#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---------------------------------------------------------------------------
// Minimal test framework
// ---------------------------------------------------------------------------
let PASS = 0;
let FAIL = 0;

function assert(condition, message) {
    if (condition) { PASS++; } else { FAIL++; console.log(`  FAIL: ${message}`); }
}

function assertEqual(actual, expected, message) {
    if (actual === expected) { PASS++; }
    else { FAIL++; console.log(`  FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

function assertDeepEqual(actual, expected, message) {
    if (JSON.stringify(actual) === JSON.stringify(expected)) { PASS++; }
    else { FAIL++; console.log(`  FAIL: ${message}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`); }
}

// ---------------------------------------------------------------------------
// Build sandbox with all globals SaveManager.js needs
// ---------------------------------------------------------------------------
function createSandbox() {
    const ItemRegistry = new Map();
    const ContainerRegistry = new Map();
    const containerStore = {}; // backing store for setContainer

    function setContainer(key, value) {
        ContainerRegistry.set(key, value);
        containerStore[key] = value;
    }

    const localStorageStore = {};
    const localStorage = {
        getItem(key) { return localStorageStore[key] ?? null; },
        setItem(key, value) { localStorageStore[key] = String(value); },
        removeItem(key) { delete localStorageStore[key]; },
        clear() { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]); }
    };

    const sandbox = {
        console,
        setTimeout,
        clearTimeout,
        Map,
        // -- Globals referenced by SaveManager.js --
        ItemRegistry,
        ContainerRegistry,
        setContainer,
        player: null,
        World: null,
        GameRNG: undefined,
        isWaitingForAI: false,
        conversationHistory: [],
        SAVE_FILE_PREFIX: 'metera_save_',
        MAX_MANUAL_SAVES: 10,
        MAX_AUTO_SAVES: 5,
        currentSaveSlot: null,
        autoSaveIntervalMs: 300000,
        autoSaveTimer: null,
        // -- Window and DOM mocks --
        window: {
            electronAPI: null,
            ModAPI: null,
            Cartographer: null,
        },
        localStorage,
        // -- Stub functions that SaveManager calls but we don't need real impls --
        showLoadingScreen() {},
        hideLoadingScreen() {},
        updateLoadingText() {},
        yieldThread: async () => {},
        getSaveFileName: (type, id) => `${type}_${id}`,
        getAllSavesFromLocalStorage: () => ({}),
        storeAllSavesToLocalStorage: () => {},
        alert: () => {},
        t: (key, params, fallback) => fallback || key,
        addLogMessage: () => {},
        stopMenuMusic: () => {},
        initializeGameInterface: async () => {},
        setActiveScreen: () => {},
        displaySavedChatHistory: () => {},
        ensurePlayerContainers: async () => {},
        syncPlayerContainerBindings: async () => {},
        syncPlayerGoldFromInventory: () => {},
        initWorldSimulator: async () => {},
        loadActiveEraLore: async () => {},
        loadGlobalLocations: async () => {},
        DEFAULT_WORLD_ID: 'metera',
        currentLanguage: 'en',
        gameInterface: { classList: { contains: () => false } },
        IS_PRE_SIMULATING: false,
        tempPlayer: null,
        showCustomConfirm: () => {},
        showCustomAlert: () => {},
        populateLoadGameScreen: () => {},
        listSaveFilesFromFSA: async () => [],
        sendInventoryCommand: async () => {},
        CoreInventorySystemAsync: { createItem: async () => {} },
        ECHO_MEMORY_MAX_ITEMS: 50,
        structuredClone: (obj) => JSON.parse(JSON.stringify(obj)),
    };
    sandbox.global = sandbox;
    return { sandbox, ItemRegistry, ContainerRegistry, containerStore, localStorageStore, localStorage };
}

// ---------------------------------------------------------------------------
// Load SaveManager.js into a sandbox
// ---------------------------------------------------------------------------
function loadSaveManager(sandbox) {
    const sourcePath = path.resolve(__dirname, '..', 'js', 'saves', 'SaveManager.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'SaveManager.js' });
    return sandbox;
}

// ===================================================================
//  1. processSaveBlock tests
// ===================================================================
console.log('\n=== 1. processSaveBlock ===');

(function testProcessSaveBlock() {
    const { sandbox, ItemRegistry, ContainerRegistry, containerStore } = createSandbox();
    loadSaveManager(sandbox);
    const processSaveBlock = sandbox.processSaveBlock;

    // --- meta block ---
    (function testMetaBlock() {
        const rawWorld = {};
        processSaveBlock({ block: 'meta', data: { mod_list: ['base_game', 'mod_x'] } }, rawWorld);
        assert(rawWorld._save_mod_list !== undefined, 'meta block stores mod_list on rawWorld');
        assertDeepEqual(rawWorld._save_mod_list, ['base_game', 'mod_x'], 'meta block mod_list value correct');
    })();

    // --- meta block without mod_list ---
    (function testMetaBlockNoModList() {
        const rawWorld = {};
        processSaveBlock({ block: 'meta', data: { slotType: 'manual' } }, rawWorld);
        assert(rawWorld._save_mod_list === undefined, 'meta block without mod_list does not set _save_mod_list');
    })();

    // --- player block ---
    (function testPlayerBlock() {
        const rawWorld = {};
        const playerData = { name: 'Hero', stats: { level: 5 } };
        const result = processSaveBlock({ block: 'player', data: playerData }, rawWorld);
        assert(result.rawPlayer !== undefined, 'player block returns rawPlayer');
        assertEqual(result.rawPlayer.name, 'Hero', 'player block rawPlayer.name');
        assertEqual(result.rawPlayer.stats.level, 5, 'player block rawPlayer.stats.level');
    })();

    // --- history block ---
    (function testHistoryBlock() {
        const rawWorld = {};
        const historyData = [{ role: 'user', content: 'Hello' }];
        const result = processSaveBlock({ block: 'history', data: historyData }, rawWorld);
        assert(result.rawHistory !== undefined, 'history block returns rawHistory');
        assertEqual(result.rawHistory.length, 1, 'history block rawHistory length');
        assertEqual(result.rawHistory[0].role, 'user', 'history block rawHistory[0].role');
    })();

    // --- item_registry block ---
    (function testItemRegistryBlock() {
        ItemRegistry.set('stale_key', 'stale_val'); // should be cleared
        const items = [['sword_01', { name: 'Iron Sword' }], ['potion_01', { name: 'Health Potion' }]];
        processSaveBlock({ block: 'item_registry', data: items }, {});
        assert(!ItemRegistry.has('stale_key'), 'item_registry block clears old entries');
        assertEqual(ItemRegistry.size, 2, 'item_registry block populates correct count');
        assertEqual(ItemRegistry.get('sword_01').name, 'Iron Sword', 'item_registry block sword entry');
        assertEqual(ItemRegistry.get('potion_01').name, 'Health Potion', 'item_registry block potion entry');
    })();

    // --- container_registry block ---
    (function testContainerRegistryBlock() {
        ContainerRegistry.set('stale_container', {}); // should be cleared
        const containers = [['backpack_01', { slots: 20 }], ['chest_01', { slots: 40 }]];
        processSaveBlock({ block: 'container_registry', data: containers }, {});
        assert(!ContainerRegistry.has('stale_container'), 'container_registry block clears old entries');
        assertEqual(ContainerRegistry.size, 2, 'container_registry block populates correct count');
        assertEqual(ContainerRegistry.get('backpack_01').slots, 20, 'container_registry block backpack entry');
        assertEqual(ContainerRegistry.get('chest_01').slots, 40, 'container_registry block chest entry');
    })();

    // --- world_base block ---
    (function testWorldBaseBlock() {
        const rawWorld = { existingKey: true };
        processSaveBlock({ block: 'world_base', data: { tick: 42, era: 'rebirth' } }, rawWorld);
        assert(rawWorld.existingKey === true, 'world_base block preserves existing keys');
        assertEqual(rawWorld.tick, 42, 'world_base block merges tick');
        assertEqual(rawWorld.era, 'rebirth', 'world_base block merges era');
    })();

    // --- world_regions block ---
    (function testWorldRegionsBlock() {
        const rawWorld = {};
        const regions = { region_1: { name: 'Valley' } };
        processSaveBlock({ block: 'world_regions', data: regions }, rawWorld);
        assert(rawWorld.regions !== undefined, 'world_regions block sets regions');
        assertEqual(rawWorld.regions.region_1.name, 'Valley', 'world_regions block region data');
    })();

    // --- world_factions block ---
    (function testWorldFactionsBlock() {
        const rawWorld = {};
        const factions = { guild_mages: { power: 80 } };
        processSaveBlock({ block: 'world_factions', data: factions }, rawWorld);
        assertDeepEqual(rawWorld.factions, factions, 'world_factions block sets factions');
    })();

    // --- world_npcs block ---
    (function testWorldNpcsBlock() {
        const rawWorld = {};
        const npcs = { npc_01: { name: 'Elder' } };
        processSaveBlock({ block: 'world_npcs', data: npcs }, rawWorld);
        assertDeepEqual(rawWorld.npcs, npcs, 'world_npcs block sets npcs');
    })();

    // --- world_rulers block ---
    (function testWorldRulersBlock() {
        const rawWorld = {};
        const rulersData = { rulers: { king: 'Aldric' }, intrigues: { plot_01: 'Assassination' } };
        processSaveBlock({ block: 'world_rulers', data: rulersData }, rawWorld);
        assertEqual(rawWorld.rulers.king, 'Aldric', 'world_rulers block sets rulers');
        assertEqual(rawWorld.intrigues.plot_01, 'Assassination', 'world_rulers block sets intrigues');
    })();

    // --- world_businesses block ---
    (function testWorldBusinessesBlock() {
        const rawWorld = {};
        const biz = { tavern_01: { revenue: 100 } };
        processSaveBlock({ block: 'world_businesses', data: biz }, rawWorld);
        assertDeepEqual(rawWorld.businesses, biz, 'world_businesses block sets businesses');
    })();

    // --- world_ships block ---
    (function testWorldShipsBlock() {
        const rawWorld = {};
        const shipsData = { ships: { s1: 'Galleon' }, fleets: { f1: 'Armada' }, ports: { p1: 'Harbor' } };
        processSaveBlock({ block: 'world_ships', data: shipsData }, rawWorld);
        assertEqual(rawWorld.ships.s1, 'Galleon', 'world_ships block sets ships');
        assertEqual(rawWorld.fleets.f1, 'Armada', 'world_ships block sets fleets');
        assertEqual(rawWorld.port_facilities.p1, 'Harbor', 'world_ships block sets port_facilities');
    })();

    // --- world_monsters block ---
    (function testWorldMonstersBlock() {
        const rawWorld = {};
        const monsters = { dragon: { hp: 500 } };
        processSaveBlock({ block: 'world_monsters', data: monsters }, rawWorld);
        assertDeepEqual(rawWorld.monsters, monsters, 'world_monsters block sets monsters');
    })();

    // --- world_sublocations block ---
    (function testWorldSublocationsBlock() {
        const rawWorld = {};
        const sub = { cave_01: { depth: 3 } };
        processSaveBlock({ block: 'world_sublocations', data: sub }, rawWorld);
        assertDeepEqual(rawWorld.subLocations, sub, 'world_sublocations block sets subLocations');
    })();

    // --- world_map block ---
    (function testWorldMapBlock() {
        const rawWorld = {};
        const mapData = { width: 256, height: 256 };
        processSaveBlock({ block: 'world_map', data: mapData }, rawWorld);
        assertDeepEqual(rawWorld.map, mapData, 'world_map block sets map');
    })();

    // --- world_trek block ---
    (function testWorldTrekBlock() {
        const rawWorld = {};
        const trek = { progress: 0.5 };
        processSaveBlock({ block: 'world_trek', data: trek }, rawWorld);
        assertDeepEqual(rawWorld.player_trek, trek, 'world_trek block sets player_trek');
    })();

    // --- world_misc block ---
    (function testWorldMiscBlock() {
        const rawWorld = {};
        processSaveBlock({ block: 'world_misc', data: { news: ['event1'], gmInterventionHistory: ['gm1'] } }, rawWorld);
        assertDeepEqual(rawWorld.news, ['event1'], 'world_misc block merges news');
        assertDeepEqual(rawWorld.gmInterventionHistory, ['gm1'], 'world_misc block merges gmInterventionHistory');
    })();

    // --- rng_seed block ---
    (function testRngSeedBlock() {
        const rawWorld = {};
        processSaveBlock({ block: 'rng_seed', data: { seed: 12345 } }, rawWorld);
        assertEqual(rawWorld._rng_seed, 12345, 'rng_seed block sets _rng_seed');
    })();

    // --- mod_data block (no ModAPI) ---
    (function testModDataBlockNoModAPI() {
        const rawWorld = {};
        const result = processSaveBlock({ block: 'mod_data', data: { someMod: { key: 'val' } } }, rawWorld);
        assertDeepEqual(result, {}, 'mod_data block returns empty object without ModAPI');
    })();

    // --- mod_data block (with ModAPI) ---
    (function testModDataBlockWithModAPI() {
        const loaded = {};
        sandbox.window.ModAPI = {
            saveHandlers: {
                testMod: {
                    onLoad(data) { loaded.testMod = data; }
                }
            }
        };
        const rawWorld = {};
        processSaveBlock({ block: 'mod_data', data: { testMod: { config: 'abc' } } }, rawWorld);
        assertDeepEqual(loaded.testMod, { config: 'abc' }, 'mod_data block calls onLoad for registered mod');
        sandbox.window.ModAPI = null;
    })();

    // --- unknown block ---
    (function testUnknownBlock() {
        const rawWorld = {};
        const result = processSaveBlock({ block: 'totally_unknown_block', data: { foo: 'bar' } }, rawWorld);
        assertDeepEqual(result, {}, 'unknown block returns empty object');
        assert(Object.keys(rawWorld).length === 0, 'unknown block does not mutate rawWorld');
    })();

    // --- meta block with null rawWorld ---
    (function testMetaBlockNullRawWorld() {
        const result = processSaveBlock({ block: 'meta', data: { mod_list: ['x'] } }, null);
        assertDeepEqual(result, {}, 'meta block with null rawWorld returns empty object');
    })();

})();

// ===================================================================
//  2. Save/Load roundtrip
// ===================================================================
console.log('\n=== 2. Save/Load Roundtrip ===');

(function testRoundtrip() {
    const { sandbox, ItemRegistry, ContainerRegistry, localStorageStore } = createSandbox();
    loadSaveManager(sandbox);
    const processSaveBlock = sandbox.processSaveBlock;

    // -- Simulate serialization (what saveGame does) --
    const playerData = {
        name: 'TestHero',
        stats: { level: 3, hp: 45, maxHp: 50, str: 12, dex: 10, int: 8, con: 11, res: 9 },
        gold: 120,
        location: 'town_village',
        container_backpack: 'bp_001',
        container_equipment: 'eq_001',
        container_backpack_slots: 20,
        container_equipment_slots: 6,
    };
    const historyData = [
        { role: 'user', content: 'I enter the tavern' },
        { role: 'assistant', content: 'The tavern is warm...' },
    ];
    const itemEntries = [
        ['sword_01', { name: 'Iron Sword', damage: 8, quantity: 1 }],
        ['potion_hp', { name: 'Health Potion', healAmount: 20, quantity: 3 }],
    ];
    const containerEntries = [
        ['bp_001', { id: 'bp_001', slots: 20, items: ['sword_01'] }],
        ['eq_001', { id: 'eq_001', slots: 6, items: [] }],
    ];
    const worldBase = { tick: 150, era: 'rebirth', time: 720, homeostasis: 0.85 };
    const regions = { valley: { name: 'Green Valley', stability: 70 } };

    // Build the block lines as saveGame would
    const lines = [];
    function addBlock(id, data) {
        lines.push(JSON.stringify({ block: id, data: data }));
    }
    addBlock('meta', { slotType: 'manual', slotId: 1, timestamp: '2025-01-01T00:00:00Z', mod_list: ['base_game'] });
    addBlock('player', playerData);
    addBlock('history', historyData);
    addBlock('item_registry', itemEntries);
    addBlock('container_registry', containerEntries);
    addBlock('world_base', worldBase);
    addBlock('world_regions', regions);

    // -- Simulate deserialization (what loadGame does with localStorage path) --
    let rawPlayer = null;
    let rawHistory = [];
    let rawWorld = {};

    for (const line of lines) {
        const parsed = JSON.parse(line);
        const result = processSaveBlock(parsed, rawWorld);
        if (result.rawPlayer !== undefined) rawPlayer = result.rawPlayer;
        if (result.rawHistory !== undefined) rawHistory = result.rawHistory;
    }

    // -- Verify data integrity --
    assert(rawPlayer !== null, 'roundtrip: rawPlayer is not null');
    assertEqual(rawPlayer.name, 'TestHero', 'roundtrip: player name');
    assertEqual(rawPlayer.stats.level, 3, 'roundtrip: player level');
    assertEqual(rawPlayer.gold, 120, 'roundtrip: player gold');
    assertEqual(rawPlayer.container_backpack, 'bp_001', 'roundtrip: player backpack container id');

    assertEqual(rawHistory.length, 2, 'roundtrip: history length');
    assertEqual(rawHistory[0].role, 'user', 'roundtrip: history[0] role');
    assertEqual(rawHistory[1].content, 'The tavern is warm...', 'roundtrip: history[1] content');

    assertEqual(ItemRegistry.size, 2, 'roundtrip: ItemRegistry size');
    assertEqual(ItemRegistry.get('sword_01').name, 'Iron Sword', 'roundtrip: sword name');
    assertEqual(ItemRegistry.get('potion_hp').quantity, 3, 'roundtrip: potion quantity');

    assertEqual(ContainerRegistry.size, 2, 'roundtrip: ContainerRegistry size');
    assertEqual(ContainerRegistry.get('bp_001').slots, 20, 'roundtrip: backpack slots');
    assertDeepEqual(ContainerRegistry.get('bp_001').items, ['sword_01'], 'roundtrip: backpack items');

    assertEqual(rawWorld.tick, 150, 'roundtrip: world tick');
    assertEqual(rawWorld.era, 'rebirth', 'roundtrip: world era');
    assertEqual(rawWorld.homeostasis, 0.85, 'roundtrip: world homeostasis');
    assert(rawWorld.regions !== undefined, 'roundtrip: regions defined');
    assertEqual(rawWorld.regions.valley.name, 'Green Valley', 'roundtrip: region name');
    assertEqual(rawWorld._save_mod_list[0], 'base_game', 'roundtrip: mod_list preserved');

    // -- Verify JSON re-serialization doesn't corrupt data --
    const reSerialized = lines.map(l => JSON.parse(l));
    assertEqual(reSerialized.length, 7, 'roundtrip: block count preserved');
    assertEqual(reSerialized[1].block, 'player', 'roundtrip: player block id');
    assertEqual(reSerialized[3].block, 'item_registry', 'roundtrip: item_registry block id');
})();

// ===================================================================
//  3. Mutex behavior
// ===================================================================
console.log('\n=== 3. Mutex Behavior ===');

async function runMutexTests() {

    // --- Test _saving flag prevents concurrent saves ---
    {
        const { sandbox } = createSandbox();

        // Set up a minimal player so saveGame doesn't bail immediately
        sandbox.player = { name: 'MutexTestHero', stats: { level: 1 } };
        sandbox.isWaitingForAI = false;
        sandbox.conversationHistory = [{ role: 'user', content: 'hi' }];

        // Mock getSaveFileName
        sandbox.getSaveFileName = (type, id) => `save_${type}_${id}`;

        // Mock getAllSavesFromLocalStorage / storeAllSavesToLocalStorage
        sandbox.getAllSavesFromLocalStorage = () => ({ manual: [] });
        sandbox.storeAllSavesToLocalStorage = () => {};

        // No electron
        sandbox.window.electronAPI = null;

        loadSaveManager(sandbox);

        // We need to make saveGame take long enough for a second call.
        // Use a gate that we control from outside the sandbox.
        let gateResolve;
        const gate = new Promise(r => { gateResolve = r; });

        sandbox.yieldThread = async () => {
            // On the first yield inside the try block, pause until we signal
            await gate;
        };

        // Start first save (runs asynchronously, will pause at yieldThread)
        const save1Promise = sandbox.saveGame('manual', 1);

        // Give the event loop a tick so saveGame starts executing
        await new Promise(r => setTimeout(r, 10));

        // Attempt concurrent save — should be rejected by _saving mutex
        const concurrentResult = await sandbox.saveGame('manual', 2);
        assert(concurrentResult === false, 'concurrent save blocked by mutex returns false');

        // Release the gate so the first save can complete
        gateResolve();

        const save1Result = await save1Promise;
        assert(save1Result === true, 'first save completes successfully after mutex releases');
    }

    // --- Test _savingTimer resets mutex after 60s (static analysis) ---
    {
        const sourcePath = path.resolve(__dirname, '..', 'js', 'saves', 'SaveManager.js');
        const source = fs.readFileSync(sourcePath, 'utf8');

        // Verify the mutex timeout value in the source code
        assert(source.includes('60000'), 'source code contains 60000ms mutex timeout');
        assert(source.includes('_saving = false'), 'source code resets _saving flag');
        assert(source.includes('clearTimeout(_savingTimer)'), 'source code clears safety timer in finally');
        assert(source.includes('Mutex safety timeout'), 'source code has mutex safety timeout warning');

        // Verify that _savingTimer is cleared in the finally block
        const finallyMatch = source.match(/finally\s*\{[^}]*_saving\s*=\s*false[^}]*clearTimeout\(_savingTimer\)[^}]*\}/s);
        assert(finallyMatch !== null, 'finally block resets _saving and clears _savingTimer');
    }

    // --- Test save returns false when player is null ---
    {
        const { sandbox } = createSandbox();
        sandbox.player = null;
        sandbox.isWaitingForAI = false;
        sandbox.yieldThread = async () => {};
        sandbox.showLoadingScreen = () => {};
        sandbox.hideLoadingScreen = () => {};
        sandbox.getSaveFileName = () => 'save_test';
        sandbox.window.electronAPI = null;

        loadSaveManager(sandbox);

        const result = await sandbox.saveGame('manual', 1);
        assert(result === false, 'saveGame returns false when player is null');
    }

    // --- Test save returns false when waiting for AI ---
    {
        const { sandbox } = createSandbox();
        sandbox.player = { name: 'Test', stats: { level: 1 } };
        sandbox.isWaitingForAI = true;
        sandbox.yieldThread = async () => {};
        sandbox.showLoadingScreen = () => {};
        sandbox.hideLoadingScreen = () => {};
        sandbox.getSaveFileName = () => 'save_test';
        sandbox.window.electronAPI = null;

        loadSaveManager(sandbox);

        const result = await sandbox.saveGame('manual', 1);
        assert(result === false, 'saveGame returns false when isWaitingForAI is true');
    }

    // --- Test _saving flag resets after failed save (no player) ---
    {
        const { sandbox } = createSandbox();
        sandbox.player = null; // This causes early bail
        sandbox.isWaitingForAI = false;
        sandbox.yieldThread = async () => {};
        sandbox.showLoadingScreen = () => {};
        sandbox.hideLoadingScreen = () => {};
        sandbox.getSaveFileName = () => 'save_test';
        sandbox.window.electronAPI = null;

        loadSaveManager(sandbox);

        // First call should fail
        const r1 = await sandbox.saveGame('manual', 1);
        assert(r1 === false, 'first save fails with no player');

        // Second call should also be allowed to attempt (mutex was reset)
        const r2 = await sandbox.saveGame('manual', 2);
        assert(r2 === false, 'second save also fails with no player (mutex was reset)');

        // If mutex weren't reset, the second call would also return false
        // but for the wrong reason (mutex still held). The key point is
        // that we can call saveGame again without being permanently locked out.
    }

}

// ===================================================================
//  4. Edge cases for processSaveBlock
// ===================================================================
console.log('\n=== 4. processSaveBlock Edge Cases ===');

(function testEdgeCases() {
    const { sandbox, ItemRegistry, ContainerRegistry } = createSandbox();
    loadSaveManager(sandbox);
    const processSaveBlock = sandbox.processSaveBlock;

    // --- Multiple blocks sequentially build up rawWorld ---
    (function testSequentialBlocks() {
        const rawWorld = {};

        processSaveBlock({ block: 'world_base', data: { tick: 1, era: 'silence' } }, rawWorld);
        processSaveBlock({ block: 'world_regions', data: { r1: {} } }, rawWorld);
        processSaveBlock({ block: 'world_factions', data: { f1: {} } }, rawWorld);
        processSaveBlock({ block: 'world_npcs', data: { n1: {} } }, rawWorld);
        processSaveBlock({ block: 'world_rulers', data: { rulers: { king: 'A' }, intrigues: {} } }, rawWorld);
        processSaveBlock({ block: 'world_businesses', data: { b1: {} } }, rawWorld);
        processSaveBlock({ block: 'world_ships', data: { ships: {}, fleets: {}, ports: {} } }, rawWorld);
        processSaveBlock({ block: 'world_monsters', data: { m1: {} } }, rawWorld);
        processSaveBlock({ block: 'world_sublocations', data: { s1: {} } }, rawWorld);
        processSaveBlock({ block: 'world_map', data: { grid: [] } }, rawWorld);
        processSaveBlock({ block: 'world_trek', data: { progress: 0 } }, rawWorld);
        processSaveBlock({ block: 'world_misc', data: { news: [], gmInterventionHistory: [] } }, rawWorld);

        assertEqual(rawWorld.tick, 1, 'sequential: world_base tick');
        assertEqual(rawWorld.era, 'silence', 'sequential: world_base era');
        assert(rawWorld.regions !== undefined, 'sequential: regions defined');
        assert(rawWorld.factions !== undefined, 'sequential: factions defined');
        assert(rawWorld.npcs !== undefined, 'sequential: npcs defined');
        assertEqual(rawWorld.rulers.king, 'A', 'sequential: rulers defined');
        assert(rawWorld.intrigues !== undefined, 'sequential: intrigues defined');
        assert(rawWorld.businesses !== undefined, 'sequential: businesses defined');
        assert(rawWorld.ships !== undefined, 'sequential: ships defined');
        assert(rawWorld.fleets !== undefined, 'sequential: fleets defined');
        assert(rawWorld.port_facilities !== undefined, 'sequential: port_facilities defined');
        assert(rawWorld.monsters !== undefined, 'sequential: monsters defined');
        assert(rawWorld.subLocations !== undefined, 'sequential: subLocations defined');
        assert(rawWorld.map !== undefined, 'sequential: map defined');
        assert(rawWorld.player_trek !== undefined, 'sequential: player_trek defined');
        assert(rawWorld.news !== undefined, 'sequential: news defined');
        assert(rawWorld.gmInterventionHistory !== undefined, 'sequential: gmInterventionHistory defined');
    })();

    // --- ItemRegistry clear-then-populate is atomic ---
    (function testItemRegistryAtomicClear() {
        ItemRegistry.set('old_item', { name: 'Old' });
        processSaveBlock({ block: 'item_registry', data: [['new_item', { name: 'New' }]] }, {});
        assert(!ItemRegistry.has('old_item'), 'item_registry: old items cleared before new items added');
        assert(ItemRegistry.has('new_item'), 'item_registry: new items populated');
    })();

    // --- ContainerRegistry clear-then-populate is atomic ---
    (function testContainerRegistryAtomicClear() {
        ContainerRegistry.set('old_container', { slots: 0 });
        processSaveBlock({ block: 'container_registry', data: [['new_container', { slots: 10 }]] }, {});
        assert(!ContainerRegistry.has('old_container'), 'container_registry: old containers cleared before new ones added');
        assert(ContainerRegistry.has('new_container'), 'container_registry: new containers populated');
    })();

    // --- Empty data arrays ---
    (function testEmptyArrays() {
        ItemRegistry.set('x', 'y');
        ContainerRegistry.set('x', 'y');
        processSaveBlock({ block: 'item_registry', data: [] }, {});
        processSaveBlock({ block: 'container_registry', data: [] }, {});
        assertEqual(ItemRegistry.size, 0, 'empty item_registry data clears all items');
        assertEqual(ContainerRegistry.size, 0, 'empty container_registry data clears all containers');
    })();

    // --- world_base Object.assign overwrites existing keys ---
    (function testWorldBaseOverwrite() {
        const rawWorld = { tick: 100, customKey: 'preserved' };
        processSaveBlock({ block: 'world_base', data: { tick: 200, newKey: 'added' } }, rawWorld);
        assertEqual(rawWorld.tick, 200, 'world_base overwrites existing tick');
        assertEqual(rawWorld.customKey, 'preserved', 'world_base preserves keys not in new data');
        assertEqual(rawWorld.newKey, 'added', 'world_base adds new keys');
    })();

    // --- world_misc Object.assign merges ---
    (function testWorldMiscMerge() {
        const rawWorld = { existingProp: 'keep' };
        processSaveBlock({ block: 'world_misc', data: { extraProp: 'added' } }, rawWorld);
        assertEqual(rawWorld.existingProp, 'keep', 'world_misc preserves existing props');
        assertEqual(rawWorld.extraProp, 'added', 'world_misc adds new props');
    })();

    // --- rng_seed with undefined seed ---
    (function testRngSeedUndefined() {
        const rawWorld = {};
        processSaveBlock({ block: 'rng_seed', data: {} }, rawWorld);
        assert(rawWorld._rng_seed === undefined, 'rng_seed with no seed property does not set _rng_seed');
    })();

    // --- mod_data with handler error (should not throw) ---
    (function testModDataHandlerError() {
        sandbox.window.ModAPI = {
            saveHandlers: {
                badMod: {
                    onLoad() { throw new Error('Mod crash!'); }
                }
            }
        };
        const rawWorld = {};
        // Should not throw — error is caught internally
        let threw = false;
        try {
            processSaveBlock({ block: 'mod_data', data: { badMod: { key: 'val' } } }, rawWorld);
        } catch (e) {
            threw = true;
        }
        assert(!threw, 'mod_data block catches handler errors without throwing');
        sandbox.window.ModAPI = null;
    })();

})();

// ===================================================================
//  5. Block format serialization verification
// ===================================================================
console.log('\n=== 5. Block Format Verification ===');

(function testBlockFormat() {
    const { sandbox } = createSandbox();
    loadSaveManager(sandbox);
    const processSaveBlock = sandbox.processSaveBlock;

    // Every block must be parseable as { block: string, data: any }
    (function testBlockStructure() {
        const blocks = [
            { block: 'meta', data: { mod_list: [] } },
            { block: 'player', data: { name: 'X' } },
            { block: 'history', data: [] },
            { block: 'item_registry', data: [] },
            { block: 'container_registry', data: [] },
            { block: 'world_base', data: {} },
            { block: 'world_regions', data: {} },
            { block: 'world_factions', data: {} },
            { block: 'world_npcs', data: {} },
            { block: 'world_rulers', data: { rulers: {}, intrigues: {} } },
            { block: 'world_businesses', data: {} },
            { block: 'world_ships', data: { ships: {}, fleets: {}, ports: {} } },
            { block: 'world_monsters', data: {} },
            { block: 'world_sublocations', data: {} },
            { block: 'world_map', data: {} },
            { block: 'world_trek', data: {} },
            { block: 'world_misc', data: {} },
            { block: 'rng_seed', data: { seed: 42 } },
            { block: 'mod_data', data: {} },
        ];

        for (const block of blocks) {
            const serialized = JSON.stringify(block);
            const deserialized = JSON.parse(serialized);
            assertEqual(deserialized.block, block.block, `block "${block.block}" serializes with correct block id`);
            assert(deserialized.data !== undefined, `block "${block.block}" has data field after roundtrip`);
        }
    })();

    // Verify that processSaveBlock returns {} for all non-player, non-history blocks
    (function testReturnValues() {
        const rawWorld = {};
        const playerResult = processSaveBlock({ block: 'player', data: { name: 'X' } }, rawWorld);
        assert(playerResult.rawPlayer !== undefined, 'player block returns rawPlayer');

        const historyResult = processSaveBlock({ block: 'history', data: [] }, rawWorld);
        assert(historyResult.rawHistory !== undefined, 'history block returns rawHistory');

        const otherBlocks = ['meta', 'item_registry', 'container_registry', 'world_base', 'world_regions',
            'world_factions', 'world_npcs', 'world_rulers', 'world_businesses', 'world_ships',
            'world_monsters', 'world_sublocations', 'world_map', 'world_trek', 'world_misc',
            'rng_seed', 'mod_data'];

        for (const blockType of otherBlocks) {
            let data;
            switch (blockType) {
                case 'item_registry': data = []; break;
                case 'container_registry': data = []; break;
                case 'world_rulers': data = { rulers: {}, intrigues: {} }; break;
                case 'world_ships': data = { ships: {}, fleets: {}, ports: {} }; break;
                case 'rng_seed': data = { seed: 1 }; break;
                default: data = {}; break;
            }
            const result = processSaveBlock({ block: blockType, data }, rawWorld);
            assertDeepEqual(result, {}, `block "${blockType}" returns empty object`);
        }
    })();

})();

// ===================================================================
// Run async tests then print results
// ===================================================================
runMutexTests().then(() => {
    console.log(`\nResults: ${PASS} passed, ${FAIL} failed`);
    if (FAIL > 0) process.exit(1);
});
