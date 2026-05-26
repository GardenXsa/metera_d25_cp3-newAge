function getRuntimeDataUtils() {
    if (!window.RuntimeDataUtils) {
        throw new Error('RuntimeDataUtils is not loaded.');
    }
    return window.RuntimeDataUtils;
}

function createDefaultValue(defaultType) {
  const utils = getRuntimeDataUtils();
  if (typeof utils.createDefaultValue === 'function') {
    return utils.createDefaultValue(defaultType);
  }
  if (defaultType === 'array') return [];
  if (defaultType === 'string') return '';
  if (defaultType === 'number') return 0;
  if (defaultType === 'boolean') return false;
  if (defaultType === 'null') return null;
  return {};
}

function isRuntimeTotalConversion() {
  return !!(window.ModAPI && window.ModAPI.isTotalConversion);
}

function shouldLoadBaseDatabaseFile(manifest, key, descriptor) {
  if (!isRuntimeTotalConversion()) return true;
  const contract = manifest && manifest.modding_contract ? manifest.modding_contract : {};
  const totalConversion = contract.total_conversion || {};
  const allowed = Array.isArray(totalConversion.allowed_base_passthrough_keys) ? totalConversion.allowed_base_passthrough_keys : [];
  if (descriptor && descriptor.load_in_total_conversion === true) return true;
  if (allowed.includes(key)) return true;
  return totalConversion.skip_base_database_files_by_default === false;
}

function isRuntimeDatabaseSectionEmpty(value) {
  if (Array.isArray(value)) return value.length === 0;
  if (value && typeof value === 'object') return Object.keys(value).length === 0;
  return value === undefined || value === null || value === '';
}

function validateRuntimeDatabaseContract(database, manifest) {
  const contract = manifest && manifest.modding_contract ? manifest.modding_contract : {};
  const totalConversion = contract.total_conversion || {};
  const requiredKeys = Array.isArray(totalConversion.required_database_keys) ? totalConversion.required_database_keys : [];
  if (!isRuntimeTotalConversion()) return;
  const missing = requiredKeys.filter((key) => isRuntimeDatabaseSectionEmpty(database[key]));
  if (missing.length > 0) {
    throw new Error(`[RuntimeData] total_conversion/base-data-off database is missing required sections: ${missing.join(', ')}`);
  }
}


function validateRuntimeCharacterStatsContract(database) {
  if (!window.CharacterStatsResolver || typeof window.CharacterStatsResolver.validateCharacterStatsContract !== 'function') {
    console.warn('[RuntimeData] CharacterStatsResolver is not available; character stats contract was not validated.');
    return;
  }

  const errors = window.CharacterStatsResolver.validateCharacterStatsContract(database);
  if (errors.length > 0) {
    const preview = errors.slice(0, 30).join('; ');
    const suffix = errors.length > 30 ? `; ...and ${errors.length - 30} more` : '';
    const message = `[RuntimeData] character stats contract failed (${errors.length}): ${preview}${suffix}`;
    if (window.RuntimeLog) window.RuntimeLog.error('RuntimeData', message, errors);
    throw new Error(message);
  }
}

function attachRuntimeDatabaseContractMetadata(database, manifest) {
  database._runtime_contract = {
    total_conversion: isRuntimeTotalConversion(),
    base_data_loaded: !isRuntimeTotalConversion(),
    contract: manifest && manifest.modding_contract ? manifest.modding_contract : {}
  };
}


function renderTemplate(template, replacements) {
    let output = template || '';
    Object.entries(replacements || {}).forEach(([key, value]) => {
        output = output.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    });
    return output;
}

async function loadTextAsset(assetPath) {
    const response = await fetch(`${assetPath}?t=${Date.now()}`);
    if (!response.ok) {
        throw new Error(`Failed to load text asset ${assetPath}: HTTP ${response.status}`);
    }
    return response.text();
}

async function hydratePromptPack(promptPack) {
    const utils = getRuntimeDataUtils();
    const hydratedPack = utils.cloneValue(promptPack || {});
    if (!utils.isPlainObject(hydratedPack.entries)) {
        hydratedPack.entries = {};
    }
    if (!utils.isPlainObject(hydratedPack.aliases)) {
        hydratedPack.aliases = {};
    }

    const keys = Object.keys(hydratedPack.entries);
    await Promise.all(keys.map(async (semanticKey) => {
        const entry = hydratedPack.entries[semanticKey];
        if (!entry || typeof entry !== 'object') {
            return;
        }
        if (!entry.content && entry.path) {
            try {
                entry.content = await loadTextAsset(entry.path);
            } catch (error) {
                console.warn(`[RuntimeData] Failed to hydrate prompt "${semanticKey}" from ${entry.path}:`, error);
                entry.content = `Ошибка: не удалось загрузить prompt "${semanticKey}" из ${entry.path}. ${error.message}`;
            }
        }
        utils.ensurePromptAlias(hydratedPack, semanticKey, entry.path);
    }));

    return hydratedPack;
}

async function initModKit() {
    if (window.ModAPI && window.ModAPI.initialized) return;
    console.log('[ModKit] Инициализация глобального API модов...');
    const modLoader = new ModLoader();
    
    if (!window.electronAPI || !window.electronAPI.isElectron) {
        if (window.ModAPI) window.ModAPI.initialized = true;
        return;
    }

    const modsResponse = await window.electronAPI.modsGetList();
    if (!modsResponse.success) return;
    
    const settings = await window.electronAPI.loadSettings();
    const disabledMods = (settings && settings.mods && settings.mods.disabled && typeof settings.mods.disabled === 'object') ? settings.mods.disabled : {};
    const disabledModIds = new Set(Object.keys(disabledMods));
    const activeIdsRaw = (settings && settings.mods && Array.isArray(settings.mods.active)) ? settings.mods.active : ['base_game'];
    const activeIds = activeIdsRaw.filter(id => id === 'base_game' || !disabledModIds.has(id));
    if (activeIds.length !== activeIdsRaw.length && window.RuntimeLog) {
        window.RuntimeLog.warn('ModKit', 'Некоторые моды были автоотключены и пропущены при загрузке.', { disabled: Object.keys(disabledMods) });
    }
    const activeMods = modsResponse.mods.filter(m => activeIds.includes(m.id) && !m.error);
    
    // Legacy hook_request: engine fires hook and waits for world response
    if (window.electronAPI && window.electronAPI.onNexusHookRequest) {
        window.electronAPI.onNexusHookRequest(async (hook, world) => {
            await window.ModAPI.emit(hook, world);
            await window.electronAPI.sendNexusHookResponse(world);
        });
    }

    // New hook_event: lightweight fire-and-forget with specific event data
    if (window.electronAPI && window.electronAPI.onNexusHookEvent) {
        window.electronAPI.onNexusHookEvent(async (hookName, data) => {
            if (window.ModAPI) await ModAPI.emit(hookName, data);
        });
    }

    await modLoader.initMods(activeMods);
    window.ModAPI.initialized = true;

    // Register which hooks mods are listening to (engine skips unregistered hooks)
    await registerEngineHooks();
}

async function registerEngineHooks() {
    if (!window.electronAPI || !window.electronAPI.nexusRegisterHooks) return;
    const modHooks = (window.ModAPI && ModAPI.hooks) ? Object.keys(ModAPI.hooks) : [];
    const baseEngineHooks = [
        'onNpcDied','onNpcBorn','onNpcJobChanged','onRulerDied',
        'onArmyCreated','onArmyMoved','onArmyDestroyed','onSiegeStarted',
        'onRegionCaptured','onWarDeclared','onPeaceMade','onRelationsChanged',
        'onFacilityUpgraded','onFacilityDestroyed','onFleetCreated',
        'onShipDestroyed','onPortBuilt','onRevoltStarted','onFamineStarted',
        'onMonsterSpawned','onDisasterTriggered','onGlobalEvent',
        'onIntrigueDiscovered','onTradeCompleted','onBanditEncounter',
        'onSeasonChanged','onWeatherChanged',
        'onBeforeDailyTick','onAfterDailyTick','onBeforeHourlyTick','onAfterHourlyTick'
    ];
    const all = [...new Set([...baseEngineHooks, ...modHooks])];
    try {
        await window.electronAPI.nexusRegisterHooks(all);
        console.log('[ModKit] Engine hooks registered:', all.length);
    } catch(e) {
        console.warn('[ModKit] registerEngineHooks failed:', e.message);
    }
}

async function buildRuntimeDatabase() {
    const utils = getRuntimeDataUtils();
    const modLoader = new ModLoader();
    const rawManifest = await modLoader.readJsonFile('./data/runtime_manifest.json');
    const normalizedManifest = typeof utils.normalizeRuntimeManifest === 'function'
        ? utils.normalizeRuntimeManifest(rawManifest).manifest
        : rawManifest;
    const manifestFiles = normalizedManifest && normalizedManifest.database_files ? normalizedManifest.database_files : {};
    const database = {};

    for (const [key, descriptor] of Object.entries(manifestFiles)) {
    const defaultValue = createDefaultValue(descriptor.default_type);
    if (!shouldLoadBaseDatabaseFile(normalizedManifest, key, descriptor)) {
      database[key] = utils.cloneValue(defaultValue);
      continue;
    }
    try {
      const rawValue = await modLoader.readJsonFile(descriptor.path);
      database[key] = rawValue ?? defaultValue;
    } catch (error) {
      console.warn(`[RuntimeData] Failed to load ${key} from ${descriptor.path}, using default.`, error);
      database[key] = utils.cloneValue(defaultValue);
    }
  }

    if (database.prompt_pack) {
        database.prompt_pack = await hydratePromptPack(database.prompt_pack);
    }

    database.runtime_manifest = normalizedManifest;
    attachRuntimeDatabaseContractMetadata(database, normalizedManifest);
  await window.ModAPI.emit('onDatabaseLoad', database);
  validateRuntimeDatabaseContract(database, normalizedManifest);
  validateRuntimeCharacterStatsContract(database);
  return database;
}

function assertRuntimeSection(database, key, validator, expected) {
    const value = database ? database[key] : undefined;
    if (!validator(value)) {
        throw new Error(`[RuntimeData] Required runtime section "${key}" is missing or invalid (expected ${expected})`);
    }
}

function applyRuntimeDatabaseGlobals(database) {
    assertRuntimeSection(database, 'eras', (v) => Array.isArray(v) && v.length > 0, 'non-empty array');
    assertRuntimeSection(database, 'equipment_slots', Array.isArray, 'array');
    assertRuntimeSection(database, 'trek_config', (v) => v && typeof v === 'object', 'object');
    assertRuntimeSection(database, 'gameplay_runtime', (v) => v && typeof v === 'object', 'object');
    assertRuntimeSection(database, 'ui_runtime', (v) => v && typeof v === 'object', 'object');
    assertRuntimeSection(database, 'prompt_runtime', (v) => v && typeof v === 'object', 'object');
    window.RUNTIME_DATABASE = database;
    window.RUNTIME_MANIFEST = database.runtime_manifest || {};
    window.ERAS_DATA = database.eras;
    window.RACES_DATA = database.races;
    window.CLASSES_DATA = database.classes;
    window.EQUIPMENT_SLOTS = database.equipment_slots;
    window.WORLD_CONFIG = database.world_config || {};
    window.CONTAINER_TYPES = database.container_types || {};
    window.SHIP_TYPES = database.ship_types || {};
    window.DIPLOMACY = database.diplomacy || {};
    window.CASUS_BELLI = database.casus_belli || {};
    window.FURNITURE_CATALOG = database.furniture_catalog || {};
    window.TAG_DEFAULTS = database.tag_defaults || {};
    window.ECONOMY_ITEMS = database.items || {};
    window.CRAFTING_RECIPES = database.recipes;
    window.FACILITY_NAMES = database.facilities || {};
    window.TREK_CONFIG = database.trek_config;
    window.TILE_TYPE_DICTIONARY = database.tile_dictionary || {};
    window.TRANSPORT_REGISTRY = database.transport_registry || {};
    window.NARRATORS_DATA = database.narrators;
    window.PREDEFINED_EFFECTS_DATA = database.predefined_effects; window.UI_RUNTIME_CONFIG = database.ui_runtime; window.PROMPT_RUNTIME_CONFIG = database.prompt_runtime; window.GAMEPLAY_RUNTIME_CONFIG = database.gameplay_runtime; if (typeof applyRuntimeConstants === 'function') { applyRuntimeConstants(window.UI_RUNTIME_CONFIG); } if (Array.isArray(database.biomes)) {
        window.BIOME_COLORS = database.biomes
            .slice()
            .sort((a, b) => (a.numeric_id ?? 0) - (b.numeric_id ?? 0))
            .map(b => b.color_hex || '#000000');
        console.log(`[RuntimeData] BIOME_COLORS synchronized (${window.BIOME_COLORS.length} biomes)`);
    }
}

async function ensureRuntimeDataLoaded(forceRefresh = false) {
    if (window.RUNTIME_DATABASE && !forceRefresh) {
        return window.RUNTIME_DATABASE;
    }
    if (window.RUNTIME_DATABASE_PROMISE && !forceRefresh) {
        return window.RUNTIME_DATABASE_PROMISE;
    }

    window.RUNTIME_DATABASE_PROMISE = (async () => {
        if (typeof initModKit === 'function') {
            await initModKit();
        }

        const database = await buildRuntimeDatabase();

        if (!database.eras || database.eras.length === 0) {
            throw new Error('[RuntimeData] Required runtime section "eras" is missing or empty.');
            
        }

        applyRuntimeDatabaseGlobals(database);
        return database;
    })();

    try {
        return await window.RUNTIME_DATABASE_PROMISE;
    } finally {
        if (forceRefresh) {
            window.RUNTIME_DATABASE_PROMISE = null;
        }
    }
}

function getRuntimeDatabase() {
    return window.RUNTIME_DATABASE || null;
}

function getRuntimePrompt(keyOrPath) {
    const database = getRuntimeDatabase();
    const utils = getRuntimeDataUtils();
    return utils.resolvePromptEntry(database ? database.prompt_pack : null, keyOrPath);
}

function resolveEraLocationInfo(eraId) {
    const database = getRuntimeDatabase() || {};
    const utils = getRuntimeDataUtils();
    const fallbackFile = (database.runtime_manifest && database.runtime_manifest.era_location_fallback_file)
        || (Array.isArray(database.eras) ? database.eras.find((era) => era && typeof era.default_location_file === 'string' && era.default_location_file)?.default_location_file : '');
    const result = utils.resolveEraLocationFile(database.eras || [], eraId, fallbackFile);
    if (result.warning) {
        console.warn(result.warning);
    }
    return result;
}

function resolveWorldAssetPath(assetKey, replacements) {
    const database = getRuntimeDatabase() || {};
    const worldAssets = database.world_assets || {};
    const localizedAssets = worldAssets.localized_assets || {};

    if (assetKey === 'lore_template' && worldAssets.lore_template) {
        return renderTemplate(worldAssets.lore_template, replacements);
    }
    if (assetKey === 'locations_template' && worldAssets.locations_template) {
        return renderTemplate(worldAssets.locations_template, replacements);
    }
    if (localizedAssets[assetKey]) {
        return renderTemplate(localizedAssets[assetKey], replacements);
    }
    return '';
}

window.ensureRuntimeDataLoaded = ensureRuntimeDataLoaded;
window.getRuntimeDatabase = getRuntimeDatabase;
window.getRuntimePrompt = getRuntimePrompt;
window.resolveEraLocationInfo = resolveEraLocationInfo;
window.resolveWorldAssetPath = resolveWorldAssetPath;

async function loadDatabaseWithModsAndInitEngine(initialAgents, startDay, isLoadMode = false) {
    if (window.isSimulatorInitialized) return typeof World !== 'undefined' ? World : null;
    
    if (typeof showLoadingScreen === 'function') {
        showLoadingScreen('loadingScreen.generatingWorld', 'Инициализация симулятора (с модами)...');
    }

    try {
        const utils = getRuntimeDataUtils();
        const runtimeDatabase = await ensureRuntimeDataLoaded();
        const database = utils.cloneValue(runtimeDatabase);

        if (typeof populateErasUI === 'function') populateErasUI(database.eras);
        if (typeof populateRacesUI === 'function') populateRacesUI(database.races);
        if (typeof populateClassesUI === 'function') populateClassesUI(database.classes);

        console.log('[ModLoader] База данных собрана. Инициализация C++ ядра...');
        
        const activeModIds = Object.keys(window.ModAPI.mods);
        const initResult = await window.electronAPI.nexusInit(true, activeModIds);
        if (initResult.status !== 'ok') {
            throw new Error(`Nexus Engine init failed: ${initResult.message}`);
        }

        console.log('[ModLoader] Ядро запущено. Загрузка базы данных...');
        const databaseString = JSON.stringify(database);
        const loadDbResult = await window.electronAPI.nexusLoadDatabase(databaseString);

        if (loadDbResult.status !== 'ok') {
            throw new Error(`Failed to load database into engine: ${loadDbResult.message}`);
        }

        window.isSimulatorInitialized = true;

        if (isLoadMode) {
            return typeof World !== 'undefined' ? World : null;
        }

        if (typeof showLoadingScreen === 'function') {
            showLoadingScreen('loadingScreen.generatingWorld', 'Построение мира...');
        }
        
        const buildResult = await window.electronAPI.nexusBuildWorld(player.id, player.era, initialAgents, globalLocations, startDay);
        if (buildResult.status !== 'ok') throw new Error(`World build failed: ${buildResult.message}`);
        
        let newWorld = buildResult.world;
        if (newWorld) {
            Object.values(newWorld.regions || {}).forEach(r => {
                if (r.vault_id) setContainer(r.vault_id, { id: r.vault_id, type: 'faction_vault', items: [], owner_id: r.factionId, max_weight_kg: 999999, max_slots: 1000 });
            });
        }
        return newWorld;

    } catch (error) {
        console.error("CRITICAL: World simulator initialization failed:", error);
        if (typeof showAiErrorModal === 'function') {
            showAiErrorModal(error.message, true, null, "Ошибка инициализации ядра");
        }
        window.isSimulatorInitialized = false;
        return null;
    }
}
