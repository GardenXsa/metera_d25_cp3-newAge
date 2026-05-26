#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const runtimeData = require(path.join(ROOT, 'js', 'mods', 'runtimeData.js'));

function projectPath(...parts) {
  return path.join(ROOT, ...parts);
}

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(projectPath(relPath), 'utf8'));
}

function readJsonAbs(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isRuntimeDatabaseSectionEmpty(value) {
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return value === undefined || value === null || value === '';
}

function shouldLoadBaseDatabaseFile(manifest, key, descriptor, totalConversionActive) {
  if (!totalConversionActive) return true;
  const contract = manifest && manifest.modding_contract ? manifest.modding_contract : {};
  const totalConversion = contract.total_conversion || {};
  const allowed = Array.isArray(totalConversion.allowed_base_passthrough_keys)
    ? totalConversion.allowed_base_passthrough_keys
    : [];
  if (descriptor && descriptor.load_in_total_conversion === true) return true;
  if (allowed.includes(key)) return true;
  return totalConversion.skip_base_database_files_by_default === false;
}

function loadBaseRuntimeDatabase(manifest, totalConversionActive) {
  const database = {};
  for (const [key, descriptor] of Object.entries(manifest.database_files || {})) {
    const defaultValue = runtimeData.createDefaultValue(descriptor.default_type);
    if (!shouldLoadBaseDatabaseFile(manifest, key, descriptor, totalConversionActive)) {
      database[key] = runtimeData.cloneValue(defaultValue);
      continue;
    }

    const absPath = projectPath(descriptor.path.replace(/^\.\//, ''));
    try {
      database[key] = fs.existsSync(absPath) ? readJsonAbs(absPath) : runtimeData.cloneValue(defaultValue);
    } catch (error) {
      throw new Error(`failed to load base runtime key ${key} from ${descriptor.path}: ${error.message}`);
    }
  }
  database.runtime_manifest = manifest;
  database._runtime_contract = {
    total_conversion: totalConversionActive,
    base_data_loaded: !totalConversionActive,
    contract: manifest.modding_contract || {}
  };
  return database;
}

function readModDataFile(modRoot, fileName) {
  return readJsonAbs(path.join(modRoot, fileName));
}

function applyDeclarativeModData(database, manifest, modRoot, modJson) {
  const totalConversion = !!(modJson.total_conversion || modJson.totalConversion || modJson.mod_type === 'total_conversion');
  const resetKeys = new Set();

  for (const [rawKey, fileList] of Object.entries(modJson.data || {})) {
    if (!Array.isArray(fileList) || rawKey === 'lore' || rawKey === 'locations') continue;

    const targetKey = runtimeData.resolveRuntimeDatabaseKey(rawKey, manifest);
    const descriptor = runtimeData.getRuntimeDatabaseDescriptor(rawKey, manifest);
    const mergePolicy = descriptor && typeof descriptor.merge_policy === 'string' ? descriptor.merge_policy : 'deepMerge';

    if (totalConversion && descriptor && descriptor.replace_on_total_conversion === true && !resetKeys.has(targetKey)) {
      database[targetKey] = runtimeData.createDefaultValue(descriptor.default_type);
      resetKeys.add(targetKey);
    }

    for (const fileName of fileList) {
      const incoming = readModDataFile(modRoot, fileName);
      if (database[targetKey] === undefined) {
        const defaultType = descriptor && descriptor.default_type
          ? descriptor.default_type
          : (Array.isArray(incoming) ? 'array' : 'object');
        database[targetKey] = runtimeData.createDefaultValue(defaultType);
      }
      database[targetKey] = runtimeData.mergeRuntimeValue(database[targetKey], incoming, { mergePolicy });
    }
  }

  return database;
}

function collectItemIds(items) {
  if (Array.isArray(items)) return new Set(items.map(item => item && item.id).filter(Boolean));
  if (isPlainObject(items)) return new Set(Object.keys(items));
  return new Set();
}

function assertTagDefaultsResolveToItems(database) {
  const itemIds = collectItemIds(database.items);
  const missing = [];
  for (const [key, value] of Object.entries(database.tag_defaults || {})) {
    const values = Array.isArray(value) ? value : [value];
    for (const itemId of values) {
      if (typeof itemId === 'string' && itemId && !itemIds.has(itemId)) {
        missing.push(`${key} -> ${itemId}`);
      }
    }
  }
  assert.deepStrictEqual(missing, [], `runtime tag_defaults reference missing items: ${missing.join('; ')}`);
}

function assertEraLocationFilesExist(modRoot, modJson, eras) {
  const declaredLocationFiles = new Set((modJson.data.locations || []).map(fileName => fileName.replace(/^data\//, '')));
  for (const era of eras) {
    assert(era && era.id, 'era entry must have id');
    assert(era.default_location_file, `era ${era.id} must define default_location_file`);
    assert(
      declaredLocationFiles.has(era.default_location_file),
      `era ${era.id} default_location_file ${era.default_location_file} must be listed in mod.data.locations`
    );
    const absPath = path.join(modRoot, 'data', era.default_location_file);
    assert(fs.existsSync(absPath), `era ${era.id} location file missing: ${absPath}`);
    readJsonAbs(absPath);
  }
}

function loadCharacterStatsResolver(database) {
  const source = fs.readFileSync(projectPath('js/core/characterStatsResolver.js'), 'utf8');
  const sandbox = {
    console,
    window: {
      RUNTIME_DATABASE: database,
      RuntimeLog: {
        warn() {},
        error() {},
        info() {}
      }
    }
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'characterStatsResolver.js' });
  return sandbox.window.CharacterStatsResolver;
}

function assertCharacterCreationRuntimeFlow(database) {
  const resolver = loadCharacterStatsResolver(database);
  assert(resolver, 'CharacterStatsResolver must export to window');

  const contractErrors = Array.from(resolver.validateCharacterStatsContract(database));
  assert.strictEqual(contractErrors.length, 0, `character stats contract failed: ${contractErrors.join('; ')}`);

  const cls = database.classes.find(entry => entry && entry.id);
  const race = database.races.find(entry => entry && entry.id);
  assert(cls, 'runtime database must expose at least one class');
  assert(race, 'runtime database must expose at least one race');

  const result = resolver.resolveCharacterCreationStats({
    classId: cls.id,
    raceId: race.id,
    allocation: { str: 1 }
  });

  assert(result.valid, `resolver should resolve class=${cls.id} race=${race.id}`);
  const expectedStr = Math.max(1, Math.round(
    Number(cls.base_stats.str) + Number((race.stat_modifiers && race.stat_modifiers.str) || 0) + 1
  ));
  assert.strictEqual(result.finalStats.str, expectedStr, 'resolver finalStats.str must equal class.base_stats + race.stat_modifiers + allocation');
}

function assertWorldStartupGuardIsPresent() {
  const scriptSource = fs.readFileSync(projectPath('script.js'), 'utf8');
  assert(scriptSource.includes('armWorldGenerationWatchdog'), 'world startup watchdog function is missing');
  assert(scriptSource.includes('disableActiveModsAfterWorldStartupFailure'), 'world startup watchdog does not disable active mods');
  assert(scriptSource.includes('world startup watchdog timeout'), 'world startup watchdog timeout reason is missing');
}

function assertDisabledModResetUiIsPresent() {
  const uiSource = fs.readFileSync(projectPath('js/mods/ModManagerUI.js'), 'utf8');
  assert(uiSource.includes('clearRuntimeDisabledMod'), 'Mod Manager cannot clear runtime-disabled mods');
  assert(uiSource.includes('Сбросить блокировку и включить'), 'Mod Manager reset button text is missing');
}


function assertAppRelaunchIpcWiringIsPresent() {
  const preloadSource = fs.readFileSync(projectPath('preload.js'), 'utf8');
  const mainSource = fs.readFileSync(projectPath('main.js'), 'utf8');
  const uiSource = fs.readFileSync(projectPath('js/mods/ModManagerUI.js'), 'utf8');

  assert(preloadSource.includes("appRelaunch: () => ipcRenderer.invoke('app-relaunch')"), 'preload appRelaunch must use invoke so renderer can detect IPC failure');
  assert(mainSource.includes("ipcMain.handle('app-relaunch'"), 'main process must handle app-relaunch IPC');
  assert(mainSource.includes('app.relaunch()'), 'app-relaunch handler must call app.relaunch()');
  assert(mainSource.includes('app.exit(0)'), 'app-relaunch handler must exit current app instance');
  assert(uiSource.includes("typeof window.electronAPI.appRelaunch === 'function'"), 'Mod Manager restart button must call appRelaunch defensively');
  assert(uiSource.includes('Перезапуск...'), 'Mod Manager restart button must show restart progress');
}

function assertNoAggressiveRiverbankTags(database) {
  const bad = (database.biomes || []).filter(biome =>
    biome && Array.isArray(biome.tags) && (biome.tags.includes('riverbank') || biome.tags.includes('floodplain'))
  );
  assert.deepStrictEqual(
    bad.map(biome => biome.id),
    [],
    'total conversion runtime biomes must not include riverbank/floodplain visual loop tags'
  );
}

function main() {
  const manifest = runtimeData.normalizeRuntimeManifest(readJson('data/runtime_manifest.json')).manifest;
  const modRoot = projectPath('mods', 'neon_siltlands_core');
  const modJson = readJson('mods/neon_siltlands_core/mod.json');

  const activeMods = ['base_game', modJson.id];
  assert.deepStrictEqual(activeMods, ['base_game', 'neon_siltlands_core'], 'test active mod order must model base_game -> neon_siltlands_core');
  assert.strictEqual(modJson.total_conversion, true, 'neon_siltlands_core must remain a total conversion mod');
  assert((modJson.dependencies || []).includes('base_game'), 'neon_siltlands_core must depend on base_game');

  const database = loadBaseRuntimeDatabase(manifest, true);
  applyDeclarativeModData(database, manifest, modRoot, modJson);

  const requiredKeys = manifest.modding_contract.total_conversion.required_database_keys || [];
  const missing = requiredKeys.filter(key => isRuntimeDatabaseSectionEmpty(database[key]));
  assert.deepStrictEqual(missing, [], `total conversion runtime database is missing required keys: ${missing.join(', ')}`);

  assertEraLocationFilesExist(modRoot, modJson, database.eras);
  assertTagDefaultsResolveToItems(database);
  assertNoAggressiveRiverbankTags(database);
  assertCharacterCreationRuntimeFlow(database);
  assertWorldStartupGuardIsPresent();
  assertDisabledModResetUiIsPresent();
  assertAppRelaunchIpcWiringIsPresent();

  console.log('mod runtime E2E flow tests OK');
}

main();
