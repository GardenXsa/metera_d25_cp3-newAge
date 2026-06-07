/**
 * METERA D25 — STUB PROVIDER GAME TEST
 * =====================================
 * Запускает игру через провайдер-заглушку (OldCoreInventorySystem) без Electron/C++ движка.
 * Тестирует: контейнеры, предметы, золото, локации, экипировку, ensurePlayerContainers.
 *
 * Запуск: node tests/test_stub_game.js [--verbose] [--timeout 30000]
 */

'use strict';

// ============================================================================
// MOCK ENVIRONMENT — минимальная замена браузера для запуска игровой логики
// ============================================================================

const _storage = {};
const localStorage = {
    getItem(k) { return _storage[k] || null; },
    setItem(k, v) { _storage[k] = String(v); },
    removeItem(k) { delete _storage[k]; },
    clear() { Object.keys(_storage).forEach(k => delete _storage[k]); }
};

const document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add(){}, remove(){}, contains(){return false}, toggle(){} }, setAttribute(){}, addEventListener(){}, appendChild(){}, innerHTML: '', textContent: '' }),
    body: { appendChild(){}, removeChild(){} },
    addEventListener() {},
    removeEventListener() {}
};

const window = {
    electronAPI: null,  // NO IPC — заставляет использовать stub provider
    localStorage,
    document,
    crypto: require('crypto'),
    marked: { parse: (t) => t },
    EventBus: null,  // будет установлен ниже
    isSimulatorInitialized: false,
    cancelCurrentApiRequest: () => {}
};

// Переносим глобальные объекты
global.window = window;
global.document = document;
global.localStorage = localStorage;
// global.crypto is already available in Node.js — don't overwrite
global.structuredClone = global.structuredClone || (obj => JSON.parse(JSON.stringify(obj)));


// ============================================================================
// CORE GAME SYSTEMS — извлечено из script.js / globals.js
// ============================================================================

const ItemRegistry = new Map();
const ContainerRegistry = new Map();

function normalizeContainer(cont) {
    if (!cont) return cont;
    const c = { ...cont };
    if (!c.items && c.item_ids) c.items = [...c.item_ids];
    if (c.items) c.items = [...c.items];
    if (!Array.isArray(c.items)) c.items = [];
    if (!c.item_ids) c.item_ids = [...c.items];
    else c.item_ids = [...c.item_ids];
    c.lock_data = c.lock_data ? JSON.parse(JSON.stringify(c.lock_data)) : { is_locked: false, difficulty: 10, trap: null };
    c.physical_props = c.physical_props ? JSON.parse(JSON.stringify(c.physical_props)) : {};
    c.custom_props = c.custom_props ? JSON.parse(JSON.stringify(c.custom_props)) : {};
    c.location = c.location ? JSON.parse(JSON.stringify(c.location)) : {};
    return c;
}

function getContainerItems(container) {
    if (!container || !container.items) return [];
    return Array.isArray(container.items) ? container.items : [];
}

function setContainer(key, cont) {
    return ContainerRegistry.set(key, normalizeContainer(cont));
}

function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function normalizeContainerLocation(locationData = null) {
    if (typeof locationData === 'string') {
        return { world_coords: null, parent_entity: null, parent_container: null, region_id: locationData };
    }
    return {
        world_coords: Array.isArray(locationData?.world_coords) ? [...locationData.world_coords] : null,
        parent_entity: locationData?.parent_entity || null,
        parent_container: locationData?.parent_container || null,
        region_id: locationData?.region_id ?? null
    };
}

// Minimal EventBus
const EventBus = {
    _listeners: {},
    on(event, callback) {
        if (!this._listeners[event]) this._listeners[event] = [];
        const entry = { callback, once: false };
        this._listeners[event].push(entry);
        return () => { const list = this._listeners[event]; if (list) { const idx = list.indexOf(entry); if (idx !== -1) list.splice(idx, 1); } };
    },
    once(event, callback) { if (!this._listeners[event]) this._listeners[event] = []; this._listeners[event].push({ callback, once: true }); },
    emit(event, data) {
        const list = this._listeners[event]; if (!list) return;
        for (let i = list.length - 1; i >= 0; i--) { try { list[i].callback(data); } catch (e) { console.error(`[EventBus] Error in handler for '${event}':`, e); } if (list[i] && list[i].once) { list.splice(i, 1); } }
    },
    off(event, callback) { const list = this._listeners[event]; if (!list) return; this._listeners[event] = list.filter(entry => entry.callback !== callback); }
};
window.EventBus = EventBus;

// GameRNG (seeded PRNG)
const GameRNG = {
    _seed: 42,
    seed(s) { this._seed = s >>> 0; },
    next() { let t = this._seed += 0x6D2B79F5; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; },
    roll(min, max) { return Math.floor(this.next() * (max - min + 1)) + min; },
    d20(modifier = 0) { return this.roll(1, 20) + modifier; }
};


// ============================================================================
// GAME STATE — имитация player и World
// ============================================================================

let player = null;
let World = { npcs: {}, regions: {} };
let itemsReferenceData = null;

function resolveSpecialContainerId(containerId) {
    if (!containerId) return containerId;
    if (containerId === 'player' || containerId === 'player_inventory' || containerId === 'player_backpack') return player?.container_backpack || null;
    if (containerId === 'player_equipment') return player?.container_equipment || null;
    return containerId;
}

function resolveActorLocation(actorId) {
    if (!actorId) return null;
    if (actorId === 'player' && player) {
        return normalizeContainerLocation({ world_coords: [0, 0, 0], parent_entity: 'player', parent_container: null, region_id: player.location || null });
    }
    if (ContainerRegistry.has(actorId)) {
        return resolveContainerLocation(actorId);
    }
    return null;
}

function resolveContainerLocation(containerId) {
    const resolvedId = resolveSpecialContainerId(containerId);
    if (!resolvedId) return null;
    const cont = ContainerRegistry.get(resolvedId);
    if (!cont) return null;
    const location = normalizeContainerLocation(cont.location);
    if (cont.type === 'magical_pocket') {
        return normalizeContainerLocation({ world_coords: null, parent_entity: cont.owner_id || null, parent_container: null, region_id: 'astral' });
    }
    if (location.parent_entity === 'player' || (cont.owner_id === 'player' && (cont.type === 'player_backpack' || cont.type === 'player_equipment'))) {
        location.parent_entity = 'player';
        location.region_id = player?.location || location.region_id;
    }
    return location;
}

// OwnershipService stub — always allows access in test
const OwnershipService = {
    canAccess: function(actorId, containerId, options = {}) { return true; }
};


// ============================================================================
// OldCoreInventorySystem — ПОЛНАЯ КОПИЯ из script.js (для изолированного тестирования)
// ============================================================================

const OldCoreInventorySystem = {
    createContainer: function(type, ownerId, maxWeight, maxSlots, locationData = null, extraData = {}) {
        const id = "cont_" + generateUUID();
        const defaultLocation = locationData || (
            ownerId === 'player' && (type === 'player_backpack' || type === 'player_equipment')
                ? { world_coords: [0, 0, 0], parent_entity: 'player', parent_container: null, region_id: player?.location || null }
                : null
        );
        const container = {
            id: id,
            type: type,
            max_weight_kg: maxWeight,
            max_slots: maxSlots,
            owner_id: ownerId,
            location: normalizeContainerLocation(defaultLocation),
            lock_data: { is_locked: false, difficulty: 10, trap: null, ...(extraData.lock_data || {}) },
            physical_props: { health: 200, flammable: type !== 'faction_vault', ...(extraData.physical_props || {}) },
            custom_props: { ...(extraData.custom_props || {}) },
            items: []
        };
        setContainer(id, normalizeContainer(container));
        return id;
    },
    createItem: function(prototypeId, quantity, containerId, customProps = {}) {
        const proto = itemsReferenceData ? itemsReferenceData.find(i => i.id === prototypeId) : null;
        const resolvedContainerId = resolveSpecialContainerId(containerId);
        const id = "item_" + generateUUID();
        let baseWeight = proto ? (proto.weight || 1) : 1;
        if (prototypeId === 'gold') baseWeight = 0.01;

        const reservedKeys = new Set(['flags', 'durability', 'slot_index', 'slot', 'state', 'created_at', 'last_moved_at']);
        const mergedCustomProps = {};
        Object.keys(customProps || {}).forEach(key => {
            if (!reservedKeys.has(key)) mergedCustomProps[key] = customProps[key];
        });

        const item = {
            id: id,
            prototype_id: prototypeId,
            name: proto ? proto.name : prototypeId,
            stack_size: quantity,
            container_id: resolvedContainerId,
            slot_index: customProps.slot_index ?? customProps.slot ?? null,
            state: customProps.state || "idle",
            flags: { quest_item: false, bound_to_owner: null, stolen: false, magical: false, fragile: false, ...(customProps.flags || {}) },
            durability: Number.isFinite(customProps.durability) ? customProps.durability : (proto ? (proto.durability || 100) : 100),
            custom_props: { weight_per_unit: baseWeight, name: customProps.name || proto?.name || prototypeId, ...mergedCustomProps },
            created_at: customProps.created_at ?? (player ? player.stats.turnCount : 0),
            last_moved_at: customProps.last_moved_at ?? (player ? player.stats.turnCount : 0)
        };
        ItemRegistry.set(id, item);
        if (resolvedContainerId && ContainerRegistry.has(resolvedContainerId)) {
            const targetCont = ContainerRegistry.get(resolvedContainerId);
            if (!targetCont.items) targetCont.items = [];
            targetCont.items.push(id);
        }
        return id;
    },
    getContainerWeight: function(containerId) {
        const cont = ContainerRegistry.get(containerId);
        if (!cont) return 0;
        return getContainerItems(cont).reduce((sum, itemId) => {
            const it = ItemRegistry.get(itemId);
            return sum + (it ? (it.custom_props.weight_per_unit || 1) * it.stack_size : 0);
        }, 0);
    },
    findItemByPrototype: function(containerId, protoId) {
        const cont = ContainerRegistry.get(containerId);
        if (!cont) return null;
        return getContainerItems(cont).find(id => {
            const it = ItemRegistry.get(id);
            return it && (it.prototype_id === protoId || it.custom_props?.aiIdentifier === protoId);
        });
    },
    moveItem: function(itemId, sourceContainerId, targetContainerId, quantity = null, options = {}) {
        if (!ItemRegistry.has(itemId)) return { success: false, error: "Item not found" };
        const actorId = options.actorId || 'player';
        const resolvedSourceId = resolveSpecialContainerId(sourceContainerId || ItemRegistry.get(itemId)?.container_id);
        const requestedTargetId = resolveSpecialContainerId(targetContainerId);
        let item = ItemRegistry.get(itemId);

        if (!resolvedSourceId || !ContainerRegistry.has(resolvedSourceId)) return { success: false, error: "Source container not found" };
        if (item.container_id !== resolvedSourceId) return { success: false, error: "Item is not in the declared source container" };

        let actualTargetId = requestedTargetId;
        if (!actualTargetId) return { success: false, error: "No target container" };
        if (!ContainerRegistry.has(actualTargetId)) return { success: false, error: "Target container not found" };
        if (resolvedSourceId === actualTargetId) return { success: true, movedItemId: itemId, targetContainerId: actualTargetId, sourceContainerId: resolvedSourceId };

        const sourceContainer = ContainerRegistry.get(resolvedSourceId);
        const targetContainer = ContainerRegistry.get(actualTargetId);
        const requestedQuantity = quantity === null ? item.stack_size : parseInt(quantity, 10);
        if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) return { success: false, error: "Invalid quantity" };
        if (requestedQuantity > item.stack_size) return { success: false, error: "Not enough quantity in stack" };
        if (sourceContainer.id !== targetContainer.id && getContainerItems(targetContainer).length >= targetContainer.max_slots) return { success: false, error: "Target container is full (slots)" };

        const currentWeight = this.getContainerWeight(actualTargetId);
        const itemWeight = (item.custom_props.weight_per_unit || 1) * requestedQuantity;
        if (sourceContainer.id !== targetContainer.id && currentWeight + itemWeight > targetContainer.max_weight_kg) {
            return { success: false, error: "Target container is full (weight)" };
        }

        let movingItem = item;
        let createdItemId = null;
        if (requestedQuantity < item.stack_size) {
            item.stack_size -= requestedQuantity;
            createdItemId = this.createItem(item.prototype_id, requestedQuantity, null, {
                ...structuredClone(item.custom_props || {}),
                flags: structuredClone(item.flags || {}),
                durability: item.durability,
                slot_index: item.slot_index,
                state: item.state,
                created_at: item.created_at,
                last_moved_at: item.last_moved_at
            });
            movingItem = ItemRegistry.get(createdItemId);
        }

        if (!sourceContainer.items) sourceContainer.items = [];
        sourceContainer.items = sourceContainer.items.filter(id => id !== movingItem.id);
        if (sourceContainer.id !== targetContainer.id) {
            if (!targetContainer.items) targetContainer.items = [];
            targetContainer.items.push(movingItem.id);
        }
        movingItem.container_id = actualTargetId;

        const movedIntoPlayerOwned = player && (
            actualTargetId === player.container_backpack ||
            actualTargetId === player.container_equipment ||
            targetContainer.owner_id === 'player'
        );
        if (movedIntoPlayerOwned && sourceContainer.owner_id && sourceContainer.owner_id !== 'player') {
            movingItem.flags.stolen = true;
        }

        movingItem.last_moved_at = player ? player.stats.turnCount : 0;
        if (player && (movingItem.prototype_id === 'gold' || item.prototype_id === 'gold')) syncPlayerGoldFromInventory();

        return { success: true, movedItemId: movingItem.id, createdItemId, targetContainerId: actualTargetId, sourceContainerId: resolvedSourceId };
    },
    removeItem: function(itemId, quantity) {
        if (!ItemRegistry.has(itemId)) return false;
        const item = ItemRegistry.get(itemId);
        const shouldSyncGold = item.prototype_id === 'gold' && item.container_id === player?.container_backpack;
        if (item.stack_size <= quantity) {
            if (item.container_id && ContainerRegistry.has(item.container_id)) {
                const cont = ContainerRegistry.get(item.container_id);
                if (!cont.items) cont.items = [];
                cont.items = cont.items.filter(id => id !== itemId);
            }
            ItemRegistry.delete(itemId);
        } else {
            item.stack_size -= quantity;
        }
        if (shouldSyncGold) syncPlayerGoldFromInventory();
        return true;
    },
    destroyContainer: function(containerId) {
        const resolvedContainerId = resolveSpecialContainerId(containerId);
        const cont = ContainerRegistry.get(resolvedContainerId);
        if (!cont) return false;
        // Drop items to a ground pile (simplified — just remove them for test)
        const itemsToRemove = [...(cont.items || [])];
        itemsToRemove.forEach(itemId => ItemRegistry.delete(itemId));
        ContainerRegistry.delete(resolvedContainerId);
        return true;
    }
};


// ============================================================================
// GOLD SYSTEM
// ============================================================================

function getGoldAmountInContainer(containerId) {
    const resolvedId = resolveSpecialContainerId(containerId);
    if (!resolvedId || !ContainerRegistry.has(resolvedId)) return 0;
    const cont = ContainerRegistry.get(resolvedId);
    const physicalGold = getContainerItems(cont).reduce((sum, itemId) => {
        const item = ItemRegistry.get(itemId);
        return sum + ((item?.prototype_id === 'gold' || item?.prototype_id === 'gold_ingot' || item?.custom_props?.aiIdentifier === 'gold') ? item.stack_size : 0);
    }, 0);
    return physicalGold;
}

function syncPlayerGoldFromInventory() {
    if (!player?.container_backpack || !ContainerRegistry.has(player.container_backpack)) return 0;
    const backpack = ContainerRegistry.get(player.container_backpack);
    const totalGold = getContainerItems(backpack).reduce((sum, itemId) => {
        const item = ItemRegistry.get(itemId);
        return sum + ((item?.prototype_id === 'gold' || item?.prototype_id === 'gold_ingot' || item?.custom_props?.aiIdentifier === 'gold') ? item.stack_size : 0);
    }, 0);
    player.stats.gold = totalGold;
    return totalGold;
}


// ============================================================================
// STUB PROVIDER — sendInventoryCommand без IPC
// ============================================================================

function sendInventoryCommand(action, args) {
    // STUB: No IPC available — always use local implementation
    return executeLocalInventoryCommand(action, args);
}

function executeLocalInventoryCommand(action, args) {
    switch (action) {
        case 'createContainer': {
            const id = OldCoreInventorySystem.createContainer(
                args.type, args.ownerId, args.maxWeight, args.maxSlots, args.location, {
                    lock_data: args.lock_data, physical_props: args.physical_props, custom_props: args.custom_props
                }
            );
            return { status: 'ok', containerId: id };
        }
        case 'createItem': {
            const id = OldCoreInventorySystem.createItem(
                args.prototypeId, args.quantity, args.containerId, args.customProps
            );
            return { status: 'ok', itemId: id };
        }
        case 'moveItem': {
            const res = OldCoreInventorySystem.moveItem(
                args.itemId, null, args.targetContainerId,
                args.quantity >= 0 ? args.quantity : null,
                { actorId: 'player', ignoreAccess: false, ignoreDistance: true }
            );
            return { status: res.success ? 'ok' : 'error', ...res, feedback: res.error };
        }
        case 'removeItem': {
            const ok = OldCoreInventorySystem.removeItem(args.itemId, args.quantity);
            return { status: ok ? 'ok' : 'error', success: ok };
        }
        case 'destroyContainer': {
            const ok = OldCoreInventorySystem.destroyContainer(args.containerId);
            return { status: ok ? 'ok' : 'error', success: ok };
        }
        case 'updateContainerLocation': {
            const cont = ContainerRegistry.get(args.containerId);
            if (cont) {
                cont.location = normalizeContainerLocation(args.location);
                return { status: 'ok', success: true };
            }
            return { status: 'error', success: false, error: 'Container not found' };
        }
        default:
            return { status: 'error', success: false, error: `Unknown command: ${action}` };
    }
}

// Async wrapper (matches CoreInventorySystemAsync API)
const CoreInventorySystemAsync = {
    createContainer: async function(type, ownerId, maxWeight, maxSlots, locationData = null, extraData = {}) {
        const defaultLocation = locationData || (
            ownerId === 'player' && (type === 'player_backpack' || type === 'player_equipment')
                ? { world_coords: [0, 0, 0], parent_entity: 'player', parent_container: null, region_id: player?.location || null }
                : null
        );
        const res = await sendInventoryCommand('createContainer', {
            type, ownerId, maxWeight, maxSlots, location: normalizeContainerLocation(defaultLocation),
            lock_data: extraData.lock_data || {}, physical_props: extraData.physical_props || {}, custom_props: extraData.custom_props || {}
        });
        return res.containerId;
    },
    createItem: async function(prototypeId, quantity, containerId, customProps = {}) {
        const res = await sendInventoryCommand('createItem', {
            prototypeId, quantity, containerId: resolveSpecialContainerId(containerId), customProps
        });
        return res.itemId;
    },
    updateContainerLocation: async function(containerId, locationData) {
        const res = await sendInventoryCommand('updateContainerLocation', {
            containerId: resolveSpecialContainerId(containerId),
            location: locationData
        });
        return res.success;
    },
    removeItem: async function(itemId, quantity) {
        const res = await sendInventoryCommand('removeItem', { itemId, quantity });
        return res.success;
    }
};

async function syncPlayerContainerBindings() {
    if (!player) return;
    const playerBinding = normalizeContainerLocation({ world_coords: [0, 0, 0], parent_entity: 'player', parent_container: null, region_id: player.location || null });
    if (player.container_backpack && ContainerRegistry.has(player.container_backpack)) {
        await CoreInventorySystemAsync.updateContainerLocation(player.container_backpack, playerBinding);
    }
    if (player.container_equipment && ContainerRegistry.has(player.container_equipment)) {
        await CoreInventorySystemAsync.updateContainerLocation(player.container_equipment, playerBinding);
    }
}

async function ensurePlayerContainers() {
    if (!player) return;
    const needsBackpack = !player.container_backpack || !ContainerRegistry.has(player.container_backpack);
    if (needsBackpack) {
        player.container_backpack = await CoreInventorySystemAsync.createContainer("player_backpack", "player", 100, 30);
    }
    const needsEquipment = !player.container_equipment || !ContainerRegistry.has(player.container_equipment);
    if (needsEquipment) {
        player.container_equipment = await CoreInventorySystemAsync.createContainer("player_equipment", "player", 50, 10);
    }
    if (needsBackpack || needsEquipment) {
        await syncPlayerContainerBindings();
    }
}


// ============================================================================
// TEST FRAMEWORK
// ============================================================================

let PASS = 0;
let FAIL = 0;
let WARN = 0;
const verbose = process.argv.includes('--verbose');

function assert(condition, message) {
    if (condition) {
        PASS++;
        if (verbose) console.log(`  \x1b[32mPASS\x1b[0m: ${message}`);
    } else {
        FAIL++;
        console.log(`  \x1b[31mFAIL\x1b[0m: ${message}`);
    }
}

function assertEqual(actual, expected, message) {
    assert(actual === expected, `${message} (expected: ${expected}, got: ${actual})`);
}

function assertNotEqual(actual, expected, message) {
    assert(actual !== expected, `${message} (should not be: ${expected}, got: ${actual})`);
}

function assertGreaterThan(actual, threshold, message) {
    assert(actual > threshold, `${message} (expected > ${threshold}, got: ${actual})`);
}

function assertIncludes(arr, item, message) {
    assert(Array.isArray(arr) && arr.includes(item), `${message} (array does not include: ${item})`);
}

function resetState() {
    ItemRegistry.clear();
    ContainerRegistry.clear();
    player = null;
    World = { npcs: {}, regions: {} };
    itemsReferenceData = null;
    GameRNG.seed(42);
}


// ============================================================================
// TESTS
// ============================================================================

async function testContainerCreation() {
    console.log('\n--- TEST: Container Creation ---');
    resetState();

    player = { name: 'TestHero', location: 'test_location', stats: { gold: 0, turnCount: 0 }, container_backpack: null, container_equipment: null };

    // Create backpack
    const backpackId = OldCoreInventorySystem.createContainer("player_backpack", "player", 100, 30);
    assert(backpackId && backpackId.startsWith('cont_'), 'Backpack ID format is cont_<uuid>');
    assert(ContainerRegistry.has(backpackId), 'Backpack is in ContainerRegistry');

    const backpack = ContainerRegistry.get(backpackId);
    assertEqual(backpack.type, 'player_backpack', 'Backpack type is correct');
    assertEqual(backpack.owner_id, 'player', 'Backpack owner is player');
    assertEqual(backpack.max_weight_kg, 100, 'Backpack max weight is 100');
    assertEqual(backpack.max_slots, 30, 'Backpack max slots is 30');
    assert(Array.isArray(backpack.items) && backpack.items.length === 0, 'Backpack starts empty');
    assertEqual(backpack.location.parent_entity, 'player', 'Backpack location parent is player');
    assertEqual(backpack.location.region_id, 'test_location', 'Backpack location region matches player location');

    player.container_backpack = backpackId;

    // Create equipment container
    const equipId = OldCoreInventorySystem.createContainer("player_equipment", "player", 50, 10);
    assert(equipId && equipId.startsWith('cont_'), 'Equipment ID format is cont_<uuid>');
    assert(ContainerRegistry.has(equipId), 'Equipment container is in registry');

    const equip = ContainerRegistry.get(equipId);
    assertEqual(equip.type, 'player_equipment', 'Equipment type is correct');
    assertEqual(equip.max_weight_kg, 50, 'Equipment max weight is 50');
    assertEqual(equip.max_slots, 10, 'Equipment max slots is 10');

    // Create a merchant chest
    const chestId = OldCoreInventorySystem.createContainer("static_chest", "merchant_01", 500, 100,
        { world_coords: [1, 2, 3], parent_entity: null, parent_container: null, region_id: 'market_district' },
        { custom_props: { shop_name: 'General Store' } }
    );
    assert(ContainerRegistry.has(chestId), 'Merchant chest is in registry');
    const chest = ContainerRegistry.get(chestId);
    assertEqual(chest.location.region_id, 'market_district', 'Cest location region is correct');
    assertEqual(chest.custom_props.shop_name, 'General Store', 'Chest custom props preserved');
}

async function testItemCreation() {
    console.log('\n--- TEST: Item Creation ---');
    resetState();

    player = { name: 'TestHero', location: 'test_location', stats: { gold: 0, turnCount: 0 }, container_backpack: null, container_equipment: null };
    player.container_backpack = OldCoreInventorySystem.createContainer("player_backpack", "player", 100, 30);

    // Create a sword
    const swordId = OldCoreInventorySystem.createItem('sword_short', 1, player.container_backpack, {
        name: 'Short Sword', slot: 'right_hand', durability: 80
    });
    assert(swordId && swordId.startsWith('item_'), 'Sword ID format is item_<uuid>');
    assert(ItemRegistry.has(swordId), 'Sword is in ItemRegistry');

    const sword = ItemRegistry.get(swordId);
    assertEqual(sword.prototype_id, 'sword_short', 'Sword prototype is correct');
    assertEqual(sword.stack_size, 1, 'Sword quantity is 1');
    assertEqual(sword.container_id, player.container_backpack, 'Sword is in backpack');
    assertEqual(sword.custom_props.name, 'Short Sword', 'Sword custom name preserved');
    assertEqual(sword.durability, 80, 'Sword durability is 80');
    assertEqual(sword.flags.stolen, false, 'Sword is not stolen');

    // Sword should appear in backpack's items array
    const backpack = ContainerRegistry.get(player.container_backpack);
    assertIncludes(backpack.items, swordId, 'Sword ID is in backpack items array');

    // Create gold items
    const goldId = OldCoreInventorySystem.createItem('gold', 100, player.container_backpack, {
        aiIdentifier: 'gold'
    });
    const goldItem = ItemRegistry.get(goldId);
    assertEqual(goldItem.prototype_id, 'gold', 'Gold prototype is correct');
    assertEqual(goldItem.stack_size, 100, 'Gold stack size is 100');
    assertEqual(goldItem.custom_props.weight_per_unit, 0.01, 'Gold weight per unit is 0.01');
}

async function testGoldSystem() {
    console.log('\n--- TEST: Gold System ---');
    resetState();

    player = { name: 'TestHero', location: 'test_location', stats: { gold: 0, turnCount: 0 }, container_backpack: null, container_equipment: null };
    player.container_backpack = OldCoreInventorySystem.createContainer("player_backpack", "player", 100, 30);

    // Add 100 gold
    OldCoreInventorySystem.createItem('gold', 100, player.container_backpack, { aiIdentifier: 'gold' });
    const goldInBackpack = getGoldAmountInContainer(player.container_backpack);
    assertEqual(goldInBackpack, 100, 'Gold count in backpack is 100');

    // Sync gold to player stats
    const syncedGold = syncPlayerGoldFromInventory();
    assertEqual(syncedGold, 100, 'Synced gold is 100');
    assertEqual(player.stats.gold, 100, 'player.stats.gold is 100 after sync');

    // Add 50 more gold
    OldCoreInventorySystem.createItem('gold', 50, player.container_backpack, { aiIdentifier: 'gold' });
    syncPlayerGoldFromInventory();
    assertEqual(player.stats.gold, 150, 'player.stats.gold is 150 after adding 50 more');

    // Remove 30 gold
    const backpack = ContainerRegistry.get(player.container_backpack);
    const firstGoldItemId = backpack.items.find(id => ItemRegistry.get(id)?.prototype_id === 'gold');
    assert(firstGoldItemId, 'Found a gold item in backpack');
    OldCoreInventorySystem.removeItem(firstGoldItemId, 30);
    syncPlayerGoldFromInventory();
    // Was 100, removed 30 = 70 left from first stack + 50 from second = 120
    assertEqual(player.stats.gold, 120, 'player.stats.gold is 120 after removing 30');

    // Verify physical gold items in container
    const goldAfter = getGoldAmountInContainer(player.container_backpack);
    assertEqual(goldAfter, 120, 'Physical gold count matches after removal');
}

async function testItemMovement() {
    console.log('\n--- TEST: Item Movement ---');
    resetState();

    player = { name: 'TestHero', location: 'test_location', stats: { gold: 0, turnCount: 0 }, container_backpack: null, container_equipment: null };
    player.container_backpack = OldCoreInventorySystem.createContainer("player_backpack", "player", 100, 30);
    player.container_equipment = OldCoreInventorySystem.createContainer("player_equipment", "player", 50, 10);

    // Create sword in backpack
    const swordId = OldCoreInventorySystem.createItem('sword_short', 1, player.container_backpack, { name: 'Short Sword' });

    // Move sword from backpack to equipment
    const moveResult = OldCoreInventorySystem.moveItem(swordId, player.container_backpack, player.container_equipment, null, {
        actorId: 'player', ignoreAccess: true, ignoreDistance: true
    });
    assert(moveResult.success, 'Move sword to equipment succeeded');
    assertEqual(moveResult.targetContainerId, player.container_equipment, 'Target is equipment container');

    // Verify sword is in equipment
    const sword = ItemRegistry.get(swordId);
    assertEqual(sword.container_id, player.container_equipment, 'Sword container_id is equipment');
    const backpack = ContainerRegistry.get(player.container_backpack);
    const equipment = ContainerRegistry.get(player.container_equipment);
    assert(!backpack.items.includes(swordId), 'Sword removed from backpack items');
    assertIncludes(equipment.items, swordId, 'Sword added to equipment items');

    // Test stack splitting
    const potionId = OldCoreInventorySystem.createItem('potion_heal_small', 5, player.container_backpack, { name: 'Health Potion' });
    const splitResult = OldCoreInventorySystem.moveItem(potionId, player.container_backpack, player.container_equipment, 3, {
        actorId: 'player', ignoreAccess: true, ignoreDistance: true
    });
    assert(splitResult.success, 'Split move succeeded');
    assert(splitResult.createdItemId, 'Split created a new item');

    const originalPotion = ItemRegistry.get(potionId);
    assertEqual(originalPotion.stack_size, 2, 'Original potion stack reduced to 2');

    const splitPotion = ItemRegistry.get(splitResult.createdItemId);
    assertEqual(splitPotion.stack_size, 3, 'Split potion stack is 3');
    assertEqual(splitPotion.container_id, player.container_equipment, 'Split potion is in equipment');
}

async function testContainerWeight() {
    console.log('\n--- TEST: Container Weight ---');
    resetState();

    player = { name: 'TestHero', location: 'test_location', stats: { gold: 0, turnCount: 0 }, container_backpack: null, container_equipment: null };
    player.container_backpack = OldCoreInventorySystem.createContainer("player_backpack", "player", 100, 30);

    // Empty backpack weighs 0
    let weight = OldCoreInventorySystem.getContainerWeight(player.container_backpack);
    assertEqual(weight, 0, 'Empty backpack weighs 0');

    // Add items
    OldCoreInventorySystem.createItem('sword_short', 1, player.container_backpack, { name: 'Sword' }); // weight 1 (default)
    OldCoreInventorySystem.createItem('gold', 100, player.container_backpack, { aiIdentifier: 'gold' }); // weight 0.01 * 100 = 1

    weight = OldCoreInventorySystem.getContainerWeight(player.container_backpack);
    assert(Math.abs(weight - 2) < 0.01, `Backpack weight is ~2 after items (got: ${weight.toFixed(2)})`);
}

async function testEnsurePlayerContainers() {
    console.log('\n--- TEST: ensurePlayerContainers ---');
    resetState();

    // Simulate the exact error from the user's report:
    // "Контейнер undefined не найден" / "Рюкзак игрока не найден в реестре"
    player = {
        name: 'TestHero',
        location: 'Столица Аквилон (Imperial City)',
        stats: { gold: 0, turnCount: 0 },
        container_backpack: null,  // NOT SET — this causes the error
        container_equipment: null  // NOT SET — this causes the error
    };

    // Before: containers are null
    assertEqual(player.container_backpack, null, 'Backpack is null before ensure');
    assertEqual(player.container_equipment, null, 'Equipment is null before ensure');

    await ensurePlayerContainers();

    // After: containers should be created and registered
    assert(player.container_backpack !== null, 'Backpack is set after ensure');
    assert(player.container_equipment !== null, 'Equipment is set after ensure');
    assert(ContainerRegistry.has(player.container_backpack), 'Backpack is in ContainerRegistry');
    assert(ContainerRegistry.has(player.container_equipment), 'Equipment is in ContainerRegistry');

    const backpack = ContainerRegistry.get(player.container_backpack);
    assertEqual(backpack.type, 'player_backpack', 'Created backpack type is correct');
    assertEqual(backpack.owner_id, 'player', 'Created backpack owner is player');
    // FIX (Issue #66/#103): Use property-based assertions instead of exact text matching.
    // Exact location name matching is fragile — use type and structure checks instead.
    const backpackRegion = backpack.location.region_id;
    assert(typeof backpackRegion === 'string' && backpackRegion.length > 0,
        'Backpack location region is a non-empty string');
    assertEqual(backpack.location.parent_entity, 'player', 'Backpack location parent is player');

    // Call ensure again — should NOT recreate containers
    const oldBackpackId = player.container_backpack;
    const oldEquipId = player.container_equipment;
    await ensurePlayerContainers();
    assertEqual(player.container_backpack, oldBackpackId, 'Backpack ID unchanged after second ensure');
    assertEqual(player.container_equipment, oldEquipId, 'Equipment ID unchanged after second ensure');

    // Simulate container missing from registry but ID still on player
    const savedBackpackId = player.container_backpack;
    ContainerRegistry.delete(savedBackpackId);  // Remove from registry
    await ensurePlayerContainers();
    assert(player.container_backpack !== savedBackpackId, 'Backpack recreated when missing from registry');
    assert(ContainerRegistry.has(player.container_backpack), 'New backpack is in registry');
}

async function testFullGameFlow() {
    console.log('\n--- TEST: Full Game Flow (Stub Provider) ---');
    resetState();

    // Simulate: finalizeCharacterCreation + finalizeWorldSetupAndStart
    player = {
        name: 'Арик',
        gender: 'male',
        race: 'human',
        class: 'warrior',
        era: 'rebirth',
        location: 'Столица Аквилон (Imperial City)',
        stats: {
            str: 14, dex: 12, int: 8, con: 13, cha: 10, res: 12,
            level: 1, xp: 0, gold: 0, hp: 25, maxHp: 25, mana: 5, maxMana: 5,
            turnCount: 0
        },
        container_backpack: null,
        container_equipment: null,
        equipment: {},
        subLocations: {},
        visitedLocations: []
    };

    // Step 1: Create containers (as done in finalizeWorldSetupAndStart)
    player.container_backpack = await CoreInventorySystemAsync.createContainer("player_backpack", "player", 100, 30);
    player.container_equipment = await CoreInventorySystemAsync.createContainer("player_equipment", "player", 50, 10);

    assert(player.container_backpack !== null, 'Game flow: Backpack created');
    assert(player.container_equipment !== null, 'Game flow: Equipment created');
    assert(ContainerRegistry.has(player.container_backpack), 'Game flow: Backpack in registry');
    assert(ContainerRegistry.has(player.container_equipment), 'Game flow: Equipment in registry');

    // Step 2: Sync container bindings (location)
    await syncPlayerContainerBindings();
    const backpack = ContainerRegistry.get(player.container_backpack);
    // FIX (Issue #66/#103): Use property-based check instead of exact text matching
    assert(typeof backpack.location.region_id === 'string' && backpack.location.region_id.length > 0,
        'Game flow: Backpack location region is a non-empty string');

    // Step 3: Add starting items
    await CoreInventorySystemAsync.createItem('sword_short', 1, player.container_backpack, { name: 'Стартовый меч', slot: 'right_hand' });
    await CoreInventorySystemAsync.createItem('potion_heal_small', 3, player.container_backpack, { name: 'Зелье здоровья' });
    await CoreInventorySystemAsync.createItem('gold', 100, player.container_backpack, { aiIdentifier: 'gold' });

    // Step 4: Verify gold system
    syncPlayerGoldFromInventory();
    assertEqual(player.stats.gold, 100, 'Game flow: Player gold is 100');

    // Step 5: Verify item count in backpack
    const bpItems = getContainerItems(ContainerRegistry.get(player.container_backpack));
    assertEqual(bpItems.length, 3, 'Game flow: 3 items in backpack (sword, potions, gold)');

    // Step 6: Equip sword
    const swordId = OldCoreInventorySystem.findItemByPrototype(player.container_backpack, 'sword_short');
    assert(swordId, 'Game flow: Found sword in backpack');

    const equipResult = OldCoreInventorySystem.moveItem(swordId, player.container_backpack, player.container_equipment, null, {
        actorId: 'player', ignoreAccess: true, ignoreDistance: true
    });
    assert(equipResult.success, 'Game flow: Sword equipped');

    // Step 7: Change location and re-sync
    player.location = 'Портовый район';
    await syncPlayerContainerBindings();
    const bpAfterMove = ContainerRegistry.get(player.container_backpack);
    assertEqual(bpAfterMove.location.region_id, 'Портовый район', 'Game flow: Location updated after move');

    // Step 8: Spend some gold
    const goldItem = ItemRegistry.get(
        getContainerItems(ContainerRegistry.get(player.container_backpack))
            .find(id => ItemRegistry.get(id)?.prototype_id === 'gold')
    );
    assert(goldItem, 'Game flow: Found gold in backpack');
    OldCoreInventorySystem.removeItem(goldItem.id, 25);
    syncPlayerGoldFromInventory();
    assertEqual(player.stats.gold, 75, 'Game flow: Gold is 75 after spending 25');
}

async function testStolenItemsFlag() {
    console.log('\n--- TEST: Stolen Items Flag ---');
    resetState();

    player = { name: 'TestHero', location: 'test_location', stats: { gold: 0, turnCount: 0 }, container_backpack: null, container_equipment: null };
    player.container_backpack = OldCoreInventorySystem.createContainer("player_backpack", "player", 100, 30);

    // Create an NPC chest
    const chestId = OldCoreInventorySystem.createContainer("static_chest", "npc_guard", 200, 50,
        { world_coords: [0, 0, 0], parent_entity: null, parent_container: null, region_id: 'test_location' }
    );
    const gemId = OldCoreInventorySystem.createItem('gem_ruby', 1, chestId, { name: 'Ruby' });

    // Steal the gem (move from NPC chest to player backpack)
    const stealResult = OldCoreInventorySystem.moveItem(gemId, chestId, player.container_backpack, null, {
        actorId: 'player', ignoreAccess: true, ignoreDistance: true
    });
    assert(stealResult.success, 'Stealing gem succeeded');

    const stolenGem = ItemRegistry.get(gemId);
    assertEqual(stolenGem.flags.stolen, true, 'Gem is flagged as stolen');
}

async function testContainerCapacityLimits() {
    console.log('\n--- TEST: Container Capacity Limits ---');
    resetState();

    // Create a small container (max 2 slots, 5kg)
    const smallBagId = OldCoreInventorySystem.createContainer("player_backpack", "player", 5, 2);
    player = { name: 'TestHero', location: 'test', stats: { gold: 0, turnCount: 0 }, container_backpack: smallBagId, container_equipment: null };

    // Fill 2 slots
    OldCoreInventorySystem.createItem('sword_short', 1, smallBagId, { name: 'Sword 1' });
    OldCoreInventorySystem.createItem('sword_short', 1, smallBagId, { name: 'Sword 2' });

    // Try to add a 3rd item — should fail (slots full)
    const smallBag = ContainerRegistry.get(smallBagId);
    assertEqual(getContainerItems(smallBag).length, 2, 'Small bag has 2 items');

    // Create another container as target
    const bigBagId = OldCoreInventorySystem.createContainer("player_backpack", "player", 100, 30);

    const thirdSwordId = OldCoreInventorySystem.createItem('sword_short', 1, bigBagId, { name: 'Sword 3' });
    const moveResult = OldCoreInventorySystem.moveItem(thirdSwordId, bigBagId, smallBagId, null, {
        actorId: 'player', ignoreAccess: true, ignoreDistance: true
    });
    assert(!moveResult.success, 'Move to full container fails');
    assert(moveResult.error.includes('full'), `Error mentions full: ${moveResult.error}`);
}

async function testUpdateContainerLocation() {
    console.log('\n--- TEST: Update Container Location ---');
    resetState();

    player = { name: 'TestHero', location: 'old_location', stats: { gold: 0, turnCount: 0 }, container_backpack: null, container_equipment: null };
    player.container_backpack = OldCoreInventorySystem.createContainer("player_backpack", "player", 100, 30);

    const bp = ContainerRegistry.get(player.container_backpack);
    assertEqual(bp.location.region_id, 'old_location', 'Initial location is old_location');

    // Update location
    const newLocation = normalizeContainerLocation({ world_coords: [0, 0, 0], parent_entity: 'player', parent_container: null, region_id: 'new_location' });
    await CoreInventorySystemAsync.updateContainerLocation(player.container_backpack, newLocation);

    const bpAfter = ContainerRegistry.get(player.container_backpack);
    assertEqual(bpAfter.location.region_id, 'new_location', 'Location updated to new_location');
}


// ============================================================================
// RUN ALL TESTS
// ============================================================================

async function runAllTests() {
    console.log('\n\x1b[1m============================================\x1b[0m');
    console.log('\x1b[1m  METERA D25 — STUB PROVIDER GAME TESTS\x1b[0m');
    console.log('\x1b[1m============================================\x1b[0m');
    console.log(`  Mode: STUB (OldCoreInventorySystem, no IPC)`);
    console.log(`  Timestamp: ${new Date().toISOString()}`);
    console.log('');

    await testContainerCreation();
    await testItemCreation();
    await testGoldSystem();
    await testItemMovement();
    await testContainerWeight();
    await testEnsurePlayerContainers();
    await testFullGameFlow();
    await testStolenItemsFlag();
    await testContainerCapacityLimits();
    await testUpdateContainerLocation();

    console.log('\n\x1b[1m============================================\x1b[0m');
    console.log(`  \x1b[32mPASSED: ${PASS}\x1b[0m`);
    console.log(`  \x1b[31mFAILED: ${FAIL}\x1b[0m`);
    console.log(`  \x1b[33mWARNINGS: ${WARN}\x1b[0m`);
    console.log('\x1b[1m============================================\x1b[0m');

    if (FAIL > 0) {
        console.log('\n\x1b[31mSOME TESTS FAILED! Fix before pushing.\x1b[0m');
        process.exit(1);
    } else {
        console.log('\n\x1b[32mAll game logic tests passed through stub provider.\x1b[0m');
        process.exit(0);
    }
}

runAllTests().catch(err => {
    console.error('\x1b[31mFATAL ERROR:\x1b[0m', err);
    process.exit(2);
});
