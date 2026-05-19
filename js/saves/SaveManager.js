// --- ЯДРО СИСТЕМЫ СОХРАНЕНИЙ (Логика, Таймеры, Сборка данных) ---

let _saving = false; // Mutex-флаг для предотвращения гонки сохранений
let _savingTimer = null; // Safety timeout to reset mutex if finally block is skipped

/**
 * Обрабатывает один распарсенный блок сохранения.
 * Выделено из трёх дублирующихся switch-блоков (Electron chunk loop, leftover, localStorage).
 */
function processSaveBlock(parsed, rawWorld) {
    switch(parsed.block) {
        case 'player': return { rawPlayer: parsed.data };
        case 'history': return { rawHistory: parsed.data };
        case 'item_registry': ItemRegistry.clear(); parsed.data.forEach(([k, v]) => ItemRegistry.set(k, v)); break;
        case 'container_registry': ContainerRegistry.clear(); parsed.data.forEach(([k, v]) => setContainer(k, v)); break;
        case 'world_base': Object.assign(rawWorld, parsed.data); break;
        case 'world_regions': rawWorld.regions = parsed.data; break;
        case 'world_factions': rawWorld.factions = parsed.data; break;
        case 'world_npcs': rawWorld.npcs = parsed.data; break;
        case 'world_rulers': rawWorld.rulers = parsed.data.rulers; rawWorld.intrigues = parsed.data.intrigues; break;
        case 'world_businesses': rawWorld.businesses = parsed.data; break;
        case 'world_ships': rawWorld.ships = parsed.data.ships; rawWorld.fleets = parsed.data.fleets; rawWorld.port_facilities = parsed.data.ports; break;
        case 'world_monsters': rawWorld.monsters = parsed.data; break;
        case 'world_sublocations': rawWorld.subLocations = parsed.data; break;
        case 'world_map': rawWorld.map = parsed.data; break;
        case 'world_trek': rawWorld.player_trek = parsed.data; break;
        case 'world_misc': Object.assign(rawWorld, parsed.data); break;
        case 'mod_data':
            if (window.ModAPI && window.ModAPI.saveHandlers) {
                for (const [modId, data] of Object.entries(parsed.data || {})) {
                    try {
                        if (window.ModAPI.saveHandlers[modId] && window.ModAPI.saveHandlers[modId].onLoad) {
                            window.ModAPI.saveHandlers[modId].onLoad(data);
                        }
                    } catch(e) { console.error(`[ModAPI] Ошибка загрузки в моде ${modId}:`, e); }
                }
            }
            break;
    }
    return {};
}

async function saveGame(slotType, slotId) {
    if (_saving) return false;
    _saving = true;
    // Safety: reset mutex after 60s even if finally doesn't run
    clearTimeout(_savingTimer);
    _savingTimer = setTimeout(() => { console.warn('[SaveManager] Mutex safety timeout — forcing reset'); _saving = false; }, 60000);
    if (isWaitingForAI || !player) { _saving = false; clearTimeout(_savingTimer); return false; }
    showLoadingScreen('loadingScreen.saving', 'Подготовка к сохранению...');
    await yieldThread();

    try {
        const fileName = getSaveFileName(slotType, slotId);
        const isElectron = window.electronAPI && window.electronAPI.isElectron;
        let lines = [];
        let blockCount = 1;

        if (isElectron) await window.electronAPI.initSaveFile(fileName);

        const addBlock = async (name, id, data) => {
            updateLoadingText(`Сохраняем блок ${blockCount++}: ${name}...`);
            await yieldThread();
            const lineStr = JSON.stringify({ block: id, data: data }) + '\n';
            if (isElectron) {
                await window.electronAPI.appendSaveLine(fileName, lineStr);
            } else {
                lines.push(lineStr.trim());
            }
            await yieldThread();
        };

        if (isElectron && window.electronAPI.nexusGetFullState) {
            updateLoadingText('Синхронизация с ядром симуляции...');
            await yieldThread();
            
            // Забираем актуальный мир и реестры из C++ (С++ является абсолютным источником правды)
            const fullState = await window.electronAPI.nexusGetFullState(player?.location || "");
            if (fullState && fullState.status === 'ok') {
                if (fullState.world) World = fullState.world;
                if (fullState.relevant_news) World.relevant_news = fullState.relevant_news;
                if (fullState.items) {
                    ItemRegistry.clear();
                    fullState.items.forEach(([k, v]) => ItemRegistry.set(k, v));
                }
                if (fullState.containers) {
                    ContainerRegistry.clear();
                    fullState.containers.forEach(([k, v]) => setContainer(k, v));
                }
            }
        }

        const metaData = {
            slotType, slotId, timestamp: new Date().toISOString(),
            playerData: { name: player.name, stats: { level: player.stats.level } }
        };
        
        await addBlock("Метаданные", "meta", metaData);
        await addBlock("Данные персонажа", "player", player);
        await addBlock("История диалогов", "history", conversationHistory);
        await addBlock("Реестр предметов", "item_registry", Array.from(ItemRegistry.entries()));
        await addBlock("Реестр контейнеров", "container_registry", Array.from(ContainerRegistry.entries()));

        if (typeof World !== 'undefined' && World) {
            await addBlock("Время и гомеостаз", "world_base", { tick: World.tick, era: World.era, time: World.time, homeostasis: World.homeostasis, lastDirectInjectionDay: World.lastDirectInjectionDay, needsGlobalEvent: World.needsGlobalEvent });
            await addBlock("Регионы мира", "world_regions", World.regions);
            await addBlock("Фракции", "world_factions", World.factions);
            await addBlock("Население (NPC)", "world_npcs", World.npcs);
            await addBlock("Правители и Интриги", "world_rulers", { rulers: World.rulers, intrigues: World.intrigues });
            await addBlock("Предприятия", "world_businesses", World.businesses);
            await addBlock("Корабли и Порты", "world_ships", { ships: World.ships, fleets: World.fleets, ports: World.port_facilities });
            await addBlock("Монстры", "world_monsters", World.monsters);
            await addBlock("Подлокации", "world_sublocations", World.subLocations);
            await addBlock("Глобальная карта", "world_map", World.map);
            await addBlock("Путешествие", "world_trek", World.player_trek);
            await addBlock("Летопись и Прочее", "world_misc", { news: World.news, gmInterventionHistory: World.gmInterventionHistory });
        }

        // --- ИНТЕГРАЦИЯ МОДОВ: Сохранение кастомных данных ---
        if (window.ModAPI && window.ModAPI.saveHandlers) {
            let modData = {};
            for (const [modId, handler] of Object.entries(window.ModAPI.saveHandlers)) {
                try {
                    if (handler.onSave) modData[modId] = handler.onSave();
                } catch(e) { console.error(`[ModAPI] Ошибка сохранения в моде ${modId}:`, e); }
            }
            await addBlock("Данные модов", "mod_data", modData);
        }
        // -----------------------------------------------------

        const allSaves = getAllSavesFromLocalStorage();
        let targetArray = allSaves[slotType] || [];
        const maxSlots = (slotType === 'manual') ? MAX_MANUAL_SAVES : MAX_AUTO_SAVES;
        const existingIdx = targetArray.findIndex(s => s.slotId === slotId);
        if (existingIdx !== -1) targetArray[existingIdx] = metaData;
        else {
            if (targetArray.length >= maxSlots && slotType === 'auto') {
                targetArray.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                targetArray.shift();
            }
            targetArray.push(metaData);
        }
        allSaves[slotType] = targetArray;
        storeAllSavesToLocalStorage(allSaves);
        
        if (!isElectron) localStorage.setItem(`${SAVE_FILE_PREFIX}${slotType}_${slotId}_lines`, JSON.stringify(lines));

        hideLoadingScreen();
        return true;
    } catch (e) {
        console.error(e);
        hideLoadingScreen();
        return false;
    } finally {
        _saving = false;
        clearTimeout(_savingTimer);
    }
}

async function loadGame(slotType, slotId) {
    showLoadingScreen('loadingScreen.loading', 'Подготовка данных...');
    await yieldThread();

    const fileName = getSaveFileName(slotType, slotId);
    const isElectron = window.electronAPI && window.electronAPI.isElectron;
    
    // 1. Атомарная очистка реестров перед началом чтения
    ItemRegistry.clear();
    ContainerRegistry.clear();

    let rawPlayer = null, rawHistory = [], rawWorld = {};
    let loadedSuccessfully = false;

    try {
        if (isElectron) {
            const fileSize = await window.electronAPI.getFileSize(fileName);
            if (fileSize > 0) {
                const CHUNK_SIZE = 512 * 1024;
                let position = 0;
                let leftover = "";
                let blockCount = 1;

                let firstChunk = await window.electronAPI.readSaveChunk(fileName, 0, 1024);
                if (!firstChunk.includes('{"block":')) {
                    throw new Error("LEGACY_SAVE");
                }

                while (position < fileSize) {
                    const chunk = await window.electronAPI.readSaveChunk(fileName, position, CHUNK_SIZE);
                    position += CHUNK_SIZE;
                    
                    const lines = (leftover + chunk).split('\n');
                    leftover = lines.pop();

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        
                        if (!line.startsWith('{"block":')) {
                            throw new Error("LEGACY_SAVE");
                        }

                        const parsed = JSON.parse(line);
                        updateLoadingText(`Читаем блок ${blockCount++}: ${parsed.block}...`);
                        await yieldThread();

                        const result = processSaveBlock(parsed, rawWorld);
                        if (result.rawPlayer !== undefined) rawPlayer = result.rawPlayer;
                        if (result.rawHistory !== undefined) rawHistory = result.rawHistory;
                    }
                }
                if (leftover.trim()) {
                    try {
                        const parsed = JSON.parse(leftover);
                        const result = processSaveBlock(parsed, rawWorld);
                        if (result.rawPlayer !== undefined) rawPlayer = result.rawPlayer;
                        if (result.rawHistory !== undefined) rawHistory = result.rawHistory;
                    } catch(e) {
                        console.warn('[SaveManager] Не удалось распарсить остаток чанка:', e);
                    }
                }
                loadedSuccessfully = true;
            }
        } else {
            const lsData = localStorage.getItem(`${SAVE_FILE_PREFIX}${slotType}_${slotId}_lines`);
            if (lsData) {
                const lines = JSON.parse(lsData);
                let blockCount = 1;
                for (const line of lines) {
                    const parsed = JSON.parse(line);
                    updateLoadingText(`Читаем блок ${blockCount++}: ${parsed.block}...`);
                    await yieldThread();
                    const result = processSaveBlock(parsed, rawWorld);
                    if (result.rawPlayer !== undefined) rawPlayer = result.rawPlayer;
                    if (result.rawHistory !== undefined) rawHistory = result.rawHistory;
                }
                loadedSuccessfully = true;
            } else {
                throw new Error("LEGACY_SAVE");
            }
        }
    } catch (e) {
        if (e.message === "LEGACY_SAVE") {
            updateLoadingText('Конвертация старого сохранения...');
            await yieldThread();
            let oldData;
            if (isElectron) {
                oldData = await window.electronAPI.loadGame(fileName);
            } else {
                const allSaves = getAllSavesFromLocalStorage();
                const targetArray = allSaves[slotType];
                oldData = targetArray.find(save => save.slotId === slotId);
            }
            
            if (oldData) {
                rawPlayer = oldData.playerData || oldData.player;
                rawHistory = oldData.historyData || oldData.history;
                rawWorld = oldData.worldData || oldData.world;
                loadedSuccessfully = true;
            }
        } else {
            console.error(e);
        }
    }

    if (!loadedSuccessfully || !rawPlayer) {
        hideLoadingScreen();
        alert(t('loadGame.errorSaveNotFound', { slotId: slotId }));
        return;
    }

    try {
        player = structuredClone(rawPlayer);

        updateLoadingText('Инициализация симуляции мира...');
        await yieldThread();
        
        // КЛЮЧЕВОЙ ФИКС: Передаем true (isLoadMode), чтобы initWorldSimulator не стирал ItemRegistry
        await initWorldSimulator(100, 0, true);
        
        if (rawWorld && Object.keys(rawWorld).length > 0) { 
            World = structuredClone(rawWorld); 
        }

        // T3 Migration (Выполняется ПОСЛЕ initWorldSimulator, чтобы не затереть предметы)
        // Используем ensurePlayerContainers() — проверяет не только ID, но и наличие в ContainerRegistry.
        // Если контейнер есть в player.X, но отсутствует в ContainerRegistry — пересоздаёт.
        const needsBackpackMigration = !player.container_backpack;
        const needsEquipmentMigration = !player.container_equipment;

        await ensurePlayerContainers();

        // Миграция старых предметов из player.inventory (T2 → T3 формат)
        if (needsBackpackMigration && player.inventory) {
            for (let key in player.inventory) {
                let oldItem = player.inventory[key];
                if (oldItem) {
                    await CoreInventorySystemAsync.createItem(oldItem.aiIdentifier || oldItem.id, oldItem.quantity || 1, player.container_backpack, oldItem);
                }
            }
        }
        // Миграция старой экипировки из player.equipment (T2 → T3 формат)
        if (needsEquipmentMigration && player.equipment) {
            for (let slot in player.equipment) {
                let oldItem = player.equipment[slot];
                if (oldItem) {
                    oldItem.slot_index = slot;
                    await CoreInventorySystemAsync.createItem(oldItem.aiIdentifier || oldItem.id, oldItem.quantity || 1, player.container_equipment, oldItem);
                }
            }
        }

        // Устранение утечки памяти (T3)
        if (player.inventory) delete player.inventory;
        if (player.equipment) delete player.equipment;

        // Синхронизация состояния с C++ ядром
        if (window.electronAPI && window.electronAPI.nexusSyncState) {
            console.log("[SaveManager] Синхронизация загруженных предметов с ядром...");
            await window.electronAPI.nexusSyncState(World, Array.from(ItemRegistry.entries()), Array.from(ContainerRegistry.entries()));
            
            // Синхронизация старых сущностей для обратной совместимости
            for (let entId in player.allKnownEntities) {
                let ent = player.allKnownEntities[entId];
                let minDmg = ent.min_damage || 1 + Math.floor((ent.stats.maxHp ?? 10) / 40);
                let diceSides = ent.type === 'creature' ? 8 : (((ent.stats.str ?? 10) > 16 || (ent.stats.dex ?? 10) > 16) ? 10 : 6);
                let maxDmg = ent.max_damage || (minDmg * diceSides);
                let ac = ent.armor_class || 10 + Math.floor(((ent.stats.dex ?? 10) - 10) / 2);
                await sendInventoryCommand('syncEntity', {
                    id: ent.aiIdentifier, name: ent.name, type: ent.type,
                    hp: ent.stats.hp ?? 10, maxHp: ent.stats.maxHp ?? 10,
                    str: ent.stats.str ?? 10, dex: ent.stats.dex ?? 10, con: ent.stats.con ?? 10, int: ent.stats.int ?? 10,
                    isHostile: ent.isHostile === true, xpReward: ent.xpReward || 20,
                    min_damage: minDmg, max_damage: maxDmg, armor_class: ac
                });
            }
        }

        updateLoadingText('Чтение лора и истории...');
        await yieldThread();
        await loadActiveEraLore(player.era);
        await loadGlobalLocations(DEFAULT_WORLD_ID, currentLanguage, player.era);
        conversationHistory = structuredClone(rawHistory || []);

        updateLoadingText('Восстановление интерфейса...');
        await yieldThread();

        player.stats = player.stats || {};
        player.inventory = player.inventory || {};
        player.equipment = player.equipment || {};
        player.holdings = player.holdings || {};
        player.bankAccount = player.bankAccount || { deposit: 0, loan: 0, loanDays: 0 };
        player.quests = player.quests || {};
        player.skills = player.skills || {};
        player.mapMarkers = player.mapMarkers || {};
        player.subLocations = player.subLocations || {};
        player.statusEffects = player.statusEffects || {};
        player.visibleEntities = player.visibleEntities || {};
        player.allKnownEntities = player.allKnownEntities || {};
        player.visitedLocations = player.visitedLocations || [];
        player.localMap = player.localMap || null;
        player.gameLogHistory = player.gameLogHistory || [];
        player.calcLogHistory = player.calcLogHistory || [];
        player.gmErrors = player.gmErrors || [];
        player.echoMemory = player.echoMemory || { items: [], maxItems: ECHO_MEMORY_MAX_ITEMS, version: 1 };
        player.gmNotes = player.gmNotes || {};
        player.memoryArchives = player.memoryArchives || {};
        player.archiveSummaries = player.archiveSummaries || {};
        player.factionData = player.factionData || { global: t('factions.global', null, 'Общая') };
        player.nexusData = player.nexusData || {};
        await syncPlayerContainerBindings();
        syncPlayerGoldFromInventory();

        if (typeof player.stats.reputation === 'number' || player.stats.reputation === undefined) {
            player.stats.reputation = { global: player.stats.reputation || 0 };
        }

        currentSaveSlot = { type: slotType, id: slotId };
        if (window.Cartographer) Cartographer.isMapInitialized = false;

        stopMenuMusic();
        await initializeGameInterface();
        setActiveScreen('game-interface');
        displaySavedChatHistory();

        addLogMessage(t('gameInterface.log.gameLoaded', { slotType: slotType, slotId: slotId }), "system-message");
        hideLoadingScreen();
    } catch (e) {
        console.error(`Ошибка загрузки:`, e);
        hideLoadingScreen();
        alert(t('loadGame.errorLoad', { slotId: slotId, message: e.message }));
        setActiveScreen('main-menu');
    }
}

async function autoSaveGame() {
    if (!player || !gameInterface.classList.contains('active-screen') || isWaitingForAI || IS_PRE_SIMULATING || tempPlayer !== null || conversationHistory.length === 0) return;

    let nextAutoSaveId = 1;
    if (window.electronAPI && window.electronAPI.isElectron) {
        const autoSaves = (await listSaveFilesFromFSA()).filter(s => s.slotType === 'auto');
        if (autoSaves.length > 0) {
            if (autoSaves.length < MAX_AUTO_SAVES) {
                const usedIds = new Set(autoSaves.map(s => s.slotId));
                for (let i = 1; i <= MAX_AUTO_SAVES + 1; i++) { if (!usedIds.has(i)) { nextAutoSaveId = i; break; } }
            } else {
                autoSaves.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                nextAutoSaveId = autoSaves[0].slotId;
            }
        }
    } else {
        const allSavesForAuto = getAllSavesFromLocalStorage();
        const autoSaves = allSavesForAuto.auto || [];
        if (autoSaves.length > 0) {
            if (autoSaves.length < MAX_AUTO_SAVES) {
                const usedIds = new Set(autoSaves.map(s => s.slotId));
                for (let i = 1; i <= MAX_AUTO_SAVES + 1; i++) { if (!usedIds.has(i)) { nextAutoSaveId = i; break; } }
            } else {
                autoSaves.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                nextAutoSaveId = autoSaves[0].slotId;
            }
        }
    }

    console.log(`Попытка автосохранения в слот ${nextAutoSaveId}...`);
    const savedSuccessfully = await saveGame('auto', nextAutoSaveId);

    if (savedSuccessfully) {
        const finalSource = (window.electronAPI && window.electronAPI.isElectron) ? t('loadGame.sourceFileSystem') : t('loadGame.sourceLocalStorage');
        addLogMessage(t('gameInterface.log.autoSaveSuccess', { slotId: nextAutoSaveId, source: finalSource }), "command-feedback");
    } else {
        addLogMessage(t('gameInterface.log.autoSaveFailed', { slotId: nextAutoSaveId }), "system-message");
    }
}

function startAutoSaveTimer() {
    stopAutoSaveTimer();
    if (autoSaveIntervalMs > 0) {
        autoSaveTimer = setInterval(autoSaveGame, autoSaveIntervalMs);
        console.log(`Таймер автосохранения запущен с интервалом ${autoSaveIntervalMs / 1000}с`);
    } else {
        console.log("Автосохранение отключено в настройках.");
    }
}

function stopAutoSaveTimer() {
    if (autoSaveTimer) {
        clearInterval(autoSaveTimer);
        autoSaveTimer = null;
        console.log("Таймер автосохранения остановлен.");
    }
}


// --- УДАЛЕНИЕ СОХРАНЕНИЙ ---
async function deleteSave(slotType, slotId) {
    const typeName = slotType === 'manual' ? t('loadGame.manualSlotType', null, 'Ручной слот') : t('loadGame.autoSlotType', null, 'Автосохранение');
    const confirmMsg = t('loadGame.confirmDelete', { slotType: typeName, slotId: slotId }, `Вы уверены, что хотите удалить сохранение '${typeName} #${slotId}'? Это действие необратимо.`);
    
    showCustomConfirm(confirmMsg, async () => {
        const fileName = getSaveFileName(slotType, slotId);
        const isElectron = window.electronAPI && window.electronAPI.isElectron;
        let success = false;

        if (isElectron) {
            success = await window.electronAPI.deleteSave(fileName);
        } else {
            const allSaves = getAllSavesFromLocalStorage();
            if (allSaves[slotType]) {
                const initialLength = allSaves[slotType].length;
                allSaves[slotType] = allSaves[slotType].filter(s => s.slotId !== slotId);
                if (allSaves[slotType].length < initialLength) {
                    storeAllSavesToLocalStorage(allSaves);
                    localStorage.removeItem(`${SAVE_FILE_PREFIX}${slotType}_${slotId}_lines`);
                    success = true;
                }
            }
        }

        if (success) {
            populateLoadGameScreen();
        } else {
            if (typeof showCustomAlert === 'function') showCustomAlert("Не удалось удалить сохранение.");
            else alert("Не удалось удалить сохранение.");
        }
    });
}
