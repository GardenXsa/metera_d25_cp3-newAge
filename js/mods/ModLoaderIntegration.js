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
    const safeMode = (settings && settings.mods) ? settings.mods.safeMode : false;
    const activeMods = modsResponse.mods.filter(m => activeIds.includes(m.id) && !m.error);
    window.ModAPI.safeMode = safeMode;
    
    // Batch mutations to reduce IPC round trips
    window.ModAPI._pendingMutations = [];
    window.ModAPI._mutationFlushTimer = null;

    window.ModAPI._flushMutations = async function() {
        if (window.ModAPI._pendingMutations.length === 0) return;
        const batch = window.ModAPI._pendingMutations.splice(0);
        clearTimeout(window.ModAPI._mutationFlushTimer);
        window.ModAPI._mutationFlushTimer = null;
        await window.ModAPI.applyModChanges(batch);
    };

    // Настройка моста между C++ хуками и JS модами (with IPC batching)
    if (window.electronAPI && window.electronAPI.onNexusHookRequest) {
        window.electronAPI.onNexusHookRequest(async (hook, world) => {
            // Передаем состояние мира модам для модификации
            await window.ModAPI.emit(hook, world);
            // Flush any pending mutations after all hooks processed
            await window.ModAPI._flushMutations();
            // Возвращаем измененный мир обратно в C++ ядро, чтобы оно продолжило симуляцию
            await window.electronAPI.sendNexusHookResponse(world);
        });
    }

    // ModKit 3.0: Listen for async mod events from engine (fire-and-forget)
    if (window.electronAPI && window.electronAPI.onNexusModEvent) {
        window.electronAPI.onNexusModEvent(async (data) => {
            if (data && data.event) {
                // Emit to ModAPI hooks with the context data
                await window.ModAPI.emit(data.event, data.context || {});
            }
        });
    }

    await modLoader.initMods(activeMods);

    // --- ФИКС: Скрытие ванильных эпох при тотальной конверсии ---
    if (window.ModAPI.isTotalConversion) {
        const eraSelect = document.getElementById('char-era-select');
        if (eraSelect) {
            Array.from(eraSelect.options).forEach(opt => {
                // Оставляем только базовую эпоху (которую мод переименовывает)
                if (window.gamedata?.eras && !window.gamedata.eras.some(e => e.id === opt.value) && opt.value !== 'rebirth') {
                    opt.style.display = 'none';
                    opt.disabled = true;
                }
            });
            // Если была выбрана скрытая эпоха, сбрасываем на базовую
            if (window.gamedata?.eras && !window.gamedata.eras.some(e => e.id === eraSelect.value) && eraSelect.value !== 'rebirth') {
                eraSelect.value = 'rebirth';
            }
            if (typeof updateEraDescription === 'function') updateEraDescription();
        }
    }

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
        let database = { items: {}, recipes: [], facilities: {}, biomes: [], city_gen: {}, monsters: [], disasters: [], races: [], professions: [], traits: [], npc_names: {}, faction_relations: {}, world_config: {}, tag_defaults: {}, classes: [], eras: [], diplomacy: {}, casus_belli: {}, ship_types: {}, container_types: {}, map_markers: {}, equipment_slots: [], news_categories: [], building_types: {} };
        if (window.ModAPI && window.ModAPI.isTotalConversion) {
            console.log('[ModLoader] Тотальная конверсия: пропуск загрузки ванильной БД.');
        } else {
            database.items = await modLoader.readJsonFile('./data/economy_items.json');
            database.recipes = await modLoader.readJsonFile('./data/economy_recipes.json');
            database.facilities = await modLoader.readJsonFile('./data/facility_names.json');
            database.biomes = await modLoader.readJsonFile('./data/biomes.json');
            database.city_gen = await modLoader.readJsonFile('./data/city_gen.json');
            database.monsters = await modLoader.readJsonFile('./data/monsters.json');
            database.disasters = await modLoader.readJsonFile('./data/disasters.json');
            database.races = await modLoader.readJsonFile('./data/races.json');
            database.professions = await modLoader.readJsonFile('./data/professions.json');
            database.traits = await modLoader.readJsonFile('./data/traits.json');
            database.npc_names = await modLoader.readJsonFile('./data/npc_names.json');
            database.faction_relations = await modLoader.readJsonFile('./data/faction_relations.json');
            database.world_config = await modLoader.readJsonFile('./data/world_config.json');
            database.tag_defaults = await modLoader.readJsonFile('./data/tag_defaults.json');
            database.classes = await modLoader.readJsonFile('./data/classes.json');
            database.eras = await modLoader.readJsonFile('./data/eras.json');
            database.diplomacy = await modLoader.readJsonFile('./data/diplomacy.json');
            database.casus_belli = await modLoader.readJsonFile('./data/casus_belli.json');
            database.ship_types = await modLoader.readJsonFile('./data/ship_types.json');
            database.container_types = await modLoader.readJsonFile('./data/container_types.json');
            database.map_markers = await modLoader.readJsonFile('./data/map_markers.json');
            database.equipment_slots = await modLoader.readJsonFile('./data/equipment_slots.json');
            database.news_categories = await modLoader.readJsonFile('./data/news_categories.json');
            database.building_types = await modLoader.readJsonFile('./data/building_types.json');
        }
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
        
        // В безопасном режиме не передаем C++ ядру моды с нативными плагинами
        const activeModIds = Object.keys(window.ModAPI.mods).filter(id => {
            const m = window.ModAPI.mods[id];
            if (window.ModAPI.safeMode && m.native_plugins && m.native_plugins.length > 0) {
                console.warn(`[ModLoader] Safe Mode: Блокировка загрузки нативного плагина для мода ${id}`);
                return false;
            }
            return true;
        });
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
        
        let customGrid = null;
        if (window.ModAPI && window.ModAPI._customMapGenerator) {
            console.log('[ModLoader] Запуск кастомного генератора карты из мода...');
            customGrid = await window.ModAPI._customMapGenerator(database.world_config.map_width || 256, database.world_config.map_height || 256);
        }
        
        const buildResult = await window.electronAPI.nexusBuildWorld(player.id, player.era, initialAgents, globalLocations, startDay, customGrid);
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
