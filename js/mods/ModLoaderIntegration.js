function getRuntimeDataUtils() {
    if (!window.RuntimeDataUtils) {
        throw new Error('RuntimeDataUtils is not loaded.');
    }
    return window.RuntimeDataUtils;
}

function createDefaultValue(defaultType) {
    return defaultType === 'array' ? [] : {};
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
    const activeIds = (settings && settings.mods) ? settings.mods.active : ['base_game'];
    const activeMods = modsResponse.mods.filter(m => activeIds.includes(m.id) && !m.error);
    
    if (window.electronAPI && window.electronAPI.onNexusHookRequest) {
        window.electronAPI.onNexusHookRequest(async (hook, world) => {
            await window.ModAPI.emit(hook, world);
            await window.electronAPI.sendNexusHookResponse(world);
        });
    }

    await modLoader.initMods(activeMods);
    window.ModAPI.initialized = true;
}

async function buildRuntimeDatabase() {
    const utils = getRuntimeDataUtils();
    const modLoader = new ModLoader();
    const manifest = await modLoader.readJsonFile('./data/runtime_manifest.json');
    const manifestFiles = manifest && manifest.database_files ? manifest.database_files : {};
    const database = {};

    for (const [key, descriptor] of Object.entries(manifestFiles)) {
        const defaultValue = createDefaultValue(descriptor.default_type);
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

    await window.ModAPI.emit('onDatabaseLoad', database);

    if (database.prompt_pack) {
        database.prompt_pack = await hydratePromptPack(database.prompt_pack);
    }

    database.runtime_manifest = manifest;
    return database;
}

function applyRuntimeDatabaseGlobals(database) {
    window.RUNTIME_DATABASE = database;
    window.RUNTIME_MANIFEST = database.runtime_manifest || {};
    window.ERAS_DATA = database.eras || [];
    window.RACES_DATA = database.races || [];
    window.CLASSES_DATA = database.classes || [];
    window.EQUIPMENT_SLOTS = database.equipment_slots || ["head", "face", "neck", "shoulders", "torso", "right_hand", "left_hand", "legs", "feet"];
    window.WORLD_CONFIG = database.world_config || {};
    window.CONTAINER_TYPES = database.container_types || {};
    window.SHIP_TYPES = database.ship_types || {};
    window.DIPLOMACY = database.diplomacy || {};
    window.CASUS_BELLI = database.casus_belli || {};
    window.FURNITURE_CATALOG = database.furniture_catalog || {};
    window.TAG_DEFAULTS = database.tag_defaults || {};
    window.ECONOMY_ITEMS = database.items || {};
    window.CRAFTING_RECIPES = database.recipes || [];
    window.FACILITY_NAMES = database.facilities || {};
    window.TREK_CONFIG = database.trek_config || { base_travel_speed: 5, tick_interval_ms: 1000 };
    window.TILE_TYPE_DICTIONARY = database.tile_dictionary || {};
    window.TRANSPORT_REGISTRY = database.transport_registry || {};
    window.NARRATORS_DATA = database.narrators || [];
    window.PREDEFINED_EFFECTS_DATA = database.predefined_effects || []; window.UI_RUNTIME_CONFIG = database.ui_runtime || {}; window.PROMPT_RUNTIME_CONFIG = database.prompt_runtime || {}; window.GAMEPLAY_RUNTIME_CONFIG = database.gameplay_runtime || {}; if (typeof applyRuntimeConstants === 'function') { applyRuntimeConstants(window.UI_RUNTIME_CONFIG); } if (Array.isArray(database.biomes)) {
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
            console.warn('[RuntimeData] Список эпох пуст. Использую fallback (rebirth).');
            database.eras = [{
                id: 'rebirth',
                name: 'Возрождение',
                start_year: 1042,
                default_location_file: 'locations_expanded.json',
                display_name_i18n_key: 'characterCreation.eraRebirth',
                description_i18n_key: 'characterCreation.eraRebirthDesc'
            }];
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
    const fallbackFile = (database.runtime_manifest && database.runtime_manifest.era_location_fallback_file) || 'locations_rebirth.json';
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

        if (typeof applyDatabaseStats === 'function' && database.races) {
            applyDatabaseStats(database.races);
        }

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
