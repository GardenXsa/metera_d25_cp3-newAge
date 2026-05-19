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
    
    // Настройка моста между C++ хуками и JS модами
    if (window.electronAPI && window.electronAPI.onNexusHookRequest) {
        window.electronAPI.onNexusHookRequest(async (hook, world) => {
            // Передаем состояние мира модам для модификации
            await window.ModAPI.emit(hook, world);
            // Возвращаем измененный мир обратно в C++ ядро, чтобы оно продолжило симуляцию
            await window.electronAPI.sendNexusHookResponse(world);
        });
    }

    await modLoader.initMods(activeMods);
    window.ModAPI.initialized = true;
}

async function loadDatabaseWithModsAndInitEngine(initialAgents, startDay, isLoadMode = false) {
    if (window.isSimulatorInitialized) return typeof World !== 'undefined' ? World : null;
    
    if (typeof showLoadingScreen === 'function') {
        showLoadingScreen('loadingScreen.generatingWorld', 'Инициализация симулятора (с модами)...');
    }

    try {
        if (typeof initModKit === 'function') await initModKit();

        const modLoader = new ModLoader();
        let database = { items: {}, recipes: [], facilities: {} };
        if (window.ModAPI && window.ModAPI.isTotalConversion) {
            console.log('[ModLoader] Тотальная конверсия: пропуск загрузки ванильной БД (items, recipes, facilities).');
        } else {
            database.items = await modLoader.readJsonFile('./data/economy_items.json');
            database.recipes = await modLoader.readJsonFile('./data/economy_recipes.json');
            database.facilities = await modLoader.readJsonFile('./data/facility_names.json');
        }

        
        // --- DATA-DRIVEN REFACTOR ---
        // Load all game data from JSON files.
        database.biomes = await modLoader.readJsonFile('./data/biomes.json');
        database.city_gen = await modLoader.readJsonFile('./data/city_gen.json');
        database.monsters = await modLoader.readJsonFile('./data/monsters.json');
        database.disasters = await modLoader.readJsonFile('./data/disasters.json');
        // Phase 1: Character registries
        database.races = await modLoader.readJsonFile('./data/races.json');
        database.professions = await modLoader.readJsonFile('./data/professions.json');
        database.traits = await modLoader.readJsonFile('./data/traits.json');
        database.npc_names = await modLoader.readJsonFile('./data/npc_names.json');
        database.faction_relations = await modLoader.readJsonFile('./data/faction_relations.json');
        // World generation config
        database.world_config = await modLoader.readJsonFile('./data/world_config.json');
        // --- END REFACTOR ---

        // --- BIOME COLOR SYNC ---
        // Extract biome colors from biomes.json and expose as global BIOME_COLORS array.
        // This ensures the JS Cartographer uses the same colors as the C++ engine,
        // preventing biome color desync between clients and the map renderer.
        if (Array.isArray(database.biomes)) {
            window.BIOME_COLORS = database.biomes
                .sort((a, b) => (a.numeric_id ?? 0) - (b.numeric_id ?? 0))
                .map(b => b.color_hex || '#000000');
            console.log(`[ModLoader] BIOME_COLORS synchronized from biomes.json (${window.BIOME_COLORS.length} biomes)`);
        }
        // --- END BIOME COLOR SYNC ---

        // Apply data-driven stats to JS constants (BASE_CLASS_STATS, RACE_MODIFIERS)
        if (typeof applyDatabaseStats === 'function' && database.races) {
            applyDatabaseStats(database.races);
        }

        await window.ModAPI.emit('onDatabaseLoad', database);

        console.log('[ModLoader] База данных собрана. Инициализация C++ ядра...');
        
        const activeModIds = Object.keys(window.ModAPI.mods);
        const initResult = await window.electronAPI.nexusInit(true, activeModIds);
        if (initResult.status !== 'ok') {
            throw new Error(`Nexus Engine init failed: ${initResult.message}`);
        }

        console.log('[ModLoader] Ядро запущено. Загрузка базы данных...');
        
        // --- DATA-DRIVEN REFACTOR ---
        // Send the entire database as a single stringified JSON.
        const databaseString = JSON.stringify(database);
        const loadDbResult = await window.electronAPI.nexusLoadDatabase(databaseString);
        // --- END REFACTOR ---

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
