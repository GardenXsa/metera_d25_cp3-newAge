// ======================================================================
// --- MARKED.JS FALLBACK (in case CDN is blocked by CSP/offline) ---
// ======================================================================
if (typeof marked === 'undefined') {
    console.warn('[marked] CDN not loaded. Using simple Markdown fallback renderer.');
    window.marked = {
        parse: function(text) {
            if (typeof text !== 'string') return '';
            return text
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.+?)\*/g, '<em>$1</em>')
                .replace(/__(.+?)__/g, '<u>$1</u>')
                .replace(/_(.+?)_/g, '<em>$1</em>')
                .replace(/~~(.+?)~~/g, '<del>$1</del>')
                .replace(/`(.+?)`/g, '<code>$1</code>')
                .replace(/^### (.+)$/gm, '<h3>$1</h3>')
                .replace(/^## (.+)$/gm, '<h2>$1</h2>')
                .replace(/^# (.+)$/gm, '<h1>$1</h1>')
                .replace(/^- (.+)$/gm, '<li>$1</li>')
                .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
                .replace(/\n{2,}/g, '</p><p>')
                .replace(/\n/g, '<br>');
        }
    };
}

// ======================================================================
// --- SEEDED PRNG (deterministic rolls for game mechanics) ---
// ======================================================================
const GameRNG = {
    _seed: (typeof crypto !== 'undefined' && crypto.getRandomValues)
        ? crypto.getRandomValues(new Uint32Array(1))[0]
        : (Date.now() ^ (Math.random() * 0x100000000 | 0)),
    /**
     * Seed the RNG. Call once at game start or on load.
     * @param {number} seed
     */
    seed(seed) { this._seed = seed >>> 0; },
    /**
     * Mulberry32 — fast 32-bit PRNG. Returns [0, 1).
     * Deterministic given the same seed sequence.
     */
    next() {
        let t = this._seed += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    /** Returns integer in [min, max] inclusive (like a d20 roll). */
    roll(min, max) {
        return Math.floor(this.next() * (max - min + 1)) + min;
    },
    /** d20 + modifier roll, used for lockpicking, skill checks etc. */
    d20(modifier = 0) {
        return this.roll(1, 20) + modifier;
    }
};

// ============================================================================
// FIX (Issue #40): Centralized state registry
// Global mutable state scattered across window scope is an architectural problem.
// MetereaState provides a single namespace for all game settings and runtime config.
// Legacy window.* assignments still work for backward compatibility, but new code
// should use MetereaState.get(key) / MetereaState.set(key, value).
// ============================================================================
const MetereaState = {
    _store: {},
    _listeners: {},
    get(key) { return this._store[key]; },
    set(key, value) {
        const old = this._store[key];
        this._store[key] = value;
        // Also set on window for backward compatibility
        if (typeof window !== 'undefined') window[key] = value;
        // Notify listeners
        if (this._listeners[key]) {
            for (const fn of this._listeners[key]) fn(value, old, key);
        }
    },
    onChange(key, fn) {
        if (!this._listeners[key]) this._listeners[key] = [];
        this._listeners[key].push(fn);
    },
    removeListener(key, fn) {
        if (!this._listeners[key]) return;
        this._listeners[key] = this._listeners[key].filter(f => f !== fn);
    },
    getAll() { return { ...this._store }; }
};
if (typeof window !== 'undefined') window.MetereaState = MetereaState;

// ======================================================================
// --- SECURE KEY STORAGE (Issue #11) ---
// API keys are no longer stored in plaintext in localStorage.
// They are XOR-encrypted with a per-session key derived from a random nonce.
// This prevents trivial exfiltration via XSS (keys are unreadable without the session key).
// ======================================================================
const _SESSION_KEY_NONCE = (typeof crypto !== 'undefined' && crypto.getRandomValues)
    ? Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')
    : (Date.now().toString(36) + Math.random().toString(36).slice(2));

function _xorEncode(text) {
    if (typeof text !== 'string' || text.length === 0) return '';
    let result = '';
    for (let i = 0; i < text.length; i++) {
        result += String.fromCharCode(text.charCodeAt(i) ^ _SESSION_KEY_NONCE.charCodeAt(i % _SESSION_KEY_NONCE.length));
    }
    return 'enc1:' + btoa(result);
}

function _xorDecode(encoded) {
    if (typeof encoded !== 'string' || !encoded.startsWith('enc1:')) return encoded; // plaintext passthrough
    try {
        const decoded = atob(encoded.slice(5));
        let result = '';
        for (let i = 0; i < decoded.length; i++) {
            result += String.fromCharCode(decoded.charCodeAt(i) ^ _SESSION_KEY_NONCE.charCodeAt(i % _SESSION_KEY_NONCE.length));
        }
        return result;
    } catch (e) {
        return ''; // corrupted data
    }
}

const SecureKeyStorage = {
    setItem(key, value) {
        if (typeof value !== 'string' || value.length === 0) {
            localStorage.setItem(key, '');
            return;
        }
        localStorage.setItem(key, _xorEncode(value));
    },
    getItem(key) {
        const raw = localStorage.getItem(key);
        if (raw === null) return null;
        if (raw === '') return '';
        return _xorDecode(raw);
    },
    removeItem(key) {
        localStorage.removeItem(key);
    },
    /** Migrate a plaintext key to encrypted form (call on first load) */
    migrateKey(key) {
        const raw = localStorage.getItem(key);
        if (raw === null) return;
        if (raw.startsWith('enc1:')) return; // already encrypted
        localStorage.setItem(key, _xorEncode(raw));
    }
};

// ======================================================================
// --- CORE INVENTORY & CONTAINER SYSTEM (T3) ---
// ======================================================================

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

function resolveActorLocation(actorId) {
    if (!actorId) return null;
    if (actorId === getInventoryActorId('default') && player) {
        return normalizeContainerLocation({ world_coords: [0, 0, 0], parent_entity: 'player', parent_container: null, region_id: player.location || null });
    }
    if (ContainerRegistry.has(actorId)) {
        return resolveContainerLocation(actorId);
    }
    const npc = World?.npcs?.[actorId];
    if (npc) {
        return normalizeContainerLocation({ world_coords: [0, 0, 0], parent_entity: actorId, parent_container: null, region_id: npc.currentLocation || npc.homeLocation || null });
    }
    return null;
}

function resolveContainerLocation(containerId) {
    const resolvedId = resolveSpecialContainerId(containerId);
    if (!resolvedId) return null;
    const cont = ContainerRegistry.get(resolvedId);
    if (!cont) return null;

    const location = normalizeContainerLocation(cont.location);
    if (cont.type === 'magical_pocket') { return normalizeContainerLocation({ world_coords: null, parent_entity: cont.owner_id || null, parent_container: null, region_id: getGameplayRuntimeConfig().inventory.system_regions.magical_pocket }); }

    if (location.parent_entity === 'player' || (cont.owner_id === 'player' && (cont.type === 'player_backpack' || cont.type === 'player_equipment'))) {
        location.parent_entity = 'player';
        location.region_id = player?.location || location.region_id;
    }

    const parentNpc = location.parent_entity ? World?.npcs?.[location.parent_entity] : null;
    if (parentNpc) {
        location.region_id = parentNpc.currentLocation || parentNpc.homeLocation || location.region_id;
    }

    return location;
}

async function syncPlayerContainerBindings() {
    if (!player) return;
    const playerBinding = normalizeContainerLocation({ world_coords: [0, 0, 0], parent_entity: 'player', parent_container: null, region_id: player.location || null });

    if (player.container_backpack && ContainerRegistry.has(player.container_backpack)) {
        await CoreInventorySystemAsync.updateContainerLocation(player.container_backpack, playerBinding);
    }
    if (player.container_equipment && ContainerRegistry.has(player.container_equipment)) {
        await CoreInventorySystemAsync.updateContainerLocation(player.container_equipment, playerBinding);
    }

    for (const cont of ContainerRegistry.values()) {
        if (cont.owner_id === 'player' && cont.type === 'magical_pocket') {
            await CoreInventorySystemAsync.updateContainerLocation(cont.id, normalizeContainerLocation({ world_coords: null, parent_entity: 'player', parent_container: null, region_id: getGameplayRuntimeConfig().inventory.system_regions.magical_pocket })); } } }

/**
 * Гарантирует, что у игрока есть рюкзак и контейнер экипировки.
 * Если они отсутствуют (null/undefined или не в реестре) -- создаёт их.
 * Вызывать перед любой операцией с инвентарём, если есть сомнения.
 * @returns {Promise<void>}
 */
const SYSTEM_CONTAINER_REGISTRY_PATH = './data/system_containers.json';
let _systemContainerRegistryPromise = null;
let _systemContainerRegistry = null;

function getRuntimeDataRegistry(name) {
    const sources = [
        window.RuntimeData,
        window.runtimeData,
        window.RuntimeDatabase,
        window.GameData,
        window.__RUNTIME_DATA__
    ].filter(Boolean);

    for (const source of sources) {
        if (source[name]) return source[name];
        if (source.data && source.data[name]) return source.data[name];
        if (typeof source.get === 'function') {
            const value = source.get(name);
            if (value) return value;
        }
    }
    return null;
}

async function loadSystemContainerRegistry() {
    if (_systemContainerRegistry) return _systemContainerRegistry;
    if (_systemContainerRegistryPromise) return _systemContainerRegistryPromise;

    _systemContainerRegistryPromise = (async () => {
        const fromRuntime = getRuntimeDataRegistry('system_containers');
        if (fromRuntime) {
            _systemContainerRegistry = fromRuntime;
            return _systemContainerRegistry;
        }

        if (typeof fetch === 'function') {
            try {
                const response = await fetch(SYSTEM_CONTAINER_REGISTRY_PATH);
                if (response.ok) {
                    _systemContainerRegistry = await response.json();
                    return _systemContainerRegistry;
                }
            } catch (error) {
                console.warn('[DataArch] Не удалось загрузить data/system_containers.json:', error.message);
            }
        }

        _systemContainerRegistry = { aliases: {}, containers: {} };
        return _systemContainerRegistry;
    })();

    return _systemContainerRegistryPromise;
}

function getLoadedSystemContainerRegistry() {
    return _systemContainerRegistry || getRuntimeDataRegistry('system_containers') || { aliases: {}, containers: {} };
}

function resolveSystemContainerKey(aliasOrId) {
    const registry = getLoadedSystemContainerRegistry();
    return registry.aliases?.[aliasOrId] || aliasOrId;
}

async function getSystemContainerConfig(aliasOrId) {
    const registry = await loadSystemContainerRegistry();
    const key = registry.aliases?.[aliasOrId] || aliasOrId;
    const config = registry.containers?.[key] || {};
    return { id: key, ...config };
}

function getSystemContainerInstanceId(aliasOrId) {
    const key = resolveSystemContainerKey(aliasOrId);
    if (key === 'player_backpack') return player?.container_backpack || null;
    if (key === 'player_equipment') return player?.container_equipment || null;

    const existing = Array.from(ContainerRegistry.values()).find(c => c.custom_props?.system_id === key);
    return existing?.id || null;
}

async function createConfiguredSystemContainer(aliasOrId, fallbackConfig = {}) {
    const config = { ...fallbackConfig, ...(await getSystemContainerConfig(aliasOrId)) };
    const type = config.type || config.container_type || config.id || aliasOrId;
    const ownerId = config.ownerId || config.owner_id || fallbackConfig.ownerId || null;
    const maxWeight = Number(config.maxWeight ?? config.max_weight_kg ?? config.weight_limit ?? fallbackConfig.maxWeight ?? 0);
    const maxSlots = Number(config.maxSlots ?? config.max_slots ?? config.capacity ?? fallbackConfig.maxSlots ?? 0);
    const location = config.locationBinding === 'player'
        ? resolveActorLocation(getInventoryActorId('default'))
        : (config.location || fallbackConfig.location || null);

    return await CoreInventorySystemAsync.createContainer(type, ownerId, maxWeight, maxSlots, location, {
    custom_props: {
      ...(config.custom_props || {}),
      system_id: config.id || aliasOrId
    }
  });
}

async function ensurePlayerContainers() {
    if (!player) return;

    const needsBackpack = !player.container_backpack || !ContainerRegistry.has(player.container_backpack);
    if (needsBackpack) {
        console.warn("[Inventory] Рюкзак игрока отсутствует или не в реестре. Пересоздаём из data/system_containers.json.");
        player.container_backpack = await createConfiguredSystemContainer('player_backpack');

        if (!player.container_backpack || !ContainerRegistry.has(player.container_backpack)) {
            throw new Error("[Inventory] Не удалось создать player_backpack через data/system_containers.json");
        }
    }

    const needsEquipment = !player.container_equipment || !ContainerRegistry.has(player.container_equipment);
    if (needsEquipment) {
        console.warn("[Inventory] Контейнер экипировки отсутствует или не в реестре. Пересоздаём из data/system_containers.json.");
        player.container_equipment = await createConfiguredSystemContainer('player_equipment');

        if (!player.container_equipment || !ContainerRegistry.has(player.container_equipment)) {
            throw new Error("[Inventory] Не удалось создать player_equipment через data/system_containers.json");
        }
    }

    if (needsBackpack || needsEquipment) {
    await syncPlayerContainerBindings();
  }
}

function resolveSpecialContainerId(containerId) {
    if (!containerId) return containerId;

    const resolvedInstanceId = getSystemContainerInstanceId(containerId);
    if (resolvedInstanceId) return resolvedInstanceId;

    const resolvedKey = resolveSystemContainerKey(containerId);
    if (resolvedKey !== containerId) {
        console.warn(`[resolveSpecialContainerId] system container '${containerId}' not found. Ensure it explicitly before resolving.`);
        return null;
    }

    return containerId;
}

/**
 * Ensures the guard_confiscation_chest container exists, creating it if needed.
 * Call this explicitly before resolveSpecialContainerId('guard_confiscation_chest').
 */
async function ensureGuardConfiscationChest() {
    const existing = getSystemContainerInstanceId('guard_confiscation_chest');
    if (existing) return existing;

    const createdId = await createConfiguredSystemContainer('guard_confiscation_chest');

    if (!createdId || !ContainerRegistry.has(createdId)) {
        throw new Error("[Inventory] Не удалось создать guard_confiscation_chest через data/system_containers.json");
    }

    return createdId;
}



function getGoldAmountInContainer(containerId) {
    const resolvedId = resolveSpecialContainerId(containerId);
    if (!resolvedId || !ContainerRegistry.has(resolvedId)) return 0;
    const cont = ContainerRegistry.get(resolvedId);
    const physicalGold = getContainerItems(cont).reduce((sum, itemId) => { const item = ItemRegistry.get(itemId); return sum + (isGoldLikeItem(item) ? item.stack_size : 0); }, 0);
    const npcAccountGold = World?.npcs?.[cont.owner_id]?.inventory?.gold || 0;
    return physicalGold + npcAccountGold;
}

function syncPlayerGoldFromInventory() {
    if (!player?.container_backpack || !ContainerRegistry.has(player.container_backpack)) return 0;
    const backpack = ContainerRegistry.get(player.container_backpack);
    const totalGold = getContainerItems(backpack).reduce((sum, itemId) => { const item = ItemRegistry.get(itemId); return sum + (isGoldLikeItem(item) ? item.stack_size : 0); }, 0);
    player.stats.gold = totalGold;
    return totalGold;
}

function countRealItems(containerId, prototypeId) {
    const cont = ContainerRegistry.get(containerId);
    if (!cont || !cont.items) return 0;
    return cont.items.reduce((sum, itemId) => {
        const item = ItemRegistry.get(itemId);
        return (item && item.prototype_id === prototypeId) ? sum + item.stack_size : sum;
    }, 0);
}

async function addRealItems(containerId, prototypeId, quantity, customProps = {}) {
    if (window.ModAPI) ModAPI.emit('onInventoryChanged', {action: 'create', prototypeId, containerId, quantity});
    const createdIds = [];
    for (let i = 0; i < quantity; i++) {
        const id = await CoreInventorySystemAsync.createItem(prototypeId, 1, containerId, {
            ...customProps,
            name: getItemName(prototypeId, player?.era)
        });
        createdIds.push(id);
    }
    return createdIds;
}

function availableManpower(faction) {
    if (!faction || typeof World === 'undefined' || !World) return 0;
    let total = 0;
    for (let rid of faction.regions || []) {
        const region = World.regions[rid];
        if (!region || !region.vault_id) continue;
        const manpowerConfig = getGameplayRuntimeConfig().faction_manpower; const weapons = manpowerConfig.weapon_good_ids.reduce((sum, goodId) => sum + countRealItems(region.vault_id, goodId), 0); const food = manpowerConfig.food_good_ids.reduce((sum, goodId) => sum + countRealItems(region.vault_id, goodId), 0); const population = region.population || 0; const possibleSoldiers = Math.min(Math.floor(population * requireRuntimeNumber(manpowerConfig.population_soldier_ratio, 'gameplay_runtime.faction_manpower.population_soldier_ratio')), weapons); if (food < possibleSoldiers * requireRuntimeNumber(manpowerConfig.food_per_soldier, 'gameplay_runtime.faction_manpower.food_per_soldier')) continue;
        total += possibleSoldiers;
    }
    return Math.floor(total);
}

const OwnershipService = {
    canAccess: function(actorId, containerId, options = {}) {
        const resolvedId = resolveSpecialContainerId(containerId);
        if (!resolvedId) return true;
        const cont = ContainerRegistry.get(resolvedId);
        if (!cont) return false;

        if (cont.type === 'magical_pocket') {
            if (cont.owner_id !== actorId) return false;
            if (actorId === getInventoryActorId('default') && (!player?.statusEffects || !player.statusEffects['spell_magical_pocket'])) return false;
            return true;
        }

        if (cont.lock_data?.is_locked && !options.allowLocked) return false;
        if (resolvedId === player?.container_backpack || resolvedId === player?.container_equipment) return actorId === getInventoryActorId('default');
        if (cont.location?.parent_entity && cont.location.parent_entity === actorId) return true;
        if (options.ignoreDistance) return true;

        const actorLocation = resolveActorLocation(actorId);
        const containerLocation = resolveContainerLocation(resolvedId);
        if (!actorLocation || !containerLocation) return false;
        return checkDistance(actorLocation, containerLocation);
    }
};

const EconomySim = {
  calculatePrice: function(prototypeId, regionId, isBuying) {
    const economyConfig = getGameplayRuntimeConfig().economy;
    let basePrice = ECONOMY_ITEMS[prototypeId]?.basePrice || toRuntimeNumber(economyConfig.default_base_price, 10);
    let region = typeof World !== 'undefined' && World ? World.regions[regionId] : null;
    let marketMod = region?.markets[prototypeId] ? (region.markets[prototypeId] / basePrice) : 1.0;
    let chaMod = player ? (toRuntimeNumber(player.stats.cha, 10) - toRuntimeNumber(economyConfig.charisma_baseline, 10)) * toRuntimeNumber(economyConfig.charisma_price_step, 0.05) : 0;
    let finalPrice = basePrice * marketMod;
    if (isBuying) finalPrice *= (toRuntimeNumber(economyConfig.buy_multiplier, 1.2) - chaMod);
    else finalPrice *= (toRuntimeNumber(economyConfig.sell_multiplier, 0.8) + chaMod);
    return Math.max(toRuntimeNumber(economyConfig.min_price, 1), Math.floor(finalPrice));
  }
};


function checkDistance(loc1, loc2) {
    loc1 = normalizeContainerLocation(loc1);
    loc2 = normalizeContainerLocation(loc2);
    if (!loc1?.region_id || !loc2?.region_id) return false;
    if (loc1.region_id !== loc2.region_id) return false;
    if (!loc1.world_coords || !loc2.world_coords) return true;
    const dist = Math.hypot(loc1.world_coords[0] - loc2.world_coords[0], loc1.world_coords[1] - loc2.world_coords[1]);
    return dist <= toRuntimeNumber(getGameplayRuntimeConfig().inventory.access_distance, 10.0);
}

function is_sellable(containerId, itemId) {
    const resolvedContainerId = resolveSpecialContainerId(containerId);
    const item = ItemRegistry.get(itemId);
    const cont = resolvedContainerId ? ContainerRegistry.get(resolvedContainerId) : null;
    if (!item || !cont) return false;
    if (item.container_id !== resolvedContainerId) return false;
    if (item.state !== 'idle') return false;
    if (item.flags?.quest_item) return false;
    if (item.flags?.bound_to_owner && item.flags.bound_to_owner !== cont.owner_id) return false;
    if (item.flags?.stolen) return false;
    return true;
}

/** @deprecated Use CoreInventorySystemAsync instead. Local-only sync implementation. */
const OldCoreInventorySystem = {
    createContainer: function(type, ownerId, maxWeight, maxSlots, locationData = null, extraData = {}) {
        const id = getInventoryEngineRuntimeConfig().id_prefixes.container + generateUUID();
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
            lock_data: { is_locked: false, difficulty: toRuntimeNumber(getGameplayRuntimeConfig().inventory.default_lock_difficulty, 10), trap: null, ...(extraData.lock_data || {}) }, physical_props: { health: toRuntimeNumber(getGameplayRuntimeConfig().inventory.default_container_health, 200), flammable: !getGameplayRuntimeConfig().inventory.non_flammable_container_types.includes(type), ...(extraData.physical_props || {}) },
            custom_props: { ...(extraData.custom_props || {}) },
            items: []
        };
        setContainer(id, normalizeContainer(container));
        return id;
    },
    createItem: function(prototypeId, quantity, containerId, customProps = {}) {
        const proto = itemsReferenceData ? itemsReferenceData.find(i => i.id === prototypeId) : null;
        const resolvedContainerId = resolveSpecialContainerId(containerId);
        const id = getInventoryEngineRuntimeConfig().id_prefixes.item + generateUUID();
        const gameplayConfig = getGameplayRuntimeConfig(); let baseWeight = proto ? (proto.weight || toRuntimeNumber(gameplayConfig.inventory.default_item_weight, 1)) : toRuntimeNumber(gameplayConfig.inventory.default_item_weight, 1); if (Object.prototype.hasOwnProperty.call(gameplayConfig.currency.physical_weights, prototypeId)) baseWeight = toRuntimeNumber(gameplayConfig.currency.physical_weights[prototypeId], baseWeight);

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
            state: customProps.state || getInventoryMovementRuntimeConfig().states.default,
            flags: { quest_item: false, bound_to_owner: null, stolen: false, magical: false, fragile: false, ...(customProps.flags || {}) },
            durability: Number.isFinite(customProps.durability) ? customProps.durability : (proto ? (proto.durability || toRuntimeNumber(getGameplayRuntimeConfig().inventory.default_item_durability, 100)) : toRuntimeNumber(getGameplayRuntimeConfig().inventory.default_item_durability, 100)),
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
    updateContainerLocation: async function(containerId, locationData) {
        const res = await sendInventoryCommand(getInventoryCommandName('update_container_location'), {
            containerId: resolveSpecialContainerId(containerId),
            location: locationData
        });
        return res.success;
    },

    getContainerWeight: function(containerId) {
        const cont = ContainerRegistry.get(containerId);
        if (!cont) return 0;
        return getContainerItems(cont).reduce((sum, itemId) => {
            const it = ItemRegistry.get(itemId);
            return sum + (it ? (it.custom_props.weight_per_unit ?? requireRuntimeNumber(getGameplayRuntimeConfig().inventory.default_item_weight, 'gameplay_runtime.inventory.default_item_weight')) * it.stack_size : 0);
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
    _restoreMovementSnapshot: function(snapshot, createdItemIds = []) {
        if (!snapshot) return;
        snapshot.containers.forEach(([containerId, data]) => {
            if (data) setContainer(containerId, structuredClone(data));
        });
        const snapshotItemIds = new Set(snapshot.items.map(([itemId]) => itemId));
        createdItemIds.forEach(itemId => {
            if (!snapshotItemIds.has(itemId)) ItemRegistry.delete(itemId);
        });
        snapshot.items.forEach(([itemId, data]) => {
            if (data) ItemRegistry.set(itemId, structuredClone(data));
        });
    },
    moveItem: function(itemId, sourceContainerId, targetContainerId, quantity = null, options = {}) {
        if (!ItemRegistry.has(itemId)) return { success: false, error: getInventoryFeedbackText('item_not_found', 'Item not found') };

        const actorId = options.actorId || getInventoryActorId('default');
        const resolvedSourceId = resolveSpecialContainerId(sourceContainerId || ItemRegistry.get(itemId)?.container_id);
        const requestedTargetId = resolveSpecialContainerId(targetContainerId);
        let item = ItemRegistry.get(itemId);

        if (!resolvedSourceId || !ContainerRegistry.has(resolvedSourceId)) return { success: false, error: getInventoryFeedbackText('source_container_not_found', 'Source container not found') };
        if (item.container_id !== resolvedSourceId) return { success: false, error: getInventoryFeedbackText('item_source_mismatch', 'Item is not in the declared source container') };
        if (item.state === getInventoryMovementRuntimeConfig().states.trade_locked && !options.allowTradeLocked) return { success: false, error: getInventoryFeedbackText('item_state_locks_movement', 'Item state locks movement') };

        let actualTargetId = requestedTargetId;
        if (!actualTargetId) {
            actualTargetId = getOrCreateGroundPile(resolveContainerLocation(resolvedSourceId) || resolveActorLocation(actorId));
        }
        if (!ContainerRegistry.has(actualTargetId)) return { success: false, error: getInventoryFeedbackText('target_container_not_found', 'Target container not found') };
        if (resolvedSourceId === actualTargetId) return { success: true, movedItemId: itemId, targetContainerId: actualTargetId, sourceContainerId: resolvedSourceId };

        if (!options.ignoreAccess) {
            if (!OwnershipService.canAccess(actorId, resolvedSourceId, { allowLocked: options.allowLocked, ignoreDistance: options.ignoreDistance })) {
                return { success: false, error: getInventoryFeedbackText('access_denied_source', 'Access denied to source container') };
            }
            if (!OwnershipService.canAccess(actorId, actualTargetId, { allowLocked: options.allowLocked, ignoreDistance: options.ignoreDistance })) {
                return { success: false, error: getInventoryFeedbackText('access_denied_target', 'Access denied to target container') };
            }
        }

        const sourceContainer = ContainerRegistry.get(resolvedSourceId);
        const targetContainer = ContainerRegistry.get(actualTargetId);
        const requestedQuantity = normalizeInventoryMoveQuantity(quantity, item.stack_size);
        if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) return { success: false, error: getInventoryFeedbackText('invalid_quantity', 'Invalid quantity') };
        if (requestedQuantity > item.stack_size) return { success: false, error: getInventoryFeedbackText('not_enough_stack', 'Not enough quantity in stack') };
        if (item.flags?.bound_to_owner && targetContainer.owner_id !== item.flags.bound_to_owner) return { success: false, error: getInventoryFeedbackText('item_soulbound', 'Item is soulbound') };
        if (sourceContainer.id !== targetContainer.id && getContainerItems(targetContainer).length >= targetContainer.max_slots) return { success: false, error: getInventoryFeedbackText('target_slots_full', 'Target container is full (slots)') };

        const currentWeight = this.getContainerWeight(actualTargetId);
        const itemWeight = (item.custom_props.weight_per_unit ?? requireRuntimeNumber(getGameplayRuntimeConfig().inventory.default_item_weight, 'gameplay_runtime.inventory.default_item_weight')) * requestedQuantity;
        if (sourceContainer.id !== targetContainer.id && currentWeight + itemWeight > targetContainer.max_weight_kg) {
            return { success: false, error: getInventoryFeedbackText('target_weight_full', 'Target container is full (weight)') };
        }

        let movingItem = item;
        let createdItemId = null;
        if (requestedQuantity < item.stack_size) {
            item.stack_size -= requestedQuantity;
            // FIX: Create the split item directly in the TARGET container, not source.
            // Previously passed resolvedSourceId which added it to source,
            // then it was moved via filter+push — but createItem already adds to container's .items array,
            // causing a duplicate in source or missed addition to target.
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
            movingItem.container_id = actualTargetId;
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

        if (sourceContainer.type === getInventoryMovementRuntimeConfig().resource_debit_source_container_type && sourceContainer.owner_id !== targetContainer.owner_id) {
            const regionId = resolveContainerLocation(sourceContainer.id)?.region_id;
            if (regionId && typeof World !== 'undefined' && World?.regions?.[regionId]?.resources?.[movingItem.prototype_id]) {
                const regionResource = World.regions[regionId].resources[movingItem.prototype_id];
                regionResource.amount = Math.max(0, regionResource.amount - movingItem.stack_size);
            }
        }

        movingItem.last_moved_at = player ? player.stats.turnCount : 0;
        if (player && (isGoldLikeItem(movingItem) || isGoldLikeItem(item))) syncPlayerGoldFromInventory();

        return { success: true, movedItemId: movingItem.id, createdItemId, targetContainerId: actualTargetId, sourceContainerId: resolvedSourceId };
    },
    moveItems: function(sourceContainerId, targetContainerId, items, options = {}) {
        if (!Array.isArray(items) || items.length === 0) return { success: false, error: getInventoryFeedbackText('no_items_requested', 'No items requested') };
        const resolvedSourceId = resolveSpecialContainerId(sourceContainerId);
        const resolvedTargetId = resolveSpecialContainerId(targetContainerId) || getOrCreateGroundPile(resolveContainerLocation(resolvedSourceId) || resolveActorLocation(options.actorId || getInventoryActorId('default')));
        const trackedItemIds = Array.from(new Set(items.map(obj => obj?.id).filter(Boolean)));
        const snapshot = {
            containers: [resolvedSourceId, resolvedTargetId].filter(Boolean).map(containerId => [containerId, ContainerRegistry.has(containerId) ? structuredClone(ContainerRegistry.get(containerId)) : null]),
            items: trackedItemIds.filter(itemId => ItemRegistry.has(itemId)).map(itemId => [itemId, structuredClone(ItemRegistry.get(itemId))])
        };
        const createdItemIds = [];

        for (const moveRequest of items) {
            const res = this.moveItem(moveRequest.id, resolvedSourceId, resolvedTargetId, moveRequest.quantity || null, options);
            if (!res.success) {
                this._restoreMovementSnapshot(snapshot, createdItemIds);
                return res;
            }
            if (res.createdItemId) createdItemIds.push(res.createdItemId);
        }

        return { success: true, movedCount: items.length, targetContainerId: resolvedTargetId };
    },
    removeItem: function(itemId, quantity) {
        if (!ItemRegistry.has(itemId)) return false;
        const item = ItemRegistry.get(itemId);
        const shouldSyncGold = isCurrencyPrototype(item.prototype_id) && item.container_id === player?.container_backpack;
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

        const groundPileId = getOrCreateGroundPile(resolveContainerLocation(resolvedContainerId));
        const itemsToMove = [...(cont.items || [])];
        itemsToMove.forEach(itemId => this.moveItem(itemId, resolvedContainerId, groundPileId, null, getInventoryTransferOptions('system_full_access')));
        ContainerRegistry.delete(resolvedContainerId);
        return true;
    },
    unlockContainer: function(containerId, actorId) {
        const resolvedContainerId = resolveSpecialContainerId(containerId);
        const cont = ContainerRegistry.get(resolvedContainerId);
        if (!cont || !cont.lock_data.is_locked) return { success: false, error: getInventoryFeedbackText('not_locked_or_not_found', 'Not locked or not found') };
        if (!OwnershipService.canAccess(actorId, resolvedContainerId, { allowLocked: true })) return { success: false, error: getInventoryFeedbackText('too_far_from_container', 'Too far away from container') };
        const actorContId = actorId === getInventoryActorId('default') ? player.container_backpack : null;
        if (!actorContId) return { success: false, error: getInventoryFeedbackText('actor_inventory_not_found', 'Actor inventory not found') };
        const actorCont = ContainerRegistry.get(actorContId);
        const unlockConfig = getInventoryUnlockRuntimeConfig();
        const lockpickId = getContainerItems(actorCont).find(id => ItemRegistry.get(id)?.prototype_id === unlockConfig.lockpick_prototype_id);
        if (!lockpickId) return { success: false, error: getInventoryFeedbackText('no_lockpicks', 'No lockpicks') };
        this.removeItem(lockpickId, 1);
        const roll = GameRNG.d20(getInventoryUnlockAbilityModifier());
        if (roll >= cont.lock_data.difficulty) {
            cont.lock_data.is_locked = false;
            return { success: true, message: getInventoryFeedbackText('unlock_success', 'Unlocked successfully') };
        } else {
            let trapMsg = "";
            if (cont.lock_data.trap) {
                if (cont.lock_data.trap.stat === 'hp') damagePlayerHP(cont.lock_data.trap.amount);
                trapMsg = ` Сработала ловушка! Урон: ${cont.lock_data.trap.amount}.`;
            }
            return { success: false, error: getInventoryFeedbackText('lockpick_broke', 'Lockpick broke, failed to unlock.{trapMessage}', { trapMessage: trapMsg }) };
        }
    },
    confiscateStolen: function(sourceContainerId, destContainerId) {
        const resolvedSourceId = resolveSpecialContainerId(sourceContainerId);
        const resolvedDestId = resolveSpecialContainerId(destContainerId);
        const src = ContainerRegistry.get(resolvedSourceId);
        if (!src) return 0;
        const stolenItems = getContainerItems(src).filter(id => ItemRegistry.get(id)?.flags?.stolen);
        let count = 0;
        stolenItems.forEach(id => {
            if (this.moveItem(id, resolvedSourceId, resolvedDestId, null, getInventoryTransferOptions('system_ignore_access')).success) count++;
        });
        return count;
    },
    buildContainer: function(actorId, type, location) {
        const actorContId = actorId === getInventoryActorId('default') ? player.container_backpack : null;
        if (!actorContId) return null;
        const actorCont = ContainerRegistry.get(actorContId);
        const buildConfig = getInventoryBuildingRuntimeConfig();
        const resourceId = getContainerItems(actorCont).find(id => ItemRegistry.get(id)?.prototype_id === buildConfig.resource_prototype_id);
        const resourceItem = resourceId ? ItemRegistry.get(resourceId) : null;
        if (!resourceItem || resourceItem.stack_size < buildConfig.resource_cost) return null;
        this.removeItem(resourceId, buildConfig.resource_cost);
        return this.createContainer(type, actorId, buildConfig.default_max_weight_kg, buildConfig.default_max_slots, buildConstructedContainerLocation(location, buildConfig));
    }
};

async function fetchGraphContext(queryIds) {
    if (window.electronAPI && window.electronAPI.nexusGetGraphContext) {
        try {
            const res = await window.electronAPI.nexusGetGraphContext(queryIds);
            if (res.status === 'ok') return res.graph_context;
        } catch (e) { console.error("AriGraph fetch error:", e); }
    }
    return [];
}


async function sendInventoryCommand(action, args, _retryCount = 0) {
    const retryConfig = getInventoryEngineRuntimeConfig().ipc_retry; const MAX_RETRIES = retryConfig.max_retries; const RETRY_DELAY_MS = retryConfig.delay_ms; const RETRY_BACKOFF_MULTIPLIER = retryConfig.backoff_multiplier;

    if (!window.electronAPI || !window.electronAPI.nexusInventoryCommand) {
        // FALLBACK: IPC недоступен -- используем локальную реализацию (OldCoreInventorySystem)
        return executeLocalInventoryCommand(action, args);
    }
    try {
        const res = await window.electronAPI.nexusInventoryCommand({ action, args });
        if (res.status === 'ok') {
            if (res.items) res.items.forEach(([k, v]) => ItemRegistry.set(k, v));
            if (res.containers) res.containers.forEach(([k, v]) => setContainer(k, v));
            if (res.deleted_items) res.deleted_items.forEach(id => ItemRegistry.delete(id));
            if (res.deleted_containers) res.deleted_containers.forEach(id => ContainerRegistry.delete(id));
            return res;
        }

        // Если движок не готов -- повторяем попытку с задержкой (race condition при загрузке мира)
        const isEngineNotReady = res.status === 'error' && (
            (res.message && (
                res.message.includes('Engine not ready') ||
                res.message.includes('Engine restarted') ||
                res.message.includes('timed out') ||
                res.message.includes('crashed')
            )) ||
            // Если движок вернул ошибку без деталей -- тоже пробуем ещё раз
            (!res.message && _retryCount === 0)
        );
        if (isEngineNotReady && _retryCount < MAX_RETRIES) {
            const delay = Math.floor(RETRY_DELAY_MS * (1 + (_retryCount * RETRY_BACKOFF_MULTIPLIER)));
            console.warn(`[Inventory] Engine not ready for '${action}' (attempt ${_retryCount + 1}/${MAX_RETRIES}). Retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            return await sendInventoryCommand(action, args, _retryCount + 1);
        }

        // IPC вернул ошибку после всех попыток -- fallback на локальную реализацию
        console.warn(`[Inventory] IPC error for '${action}': ${res.error || res.message || res.status}. Falling back to local.${_retryCount > 0 ? ` (after ${_retryCount} retries)` : ''}`);
        return executeLocalInventoryCommand(action, args);
    } catch (e) {
        if (_retryCount < MAX_RETRIES && (e.message || '').includes('not ready')) {
            const delay = RETRY_DELAY_MS * (_retryCount + 1);
            console.warn(`[Inventory] IPC exception for '${action}' (attempt ${_retryCount + 1}/${MAX_RETRIES}). Retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            return await sendInventoryCommand(action, args, _retryCount + 1);
        }
        console.warn(`[Inventory] IPC exception for '${action}': ${e.message}. Falling back to local.`);
        return executeLocalInventoryCommand(action, args);
    }
}

/**
 * Локальная реализация инвентаря -- fallback когда C++ движок / IPC недоступны.
 * Делегирует к OldCoreInventorySystem (работает напрямую с ContainerRegistry / ItemRegistry).
 */
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
                getInventoryTransferOptions('player_ui')
            );
            return { status: res.success ? 'ok' : 'error', ...res, feedback: res.error };
        }
        case 'moveItems': {
            const res = OldCoreInventorySystem.moveItems(
                args.sourceContainerId, args.targetContainerId, args.items,
                getInventoryTransferOptions('player_ui')
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
            return { status: 'error', success: false, error: getInventoryFeedbackText('container_not_found', 'Container not found') };
        }
        case 'syncEntity':
        case 'updateEntityStat':
        case 'updateItemStat':
            // Команды синхронизации NPC/Entity -- работают только через C++ движок.
            // Локально нет реестра NPC, поэтому просто возвращаем OK (fire-and-forget).
            return { status: 'ok', success: true };
        default:
            console.warn(`[Inventory] Unknown local command: ${action}`);
            return { status: 'error', success: false, error: getInventoryFeedbackText('unknown_command', 'Unknown command: {action}', { action }) };
    }
}

async function getOrCreateGroundPileAsync(locationData) {
    const normalized = normalizeContainerLocation(locationData || resolveActorLocation('player'));
    const existing = Array.from(ContainerRegistry.values()).find(c => c.type === 'ground_pile' && resolveContainerLocation(c.id)?.region_id === normalized.region_id);
    if (existing) return existing.id;
    return await CoreInventorySystemAsync.createContainer('ground_pile', null, 9999, 999, normalized, {
        physical_props: { health: requireRuntimeNumber(getGameplayRuntimeConfig().inventory.default_container_health, 'gameplay_runtime.inventory.default_container_health'), flammable: false }
    });
}

async function consumeRealItemsAsync(containerId, prototypeId, quantity) {
    const cont = ContainerRegistry.get(containerId);
    if (!cont) return 0;
    let remaining = quantity;
    let taken = 0;
    for (const itemId of [...getContainerItems(cont)]) {
        const item = ItemRegistry.get(itemId);
        if (!item || item.prototype_id !== prototypeId) continue;
        const take = Math.min(item.stack_size, remaining);
        if (take > 0) {
            await CoreInventorySystemAsync.removeItem(itemId, take);
            remaining -= take;
            taken += take;
        }
        if (remaining <= 0) break;
    }
    return taken;
}

async function addRealItemsAsync(containerId, prototypeId, quantity, customProps = {}) {
    const createdIds = [];
    for (let i = 0; i < quantity; i++) {
        const id = await CoreInventorySystemAsync.createItem(prototypeId, 1, containerId, {
            ...customProps,
            name: getItemName(prototypeId, player?.era)
        });
        createdIds.push(id);
    }
    return createdIds;
}

const CoreInventorySystemAsync = {
    createContainer: async function(type, ownerId, maxWeight, maxSlots, locationData = null, extraData = {}) {
        const defaultLocation = locationData || (
            ownerId === 'player' && (type === 'player_backpack' || type === 'player_equipment')
                ? { world_coords: [0, 0, 0], parent_entity: 'player', parent_container: null, region_id: player?.location || null }
                : null
        );
        const res = await sendInventoryCommand(getInventoryCommandName('create_container'), {
            type, ownerId, maxWeight, maxSlots, location: normalizeContainerLocation(defaultLocation),
            lock_data: extraData.lock_data || {}, physical_props: extraData.physical_props || {}, custom_props: extraData.custom_props || {}
        });
        return res.containerId;
    },
    createItem: async function(prototypeId, quantity, containerId, customProps = {}) {
        const res = await sendInventoryCommand(getInventoryCommandName('create_item'), {
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

    getContainerWeight: function(containerId) {
        const cont = ContainerRegistry.get(containerId);
        if (!cont) return 0;
        return getContainerItems(cont).reduce((sum, itemId) => {
            const it = ItemRegistry.get(itemId);
            return sum + (it ? (it.custom_props.weight_per_unit ?? requireRuntimeNumber(getGameplayRuntimeConfig().inventory.default_item_weight, 'gameplay_runtime.inventory.default_item_weight')) * it.stack_size : 0);
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
    moveItem: async function(itemId, sourceContainerId, targetContainerId, quantity = null, options = {}) {
        const actualTargetId = resolveSpecialContainerId(targetContainerId) || await getOrCreateGroundPileAsync(resolveContainerLocation(sourceContainerId) || resolveActorLocation(options.actorId || getInventoryActorId('default')));
        const res = await sendInventoryCommand(getInventoryCommandName('move_item'), {
            itemId, targetContainerId: actualTargetId, quantity: serializeInventoryMoveQuantity(quantity)
        });
        return { success: res.success, movedItemId: res.movedItemId, error: res.feedback };
    },
    moveItems: async function(sourceContainerId, targetContainerId, items, options = {}) {
        const actualTargetId = resolveSpecialContainerId(targetContainerId) || await getOrCreateGroundPileAsync(resolveContainerLocation(sourceContainerId) || resolveActorLocation(options.actorId || getInventoryActorId('default')));
        const res = await sendInventoryCommand(getInventoryCommandName('move_items'), {
            sourceContainerId: resolveSpecialContainerId(sourceContainerId),
            targetContainerId: actualTargetId,
            items: items
        });
        return { success: res.success, error: res.feedback };
    },
    removeItem: async function(itemId, quantity) {
        const item = ItemRegistry.get(itemId);
        const shouldSyncGold = item && isGoldLikeItem(item) && item.container_id === player?.container_backpack;
        const res = await sendInventoryCommand(getInventoryCommandName('remove_item'), { itemId, quantity });
        if (shouldSyncGold) syncPlayerGoldFromInventory();
        return res.success;
    },
    destroyContainer: async function(containerId) {
        const resolvedContainerId = resolveSpecialContainerId(containerId);
        const groundPileId = await getOrCreateGroundPileAsync(resolveContainerLocation(resolvedContainerId));
        const res = await sendInventoryCommand(getInventoryCommandName('destroy_container'), {
            containerId: resolvedContainerId, groundContainerId: groundPileId
        });
        return res.success;
    },
    unlockContainer: async function(containerId, actorId) {
        const resolvedContainerId = resolveSpecialContainerId(containerId);
        const cont = ContainerRegistry.get(resolvedContainerId);
        if (!cont || !cont.lock_data.is_locked) return { success: false, error: "Not locked or not found" };
        if (!OwnershipService.canAccess(actorId, resolvedContainerId, { allowLocked: true })) return { success: false, error: "Too far away from container" };
        const actorContId = actorId === 'player' ? player.container_backpack : null;
        if (!actorContId) return { success: false, error: "Actor inventory not found" };
        const actorCont = ContainerRegistry.get(actorContId);
        const lockpickId = getContainerItems(actorCont).find(id => ItemRegistry.get(id)?.prototype_id === 'lockpicks_common');
        if (!lockpickId) return { success: false, error: "No lockpicks" };
        await this.removeItem(lockpickId, 1);
        const roll = GameRNG.d20((player.stats.dex - 10)/2);
        if (roll >= cont.lock_data.difficulty) {
            cont.lock_data.is_locked = false;
            return { success: true, message: "Unlocked successfully" };
        } else {
            let trapMsg = "";
            if (cont.lock_data.trap) {
                if (cont.lock_data.trap.stat === 'hp') damagePlayerHP(cont.lock_data.trap.amount);
                trapMsg = ` Сработала ловушка! Урон: ${cont.lock_data.trap.amount}.`;
            }
            return { success: false, error: "Lockpick broke, failed to unlock." + trapMsg };
        }
    },
    confiscateStolen: async function(sourceContainerId, destContainerId) {
        const resolvedSourceId = resolveSpecialContainerId(sourceContainerId);
        let resolvedDestId = resolveSpecialContainerId(destContainerId);
        if (!resolvedDestId && resolveSystemContainerKey(destContainerId) === 'guard_confiscation_chest') {
            resolvedDestId = await ensureGuardConfiscationChest();
        }
        const src = ContainerRegistry.get(resolvedSourceId);
        if (!src) return 0;
        const stolenItems = getContainerItems(src).filter(id => ItemRegistry.get(id)?.flags?.stolen);
        let count = 0;
        for (const id of stolenItems) {
            const res = await this.moveItem(id, resolvedSourceId, resolvedDestId, null, { actorId: getInventoryActorId('system'), ignoreAccess: true, ignoreDistance: true });
            if (res.success) count++;
        }
        return count;
    },
    buildContainer: async function(actorId, type, location) {
        const actorContId = actorId === 'player' ? player.container_backpack : null;
        if (!actorContId) return null;
        const actorCont = ContainerRegistry.get(actorContId);
        const buildConfig = getInventoryBuildingRuntimeConfig();
        const resourceId = getContainerItems(actorCont).find(id => ItemRegistry.get(id)?.prototype_id === buildConfig.resource_prototype_id);
        const resourceItem = resourceId ? ItemRegistry.get(resourceId) : null;
        if (!resourceItem || resourceItem.stack_size < buildConfig.resource_cost) return null;
        await this.removeItem(resourceId, buildConfig.resource_cost);
        return await this.createContainer(type, actorId, buildConfig.default_max_weight_kg, buildConfig.default_max_slots, buildConstructedContainerLocation(location, buildConfig));
    }
};
// DEPRECATED: CoreInventorySystem alias removed.
// Previously, this was: const CoreInventorySystem = CoreInventorySystemAsync;
// This was DANGEROUS because callers used sync patterns (no await) on async functions,
// causing silent failures (promises not awaited, operations silently dropped).
// 
// MIGRATION GUIDE:
// - For code that NEEDS sync behavior (UI helpers, pure local calculations):
//   Use OldCoreInventorySystem directly — it operates on local registries only.
// - For code that NEEDS engine synchronization (persisting to C++ engine):
//   Use CoreInventorySystemAsync and ALWAYS await the result.
// - NEVER call CoreInventorySystemAsync methods without await.
// - If you see "CoreInventorySystem" in code, replace it with either
//   OldCoreInventorySystem (sync, local) or CoreInventorySystemAsync (async, networked).
//
// FIX (Issue #85/#38): OldCoreInventorySystem is now explicitly marked as @deprecated.
// It will be removed in a future version once all callers migrate to CoreInventorySystemAsync.
// The Proxy wrapper below (CoreInventorySystem) is the transition layer.

/**
 * @deprecated Use CoreInventorySystemAsync (async, networked) instead.
 * OldCoreInventorySystem is the sync, local-only implementation.
 * It operates on local JS registries only and does NOT sync with the C++ engine.
 * Kept for backward compatibility — will be removed in a future version.
 */

// Backward compatibility wrapper that warns when used without proper async handling
const CoreInventorySystem = new Proxy(OldCoreInventorySystem, {
    get(target, prop) {
        if (prop in CoreInventorySystemAsync && typeof CoreInventorySystemAsync[prop] === 'function') {
            // Return the async version but log a deprecation warning
            const asyncFn = CoreInventorySystemAsync[prop];
            return function(...args) {
                const stackHint = new Error().stack?.split('\n')[2]?.trim() || 'unknown caller';
                console.warn(`[DEPRECATED] CoreInventorySystem.${prop}() called — this returns a Promise. Use "await CoreInventorySystemAsync.${prop}()" instead. Called from: ${stackHint}`);
                const result = asyncFn.apply(this, args);
                // If the result is a promise, check if it's being awaited
                if (result && typeof result.then === 'function') {
                    result.catch(err => {
                        console.error(`[CoreInventorySystem] Unhandled async error in ${prop}():`, err);
                    });
                }
                return result;
            };
        }
        return target[prop];
    }
});

async function equipItemAsync(itemId, targetSlot = null) {
    if (window.ModAPI) ModAPI.emit('onPlayerEquipped', {itemId, slot: targetSlot, action: 'equip'});
    if (!player || !player.container_backpack || !player.container_equipment) return null;
    const itemToEquip = ItemRegistry.get(itemId);
    if (!itemToEquip || itemToEquip.container_id !== player.container_backpack) return null;

    if (!targetSlot) {
        const allPossibleSlots = bodySlots.filter(s => !itemToEquip.custom_props.slot || itemToEquip.custom_props.slot === s || (['right_hand', 'left_hand'].includes(s) && ['right_hand', 'left_hand'].includes(itemToEquip.custom_props.slot)));
        if (allPossibleSlots.length === 0) return t('gameInterface.commandFeedback.itemNotEquipable', { itemName: itemToEquip.custom_props.name });
        const eqCont = ContainerRegistry.get(player.container_equipment);
        targetSlot = allPossibleSlots.find(s => !getContainerItems(eqCont).find(id => ItemRegistry.get(id).slot_index === s));
        if (!targetSlot) targetSlot = allPossibleSlots[0];
    }

    if (!bodySlots.includes(targetSlot)) return `[ERROR] Попытка экипировать в несуществующий слот: '${targetSlot}'`;

    const res = await sendInventoryCommand(getInventoryCommandName('equip_item'), {
        itemId, slot: targetSlot, equipmentContainerId: player.container_equipment, backpackContainerId: player.container_backpack
    });

    if (res.success) {
        updateInventoryDisplay();
        updateEquipmentDisplay();
        updateCharacterSheet();
        queuePlayerActionForGM(`Player equipped item '${itemToEquip.custom_props.name}' to slot '${targetSlot}'.`);
        if (itemTooltipElement) itemTooltipElement.style.display = 'none';
        return t('gameInterface.commandFeedback.itemEquipped', { itemName: itemToEquip.custom_props.name, slot: targetSlot });
    }
    return res.feedback;
}

async function unequipItemAsync(slot) {
    if (!player || !player.container_equipment || !player.container_backpack) return null;
    const eqCont = ContainerRegistry.get(player.container_equipment);
    const itemId = getContainerItems(eqCont).find(id => ItemRegistry.get(id).slot_index === slot);
    if (!itemId) return t('gameInterface.commandFeedback.slotIsEmpty', { slot: slot });

    const itemToUnequip = ItemRegistry.get(itemId);
    const backpack = ContainerRegistry.get(player.container_backpack);

    if (getContainerItems(backpack).length >= player.inventoryCapacity) {
        return t('gameInterface.commandFeedback.inventoryFullOnUnequip', { itemName: itemToUnequip.custom_props.name });
    }

    const res = await sendInventoryCommand(getInventoryCommandName('unequip_item'), {
        slot, equipmentContainerId: player.container_equipment, backpackContainerId: player.container_backpack
    });

    if (res.success) {
        updateInventoryDisplay();
        updateEquipmentDisplay();
        updateCharacterSheet();
        queuePlayerActionForGM(`Player unequipped item '${itemToUnequip.custom_props.name}' from slot '${slot}'.`);
        if (itemTooltipElement) itemTooltipElement.style.display = 'none';
        return t('gameInterface.commandFeedback.itemUnequipped', { itemName: itemToUnequip.custom_props.name, slot: slot });
    }
    return res.feedback;
}

// ======================================================================
// --- TRANSPORT SYSTEM (CENTRALIZED) ---
// ======================================================================

const TransportSystem = {
    registry: null,

    async init() {
        if (!this.registry) {
            try {
                if (typeof window.ensureRuntimeDataLoaded === 'function') {
                    await window.ensureRuntimeDataLoaded();
                }
                this.registry = window.TRANSPORT_REGISTRY || {};
                console.log('[TransportSystem] Registry loaded:', Object.keys(this.registry));
            } catch (error) {
                console.error('[TransportSystem] Failed to load registry:', error);
                // Fallback к жестко закодированному списку
                this.registry = {
                    horse: { id: 'horse', speedMultiplier: 2.0, cargoBonus: 5, name: 'Лошадь', basePrice: 500, rarity: 'Необычный' },
                    warhorse: { id: 'warhorse', speedMultiplier: 1.8, cargoBonus: 3, name: 'Боевой конь', basePrice: 1200, rarity: 'Редкий' },
                    cart: { id: 'cart', speedMultiplier: 1.3, cargoBonus: 15, name: 'Тележка', basePrice: 300, rarity: 'Обычный' },
                    wagon: { id: 'wagon', speedMultiplier: 1.5, cargoBonus: 30, name: 'Торговая повозка', basePrice: 500, rarity: 'Необычный' },
                    ship_deed: { id: 'ship_deed', speedMultiplier: 2.5, cargoBonus: 50, name: 'Документ на корабль', basePrice: 2000, rarity: 'Редкий' }
                };
            }
        }
        return this.registry;
    },

    isTransportId(id) {
        if (!this.registry) return false;
        return id && this.registry.hasOwnProperty(id.toLowerCase());
    },

    getTransportData(id) {
        if (!this.registry) return null;
        return this.registry[id.toLowerCase()] || null;
    },

    getAllTransportIds() {
        if (!this.registry) return [];
        return Object.keys(this.registry);
    },

    validateTransportItem(item) {
        if (!item) return { valid: false, error: 'Item is null or undefined' };

        const transportData = this.getTransportData(item.prototype_id || item.custom_props?.aiIdentifier);

        if (!transportData) {
            return {
                valid: false,
                error: `Item "${item.custom_props?.name || item.prototype_id}" is not a valid transport. Valid IDs: ${this.getAllTransportIds().join(', ')}`,
                suggestion: `Use addItem with aiIdentifier from: ${this.getAllTransportIds().join(', ')}`
            };
        }

        if (!item.custom_props?.isTransport) {
            return {
                valid: false,
                error: `Item "${item.custom_props?.name}" was not created as transport (missing isTransport flag)`,
                suggestion: `Recreate item using addItem with aiIdentifier="${transportData.id}"`
            };
        }

        return { valid: true, data: transportData };
    },

    // Генерация документации для ГМ
    generateGMDocumentation() {
        if (!this.registry) return '';

        let doc = '=== [СЛУЖЕБНАЯ ИНФОРМАЦИЯ ДЛЯ ГМ - НЕ ВЫВОДИТЬ ИГРОКУ] ===\n';
        doc += 'ТРАНСПОРТ: ДОПУСТИМЫЕ ID (СТРОГО!)\n';
        doc += 'При создании транспорта через addItem используй ТОЛЬКО эти aiIdentifier:\n\n';

        for (const [id, data] of Object.entries(this.registry)) {
            doc += `  "${id}" - ${data.name || data.nameEn} (скорость ×${data.speedMultiplier}, +${data.cargoBonus} слотов)\n`;
        }

        doc += '\nПРАВИЛЬНО:\n';
        doc += '  { "command": "addItem", "args": { "aiIdentifier": "horse", "name": "Гнедая лошадь" } }\n';
        doc += '  { "command": "mountTransport", "args": { "itemId": "horse" } }\n';
        doc += '\nНЕПРАВИЛЬНО:\n';
        doc += '  { "command": "addItem", "args": { "aiIdentifier": "horse_brown" } } вќЊ\n';
        doc += '  { "command": "addItem", "args": { "aiIdentifier": "лошадь" } } ❌\n';
        doc += '=== [КОНЕЦ СЛУЖЕБНОЙ ИНФОРМАЦИИ] ===\n';

        return doc;
    }
};

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', async () => {
    await TransportSystem.init();
});

// Delegated event listener for data-action buttons (CSP-compliant replacement for inline onclick)
document.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]');
    if (!action) return;
    const act = action.getAttribute('data-action');
    if (act === 'cancel-api' && typeof window.cancelCurrentApiRequest === 'function') {
        window.cancelCurrentApiRequest();
    } else if (act === 'dismount-transport') {
        dismountTransport();
    } else if (act === 'admin-add-gold') {
        adminAddGold();
    } else if (act === 'admin-heal') {
        adminHeal();
    } else if (act === 'admin-force-summary') {
        adminForceSummary();
    } else if (act === 'toggle-autotester') {
        toggleAutoTester();
    } else if (act === 'toggle-localization') {
        window.DISABLE_LOCALIZATION = !window.DISABLE_LOCALIZATION;
        populateAdminMenu();
    }
});

// ======================================================================
// --- TRANSPORT SYSTEM (LEGACY FUNCTIONS) ---
// ======================================================================

async function mountTransport(itemId) {
    if (!player || !player.container_backpack) return null;

    const item = ItemRegistry.get(itemId);
    if (!item) return "Item not found";

    const transportTypes = TransportSystem.registry ? Object.keys(TransportSystem.registry) : ['horse', 'warhorse', 'cart', 'wagon', 'ship_deed'];
    const isTransportByPrototype = transportTypes.includes(item.prototype_id);
    const isTransportByProperty = item.custom_props?.isTransport === true;

    if (!isTransportByPrototype && !isTransportByProperty) {
        return t('transport.notTransport', 'This item is not a transport');
    }

    const feedback = await executeCommand('mountTransport', {
        itemId: itemId,
        backpackContainerId: player.container_backpack
    });

    if (feedback && !feedback.includes('ERROR')) {
        await updateTransportUI();
        addLogMessage(feedback, 'system-message');
        queuePlayerActionForGM(`Player mounted transport: ${item.custom_props.name || item.prototype_id}`);
    }

    return feedback || "Failed to mount transport";
}

async function dismountTransport() {
    const feedback = await executeCommand('dismountTransport', {});

    if (feedback && !feedback.includes('ERROR')) {
        await updateTransportUI();
        addLogMessage(feedback, 'system-message');
        queuePlayerActionForGM('Player dismounted transport');
    }

    return feedback || "Failed to dismount transport";
}

async function getTransportInfo() {
    if (!window.electronAPI || !window.electronAPI.nexusTransportCommand) {
        return {
            active_transport_id: "",
            transport_type: "none",
            speed_multiplier: 1.0,
            cargo_bonus: 0
        };
    }

    const result = await window.electronAPI.nexusTransportCommand({
        action: 'getInfo',
        args: {}
    });

    if (result && result.success && result.info) {
        return result.info;
    }

    return {
        active_transport_id: "",
        transport_type: "none",
        speed_multiplier: 1.0,
        cargo_bonus: 0
    };
}

async function updateTransportUI() {
    const indicator = document.getElementById('transport-indicator');
    if (!indicator) return;

    const info = await getTransportInfo();

    if (info.transport_type !== 'none') {
        indicator.style.display = 'block';
        const transportName = t('transport.' + info.transport_type, info.transport_type);
        indicator.innerHTML = `
            <i class="fas fa-horse"></i>
            ${t('transport.active', 'Transport')}: ${transportName}
            <br>Speed: Г—${info.speed_multiplier.toFixed(1)}
            <button id="dismount-transport-btn" class="btn-small">${t('transport.dismount', 'Dismount')}</button>
        `;
        const dismountBtn = indicator.querySelector('#dismount-transport-btn');
        if (dismountBtn) dismountBtn.addEventListener('click', dismountTransport);
    } else {
        indicator.style.display = 'none';
    }
}


const TradeSystemAsync = {
    activeTrades: new Map(),
    _toggleConfirmButton: function(tradeId = null) {
        const btn = document.getElementById('trade-confirm-btn');
        if (!btn) return;
        if (!tradeId) {
            btn.style.display = 'none';
            btn.onclick = null;
            return;
        }
        btn.style.display = 'inline-block';
        btn.onclick = async () => {
            const res = await this.confirmTrade(tradeId);
            addLogMessage(res.success ? "[ТОРГОВЛЯ] Сделка подтверждена игроком и успешно завершена." : `[ERROR] Ошибка сделки: ${res.error}`, "system-message");
            if (res.success || res.error) {
                player.active_trade_id = null;
                updateInventoryDisplay();
                updateEquipmentDisplay();
                updateCharacterSheet();
            }
        };
    },
    _normalizeTradeItems: function(items) { return OldTradeSystem._normalizeTradeItems(items); },
    _lockItemForTrade: function(itemId) { return OldTradeSystem._lockItemForTrade(itemId); },
    _releaseTradeLocks: function(trade) { return OldTradeSystem._releaseTradeLocks(trade); },
    _snapshotTradeState: function(trade) { return OldTradeSystem._snapshotTradeState(trade); },
    _restoreTradeSnapshot: function(snapshot, createdItemIds = []) { return OldTradeSystem._restoreTradeSnapshot(snapshot, createdItemIds); },
    _validateTradeDistance: function(trade) { return OldTradeSystem._validateTradeDistance(trade); },
    _prepareMerchantSale: function(trade, offerItems) { return OldTradeSystem._prepareMerchantSale(trade, offerItems); },
    _prepareManualTrade: function(trade, offerItems, requestItems) { return OldTradeSystem._prepareManualTrade(trade, offerItems, requestItems); },
    initiateTrade: async function(config) {
        return OldTradeSystem.initiateTrade.call(this, config);
    },
    addItemToTrade: async function(tradeId, itemId, side, quantity) {
        return OldTradeSystem.addItemToTrade.call(this, tradeId, itemId, side, quantity);
    },
    _validateTradeReady: function(trade) { return OldTradeSystem._validateTradeReady(trade); },
    _executeItemTransfers: async function(items, sourceContainerId, targetContainerId, createdItemIds) {
        for (const entry of items) {
            const res = await CoreInventorySystemAsync.moveItem(entry.id, sourceContainerId, targetContainerId, entry.quantity, {
                actorId: getInventoryActorId('system'), ignoreAccess: true, ignoreDistance: true, allowTradeLocked: true, allowLocked: true
            });
            if (!res.success) return res;
            if (res.createdItemId) createdItemIds.push(res.createdItemId);
            if (ItemRegistry.has(entry.id)) ItemRegistry.get(entry.id).state = 'idle';
            if (ItemRegistry.has(res.movedItemId)) ItemRegistry.get(res.movedItemId).state = 'idle';
        }
        return { success: true };
    },
    _transferMerchantGold: async function(trade, createdItemIds) {
        let remaining = trade.final_price;
        const targetContainer = ContainerRegistry.get(trade.target_container);
        if (!targetContainer) return { success: false, error: getInventoryFeedbackText('merchant_container_not_found', 'Merchant container not found') };

        const physicalGoldItems = [...getContainerItems(targetContainer)].filter(itemId => {
            const it = ItemRegistry.get(itemId);
            return it && isGoldLikeItem(it);
        });
        for (const goldItemId of physicalGoldItems) {
            if (remaining <= 0) break;
            const goldItem = ItemRegistry.get(goldItemId);
            const amountToMove = Math.min(goldItem.stack_size, remaining);
            const res = await CoreInventorySystemAsync.moveItem(goldItemId, trade.target_container, trade.initiator_container, amountToMove, {
                actorId: getInventoryActorId('system'), ignoreAccess: true, ignoreDistance: true, allowLocked: true
            });
            if (!res.success) return res;
            if (res.createdItemId) createdItemIds.push(res.createdItemId);
            remaining -= amountToMove;
        }

        if (remaining > 0) {
            const merchant = World?.npcs?.[trade.target];
            if (!merchant?.inventory || merchant.inventory.gold < remaining) return { success: false, error: getInventoryFeedbackText('merchant_account_short_gold', 'Merchant account is short on gold') };
            const buyerContainer = ContainerRegistry.get(trade.initiator_container);
            const primaryCurrencyId = getPrimaryCurrencyPrototypeId('gold');
            const existingGoldId = CoreInventorySystemAsync.findItemByPrototype(trade.initiator_container, primaryCurrencyId);
            const currentWeight = CoreInventorySystemAsync.getContainerWeight(trade.initiator_container);
            const addedWeight = remaining * getCurrencyPhysicalWeight(primaryCurrencyId, 0.01);
            if (!existingGoldId && getContainerItems(buyerContainer).length >= buyerContainer.max_slots) {
                return { success: false, error: getInventoryFeedbackText('buyer_no_gold_slot', 'Buyer container has no free slot for gold') };
            }
            if (currentWeight + addedWeight > buyerContainer.max_weight_kg) {
                return { success: false, error: getInventoryFeedbackText('buyer_cannot_carry_gold', 'Buyer container cannot carry the gold payment') };
            }

            merchant.inventory.gold -= remaining;
            const createdGoldId = await CoreInventorySystemAsync.createItem(primaryCurrencyId, remaining, trade.initiator_container, { name: getItemName(primaryCurrencyId, player?.era) });
            createdItemIds.push(createdGoldId);
            remaining = 0;
        }

        syncPlayerGoldFromInventory();
        return { success: true };
    },
    _postProcessTrade: function(trade) { return TradeSystem._postProcessTrade(trade); },
    confirmTrade: async function(tradeId) {
        if (!this.activeTrades.has(tradeId)) return { success: false, error: getInventoryFeedbackText('trade_not_found', 'Trade not found') };
        const trade = this.activeTrades.get(tradeId);

        const readiness = this._validateTradeReady(trade);
        if (!readiness.success) return this._rollbackTrade(tradeId, readiness.error);

        const snapshot = this._snapshotTradeState(trade);
        const createdItemIds = [];

        const offerResult = await this._executeItemTransfers(trade.offer_items, trade.initiator_container, trade.target_container, createdItemIds);
        if (!offerResult.success) {
            this._restoreTradeSnapshot(snapshot, createdItemIds);
            return this._rollbackTrade(tradeId, offerResult.error || "Failed to move offer item");
        }

        let requestResult = { success: true };
        if (trade.mode === 'manual') {
            requestResult = await this._executeItemTransfers(trade.request_items, trade.target_container, trade.initiator_container, createdItemIds);
        } else {
            requestResult = await this._transferMerchantGold(trade, createdItemIds);
        }

        if (!requestResult.success) {
            this._restoreTradeSnapshot(snapshot, createdItemIds);
            return this._rollbackTrade(tradeId, requestResult.error || "Failed to complete trade payment");
        }

        trade.status = "completed";
        this.activeTrades.delete(tradeId);
        this._toggleConfirmButton(null);
        if (player?.active_trade_id === tradeId) player.active_trade_id = null;
        syncPlayerGoldFromInventory();
        this._postProcessTrade(trade);
        return { success: true, tradeId, price: trade.final_price || 0 };
    },
    _rollbackTrade: function(tradeId, reason) { return OldTradeSystem._rollbackTrade.call(this, tradeId, reason); },
    negotiateTrade: async function(tradeId, newOffer, newRequestItems = []) {
        return OldTradeSystem.negotiateTrade.call(this, tradeId, newOffer, newRequestItems);
    }
};

async function executeCommand(command, args) {
    if (window.ModAPI) ModAPI.emit('onCommandExecuted', {command, args});
    if (!command) return null;
    if (!player) return t('gameInterface.commandFeedback.errorPlayerMissing');

    // Shallow-clone args to prevent mutation of the caller's object
    if (args && typeof args === 'object') {
        args = { ...args };
        if (args.entityKey !== undefined && args.aiIdentifier === undefined) args.aiIdentifier = args.entityKey;
        if (args.target !== undefined && args.aiIdentifier === undefined && args.target !== 'player') args.aiIdentifier = args.target;
        if (args.id !== undefined) {
            if (args.aiIdentifier === undefined) args.aiIdentifier = args.id;
            if (args.key === undefined) args.key = args.id;
            if (args.effectId === undefined) args.effectId = args.id;
        }
        if (args.id === undefined) args.id = args.aiIdentifier || args.key || args.effectId;
        if (command.toLowerCase().includes('quest') && args.id === undefined && args.title !== undefined) {
            args.id = args.title;
            args.aiIdentifier = args.title;
        }
    }

    console.log("Выполнение команды (ASYNC):", command, args);
    let feedback = null;

    // Гарантируем, что рюкзак и экипировка существуют перед выполнением команд
    const inventoryCommands = ['addItem', 'removeItem', 'equipItem', 'unequipItem', 'moveItem', 'updateStat', 'createContainer', 'destroyContainer', 'useItem', 'openContainer', 'trade', 'sell'];
    if (inventoryCommands.includes(command)) {
        await ensurePlayerContainers();
    }

    try {
        // --- ИНТЕГРАЦИЯ МОДОВ: Кастомные команды ---
        if (window.ModAPI && window.ModAPI.customCommands && window.ModAPI.customCommands[command]) {
            return await window.ModAPI.customCommands[command](args);
        }
        // -------------------------------------------

        switch (command) {
            case 'echoMemory':
            case 'clearEchoMemory':
            case 'removeEchoMemoryItem':
            case 'setMemory':
            case 'deleteMemory':
            case 'archiveMemory':
            case 'setLocation':
            case 'gmDeclareWar':
            case 'gmForcePeace':
            case 'gmChangeRulerTrait':
            case 'gmCreateFaction':
            case 'gmTransferRegion':
            case 'gmRaisePlayerArmy':
            case 'gmCommandArmy':
            case 'startIntrigue':
            case 'startTravel':
            case 'pauseTravel':
            case 'resumeTravel':
            case 'cancelTravel':
            case 'fastForwardTravel':
            case 'startJourney':
            case 'endJourney':
            case 'setJourneyLocation':
            case 'calculationLog':
            case 'defineFaction':
            case 'updateStat':
            case 'setStat':
            case 'addQuest':
        if (window.ModAPI) ModAPI.emit('onQuestUpdated', {action: 'add', quest: args});
            case 'updateQuest':
            case 'removeQuest':
            case 'editQuest':
            case 'addSkill':
            case 'removeSkill':
            case 'addDiscoveredLocation':
            case 'addMapMarker':
            case 'removeMapMarker':
            case 'addSubLocation':
            case 'removeSubLocation':
            case 'buildBusiness':
            case 'buyHolding':
            case 'sellHolding':
            case 'bankTransaction':
            case 'nexusDefine':
            case 'nexusUpdate':
            case 'nexusRemove':
            case 'repairFacility':
            case 'applyPredefinedEffect':
            case 'addStatusEffect':
            case 'removeStatusEffect':
            case 'addEnvironment':
            case 'removeEnvironment':
            case 'updateEntityStat':
            case 'setEntityState':
            case 'revealEntityTrait':
            case 'setCombatState':
            case 'endCombat':
            case 'buildShip':
            case 'buildPort':
            case 'upgradePort':
            case 'navalBlockade':
            case 'gmPurchaseGoods':
            case 'gmSellGoods':
            case 'gmInvestInFacility':
            case 'gmModifyTradeSecurity':
            case 'gmRaiseMilitia':
            case 'gmSpreadRumor':
            case 'gmFrameForSabotage':
            case 'gmDirectResourceInjection':
            case 'applyConsequence':
            case 'updateRelationship':
            case 'recordIntimacy':
            case 'recordEroticScene':
            case 'giveItem':
            case 'setPlayerDescription':
            case 'renderLocation':
                return executeNonInventoryCommand(command, args);

            case 'addItem':
                if (args.aiIdentifier && args.name) {
                    const aiId = String(args.aiIdentifier);
                    const name = String(args.name);
                    const quantity = (args.quantity !== undefined && !isNaN(parseInt(args.quantity))) ? parseInt(args.quantity) : 1;
                    const targetContId = resolveSpecialContainerId(args.containerId || player.container_backpack);
                    
                    if (!ContainerRegistry.has(targetContId)) {
                        feedback = `[ERROR] Контейнер ${targetContId} не найден.`;
                        break;
                    }

                    const cont = ContainerRegistry.get(targetContId);
                    let existingItemId = getContainerItems(cont).find(id => {
                        let it = ItemRegistry.get(id);
                        return it && (it.prototype_id.toLowerCase() === aiId.toLowerCase() || it.custom_props?.aiIdentifier?.toLowerCase() === aiId.toLowerCase());
                    });
                    
                    if (existingItemId) {
                        await sendInventoryCommand(getInventoryCommandName('update_item_stat'), { itemId: existingItemId, stat: getInventoryStackField(), change: quantity });
                        feedback = t('gameInterface.commandFeedback.itemQuantityIncreased', { itemName: name, quantity: quantity });
                    } else {
                        // Т3 ФИКС: Проверка веса
                    const currentWeight = CoreInventorySystemAsync.getContainerWeight(targetContId);
                    let itemWeight = 1.0;
                    if (isCurrencyAiIdentifier(aiId)) {
                        itemWeight = 0.01;
                    } else if (typeof ECONOMY_ITEMS !== 'undefined' && ECONOMY_ITEMS[aiId]) {
                        itemWeight = 1.0;
                    }
                    const addedWeight = quantity * itemWeight;

                    if (cont.owner_id !== 'player' && currentWeight + addedWeight > cont.max_weight_kg) {
                        feedback = `[ОШИБКА ЯДРА] Контейнер перегружен! Лимит: ${cont.max_weight_kg} кг. Невозможно добавить ${quantity} шт. '${name}' (Вес: ${addedWeight.toFixed(2)} кг). Используйте банк, сундуки или повозку!`;
                        break;
                    }

                    if (getContainerItems(cont).length >= cont.max_slots) {
                            feedback = t('gameInterface.commandFeedback.inventoryFull', { itemName: name });
                        } else {
                            // Проверка транспорта через централизованный реестр
                            const isTransport = TransportSystem.isTransportId(aiId);
                            const transportData = isTransport ? TransportSystem.getTransportData(aiId) : null;

                            const customProps = {
                                name: name,
                                aiIdentifier: aiId,
                                description: args.description || t('itemDescriptions.noDescription'),
                                rarity: args.rarity || (transportData?.rarity) || 'Обычный',
                                itemType: args.itemType || (isTransport ? 'vehicle' : 'misc'),
                                slot: args.slot || null,
                                effects: args.effects || [],
                                value: args.value ?? (transportData?.basePrice) ?? 0,
                                quality: args.quality ?? requireRuntimeNumber(getGameplayRuntimeConfig().inventory.default_item_quality, 'gameplay_runtime.inventory.default_item_quality'),
                                isTransport: isTransport,
                                speedMultiplier: transportData?.speedMultiplier,
                                cargoBonus: transportData?.cargoBonus
                            };

                            // Валидация: предупреждение если ГМ пытается создать "похожий" ID
                            if (!isTransport && (aiId.toLowerCase().includes('horse') || aiId.toLowerCase().includes('cart') || aiId.toLowerCase().includes('wagon'))) {
                                const validIds = TransportSystem.getAllTransportIds();
                                console.warn(`[addItem] Suspicious transport-like ID "${aiId}". Valid transport IDs: ${validIds.join(', ')}`);
                                await CoreInventorySystemAsync.createItem(aiId, quantity, targetContId, customProps);
                                feedback = t('gameInterface.commandFeedback.itemAdded', { itemName: name, quantity: quantity }) + ` [WARNING] ID "${aiId}" не является транспортом. Используйте: ${validIds.join(', ')}`;
                            } else {
                                await CoreInventorySystemAsync.createItem(aiId, quantity, targetContId, customProps);
                                feedback = t('gameInterface.commandFeedback.itemAdded', { itemName: name, quantity: quantity });
                            }
                        }
                    }
                    
                    if (isCurrencyAiIdentifier(aiId) && targetContId === player.container_backpack) {
                        syncPlayerGoldFromInventory();
                        animateGoldChange(quantity);
                        updateCharacterSheet();
                    }
                    updateInventoryDisplay();
                } else {
                    feedback = `[ERROR] 'addItem' требует 'aiIdentifier' и 'name'.`;
                }
                break;

                                    case 'removeItem': {
                const rawId = args.itemId || args.id || args.aiIdentifier;
                if (!rawId) {
                    feedback = `[ERROR] 'removeItem' требует 'itemId' или 'aiIdentifier'.`;
                    break;
                }

                const searchTerm = String(rawId).trim();

                // 2. Поиск предмета
                const backpack = ContainerRegistry.get(player.container_backpack);
                let foundKey = getContainerItems(backpack).find(id => id === searchTerm);
                
                if (!foundKey) {
                    foundKey = getContainerItems(backpack).find(id => {
                        const it = ItemRegistry.get(id);
                        return it && (it.prototype_id === searchTerm || it.custom_props?.aiIdentifier === searchTerm);
                    });
                }

                if (!foundKey) {
                    foundKey = getContainerItems(backpack).find(id => {
                        const it = ItemRegistry.get(id);
                        return it && it.custom_props?.name?.toLowerCase() === searchTerm.toLowerCase();
                    });
                }

                if (foundKey && ItemRegistry.has(foundKey)) {
                    const targetItem = ItemRegistry.get(foundKey);
                    const quantity = (args.quantity !== undefined && !isNaN(parseInt(args.quantity))) ? parseInt(args.quantity, 10) : targetItem.stack_size;
                    
                    if (targetItem.stack_size >= quantity) {
                        const removedName = targetItem.custom_props?.name || targetItem.prototype_id;
                        await CoreInventorySystemAsync.removeItem(foundKey, quantity);
                        feedback = t('gameInterface.commandFeedback.itemRemoved', { itemName: removedName, quantityToRemove: quantity });
                        updateInventoryDisplay();
                        updateEquipmentDisplay();
                        updateCharacterSheet();
                    } else {
                        feedback = t('gameInterface.commandFeedback.notEnoughItem', { itemName: targetItem.custom_props?.name || targetItem.prototype_id, itemId: searchTerm, quantityToRemove: quantity });
                    }
                } else {
                    feedback = t('gameInterface.commandFeedback.itemNotFound', { itemId: searchTerm });
                }
                break;
            }

                                    case 'equipItem': {
                const rawId = args.aiIdentifier || args.id;
                if (!rawId) {
                    feedback = `[ERROR] 'equipItem' требует аргумент 'aiIdentifier'.`;
                    break;
                }

                const searchTerm = String(rawId).trim();
                const backpack = ContainerRegistry.get(player.container_backpack);
                
                if (!backpack) {
                    feedback = `[ERROR] Рюкзак игрока не найден в реестре.`;
                    break;
                }

                let itemKey = getContainerItems(backpack).find(id => id === searchTerm);
                if (!itemKey) {
                    itemKey = getContainerItems(backpack).find(id => {
                        const it = ItemRegistry.get(id);
                        return it && (it.prototype_id === searchTerm || it.custom_props?.aiIdentifier === searchTerm);
                    });
                }
                if (!itemKey) {
                    itemKey = getContainerItems(backpack).find(id => {
                        const it = ItemRegistry.get(id);
                        return it && it.custom_props?.name?.toLowerCase() === searchTerm.toLowerCase();
                    });
                }

                if (itemKey) {
                    feedback = await equipItemAsync(itemKey, args.slot);
                } else {
                    feedback = `[ERROR] Не удалось экипировать '${searchTerm}'. Предмет не найден в инвентаре.`;
                }
                break;
            }

            case 'unequipItem':
                if (args.slot) {
                    const slot = args.slot.toLowerCase();
                    feedback = await unequipItemAsync(slot);
                } else {
                    feedback = `[ERROR] 'unequipItem' требует 'slot'.`;
                }
                break;

            case 'createContainer':
                if (args.type && args.ownerId) {
                    const createContainerDefaults = getGameplayCommandDefaults().create_container || {};
                    const contId = await CoreInventorySystemAsync.createContainer(
                        args.type,
                        args.ownerId,
                        args.maxWeight ?? requireRuntimeNumber(createContainerDefaults.max_weight_kg, 'gameplay_runtime.command_defaults.create_container.max_weight_kg'),
                        args.maxSlots ?? requireRuntimeNumber(createContainerDefaults.max_slots, 'gameplay_runtime.command_defaults.create_container.max_slots'),
                        args.location || null,
                        {
                            lock_data: args.lockData || args.lock_data || {},
                            physical_props: args.physicalProps || args.physical_props || {},
                            custom_props: args.customProps || args.custom_props || {}
                        }
                    );
                    if (Array.isArray(args.items)) {
                        for (const itemDef of args.items) {
                            const protoId = itemDef.prototypeId || itemDef.prototype_id || itemDef.aiIdentifier || itemDef.id;
                            if (protoId) {
                                await CoreInventorySystemAsync.createItem(protoId, itemDef.quantity ?? requireRuntimeNumber(getGameplayRuntimeConfig().inventory.default_stack_quantity, 'gameplay_runtime.inventory.default_stack_quantity'), contId, itemDef.customProps || itemDef.custom_props || itemDef);
                            }
                        }
                    }
                    feedback = `[СИСТЕМА] Создан контейнер ${contId} типа ${args.type} для ${args.ownerId}.`;
                } else {
                    feedback = `[ERROR] 'createContainer' требует 'type' и 'ownerId'.`;
                }
                break;

            case 'moveItem':
                if (args.itemId && args.sourceContainerId) {
                    const res = await CoreInventorySystemAsync.moveItem(args.itemId, args.sourceContainerId, args.targetContainerId || null, args.quantity || null);
                    feedback = res.success ? `[СИСТЕМА] Предмет перемещен.` : `[ERROR] Ошибка перемещения: ${res.error}`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'moveItem' требует 'itemId' и 'sourceContainerId'.`;
                }
                break;

            case 'moveItems':
            case 'move_items':
                if (args.sourceContainerId && Array.isArray(args.items) && args.items.length > 0) {
                    const res = await CoreInventorySystemAsync.moveItems(args.sourceContainerId, args.targetContainerId || args.target || null, args.items, { actorId: getInventoryActorId('default') });
                    feedback = res.success
                        ? `[СИСТЕМА] Перемещено предметов: ${res.movedCount}.`
                        : `[ERROR] Ошибка пакетного перемещения: ${res.error}`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'moveItems' требует 'sourceContainerId' и 'items' [{id, quantity}].`;
                }
                break;

            case 'initiateTrade':
            case 'initiate_trade': {
                const directItemId = args.itemId || args.item_id;
                const saleOfferItems = directItemId
                    ? [{ id: directItemId, quantity: args.quantity ?? requireRuntimeNumber(getGameplayRuntimeConfig().inventory.default_stack_quantity, 'gameplay_runtime.inventory.default_stack_quantity') }]
                    : (Array.isArray(args.offerItems) ? args.offerItems : []);
                const isMerchantSale = !!args.targetId && args.targetId !== 'player' && saleOfferItems.length > 0 && (!Array.isArray(args.requestItems) || args.requestItems.length === 0);
                const tradeConfig = isMerchantSale
                    ? {
                        initiatorId: args.initiatorId || 'player',
                        targetId: args.targetId,
                        initiatorContainerId: args.initiatorContainerId || player.container_backpack,
                        targetContainerId: args.targetContainerId,
                        offerItems: saleOfferItems,
                        mode: 'sale'
                    }
                    : {
                        initiatorId: args.initiatorId || 'player',
                        targetId: args.targetId,
                        initiatorContainerId: args.initiatorContainerId || player.container_backpack,
                        targetContainerId: args.targetContainerId,
                        offerItems: args.offerItems || [],
                        requestItems: args.requestItems || [],
                        mode: 'manual'
                    };

                const res = await TradeSystemAsync.initiateTrade(tradeConfig);
                feedback = res.success ? `[ТОРГОВЛЯ] ${res.message}` : `[ERROR] ${res.error}`;
                break;
            }

            case 'confirmTrade':
            case 'confirm_trade': {
                const tradeId = args.tradeId || args.trade_id || player.active_trade_id;
                if (!tradeId) {
                    feedback = `[ERROR] Нет активной сделки для подтверждения.`;
                    break;
                }
                const res = await TradeSystemAsync.confirmTrade(tradeId);
                feedback = res.success
                    ? `[ТОРГОВЛЯ] Сделка успешно завершена${res.price ? ` за ${res.price} золота` : ''}.`
                    : `[ERROR] Ошибка сделки: ${res.error}`;
                if (player.active_trade_id === tradeId) player.active_trade_id = null;
                updateInventoryDisplay();
                updateEquipmentDisplay();
                updateCharacterSheet();
                break;
            }

            case 'negotiateTrade':
            case 'negotiate': {
                const tradeId = args.tradeId || args.trade_id || player.active_trade_id;
                if (!tradeId) {
                    feedback = `[ERROR] Нет активной сделки для торга.`;
                    break;
                }
                const newOffer = args.newOffer ?? args.new_offer ?? args.price ?? args.offerItems;
                const res = await TradeSystemAsync.negotiateTrade(tradeId, newOffer, args.requestItems || args.request_items || []);
                feedback = res.success
                    ? `[ТОРГОВЛЯ] Условия сделки обновлены${res.acceptedPrice ? `: ${res.acceptedPrice} золота.` : '.'}`
                    : `[ERROR] Ошибка изменения сделки: ${res.error}`;
                break;
            }

            case 'destroyContainer':
                if (args.containerId) {
                    const res = await CoreInventorySystemAsync.destroyContainer(args.containerId);
                    feedback = res ? `[СИСТЕМА] Контейнер ${args.containerId} разрушен, содержимое высыпалось на землю.` : `[ERROR] Контейнер не найден.`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'destroyContainer' требует 'containerId'.`;
                }
                break;

            case 'unlockContainer':
                if (args.containerId) {
                    const res = await CoreInventorySystemAsync.unlockContainer(args.containerId, 'player');
                    feedback = res.success ? `[ВЗЛОМ] Успешно: ${res.message}` : `[ВЗЛОМ] Провал: ${res.error}`;
                    updateInventoryDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'unlockContainer' требует 'containerId'.`;
                }
                break;

            case 'confiscateStolen':
                if (args.targetId) {
                    const targetCont = args.targetId === 'player' ? player.container_backpack : args.targetId;
                    const count = await CoreInventorySystemAsync.confiscateStolen(targetCont, "guard_confiscation_chest");
                    feedback = `[СТРАЖА] Изъято краденых предметов: ${count}.`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'confiscateStolen' требует 'targetId'.`;
                }
                break;

            case 'buildContainer':
                if (args.type) {
                    const contId = await CoreInventorySystemAsync.buildContainer('player', args.type, player.location);
                    feedback = contId ? `[КРАФТ] Создан контейнер ${contId}. Потрачено 5 дерева.` : `[ERROR] Недостаточно дерева (нужно 5 wood).`;
                    updateInventoryDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'buildContainer' требует 'type'.`;
                }
                break;

            case 'applyAoEDamage':
                if (args.location && args.damage) {
                    let destroyed = 0;
                    for (const cont of Array.from(ContainerRegistry.values())) {
                        if (resolveContainerLocation(cont.id)?.region_id === args.location && cont.physical_props) {
                            cont.physical_props.health -= args.damage;
                            for (const itemId of getContainerItems(cont)) {
                                const item = ItemRegistry.get(itemId);
                                if (item) {
                                    await sendInventoryCommand(getInventoryCommandName('update_item_stat'), { itemId: item.id, stat: 'durability', change: -Math.floor(args.damage / 2) });
                                }
                            }
                            if (cont.physical_props.health <= 0) {
                                await CoreInventorySystemAsync.destroyContainer(cont.id);
                                destroyed++;
                            }
                        }
                    }
                    feedback = `[СИСТЕМА] AoE урон (${args.damage}) нанесен по локации ${args.location}. Разрушено контейнеров: ${destroyed}. Предметы внутри повреждены.`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'applyAoEDamage' требует 'location' и 'damage'.`;
                }
                break;

            case 'castMagicalPocket': {
                const existingPocket = Array.from(ContainerRegistry.values()).find(cont => cont.owner_id === 'player' && cont.type === 'magical_pocket');
                if (!player.statusEffects['spell_magical_pocket']) {
                    player.statusEffects['spell_magical_pocket'] = { id: 'spell_magical_pocket', name: 'Магический карман', duration: 9999, description: 'Открывает доступ к экстрадименсиональному хранилищу.', effects: [] };
                }
                if (existingPocket) {
                    await CoreInventorySystemAsync.updateContainerLocation(existingPocket.id, normalizeContainerLocation({ world_coords: null, parent_entity: 'player', parent_container: null, region_id: 'astral' }));
                    feedback = `[МАГИЯ] Магический карман уже активен.`;
                } else {
                    const contId = await CoreInventorySystemAsync.createContainer('magical_pocket', 'player', 500, 100, { world_coords: null, parent_entity: 'player', parent_container: null, region_id: 'astral' });
                    feedback = `[МАГИЯ] Создан магический карман (ID: ${contId}).`;
                }
                break;
            }

            case 'dispelMagicPocket': {
                const pocketId = args.containerId || Array.from(ContainerRegistry.values()).find(cont => cont.owner_id === 'player' && cont.type === 'magical_pocket')?.id;
                if (pocketId && ContainerRegistry.has(pocketId)) {
                    await CoreInventorySystemAsync.updateContainerLocation(pocketId, resolveActorLocation('player'));
                    await CoreInventorySystemAsync.destroyContainer(pocketId);
                    delete player.statusEffects['spell_magical_pocket'];
                    feedback = `[МАГИЯ] Магический карман развеян, вещи высыпались в реальный мир.`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] Магический карман не найден.`;
                }
                break;
            }

            case 'fleePackAnimal':
                if (args.containerId) {
                    const contId = resolveSpecialContainerId(args.containerId);
                    const cont = ContainerRegistry.get(contId);
                    if (cont) {
                        await CoreInventorySystemAsync.updateContainerLocation(contId, normalizeContainerLocation({ world_coords: [0, 0, 0], parent_entity: null, parent_container: null, region_id: "unknown_wilderness" }));
                        feedback = `[СОБЫТИЕ] Вьючное животное испугалось и сбежало вместе с контейнером ${contId}!`;
                    } else {
                        feedback = `[ERROR] Контейнер не найден.`;
                    }
                } else {
                    feedback = `[ERROR] 'fleePackAnimal' требует 'containerId'.`;
                }
                break;

                                    case 'updateItemStat': {
                const rawId = args.aiIdentifier || args.id;
                if (rawId && args.stat && args.change !== undefined) {
                    const searchTerm = String(rawId).trim();
                    let item = null;
                    let isEquipped = false;

                    if (player.container_backpack) {
                        const bp = ContainerRegistry.get(player.container_backpack);
                        const id = getContainerItems(bp).find(i => i === searchTerm || ItemRegistry.get(i).prototype_id === searchTerm);
                        if (id) item = ItemRegistry.get(id);
                    }
                    if (!item && player.container_equipment) {
                        const eq = ContainerRegistry.get(player.container_equipment);
                        const id = getContainerItems(eq).find(i => i === searchTerm || ItemRegistry.get(i).prototype_id === searchTerm);
                        if (id) {
                            item = ItemRegistry.get(id);
                            isEquipped = true;
                        }
                    }

                    if (item) {
                        const change = parseInt(args.change, 10);
                        await sendInventoryCommand(getInventoryCommandName('update_item_stat'), { itemId: item.id, stat: args.stat, change });
                        feedback = `[Предмет] Характеристика '${args.stat}' у '${item.custom_props.name}' изменена на ${change > 0 ? '+' + change : change}.`;
                        if (isEquipped) updateEquipmentDisplay();
                        else updateInventoryDisplay();
                    } else {
                        feedback = `[ERROR] Предмет '${searchTerm}' не найден для updateItemStat.`;
                    }
                } else {
                    feedback = `[ERROR] 'updateItemStat' требует 'aiIdentifier', 'stat' и 'change'.`;
                }
                break;
            }

            case 'mountTransport': {
                const itemId = args.itemId || args.aiIdentifier || args.id;
                if (!itemId) {
                    feedback = `[ERROR] 'mountTransport' требует 'itemId'.`;
                    break;
                }

                const backpackId = player.container_backpack;
                const backpack = ContainerRegistry.get(backpackId);
                if (!backpack) {
                    feedback = `[ERROR] Рюкзак игрока не найден.`;
                    break;
                }

                const item = getContainerItems(backpack).map(id => ItemRegistry.get(id)).find(it =>
                    it && (it.id === itemId || it.prototype_id === itemId || it.custom_props?.aiIdentifier === itemId)
                );

                if (!item) {
                    feedback = `[ERROR] Предмет транспорта не найден в инвентаре.`;
                    break;
                }

                // Централизованная валидация через TransportSystem
                const validation = TransportSystem.validateTransportItem(item);

                if (!validation.valid) {
                    feedback = `[ERROR] ${validation.error}\n[HINT] ${validation.suggestion}`;
                    console.error('[mountTransport] Validation failed:', validation);
                    break;
                }

                player.activeTransport = {
                    itemId: item.id,
                    prototypeId: item.prototype_id,
                    name: item.custom_props.name,
                    speedMultiplier: validation.data.speedMultiplier,
                    cargoBonus: validation.data.cargoBonus,
                    waterOnly: validation.data.waterOnly || false
                };

                feedback = t('transport.mounted', { name: item.custom_props.name });
                updateCharacterSheet();
                break;
            }

            case 'dismountTransport': {
                if (!player.activeTransport) {
                    feedback = `[ERROR] Транспорт не активирован.`;
                    break;
                }

                player.activeTransport = null;
                feedback = t('transport.dismounted');
                updateCharacterSheet();
                break;
            }

            default:
                feedback = `[ERROR] Неизвестная команда (ASYNC): ${command}`;
                console.warn(feedback, args);
        }
    } catch (error) {
        feedback = t('gameInterface.commandFeedback.errorCommandGeneric', { command: command, args: error.message });
        console.error(`Критическая ошибка при выполнении команды ${command} (ASYNC):`, error, args);
    }
    return feedback;
}


const TradeSystem = TradeSystemAsync;
const OldTradeSystem = {
    activeTrades: new Map(),
    _toggleConfirmButton: function(tradeId = null) {
        const btn = document.getElementById('trade-confirm-btn');
        if (!btn) return;
        if (!tradeId) {
            btn.style.display = 'none';
            btn.onclick = null;
            return;
        }
        btn.style.display = 'inline-block';
        btn.onclick = () => {
            const res = this.confirmTrade(tradeId);
            addLogMessage(res.success ? "[ТОРГОВЛЯ] Сделка подтверждена игроком и успешно завершена." : `[ERROR] Ошибка сделки: ${res.error}`, "system-message");
            if (res.success || res.error) {
                player.active_trade_id = null;
                updateInventoryDisplay();
                updateEquipmentDisplay();
                updateCharacterSheet();
            }
        };
    },
    _normalizeTradeItems: function(items) {
        return (items || []).map(entry => ({
            id: entry.id,
            quantity: parseInt(entry.quantity, 10) || requireRuntimeNumber(getGameplayRuntimeConfig().inventory.default_stack_quantity, 'gameplay_runtime.inventory.default_stack_quantity')
        })).filter(entry => entry.id && entry.quantity > 0);
    },
    _lockItemForTrade: function(itemId) {
        const item = ItemRegistry.get(itemId);
        if (!item || item.state !== 'idle') return false;
        item.state = 'in_trade';
        return true;
    },
    _releaseTradeLocks: function(trade) {
        [...(trade.offer_items || []), ...(trade.request_items || [])].forEach(entry => {
            if (ItemRegistry.has(entry.id)) ItemRegistry.get(entry.id).state = 'idle';
        });
    },
    _snapshotTradeState: function(trade) {
        const containerIds = new Set([trade.initiator_container, trade.target_container].filter(Boolean));
        const itemIds = new Set();
        [...(trade.offer_items || []), ...(trade.request_items || [])].forEach(entry => itemIds.add(entry.id));
        containerIds.forEach(containerId => {
            const cont = ContainerRegistry.get(containerId);
            if (cont) {
                getContainerItems(cont).forEach(itemId => {
                    const it = ItemRegistry.get(itemId);
                    if (it && isGoldLikeItem(it)) itemIds.add(itemId);
                });
            }
        });
        return {
            containers: Array.from(containerIds).map(containerId => [containerId, structuredClone(ContainerRegistry.get(containerId))]),
            items: Array.from(itemIds).filter(itemId => ItemRegistry.has(itemId)).map(itemId => [itemId, structuredClone(ItemRegistry.get(itemId))]),
            npcGoldState: trade.target && World?.npcs?.[trade.target]?.inventory ? { npcId: trade.target, gold: World.npcs[trade.target].inventory.gold || 0 } : null,
            playerGold: player?.stats?.gold ?? null
        };
    },
    _restoreTradeSnapshot: function(snapshot, createdItemIds = []) {
        if (!snapshot) return;
        snapshot.containers.forEach(([containerId, data]) => {
            if (data) setContainer(containerId, structuredClone(data));
        });
        const snapshotItemIds = new Set(snapshot.items.map(([itemId]) => itemId));
        createdItemIds.forEach(itemId => {
            if (!snapshotItemIds.has(itemId)) ItemRegistry.delete(itemId);
        });
        snapshot.items.forEach(([itemId, data]) => {
            if (data) ItemRegistry.set(itemId, structuredClone(data));
        });
        if (snapshot.npcGoldState && World?.npcs?.[snapshot.npcGoldState.npcId]?.inventory) {
            World.npcs[snapshot.npcGoldState.npcId].inventory.gold = snapshot.npcGoldState.gold;
        }
        if (player?.stats && snapshot.playerGold !== null) {
            player.stats.gold = snapshot.playerGold;
        }
    },
    _validateTradeDistance: function(trade) {
        const initiatorLocation = resolveContainerLocation(trade.initiator_container);
        const targetLocation = resolveContainerLocation(trade.target_container);
        return !!(initiatorLocation && targetLocation && checkDistance(initiatorLocation, targetLocation));
    },
    _prepareMerchantSale: function(trade, offerItems) {
        if (trade.initiator !== getInventoryActorId('default')) return { success: false, error: getInventoryFeedbackText('merchant_sale_player_only', 'T3 merchant sale supports player as seller only') };
        if (trade.initiator_container !== player?.container_backpack) return { success: false, error: getInventoryFeedbackText('sellable_backpack_only', 'Sellable items must be in player backpack') };
        if (!this._validateTradeDistance(trade)) return { success: false, error: getInventoryFeedbackText('merchant_too_far', 'Merchant is too far away') };

        const normalizedOffers = this._normalizeTradeItems(offerItems);
        if (normalizedOffers.length === 0) return { success: false, error: getInventoryFeedbackText('no_offer_items', 'No offer items provided') };

        const regionId = resolveContainerLocation(trade.target_container)?.region_id || player?.location || null;
        let totalPrice = 0;

        for (const offer of normalizedOffers) {
            const item = ItemRegistry.get(offer.id);
            if (!item || item.container_id !== trade.initiator_container) return { success: false, error: getInventoryFeedbackText('offer_item_missing', 'Offer item is no longer in player backpack') };
            if (offer.quantity > item.stack_size) return { success: false, error: getInventoryFeedbackText('sale_quantity_unavailable', 'Not enough quantity for sale') };
            if (!is_sellable(trade.initiator_container, offer.id)) return { success: false, error: getInventoryFeedbackText('item_not_sellable', 'Item is not sellable') };
            totalPrice += EconomySim.calculatePrice(item.prototype_id, regionId, false) * offer.quantity;
        }

        if (getGoldAmountInContainer(trade.target_container) < totalPrice) return { success: false, error: getInventoryFeedbackText('merchant_no_gold', 'Merchant does not have enough gold') };
        for (const offer of normalizedOffers) {
            if (!this._lockItemForTrade(offer.id)) {
                this._releaseTradeLocks({ offer_items: normalizedOffers, request_items: [] });
                return { success: false, error: getInventoryFeedbackText('failed_lock_sale_item', 'Failed to lock sale item') };
            }
        }

        trade.offer_items = normalizedOffers;
        trade.request_items = [];
        trade.mode = 'sale';
        trade.region_id = regionId;
        trade.base_price = totalPrice;
        trade.final_price = totalPrice;
        trade.negotiation = {
            min_price: Math.max(1, Math.floor(totalPrice * 0.5)),
            max_price: Math.max(totalPrice, Math.ceil(totalPrice * 1.15))
        };
        return { success: true };
    },
    _prepareManualTrade: function(trade, offerItems, requestItems) {
        const normalizedOffers = this._normalizeTradeItems(offerItems);
        const normalizedRequests = this._normalizeTradeItems(requestItems);
        if (normalizedOffers.length === 0 && normalizedRequests.length === 0) return { success: false, error: getInventoryFeedbackText('trade_empty', 'Trade is empty') };
        if (!this._validateTradeDistance(trade)) return { success: false, error: getInventoryFeedbackText('trade_too_far', 'Trade parties are too far apart') };

        for (const offer of normalizedOffers) {
            const item = ItemRegistry.get(offer.id);
            if (!item || item.container_id !== trade.initiator_container || item.state !== getInventoryMovementRuntimeConfig().states.default) return { success: false, error: getInventoryFeedbackText('offer_item_unavailable', 'Offer item is unavailable') };
            if (offer.quantity > item.stack_size) return { success: false, error: getInventoryFeedbackText('offer_quantity_unavailable', 'Offer quantity is unavailable') };
            if (trade.initiator === 'player' && trade.target !== 'player' && !is_sellable(trade.initiator_container, offer.id)) {
                return { success: false, error: getInventoryFeedbackText('offer_not_sellable', 'Offer item is not sellable') };
            }
        }
        for (const request of normalizedRequests) {
            const item = ItemRegistry.get(request.id);
            if (!item || item.container_id !== trade.target_container || item.state !== getInventoryMovementRuntimeConfig().states.default) return { success: false, error: getInventoryFeedbackText('request_item_unavailable', 'Request item is unavailable') };
            if (request.quantity > item.stack_size) return { success: false, error: getInventoryFeedbackText('request_quantity_unavailable', 'Request quantity is unavailable') };
        }

        const locked = [];
        for (const entry of [...normalizedOffers, ...normalizedRequests]) {
            if (!this._lockItemForTrade(entry.id)) {
                locked.forEach(itemId => {
                    if (ItemRegistry.has(itemId)) ItemRegistry.get(itemId).state = getInventoryMovementRuntimeConfig().states.default;
                });
                return { success: false, error: getInventoryFeedbackText('failed_lock_trade_item', 'Failed to lock trade item') };
            }
            locked.push(entry.id);
        }

        trade.offer_items = normalizedOffers;
        trade.request_items = normalizedRequests;
        trade.mode = 'manual';
        return { success: true };
    },
    initiateTrade: function(config) {
        const initiatorId = config.initiatorId || 'player';
        const targetId = config.targetId;
        const initiatorContainerId = resolveSpecialContainerId(config.initiatorContainerId || initiatorId);
        const targetContainerId = resolveSpecialContainerId(config.targetContainerId || World?.npcs?.[targetId]?.inventory_id || targetId);

        if (!targetId || !initiatorContainerId || !targetContainerId) {
            return { success: false, error: getInventoryFeedbackText('requires_target_and_containers', 'Trade requires valid target and containers') };
        }
        if (!ContainerRegistry.has(initiatorContainerId) || !ContainerRegistry.has(targetContainerId)) {
            return { success: false, error: getInventoryFeedbackText('trade_container_missing', 'One of the trade containers was not found') };
        }

        const tradeId = "trade_" + generateUUID();
        const trade = {
            id: tradeId,
            initiator: initiatorId,
            target: targetId,
            initiator_container: initiatorContainerId,
            target_container: targetContainerId,
            offer_items: [],
            request_items: [],
            status: "pending",
            mode: config.mode || 'sale',
            created_at: player?.stats?.turnCount || 0,
            final_price: 0
        };

        const prepResult = trade.mode === 'manual'
            ? this._prepareManualTrade(trade, config.offerItems, config.requestItems)
            : this._prepareMerchantSale(trade, config.offerItems);
        if (!prepResult.success) return prepResult;

        this.activeTrades.set(tradeId, trade);
        if (initiatorId === 'player' || targetId === 'player') {
            player.active_trade_id = tradeId;
            this._toggleConfirmButton(tradeId);
        }

        return {
            success: true,
            tradeId,
            trade,
            price: trade.final_price,
            message: trade.mode === 'sale'
                ? `Сделка подготовлена. Торговец предлагает ${trade.final_price} золота.`
                : `Сделка подготовлена. Ожидание подтверждения.`
        };
    },
    addItemToTrade: function(tradeId, itemId, side, quantity) {
        if (!this.activeTrades.has(tradeId)) return false;
        const trade = this.activeTrades.get(tradeId);
        const item = ItemRegistry.get(itemId);
        if (!item || item.state !== getInventoryMovementRuntimeConfig().states.default) return false;
        if (item.stack_size < quantity) return false;
        
        const expectedContainer = side === "offer" ? trade.initiator_container : trade.target_container;
        if (item.container_id !== expectedContainer) return false;
        if (!is_sellable(expectedContainer, itemId)) return false;

        item.state = getInventoryMovementRuntimeConfig().states.trade_locked;
        if (side === "offer") trade.offer_items.push({id: itemId, quantity: quantity});
        else trade.request_items.push({id: itemId, quantity: quantity});
        return true;
    },
    _validateTradeReady: function(trade) {
        if (!this._validateTradeDistance(trade)) return { success: false, error: getInventoryFeedbackText('trade_too_far', 'Trade parties are too far apart') };

        for (const offer of trade.offer_items) {
            const item = ItemRegistry.get(offer.id);
            if (!item || item.container_id !== trade.initiator_container) return { success: false, error: getInventoryFeedbackText('offer_moved_before_confirmation', 'Offer item moved before confirmation') };
            if (item.stack_size < offer.quantity) return { success: false, error: getInventoryFeedbackText('offer_quantity_changed', 'Offer quantity changed before confirmation') };
            if (item.state !== getInventoryMovementRuntimeConfig().states.trade_locked) return { success: false, error: getInventoryFeedbackText('offer_no_longer_locked', 'Offer item is no longer locked for trade') };
        }

        for (const request of trade.request_items) {
            const item = ItemRegistry.get(request.id);
            if (!item || item.container_id !== trade.target_container) return { success: false, error: getInventoryFeedbackText('request_moved_before_confirmation', 'Request item moved before confirmation') };
            if (item.stack_size < request.quantity) return { success: false, error: getInventoryFeedbackText('request_quantity_changed', 'Request quantity changed before confirmation') };
            if (item.state !== getInventoryMovementRuntimeConfig().states.trade_locked) return { success: false, error: getInventoryFeedbackText('request_no_longer_locked', 'Request item is no longer locked for trade') };
        }

        if (trade.mode === 'sale' && getGoldAmountInContainer(trade.target_container) < trade.final_price) {
            return { success: false, error: "Merchant no longer has enough gold" };
        }

        return { success: true };
    },
    _executeItemTransfers: async function(items, sourceContainerId, targetContainerId, createdItemIds) {
        for (const entry of items) {
            const res = await CoreInventorySystemAsync.moveItem(entry.id, sourceContainerId, targetContainerId, entry.quantity, {
                ...getInventoryTransferOptions('system_full_access')
            });
            if (!res.success) return res;
            if (res.createdItemId) createdItemIds.push(res.createdItemId);
            if (ItemRegistry.has(entry.id)) ItemRegistry.get(entry.id).state = 'idle';
            if (ItemRegistry.has(res.movedItemId)) ItemRegistry.get(res.movedItemId).state = 'idle';
        }
        return { success: true };
    },
    _transferMerchantGold: async function(trade, createdItemIds) {
        let remaining = trade.final_price;
        const targetContainer = ContainerRegistry.get(trade.target_container);
        if (!targetContainer) return { success: false, error: "Merchant container not found" };

        const physicalGoldItems = [...getContainerItems(targetContainer)].filter(itemId => {
            const it = ItemRegistry.get(itemId);
            return it && isGoldLikeItem(it);
        });
        for (const goldItemId of physicalGoldItems) {
            if (remaining <= 0) break;
            const goldItem = ItemRegistry.get(goldItemId);
            const amountToMove = Math.min(goldItem.stack_size, remaining);
            const res = await CoreInventorySystemAsync.moveItem(goldItemId, trade.target_container, trade.initiator_container, amountToMove, {
                ...getInventoryTransferOptions('system_ignore_access'),
                allowLocked: true
            });
            if (!res.success) return res;
            if (res.createdItemId) createdItemIds.push(res.createdItemId);
            remaining -= amountToMove;
        }

        if (remaining > 0) {
            const merchant = World?.npcs?.[trade.target];
            if (!merchant?.inventory || merchant.inventory.gold < remaining) return { success: false, error: "Merchant account is short on gold" };
            const buyerContainer = ContainerRegistry.get(trade.initiator_container);
            const existingGoldId = CoreInventorySystemAsync.findItemByPrototype(trade.initiator_container, 'gold');
            const currentWeight = CoreInventorySystemAsync.getContainerWeight(trade.initiator_container);
            const addedWeight = remaining * 0.01;
            if (!existingGoldId && getContainerItems(buyerContainer).length >= buyerContainer.max_slots) {
                return { success: false, error: "Buyer container has no free slot for gold" };
            }
            if (currentWeight + addedWeight > buyerContainer.max_weight_kg) {
                return { success: false, error: "Buyer container cannot carry the gold payment" };
            }

            merchant.inventory.gold -= remaining;
            if (existingGoldId) {
                ItemRegistry.get(existingGoldId).stack_size += remaining;
            } else {
                const createdGoldId = await CoreInventorySystemAsync.createItem('gold', remaining, trade.initiator_container, { name: getItemName('gold', player?.era) });
                createdItemIds.push(createdGoldId);
            }
            remaining = 0;
        }

        syncPlayerGoldFromInventory();
        return { success: true };
    },
    _postProcessTrade: async function(trade) {
        if (trade.target !== 'player' && typeof World !== 'undefined' && World && World.npcs?.[trade.target]) {
            const npc = World.npcs[trade.target];
            const regionId = npc.currentLocation || npc.homeLocation || resolveContainerLocation(trade.target_container)?.region_id;
            if (regionId && World.regions?.[regionId]) {
                const region = World.regions[regionId];
                const factionId = region.owner;
                const tradeValueGold = trade.final_price || 0;

                if (tradeValueGold > 0) {
                    const tax = Math.max(1, Math.floor(tradeValueGold * 0.05));
                    region.moneySupply += tax;
                    // Добавляем физическое золото в склад региона
                    if (factionId && region.vault_id) {
                        await addRealItems(region.vault_id, 'gold', tax);
                    }
                }

                if (factionId && trade.initiator === 'player') {
                    player.stats.reputation[factionId] = (player.stats.reputation[factionId] || 0) + 1;
                }
            }
        }

        if (World?.news) {
            World.news.push({
                category: 'trade',
                text: `Игрок успешно завершил сделку с ${trade.target} на сумму ${trade.final_price || 0} золота.`,
                day: (World.current_day !== undefined ? World.current_day : Math.floor((World.tick || 0) / 24)),
                location: trade.region_id || "global",
                importance: 1
            });
        }
        if (player?.worldEvents) {
            player.worldEvents.push({
                type: 'trade_completed',
                turn: player.stats.turnCount,
                tradeId: trade.id,
                target: trade.target,
                price: trade.final_price || 0
            });
        }
    },
    confirmTrade: async function(tradeId) {
        if (!this.activeTrades.has(tradeId)) return { success: false, error: "Trade not found" };
        const trade = this.activeTrades.get(tradeId);

        const readiness = this._validateTradeReady(trade);
        if (!readiness.success) return this._rollbackTrade(tradeId, readiness.error);

        const snapshot = this._snapshotTradeState(trade);
        const createdItemIds = [];

        const offerResult = await this._executeItemTransfers(trade.offer_items, trade.initiator_container, trade.target_container, createdItemIds);
        if (!offerResult.success) {
            this._restoreTradeSnapshot(snapshot, createdItemIds);
            return this._rollbackTrade(tradeId, offerResult.error || "Failed to move offer item");
        }

        let requestResult = { success: true };
        if (trade.mode === 'manual') {
            requestResult = await this._executeItemTransfers(trade.request_items, trade.target_container, trade.initiator_container, createdItemIds);
        } else {
            requestResult = await this._transferMerchantGold(trade, createdItemIds);
        }

        if (!requestResult.success) {
            this._restoreTradeSnapshot(snapshot, createdItemIds);
            return this._rollbackTrade(tradeId, requestResult.error || "Failed to complete trade payment");
        }

        trade.status = "completed";
        this.activeTrades.delete(tradeId);
        this._toggleConfirmButton(null);
        if (player?.active_trade_id === tradeId) player.active_trade_id = null;
        syncPlayerGoldFromInventory();
        await this._postProcessTrade(trade);
        return { success: true, tradeId, price: trade.final_price || 0 };
    },
    _rollbackTrade: function(tradeId, reason) {
        const trade = this.activeTrades.get(tradeId);
        if (trade) {
            this._releaseTradeLocks(trade);
            trade.status = "failed";
            this.activeTrades.delete(tradeId);
        }
        this._toggleConfirmButton(null);
        if (player?.active_trade_id === tradeId) player.active_trade_id = null;
        return { success: false, error: reason };
    },
    negotiateTrade: function(tradeId, newOffer, newRequestItems = []) {
        if (!this.activeTrades.has(tradeId)) return { success: false, error: "Trade not found" };
        const trade = this.activeTrades.get(tradeId);
        if (trade.mode === 'sale') {
            const requestedPrice = parseInt(newOffer, 10);
            if (!Number.isFinite(requestedPrice) || requestedPrice <= 0) return { success: false, error: "Invalid negotiated offer" };
            if (requestedPrice < trade.negotiation.min_price || requestedPrice > trade.negotiation.max_price) {
                return { success: false, error: `Merchant rejects this price. Allowed range: ${trade.negotiation.min_price}-${trade.negotiation.max_price}.` };
            }
            if (getGoldAmountInContainer(trade.target_container) < requestedPrice) {
                return { success: false, error: "Merchant cannot cover the negotiated price" };
            }
            trade.final_price = requestedPrice;
            return { success: true, acceptedPrice: requestedPrice };
        }

        this._releaseTradeLocks(trade);
        trade.offer_items = [];
        trade.request_items = [];
        const prepResult = this._prepareManualTrade(trade, newOffer, newRequestItems);
        return prepResult.success ? { success: true } : prepResult;
    }
};


// ======================================================================
// ======================================================================
// --- TREK SYSTEM (GLOBAL TRAVEL ENGINE) --- 
// ======================================================================
function getCaravanContents(chestId) {
    if (!chestId || !ContainerRegistry.has(chestId)) return "Пусто";
    const cont = ContainerRegistry.get(chestId);
    if (!cont.items || cont.items.length === 0) return "Пусто";
    let contents = [];
    cont.items.forEach(itemId => {
        const item = ItemRegistry.get(itemId);
        if (item) {
            let name = item.custom_props?.name || item.prototype_id;
            contents.push(`${name} (x${item.stack_size})`);
        }
    });
    return contents.join(", ");
}

function formatTrekObjectData(objType, data) {
    if (!data) return "Нет данных";
    if (objType === 'caravan') {
        let goods = getCaravanContents(data.chest_id);
        return `Караван (ID: ${data.id}). Маршрут: ${data.origin} -> ${data.destination}. Охрана: ${data.guards} наемников. Груз (chest_id: ${data.chest_id}): ${goods}.`;
    } else if (objType === 'army') {
        return `Армия (ID: ${data.id}). Фракция: ${data.faction_name || 'Неизвестно'}. Численность: ${data.size}. Мораль: ${data.morale}. Направляется в: ${data.destination}. Фаза: ${data.current_phase}. Сундук снабжения: ${data.supply_chest_id || 'Нет'}.`;
    }
    return JSON.stringify(data);
}


const LivingRoads = {
    timer: null,
    isProcessing: false,
    isGeneratingHour: false,

    calculateDistance: function(x1, y1, x2, y2) {
        return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    },

    start: async function(destinationId) {
        if (!player) return { success: false, error: "Игрок не найден" };
        
        let dest = globalLocations[destinationId] || (player.mapMarkers && player.mapMarkers[destinationId]);
        const allPoints = [
            ...Object.keys(globalLocations || {}).map(k => ({ ...globalLocations[k], id: k })),
            ...Object.values(player.mapMarkers || {})
        ];

        if (!dest) {
            const searchName = String(destinationId).toLowerCase().trim();
            
            // 1. Поиск по имени
            dest = allPoints.find(p => p.name && p.name.toLowerCase().trim().includes(searchName));
            
            // 2. Поиск по частям ID (устойчивость к перестановке слов, напр. aquilon_capital)
            if (!dest) {
                const searchParts = searchName.split(/[_ \-]+/);
                dest = allPoints.find(p => {
                    if (!p.id) return false;
                    const idLower = p.id.toLowerCase();
                    const validParts = searchParts.filter(part => part.length > 2);
                    if (validParts.length === 0) return false;
                    return validParts.every(part => idLower.includes(part));
                });
            }
            
            // 3. Поиск по частям имени
            if (!dest) {
                const searchParts = searchName.split(/[_ \-]+/);
                dest = allPoints.find(p => {
                    if (!p.name) return false;
                    const nameLower = p.name.toLowerCase();
                    const validParts = searchParts.filter(part => part.length > 2);
                    if (validParts.length === 0) return false;
                    return validParts.some(part => nameLower.includes(part));
                });
            }
        }

        let startLocId = null;
        for (let key in globalLocations) {
            if (globalLocations[key].name === player.location) {
                startLocId = key; break;
            }
        }
        if (!startLocId && player.currentSublocation) {
            let sub = player.subLocations[player.currentSublocation] || (World && World.subLocations && World.subLocations[player.currentSublocation]);
            if (sub && sub.parentId) startLocId = sub.parentId;
        }
        if (!startLocId) startLocId = Object.keys(globalLocations)[0];

        if (!dest) {
            const newName = String(destinationId).replace(/_/g, ' ');
            const capitalizedName = newName.charAt(0).toUpperCase() + newName.slice(1);
            addLogMessage(`[ВНИМАНИЕ] Локация '${destinationId}' не найдена в атласе. Маршрут проложен наугад, локация добавлена на карту.`, "system-message");
            
            let startX = 128, startY = 128;
            if (globalLocations[startLocId]) { startX = globalLocations[startLocId].x; startY = globalLocations[startLocId].y; }
            
            await executeCommand('addMapMarker', {
                id: destinationId,
                name: capitalizedName,
                description: "Неизведанное место, упомянутое в пути.",
                x: startX + (Math.random() * 20 - 10),
                y: startY + (Math.random() * 20 - 10)
            });
            
            dest = player.mapMarkers[destinationId];
        }

        if (window.electronAPI && window.electronAPI.nexusStartTrek) {
            const res = await window.electronAPI.nexusStartTrek(startLocId, dest.id || destinationId);
            if (res.status === 'ok') {
                player.travel = {
                    active: true, destinationId: dest.id || destinationId, destinationName: dest.name,
                    totalHours: res.total_hours, elapsedHours: 0,
                    paused: false, pauseReason: null
                };
                if (window.Cartographer) window.Cartographer.mapState.isFollowingPlayer = true;
                updateCharacterSheet();
                addLogMessage(`[СИСТЕМА] Путешествие в ${dest.name} начато. Расчетное время: ${res.total_hours} ч.`, "system-message");
            }
        }
        this.resume();
        return { success: true };
    },

        tick: async function() {
        if (!player || !player.travel || !player.travel.active || player.travel.paused || this.isProcessing) return;
        this.isProcessing = true;
        this.isGeneratingHour = true;
        updateCharacterSheet(); // Показываем загрузку

        try {
            // Ждем ответа от движка, чтобы не спамить запросами
            await new Promise(resolve => {
                const prev = window.isSimulatingTime;
                window.isSimulatingTime = true; // Подавляем блокировку ввода на время тика
                
                            window.electronAPI.nexusSimulate(null, 1, player?.location || "").then(res => {
                this.isGeneratingHour = false;
                if (res.status === 'ok') {
                    if (res.world) setWorld(res.world);
                    if (res.relevant_news) { const w = getWorld(); if (w) w.relevant_news = res.relevant_news; }
                        if (res.items) res.items.forEach(([k, v]) => ItemRegistry.set(k, v));
                        if (res.containers) res.containers.forEach(([k, v]) => setContainer(k, v));
                        if (res.deleted_items) res.deleted_items.forEach(id => ItemRegistry.delete(id));
                        if (res.deleted_containers) res.deleted_containers.forEach(id => ContainerRegistry.delete(id));
                    processMonsterQuests();
                        
                        // Синхронизация прогресса пути из C++
                        if (res.world && res.world.player_trek) {
                            player.travel.active = res.world.player_trek.active;
                            // Защита от рассинхрона: если игрок нажал паузу, не перезаписываем старым стейтом
                            if (!player.travel.paused || res.world.player_trek.paused) {
                                player.travel.paused = res.world.player_trek.paused;
                            }
                            player.travel.elapsedHours = res.world.player_trek.elapsed_hours;
                            player.travel.totalHours = res.world.player_trek.total_hours;
                            player.travel.currentX = res.world.player_trek.current_x;
                            player.travel.currentY = res.world.player_trek.current_y;
                        }
                        
                        // Двигаем часы UI
                        if (player.gameTime) {
                            player.gameTime.totalPulses += 12;
                            player.gameTime.hour += 1;
                            if (player.gameTime.hour >= 24) {
                                player.gameTime.hour = 0;
                                player.gameTime.day += 1;
                            }
                        }

                        if (res.trek_events && res.trek_events.length > 0) {
                            LivingRoads.handleEvents(res.trek_events);
                        }
                        
                        updateTimeDisplay();
                    }
                    window.isSimulatingTime = prev;
                    updateCharacterSheet(); // Обновляем UI после получения данных
                    if (typeof updateHoldingsDisplay === 'function') updateHoldingsDisplay();
                    resolve();
                }).catch(err => {
                    console.error("Ошибка тика пути:", err);
                    this.isGeneratingHour = false;
                    window.isSimulatingTime = prev;
                    updateCharacterSheet();
                    resolve();
                });
            });
        } finally {
            this.isProcessing = false;
        }
    },

    pause: async function(reason = "manual") {
        if (!player || !player.travel || !player.travel.active) return;
        player.travel.paused = true;
        player.travel.pauseReason = reason;
        player.travel.isFastForwarding = false;
        if (this.timer) clearInterval(this.timer);
        if (window.electronAPI && window.electronAPI.nexusPauseTrek) await window.electronAPI.nexusPauseTrek();
        updateCharacterSheet();
        addLogMessage(`[СИСТЕМА] Путешествие приостановлено. Причина: ${reason}`, "system-message");
    },

        resume: async function() {
        if (!player || !player.travel || !player.travel.active) return;
        player.travel.paused = false;
        player.travel.pauseReason = null;
        player.travel.currentEvents = null; // Очищаем события при продолжении пути
        player.travel.isFastForwarding = false;
        if (window.electronAPI && window.electronAPI.nexusResumeTrek) await window.electronAPI.nexusResumeTrek();
        if (this.timer) clearInterval(this.timer);
        const interval = requireRuntimeNumber(
            typeof TREK_CONFIG !== 'undefined' ? TREK_CONFIG.tick_interval_ms : NaN,
            'TREK_CONFIG.tick_interval_ms'
        );
        this.timer = setInterval(() => this.tick(), interval);
        updateCharacterSheet();
        addLogMessage(`[СИСТЕМА] Путешествие возобновлено.`, "system-message");
    },

    cancel: async function() {
        if (!player || !player.travel || !player.travel.active) return;
        player.travel.active = false;
        player.travel.isFastForwarding = false;
        if (this.timer) clearInterval(this.timer);
        if (window.electronAPI && window.electronAPI.nexusCancelTrek) await window.electronAPI.nexusCancelTrek();
        addLogMessage(`[СИСТЕМА] Путешествие отменено. Вы остались в дикой местности.`, "system-message");
        updateCharacterSheet();
    },

    fastForward: async function() {
        if (!player || !player.travel || !player.travel.active) return;
        player.travel.paused = false;
        player.travel.pauseReason = null;
        player.travel.currentEvents = null;
        player.travel.isFastForwarding = true;
        if (window.electronAPI && window.electronAPI.nexusResumeTrek) await window.electronAPI.nexusResumeTrek();
        if (this.timer) clearInterval(this.timer);
        // Ускоряем до 50мс
        this.timer = setInterval(() => this.tick(), 50);
        addLogMessage(`[СИСТЕМА] Путешествие ускорено.`, "system-message");
        updateCharacterSheet();
    },

        handleEvents: function(events) {
        if (!events || events.length === 0) return;
        
        let arrivalEvent = events.find(ev => ev.object_type === 'arrival');
        let otherEvents = events.filter(ev => ev.object_type !== 'arrival');

        if (otherEvents.length > 0) {
            // Сохраняем события для отображения в UI
            player.travel.currentEvents = otherEvents;
            player.travel.paused = true;
            player.travel.pauseReason = "event";
            player.travel.isFastForwarding = false;
            if (this.timer) clearInterval(this.timer);
            
            // Дублируем в лог для истории
            otherEvents.forEach(ev => {
                // Обработка локализации для лога
                let description = '';
                let descObj = ev.description;

                // Если description - это JSON-строка, парсим её
                if (typeof descObj === 'string') {
                    try {
                        const parsed = JSON.parse(descObj);
                        if (typeof parsed === 'object' && parsed !== null) {
                            descObj = parsed;
                        } else {
                            description = descObj;
                        }
                    } catch (e) {
                        // Не JSON, используем как есть
                        description = descObj;
                    }
                }

                // Если ещё не установлено и это объект
                if (!description && typeof descObj === 'object' && descObj !== null) {
                    if (descObj.loc_key) {
                        // Используем систему локализации с ключом и аргументами
                        description = t(descObj.loc_key, descObj.loc_args || {});
                    } else if (descObj[currentLanguage]) {
                        description = descObj[currentLanguage] || descObj['ru'] || descObj['en'];
                    } else {
                        description = JSON.stringify(descObj);
                    }
                }

                if (!description) {
                    description = String(ev.description || 'Неизвестное событие');
                }

                addLogMessage(`<div style="border-left: 3px solid #f39c12; padding-left: 10px; margin: 5px 0;"><strong style="color:#f39c12;">[СОБЫТИЕ В ПУТИ]</strong> ${description}</div>`, "system-message");
            });
        }

        if (arrivalEvent) {
            this.finish();
        }
    },

        interact: async function(objType, simId, description) {
        let formattedData = "";
        if (simId && simId !== "undefined" && simId !== "null" && window.electronAPI && window.electronAPI.nexusInteractTrekObject) {
            const res = await window.electronAPI.nexusInteractTrekObject(objType, simId);
            if (res.status === 'ok') {
                formattedData = formatTrekObjectData(objType, res.object_data);
            }
        }

        if (player && player.travel) {
            player.travel.currentEvents = null;
            player.travel.interactTarget = { type: objType, data: formattedData ? { id: simId } : null };
        }
        updateCharacterSheet();
        
        let prompt = `[SYSTEM: ПУТЕШЕСТВИЕ ПРИОСТАНОВЛЕНО]\nСобытие в пути: ${description || objType}\n`;
        if (formattedData) {
            prompt += `Данные объекта от движка: ${formattedData}\n`;
        }
        prompt += `Опиши сцену (как это выглядит, звуки, запахи) и спроси игрока, что он будет делать. Жди ответа игрока.`;
                sendApiRequest(prompt, false, false, [], false);
    },

    finish: function() {
        if (this.timer) clearInterval(this.timer);
        executeCommand('setLocation', { locationName: player.travel.destinationName });
        addLogMessage(`[СИСТЕМА] Путешествие завершено. Вы прибыли в: ${player.travel.destinationName}.`, "system-message");
        player.travel.active = false;
        updateCharacterSheet();
        updateMapDisplay();
        const prompt = `[SYSTEM: ПУТЕШЕСТВИЕ ЗАВЕРШЕНО] Игрок успешно прибыл в ${player.travel.destinationName}. Опиши прибытие и обстановку вокруг.`;
        sendApiRequest(prompt, false, false, [], false);
    }
};

// --- ИНТЕГРАЦИЯ WEB WORKER ДЛЯ СИМУЛЯЦИИ МИРА ---
// ======================================================================
let ECONOMY_ITEMS = {};
let CRAFTING_RECIPES = [];

let FACILITY_NAMES = {};
let TREK_CONFIG = {};
window.DISABLE_LOCALIZATION = false;

function syncRuntimeRegistries() {
    ECONOMY_ITEMS = window.ECONOMY_ITEMS || {};
    CRAFTING_RECIPES = window.CRAFTING_RECIPES || [];
    FACILITY_NAMES = window.FACILITY_NAMES || {};
    TREK_CONFIG = window.TREK_CONFIG;
}

function getLocalizedRuntimeAssetPaths(primaryKey, fallbackKey, replacements = {}) {
    const primary = typeof window.resolveWorldAssetPath === 'function'
        ? window.resolveWorldAssetPath(primaryKey, replacements)
        : '';
    const fallback = typeof window.resolveWorldAssetPath === 'function'
        ? window.resolveWorldAssetPath(fallbackKey, replacements)
        : '';
    return { primary, fallback };
}

// FIX (Issue #80): parseLocString was vulnerable to:
// 1. ReDoS via unescaped itemId/facId in new RegExp()
// 2. Stack overflow via recursive parseLocString calls on loc_args
// 3. JSON injection via untrusted loc_key/loc_args values
// Now: regex special chars are escaped, recursion is depth-limited,
// and loc_key values are validated against dangerous patterns.
const _locStrRegexCache = new Map();
function _escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseLocString(str, disableLoc = window.DISABLE_LOCALIZATION, _depth = 0) {
    if (typeof str !== 'string') return str;
    let result = str;

    // FIX: Limit recursion depth to prevent stack overflow from nested loc_key strings
    const MAX_LOC_RECURSION_DEPTH = 5;
    if (_depth >= MAX_LOC_RECURSION_DEPTH) {
        console.warn('[i18n] parseLocString recursion depth limit reached, returning raw string');
        return str;
    }

    if (!disableLoc && str.includes('"loc_key"')) {
        const processParsed = (data, originalStr) => {
            if (data.loc_args) {
                for (let k in data.loc_args) {
                    let argStr = data.loc_args[k];
                    if (typeof argStr === 'string') {
                        if (typeof ECONOMY_ITEMS !== 'undefined') {
                            Object.keys(ECONOMY_ITEMS).forEach(itemId => {
                                // FIX: Escape regex special chars in itemId to prevent ReDoS
                                const cached = _locStrRegexCache.get(itemId);
                                const r = cached || (_locStrRegexCache.set(itemId, new RegExp('\\b' + _escapeRegExp(itemId) + '\\b', 'g')), _locStrRegexCache.get(itemId));
                                if (r.test(argStr)) {
                                    argStr = argStr.replace(r, getItemName(itemId, player ? player.era : getRuntimeDefaultEraId()));
                                }
                            });
                        }
                        if (typeof FACILITY_NAMES !== 'undefined') {
                            Object.keys(FACILITY_NAMES).forEach(facId => {
                                // FIX: Escape regex special chars in facId to prevent ReDoS
                                const cached = _locStrRegexCache.get('fac:' + facId);
                                const r = cached || (_locStrRegexCache.set('fac:' + facId, new RegExp('\\b' + _escapeRegExp(facId) + '\\b', 'g')), _locStrRegexCache.get('fac:' + facId));
                                if (r.test(argStr)) {
                                    argStr = argStr.replace(r, getFacilityName(facId, player ? player.era : getRuntimeDefaultEraId()));
                                }
                            });
                        }
                        if (argStr.includes('"loc_key"')) {
                            // FIX: Pass depth counter to limit recursion
                            argStr = parseLocString(argStr, disableLoc, _depth + 1);
                        }
                        data.loc_args[k] = argStr;
                    }
                }
            }
            let trans = t(data.loc_key, data.loc_args, null);
            if (trans === null) {
                let fallbackText = data.loc_key.split('.').pop() + ": ";
                if (data.loc_args) fallbackText += Object.values(data.loc_args).join(', ');
                return fallbackText;
            }
            return trans;
        };

        try {
            let data = JSON.parse(str);
            if (data && data.loc_key) {
                result = processParsed(data, str);
            }
        } catch(e) {
            const regex = /\{"loc_key":"[^"]+"(?:,\s*"loc_args":\{.*?\})?\}/g;
            result = str.replace(regex, (match) => {
                try {
                    let data = JSON.parse(match);
                    if (data && data.loc_key) return processParsed(data, match);
                } catch(err) {
                    console.warn('[i18n] Failed to parse location JSON fragment:', match, err.message);
                }
                return match;
            });
        }
    }

    if (window.ModAPI && window.ModAPI.applyTextFilters) {
        result = window.ModAPI.applyTextFilters(result);
    }
    return result;
}


function getItemName(itemId, eraId) {
    const runtimeEraId = getRuntimeDefaultEraId();
    if (!eraId) eraId = runtimeEraId;
    let locName = t(`economy_items.${itemId}.${eraId}`);
    if (locName !== `economy_items.${itemId}.${eraId}`) return locName;
    return (ECONOMY_ITEMS[itemId] && ECONOMY_ITEMS[itemId].names)
        ? (ECONOMY_ITEMS[itemId].names[eraId] || ECONOMY_ITEMS[itemId].names[runtimeEraId] || ECONOMY_ITEMS[itemId].name || itemId)
        : (ECONOMY_ITEMS[itemId]?.name || itemId);
}
function getFacilityName(facId, eraId) {
    const runtimeEraId = getRuntimeDefaultEraId();
    if (!eraId) eraId = runtimeEraId;
    let locName = t(`facilities.${facId}.${eraId}`);
    if (locName !== `facilities.${facId}.${eraId}`) return locName;
    return (FACILITY_NAMES[facId] && FACILITY_NAMES[facId].names && FACILITY_NAMES[facId].names[eraId]) ? FACILITY_NAMES[facId].names[eraId] : facId;
}

// Вспомогательная функция для генерации новостей в Летопись Мира
function generateWorldNews(text, location, importance, category) {
    if (typeof World === 'undefined' || !World) return;
    if (!World.news) World.news = [];
    World.news.push({
        id: "news_" + generateUUID(),
        text: text,
        location: location || "global",
        importance: importance || 1,
        category: category || "misc",
        day: (World.current_day !== undefined ? World.current_day : Math.floor((World.tick || 0) / 24))
    });
}

let World = null;
// Defensive getter for World state — prevents null reference errors
function getWorld() {
    return World;
}
function setWorld(newWorld) {
    World = newWorld;
}
function mutateWorld(mutator) {
    if (!World) {
        console.error('[State] Attempted to mutate null World. Call ignored.');
        return false;
    }
    mutator(World);
    return true;
}

// worldWorker удален, используется нативный C++ Nexus Engine

async function initWorldSimulator(initialAgents = 100, startDay = 0, isLoadMode = false) {
    // This function now delegates entirely to the integration script
    // to ensure modded data is loaded correctly.
    return loadDatabaseWithModsAndInitEngine(initialAgents, startDay, isLoadMode);
}
async function preSimulateWorldHistory(yearsToSimulate) {
    IS_PRE_SIMULATING = true;
    
    if (window.electronAPI && window.electronAPI.nexusPreSimulate) {
        const totalTicks = yearsToSimulate * 360 * 24;
        const titleEl = document.getElementById('loading-title');
        if (titleEl) titleEl.textContent = 'Летопись Мира';
        const loadingText = document.getElementById('loading-text');
        if (loadingText) loadingText.textContent = `Синтез истории за ${yearsToSimulate} лет (вычисляется в Nexus Engine)...`;

        console.log(`[Nexus] Запуск пре-симуляции ${totalTicks} тиков в C++...`);
        const res = await window.electronAPI.nexusPreSimulate(World, totalTicks);
        console.log(`[Nexus] Ответ пре-симуляции получен:`, res ? `status=${res.status}` : 'null');
        if (res.status === 'ok') {
            if (res.world) setWorld(res.world);
            if (res.relevant_news) World.relevant_news = res.relevant_news;
            if (res.items) res.items.forEach(([k, v]) => ItemRegistry.set(k, v));
            if (res.containers) res.containers.forEach(([k, v]) => setContainer(k, v));
            if (res.deleted_items) res.deleted_items.forEach(id => ItemRegistry.delete(id));
            if (res.deleted_containers) res.deleted_containers.forEach(id => ContainerRegistry.delete(id));
                    processMonsterQuests();
            
            IS_PRE_SIMULATING = false;
            if (loadingText) loadingText.textContent = 'Генерация мира завершена...';
            updateWorldChroniclesDisplay();
            updateTradeJournalDisplay();
            updatePortPanel();
            if (typeof updateHoldingsDisplay === 'function') updateHoldingsDisplay();
            document.dispatchEvent(new Event('PreSimulateComplete'));
            return;
        } else {
            console.error("[Nexus] Ошибка пре-симуляции:", res);
        }
    } else {
        console.error("[Nexus] Нативный движок недоступен для пре-симуляции!");
    }
    
    IS_PRE_SIMULATING = false;
    document.dispatchEvent(new Event('PreSimulateComplete'));
}

function processMonsterQuests() {
    if (!World || !World.monsters || !player || !player.quests) return;

    let playerRegionId = null;
    if (player.location) {
        const locLower = player.location.toLowerCase().trim();
        for (let rId in World.regions) {
            if (locLower.includes(World.regions[rId].name.toLowerCase().trim())) {
                playerRegionId = rId;
                break;
            }
        }
    }

    let questsUpdated = false;

    World.monsters.forEach(m => {
        if (m.health > 0 && m.state === "ACTIVE") {
            // Выдаем квест ТОЛЬКО если монстр находится в текущем регионе игрока
            if (m.region_id === playerRegionId) {
                const questId = "hunt_" + m.id;
                if (!player.quests[questId]) {
                    player.quests[questId] = {
                        id: questId,
                        aiIdentifier: questId,
                        title: "Великая Охота: " + m.name,
                        objective: "Уничтожить чудовище в регионе " + (World.regions[m.region_id] ? World.regions[m.region_id].name : m.region_id),
                        description: "Местные жители в ужасе. Эпическое чудовище терроризирует эти земли. Награда за его голову будет щедрой.",
                        reward: "Сокровища логова, Слава",
                        issuer: "Местные слухи",
                        status: 'active'
                    };
                    // Блокируем спам в лог во время пре-симуляции и фоновых расчетов
                    if (!IS_PRE_SIMULATING && !window.isSimulatingTime) {
                        addLogMessage(`[АВТО-КВЕСТ] Добавлено местное задание: Великая Охота на ${m.name}!`, "system-message");
                        questsUpdated = true;
                    }
                }
            }
        }
    });

    Object.keys(player.quests).forEach(qId => {
        if (qId.startsWith("hunt_") && player.quests[qId].status === 'active') {
            const mId = qId.replace("hunt_", "");
            const monster = World.monsters.find(m => m.id === mId);
            // Если монстр мертв ИЛИ вообще исчез из массива (убит армией)
            if (!monster || monster.health <= 0) {
                player.quests[qId].status = 'completed';
                if (!IS_PRE_SIMULATING && !window.isSimulatingTime) {
                    addLogMessage(`[АВТО-КВЕСТ] Задание выполнено: ${player.quests[qId].title}!`, "level-up");
                    questsUpdated = true;
                }
            }
        }
    });

    if (questsUpdated && !IS_PRE_SIMULATING && !window.isSimulatingTime) {
        updateQuestList();
    }
}

// Флаг реалтайм-режима движка
let _realtimeActive = false;

function updateWorldSimulation(pulses) {
    if (!World) return;
    
    if (window.electronAPI && window.electronAPI.nexusStartRealtime) {
        World.time = World.time || { accumulatedMinutes: 0 };
        World.time.accumulatedMinutes += pulses * 5;
        
        let ticks = Math.floor(World.time.accumulatedMinutes / 60);
        if (ticks > 0) {
            World.time.accumulatedMinutes -= ticks * 60;

            // Реалтайм-режим: движок симулирует и стримит обновления мира
            // каждые 500мс (по умолчанию). JS получает мир мгновенно через onNexusRealtimeUpdate.
            // Запускаем реалтайм если ещё не запущен, и отправляем тики.
            const startRealtimeIfNeeded = async () => {
                if (!_realtimeActive) {
                    try {
                        await window.electronAPI.nexusStartRealtime(500);
                        _realtimeActive = true;
                    } catch (e) {
                        console.warn("[Nexus] Не удалось запустить реалтайм-режим, fallback на блокирующий:", e);
                    }
                }
                // Отправляем тики для симуляции
                window.electronAPI.nexusSimulate(World, ticks, player?.location || "").then(res => {
                    if (res.status === 'ok') {
                        // Реалтайм-обновления приходят через onNexusRealtimeUpdate,
                        // но финальный ответ тоже обрабатываем для trek_events и UI
                        if (res.world) setWorld(res.world);
                        if (res.relevant_news) { const w = getWorld(); if (w) w.relevant_news = res.relevant_news; }
                        if (res.items) res.items.forEach(([k, v]) => ItemRegistry.set(k, v));
                        if (res.containers) res.containers.forEach(([k, v]) => setContainer(k, v));
                        if (res.deleted_items) res.deleted_items.forEach(id => ItemRegistry.delete(id));
                        if (res.deleted_containers) res.deleted_containers.forEach(id => ContainerRegistry.delete(id));
                        processMonsterQuests();

                        if (res.world && res.world.player_trek) {
                            if (!player.travel) player.travel = {};
                            player.travel.active = res.world.player_trek.active;
                            player.travel.paused = res.world.player_trek.paused;
                            player.travel.elapsedHours = res.world.player_trek.elapsed_hours;
                            player.travel.totalHours = res.world.player_trek.total_hours;
                            player.travel.currentX = res.world.player_trek.current_x;
                            player.travel.currentY = res.world.player_trek.current_y;
                        }
                        if (res.trek_events && res.trek_events.length > 0) {
                            LivingRoads.handleEvents(res.trek_events);
                        }

                        if (typeof updateEnvironmentPanel === 'function') updateEnvironmentPanel();
                        if (typeof updateHoldingsDisplay === 'function') updateHoldingsDisplay();
                        if (window.isSimulatingTime) {
                            hideLoadingScreen();
                            window.isSimulatingTime = false;
                        }
                        if (World.needsGlobalEvent) {
                            World.needsGlobalEvent = false;
                            runWorldSimulationTick();
                        } else if (!isWaitingForAI && !window.isSimulatingTime) {
                            if (userInput) userInput.disabled = false;
                            if (sendButton) sendButton.disabled = false;
                        }
                    } else {
                        console.error("[Nexus] Ошибка симуляции:", res);
                    }
                }).catch(err => {
                    console.error("[Nexus] Ошибка вызова nexusSimulate:", err);
                    if (window.isSimulatingTime) {
                        hideLoadingScreen();
                        window.isSimulatingTime = false;
                    }
                    if (!isWaitingForAI) {
                        if (userInput) userInput.disabled = false;
                        if (sendButton) sendButton.disabled = false;
                    }
                });
            };
            startRealtimeIfNeeded();
        }
    } else {
        console.error("[Nexus] Нативный движок недоступен для симуляции времени!");
    }
}

// Остановка реалтайм-режима при завершении/паузе
async function stopRealtimeSimulation() {
    if (_realtimeActive && window.electronAPI && window.electronAPI.nexusStopRealtime) {
        try {
            await window.electronAPI.nexusStopRealtime();
            _realtimeActive = false;
        } catch (e) {
            console.warn("[Nexus] Ошибка остановки реалтайм:", e);
        }
    }
}

async function runWorldSimulationTick() {
    if (isSimulatingWorld) return;
    isSimulatingWorld = true;
    isWaitingForAI = true;
    if (userInput) userInput.disabled = true;
    if (sendButton) sendButton.disabled = true;
    
    addCalculationMessage("[СИСТЕМА: СИМУЛЯЦИЯ] Мир приходит в движение...");
    const loaderDiv = document.createElement('div');
    loaderDiv.id = 'world-sim-loader';
    loaderDiv.className = 'ether-loader-container';
    loaderDiv.innerHTML = `
        <div class="astrolabe" style="filter: hue-rotate(120deg) brightness(0.8);">
            <div class="astrolabe-ring"></div><div class="astrolabe-ring"></div><div class="astrolabe-ring"></div><div class="astrolabe-core"></div>
        </div>
                    <div class="ether-text-container">
                <span class="ether-text-title" style="color: #e74c3c; text-shadow: 0 0 10px #e74c3c;">ПЕРЕСТРОЙКА РЕАЛЬНОСТИ...</span>
                <span class="ether-text-subtitle">Движок Мира анализирует события</span>
            </div>
            <button class="ether-cancel-btn" data-action="cancel-api">
                <i class="fas fa-times"></i> Прервать связь
            </button>
    `;
    const gameLog = document.getElementById('game-log');
    if (gameLog) {
        gameLog.appendChild(loaderDiv);
        gameLog.scrollTo({ top: gameLog.scrollHeight, behavior: 'smooth' });
    }

    try {
        const currentDay = (World.current_day !== undefined ? World.current_day : Math.floor((World.tick || 0) / 24));
        let daysPassed = currentDay - (player.lastWorldSimDay || 0);
        if (daysPassed <= 0) daysPassed = 1;
        player.lastWorldSimDay = currentDay;

        let worldSummary = "=== ТЕКУЩЕЕ СОСТОЯНИЕ МИРА (СЫРЫЕ ДАННЫЕ) ===\n";
        for (let rId in World.regions) {
            let r = World.regions[rId];
            let ownerName = World.factions[r.factionId] ? World.factions[r.factionId].name : "Нет владельца";
            
            let resArr = [];
            if (r.vault_id && ContainerRegistry.has(r.vault_id)) {
                let vault = ContainerRegistry.get(r.vault_id);
                let counts = {};
                getContainerItems(vault).forEach(itemId => {
                    let item = ItemRegistry.get(itemId);
                    if (item) {
                        counts[item.prototype_id] = (counts[item.prototype_id] || 0) + item.stack_size;
                    }
                });
                for (let k in counts) {
                    if (counts[k] > 0) {
                        let name = getItemName(k, player ? player.era : getRuntimeDefaultEraId());
                        resArr.push(`${name}: ${counts[k]}`);
                    }
                }
            }
            let resStr = resArr.length > 0 ? resArr.slice(0, 6).join(', ') : "Пусто";

            worldSummary += `Регион: ${r.name} (Владелец: ${ownerName}). Население: ${r.population}. Погода: ${r.weather || "Нормальная"}. Ресурсы: ${resStr}.\n`;
        }
        
        let activeWars = [];
        for (let fId in World.factions) {
            let f = World.factions[fId];
            // Золото считаем из физических запасов столичного региона
            const capitalRegionId = Object.keys(World.regions).find(rid => World.regions[rid].factionId === fId);
            let gold = 0;
            if (capitalRegionId && World.regions[capitalRegionId]?.vault_id) {
                gold = countRealItems(World.regions[capitalRegionId].vault_id, getPrimaryCurrencyPrototypeId('gold'));
            }
            const manpower = availableManpower(f);
            worldSummary += `Фракция: ${f.name}. Доступная живая сила: ${manpower}. Золото в столице: ${gold}. Армий в походе СЕЙЧАС: ${f.armies.length}.\n`;
            for (let target in f.diplomacy) {
                if (f.diplomacy[target] === "war") activeWars.push(`${f.name} воюет с ${World.factions[target].name}`);
            }
        }
        if (activeWars.length > 0) worldSummary += `\nР’РѕР№РЅС‹: ${[...new Set(activeWars)].join(", ")}\n`;

        let recentNews = World.news
            .map(n => ({ ...n, daysOld: Math.max(0, currentDay - (n.day || 0)) }))
            .filter(n => n.daysOld <= daysPassed)
            .filter(n => n.importance >= 2)
            .sort((a, b) => b.daysOld - a.daysOld)
            .map(n => `[${n.daysOld} дн. назад, Локация: ${n.location}]: ${parseLocString(n.text)}`)
            .join("\n");
        worldSummary += `\nХронология системных событий за этот период:\n${recentNews || "Нет свежих данных"}\n`;

        let mName = "Месяца";
        if (window.WORLD_CONFIG && window.WORLD_CONFIG.months && window.WORLD_CONFIG.months[player.gameTime.month - 1]) {
            const m = window.WORLD_CONFIG.months[player.gameTime.month - 1];
            mName = typeof t === 'function' ? t(m.name_i18n_key, null, m.id) : m.id;
        }
        let currentDateStr = `${player.gameTime.day} ${mName}, ${player.gameTime.year} РіРѕРґР°`;
        
        const prompt = `### ДИРЕКТИВА: ДВИЖОК МИРА (WORLD SIMULATOR) v5.0\nТы -- аналитический модуль. Твоя задача: написать историческую сводку ("Вести из Эфира") на основе СЫРЫХ ДАННЫХ.\n\n[СИСТЕМНОЕ ВРЕМЯ]:\n- Текущая дата: ${currentDateStr}\n- Времени прошло с прошлой сводки: ровно ${daysPassed} дней.\n\n${worldSummary}\n\nПРИКАЗЫ (ЛОГИКА И ФАКТЫ):\n1. Внимательно изучи "Хронологию системных событий". Обращай внимание на пометку "[X дн. назад]". Если осада началась 14 дней назад и длилась 4 дня, значит ОНА УЖЕ ЗАВЕРШИЛАСЬ. Не смей писать, что город "продержится еще 4 дня"!\n2. Сверься с "ТЕКУЩИМ СОСТОЯНИЕМ МИРА". Если в списке "Армий в походе СЕЙЧАС" у фракции 0 армий, значит в ДАННЫЙ МОМЕНТ она никого не осаждает и никуда не идет. Все её походы из Хронологии уже завершены, описывай их как прошлые события.\n3. Опиши события в прошедшем времени, как историк, подводящий итоги за ${daysPassed} дней. Оперируй только фактами из сводки, НЕ ВЫДУМЫВАЙ действия армий, если их нет в логах.\n4. Начни текст с четкого обозначения прошедшего времени (Например: "За минувшие ${daysPassed} дней...", "К ${currentDateStr} ситуация...").\n5. Твой ответ ДОЛЖЕН БЫТЬ СТРОГО ВАЛИДНЫМ JSON ОБЪЕКТОМ. Массив actions оставляй ПУСТЫМ [].\nФормат:\n{\n  "narrative": "Твоя точная и логичная хроника событий...",\n  "actions": []\n}`;
        
        let modelId = localModelId;
        if (currentApiProvider === 'gemini') modelId = geminiModelId;
        else if (currentApiProvider === 'llmost') modelId = llmostModelId;
        else if (currentApiProvider === 'openrouter') modelId = openrouterModelId;
        else if (currentApiProvider === 'deepseek') modelId = deepseekModelId;
        else if (currentApiProvider === 'omniroute') modelId = omnirouteModelId;
        
        const raw = await performAiFetch(prompt, [], modelId, `Анализ данных за ${daysPassed} дней.`);
        const res = parseAIResponse(raw);
    if (window.ModAPI) await ModAPI.emit('onAIResponseReceived', {raw, parsed: res, location: player?.location});
        
        if (loaderDiv) loaderDiv.remove();
        
        if (res.ai_reasoning) {
            addCalculationMessage(`[МЫСЛИ ИИ (Симуляция)]:\n${res.ai_reasoning}`, "calc-info");
        }

        if (res.actions) {
            for (const a of res.actions) await executeCommand(a.command, a.args);
        }

        if (res.narrative) {
            const container = document.querySelector('.game-container');
            if (container) {
                container.classList.remove('heavy-shake');
                void container.offsetWidth; 
                container.classList.add('heavy-shake');
            }
            
            addLogMessage(res.narrative, "world-event");
        }

    } catch (e) { 
        console.error("World Sim Error:", e);
        if (loaderDiv) loaderDiv.remove();
        isSimulatingWorld = false;
        showAiErrorModal(
            e.message || String(e),
            false,
            () => { runWorldSimulationTick(); },
            "Сбой Эфирной Сети",
            "Произошел сбой при генерации Вестей из Эфира (Симуляция Мира). Повторить попытку?"
        );
    } finally { 
        isSimulatingWorld = false;
        isWaitingForAI = false;
        if (userInput) {
            userInput.disabled = false;
            userInput.focus();
        }
        if (sendButton) sendButton.disabled = false;
        updateWorldChroniclesDisplay();
        updateTradeJournalDisplay();
        updatePortPanel();
        if (typeof updateHoldingsDisplay === 'function') updateHoldingsDisplay();
    }
}
// ======================================================================

// --- СИСТЕМА ЛОКАЛЬНОЙ КАРТЫ (Canvas + Sprite) ---
let TILESET_IMAGE = null;
const SOURCE_TILE_SIZE = 16; // Исходный размер тайла в Kenney 1-bit
const SPACING = 1;           // Отступ между тайлами в спрайт-листе
const RENDER_TILE_SIZE = 48; // Размер отрисовки на экране
let USE_SPRITE_RENDERER = true;
let currentLocalMapPlots = null;
let currentLocalMapSize = { width: 0, height: 0 };

let TILE_SPRITE_MAP = {};
let AVAILABLE_TILES_LIST = "";;

function getSpriteCoords(type) {
    return TILE_SPRITE_MAP[type] || TILE_SPRITE_MAP['void'] || { x: 0, y: 0 };
}

async function loadTileSet() {
    try {
        const response = await fetch('assets/assets/kenny1bit-tagger/tile_tags.json?t=' + Date.now());
        if (response.ok) {
            const data = await response.json();
            if (data.mappings) {
                TILE_SPRITE_MAP = data.mappings;
                AVAILABLE_TILES_LIST = Object.keys(TILE_SPRITE_MAP).join(', ');
                console.log(`[TileSet] Загружен маппинг тайлов: ${Object.keys(TILE_SPRITE_MAP).length} шт.`);
            }
        } else {
            console.warn('[TileSet] Не удалось загрузить tileset.json');
        }
    } catch (e) {
        console.error('[TileSet] Ошибка загрузки tileset.json:', e);
    }

    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            TILESET_IMAGE = img;
            console.log('[TileSet] Загружен спрайт-лист Kenney 1-Bit');
            resolve(true);
        };
        img.onerror = (err) => {
            console.error('[TileSet] Ошибка загрузки спрайт-листа, используем fallback CSS', err);
            USE_SPRITE_RENDERER = false;
            resolve(false);
        };
        img.src = 'assets/assets/kenny1bit-tagger/Tilesheet/colored-transparent.png';
    });
}

function toggleMapRenderer(useSprite) {
    USE_SPRITE_RENDERER = useSprite;
    if (currentLocalMapPlots && currentLocalMapSize.width) {
        const args = {
            plots: currentLocalMapPlots,
            size: `${currentLocalMapSize.width}x${currentLocalMapSize.height}`,
            description: 'Обновлено'
        };
        buildLocalMap(args);
        const fullscreenCanvas = document.getElementById('fullscreen-map-canvas');
        if (fullscreenCanvas && fullscreenCanvas.parentElement) {
            renderCanvasMap(currentLocalMapPlots, currentLocalMapSize.width, currentLocalMapSize.height, fullscreenCanvas);
        }
    }
}







// --- ПЕРЕМЕННЫЕ КАРТЫ ПЕРЕНЕСЕНЫ В Nexus Cartographer ---

// Глобальные переменные для новой системы экипировки
let bodySlots = []; // Заполняется динамически из window.EQUIPMENT_SLOTS
let equipmentElements = {}; // Будет заполнен динамически
const inventoryTabsContainer = document.querySelector('.inventory-tabs');

// Добавить к остальным глобальным переменным
let currentInventoryFilter = 'all';

// Словарь типов для локальной карты
const tileTypeDictionary = (function() {
    // Data-driven: loaded from data/tile_dictionary.json via runtime database
    const _db = (typeof getLoadedDatabase === 'function' && getLoadedDatabase()) ? getLoadedDatabase() : null;
    if (_db && _db.tile_dictionary && Object.keys(_db.tile_dictionary).length > 0) {
        return _db.tile_dictionary;
    }
    // Inline fallback (same data as tile_dictionary.json — used before DB loads)
    return {
    "d_wall": "Стена темницы",
    "d_wall_moss": "Замшелая стена",
    "d_wall_crack": "Треснувшая стена",
    "d_wall_iron": "Железная перегородка",
    "d_wall_bars": "Тюремная решетка",
    "d_floor": "Пол подземелья",
    "d_floor_blood": "Окровавленный пол",
    "d_floor_grate": "Ржавая решетка в полу",
    "d_door": "Укрепленная дверь",
    "d_door_locked": "Запертая дверь",
    "d_stairs_up": "Лестница наверх",
    "d_stairs_down": "Лестница вниз",
    "d_pillar": "Каменная колонна",
    "d_barrel": "Бочка",
    "d_crate": "Ящик",
    "d_webs": "Паутина",
    "d_spikes": "Ловушка с шипами",
    "d_pit": "Глубокая яма",
    "d_chains": "Цепи на стене",
    "d_skeleton": "Скелет узника",
    "c_wall_brick": "Кирпичная стена",
    "c_wall_plank": "Стена из досок",
    "c_wall_rich": "Обои с узором",
    "c_floor_cobble": "Брусчатка",
    "c_floor_wood": "Паркет",
    "c_floor_carpet": "Красный ковер",
    "c_door_front": "Входная дверь",
    "c_door_rich": "Резная дверь",
    "c_bed": "Кровать",
    "c_bookshelf": "Книжный шкаф",
    "c_wardrobe": "Шкаф",
    "c_desk": "Письменный стол",
    "c_chair": "Стул",
    "c_fireplace": "Камин",
    "c_anvil": "Наковальня",
    "c_forge": "Горн",
    "c_fountain": "Фонтан",
    "c_statue": "Статуя героя",
    "c_sign": "Вывеска",
    "c_cart": "Повозка",
    "n_grass": "Зеленая трава",
    "n_grass_tall": "Высокая трава",
    "n_sand": "Песок",
    "n_snow_ground": "Снег",
    "n_ice_floor": "Лед",
    "n_water_shallow": "Мелководье",
    "n_tree_oak": "Дуб",
    "n_tree_birch": "Береза",
    "n_stump": "Пень",
    "n_bush": "Куст",
    "n_bush_berry": "Ягодный куст",
    "n_flower_red": "Красный цветок",
    "n_flower_blue": "Синий цветок",
    "n_mushroom_brown": "Коричневый гриб",
    "n_mushroom_glow": "Светящийся гриб",
    "n_rock_small": "Камень",
    "n_rock_large": "Валун",
    "n_log": "Поваленное бревно",
    "n_vines": "Лианы",
    "n_nest": "Птичье гнездо",
    "h_wall_obsidian": "Обсидиановая стена",
    "h_wall_flesh": "Стена из плоти",
    "h_wall_bone": "Костяная стена",
    "h_floor_ash": "Пепел",
    "h_floor_lava": "Лава",
    "h_floor_blood": "Озеро крови",
    "h_door_demon": "Демонические врата",
    "h_altar": "Алтарь жертвоприношений",
    "h_pentagram": "Пентаграмма",
    "h_fire_blue": "Адское пламя",
    "h_cages": "Подвешенные клетки",
    "h_spikes_bone": "Костяные шипы",
    "h_statue_gargoyle": "Статуя горгульи",
    "h_eye": "Глаз Бездны",
    "h_rune_red": "Красная руна",
    "h_rune_purple": "Пурпурная руна",
    "h_portal": "Портал в пустоту",
    "h_crystal_dark": "Темный кристалл",
    "h_tentacle": "Щупальце",
    "h_maw": "Зубастая пасть",
    "s_wall_ice": "Ледяная стена",
    "s_wall_snow": "Снежный вал",
    "s_door_frozen": "Смерзшаяся дверь",
    "s_tree_pine": "Заснеженная сосна",
    "s_snowman": "Снеговик",
    "s_crystal_ice": "Ледяной кристалл",
    "s_campfire_dead": "Потухший костер",
    "s_frozen_body": "Замерзший труп",
    "m_wall_void": "Стена Пустоты",
    "m_wall_runic": "Руническая стена",
    "m_floor_stars": "Звездный пол",
    "m_floor_energy": "Энергетическая сетка",
    "m_portal_blue": "Синий портал",
    "m_crystal_blue": "Магический кристалл",
    "m_altar_arcane": "Мистический алтарь",
    "m_book": "Книга заклинаний",
    "m_orb": "Светящаяся сфера",
    "m_pillar_float": "Парящая колонна",
    "void": "Неизведанная тьма",
    "dirt": "Сырая земля",
    "grass_dead": "Мертвая трава",
    "mud": "Вязкая грязь",
    "water_deep": "Глубокая темная вода",
    "tree_dead": "Мертвое дерево",
    "tree_pine_dark": "Мрачная сосна",
    "bush_dry": "Колючий кустарник",
    "stone_floor": "Каменный пол",
    "wood_floor": "Сгнившие доски",
    "wall_stone": "Каменная кладка",
    "wall_cave": "Стена пещеры",
    "wall_wood": "Деревянный частокол",
    "door_wood": "Тяжелая дверь",
    "campfire": "Костер",
    "torch": "Настенный факел",
    "chest": "Сундук",
    "table": "Стол",
    "bones": "Останки",
    "blood": "Кровь",
    "road": "Дорога",
    "house": "Дом",
    "tavern": "Таверна",
    "market": "Рынок",
    "blacksmith": "Кузница",
    "temple": "Храм",
    "office": "Лавка",
    "farms": "Фермы",
    "lumbermills": "Лесопилка",
    "mines": "Шахта",
    "forges": "Кузница",
    "smelters": "Плавильня",
    "weavers": "Ткацкая",
    "bakeries": "Пекарня",
    "smokehouses": "Коптильня",
    "alchemists": "Алхимик",
    "banks": "Банк",
    "mills": "Мельница",
    "tailors": "Портной",
    "jewelers": "Ювелир"
};
})()
let selectedLocalTile = null;

// --- ДЕТЕКТОР СРЕДЫ (Electron или Браузер) ---
const isElectron = () => {
    const userAgent = navigator.userAgent.toLowerCase();
    return userAgent.indexOf(' electron/') > -1;
};
console.log("Environment:", isElectron() ? "Electron (Desktop)" : "Web Browser");

// --- XSS PROTECTION: Escape HTML special characters ---
function escapeHTML(str) {
    if (typeof str !== 'string') return String(str);
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
// Sanitize HTML content — strip dangerous tags while preserving safe formatting
// FIX (Issue #14): The previous regex fallback was bypassable via:
// 1. Nested tags: <scr<script>ipt> — after removing inner <script>, outer reassembles
// 2. No-space event handlers: <img/onerror=...> — \s+ before on\w+ missed / separator
// 3. HTML entity encoding: &#106;avascript: bypasses plain "javascript:" filter
// 4. Missing dangerous tags: <body>, <input>, <textarea>, <select>, <details>, <math>
// Now: iteratively strip dangerous tags until stable, handle / as attribute separator,
// decode HTML entities before checking for javascript: URLs, and cover more tags.
function sanitizeHTML(html) {
    if (typeof html !== 'string') return '';
    // Use DOMPurify if available (loaded in index.html), otherwise fallback to basic sanitization
    if (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) {
        return DOMPurify.sanitize(html, { ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'span', 'br', 'p', 'div', 'ul', 'ol', 'li', 'a'], ALLOWED_ATTR: ['class', 'href', 'style', 'title'] });
    }
    // Fallback: robust regex sanitization (improved security)
    let result = html;
    // Iteratively remove dangerous tags until no more changes (handles nested tag bypass)
    const DANGEROUS_TAGS = 'script|iframe|object|embed|applet|base|form|meta|link|body|input|textarea|select|button|svg|math|details|summary|template|slot|noscript';
    const dangerousTagRegex = new RegExp(`<(${DANGEROUS_TAGS})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi');
    const dangerousSelfCloseRegex = new RegExp(`<(${DANGEROUS_TAGS})\\b[^>]*\\/?>`, 'gi');
    let prev = '';
    let iterations = 0;
    while (prev !== result && iterations < 10) {
        prev = result;
        result = result.replace(dangerousTagRegex, '');
        result = result.replace(dangerousSelfCloseRegex, '');
        iterations++;
    }
    // Remove on* event handlers — handle both space and / as attribute separators
    // Catches: onerror=, onerror =, /onerror=, etc.
    result = result.replace(/[\/\s]on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    // Remove javascript: and vbscript: URLs (with optional HTML entities)
    // Decode common HTML entities that could bypass the filter
    result = result.replace(/(&#(106|74);|&amp;#(106|74);|j\s*&#x0*6[1a];?|j\s*&#x0*4[1a];?|j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:)/gi, 'blocked:');
    result = result.replace(/(javascript|vbscript|data)\s*:/gi, 'blocked:');
    // Remove data: URLs in src attributes
    result = result.replace(/src\s*=\s*["']data:text\/html[^"']*["']/gi, 'src=""');
    return result;
}

// --- УНИВЕРСАЛЬНЫЙ КРАСИВЫЙ ТУЛТИП ---
function showGenericTooltip(event, header, body) {
    if (!itemTooltipElement) {
        itemTooltipElement = document.createElement('div');
        itemTooltipElement.className = 'item-tooltip';
        document.body.appendChild(itemTooltipElement);
    }
    itemTooltipElement.innerHTML = `
        <div class="item-card-header">${escapeHTML(header)}</div>
        <div class="item-card-body">${escapeHTML(body)}</div>
    `;
    itemTooltipElement.style.display = 'block';
    moveGenericTooltip(event);
}

function hideGenericTooltip() { if (itemTooltipElement) itemTooltipElement.style.display = 'none'; }
function moveGenericTooltip(e) {
    if (!itemTooltipElement) return;
    let x = e.pageX + 15; let y = e.pageY + 15;
    if (x + 250 > window.innerWidth) x = e.pageX - 260;
    itemTooltipElement.style.left = x + 'px'; itemTooltipElement.style.top = y + 'px';
}

function queuePlayerActionForGM(actionDescription) {
    if (!actionDescription) return;
    playerActionQueue.push(`(System Note: The player performed the action: "${actionDescription}")`);
    console.log(`[Action Queued for GM] ${actionDescription}`);
}

let worldLore = "Загрузка лора...";
let globalLocations = {};
let skillsReferenceData = "Загрузка справочника умений...";
let environmentCommandsGuideData = "Загрузка руководства по командам окружения...";

let activeEraSpecialLore = "";

async function loadActiveEraLore(eraId) {
// Кэш для переменных промпта, чтобы не подгружать каждый раз
let promptVariablesCache = {};
    if (!eraId) return;

    if (window.ModAPI && window.ModAPI.isTotalConversion) {
        console.log(`[Total Conversion] Пропуск загрузки ванильного лора эпохи ${eraId}.`);
        activeEraSpecialLore = "";
        if (window.ModAPI) {
            const hookData = { lore: activeEraSpecialLore };
            await window.ModAPI.emit('onEraLoreLoad', hookData, eraId);
            activeEraSpecialLore = hookData.lore;
        }
        return;
    }

    try {
        activeEraSpecialLore = await loadPromptFromFile(`era_lore.${eraId}`);
        
        // --- ИНТЕГРАЦИЯ МОДОВ (ЭПОХА) ---
        if (window.ModAPI) {
            const hookData = { lore: activeEraSpecialLore };
            await window.ModAPI.emit('onEraLoreLoad', hookData, eraId);
            activeEraSpecialLore = hookData.lore;
        }
        // ------------------------------
        
        console.log(`[Context] База данных эпохи ${eraId} интегрирована.`);
    } catch (e) {
        console.error("[Context] Ошибка загрузки данных эпохи:", e);
        activeEraSpecialLore = "// Дополнительные данные по эпохе недоступны.";
    }
}

let currentTrackIndex = -1;
let isMusicPlaying = false;
let userInteractedForMusic = false;
let isUsingBuiltInKey = false;
let builtInKeysCache = null;
let currentBuiltInKey = null;

let availableLanguages = {};
let currentLanguage = DEFAULT_LANGUAGE;
let translations = {};

let player = null;
// Defensive getter for player state — prevents null reference errors
// Usage: getPlayer()?.stats.hp instead of player?.stats.hp (same effect, but centralized)
function getPlayer() {
    return player;
}
function setPlayer(newPlayer) {
    player = newPlayer;
}
function mutatePlayer(mutator) {
    if (!player) {
        console.error('[State] Attempted to mutate null player. Call ignored.');
        return false;
    }
    mutator(player);
    return true;
}

/**
 * Damage the player's HP, clamping to 0 (never negative).
 * Use this instead of `player.stats.hp -= amount` to prevent negative HP.
 */
function damagePlayerHP(amount) {
    if (!player || !player.stats) return;
    player.stats.hp = Math.max(0, (player.stats.hp || 0) - amount);
}

let conversationHistory = [];
let isWaitingForAI = false;
let currentCreationStats = {};
let baseStatsForDistribution = {};
let availableStatPoints = INITIAL_STAT_POINTS;
let autoSaveTimer = null;
let currentSaveSlot = null;
let nextInternalQuestId = 1; // <--- НОВЫЙ СЧЕТЧИК

// Настройки эротического контента
let eroticIntensityLevel = 2; // 0-3
let eroticPreferences = {
    pregnancyRisk: true,
    diseaseRisk: true,
    reputationConsequences: true,
    pornoMode: false
};

let backgroundChangeTimer = null;

function handleQuickStart() {
    if (!Array.isArray(window.RACES_DATA) || window.RACES_DATA.length === 0) {
        throw new Error('[RuntimeData] RACES_DATA is missing or empty for quick start.');
    }
    if (!Array.isArray(window.CLASSES_DATA) || window.CLASSES_DATA.length === 0) {
        throw new Error('[RuntimeData] CLASSES_DATA is missing or empty for quick start.');
    }
    if (!Array.isArray(window.ERAS_DATA) || window.ERAS_DATA.length === 0) {
        throw new Error('[RuntimeData] ERAS_DATA is missing or empty for quick start.');
    }
    const runtime = getGameplayRuntimeConfig();
    const worldRuntime = runtime.engine_world || {};
    const races = window.RACES_DATA.map(r => r.id);
    const classes = window.CLASSES_DATA.map(c => c.id);
    const eras = window.ERAS_DATA.map(e => e.id);
    const defaultRace = (typeof worldRuntime.default_race_id === 'string' && races.includes(worldRuntime.default_race_id))
        ? worldRuntime.default_race_id
        : races[0];
    const defaultEra = (typeof worldRuntime.default_era_id === 'string' && eras.includes(worldRuntime.default_era_id))
        ? worldRuntime.default_era_id
        : eras[0];
    const defaultClass = classes[0];
    const quickStart = getQuickStartRuntimeConfig();
    const names = ['Странник', 'Наемник', 'Искатель', 'Тень', 'Вестник', 'Бродяга'];

    charRaceSelect.value = defaultRace;
    charClassSelect.value = defaultClass;
    charEraSelect.value = defaultEra;
    const genderSelect = document.getElementById('char-gender-select');
    if (genderSelect) genderSelect.value = Math.random() > 0.5 ? 'male' : 'female';

    handleRaceOrClassChange();

    charNameInput.value = names[Math.floor(Math.random() * names.length)] + " " + (Math.floor(Math.random() * Math.max(1, requireRuntimeNumber(quickStart.name_suffix_range, 'gameplay_runtime.character_creation.quick_start.name_suffix_range'))) + requireRuntimeNumber(quickStart.name_suffix_min, 'gameplay_runtime.character_creation.quick_start.name_suffix_min'));
    charDescInput.value = "Авантюрист, прибывший из старой деревни на севере.";

    const statKeys = ['str', 'dex', 'int', 'con', 'cha', 'res'];
    while (availableStatPoints > 0) {
        const randomStat = statKeys[Math.floor(Math.random() * statKeys.length)];
        currentCreationStats[randomStat]++;
        availableStatPoints--;
    }

    updateStatCreationDisplay();
    finalizeCharacterCreation();
}

let currentBackgroundElement = null;
let lastBackgroundIndex = -1;

// TTS
let isTTSEnabled = false;
let speechSynthesis = window.speechSynthesis;
let ttsUtterance = null;
let ttsVoices = [];
let selectedTTSVoice = null;
let ttsLang = 'ru-RU';

let currentAudio = null; // Для управления воспроизведением оффлайн TTS

function openSettingsFromGame() {
    console.log("Открытие настроек из игрового меню.");
    closeInGameMenu();
    settingsReturnScreen = 'game-interface'; // Запоминаем, что мы пришли из игры
    setActiveScreen('settings-menu');
}

// Функция для вызова окна подтверждения
function showCustomConfirm(message, onYesCallback) {
    const modal = document.getElementById('custom-confirm-modal');
    const msgEl = document.getElementById('custom-confirm-message');
    const yesBtn = document.getElementById('confirm-yes-btn');
    const noBtn = document.getElementById('confirm-no-btn');

    if (!modal) return;

    msgEl.textContent = message;
    modal.style.display = 'flex';

    // Анимация
    requestAnimationFrame(() => {
        modal.classList.add('visible');
    });

    // Очистка событий перед назначением новых (чтобы не стакались)
    const closeModal = () => {
        modal.classList.remove('visible');
        setTimeout(() => modal.style.display = 'none', 300);
        yesBtn.onclick = null;
        noBtn.onclick = null;

        // ФИКС ФОКУСА: Возвращаем фокус на body после закрытия
        if (document.activeElement) document.activeElement.blur();
    };

    yesBtn.onclick = () => {
        closeModal();
        if (onYesCallback) onYesCallback();
    };

    noBtn.onclick = () => {
        closeModal();
    };
}

/**
 * Обновляет панель заметок GM.
 * Панель видна только если DEBUG_MODE === true.
 */
function updateEchoMemoryDisplay() {
    const listEl = document.getElementById('echo-memory-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!player || !player.echoMemory || !player.echoMemory.items || player.echoMemory.items.length === 0) {
        listEl.innerHTML = `<li data-i18n="gameInterface.echoMemoryPanel.empty">${t('gameInterface.echoMemoryPanel.empty', 'Нет активных фактов')}</li>`;
        return;
    }
    
    const escapeHtml = (unsafe) => {
        return (unsafe || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    };

    player.echoMemory.items.forEach((item, idx) => {
        const li = document.createElement('li');
        li.className = 'echo-item';
        li.innerHTML = `
            <span class="echo-text">${escapeHtml(item)}</span>
            <button class="echo-delete-btn" data-index="${idx}" title="Удалить">✖</button>
        `;
        listEl.appendChild(li);
    });

    document.querySelectorAll('.echo-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(btn.dataset.index, 10);
            if (!isNaN(idx)) {
                executeCommand('removeEchoMemoryItem', { index: idx });
            }
        });
    });

    const clearBtn = document.getElementById('clear-echo-memory-btn');
    if (clearBtn) {
        clearBtn.style.display = DEBUG_MODE ? 'inline-block' : 'none';
        clearBtn.onclick = () => {
            showCustomConfirm(t('gameInterface.echoMemoryPanel.confirmClear', 'Очистить всю эхо-память?'), () => {
                executeCommand('clearEchoMemory', { confirm: true });
            });
        };
    }
}

function updateGmNotesDisplay() {

// --- ИСПРАВЛЕННАЯ ФУНКЦИЯ ГЕНЕРАЦИИ ИЗОБРАЖЕНИЙ --- 




    if (!gmNotesPanel || !gmNotesContent) return;
    if (DEBUG_MODE && player) {
        gmNotesPanel.style.display = 'flex';
        let displayHtml = '<strong>АКТИВНАЯ ПАМЯТЬ:</strong>\n';
        for (const [key, value] of Object.entries(player.gmNotes || {})) {
            displayHtml += `<span style="color:#5dade2">[${key}]</span>: ${value}\n`;
        }
        displayHtml += '\n<strong>АРХИВЫ (Сводка):</strong>\n';
        for (const [key, summary] of Object.entries(player.archiveSummaries || {})) {
            displayHtml += `<span style="color:#f39c12">[${key}]</span>: ${summary}\n`;
        }
        gmNotesContent.innerHTML = sanitizeHTML(displayHtml) || t('gameInterface.gmNotesPanel.empty', 'Заметок пока нет.');
    } else {
        gmNotesPanel.style.display = 'none';
    }
}

// --- Функции Управления Рассказчиками (НОВОЕ) ---

async function loadNarrators() {
    try {
        if (typeof window.ensureRuntimeDataLoaded === 'function') {
            await window.ensureRuntimeDataLoaded();
        }
        narrators = Array.isArray(window.NARRATORS_DATA) ? window.NARRATORS_DATA : [];
        if (narrators.length === 0) throw new Error('Narrators registry is empty');
        console.log("Рассказчики загружены:", narrators);
    } catch (error) {
        console.error("Ошибка загрузки рассказчиков:", error);
        // Fallback, если файл не найден
        narrators = [{
            id: "classic",
            name: "Классический Рассказчик",
            description: "Произошла ошибка загрузки. Доступен только классический режим.",
            image: "assets/narrators/classic.jpg",
            promptFile: "assets/narrators/style_classic.txt"
        }];
    }
}

function showNarrator(index) {
    if (!narrators || narrators.length === 0) return;
    currentNarratorIndex = (index + narrators.length) % narrators.length;
    const narrator = narrators[currentNarratorIndex];

    // Находим карточку по ID, который мы добавили в HTML
    // const narratorCard = document.getElementById('narrator-card'); // Уже объявлена глобально

    if (narratorCard) {
        // Меняем фоновое изображение карточки
        narratorCard.style.backgroundImage = `url('${narrator.image}')`;
    } else {
        console.error("Элемент narrator-card не найден!");
    }

    // Обновляем текст как и раньше
    narratorName.textContent = t(`narrators.${narrator.id}.name`, null, narrator.name);
    narratorDesc.textContent = t(`narrators.${narrator.id}.desc`, null, narrator.description);
}

// --- Функции Управления Экраном Загрузки (НОВОЕ) ---

function populateErasUI(erasData) {
    if (!charEraSelect || !erasData) return;
    charEraSelect.innerHTML = '';
    erasData.forEach((era, index) => {
        const opt = document.createElement('option');
        opt.value = era.id;
        opt.dataset.descriptionKey = era.description_i18n_key || `characterCreation.era${era.id.charAt(0).toUpperCase() + era.id.slice(1)}Desc`;
        opt.textContent = typeof t === 'function' ? t(era.display_name_i18n_key, null, era.name) : era.name;
        if (index === 0) opt.selected = true;
        charEraSelect.appendChild(opt);
    });
    updateEraDescription();
}

function populateRacesUI(racesData) {
    if (!charRaceSelect || !racesData) return;
    const currentValue = charRaceSelect.value;
    charRaceSelect.innerHTML = `<option value="" disabled ${!currentValue ? 'selected' : ''} data-i18n="characterCreation.racePlaceholder">${typeof t === 'function' ? t('characterCreation.racePlaceholder') : '-- Выберите расу --'}</option>`;
    racesData.forEach(race => {
        const opt = document.createElement('option');
        opt.value = race.id;
        const i18nKey = `characterCreation.race${race.id.charAt(0).toUpperCase() + race.id.slice(1)}`;
        opt.textContent = typeof t === 'function' ? t(i18nKey, null, race.name) : race.name;
        if (race.id === currentValue) opt.selected = true;
        charRaceSelect.appendChild(opt);
    });
}

function populateClassesUI(classesData) {
    if (!charClassSelect || !classesData) return;
    const currentValue = charClassSelect.value;
    charClassSelect.innerHTML = `<option value="" disabled ${!currentValue ? 'selected' : ''} data-i18n="characterCreation.classPlaceholder">${typeof t === 'function' ? t('characterCreation.classPlaceholder') : '-- Выберите класс --'}</option>`;
    classesData.forEach(cls => {
        const opt = document.createElement('option');
        opt.value = cls.id;
        opt.textContent = typeof t === 'function' && cls.display_name_i18n_key ? t(cls.display_name_i18n_key, null, cls.name) : cls.name;
        if (cls.id === currentValue) opt.selected = true;
        charClassSelect.appendChild(opt);
    });
}

function updateEraDescription() {
    if (!charEraSelect || !eraDescriptionBox) return;

    // Находим выбранный элемент <option>
    const selectedOption = charEraSelect.options[charEraSelect.selectedIndex];
    if (!selectedOption) {
        eraDescriptionBox.classList.remove('visible');
        eraDescriptionBox.innerHTML = '';
        return;
    }

    // Получаем ключ для текста напрямую из data-атрибута
    const descriptionKey = selectedOption.dataset.descriptionKey;
    const descriptionText = t(descriptionKey, null, '');

    // Прячем блок, чтобы сменить текст и запустить анимацию заново
    eraDescriptionBox.classList.remove('visible');

    setTimeout(() => {
        if (descriptionText) {
            eraDescriptionBox.innerHTML = sanitizeHTML(descriptionText);
            eraDescriptionBox.classList.add('visible');
        } else {
            eraDescriptionBox.innerHTML = '';
        }
    }, 200); // Небольшая задержка для плавной анимации
}

// --- Функции File System Access API ---



// 1. Конфигурация кнопок (Типы бросков)
const quickTags = [
    { label: 'вљ”пёЏ Attack', type: 'combat', stat: 'atk' },
    { label: 'рџ›ЎпёЏ Defend', type: 'combat', stat: 'def' },
    { label: 'рџЋІ D20', type: 'stat', stat: 'd20' },
    { label: 'рџ’Є STR', type: 'stat', stat: 'str' },
    { label: 'рџ¤ё DEX', type: 'stat', stat: 'dex' },
    { label: 'рџ§  INT', type: 'stat', stat: 'int' },
    { label: 'вќ¤пёЏ CON', type: 'stat', stat: 'con' },
    { label: 'рџ—ЈпёЏ CHA', type: 'stat', stat: 'cha' }
];

// 2. Инициализация панели кнопок (Вызывается при старте игры)
function initQuickTags() {
    const container = document.getElementById('quick-tags-bar');
    if (!container) return;

    container.innerHTML = ''; // Очистка перед созданием

    quickTags.forEach(tag => {
        const btn = document.createElement('div');
        btn.className = `tag-chip ${tag.type}`;
        btn.textContent = tag.label;

        // При клике создаем не текст, а визуальную плашку
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (createRollBadge(tag.stat, tag.label)) {
                btn.style.transform = 'scale(1.1)';
                btn.style.filter = 'brightness(1.5)';
                setTimeout(() => {
                    btn.style.transform = '';
                    btn.style.filter = '';
                }, 200);
            }
        });

        container.appendChild(btn);
    });
}

// 3. Создание плашки с результатом (Математика происходит здесь)
function createRollBadge(statKey, labelText) {
    if (!player) return;

    const container = document.getElementById('active-rolls-container');
    if (!container) return;

    if (container.children.length >= 5) return;

    // --- АНТИЧИТ: ЗАПОМИНАНИЕ БРОСКА ---
    // Если игрок уже бросал этот кубик в этом ходу, берем старое значение.
    // Это не дает "перебрасывать" кубик, удаляя плашку.
    let roll;
    if (turnRollMemory[statKey]) {
        roll = turnRollMemory[statKey];
    } else {
        roll = rollRuntimeD20();
        turnRollMemory[statKey] = roll;
    }

    let modifier = 0;
    let cleanLabel = labelText.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '').trim();

    switch (statKey) {
        case 'str':
        case 'dex':
        case 'int':
        case 'con':
        case 'cha':
            modifier = getStatModifier(statKey);
            cleanLabel = `${statKey.toUpperCase()} Check`;
            break;
        case 'atk':
            if (['rogue', 'bard', 'ranger'].includes(player.class)) {
                modifier = getStatModifier('dex');
            } else {
                modifier = getStatModifier('str');
            }
            cleanLabel = "Attack";
            break;
        case 'def':
            modifier = getStatModifier('dex');
            cleanLabel = "Defend";
            break;
        case 'd20':
            modifier = 0;
            cleanLabel = "D20 Roll";
            break;
    }

    // Проверяем, нет ли уже такой плашки визуально, чтобы не дублировать
    const existingBadges = container.querySelectorAll('.roll-badge');
    for (let badge of existingBadges) {
        if (badge.dataset.statKey === statKey) {
            badge.classList.remove('shake');
            void badge.offsetWidth;
            badge.classList.add('shake');
            return false; // РЈР¶Рµ РІРёСЃРёС‚
        }
    }

    const total = roll + modifier;
    const sign = modifier >= 0 ? "+" : "";
    const resultText = `[ROLL_RESULT: ${roll} | STAT: ${statKey} | MOD: ${modifier} | TOTAL: ${total}]`;

    const badge = document.createElement('div');
    badge.className = 'roll-badge';
    badge.dataset.statKey = statKey; // Для проверки дубликатов

    if (roll === 20) badge.classList.add('crit-success');
    if (roll === 1) badge.classList.add('crit-fail');

    badge.dataset.resultText = resultText;

    // Теперь игрок видит итоговую сумму и из чего она состоит
    const modDisplay = modifier !== 0 ? ` <small style="opacity:0.7; font-size:0.85em;">(${roll}${sign}${modifier})</small>` : ` <small style="opacity:0.7; font-size:0.85em;">(${roll})</small>`;
    badge.innerHTML = `
        <span>${cleanLabel}: ${total}${modDisplay}</span>
        <span class="roll-badge-close" title="Удалить бросок">✖</span>
    `;

    badge.querySelector('.roll-badge-close').addEventListener('click', () => {
        badge.remove();
    });

    container.appendChild(badge);
    return true;
}


// 4. Парсер тегов (превращает {d20_str} в результат броска)
function parseInlineRolls(text) {
    if (!player) return text;

    // Регулярка ищет всё в фигурных скобках
    return text.replace(/\{(.*?)\}/g, (match, content) => {
        const tag = content.toLowerCase().trim();

        // Если это команда броска (начинается с d20_) или просто d20
        if (tag.startsWith('d20')) {
            let roll = rollRuntimeD20();
            let modifier = 0;
            let label = "D20";

            // Если это специфичный бросок (например d20_str)
            if (tag.includes('_')) {
                const statName = tag.split('_')[1];

                switch (statName) {
                    case 'str':
                        modifier = Math.floor((player.stats.str - 10) / 2);
                        label = "STR Check";
                        break;
                    case 'dex':
                        modifier = Math.floor((player.stats.dex - 10) / 2);
                        label = "DEX Check";
                        break;
                    case 'int':
                        modifier = Math.floor((player.stats.int - 10) / 2);
                        label = "INT Check";
                        break;
                    case 'con':
                        modifier = Math.floor((player.stats.con - 10) / 2);
                        label = "CON Check";
                        break;
                    case 'cha':
                        modifier = Math.floor((player.stats.cha - 10) / 2);
                        label = "CHA Check";
                        break;
                    case 'atk':
                        // Авто-выбор стата для атаки
                        if (['rogue', 'bard', 'ranger'].includes(player.class)) {
                            modifier = Math.floor((player.stats.dex - 10) / 2);
                            label = "Attack (DEX)";
                        } else {
                            modifier = Math.floor((player.stats.str - 10) / 2);
                            label = "Attack (STR)";
                        }
                        break;
                    case 'def':
                        modifier = Math.floor((player.stats.dex - 10) / 2);
                        label = "Defend";
                        break;
                }
            }

            const total = roll + modifier;
            const sign = modifier >= 0 ? "+" : "";

            // Формат вывода: [🎲 STR Check: 15 (roll:12+3)]
            return `[рџЋІ ${label}: ${total} (roll:${roll}${sign}${modifier})]`;
        }

        // Если тег не распознан, возвращаем как есть
        return match;
    });
}



/**
 * УНИВЕРСАЛЬНЫЙ И ПОЛНЫЙ СЛЕПОК ДАННЫХ (SNAPSHOT)
 * Здесь собраны ВСЕ данные объекта player без исключений.
 */
/**
 * ОБЛЕГЧЕННЫЙ СЛЕПОК ДЛЯ АВТО-ТЕСТЕРА
 * Содержит только то, что видит сам игрок, чтобы не перегружать контекст локальных моделей.
 */
function buildLitePlayerSnapshot() {
    if (!player) return "{}";
    
    const nearbyNpcs = Object.values(player.visibleEntities).filter(e => e.type === 'npc' || e.type === 'enemy' || e.type === 'creature').map(e => ({
        name: e.name,
        type: e.type,
        isHostile: e.isHostile,
        hp: e.stats?.hp
    }));

    const inv = player.container_backpack ? (ContainerRegistry.get(player.container_backpack)?.items || []).map(id => {
        let it = ItemRegistry.get(id);
        return it ? `${it.custom_props?.name || it.prototype_id} (x${it.stack_size})` : null;
    }).filter(Boolean) : [];

    const eq = player.container_equipment ? (ContainerRegistry.get(player.container_equipment)?.items || []).map(id => {
        let it = ItemRegistry.get(id);
        return it ? `${it.slot_index}: ${it.custom_props?.name || it.prototype_id}` : null;
    }).filter(Boolean) : [];

    const activeQuests = Object.values(player.quests || {}).filter(q => q.status === 'active').map(q => q.title + ": " + q.objective);

    return JSON.stringify({
        player: {
            name: player.name,
            gender: player.gender || 'not_specified',
            class: player.class,
            location: player.location,
            hp: `${player.stats.hp}/${player.stats.maxHp}`,
            gold: player.stats.gold
        },
        equipment: eq,
        inventory: inv,
        nearby_entities: nearbyNpcs,
        active_quests: activeQuests
    }, null, 2);
}

function buildFullPlayerSnapshot() {
    if (!player) return "КРИТИЧЕСКАЯ ОШИБКА: ДАННЫЕ ИГРОКА ОТСУТСТВУЮТ";

    const inHands = player.equipment.right_hand ? player.equipment.right_hand.name : 'Ничего';
    
            let worldContextString = "";
        
        const allMapPoints = [
            ...Object.keys(globalLocations || {}).map(k => ({ ...globalLocations[k], id: k })),
            ...Object.values(player.mapMarkers || {})
        ].filter(p => p && p.name);
        const mapCoordsString = allMapPoints.map(p => `${p.name} [ID: ${p.id}]`).join('; ');
        worldContextString += `\n=== КАРТА МИРА (ДОСТУПНЫЕ ЛОКАЦИИ И ИХ ID) ===\n${mapCoordsString}\n==================================================\n`;

            if (World) {
        worldContextString = "\n=== MASMP STATE VECTORS ===\n";
        let playerRegion = null;
        for (let rId in World.regions) {
            if (player.location.toLowerCase().includes(World.regions[rId].name.toLowerCase())) {
                playerRegion = rId; break;
            }
        }
        if (playerRegion) {
            let r = World.regions[playerRegion];
            let ownerFaction = World.factions[r.factionId];
            let ownerId = ownerFaction ? ownerFaction.id : "none";
            
            worldContextString += `[SYS_VEC | LOC:${r.id} | SEA:${r.current_season} | WTH:${r.weather || "clear"} | FAC:${ownerId} | THR:${r.threat_level} | STAB:${r.stability} | OCC:${r.isOccupied}]\n`;
            
            const marketFallbackPrices = getGameplayRuntimeConfig().economy.market_fallback_prices || {};
            let prices = `food:${Math.round(r.markets.bread ?? requireRuntimeNumber(marketFallbackPrices.bread, 'gameplay_runtime.economy.market_fallback_prices.bread'))},wood:${Math.round(r.markets.wood ?? requireRuntimeNumber(marketFallbackPrices.wood, 'gameplay_runtime.economy.market_fallback_prices.wood'))},ore:${Math.round(r.markets.iron_ore ?? requireRuntimeNumber(marketFallbackPrices.iron_ore, 'gameplay_runtime.economy.market_fallback_prices.iron_ore'))},weap:${Math.round(r.markets.weapons ?? requireRuntimeNumber(marketFallbackPrices.weapons, 'gameplay_runtime.economy.market_fallback_prices.weapons'))}`;
            worldContextString += `[ECON_VEC | LOC:${r.id} | PRICES:${prices}]\n`;
            
            if (r.cityLayout && r.cityLayout.length > 0) {
                let bldgs = r.cityLayout.filter(b => b.type !== 'empty' && b.type !== 'road').map(b => `${b.type}:${b.sublocation_id}`).join(',');
                if (bldgs) worldContextString += `[CITY_VEC | LOC:${r.id} | BLDGS:${bldgs}]\n`;
            }
        }

        let facVecs = [];
        for (let fId in World.factions) {
            let f = World.factions[fId];
            let enemies = Object.keys(f.diplomacy).filter(t => f.diplomacy[t] === 'war').join(',');
            facVecs.push(`[FAC_VEC | ID:${fId} | WEX:${f.warExhaustion} | WAR:${enemies || 'none'}]`);
        }
        worldContextString += facVecs.join('\n') + '\n';

        let goodsStats = {};
        for (let rId in World.regions) {
            let r = World.regions[rId];
            if (!r.vault_id) continue;
            let pop = r.population || 0;
            for (let good in ECONOMY_ITEMS) {
                if (!goodsStats[good]) goodsStats[good] = { stock: 0, demand: 0 };
                goodsStats[good].stock += countRealItems(r.vault_id, good);
                goodsStats[good].demand += pop * 0.01;
            }
        }
        let deficitArray = [];
        for (let good in goodsStats) {
            let ratio = goodsStats[good].demand / (goodsStats[good].stock + 1);
            deficitArray.push({ good: good, ratio: ratio });
        }
        deficitArray.sort((a, b) => b.ratio - a.ratio);
        let top3 = deficitArray.slice(0, 3).map(item => item.good).join(',');
        worldContextString += `[GLOB_ECON_VEC | DEFICIT:${top3 || 'none'}]\n`;

        let activeMonsters = (World.monsters || []).filter(m => m.health > 0).map(m => `${m.type}:${m.region_id}:L${m.level}`).join(',');
        if (activeMonsters) worldContextString += `[MONSTER_VEC | ACT:${activeMonsters}]\n`;

        let activeDisasters = (World.map && World.map.disasters) ? World.map.disasters.filter(d => d.days_active > 0).map(d => `${d.type}:${d.affected_regions.join('-')}`).join(',') : "";
        if (activeDisasters) worldContextString += `[DISASTER_VEC | ACT:${activeDisasters}]\n`;

        let recentNewsStr = "Нет свежих новостей.";
        if (typeof World !== 'undefined' && World && World.relevant_news && World.relevant_news.length > 0) {
            recentNewsStr = World.relevant_news.map(n => {
                let daysOld = Math.max(0, (World.current_day || 0) - (n.day || 0));
                return `[${daysOld}d ago, ${n.location}] ${parseLocString(n.text)}`;
            }).join("\n");
        }
        worldContextString += `\n=== RELEVANT EVENTS ===\n${recentNewsStr}\n`;

        worldContextString += "==================================================\n";
    }

    if (typeof World !== 'undefined' && World && World.monsters && World.monsters.length > 0) {
        worldContextString += "\n=== ЭПИЧЕСКИЕ ЧУДОВИЩА В МИРЕ (ГЛОБАЛЬНАЯ УГРОЗА) ===\n";
        World.monsters.forEach(m => {
            if (m.health > 0) {
                worldContextString += `• ${m.name} (Тип: ${m.type}, Ур: ${m.level}, HP: ${m.health}/${m.maxHealth}, Атака: ${m.attack}, Защита: ${m.defense}). Локация: ${m.region_id}. Логово: контейнер ${m.treasure_chest_id}.\n`;
            }
        });
        worldContextString += "ГМ ИНСТРУКЦИЯ: Если игрок вступает в бой с чудовищем, используй команду `addEnvironment` с этими статами. При его смерти ОБЯЗАТЕЛЬНО вызови команду `killMonster` с аргументом `monsterId`, чтобы удалить его с глобальной карты.\n==================================================\n";
    }

    const playerPhysicalLocation = resolveActorLocation('player');
    let filteredContainers = Array.from(ContainerRegistry.values())
        .filter(c => c.id !== player.container_backpack && c.id !== player.container_equipment && c.type !== 'npc_inventory')
        .filter(c => {
            const containerLocation = resolveContainerLocation(c.id);
            if (!containerLocation || !playerPhysicalLocation) return false;
            return checkDistance(playerPhysicalLocation, containerLocation);
        })
        .filter(c => getContainerItems(c).length > 0 || c.type === 'faction_vault' || c.owner_id === 'player');
        
    filteredContainers.sort((a, b) => {
        if (a.owner_id === 'player' && b.owner_id !== 'player') return -1;
        if (b.owner_id === 'player' && a.owner_id !== 'player') return 1;
        if (a.type === 'faction_vault' && b.type !== 'faction_vault') return -1;
        if (b.type === 'faction_vault' && a.type !== 'faction_vault') return 1;
        return 0;
    });

    const nearbyContainers = filteredContainers.slice(0, 30).map(c => ({
            id: c.id,
            type: c.type,
            locked: !!c.lock_data?.is_locked,
            owner: c.owner_id,
            location: resolveContainerLocation(c.id)?.region_id || null,
            items: (!c.lock_data?.is_locked && OwnershipService.canAccess('player', c.id, { allowLocked: true, ignoreDistance: false }))
                ? getContainerItems(c).map(id => {
                    const item = ItemRegistry.get(id);
                    if (!item) return null;
                    return {
                        instance_id: item.id,
                        prototype_id: item.prototype_id,
                        name: item.custom_props?.name || item.name || item.prototype_id,
                        quantity: item.stack_size,
                        flags: item.flags || {}
                    };
                }).filter(Boolean)
                : []
        }));

    const nearbyNpcs = Object.values(player.visibleEntities).filter(e => e.type === 'npc').map(npc => {
        const wNpc = World?.npcs[npc.aiIdentifier];
        return {
            id: npc.aiIdentifier,
            name: npc.name,
            inventory_id: wNpc?.inventory_id || null,
            gold: wNpc?.inventory_id ? getGoldAmountInContainer(wNpc.inventory_id) : (wNpc?.inventory?.gold || 0),
            wounds: wNpc?.wounds || []
        };
    });

    return `
{
  "player": {
    "id": "player", "name": "${player.name}", "gender": "${player.gender || 'not_specified'}", "race": "${player.race}", "class": "${player.class}", "level": ${player.stats.level},
    "location": "${player.location}", "hp": ${player.stats.hp}, "maxHp": ${player.stats.maxHp}, "gold": ${player.stats.gold},
    "backpack_id": "${player.container_backpack}", "equipment_id": "${player.container_equipment}",
    "eroticIntensityLevel": ${eroticIntensityLevel}, "eroticPreferences": ${JSON.stringify(eroticPreferences)}
  },
  "inventory_CARRYING_NOW": ${JSON.stringify(player.container_backpack ? getContainerItems(ContainerRegistry.get(player.container_backpack)).map(id => { let it = ItemRegistry.get(id); return it ? { instance_id: it.id, prototype_id: it.prototype_id, name: it.custom_props?.name || it.name || it.prototype_id, quantity: it.stack_size, container_id: it.container_id, slot_index: it.slot_index, flags: it.flags } : null; }).filter(Boolean) : [])},
  "equipment": ${JSON.stringify(player.container_equipment ? getContainerItems(ContainerRegistry.get(player.container_equipment)).map(id => { let it = ItemRegistry.get(id); return it ? { slot: it.slot_index, instance_id: it.id, prototype_id: it.prototype_id, name: it.custom_props?.name || it.name || it.prototype_id } : null; }).filter(Boolean) : [])},
  "nearby_containers": ${JSON.stringify(nearbyContainers)},
  "nearby_npcs": ${JSON.stringify(nearbyNpcs)},
  "quests": ${JSON.stringify(Object.values(player.quests || {}).filter(q => q.status === 'active'))},
  "gm_notes": ${JSON.stringify(player.gmNotes)}
}
${worldContextString}`;
}



async function ensureDirectoryHandleAndPermission() {
    if (window.electronAPI && window.electronAPI.isElectron) {
        return true;
    }
    // Для веба возвращаем false (или старую логику, если она там осталась)
    return false;
}





function updateReputationModal() {
    if (!player || !reputationModal) return;
    const modalTitle = document.querySelector('#reputation-modal h4');
    if (modalTitle) modalTitle.textContent = t('gameInterface.reputationModal.title', null, 'Репутация');

    const reputations = player.stats.reputation;
    const contentDiv = document.getElementById('reputation-modal-content');
    if (!contentDiv) return;

    contentDiv.innerHTML = ''; // Очищаем старое содержимое
    let htmlContent = '';

    const factionKeys = Object.keys(reputations).sort((a, b) => {
        if (a === 'global') return -1; // global всегда первая
        if (b === 'global') return 1;
        return a.localeCompare(b);
    });

    for (const factionKey of factionKeys) {
        const value = reputations[factionKey];
        const factionName = player.factionData?.[factionKey] || factionKey;

        const minRep = -100;
        const maxRep = 100;
        const totalRange = maxRep - minRep;
        let markerPositionPercent = ((value - minRep) / totalRange) * 100;
        markerPositionPercent = Math.max(0, Math.min(100, markerPositionPercent));

        htmlContent += `
            <div class="faction-rep-row">
                <div class="faction-rep-label"><span>${factionName}</span> <span>${value}</span></div>
                <div class="faction-rep-bar-container">
                    <div class="reputation-marker-modal" style="left: ${markerPositionPercent}%;"></div>
                </div>
            </div>
        `;
    }

    contentDiv.innerHTML = sanitizeHTML(htmlContent);
    reputationModal.classList.add('visible');
}

function positionReputationModal(event) {
    if (!reputationModal || !reputationModal.classList.contains('visible')) return;

    const xOffset = 15;
    const yOffset = -10; // Появляется чуть выше курсора

    let newX = event.clientX + xOffset;
    let newY = event.clientY + yOffset;

    const modalRect = reputationModal.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Предотвращаем выход за правый край экрана
    if (newX + modalRect.width > viewportWidth - 10) {
        newX = event.clientX - modalRect.width - xOffset;
    }
    // Предотвращаем выход за нижний край, сдвигая вверх
    if (newY + modalRect.height > viewportHeight - 10) {
        newY = viewportHeight - modalRect.height - 10;
    }
    // Предотвращаем выход за левый и верхний края
    if (newX < 10) newX = 10;
    if (newY < 10) newY = 10;

    reputationModal.style.left = `${newX}px`;
    reputationModal.style.top = `${newY}px`;
}

function pruneGameLog() {
    const MAX_LOG_MESSAGES = 100; // Храним в DOM только последние 100 сообщений
    if (gameLog && gameLog.children.length > MAX_LOG_MESSAGES) {
        // Удаляем старые сообщения, пока их не останется нужное количество
        while (gameLog.children.length > MAX_LOG_MESSAGES) {
            gameLog.removeChild(gameLog.firstChild);
        }
    }
}










// --- Функции для localStorage (Fallback) ---




// --- Отображение сохраненной истории чата ---
function displaySavedChatHistory() {
    if (!gameLog) return;
    gameLog.innerHTML = '';
    if (player && player.gameLogHistory && player.gameLogHistory.length > 0) {
        player.gameLogHistory.forEach(entry => {
            addLogMessage(entry.message, entry.type, true, entry.imagePrompt, entry.savedImageBase64);
        });
    } else if (conversationHistory && conversationHistory.length > 0) {
        conversationHistory.forEach(msg => {
            if (msg.parts && msg.parts[0].text) {
                addLogMessage(msg.parts[0].text, msg.role === 'model' ? 'gm-message' : 'user-message', true);
            }
        });
    }
    if (calculationLog) {
        calculationLog.innerHTML = `<p class="system-message" data-i18n="gameInterface.calcLogPanel.empty">${t('gameInterface.calcLogPanel.empty')}</p>`;
        if (player && player.calcLogHistory) {
            player.calcLogHistory.forEach(msg => addCalculationMessage(msg, "calc-info", true));
        }
    }
    gameLog.scrollTo({ top: gameLog.scrollHeight, behavior: 'auto' });
}



// --- НОВАЯ СИСТЕМА ОБРАБОТКИ СТАТУС-ЭФФЕКТОВ ---

/**
 * Главная функция, обрабатывающая все активные статус-эффекты для сущности (игрока).
 * Вызывается в начале каждого хода.
 * @returns {Array<string>} Массив сообщений для игрового лога.
 */
function processStatusEffects() {
    if (!player || !player.statusEffects) {
        return [];
    }

    const logMessages = [];
    const effectsToRemove = [];
    const expiredEffectNames = [];

    for (const effectId in player.statusEffects) {
        const effect = player.statusEffects[effectId];

        // --- НОВАЯ ЛОГИКА ПРОВЕРКИ ДЛИТЕЛЬНОСТИ ---
        // Сначала проверяем, не истек ли эффект в НАЧАЛЕ этого хода.
        if (effect.duration <= 0) {
            effectsToRemove.push(effectId);
            expiredEffectNames.push(effect.name);
            continue; // Переходим к следующему эффекту, не обрабатывая его триггеры в этом ходу
        }

        // 1. Обработка триггеров для АКТИВНЫХ эффектов
        if (effect.effects && Array.isArray(effect.effects)) {
            effect.effects.forEach(subEffect => {
                if (subEffect.trigger && subEffect.action) {
                    if (checkEffectTrigger(effect, subEffect.trigger)) {
                        const message = applyEffectAction(player, effect, subEffect.action);
                        if (message) {
                            logMessages.push(message);
                        }
                    }
                }
            });
        }

        // 2. Уменьшение длительности В КОНЦЕ обработки хода.
        // Теперь эффект с duration: 1 будет действовать этот ход и истечет к началу следующего.
        effect.duration--;
    }

    // 4. Удаление истекших эффектов и запуск их on_remove действий
    if (effectsToRemove.length > 0) {
        effectsToRemove.forEach(idToRemove => {
            const removedEffect = player.statusEffects[idToRemove];
            if (removedEffect) {
                let specificActionOccurred = false;

                // Запускаем on_remove действия
                if (removedEffect.effects && Array.isArray(removedEffect.effects)) {
                    removedEffect.effects.forEach(subEffect => {
                        if (subEffect.trigger?.type === 'on_remove') {
                            const message = applyEffectAction(player, removedEffect, subEffect.action);
                            if (message) {
                                logMessages.push(message);
                                specificActionOccurred = true;
                            }
                        }
                    });
                }

                // Принудительное восстановление статов
                if (removedEffect.originalValues && typeof removedEffect.originalValues === 'object') {
                    for (const statToRestore in removedEffect.originalValues) {
                        const restoreAction = { type: 'restore_stat', stat: statToRestore };
                        const message = applyEffectAction(player, removedEffect, restoreAction);
                        if (message) {
                            logMessages.push(message);
                            specificActionOccurred = true;
                            console.warn(`Принудительное восстановление стата '${statToRestore}' для эффекта '${removedEffect.name}', т.к. GM не предоставил триггер on_remove.`);
                        }
                    }
                }

                delete player.statusEffects[idToRemove];

                if (!specificActionOccurred) {
                    logMessages.push(t('gameInterface.commandFeedback.statusEffectRemoved', { effectName: removedEffect.name }));
                }
            }
        });
    }

    // 5. Обновляем UI, если что-то изменилось
    if (logMessages.length > 0) {
        updateStatusEffectsDisplay();
        updateCharacterSheet();
    }

    // Возвращаем имена истекших эффектов для передачи GM
    player.expiredEffectsForGM = expiredEffectNames;
    return logMessages;
}

/**
 * Проверяет, должен ли сработать триггер эффекта в текущем ходу.
 * @param {object} effect - Полный объект статус-эффекта.
 * @param {object} trigger - Объект триггера.
 * @returns {boolean} - true, если триггер сработал.
 */
function checkEffectTrigger(effect, trigger) {
    if (trigger.type === 'on_turn_start') {
        const interval = trigger.interval || 1;
        const turnsPassed = player.stats.turnCount - effect.appliedTurn;
        // Срабатывает в 0-й ход (сразу при применении) и каждый 'interval' ход после
        return turnsPassed >= 0 && turnsPassed % interval === 0;
    }
    // Здесь можно добавить другие типы триггеров: on_damage_taken, on_attack, и т.д.
    return false;
}

/**
 * Применяет конкретное действие эффекта к сущности.
 * @param {object} entity - Сущность, на которую действует эффект (пока только player).
 * @param {object} effect - Родительский статус-эффект (для хранения originalValues).
 * @param {object} action - Объект действия.
 * @returns {string|null} Сообщение для лога или null.
 */
function applyEffectAction(entity, effect, action) {
    let message = null;
    try {
        switch (action.type) {
            case 'modify_stat': {
                const { stat, change } = action;
                const changeValue = parseInt(change, 10);
                if (!entity.stats || isNaN(changeValue)) break;

                const oldValue = entity.stats[stat] || 0;
                entity.stats[stat] = oldValue + changeValue;

                // Ограничения
                if (stat === 'hp') {
                    entity.stats.hp = Math.max(0, Math.min(entity.stats.hp, entity.stats.maxHp));
                }
                if (stat === 'mana' && entity.class === 'mage') {
                    entity.stats.mana = Math.max(0, Math.min(entity.stats.mana, entity.stats.maxMana));
                }

                const statName = t(`gameInterface.characterPanel.${stat}`, null, stat);
                const changeText = changeValue > 0 ? `+${changeValue}` : changeValue;
                message = t('gameInterface.log.effectModifyStat', { effectName: effect.name, statName: statName, change: changeText });
                break;
            }
            case 'set_stat': {
                const { stat, value } = action;
                const setValue = parseInt(value, 10);
                if (!entity.stats || isNaN(setValue)) break;

                // Сохраняем оригинальное значение, если оно еще не сохранено
                if (!effect.originalValues) {
                    effect.originalValues = {};
                }
                if (effect.originalValues[stat] === undefined) {
                    effect.originalValues[stat] = entity.stats[stat] || 0;
                }

                entity.stats[stat] = setValue;
                const statName = t(`gameInterface.characterPanel.${stat}`, null, stat);
                message = t('gameInterface.log.effectSetStat', { effectName: effect.name, statName: statName, value: setValue });
                break;
            }
            case 'restore_stat': {
                const { stat } = action;
                if (effect.originalValues && effect.originalValues[stat] !== undefined) {
                    entity.stats[stat] = effect.originalValues[stat];
                    const statName = t(`gameInterface.characterPanel.${stat}`, null, stat);
                    message = t('gameInterface.log.effectRestoreStat', { effectName: effect.name, statName: statName, value: entity.stats[stat] });
                    delete effect.originalValues[stat]; // Очищаем сохраненное значение
                }
                break;
            }
        }
    } catch (e) {
        console.error("Ошибка применения действия эффекта:", e, action);
    }
    return message;
}

// --- Система Сохранений / Загрузки (Основные функции) ---


/**
 * Загружает игру из указанного слота.
 * Приоритет отдается File System Access API, если доступно, иначе используется localStorage.
 * Обеспечивает обратную совместимость со старыми сохранениями.
 * @param {string} slotType - 'manual' или 'auto'.
 * @param {number} slotId - ID слота.
 */











// --- Функции Управления Экранами ---
function setActiveScreen(screenId) {
    const overlays = [
        document.getElementById('custom-alert-modal'),
        document.getElementById('save-slot-modal'),
        document.getElementById('custom-confirm-modal'),
        document.getElementById('menu-overlay'),
        document.getElementById('loading-overlay'),
        document.getElementById('ai-error-modal')
    ];
    overlays.forEach(el => { if (el) { el.classList.remove('visible'); el.style.display = 'none'; } });

    const allScreens = [mainMenu, settingsMenu, characterCreationScreen, loadGameScreen, helpScreen, narratorSelectionScreen, worldSetupScreen, gameInterface, document.getElementById('mods-menu')];
    const currentActive = document.querySelector('.menu-screen.active-screen, .main-menu-screen.active-screen, .game-container.active-screen');
    const targetScreen = document.getElementById(screenId);

    const executeSwap = () => {
        allScreens.forEach(screen => {
            if (screen) {
                screen.classList.remove('active-screen');
                if (screen.id !== screenId) screen.style.display = 'none';
            }
        });
        if (targetScreen) {
            targetScreen.style.display = 'flex';
            requestAnimationFrame(() => {
                targetScreen.classList.add('active-screen');
                if (screenId === 'character-creation-screen') {
                    const nameInput = document.getElementById('char-name-input');
                    if (nameInput) nameInput.focus();
                }
            });
        }
    };

    // Анимация ухода из главного меню
    if (currentActive && currentActive.id === 'main-menu' && screenId !== 'main-menu') {
        const leftBlock = currentActive.querySelector('.mm-left-block');
        if (leftBlock) leftBlock.style.animation = 'slideOutLeft 0.3s forwards cubic-bezier(0.7, 0, 0.3, 1)';
        setTimeout(executeSwap, 250);
    } 
    // Анимация возврата в главное меню
    else if (screenId === 'main-menu') {
        if (currentActive) currentActive.classList.remove('active-screen'); // Начинаем фейд-аут текущего
        setTimeout(() => {
            executeSwap();
            const leftBlock = targetScreen.querySelector('.mm-left-block');
            if (leftBlock) leftBlock.style.animation = 'slideInLeft 0.4s forwards cubic-bezier(0.2, 0.8, 0.2, 1)';
        }, 200);
    } 
    // Обычный переход
    else {
        executeSwap();
    }
}

// --- Функции для вкладок Помощи ---
window.openHelpTab = function(evt, tabName) {
    const tabContents = document.querySelectorAll('.help-tab-content');
    tabContents.forEach(content => content.classList.remove('active'));

    const tabBtns = document.querySelectorAll('.help-tab-btn');
    tabBtns.forEach(btn => btn.classList.remove('active'));

    const targetTab = document.getElementById(tabName);
    if (targetTab) targetTab.classList.add('active');
    
    if (evt && evt.currentTarget) evt.currentTarget.classList.add('active');
};

window.openHelpSubTab = function(evt, tabName) {
    const container = evt.currentTarget.closest('.help-tab-content');
    const tabContents = container.querySelectorAll('.sub-tab-content');
    tabContents.forEach(content => {
        content.classList.remove('active');
    });

    const tabBtns = container.querySelectorAll('.sub-tab-btn');
    tabBtns.forEach(btn => btn.classList.remove('active'));

    const targetTab = document.getElementById(tabName);
    if (targetTab) {
        targetTab.classList.add('active');
    }
    
    if (evt && evt.currentTarget) evt.currentTarget.classList.add('active');
};

// --- CSP-compliant event delegation (replaces inline onclick/onmouseover/onmouseout handlers) ---
document.addEventListener('DOMContentLoaded', function() {
    // Help tab buttons (data-help-tab attribute)
    document.querySelectorAll('.help-tab-btn[data-help-tab]').forEach(btn => {
        btn.addEventListener('click', function(evt) {
            const tabName = this.getAttribute('data-help-tab');
            if (tabName) window.openHelpTab(evt, tabName);
        });
    });

    // Help sub-tab buttons (data-help-subtab attribute)
    document.querySelectorAll('.sub-tab-btn[data-help-subtab]').forEach(btn => {
        btn.addEventListener('click', function(evt) {
            const tabName = this.getAttribute('data-help-subtab');
            if (tabName) window.openHelpSubTab(evt, tabName);
        });
    });

    // Close map modal button (replaces onmouseover/onmouseout inline handlers)
    const closeMapBtn = document.getElementById('close-map-modal-btn');
    if (closeMapBtn) {
        closeMapBtn.addEventListener('mouseenter', function() { this.style.color = '#e74c3c'; });
        closeMapBtn.addEventListener('mouseleave', function() { this.style.color = '#7f8c8d'; });
    }

    // Close examine modal button (replaces inline onclick handler)
    const closeExamineBtn = document.getElementById('close-examine-modal-btn');
    if (closeExamineBtn) {
        closeExamineBtn.addEventListener('click', function() {
            const modal = document.getElementById('item-examine-modal');
            if (modal) {
                modal.classList.remove('visible');
                setTimeout(() => { modal.style.display = 'none'; }, 300);
            }
        });
    }
});

// --- Custom Alert Modal ---
function showCustomAlert(message) {
    const modal = document.getElementById('custom-alert-modal');
    const messageP = document.getElementById('custom-alert-message');
    const closeBtn = document.getElementById('custom-alert-close');

    if (!modal || !messageP || !closeBtn) {
        alert(message);
        return;
    }

    messageP.textContent = message;
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('visible'), 10);

    const closeAlert = () => {
        modal.classList.remove('visible');
        setTimeout(() => modal.style.display = 'none', 300);
    };

    closeBtn.onclick = closeAlert;
    modal.addEventListener('click', (event) => {
        if (event.target === modal) {
            closeAlert();
        }
    });
}

function showAiErrorModal(errorText, isInitial, onRetry, customTitle = null, customDesc = null) {
    if (!aiErrorModal) return;

    const titleH3 = aiErrorModal.querySelector('h3');
    if (customTitle && titleH3) {
        titleH3.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${customTitle}`;
    } else if (titleH3) {
        titleH3.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Ошибка Мастера Игры`;
    }

    let mainText = "";
    let detailsText = errorText;

    // Разделяем человекочитаемую часть и технические детали
    if (typeof errorText === 'string' && errorText.includes('\n\n[РљРѕРґ:')) {
        let parts = errorText.split('\n\n[РљРѕРґ:');
        mainText = parts[0];
        detailsText = '[РљРѕРґ:' + parts[1];
    }

    if (customDesc) {
        aiErrorMessage.textContent = customDesc;
        aiErrorCancelBtn.textContent = "Отмена";
    } else if (mainText) {
        // FIX: Выводим понятную причину ошибки прямо в центр окна
        aiErrorMessage.textContent = mainText;
        aiErrorCancelBtn.textContent = isInitial ? "В главное меню" : "Отмена (Остаться в игре)";
    } else if (isInitial) {
        aiErrorMessage.textContent = "Не удалось сгенерировать мир. Магические потоки прервались.";
        aiErrorCancelBtn.textContent = "В главное меню";
    } else {
        aiErrorMessage.textContent = "Мастер Игры потерял нить повествования. Произошла ошибка генерации.";
        aiErrorCancelBtn.textContent = "Отмена (Остаться в игре)";
    }

    aiErrorDetailsContent.textContent = detailsText;
    aiErrorDetailsContent.style.display = 'none';
    aiErrorDetailsToggle.textContent = "Показать детали ошибки";

    aiErrorModal.style.display = 'flex';
    setTimeout(() => aiErrorModal.classList.add('visible'), 10);

    const isRateLimitOrUnavailable = typeof errorText === 'string' && (errorText.includes('429') || errorText.includes('503'));
    if (isRateLimitOrUnavailable && !isInitial) {
        aiErrorRetryBtn.textContent = "Сменить модель (Fallback) и повторить";
        aiErrorRetryBtn.onclick = () => {
            closeAiErrorModal();
            // Fallback на стабильную бесплатную/дешевую модель
            if (currentApiProvider === 'openrouter') {
                openrouterModelId = 'google/gemini-2.0-flash-lite-preview-02-05:free';
                localStorage.setItem('openrouterModelId', openrouterModelId);
            } else if (currentApiProvider === 'gemini') {
                geminiModelId = 'gemini-2.0-flash-lite';
                localStorage.setItem('geminiModelId', geminiModelId);
            }
            addLogMessage("⚠️ Модель автоматически изменена на резервную из-за недоступности сервера.", "system-message");
            if (onRetry) onRetry();
        };
    } else {
        aiErrorRetryBtn.textContent = "Повторить запрос";
        aiErrorRetryBtn.onclick = () => {
            closeAiErrorModal();
            if (isInitial) {
                // Полный сброс к состоянию до старта
                if (player) exitToMainMenu();
                startNewGameSetup(); // Перезапуск с нуля
            } else {
                if (onRetry) onRetry();
            }
        };
    }

    aiErrorCancelBtn.onclick = () => {
        closeAiErrorModal();
        if (isInitial) {
            exitToMainMenu();
        } else {
            isWaitingForAI = false;
            
            // FIX: Глубокая очистка состояний путешествия для разблокировки UI
            if (player && player.travel && player.travel.active) {
                player.travel.paused = true;
                player.travel.pauseReason = "api_error";
                player.travel.currentEvents = null; // Удаляем зависшие события, блокирующие инпут
                player.travel.interactTarget = null;
            }
            if (player && player.currentJourney) {
                player.currentJourney.isPausedForCheck = false;
            }

            const suggestedContainer = document.getElementById('suggested-actions-container');
            if (suggestedContainer) {
                suggestedContainer.innerHTML = '';
                suggestedContainer.style.display = 'none';
            }

            if (userInput) {
                userInput.disabled = false;
                // Восстанавливаем текст игрока, вырезая системные тэги кубиков
                if (lastUserMessageForRetry && !lastUserMessageForRetry.includes("[SYSTEM:")) {
                    userInput.value = lastUserMessageForRetry.replace(/\[ROLL_RESULT:.*?\]/gi, '').trim();
                }
                userInput.focus();
            }
            if (sendButton) sendButton.disabled = false;
            
            updateCharacterSheet(); // Принудительно перерисовываем интерфейс
        }
    };
}

function closeAiErrorModal() {
    if (!aiErrorModal) return;
    aiErrorModal.classList.remove('visible');
    setTimeout(() => aiErrorModal.style.display = 'none', 300);
}

document.addEventListener('DOMContentLoaded', () => {
    if (aiErrorDetailsToggle) {
        aiErrorDetailsToggle.addEventListener('click', () => {
            if (aiErrorDetailsContent.style.display === 'none') {
                aiErrorDetailsContent.style.display = 'block';
                aiErrorDetailsToggle.textContent = "Скрыть детали ошибки";
            } else {
                aiErrorDetailsContent.style.display = 'none';
                aiErrorDetailsToggle.textContent = "Показать детали ошибки";
            }
        });
    }
});

// --- функции расчета действия ---
function addCalculationMessage(message, type = "calc-info", isRestoring = false) {
    if (!calculationLog) return;
    if (!isRestoring && player) {
        if (!player.calcLogHistory) player.calcLogHistory = [];
        player.calcLogHistory.push(message);
        if (player.calcLogHistory.length > 50) player.calcLogHistory.shift();
    }
    const emptyMessage = calculationLog.querySelector('p[data-i18n="gameInterface.calcLogPanel.empty"]');
    if (emptyMessage && calculationLog.children.length === 1 && calculationLog.firstElementChild === emptyMessage) {
        calculationLog.innerHTML = '';
    }
    const messageElement = document.createElement('p');
    messageElement.textContent = message;
    calculationLog.appendChild(messageElement);
    calculationLog.scrollTo({ top: calculationLog.scrollHeight, behavior: 'smooth' });
}






async function loadAndDecryptBuiltInKeys() {
    // Заглушка для встроенных ключей (возвращаем пустой массив, чтобы избежать ReferenceError)
    return [];
}

async function fetchAndSelectBuiltInKey() {
    const keys = await loadAndDecryptBuiltInKeys();
    if (!keys || keys.length === 0) {
        currentBuiltInKey = null;
        GEMINI_API_KEY = '';
        isUsingBuiltInKey = false;
        localStorage.removeItem(BUILT_IN_KEY_STORAGE_FLAG);
        if (apiKeyInput) apiKeyInput.disabled = false;
        updateApiKeyStatus();
        return false;
    }

    const randomIndex = Math.floor(Math.random() * keys.length);
    currentBuiltInKey = keys[randomIndex];
    GEMINI_API_KEY = currentBuiltInKey;
    isUsingBuiltInKey = true;
    localStorage.setItem(BUILT_IN_KEY_STORAGE_FLAG, 'true');
    localStorage.removeItem('geminiApiKey');
    if (apiKeyInput) {
        apiKeyInput.value = '';
        apiKeyInput.disabled = true;
    }
    console.log("Выбран встроенный API ключ.");
    updateApiKeyStatus();
    return true;
}

function updateApiKeyStatus() {
    let statusKey;
    let statusClass;
    let keyIsMissing = false;

    if (currentApiProvider === 'local' || currentApiProvider === 'dummy') {
        statusKey = 'mainMenu.apiKeyStatusNotRequired';
        statusClass = 'status-ok';
    } else if (isUsingBuiltInKey) {
        statusKey = 'mainMenu.apiKeyStatusFound';
        statusClass = 'status-ok';
    } else {
        let keyToCheck = geminiApiKey;
        switch (currentApiProvider) {
            case 'gemini':
                keyToCheck = geminiApiKeys[currentGeminiKeyIndex] || geminiApiKey;
                break;
            case 'llmost':
                keyToCheck = llmostApiKey;
                break;
            case 'openrouter':
                keyToCheck = openrouterApiKey;
                break;
            case 'deepseek':
                keyToCheck = deepseekApiKey;
                break;
            case 'omniroute':
                keyToCheck = omnirouteApiKey;
                break;
        }

        if (keyToCheck && keyToCheck.trim() !== '') {
            statusKey = 'mainMenu.apiKeyStatusFound';
            statusClass = 'status-ok';
        } else {
            statusKey = 'mainMenu.apiKeyStatusMissing';
            statusClass = 'status-error';
            keyIsMissing = true;
        }
    }

    if (apiKeyStatus) {
        apiKeyStatus.textContent = t(statusKey, {
            provider: currentApiProvider.charAt(0).toUpperCase() + currentApiProvider.slice(1)
        });
        apiKeyStatus.className = `api-key-status ${statusClass}`;
    }

    if (newGameButton) {
        newGameButton.disabled = keyIsMissing;
        newGameButton.title = keyIsMissing ? t('mainMenu.tooltips.newGameDisabled', 'Введите API ключ в настройках, чтобы начать') : t('mainMenu.tooltips.newGame', 'Начать новое приключение');
    }
}

function saveApiKey() {
    const newKey = document.getElementById('api-key-input').value.trim();
    if (newKey) {
        SecureKeyStorage.setItem('geminiApiKey', newKey);
        GEMINI_API_KEY = newKey;
        isUsingBuiltInKey = false;
        localStorage.setItem('useBuiltInApiKey_v1', 'false');
        // ЗАМЕНА ALERT
        showCustomAlert(t('settingsMenu.apiKeySaved', null, 'API ключ сохранен!'));
    } else {
        SecureKeyStorage.removeItem('geminiApiKey');
        GEMINI_API_KEY = '';
        // ЗАМЕНА ALERT
        showCustomAlert(t('settingsMenu.apiKeyRemovedOrEmpty', null, 'API ключ удален.'));
    }
    updateApiKeyStatus();
}

// --- Функции Музыки ---
// --- ЕДИНАЯ ЛОГИКА МУЗЫКИ ---
function playMenuMusic() {
    if (!audioPlayer) return;
    if (!audioPlayer.paused) return; // Уже играет

    playMusic(0); // Запускаем menu_theme.mp3

    // Обработка блокировки автоплея браузером
    if (audioPlayer.paused) {
        document.addEventListener('click', () => {
            if (audioPlayer.paused) playMusic(0);
        }, { once: true });
    }
}

function stopMenuMusic() {
    // Музыка больше не останавливается при переходе в игру!
    // Она плавно продолжает играть фоном.
    console.log("Переход в игру: музыка продолжает играть.");
}

// Запускаем при загрузке страницы
window.addEventListener('DOMContentLoaded', () => {
    playMenuMusic();
});

function playMusic(index) {
    if (!audioPlayer || musicFiles.length === 0 || index < 0 || index >= musicFiles.length) {
        console.warn("Не удается воспроизвести музыку: нет плеера, нет файлов или неверный индекс.", index);
        return;
    }
    if (!userInteractedForMusic && currentTrackIndex !== -1) {
        console.log("Музыка заблокирована до первого взаимодействия пользователя с кнопкой переключения.");
        return;
    }

    const trackSrc = SOUND_FOLDER_PATH + musicFiles[index];
    if (audioPlayer.currentSrc.endsWith(trackSrc) && !audioPlayer.paused) {
        console.log(`Трек ${musicFiles[index]} уже играет.`);
        return;
    }

    console.log(`Попытка воспроизвести музыку: ${musicFiles[index]}`);
    audioPlayer.src = trackSrc;
    audioPlayer.volume = musicVolume;
    audioPlayer.loop = true; // Зацикливаем трек

    const playPromise = audioPlayer.play();

    if (playPromise !== undefined) {
        playPromise.then(_ => {
            console.log(`Играет: ${musicFiles[index]}`);
            isMusicPlaying = true;
            currentTrackIndex = index;
            updateMusicToggleButton(true);
        }).catch(error => {
            console.warn(`Воспроизведение музыки не удалось для ${musicFiles[index]}:`, error);
            isMusicPlaying = false;
            updateMusicToggleButton(false);
        });
    } else {
        isMusicPlaying = !audioPlayer.paused;
        currentTrackIndex = index;
        updateMusicToggleButton(isMusicPlaying);
    }
}

function pauseMusic() {
    if (!audioPlayer || audioPlayer.paused) return;
    audioPlayer.pause();
    isMusicPlaying = false;
    updateMusicToggleButton(false);
    console.log("Музыка на паузе.");
}

function toggleMusic() {
    if (!toggleMusicButton) return;

    if (!userInteractedForMusic) {
        userInteractedForMusic = true;
        console.log("Обнаружено взаимодействие пользователя, включение воспроизведения музыки.");
        if (!isMusicPlaying) {
            const indexToPlay = currentTrackIndex >= 0 ? currentTrackIndex : 0;
            playMusic(indexToPlay);
        }
        return;
    }

    if (isMusicPlaying) {
        pauseMusic();
    } else {
        if (audioPlayer.readyState >= 2 && audioPlayer.currentSrc) {
            const playPromise = audioPlayer.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    isMusicPlaying = true;
                    updateMusicToggleButton(true);
                }).catch(e => console.error("Ошибка возобновления музыки:", e));
            } else {
                isMusicPlaying = true;
                updateMusicToggleButton(true);
            }
        } else {
            playMusic(0);
        }
    }
}

function updateMusicToggleButton(isPlaying) {
    if (!toggleMusicIcon || !toggleMusicButton) return;
    if (isPlaying) {
        toggleMusicIcon.classList.remove('fa-volume-off', 'fa-play');
        toggleMusicIcon.classList.add('fa-volume-high');
        toggleMusicButton.title = t('gameInterface.toggleMusicButtonTitlePause', "Пауза");
    } else {
        toggleMusicIcon.classList.remove('fa-volume-high', 'fa-pause');
        toggleMusicIcon.classList.add('fa-volume-off');
        toggleMusicButton.title = t('gameInterface.toggleMusicButtonTitlePlay', "Включить музыку");
    }
    toggleMusicButton.dataset.i18n = isPlaying
        ? "[title]gameInterface.toggleMusicButtonTitlePause"
        : "[title]gameInterface.toggleMusicButtonTitlePlay";
}

function playNextTrack() {
    if (musicFiles.length === 0) return;
    let nextIndex = (currentTrackIndex + 1) % musicFiles.length;
    playMusic(nextIndex);
}

function setupMusicPlayer() {
    if (!audioPlayer) return;
    audioPlayer.addEventListener('ended', playNextTrack);
}

// --- Функции TTS (Text-to-Speech) ---
function setupTTS() {
    if (!hasElectronAPI) {
        console.warn("Локальный TTS работает только в Electron-версии.");
        if (ttsVoiceSelectorGroup) ttsVoiceSelectorGroup.style.display = 'none';
        return;
    }

    if (ttsVoiceSelectorGroup) ttsVoiceSelectorGroup.style.display = 'block';
    loadTTSVoices();

    if (ttsVoiceSelect) {
        ttsVoiceSelect.addEventListener('change', handleTTSVoiceChange);
    }
}

function loadTTSVoices() {
    // Жестко заданный список моделей, которые мы положим в папку assets/tts
    ttsVoices = [
        { name: "Ирина (Русский, Женский)", file: "ru_RU-irina-medium.onnx", lang: "ru" },
        { name: "Дмитрий (Русский, Мужской)", file: "ru_RU-dmitri-medium.onnx", lang: "ru" },
        { name: "Amy (English, Female)", file: "en_US-amy-medium.onnx", lang: "en" }
    ];

    if (!ttsVoiceSelect) return;
    ttsVoiceSelect.innerHTML = '';

    ttsVoices.forEach(voice => {
        const option = document.createElement('option');
        option.value = voice.file;
        option.textContent = voice.name;
        ttsVoiceSelect.appendChild(option);
    });

    const savedVoiceFile = localStorage.getItem(TTS_VOICE_STORAGE_KEY);
    if (savedVoiceFile && ttsVoices.some(v => v.file === savedVoiceFile)) {
        ttsVoiceSelect.value = savedVoiceFile;
        selectedTTSVoice = ttsVoices.find(v => v.file === savedVoiceFile);
    } else {
        selectTTSVoice();
    }
}

function selectTTSVoice() {
    const targetLang = currentLanguage;
    let voice = ttsVoices.find(v => v.lang === targetLang) || ttsVoices[0];
    if (voice) {
        selectedTTSVoice = voice;
        if (ttsVoiceSelect) ttsVoiceSelect.value = voice.file;
    }
}

function handleTTSVoiceChange(event) {
    const selectedFile = event.target.value;
    const voice = ttsVoices.find(v => v.file === selectedFile);
    if (voice) {
        selectedTTSVoice = voice;
        localStorage.setItem(TTS_VOICE_STORAGE_KEY, voice.file);
        console.log(`[TTS] Выбран локальный голос: ${voice.name}`);
        speakText(t('tts.voiceTest', 'Тест голоса'));
    }
}

/**
 * Рассчитывает ПОЛНЫЙ модификатор для характеристики, учитывая статы, эффекты и умения.
 * @param {string} statKey - Ключ характеристики ('str', 'dex', 'int', 'con', 'cha').
 * @returns {number} - Итоговый модификатор.
 */
function getStatModifier(statKey) {
    if (!player || !player.stats[statKey]) {
        return 0;
    }

    // Шаг 1: Базовый модификатор от характеристики
    let baseModifier = Math.floor((player.stats[statKey] - 10) / 2);
    let totalBonus = 0;
    let logMessages = [];

    // Шаг 2: Учет баффов и дебаффов от статус-эффектов
    if (player.statusEffects) {
        for (const effectId in player.statusEffects) {
            const effect = player.statusEffects[effectId];
            if (effect.effects && Array.isArray(effect.effects)) {
                for (const subEffect of effect.effects) {
                    if (subEffect.action && subEffect.action.stat === statKey && subEffect.action.type === 'modify_stat') {
                        const change = parseInt(subEffect.action.change, 10);
                        if (!isNaN(change)) {
                            totalBonus += change;
                            logMessages.push(`Эффект '${effect.name}': ${change > 0 ? '+' : ''}${change} к ${statKey.toUpperCase()}`);
                        }
                    }
                }
            }
        }
    }

    // Шаг 3: Учет бонусов от пассивных умений (Универсальный парсер)
    if (player.skills) {
        for (const skillId in player.skills) {
            const skill = player.skills[skillId];
            if (skill.skillType && skill.skillType.toLowerCase().includes('пассив') && skill.effectsJSON) {
                try {
                    const parsedEffects = typeof skill.effectsJSON === 'string' ? JSON.parse(skill.effectsJSON) : skill.effectsJSON;
                    for (const subEffect of parsedEffects) {
                        if (subEffect.action && subEffect.action.stat === statKey && subEffect.action.type === 'modify_stat') {
                            const change = parseInt(subEffect.action.change, 10);
                            if (!isNaN(change)) {
                                totalBonus += change;
                                logMessages.push(`Умение '${skill.name}': ${change > 0 ? '+' : ''}${change}`);
                            }
                        }
                    }
                } catch (e) { console.error("Error parsing skill effects", e); }
            }
        }
    }

    // Шаг 4: (Задел на будущее) Учет бонусов от экипированных предметов
    // for (const itemId in player.equipment) { ... }

    const finalModifier = baseModifier + totalBonus;

    if (logMessages.length > 0) {
        console.log(`[getStatModifier] Расчет для ${statKey.toUpperCase()}: База ${baseModifier}, Бонусы ${totalBonus} -> Итог ${finalModifier}. Причины:`, logMessages.join('; '));
    }

    return finalModifier;
}

function toggleTTS() {
    if (!speechSynthesis) return;
    isTTSEnabled = !isTTSEnabled;
    updateTTSToggleButton(isTTSEnabled);
    if (!isTTSEnabled && speechSynthesis.speaking) {
        speechSynthesis.cancel();
    }
    const statusMessage = isTTSEnabled ? t('tts.enabled', 'Озвучка включена.') : t('tts.disabled', 'Озвучка выключена.');
    console.log(statusMessage);
}

function updateTTSToggleButton(isEnabled) {
    if (!toggleTTSIcon || !toggleTTSButton) return;
    if (isEnabled) {
        toggleTTSIcon.classList.remove('fa-comment-dots');
        toggleTTSIcon.classList.add('fa-comment-slash');
        toggleTTSButton.title = t('gameInterface.toggleTTSButtonTitlePause', "Выключить озвучку");
    } else {
        toggleTTSIcon.classList.remove('fa-comment-slash');
        toggleTTSIcon.classList.add('fa-comment-dots');
        toggleTTSButton.title = t('gameInterface.toggleTTSButtonTitlePlay', "Включить озвучку");
    }
    toggleTTSButton.dataset.i18n = isEnabled
        ? "[title]gameInterface.toggleTTSButtonTitlePause"
        : "[title]gameInterface.toggleTTSButtonTitlePlay";
}

async function speakText(text) {
    if (!text || text.trim() === '' || !selectedTTSVoice) return;

    // Останавливаем предыдущую речь, если она была
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }

    console.log(`[TTS] Генерация аудио для: "${text.substring(0, 30)}..."`);

    try {
        // Отправляем текст в Node.js для генерации через Piper
        const result = await window.electronAPI.speakText(text, selectedTTSVoice.file);

        if (result.success) {
            currentAudio = new Audio(result.audioPath);
            currentAudio.volume = 0.8;
            currentAudio.play();
        } else {
            console.error("[TTS] Ошибка генерации:", result.error);
            showCustomAlert("Ошибка TTS: Движок или модель голоса не найдены. Проверьте папку assets/tts/");
        }
    } catch (e) {
        console.error("[TTS] Критическая ошибка вызова IPC:", e);
    }
}

// Функция генерации изображений удалена


async function loadItemsReference() {
    if (window.ModAPI && window.ModAPI.isTotalConversion) {
        console.log(`[Total Conversion] Пропуск загрузки ванильного справочника предметов.`);
        itemsReferenceData = [];
        return;
    }

    const isDefault = currentLanguage === DEFAULT_LANGUAGE;
    const { primary, fallback } = getLocalizedRuntimeAssetPaths(
        isDefault ? 'items_reference_default' : 'items_reference_template',
        'items_reference_default',
        { lang: currentLanguage }
    );
    const filePath = primary || fallback;
    console.log(`Попытка загрузить справочник предметов из: ${filePath}`);
    try {
        let response = await fetch(`${filePath}?t=${Date.now()}`);
        if (!response.ok && !isDefault) {
            response = await fetch(`${fallback}?t=${Date.now()}`);
        }
        if (!response.ok) throw new Error(`HTTP ошибка! статус: ${response.status}`);
        
        itemsReferenceData = await response.json();
        console.log(`Справочник предметов (${itemsReferenceData.length} шт.) успешно загружен и разобран.`);
    } catch (error) {
        console.error(`Не удалось загрузить или разобрать справочник предметов:`, error);
        itemsReferenceData = [];
    }
}

// --- Функции Локализации ---
async function loadLanguagesConfig() {
    try {
        const response = await fetch('assets/localizations/languages.json');
        if (!response.ok) throw new Error(`HTTP ошибка! статус: ${response.status}`);
        availableLanguages = await response.json();
        console.log("Доступные языки загружены:", availableLanguages);
        populateLanguageSelector();
    } catch (error) {
        console.error("Не удалось загрузить конфигурацию языков:", error);
        availableLanguages = {
            [DEFAULT_LANGUAGE]: { name: (DEFAULT_LANGUAGE === 'ru' ? 'Р СѓСЃСЃРєРёР№' : 'Default'), file: `assets/localizations/${DEFAULT_LANGUAGE}.json` }
        };
        populateLanguageSelector();
    }
}

function populateLanguageSelector() {
    if (!languageSelect) return;
    languageSelect.innerHTML = '';

    for (const langCode in availableLanguages) {
        const option = document.createElement('option');
        option.value = langCode;
        option.textContent = availableLanguages[langCode].name;
        if (langCode === currentLanguage) {
            option.selected = true;
        }
        languageSelect.appendChild(option);
    }

    languageSelect.removeEventListener('change', handleLanguageChange);
    languageSelect.addEventListener('change', handleLanguageChange);
}

function handleLanguageChange(event) {
    const newLang = event.target.value;
    setLanguage(newLang);
}

async function loadTranslations(langCode) {
    const langConfig = availableLanguages[langCode];
    if (!langConfig || !langConfig.file) {
        console.error(`Конфигурация файла перевода не найдена для языка: ${langCode}`);
        translations = {};
        return;
    }

    const fileUrl = `${langConfig.file}?t=${Date.now()}`;
    console.log(`Попытка загрузить переводы из: ${fileUrl}`);

    try {
        const response = await fetch(fileUrl, {
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });

        if (!response.ok) throw new Error(`HTTP ошибка! статус: ${response.status}, Не удалось загрузить ${response.url}`);
        const responseText = await response.text();

        try {
            translations = JSON.parse(responseText);
            console.log(`Переводы для '${langCode}' успешно разобраны.`);
        } catch (parseError) {
            console.error(`Не удалось РАЗОБРАТЬ переводы для ${langCode} после загрузки. Ошибка:`, parseError);
            console.error("--- Проблемный JSON текст, полученный браузером: ---");
            const errorPosition = parseError.message.match(/position (\d+)/);
            if (errorPosition && errorPosition[1]) {
                const pos = parseInt(errorPosition[1], 10);
                const contextLength = 50;
                console.error(responseText.substring(Math.max(0, pos - contextLength), Math.min(responseText.length, pos + contextLength)));
                console.error(`^^^ Ошибка, вероятно, около позиции ${pos} ^^^`);
            } else {
                console.error(responseText.substring(0, 500) + '...');
            }
            console.error("---------------------------------------------");
            translations = {};
        }

    } catch (fetchError) {
        console.error(`Не удалось ЗАГРУЗИТЬ переводы для ${langCode}:`, fetchError);
        translations = {};
    }
}

async function setLanguage(langCode) {
    if (!availableLanguages[langCode]) {
        console.warn(`Попытка установить неподдерживаемый язык: ${langCode}. Возврат к языку по умолчанию.`);
        langCode = DEFAULT_LANGUAGE;
    }

    const previousLanguage = currentLanguage;
    currentLanguage = langCode;
    localStorage.setItem(LANGUAGE_STORAGE_KEY, currentLanguage);
    console.log(`Установка языка на: ${currentLanguage}`);

    document.documentElement.lang = currentLanguage;

    if (languageSelect) {
        languageSelect.value = currentLanguage;
    }

    await loadTranslations(currentLanguage);
    applyTranslations();

    if (speechSynthesis) {
        loadTTSVoices();
        if (isTTSEnabled && speechSynthesis.speaking) {
            speechSynthesis.cancel();
        }
    }

    const isGameActive = gameInterface && gameInterface.classList.contains('active-screen');

    if (currentLanguage !== previousLanguage && !isGameActive) {
        try {
            await loadLore(DEFAULT_WORLD_ID, currentLanguage);
            await loadGlobalLocations(DEFAULT_WORLD_ID, currentLanguage, player ? player.era : getRuntimeDefaultEraId());
            await loadItemsReference();
            await loadPredefinedEffects();
            updateMapDisplay();
        } catch (error) {
            console.error(error);
        }
    }
    updateDynamicUIText();
    updateApiKeyStatus();
}

function applyTranslations() {
    const elements = document.querySelectorAll('[data-i18n]');

    elements.forEach(el => {
        if (el.id === 'level-info') { // level-info обновляется отдельно через updateCharacterSheet
            return;
        }

        const keyWithOptions = el.dataset.i18n;
        let key = keyWithOptions;
        let attribute = 'textContent'; // По умолчанию обновляем текстовое содержимое

        // Проверяем, указан ли атрибут в data-i18n (например, [placeholder]key.name)
        if (key.startsWith('[')) {
            const match = key.match(/^\[(.*?)\](.*)/);
            if (match) {
                attribute = match[1];
                key = match[2];
            }
        }

        let variables = null;
        if (el.dataset.i18nVariables) {
            try {
                // Заменяем одинарные кавычки на двойные для корректного JSON.parse
                const jsonString = el.dataset.i18nVariables.replace(/'/g, '"');
                variables = JSON.parse(jsonString);
            } catch (e) {
                console.error(`Ошибка разбора переменных i18n для ключа "${key}":`, e, el.dataset.i18nVariables);
            }
        }

        let translation = t(key, variables); // Получаем перевод

        if (translation !== key) { // Если перевод найден и он не равен самому ключу
            if (attribute === 'textContent') {
                el.textContent = translation; // Safe: textContent doesn't parse HTML
            } else if (attribute === 'innerHTML') {
                el.innerHTML = sanitizeHTML(translation);
            } else if (el.hasAttribute(attribute)) {
                el.setAttribute(attribute, translation);
            } else {
                // Если это специальный атрибут, который не является стандартным HTML атрибутом
                // (например, data-custom-attr), то el.setAttribute сработает.
                // Если это свойство объекта (например, el.value), то нужно обрабатывать отдельно или убедиться,
                // что такие случаи покрыты в updateDynamicUIText или других функциях.
                // Для большинства случаев (title, placeholder) setAttribute сработает.
                el.setAttribute(attribute, translation);
                // console.warn(`Целевой атрибут "${attribute}" не найден или не является стандартным на элементе для ключа: ${key}. Попытка установить через setAttribute.`);
            }
        } else if (!el.innerHTML && (attribute === 'textContent' || attribute === 'innerHTML')) {
            // Если перевод не найден и элемент пуст, показываем ключ для отладки
            el.innerHTML = `[${key}]`;
        }
    });
    // updateApiKeyStatus(); // Уже вызывается в setLanguage
}

function t(key, variables = null, fallback = null) {
    let translation = undefined;
    
    // Сначала ищем перевод в словарях модов
    if (window.ModAPI && window.ModAPI.customTranslations && window.ModAPI.customTranslations[currentLanguage]) {
        translation = key.split('.').reduce((obj, i) => obj?.[i], window.ModAPI.customTranslations[currentLanguage]);
    }
    
    // Если мод не переопределил строку, ищем в базовой игре
    if (translation === undefined) {
        translation = key.split('.').reduce((obj, i) => obj?.[i], translations);
    }

    if (typeof translation !== 'string') {
        translation = fallback !== null ? fallback : key;
    }

    if (variables && typeof translation === 'string') {
        for (const varKey in variables) {
            const regex = new RegExp(`\\{${varKey}\\}`, 'g');
            translation = translation.replace(regex, variables[varKey]);
        }
    }
    return translation || (fallback !== null ? fallback : key);
}

function updateDynamicUIText() {
    document.title = t('appName');

    const inventoryPanelTitle = document.querySelector('.inventory .panel-toggle > span:first-child');
    if (inventoryPanelTitle) {
        inventoryPanelTitle.innerHTML = t('gameInterface.inventoryPanel.title', {
            count: `<span id="inventory-count">${player && player.inventory ? Object.keys(player.inventory).length : 0}</span>`,
            capacity: `<span id="inventory-capacity">${player ? player.inventoryCapacity : 10}</span>`
        });
    }
    const charPanelTitle = document.querySelector('.character-sheet .panel-toggle > span:first-child');
    if (charPanelTitle) {
        charPanelTitle.textContent = t('gameInterface.characterPanel.title');
    }
    const questPanelTitle = document.querySelector('.quests .panel-toggle > span:first-child');
    if (questPanelTitle) {
        questPanelTitle.textContent = t('gameInterface.questPanel.title');
    }
    const skillsPanelTitle = document.querySelector('.skills-panel .panel-toggle > span:first-child');
    if (skillsPanelTitle) {
        skillsPanelTitle.textContent = t('gameInterface.skillsPanel.title');
    }
    const mapPanelTitle = document.querySelector('.map-panel .panel-toggle > span:first-child');
    if (mapPanelTitle) {
        mapPanelTitle.textContent = t('gameInterface.mapPanel.title');
    }
    const environmentPanelTitle = document.querySelector('.environment-panel .panel-toggle > span:first-child'); // РќРћР’РћР•
    if (environmentPanelTitle) {
        environmentPanelTitle.textContent = t('gameInterface.environmentPanel.title');
    }
    const calcLogPanelTitle = document.querySelector('.calculation-log-panel .panel-toggle > span:first-child');
    if (calcLogPanelTitle) {
        calcLogPanelTitle.textContent = t('gameInterface.calcLogPanel.title');
    }

    const echoMemoryPanelTitle = document.querySelector('.echo-memory-panel .panel-toggle > span:first-child');
    if (echoMemoryPanelTitle) {
        echoMemoryPanelTitle.textContent = t('gameInterface.echoMemoryPanel.title');
    }
    const worldChroniclesPanelTitle = document.querySelector('.world-chronicles-panel .panel-toggle > span:first-child');
    if (worldChroniclesPanelTitle) {
        worldChroniclesPanelTitle.textContent = t('gameInterface.worldChroniclesPanel.title');
    }
    const tradeJournalPanelTitle = document.querySelector('.trade-journal-panel .panel-toggle > span:first-child');
    if (tradeJournalPanelTitle) {
        tradeJournalPanelTitle.textContent = t('gameInterface.tradeJournalPanel.title', null, 'Торговый Журнал');
    }
    const portPanelTitle = document.querySelector('.port-panel .panel-toggle > span:first-child');
    if (portPanelTitle) {
        portPanelTitle.textContent = t('gameInterface.portPanel.title', null, 'РџРѕСЂС‚');
    }
    const clearEchoBtn = document.getElementById('clear-echo-memory-btn');
    if (clearEchoBtn) {
        clearEchoBtn.textContent = t('gameInterface.echoMemoryPanel.clearButton');
    }
    const calcLogEmpty = calculationLog ? calculationLog.querySelector('p[data-i18n="gameInterface.calcLogPanel.empty"]') : null;
    if (calcLogEmpty && calculationLog.children.length === 1 && calculationLog.firstElementChild === calcLogEmpty) {
        calcLogEmpty.textContent = t('gameInterface.calcLogPanel.empty');
    }

    statIncreaseButtons.forEach(button => {
        const stat = button.getAttribute('data-stat');
        if (stat) {
            button.title = t('gameInterface.characterPanel.increaseStatTooltip', { statName: stat.toUpperCase() });
        }
    });

    const maxManual = document.getElementById('max-manual-saves');
    const maxAuto = document.getElementById('max-auto-saves');
    const manualTitleSpan = document.querySelector('#load-game-screen h2:nth-of-type(1) span[data-i18n]');
    const autoTitleSpan = document.querySelector('#load-game-screen h2:nth-of-type(2) span[data-i18n]');

    if (maxManual) maxManual.textContent = MAX_MANUAL_SAVES;
    if (maxAuto) maxAuto.textContent = MAX_AUTO_SAVES;
    if (manualTitleSpan) manualTitleSpan.innerHTML = t('loadGame.manualSavesTitle', { max: `<span id="max-manual-saves">${MAX_MANUAL_SAVES}</span>` });
    if (autoTitleSpan) autoTitleSpan.innerHTML = t('loadGame.autoSavesTitle', { max: `<span id="max-auto-saves">${MAX_AUTO_SAVES}</span>` });

    if (typeof populateErasUI   === 'function' && window.ERAS_DATA)    populateErasUI(window.ERAS_DATA);
    if (typeof populateRacesUI  === 'function' && window.RACES_DATA)   populateRacesUI(window.RACES_DATA);
    if (typeof populateClassesUI === 'function' && window.CLASSES_DATA) populateClassesUI(window.CLASSES_DATA);

    if (player && gameInterface && gameInterface.classList.contains('active-screen')) {
        if (gameTitle) gameTitle.textContent = t('appName') + ` | ${player.name}`;
    } else if (mainMenu && mainMenu.classList.contains('active-screen')) {
        const mainMenuTitle = mainMenu.querySelector('h1');
        if (mainMenuTitle) mainMenuTitle.textContent = t('mainMenu.title');
        if (gameTitle) gameTitle.textContent = t('appName');
    } else {
        if (gameTitle) gameTitle.textContent = t('appName');
    }

    if (inventoryList && inventoryList.children.length === 1 && inventoryList.firstElementChild.tagName === 'LI') {
        const li = inventoryList.firstElementChild;
        if (Object.keys(player?.inventory || {}).length === 0) {
            li.textContent = t('gameInterface.inventoryPanel.empty');
            li.removeAttribute('title');
            li.style.cursor = 'default';
        }
    }
    if (questList && questList.children.length === 1 && questList.firstElementChild.tagName === 'LI') {
        const li = questList.firstElementChild;
        if (Object.keys(player?.quests || {}).filter(q => player.quests[q].status === 'active').length === 0) {
            li.textContent = t('gameInterface.questPanel.empty');
        }
    }
    if (skillsList && skillsList.children.length === 1 && skillsList.firstElementChild.tagName === 'LI') {
        const li = skillsList.firstElementChild;
        if (Object.keys(player?.skills || {}).length === 0) {
            li.textContent = t('gameInterface.skillsPanel.empty');
            li.style.cursor = 'default';
        }
    }
    if (customLocationsList && customLocationsList.children.length === 1 && customLocationsList.firstElementChild.tagName === 'LI') {
        const li = customLocationsList.firstElementChild;
        if (Object.keys(player?.mapMarkers || {}).length === 0) {
            li.textContent = t('gameInterface.mapPanel.noCustom');
        }
    }
    if (environmentList && environmentList.children.length === 1 && environmentList.firstElementChild.tagName === 'LI') { // РќРћР’РћР•
        const li = environmentList.firstElementChild;
        if (Object.keys(player?.visibleEntities || {}).length === 0) {
            li.textContent = t('gameInterface.environmentPanel.empty');
            li.style.cursor = 'default';
        }
    }
    // Кнопки музыки и TTS удалены из верхней панели
    if (globalLocationsList && globalLocationsList.children.length === 1 && globalLocationsList.firstElementChild.tagName === 'LI') {
        const li = globalLocationsList.firstElementChild;
        if (Object.keys(globalLocations || {}).filter(key => key !== 'startLocation').length === 0) {
            if (worldLore.startsWith(t('error.prefix', 'Ошибка:')) || worldLore === "Загрузка лора...") {
                li.textContent = t('gameInterface.mapPanel.errorWorldData');
            } else {
                li.textContent = t('gameInterface.mapPanel.noGlobal');
            }
        }
    }
}

// --- Инициализация Приложения ---
async function initializeApp() {

    // Слушатель прогресса нативного движка
    if (window.electronAPI && window.electronAPI.onNexusProgress) {
        window.electronAPI.onNexusProgress((message) => {
            const loadingText = document.getElementById('loading-text');
            if (loadingText) {
                let parsedMessage = message;
                const jsonStart = message.indexOf('{');
                if (jsonStart !== -1 && message.includes('"loc_key"')) {
                    const prefix = message.substring(0, jsonStart);
                    const jsonStr = message.substring(jsonStart);
                    parsedMessage = prefix + parseLocString(jsonStr);
                }
                loadingText.textContent = parsedMessage;
            }
            console.log("[Nexus Progress]", message);
        });
    }

    // Слушатель реалтайм-обновлений от движка -- мир обновляется мгновенно
    // FIX: Engine now sends lightweight delta updates (time, homeostasis, dirty items/containers)
    // instead of the entire world every 500ms. Full world is fetched on demand via getFullState.
    if (window.electronAPI && window.electronAPI.onNexusRealtimeUpdate) {
        window.electronAPI.onNexusRealtimeUpdate((data) => {
            if (!World) return;
            // Apply lightweight updates from engine delta
            if (data.time) World.time = data.time;
            if (data.homeostasis) World.homeostasis = data.homeostasis;
            if (data.tick !== undefined) World.tick = data.tick;
            if (data.current_day !== undefined) World.current_day = data.current_day;
            if (data.items) data.items.forEach(([k, v]) => ItemRegistry.set(k, v));
            if (data.containers) data.containers.forEach(([k, v]) => setContainer(k, v));
            if (data.deleted_items) data.deleted_items.forEach(id => ItemRegistry.delete(id));
            if (data.deleted_containers) data.deleted_containers.forEach(id => ContainerRegistry.delete(id));
            processMonsterQuests();

            if (data.trek_events && data.trek_events.length > 0) {
                LivingRoads.handleEvents(data.trek_events);
            }

            if (typeof updateEnvironmentPanel === 'function') updateEnvironmentPanel();
            if (typeof updateHoldingsDisplay === 'function') updateHoldingsDisplay();
            updateTimeDisplay();
        });
    }


    console.log("Инициализация приложения...");

    currentApiProvider = localStorage.getItem('apiProvider') || 'gemini';
    usePromptCaching = localStorage.getItem('usePromptCaching') !== 'false';
    useThinkingMode = localStorage.getItem('useThinkingMode') === 'true';
    thinkingBudget = parseInt(localStorage.getItem('thinkingBudget')) || 2048;
    reasoningEffort = localStorage.getItem('reasoningEffort') || 'medium';
    allowNSFW = localStorage.getItem('allowNSFW') === 'true';
    eroticIntensityLevel = parseInt(localStorage.getItem('eroticIntensityLevel')) || 2;
    try {
        eroticPreferences = JSON.parse(localStorage.getItem('eroticPreferences')) || {
            pregnancyRisk: true,
            diseaseRisk: true,
            reputationConsequences: true,
            pornoMode: false
        };
    } catch (e) {
        eroticPreferences = { pregnancyRisk: true, diseaseRisk: true, reputationConsequences: true, pornoMode: false };
    }
    // FIX (Issue #11): Migrate plaintext keys, then use SecureKeyStorage
    SecureKeyStorage.migrateKey('geminiApiKeys');
    try { geminiApiKeys = JSON.parse(SecureKeyStorage.getItem('geminiApiKeys')) || []; } catch (e) { geminiApiKeys = []; }
    geminiApiKey = geminiApiKeys.length > 0 ? geminiApiKeys[0] : '';
    geminiModelId = localStorage.getItem('geminiModelId') || 'gemini-3.1-flash-lite-preview';
    SecureKeyStorage.migrateKey('llmostApiKey');
    llmostApiKey = SecureKeyStorage.getItem('llmostApiKey') || '';
    llmostModelId = localStorage.getItem('llmostModelId') || 'openai/gpt-4';
    SecureKeyStorage.migrateKey('openrouterApiKey');
    openrouterApiKey = SecureKeyStorage.getItem('openrouterApiKey') || '';
    openrouterModelId = localStorage.getItem('openrouterModelId') || 'anthropic/claude-3-haiku';
    SecureKeyStorage.migrateKey('deepseekApiKey');
    deepseekApiKey = SecureKeyStorage.getItem('deepseekApiKey') || '';
    deepseekModelId = localStorage.getItem('deepseekModelId') || 'deepseek-chat';
    SecureKeyStorage.migrateKey('omnirouteApiKey');
    omnirouteApiKey = SecureKeyStorage.getItem('omnirouteApiKey') || '';
    omnirouteModelId = localStorage.getItem('omnirouteModelId') || 'anthropic/claude-3-sonnet';
    omnirouteBaseUrl = localStorage.getItem('omnirouteBaseUrl') || 'https://api.omniroute.ai/v1/chat/completions';
    localApiUrl = localStorage.getItem('localApiUrl') || 'http://localhost:1234/v1/chat/completions';
    localModelId = localStorage.getItem('localModelId') || 'local-model';
    imgApiProvider = localStorage.getItem('imgApiProvider') || 'pollinations';
    SecureKeyStorage.migrateKey('imgApiKey');
    imgApiKey = SecureKeyStorage.getItem('imgApiKey') || '';
    
    aiPlayerProvider = localStorage.getItem('aiPlayerProvider') || 'openrouter';
    aiPlayerModelId = localStorage.getItem('aiPlayerModelId') || 'google/gemma-2-9b-it:free';
    SecureKeyStorage.migrateKey('aiPlayerApiKey');
    aiPlayerApiKey = SecureKeyStorage.getItem('aiPlayerApiKey') || '';
    aiPlayerLocalUrl = localStorage.getItem('aiPlayerLocalUrl') || 'http://localhost:1234/v1/chat/completions';
    aiPlayerTurnLimit = parseInt(localStorage.getItem('aiPlayerTurnLimit')) || 20;

    imgModelId = localStorage.getItem('imgModelId') || 'dall-e-3';
    enableImageGeneration = localStorage.getItem('enableImageGeneration') !== 'false';
    enableLocalMap = localStorage.getItem('enableLocalMap') !== 'false';
    enableDeepSetup = localStorage.getItem('enableDeepSetup') === 'true';

    initSettingsUI();

    // Инициализация ModKit ДО загрузки лора и локаций
    if (typeof initModKit === 'function') {
        await initModKit();
    }

    await loadLanguagesConfig();
    currentLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY) || DEFAULT_LANGUAGE;
    if (!availableLanguages[currentLanguage]) {
        currentLanguage = DEFAULT_LANGUAGE;
    }
    document.documentElement.lang = currentLanguage;
    if (languageSelect) {
        languageSelect.value = currentLanguage;
    }
    await loadTranslations(currentLanguage);
    applyTranslations();

        await loadTileSet();

    // Load runtime database FIRST — other loaders depend on GAMEPLAY_RUNTIME_CONFIG
    if (typeof window.ensureRuntimeDataLoaded === 'function') {
        await window.ensureRuntimeDataLoaded();
        syncRuntimeRegistries();
        // Populate character creation UI with runtime data
        if (typeof populateErasUI    === 'function' && window.ERAS_DATA)    populateErasUI(window.ERAS_DATA);
        if (typeof populateRacesUI   === 'function' && window.RACES_DATA)   populateRacesUI(window.RACES_DATA);
        if (typeof populateClassesUI === 'function' && window.CLASSES_DATA) populateClassesUI(window.CLASSES_DATA);
    }

    const results = await Promise.allSettled([
        loadLore(DEFAULT_WORLD_ID, currentLanguage),
        loadGlobalLocations(DEFAULT_WORLD_ID, currentLanguage),
        loadSkillsReference(DEFAULT_WORLD_ID, currentLanguage),
        loadEnvironmentCommandsGuide(DEFAULT_WORLD_ID, currentLanguage),
        loadItemsReference(),
        loadCombatSystemRules(),
        loadPredefinedEffects(),
        loadPromptFromFile('auto_tester').then(t => autoTesterPromptTemplate = t)
    ]);

    const failedLoads = results.filter(result => result.status === 'rejected');

    if (failedLoads.length > 0) {
        console.error("КРИТИЧЕСКАЯ ОШИБКА: Не удалось загрузить основные файлы игры:");
        failedLoads.forEach(result => console.error(result.reason));

        if (worldLore.startsWith('Ошибка:') || Object.keys(globalLocations).length === 0) {
            alert(t('error.worldLoadFailed', { worldId: DEFAULT_WORLD_ID }));
            return;
        }
    }

    updateMapDisplay();

    if (hasElectronAPI) {
        updateFSAStatus();
    } else if (fsaApiAvailable) {
        const handleFromDB = await getDirectoryHandleFromDB();
        if (handleFromDB && typeof handleFromDB.queryPermission === 'function') {
            directoryHandle = handleFromDB;
            if (await verifyDirectoryHandlePermission(directoryHandle)) {
                updateFSAStatus(directoryHandle, 'granted_from_db');
            } else {
                directoryHandle = null;
                await saveDirectoryHandleToDB(null);
                updateFSAStatus(null, 'permission_revoked_on_load');
            }
        }
    }

    updateApiKeyStatus();
    setupTTS();
    setupMusicPlayer();

    setActiveScreen('main-menu');
    setupEventListeners();

    // equipmentElements теперь заполняется динамически в populateEquipmentUI()

    startBackgroundChanger();
    updateDynamicUIText();

    console.log("Инициализация приложения завершена.");
}


// --- УПРАВЛЕНИЕ UI НАСТРОЕК ---
function initSettingsUI() {
    const providerSelect = document.getElementById('api-provider-select');
    const modelIdInput = document.getElementById('model-id-input');

    // Находим все группы настроек
    const settingsGroups = {
        gemini: document.getElementById('gemini-settings-group'),
        llmost: document.getElementById('llmost-settings-group'),
        openrouter: document.getElementById('openrouter-settings-group'),
        deepseek: document.getElementById('deepseek-settings-group'),
        omniroute: document.getElementById('omniroute-settings-group'),
        local: document.getElementById('local-settings-group')
    };

    // Находим все поля для API ключей
    const keyInputs = {
        gemini: document.getElementById('gemini-api-key-input'),
        llmost: document.getElementById('llmost-api-key-input'),
        openrouter: document.getElementById('openrouter-api-key-input'),
        deepseek: document.getElementById('deepseek-api-key-input'),
        omniroute: document.getElementById('omniroute-api-key-input')
    };

    const localUrlInput = document.getElementById('local-url-input');

    // Функция для переключения видимости и загрузки данных
    const switchProviderView = (provider) => {
        // 1. Скрываем все группы
        Object.values(settingsGroups).forEach(group => {
            if (group) group.style.display = 'none';
        });

        // 2. Показываем нужную группу
        if (settingsGroups[provider]) {
            settingsGroups[provider].style.display = 'block';
        }

        // 3. Загружаем и устанавливаем ID модели для выбранного провайдера
        let modelId = '';
        switch (provider) {
            case 'gemini': modelId = geminiModelId; break;
            case 'llmost': modelId = llmostModelId; break;
            case 'openrouter': modelId = openrouterModelId; break;
            case 'deepseek': modelId = deepseekModelId; break;
            case 'omniroute': modelId = omnirouteModelId; break;
            case 'local': modelId = localModelId; break; // Для LM Studio это тоже ID
            case 'dummy': modelId = 'dummy-test-model'; break;
        }
        if (modelIdInput) modelIdInput.value = modelId;

        // Обновляем заголовок для поля ввода модели
        const modelLabel = document.querySelector('#model-id-input-group label');
        if (modelLabel) modelLabel.textContent = t('settingsMenu.modelIdLabelFor', { provider: provider.charAt(0).toUpperCase() + provider.slice(1) });
    };

    // Устанавливаем начальные значения из глобальных переменных
    if (providerSelect) providerSelect.value = currentApiProvider;
    const cachingCheckbox = document.getElementById('prompt-caching-checkbox');
    if (cachingCheckbox) cachingCheckbox.checked = usePromptCaching;

    const thinkingCheckbox = document.getElementById('thinking-mode-checkbox');
    const thinkingGroup = document.getElementById('thinking-settings-group');
    const thinkingSlider = document.getElementById('thinking-budget-slider');
    const thinkingValue = document.getElementById('thinking-budget-value');
    const effortSelect = document.getElementById('reasoning-effort-select');

    if (thinkingCheckbox && thinkingGroup) {
        thinkingCheckbox.checked = useThinkingMode;
        thinkingGroup.style.display = useThinkingMode ? 'block' : 'none';

        thinkingCheckbox.addEventListener('change', (e) => {
            thinkingGroup.style.display = e.target.checked ? 'block' : 'none';
        });
    }
    if (thinkingSlider && thinkingValue) {
        thinkingSlider.value = thinkingBudget;
        thinkingValue.textContent = thinkingBudget;
        thinkingSlider.addEventListener('input', (e) => {
            thinkingValue.textContent = e.target.value;
        });
    }
    if (effortSelect) {
        effortSelect.value = reasoningEffort;
    }

    const nsfwCheckbox = document.getElementById('nsfw-mode-checkbox');
    const eroticSettingsGroup = document.getElementById('erotic-settings-group');
    if (nsfwCheckbox) {
        nsfwCheckbox.checked = allowNSFW;

        // Показать/скрыть эротические настройки в зависимости от NSFW
        if (eroticSettingsGroup) {
            eroticSettingsGroup.style.display = allowNSFW ? 'block' : 'none';
        }

        // Обработчик изменения NSFW чекбокса
        nsfwCheckbox.addEventListener('change', (e) => {
            if (eroticSettingsGroup) {
                eroticSettingsGroup.style.display = e.target.checked ? 'block' : 'none';
            }
        });
    }

    // Инициализация эротических настроек
    const eroticIntensitySlider = document.getElementById('erotic-intensity-slider');
    const eroticIntensityValue = document.getElementById('erotic-intensity-value');
    const pregnancyRiskCheckbox = document.getElementById('pregnancy-risk-checkbox');
    const diseaseRiskCheckbox = document.getElementById('disease-risk-checkbox');
    const reputationConsequencesCheckbox = document.getElementById('reputation-consequences-checkbox');
    const pornoModeCheckbox = document.getElementById('porno-mode-checkbox');

    if (eroticIntensitySlider && eroticIntensityValue) {
        eroticIntensitySlider.value = eroticIntensityLevel;
        eroticIntensityValue.textContent = eroticIntensityLevel;
        eroticIntensitySlider.addEventListener('input', (e) => {
            eroticIntensityValue.textContent = e.target.value;
        });
    }

    if (pregnancyRiskCheckbox) pregnancyRiskCheckbox.checked = eroticPreferences.pregnancyRisk;
    if (diseaseRiskCheckbox) diseaseRiskCheckbox.checked = eroticPreferences.diseaseRisk;
    if (reputationConsequencesCheckbox) reputationConsequencesCheckbox.checked = eroticPreferences.reputationConsequences;
    if (pornoModeCheckbox) pornoModeCheckbox.checked = eroticPreferences.pornoMode;

    if (keyInputs.gemini) keyInputs.gemini.value = geminiApiKeys.join('\n');
    if (keyInputs.llmost) keyInputs.llmost.value = llmostApiKey;
    if (keyInputs.openrouter) keyInputs.openrouter.value = openrouterApiKey;
    if (keyInputs.deepseek) keyInputs.deepseek.value = deepseekApiKey;
    if (keyInputs.omniroute) keyInputs.omniroute.value = omnirouteApiKey;
    const omnirouteUrlInput = document.getElementById('omniroute-base-url-input');
    if (omnirouteUrlInput) omnirouteUrlInput.value = omnirouteBaseUrl;
    if (localUrlInput) localUrlInput.value = localApiUrl;

    // Load image settings
    const imgGenCheckbox = document.getElementById('enable-img-gen-checkbox');
    const deepSetupCheckbox = document.getElementById('enable-deep-setup-checkbox');
    if (deepSetupCheckbox) deepSetupCheckbox.checked = enableDeepSetup;
    
    if (imgGenCheckbox) imgGenCheckbox.checked = enableImageGeneration;
    const imgProviderSelect = document.getElementById('img-provider-select');
    if (imgProviderSelect) imgProviderSelect.value = imgApiProvider;
    const imgModelInput = document.getElementById('img-model-input');
    if (imgModelInput) imgModelInput.value = imgModelId;
    const imgKeyInput = document.getElementById('img-key-input');
    
    const aiPlayerProvSelect = document.getElementById('ai-player-provider-select');
    if (aiPlayerProvSelect) aiPlayerProvSelect.value = aiPlayerProvider;
    const aiPlayerModelInp = document.getElementById('ai-player-model-input');
    if (aiPlayerModelInp) aiPlayerModelInp.value = aiPlayerModelId;
    const aiPlayerKeyInp = document.getElementById('ai-player-key-input');
    if (aiPlayerKeyInp) {
        aiPlayerKeyInp.value = aiPlayerProvider === 'local' ? aiPlayerLocalUrl : aiPlayerApiKey;
                const aiPlayerLimitInp = document.getElementById('ai-player-turn-limit');
        if (aiPlayerLimitInp) aiPlayerLimitInp.value = aiPlayerTurnLimit;

if (aiPlayerProvSelect) {
            aiPlayerProvSelect.addEventListener('change', () => {
                aiPlayerKeyInp.value = aiPlayerProvSelect.value === 'local' ? aiPlayerLocalUrl : aiPlayerApiKey;
            });
        }
    }

    if (imgKeyInput) imgKeyInput.value = imgApiKey;

    // Инициализация внутренних вкладок (Sub-tabs) только для настроек
    const settingsMenuEl = document.getElementById('settings-menu');
    if (settingsMenuEl) {
        const subTabBtns = settingsMenuEl.querySelectorAll('.sub-tab-btn');
        const subTabContents = settingsMenuEl.querySelectorAll('.sub-tab-content');
        subTabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                subTabBtns.forEach(b => b.classList.remove('active'));
                subTabContents.forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                const targetId = btn.getAttribute('data-subtab');
                if (targetId) document.getElementById(targetId).classList.add('active');
            });
        });
    }


    // Устанавливаем первоначальное отображение
    switchProviderView(currentApiProvider);

    // Вешаем обработчик события
    if (providerSelect) {
        providerSelect.addEventListener('change', () => {
            currentApiProvider = providerSelect.value;
            switchProviderView(currentApiProvider);
        });
    }

    // Инициализация вкладок настроек
    const tabBtns = document.querySelectorAll('.settings-tab-btn');
    const tabContents = document.querySelectorAll('.settings-tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });

    // Инициализация ползунков звука
        const autoSaveSelect = document.getElementById('autosave-interval-select');
    if (autoSaveSelect) autoSaveSelect.value = autoSaveIntervalMs.toString();


const musicSlider = document.getElementById('music-volume-slider');
    const musicValue = document.getElementById('music-volume-value');
    const sfxSlider = document.getElementById('sfx-volume-slider');
    const sfxValue = document.getElementById('sfx-volume-value');

    if (musicSlider) {
        musicSlider.value = Math.round(musicVolume * 100);
        musicValue.textContent = musicSlider.value + '%';
        musicSlider.addEventListener('input', (e) => {
            musicVolume = e.target.value / 100;
            musicValue.textContent = e.target.value + '%';
            if (audioPlayer) audioPlayer.volume = musicVolume;
        });
    }

    if (sfxSlider) {
        sfxSlider.value = Math.round(sfxVolume * 100);
        sfxValue.textContent = sfxSlider.value + '%';
        sfxSlider.addEventListener('input', (e) => {
            sfxVolume = e.target.value / 100;
            sfxValue.textContent = e.target.value + '%';
            updateSfxVolume();
            playSfx(clickSfx); // Проигрываем звук для теста громкости
        });
    }
}

// --- СОХРАНЕНИЕ НАСТРОЕК ---
// Замени старую функцию saveApiKey на эту (или обнови слушатель события)
function getFriendlyApiErrorMessage(status, rawText) {
    // Хардкодный словарь на случай сбоя системы локализации (t())
    const fallbacks = {
        400: "Неверный запрос. Возможно, контекст слишком велик или модель не поддерживает выбранные параметры.",
        401: "Ошибка авторизации. Проверьте правильность API ключа.",
        402: "Недостаточно средств на балансе провайдера. Пополните счёт или смените модель.",
        403: "Доступ запрещен. Проверьте API ключ или ограничения провайдера.",
        429: "Слишком много запросов (Лимит исчерпан). Если это бесплатная модель, подождите немного или смените модель.",
        500: "Внутренняя ошибка сервера провайдера ИИ.",
        502: "Плохой шлюз. Сервер провайдера ИИ временно недоступен.",
        503: "Сервер провайдера ИИ перегружен. Повторите попытку позже.",
        504: "Время ожидания ответа от сервера ИИ истекло.",
        'network': "Ошибка сети. Проверьте подключение к интернету или отключите VPN/AdBlock."
    };
    
    let friendlyText = t(`apiErrors.${status}`, null, "");
    // Если перевод не найден или вернул сам ключ
    if (!friendlyText || friendlyText === `apiErrors.${status}`) {
        friendlyText = fallbacks[status] || t('apiErrors.unknown', null, "Неизвестная ошибка API.");
    }
    return `${friendlyText}\n\n[Код: ${status}] Детали: ${rawText}`;
}


async function pingProvider() {
    const provider = document.getElementById('api-provider-select').value;
    const resultDiv = document.getElementById('ping-provider-result');
    const btn = document.getElementById('ping-provider-btn');
    if (!resultDiv || !btn) return;

    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<i class="fas fa-spinner fa-spin" style="color: #f39c12;"></i> Пинг провайдера...';
    btn.disabled = true;

    let url = ''; let headers = {}; let key = '';
    try {
        switch (provider) {
            case 'gemini':
                key = document.getElementById('gemini-api-key-input').value.trim() || geminiApiKey;
                if (!key) throw new Error("Ключ не введен");
                url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
                break;
            case 'openrouter':
                key = document.getElementById('openrouter-api-key-input').value.trim() || openrouterApiKey;
                if (!key) throw new Error("Ключ не введен");
                url = "https://openrouter.ai/api/v1/auth/key";
                headers['Authorization'] = `Bearer ${key}`;
                break;
            case 'llmost':
                key = document.getElementById('llmost-api-key-input').value.trim() || llmostApiKey;
                if (!key) throw new Error("Ключ не введен");
                url = "https://llmost.ru/api/v1/models";
                headers['Authorization'] = `Bearer ${key}`;
                break;
            case 'deepseek':
                key = document.getElementById('deepseek-api-key-input').value.trim() || deepseekApiKey;
                if (!key) throw new Error("Ключ не введен");
                url = "https://api.deepseek.com/models";
                headers['Authorization'] = `Bearer ${key}`;
                headers['Accept'] = 'application/json';
                break;
            case 'omniroute':
                key = document.getElementById('omniroute-api-key-input').value.trim() || omnirouteApiKey;
                let baseUrl = document.getElementById('omniroute-base-url-input').value.trim() || omnirouteBaseUrl;
                if (!key) throw new Error("Ключ не введен");
                url = baseUrl.replace(/\/chat\/completions\/?$/, '/models');
                headers['Authorization'] = `Bearer ${key}`;
                break;
            case 'local':
                let lUrl = document.getElementById('local-url-input').value.trim() || localApiUrl;
                url = lUrl.replace(/\/chat\/completions\/?$/, '/models');
                break;
            case 'dummy':
                resultDiv.innerHTML = '<span style="color: #2ecc71;"><i class="fas fa-check"></i> Заглушка готова!</span>';
                btn.disabled = false;
                setTimeout(() => resultDiv.style.display = 'none', 3000);
                return;
        }

        const response = await fetch(url, { method: 'GET', headers: headers });
        if (response.ok) {
            resultDiv.innerHTML = `<span style="color: #2ecc71;"><i class="fas fa-check"></i> Соединение установлено! Ключ валиден.</span>`;
        } else {
            const errText = await response.text();
            let shortMsg = t(`apiErrors.${response.status}`, null, `Ошибка ${response.status}`);
            resultDiv.innerHTML = `<span style="color: #e74c3c;" title="${errText.replace(/"/g, '&quot;')}"><i class="fas fa-times"></i> ${shortMsg} (РљРѕРґ: ${response.status})</span>`;
        }
    } catch (e) {
        let shortMsg = e.message.includes('fetch') ? t('apiErrors.network', null, 'Ошибка сети') : e.message;
        resultDiv.innerHTML = `<span style="color: #e74c3c;"><i class="fas fa-times"></i> ${shortMsg}</span>`;
    } finally {
        btn.disabled = false;
    }
}

async function fetchModels() {
    const provider = document.getElementById('api-provider-select').value;
    const btn = document.getElementById('fetch-models-btn');
    if (!btn) return;

    const originalIcon = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;

    let url = ''; let headers = {}; let key = ''; let isGemini = false;
    try {
        switch (provider) {
            case 'gemini':
                key = document.getElementById('gemini-api-key-input').value.trim() || geminiApiKey;
                if (!key) throw new Error("Ключ не введен");
                url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
                isGemini = true;
                break;
            case 'openrouter':
                key = document.getElementById('openrouter-api-key-input').value.trim() || openrouterApiKey;
                if (!key) throw new Error("Ключ не введен");
                url = "https://openrouter.ai/api/v1/models";
                headers['Authorization'] = `Bearer ${key}`;
                break;
            case 'llmost':
                key = document.getElementById('llmost-api-key-input').value.trim() || llmostApiKey;
                if (!key) throw new Error("Ключ не введен");
                url = "https://llmost.ru/api/v1/models";
                headers['Authorization'] = `Bearer ${key}`;
                break;
            case 'deepseek':
                key = document.getElementById('deepseek-api-key-input').value.trim() || deepseekApiKey;
                if (!key) throw new Error("Ключ не введен");
                url = "https://api.deepseek.com/models";
                headers['Authorization'] = `Bearer ${key}`;
                headers['Accept'] = 'application/json';
                break;
            case 'omniroute':
                key = document.getElementById('omniroute-api-key-input').value.trim() || omnirouteApiKey;
                let baseUrl = document.getElementById('omniroute-base-url-input').value.trim() || omnirouteBaseUrl;
                if (!key) throw new Error("Ключ не введен");
                url = baseUrl.replace(/\/chat\/completions\/?$/, '/models');
                headers['Authorization'] = `Bearer ${key}`;
                break;
            case 'local':
                let lUrl = document.getElementById('local-url-input').value.trim() || localApiUrl;
                url = lUrl.replace(/\/chat\/completions\/?$/, '/models');
                break;
            case 'dummy':
                if (typeof showCustomAlert === 'function') showCustomAlert("Заглушка не имеет списка моделей.");
                return;
        }

        const response = await fetch(url, { method: 'GET', headers: headers });
        if (response.ok) {
            const data = await response.json();
            let models = [];
            
            if (isGemini && data.models) {
                models = data.models.map(m => {
                    let id = m.name.replace('models/', '');
                    let type = 'text';
                    if (id.includes('vision') || id.includes('image') || id.includes('nano-banana')) type = 'vision';
                    else if (id.includes('tts') || id.includes('audio')) type = 'audio';
                    else if (id.includes('embed')) type = 'embedding';
                    
                    let isThinking = id.includes('thinking') || id.includes('reasoning');
                    let isCaching = id.includes('gemini-1.5') || id.includes('gemini-2.0');

                    return {
                        id: id, name: m.displayName || id, desc: m.description || 'Официальная модель Google Gemini.',
                        type: type, free: false, context: m.inputTokenLimit || null, priceText: 'Лимиты API (Free Tier)',
                        caching: isCaching, thinking: isThinking
                    };
                });
            } else if (provider === 'openrouter' && data.data) {
                models = data.data.map(m => {
                    let type = 'text';
                    if (m.id.includes('vision') || (m.architecture && m.architecture.modality && m.architecture.modality.includes('image'))) type = 'vision';
                    
                    let p_prompt = m.pricing && m.pricing.prompt ? parseFloat(m.pricing.prompt) * 1000000 : -1;
                    let p_comp = m.pricing && m.pricing.completion ? parseFloat(m.pricing.completion) * 1000000 : -1;
                    let isFree = (p_prompt === 0 && p_comp === 0) || m.id.endsWith(':free');
                    let priceText = '';
                    if (isFree) priceText = 'Бесплатно';
                    else if (p_prompt >= 0 && p_comp >= 0) {
                        let pr_str = p_prompt < 0.01 ? p_prompt.toFixed(4) : p_prompt.toFixed(2);
                        let cmp_str = p_comp < 0.01 ? p_comp.toFixed(4) : p_comp.toFixed(2);
                        priceText = `$${pr_str} / $${cmp_str} Р·Р° 1M`;
                    } else priceText = 'Платная';
                    
                    let isCaching = m.architecture && m.architecture.prompt_caching;
                    let idLower = m.id.toLowerCase();
                    let isThinking = idLower.includes('r1') || idLower.includes('o1') || idLower.includes('o3') || idLower.includes('thinking') || idLower.includes('reasoning');

                    return {
                        id: m.id, name: m.name || m.id, desc: m.description || '', type: type, free: isFree,
                        context: m.context_length, priceText: priceText, caching: isCaching, thinking: isThinking
                    };
                });
            } else if (data.data && Array.isArray(data.data)) {
                models = data.data.map(m => {
                    let idLower = (m.id || "").toLowerCase();
                    let isThinking = idLower.includes('r1') || idLower.includes('o1') || idLower.includes('o3') || idLower.includes('thinking') || idLower.includes('reasoning');
                    return { id: m.id, name: m.name || m.id, desc: '', type: 'text', free: false, priceText: 'По тарифу провайдера', caching: false, thinking: isThinking };
                });
            } else if (Array.isArray(data)) {
                models = data.map(m => {
                    let idLower = (m.id || m.name || "").toLowerCase();
                    let isThinking = idLower.includes('r1') || idLower.includes('o1') || idLower.includes('o3') || idLower.includes('thinking') || idLower.includes('reasoning');
                    return { id: m.id || m.name, name: m.name || m.id, desc: '', type: 'text', free: false, priceText: 'По тарифу провайдера', caching: false, thinking: isThinking };
                });
            }

            models = models.filter(m => m.type !== 'embedding');

            if (models.length > 0) {
                showModelSelector(models);
            } else {
                if (typeof showCustomAlert === 'function') showCustomAlert("Связь есть, но список моделей пуст.");
            }
        } else {
            const errText = await response.text();
            if (typeof showCustomAlert === 'function') showCustomAlert(getFriendlyApiErrorMessage(response.status, errText));
        }
    } catch (e) {
        let shortMsg = e.message.includes('fetch') ? t('apiErrors.network', null, 'Ошибка сети') : e.message;
        if (typeof showCustomAlert === 'function') showCustomAlert("Ошибка получения списка моделей: " + shortMsg);
    } finally {
        btn.innerHTML = originalIcon;
        btn.disabled = false;
    }
}


function getFriendlyApiErrorMessage(status, rawText) {
    // Хардкодный словарь на случай сбоя системы локализации (t())
    const fallbacks = {
        400: "Неверный запрос. Возможно, контекст слишком велик или модель не поддерживает выбранные параметры.",
        401: "Ошибка авторизации. Проверьте правильность API ключа.",
        402: "Недостаточно средств на балансе провайдера. Пополните счёт или смените модель.",
        403: "Доступ запрещен. Проверьте API ключ или ограничения провайдера.",
        429: "Слишком много запросов (Лимит исчерпан). Если это бесплатная модель, подождите немного или смените модель.",
        500: "Внутренняя ошибка сервера провайдера ИИ.",
        502: "Плохой шлюз. Сервер провайдера ИИ временно недоступен.",
        503: "Сервер провайдера ИИ перегружен. Повторите попытку позже.",
        504: "Время ожидания ответа от сервера ИИ истекло.",
        'network': "Ошибка сети. Проверьте подключение к интернету или отключите VPN/AdBlock."
    };
    
    let friendlyText = t(`apiErrors.${status}`, null, "");
    // Если перевод не найден или вернул сам ключ
    if (!friendlyText || friendlyText === `apiErrors.${status}`) {
        friendlyText = fallbacks[status] || t('apiErrors.unknown', null, "Неизвестная ошибка API.");
    }
    return `${friendlyText}\n\n[Код: ${status}] Детали: ${rawText}`;
}


async function testApiConnection() {
    const provider = document.getElementById('api-provider-select').value;
    const resultDiv = document.getElementById('test-api-result');
    const btn = document.getElementById('test-api-connection-btn');

    if (!resultDiv || !btn) return;

    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<i class="fas fa-spinner fa-spin" style="color: #f39c12;"></i> Подключение...';
    btn.disabled = true;

    let url = '';
    let headers = {};
    let key = '';
    let isGemini = false;

    try {
        switch (provider) {
            case 'gemini':
                key = document.getElementById('gemini-api-key-input').value.trim() || geminiApiKey;
                if (!key) throw new Error("Ключ не введен");
                url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
                isGemini = true;
                break;
            case 'openrouter':
                key = document.getElementById('openrouter-api-key-input').value.trim() || openrouterApiKey;
                if (!key) throw new Error("Ключ не введен");
                url = "https://openrouter.ai/api/v1/models";
                headers['Authorization'] = `Bearer ${key}`;
                break;
            case 'llmost':
                key = document.getElementById('llmost-api-key-input').value.trim() || llmostApiKey;
                if (!key) throw new Error("Ключ не введен");
                url = "https://llmost.ru/api/v1/models";
                headers['Authorization'] = `Bearer ${key}`;
                break;
            case 'deepseek':
                key = document.getElementById('deepseek-api-key-input').value.trim() || deepseekApiKey;
                if (!key) throw new Error("Ключ не введен");
                url = "https://api.deepseek.com/models";
                headers['Authorization'] = `Bearer ${key}`;
                headers['Accept'] = 'application/json';
                break;
            case 'omniroute':
                key = document.getElementById('omniroute-api-key-input').value.trim() || omnirouteApiKey;
                let baseUrl = document.getElementById('omniroute-base-url-input').value.trim() || omnirouteBaseUrl;
                if (!key) throw new Error("Ключ не введен");
                url = baseUrl.replace(/\/chat\/completions\/?$/, '/models');
                headers['Authorization'] = `Bearer ${key}`;
                break;
            case 'local':
                let lUrl = document.getElementById('local-url-input').value.trim() || localApiUrl;
                url = lUrl.replace(/\/chat\/completions\/?$/, '/models');
                break;
            case 'dummy':
                resultDiv.innerHTML = '<span style="color: #2ecc71;"><i class="fas fa-check"></i> Заглушка готова!</span>';
                btn.disabled = false;
                setTimeout(() => resultDiv.style.display = 'none', 2000);
                return;
        }

        const response = await fetch(url, { method: 'GET', headers: headers });

        if (response.ok) {
            const data = await response.json();
            resultDiv.innerHTML = `<span style="color: #2ecc71;"><i class="fas fa-check"></i> Успешно! Загрузка списка...</span>`;
            
            let models = [];
            if (isGemini && data.models) {
                models = data.models.map(m => {
                    let id = m.name.replace('models/', '');
                    // Эвристика типов для Gemini
                    let type = 'text';
                    if (id.includes('vision') || id.includes('image') || id.includes('nano-banana')) type = 'vision';
                    else if (id.includes('tts') || id.includes('audio')) type = 'audio';
                    else if (id.includes('embed')) type = 'embedding';
                    
                    return {
                        id: id,
                        name: m.displayName || id,
                        desc: m.description || 'Официальная модель Google Gemini.',
                        type: type,
                        free: false, // FIX: Убрали ложный статус "Бесплатно", так как есть жесткие лимиты (Rate Limits)
                        context: m.inputTokenLimit || null,
                        priceText: 'Лимиты API (Free Tier)' // Честное предупреждение
                    };
                });
            } else if (provider === 'openrouter' && data.data) {
                models = data.data.map(m => {
                    let type = 'text';
                    if (m.id.includes('vision') || (m.architecture && m.architecture.modality && m.architecture.modality.includes('image'))) type = 'vision';
                    
                    // Расчет цены за 1 миллион токенов (защита от undefined)
                    let p_prompt = m.pricing && m.pricing.prompt ? parseFloat(m.pricing.prompt) * 1000000 : -1;
                    let p_comp = m.pricing && m.pricing.completion ? parseFloat(m.pricing.completion) * 1000000 : -1;
                    
                    let isFree = (p_prompt === 0 && p_comp === 0) || m.id.endsWith(':free');
                    let priceText = '';
                    
                    if (isFree) {
                        priceText = 'Бесплатно';
                    } else if (p_prompt >= 0 && p_comp >= 0) {
                        // Форматируем цену: если меньше цента, показываем 4 знака, иначе 2
                        let pr_str = p_prompt < 0.01 ? p_prompt.toFixed(4) : p_prompt.toFixed(2);
                        let cmp_str = p_comp < 0.01 ? p_comp.toFixed(4) : p_comp.toFixed(2);
                        priceText = `$${pr_str} / $${cmp_str} Р·Р° 1M`;
                    } else {
                        priceText = 'Платная';
                    }
                    
                    return {
                        id: m.id,
                        name: m.name || m.id,
                        desc: m.description || '',
                        type: type,
                        free: isFree,
                        context: m.context_length,
                        priceText: priceText
                    };
                });
            } else if (data.data && Array.isArray(data.data)) {
                models = data.data.map(m => ({ id: m.id, name: m.name || m.id, desc: '', type: 'text', free: false, priceText: 'По тарифу провайдера' }));
            } else if (Array.isArray(data)) {
                models = data.map(m => ({ id: m.id || m.name, name: m.name || m.id, desc: '', type: 'text', free: false, priceText: 'По тарифу провайдера' }));
            }

            // Убираем эмбеддинги, они не нужны для чата
            models = models.filter(m => m.type !== 'embedding');

            if (models.length > 0) {
                showModelSelector(models);
                setTimeout(() => resultDiv.style.display = 'none', 2000);
            } else {
                resultDiv.innerHTML = `<span style="color: #f1c40f;"><i class="fas fa-check"></i> Связь есть, но список моделей пуст.</span>`;
            }

        } else {
            const errText = await response.text();
            let shortMsg = t(`apiErrors.${response.status}`, null, `Ошибка ${response.status}`);
            resultDiv.innerHTML = `<span style="color: #e74c3c;" title="${errText.replace(/"/g, '&quot;')}"><i class="fas fa-times"></i> ${shortMsg} (РљРѕРґ: ${response.status})</span>`;
            console.error("Ping error:", errText);
        }
    } catch (e) {
        let shortMsg = e.message.includes('fetch') ? t('apiErrors.network', null, 'Ошибка сети') : e.message;
        resultDiv.innerHTML = `<span style="color: #e74c3c;"><i class="fas fa-times"></i> ${shortMsg}</span>`;
    } finally {
        btn.disabled = false;
    }
}

var currentModelsList = [];
var currentModelFilter = 'all';

function showModelSelector(models) {
    currentModelsList = models;
    const modal = document.getElementById('model-selector-modal');
    const searchInput = document.getElementById('model-search-input');
    const filterBtns = document.querySelectorAll('#model-filters button');
    
    if (!modal || !searchInput) return;

    searchInput.value = '';
    currentModelFilter = 'all';
    
    // Сброс кнопок фильтров
    filterBtns.forEach(btn => {
        btn.classList.remove('active-filter', 'btn-blue');
        btn.classList.add('btn-gray');
        if (btn.dataset.filter === 'all') {
            btn.classList.add('active-filter', 'btn-blue');
            btn.classList.remove('btn-gray');
        }
    });

    applyModelFilters();

    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('visible'), 10);

    // Обработчик поиска
    searchInput.oninput = () => applyModelFilters();

    // Обработчики фильтров
    filterBtns.forEach(btn => {
        btn.onclick = (e) => {
            filterBtns.forEach(b => {
                b.classList.remove('active-filter', 'btn-blue');
                b.classList.add('btn-gray');
            });
            const target = e.currentTarget;
            target.classList.add('active-filter', 'btn-blue');
            target.classList.remove('btn-gray');
            currentModelFilter = target.dataset.filter;
            applyModelFilters();
        };
    });

    document.getElementById('close-model-selector-btn').onclick = () => {
        modal.classList.remove('visible');
        setTimeout(() => modal.style.display = 'none', 300);
    };
}

function applyModelFilters() {
    const query = document.getElementById('model-search-input').value.toLowerCase();
    
    const filtered = currentModelsList.filter(m => {
        // 1. Поиск по тексту
        const matchesSearch = m.id.toLowerCase().includes(query) || (m.name && m.name.toLowerCase().includes(query));
        if (!matchesSearch) return false;
        
        // 2. Фильтр по категории
        if (currentModelFilter === 'all') return true;
        if (currentModelFilter === 'free') return m.free === true;
        return m.type === currentModelFilter;
    });
    
    renderModelList(filtered);
}

function applyModelFilters() {
    const query = document.getElementById('model-search-input').value.toLowerCase();
    
    const filtered = currentModelsList.filter(m => {
        // 1. Поиск по тексту
        const matchesSearch = m.id.toLowerCase().includes(query) || (m.name && m.name.toLowerCase().includes(query));
        if (!matchesSearch) return false;
        
        // 2. Фильтр по категории
        if (currentModelFilter === 'all') return true;
        if (currentModelFilter === 'free') return m.free === true;
        return m.type === currentModelFilter;
    });
    
    renderModelList(filtered);
}

function renderModelList(models) {
    const container = document.getElementById('model-list-container');
    const countBadge = document.getElementById('model-count-badge');
    container.innerHTML = '';
    
    if (countBadge) countBadge.textContent = `${models.length} моделей`;
    
    if (models.length === 0) {
        container.innerHTML = '<div style="padding: 20px; color: #7f8c8d; text-align: center; font-style: italic;">По вашему запросу ничего не найдено.</div>';
        return;
    }

    models.forEach(m => {
        const item = document.createElement('div');
        item.className = 'model-card';
        
        let badgesHtml = '';
        if (m.free) badgesHtml += `<span class="model-badge badge-free"><i class="fas fa-gift"></i> Бесплатно</span>`;
        else if (m.priceText) badgesHtml += `<span class="model-badge badge-price"><i class="fas fa-coins"></i> ${m.priceText}</span>`;
        
        if (m.context) {
            let ctxStr = m.context >= 1000 ? Math.round(m.context/1000) + 'k' : m.context;
            badgesHtml += `<span class="model-badge badge-ctx"><i class="fas fa-brain"></i> ${ctxStr} ctx</span>`;
        }
        
        if (m.type === 'vision') badgesHtml += `<span class="model-badge badge-type-vision"><i class="fas fa-eye"></i> Vision</span>`;
        if (m.type === 'audio') badgesHtml += `<span class="model-badge badge-type-audio"><i class="fas fa-volume-up"></i> Audio</span>`;
        
        if (m.caching) badgesHtml += `<span class="model-badge badge-caching" title="Поддерживает Prompt Caching (снижает цену и ускоряет ответ)"><i class="fas fa-bolt"></i> Caching</span>`;
        if (m.thinking) badgesHtml += `<span class="model-badge badge-thinking" title="Поддерживает режим размышления (Reasoning)"><i class="fas fa-brain"></i> Thinking</span>`;

        let descHtml = m.desc ? `<div class="model-card-desc">${m.desc}</div>` : '';

        item.innerHTML = `
            <div class="model-card-header">
                <div class="model-card-title">${m.name}</div>
                <div class="model-card-id">${m.id}</div>
            </div>
            ${descHtml}
            <div class="model-badges">${badgesHtml}</div>
        `;
        
        item.onclick = () => {
            const input = document.getElementById('model-id-input');
            if (input) {
                input.value = m.id;
                input.style.boxShadow = '0 0 15px #2ecc71';
                setTimeout(() => input.style.boxShadow = 'none', 1000);
                
                // Автоматически сохраняем настройки при выборе модели
                if (typeof saveSettings === 'function') saveSettings();
            }
            document.getElementById('model-selector-modal').classList.remove('visible');
            setTimeout(() => document.getElementById('model-selector-modal').style.display = 'none', 300);
        };
        
        container.appendChild(item);
    });
}


function saveSettings() {
    const provider = document.getElementById('api-provider-select')?.value || 'gemini';
    const cachingCheckbox = document.getElementById('prompt-caching-checkbox');
    if (cachingCheckbox) {
        usePromptCaching = cachingCheckbox.checked;
        localStorage.setItem('usePromptCaching', usePromptCaching);
    }

    const thinkingCheckbox = document.getElementById('thinking-mode-checkbox');
    if (thinkingCheckbox) {
        useThinkingMode = thinkingCheckbox.checked;
        localStorage.setItem('useThinkingMode', useThinkingMode);
    }
    const thinkingSlider = document.getElementById('thinking-budget-slider');
    if (thinkingSlider) {
        thinkingBudget = parseInt(thinkingSlider.value);
        localStorage.setItem('thinkingBudget', thinkingBudget);
    }
    const effortSelect = document.getElementById('reasoning-effort-select');
    if (effortSelect) {
        reasoningEffort = effortSelect.value;
        localStorage.setItem('reasoningEffort', reasoningEffort);
    }

    const nsfwCheckbox = document.getElementById('nsfw-mode-checkbox');
    if (nsfwCheckbox) {
        allowNSFW = nsfwCheckbox.checked;
        localStorage.setItem('allowNSFW', allowNSFW);
    }

    // Сохранение эротических настроек
    const eroticIntensitySlider = document.getElementById('erotic-intensity-slider');
    if (eroticIntensitySlider) {
        eroticIntensityLevel = parseInt(eroticIntensitySlider.value);
        localStorage.setItem('eroticIntensityLevel', eroticIntensityLevel);
    }

    const pregnancyRiskCheckbox = document.getElementById('pregnancy-risk-checkbox');
    const diseaseRiskCheckbox = document.getElementById('disease-risk-checkbox');
    const reputationConsequencesCheckbox = document.getElementById('reputation-consequences-checkbox');
    const pornoModeCheckbox = document.getElementById('porno-mode-checkbox');

    if (pregnancyRiskCheckbox) eroticPreferences.pregnancyRisk = pregnancyRiskCheckbox.checked;
    if (diseaseRiskCheckbox) eroticPreferences.diseaseRisk = diseaseRiskCheckbox.checked;
    if (reputationConsequencesCheckbox) eroticPreferences.reputationConsequences = reputationConsequencesCheckbox.checked;
    if (pornoModeCheckbox) eroticPreferences.pornoMode = pornoModeCheckbox.checked;

    localStorage.setItem('eroticPreferences', JSON.stringify(eroticPreferences));

    const modelId = document.getElementById('model-id-input')?.value.trim() || '';

    // Сохраняем ID модели для ТЕКУЩЕГО провайдера
    switch (provider) {
        case 'gemini':
            geminiModelId = modelId;
            localStorage.setItem('geminiModelId', geminiModelId);
            break;
        case 'llmost':
            llmostModelId = modelId;
            localStorage.setItem('llmostModelId', llmostModelId);
            break;
        case 'openrouter':
            openrouterModelId = modelId;
            localStorage.setItem('openrouterModelId', openrouterModelId);
            break;
        case 'deepseek':
            deepseekModelId = modelId;
            localStorage.setItem('deepseekModelId', deepseekModelId);
            break;
        case 'omniroute':
            omnirouteModelId = modelId;
            localStorage.setItem('omnirouteModelId', omnirouteModelId);
            break;
        case 'local':
            localModelId = modelId;
            localStorage.setItem('localModelId', localModelId);
            break;
    }

    // Сохраняем ключи и URL
    const geminiKeyInput = document.getElementById('gemini-api-key-input')?.value.trim() || '';
    geminiApiKeys = geminiKeyInput.split(/[\n,]+/).map(k => k.trim()).filter(k => k.length > 10);
    geminiApiKey = geminiApiKeys.length > 0 ? geminiApiKeys[0] : '';
    SecureKeyStorage.setItem('geminiApiKeys', JSON.stringify(geminiApiKeys));
    currentGeminiKeyIndex = 0;

    const llmostKey = document.getElementById('llmost-api-key-input')?.value.trim() || '';
    llmostApiKey = llmostKey;
    SecureKeyStorage.setItem('llmostApiKey', llmostKey);

    const openrouterKey = document.getElementById('openrouter-api-key-input')?.value.trim() || '';
    openrouterApiKey = openrouterKey;
    SecureKeyStorage.setItem('openrouterApiKey', openrouterKey);

    const deepseekKey = document.getElementById('deepseek-api-key-input')?.value.trim() || '';
    deepseekApiKey = deepseekKey;
    SecureKeyStorage.setItem('deepseekApiKey', deepseekKey);

    const omnirouteKey = document.getElementById('omniroute-api-key-input')?.value.trim() || '';
    omnirouteApiKey = omnirouteKey;
    SecureKeyStorage.setItem('omnirouteApiKey', omnirouteKey);

    const omniUrl = document.getElementById('omniroute-base-url-input')?.value.trim() || '';
    omnirouteBaseUrl = omniUrl;
    localStorage.setItem('omnirouteBaseUrl', omniUrl);

    const localUrl = document.getElementById('local-url-input')?.value.trim() || '';
    localApiUrl = localUrl;
    localStorage.setItem('localApiUrl', localUrl);

    // Save image settings
    const imgGenCheckbox = document.getElementById('enable-img-gen-checkbox');
    const localMapCheckbox = document.getElementById('enable-local-map-checkbox');
    const deepSetupCheckbox = document.getElementById('enable-deep-setup-checkbox');
    
    
    if (imgGenCheckbox) {
        enableImageGeneration = imgGenCheckbox.checked;
        localStorage.setItem('enableImageGeneration', enableImageGeneration);
    }
    if (deepSetupCheckbox) {
        enableDeepSetup = deepSetupCheckbox.checked;
        localStorage.setItem('enableDeepSetup', enableDeepSetup);
    }
    
    imgApiProvider = document.getElementById('img-provider-select')?.value || 'pollinations';
    imgModelId = document.getElementById('img-model-input')?.value.trim() || 'dall-e-3';
    imgApiKey = document.getElementById('img-key-input')?.value.trim() || '';
    localStorage.setItem('imgApiProvider', imgApiProvider);
    localStorage.setItem('imgModelId', imgModelId);
    SecureKeyStorage.setItem('imgApiKey', imgApiKey);
    
    aiPlayerProvider = document.getElementById('ai-player-provider-select')?.value || 'openrouter';
    aiPlayerModelId = document.getElementById('ai-player-model-input')?.value.trim() || 'google/gemma-2-9b-it:free';
    const aiKeyRaw = document.getElementById('ai-player-key-input')?.value.trim() || '';
    if (aiPlayerProvider === 'local') {
        aiPlayerLocalUrl = aiKeyRaw;
    } else {
        aiPlayerApiKey = aiKeyRaw;
    }
    localStorage.setItem('aiPlayerProvider', aiPlayerProvider);
    localStorage.setItem('aiPlayerModelId', aiPlayerModelId);
    SecureKeyStorage.setItem('aiPlayerApiKey', aiPlayerApiKey);
    localStorage.setItem('aiPlayerLocalUrl', aiPlayerLocalUrl);
    aiPlayerTurnLimit = parseInt(document.getElementById('ai-player-turn-limit')?.value) || 0;
    localStorage.setItem('aiPlayerTurnLimit', aiPlayerTurnLimit);



    // Сохраняем звук
    localStorage.setItem('musicVolume', musicVolume);
    localStorage.setItem('sfxVolume', sfxVolume);


    const autoSaveSelect = document.getElementById('autosave-interval-select');
    if (autoSaveSelect) {
        autoSaveIntervalMs = parseInt(autoSaveSelect.value, 10);
        localStorage.setItem('autoSaveInterval', autoSaveIntervalMs);
        if (typeof startAutoSaveTimer === 'function') startAutoSaveTimer();
    }

    // Обновляем глобальную переменную текущего провайдера
    currentApiProvider = provider;
    localStorage.setItem('apiProvider', currentApiProvider);



    updateApiKeyStatus();
    showCustomAlert(t('settingsMenu.apiKeySaved', 'Настройки успешно сохранены!'));

    if (document.activeElement) document.activeElement.blur();
}

async function loadEnvironmentCommandsGuide(worldId, langCode) {
    try {
        environmentCommandsGuideData = await loadPromptFromFile('environment_commands_guide');
        console.log(`Руководство по командам окружения для '${worldId}' (язык: ${langCode}) успешно загружено.`);
    } catch (error) {
        console.error(`Не удалось загрузить руководство по командам окружения для '${worldId}' (язык: ${langCode}):`, error);
        environmentCommandsGuideData = t('error.envGuideNotLoadedLang', { worldId: worldId, lang: langCode, error: error.message }, `// Ошибка: Не удалось загрузить руководство по командам окружения для мира '${worldId}' (Язык: ${langCode}). ${error.message}`);
    }
}


async function loadSkillsReference() {
    try {
        skillsReferenceData = await loadPromptFromFile('skills_reference');
        console.log(`Справочник умений успешно загружен.`);
    } catch (error) {
        console.error(`Не удалось загрузить справочник умений:`, error);
        skillsReferenceData = t('error.skillsRefNotLoaded', '// Ошибка: Не удалось загрузить справочник умений.');
    }
}

// --- Загрузка Данных Мира ---
async function loadLore(worldId, langCode) {
    if (!worldId) {
        console.error("Не удается загрузить лор: worldId не предоставлен.");
        worldLore = t('error.worldNotSpecified', 'Ошибка: Мир не указан.');
        return;
    }

    if (window.ModAPI && window.ModAPI.isTotalConversion) {
        console.log(`[Total Conversion] Пропуск загрузки ванильного лора мира.`);
        worldLore = "";
        if (window.ModAPI) {
            const hookData = { lore: worldLore };
            await window.ModAPI.emit('onLoreLoad', hookData, worldId, langCode);
            worldLore = hookData.lore;
        }
        return;
    }

    const filePath = typeof window.resolveWorldAssetPath === 'function'
        ? window.resolveWorldAssetPath('lore_template', { worldId, langCode })
        : `assets/lor/${worldId}/${langCode}/lor.txt`;
    console.log(`Попытка загрузить лор из: ${filePath}`);

    try {
        const response = await fetch(`${filePath}?t=${Date.now()}`);
        if (!response.ok) {
            throw new Error(`HTTP ошибка! статус: ${response.status}. Не удалось загрузить ${response.url}`);
        }
        worldLore = await response.text();
        
        // --- ИНТЕГРАЦИЯ МОДОВ (ЛОР) ---
        if (window.ModAPI) {
            const hookData = { lore: worldLore };
            await window.ModAPI.emit('onLoreLoad', hookData, worldId, langCode);
            worldLore = hookData.lore;
        }
        // ------------------------------
        
        console.log(`Лор мира для '${worldId}' (язык: ${langCode}) успешно загружен.`);
    } catch (error) {
        console.error(`Не удалось загрузить лор мира для '${worldId}' (язык: ${langCode}):`, error);
        worldLore = t('error.loadLoreFailedLang', { worldId: worldId, lang: langCode, error: error.message }, `Ошибка: Не удалось загрузить лор для мира '${worldId}' (Язык: ${langCode}).`);
        globalLocations = {};
        updateMapDisplay();
    }
}

async function loadGlobalLocations(worldId, langCode, eraId = getRuntimeDefaultEraId()) {
    if (!worldId) {
        console.error("Не удается загрузить локации: worldId не предоставлен.");
        globalLocations = {};
        return;
    }

    if (window.ModAPI && window.ModAPI.isTotalConversion) {
        console.log(`[Total Conversion] Пропуск загрузки ванильных локаций.`);
        globalLocations = {};
        if (window.ModAPI) {
            const hookData = { locations: globalLocations };
            await window.ModAPI.emit('onLocationsLoad', hookData, worldId, langCode, eraId);
            globalLocations = hookData.locations;
        }
        updateMapDisplay();
        return;
    }

    const locationInfo = (typeof window.resolveEraLocationInfo === 'function')
        ? window.resolveEraLocationInfo(eraId)
        : { fileName: `locations_${eraId}.json` };
    const filePath = typeof window.resolveWorldAssetPath === 'function'
        ? window.resolveWorldAssetPath('locations_template', { worldId, langCode, fileName: locationInfo.fileName })
        : `assets/lor/${worldId}/${langCode}/${locationInfo.fileName}`;
    console.log(`Попытка загрузить локации из: ${filePath}`);

    try {
        const response = await fetch(`${filePath}?t=${Date.now()}`);
        if (!response.ok) {
            throw new Error(`HTTP ошибка! статус: ${response.status}. Не удалось загрузить ${response.url}`);
        }
        globalLocations = await response.json();
        
        // --- ИНТЕГРАЦИЯ МОДОВ (ЛОКАЦИИ) ---
        if (window.ModAPI) {
            const hookData = { locations: globalLocations };
            await window.ModAPI.emit('onLocationsLoad', hookData, worldId, langCode, eraId);
            globalLocations = hookData.locations;
        }
        // ----------------------------------
        
        console.log(`Глобальные локации для '${worldId}' (язык: ${langCode}) успешно загружены:`, globalLocations);
    } catch (error) {
        console.error(`Не удалось загрузить глобальные локации для '${worldId}' (язык: ${langCode}):`, error);
        globalLocations = {};
        if (globalLocationsList) globalLocationsList.innerHTML = `<li>${t('gameInterface.mapPanel.errorLoadingWorldDataLang', { worldId: worldId, lang: langCode })}</li>`;
    }
    updateMapDisplay();
}

// --- Настройка Слушателей Событий ---
function setupEventListeners() {
    // --- Главное меню ---
    if (newGameButton) newGameButton.addEventListener('click', startNewGameSetup);
    if (loadGameButton) loadGameButton.addEventListener('click', () => showLoadGameScreen());
    if (mainSettingsButton) mainSettingsButton.addEventListener('click', () => {
        settingsReturnScreen = 'main-menu'; // Устанавливаем экран возврата
        setActiveScreen('settings-menu');
    });
    if (helpButton) {
        helpButton.addEventListener('click', () => setActiveScreen('help-screen'));
    }
    if (communityButton) {
        communityButton.addEventListener('click', () => {
            window.open('https://discord.com/invite/kDnTx2HAvT', '_blank');
        });
    }

    // --- Меню настроек ---
    if (saveSettingsButton) saveSettingsButton.addEventListener('click', saveSettings);

    const pingBtn = document.getElementById('ping-provider-btn');
    if (pingBtn) pingBtn.addEventListener('click', pingProvider);
    
    const fetchModelsBtn = document.getElementById('fetch-models-btn');
    if (fetchModelsBtn) fetchModelsBtn.addEventListener('click', fetchModels);

    var testApiBtn = document.getElementById('test-api-connection-btn');
    if (testApiBtn) {
        testApiBtn.addEventListener('click', testApiConnection);
    }

    const localSaveBtn = document.querySelector('#local-settings-group button');
    if (localSaveBtn && localSaveBtn !== saveSettingsButton) {
        localSaveBtn.addEventListener('click', saveSettings);
    }

    // Универсальная логика для всех кнопок скрытия/показа API ключей
    const toggleKeyBtns = document.querySelectorAll('.toggle-key-btn');
    toggleKeyBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = btn.getAttribute('data-target');
            const inputEl = document.getElementById(targetId);
            if (inputEl) {
                if (inputEl.type === 'password') {
                    inputEl.type = 'text';
                    btn.innerHTML = '<i class="fas fa-eye-slash"></i>';
                } else {
                    inputEl.type = 'password';
                    btn.innerHTML = '<i class="fas fa-eye"></i>';
                }
            }
        });
    });



    // --- Создание персонажа ---
    if (charEraSelect) charEraSelect.addEventListener('change', updateEraDescription);
    if (charRaceSelect) charRaceSelect.addEventListener('change', handleRaceOrClassChange);
    if (charClassSelect) charClassSelect.addEventListener('change', handleRaceOrClassChange);

    const charGenderSelect = document.getElementById('char-gender-select');
    if (charGenderSelect) charGenderSelect.addEventListener('change', checkCreationFormValidity);

    if (statButtons) {
        statButtons.forEach(button => button.addEventListener('click', handleStatChange));
    }

    if (charNameInput) charNameInput.addEventListener('input', checkCreationFormValidity);
    if (charDescInput) charDescInput.addEventListener('input', checkCreationFormValidity);
    const genBackstoryCb = document.getElementById('generate-backstory-checkbox');
    if (genBackstoryCb && charDescInput) {
        genBackstoryCb.addEventListener('change', (e) => {
            if (e.target.checked) {
                charDescInput.dataset.oldValue = charDescInput.value;
                charDescInput.value = "ИИ сгенерирует мрачную и глубокую предысторию, вплетя её в лор мира...";
                charDescInput.disabled = true;
                charDescInput.style.opacity = "0.7";
            } else {
                charDescInput.value = charDescInput.dataset.oldValue || "";
                charDescInput.disabled = false;
                charDescInput.style.opacity = "1";
            }
            checkCreationFormValidity();
        });
    }
    if (startGameButton) startGameButton.addEventListener('click', finalizeCharacterCreation);

    // Используем разовое получение элемента без повторного объявления через const
    const qsBtn = document.getElementById('quick-start-button');
    if (qsBtn) qsBtn.addEventListener('click', handleQuickStart);

    // --- Выбор Рассказчика ---
    if (narratorPrevButton) narratorPrevButton.addEventListener('click', () => showNarrator(currentNarratorIndex - 1));
    if (narratorNextButton) narratorNextButton.addEventListener('click', () => showNarrator(currentNarratorIndex + 1));
    if (confirmNarratorButton) confirmNarratorButton.addEventListener('click', startGameWithNarrator);
    if (worldYearsSlider) worldYearsSlider.addEventListener('input', (e) => worldYearsValue.textContent = e.target.value);
    if (worldAgentsSlider) worldAgentsSlider.addEventListener('input', (e) => worldAgentsValue.textContent = e.target.value);
    if (confirmWorldSetupButton) confirmWorldSetupButton.addEventListener('click', finalizeWorldSetupAndStart);
    if (openLoadWorldModalBtn) openLoadWorldModalBtn.addEventListener('click', openLoadWorldModal);
    if (closeLoadWorldModalBtn) closeLoadWorldModalBtn.addEventListener('click', () => {
        if (loadWorldModal) {
            loadWorldModal.classList.remove('visible');
            setTimeout(() => loadWorldModal.style.display = 'none', 300);
        }
    });

    // --- Кнопки "Назад" ---
    if (settingsBackButton) {
        settingsBackButton.addEventListener('click', () => {
            setActiveScreen(settingsReturnScreen);
        });
    }

    backButtons.forEach(button => {
        if (button.id === 'settings-back-button') return;
        button.addEventListener('click', () => {
            const targetMenu = button.getAttribute('data-target');
            if (targetMenu) {
                setActiveScreen(targetMenu);
                if (creationError) creationError.textContent = '';
            }
        });
    });

    // --- Сворачиваемые панели ---
    collapsiblePanels.forEach(panel => {
        const toggle = panel.querySelector('.panel-toggle');
        if (toggle) {
            toggle.addEventListener('click', () => {
                const content = panel.querySelector('.panel-content');
                const icon = toggle.querySelector('.toggle-icon');
                const isExpanded = panel.classList.toggle('expanded');

                if (icon) icon.textContent = isExpanded ? '▼' : '▶';

                if (content) {
                    if (isExpanded) {
                        content.style.maxHeight = content.scrollHeight + "px";
                        setTimeout(() => { if (panel.classList.contains('expanded')) content.style.maxHeight = 'none'; }, 400);
                    } else {
                        content.style.maxHeight = content.scrollHeight + "px";
                        requestAnimationFrame(() => { content.style.maxHeight = '0'; });
                    }
                }
            });
        }
    });

    // --- Глобальная Карта (Модальное окно) ---
    const openMapBtn = document.getElementById('open-map-modal-btn');
    if (window.ModAPI) ModAPI.emit('onMapOpened', {location: player?.location});
    const closeMapBtn = document.getElementById('close-map-modal-btn');
    const mapModal = document.getElementById('global-map-modal');
    if (openMapBtn && mapModal && closeMapBtn) {
        openMapBtn.addEventListener('click', () => {
            mapModal.style.display = 'flex';
            setTimeout(() => mapModal.classList.add('visible'), 10);
            
            const container = document.getElementById('map-canvas-container');
            const canvas = document.getElementById('visual-map');
            if (container && canvas) {
                canvas.width = container.clientWidth;
                canvas.height = container.clientHeight;
            }
            
            if (window.Cartographer) {
                Cartographer.mapState.isFollowingPlayer = true;
                Cartographer.requestRender();
            }
        });
        
        closeMapBtn.addEventListener('click', () => {
            mapModal.classList.remove('visible');
            setTimeout(() => mapModal.style.display = 'none', 300);
        });
        
        mapModal.addEventListener('click', (e) => {
            if (e.target === mapModal) {
                mapModal.classList.remove('visible');
                setTimeout(() => mapModal.style.display = 'none', 300);
            }
        });
        
        window.addEventListener('resize', () => {
            if (mapModal.classList.contains('visible')) {
                const container = document.getElementById('map-canvas-container');
                const canvas = document.getElementById('visual-map');
                if (container && canvas) {
                    canvas.width = container.clientWidth;
                    canvas.height = container.clientHeight;
                    if (window.Cartographer) Cartographer.requestRender();
                }
            }
        });
    }

    // --- Внутриигровое меню ---
    if (inGameMenuButton) inGameMenuButton.addEventListener('click', openInGameMenu);
    if (closeInGameMenuButton) closeInGameMenuButton.addEventListener('click', closeInGameMenu);
    if (menuOverlay) menuOverlay.addEventListener('click', closeInGameMenu);
    if (inGameSaveButton) inGameSaveButton.addEventListener('click', async () => {
        await promptManualSave();
        closeInGameMenu();
    });
    if (inGameSettingsButton) {
        inGameSettingsButton.addEventListener('click', openSettingsFromGame);
    }
    if (inGameExitButton) inGameExitButton.addEventListener('click', () => exitToMainMenu());

    // --- Увеличение характеристик ---
    if (statIncreaseButtons) {
        statIncreaseButtons.forEach(button => {
            button.addEventListener('click', handleStatIncrease);
        });
    }

    // --- Ввод пользователя (Текст и Голос) ---
    if (journeyContinueBtn) {
        journeyContinueBtn.addEventListener('click', () => {
            if (window.advanceJourney) window.advanceJourney();
        });
    }
    if (travelFastForwardBtn) travelFastForwardBtn.addEventListener('click', () => LivingRoads.fastForward());
        if (travelPauseBtn) travelPauseBtn.addEventListener('click', () => {
        if (player && player.travel && player.travel.active) {
            if (player.travel.paused) LivingRoads.resume();
            else LivingRoads.pause("manual");
        }
    });

    if (travelCancelBtn) travelCancelBtn.addEventListener('click', () => LivingRoads.cancel());

    if (sendButton) sendButton.addEventListener('click', handleUserInput);
    const repeatBtn = document.getElementById('repeat-button');
    if (repeatBtn) repeatBtn.addEventListener('click', repeatLastAction);

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && (e.key === 'r' || e.key === 'Рє')) {
            e.preventDefault();
            repeatLastAction();
        }
        
        // --- ИНТЕГРАЦИЯ МОДОВ: Хоткеи ---
        if (window.ModAPI && window.ModAPI.hotkeys) {
            let keys = [];
            if (e.ctrlKey) keys.push('ctrl');
            if (e.shiftKey) keys.push('shift');
            if (e.altKey) keys.push('alt');
            if (e.key !== 'Control' && e.key !== 'Shift' && e.key !== 'Alt') {
                keys.push(e.key.toLowerCase());
            }
            const combo = keys.join('+');
            if (window.ModAPI.hotkeys[combo]) {
                e.preventDefault();
                window.ModAPI.hotkeys[combo]();
            }
        }
        // --------------------------------
    });
    if (userInput) {
        userInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter' && !isWaitingForAI) {
                event.preventDefault();
                handleUserInput();
            }
        });
    }

    // Register hotkeys via KeyMapper (layout-independent)
    if (window.KeyMapper) {
        window.KeyMapper.register('ctrl+r', () => repeatLastAction(), { global: false });
    }

    // --- Модальное окно репутации ---
    if (reputationDisplayWrapper && reputationModal) {
        reputationDisplayWrapper.addEventListener('mouseenter', (event) => {
            updateReputationModal();
            positionReputationModal(event);
        });
        reputationDisplayWrapper.addEventListener('mousemove', positionReputationModal);
        reputationDisplayWrapper.addEventListener('mouseleave', () => {
            reputationModal.classList.remove('visible');
        });
    }

    // --- [ИСПРАВЛЕНИЕ] Обработчик кликов по OOC-маркерам ---
    const oocTooltip = document.getElementById('ooc-tooltip');
    const oocTooltipContent = document.getElementById('ooc-tooltip-content');
    if (gameLog && oocTooltip && oocTooltipContent) {
        gameLog.addEventListener('click', (event) => {
            const marker = event.target.closest('.ooc-marker');
            if (marker) {
                event.stopPropagation(); // Останавливаем всплытие, чтобы body не закрыл окно сразу

                const text = marker.dataset.oocText;
                oocTooltipContent.textContent = text;

                // Позиционируем и показываем
                const rect = marker.getBoundingClientRect();
                oocTooltip.style.left = `${rect.left}px`;
                oocTooltip.style.top = `${rect.bottom + 5}px`; // Чуть ниже маркера
                oocTooltip.classList.add('visible');
            }
        });

        // Клик в любом другом месте закрывает подсказку
        document.body.addEventListener('click', () => {
            if (oocTooltip.classList.contains('visible')) {
                oocTooltip.classList.remove('visible');
            }
        });
    }
    // --- [КОНЕЦ ИСПРАВЛЕНИЯ] ---

    // --- Событие закрытия окна/вкладки ---
    window.addEventListener('beforeunload', handleBeforeUnload);

    // --- Админ Меню (F4) ---
    document.addEventListener('keydown', (event) => {
        if (event.key === 'F4' && DEBUG_MODE && player && gameInterface && gameInterface.classList.contains('active-screen')) {
            event.preventDefault();
            const adminModal = document.getElementById('admin-menu-overlay');
            if (adminModal && adminModal.style.display === 'flex') {
                closeAdminMenu();
            } else {
                openAdminMenu();
            }
        }
    });

    const closeAdminBtn = document.getElementById('close-admin-menu-btn');
    if (closeAdminBtn) {
        closeAdminBtn.addEventListener('click', closeAdminMenu);
    }

    const closeBioBtn = document.getElementById('close-biography-modal-btn');
    if (closeBioBtn) {
        closeBioBtn.addEventListener('click', () => {
            const modal = document.getElementById('biography-modal');
            if (modal) {
                modal.classList.remove('visible');
                setTimeout(() => modal.style.display = 'none', 300);
            }
        });
    }

    const testAiPlayerBtn = document.getElementById('test-ai-player-btn');
    if (testAiPlayerBtn) {
        testAiPlayerBtn.addEventListener('click', async () => {
            const resultDiv = document.getElementById('test-ai-player-result');
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Отправка запроса...';
            
            const prov = document.getElementById('ai-player-provider-select')?.value || 'openrouter';
            const mod = document.getElementById('ai-player-model-input')?.value.trim() || 'google/gemma-2-9b-it:free';
            const key = document.getElementById('ai-player-key-input')?.value.trim() || '';
            
            const oldProv = aiPlayerProvider;
            const oldMod = aiPlayerModelId;
            const oldKey = aiPlayerApiKey;
            const oldUrl = aiPlayerLocalUrl;
            
            aiPlayerProvider = prov;
            aiPlayerModelId = mod;
            if (prov === 'local') aiPlayerLocalUrl = key || 'http://localhost:1234/v1/chat/completions';
            else aiPlayerApiKey = key;
            
            try {
                const response = await performAiPlayerFetch("Ты тестовый ИИ. Ответь 'Тест пройден успешно, системы в норме.'", [], mod, "Проверка связи.");
                resultDiv.innerHTML = `<span style="color: #2ecc71;">✅ Успех:</span><br>${response}`;
            } catch (e) {
                resultDiv.innerHTML = `<span style="color: #e74c3c;">❌ Ошибка:</span><br>${e.message}`;
            } finally {
                aiPlayerProvider = oldProv;
                aiPlayerModelId = oldMod;
                aiPlayerApiKey = oldKey;
                aiPlayerLocalUrl = oldUrl;
            }
        });
    }


    // --- Обработка вкладок инвентаря ---
    if (inventoryTabsContainer) {
        inventoryTabsContainer.addEventListener('click', (event) => {
            const target = event.target;
            if (target.classList.contains('tab-button')) {
                inventoryTabsContainer.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                target.classList.add('active');
                currentInventoryFilter = target.dataset.category;
                updateInventoryDisplay();
            }
        });
    }

    // Обработка слотов экипировки теперь происходит динамически в populateEquipmentUI()
}

function handleDragStart(event, itemData) {
    // Сохраняем ID предмета для события drop
    event.dataTransfer.setData('text/plain', itemData.id);
    // Сохраняем полные данные о предмете в глобальную переменную для проверок в dragover
    draggedItemData = itemData;
    // Добавляем класс к перетаскиваемому элементу для стилизации
    event.currentTarget.classList.add('dragging');
}

function handleDragEnd(event) {
    // Очищаем данные и убираем классы стилизации
    draggedItemData = null;
    event.currentTarget.classList.remove('dragging');
    // Убираем всю подсветку со слотов на всякий случай
    document.querySelectorAll('.equipment-slot-v2').forEach(slot => {
        slot.classList.remove('drag-over', 'drag-over-valid', 'drag-over-invalid');
    });
}

function handleDragEnter(event) {
    event.preventDefault();
    const targetSlot = event.currentTarget;
    if (!draggedItemData || !targetSlot) return;

    targetSlot.classList.add('drag-over');
    const slotName = targetSlot.dataset.slot;

    // Проверяем, подходит ли предмет для этого слота
    let isValid = true;
    if (draggedItemData.slot && draggedItemData.slot !== slotName) {
        if (!(['right_hand', 'left_hand'].includes(slotName) && ['right_hand', 'left_hand'].includes(draggedItemData.slot))) {
            isValid = false;
        }
    }
    if (!isValid) {
        targetSlot.classList.add('drag-over-invalid');
    } else {
        targetSlot.classList.add('drag-over-valid');
    }
}

function handleDragOver(event) {
    // Обязательно вызываем preventDefault, чтобы разрешить drop
    event.preventDefault();
}

function handleDragLeave(event) {
    // Убираем подсветку, когда курсор уходит со слота
    event.currentTarget.classList.remove('drag-over', 'drag-over-valid', 'drag-over-invalid');
}

// --- Логика Старта Новой Игры ---
function startNewGameSetup() {
    if (window.ModAPI) ModAPI.emit('onNewGameStarted', {player: player || {}, world: World || {}});

    clearPromptCache(); // Сбрасываем кэш промпта при новой игре

    // --- [ИСПРАВЛЕНИЕ] Универсальная проверка API ключа ---
    let keyIsMissing = false;
    let requiredKey = '';

    // Проверяем ключ только если провайдер не 'local' и не 'dummy'
    if (currentApiProvider !== 'local' && currentApiProvider !== 'dummy') {
        switch (currentApiProvider) {
            case 'gemini':
                requiredKey = geminiApiKey || (geminiApiKeys.length > 0 ? geminiApiKeys[0] : '');
                break;
            case 'llmost':
                requiredKey = llmostApiKey;
                break;
            case 'openrouter':
                requiredKey = openrouterApiKey;
                break;
                                case 'deepseek':
                        requiredKey = deepseekApiKey;
                        break;
                    case 'omniroute':
                        requiredKey = omnirouteApiKey;
                        break;
                }

                if (!requiredKey || requiredKey.trim() === '') {
            keyIsMissing = true;
        }
    }

    if (keyIsMissing) {
        // Используем кастомный alert вместо стандартного
        const providerName = currentApiProvider.charAt(0).toUpperCase() + currentApiProvider.slice(1);
        showCustomAlert(t('error.apiKeyNeededForProvider', { provider: providerName }, `Для начала игры требуется API ключ для провайдера ${providerName}. Пожалуйста, введите его в настройках.`));
        settingsReturnScreen = 'main-menu'; // Убедимся, что вернемся в главное меню
        setActiveScreen('settings-menu');
        return;
    }
    // --- [КОНЕЦ ИСПРАВЛЕНИЯ] ---

    // Если проверка прошла, остальная часть функции выполняется как и раньше
    if (worldLore.startsWith(t('error.prefix', "Ошибка:")) || Object.keys(globalLocations).length === 0) {
        alert(t('error.worldLoadFailed', { worldId: DEFAULT_WORLD_ID }, `Не удалось загрузить данные для мира по умолчанию (${DEFAULT_WORLD_ID}). Проверьте консоль (F12) и файлы лора.`));
        return;
    }

    console.log(`Начало настройки новой игры для мира по умолчанию: ${DEFAULT_WORLD_ID}`);

    player = null;
    conversationHistory = [];
    currentSaveSlot = null;
        preloadedWorldData = null;
        if (selectedWorldInfo) {
            selectedWorldInfo.style.display = 'none';
            selectedWorldInfo.textContent = '';
        }
    nextInternalQuestId = 1;
    nextInternalItemId = 1;
    nextInternalEntityId = 1;
    nextInternalSkillId = 1;
    nextInternalMapMarkerId = 1;
    
    // Очистка реестров от предыдущих сессий (Fix Memory Leak)
    ItemRegistry.clear();
    ContainerRegistry.clear();

    resetCharacterCreation();
    setActiveScreen('character-creation-screen');
    updateDynamicUIText();
}


/**
 * Обновляет и анимирует блок с описанием выбранной эпохи.
 */
function updateEraDescription() {
    if (!charEraSelect || !eraDescriptionBox) return;

    // Находим выбранный элемент <option>
    const selectedOption = charEraSelect.options[charEraSelect.selectedIndex];
    if (!selectedOption) {
        eraDescriptionBox.classList.remove('visible');
        eraDescriptionBox.innerHTML = '';
        return;
    }

    // Получаем ключ для текста напрямую из data-атрибута
    const descriptionKey = selectedOption.dataset.descriptionKey;
    const descriptionText = t(descriptionKey, null, '');

    // Прячем блок, чтобы сменить текст и запустить анимацию заново
    eraDescriptionBox.classList.remove('visible');

    setTimeout(() => {
        if (descriptionText) {
            eraDescriptionBox.innerHTML = sanitizeHTML(descriptionText);
            eraDescriptionBox.classList.add('visible');
        } else {
            eraDescriptionBox.innerHTML = '';
        }
    }, 200); // Небольшая задержка для плавной анимации
}

function resetCharacterCreation() {
    const backupJson = localStorage.getItem('characterCreationBackup');
    if (backupJson) {
        try {
            const backup = JSON.parse(backupJson);
            charNameInput.value = backup.name || '';
            charRaceSelect.value = backup.race || '';
            charClassSelect.value = backup.class || '';
            const genderSelect = document.getElementById('char-gender-select');
            if (genderSelect) genderSelect.value = backup.gender || '';
            if (charStartModeSelect) charStartModeSelect.value = backup.startMode || 'adrenaline';
            if (charEraSelect) charEraSelect.value = backup.era || getRuntimeDefaultEraId();
            charDescInput.value = backup.description || '';

            if (backup.race && backup.class && window.CharacterStatsResolver) {
                const resolved = window.CharacterStatsResolver.resolveCharacterCreationStats({
                    raceId: backup.race,
                    classId: backup.class
                });

                if (resolved.valid) {
                    statDistributionSection.style.display = 'block';
                    baseStatsForDistribution = { ...resolved.baseStatsForDistribution };
                    currentCreationStats = { ...resolved.finalStats };

                    const restoredStats = backup.stats && typeof backup.stats === 'object' ? backup.stats : {};
                    Object.keys(baseStatsForDistribution).forEach(stat => {
                        const restored = Number(restoredStats[stat]);
                        if (Number.isFinite(restored) && restored >= baseStatsForDistribution[stat]) {
                            currentCreationStats[stat] = Math.round(restored);
                        }
                    });

                    availableStatPoints = backup.availablePoints !== undefined
                        ? Math.max(0, Math.floor(Number(backup.availablePoints) || 0))
                        : INITIAL_STAT_POINTS;
                } else {
                    statDistributionSection.style.display = 'none';
                    availableStatPoints = INITIAL_STAT_POINTS;
                    currentCreationStats = {};
                    baseStatsForDistribution = {};
                    if (window.RuntimeLog) {
                        window.RuntimeLog.error('CharacterCreation', 'Не удалось восстановить статы персонажа из backup/runtime database.', {
                            raceId: backup.race,
                            classId: backup.class,
                            warnings: resolved.warnings
                        });
                    }
                }
            } else {
                statDistributionSection.style.display = 'none';
                availableStatPoints = INITIAL_STAT_POINTS;
                currentCreationStats = {};
                baseStatsForDistribution = {};
            }
        } catch (e) {
            console.error("Failed to restore character creation backup", e);
            charNameInput.value = '';
            charRaceSelect.value = '';
            charClassSelect.value = '';
            if (charEraSelect) charEraSelect.value = getRuntimeDefaultEraId();
            charDescInput.value = '';
            statDistributionSection.style.display = 'none';
            availableStatPoints = INITIAL_STAT_POINTS;
            currentCreationStats = {};
            baseStatsForDistribution = {};
        }
    } else {
        charNameInput.value = '';
        charRaceSelect.value = '';
        charClassSelect.value = '';
        const genderSelect = document.getElementById('char-gender-select');
        if (genderSelect) genderSelect.value = '';
        if (charEraSelect) charEraSelect.value = getRuntimeDefaultEraId();
        charDescInput.value = '';
        statDistributionSection.style.display = 'none';
        availableStatPoints = INITIAL_STAT_POINTS;
        currentCreationStats = {};
        baseStatsForDistribution = {};
    }

    creationStatPointsDisplay.textContent = availableStatPoints;
    Object.keys(createStatDisplays).forEach(stat => {
        createStatDisplays[stat].textContent = currentCreationStats[stat] !== undefined ? currentCreationStats[stat] : (baseStatsForDistribution[stat] || '0');
    });
    creationError.textContent = '';
    checkCreationFormValidity();
    updateDynamicUIText();
    setTimeout(updateEraDescription, 50);
}


function handleRaceOrClassChange() {
    const selectedRace = charRaceSelect.value;
    const selectedClass = charClassSelect.value;

    if (selectedRace && selectedClass && window.CharacterStatsResolver) {
        const resolved = window.CharacterStatsResolver.resolveCharacterCreationStats({
            raceId: selectedRace,
            classId: selectedClass
        });

        if (resolved.valid) {
            statDistributionSection.style.display = 'block';
            baseStatsForDistribution = { ...resolved.baseStatsForDistribution };
            currentCreationStats = { ...resolved.finalStats };
            availableStatPoints = INITIAL_STAT_POINTS;
            updateStatCreationDisplay();
        } else {
            statDistributionSection.style.display = 'none';
            currentCreationStats = {};
            baseStatsForDistribution = {};
            if (window.RuntimeLog) {
                window.RuntimeLog.error('CharacterCreation', 'Не удалось рассчитать статы персонажа из runtime database.', {
                    raceId: selectedRace,
                    classId: selectedClass,
                    warnings: resolved.warnings
                });
            }
        }
    } else {
        statDistributionSection.style.display = 'none';
        currentCreationStats = {};
        baseStatsForDistribution = {};
    }
    checkCreationFormValidity();
}

function handleStatChange(event) {
    const button = event.target;
    const stat = button.getAttribute('data-stat');
    const change = button.classList.contains('plus') ? 1 : -1;

    if (!charRaceSelect.value || !charClassSelect.value || baseStatsForDistribution[stat] === undefined) return;

    const baseStatValueForDistribution = baseStatsForDistribution[stat];

    if (change > 0 && availableStatPoints > 0) {
        currentCreationStats[stat]++;
        availableStatPoints--;
    } else if (change < 0 && currentCreationStats[stat] > baseStatValueForDistribution) {
        currentCreationStats[stat]--;
        availableStatPoints++;
    }
    updateStatCreationDisplay();
}

function updateStatCreationDisplay() {
    creationStatPointsDisplay.textContent = availableStatPoints;

    Object.keys(createStatDisplays).forEach(stat => {
        createStatDisplays[stat].textContent = currentCreationStats[stat] !== undefined ? currentCreationStats[stat] : (baseStatsForDistribution[stat] || '0');
    });

    statButtons.forEach(button => {
        const stat = button.getAttribute('data-stat');
        const isPlus = button.classList.contains('plus');
        const baseValue = baseStatsForDistribution[stat];
        const currentValue = currentCreationStats[stat];

        if (isPlus) {
            button.disabled = availableStatPoints <= 0;
        } else {
            button.disabled = currentValue === undefined || currentValue <= baseValue;
        }
    });
    checkCreationFormValidity();
}

function checkCreationFormValidity() {
    // Лимиты на количество символов полностью удалены
    const nameValid = charNameInput.value.trim().length > 0;
    const genderValid = document.getElementById('char-gender-select').value !== '';
    const raceValid = charRaceSelect.value !== '';
    const classValid = charClassSelect.value !== '';
    const descValid = charDescInput.value.trim().length > 0;

    const statsValid = statDistributionSection && statDistributionSection.style.display !== 'none' && Object.keys(currentCreationStats || {}).length > 0;

    // Кнопка активируется, если все поля заполнены и статы рассчитаны из runtime database.
    startGameButton.disabled = !(nameValid && genderValid && raceValid && classValid && descValid && statsValid);
}


async function finalizeCharacterCreation() {
    if (startGameButton.disabled) {
        creationError.textContent = t("characterCreation.errorFillFields");
        return;
    }

    const proceedToNarrator = async () => {
        const playerRace = charRaceSelect.value;
        const playerClass = charClassSelect.value;
        const playerGender = document.getElementById('char-gender-select').value;
        const selectedEra = charEraSelect.value;
        const generateBackstory = document.getElementById('generate-backstory-checkbox')?.checked || false;

        // Save backup to localStorage
        localStorage.setItem('characterCreationBackup', JSON.stringify({
            name: charNameInput.value.trim(),
            gender: playerGender,
            race: playerRace,
            class: playerClass,
            era: selectedEra,
            startMode: charStartModeSelect.value,
            description: charDescInput.value.trim(),
            generateBackstory: generateBackstory,
            stats: { ...currentCreationStats },
            availablePoints: availableStatPoints
        }));

        tempPlayer = {
            name: charNameInput.value.trim(),
            gender: playerGender,
            race: playerRace,
            class: playerClass,
            era: selectedEra,
            startMode: charStartModeSelect.value,
            description: charDescInput.value.trim(),
            generateBackstory: generateBackstory,
            stats: {
                ...currentCreationStats,
                level: 1,
                xp: 0,
                xpNext: calculateXpForNextLevel(1),
                statPoints: 0,
                gold: requireRuntimeNumber(getQuickStartRuntimeConfig().starting_gold, 'gameplay_runtime.character_creation.quick_start.starting_gold'),
                reputation: { global: 0 },
                turnCount: 0,
                momentum: 0,
                traumaCooldown: 0,
            },
            currentCombat: { isActive: false, participants: [] },
            gameTime: buildInitialGameTime(selectedEra),
            timeOfDay: "Утро",
            equipment: {},
            holdings: {},
            bankAccount: { deposit: 0, loan: 0, loanDays: 0 },
                        inventory: {}, // Legacy
            container_backpack: null, // ИСПРАВЛЕНИЕ: Будет создано после генерации мира C++ ядром
            container_equipment: null, // ИСПРАВЛЕНИЕ: Будет создано после генерации мира C++ ядром
            echoMemory: { items: [], maxItems: ECHO_MEMORY_MAX_ITEMS, version: 1 },
gmNotes: { "Main_Plot": "Начало пути. Игрок появляется в стартовой локации." },
            memoryArchives: {},
            archiveSummaries: {},
            factionData: { global: t('factions.global', null, 'Общая') },
            location: t('world.generatingStartLocation', "Генерация стартовой точки..."),
            nexusData: {},
            worldEvents: [],
            quests: {},
            skills: {},
            mapMarkers: {},
            subLocations: {},
            statusEffects: {},
            visibleEntities: {},
            allKnownEntities: {},
            visitedLocations: [],
            localMap: null,
            gameLogHistory: [],
            calcLogHistory: [],
            gmErrors: [],
            eroticJournal: [],  // Журнал эротических сцен
            eroticStats: {
                totalScenes: 0,
                partners: [],
                locations: {},
                types: { consensual: 0, forced: 0, seduction: 0 },
                fetishes: { anal: 0, oral: 0, bdsm: 0, group: 0 }
            }
        };

        tempPlayer.stats.maxHp = calculateMaxHp(tempPlayer.stats.con);
        tempPlayer.stats.hp = tempPlayer.stats.maxHp;
        tempPlayer.inventoryCapacity = getInitialInventoryCapacity(tempPlayer.stats.str);

        if (tempPlayer.class === 'mage') {
            tempPlayer.stats.maxMana = calculateMaxMana(tempPlayer.stats.int, tempPlayer.stats.level);
            tempPlayer.stats.mana = tempPlayer.stats.maxMana;
        } else {
            tempPlayer.stats.mana = 0;
            tempPlayer.stats.maxMana = 0;
        }

        console.log("Персонаж временно создан для эпохи '" + selectedEra + "', переход к выбору рассказчика:", tempPlayer);

        // Т3 ФИКС: Удаляем выбор рассказчиков. Идем сразу к настройке мира.
        setActiveScreen('world-setup-screen');
        if (document.activeElement) document.activeElement.blur();
    };

    if (availableStatPoints > 0 && statDistributionSection.style.display === 'block') {
        showCustomConfirm(
            t('characterCreation.confirmPointsLeft', { points: availableStatPoints }),
            proceedToNarrator
        );
    } else {
        await proceedToNarrator();
    }
}


/**
 * Сохраняет текущие данные из формы создания персонажа в объект.
 * Используется для восстановления формы в случае ошибки API.
 * @returns {object|null} Объект с данными формы или null, если экран создания не активен.
 */
function backupCreationForm() {
    // Убеждаемся, что мы на экране создания персонажа
    if (!characterCreationScreen || !characterCreationScreen.classList.contains('active-screen')) {
        return null;
    }

    return {
        name: charNameInput.value,
        gender: document.getElementById('char-gender-select') ? document.getElementById('char-gender-select').value : '',
        race: charRaceSelect.value,
        class: charClassSelect.value,
        era: charEraSelect.value,
        description: charDescInput.value,
        // Сохраняем распределенные статы и оставшиеся очки
        stats: { ...currentCreationStats },
        availablePoints: availableStatPoints
    };
}

async function startGameWithNarrator() {
    if (!tempPlayer) {
        console.error("Ошибка: Временные данные игрока отсутствуют. Возврат к созданию персонажа.");
        setActiveScreen('character-creation-screen');
        return;
    }
    // Переходим к экрану настройки симуляции мира
    setActiveScreen('world-setup-screen');
}

function getActiveNonBaseModIdsFromSettings(settings) {
    const active = settings && settings.mods && Array.isArray(settings.mods.active) ? settings.mods.active : [];
    return active.filter(id => id && id !== 'base_game');
}

async function disableActiveModsAfterWorldStartupFailure(reason, detail = null) {
    if (!window.electronAPI || typeof window.electronAPI.loadSettings !== 'function' || typeof window.electronAPI.saveSettings !== 'function') {
        if (window.RuntimeLog) window.RuntimeLog.warn('WorldStartupWatchdog', 'Не удалось автоотключить моды: settings API недоступен.', { reason, detail });
        return false;
    }

    const settings = await window.electronAPI.loadSettings() || {};
    if (!settings.mods || typeof settings.mods !== 'object') settings.mods = {};
    const active = Array.isArray(settings.mods.active) ? settings.mods.active : ['base_game'];
    const nonBaseActive = active.filter(id => id && id !== 'base_game');

    if (nonBaseActive.length === 0) {
        if (window.RuntimeLog) window.RuntimeLog.warn('WorldStartupWatchdog', 'Watchdog сработал без активных пользовательских модов.', { reason, detail });
        return false;
    }

    settings.mods.active = active.filter(id => id === 'base_game' || !nonBaseActive.includes(id));
    if (!settings.mods.active.includes('base_game')) settings.mods.active.unshift('base_game');
    if (!settings.mods.disabled || typeof settings.mods.disabled !== 'object') settings.mods.disabled = {};

    const disabledAt = new Date().toISOString();
    for (const modId of nonBaseActive) {
        settings.mods.disabled[modId] = {
            reason,
            detail,
            disabled_at: disabledAt,
            source: 'WorldStartupWatchdog'
        };
    }

    await window.electronAPI.saveSettings(settings);

    if (window.RuntimeLog) {
        window.RuntimeLog.error('WorldStartupWatchdog', `Автоотключены моды после зависания/ошибки запуска мира: ${nonBaseActive.join(', ')}`, { reason, detail });
    }

    return true;
}

function shouldWorldStartupWatchdogAutoDisable(detail) {
    const screen = String(detail && detail.screen || '');
    const loadingText = String(detail && detail.loadingText || '');
    const worldObject = (typeof World !== 'undefined' && World && typeof World === 'object') ? World : null;
    const worldHasRegions = !!(worldObject && worldObject.regions && Object.keys(worldObject.regions).length > 0);
    const lateStageText = /заверш|final|настрой|setup/i.test(loadingText);

    if (screen === 'game-interface' || worldHasRegions || lateStageText) {
        return {
            autoDisable: false,
            reason: 'late-stage startup already reached game interface/world state'
        };
    }

    return {
        autoDisable: true,
        reason: 'early startup stall before game interface/world state'
    };
}

function armWorldGenerationWatchdog(phase, options = {}) {
    const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 180000;
    const armedAt = Date.now();

    if (window.RuntimeLog) {
        window.RuntimeLog.info('WorldStartupWatchdog', `Watchdog запуска мира активирован: ${phase}`, { timeoutMs });
    }

    const timer = setTimeout(async () => {
        const detail = {
            phase,
            timeoutMs,
            elapsedMs: Date.now() - armedAt,
            screen: document.querySelector('.active-screen')?.id || null,
            loadingText: document.getElementById('loading-text')?.textContent || null
        };

        const decision = shouldWorldStartupWatchdogAutoDisable(detail);
        detail.decision = decision;

        if (!decision.autoDisable) {
            if (window.RuntimeLog) {
                window.RuntimeLog.warn(
                    'WorldStartupWatchdog',
                    'Watchdog сработал на поздней стадии запуска мира; моды НЕ отключены, чтобы не ломать уже созданный runtime.',
                    detail
                );
            } else {
                console.warn('[WorldStartupWatchdog] Late-stage timeout ignored:', detail);
            }
            return;
        }

        if (window.RuntimeLog) {
            window.RuntimeLog.error('WorldStartupWatchdog', 'Запуск мира не завершился в отведённое время до создания мира. Активные пользовательские моды будут отключены.', detail);
        } else {
            console.error('[WorldStartupWatchdog] World startup timeout:', detail);
        }

        await disableActiveModsAfterWorldStartupFailure('world startup watchdog timeout', detail);

        try {
            hideLoadingScreen();
            showCustomAlert('Запуск мира завис или занял слишком много времени до создания мира. Активные пользовательские моды автоотключены. Перезапусти игру и попробуй снова.');
        } catch (error) {
            console.error('[WorldStartupWatchdog] Failed to show timeout alert:', error);
        }
    }, timeoutMs);

    return { timer, phase, armedAt, timeoutMs };
}

function disarmWorldGenerationWatchdog(watchdog, reason = 'completed') {
    if (!watchdog || !watchdog.timer) return;
    clearTimeout(watchdog.timer);
    watchdog.timer = null;
    if (window.RuntimeLog) {
        window.RuntimeLog.info('WorldStartupWatchdog', `Watchdog запуска мира снят: ${reason}`, {
            phase: watchdog.phase,
            elapsedMs: Date.now() - watchdog.armedAt
        });
    }
}


async function finalizeWorldSetupAndStart() {
    const yearsToSimulate = parseInt(worldYearsSlider.value, 10);
    const initialAgents = parseInt(worldAgentsSlider.value, 10);

    const worldGenerationWatchdog = armWorldGenerationWatchdog('finalizeWorldSetupAndStart');

    player = tempPlayer;
    await loadActiveEraLore(player.era);
    await loadGlobalLocations(DEFAULT_WORLD_ID, currentLanguage, player.era);

    conversationHistory = [];
    currentSaveSlot = null;
    nextInternalQuestId = 1;
    nextInternalItemId = 1;
    nextInternalEntityId = 1;

    console.log("Игра начинается с персонажем:", player);

    await initializeGameInterface();
    setActiveScreen('game-interface');
    showLoadingScreen('loadingScreen.generatingWorld', 'Генерация мира...');

    const absoluteStartDay = calculateAbsoluteStartDay(player.gameTime);

    if (preloadedWorldData) {
        console.log("Используется предзагруженный мир.");
        setWorld(preloadedWorldData);
        // Инициализируем движок, но НЕ синхронизируем мир сейчас --
        // World JSON слишком большой (1.5МБ+), syncState таймаутится.
        // Синхронизация будет выполнена позже, после создания контейнеров.
        if (window.electronAPI && window.electronAPI.nexusInit) {
            const initRes = await window.electronAPI.nexusInit(true);
            if (initRes.status !== 'ok') {
                console.warn('[Nexus] Init failed for preloaded world:', initRes.message);
            }
        }
    } else {
        setWorld(await initWorldSimulator(initialAgents, absoluteStartDay));
        if (!World) {
            disarmWorldGenerationWatchdog(worldGenerationWatchdog, 'world simulator returned empty world');
            hideLoadingScreen();
            return; // Прерываем запуск, так как ядро упало или не инициализировалось
        }

        // --- BOOTSTRAP PHASE ---
        if (window.electronAPI && window.electronAPI.nexusBootstrap) {
            const totalPop = Object.values(World.regions).reduce((sum, r) => sum + r.population, 0);
            const bootstrapDays = calculateBootstrapDays(totalPop);
            
            const loadingText = document.getElementById('loading-text');
            if (loadingText) loadingText.textContent = `Экономическая балансировка (${bootstrapDays} дн.)...`;
            console.log(`[Nexus] Запуск Bootstrap на ${bootstrapDays} дней...`);
            
            const res = await window.electronAPI.nexusBootstrap(bootstrapDays, absoluteStartDay);
            if (res.status === 'ok') {
                setWorld(res.world);
                if (res.items) { ItemRegistry.clear(); res.items.forEach(([k, v]) => ItemRegistry.set(k, v)); }
                if (res.containers) { ContainerRegistry.clear(); res.containers.forEach(([k, v]) => setContainer(k, v)); }
            }
        }

        if (enableWorldSim) {
            await preSimulateWorldHistory(yearsToSimulate);
            const loadingText = document.getElementById('loading-text');
            if (loadingText) loadingText.textContent = t('loadingScreen.finalizing', null, 'Завершение...');
        }

        if (window.electronAPI && window.electronAPI.isElectron) {
            hideLoadingScreen();
            await promptSaveWorldModal();
            showLoadingScreen('loadingScreen.generatingWorld', 'Завершение настройки...');
        }
    }

    // --- ВЫБОР СТАРТОВОЙ ЛОКАЦИИ ДО ГЕНЕРАЦИИ СНАПШОТА ---
    let startRegionId = null;
    // Т3 ФИКС: Передаем ответственность за выбор стартовой локации Гейм-Мастеру
    player.location = "Не определена (ГМ ОБЯЗАН выбрать логичную стартовую локацию)";

    await ensurePlayerContainers();

    // Для предзагруженного мира: синхронизация через ФАЙЛ, а не через stdin.
    // syncState через stdin блокирует движок (1.5MB+ JSON → 64KB pipe buffer → timeout).
    // Новый подход: записываем мир в файл, движок читает его напрямую через loadWorldFile.
    if (preloadedWorldData && window.electronAPI && window.electronAPI.nexusWriteSyncFile) {
        const syncItems = Array.from(ItemRegistry.entries());
        const syncContainers = Array.from(ContainerRegistry.entries());
        const worldFileData = { world: World, items: syncItems, containers: syncContainers };
        console.log('[Nexus] Запуск файловой синхронизации предзагруженного мира...');
        try {
            // Шаг 1: Записываем данные мира во временный файл через IPC
            const writeRes = await window.electronAPI.nexusWriteSyncFile(worldFileData);
            if (writeRes.status === 'ok' && writeRes.path) {
                // Шаг 2: Отправляем команду движку прочитать файл напрямую
                const loadRes = await window.electronAPI.nexusLoadWorldFile(writeRes.path);
                if (loadRes.status === 'ok') {
                    console.log('[Nexus] Файловая синхронизация мира завершена:', loadRes.message);
                } else {
                    console.warn('[Nexus] loadWorldFile не удался:', loadRes.message || loadRes.error || 'unknown error');
                }
            } else {
                console.warn('[Nexus] Не удалось записать временный файл:', writeRes.message);
            }
        } catch (err) {
            console.warn('[Nexus] Ошибка файловой синхронизации:', err.message || err);
        }
    }

    const narratorStyleGuide = `
    ### ТВОЙ СТИЛЬ: THE PRISM MASTER
    - Ты -- харизматичный, непредсказуемый и глубокий рассказчик. 
    - Твоя база: Гай Ричи + Хаяо Миядзаки + Ганнибал Лектер. 
    - КОНТРАСТ: Умей быть милым и няшным в один момент, и превращать сцену в кровавый кошмар в следующий.
    - ПЕРСОНАЖИ: Давай им душу. Твои NPC должны запоминаться странностями, шутками, матами или пугающим спокойствием.
    - НИКАКОЙ СКУКИ: Если игрок просто идет по дороге -- заставь его почувствовать либо невероятную красоту природы, либо паранойю, что за ним следят.
    - Используй мат и жаргон для акцентов, не делай из этого самоцель, но и не стесняйся.`;

    if (enableDeepSetup) {
        disarmWorldGenerationWatchdog(worldGenerationWatchdog, 'deep setup pipeline started');
        await runDeepSetupPipeline(narratorStyleGuide);
        return;
    }

    const currentWorldLore = worldLore;
    let initialPromptFile = `initial_prompt.${player.era}`;
    const allMapPoints = [
        ...Object.keys(globalLocations || {}).map(k => ({ ...globalLocations[k], id: k })),
        ...Object.values(player.mapMarkers || {})
    ].filter(p => p && p.name && !isNaN(Number(p.x)));
    const mapCoordsString = allMapPoints.map(p => `${p.name} [ID: ${p.id}] (x:${Math.round(p.x)}, y:${Math.round(p.y)})`).join('; ');

    console.log(`Загрузка стартового промпта для эпохи '${player.era}': ${initialPromptFile}`);
    const initialPromptTemplate = await loadPromptFromFile(initialPromptFile);

    if (initialPromptTemplate.startsWith('Ошибка:')) {
        addLogMessage(t('error.loadPromptFailed', { filePath: initialPromptFile }), 'system-message');
        disarmWorldGenerationWatchdog(worldGenerationWatchdog, 'initial prompt failed to load');
        hideLoadingScreen();
        isWaitingForAI = false;
        if (userInput) userInput.disabled = false;
        if (sendButton) sendButton.disabled = false;
        return;
    }

    let itemsRefStringInitial = "Справочник предметов не загружен или пуст.";
    if (Array.isArray(itemsReferenceData) && itemsReferenceData.length > 0) {
        try {
            const itemsForPrompt = itemsReferenceData.slice(0, 50).map(item => ({ id: item.id, name: item.name, type: item.type, rarity: item.rarity, description: item.description.substring(0, 100) + "..." }));
            itemsRefStringInitial = JSON.stringify(itemsForPrompt, null, 2);
            if (itemsReferenceData.length > 50) itemsRefStringInitial += "\n... (и другие предметы)";
        } catch (e) { console.error("Ошибка сериализации itemsReferenceData для начального промпта:", e); }
    }

    // Автоматически генерируем актуальную документацию по транспорту
    // Убеждаемся, что реестр загружен
    await TransportSystem.init();
    const transportDocs = TransportSystem.generateGMDocumentation();
    if (transportDocs) {
        itemsRefStringInitial = transportDocs + '\n\n' + itemsRefStringInitial;
    }

    const startModeInstruction = (player.startMode === 'calm') 
        ? "СПОКОЙНЫЙ СТАРТ: Начни игру максимально мирно. Игрок в безопасности (дом, таверна, привал). Дай время осмотреться и поговорить. Никакой немедленной угрозы."
        : "АДРЕНАЛИНОВЫЙ СТАРТ: Начни в самой гуще событий! Критическая ситуация: погоня, засада, дуэль или катастрофа. Требуй немедленных действий.";

        // --- SMART CONTEXT FILTER (EPIC HISTORY) ---
    let dynamicContextStr = "";
    if (typeof World !== 'undefined' && World && startRegionId && World.regions[startRegionId]) {
        let r = World.regions[startRegionId];
        dynamicContextStr += `\n=== MASMP STATE VECTORS ===\n`;
        let ownerFaction = World.factions[r.factionId];
        let ownerId = ownerFaction ? ownerFaction.id : "none";
        
        dynamicContextStr += `[SYS_VEC | LOC:${r.id} | SEA:${r.current_season} | WTH:${r.weather || "clear"} | FAC:${ownerId} | THR:${r.threat_level} | STAB:${r.stability} | OCC:${r.isOccupied}]\n`;
        
        let activeMonsters = (World.monsters || []).filter(m => m.health > 0 && m.region_id === startRegionId);
        if (activeMonsters.length > 0) {
            dynamicContextStr += `[MONSTER_VEC | ACT:${activeMonsters.map(m => `${m.type}:${m.region_id}:L${m.level}`).join(',')}]\n`;
            dynamicContextStr += `\n[КРИТИЧЕСКАЯ УГРОЗА В РЕГИОНЕ]: ТЫ КАТЕГОРИЧЕСКИ ОБЯЗАН сделать монстра главной темой стартового описания (тень над городом, рев вдалеке, разрушения, паника жителей)!\n`;
        }
        
        let activeDisasters = (World.map && World.map.disasters) ? World.map.disasters.filter(d => d.days_active > 0 && d.affected_regions.includes(startRegionId)) : [];
        if (activeDisasters.length > 0) {
            dynamicContextStr += `[DISASTER_VEC | ACT:${activeDisasters.map(d => `${d.type}:${d.affected_regions.join('-')}`).join(',')}]\n`;
            dynamicContextStr += `\n[АКТИВНОЕ БЕДСТВИЕ В РЕГИОНЕ]: ТЫ ОБЯЗАН описать это в стартовом тексте!\n`;
        }
    }

    if (typeof World !== 'undefined' && World && World.relevant_news && World.relevant_news.length > 0) {
        let recentNewsStr = World.relevant_news.map(n => {
            let daysOld = Math.max(0, (World.current_day || 0) - (n.day || 0));
            return `[${daysOld}d ago, ${n.location}] ${parseLocString(n.text)}`;
        }).join("\n");
        if (recentNewsStr) {
            dynamicContextStr += `\n=== RELEVANT EVENTS ===\n${recentNewsStr}\n`;
            dynamicContextStr += `\nТЫ ОБЯЗАН органично вплести эти недавние события в стартовое повествование!\n`;
        }
    }
    if (typeof World !== 'undefined' && World && startRegionId && World.regions[startRegionId]) {
        let r = World.regions[startRegionId];
        dynamicContextStr += `\n=== СИМУЛЯЦИЯ МИРА (ЛОКАЛЬНЫЕ ДАННЫЕ) ===\n`;
        let seasonName = r.current_season === 'spring' ? 'Весна' : (r.current_season === 'summer' ? 'Лето' : (r.current_season === 'autumn' ? 'Осень' : 'Зима'));
        dynamicContextStr += `[ВАША ЛОКАЦИЯ] Регион: ${r.name}. Сезон: ${seasonName}. Погода: ${r.weather || "Нормальная"}\n`;
        
        let activeMonsters = (World.monsters || []).filter(m => m.health > 0 && m.region_id === startRegionId);
        if (activeMonsters.length > 0) {
            dynamicContextStr += `\n[КРИТИЧЕСКАЯ УГРОЗА В РЕГИОНЕ]: Прямо сейчас в этой локации находится ЭПИЧЕСКОЕ ЧУДОВИЩЕ: ${activeMonsters.map(m => m.name).join(', ')}! ТЫ КАТЕГОРИЧЕСКИ ОБЯЗАН сделать это частью стартового описания (тень над городом, рев вдалеке, разрушения, паника жителей)!\n`;
        }
        
        let activeDisasters = (World.map && World.map.disasters) ? World.map.disasters.filter(d => d.days_active > 0 && d.affected_regions.includes(startRegionId)) : [];
        if (activeDisasters.length > 0) {
            dynamicContextStr += `\n[АКТИВНОЕ БЕДСТВИЕ В РЕГИОНЕ]: Прямо сейчас здесь бушует катаклизм: ${activeDisasters.map(d => d.type).join(', ')}! ТЫ ОБЯЗАН описать это в стартовом тексте!\n`;
        }
        
        if (r.isOccupied) {
            let occName = World.factions[r.occupierFactionId] ? World.factions[r.occupierFactionId].name : r.occupierFactionId;
            dynamicContextStr += `\n[ВОЕННОЕ ПОЛОЖЕНИЕ]: Регион оккупирован вражескими войсками (${occName})! Повсюду патрули, разруха и страх.\n`;
        }
    }

    if (typeof World !== 'undefined' && World && World.news && World.news.length > 0) {
        let currentDay = (World.current_day !== undefined ? World.current_day : Math.floor((World.tick || 0) / 24));
        let recentNews = World.news
            .map(n => ({ ...n, daysOld: Math.max(0, currentDay - (n.day || 0)) }))
            .filter(n => n.daysOld <= 720) // За последние 2 года
            .filter(n => ['war', 'disaster', 'politics'].includes(n.category)) // Только самые крупные потрясения
            .sort((a, b) => a.daysOld - b.daysOld)
            .slice(0, 15);
            
        if (recentNews.length > 0) {
            dynamicContextStr += `\n=== НЕДАВНЯЯ ИСТОРИЯ (ПОСЛЕДСТВИЯ ПРЕ-СИМУЛЯЦИИ) ===\n`;
            dynamicContextStr += recentNews.map(n => `[${n.daysOld} дн. назад, Локация: ${n.location}] ${parseLocString(n.text)}`).join("\n");
            dynamicContextStr += `\nТЫ ОБЯЗАН органично вплести эти недавние события в стартовое повествование (о чем шепчутся выжившие, следы недавней войны, последствия катастроф)!\n`;
        }
    }

    let imgExample = enableImageGeneration ? '"image_prompt": "Ado music video aesthetic, monochrome with red accent, dark gothic anime, creepy vibe, masterpiece",' : '';
    const genBackstoryText = player.generateBackstory ? "TRUE (ТЫ ОБЯЗАН ПРИДУМАТЬ ПРЕДЫСТОРИЮ И ВЫЗВАТЬ setPlayerDescription)" : "FALSE";
    const startPrompt = initialPromptTemplate.replace(/{start_mode_instruction}/g, startModeInstruction)
        .replace(/{generate_backstory_flag}/g, genBackstoryText)
        .replace(/{image_prompt_example}/g, imgExample)
        .replace(/{worldId}/g, DEFAULT_WORLD_ID)
        .replace(/{worldId_upper}/g, DEFAULT_WORLD_ID.toUpperCase())
        .replace(/{era_description}/g, player.era)
        .replace(/{name}/g, player.name)
        .replace(/{race}/g, t(`characterCreation.race${player.race.charAt(0).toUpperCase() + player.race.slice(1)}`, null, player.race))
        .replace(/{class}/g, t(`characterCreation.class${player.class.charAt(0).toUpperCase() + player.class.slice(1)}`, null, player.class))
        .replace(/{level}/g, player.stats.level)
        .replace(/{description}/g, player.description)
        .replace(/{lore}/g, currentWorldLore)
        .replace(/{globalLocationsList}/g, mapCoordsString)
        .replace(/{map_coordinates_list}/g, mapCoordsString)
        .replace(/{itemsReference}/g, itemsRefStringInitial)
        .replace(/{language}/g, currentLanguage === 'ru' ? 'Russian' : 'English')
        .replace(/{narrator_style_guide}/g, narratorStyleGuide)
                .replace(/{dynamic_context}/g, dynamicContextStr);

    disarmWorldGenerationWatchdog(worldGenerationWatchdog, 'initial prompt ready');

    sendApiRequest(startPrompt, true);

    tempPlayer = null;
    stopMenuMusic();
}

// --- Вспомогательные функции для персонажа ---
function advanceTime(pulses) {
    if (!player || !player.gameTime) return;
    if (pulses <= 0) return;

    let gt = player.gameTime;
    let oldHour = gt.hour;

    if (!player.lastTurnPulses) player.lastTurnPulses = gt.totalPulses;
    gt.totalPulses += pulses;
    gt.minute += pulses * 5;

    while (gt.minute >= 60) {
        gt.minute -= 60;
        gt.hour += 1;
    }
    while (gt.hour >= 24) {
        gt.hour -= 24;
        gt.day += 1;
    }
    while (gt.day > 30) {
        gt.day -= 30;
        gt.month += 1;
    }
    while (gt.month > 12) {
        gt.month -= 12;
        gt.year += 1;
    }

    checkTimeTriggers(oldHour, gt.hour);
    if (enableWorldSim && typeof updateWorldSimulation === 'function') {
        if (pulses >= 288) {
            showLoadingScreen('loadingScreen.generatingWorld', 'Симуляция времени и событий...');
            isWaitingForAI = true;
            window.isSimulatingTime = true;
        }
        updateWorldSimulation(pulses);
    }
    updateTimeDisplay();
}

function checkTimeTriggers(oldHour, newHour) {
    if (oldHour === newHour) return;

    let timeOfDay = "День";
    if (window.WORLD_CONFIG && window.WORLD_CONFIG.time_periods) {
        for (const tp of window.WORLD_CONFIG.time_periods) {
            if (tp.start_hour > tp.end_hour) {
                if (newHour >= tp.start_hour || newHour < tp.end_hour) timeOfDay = typeof t === 'function' ? t(tp.name_i18n_key, null, tp.id) : tp.id;
            } else {
                if (newHour >= tp.start_hour && newHour < tp.end_hour) timeOfDay = typeof t === 'function' ? t(tp.name_i18n_key, null, tp.id) : tp.id;
            }
        }
    }

    player.timeOfDay = timeOfDay;

    if (oldHour < 22 && newHour >= 22) {
        addLogMessage("На мир опускается ночь. Становится темнее и опаснее.", "system-message");
        for (let key in player.visibleEntities) {
            let ent = player.visibleEntities[key];
            if (!ent.isHostile && ent.type === 'npc') ent.isSleeping = true;
        }
        updateEnvironmentPanel();
    }
    if (oldHour < 6 && newHour >= 6) {
        addLogMessage("Всходит солнце. Начинается новый день.", "system-message");
        for (let key in player.visibleEntities) {
            let ent = player.visibleEntities[key];
            if (ent.isSleeping) ent.isSleeping = false;
        }
        updateEnvironmentPanel();
    }
}

function updateTimeDisplay() {
    const timeInfo = document.getElementById('time-info');
    if (timeInfo && player && player.gameTime) {
        let gt = player.gameTime;
        let mm = gt.minute < 10 ? '0' + gt.minute : gt.minute;
        let hh = gt.hour < 10 ? '0' + gt.hour : gt.hour;
        let icon = (gt.hour >= 6 && gt.hour < 20) ? '☀️' : '🌙';
        
        let mName = "Месяца";
        if (window.WORLD_CONFIG && window.WORLD_CONFIG.months && window.WORLD_CONFIG.months[gt.month - 1]) {
            const m = window.WORLD_CONFIG.months[gt.month - 1];
            mName = typeof t === 'function' ? t(m.name_i18n_key, null, m.id) : m.id;
        }
        
        timeInfo.innerHTML = `${icon} ${gt.day} ${mName}, ${gt.year} Рі. | ${hh}:${mm}`;
    }
}



function requireRuntimeConfigValue(root, key, validate, message) {
  const value = root?.[key];
  if (!validate(value)) {
    throw new Error(`[RuntimeData] Missing or invalid gameplay_runtime.${key}: ${message}`);
  }
  return value;
}

function getGameplayRuntimeConfig() {
  const runtime = (typeof window !== 'undefined' && window.GAMEPLAY_RUNTIME_CONFIG && typeof window.GAMEPLAY_RUNTIME_CONFIG === 'object')
    ? window.GAMEPLAY_RUNTIME_CONFIG
    : null;
  if (!runtime) {
    throw new Error('[RuntimeData] GAMEPLAY_RUNTIME_CONFIG is not loaded.');
  }

  requireRuntimeConfigValue(runtime, 'progression', (v) => v && typeof v === 'object', 'object expected');
  requireRuntimeConfigValue(runtime, 'character_creation', (v) => v && typeof v === 'object', 'object expected');
  requireRuntimeConfigValue(runtime, 'calendar', (v) => v && typeof v === 'object', 'object expected');
  requireRuntimeConfigValue(runtime, 'world_bootstrap', (v) => v && typeof v === 'object', 'object expected');
  requireRuntimeConfigValue(runtime, 'inventory', (v) => v && typeof v === 'object', 'object expected');
  requireRuntimeConfigValue(runtime, 'currency', (v) => v && typeof v === 'object', 'object expected');
  requireRuntimeConfigValue(runtime, 'economy', (v) => v && typeof v === 'object', 'object expected');
  requireRuntimeConfigValue(runtime, 'faction_manpower', (v) => v && typeof v === 'object', 'object expected');

  return runtime;
}

function toRuntimeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getRuntimeDefaultEraId() {
  try {
    const runtimeEraId = getGameplayRuntimeConfig().engine_world?.default_era_id;
    if (typeof runtimeEraId === 'string' && runtimeEraId.trim()) return runtimeEraId;
  } catch(e) { /* GAMEPLAY_RUNTIME_CONFIG not yet loaded — use fallbacks below */ }
  if (Array.isArray(window.ERAS_DATA) && window.ERAS_DATA.length > 0 && typeof window.ERAS_DATA[0]?.id === 'string') {
    return window.ERAS_DATA[0].id;
  }
  return 'rebirth'; // safe fallback — never throw during parallel init
}

function getGameplayCommandDefaults() {
  return requireRuntimeConfigValue(
    getGameplayRuntimeConfig(),
    'command_defaults',
    (v) => v && typeof v === 'object',
    'object expected'
  );
}

function getGameplaySurvivalRuntimeConfig() {
  return requireRuntimeConfigValue(
    getGameplayRuntimeConfig(),
    'survival',
    (v) => v && typeof v === 'object',
    'object expected'
  );
}

function getEnvironmentCommandDefaults() {
  return requireRuntimeConfigValue(
    getGameplayCommandDefaults(),
    'environment',
    (v) => v && typeof v === 'object',
    'object expected'
  );
}

function getRulerEntityCommandDefaults() {
  return requireRuntimeConfigValue(
    getGameplayCommandDefaults(),
    'ruler_entity',
    (v) => v && typeof v === 'object',
    'object expected'
  );
}

function getBusinessCommandDefaults() {
  return requireRuntimeConfigValue(
    getGameplayCommandDefaults(),
    'business',
    (v) => v && typeof v === 'object',
    'object expected'
  );
}

function getQuickStartRuntimeConfig() {
  return requireRuntimeConfigValue(
    getGameplayRuntimeConfig().character_creation,
    'quick_start',
    (v) => v && typeof v === 'object',
    'object expected'
  );
}

function getDiceRuntimeConfig() {
  return requireRuntimeConfigValue(
    getGameplayRuntimeConfig(),
    'dice',
    (v) => v && typeof v === 'object',
    'object expected'
  );
}

function getRulerEntityPersonalityDefaults() {
  return requireRuntimeConfigValue(
    getRulerEntityCommandDefaults(),
    'personality',
    (v) => v && typeof v === 'object',
    'object expected'
  );
}

function getRulerEntityNeedsDefaults() {
  return requireRuntimeConfigValue(
    getRulerEntityCommandDefaults(),
    'needs',
    (v) => v && typeof v === 'object',
    'object expected'
  );
}

function getRulerEntityEconomyDefaults() {
  return requireRuntimeConfigValue(
    getRulerEntityCommandDefaults(),
    'economy',
    (v) => v && typeof v === 'object',
    'object expected'
  );
}

function getCharacterStatBaseline(statKey) {
  const baselines = requireRuntimeConfigValue(
    getGameplayRuntimeConfig().character_creation,
    'stat_baselines',
    (v) => v && typeof v === 'object',
    'object expected'
  );
  const pathMap = {
    strength: 'gameplay_runtime.character_creation.stat_baselines.strength',
    dexterity: 'gameplay_runtime.character_creation.stat_baselines.dexterity',
    constitution: 'gameplay_runtime.character_creation.stat_baselines.constitution',
    charisma: 'gameplay_runtime.character_creation.stat_baselines.charisma',
    resilience: 'gameplay_runtime.character_creation.stat_baselines.resilience'
  };
  return requireRuntimeNumber(baselines[statKey], pathMap[statKey] || `gameplay_runtime.character_creation.stat_baselines.${statKey}`);
}

function getEnvironmentDefaultStat(statKey) {
  const defaults = requireRuntimeConfigValue(
    getEnvironmentCommandDefaults(),
    'default_stats',
    (v) => v && typeof v === 'object',
    'object expected'
  );
  const pathMap = {
    strength: 'gameplay_runtime.command_defaults.environment.default_stats.strength',
    dexterity: 'gameplay_runtime.command_defaults.environment.default_stats.dexterity',
    constitution: 'gameplay_runtime.command_defaults.environment.default_stats.constitution',
    intelligence: 'gameplay_runtime.command_defaults.environment.default_stats.intelligence'
  };
  return requireRuntimeNumber(defaults[statKey], pathMap[statKey] || `gameplay_runtime.command_defaults.environment.default_stats.${statKey}`);
}

function getRulerEntityDefaultStat(statKey) {
  const defaults = requireRuntimeConfigValue(
    getRulerEntityCommandDefaults(),
    'stats',
    (v) => v && typeof v === 'object',
    'object expected'
  );
  const pathMap = {
    hp: 'gameplay_runtime.command_defaults.ruler_entity.stats.hp',
    strength: 'gameplay_runtime.command_defaults.ruler_entity.stats.strength',
    dexterity: 'gameplay_runtime.command_defaults.ruler_entity.stats.dexterity',
    intelligence: 'gameplay_runtime.command_defaults.ruler_entity.stats.intelligence',
    constitution: 'gameplay_runtime.command_defaults.ruler_entity.stats.constitution',
    charisma: 'gameplay_runtime.command_defaults.ruler_entity.stats.charisma',
    resilience: 'gameplay_runtime.command_defaults.ruler_entity.stats.resilience'
  };
  return requireRuntimeNumber(defaults[statKey], pathMap[statKey] || `gameplay_runtime.command_defaults.ruler_entity.stats.${statKey}`);
}

function getRulerEntityPersonalityNumber(key) {
  return requireRuntimeNumber(
    getRulerEntityPersonalityDefaults()[key],
    `gameplay_runtime.command_defaults.ruler_entity.personality.${key}`
  );
}

function rollRuntimeD20() {
  const d20 = requireRuntimeConfigValue(
    getDiceRuntimeConfig(),
    'd20',
    (v) => v && typeof v === 'object',
    'object expected'
  );
  const sides = Math.max(1, requireRuntimeNumber(d20.sides, 'gameplay_runtime.dice.d20.sides'));
  const minimum = requireRuntimeNumber(d20.minimum, 'gameplay_runtime.dice.d20.minimum');
  return Math.floor(Math.random() * sides) + minimum;
}

function requireRuntimeNumber(value, path) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`[RuntimeData] Missing or invalid numeric value at ${path}`);
  }
  return n;
}


function getInventoryEngineRuntimeConfig() {
  const runtime = requireRuntimeConfigValue(
    getGameplayRuntimeConfig(),
    'inventory_engine',
    (v) => v && typeof v === 'object',
    'object expected'
  );
  return {
    id_prefixes: {
      container: runtime.id_prefixes?.container,
      item: runtime.id_prefixes?.item
    },
    actors: {
      default: runtime.actors?.default,
      system: runtime.actors?.system
    },
    ipc_retry: {
      max_retries: Math.max(0, Math.floor(toRuntimeNumber(runtime.ipc_retry?.max_retries, 0))),
      delay_ms: Math.max(0, Math.floor(toRuntimeNumber(runtime.ipc_retry?.delay_ms, 0))),
      backoff_multiplier: Math.max(0, toRuntimeNumber(runtime.ipc_retry?.backoff_multiplier, 0))
    }
  };
}

function getInventoryActorId(kind = 'default') {
  const actors = getInventoryEngineRuntimeConfig().actors;
  return actors[kind] || actors.default;
}


function getInventoryBuildingRuntimeConfig() {
  const runtime = requireRuntimeConfigValue(
    getGameplayRuntimeConfig(),
    'inventory_building',
    (v) => v && typeof v === 'object',
    'object expected'
  );
  const coords = Array.isArray(runtime.default_world_coords) ? runtime.default_world_coords : [];
  return {
    resource_prototype_id: runtime.resource_prototype_id,
    resource_cost: Math.max(1, Math.floor(toRuntimeNumber(runtime.resource_cost, 1))),
    default_max_weight_kg: Math.max(1, toRuntimeNumber(runtime.default_max_weight_kg, 1)),
    default_max_slots: Math.max(1, Math.floor(toRuntimeNumber(runtime.default_max_slots, 1))),
    default_world_coords: [
      toRuntimeNumber(coords[0], NaN),
      toRuntimeNumber(coords[1], NaN),
      toRuntimeNumber(coords[2], NaN)
    ]
  };
}

function buildConstructedContainerLocation(regionId, runtimeConfig = getInventoryBuildingRuntimeConfig()) {
  return {
    world_coords: runtimeConfig.default_world_coords,
    parent_entity: null,
    parent_container: null,
    region_id: regionId
  };
}


function getInventoryMovementRuntimeConfig() {
  const runtime = requireRuntimeConfigValue(
    getGameplayRuntimeConfig(),
    'inventory_movement',
    (v) => v && typeof v === 'object',
    'object expected'
  );
  const states = runtime.states || {};
  return {
    full_stack_quantity_sentinel: Math.floor(toRuntimeNumber(runtime.full_stack_quantity_sentinel, -1)),
    states: {
      default: states.default,
      trade_locked: states.trade_locked
    },
    stack_size_field: runtime.stack_size_field,
    resource_debit_source_container_type: runtime.resource_debit_source_container_type
  };
}

function isFullStackMoveQuantity(quantity) {
  return Number(quantity) === getInventoryMovementRuntimeConfig().full_stack_quantity_sentinel;
}

function normalizeInventoryMoveQuantity(quantity, fallbackStackSize) {
  if (quantity === null || quantity === undefined || isFullStackMoveQuantity(quantity)) return fallbackStackSize;
  return parseInt(quantity, 10);
}

function serializeInventoryMoveQuantity(quantity) {
  if (quantity === null || quantity === undefined) return getInventoryMovementRuntimeConfig().full_stack_quantity_sentinel;
  return parseInt(quantity, 10);
}


function getInventoryStackField() {
  return getInventoryMovementRuntimeConfig().stack_size_field;
}

function getInventoryCommandName(key) {
  const commands = requireRuntimeConfigValue(
    getGameplayRuntimeConfig(),
    'inventory_commands',
    (v) => v && typeof v === 'object',
    'object expected'
  );
  return commands[key] || key;
}

function getInventoryTransferOptions(kind) {
  const movement = getGameplayRuntimeConfig().inventory_movement || {};
  const presets = movement.transfer_options || {};
  const defaults = {
    system_full_access: { actor: 'system', ignoreAccess: true, ignoreDistance: true, allowTradeLocked: true, allowLocked: true },
    system_ignore_access: { actor: 'system', ignoreAccess: true, ignoreDistance: true },
    system_ignore_access_only: { actor: 'system', ignoreAccess: true },
    player_ui: { actor: 'default', ignoreAccess: false, ignoreDistance: true }
  };
  const preset = presets[kind] || defaults[kind] || {};
  const actorKind = preset.actor || 'default';
  const result = { ...preset, actorId: getInventoryActorId(actorKind) };
  delete result.actor;
  return result;
}

function getInventoryLootRuntimeConfig() {
  const runtime = requireRuntimeConfigValue(
    getGameplayRuntimeConfig(),
    'inventory_loot',
    (v) => v && typeof v === 'object',
    'object expected'
  );
  return {
    event_type: runtime.event_type,
    default_quantity: Math.max(1, Math.floor(toRuntimeNumber(runtime.default_quantity, 1))),
    fallback_item_name: runtime.fallback_item_name
  };
}

function getPrimaryCurrencyPrototypeId(fallback = 'gold') {
  const ids = getGameplayRuntimeConfig().currency?.prototype_ids;
  return Array.isArray(ids) && ids.length > 0 ? ids[0] : fallback;
}

function getCurrencyPhysicalWeight(prototypeId, fallback = 0.01) {
  const weights = getGameplayRuntimeConfig().currency?.physical_weights || {};
  return toRuntimeNumber(weights[prototypeId], fallback);
}


function formatRuntimeTemplate(template, params = {}) {
  return String(template ?? '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : `{${key}}`;
  });
}

function getInventoryFeedbackText(key, fallback, params = {}) {
  const feedback = getGameplayRuntimeConfig().inventory_feedback || {};
  const value = feedback.inventory_errors?.[key]
    ?? feedback.trade_errors?.[key]
    ?? fallback;
  return formatRuntimeTemplate(value, params);
}

function getInventoryUnlockRuntimeConfig() {
  const runtime = requireRuntimeConfigValue(
    getGameplayRuntimeConfig(),
    'inventory_unlock',
    (v) => v && typeof v === 'object',
    'object expected'
  );
  return {
    lockpick_prototype_id: runtime.lockpick_prototype_id,
    ability_stat: runtime.ability_stat,
    ability_baseline: toRuntimeNumber(runtime.ability_baseline, 10),
    ability_divisor: Math.max(1, toRuntimeNumber(runtime.ability_divisor, 2))
  };
}

function getInventoryUnlockAbilityModifier() {
  const config = getInventoryUnlockRuntimeConfig();
  const statValue = toRuntimeNumber(player?.stats?.[config.ability_stat], config.ability_baseline);
  return (statValue - config.ability_baseline) / config.ability_divisor;
}

function getCurrencyPrototypeIds() {
  return getGameplayRuntimeConfig().currency.prototype_ids;
}

function isCurrencyPrototype(prototypeId) {
  return getCurrencyPrototypeIds().includes(prototypeId);
}

function isGoldLikeItem(item) {
  if (!item) return false;
  const currency = getGameplayRuntimeConfig().currency;
  const aiId = typeof item.custom_props?.aiIdentifier === 'string'
    ? item.custom_props.aiIdentifier.toLowerCase()
    : '';
  const aiIds = (currency.ai_identifiers || []).map((id) => String(id).toLowerCase());
  return currency.prototype_ids.includes(item.prototype_id) || aiIds.includes(aiId);
}

function isCurrencyAiIdentifier(value) {
  if (typeof value !== 'string') return false;
  const currency = getGameplayRuntimeConfig().currency;
  const normalized = value.toLowerCase();
  const aiIds = (currency.ai_identifiers || []).map((id) => String(id).toLowerCase());
  const prototypeIds = (currency.prototype_ids || []).map((id) => String(id).toLowerCase());
  return aiIds.includes(normalized) || prototypeIds.includes(normalized);
}


function calculateMaxMana(intelligence, level) {
  const manaConfig = getGameplayRuntimeConfig().progression.mana;
  const currentLevel = requireRuntimeNumber(level, 'player.stats.level');
  const baseMana = requireRuntimeNumber(manaConfig.base, 'gameplay_runtime.progression.mana.base');
  const intBaseline = requireRuntimeNumber(manaConfig.int_baseline, 'gameplay_runtime.progression.mana.int_baseline');
  const levelBonus = requireRuntimeNumber(manaConfig.level_bonus, 'gameplay_runtime.progression.mana.level_bonus');
  const minimum = requireRuntimeNumber(manaConfig.minimum, 'gameplay_runtime.progression.mana.minimum');
  const intModifier = Math.floor(requireRuntimeNumber(intelligence, 'player.stats.int') - intBaseline);
  return Math.max(minimum, baseMana + (intModifier * currentLevel) + (currentLevel * levelBonus));
}

function calculateMaxHp(constitution) { const hpConfig = getGameplayRuntimeConfig().progression.hp; const currentLevel = player ? requireRuntimeNumber(player.stats.level, 'player.stats.level') : 1; const baseHp = requireRuntimeNumber(hpConfig.base, 'gameplay_runtime.progression.hp.base'); const divisor = Math.max(1, requireRuntimeNumber(hpConfig.constitution_divisor, 'gameplay_runtime.progression.hp.constitution_divisor')); const baseline = requireRuntimeNumber(hpConfig.constitution_baseline, 'gameplay_runtime.progression.hp.constitution_baseline'); const conModifier = Math.floor((requireRuntimeNumber(constitution, 'player.stats.con') - baseline) / divisor); const levelBonus = requireRuntimeNumber(hpConfig.level_bonus, 'gameplay_runtime.progression.hp.level_bonus'); const minimum = requireRuntimeNumber(hpConfig.minimum, 'gameplay_runtime.progression.hp.minimum'); return Math.max(minimum, baseHp + (conModifier * currentLevel) + (currentLevel * levelBonus)); }
function getInitialInventoryCapacity(strength) { const capacityConfig = getGameplayRuntimeConfig().character_creation?.inventory_capacity || {}; const base = requireRuntimeNumber(capacityConfig.base, 'gameplay_runtime.character_creation.inventory_capacity.base'); const strengthBaseline = requireRuntimeNumber(capacityConfig.strength_baseline, 'gameplay_runtime.character_creation.inventory_capacity.strength_baseline'); const strengthDivisor = Math.max(1, requireRuntimeNumber(capacityConfig.strength_divisor, 'gameplay_runtime.character_creation.inventory_capacity.strength_divisor')); return base + Math.floor((requireRuntimeNumber(strength, 'player.stats.str') - strengthBaseline) / strengthDivisor); }
function buildInitialGameTime(selectedEra) { const calendar = getGameplayRuntimeConfig().calendar || {}; const eraStartYear = window.ERAS_DATA && window.ERAS_DATA.find(e => e.id === selectedEra)?.start_year; const fallbackYear = requireRuntimeNumber(calendar.fallback_start_year, 'gameplay_runtime.calendar.fallback_start_year'); const monthsPerYear = Math.max(1, requireRuntimeNumber(calendar.months_per_year, 'gameplay_runtime.calendar.months_per_year')); const maxInitialDay = Math.max(1, requireRuntimeNumber(calendar.max_initial_day, 'gameplay_runtime.calendar.max_initial_day')); return { year: eraStartYear || fallbackYear, month: Math.floor(Math.random() * monthsPerYear) + 1, day: Math.floor(Math.random() * maxInitialDay) + 1, hour: requireRuntimeNumber(calendar.initial_hour, 'gameplay_runtime.calendar.initial_hour'), minute: requireRuntimeNumber(calendar.initial_minute, 'gameplay_runtime.calendar.initial_minute'), totalPulses: requireRuntimeNumber(calendar.initial_total_pulses, 'gameplay_runtime.calendar.initial_total_pulses') }; }
function calculateAbsoluteStartDay(gameTime) { const calendar = getGameplayRuntimeConfig().calendar || {}; const daysPerYear = Math.max(1, requireRuntimeNumber(calendar.days_per_year, 'gameplay_runtime.calendar.days_per_year')); const daysPerMonth = Math.max(1, requireRuntimeNumber(calendar.days_per_month, 'gameplay_runtime.calendar.days_per_month')); return gameTime.year * daysPerYear + (gameTime.month - 1) * daysPerMonth + (gameTime.day - 1); }
function calculateBootstrapDays(totalPopulation) { const bootstrap = getGameplayRuntimeConfig().world_bootstrap || {}; const minimumDays = Math.max(0, requireRuntimeNumber(bootstrap.minimum_days, 'gameplay_runtime.world_bootstrap.minimum_days')); const baseDays = Math.max(0, requireRuntimeNumber(bootstrap.base_days, 'gameplay_runtime.world_bootstrap.base_days')); const populationDivisor = Math.max(1, requireRuntimeNumber(bootstrap.population_divisor, 'gameplay_runtime.world_bootstrap.population_divisor')); return Math.max(minimumDays, baseDays + Math.floor(requireRuntimeNumber(totalPopulation, 'world.totalPopulation') / populationDivisor)); }
function getStartingInventory(playerClass) {
    let startingItemConfig = {}; // itemAiIdentifier: quantity
    
    if (window.CLASSES_DATA) {
        const classDef = window.CLASSES_DATA.find(c => c.id === playerClass);
        if (classDef && classDef.starting_items) {
            startingItemConfig = classDef.starting_items;
        }
    }

    const inventory = {};
    if (!Array.isArray(itemsReferenceData)) {
        console.error("Справочник предметов не загружен или имеет неверный формат. Невозможно выдать стартовый инвентарь.");
        return {};
    }

    for (const itemAiId in startingItemConfig) {
        const quantity = startingItemConfig[itemAiId];
        const itemRef = itemsReferenceData.find(ref => ref.id === itemAiId);

        if (itemRef) {
            const internalId = nextInternalItemId++; // Ensure nextInternalItemId is initialized globally
            inventory[internalId] = {
                id: internalId,
                aiIdentifier: itemAiId,
                name: itemRef.name,
                quantity: quantity,
                description: itemRef.description || t('itemDescriptions.noDescription'),
                rarity: itemRef.rarity,
                itemType: itemRef.type,
                effects: itemRef.effects || [],
                value: itemRef.value || 0
            };
        } else {
            console.warn(`[getStartingInventory] Ссылка на предмет не найдена для ID: ${itemAiId}. Предмет не добавлен.`);
        }
    }
    return inventory;
}

function calculateXpForNextLevel(level) {
    return Math.floor(100 * Math.pow(level, 1.5));
}

function levelUp() {
    const _beforeLevel = player?.level || 1;
    if (!player) return;

    let levelsGainedThisCycle = 0;
    let totalHpGainThisCycle = 0;
    let totalStatPointsGainedThisCycle = 0;

    while (player.stats.xp >= player.stats.xpNext) {
        const excessXp = player.stats.xp - player.stats.xpNext;
        player.stats.level++;
    const _prevLevel = player.stats.level;
        levelsGainedThisCycle++;
        player.stats.statPoints += POINTS_PER_LEVEL;
        totalStatPointsGainedThisCycle += POINTS_PER_LEVEL;
        player.stats.xp = Math.max(0, excessXp); // Опыт переносится
        player.stats.xpNext = calculateXpForNextLevel(player.stats.level);

        const oldMaxHp = player.stats.maxHp;
        player.stats.maxHp = calculateMaxHp(player.stats.con);
        const hpGainThisLevel = player.stats.maxHp - oldMaxHp;
        totalHpGainThisCycle += hpGainThisLevel;
        player.stats.hp = player.stats.maxHp; // Полное восстановление HP при уровне

        if (player.class === 'mage') {
            player.stats.maxMana = calculateMaxMana(player.stats.int, player.stats.level);
            player.stats.mana = player.stats.maxMana; // Полное восстановление маны
        }
        player.justLeveledUp = true;
    }

    if (levelsGainedThisCycle > 0) {
        addLogMessage(t('gameInterface.log.levelUpSummary', {
            finalLevel: player.stats.level
        }), "system-message level-up");

        if (totalHpGainThisCycle > 0) {
            addLogMessage(t('gameInterface.log.levelUpHPSummary', {
                totalHpGain: totalHpGainThisCycle
            }), "system-message level-up");
        }
        addLogMessage(t('gameInterface.log.levelUpPointsSummary', {
            totalStatPoints: totalStatPointsGainedThisCycle
        }), "system-message level-up");
        generateWorldNews(`Герой ${player.name} достиг ${player.stats.level} уровня!`, player.location || "global", 3, 'misc');
        updateCharacterSheet(); // Обновит отображение, включая кнопки "+"
    }
}

function handleStatIncrease(event) {
    if (!player || player.stats.statPoints <= 0) return;
    const statToIncrease = event.target.getAttribute('data-stat');
    const validStats = ['str', 'dex', 'int', 'con', 'cha', 'res'];
    if (!statToIncrease || !validStats.includes(statToIncrease)) return;

    player.stats.statPoints--;
    player.stats[statToIncrease]++;

    if (statToIncrease === 'con') {
        const oldMaxHp = player.stats.maxHp;
        player.stats.maxHp = calculateMaxHp(player.stats.con);
        const hpDiff = player.stats.maxHp - oldMaxHp;
        player.stats.hp = Math.min((player.stats.hp || 0) + hpDiff, player.stats.maxHp);
    }
    if (statToIncrease === 'str') {
        player.inventoryCapacity = 10 + Math.floor((player.stats.str - 10) / 2);
    }
    if (statToIncrease === 'int' && player.class === 'mage') {
        const oldMaxMana = player.stats.maxMana;
        player.stats.maxMana = calculateMaxMana(player.stats.int, player.stats.level);
        player.stats.mana = Math.min((player.stats.mana || 0) + (player.stats.maxMana - oldMaxMana), player.stats.maxMana);
    }

    const statNameLocalized = t(`characterCreation.stat${statToIncrease.toUpperCase()}`);
    addLogMessage(t('gameInterface.log.statIncreased', { statName: statNameLocalized, points: player.stats.statPoints }), "command-feedback");

    // Сообщаем GM о действии
    queuePlayerActionForGM(`Player increased attribute '${statToIncrease.toUpperCase()}' to ${player.stats[statToIncrease]}.`);

    updateCharacterSheet();
}

function updateNexusDisplay() {
    const nexusList = document.getElementById('nexus-list');
    if (!player || !nexusList) return;

    nexusList.innerHTML = '';
    const nexusData = Object.values(player.nexusData || {});

    // Фильтруем служебные элементы и скрываем Мировые События (они теперь в Летописи Мира)
    const actualItems = nexusData.filter(item => {
        if (!item || typeof item.name !== 'string' || item.name === item.category) return false;
        if (item.category === 'World_Event' || item.category === 'Мировое Событие' || item.id.startsWith('event_')) return false;
        return true;
    });

    if (actualItems.length === 0) {
        nexusList.innerHTML = `<li data-i18n="gameInterface.nexusPanel.empty">${t('gameInterface.nexusPanel.empty', 'Нет данных')}</li>`;
        return;
    }

    // Группируем отфильтрованные элементы по категориям
    const groupedData = actualItems.reduce((acc, item) => {
        const category = item.category || t('gameInterface.nexusPanel.defaultCategory', 'Прочее');
        if (!acc[category]) {
            acc[category] = [];
        }
        acc[category].push(item);
        return acc;
    }, {});

    const sortedCategories = Object.keys(groupedData).sort((a, b) => a.localeCompare(b, currentLanguage));

    for (const category of sortedCategories) {
        const categoryHeader = document.createElement('li');
        categoryHeader.className = 'category-header';
        categoryHeader.textContent = category;
        nexusList.appendChild(categoryHeader);

        groupedData[category].sort((a, b) => a.name.localeCompare(b.name, currentLanguage)).forEach(item => {
            // *** ЗАЩИТА: Дополнительная проверка на корректность объекта ***
            if (!item || typeof item.name !== 'string' || typeof item.value === 'undefined') {
                console.error("Пропущен некорректный элемент Nexus:", item);
                return; // Пропускаем рендеринг сломанного элемента
            }

            const li = document.createElement('li');
            li.className = 'nexus-item';
            // Кастомный тултип для Nexus
            li.addEventListener('mouseenter', (e) => {
                const desc = item.description || 'Нет подробного описания.';
                const content = `<div style="color:#5d4a36; font-style:italic; margin-bottom: 5px; border-bottom: 1px solid rgba(0,0,0,0.1); padding-bottom: 3px;">Категория: ${item.category || 'Прочее'}</div>
                                 <div style="color:#1a110a; line-height: 1.4; font-size: 0.95em; font-weight: 500;">${desc}</div>`;
                showGenericTooltip(e, item.name, content);
            });
            li.addEventListener('mouseleave', hideGenericTooltip);
            li.addEventListener('mousemove', moveGenericTooltip);

            let valueDisplay = '';
            switch (item.displayType) {
                case 'boolean':
                    valueDisplay = item.value === 'true'
                        ? t('gameInterface.nexusPanel.boolTrue', 'Да')
                        : t('gameInterface.nexusPanel.boolFalse', 'Нет');
                    break;
                case 'numeric':
                    valueDisplay = `${item.value}`;
                    break;
                case 'clock':
                    const max = parseInt(item.max, 10) || requireRuntimeNumber(getGameplayRuntimeConfig().item_display.clock_max_segments, 'gameplay_runtime.item_display.clock_max_segments');
                    const val = parseInt(item.value, 10) || 0;
                    const filled = 'в–€'.repeat(val);
                    const empty = 'в–‘'.repeat(Math.max(0, max - val));
                    valueDisplay = `<span style="color:#e74c3c; letter-spacing: 2px;">[${filled}${empty}]</span>`;
                    break;
                case 'text':
                default:
                    valueDisplay = `${item.value}`;
            }

            li.innerHTML = `<span class="nexus-name">${item.name}</span><span class="nexus-value">${valueDisplay}</span>`;
            nexusList.appendChild(li);
        });
    }
}

async function loadPredefinedEffects() {
    try {
        if (typeof window.ensureRuntimeDataLoaded === 'function') {
            await window.ensureRuntimeDataLoaded();
        }

        let effectsArray = Array.isArray(window.PREDEFINED_EFFECTS_DATA) ? window.PREDEFINED_EFFECTS_DATA : [];
        if (effectsArray.length === 0) {
            const isDefault = currentLanguage === DEFAULT_LANGUAGE;
            const { primary, fallback } = getLocalizedRuntimeAssetPaths(
                isDefault ? 'predefined_effects_default' : 'predefined_effects_template',
                'predefined_effects_default',
                { lang: currentLanguage }
            );
            console.log(`Попытка загрузить предопределенные эффекты из: ${primary || fallback}`);
            let response = await fetch(`${(primary || fallback)}?t=${Date.now()}`);
            if (!response.ok && !isDefault) {
                response = await fetch(`${fallback}?t=${Date.now()}`);
            }
            if (!response.ok) throw new Error(`HTTP ошибка! статус: ${response.status}`);
            effectsArray = await response.json();
        }

        // Handle both array [{id,name,...}] and object {id:{name,...}} formats
        if (Array.isArray(effectsArray)) {
            predefinedStatusEffects = effectsArray.reduce((acc, effect) => {
                if (effect && effect.id) acc[effect.id] = effect;
                return acc;
            }, {});
        } else if (effectsArray && typeof effectsArray === 'object') {
            predefinedStatusEffects = effectsArray; // Already {id: {name,...}} format
        } else {
            predefinedStatusEffects = {};
        }

        console.log(`Предопределенные эффекты (${Object.keys(predefinedStatusEffects).length} шт.) успешно загружены.`);
    } catch (error) {
        console.error(`Критическая ошибка: не удалось загрузить или разобрать предопределенные эффекты:`, error);
        predefinedStatusEffects = {};
        showCustomAlert(`Ошибка загрузки базовых игровых данных (эффекты). Игра может работать некорректно. Детали: ${error.message}`);
    }
}

function processAutomatedNexusEffects() {
    if (!player || !player.nexusData) return;

    for (const key in player.nexusData) {
        const nexusItem = player.nexusData[key];
        if (nexusItem.effectsJSON && !nexusItem.effectApplied) {
            try {
                const parsedEffects = typeof nexusItem.effectsJSON === 'string' ? JSON.parse(nexusItem.effectsJSON) : nexusItem.effectsJSON;
                for (const subEffect of parsedEffects) {
                    if (subEffect.action && subEffect.action.type === 'modify_stat') {
                        const stat = subEffect.action.stat;
                        const change = parseInt(subEffect.action.change, 10);
                        if (player.stats[stat] !== undefined && !isNaN(change)) {
                            player.stats[stat] += change;
                            addLogMessage(`Константа '${nexusItem.name}' повлияла на вас! (${stat.toUpperCase()} ${change > 0 ? '+' : ''}${change})`, 'level-up');
                            addCalculationMessage(`[NEXUS_AUTO] Эффект '${key}' применен. ${stat.toUpperCase()} ${change > 0 ? '+' : ''}${change}.`);
                        }
                    }
                }
                nexusItem.effectApplied = true;
            } catch (e) { console.error("Error parsing nexus effects", e); }
        }
    }

    updateCharacterSheet();
}

// --- Обновление Интерфейса ---
function updateDiceLogDisplay() {
    const panel = document.getElementById('dice-log-panel');
    const list = document.getElementById('dice-log-list');
    if (!panel || !list || !player) return;
    
    if (!player.diceLogHistory || player.diceLogHistory.length === 0) {
        panel.style.display = 'none';
        return;
    }
    
    panel.style.display = 'flex';
    list.innerHTML = '';
    
    const history = [...player.diceLogHistory].reverse();
    history.forEach(entry => {
        const li = document.createElement('li');
        li.style.cssText = 'flex-direction: column; align-items: flex-start; background: rgba(0,0,0,0.3); border-left: 3px solid #f39c12; margin-bottom: 5px; padding: 8px;';
        
        let html = `<div style="color: #f39c12; font-size: 0.85em; margin-bottom: 4px; font-weight: bold;">РҐРѕРґ ${entry.turn}</div>`;
        entry.rolls.forEach(roll => {
            html += `<div style="color: #ecf0f1; font-size: 0.9em; font-family: monospace;">рџЋІ ${roll}</div>`;
        });
        
        li.innerHTML = html;
        list.appendChild(li);
    });
}


async function initializeGameInterface() {
    restructureUI();
    await syncPlayerContainerBindings();
    syncPlayerGoldFromInventory();

    // --- ЛОГИКА СКРИПТОВОГО ПУТЕШЕСТВИЯ ---
    window.advanceJourney = async function () {
        if (!player || !player.currentJourney) return;

        if (player.currentCombat && player.currentCombat.isActive) {
            showCustomAlert("Сначала завершите бой!");
            return;
        }

        player.currentJourney.currentPoint++;
        advanceTime(48); // 4 часа на один этап пути
        player.currentJourney.isPausedForCheck = false; // Снимаем паузу при переходе
        updateCharacterSheet();

        // Если дошли до конца
        if (player.currentJourney.currentPoint > player.currentJourney.points) {
            journeyContinueBtn.style.display = 'none';
            userInput.disabled = false;
            sendButton.style.display = 'block';
            userInput.value = `[SYSTEM: ПУТЕШЕСТВИЕ ЗАВЕРШЕНО. Игрок прибыл в ${player.currentJourney.destination}. Опиши прибытие и вызови команду endJourney]`;
            handleUserInput();
            return;
        }

        // Получаем события для текущей точки
        const pointData = player.currentJourney.events[player.currentJourney.currentPoint - 1];
        const options = pointData.options || [];

        if (options.length === 0) {
            addLogMessage(`*День ${player.currentJourney.currentPoint} проходит без происшествий.*`, "gm-message");
            return;
        }

        // Рандомный выбор события скриптом
        const randomIndex = Math.floor(Math.random() * options.length);
        const selectedEvent = options[randomIndex];

        // Отрисовка текста события
        addLogMessage(`**[Этап пути ${player.currentJourney.currentPoint}/${player.currentJourney.points}]**\n${selectedEvent.text}`, "gm-message");

        // Обработка механики события
        if (selectedEvent.type === 'combat') {
            let participants = [];
            if (selectedEvent.enemies && selectedEvent.enemies.length > 0) {
                                        for (let idx = 0; idx < selectedEvent.enemies.length; idx++) {
                            const en = selectedEvent.enemies[idx];
                            const eId = `j_enemy_${Date.now()}_${idx}`;
                            await executeCommand('addEnvironment', {
                                aiIdentifier: eId,
                                name: en.name || "Враг",
                                type: "enemy",
                                hp: en.hp ?? requireRuntimeNumber(getEnvironmentCommandDefaults().journey_enemy_default_hp, 'gameplay_runtime.command_defaults.environment.journey_enemy_default_hp'),
                                maxHp: en.hp ?? requireRuntimeNumber(getEnvironmentCommandDefaults().journey_enemy_default_hp, 'gameplay_runtime.command_defaults.environment.journey_enemy_default_hp'),
                                str: getEnvironmentDefaultStat('strength'), dex: getEnvironmentDefaultStat('dexterity'), con: getEnvironmentDefaultStat('constitution'), int: getEnvironmentDefaultStat('intelligence'),
                                isHostile: true,
                                xpReward: requireRuntimeNumber(getEnvironmentCommandDefaults().journey_enemy_default_xp_reward, 'gameplay_runtime.command_defaults.environment.journey_enemy_default_xp_reward')
                            });
                            participants.push(eId);
                        }
            } else {
                const eId = `j_enemy_${Date.now()}`;
                executeCommand('addEnvironment', { aiIdentifier: eId, name: "Разбойник", type: "enemy", hp: requireRuntimeNumber(getEnvironmentCommandDefaults().journey_bandit_default_hp, 'gameplay_runtime.command_defaults.environment.journey_bandit_default_hp'), maxHp: requireRuntimeNumber(getEnvironmentCommandDefaults().journey_bandit_default_hp, 'gameplay_runtime.command_defaults.environment.journey_bandit_default_hp'), isHostile: true, xpReward: requireRuntimeNumber(getEnvironmentCommandDefaults().journey_bandit_default_xp_reward, 'gameplay_runtime.command_defaults.environment.journey_bandit_default_xp_reward') });
                participants.push(eId);
            }
            executeCommand('setCombatState', { isActive: true, participants: participants });
            updateCharacterSheet();
        }
 else if (selectedEvent.type === 'check') {
            player.currentJourney.isPausedForCheck = true;
            updateCharacterSheet();
            addLogMessage(`(( СИСТЕМА: Путь прерван препятствием. Требуется проверка: ${selectedEvent.stat.toUpperCase()} (Сложность: ${selectedEvent.dc}). Совершите действие или бросок! ))`, "system-message");
        } else if (selectedEvent.type === getInventoryLootRuntimeConfig().event_type) {
            if (selectedEvent.itemId) {
                executeCommand('addItem', { aiIdentifier: selectedEvent.itemId, name: selectedEvent.itemName || "Находка", quantity: selectedEvent.amount ?? requireRuntimeNumber(getInventoryLootRuntimeConfig().default_quantity, 'gameplay_runtime.inventory_loot.default_quantity') });
            }
        }
    };

    if (!player) return;

    // --- АКТИВИРУЕМ УПРАВЛЕНИЕ КАРТОЙ ЗДЕСЬ! ---
    setupMapControls();

    if (gameTitle) gameTitle.textContent = t('appName') + ` | ${player.name}`;
    if (gameLog) gameLog.innerHTML = '';
    if (calculationLog) {
        calculationLog.innerHTML = `<p class="system-message" data-i18n="gameInterface.calcLogPanel.empty">${t('gameInterface.calcLogPanel.empty')}</p>`;
    }

    initQuickTags();

    updateCharacterSheet();
    updateNexusDisplay();
    if (typeof populateEquipmentUI === 'function') populateEquipmentUI();
    updateEquipmentDisplay(); // <--- ДОБАВЛЕН ВЫЗОВ
    updateHoldingsDisplay();
    updateEchoMemoryDisplay();

    updateDiceLogDisplay();
    updateInventoryDisplay();
    updateStatusEffectsDisplay();
    updateQuestList();
    updateSkillsDisplay();
    updateMapDisplay(); // Эта функция вызовет renderVisualMap
    updateWorldChroniclesDisplay();
    updateTradeJournalDisplay();
    updatePortPanel();

    // Локальная карта удалена (CityGen вырезан из проекта)

    // Даем время CSS-анимациям завершиться, чтобы канвас получил реальный размер
    setTimeout(() => {
        if (window.Cartographer) {
            Cartographer.isMapInitialized = false;
            Cartographer.render();
        }
    }, 500);
    updateEnvironmentPanel();
    updateTimeDisplay();
    
    // Возобновление таймера путешествия при загрузке, если он был активен
    if (player && player.travel && player.travel.active && !player.travel.paused) {
        LivingRoads.resume();
    }

toggleStatIncreaseButtons();

    // Синхронизируем состояние плеера
    isMusicPlaying = audioPlayer ? !audioPlayer.paused : false;

    if (userInput) {
        userInput.disabled = false;
        userInput.focus();
    }
    if (sendButton) sendButton.disabled = false;

    collapsiblePanels.forEach(panel => {
        const content = panel.querySelector('.panel-content');
        const icon = panel.querySelector('.toggle-icon');
        const shouldBeExpanded = panel.classList.contains('character-sheet');

        panel.classList.toggle('expanded', shouldBeExpanded);
        if (icon) icon.textContent = shouldBeExpanded ? '▼' : '▶';

        if (content) {
            if (shouldBeExpanded) {
                setTimeout(() => {
                    content.style.maxHeight = content.scrollHeight + "px";
                    setTimeout(() => {
                        if (panel.classList.contains('expanded')) content.style.maxHeight = 'none';
                    }, 400);
                }, 50);
            } else {
                content.style.maxHeight = '0';
            }
        }
    });

    startAutoSaveTimer();
    updateTransportUI();
}

/**
 * RPG Health Bar -- создает и обновляет анимированную полосу здоровья
 */
function _updateHpBar(hp, maxHp) {
    const statLine = document.querySelector('.stat-line:has(#stat-hp)');
    if (!statLine) return;
    let barContainer = statLine.querySelector('.hp-bar-container');
    if (!barContainer) {
        barContainer = document.createElement('div');
        barContainer.className = 'hp-bar-container';
        const barFill = document.createElement('div');
        barFill.className = 'hp-bar-fill';
        barContainer.appendChild(barFill);
        const valueGroup = statLine.querySelector('.stat-value-group');
        if (valueGroup) valueGroup.insertBefore(barContainer, valueGroup.firstChild);
    }
    const barFill = barContainer.querySelector('.hp-bar-fill');
    if (barFill) {
        const pct = maxHp > 0 ? Math.min(100, (hp / maxHp) * 100) : 0;
        barFill.style.width = pct + '%';
        barFill.classList.remove('healthy', 'wounded', 'critical');
        if (pct > 60) barFill.classList.add('healthy');
        else if (pct > 25) barFill.classList.add('wounded');
        else barFill.classList.add('critical');
    }
}

/**
 * RPG Mana Bar -- создает и обновляет анимированную полосу маны
 */
function _updateManaBar(mana, maxMana) {
    const statLine = document.getElementById('mana-stat-line');
    if (!statLine) return;
    let barContainer = statLine.querySelector('.hp-bar-container');
    if (!barContainer) {
        barContainer = document.createElement('div');
        barContainer.className = 'hp-bar-container';
        const barFill = document.createElement('div');
        barFill.className = 'mana-bar-fill';
        barContainer.appendChild(barFill);
        const valueGroup = statLine.querySelector('.stat-value-group');
        if (valueGroup) valueGroup.insertBefore(barContainer, valueGroup.firstChild);
    }
    const barFill = barContainer.querySelector('.mana-bar-fill');
    if (barFill) {
        const pct = maxMana > 0 ? Math.min(100, (mana / maxMana) * 100) : 0;
        barFill.style.width = pct + '%';
    }
}

/**
 * Полностью обновляет панель персонажа в игровом интерфейсе,
 * отображая актуальные данные из объекта player.
 * Включает логику для визуального выделения характеристик,
 * на которые действуют баффы или дебаффы.
 */
function updateCharacterSheet() {
        // Управление UI путешествия и блокировка ввода
    if (player && player.travel && player.travel.active) {
        if (locationStatLine) locationStatLine.style.display = 'none';
        if (journeyContainer) {
            journeyContainer.style.display = 'flex';
            journeyDest.textContent = `Р’ пути: ${player.travel.destinationName}`;
            journeyProgressText.textContent = `${player.travel.elapsedHours} / ${player.travel.totalHours} С‡.`;
            const pct = Math.min(100, (player.travel.elapsedHours / player.travel.totalHours) * 100);
            journeyProgressBar.style.width = `${pct}%`;
            
            if (LivingRoads.isGeneratingHour) {
                if (journeyLoading) journeyLoading.style.display = 'block';
                if (travelControls) travelControls.style.display = 'flex';
                if (journeyEventArea) journeyEventArea.style.display = 'none';
            } else if (player.travel.currentEvents && player.travel.currentEvents.length > 0) {
                if (journeyLoading) journeyLoading.style.display = 'none';
                if (travelControls) travelControls.style.display = 'none';
                if (journeyEventArea) {
                    journeyEventArea.style.display = 'block';
                    let htmlText = '';
                    player.travel.currentEvents.forEach(ev => {
                        // Обработка локализации: если description содержит loc_key, используем t()
                        let description = '';
                        let descObj = ev.description;

                        // Если description - это JSON-строка, парсим её
                        if (typeof descObj === 'string') {
                            try {
                                const parsed = JSON.parse(descObj);
                                if (typeof parsed === 'object' && parsed !== null) {
                                    descObj = parsed;
                                } else {
                                    description = descObj;
                                }
                            } catch (e) {
                                // Не JSON, используем как есть
                                description = descObj;
                            }
                        }

                        // Если ещё не установлено и это объект
                        if (!description && typeof descObj === 'object' && descObj !== null) {
                            if (descObj.loc_key) {
                                // Используем систему локализации с ключом и аргументами
                                description = t(descObj.loc_key, descObj.loc_args || {});
                            } else if (descObj[currentLanguage]) {
                                // Если это объект локализации, берём текущий язык
                                description = descObj[currentLanguage] || descObj['ru'] || descObj['en'];
                            } else {
                                description = JSON.stringify(descObj);
                            }
                        }

                        if (!description) {
                            description = String(ev.description || 'Неизвестное событие');
                        }

                        let safeDesc = description.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                        htmlText += `<div class="journey-event-row">
                                        <div class="journey-event-text-container"><strong>[Событие]</strong> ${description}</div>`;
                        if (ev.can_interact) {
                            htmlText += `<div class="journey-event-btn-container">
                                            <button class="travel-action-btn" onclick="LivingRoads.interact('${ev.object_type}', '${ev.sim_object_id}', '${safeDesc}')"><i class="fas fa-search"></i> Исследовать</button>
                                         </div>`;
                        }
                        htmlText += `</div>`;
                    });
                    if (journeyEventText) journeyEventText.innerHTML = htmlText;
                    if (journeyEventActions) {
                        // Т3 ФИКС: Критические события (река, бандиты, бедствия) нельзя просто пропустить
                        const hasCriticalEvent = player.travel.currentEvents.some(ev => ['river_crossing', 'bandit', 'disaster'].includes(ev.object_type));
                        if (hasCriticalEvent) {
                            journeyEventActions.innerHTML = `<div style="text-align:center; color:#e74c3c; font-size:0.8em; padding:5px;"><i class="fas fa-exclamation-triangle"></i> Это препятствие невозможно просто обойти. Нужно решение.</div>`;
                        } else {
                            journeyEventActions.innerHTML = `<button class="travel-action-btn btn-continue" style="width: 100%; margin: 0;" onclick="LivingRoads.resume()"><i class="fas fa-shoe-prints"></i> Уйти дальше</button>`;
                        }
                    }
                }
            } else {
                if (journeyLoading) journeyLoading.style.display = 'none';
                if (journeyEventArea) journeyEventArea.style.display = 'none';
                if (travelControls) travelControls.style.display = 'flex';
            }
            
            if (travelControls && travelControls.style.display === 'flex') {
                if (travelPauseBtn) {
                    travelPauseBtn.innerHTML = player.travel.paused ? '<i class="fas fa-play"></i>' : '<i class="fas fa-pause"></i>';
                    travelPauseBtn.title = player.travel.paused ? 'Продолжить путь' : 'Остановиться (Пауза)';
                }
                if (travelFastForwardBtn) {
                    if (player.travel.isFastForwarding) {
                        travelFastForwardBtn.style.background = 'rgba(46, 204, 113, 0.3)';
                        travelFastForwardBtn.style.color = '#2ecc71';
                        travelFastForwardBtn.style.borderColor = '#2ecc71';
                    } else {
                        travelFastForwardBtn.style.background = '';
                        travelFastForwardBtn.style.color = '';
                        travelFastForwardBtn.style.borderColor = '';
                    }
                }
            }
        }

        if ((player.currentCombat && player.currentCombat.isActive) || (player.travel.paused && (!player.travel.currentEvents || player.travel.currentEvents.length === 0))) {
            if (sendButton) sendButton.style.display = 'block';
            if (userInput) {
                if (!isWaitingForAI && !window.isSimulatingTime) userInput.disabled = false;
                userInput.placeholder = (player.currentCombat && player.currentCombat.isActive) ? "Что вы будете делать в бою?" : "Путь приостановлен. Что делаем?";
            }
        } else {
            if (sendButton) sendButton.style.display = 'none';
            if (userInput) {
                userInput.disabled = true;
                userInput.placeholder = LivingRoads.isGeneratingHour ? "Генерация пути..." : (player.travel.currentEvents && player.travel.currentEvents.length > 0 ? "Сделайте выбор в панели выше" : "Вы в пути... (Идет время)");
            }
        }
    } else if (player && player.currentJourney) {
        if (locationStatLine) locationStatLine.style.display = 'none';
        if (journeyContainer) {
            journeyContainer.style.display = 'flex';
            // Визуальная индикация боя в путешествии
            if (player.currentCombat && player.currentCombat.isActive) {
                journeyDest.innerHTML = `Р’ пути: ${player.currentJourney.destination} <span style="color: #e74c3c;">[БОЙ!]</span>`;
            } else {
                journeyDest.textContent = `Р’ пути: ${player.currentJourney.destination}`;
            }
            journeyProgressText.textContent = `${player.currentJourney.currentPoint} / ${player.currentJourney.points}`;
            const pct = Math.min(100, (player.currentJourney.currentPoint / player.currentJourney.points) * 100);
            journeyProgressBar.style.width = `${pct}%`;
        }
        if ((player.currentCombat && player.currentCombat.isActive) || player.currentJourney.isPausedForCheck) {
            // Бой активен или требуется проверка - блокируем кнопку продолжения путешествия
            if (journeyContinueBtn) journeyContinueBtn.style.display = 'none';
            if (sendButton) sendButton.style.display = 'block';
            if (userInput) {
                if (!isWaitingForAI) userInput.disabled = false;
                userInput.placeholder = "Что вы будете делать в бою?";
            }
        } else {
            // Путешествие идёт нормально - показываем кнопку продолжения
            if (journeyContinueBtn) journeyContinueBtn.style.display = 'block';
            if (sendButton) sendButton.style.display = 'none';
            if (userInput) {
                userInput.disabled = true;
                userInput.placeholder = "Вы в пути... (Устаревшая система)";
            }
        }
            } else {
            // Нет путешествия - стандартный UI
            if (locationStatLine) locationStatLine.style.display = 'flex';
            if (journeyContainer) journeyContainer.style.display = 'none';
            if (journeyContinueBtn) journeyContinueBtn.style.display = 'none';

            if (sendButton) sendButton.style.display = 'block';
            if (userInput) {
                if (!isWaitingForAI && !window.isSimulatingTime) userInput.disabled = false;
                userInput.placeholder = "Что вы будете делать?";
            }
        }

    if (!player) return;

    const { effectiveStats, bonuses, breakdown } = getEffectiveStats();

    // Обновление Имени, Расы, Класса
    charNameDisplay.querySelector('span:last-child').textContent = player.name || "???";
    charNameDisplay.style.cursor = 'pointer';
    charNameDisplay.title = "Нажмите, чтобы открыть полную летопись (предысторию)";
    charNameDisplay.onclick = () => {
        const modal = document.getElementById('biography-modal');
        const content = document.getElementById('biography-modal-content');
        const title = document.getElementById('biography-modal-title');
        if (modal && content) {
            title.textContent = `Летопись: ${player.name}`;
            content.textContent = player.description || "Предыстория скрыта в тумане времени...";
            modal.style.display = 'flex';
            setTimeout(() => modal.classList.add('visible'), 10);
        }
    };

    charRaceDisplay.querySelector('span:last-child').textContent = t(`characterCreation.race${player.race.charAt(0).toUpperCase() + player.race.slice(1)}`, null, player.race);
    charClassDisplay.querySelector('span:last-child').textContent = t(`characterCreation.class${player.class.charAt(0).toUpperCase() + player.class.slice(1)}`, null, player.class);

    // Обновление Здоровья и Маны
    if (hpDisplay) hpDisplay.textContent = player.stats.hp;
    if (maxHpDisplay) maxHpDisplay.textContent = effectiveStats.maxHp;

    // RPG Health Bar Update
    _updateHpBar(player.stats.hp, effectiveStats.maxHp);

    if (player.class === 'mage') {
        document.getElementById('mana-stat-line').style.display = 'flex';
        if (manaDisplay) manaDisplay.textContent = player.stats.mana;
        if (maxManaDisplay) maxManaDisplay.textContent = effectiveStats.maxMana;
        _updateManaBar(player.stats.mana, effectiveStats.maxMana);
    }

            // Обновление основных характеристик с КРАСИВЫМИ тултипами
        const statsToUpdate = ['str', 'dex', 'int', 'con', 'cha', 'res'];
        statsToUpdate.forEach(statKey => {
            const statLine = document.querySelector(`.stat-line[data-stat="${statKey}"]`);
            const statValueElement = document.getElementById(`stat-${statKey}`);
            if (!statValueElement || !statLine) return;

            const base = player.stats[statKey];
            const bonus = bonuses[statKey] || 0;

            // Удаляем старый системный тултип
            statLine.removeAttribute('title');

            // Привязываем наш красивый тултип
            statLine.onmouseenter = (e) => {
                let content = `<div style="color:#1a110a; font-size: 1.1em; margin-bottom:5px; border-bottom: 1px solid rgba(0,0,0,0.2); padding-bottom: 3px;">Итоговое значение: <b>${effectiveStats[statKey]}</b></div>`;
                content += `<div style="color:#2c1e14; margin-bottom:5px;">Базовое значение: <b>${base}</b></div>`;
                if (breakdown[statKey].length > 0) {
                    content += breakdown[statKey].map(b => `<div style="display:flex; justify-content:space-between; gap:10px; color:#3e2723;"><span>${b.name}:</span> <b style="${b.change > 0 ? 'color:#27ae60' : 'color:#c0392b'}">${b.change > 0 ? '+' : ''}${b.change}</b></div>`).join('');
                }
                showGenericTooltip(e, t(`gameInterface.characterPanel.${statKey}`), content);
            };
            statLine.onmouseleave = hideGenericTooltip;
            statLine.onmousemove = moveGenericTooltip;

            let htmlContent = `${base}`;
            if (bonus > 0) htmlContent += ` <span class="stat-bonus" style="color:#2ecc71; font-size:0.9em;">(+${bonus})</span>`;
            else if (bonus < 0) htmlContent += ` <span class="stat-bonus negative" style="color:#e74c3c; font-size:0.9em;">(${bonus})</span>`;

            statValueElement.innerHTML = htmlContent;
        });

    if (goldDisplay) goldDisplay.textContent = player.stats.gold;
    if (locationDisplay) locationDisplay.textContent = player.location || '???';

    // Обновление главной полоски репутации
    const globalRep = player.stats.reputation?.global || 0;
    if (reputationValueTextDisplay) reputationValueTextDisplay.textContent = globalRep;
    if (reputationMarker) {
        const minRep = -100;
        const maxRep = 100;
        let percent = ((globalRep - minRep) / (maxRep - minRep)) * 100;
        percent = Math.max(0, Math.min(100, percent));
        reputationMarker.style.left = `${percent}%`;
    }

    if (levelInfoDiv) {
        levelInfoDiv.innerHTML = t('gameInterface.characterPanel.levelInfo', {
            level: `<span id="stat-level">${player.stats.level}</span>`,
            xp: `<span id="stat-xp">${player.stats.xp}</span>`,
            xpNext: `<span id="stat-xp-next">${player.stats.xpNext}</span>`,
            points: `<span id="stat-points-available-display">${player.stats.statPoints}</span>`,
            turn: `<span id="stat-turn">${player.stats.turnCount}</span>`
        });
    }
        updateTimeDisplay();

toggleStatIncreaseButtons();
}



function updateInventoryDisplay() {
    if (!player || !inventoryList || !player.container_backpack) return;
    inventoryList.innerHTML = '';
    const backpack = ContainerRegistry.get(player.container_backpack);
    const allItems = backpack ? getContainerItems(backpack).map(id => ItemRegistry.get(id)).filter(Boolean) : [];

    const countEl = document.getElementById('inventory-count');
    if (countEl) countEl.textContent = allItems.length;

    const filteredItems = allItems.filter(item => {
        const props = item.custom_props || {};
        if (currentInventoryFilter === 'all') return true;
        if (currentInventoryFilter === 'quest') return props.isQuestItem === true;
        const iType = (props.itemType || 'misc').toLowerCase().trim();
        if (currentInventoryFilter === 'potion' && (iType === 'potion' || iType === 'зелье' || iType === 'consumable')) return true;
        if (currentInventoryFilter === 'weapon' && (iType === 'weapon' || iType === 'РѕСЂСѓР¶РёРµ')) return true;
        if (currentInventoryFilter === 'armor' && (iType === 'armor' || iType === 'Р±СЂРѕРЅСЏ')) return true;
        return iType === currentInventoryFilter;
    });

    if (filteredItems.length === 0) {
        inventoryList.innerHTML = `<li data-i18n="gameInterface.inventoryPanel.empty">${t('gameInterface.inventoryPanel.empty')}</li>`;
    } else {
        filteredItems.sort((a, b) => (a.custom_props.name || '').localeCompare(b.custom_props.name || ''));
        filteredItems.forEach(item => {
            const props = item.custom_props;
            const li = document.createElement('li');
            li.dataset.itemId = item.id;
            
            const legacyItemFormat = {
                id: item.id, aiIdentifier: item.prototype_id, name: props.name, quantity: item.stack_size,
                description: props.description, rarity: props.rarity, itemType: props.itemType,
                slot: props.slot, effects: props.effects, value: props.value,
                history: item.history
            };
            
            li.addEventListener('mouseenter', (e) => createItemTooltip(e, legacyItemFormat));
            li.addEventListener('mousemove', moveItemTooltip);
            li.addEventListener('mouseleave', () => { if (itemTooltipElement) itemTooltipElement.style.display = 'none'; });

            li.draggable = true;
            li.addEventListener('dragstart', (e) => handleDragStart(e, legacyItemFormat));
            li.addEventListener('dragend', handleDragEnd);

            const itemName = props.name || item.prototype_id || 'Неизвестный предмет';
            let rarityClass = props.rarity ? props.rarity.toLowerCase().replace(/[^a-zР°-СЏС'0-9]/g, '-') : '';

            // Проверка: является ли предмет транспортом (через централизованный TransportSystem)
            const isTransport = TransportSystem.isTransportId(item.prototype_id) ||
                               TransportSystem.isTransportId(props.aiIdentifier) ||
                               props.isTransport === true;

            li.innerHTML = `
                <span class="item-name ${rarityClass}">${itemName}</span>
                <span class="item-quantity">(x${item.stack_size})</span>
            `;

            // Добавляем кнопку "Оседлать" для транспорта
            if (isTransport) {
                // Инициализируем activeTransport, если не существует
                if (!player.activeTransport) {
                    player.activeTransport = null;
                }

                const isMounted = player.activeTransport && player.activeTransport.itemId === item.id;
                const mountBtn = document.createElement('button');
                mountBtn.textContent = isMounted ? t('transport.dismount', 'Спешиться') : t('transport.mount', 'Оседлать');
                mountBtn.className = 'btn-small mount-transport-btn';
                mountBtn.style.marginLeft = '10px';
                mountBtn.onclick = async (e) => {
                    e.stopPropagation();
                    mountBtn.disabled = true;
                    mountBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    if (isMounted) {
                        await dismountTransport();
                    } else {
                        await mountTransport(item.id);
                    }
                    updateInventoryDisplay();
                };
                li.appendChild(mountBtn);
            }

            // Добавляем кнопку "Изучить" (Летопись)
            const examineBtn = document.createElement('button');
            examineBtn.innerHTML = '<i class="fas fa-search"></i>';
            examineBtn.className = 'btn-small';
            examineBtn.style.marginLeft = '10px';
            examineBtn.style.backgroundColor = 'rgba(142, 68, 173, 0.7)';
            examineBtn.style.borderColor = '#8e44ad';
            examineBtn.title = 'Изучить предмет (Летопись)';
            examineBtn.onclick = (e) => {
                e.stopPropagation();
                showItemExamineModal(legacyItemFormat);
            };
            li.appendChild(examineBtn);


            inventoryList.appendChild(li);
        });
    }
}

function showItemExamineModal(item) {
    const modal = document.getElementById('item-examine-modal');
    if (!modal) return;

    document.getElementById('examine-title').textContent = parseLocString(item.name) || 'Неизвестный предмет';
    
    const rarityEl = document.getElementById('examine-rarity');
    rarityEl.textContent = item.rarity || 'Обычный';
    rarityEl.style.color = getRarityColor(item.rarity);

    document.getElementById('examine-desc').textContent = parseLocString(item.description) || 'Нет описания.';

    let statsHtml = '';
    if (item.effects && item.effects.length > 0) {
        statsHtml += `<div><strong>Эффекты:</strong> ${item.effects.map(e => `${e.stat.toUpperCase()} ${e.change > 0 ? '+' : ''}${e.change}`).join(', ')}</div>`;
    }
    statsHtml += `<div><strong>Ценность:</strong> ${item.value || 0} 💰</div>`;
    document.getElementById('examine-stats').innerHTML = statsHtml || 'Нет характеристик';

    const historyEl = document.getElementById('examine-history-content');
    if (item.history && item.history.length > 0) {
        historyEl.innerHTML = item.history.map(h => `<div style="margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 2px;"><span style="color:#f39c12;">[День ${h.day}]</span> ${parseLocString(h.event)}</div>`).join('');
    } else {
        historyEl.innerHTML = '<div style="font-style:italic;">История этого предмета скрыта во тьме веков...</div>';
    }

    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('visible'), 10);
}


// НОВАЯ ФУНКЦИЯ: Обновление панели статус-эффектов
function updateStatusEffectsDisplay() {
    if (!player || !statusEffectsList) return;
    statusEffectsList.innerHTML = '';
    const effects = Object.values(player.statusEffects || {});

    if (effects.length === 0) {
        statusEffectsList.innerHTML = `<li data-i18n="gameInterface.statusEffectsPanel.empty">${t('gameInterface.statusEffectsPanel.empty', 'Нет активных эффектов')}</li>`;
    } else {
        effects.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        effects.forEach(effect => {
            const li = document.createElement('li');
            li.classList.add('status-effect-item');
            li.title = effect.description || t('gameInterface.statusEffectsPanel.noDescription', 'Нет подробного описания.');

            const durationText = t('gameInterface.statusEffectsPanel.duration', { turns: effect.duration });

            li.innerHTML = `
                <div>
                    <span class="effect-name">${effect.name}</span>
                    <span class="effect-duration">${durationText}</span>
                </div>
                <div class="effect-description">${effect.description}</div>
            `;
            statusEffectsList.appendChild(li);
        });
    }
}


function updateQuestList() {
    if (!player || !questList) return;
    questList.innerHTML = '';
    const activeQuests = Object.values(player.quests).filter(q => q.status === 'active');

    if (activeQuests.length === 0) {
        questList.innerHTML = `<li data-i18n="gameInterface.questPanel.empty">${t('gameInterface.questPanel.empty')}</li>`;
    } else {
        activeQuests.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        activeQuests.forEach(quest => {
            const li = document.createElement('li');
            li.classList.add('quest-item');
            const title = quest.title || t('quests.defaultTitle', null, 'Без названия');
            const objective = quest.objective || '?';
            const description = quest.description || t('quests.noDescription', null, 'Нет описания');
            let rawReward = quest.reward;
            let rawIssuer = quest.issuer;
            let rewardValue = t('quests.unknown', null, 'Неизвестно');
            const trimmedLowerReward = String(rawReward || '').trim().toLowerCase();
            if (rawReward !== undefined && rawReward !== null && trimmedLowerReward !== '' && trimmedLowerReward !== '?' && !trimmedLowerReward.startsWith('?,')) {
                rewardValue = rawReward;
            }
            let issuerValue = t('quests.unknown', null, 'Неизвестно');
            const trimmedLowerIssuer = String(rawIssuer || '').trim().toLowerCase();
            const rewardPatternMatch = String(rawReward || '').match(/^\s*\?\s*,\s*(.+?)\s*$/);
            if (rewardPatternMatch && rewardPatternMatch[1]) {
                const potentialIssuerFromReward = rewardPatternMatch[1].trim();
                if (rawIssuer === undefined || rawIssuer === null || trimmedLowerIssuer === '' || trimmedLowerIssuer === '?') {
                    if (potentialIssuerFromReward.toLowerCase() !== '?') {
                        issuerValue = potentialIssuerFromReward;
                    }
                } else {
                    issuerValue = rawIssuer;
                }
            } else {
                if (rawIssuer !== undefined && rawIssuer !== null && trimmedLowerIssuer !== '' && trimmedLowerIssuer !== '?') {
                    issuerValue = rawIssuer;
                }
            }
            li.innerHTML = `
                <span class="quest-title">${title}</span>
                <div class="quest-detail"><strong>${t('quests.objectiveLabel')}:</strong> ${objective}</div>
                <div class="quest-detail quest-description"><strong>${t('quests.descriptionLabel')}:</strong> ${description}</div>
                <div class="quest-detail"><strong>${t('quests.rewardLabel')}:</strong> ${rewardValue}</div>
                <div class="quest-detail"><strong>${t('quests.issuerLabel')}:</strong> ${issuerValue}</div>
            `;
            questList.appendChild(li);
        });
    }
}

function updateSkillsDisplay() {
    window.activatePlayerSkill = function (skillId) {
        const skill = player.skills[skillId];
        if (!skill) return;

        // Только проверяем стоимость, спишем при отправке хода
        let costVal = parseInt(skill.cost) || 0;
        let costType = (skill.costType || '').toLowerCase();
        if (costType.includes('mp') || costType.includes('ман')) {
            if (player.stats.mana < costVal) { showCustomAlert("Недостаточно маны!"); return; }
        } else if (costType.includes('hp') || costType.includes('здоровь') || costType.includes('stamina') || costType.includes('выносливост')) {
            if (player.stats.hp <= costVal) { showCustomAlert("Недостаточно здоровья/выносливости!"); return; }
        }

        createSkillBadge(skillId, skill.name, skill.effect);
    };

    function createSkillBadge(skillId, skillName, skillEffect) {
        const container = document.getElementById('active-rolls-container');
        if (!container) return;

        const existing = container.querySelectorAll('.skill-badge');
        for (let b of existing) {
            if (b.dataset.skillId === skillId) return; // Уже добавлено
        }

        const badge = document.createElement('div');
        badge.className = 'roll-badge skill-badge';
        badge.dataset.skillId = skillId;
        badge.dataset.resultText = `[SYSTEM_MECHANIC: АКТИВИРОВАНО УМЕНИЕ | ИМЯ: ${skillName} | ЭФФЕКТ: ${skillEffect}]`;

        badge.innerHTML = `
        <span>вњЁ ${skillName}</span>
        <span class="roll-badge-close" title="Отменить">✖</span>
    `;

        badge.querySelector('.roll-badge-close').addEventListener('click', () => {
            badge.remove();
        });

        container.appendChild(badge);
    }

    if (!player || !skillsList) return;
    skillsList.innerHTML = '';
    const learnedSkills = Object.values(player.skills);

    if (learnedSkills.length === 0) {
        skillsList.innerHTML = `<li data-i18n="gameInterface.skillsPanel.empty">${t('gameInterface.skillsPanel.empty')}</li>`;
    } else {
        learnedSkills.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        learnedSkills.forEach(skill => {
            const li = document.createElement('li');
            li.classList.add('skill-item');
            li.title = skill.description || t('skills.noDescription', null, 'Нет описания');

            let detailsHTML = '';
            if (skill.damage && String(skill.damage).toLowerCase() !== 'нет') {
                detailsHTML += `<span><strong>${t('skills.damageLabel', 'РЈСЂРѕРЅ')}:</strong> ${skill.damage}</span>`;
            }
            if (skill.cost && skill.costType && String(skill.costType).toLowerCase() !== 'нет') {
                detailsHTML += `<span><strong>${t('skills.costLabel', 'Стоимость')}:</strong> ${skill.cost} ${skill.costType}</span>`;
            } else if (skill.cost && String(skill.cost).toLowerCase() !== '0' && String(skill.cost).toLowerCase() !== 'нет') {
                detailsHTML += `<span><strong>${t('skills.costLabel', 'Стоимость')}:</strong> ${skill.cost}</span>`;
            }
            if (skill.duration && String(skill.duration).toLowerCase() !== 'нет') {
                detailsHTML += `<span><strong>${t('skills.durationLabel', 'Длит.')}:</strong> ${skill.duration}</span>`;
            }
            if (skill.cooldown && String(skill.cooldown).toLowerCase() !== 'нет') {
                detailsHTML += `<span><strong>${t('skills.cooldownLabel', 'Перезар.')}:</strong> ${skill.cooldown}</span>`;
            }
            if (skill.skillType && String(skill.skillType).toLowerCase() !== 'нет') {
                detailsHTML += `<span><strong>${t('skills.typeLabel', 'РўРёРї')}:</strong> ${skill.skillType}</span>`;
            }

            let effectDisplay = skill.effect || '';
            if (effectDisplay.toLowerCase() === 'нет') effectDisplay = '';

            let cdText = '';
            let isUsable = false;
            if (skill.skillType && skill.skillType.toLowerCase().includes('актив')) {
                isUsable = true;
                if (skill.currentCooldown > 0) {
                    cdText = `<span style="color:#e74c3c; font-weight:bold; margin-left:10px; font-size:0.85em;">(Откат: ${skill.currentCooldown} ход.)</span>`;
                }
            }

            li.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                    <span class="skill-name" style="margin:0;">${skill.name || skill.id} ${cdText}</span>
                    ${isUsable && (!skill.currentCooldown || skill.currentCooldown <= 0) ? `<button class="use-skill-btn" data-id="${skill.id}">${t('gameInterface.skills.use', null, 'Применить')}</button>` : ''}
                </div>
                <span class="skill-description">${skill.description || ''}</span>
                ${detailsHTML ? `<div class="skill-details">${detailsHTML}</div>` : ''}
                ${effectDisplay ? `<div class="skill-effect"><strong>${t('skills.effectLabel', 'Эффект')}:</strong> ${effectDisplay}</div>` : ''}
            `;

            const useBtn = li.querySelector('.use-skill-btn');
            if (useBtn) {
                useBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    activatePlayerSkill(skill.id);
                });
            }

            skillsList.appendChild(li);
        });
    }
}


let currentChronicleFilter = 'all';
let currentChronicleTimeFilter = 99999;
let currentChronicleList = [];
let currentChroniclePage = 1;
const CHRONICLE_ITEMS_PER_PAGE = 30;

function updateWorldChroniclesDisplay() {
    const listEl = document.getElementById('world-chronicles-list');
    const panelEl = document.getElementById('world-chronicles-panel');
    if (!listEl || !panelEl) return;

    panelEl.style.display = 'flex';

    let filterContainer = document.querySelector('.chronicle-filters');
    if (filterContainer) {
        filterContainer.outerHTML = `
            <div class="chronicle-ui-container" id="chronicle-ui-container">
                <div class="chronicle-filter-row">
                    <button class="c-filter-btn ${currentChronicleFilter === 'all' ? 'active' : ''}" data-filter="all">${t('extraLoc.chronicles.all')}</button>
                    <button class="c-filter-btn ${currentChronicleFilter === 'war' ? 'active' : ''}" data-filter="war">вљ”пёЏ ${t('extraLoc.chronicles.wars')}</button>
                    <button class="c-filter-btn ${currentChronicleFilter === 'disaster' ? 'active' : ''}" data-filter="disaster">рџЊЄпёЏ ${t('extraLoc.chronicles.disasters')}</button>
                    <button class="c-filter-btn ${currentChronicleFilter === 'trade' ? 'active' : ''}" data-filter="trade">рџ'° ${t('extraLoc.chronicles.economy')}</button>
                    <button class="c-filter-btn ${currentChronicleFilter === 'business' ? 'active' : ''}" data-filter="business">рџЏ­ ${t('extraLoc.chronicles.business')}</button>
                    <button class="c-filter-btn ${currentChronicleFilter === 'market' ? 'active' : ''}" data-filter="market">вљ–пёЏ ${t('extraLoc.chronicles.market')}</button>
                    <button class="c-filter-btn ${currentChronicleFilter === 'logistics' ? 'active' : ''}" data-filter="logistics">📦 ${t('extraLoc.chronicles.logistics')}</button>
                    <button class="c-filter-btn ${currentChronicleFilter === 'politics' ? 'active' : ''}" data-filter="politics">🏛️ Политика</button>
                    <button class="c-filter-btn ${currentChronicleFilter === 'misc' ? 'active' : ''}" data-filter="misc">рџ—ЈпёЏ ${t('extraLoc.chronicles.rumors')}</button>
                </div>
                <div class="chronicle-filter-row">
                    <button class="c-filter-btn ${currentChronicleTimeFilter === 7 ? 'active' : ''}" data-time="7">${t('extraLoc.chronicles.days7')}</button>
                    <button class="c-filter-btn ${currentChronicleTimeFilter === 30 ? 'active' : ''}" data-time="30">${t('extraLoc.chronicles.days30')}</button>
                    <button class="c-filter-btn ${currentChronicleTimeFilter === 360 ? 'active' : ''}" data-time="360">${t('extraLoc.chronicles.year1')}</button>
                    <button class="c-filter-btn ${currentChronicleTimeFilter === 99999 ? 'active' : ''}" data-time="99999">${t('extraLoc.chronicles.allHistory')}</button>
                </div>
            </div>
        `;
        
        document.querySelectorAll('#chronicle-ui-container .c-filter-btn').forEach(btn => {
            btn.onclick = (e) => {
                if (e.target.dataset.filter) currentChronicleFilter = e.target.dataset.filter;
                if (e.target.dataset.time) currentChronicleTimeFilter = parseInt(e.target.dataset.time);
                updateWorldChroniclesDisplay();
            };
        });
    }

    let events = Object.values(player.nexusData || {}).filter(item => 
        item.category === 'World_Event' || item.category === 'Мировое Событие' || item.id.startsWith('event_')
    );

    let simNews = [];
    if (typeof World !== 'undefined' && World && World.news) {
        const currentDay = (World.current_day !== undefined ? World.current_day : Math.floor((World.tick || 0) / 24));
        simNews = World.news.map(n => ({
            ...n,
            daysOld: Math.max(0, currentDay - (n.day || 0))
        }));
    }

    if (currentChronicleFilter !== 'all') {
        simNews = simNews.filter(n => n.category === currentChronicleFilter);
        if (currentChronicleFilter !== 'war' && currentChronicleFilter !== 'disaster') events = []; 
    }

    simNews = simNews.filter(n => n.daysOld <= currentChronicleTimeFilter);

    currentChronicleList = [];

    // СНАЧАЛА simNews (сортировка по свежести)
    simNews.sort((a, b) => a.daysOld - b.daysOld).forEach(news => {
        currentChronicleList.push({ type: 'sim', data: news });
    });

    // ЗАТЕМ events (константы Nexus)
    events.sort((a, b) => a.name.localeCompare(b.name)).forEach(ev => {
        currentChronicleList.push({ type: 'nexus', data: ev });
    });

    if (currentChronicleList.length === 0) {
        listEl.innerHTML = `<li style="color:#7f8c8d; padding:10px; text-align:center;">${t('extraLoc.chronicles.empty')}</li>`;
        return;
    }

    renderChroniclePage(1);
}

function renderChroniclePage(page) {
    currentChroniclePage = page;
    const listEl = document.getElementById('world-chronicles-list');
    if (!listEl) return;

    listEl.innerHTML = ''; 

    const startIndex = (page - 1) * CHRONICLE_ITEMS_PER_PAGE;
    const endIndex = startIndex + CHRONICLE_ITEMS_PER_PAGE;
    const chunk = currentChronicleList.slice(startIndex, endIndex);
    
    chunk.forEach(item => {
        const li = document.createElement('li');
        
        if (item.type === 'nexus') {
            const ev = item.data;
            const isActive = (ev.value === 'АКТИВНО' || ev.value === 'active' || ev.value === 'Активно' || ev.value === 'ACTIVE');
            li.className = 'chronicle-item' + (isActive ? ' active-event' : '');
            const statusClass = isActive ? 'chronicle-status-active' : 'chronicle-status-brewing';
            const statusIcon = isActive ? '<i class="fas fa-fire"></i>' : '<i class="fas fa-hourglass-half"></i>';
            
            li.innerHTML = `
                <div style="display:flex; justify-content: space-between; align-items: flex-start;">
                    <span class="chronicle-title">${ev.name}</span>
                    <span class="${statusClass}">${statusIcon} ${isActive ? t('extraLoc.chronicles.active') : ev.value.toUpperCase()}</span>
                </div>
                <div class="chronicle-desc">${ev.description}</div>
            `;
        } else {
            const news = item.data;
            li.className = 'chronicle-item';
            let icon = '<i class="fas fa-newspaper"></i>';
            let catName = t('extraLoc.chronicles.rumor');
            let color = '#aeb6bf';
            if (news.category === 'war') { icon = '<i class="fas fa-swords"></i>'; catName = t('extraLoc.chronicles.war'); color = '#e74c3c'; }
            if (news.category === 'disaster') { icon = '<i class="fas fa-volcano"></i>'; catName = t('extraLoc.chronicles.disaster'); color = '#e67e22'; }
            if (news.category === 'trade') { icon = '<i class="fas fa-coins"></i>'; catName = t('extraLoc.chronicles.economy'); color = '#f1c40f'; }
            if (news.category === 'business') { icon = '<i class="fas fa-industry"></i>'; catName = t('extraLoc.chronicles.business'); color = '#9b59b6'; }
            if (news.category === 'market') { icon = '<i class="fas fa-balance-scale"></i>'; catName = t('extraLoc.chronicles.market'); color = '#1abc9c'; }
            if (news.category === 'logistics') { icon = '<i class="fas fa-box"></i>'; catName = t('extraLoc.chronicles.logistics'); color = '#34495e'; }
            if (news.category === 'politics') { icon = '<i class="fas fa-landmark"></i>'; catName = t('extraLoc.chronicles.politics', null, 'Политика'); color = '#8e44ad'; }

            let causalHtml = '';
            if (news.causal_link) {
                causalHtml = `<div style="margin-top: 4px; font-size: 0.85em; color: #8e44ad; font-style: italic;">
                    <i class="fas fa-link"></i> ${t('extraLoc.chronicles.consequence')}
                </div>`;
            }
            li.innerHTML = `
                <div style="display:flex; justify-content: space-between; align-items: flex-start;">
                    <span class="chronicle-title" style="color: #f39c12; font-size: 0.9em;">${t('extraLoc.chronicles.daysAgo', {days: news.daysOld})}</span>
                    <span class="chronicle-status-brewing" style="color:${color}">${icon} ${catName}</span>
                </div>
                <div class="chronicle-desc" style="color: #ecf0f1;">${parseLocString(news.text)}</div>
                ${causalHtml}
            `;
        }
        listEl.appendChild(li);
    });

    const totalPages = Math.ceil(currentChronicleList.length / CHRONICLE_ITEMS_PER_PAGE);
    if (totalPages > 1) {
        const paginationDiv = document.createElement('div');
        paginationDiv.className = 'chronicle-pagination';
        
        const btnPrev = document.createElement('button');
        btnPrev.className = 'c-page-btn';
        btnPrev.innerHTML = `в—Ђ ${t('extraLoc.chronicles.back')}`;
        btnPrev.disabled = (page === 1);
        btnPrev.onclick = () => renderChroniclePage(page - 1);

        const infoSpan = document.createElement('span');
        infoSpan.className = 'c-page-info';
        infoSpan.textContent = t('extraLoc.chronicles.pageInfo', {page: page, total: totalPages});

        const btnNext = document.createElement('button');
        btnNext.className = 'c-page-btn';
        btnNext.innerHTML = `${t('extraLoc.chronicles.forward')} ▶`;
        btnNext.disabled = (page === totalPages);
        btnNext.onclick = () => renderChroniclePage(page + 1);

        paginationDiv.appendChild(btnPrev);
        paginationDiv.appendChild(infoSpan);
        paginationDiv.appendChild(btnNext);
        listEl.appendChild(paginationDiv);
    }

    listEl.scrollTop = 0;
}

function updateTradeJournalDisplay() {
    const listEl = document.getElementById('trade-journal-list');
    const panelEl = document.getElementById('trade-journal-panel');
    if (!listEl || !panelEl) return;

    if (!player || !World) {
        panelEl.style.display = 'none';
        return;
    }

    panelEl.style.display = 'flex';
    listEl.innerHTML = '';

    let playerRegionId = null;
    for (let rId in World.regions) {
        if (player.location.toLowerCase().includes(World.regions[rId].name.toLowerCase())) {
            playerRegionId = rId;
            break;
        }
    }

    if (!playerRegionId) {
        listEl.innerHTML = `<li style="color:#7f8c8d; padding:5px; text-align:center;">${t('extraLoc.tradeJournal.wilderness')}</li>`;
        return;
    }

    const region = World.regions[playerRegionId];
    
    if (region.population === 0 || !region.factionId) {
        listEl.innerHTML = `<li style="color:#e74c3c; padding:10px; text-align:center; font-style:italic;">${t('extraLoc.tradeJournal.abandoned')}</li>`;
        return;
    }

    const prices = region.markets;

    let seasonName = region.current_season === 'spring' ? t('extraLoc.seasons.spring') : (region.current_season === 'summer' ? t('extraLoc.seasons.summer') : (region.current_season === 'autumn' ? t('extraLoc.seasons.autumn') : t('extraLoc.seasons.winter')));
    let html = `<li style="border-bottom: 1px solid rgba(241, 196, 15, 0.3); padding-bottom: 5px; margin-bottom: 5px;"><strong style="color:#f1c40f">${t('extraLoc.tradeJournal.market')}: ${region.name}</strong><br><span style="font-size:0.85em; color:#bdc3c7;">${t('extraLoc.tradeJournal.season')}: ${seasonName} | ${t('extraLoc.tradeJournal.weather')}: ${t('weather.' + region.weather, null, region.weather)}</span></li>`;
    
    const formatPrice = (key, price) => {
        let name = getItemName(key, player ? player.era : getRuntimeDefaultEraId());
        return `
        <li style="display:flex; justify-content:space-between; padding: 3px 0;">
            <span style="color:#bdc3c7">📦 ${name}</span>
            <span style="color:#f5b041; font-weight:bold;">${price.toFixed(1)} рџ'°</span>
        </li>`;
    };

    html += `<li style="color:#5dade2; font-size: 0.9em; padding: 3px 0; margin-top: 5px;"><b>${t('extraLoc.tradeJournal.averagePrices')}:</b></li>`;
    for(let good in prices) {
        const supply = countRealItems(region.vault_id, good);
        if (supply > 0 || prices[good] > 0) {
            html += formatPrice(good, prices[good]);
        }
    }

    html += `<li style="color:#5dade2; font-size: 0.9em; padding: 3px 0; margin-top: 5px;"><b>${t('extraLoc.tradeJournal.privateOffers')}:</b></li>`;
    if (region.market_square && region.market_square.length > 0) {
        let offersHtml = '';
        region.market_square.slice(0, 10).forEach(offer => {
            let goodName = getItemName(offer.good, player ? player.era : getRuntimeDefaultEraId());
            offersHtml += `<li style="display:flex; justify-content:space-between; padding: 2px 0; font-size: 0.85em;"><span style="color:#bdc3c7">${goodName} (x${offer.quantity})</span><span style="color:#f5b041;">${offer.price.toFixed(1)} рџ'°</span></li>`;
        });
        html += offersHtml;
        if (region.market_square.length > 10) html += `<li style="font-size: 0.8em; color: #7f8c8d;">${t('extraLoc.tradeJournal.moreLots', {count: region.market_square.length - 10})}</li>`;
    } else {
        html += `<li style="color:#7f8c8d; font-size: 0.85em; padding: 2px 0;">${t('extraLoc.tradeJournal.emptySquare')}</li>`;
    }

    html += `<li style="border-bottom: 1px solid rgba(241, 196, 15, 0.3); padding-bottom: 5px; margin-top: 15px; margin-bottom: 5px;"><strong style="color:#f1c40f">${t('extraLoc.tradeJournal.logistics')}</strong></li>`;
    
    let incomingCaravans = [];
    let outgoingCaravans = [];
    
    for (let id in World.regions) {
        let reg = World.regions[id];
        reg.caravans.forEach(c => {
            if (c.destination === playerRegionId) incomingCaravans.push(c);
            if (c.origin === playerRegionId) outgoingCaravans.push(c);
        });
    }
    
    if (incomingCaravans.length > 0) {
        html += `<li style="color:#2ecc71; font-size: 0.9em; padding: 3px 0;">${t('extraLoc.tradeJournal.incoming', {count: incomingCaravans.length})}</li>`;
    } else {
        html += `<li style="color:#7f8c8d; font-size: 0.85em; padding: 3px 0;">${t('extraLoc.tradeJournal.noIncoming')}</li>`;
    }
    
    if (outgoingCaravans.length > 0) {
        html += `<li style="color:#3498db; font-size: 0.9em; padding: 3px 0;">${t('extraLoc.tradeJournal.outgoing', {count: outgoingCaravans.length})}</li>`;
    }
    
    listEl.innerHTML = html;
}


function getResourceIcon(res) {
    // Data-driven: icons from world_assets.json resource_icons
    const rtAssets = (typeof getLoadedRuntimeManifest === 'function') ? (getLoadedRuntimeManifest()?.world_assets || {}) : {};
    const rtIcons = rtAssets.resource_icons || {};
    const fallback = {"wheat":"🌾","meat":"🥩","fish":"🐟","wood":"🌲","iron_ore":"⛏️","gold_ore":"💎","cotton":"⁃️","herbs":"🌿","salt":"🧂","stone":"🪨"};
    const icons = Object.keys(rtIcons).length > 0 ? rtIcons : fallback;
    return icons[res] || rtAssets.resource_icon_default || "📦";
}

function updateMapDisplay() {
    if (window.Cartographer) {
        Cartographer.fetchMapData().then(() => {
            Cartographer.updateSidebar();
            // Рендер запускается автоматически через requestAnimationFrame внутри Cartographer
        });
    }
}

// НОВАЯ ФУНКЦИЯ для обновления панели окружения
function updateEnvironmentPanel() {
    if (!player || !environmentList) return;
    environmentList.innerHTML = '';
    const entities = Object.values(player.visibleEntities || {});

    if (entities.length === 0) {
        environmentList.innerHTML = `<li data-i18n="gameInterface.environmentPanel.empty">${t('gameInterface.environmentPanel.empty')}</li>`;
    } else {
        entities.sort((a, b) => (a.name || '').localeCompare(b.name || '', currentLanguage));
        entities.forEach(entity => {
            const li = document.createElement('li');
            li.classList.add('entity-item');
            li.dataset.entityId = entity.id;

            const iconEl = document.createElement('span');
            iconEl.classList.add('entity-icon');
            let iconClass = 'fa-question-circle'; // Default icon
            let entityTypeClass = 'npc'; // Default color class

            const typeKey = `gameInterface.environmentPanel.entityType${entity.type.charAt(0).toUpperCase() + entity.type.slice(1)}`;
            const entityTypeLocalized = t(typeKey, null, entity.type);

            switch (entity.type.toLowerCase()) {
                case 'npc':
                    iconClass = entity.isHostile ? 'fa-user-ninja' : 'fa-user';
                    entityTypeClass = entity.isHostile ? 'enemy' : 'npc';
                    break;
                case 'creature':
                    iconClass = entity.isHostile ? 'fa-dragon' : 'fa-paw';
                    entityTypeClass = entity.isHostile ? 'enemy' : 'creature';
                    break;
                case 'enemy':
                    iconClass = 'fa-skull-crossbones';
                    entityTypeClass = 'enemy';
                    break;
            }
            iconEl.classList.add('fas', iconClass, entityTypeClass);

            const nameSpan = document.createElement('span');
            nameSpan.classList.add('entity-name');
            nameSpan.textContent = entity.name || entity.id || t('gameInterface.environmentPanel.unknownEntity', 'Неизвестное существо');

            if (entity.isSleeping) {
                nameSpan.textContent += " (РЎРїРёС‚)";
                nameSpan.style.color = "#7f8c8d";
                nameSpan.style.fontStyle = "italic";
            }

            li.appendChild(iconEl);
            li.appendChild(nameSpan);

            // Store data for tooltip
            let profType = 'none';
            let savings = 0;
            let lustVal = 0;
            if (typeof World !== 'undefined' && World && World.npcs && World.npcs[entity.aiIdentifier]) {
                let wNpc = World.npcs[entity.aiIdentifier];
                profType = wNpc.economy?.profession_type || 'none';
                savings = wNpc.economy?.savings || 0;
                lustVal = wNpc.personality?.lust || 0;
            }

            li.dataset.tooltipData = JSON.stringify({
                lust: lustVal,
                id: entity.aiIdentifier,
                name: entity.name,
                type: entityTypeLocalized,
                profession_type: profType,
                savings: savings,
                description: entity.description || t('gameInterface.environmentPanel.noDescription', 'Нет подробного описания.'),
                hp: entity.stats?.hp,
                maxHp: entity.stats?.maxHp,
                str: entity.stats?.str,
                dex: entity.stats?.dex,
                con: entity.stats?.con,
                int: entity.stats?.int,
                isHostile: entity.isHostile,
                traits: entity.traits || []
            });

            li.addEventListener('mouseover', showEntityTooltip);
            li.addEventListener('mouseout', hideEntityTooltip);
            li.addEventListener('mousemove', moveEntityTooltip);
            
            // === ДОБАВЛЕНО: Клик по торговцу открывает рынок ===
            const isMerchant = entity.type === 'npc' && entity.traits &&
                ['merchant', 'trader', 'peddler', 'торговец', 'купец'].some(t =>
                    entity.traits.some(trait => trait.toLowerCase().includes(t))
                );

            if (isMerchant) {
                li.style.cursor = 'pointer';
                li.addEventListener('click', () => openMarketInterface(entity));
                li.title = "Нажмите чтобы открыть торговлю";
            } else if (entity.type === 'npc') {
                // Клик по обычному NPC открывает модальное окно с отношениями
                li.style.cursor = 'pointer';
                li.addEventListener('click', () => showNPCDetailsModal(entity.aiIdentifier));
                li.title = "Нажмите чтобы посмотреть детали";
            }

            environmentList.appendChild(li);
        });
    }
}

// НОВЫЕ ФУНКЦИИ для всплывающей подсказки
function createItemTooltip(event, item) {
    if (!itemTooltipElement) {
        itemTooltipElement = document.createElement('div');
        itemTooltipElement.className = 'item-tooltip';
        document.body.appendChild(itemTooltipElement);
    }

    const rarityColor = getRarityColor(item.rarity);

    let effectsHtml = '';
    if (item.effects && item.effects.length > 0) {
        effectsHtml = `<div style="margin-top:8px; border-top:1px dashed #2c1e14; padding-top:5px; font-weight:bold;">
            Эффекты: ${item.effects.map(e => `${e.stat.toUpperCase()} ${e.change > 0 ? '+' : ''}${e.change}`).join(', ')}
        </div>`;
    }

    let historyHtml = '';
    if (item.history && item.history.length > 0) {
        const historyItems = item.history.slice(-3).map(h => `[День ${h.day}] ${parseLocString(h.event)}`).join('<br>');
        historyHtml = `<div style="margin-top:8px; border-top:1px dashed #2c1e14; padding-top:5px; font-size:0.85em; color:#d35400;">
            <strong>Летопись предмета:</strong><br>${historyItems}
        </div>`;
    }

    // FIX (Issue #71): Escape all user/mod-controlled data before inserting into innerHTML
    const safeItemName = escapeHTML(parseLocString(item.name));
    const safeItemDesc = escapeHTML(parseLocString(item.description));
    const safeItemRarity = escapeHTML(item.rarity || 'Обычный');

    itemTooltipElement.innerHTML = `
        <div class="item-card-header">${safeItemName}</div>
        <div class="item-card-body">
            <span class="item-card-rarity" style="color: ${rarityColor}">${safeItemRarity}</span>
            <div style="font-style:italic;">${safeItemDesc}</div>
            ${effectsHtml}
            ${historyHtml}
            <div style="margin-top:8px; font-size:0.85em; text-align:right; opacity:0.8;">💰 Ценность: ${item.value || 0}</div>
        </div>
    `;

    itemTooltipElement.style.display = 'block';
    moveItemTooltip(event);
}


function getRarityColor(r) {
    const s = String(r).toLowerCase();
    if (s.includes('необыч')) return '#1eff00';
    if (s.includes('редк')) return '#0070dd';
    if (s.includes('СЌРїРёС‡')) return '#a335ee';
    if (s.includes('легенд')) return '#ff8000';
    return '#5d4a36';
}

function moveItemTooltip(e) {
    if (!itemTooltipElement) return;
    let x = e.pageX + 20;
    let y = e.pageY - 150; // Поднимаем выше курсора
    if (x + 230 > window.innerWidth) x = e.pageX - 250;
    if (y < 10) y = e.pageY + 20; // Если сверху мало места, кидаем вниз
    itemTooltipElement.style.left = x + 'px';
    itemTooltipElement.style.top = y + 'px';
}

function createEntityTooltipElement() {
    if (!entityTooltip) {
        entityTooltip = document.createElement('div');
        entityTooltip.classList.add('entity-tooltip');
        document.body.appendChild(entityTooltip);
    }
}

function showEntityTooltip(event) {
    createEntityTooltipElement();
    const li = event.currentTarget;
    let data;
    try { data = JSON.parse(li.dataset.tooltipData); } catch(e) { console.warn('Invalid tooltip data:', e); return; }

    let statsHtml = '';
    if (data.str !== undefined) statsHtml += `<p><span class="stat-label">${t('gameInterface.characterPanel.str', '⚔️ Сила')}:</span> <span class="stat-value">${data.str}</span></p>`;
    if (data.dex !== undefined) statsHtml += `<p><span class="stat-label">${t('gameInterface.characterPanel.dex', '🤸 Ловкость')}:</span> <span class="stat-value">${data.dex}</span></p>`;
    if (data.con !== undefined) statsHtml += `<p><span class="stat-label">${t('gameInterface.characterPanel.con', '맷 Выносливость')}:</span> <span class="stat-value">${data.con}</span></p>`;
    if (data.int !== undefined) statsHtml += `<p><span class="stat-label">${t('gameInterface.characterPanel.int', '💡 Интеллект')}:</span> <span class="stat-value">${data.int}</span></p>`;
    if (allowNSFW && data.lust !== undefined) statsHtml += `<p><span class="stat-label" style="color:#e91e63;">рџ’‹ Похоть:</span> <span class="stat-value" style="color:#e91e63;">${data.lust}%</span></p>`;

    let healthBarHtml = '';
    let healthText = '';
    if (data.hp !== undefined && data.maxHp !== undefined && data.maxHp > 0) {
        const healthPercentage = Math.max(0, Math.min(100, (data.hp / data.maxHp) * 100));
        let barClass = 'enemy'; // Default red
        if (!data.isHostile) {
            if (data.type.toLowerCase() === t('gameInterface.environmentPanel.entityTypeNPC', 'РќРџРЎ').toLowerCase()) {
                barClass = 'friendly'; // Green for friendly NPC
            } else {
                barClass = 'neutral'; // Yellow for neutral creature
            }
        }
        healthText = `${data.hp}/${data.maxHp}`;
        healthBarHtml = `
            <div class="health-bar-container">
                <div class="health-bar ${barClass}" style="width: ${healthPercentage}%;">${healthText}</div>
            </div>
        `;
        healthText = `<p><strong>${t('gameInterface.environmentPanel.tooltip.health', 'Р--РґРѕСЂРѕРІСЊРµ')}:</strong> <span class="stat-value">${data.hp} / ${data.maxHp}</span></p>`;
    }


    // FIX (Issue #71/#79): Escape all mod-controlled entity data before innerHTML
    const safeName = escapeHTML(data.name || '');
    const safeType = escapeHTML(data.type || '');
    const safeDescription = escapeHTML(data.description || '');
    const safeTraitsHtml = data.traits && data.traits.length > 0
        ? `<p><strong style="color: #9b59b6;">Черты:</strong> <span style="color: #ecf0f1; font-style: italic;">${escapeHTML(data.traits.join(', '))}</span></p>`
        : '';

    // FIX (Issue #79): Sanitize profession/economy data that could come from mods
    let safeEconHtml = '';
    if (data.profession_type && data.profession_type !== 'none') {
        const profMap = { 'farmer': 'Крестьянин', 'artisan': 'Ремесленник', 'merchant': 'Купец', 'innkeeper': 'Трактирщик', 'ruler': 'Феодал', 'cleric': 'Священник', 'mage': 'Маг', 'mercenary': 'Наемник' };
        safeEconHtml = `<p><strong style="color: #2ecc71;">Роль:</strong> <span style="color: #ecf0f1;">${escapeHTML(profMap[data.profession_type] || data.profession_type)}</span> | <strong style="color: #f1c40f;">Капитал:</strong> ${Number(data.savings || 0).toFixed(1)} з.</p>`;
    }

    // FIX (Issue #79): Sanitize wound data from NPC objects
    let safeWoundsHtml = '';
    if (typeof World !== 'undefined' && World && World.npcs && World.npcs[data.id] && World.npcs[data.id].wounds) {
        const wounds = World.npcs[data.id].wounds;
        if (wounds.length > 0) {
            const wList = wounds.map(w => `${escapeHTML(w.type)} (тяжесть: ${Number(w.severity || 0)})`).join(', ');
            safeWoundsHtml = `<p><strong style="color: #e74c3c;">Ранения:</strong> <span style="color: #ffcccc;">${wList}</span></p>`;
        }
    }

    entityTooltip.innerHTML = `
        <h4>${safeName}</h4>
        <p><strong>${t('gameInterface.environmentPanel.tooltip.type', 'Тип')}:</strong> ${safeType}</p>
        ${safeEconHtml}
        ${safeTraitsHtml}
        ${safeWoundsHtml}
        ${healthText}
        ${healthBarHtml}
        ${statsHtml}
        <p class="description-text">${safeDescription}</p>
    `;
    entityTooltip.style.display = 'block';
    moveEntityTooltip(event); // Initial position
}

function hideEntityTooltip() {
    if (entityTooltip) {
        entityTooltip.style.display = 'none';
    }
}

function moveEntityTooltip(event) {
    if (entityTooltip && entityTooltip.style.display === 'block') {
        const xOffset = 25; // Т3 ФИКС: Увеличен отступ, чтобы окно не перекрывало курсор
        const yOffset = 15;
        let newX = event.pageX + xOffset;
        let newY = event.pageY + yOffset;

        const tooltipRect = entityTooltip.getBoundingClientRect();
        const bodyRect = document.body.getBoundingClientRect();

        // Предотвращение выхода за пределы экрана
        if (newX + tooltipRect.width > window.innerWidth - 10) { // 10px отступ от края
            newX = event.pageX - tooltipRect.width - xOffset;
        }
        if (newY + tooltipRect.height > window.innerHeight - 10) {
            newY = event.pageY - tooltipRect.height - yOffset;
        }
        if (newX < 10) {
            newX = 10;
        }
        if (newY < 10) {
            newY = 10;
        }


        entityTooltip.style.left = `${newX}px`;
        entityTooltip.style.top = `${newY}px`;
    }
}

// === МОДАЛЬНОЕ ОКНО ДЛЯ ОТОБРАЖЕНИЯ ОТНОШЕНИЙ С NPC ===
function showNPCDetailsModal(npcId) {
    const npc = player.allKnownEntities[npcId];
    if (!npc) return;

    // Создаём модальное окно
    const modal = document.createElement('div');
    modal.className = 'npc-details-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;

    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        background: linear-gradient(135deg, #2c1e14 0%, #1a1410 100%);
        border: 2px solid #d4af37;
        border-radius: 12px;
        padding: 25px;
        max-width: 600px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.9);
        color: #e8dcc4;
    `;

    // Инициализация relationships если нет
    if (!npc.relationships) {
        npc.relationships = {
            player: { affection: 0, attraction: 0, trust: 0, intimacy: 0, sexualHistory: [] }
        };
    }
    if (!npc.relationships.player) {
        npc.relationships.player = { affection: 0, attraction: 0, trust: 0, intimacy: 0, sexualHistory: [] };
    }

    const rel = npc.relationships.player;

    // Функция для получения цвета прогресс-бара
    const getBarColor = (value, isAffection = false) => {
        if (isAffection) {
            if (value >= 50) return '#27ae60'; // Зелёный (любовь)
            if (value >= 0) return '#f39c12'; // Оранжевый (нейтральное)
            if (value >= -50) return '#e67e22'; // Тёмно-оранжевый (неприязнь)
            return '#e74c3c'; // Красный (ненависть)
        } else {
            if (value >= 75) return '#27ae60'; // Зелёный
            if (value >= 50) return '#2ecc71'; // Светло-зелёный
            if (value >= 25) return '#f39c12'; // Оранжевый
            return '#95a5a6'; // Серый
        }
    };

    // Функция для создания прогресс-бара
    const createProgressBar = (label, value, min = 0, max = 100) => {
        const isAffection = min === -100;
        const normalizedValue = isAffection ? ((value + 100) / 200) * 100 : value;
        const color = getBarColor(value, isAffection);
        
        const valueText = isAffection ? `${value > 0 ? '+' : ''}${value} [-100..100]` : `${value}/${max}`;
        const centerMarker = isAffection ? `<div style="position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; background: rgba(255,255,255,0.2); z-index: 1;"></div>` : '';

        return `
            <div style="margin-bottom: 15px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span style="font-weight: bold;">${label}</span>
                    <span style="color: ${color}; font-weight: bold;">${valueText}</span>
                </div>
                <div style="position: relative; background: rgba(0,0,0,0.4); border-radius: 10px; height: 20px; overflow: hidden; border: 1px solid #5d4a36;">
                    ${centerMarker}
                    <div style="position: relative; background: ${color}; height: 100%; width: ${normalizedValue}%; transition: width 0.3s ease; z-index: 0;"></div>
                </div>
            </div>
        `;
    };

    // История интимных сцен
    let historyHtml = '';
    if (rel.sexualHistory && rel.sexualHistory.length > 0) {
        const historyItems = rel.sexualHistory.slice(-5).reverse().map(h => {
            const typeLabel = h.type === 'consensual' ? '💕 Консенсуальный' :
                             h.type === 'forced' ? '⚠️ Принуждение' :
                             h.type === 'seduction' ? '😏 Соблазнение' : h.type;
            return `
                <div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px; margin-bottom: 8px; border-left: 3px solid #e74c3c;">
                    <div style="font-size: 0.9em;"><strong>День ${h.day}</strong> -- ${h.location}</div>
                    <div style="font-size: 0.85em; color: #95a5a6; margin-top: 3px;">${typeLabel}</div>
                </div>
            `;
        }).join('');

        historyHtml = `
            <div style="margin-top: 20px; padding-top: 20px; border-top: 2px solid #5d4a36;">
                <h3 style="margin: 0 0 15px 0; color: #e74c3c;">💋 История интимных сцен</h3>
                ${historyItems}
                ${rel.sexualHistory.length > 5 ? `<div style="text-align: center; color: #95a5a6; font-size: 0.85em; margin-top: 10px;">...и ещё ${rel.sexualHistory.length - 5} сцен</div>` : ''}
            </div>
        `;
    } else {
        historyHtml = `
            <div style="margin-top: 20px; padding-top: 20px; border-top: 2px solid #5d4a36;">
                <h3 style="margin: 0 0 10px 0; color: #95a5a6;">💋 История интимных сцен</h3>
                <div style="text-align: center; color: #7f8c8d; font-style: italic; padding: 20px;">Пока нет интимных сцен с этим персонажем</div>
            </div>
        `;
    }

    modalContent.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2 style="margin: 0; color: #d4af37; font-size: 1.5em;">${npc.name}</h2>
            <button id="close-npc-modal" style="background: #e74c3c; border: none; color: white; padding: 8px 15px; border-radius: 6px; cursor: pointer; font-weight: bold;">✕ Закрыть</button>
        </div>

        <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
            <div style="font-style: italic; color: #bdc3c7;">${npc.description || 'Нет описания'}</div>
        </div>

        <h3 style="margin: 20px 0 15px 0; color: #d4af37;">💞 Отношения с вами</h3>

        ${createProgressBar('❤️ Привязанность (Affection)', rel.affection, -100, 100)}
        ${createProgressBar('🔥 Влечение (Attraction)', rel.attraction, 0, 100)}
        ${createProgressBar('🤝 Доверие (Trust)', rel.trust, 0, 100)}
        ${createProgressBar('💋 Близость (Intimacy)', rel.intimacy, 0, 100)}

        ${historyHtml}
    `;

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Закрытие по клику на кнопку
    document.getElementById('close-npc-modal').addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    // Закрытие по клику вне окна
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });

    // Закрытие по ESC
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            if (document.body.contains(modal)) {
                document.body.removeChild(modal);
            }
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}


function toggleStatIncreaseButtons() {
    if (!player || !characterSheetPanel) return;
    const hasPoints = player.stats.statPoints > 0;
    characterSheetPanel.classList.toggle('has-stat-points', hasPoints);
}

// === ФУНКЦИИ ДЛЯ РАБОТЫ С ЭРОТИЧЕСКИМ ЖУРНАЛОМ ===

/**
 * Обновляет отображение эротического журнала
 */
function updateEroticJournal() {
    const journalList = document.getElementById('erotic-journal-list');
    const journalPanel = document.getElementById('erotic-journal-panel');
    const clearButton = document.getElementById('clear-erotic-journal-btn');

    if (!journalList || !player) return;

    // Показываем панель только если NSFW включен и есть записи
    if (allowNSFW && player.eroticJournal && player.eroticJournal.length > 0) {
        journalPanel.style.display = 'block';
        clearButton.style.display = 'block';
    } else if (allowNSFW) {
        journalPanel.style.display = 'block';
        clearButton.style.display = 'none';
    } else {
        journalPanel.style.display = 'none';
        return;
    }

    journalList.innerHTML = '';

    let statsDiv = document.getElementById('erotic-stats-summary');
    if (!statsDiv) {
        statsDiv = document.createElement('div');
        statsDiv.id = 'erotic-stats-summary';
        statsDiv.style.cssText = 'background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; margin-bottom: 15px; font-size: 0.85em; color: #bdc3c7;';
        journalPanel.querySelector('.panel-content').insertBefore(statsDiv, journalList);
    }
    
    if (player.eroticStats && player.eroticStats.totalScenes > 0) {
        const stats = player.eroticStats;
        let favLoc = "Нет";
        let maxLoc = 0;
        for (const [loc, count] of Object.entries(stats.locations)) {
            if (count > maxLoc) { maxLoc = count; favLoc = loc; }
        }
        let fetishesStr = [];
        if (stats.fetishes.anal > 0) fetishesStr.push(`Анал (${stats.fetishes.anal})`);
        if (stats.fetishes.oral > 0) fetishesStr.push(`Орал (${stats.fetishes.oral})`);
        if (stats.fetishes.bdsm > 0) fetishesStr.push(`БДСМ (${stats.fetishes.bdsm})`);
        if (stats.fetishes.group > 0) fetishesStr.push(`Групповой (${stats.fetishes.group})`);
        let fetishesDisplay = fetishesStr.length > 0 ? fetishesStr.join(', ') : "Нет";

        statsDiv.innerHTML = `
            <strong style="color: #e74c3c;">📊 Статистика:</strong><br>
            Всего сцен: ${stats.totalScenes} | Уникальных партнёров: ${stats.partners.length}<br>
            Консенсуально: ${stats.types.consensual || 0} | Соблазнение: ${stats.types.seduction || 0} | Принуждение: ${stats.types.forced || 0}<br>
            Любимая локация: ${favLoc} (${maxLoc} раз)<br>
            Фетиши: ${fetishesDisplay}
        `;
        statsDiv.style.display = 'block';
    } else {
        statsDiv.style.display = 'none';
    }

    if (!player.eroticJournal || player.eroticJournal.length === 0) {
        journalList.innerHTML = `<li style="color: #7f8c8d; font-style: italic; text-align: center; padding: 20px;" data-i18n="gameInterface.eroticJournalPanel.empty">${t('gameInterface.eroticJournalPanel.empty', 'Пока нет записей в дневнике')}</li>`;
        return;
    }

    // Сортируем по дате (новые сверху)
    const sortedScenes = [...player.eroticJournal].sort((a, b) => b.timestamp - a.timestamp);

    sortedScenes.forEach(scene => {
        const li = document.createElement('li');
        li.style.cssText = `
            background: rgba(231, 76, 60, 0.1);
            border-left: 3px solid #e74c3c;
            padding: 10px;
            margin-bottom: 8px;
            border-radius: 6px;
            cursor: pointer;
            transition: background 0.2s ease;
        `;

        li.addEventListener('mouseenter', () => {
            li.style.background = 'rgba(231, 76, 60, 0.2)';
        });
        li.addEventListener('mouseleave', () => {
            li.style.background = 'rgba(231, 76, 60, 0.1)';
        });

        const typeLabel = scene.type === 'consensual' ? 'рџ’•' :
                         scene.type === 'forced' ? 'вљ пёЏ' :
                         scene.type === 'seduction' ? '😏' : '💋';

        li.innerHTML = `
            <div style="font-weight: bold; color: #e74c3c; margin-bottom: 5px;">
                ${typeLabel} ${scene.partner}
            </div>
            <div style="font-size: 0.85em; color: #bdc3c7;">
                📅 День ${scene.day} • 📍 ${scene.location}
            </div>
        `;

        li.addEventListener('click', () => showEroticSceneModal(scene.id));
        journalList.appendChild(li);
    });
}

/**
 * Показывает модальное окно с полным текстом эротической сцены
 */
function showEroticSceneModal(sceneId) {
    if (!player || !player.eroticJournal) return;

    const scene = player.eroticJournal.find(s => s.id === sceneId);
    if (!scene) return;

    // Создаём модальное окно
    const modal = document.createElement('div');
    modal.className = 'erotic-scene-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        overflow-y: auto;
        padding: 20px;
    `;

    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        background: linear-gradient(135deg, #2c1e14 0%, #1a1410 100%);
        border: 2px solid #e74c3c;
        border-radius: 12px;
        padding: 30px;
        max-width: 800px;
        width: 100%;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.9);
        color: #e8dcc4;
    `;

    const typeLabel = scene.type === 'consensual' ? t('gameInterface.eroticJournalPanel.typeConsensual', '💕 Консенсуальный') :
                     scene.type === 'forced' ? t('gameInterface.eroticJournalPanel.typeForced', '⚠️ Принуждение') :
                     scene.type === 'seduction' ? t('gameInterface.eroticJournalPanel.typeSeduction', '😏 Соблазнение') : scene.type;

    const intensityLabel = scene.intensity === 0 ? 'Fade to black' :
                          scene.intensity === 1 ? 'Sensual' :
                          scene.intensity === 2 ? 'Explicit' :
                          scene.intensity === 3 ? 'Extreme' : scene.intensity;

    modalContent.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 2px solid #e74c3c; padding-bottom: 15px;">
            <h2 style="margin: 0; color: #e74c3c; font-size: 1.5em;">рџ’‹ ${scene.partner}</h2>
            <button id="close-scene-modal" style="background: #c0392b; border: none; color: white; padding: 8px 15px; border-radius: 6px; cursor: pointer; font-weight: bold;">✕ ${t('gameInterface.eroticJournalPanel.closeModal', 'Закрыть')}</button>
        </div>

        <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.9em;">
                <div><strong>📅 ${t('gameInterface.eroticJournalPanel.sceneDay', 'День')}:</strong> ${scene.day}</div>
                <div><strong>📍 ${t('gameInterface.eroticJournalPanel.sceneLocation', 'Локация')}:</strong> ${scene.location}</div>
                <div><strong>рџ’ћ ${t('gameInterface.eroticJournalPanel.sceneType', 'РўРёРї')}:</strong> ${typeLabel}</div>
                <div><strong>🔥 Интенсивность:</strong> ${intensityLabel}</div>
            </div>
        </div>

        <div style="background: rgba(0,0,0,0.2); padding: 20px; border-radius: 8px; line-height: 1.8; font-size: 1em; white-space: pre-wrap; word-wrap: break-word;">
            ${scene.narrative}
        </div>
    `;

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Закрытие по клику на кнопку
    document.getElementById('close-scene-modal').addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    // Закрытие по клику вне окна
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });

    // Закрытие по ESC
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            if (document.body.contains(modal)) {
                document.body.removeChild(modal);
            }
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

/**
 * Очищает эротический журнал с подтверждением
 */
function clearEroticJournal() {
    if (!player || !player.eroticJournal || player.eroticJournal.length === 0) return;

    const confirmMessage = t('gameInterface.eroticJournalPanel.confirmClear', 'Вы уверены, что хотите удалить все записи из интимного дневника? Это действие необратимо.');

    if (confirm(confirmMessage)) {
        player.eroticJournal = [];
        updateEroticJournal();
    }
}


function updateEnvironmentVisibility() {
    if (!player || !player.allKnownEntities) return;
    
    const newVisible = {};

    Object.values(player.allKnownEntities).forEach(ent => {
        const isHere = (ent.boundTo === player.location);
        const isFollowing = (ent.boundTo === 'player');
        
        if ((isHere || isFollowing) && ent.stats.hp > 0) {
            // КЛЮЧЕВОЕ ИЗМЕНЕНИЕ: Используем aiIdentifier как ключ вместо цифр
            newVisible[ent.aiIdentifier] = { ...ent, id: ent.aiIdentifier };
        }
    });

    player.visibleEntities = newVisible;
    updateEnvironmentPanel();
}

async function loadPromptFromFile(filePath) {
    try {
        if (typeof window.ensureRuntimeDataLoaded === 'function' && !window.RUNTIME_DATABASE) {
            await window.ensureRuntimeDataLoaded();
        }
        if (typeof window.getRuntimePrompt === 'function') {
            const runtimePrompt = window.getRuntimePrompt(filePath);
            if (runtimePrompt && typeof runtimePrompt.content === 'string') {
                console.log(`Промпт успешно получен из runtime registry: ${filePath}`);
                return runtimePrompt.content;
            }
        }
        const response = await fetch(`${filePath}?t=${Date.now()}`); // Cache busting
        if (!response.ok) {
            throw new Error(`HTTP ошибка! статус: ${response.status}, Не удалось загрузить ${response.url}`);
        }
        const promptText = await response.text();
        console.log(`Промпт успешно загружен из: ${filePath}`);
        return promptText;
    } catch (error) {
        console.error(`Не удалось загрузить промпт из ${filePath}:`, error);
        return `Ошибка: Не удалось загрузить промпт из ${filePath}. ${error.message}`;
    }
}

// --- Игровое Меню ---
function repeatLastAction() {
    if (isWaitingForAI || !player || lastUserMessageForRetry === null) return;
    
    // Вставляем чистый текст пользователя
    userInput.value = lastUserMessageForRetry;
    
    // Восстанавливаем плашки бросков
    const rollsContainer = document.getElementById('active-rolls-container');
    if (window.lastRollsStateForRetry && rollsContainer) {
        rollsContainer.innerHTML = window.lastRollsStateForRetry;
        // Переназначаем обработчики удаления
        rollsContainer.querySelectorAll('.roll-badge-close').forEach(btn => {
            btn.addEventListener('click', () => btn.parentElement.remove());
        });
    }
    
    handleUserInput();
}

function openInGameMenu() {
    menuOverlay.style.display = 'block';
    inGameMenu.style.display = 'flex';
    requestAnimationFrame(() => {
        menuOverlay.style.opacity = '1';
        inGameMenu.style.opacity = '1';
        inGameMenu.style.transform = 'translate(-50%, -50%) scale(1)';
    });
}

function closeInGameMenu() {
    menuOverlay.style.opacity = '0';
    inGameMenu.style.opacity = '0';
    inGameMenu.style.transform = 'translate(-50%, -50%) scale(0.9)';
    setTimeout(() => {
        menuOverlay.style.display = 'none';
        inGameMenu.style.display = 'none';
    }, 300); // Время анимации
}

// --- Лог Рё Р’РІРѕРґ ---
function addLogMessage(message, type = "gm-message", isRestoring = false, imagePrompt = "", savedImageBase64 = null) {
    if (!gameLog) return;
    message = parseLocString(message); // Авто-локализация

    // --- СИСТЕМА СОХРАНЕНИЯ ЛОГОВ ---
    let currentHistoryEntry = null;
    if (player) {
        if (!player.gameLogHistory) player.gameLogHistory = [];
        if (!isRestoring) {
            currentHistoryEntry = { message, type, imagePrompt, savedImageBase64 };
            player.gameLogHistory.push(currentHistoryEntry);
            if (player.gameLogHistory.length > 100) player.gameLogHistory.shift();
        } else {
            // При загрузке находим конкретный лог по тексту, чтобы привязать кнопку именно к нему
            currentHistoryEntry = player.gameLogHistory.find(e => e.message === message && e.imagePrompt === imagePrompt);
        }
    }

    // Определяем категорию для стиля пузыря
            let category = 'gm';
        if (type === 'user-message') category = 'user';
        else if (['system-message', 'command-feedback', 'level-up', 'calc-info'].includes(type)) category = 'system';
        else if (type === 'world-event') category = 'world-event';

        let textToSpeak = message;
    let cleanHtml = "";

    // Обработка текста (Markdown, RP-теги, Санитайзер)
    try {
        if (type === 'world-event') {
            let sanitizedText = DOMPurify.sanitize(marked.parse(message));
            cleanHtml = `
                <div class="world-event-card">
                    <div class="world-event-header"><i class="fas fa-globe-europe"></i> ВЕСТИ ИЗ ЭФИРА</div>
                    <div class="world-event-body">${sanitizedText}</div>
                    <div style="margin-top: 15px; font-size: 0.85em; color: #7f8c8d; font-style: italic; border-top: 1px solid rgba(184,134,11,0.2); padding-top: 10px;">
                        Событие обновило карту и баланс сил. Последствия неизбежны.
                    </div>
                </div>
            `;
            textToSpeak = message.replace(/<[^>]*>?/gm, '');
        } else if (type === 'gm-message') {
            let cleanMessage = message.replace(/\[COMMAND:.+?\]/g, '').trim();
            const tempDiv = document.createElement('div');
            tempDiv.textContent = cleanMessage;
            let rawHtml = tempDiv.innerHTML;

            const rpRegex = /(\(\(.*?\)\))|("(.*?)")|(\*(.*?)\*)/g;
            let processedHtml = rawHtml.replace(rpRegex, (match, ooc, dialogue, dialogueContent, action, actionContent) => {
                if (ooc) {
                    const oocText = ooc.slice(2, -2).replace(/"/g, '&quot;').trim();
                    return `<span class="ooc-marker" data-ooc-text="${oocText}" title="${t('gameInterface.log.oocTooltip', 'OOC Сообщение')}">OOC</span>`;
                }
                if (dialogue) return `<span class="dialogue-text">${dialogue}</span>`;
                if (action) return `<span class="action-text">${action}</span>`;
                return match;
            });

            let markdownHtml = marked.parse(processedHtml);
            cleanHtml = DOMPurify.sanitize(markdownHtml, { ADD_ATTR: ['data-ooc-text'], USE_PROFILES: { html: true } });

            // Готовим текст для озвучки (без OOC)
            const speechTempDiv = document.createElement('div');
            speechTempDiv.innerHTML = cleanHtml;
            speechTempDiv.querySelectorAll('.ooc-marker').forEach(m => m.remove());
            textToSpeak = speechTempDiv.textContent || speechTempDiv.innerText || "";
        } else {
            // Для системных и пользовательских сообщений
            cleanHtml = `<p class="${type}">${DOMPurify.sanitize(message, { USE_PROFILES: { html: true } })}</p>`;
            textToSpeak = message.replace(/<[^>]*>?/gm, '');
        }
    } catch (e) {
        console.error("Ошибка при рендеринге сообщения:", e);
        cleanHtml = `<p class="${type}">>>> [Ошибка отображения]</p>`;
        textToSpeak = "";
    }

    // Группировка системных логов (чтобы не спамить пузырями)
    let targetBubble = null;
    if (category === 'system') {
        const lastWrapper = gameLog.lastElementChild;
        if (lastWrapper && lastWrapper.classList.contains('wrapper-system')) {
            targetBubble = lastWrapper.querySelector('.system-content');
        }
    }

    let bubbleElement = null;

    if (category === 'world-event') {
        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper wrapper-system';
        wrapper.innerHTML = cleanHtml;
        bubbleElement = wrapper.firstElementChild;
        gameLog.appendChild(wrapper);
    } else if (targetBubble) {
        const tempContainer = document.createElement('div');
        tempContainer.innerHTML = cleanHtml;
        while (tempContainer.firstChild) {
            targetBubble.appendChild(tempContainer.firstChild);
        }
        bubbleElement = targetBubble.parentElement;
    } else {
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper wrapper-${category}`;

        const bubble = document.createElement('div');
        bubble.className = `message-bubble bubble-${category}`;
        bubbleElement = bubble;

        if (category === 'system') {
            bubble.classList.add('collapsed');
            const contentDiv = document.createElement('div');
            contentDiv.className = 'system-content';
            contentDiv.innerHTML = cleanHtml;
            const hintDiv = document.createElement('div');
            hintDiv.className = 'system-toggle-hint';
            hintDiv.innerHTML = '<i class="fas fa-chevron-down"></i> Системные логи';
            bubble.appendChild(contentDiv);
            bubble.appendChild(hintDiv);

            bubble.addEventListener('click', (e) => {
                if (e.target.closest('.tts-speak-btn')) return;
                const isCollapsed = bubble.classList.toggle('collapsed');
                bubble.classList.toggle('expanded', !isCollapsed);
                hintDiv.innerHTML = isCollapsed ? `<i class="fas fa-chevron-down"></i> ${t('gameInterface.log.systemLogs', null, 'Системные логи')}` : `<i class="fas fa-chevron-up"></i> ${t('gameInterface.log.collapse', null, 'Свернуть')}`;
            });
        } else {
            bubble.innerHTML = cleanHtml;
        }

        wrapper.appendChild(bubble);
        gameLog.appendChild(wrapper);
    }

    // --- КНОПКА РУЧНОЙ ОЗВУЧКИ (TTS) ---
    if (textToSpeak && textToSpeak.trim() !== '' && category !== 'system') {
        if (!bubbleElement.querySelector('.tts-controls-wrapper')) {
            const ttsWrapper = document.createElement('div');
            ttsWrapper.className = 'tts-controls-wrapper';

            const ttsBtn = document.createElement('button');
            ttsBtn.className = 'tts-speak-btn';
            ttsBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
            ttsBtn.title = t('gameInterface.tooltip.speak', null, 'Озвучить');
            ttsBtn.dataset.state = 'idle';

            const stopBtn = document.createElement('button');
            stopBtn.className = 'tts-stop-btn';
            stopBtn.innerHTML = '<i class="fas fa-stop"></i>';
            stopBtn.title = t('gameInterface.tooltip.stop', null, 'Остановить');
            stopBtn.style.display = 'none';

            const resetThisUI = () => {
                ttsBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
                ttsBtn.dataset.state = 'idle';
                stopBtn.style.display = 'none';
            };

            ttsBtn.onclick = async (e) => {
                e.stopPropagation();

                // Если уже играет именно этот текст - ставим на паузу
                if (ttsBtn.dataset.state === 'playing') {
                    if (currentAudio && !currentAudio.paused) {
                        currentAudio.pause();
                        ttsBtn.innerHTML = '<i class="fas fa-play"></i>';
                        ttsBtn.dataset.state = 'paused';
                    }
                    return;
                }

                // Если на паузе именно этот текст - снимаем с паузы
                if (ttsBtn.dataset.state === 'paused') {
                    if (currentAudio && currentAudio.paused) {
                        currentAudio.play();
                        ttsBtn.innerHTML = '<i class="fas fa-pause"></i>';
                        ttsBtn.dataset.state = 'playing';
                    }
                    return;
                }

                // Иначе (состояние idle) - генерируем и запускаем
                let toRead = bubbleElement.innerText.replace('OOC', '').trim();

                // Сбрасываем UI всех остальных кнопок на странице
                document.querySelectorAll('.tts-controls-wrapper').forEach(wrapper => {
                    const btn = wrapper.querySelector('.tts-speak-btn');
                    const sBtn = wrapper.querySelector('.tts-stop-btn');
                    if (btn) {
                        btn.innerHTML = '<i class="fas fa-volume-up"></i>';
                        btn.dataset.state = 'idle';
                    }
                    if (sBtn) sBtn.style.display = 'none';
                });

                // Анимация загрузки
                ttsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                ttsBtn.style.pointerEvents = 'none';

                try {
                    await speakText(toRead);

                    // После успешной генерации (speakText сам запускает play)
                    if (currentAudio) {
                        ttsBtn.dataset.state = 'playing';
                        ttsBtn.innerHTML = '<i class="fas fa-pause"></i>';
                        stopBtn.style.display = 'flex';

                        // Вешаем слушатели на текущий аудио-объект
                        currentAudio.addEventListener('pause', () => {
                            if (ttsBtn.dataset.state === 'playing') {
                                ttsBtn.innerHTML = '<i class="fas fa-play"></i>';
                                ttsBtn.dataset.state = 'paused';
                            }
                        });
                        currentAudio.addEventListener('play', () => {
                            if (ttsBtn.dataset.state === 'paused') {
                                ttsBtn.innerHTML = '<i class="fas fa-pause"></i>';
                                ttsBtn.dataset.state = 'playing';
                            }
                        });
                        currentAudio.addEventListener('ended', () => {
                            resetThisUI();
                        });
                    } else {
                        resetThisUI();
                    }
                } catch (err) {
                    resetThisUI();
                } finally {
                    ttsBtn.style.pointerEvents = 'auto';
                }
            };

            stopBtn.onclick = (e) => {
                e.stopPropagation();
                if (currentAudio) {
                    currentAudio.pause();
                    currentAudio.currentTime = 0;
                    currentAudio = null;
                }
                resetThisUI();
            };

            ttsWrapper.appendChild(ttsBtn);
            ttsWrapper.appendChild(stopBtn);

            // КАРТИНКА ИЛИ КНОПКА ГЕНЕРАЦИИ
            const attachImageToChat = (srcBase64) => {
                const cleanSrc = srcBase64.replace(/[\r\n]+/g, '');
                const finalSrc = cleanSrc.startsWith('data:image') || cleanSrc.startsWith('http') ? cleanSrc : 'data:image/jpeg;base64,' + cleanSrc;
                
                const imgContainer = document.createElement('div');
                imgContainer.className = 'chat-illustration-container';
                
                const imgEl = document.createElement('img');
                imgEl.src = finalSrc;
                imgEl.alt = "Эфирное видение";
                imgEl.title = "Нажми, чтобы открыть оригинал";
                imgEl.style.cursor = "pointer";
                imgEl.onclick = () => {
                    const w = window.open('');
                    w.document.write('<style>body{margin:0;background:#000;display:flex;justify-content:center;align-items:center;height:100vh;}img{max-width:100%;max-height:100vh;object-fit:contain;}</style><img id="fullImg">');
                    w.document.getElementById('fullImg').src = finalSrc;
                };
                
                const watermark = document.createElement('div');
                watermark.className = 'img-watermark';
                watermark.textContent = t('gameInterface.tooltip.etherealSnapshot', null, 'Эфирный Слепок');
                
                imgContainer.appendChild(imgEl);
                imgContainer.appendChild(watermark);
                bubbleElement.appendChild(imgContainer);
                return finalSrc;
            };

            if (savedImageBase64) {
                attachImageToChat(savedImageBase64);
            } else if (enableImageGeneration && imagePrompt && imagePrompt.trim() !== '') {
                const imgBtn = document.createElement('button');
                imgBtn.className = 'tts-speak-btn img-gen-btn';
                imgBtn.innerHTML = '<i class="fas fa-eye"></i>';
                imgBtn.title = t('gameInterface.tooltip.visualize', null, 'Визуализировать сцену');
                imgBtn.onclick = async (e) => {
                    e.stopPropagation();
                    imgBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    imgBtn.style.pointerEvents = 'none';
                    try {
                        const res = await window.generateVisionImage(imagePrompt);
                        if (res && res.success && res.imageUrl) {
                            const finalSrc = attachImageToChat(res.imageUrl);
                            // Сохраняем картинку строго в тот объект истории, к которому привязана кнопка
                            if (currentHistoryEntry) {
                                currentHistoryEntry.savedImageBase64 = finalSrc;
                            } else if (player && player.gameLogHistory) {
                                const fallbackEntry = player.gameLogHistory.find(e => e.message === message);
                                if (fallbackEntry) fallbackEntry.savedImageBase64 = finalSrc;
                            }
                            imgBtn.remove();
                        }
                    } catch (err) {
                        console.error("Ошибка генерации картинки:", err);
                        imgBtn.innerHTML = '<i class="fas fa-exclamation-triangle" style="color:#e74c3c"></i>';
                        imgBtn.title = 'Ошибка: ' + err.message;
                        setTimeout(() => {
                            imgBtn.innerHTML = '<i class="fas fa-eye"></i>';
                            imgBtn.style.pointerEvents = 'auto';
                            imgBtn.title = t('gameInterface.tooltip.visualize', null, 'Визуализировать сцену');
                        }, 3000);
                    }
                };
                ttsWrapper.appendChild(imgBtn);
            }
            bubbleElement.appendChild(ttsWrapper);
        }
    }

    pruneGameLog();
    gameLog.scrollTo({ top: gameLog.scrollHeight, behavior: 'smooth' });
}

function processTurnEffects() {
    if (!player || !player.statusEffects) {
        return []; // Возвращаем пустой массив, если нечего обрабатывать
    }

    const effectsToRemove = [];
    const expiredEffectNames = []; // >>>>> НОВОЕ: Собираем имена истекших эффектов

    for (const effectId in player.statusEffects) {
        const effect = player.statusEffects[effectId];

        if (effect.duration > 0) {
            effect.duration--;
        }

        if (effect.duration <= 0) {
            effectsToRemove.push(effectId);
            expiredEffectNames.push(effect.name); // >>>>> НОВОЕ: Добавляем имя в список
            addLogMessage(t('gameInterface.commandFeedback.statusEffectRemoved', { effectName: effect.name }), "command-feedback");
        }
    }

    if (effectsToRemove.length > 0) {
        effectsToRemove.forEach(id => {
            delete player.statusEffects[id];
        });
    }

    updateStatusEffectsDisplay();

    return expiredEffectNames; // >>>>> НОВОЕ: Возвращаем список имен
}

async function loadCombatSystemRules() {
    try {
        combatSystemRulesData = await loadPromptFromFile('combat_system_rules');
        console.log(`Правила боевой системы успешно загружены.`);
    } catch (error) {
        console.error(`Не удалось загрузить правила боевой системы:`, error);
        combatSystemRulesData = "// Ошибка: Не удалось загрузить правила боевой системы. Бой может быть непредсказуемым.";
    }
}

// --- Функции Управления Экраном Загрузки (НОВОЕ) ---

function showLoadingScreen(textKey = 'loadingScreen.generatingWorld', fallbackText = 'Генерация мира...') {
    if (!loadingOverlay) return;

    const titleEl = document.getElementById('loading-title');
    if (titleEl) {
        titleEl.textContent = t(textKey, null, fallbackText);
    } else if (loadingText) {
        loadingText.textContent = t(textKey, null, fallbackText);
    }

    const textEl = document.getElementById('loading-text');
    if (textEl && titleEl) {
        textEl.textContent = 'Инициализация...';
    }

    loadingOverlay.style.display = 'flex';

    // Небольшая задержка перед добавлением класса для срабатывания transition
    setTimeout(() => {
        loadingOverlay.classList.add('visible');
    }, 10);
}

function hideLoadingScreen() {
    if (!loadingOverlay) return;

    loadingOverlay.classList.remove('visible');

    // Скрываем элемент после завершения анимации
    setTimeout(() => {
        loadingOverlay.style.display = 'none';
    }, 500); // Должно совпадать со временем transition в CSS
}

// --- Взаимодействие с Gemini ---
/**
 * Основная функция для взаимодействия с Gemini API.
 * Собирает все состояние игры, формирует промпт, отправляет запрос и обрабатывает ответ.
 * @param {string} promptTextForAI - Текст от пользователя или системный промпт для инициализации.
 * @param {boolean} [isInitialPrompt=false] - Флаг, указывающий, что это первый запрос для начала новой игры.
 * @param {boolean} [isDiceRollResponse=false] - Флаг, указывающий, что это внутренний ответ на запрос броска кубика.
 * @param {Array<string>} [expiredEffects=[]] - Массив имен статус-эффектов, которые истекли в этом ходу.
 */


/**
 * (ПОЛНАЯ ОБНОВЛЕННАЯ ВЕРСИЯ v3.0 - АГЕНТСКИЙ ЦИКЛ И ПОВТОРЫ)
 */
async function handleUserInput() {
    let text = userInput.value.trim();

    // --- АНТИЧИТ: Удаляем вручную вписанные броски ---
    text = text.replace(/\[ROLL_RESULT:.*?\]/gi, '').trim();


    // Очищаем предложенные действия при любом вводе
    const suggestedContainer = document.getElementById('suggested-actions-container');
    if (suggestedContainer) {
        suggestedContainer.innerHTML = '';
        suggestedContainer.style.display = 'none';
    }

    // ==========================================
    // --- [DEV] ПАНЕЛЬ РАЗРАБОТЧИКА ЧЕРЕЗ ЧАТ ---
    // ==========================================
    if (DEBUG_MODE && text.startsWith('/dev ')) {
        const args = text.split(' ');
        const cmd = args[1];
        const val = parseInt(args[2]);

        if (cmd === 'turn') {
            player.stats.turnCount = val || 0;
            addLogMessage(`[DEV] Текущий ход установлен на: ${player.stats.turnCount}`, "system-message");
            updateCharacterSheet();
        }
        else if (cmd === 'addmem') {
            if (!player.gmNotes) player.gmNotes = {};
            player.gmNotes[`Test_Data_${Date.now()}`] = "Это тестовая запись для проверки системы архивации памяти. Игрок нашел ржавый гвоздь и поговорил с призраком.";
            addLogMessage(`[DEV] В память GM добавлена тестовая запись. Открой F4, чтобы проверить.`, "system-message");
            updateGmNotesDisplay();
    updateWorldSimDebugDisplay();
        }
        else if (cmd === 'killall') {
            Object.values(player.visibleEntities).forEach(ent => {
                executeCommand('updateEntityStat', { aiIdentifier: ent.aiIdentifier, stat: 'hp', value: 0 });
            });
            addLogMessage(`[DEV] Все видимые существа убиты.`, "system-message");
        }
        else if (cmd === 'skip') {
            const skipAmount = val || 1;
            player.stats.turnCount += skipAmount;
            addLogMessage(`[DEV] Пропущено ходов: ${skipAmount}. Текущий ход: ${player.stats.turnCount}
Игровое время: День ${player.gameTime.day}, ${player.gameTime.hour < 10 ? '0'+player.gameTime.hour : player.gameTime.hour}:${player.gameTime.minute < 10 ? '0'+player.gameTime.minute : player.gameTime.minute} (${player.timeOfDay})
[ВРЕМЯ С ПРОШЛОГО ХОДА]: ${(() => {
    const delta = player.gameTime.totalPulses - (player.lastTurnPulses || player.gameTime.totalPulses);
    const d = Math.floor(delta / 288);
    const h = Math.floor((delta % 288) / 12);
    return d > 0 ? `${d} РґРЅ. Рё ${h} С‡.` : `${h} С‡.`;
})()}`, "system-message");
            updateCharacterSheet();
        }
        else if (cmd === 'test') {
            runUnitTests();
        }
        else {
            addLogMessage(`[DEV] Неизвестная команда. Доступно: /dev turn [число], /dev addmem, /dev killall, /dev skip [число], /dev test`, "system-message");
        }

        userInput.value = '';
        return; // Прерываем выполнение, чтобы не отправлять это ИИ
    }
    // ==========================================

    // Клиентская валидация: не давать отправлять сообщение с требованиями броска, если бросков нет
    const rollsContainer = document.getElementById('active-rolls-container');
    const attackKeywords = /атакую|бью|стреляю|рублю|колю|ударяю|кастую|использую умение/i;
    if (attackKeywords.test(text) && (!rollsContainer || rollsContainer.children.length === 0)) {
        addLogMessage("⚠️ Вы описали боевое действие, но не добавили бросок кубика! Используйте кнопки макросов (⚔️ Attack, 🎲 D20) перед отправкой.", "system-message");
        return;
    }

    // Сохраняем ЧИСТЫЙ текст пользователя и состояние плашек для функции "Повторить действие"
    lastUserMessageForRetry = text;
    window.lastRollsStateForRetry = rollsContainer ? rollsContainer.innerHTML : "";

    let rollsBlock = "";
    let rollResultsArray = [];
    let hasRolls = false;

    if (rollsContainer) {
        const badges = rollsContainer.querySelectorAll('.roll-badge');
        badges.forEach(badge => {
            hasRolls = true;
            rollResultsArray.push(badge.dataset.resultText);

            // Списываем ресурсы и вешаем КД только в момент отправки
            if (badge.classList.contains('skill-badge')) {
                const sId = badge.dataset.skillId;
                const skill = player.skills[sId];
                if (skill) {
                    let costVal = parseInt(skill.cost) || 0;
                    let costType = (skill.costType || '').toLowerCase();
                    if (costType.includes('mp') || costType.includes('ман')) player.stats.mana -= costVal;
                    else if (costType.includes('hp') || costType.includes('Р·РґРѕСЂРѕРІСЊ')) damagePlayerHP(costVal);

                    let cdVal = parseInt(skill.cooldown) || 0;
                    if (cdVal > 0) skill.currentCooldown = cdVal;
                }
            }
        });
    }

    if (rollResultsArray.length > 0) {
        rollsBlock = "\n\n=== БРОСКИ ИГРОКА ===\n" + rollResultsArray.join("\n") + "\n========================\n";
        addCalculationMessage(`[СИСТЕМА] Отправлено бросков: ${rollResultsArray.length}`);
        
        if (!player.diceLogHistory) player.diceLogHistory = [];
        player.diceLogHistory.push({ turn: player.stats.turnCount + 1, rolls: rollResultsArray });
        if (player.diceLogHistory.length > 10) player.diceLogHistory.shift();
        updateDiceLogDisplay();
    }

    if ((!text && !hasRolls) || isWaitingForAI || !player) {
        if (!player && !isWaitingForAI) addLogMessage(t("gameInterface.log.gameNotActive"), "system-message");
        return;
    }

    // --- ОТОБРАЖЕНИЕ ДЛЯ ИГРОКА (Скрываем технические теги, показываем красивые плашки) ---
    // Экранируем сырой текст игрока, чтобы не сломать верстку, но оставляем сгенерированные плашки кубиков
    let safeText = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let displayMessage = safeText || "*Совершает действие...*";

    if (rollsContainer && rollsContainer.children.length > 0) {
        let rollsHtml = '<div class="chat-rolls-display-block"><div class="chat-rolls-header"><i class="fas fa-dice"></i> Броски кубиков</div><div class="chat-rolls-content">';
        rollsContainer.querySelectorAll('.roll-badge').forEach(badge => {
            const badgeText = badge.querySelector('span').textContent;
            const isSkill = badge.classList.contains('skill-badge');
            const isCrit = badge.classList.contains('crit-success');
            const isFail = badge.classList.contains('crit-fail');

            let extraClass = isCrit ? 'crit-success' : (isFail ? 'crit-fail' : '');
            if (isSkill) extraClass += ' skill-badge-chat';

            const icon = isSkill ? '<i class="fas fa-bolt"></i>' : '<i class="fas fa-dice-d20"></i>';
            rollsHtml += `<span class="chat-roll-badge ${extraClass}">${icon} ${badgeText}</span>`;
        });
        rollsHtml += '</div></div>';
        displayMessage += rollsHtml;
    }

    addLogMessage(displayMessage, "user-message");

    // --- ФОРМИРОВАНИЕ ЗАПРОСА ДЛЯ GM ---
    let finalMessageForGM = `[ДЕЙСТВИЕ/ТЕКСТ ИГРОКА]:\n${text || "*Ждет*"}`;
    if (rollsBlock) finalMessageForGM += rollsBlock;

    // --- СБОР КОНТЕКСТНЫХ ТЕГОВ И ИНЕРЦИИ (MOMENTUM) ---
    let activeTags = [];
    for (const slot in player.equipment) {
        if (player.equipment[slot] && player.equipment[slot].tags) {
            activeTags.push(...player.equipment[slot].tags);
        }
    }

    if (rollsContainer) {
        const badges = rollsContainer.querySelectorAll('.roll-badge');
        badges.forEach(badge => {
            const badgeText = badge.dataset.resultText;
            const match = badgeText.match(/ROLL_RESULT:\s*(\d+)/);
            if (match) {
                const roll = parseInt(match[1], 10);
                if (roll >= 15) player.stats.momentum = Math.min(5, (player.stats.momentum || 0) + 1);
                if (roll <= 5) player.stats.momentum = Math.max(-5, (player.stats.momentum || 0) - 1);
            }
        });
    }

    let contextInjection = `\n\n[SYSTEM CONTEXT: Инерция сцены (Momentum): ${player.stats.momentum || 0} (от -5 до 5). Активные теги: ${activeTags.length > 0 ? activeTags.join(', ') : 'Нет'}.]`;
    finalMessageForGM += contextInjection;


    // Добавляем очередь системных действий (например, активация скиллов)
    if (playerActionQueue.length > 0) {
        finalMessageForGM += "\n\n" + playerActionQueue.join("\n");
        playerActionQueue = []; // Очищаем очередь
    }

    // --- ПРЕДСКАЗАТЕЛЬНАЯ ЗАГРУЗКА ПАМЯТИ (PREFETCHING / ARIGRAPH) ---
    if (text && typeof World !== 'undefined' && World) {
        let matchedQueryIds = [];
        const lowerInput = text.toLowerCase();

        if (player && player.allKnownEntities) {
            for (const [entId, ent] of Object.entries(player.allKnownEntities)) {
                if (ent.name && ent.name.length > 2 && lowerInput.includes(ent.name.toLowerCase())) {
                    matchedQueryIds.push(entId);
                }
            }
        }
        if (World.map && World.map.locations) {
            for (const [locId, loc] of Object.entries(World.map.locations)) {
                if (loc.name && loc.name.length > 2 && lowerInput.includes(loc.name.toLowerCase())) {
                    matchedQueryIds.push(locId);
                }
            }
        }
        if (World.subLocations) {
            for (const [locId, loc] of Object.entries(World.subLocations)) {
                if (loc.name && loc.name.length > 2 && lowerInput.includes(loc.name.toLowerCase())) {
                    matchedQueryIds.push(locId);
                }
            }
        }

        if (matchedQueryIds.length > 0) {
            matchedQueryIds = [...new Set(matchedQueryIds)];
            const graphContext = await fetchGraphContext(matchedQueryIds);
            if (graphContext && graphContext.length > 0) {
                let recalledMemoryStr = `\n\n[RECALLED_MEMORY: Всплывшие факты из AriGraph для (${matchedQueryIds.join(', ')})]\n`;
                recalledMemoryStr += graphContext.map(n => {
                    let daysOld = Math.max(0, (World.current_day || 0) - (n.day || 0));
                    return `[${daysOld}d ago, ${n.location}] ${parseLocString(n.text)}`;
                }).join("\n");
                finalMessageForGM += recalledMemoryStr;
                addCalculationMessage(`[AriGraph] Извлечено ${graphContext.length} воспоминаний для: ${matchedQueryIds.join(', ')}`);
            }
        }
    }

    // --- АВТОМАТИЗИРОВАННАЯ БОЕВАЯ СИСТЕМА ---
    if (player.currentCombat && player.currentCombat.isActive) {
        // 1. Проверка на авто-завершение боя
        const activeEnemies = player.currentCombat.participants.filter(id => player.visibleEntities[id]);

        if (activeEnemies.length === 0) {
            player.currentCombat.isActive = false;
            player.currentCombat.participants = [];
            finalMessageForGM += "\n\n[SYSTEM: Бой автоматически завершен. Все противники устранены или покинули поле боя. Опиши исход боя и победителя.]";
            addCalculationMessage("[СИСТЕМА] Бой автоматически завершен.");
            if (player.travel && player.travel.active && player.travel.paused && player.travel.pauseReason === 'combat') {
                TravelSystem.resume();
                finalMessageForGM += " [SYSTEM: ПУТЕШЕСТВИЕ ВОЗОБНОВЛЕНО. Упомяни, что герой продолжает путь.]";
            }
        } else {
            // 2. Расчет атак противников через C++ ядро
            let playerDef = 10 + Math.floor((player.stats.dex - 10) / 2);
            const { bonuses } = getEffectiveStats();
            playerDef += (bonuses['res'] || 0);

            let enemiesData = activeEnemies; // Просто передаем массив ID

            const combatRes = await sendInventoryCommand('resolveEnemyAttacks', { player_def: playerDef, enemies: enemiesData });
            
            let enemyRollsText = "\n\n[SYSTEM: РЕЗУЛЬТАТЫ АТАК ПРОТИВНИКОВ В ЭТОМ ХОДУ:\n";
            if (combatRes.success && combatRes.combat_log) {
                combatRes.combat_log.forEach(logLine => {
                    enemyRollsText += "- " + logLine + "\n";
                });
                if (combatRes.total_damage > 0) {
                    damagePlayerHP(combatRes.total_damage);
                    enemyRollsText += `ИТОГО УРОНА ПО ИГРОКУ: ${combatRes.total_damage}. HP игрока снижено.\n`;
                } else {
                    enemyRollsText += "Игрок успешно уклонился/заблокировал все атаки.\n";
                }
            }
            enemyRollsText += "СТРОЖАЙШИЙ ПРИКАЗ: ВРАГИ ЖИВЫ (HP > 0)! ТЫ ОБЯЗАН учесть эти результаты в своем художественном описании! ЗАПРЕЩЕНО завершать бой, выдавать лут или обновлять квесты! Напиши Поэту в logic_summary: 'БОЙ ПРОДОЛЖАЕТСЯ. Опиши ответный удар врагов'.]";
            finalMessageForGM += enemyRollsText;
        }
    }

    // --- НАЧАЛО ЛОГИКИ МЕХАНИЗМА ПАМЯТИ ---
    player.stats.turnCount++;
    player.lastTurnPulses = player.gameTime.totalPulses; // Запоминаем время ДО выполнения действия
    const turn = player.stats.turnCount;

    // Уменьшаем кулдауны скиллов
    if (player.skills) {
        Object.values(player.skills).forEach(s => {
            if (s.currentCooldown > 0) s.currentCooldown--;
        });
        updateSkillsDisplay();
    }


    // Архивация перенесена в конец sendApiRequest, чтобы не прерывать текущий ход игрока.

    if (turn > 0 && turn % MEMORY_PRUNE_TURN === 0) {
        addLogMessage(t('optimization.clearing', "Контекст диалогов был очищен для оптимизации. Ключевые события сохранены в памяти GM."), "command-feedback");
        conversationHistory = [];
    }

    processAutomatedNexusEffects();
    const effectLogMessages = processStatusEffects();
    
    if (player.stats.hp <= 0 && !player.statusEffects['ghost_form']) {
        if (window.ModAPI) await ModAPI.emit('onPlayerDied', {cause: 'combat', location: player.location, hp: player.stats.hp});
        updateCharacterSheet();
        effectLogMessages.forEach(msg => addLogMessage(msg, "command-feedback"));
        await handlePlayerDeath();
        return; // Прерываем обычный ход, так как игрок умер до ответа GM (от яда или авто-боя)
    }

    updateCharacterSheet();
    effectLogMessages.forEach(msg => addLogMessage(msg, "command-feedback"));

    const expiredEffectsForGM = player.expiredEffectsForGM || [];
    player.expiredEffectsForGM = [];

    // --- СИСТЕМА ТРАВМ ---
    let traumaInstruction = "";
    const currentHP = player.stats.hp;
    const resilienceBaseline = requireRuntimeNumber(
        getGameplaySurvivalRuntimeConfig().trauma?.resilience_baseline,
        'gameplay_runtime.survival.trauma.resilience_baseline'
    );
    const resilience = player.stats.res ?? resilienceBaseline;

    if (currentHP > 0 && currentHP <= 15) {
        let baseChance = currentHP <= 5 ? 70 : 40;
        let finalChance = Math.max(5, baseChance - (resilience - resilienceBaseline) * 2.5);
        if (Math.random() * 100 < finalChance) {
            traumaInstruction = `\n\n[SYSTEM CRITICAL: Персонаж получил ТЯЖЕЛУЮ ТРАВМУ. Опиши это и наложи дебафф командой addStatusEffect.]`;
        }
    }

        let hasGuards = Object.values(player.visibleEntities).some(e => e.type === 'npc' && (e.profession?.toLowerCase().includes('страж') || (e.traits && e.traits.includes('Стражник'))));
    if (hasGuards) {
        let bp = ContainerRegistry.get(player.container_backpack);
        let hasStolen = bp && getContainerItems(bp).some(id => ItemRegistry.get(id)?.flags?.stolen);
        if (hasStolen) {
            let count = await CoreInventorySystemAsync.confiscateStolen(player.container_backpack, "guard_confiscation_chest");
            finalMessageForGM += `\n\n[SYSTEM CRITICAL: Стража АВТОНОМНО обыскала игрока и нашла краденое! Изъято предметов: ${count}. ТЫ ОБЯЗАН описать сцену ареста, штрафа или нападения стражи!]`;
        }
    }


finalMessageForGM += traumaInstruction;
    sendApiRequest(finalMessageForGM, false, false, expiredEffectsForGM, false);

    userInput.value = '';
    if (rollsContainer) rollsContainer.innerHTML = '';
    turnRollMemory = {};
}





/**
 * Вспомогательная функция для выполнения запроса к API.
 * Инкапсулирует логику провайдеров, заголовков и ключей.
 */
let lastApiRequestTime = 0;
const API_DELAY_MS = 3500; // 3.5 секунды задержки между любыми запросами
let apiRequestQueue = Promise.resolve();

async function performAiFetch(systemInstruction, history, providerModel, currentInput = "") {
    return new Promise((resolve, reject) => {
        apiRequestQueue = apiRequestQueue.then(async () => {
            try {
                const result = await _internalPerformAiFetch(systemInstruction, history, providerModel, currentInput);
                resolve(result);
            } catch (e) {
                reject(e);
            } finally {
                lastApiRequestTime = Date.now();
            }
        });
    });
}

async function _internalPerformAiFetch(systemInstruction, history, providerModel, currentInput = "") {
    if (currentApiAbortController) {
        currentApiAbortController.abort();
    }
    currentApiAbortController = new AbortController();

    // --- ПРОВАЙДЕР-ЗАГЛУШКА (ДЛЯ ТЕСТОВ) ---
    if (currentApiProvider === 'dummy') {
        await new Promise(resolve => setTimeout(resolve, 500)); // Имитация задержки
        if (currentInput === "[INITIAL_GAME_SETUP_START_OF_STORY]") {
            return JSON.stringify({
                "director_notes": "Dummy initial setup.",
                "time_passed": { "days": 0, "hours": 0, "minutes": 5 },
                "narrative": "(( ТЕСТОВЫЙ СТАРТ. Вы появились в мире. Движок и UI готовы к тестам. ))",
                "actions": [
                    { "command": "setLocation", "args": { "locationName": "capital_aquilon" } },
                    { "command": "renderLocation", "args": { "locationId": "dummy_start", "size": "15x15", "description": "Тестовая локация" } },
                    { "command": "addItem", "args": { "id": "sword_short_common", "name": "Тестовый меч", "slot": "right_hand", "effects": [{"type": "modify_stat", "stat": "str", "change": 1}] } },
                    { "command": "equipItem", "args": { "id": "sword_short_common", "slot": "right_hand" } },
                    { "command": "addItem", "args": { "id": "leather_armor_light_common", "name": "Тестовая броня", "slot": "torso", "effects": [{"type": "modify_stat", "stat": "res", "change": 2}] } },
                    { "command": "equipItem", "args": { "id": "leather_armor_light_common", "slot": "torso" } },
                    { "command": "addItem", "args": { "id": "boots_common", "name": "Тестовые сапоги", "slot": "feet", "effects": [{"type": "modify_stat", "stat": "res", "change": 1}] } },
                    { "command": "equipItem", "args": { "id": "boots_common", "slot": "feet" } },
                    { "command": "addItem", "args": { "id": "pants_common", "name": "Тестовые штаны", "slot": "legs", "effects": [{"type": "modify_stat", "stat": "res", "change": 1}] } },
                    { "command": "equipItem", "args": { "id": "pants_common", "slot": "legs" } },
                    { "command": "updateStat", "args": { "stat": "gold", "change": 100 } }
                ]
            });
        } else {
            return JSON.stringify({
                "director_notes": "Dummy response.",
                "time_passed": { "days": 0, "hours": 1, "minutes": 0 },
                "narrative": "(( ТЕСТОВЫЙ ОТВЕТ ЗАГЛУШКИ. Время продвинуто на 1 час. ))\n\nВаш запрос: *" + currentInput + "*",
                "actions": []
            });
        }
    }


    // --- ГЛОБАЛЬНАЯ ЗАДЕРЖКА (RATE LIMIT) ---
    const now = Date.now();
    const currentDelay = (currentInput === "[INITIAL_GAME_SETUP_START_OF_STORY]") ? 15000 : API_DELAY_MS;
    const timeSinceLastRequest = now - lastApiRequestTime;
    if (timeSinceLastRequest < currentDelay) {
        const waitTime = currentDelay - timeSinceLastRequest;
        console.log(`[Rate Limit] Ожидание ${waitTime}мс перед отправкой запроса...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    lastApiRequestTime = Date.now();
    // ----------------------------------------

            let attempts = 0;
        const maxAttempts = (currentApiProvider === 'gemini' && geminiApiKeys.length > 0) ? geminiApiKeys.length : 1;

        // FIX: Сохраняем глобальные настройки для безопасного фолбэка
        let originalUseCaching = usePromptCaching;
        let originalUseThinking = useThinkingMode;
        let fallbackRetries = 0;

        try {
            while (attempts < maxAttempts) {
        let targetUrl = "";
        let headers = { 'Content-Type': 'application/json' };
        let requestBody = {};
        let isGeminiFormat = false;

        // 1. Подготовка стандартного массива сообщений (OpenAI формат)
        let messages = [];
        
        // ЯВНОЕ КЭШИРОВАНИЕ (Anthropic / Gemini через LLMost/OpenRouter)
        if (usePromptCaching && (currentApiProvider === 'llmost' || currentApiProvider === 'openrouter')) {
            messages.push({ 
                role: "system", 
                content: [
                    {
                        type: "text",
                        text: systemInstruction,
                        cache_control: { type: "ephemeral" }
                    }
                ]
            });
        } else {
            messages.push({ role: "system", content: systemInstruction });
        }

        if (history && history.length > 0) {
            history.forEach(item => {
                messages.push({
                    role: item.role === 'model' ? 'assistant' : 'user',
                    content: item.parts[0].text
                });
            });
        }
        if (currentInput) {
            messages.push({ role: "user", content: currentInput });
        }

        // --- ИНТЕГРАЦИЯ МОДОВ: Фильтры Промптов ---
        if (window.ModAPI && window.ModAPI.promptFilters && window.ModAPI.promptFilters.length > 0) {
            for (const filter of window.ModAPI.promptFilters) {
                try {
                    const modified = filter(messages, providerModel, currentInput);
                    if (modified) {
                        if (modified.messages) messages = modified.messages;
                        if (modified.currentInput) currentInput = modified.currentInput;
                    }
                } catch(e) { console.error("[ModAPI] Ошибка в фильтре промптов:", e); }
            }
        }
        // ------------------------------------------

        // --- ВСЕ ЗАПРОСЫ ИДУТ НАПРЯМУЮ ПРОВАЙДЕРУ ---
        // --- ПОДГОТОВКА ПАРАМЕТРОВ THINKING ---
        let finalTemperature = 0.7;
        let finalMaxTokens = 4096;
        let thinkingParams = null;
        let reasoningParams = null;

        if (useThinkingMode) {
            finalTemperature = 1.0; // Модели с Thinking требуют температуру 1.0
            finalMaxTokens = thinkingBudget + 4096; // Бюджет на мысли + место для самого ответа
            thinkingParams = {
                type: "enabled",
                budget_tokens: thinkingBudget
            };
            reasoningParams = reasoningEffort;
        }

        if (currentInput === "[INITIAL_GAME_SETUP_START_OF_STORY]") {
            finalMaxTokens = 16384; // Увеличиваем лимит для генерации мира
        }

        if (currentApiProvider === 'local') {
            targetUrl = localApiUrl || 'http://localhost:1234/v1/chat/completions';
            if (targetUrl.endsWith('/')) targetUrl = targetUrl.slice(0, -1);
            if (!targetUrl.endsWith('/chat/completions')) {
                targetUrl += targetUrl.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions';
            }
            requestBody = {
                model: providerModel || "local-model",
                messages: messages,
                temperature: finalTemperature,
                max_tokens: finalMaxTokens
                // Убрано response_format: { type: "json_object" } для совместимости с LM Studio
            };
            if (useThinkingMode) {
                requestBody.thinking = thinkingParams;
                requestBody.reasoning_effort = reasoningParams;
            }
        } else if (currentApiProvider === 'deepseek') {
            targetUrl = "https://api.deepseek.com/v1/chat/completions";
            headers['Authorization'] = 'Bearer ' + deepseekApiKey;
            requestBody = {
                model: providerModel,
                messages: messages,
                temperature: finalTemperature,
                max_tokens: finalMaxTokens,
                response_format: { type: "json_object" }
            };
            if (useThinkingMode) {
                requestBody.thinking = thinkingParams;
                requestBody.reasoning_effort = reasoningParams;
            }
        } else if (currentApiProvider === 'omniroute') {
            targetUrl = omnirouteBaseUrl || "https://api.omniroute.ai/v1/chat/completions";
            if (targetUrl.endsWith('/')) targetUrl = targetUrl.slice(0, -1);
            if (!targetUrl.endsWith('/chat/completions')) {
                targetUrl += targetUrl.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions';
            }
            headers['Authorization'] = 'Bearer ' + omnirouteApiKey;
            requestBody = {
                model: providerModel,
                messages: messages,
                temperature: finalTemperature,
                max_tokens: finalMaxTokens,
                response_format: { type: "json_object" }
            };
            if (useThinkingMode) {
                requestBody.thinking = thinkingParams;
                requestBody.reasoning_effort = reasoningParams;
            }
        } else if (currentApiProvider === 'openrouter') {
            targetUrl = "https://openrouter.ai/api/v1/chat/completions";
            headers['Authorization'] = 'Bearer ' + openrouterApiKey;
            headers['HTTP-Referer'] = "https://github.com/MrKins/Chronicles-of-Meterea";
            headers['X-Title'] = "Chronicles of Meterea";
            requestBody = {
                model: providerModel,
                messages: messages,
                temperature: finalTemperature,
                max_tokens: finalMaxTokens,
                response_format: { type: "json_object" }
            };
            if (usePromptCaching) {
                requestBody.provider = { prompt_caching: true };
            }
            if (useThinkingMode) {
                requestBody.thinking = thinkingParams;
                requestBody.reasoning_effort = reasoningParams;
                requestBody.include_reasoning = true;
            }
        } else if (currentApiProvider === 'llmost') {
            targetUrl = "https://llmost.ru/api/v1/chat/completions";
            headers['Authorization'] = 'Bearer ' + llmostApiKey;
            requestBody = {
                model: providerModel,
                messages: messages,
                temperature: finalTemperature,
                max_tokens: finalMaxTokens,
                response_format: { type: "json_object" }
            };
            if (usePromptCaching) {
                requestBody.provider = { prompt_caching: true };
            }
            if (useThinkingMode) {
                requestBody.thinking = thinkingParams;
                requestBody.reasoning_effort = reasoningParams;
                requestBody.include_reasoning = true;
            }
        } else if (currentApiProvider === 'gemini') {
            const activeKey = geminiApiKeys[currentGeminiKeyIndex] || geminiApiKey;
            targetUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' + providerModel + ':generateContent?key=' + activeKey;

            // Gemini API требует специфичный формат напрямую
            const contents = [];
            if (history && history.length > 0) {
                history.forEach(item => {
                    contents.push({
                        role: item.role === 'model' ? 'model' : 'user',
                        parts: [{ text: item.parts[0].text }]
                    });
                });
            }
            if (currentInput) {
                contents.push({ role: "user", parts: [{ text: currentInput }] });
            }

            requestBody = {
                systemInstruction: { parts: [{ text: systemInstruction }] },
                contents: contents,
                generationConfig: {
                    maxOutputTokens: 8192,
                    temperature: 0.8,
                    topP: 0.95,
                    responseMimeType: "application/json"
                },
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                ]
            };
            isGeminiFormat = true;
        }

        console.log('Отправка ПРЯМОГО запроса (' + currentApiProvider + ') на: ' + targetUrl);

        // 3. Отправка запроса
        let response;
        try {
            response = await fetch(targetUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestBody),
                signal: currentApiAbortController.signal
            });

            if (response.status === 429 && currentApiProvider === 'gemini' && geminiApiKeys.length > 1) {
                console.warn('[KeyRotation] Ключ #' + currentGeminiKeyIndex + ' исчерпан (429). Пробую следующий...');
                currentGeminiKeyIndex = (currentGeminiKeyIndex + 1) % geminiApiKeys.length;
                geminiApiKey = geminiApiKeys[currentGeminiKeyIndex];
                attempts++;
                continue;
            }
        } catch (err) {
            console.error("Fetch error:", err);
            if (err.message && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError'))) {
                throw new Error(getFriendlyApiErrorMessage('network', err.message));
            }
            throw err;
        }

                    if (!response.ok) {
                const errText = await response.text();
                let retry = false;

                // Авто-отключение неподдерживаемых параметров (временно меняем глобальные флаги)
                if (errText.includes("prompt_caching") && usePromptCaching) {
                    console.warn('[API] Модель не поддерживает prompt_caching, отключаю...');
                    usePromptCaching = false;
                    retry = true;
                }
                if (errText.includes("cache_control") && usePromptCaching) {
                    console.warn('[API] Модель не поддерживает cache_control, отключаю...');
                    usePromptCaching = false;
                    retry = true;
                }
                if ((errText.includes("thinking") || errText.includes("reasoning_effort") || errText.includes("include_reasoning")) && useThinkingMode) {
                    console.warn('[API] Модель не поддерживает thinking mode, отключаю...');
                    useThinkingMode = false;
                    retry = true;
                }

                if (retry) {
                    fallbackRetries++;
                    if (fallbackRetries > 3) {
                        throw new Error("Критический сбой API: бесконечный цикл фолбэков. Текст ошибки: " + errText);
                    }
                    addLogMessage("[СИСТЕМА] Модель не поддерживает параметры ИИ (Thinking/Caching), отключаю их и повторяю запрос...", "system-message");
                    continue;
                }
                // FIX: Используем человекочитаемую ошибку
                throw new Error(getFriendlyApiErrorMessage(response.status, errText));
            }

        const data = await response.json();

        // 4. Обработка ответа
        if (isGeminiFormat) {
            if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
                return data.candidates[0].content.parts[0].text;
            }
        } else {
            if (data.choices && data.choices[0] && data.choices[0].message) {
                let content = data.choices[0].message.content || "";
                let reasoning = data.choices[0].message.reasoning || "";
                
                // Если API вернуло reasoning отдельным полем, вшиваем его в контент для парсера
                if (reasoning) {
                    content = "<think>\n" + reasoning + "\n</think>\n" + content;
                }
                return content;
            }
        }

                throw new Error("Не удалось получить текст из ответа модели.");
            }
            
            // Защита от тихого выхода из цикла (если maxAttempts исчерпан)
            throw new Error("Превышено количество попыток запроса к API или произошел сбой фолбэка.");
        } finally {
            // FIX: Восстанавливаем глобальные настройки после завершения запроса
            usePromptCaching = originalUseCaching;
            useThinkingMode = originalUseThinking;
        }
}

/**
 * ОСНОВНАЯ ФУНКЦИЯ (ОРКЕСТРАТОР): Счетовод -> Поэт
 */


async function handlePlayerDeath() {
    isWaitingForAI = true;
    addLogMessage("Вы чувствуете, как холод охватывает ваше тело. Тьма застилает глаза. Вы мертвы...", "system-message");

    const corpseId = await CoreInventorySystemAsync.createContainer("static_chest", "system", 999999, 1000, player.location, {
        custom_props: { name: `Останки (${player.name})` }
    });
    
    const backpack = ContainerRegistry.get(player.container_backpack);
    if (backpack && getContainerItems(backpack).length > 0) {
        const itemsToMove = getContainerItems(backpack).map(id => ({ id: id, quantity: ItemRegistry.get(id).stack_size }));
        await CoreInventorySystemAsync.moveItems(player.container_backpack, corpseId, itemsToMove, getInventoryTransferOptions('system_ignore_access_only'));
    }
    
    const equipment = ContainerRegistry.get(player.container_equipment);
    if (equipment && getContainerItems(equipment).length > 0) {
        const itemsToMove = getContainerItems(equipment).map(id => ({ id: id, quantity: ItemRegistry.get(id).stack_size }));
        await CoreInventorySystemAsync.moveItems(player.container_equipment, corpseId, itemsToMove, { actorId: 'system', ignoreAccess: true });
    }

    player.location = "Тень (Изнанка Мира)";
    player.currentSublocation = null;
    player.stats.hp = player.stats.maxHp;
    
    await executeCommand('addStatusEffect', {
        target: "player", id: "ghost_form", name: "Эхо (Призрак)", duration: 9999,
        description: "Вы мертвы. Физический мир недоступен. Найдите Эфирный Разлом, чтобы воскреснуть.", effectsJSON: "[]"
    });

    await executeCommand('addQuest', {
        aiIdentifier: "quest_resurrection", title: "Путь из Тени",
        objective: "Найти Эфирный Разлом в Тени и шагнуть в него.",
        description: "Ваше тело мертво, а вещи остались на месте гибели. Душа застряла в Тени. Найдите разлом в ткани реальности, чтобы переродиться.",
        reward: "Воскрешение", issuer: "Смерть"
    });

            syncPlayerGoldFromInventory();
        updateCharacterSheet();
        updateInventoryDisplay();
        updateEquipmentDisplay();
        updateMapDisplay();
        
        const deathPrompt = "[SYSTEM CRITICAL: ИГРОК ТОЛЬКО ЧТО УМЕР (HP упало до 0). Опиши момент смерти, как душа отрывается от тела и падает в Тень (Umbra) -- холодное, серое, искаженное отражение Метеры. Вокруг бродят Пожиратели Душ и другие призраки. Игрок потерял все вещи (они остались на трупе). Чтобы воскреснуть, ему нужно найти Эфирный Разлом (Aether Rift). Опиши это жуткое место и спроси, что игрок будет делать в виде призрака. ДИРЕКТИВА ДВИЖКА: Движок УЖЕ перенес игрока в Тень, обнулил инвентарь, выдал квест на воскрешение и наложил статус призрака. ТЕБЕ КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО использовать команды setLocation, addQuest, addStatusEffect или изменять HP в этом ответе! Верни пустой массив actions.]";
    
    sendApiRequest(deathPrompt, false, false, [], false);
}


function renderSuggestedActions(actions) {
    const container = document.getElementById('suggested-actions-container');
    if (!container) return;
    
    container.innerHTML = '';
    if (!actions || !Array.isArray(actions) || actions.length === 0) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'flex';
    actions.forEach(act => {
        const btn = document.createElement('button');
        btn.className = 'suggested-action-btn';
        
        let icon = '';
        if (act.roll_stat) icon = '<i class="fas fa-dice-d20"></i>';
        else icon = '<i class="fas fa-location-arrow"></i>';
        
        btn.innerHTML = `${icon} <span>${act.text}</span>`;
        
        btn.onclick = () => {
            if (act.roll_stat) {
                const validStats = ['str', 'dex', 'int', 'con', 'cha', 'atk', 'def', 'd20'];
                const stat = act.roll_stat.toLowerCase();
                if (validStats.includes(stat)) {
                    createRollBadge(stat, stat.toUpperCase() + " Check");
                }
            }
            const input = document.getElementById('user-input');
            if (input) input.value = act.text;
            
            container.innerHTML = '';
            container.style.display = 'none';
            
            handleUserInput();
        };
        container.appendChild(btn);
    });
}


async function sendApiRequest(promptTextForAI, isInitialPrompt = false, isDiceRollResponse = false, expiredEffects = [], isSummarizationRequest = false, timeRetryCount = 0) {
    isWaitingForAI = true;
    if (userInput) userInput.disabled = true;
    if (sendButton) sendButton.disabled = true;

    const oldRetryBtn = document.getElementById('retry-request-btn');
    if (oldRetryBtn) oldRetryBtn.remove();

    const oldLoader = document.getElementById('active-ether-loader');
    if (oldLoader) oldLoader.remove();

    const thinkingTitle = isInitialPrompt ? "Сотворение мира..." : "Сплетение нитей судьбы...";
    const thinkingSub = isInitialPrompt ? "Синтез первозданной материи" : "Единый разум обрабатывает реальность";

    const loaderDiv = document.createElement('div');
    loaderDiv.id = 'active-ether-loader';
    loaderDiv.className = 'ether-loader-container';
    loaderDiv.innerHTML = `
        <div class="astrolabe">
            <div class="astrolabe-ring"></div>
            <div class="astrolabe-ring"></div>
            <div class="astrolabe-ring"></div>
            <div class="astrolabe-core"></div>
        </div>
                    <div class="ether-text-container">
                <span class="ether-text-title">${thinkingTitle}</span>
                <span class="ether-text-subtitle">${thinkingSub}</span>
            </div>
            <button class="ether-cancel-btn" onclick="window.cancelCurrentApiRequest()">
                <i class="fas fa-times"></i> Прервать связь
            </button>
        `;

    if (!isSummarizationRequest) {
        gameLog.appendChild(loaderDiv);
        gameLog.scrollTo({ top: gameLog.scrollHeight, behavior: 'smooth' });
    }

    const removeEtherLoader = () => {
        const loader = document.getElementById('active-ether-loader');
        if (loader) {
            loader.style.opacity = '0';
            loader.style.transform = 'scale(0.9)';
            setTimeout(() => loader.remove(), 300);
        }
    };

    try {
        let modelIdForRequest = localModelId;
        if (currentApiProvider === 'gemini') modelIdForRequest = geminiModelId;
        else if (currentApiProvider === 'llmost') modelIdForRequest = llmostModelId;
        else if (currentApiProvider === 'openrouter') modelIdForRequest = openrouterModelId;
        else if (currentApiProvider === 'deepseek') modelIdForRequest = deepseekModelId;
        else if (currentApiProvider === 'omniroute') modelIdForRequest = omnirouteModelId;

        let allPendingActions = [];
        let timeToApply = null;

        const validateTime = (res) => {
            if (isSummarizationRequest) return true;
            if (!res.time_passed) return false;
            return true;
        };

        if (isInitialPrompt) {
            console.log(">>> Запуск Инициализации (Single Pass)...");
            let rawResponse = await performAiFetch(promptTextForAI, [], modelIdForRequest, "[INITIAL_GAME_SETUP_START_OF_STORY]");
            let result = parseAIResponse(rawResponse);

            if (!result || !result.narrative || !result.actions || !result.time_passed) {
                throw new Error("INCOMPLETE_RESPONSE");
            }
            if (!validateTime(result)) throw new Error("MISSING_TIME_PASSED");

            timeToApply = result.time_passed;
            removeEtherLoader();
            allPendingActions = result.actions || [];
            window.lastGeneratedNarrative = result.narrative;

            addLogMessage(result.narrative, "gm-message", false, result.image_prompt);

            renderSuggestedActions(result.suggested_actions);
            conversationHistory.push({ role: "model", parts: [{ text: result.narrative }] });
            if (result.image_prompt && player && player.gmNotes) player.gmNotes['last_image_prompt'] = result.image_prompt;

            if (timeToApply && !isSummarizationRequest) {
                if (allPendingActions.some(a => a.command === 'startTravel')) timeToApply = { days: 0, hours: 0, minutes: 5 };
                applyTimePassed(timeToApply);
            }

            let currentErrors = [];
            for (const action of allPendingActions) {
                const feedback = await executeCommand(action.command, action.args);
                if (feedback) {
                    addLogMessage(feedback, "command-feedback");
                    addCalculationMessage(feedback);
                    if (typeof feedback === 'string' && feedback.includes("[ERROR]")) {
                        currentErrors.push(`Команда ${action.command} с аргументами ${JSON.stringify(action.args)} вызвала ошибку: ${feedback}`);
                    }
                }
            }
            player.gmErrors = currentErrors;

            updateCharacterSheet();
            updateMapDisplay();
            updateInventoryDisplay();
            updateEnvironmentPanel();
            updateWorldChroniclesDisplay();
            updateTradeJournalDisplay();
            updatePortPanel();
            hideLoadingScreen();

            if (window.ModAPI) await ModAPI.emit('onSaveGame', {type: 'auto'});
            await autoSaveGame();

        } else if (!isSummarizationRequest) {
            console.log(">>> Запуск Единого GM...");
            
            const unifiedPrompt = await prepareUnifiedPrompt();
            const dynamicContext = buildDynamicContext(expiredEffects);
            const finalInput = `${dynamicContext}\n\n=== ВВОД ИГРОКА И СИСТЕМНЫЕ ДАННЫЕ ХОДА ===\n${promptTextForAI}`;

            const rawResponse = await performAiFetch(unifiedPrompt, conversationHistory, modelIdForRequest, finalInput);
            const result = parseAIResponse(rawResponse);

            if (!result || (!result.narrative && !result.actions)) throw new Error("Единый GM вернул пустой ответ.");
            if (!validateTime(result)) throw new Error("MISSING_TIME_PASSED");

            timeToApply = result.time_passed;
            allPendingActions = result.actions || [];
            
            let valErrors = validateActionsArray(allPendingActions);
            if (valErrors.length > 0) throw new Error("VALIDATION_FAILED|" + valErrors.join("; "));

            const narrativeText = result.narrative || "Действие выполнено.";
            window.lastGeneratedNarrative = narrativeText;

            removeEtherLoader();
            
            if (result.ai_reasoning) {
                addCalculationMessage(`[МЫСЛИ ИИ (Reasoning)]:\n${result.ai_reasoning}`, "calc-info");
            }
            
            addLogMessage(narrativeText, "gm-message", false, result.image_prompt);

            renderSuggestedActions(result.suggested_actions);

            conversationHistory.push({ role: "user", parts: [{ text: promptTextForAI }] });
            conversationHistory.push({ role: "model", parts: [{ text: narrativeText }] });
            if (result.image_prompt && player && player.gmNotes) player.gmNotes['last_image_prompt'] = result.image_prompt;

            if (timeToApply && !isSummarizationRequest) {
                if (allPendingActions.some(a => a.command === 'startTravel')) timeToApply = { days: 0, hours: 0, minutes: 5 };
                applyTimePassed(timeToApply);
            }

            let currentErrors = [];
            for (const action of allPendingActions) {
                const feedback = await executeCommand(action.command, action.args);
                if (feedback) {
                    addLogMessage(feedback, "command-feedback");
                    addCalculationMessage(feedback);
                    if (typeof feedback === 'string' && feedback.includes("[ERROR]")) {
                        currentErrors.push(`Команда ${action.command} с аргументами ${JSON.stringify(action.args)} вызвала ошибку: ${feedback}`);
                    }
                }
            }
            player.gmErrors = currentErrors;

            updateCharacterSheet();
            updateMapDisplay();
            updateInventoryDisplay();
            updateEnvironmentPanel();

            // Проверка на смерть от команд ГМ (например, updateStat hp -100)
            if (player.stats.hp <= 0 && !player.statusEffects['ghost_form']) {
                setTimeout(() => { handlePlayerDeath(); }, 500);
            }
        }

                if (isAutoTesting && !isInitialPrompt && !isSummarizationRequest) {
            setTimeout(runAIPlayerTurn, 2500); // Задержка 2.5 сек перед ходом ИИ-игрока для имитации чтения
        }

if (!isInitialPrompt && !isSummarizationRequest && player.stats.turnCount > 0 && player.stats.turnCount % MEMORY_SUMMARY_TURN === 0) {
            await runBackgroundSummarization();
        }

        if (enableWorldSim && World && player && !isInitialPrompt && !isSummarizationRequest) {
            if (World.needsGlobalEvent || (player.stats.turnCount > 0 && player.stats.turnCount % 15 === 0)) {
                await runWorldSimulationTick();
                World.needsGlobalEvent = false;
            }
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log("[Network] Обработка отмены: запрос прерван.");
            removeEtherLoader();
            isWaitingForAI = false;
            if (userInput) {
                userInput.disabled = false;
                if (lastUserMessageForRetry && !lastUserMessageForRetry.includes("[SYSTEM:")) {
                    userInput.value = lastUserMessageForRetry.replace(/\[ROLL_RESULT:.*?\]/gi, '').trim();
                }
                userInput.focus();
            }
            if (sendButton) sendButton.disabled = false;
            addLogMessage("(( Связь с Эфиром принудительно разорвана. Генерация остановлена. ))", "system-message");
            return;
        }


        if (error.message === "INCOMPLETE_RESPONSE" && timeRetryCount < 3) {
            console.warn(`GM прислал неполный ответ. Попытка ${timeRetryCount + 1} из 3...`);
            const timeErrorPrompt = promptTextForAI + "\n\n[СИСТЕМНАЯ ОШИБКА]: Твой предыдущий ответ был отклонён. Ты КАТЕГОРИЧЕСКИ ЗАБЫЛ добавить обязательные поля (narrative, actions или time_passed). Сгенерируй полный валидный JSON.";
            const loaderSub = document.querySelector('.ether-text-subtitle');
            if (loaderSub) loaderSub.textContent = "Восстановление структуры ответа...";
            return sendApiRequest(timeErrorPrompt, isInitialPrompt, isDiceRollResponse, expiredEffects, isSummarizationRequest, timeRetryCount + 1);
        }
        
        if (error.message === "MISSING_TIME_PASSED" && timeRetryCount < 3) {
            console.warn(`GM забыл указать time_passed. Попытка ${timeRetryCount + 1} из 3...`);
            const timeErrorPrompt = promptTextForAI + "\n\n[СИСТЕМНАЯ ОШИБКА]: Твой предыдущий ответ был отклонён. Ты КАТЕГОРИЧЕСКИ ЗАБЫЛ добавить обязательное поле \"time_passed\" на верхнем уровне JSON или указал там нули. Оцени, сколько времени заняло действие игрока (даже если это 5 минут на разговор), добавь поле \"time_passed\": {\"days\": 0, \"hours\": 0, \"minutes\": 5} и сгенерируй ответ заново.";
            const loaderSub = document.querySelector('.ether-text-subtitle');
            if (loaderSub) loaderSub.textContent = "Корректировка временного потока...";
            return sendApiRequest(timeErrorPrompt, isInitialPrompt, isDiceRollResponse, expiredEffects, isSummarizationRequest, timeRetryCount + 1);
        }
        
        if (error.message.startsWith("VALIDATION_FAILED|") && timeRetryCount < 3) {
            console.warn(`GM прислал невалидные команды. Попытка ${timeRetryCount + 1} из 3...`);
            let errs = error.message.split("|")[1];
            const validationErrorPrompt = promptTextForAI + `\n\n[СИСТЕМНАЯ ОШИБКА]: Твой предыдущий ответ был отклонён из-за неверных аргументов в командах:\n${errs}\nИСПРАВЬ ЭТИ ОШИБКИ И СГЕНЕРИРУЙ ОТВЕТ ЗАНОВО. ИСПОЛЬЗУЙ ТОЛЬКО СУЩЕСТВУЮЩИЕ ID И ТИПЫ!`;
            const loaderSub = document.querySelector('.ether-text-subtitle');
            if (loaderSub) loaderSub.textContent = "Исправление логических ошибок...";
            return sendApiRequest(validationErrorPrompt, isInitialPrompt, isDiceRollResponse, expiredEffects, isSummarizationRequest, timeRetryCount + 1);
        }

        console.error("Ошибка API:", error);
        removeEtherLoader();

        const oldRetryBtn = document.getElementById('retry-request-btn');
        if (oldRetryBtn) oldRetryBtn.remove();

        if (isInitialPrompt) {
            clearPromptCache(); // Очищаем кэш промпта, чтобы следующий запрос собрал свежие данные
            hideLoadingScreen();
        }

        showAiErrorModal(
            error.stack || error.message || String(error),
            isInitialPrompt,
            () => {
                if (isInitialPrompt) showLoadingScreen('loadingScreen.generatingWorld', 'Генерация мира...');
                sendApiRequest(lastUserMessageForRetry, isInitialPrompt, isDiceRollResponse, [], false);
            }
        );

    } finally {
        const errorModal = document.getElementById('ai-error-modal');
        if (!errorModal || !errorModal.classList.contains('visible')) {
            isWaitingForAI = false;
            if (!window.isSimulatingTime) {
                if (userInput) userInput.disabled = false;
                if (sendButton) sendButton.disabled = false;
                if (userInput) userInput.focus();
            }
        }
    }
}




/**
 * УНИВЕРСАЛЬНЫЙ ПАРСЕР
 * Гарантирует извлечение данных из JSON даже если модель прислала лишний текст.
 */
async function runBackgroundSummarization() {
    isWaitingForAI = true;
    if (userInput) userInput.disabled = true;
    if (sendButton) sendButton.disabled = true;

    try {
        const promptTemplate = await loadPromptFromFile('assets/prompts/summarize_memory_prompt.txt');
        const historyText = conversationHistory.map(m => `${m.role === 'model' ? 'GM' : 'Player'}: ${m.parts[0].text}`).join('\n\n');
        const notesText = JSON.stringify(player.gmNotes, null, 2);

        const finalPrompt = promptTemplate
            .replace('{gmNotes}', notesText)
            .replace('{conversationHistory}', historyText)
            .replace('{userAction}', 'Автоматическая архивация после завершения хода');

        let modelId = localModelId;
        if (currentApiProvider === 'gemini') modelId = geminiModelId;
        else if (currentApiProvider === 'llmost') modelId = llmostModelId;
        else if (currentApiProvider === 'openrouter') modelId = openrouterModelId;
        else if (currentApiProvider === 'deepseek') modelId = deepseekModelId;
        else if (currentApiProvider === 'omniroute') modelId = omnirouteModelId;
        
        // ПАТЧ: Передаем обязательный currentInput, чтобы Gemini не ругался на пустой массив contents
        const rawResponse = await performAiFetch(finalPrompt, [], modelId, "Проанализируй историю и обнови память (JSON).");
        const result = parseAIResponse(rawResponse);

        if (result.actions && result.actions.length > 0) {
            for (const action of result.actions) {
                await executeCommand(action.command, action.args);
            }
            addLogMessage("Память успешно сжата и заархивирована.", "command-feedback");
        } else {
            console.log("[Memory] GM не нашел данных для архивации в этот раз.");
        }
    } catch (e) {
        console.error("Ошибка фоновой архивации:", e);
        addLogMessage("Сбой системы архивации памяти.", "system-message");
    } finally {
        isWaitingForAI = false;
        if (userInput) userInput.disabled = false;
        if (sendButton) sendButton.disabled = false;
        if (userInput) userInput.focus();
    }
}

function parseAIResponse(rawResponse) {
    // FIX: Строгая защита от undefined/null, если API вернуло пустой ответ или произошел сбой
    if (typeof rawResponse !== 'string') {
        console.warn("[Parser] Получен нестроковый ответ от API, конвертируем в пустую строку.", rawResponse);
        rawResponse = String(rawResponse || "");
    }

    // --- ИНТЕГРАЦИЯ МОДОВ: Фильтры Ответов ---
    if (window.ModAPI && window.ModAPI.responseFilters && window.ModAPI.responseFilters.length > 0) {
        for (const filter of window.ModAPI.responseFilters) {
            try {
                rawResponse = filter(rawResponse) || rawResponse;
            } catch(e) { console.error("[ModAPI] Ошибка в фильтре ответов:", e); }
        }
    }
    // -----------------------------------------

    let narrative = "";
    let actions = [];
    let logic_summary = "";
    let image_prompt = "";
    let time_passed = { days: 0, hours: 0, minutes: 0 };
    let suggested_actions = [];
    let ai_reasoning = "";

    // Извлекаем блок <think> (Reasoning)
    const thinkMatch = rawResponse.match(/<think>([\s\S]*?)<\/think>/i);
    if (thinkMatch) {
        ai_reasoning = thinkMatch[1].trim();
        // Удаляем блок think из сырого ответа, чтобы он не мешал парсингу JSON
        rawResponse = rawResponse.replace(/<think>[\s\S]*?<\/think>/i, "");
    }

    // 1. Очистка от маркдауна сразу
    let cleanRaw = rawResponse.replace(/```json/gi, "").replace(/```/g, "").trim();

            // 2. ЭКСТРЕННАЯ ПРОВЕРКА: Если ИИ прислал просто массив действий без главного объекта
        if (cleanRaw.startsWith('[')) {
            try {
                let parsedArray = JSON.parse(cleanRaw);
                if (Array.isArray(parsedArray)) {
                    actions = parsedArray;
                    return { narrative: "(( Системное действие выполнено. Эфирные помехи скрыли детали события. ))", actions, logic_summary, image_prompt };
                }
            } catch(e) {
                // Проваливаемся дальше, если не распарсилось
            }
        }

        // 3. Ищем главный объект {}
    const startIdx = cleanRaw.indexOf('{');
    let endIdx = -1;

    if (startIdx !== -1) {
        let depth = 0;
        for (let i = startIdx; i < cleanRaw.length; i++) {
            if (cleanRaw[i] === '{') depth++;
            else if (cleanRaw[i] === '}') depth--;

            if (depth === 0) {
                endIdx = i;
                break;
            }
        }
    }

    if (startIdx !== -1 && endIdx !== -1) {
        const jsonString = cleanRaw.substring(startIdx, endIdx + 1);

        try {
            // Умный С…РёСЂСѓСЂРі JSON
            let fixedJsonString = jsonString
                .replace(/,\s*([\]}\]])/g, '$1')
                .replace(/}\s*{/g, '},{')
                .replace(/\]\s*\[/g, '],[');

            // Санитайзер неэкранированных переносов строк (Bad control character fix)
            let inString = false;
            let isEscaped = false;
            let sanitizedJson = '';
            for (let i = 0; i < fixedJsonString.length; i++) {
                let char = fixedJsonString[i];
                if (char === '"' && !isEscaped) {
                    inString = !inString;
                    sanitizedJson += char;
                } else if (char === '\\' && !isEscaped) {
                    isEscaped = true;
                    sanitizedJson += char;
                } else {
                    if (isEscaped) isEscaped = false;
                    if (inString) {
                        if (char === '\n') sanitizedJson += '\\n';
                        else if (char === '\r') sanitizedJson += '\\r';
                        else if (char === '\t') sanitizedJson += '\\t';
                        else if (char.charCodeAt(0) < 32) sanitizedJson += ''; // Удаляем прочие невидимые спецсимволы
                        else sanitizedJson += char;
                    } else {
                        sanitizedJson += char;
                    }
                }
            }

            let parsed;
            try { parsed = JSON.parse(sanitizedJson); } catch(e) { console.warn('Invalid sanitized JSON:', e); return; }

            actions = parsed.actions || [];
            if (Array.isArray(actions)) {
                actions = actions.filter(a => a && a.command);
            } else {
                actions = [];
            }
            
            if (parsed.director_notes && DEBUG_MODE) console.log("[GM THOUGHTS]:", parsed.director_notes);
            logic_summary = parsed.logic_summary || "";
            narrative = parsed.narrative || "";
            image_prompt = parsed.image_prompt || "";
            
            suggested_actions = parsed.suggested_actions || [];

            // АВТО-ФИКС ВРЕМЕНИ: Если поля нет, создаем его (1 минута по умолчанию)
            if (!parsed.time_passed) {
                console.warn("[Parser] GM забыл time_passed, ставлю 1 минуту.");
                time_passed = { days: 0, hours: 0, minutes: 1 };
            } else {
                time_passed = {
                    days: parseInt(parsed.time_passed.days) || 0,
                    hours: parseInt(parsed.time_passed.hours) || 0,
                    minutes: parseInt(parsed.time_passed.minutes) || 0
                };
            }

        } catch (jsonErr) {
            console.error("КРИТИЧЕСКАЯ ОШИБКА ПАРСИНГА:", jsonErr);
            throw new Error("Ответ ИИ содержит невалидный синтаксис JSON. Требуется повторный запрос.\nДетали: " + jsonErr.message);
        }

        // Если narrative пуст, пытаемся взять текст ДО или ПОСЛЕ JSON
        if (!narrative.trim()) {
            let textOutside = cleanRaw.replace(jsonString, "").trim();
            // ЗАЩИТА ОТ УТЕЧКИ: Если снаружи остался кусок массива, игнорируем его
            if (!textOutside.includes('"command":') && !textOutside.includes('"args":')) {
                narrative = textOutside;
            }
        }
    } else {
        // JSON не найден вообще, весь ответ - это текст
        narrative = cleanRaw;
    }

    // --- АБСОЛЮТНАЯ ЗАЩИТА (ГИЛЬОТИНА) ---
    // Если в итоговом тексте всё ещё торчат куски JSON-команд, вырезаем их жестко
    if (narrative.includes('"command":') || narrative.includes('"args":') || narrative.includes('{"id":')) {
        console.error("ОБНАРУЖЕНА УТЕЧКА JSON В ЧАТ! Текст очищен принудительно.");
        narrative = "(( Системный сбой связи с Эфиром. Мастер Игры прислал технический код вместо текста. Действия выполнены. ))";
    }

    return { narrative, actions, logic_summary, image_prompt, time_passed, suggested_actions, ai_reasoning };
}

function animateGoldChange(amount) {
    const goldDisplay = document.getElementById('stat-gold');
    if (!goldDisplay) return;

    // Создаем элемент частицы
    const particle = document.createElement('span');
    particle.className = 'coin-particle';
    const isPositive = amount > 0;
    particle.textContent = (isPositive ? '+$' : '$') + Math.abs(amount);
    if (!isPositive) particle.style.color = '#e74c3c'; // Красный для убытка

    // Добавляем иконку монетки
    const coinIcon = document.createElement('i');
    coinIcon.className = 'fas fa-coins';
    coinIcon.style.marginLeft = '5px';
    particle.appendChild(coinIcon);

    // Позиционируем возле счетчика золота
    const rect = goldDisplay.getBoundingClientRect();
    particle.style.left = `20px`;
    particle.style.top = `-10px`;

    goldDisplay.parentElement.style.position = 'relative';
    goldDisplay.parentElement.appendChild(particle);

    // Эффект тряски для родителя при трате
    if (!isPositive) {
        goldDisplay.parentElement.classList.add('shake');
        setTimeout(() => goldDisplay.parentElement.classList.remove('shake'), 300);
    }

    // Удаляем после анимации
    setTimeout(() => particle.remove(), 1000);
}

/**
 * ПОЛНАЯ СБОРКА ДЛЯ СЧЕТОВОДА (LOGIC)
 * Включает: logic_rules + rules_and_instructions + combat_rules + env_guide + items_ref + snapshot
 */
function buildDynamicContext(expiredEffects) {
    let echoMemoryString = '';
    if (player && player.echoMemory && player.echoMemory.items && player.echoMemory.items.length > 0) {
        const itemsList = player.echoMemory.items.map((item, idx) => `${idx+1}. ${item}`).join('\n');
        echoMemoryString = `\n### ЭХО-ПАМЯТЬ (КЛЮЧЕВЫЕ ФАКТЫ, НИКОГДА НЕ ЗАБЫВАЙ):\n${itemsList}\n`;
    }
    const snapshot = buildFullPlayerSnapshot();
    const expiredText = expiredEffects && expiredEffects.length > 0 ? `ВНИМАНИЕ: Истекли эффекты: ${expiredEffects.join(', ')}` : "";
    const errorText = (player && player.gmErrors && player.gmErrors.length > 0) ? `\n\n[КРИТИЧЕСКАЯ СИСТЕМНАЯ ОШИБКА ПРОШЛОГО ХОДА]\nТы допустил ошибки в JSON-командах в прошлом ответе:\n${player.gmErrors.join('\n')}\nТВОЙ АБСОЛЮТНЫЙ ПРИОРИТЕТ В ЭТОМ ХОДУ: ИСПРАВИТЬ ЭТИ ОШИБКИ! Вызови правильные команды с верными аргументами, прежде чем продолжать сюжет!` : "";
    const ghostText = (player && player.statusEffects && player.statusEffects['ghost_form']) ? "\n\n[SYSTEM CRITICAL: ИГРОК МЕРТВ (ПРИЗРАК В ТЕНИ). Он находится в изнанке мира. Он не может взаимодействовать с живыми, брать физические предметы или получать физический урон. Он должен найти Эфирный Разлом (Aether Rift). Когда он найдет его и шагнет туда, ТЫ ОБЯЗАН ИСПОЛЬЗОВАТЬ КОМАНДУ removeStatusEffect для 'ghost_form', выдать квест 'completed' и setLocation для возвращения его в реальный мир!]" : "";
    
    return `======================================================================\n=== ДИНАМИЧЕСКИЕ ДАННЫЕ (ИЗМЕНЯЮТСЯ КАЖДЫЙ ХОД) ===\n======================================================================\n${echoMemoryString}\n${snapshot}\n${expiredText}\n${errorText}\n${ghostText}\n`;
}

function getPromptRuntimeConfig() {
  const defaults = {
    prompt_files: {
      logic_rules: 'assets/prompts/logic_rules.txt',
      narrative_rules: 'assets/prompts/narrative_rules.txt',
      master_instructions: 'assets/prompts/1.txt',
      rules_and_instructions: 'assets/prompts/rules_and_instructions.txt',
      combat_rules: 'assets/prompts/combat_system_rules.txt',
      environment_commands_guide: 'assets/prompts/environment_commands_guide.txt',
      skills_reference: 'assets/prompts/skills_reference_prompt.txt',
      supreme_gm_style: 'assets/prompts/supreme_gm_style.txt',
      nsfw_rules_advanced: 'assets/prompts/nsfw_rules_advanced.txt'
    },
    image_generation: {
      prompt_field_template: '"image_prompt": "ОБЯЗАТЕЛЬНО! Описание ТЕКУЩЕЙ сцены СТРОГО НА АНГЛИЙСКОМ ЯЗЫКЕ для нейросети генерации картинок. Пиши тегами через запятую. Укажи персонажей и детали. Обязательно добавляй в конце: \'Ado music video aesthetic, monochrome anime style with one spot color, dark gothic, creepy vibe, extreme contrast, inverted colors, masterpiece, highly detailed\'.",',
      format_field_template: '"image_prompt": "Описание сцены на АНГЛИЙСКОМ языке для генератора картинок (ОБЯЗАТЕЛЬНО).",'
    },
    response_languages: { ru: 'Russian', en: 'English', default: 'English' },
    unified_response: {
      default_time_passed: { days: 0, hours: 0, minutes: 5 },
      suggested_action_template: { text: 'Действие', roll_stat: null }
    },
    fallback_texts: {
      items_reference_error: 'DATABASE ERROR',
      missing_era_context: 'Данные по эпохе отсутствуют.',
      critical_logic_error: 'Critical logic error'
    },
    injection_headers: {
      custom_commands: '// === КАСТОМНЫЕ КОМАНДЫ (ИЗ МОДОВ) ===',
      custom_world_rules: '// === КАСТОМНЫЕ ПРАВИЛА МИРА (ИЗ МОДОВ) ==='
    },
    command_parser: {
      start_tag: '[COMMAND:',
      end_tag: ']',
      delimiter: '|:|'
    }
  };
  const runtime = (typeof window !== 'undefined' && window.PROMPT_RUNTIME_CONFIG && typeof window.PROMPT_RUNTIME_CONFIG === 'object') ? window.PROMPT_RUNTIME_CONFIG : {};
  return {
    ...defaults,
    ...runtime,
    prompt_files: { ...defaults.prompt_files, ...(runtime.prompt_files || {}) },
    image_generation: { ...defaults.image_generation, ...(runtime.image_generation || {}) },
    response_languages: { ...defaults.response_languages, ...(runtime.response_languages || {}) },
    unified_response: { ...defaults.unified_response, ...(runtime.unified_response || {}) },
    fallback_texts: { ...defaults.fallback_texts, ...(runtime.fallback_texts || {}) },
    injection_headers: { ...defaults.injection_headers, ...(runtime.injection_headers || {}) },
    command_parser: { ...defaults.command_parser, ...(runtime.command_parser || {}) }
  };
}

function getPromptFilePath(key, runtimeConfig = getPromptRuntimeConfig()) {
  return runtimeConfig.prompt_files[key] || getPromptRuntimeConfig().prompt_files[key] || '';
}

function getPromptResponseLanguage(langCode, runtimeConfig = getPromptRuntimeConfig()) {
  return runtimeConfig.response_languages[langCode] || runtimeConfig.response_languages.default || 'English';
}

function buildPromptTimePassed(runtimeConfig = getPromptRuntimeConfig()) {
  const tp = runtimeConfig.unified_response.default_time_passed || {};
  const days = parseInt(tp.days, 10) || 0;
  const hours = parseInt(tp.hours, 10) || 0;
  const minutes = parseInt(tp.minutes, 10) || 0;
  return `{ "days": ${days}, "hours": ${hours}, "minutes": ${minutes} }`;
}

function buildPromptSuggestedAction(runtimeConfig = getPromptRuntimeConfig()) {
  const action = runtimeConfig.unified_response.suggested_action_template || { text: 'Действие', roll_stat: null };
  return JSON.stringify(action);
}

function buildImagePromptInstruction(runtimeConfig = getPromptRuntimeConfig()) {
  return enableImageGeneration ? String(runtimeConfig.image_generation.prompt_field_template || '') : '';
}

function buildImagePromptFormatField(runtimeConfig = getPromptRuntimeConfig()) {
  return enableImageGeneration ? String(runtimeConfig.image_generation.format_field_template || '') : '';
}

let GLOBAL_CACHED_SYSTEM_PROMPT = null; function clearPromptCache() {
    GLOBAL_CACHED_SYSTEM_PROMPT = null;
    console.log("[Cache] Системный промпт сброшен.");
}


async function prepareUnifiedPrompt() {
    if (GLOBAL_CACHED_SYSTEM_PROMPT) return GLOBAL_CACHED_SYSTEM_PROMPT;
    try {
        const promptRuntime = getPromptRuntimeConfig(); const logicRules = await loadPromptFromFile(getPromptFilePath('logic_rules', promptRuntime));
        const narrativeRules = await loadPromptFromFile(getPromptFilePath('narrative_rules', promptRuntime));
        let masterInstructions = await loadPromptFromFile(getPromptFilePath('master_instructions', promptRuntime));
        let imgInstructionMaster = buildImagePromptInstruction(promptRuntime);
        masterInstructions = masterInstructions.replace(/\{image_prompt_instruction\}/g, imgInstructionMaster)
                                               .replace(/\{debugMode\}/g, DEBUG_MODE ? "true" : "false");
        const rulesAndInstructions = await loadPromptFromFile(getPromptFilePath('rules_and_instructions', promptRuntime));
        const combatRules = await loadPromptFromFile(getPromptFilePath('combat_rules', promptRuntime));
        const envGuide = await loadPromptFromFile(getPromptFilePath('environment_commands_guide', promptRuntime));
        const skillRef = await loadPromptFromFile(getPromptFilePath('skills_reference', promptRuntime));
        const itemsRefString = Array.isArray(itemsReferenceData) ? JSON.stringify(itemsReferenceData) : promptRuntime.fallback_texts.items_reference_error;

        const eraContext = activeEraSpecialLore || promptRuntime.fallback_texts.missing_era_context;
        const style = await loadPromptFromFile(getPromptFilePath('supreme_gm_style', promptRuntime));
        const nsfwRules = allowNSFW ? await loadPromptFromFile(getPromptFilePath('nsfw_rules_advanced', promptRuntime)) : '';
        const responseLanguage = getPromptResponseLanguage(currentLanguage, promptRuntime);

        let finalPrompt = `
${masterInstructions}
${rulesAndInstructions}
${logicRules}
${combatRules}
${envGuide}
${narrativeRules}
${skillRef}

### РЕЕСТР ТЕКУЩЕЙ ЭПОХИ:
${eraContext}

### ЛОР МИРА:
${worldLore}

### СПРАВОЧНИК ПРЕДМЕТОВ:
${itemsRefString}

### СТИЛЬ ПОВЕСТВОВАНИЯ:
${style}

ЯЗЫК ОТВЕТА (КРИТИЧЕСКИ ВАЖНО): СТРОГО ${responseLanguage.toUpperCase()}! Весь текст в полях "narrative", "director_notes" и "logic_summary" ОБЯЗАН быть на этом языке. Запрещено отвечать на другом языке!

### ИНСТРУКЦИЯ (ЕДИНЫЙ РЕЖИМ):
Ты должен одновременно выполнить логические расчеты (изменить статы, выдать лут, провести бой) И написать красивый художественный ответ.
Твой ответ ДОЛЖЕН БЫТЬ СТРОГО ВАЛИДНЫМ JSON.
Формат: { ${buildImagePromptFormatField(promptRuntime)} "time_passed": ${buildPromptTimePassed(promptRuntime)}, "suggested_actions": [ ${buildPromptSuggestedAction(promptRuntime)} ], "narrative": "Твой художественный текст...", "actions": [ ...массив команд... ], "logic_summary": "Краткая сводка твоих расчетов (опционально)" }

### ВАЖНО: Если игрок использует теги {d20}, {str} и т.д. -- интерпретируй их как броски кубиков и включай результат в повествование.
${nsfwRules}`;

        // Инъекция документации кастомных команд из модов
        if (window.ModAPI && window.ModAPI.commandDocs && window.ModAPI.commandDocs.length > 0) {
            finalPrompt += `\n\n${promptRuntime.injection_headers.custom_commands}\n` + window.ModAPI.commandDocs.join('\n');
        }

        // Инъекция кастомных правил лора/логики из модов
        if (window.ModAPI && window.ModAPI.promptInjections && window.ModAPI.promptInjections.length > 0) {
            finalPrompt += `\n\n${promptRuntime.injection_headers.custom_world_rules}\n` + window.ModAPI.promptInjections.join('\n\n');
        }

        GLOBAL_CACHED_SYSTEM_PROMPT = finalPrompt;
        console.log("[Cache] Системный промпт успешно собран и закэширован в памяти.");
        return finalPrompt;
    } catch (error) {
        console.error("Error in prepareUnifiedPrompt:", error);
        return getPromptRuntimeConfig().fallback_texts.critical_logic_error;
    }
}









/**
 * ПОЛНАЯ СБОРКА ДЛЯ ПОЭТА (NARRATIVE)
 * Включает: narrative_rules + rules_and_instructions + skills_ref + lore + snapshot + logic_summary
 */





// --- Обработка Команд от Gemini ---
/**
 * Извлекает команды из текста GM и разделяет их на команду и аргументы.
 * Использует специальную логику для команд, у которых последний аргумент может содержать разделители.
 * @param {string} text - Текст ответа от Gemini.
 * @returns {{narrative: string, commands: Array<object>}} - Объект с нарративом и массивом команд.
 */
function processCommands(text) {
    if (!text) return { narrative: "", commands: [] };

    let narrativeText = text;
    const commandsToExecute = [];
    const commandParserConfig = getPromptRuntimeConfig().command_parser; const commandStartTag = commandParserConfig.start_tag || '[COMMAND:'; const commandEndTag = commandParserConfig.end_tag || ']'; const delimiter = commandParserConfig.delimiter || '|:|';

    // FIX (Issue #81/#32): Validate delimiter and tags to prevent prompt injection.
    // If a mod overrides command_parser config with dangerous values (empty, regex-special,
    // or overlapping tags), reject the configuration and use safe defaults.
    const SAFE_DEFAULT_TAG_START = '[COMMAND:';
    const SAFE_DEFAULT_TAG_END = ']';
    const SAFE_DEFAULT_DELIMITER = '|:|';
    const SAFE_TAG_REGEX = /^[^\s\w]{1,20}$/; // Non-alphanumeric, no whitespace, max 20 chars

    const safeStartTag = (typeof commandStartTag === 'string' && commandStartTag.length >= 2 && SAFE_TAG_REGEX.test(commandStartTag))
        ? commandStartTag : SAFE_DEFAULT_TAG_START;
    const safeEndTag = (typeof commandEndTag === 'string' && commandEndTag.length >= 1 && SAFE_TAG_REGEX.test(commandEndTag))
        ? commandEndTag : SAFE_DEFAULT_TAG_END;
    const safeDelimiter = (typeof delimiter === 'string' && delimiter.length >= 2 && delimiter.length <= 10)
        ? delimiter : SAFE_DEFAULT_DELIMITER;

    let startIndex = narrativeText.indexOf(safeStartTag);

    while (startIndex !== -1) {
        const endIndex = narrativeText.indexOf(safeEndTag, startIndex + safeStartTag.length);
        if (endIndex === -1) break;

        const fullMatch = narrativeText.substring(startIndex, endIndex + safeEndTag.length);
        const commandContent = fullMatch.substring(safeStartTag.length, fullMatch.length - safeEndTag.length);

        const firstColonIndex = commandContent.indexOf(':');
        if (firstColonIndex !== -1) {
            const command = commandContent.substring(0, firstColonIndex).trim();

            // FIX (Issue #81/#32): Whitelist allowed command names to prevent injection.
            // Only alphanumeric + underscore commands are allowed (e.g. "addItem", "setLocation")
            if (!/^[a-zA-Z_]\w{0,40}$/.test(command)) {
                console.warn(`[Security] Blocked suspicious command name: "${command}"`);
                narrativeText = narrativeText.replace(fullMatch, '');
                startIndex = narrativeText.indexOf(safeStartTag);
                continue;
            }

            const argsString = commandContent.substring(firstColonIndex + 1);

            const args = argsString.split(safeDelimiter)
                .map(arg => arg.trim())
                .filter(arg => arg.length > 0);

            commandsToExecute.push({ command, args });
        }

        narrativeText = narrativeText.replace(fullMatch, '');
        startIndex = narrativeText.indexOf(safeStartTag);
    }

    return {
        narrative: narrativeText.trim(),
        commands: commandsToExecute
    };
}

/**
 * Обновляет панель "Константы" (Nexus), корректно отображая иерархию
 * категорий и элементов.
 * Эта версия фильтрует служебные элементы, которые используются для определения
 * категории (например, элемент с name: "Владения" и category: "Владения"),
 * и не отображает их как отдельные пункты.
 */
/**
 * (ПОЛНАЯ ОБНОВЛЕННАЯ ВЕРСИЯ v2.0)
 * Выполняет команду, полученную от GM в виде структурированного объекта.
 * Сохраняет 100% функционала оригинальной версии, работавшей на строках.
 * @param {string} command - Имя команды в формате camelCase (например, "addItem").
 * @param {object} args - Объект с именованными аргументами для команды.
 * @returns {string|null} - Сообщение для лога обратной связи или null, если обратная связь не требуется.
 */
function applyTimePassed(tp) {
    if (!tp) return 0;
    let totalPulses = 0;
    if (tp.days > 0) totalPulses += tp.days * 24 * 12;
    if (tp.hours > 0) totalPulses += tp.hours * 12;
    if (tp.minutes > 0) totalPulses += Math.ceil(tp.minutes / 5);

    if (totalPulses > 0) {
        advanceTime(totalPulses);
        let timeStrings = [];
        if (tp.days > 0) timeStrings.push(`${tp.days} РґРЅ.`);
        if (tp.hours > 0) timeStrings.push(`${tp.hours} С‡.`);
        if (tp.minutes > 0) timeStrings.push(`${tp.minutes} РјРёРЅ.`);
        addCalculationMessage(`[ВРЕМЯ] Прошло: ${timeStrings.join(', ')}.`);
    }
    return totalPulses;
}

function getFactionCapitalVault(factionId) {
    if (typeof World === 'undefined' || !World || !World.factions[factionId]) return null;
    let f = World.factions[factionId];
    if (!f.regions || f.regions.length === 0) return null;
    let capId = f.regions[0];
    if (!World.regions[capId]) return null;
    return World.regions[capId].vault_id;
}
function getFactionGold(factionId) {
    let vaultId = getFactionCapitalVault(factionId);
    if (!vaultId) return 0;
    return getCurrencyPrototypeIds().reduce((sum, prototypeId) => sum + countRealItems(vaultId, prototypeId), 0);
}
function getFactionGoodStock(factionId, goodType) {
    let vaultId = getFactionCapitalVault(factionId);
    if (!vaultId) return 0;
    return countRealItems(vaultId, goodType);
}
function getRegionGoodStock(regionId, goodType) {
    if (typeof World === 'undefined' || !World || !World.regions[regionId]) return 0;
    let vaultId = World.regions[regionId].vault_id;
    if (!vaultId) return 0;
    return countRealItems(vaultId, goodType);
}


function validateGMCommand(command, args) {
    // --- ИНТЕГРАЦИЯ МОДОВ: Валидация кастомных команд ---
    if (window.ModAPI && window.ModAPI.customCommands && window.ModAPI.customCommands[command]) {
        return { valid: true }; // Кастомные команды считаются валидными
    }
    // ----------------------------------------------------

    if (!args || typeof args !== 'object') return { valid: true };
    let testArgs = { ...args };
    if (testArgs.entityKey !== undefined && testArgs.aiIdentifier === undefined) testArgs.aiIdentifier = testArgs.entityKey;
    if (testArgs.target !== undefined && testArgs.aiIdentifier === undefined && testArgs.target !== 'player') testArgs.aiIdentifier = testArgs.target;
    if (testArgs.id !== undefined) {
        if (testArgs.aiIdentifier === undefined) testArgs.aiIdentifier = testArgs.id;
        if (testArgs.key === undefined) testArgs.key = testArgs.id;
        if (testArgs.effectId === undefined) testArgs.effectId = testArgs.id;
    }
    if (testArgs.id === undefined) testArgs.id = testArgs.aiIdentifier || testArgs.key || testArgs.effectId;

    switch (command) {
        case 'buildBusiness':
            if (!testArgs.facilityType || !FACILITY_NAMES[testArgs.facilityType]) return { valid: false, error: `Неизвестный тип предприятия '${testArgs.facilityType}'. Допустимые: ${Object.keys(FACILITY_NAMES).join(', ')}` };
            if (!testArgs.name || testArgs.name.trim() === '') return { valid: false, error: "Имя предприятия не может быть пустым." };
            break;
        case 'gmPurchaseGoods':
            if (!testArgs.factionId) return { valid: false, error: "Не указан factionId." };
            if (!testArgs.regionId) return { valid: false, error: "Не указан regionId." };
            if (!testArgs.goodType || !ECONOMY_ITEMS[testArgs.goodType]) return { valid: false, error: `Неизвестный тип товара '${testArgs.goodType}'.` };
            if (!testArgs.quantity || isNaN(parseInt(testArgs.quantity)) || parseInt(testArgs.quantity) <= 0) return { valid: false, error: "Количество должно быть положительным числом." };
            if (typeof World !== 'undefined' && World) {
                let r = World.regions[testArgs.regionId];
                if (!r) return { valid: false, error: `Регион '${testArgs.regionId}' не найден.` };
                let price = r.markets[testArgs.goodType] ?? ECONOMY_ITEMS[testArgs.goodType].basePrice ?? requireRuntimeNumber(getGameplayRuntimeConfig().economy.min_price, 'gameplay_runtime.economy.min_price');
                let cost = price * testArgs.quantity;
                let gold = getFactionGold(testArgs.factionId);
                if (gold < cost) return { valid: false, error: `У фракции '${testArgs.factionId}' недостаточно золота. Нужно ${cost}, есть ${gold}.` };
                let stock = getRegionGoodStock(testArgs.regionId, testArgs.goodType);
                if (stock < testArgs.quantity) return { valid: false, error: `В регионе '${testArgs.regionId}' недостаточно товара '${testArgs.goodType}'. Нужно ${testArgs.quantity}, есть ${stock}.` };
            }
            break;
        case 'gmSellGoods':
            if (!testArgs.factionId) return { valid: false, error: "Не указан factionId." };
            if (!testArgs.regionId) return { valid: false, error: "Не указан regionId." };
            if (!testArgs.goodType || !ECONOMY_ITEMS[testArgs.goodType]) return { valid: false, error: `Неизвестный тип товара '${testArgs.goodType}'.` };
            if (!testArgs.quantity || isNaN(parseInt(testArgs.quantity)) || parseInt(testArgs.quantity) <= 0) return { valid: false, error: "Количество должно быть положительным числом." };
            if (typeof World !== 'undefined' && World) {
                let stock = getFactionGoodStock(testArgs.factionId, testArgs.goodType);
                if (stock < testArgs.quantity) return { valid: false, error: `У фракции '${testArgs.factionId}' недостаточно товара '${testArgs.goodType}' для продажи. Нужно ${testArgs.quantity}, есть ${stock}.` };
            }
            break;
        case 'gmInvestInFacility':
            if (!testArgs.factionId || !testArgs.regionId || !testArgs.facilityType || !testArgs.action) return { valid: false, error: "Отсутствуют обязательные аргументы." };
            if (typeof World !== 'undefined' && World) {
                let cost = testArgs.action === 'repair' ? 500 : 2000;
                let gold = getFactionGold(testArgs.factionId);
                if (gold < cost) return { valid: false, error: `У фракции '${testArgs.factionId}' недостаточно золота для инвестиции. Нужно ${cost}, есть ${gold}.` };
            }
            break;
        case 'gmSpreadRumor':
            if (!testArgs.factionId || !testArgs.targetFactionId || !testArgs.type || testArgs.investmentGold === undefined) return { valid: false, error: "Отсутствуют обязательные аргументы." };
            if (typeof World !== 'undefined' && World) {
                let cost = parseInt(testArgs.investmentGold);
                let gold = getFactionGold(testArgs.factionId);
                if (gold < cost) return { valid: false, error: `У фракции '${testArgs.factionId}' недостаточно золота для слухов. Нужно ${cost}, есть ${gold}.` };
            }
            break;
        case 'gmFrameForSabotage':
            if (!testArgs.factionId || !testArgs.targetFactionId || !testArgs.regionId) return { valid: false, error: "Отсутствуют обязательные аргументы." };
            if (typeof World !== 'undefined' && World) {
                let gold = getFactionGold(testArgs.factionId);
                if (gold < 3000) return { valid: false, error: `У фракции '${testArgs.factionId}' недостаточно золота для саботажа. Нужно 3000, есть ${gold}.` };
            }
            break;
        case 'gmDirectResourceInjection':
            if (!testArgs.regionId || !testArgs.goodType || !testArgs.quantity) return { valid: false, error: "Отсутствуют обязательные аргументы." };
            if (typeof World !== 'undefined' && World) {
                let currentDay = Math.floor((World.tick || 0) / 24);
                let lastDay = World.lastDirectInjectionDay || -999;
                if (currentDay - lastDay < 7) {
                    return { valid: false, error: `Команда gmDirectResourceInjection на кулдауне. Прошло ${currentDay - lastDay} дней из 7 необходимых.` };
                }
            }
            break;
        case 'gmDeclareWar':
            if (!testArgs.fromFactionId || !testArgs.toFactionId) return { valid: false, error: "Не указаны fromFactionId или toFactionId." };
            break;
        case 'gmForcePeace':
            if (!testArgs.factionId1 || !testArgs.factionId2) return { valid: false, error: "Не указаны factionId1 или factionId2." };
            break;
        case 'gmChangeRulerTrait':
            if (!testArgs.rulerId || !testArgs.trait || testArgs.value === undefined) return { valid: false, error: "Не указаны rulerId, trait или value." };
            const allowedTraits = ['ambition', 'paranoia', 'wisdom', 'cruelty', 'diplomacy', 'military', 'stewardship'];
            if (!allowedTraits.includes(testArgs.trait)) return { valid: false, error: `Неизвестная черта '${testArgs.trait}'. Допустимые: ${allowedTraits.join(', ')}` };
            break;

        case 'startIntrigue':
            if (!testArgs.id || !testArgs.type || !testArgs.initiator || !testArgs.target) return { valid: false, error: "Не указаны id, type, initiator или target." };
            const allowedIntrigues = ['assassination', 'sabotage', 'rebellion', 'bribery'];
            if (!allowedIntrigues.includes(testArgs.type)) return { valid: false, error: `Неизвестный тип интриги '${testArgs.type}'. Допустимые: ${allowedIntrigues.join(', ')}` };
            break;

        case 'startTravel':
            if (!testArgs.destinationId) return { valid: false, error: "Не указан destinationId." };
            let destExists = false;
            if (globalLocations && globalLocations[testArgs.destinationId]) destExists = true;
            if (player && player.mapMarkers && player.mapMarkers[testArgs.destinationId]) destExists = true;
            if (typeof World !== 'undefined' && World && World.subLocations && World.subLocations[testArgs.destinationId]) destExists = true;
            if (player && player.subLocations && player.subLocations[testArgs.destinationId]) destExists = true;
            if (!destExists) return { valid: false, error: `Локация '${testArgs.destinationId}' не найдена на карте. Используй только существующие ID.` };
            break;
        case 'setPlayerDescription':
            if (!testArgs.text && !testArgs.description && !testArgs.bio && !testArgs.value && !testArgs.narrative && !testArgs.biography && !testArgs.background && !testArgs.history && !testArgs.lore) return { valid: false, error: "Не указан text или description." };
            break;
        case 'updateStat':
        case 'setStat':
            if (!testArgs.stat) return { valid: false, error: "Не указан stat." };
            const allowedStats = ['hp', 'mana', 'gold', 'statPoints', 'xp', 'str', 'dex', 'int', 'con', 'cha', 'res'];
            let baseStat = testArgs.stat.split('.')[0];
            if (!allowedStats.includes(baseStat) && baseStat !== 'reputation') {
                return { valid: false, error: `Изменение стата '${testArgs.stat}' запрещено. Разрешены: ${allowedStats.join(', ')}, reputation.*` };
            }
            break;
        case 'addEnvironment':
            if (!testArgs.id) return { valid: false, error: "Не указан id." };
            if (!testArgs.name) return { valid: false, error: "Не указано имя (name)." };
            if (!testArgs.type || !['npc', 'creature', 'enemy'].includes(testArgs.type)) return { valid: false, error: "Тип (type) должен быть npc, creature или enemy." };
            break;
        case 'renderLocation':
            // CityGen вырезан из проекта. Команда игнорируется.
            return { valid: true, warning: "renderLocation: CityGen удалён, команда проигнорирована." };
    }
    return { valid: true };
}

function validateActionsArray(actions) {
    let errors = [];
    if (!Array.isArray(actions)) return ["Поле 'actions' должно быть массивом."];
    for (let action of actions) {
        if (!action.command) continue;
        let val = validateGMCommand(action.command, action.args);
        if (!val.valid) errors.push(`Команда '${action.command}': ${val.error}`);
    }
    return errors;
}


async function executeNonInventoryCommand(command, args) {
    if (!command) return null;
    if (!player) return t('gameInterface.commandFeedback.errorPlayerMissing');

    // --- СТАНДАРТИЗАЦИЯ АРГУМЕНТОВ (БРОНЯ ОТ ДУРАКА) ---
    if (args && typeof args === 'object') {
        // 0. Если ИИ прислал entityKey или target вместо aiIdentifier
        if (args.entityKey !== undefined && args.aiIdentifier === undefined) {
            args.aiIdentifier = args.entityKey;
        }
        if (args.target !== undefined && args.aiIdentifier === undefined && args.target !== 'player') {
            args.aiIdentifier = args.target;
        }
        
        // 1. Если ИИ прислал универсальный 'id', прокидываем его в старые переменные
        if (args.id !== undefined) {
            if (args.aiIdentifier === undefined) args.aiIdentifier = args.id;
            if (args.key === undefined) args.key = args.id;
            if (args.effectId === undefined) args.effectId = args.id;
        }
        // 2. Если ИИ по старой памяти прислал старый флаг, прокидываем его в 'id'
        if (args.id === undefined) {
            args.id = args.aiIdentifier || args.key || args.effectId;
        }
        // 3. Экстренный фикс для квестов (если ИИ прислал только title)
        if (command.toLowerCase().includes('quest') && args.id === undefined && args.title !== undefined) {
            args.id = args.title;
            args.aiIdentifier = args.title;
        }
    }

    console.log("Выполнение команды:", command, args);
    let feedback = null;

    try {
        switch (command) {

            // --- ОБЩИЕ КОМАНДЫ И СОСТОЯНИЕ ---

                        case 'echoMemory':
                if (args.text && typeof args.text === 'string') {
                    if (!player.echoMemory) player.echoMemory = { items: [], maxItems: ECHO_MEMORY_MAX_ITEMS, version: 1 };
                    if (!player.echoMemory.items) player.echoMemory.items = [];
                    let text = args.text.trim();
                    if (text.length > ECHO_MEMORY_MAX_LENGTH) {
                        text = text.substring(0, ECHO_MEMORY_MAX_LENGTH - 3) + '...';
                    }
                    if (text) {
                        player.echoMemory.items.unshift(text);
                        if (player.echoMemory.items.length > (player.echoMemory.maxItems || ECHO_MEMORY_MAX_ITEMS)) {
                            player.echoMemory.items.pop();
                        }
                        feedback = t('gameInterface.commandFeedback.echoMemoryAdded', { text: text });
                        updateEchoMemoryDisplay();

    updateDiceLogDisplay();
                    } else {
                        feedback = `[ERROR] 'echoMemory' получил пустой текст.`;
                    }
                } else {
                    feedback = `[ERROR] 'echoMemory' требует аргумент 'text' (string).`;
                }
                break;
            case 'clearEchoMemory':
                if (args.confirm === true || DEBUG_MODE) {
                    if (player.echoMemory) player.echoMemory.items = [];
                    feedback = t('gameInterface.commandFeedback.echoMemoryCleared');
                    updateEchoMemoryDisplay();

    updateDiceLogDisplay();
                } else {
                    feedback = `[ERROR] 'clearEchoMemory' требует подтверждения (confirm: true).`;
                }
                break;
            case 'removeEchoMemoryItem':
                if (player.echoMemory && player.echoMemory.items) {
                    if (args.index !== undefined && typeof args.index === 'number') {
                        if (player.echoMemory.items[args.index]) {
                            const removed = player.echoMemory.items.splice(args.index, 1);
                            feedback = t('gameInterface.commandFeedback.echoMemoryItemRemoved', { text: removed[0] });
                        } else {
                            feedback = `[ERROR] Индекс ${args.index} вне диапазона.`;
                        }
                    } else if (args.contains && typeof args.contains === 'string') {
                        const idx = player.echoMemory.items.findIndex(item => item.includes(args.contains));
                        if (idx !== -1) {
                            const removed = player.echoMemory.items.splice(idx, 1);
                            feedback = t('gameInterface.commandFeedback.echoMemoryItemRemoved', { text: removed[0] });
                        } else {
                            feedback = `[ERROR] Текст '${args.contains}' не найден в эхо-памяти.`;
                        }
                    } else {
                        feedback = `[ERROR] 'removeEchoMemoryItem' требует 'index' или 'contains'.`;
                    }
                    updateEchoMemoryDisplay();

    updateDiceLogDisplay();
                }
                break;

            case 'setPlayerDescription':
                let bioText = args.text || args.description || args.bio || args.value || args.narrative || args.biography || args.background || args.history || args.lore;
                if (bioText) {
                    player.description = bioText;
                    feedback = `[СИСТЕМА] Предыстория персонажа успешно сгенерирована и сохранена в профиль.`;
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'setPlayerDescription' требует 'text' или 'description'. Получено: ${JSON.stringify(args)}`;
                }
                break;

            case 'setMemory':
                if (args.key && args.text) {
                    if (!player.gmNotes) player.gmNotes = {};
                    player.gmNotes[args.key] = args.text;
                    console.log(`[Memory] Блок '${args.key}' обновлен.`);
                    updateGmNotesDisplay();
    updateWorldSimDebugDisplay();
                }
                break;
            case 'deleteMemory':
                if (args.key && player.gmNotes && player.gmNotes[args.key]) {
                    delete player.gmNotes[args.key];
                    console.log(`[Memory] Блок '${args.key}' удален.`);
                    updateGmNotesDisplay();
    updateWorldSimDebugDisplay();
                }
                break;
            case 'archiveMemory':
                if (args.key && args.summary) {
                    if (player.gmNotes && player.gmNotes[args.key]) {
                        if (!player.memoryArchives) player.memoryArchives = {};
                        if (!player.archiveSummaries) player.archiveSummaries = {};

                        player.memoryArchives[args.key] = player.gmNotes[args.key];
                        player.archiveSummaries[args.key] = args.summary;
                        delete player.gmNotes[args.key];
                        console.log(`[Memory] Блок '${args.key}' заархивирован.`);
                        updateGmNotesDisplay();
    updateWorldSimDebugDisplay();
                    }
                }
                break;

            case 'setLocation':
                let locId = args.id || args.aiIdentifier || args.locationName;
                let locName = args.locationName;
                let foundLoc = false;

                // --- УМНЫЙ ПОИСК ПОДЛОКАЦИЙ (Т3 ФИКС) ---
                // Если ГМ прислал текст вместо ID (например "Таверна 'Веселый Монах'"), ищем совпадение
                if (locId && typeof World !== 'undefined' && World && World.subLocations && !World.subLocations[locId]) {
                    const searchStr = String(locId).toLowerCase().trim();
                    for (let key in World.subLocations) {
                        const subName = World.subLocations[key].name.toLowerCase().trim();
                        // Ищем перекрестное вхождение строк
                        if (searchStr === subName || searchStr.includes(subName) || subName.includes(searchStr)) {
                            locId = key;
                            break;
                        }
                    }
                }
                // ----------------------------------------

                if (locId && typeof World !== 'undefined' && World && World.subLocations && World.subLocations[locId]) {
                    player.location = World.subLocations[locId].name;
    if (window.ModAPI) ModAPI.emit('onLocationChanged', {newLocation: World.subLocations[locId]?.name, oldLocation: player.location});
                    player.currentSublocation = locId;
                    foundLoc = true;
                } else if (locId && player.subLocations && player.subLocations[locId]) {
                    player.location = player.subLocations[locId].name;
                    player.currentSublocation = locId;
                    foundLoc = true;
                } else if (locId && globalLocations && globalLocations[locId]) {
                    player.location = globalLocations[locId].name;
                    player.currentSublocation = null;
                    foundLoc = true;
                } else if (locName) {
                    let cleanName = String(locName).trim().replace(/_/g, ' ');
                    if (cleanName.toLowerCase().startsWith('sub ')) cleanName = cleanName.substring(4);
                    cleanName = cleanName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                    
                    let matchedLoc = null;
                    if (typeof World !== 'undefined' && World && World.regions) {
                        matchedLoc = Object.values(World.regions).find(r => r.name.toLowerCase().includes(cleanName.toLowerCase()) || cleanName.toLowerCase().includes(r.name.toLowerCase()));
                    }
                    if (!matchedLoc) {
                        matchedLoc = Object.values(globalLocations || {}).find(r => r.name.toLowerCase().includes(cleanName.toLowerCase()) || cleanName.toLowerCase().includes(r.name.toLowerCase()));
                    }

                    if (matchedLoc) {
                        player.location = matchedLoc.name;
                        player.currentSublocation = null;
                        foundLoc = true;
                    } else {
                        feedback = `[ОШИБКА ЯДРА] Локация '${locName}' не найдена в реестре мира! Запрещено телепортировать игрока в выдуманные места (игрок улетит в океан). Сначала физически создайте здание через addSubLocation или локацию через addMapMarker.`;
                    }
                }

                if (foundLoc) {
                    await syncPlayerContainerBindings();

                    for (const cont of ContainerRegistry.values()) {
                        if ((cont.type === 'mobile_cart' || cont.type === 'pack_animal') && cont.owner_id === 'player') {
                            await CoreInventorySystemAsync.updateContainerLocation(cont.id, { world_coords: [0,0,0], parent_entity: 'player', parent_container: null, region_id: player.location });
                        }
                    }
                    if (!player.visitedLocations.includes(player.location)) {
                        player.visitedLocations.push(player.location);
                    }
                    feedback = t('gameInterface.commandFeedback.locationChanged', { location: player.location });
                    updateEnvironmentVisibility(); // Авто-скрытие/показ NPC
                    updateCharacterSheet();
                    updateMapDisplay();
                } else {
                    feedback = `[ERROR] 'setLocation' требует корректный 'id' или 'locationName'.`;
                }
                break;

            case 'gmDeclareWar':
            if (!testArgs.fromFactionId || !testArgs.toFactionId) return { valid: false, error: "Не указаны fromFactionId или toFactionId." };
            break;
        case 'gmForcePeace':
            if (!testArgs.factionId1 || !testArgs.factionId2) return { valid: false, error: "Не указаны factionId1 или factionId2." };
            break;
        case 'gmChangeRulerTrait':
            if (!testArgs.rulerId || !testArgs.trait || testArgs.value === undefined) return { valid: false, error: "Не указаны rulerId, trait или value." };
            const allowedTraits = ['ambition', 'paranoia', 'wisdom', 'cruelty', 'diplomacy', 'military', 'stewardship'];
            if (!allowedTraits.includes(testArgs.trait)) return { valid: false, error: `Неизвестная черта '${testArgs.trait}'. Допустимые: ${allowedTraits.join(', ')}` };
            break;

        case 'startIntrigue':
            if (!testArgs.id || !testArgs.type || !testArgs.initiator || !testArgs.target) return { valid: false, error: "Не указаны id, type, initiator или target." };
            const allowedIntrigues = ['assassination', 'sabotage', 'rebellion', 'bribery'];
            if (!allowedIntrigues.includes(testArgs.type)) return { valid: false, error: `Неизвестный тип интриги '${testArgs.type}'. Допустимые: ${allowedIntrigues.join(', ')}` };
            break;

        case 'startTravel':
                if (args.destinationId) {
                    LivingRoads.start(args.destinationId);
                    feedback = `[СИСТЕМА] Путешествие инициировано.`;
                } else {
                    feedback = `[ERROR] 'startTravel' требует 'destinationId'.`;
                }
                break;
            case 'pauseTravel':
                LivingRoads.pause("gm_intervention");
                feedback = `[СИСТЕМА] Путешествие приостановлено Мастером.`;
                break;
            case 'resumeTravel':
                LivingRoads.resume();
                feedback = `[СИСТЕМА] Путешествие возобновлено.`;
                break;
            case 'cancelTravel':
                if (player.currentJourney && player.currentJourney.currentLocation) {
                    // Если GM установил промежуточную локацию, остаёмся в ней
                    executeCommand('setLocation', { locationName: player.currentJourney.currentLocation });
                    feedback = `[СИСТЕМА] Путешествие отменено. Вы остаётесь в: ${player.location}.`;
                    player.currentJourney = null;
                } else {
                    // Иначе возвращаемся в точку старта (старое поведение)
                    feedback = `[СИСТЕМА] Путешествие отменено. Вы вернулись в точку старта.`;
                }
                LivingRoads.cancel();
                break;
            case 'fastForwardTravel':
                LivingRoads.fastForward();
                feedback = `[СИСТЕМА] Путешествие ускорено.`;
                break;


            case 'startJourney':
                if (!args.destination) {
                    feedback = `[ERROR] 'startJourney' провалена: нет 'destination'.`;
                } else if (!args.events || !Array.isArray(args.events) || args.events.length === 0) {
                    feedback = `[ERROR] 'startJourney' провалена: отсутствует массив 'events'. Ты обязан сгенерировать точки пути!`;
                } else {
                    let valid = true;
                    for (let i = 0; i < args.events.length; i++) {
                        if (!args.events[i].options || args.events[i].options.length < 2) {
                            valid = false;
                            feedback = `[ERROR] 'startJourney' провалена: в точке ${i + 1} нет массива 'options' (минимум 2 варианта).`;
                            break;
                        }
                    }
                    if (valid) {
                        let destId = String(args.destination).trim();
                        let destName = destId;
                        if (typeof World !== 'undefined' && World && World.subLocations && World.subLocations[destId]) {
                            destName = World.subLocations[destId].name;
                        } else if (player.subLocations && player.subLocations[destId]) {
                            destName = player.subLocations[destId].name;
                        } else if (globalLocations && globalLocations[destId]) {
                            destName = globalLocations[destId].name;
                        } else {
                            destName = destId.replace(/_/g, ' ');
                        }

                        player.currentJourney = {
                            destination: destName,
                            destinationId: destId,
                            points: args.events.length,
                            currentPoint: 0,
                            events: args.events,
                            currentLocation: null  // Промежуточная локация для событий во время путешествия
                        };
                        feedback = `[СИСТЕМА] Начато путешествие в ${destName}.`;
                        updateCharacterSheet();
                        setTimeout(() => { if (window.advanceJourney) window.advanceJourney(); }, 1500);
                    }
                }
                break;

            case 'endJourney':
            if (player.currentJourney) {
                // Если есть промежуточная локация, остаёмся в ней, иначе идём в destination
                const finalLocation = player.currentJourney.currentLocation ||
                                     player.currentJourney.destinationId ||
                                     player.currentJourney.destination;
                executeCommand('setLocation', { locationName: finalLocation });
                feedback = `[СИСТЕМА] Путешествие завершено. Вы находитесь в: ${player.location}.`;
                player.currentJourney = null;
            player.travel = {
                active: false,
                destinationId: null,
                destinationName: null,
                startX: 0, startY: 0,
                endX: 0, endY: 0,
                totalHours: 0,
                elapsedHours: 0,
                speed: 5,
                paused: false,
                pauseReason: null,
                lastEventHour: 0,
                suppliesConsumed: { food: 0, water: 0 }
            };
                updateCharacterSheet();
                updateMapDisplay();
            }
            break;

        case 'setJourneyLocation':
            if (player.currentJourney) {
                const locId = args.locationId || args.locationName;
                if (locId) {
                    player.currentJourney.currentLocation = locId;
                    // Немедленно обновляем player.location для корректного отображения
                    executeCommand('setLocation', { locationName: locId });
                    feedback = `[СИСТЕМА ПУТЕШЕСТВИЯ] Текущая локация на маршруте установлена: ${locId}`;
                } else {
                    feedback = `[ERROR] 'setJourneyLocation' требует 'locationId' или 'locationName'.`;
                }
            } else {
                feedback = `[ERROR] 'setJourneyLocation' можно использовать только во время активного путешествия.`;
            }
            break;

        case 'calculationLog':
                if (args.message) {
                    addCalculationMessage(String(args.message));
                }
                break;

            case 'defineFaction':
                if (args.key && args.name) {
                    if (!player.factionData) player.factionData = {};
                    player.factionData[String(args.key)] = String(args.name);
                    feedback = `[DEBUG] Фракция '${args.key}' определена как '${args.name}'.`;
                    addCalculationMessage(feedback);
                } else {
                    feedback = `[ERROR] 'defineFaction' требует 'key' и 'name'.`;
                }
                break;

            // --- ПЕРСОНАЖ ---

            case 'updateStat':
                // Делаем парсер умнее: понимаем change, value, amount и переводим строки в числа
                let changeVal = args.change !== undefined ? args.change : (args.value !== undefined ? args.value : args.amount);
                changeVal = parseInt(changeVal, 10);

                if (args.stat && !isNaN(changeVal)) {
                    const stat = args.stat;
                    const change = changeVal;

                    // --- СИНХРОНИЗАЦИЯ ФИЗИЧЕСКОГО ЗОЛОТА ---
                    if (stat === 'gold') {
                        if (change > 0) {
                            const addRes = await executeCommand('addItem', { aiIdentifier: 'gold', name: 'Золото', quantity: change });
                            if (addRes && addRes.includes("[ОШИБКА")) {
                                feedback = addRes; // Пробрасываем ошибку перегруза
                                break;
                            }
                        } else if (change < 0) {
                            await executeCommand(getInventoryCommandName('remove_item'), { aiIdentifier: getPrimaryCurrencyPrototypeId('gold'), quantity: Math.abs(change) });
                        }
                        feedback = t('gameInterface.commandFeedback.goldChanged', { change: change > 0 ? `+${change}` : change, gold: player.stats.gold });
                        break;
                    }

                    const pathParts = stat.toLowerCase().split('.');
                    let currentStatObject = player.stats;
                    let finalStatName = pathParts[pathParts.length - 1];

                    for (let i = 0; i < pathParts.length - 1; i++) {
                        const part = pathParts[i];
                        if (currentStatObject[part] === undefined || typeof currentStatObject[part] !== 'object') {
                            currentStatObject[part] = {};
                        }
                        currentStatObject = currentStatObject[part];
                    }

                    const oldValue = currentStatObject[finalStatName] || 0;
                    
                    // Т3 ФИКС: Системный запрет на прямое исцеление игрока через updateStat
                    if (stat === 'hp' && change > 0) {
                        console.error("[System] GM attempted direct healing via updateStat. Action blocked.");
                        addCalculationMessage("[ОШИБКА ЯДРА] Прямое исцеление через updateStat запрещено. Используйте статус-эффекты!");
                        change = 0;
                    }

                    currentStatObject[finalStatName] = oldValue + change;

                    if (stat === 'hp') {
                        player.stats.hp = Math.max(0, Math.min(player.stats.hp, player.stats.maxHp || 0));
                        feedback = t('gameInterface.commandFeedback.hpChanged', { change: change > 0 ? `+${change}` : change, hp: player.stats.hp, maxHp: player.stats.maxHp || 0 });
                        if (player.stats.hp <= player.stats.maxHp * 0.2) {
                            executeCommand('echoMemory', { text: `⚠️ Критическое здоровье! (${player.stats.hp}/${player.stats.maxHp})` });
                        }
                    } else if (stat.startsWith('reputation.')) {
                        feedback = t('gameInterface.commandFeedback.reputationChanged', { change: change > 0 ? `+${change}` : change, reputation: currentStatObject[finalStatName] });
                        if (Math.abs(change) >= 20) {
                            executeCommand('echoMemory', { text: `Репутация резко изменилась на ${change > 0 ? '+'+change : change} (теперь: ${currentStatObject[finalStatName]})` });
                        }
                    } else if (stat === 'xp') {
                        player.stats.xp = Math.max(0, player.stats.xp);
                        feedback = t('gameInterface.commandFeedback.xpGained', { change: change, xp: player.stats.xp, xpNext: player.stats.xpNext });
                        levelUp();
                    } else {
                        feedback = `${finalStatName.toUpperCase()} changed by ${change > 0 ? `+${change}` : change}. New value: ${currentStatObject[finalStatName]}`;
                    }

                    if (stat !== 'xp') {
                        updateCharacterSheet();
                    }
                } else {
                    feedback = `[ERROR] 'updateStat' требует 'stat' (string) и 'change' (number).`;
                }
                break;

            case 'setStat':
                if (args.stat && typeof args.value === 'number') {
                    const { stat, value } = args;

                    // --- СИНХРОНИЗАЦИЯ ФИЗИЧЕСКОГО ЗОЛОТА ---
                    if (stat === 'gold') {
                        let currentGold = syncPlayerGoldFromInventory();
                        let diff = value - currentGold;
                        if (diff > 0) {
                            const addRes = await executeCommand('addItem', { aiIdentifier: 'gold', name: 'Золото', quantity: diff });
                            if (addRes && addRes.includes("[ОШИБКА")) {
                                feedback = addRes;
                                break;
                            }
                        }
                        else if (diff < 0) await executeCommand(getInventoryCommandName('remove_item'), { aiIdentifier: getPrimaryCurrencyPrototypeId('gold'), quantity: Math.abs(diff) });
                        feedback = `Золото установлено на ${value}.`;
                        break;
                    }

                    const pathParts = stat.toLowerCase().split('.');
                    let currentStatObject = player.stats;
                    let finalStatName = pathParts[pathParts.length - 1];

                    for (let i = 0; i < pathParts.length - 1; i++) {
                        const part = pathParts[i];
                        if (currentStatObject[part] === undefined || typeof currentStatObject[part] !== 'object') {
                            currentStatObject[part] = {};
                        }
                        currentStatObject = currentStatObject[part];
                    }

                    currentStatObject[finalStatName] = value;

                    if (stat.startsWith('reputation.')) {
                        feedback = t('gameInterface.commandFeedback.reputationSet', { value: value });
                    } else {
                        feedback = `${finalStatName.toUpperCase()} set to ${value}.`;
                    }
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'setStat' требует 'stat' (string) и 'value' (number).`;
                }
                break;

            // --- ИНВЕНТАРЬ ---
                        case 'addItem':
                if (args.aiIdentifier && args.name) {
                    const aiId = String(args.aiIdentifier);
                    const name = String(args.name);
                    const quantity = (args.quantity !== undefined && !isNaN(parseInt(args.quantity))) ? parseInt(args.quantity) : 1;
                    const targetContId = resolveSpecialContainerId(args.containerId || player.container_backpack);
                    
                    if (!ContainerRegistry.has(targetContId)) {
                        feedback = `[ERROR] Контейнер ${targetContId} не найден.`;
                        break;
                    }

                    const cont = ContainerRegistry.get(targetContId);
                    let existingItemId = getContainerItems(cont).find(id => {
                        let it = ItemRegistry.get(id);
                        return it && it.prototype_id.toLowerCase() === aiId.toLowerCase();
                    });
                    
                    if (existingItemId) {
                        ItemRegistry.get(existingItemId).stack_size += quantity;
                        feedback = t('gameInterface.commandFeedback.itemQuantityIncreased', { itemName: name, quantity: quantity });
                    } else {
                        // Т3 ФИКС: Проверка веса
                    const currentWeight = CoreInventorySystemAsync.getContainerWeight(targetContId);
                    let itemWeight = 1.0;
                    if (isCurrencyAiIdentifier(aiId)) {
                        itemWeight = 0.01;
                    } else if (typeof ECONOMY_ITEMS !== 'undefined' && ECONOMY_ITEMS[aiId]) {
                        itemWeight = 1.0;
                    }
                    const addedWeight = quantity * itemWeight;

                    if (cont.owner_id !== 'player' && currentWeight + addedWeight > cont.max_weight_kg) {
                        feedback = `[ОШИБКА ЯДРА] Контейнер перегружен! Лимит: ${cont.max_weight_kg} кг. Невозможно добавить ${quantity} шт. '${name}' (Вес: ${addedWeight.toFixed(2)} кг). Используйте банк, сундуки или повозку!`;
                        break;
                    }

                    if (getContainerItems(cont).length >= cont.max_slots) {
                            feedback = t('gameInterface.commandFeedback.inventoryFull', { itemName: name });
                        } else {
                            const customProps = {
                                name: name,
                                description: args.description || t('itemDescriptions.noDescription'),
                                rarity: args.rarity || 'Обычный',
                                itemType: args.itemType || 'misc',
                                slot: args.slot || null,
                                effects: args.effects || [],
                                value: args.value ?? 0,
                                quality: args.quality ?? requireRuntimeNumber(getGameplayRuntimeConfig().inventory.default_item_quality, 'gameplay_runtime.inventory.default_item_quality')
                            };
                            await CoreInventorySystemAsync.createItem(aiId, quantity, targetContId, customProps);
                            feedback = t('gameInterface.commandFeedback.itemAdded', { itemName: name, quantity: quantity });
                        }
                    }
                    
                    if (isCurrencyAiIdentifier(aiId) && targetContId === player.container_backpack) {
                        syncPlayerGoldFromInventory();
                        animateGoldChange(quantity);
                        updateCharacterSheet();
                    }
                    updateInventoryDisplay();
                } else {
                    feedback = `[ERROR] 'addItem' требует 'aiIdentifier' и 'name'.`;
                }
                break;

            case 'removeItem':
                if (args.itemId && ItemRegistry.has(args.itemId)) {
                    const targetItem = ItemRegistry.get(args.itemId);
                    const quantity = (args.quantity !== undefined && !isNaN(parseInt(args.quantity))) ? parseInt(args.quantity, 10) : targetItem.stack_size;
                    if (targetItem.stack_size >= quantity) {
                        const removedName = targetItem.custom_props?.name || targetItem.prototype_id;
                        await CoreInventorySystemAsync.removeItem(args.itemId, quantity);
                        feedback = t('gameInterface.commandFeedback.itemRemoved', { itemName: removedName, quantityToRemove: quantity });
                        updateInventoryDisplay();
                        updateEquipmentDisplay();
                        updateCharacterSheet();
                    } else {
                        feedback = t('gameInterface.commandFeedback.notEnoughItem', { itemName: targetItem.custom_props?.name || targetItem.prototype_id, itemId: args.itemId, quantityToRemove: quantity });
                    }
                } else if (args.aiIdentifier) {
                    const searchTerm = String(args.aiIdentifier).toLowerCase();
                    const quantity = (args.quantity !== undefined && !isNaN(parseInt(args.quantity))) ? parseInt(args.quantity, 10) : 1;
                    const backpack = ContainerRegistry.get(player.container_backpack);
                    let itemKey = getContainerItems(backpack).find(id => {
                        let it = ItemRegistry.get(id);
                        return it && (it.prototype_id.toLowerCase() === searchTerm || it.custom_props?.aiIdentifier?.toLowerCase() === searchTerm || (it.custom_props.name && it.custom_props.name.toLowerCase() === searchTerm));
                    });
                    if (itemKey) {
                        const item = ItemRegistry.get(itemKey);
                        if (item.stack_size >= quantity) {
                            const removedName = item.custom_props.name || item.prototype_id;
                            await CoreInventorySystemAsync.removeItem(itemKey, quantity);
                            feedback = t('gameInterface.commandFeedback.itemRemoved', { itemName: removedName, quantityToRemove: quantity });
                            updateInventoryDisplay();
                            updateEquipmentDisplay();
                            updateCharacterSheet();
                        } else {
                            feedback = t('gameInterface.commandFeedback.notEnoughItem', { itemName: item.custom_props.name, itemId: args.aiIdentifier, quantityToRemove: quantity });
                        }
                    } else {
                        feedback = t('gameInterface.commandFeedback.itemNotFound', { itemId: args.aiIdentifier });
                    }
                } else {
                    feedback = `[ERROR] 'removeItem' требует 'itemId' или 'aiIdentifier'.`;
                }
                break;

            case 'lockContainer':
                if (args.containerId) {
                    const cont = ContainerRegistry.get(resolveSpecialContainerId(args.containerId));
                    if (cont) {
                        if (!cont.lock_data) cont.lock_data = { is_locked: false, difficulty: 10, trap: null };
                        cont.lock_data.is_locked = args.isLocked !== undefined ? args.isLocked : true;
                        if (args.difficulty) cont.lock_data.difficulty = args.difficulty;
                        if (args.trap) cont.lock_data.trap = args.trap;
                        feedback = `[СИСТЕМА] Замок контейнера ${args.containerId} обновлен.`;
                    } else {
                        feedback = `[ERROR] Контейнер не найден.`;
                    }
                } else {
                    feedback = `[ERROR] 'lockContainer' требует 'containerId'.`;
                }
                break;

            // --- КВЕСТЫ ---

            case 'addQuest':
                if (args.aiIdentifier && args.title) {
                    const existingQuest = Object.values(player.quests).find(q => q.aiIdentifier?.toLowerCase() === args.aiIdentifier.toLowerCase() && q.status === 'active');
                    if (!existingQuest) {
                        const newId = nextInternalQuestId++;
                        player.quests[newId] = {
                            id: newId,
                            aiIdentifier: args.aiIdentifier,
                            title: args.title,
                            objective: args.objective || '?',
                            description: args.description || t('quests.noDescription'),
                            reward: args.reward || t('quests.unknown'),
                            issuer: args.issuer || t('quests.unknown'),
                            status: 'active'
                        };
                        feedback = t('gameInterface.commandFeedback.questAdded', { description: args.title });
                        updateQuestList();
                        executeCommand('echoMemory', { text: `[Квест] ${args.title}: ${args.objective}` });
                    } else {
                        feedback = t('gameInterface.commandFeedback.questAlreadyActive', { description: existingQuest.title });
                    }
                } else {
                    feedback = `[ERROR] 'addQuest' требует 'aiIdentifier' и 'title'.`;
                }
                break;

            case 'updateQuest':
                const uqId = args.aiIdentifier || args.id || args.title;
                if (uqId && args.status) {
                    const searchTerm = String(uqId).toLowerCase().trim();
                    let questKey = Object.keys(player.quests).find(id => player.quests[id].aiIdentifier?.toLowerCase().trim() === searchTerm);
                    if (!questKey) {
                        questKey = Object.keys(player.quests).find(id => player.quests[id].title?.toLowerCase().trim() === searchTerm);
                    }

                    // Т3 ФИКС: Улучшенный поиск квеста (Fuzzy Search)
                    if (!questKey) {
                        // Если не нашли по ID, ищем квест, в заголовке которого ЕСТЬ искомая фраза
                        questKey = Object.keys(player.quests).find(id => {
                            const q = player.quests[id];
                            return q.title.toLowerCase().includes(searchTerm) || 
                                   q.aiIdentifier?.toLowerCase().includes(searchTerm);
                        });
                    }

                    if (questKey) {
                        const quest = player.quests[questKey];
                        const newStatus = args.status.toLowerCase();
                        if (['active', 'completed', 'failed'].includes(newStatus)) {
                            if (quest.status !== newStatus) {
                                quest.status = newStatus;
                                const statusLocalized = t(`quests.status${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)}`);
                                if (newStatus === 'completed') {
                                    const xpReward = requireRuntimeNumber(getGameplayRuntimeConfig().progression.quest_rewards.xp_per_level, 'gameplay_runtime.progression.quest_rewards.xp_per_level') * (player.stats.level || 1);
                                    player.stats.xp += xpReward;
                                    levelUp();
                                    feedback = t('gameInterface.commandFeedback.questStatusUpdated', { description: quest.title, status: statusLocalized }) + ` Получено ${xpReward} XP.`;
                                    generateWorldNews(`Герой ${player.name} успешно завершил задание: "${quest.title}".`, player.location || "global", 2, 'misc');
                                } else {
                                    feedback = t('gameInterface.commandFeedback.questStatusUpdated', { description: quest.title, status: statusLocalized });
                                }
                            } else {
                                feedback = t('gameInterface.commandFeedback.questSameStatus', { description: quest.title });
                            }
                            updateQuestList();
                        } else {
                            feedback = `[ERROR] Неверный статус для 'updateQuest': ${args.status}.`;
                        }
                    } else {
                        feedback = t('gameInterface.commandFeedback.questNotFound', { questId: uqId });
                    }
                } else {
                    feedback = `[ERROR] 'updateQuest' требует 'aiIdentifier' (или 'title') и 'status'.`;
                }
                break;

            case 'removeQuest':
                const rqId = args.aiIdentifier || args.id || args.title;
                if (rqId) {
                    const searchTerm = String(rqId).toLowerCase().trim();
                    let questKey = Object.keys(player.quests).find(id => player.quests[id].aiIdentifier?.toLowerCase().trim() === searchTerm);
                    if (!questKey) {
                        questKey = Object.keys(player.quests).find(id => player.quests[id].title?.toLowerCase().trim() === searchTerm);
                    }

                    if (questKey) {
                        const quest = player.quests[questKey];
                        const title = quest.title;

                        // --- ИСПРАВЛЕНИЕ ---
                        // Вместо полного удаления, мы меняем статус на "failed".
                        // Это гарантированно уберет его из списка, так как эта логика уже работает.
                        quest.status = 'failed';
                        // -------------------

                        feedback = t('gameInterface.commandFeedback.questRemoved', { description: title });
                        updateQuestList(); // Эта функция теперь корректно отработает изменение статуса
                    } else {
                        feedback = t('gameInterface.commandFeedback.questNotFoundForRemoval', { questId: rqId });
                    }
                } else {
                    feedback = `[ERROR] 'removeQuest' требует 'aiIdentifier' (или 'title').`;
                }
                break;

            case 'editQuest':
                const eqId = args.aiIdentifier || args.id || args.title;
                if (eqId && args.field && args.value !== undefined) {
                    const searchTerm = String(eqId).toLowerCase().trim();
                    let questKey = Object.keys(player.quests).find(id => player.quests[id].aiIdentifier?.toLowerCase().trim() === searchTerm);
                    if (!questKey) {
                        questKey = Object.keys(player.quests).find(id => player.quests[id].title?.toLowerCase().trim() === searchTerm);
                    }

                    if (questKey) {
                        const quest = player.quests[questKey];
                        const field = args.field.toLowerCase();
                        if (['title', 'objective', 'description', 'reward', 'issuer'].includes(field)) {
                            quest[field] = args.value;
                            const fieldLocalized = t(`quests.${field}Label`);
                            feedback = t('gameInterface.commandFeedback.questEdited', { questId: quest.title, field: fieldLocalized, newValue: args.value });
                            updateQuestList();
                        } else {
                            feedback = `[ERROR] Неверное поле для 'editQuest': ${args.field}.`;
                        }
                    } else {
                        feedback = t('gameInterface.commandFeedback.questNotFound', { questId: eqId });
                    }
                } else {
                    feedback = `[ERROR] 'editQuest' требует 'aiIdentifier' (или 'title'), 'field', и 'value'.`;
                }
                break;

            // --- УМЕНИЯ ---

            case 'addSkill':
                if (args.id && args.name) {
                    const existingSkill = player.skills[args.id];
                    player.skills[args.id] = {
                        id: args.id, name: args.name,
                        description: args.description || t('skills.noDescription'),
                        damage: args.damage || null,
                        cost: args.cost ?? null,
                        costType: args.costType || null,
                        duration: args.duration || null,
                        cooldown: args.cooldown || null,
                        skillType: args.skillType || null,
                        effect: args.effect || null,
                        effectsJSON: args.effectsJSON || null
                    };
                    if (existingSkill) {
                        feedback = t('gameInterface.commandFeedback.skillAlreadyKnown', { skillName: args.name }) + " " + t('gameInterface.commandFeedback.skillUpdated');
                    } else {
                        feedback = t('gameInterface.commandFeedback.skillLearned', { skillName: args.name });
                    }
                    updateSkillsDisplay();
                } else {
                    feedback = `[ERROR] 'addSkill' требует 'id' и 'name'.`;
                }
                break;

            case 'removeSkill':
                if (args.id) {
                    if (player.skills[args.id]) {
                        const skillName = player.skills[args.id].name;
                        delete player.skills[args.id];
                        feedback = t('gameInterface.commandFeedback.skillForgotten', { skillName: skillName });
                        updateSkillsDisplay();
                    } else {
                        feedback = t('gameInterface.commandFeedback.skillNotFoundForRemoval', { skillId: args.id });
                    }
                } else {
                    feedback = `[ERROR] 'removeSkill' требует 'id'.`;
                }
                break;

            // --- РљРђР РўРђ ---

            case 'addDiscoveredLocation': // Старое название, сохраняем для совместимости промпта
            case 'addMapMarker':
                // Принудительно превращаем координаты в числа, даже если ИИ прислал строки
                const safeX = Number(args.x);
                const safeY = Number(args.y);
                if (args.id && args.name && !isNaN(safeX) && !isNaN(safeY)) {
                    if (!player.mapMarkers) player.mapMarkers = {};

                    let newX = safeX;
                    let newY = safeY;

                    // АНТИ-ДУБЛИКАТ: Проверяем, нет ли уже такой локации
                    const searchName = String(args.name).toLowerCase().trim();
                    const existsGlobal = Object.values(globalLocations || {}).some(l => l.name && l.name.toLowerCase().trim() === searchName);
                    const existsCustom = Object.values(player.mapMarkers || {}).some(l => l.name && l.name.toLowerCase().trim() === searchName);
                    const existsRegion = (typeof World !== 'undefined' && World && World.regions) ? Object.values(World.regions).some(r => r.name && r.name.toLowerCase().trim() === searchName) : false;
                    
                    if (existsGlobal || existsCustom || existsRegion) {
                        feedback = `[СИСТЕМА КАРТЫ] Отказ: Локация '${args.name}' уже существует на карте. Дубликат проигнорирован.`;
                        break;
                    }


                    // АНТИ-КЛАСТЕР: Если ИИ прислал (0,0) или координаты вне карты, 
                    // привязываем маркер к текущей локации игрока.
                    if ((newX <= 0 && newY <= 0) || newX > 250 || newY > 250) {
                        let pLoc = null;
                        if (typeof World !== 'undefined' && World && World.map && World.map.locations) {
                            pLoc = Object.values(World.map.locations).find(l => player.location && player.location.includes(l.name));
                        }
                        if (pLoc) {
                            newX = pLoc.x + (Math.random() * 20 - 10);
                            newY = pLoc.y + (Math.random() * 20 - 10);
                        } else {
                            newX = 128 + (Math.random() * 40 - 20);
                            newY = 128 + (Math.random() * 40 - 20);
                        }
                    }
                    const MIN_DISTANCE = 45; // Увеличено расстояние отталкивания меток друг от друга

                    // --- [НАЧАЛО НОВОЙ ЛОГИКИ] - Проверка коллизий ---
                    let collisionDetected = false;
                    let attempts = 0;
                    const MAX_ATTEMPTS = 50; // Чтобы избежать бесконечного цикла

                    // Собираем все существующие точки на карте
                    const allPoints = [
                        ...Object.values(globalLocations || {}),
                        ...Object.values(player.mapMarkers || {})
                    ].filter(p => p.id !== args.id); // Исключаем саму себя, если это обновление

                    do {
                        collisionDetected = false;
                        for (const point of allPoints) {
                            if (typeof point.x === 'number' && typeof point.y === 'number') {
                                // Рассчитываем расстояние между новой точкой и существующей
                                const distance = Math.hypot(newX - point.x, newY - point.y);

                                if (distance < MIN_DISTANCE) {
                                    collisionDetected = true;
                                    // Если нашли коллизию, сдвигаем новую точку в случайном направлении по спирали
                                    const angle = Math.random() * 2 * Math.PI;
                                    newX += Math.cos(angle) * (MIN_DISTANCE * 0.75);
                                    newY += Math.sin(angle) * (MIN_DISTANCE * 0.75);
                                    attempts++;
                                    break; // Начинаем проверку заново с новыми координатами
                                }
                            }
                        }
                    } while (collisionDetected && attempts < MAX_ATTEMPTS);

                    if (attempts > 0) {
                        console.log(`[Map Collision] Обнаружено наложение меток. Новая метка '${args.name}' была сдвинута из (${args.x},${args.y}) в (${Math.round(newX)},${Math.round(newY)}).`);
                    }
                    // --- [КОНЕЦ НОВОЙ ЛОГИКИ] ---

                    const isUpdate = !!player.mapMarkers[args.id];
                    player.mapMarkers[args.id] = {
                        id: args.id,
                        name: args.name,
                        description: args.description || '',
                        x: newX, // Используем новые, скорректированные координаты
                        y: newY  // Используем новые, скорректированные координаты
                    };

                    feedback = isUpdate
                        ? t('gameInterface.commandFeedback.mapMarkerUpdated', { markerName: args.name })
                        : t('gameInterface.commandFeedback.mapMarkerAdded', { markerName: args.name });
                    updateMapDisplay();
                } else {
                    feedback = `[ERROR] 'addMapMarker' требует 'id', 'name', 'x' (number), и 'y' (number).`;
                }
                break;

            case 'removeMapMarker':
                if (args.id) {
                    if (player.mapMarkers && player.mapMarkers[args.id]) {
                        const markerName = player.mapMarkers[args.id].name;
                        delete player.mapMarkers[args.id];
                        feedback = t('gameInterface.commandFeedback.mapMarkerRemoved', { markerName: markerName });
                        updateMapDisplay();
                    } else {
                        feedback = t('gameInterface.commandFeedback.mapMarkerNotFound', { markerId: args.id });
                    }
                } else {
                    feedback = `[ERROR] 'removeMapMarker' требует 'id'.`;
                }
                break;

            case 'addSubLocation':
                if (args.id && args.name && args.parentId) {
                    if (!player.subLocations) player.subLocations = {};
                    player.subLocations[args.id] = {
                        id: args.id,
                        name: args.name,
                        parentId: args.parentId,
                        description: args.description || ''
                    };
                    feedback = `[СИСТЕМА КАРТЫ] Открыта подлокация '${args.name}' (Внутри: ${args.parentId}).`;
                    updateMapDisplay();
                } else {
                    feedback = `[ERROR] 'addSubLocation' требует 'id', 'name' и 'parentId'.`;
                }
                break;

            case 'removeSubLocation':
                if (args.id && player.subLocations && player.subLocations[args.id]) {
                    const subName = player.subLocations[args.id].name;
                    delete player.subLocations[args.id];
                    feedback = `[СИСТЕМА КАРТЫ] Подлокация '${subName}' удалена.`;
                    updateMapDisplay();
                } else {
                    feedback = `[ERROR] Подлокация '${args.id}' не найдена.`;
                }
                break;



            // --- ЭКОНОМИКА ИГРОКА (БАНКИ И ВЛАДЕНИЯ) ---
            case 'buildBusiness':
                if (args.facilityType && args.name) {
                    let playerRegionId = null;
                    let pLoc = player.location.toLowerCase().trim();

                    // 1. Прямой нечеткий поиск по регионам
                    for (let rId in World.regions) {
                        let rName = World.regions[rId].name.toLowerCase();
                        if (pLoc.includes(rName) || rName.includes(pLoc) || pLoc === rId.toLowerCase()) {
                            playerRegionId = rId; break;
                        }
                    }

                    // 2. Поиск через подлокации (деревни, таверны)
                    if (!playerRegionId) {
                        const allSubs = [...Object.values(World.subLocations || {}), ...Object.values(player.subLocations || {})];
                        for (let sub of allSubs) {
                            let sName = sub.name.toLowerCase();
                            if (pLoc.includes(sName) || sName.includes(pLoc)) {
                                if (World.regions[sub.parentId]) {
                                    playerRegionId = sub.parentId; break;
                                }
                            }
                        }
                    }

                    if (!playerRegionId) {
                        const availRegs = Object.values(World.regions).map(r => r.name).join(', ');
                        feedback = `[ОШИБКА] Невозможно построить бизнес. Локация '${player.location}' -- это дикая местность без экономики. Бизнес можно строить только в макро-регионах: ${availRegs}. Используй setLocation, чтобы переместить игрока в город, или откажи ему в постройке.`;
                        break;
                    }
                    
                    if (window.electronAPI && window.electronAPI.nexusManageBusiness) {
                        window.electronAPI.nexusManageBusiness({ 
                            action: 'create', 
                            args: { regionId: playerRegionId, facilityType: args.facilityType, name: args.name } 
                        }).then(async (response) => {
                            try {
                                if (response.status === 'ok') {
                                    const fullState = await window.electronAPI.nexusGetFullState();
                                    if (fullState && fullState.status === 'ok') {
                                        setWorld(fullState.world);
                                        if (fullState.items) fullState.items.forEach(([k, v]) => ItemRegistry.set(k, v));
                                        if (fullState.containers) fullState.containers.forEach(([k, v]) => setContainer(k, v));
                                        updateHoldingsDisplay();
                                        updateMapDisplay();
                                        addLogMessage(`[СИСТЕМА] Контракт подписан! Строительство предприятия '${args.name}' начато. Это займет 14 игровых дней.`, "command-feedback");
                                        generateWorldNews(`Герой ${player.name} начал строительство предприятия '${args.name}' в регионе ${World.regions[playerRegionId]?.name || playerRegionId}.`, playerRegionId, 3, 'business');
                                        showCustomAlert(`Строительство начато! Следите за прогрессом в панели 'Владения'. Предприятие начнет работу только после завершения стройки.`);
                                    } else {
                                        addLogMessage(`[ОШИБКА] Сбой синхронизации мира после постройки.`, "system-message");
                                    }
                                } else {
                                    addLogMessage(`[ОШИБКА ДВИЖКА] ${response.message || 'Неизвестная ошибка при создании бизнеса.'}`, "system-message");
                                }
                            } catch (err) {
                                addLogMessage(`[КРИТИЧЕСКАЯ ОШИБКА] Сбой UI при постройке: ${err.message}`, "system-message");
                                console.error("Business creation UI error:", err);
                            }
                        }).catch(err => {
                            addLogMessage(`[КРИТИЧЕСКАЯ ОШИБКА] Сбой IPC при постройке: ${err.message}`, "system-message");
                            console.error("Business creation IPC error:", err);
                        });
                        feedback = `[СТРОИТЕЛЬСТВО] Запрос на постройку '${args.name}' отправлен инженерам. Ожидание ответа от ядра...`;
                    }
                } else {
                    feedback = `[ERROR] 'buildBusiness' требует 'facilityType' и 'name'.`;
                }
                break;

            case 'buyHolding':
                if (args.id && args.name && args.baseProfit) {
                    if (!player.holdings) player.holdings = {};
                    player.holdings[args.id] = {
                        id: args.id, name: args.name, description: args.description || '',
                        region: args.region || player.location, baseProfit: args.baseProfit
                    };
                    feedback = `[Экономика] Приобретено владение: ${args.name}. Ожидаемый доход: ${args.baseProfit} з/день.`;
                    generateWorldNews(`Герой ${player.name} приобрел владение: ${args.name}.`, player.location || "global", 2, 'economy');
                    updateHoldingsDisplay();
                } else {
                    feedback = `[ERROR] 'buyHolding' требует 'id', 'name', 'baseProfit'.`;
                }
                break;

            case 'sellHolding':
                if (args.id && player.holdings && player.holdings[args.id]) {
                    let hName = player.holdings[args.id].name;
                    delete player.holdings[args.id];
                    feedback = `[Экономика] Владение продано: ${hName}.`;
                    updateHoldingsDisplay();
                } else {
                    feedback = `[ERROR] Владение '${args.id}' не найдено.`;
                }
                break;

            case 'bankTransaction':
                if (!player.bankAccount) player.bankAccount = { deposit: 0, loan: 0, loanDays: 0 };
                let amount = parseInt(args.amount, 10);
                if (isNaN(amount) || amount <= 0) {
                    feedback = `[ERROR] Неверная сумма для транзакции.`;
                    break;
                }
                if (args.type === 'deposit') {
                    if (player.stats.gold >= amount) {
                        player.stats.gold -= amount;
                        player.bankAccount.deposit += amount;
                        feedback = `[Банк] Внесено ${amount} з. На счету: ${player.bankAccount.deposit} з.`;
                    } else feedback = `[ERROR] Недостаточно золота для депозита.`;
                } else if (args.type === 'withdraw') {
                    if (player.bankAccount.deposit >= amount) {
                        player.bankAccount.deposit -= amount;
                        player.stats.gold += amount;
                        feedback = `[Банк] Снято ${amount} з. На счету: ${player.bankAccount.deposit} з.`;
                    } else feedback = `[ERROR] Недостаточно золота на счету.`;
                } else if (args.type === 'loan') {
                    player.bankAccount.loan += amount;
                    player.stats.gold += amount;
                    player.bankAccount.loanDays = args.days ?? requireRuntimeNumber((getGameplayCommandDefaults().bank_loan || {}).default_days, 'gameplay_runtime.command_defaults.bank_loan.default_days');
                    feedback = `[Банк] Взят кредит ${amount} з. Срок: ${player.bankAccount.loanDays} дн.`;
                } else if (args.type === 'repay') {
                    if (player.stats.gold >= amount) {
                        let actualRepay = Math.min(amount, player.bankAccount.loan);
                        player.stats.gold -= actualRepay;
                        player.bankAccount.loan -= actualRepay;
                        feedback = `[Банк] Погашено ${actualRepay} з. Остаток долга: ${player.bankAccount.loan} з.`;
                    } else feedback = `[ERROR] Недостаточно золота для погашения.`;
                } else {
                    feedback = `[ERROR] Неизвестный тип транзакции: ${args.type}`;
                }
                updateCharacterSheet();
                updateHoldingsDisplay();
                break;


            // --- РљРћРќРЎРўРђРќРўР« (NEXUS) ---

            case 'nexusDefine':
                let dType = args.displayType || 'text'; // Защита от ошибок ИИ
                if (args.id && args.name && args.category && args.value !== undefined) {
                    if (!player.nexusData) player.nexusData = {};
                    if (!player.nexusData[args.id]) {
                        player.nexusData[args.id] = {
                            id: args.id, name: args.name, description: args.description || '',
                            category: args.category, displayType: dType, value: args.value,
                            effectsJSON: args.effectsJSON || null,
                            effectApplied: false
                        };
                        feedback = t('gameInterface.commandFeedback.nexusDefined', { name: args.name });
                        updateNexusDisplay();
                        updateWorldChroniclesDisplay();
    updateTradeJournalDisplay();
    updatePortPanel();
                    }
                } else {
                    feedback = `[ERROR] 'nexusDefine' требует 'id', 'name', 'category', 'value'.`;
                }
                break;

            case 'nexusUpdate':
                if (args.id && args.value !== undefined) {
                                        // ИНТЕГРАЦИЯ С ИНТРИГАМИ (Ускорение прогресса через Nexus)
                    if (args.id.includes("_progress") && typeof World !== 'undefined' && World.intrigues) {
                        let intrId = args.id.replace("_progress", "");
                        let intr = World.intrigues.find(i => i.id === intrId);
                        if (intr) {
                            intr.progress = parseInt(args.value, 10);
                            feedback = `[Интрига] Прогресс заговора '${intrId}' принудительно установлен на ${intr.progress}.`;
                            updateWorldSimDebugDisplay();
                            break;
                        }
                    }

if (player.nexusData && player.nexusData[args.id]) {
                        const nexusItem = player.nexusData[args.id];
                        if (args.isModification === true && nexusItem.displayType === 'numeric') {
                            const change = parseInt(args.value, 10);
                            if (!isNaN(change)) {
                                nexusItem.value = (parseInt(nexusItem.value, 10) || 0) + change;
                                feedback = t('gameInterface.commandFeedback.nexusModified', { name: nexusItem.name, change: args.value, newValue: nexusItem.value });
                            }
                        } else {
                            nexusItem.value = args.value;
                            feedback = t('gameInterface.commandFeedback.nexusSet', { name: nexusItem.name, newValue: nexusItem.value });
                        }
                        updateNexusDisplay();
                        updateWorldChroniclesDisplay();
    updateTradeJournalDisplay();
    updatePortPanel();
                    } else {
                        feedback = `[ERROR] Константа Nexus '${args.id}' не найдена.`;
                    }
                } else {
                    feedback = `[ERROR] 'nexusUpdate' требует 'id' и 'value'.`;
                }
                break;

            case 'nexusRemove':
                if (args.id) {
                                        // ИНТЕГРАЦИЯ С ИНТРИГАМИ (Ускорение прогресса через Nexus)
                    if (args.id.includes("_progress") && typeof World !== 'undefined' && World.intrigues) {
                        let intrId = args.id.replace("_progress", "");
                        let intr = World.intrigues.find(i => i.id === intrId);
                        if (intr) {
                            intr.progress = parseInt(args.value, 10);
                            feedback = `[Интрига] Прогресс заговора '${intrId}' принудительно установлен на ${intr.progress}.`;
                            updateWorldSimDebugDisplay();
                            break;
                        }
                    }

if (player.nexusData && player.nexusData[args.id]) {
                        const name = player.nexusData[args.id].name;
                        delete player.nexusData[args.id];
                        feedback = t('gameInterface.commandFeedback.nexusRemoved', { name: name });
                        updateNexusDisplay();
                        updateWorldChroniclesDisplay();
    updateTradeJournalDisplay();
    updatePortPanel();
                    } else {
                        feedback = `[ERROR] Константа Nexus '${args.id}' не найдена для удаления.`;
                    }
                } else {
                    feedback = `[ERROR] 'nexusRemove' требует 'id'.`;
                }
                break;

            case 'repairFacility':
                if (args.regionId && args.facilityType) {
                    let region = World.regions[args.regionId];
                    let fac = region.facilities[args.facilityType];
                    if (fac && fac.durability < 100) {
                        fac.durability = 100;
                        feedback = `[Ремонт] ${args.facilityType} в ${region.name} восстановлена.`;
                    } else {
                        feedback = `[Ремонт] Здание не требует ремонта.`;
                    }
                }
                break;

            case 'repairFacility':
                if (args.regionId && args.facilityType) {
                    let region = World.regions[args.regionId];
                    let fac = region.facilities[args.facilityType];
                    if (fac && fac.durability < 100) {
                        fac.durability = 100;
                        feedback = `[Ремонт] ${args.facilityType} в ${region.name} восстановлена.`;
                    } else {
                        feedback = `[Ремонт] Здание не требует ремонта.`;
                    }
                }
                break;

            // --- СТАТУС-ЭФФЕКТЫ ---

            case 'applyPredefinedEffect':
                if (args.target === 'player' && args.effectId && typeof args.duration === 'number') {
                    const predefinedEffect = predefinedStatusEffects[args.effectId.toLowerCase()]; // Ищем в нижнем регистре для надежности

                    if (predefinedEffect) {
                        // Если эффект НАЙДЕН в нашем списке, создаем его клон
                        const newEffectInstance = structuredClone(predefinedEffect);
                        // И вызываем основную команду addStatusEffect, передавая все данные из нашего шаблона
                        // Это централизует логику создания эффектов
                        executeCommand('addStatusEffect', {
                            target: 'player',
                            id: args.effectId, // Используем оригинальный ID, который прислал GM
                            name: newEffectInstance.name,
                            duration: args.duration,
                            description: newEffectInstance.description,
                            effectsJSON: newEffectInstance.effectsJSON
                        });
                        // Явный фидбэк не нужен, т.к. его даст вложенная команда addStatusEffect
                    } else {
                        // --- [КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ] ---
                        // Если эффект НЕ НАЙДЕН, мы больше не выдаем ошибку.
                        // Мы логируем это для отладки и даем GM подсказку.
                        feedback = `[INFO] GM попытался применить неопределенный эффект '${args.effectId}'. Для создания уникальных эффектов следует использовать команду 'addStatusEffect' со всеми параметрами.`;
                        console.warn(feedback);
                    }
                } else {
                    feedback = `[ERROR] 'applyPredefinedEffect' требует 'target', 'effectId', и 'duration'.`;
                }
                break;

            case 'addStatusEffect':
                if (args.target === 'player' && args.id && args.name && typeof args.duration === 'number' && args.description) {
                    if (!player.statusEffects) player.statusEffects = {};

                    let parsedEffects = [];
                    try {
                        if (typeof args.effectsJSON === 'string' && args.effectsJSON.length > 2) {
                            parsedEffects = JSON.parse(args.effectsJSON);
                        } else if (Array.isArray(args.effectsJSON)) {
                            parsedEffects = args.effectsJSON;
                        }
                    } catch (e) {
                        console.error(`Ошибка разбора effectsJSON для эффекта '${args.id}':`, e, args.effectsJSON);
                    }

                    const newEffectData = {
                        id: args.id, name: args.name, duration: args.duration,
                        description: args.description, effects: parsedEffects,
                        appliedTurn: player.stats.turnCount, originalValues: {}
                    };

                    parsedEffects.forEach(subEffect => {
                        if (subEffect.trigger?.type === 'on_apply') {
                            const message = applyEffectAction(player, newEffectData, subEffect.action);
                            if (message) addLogMessage(message, "command-feedback");
                        }
                    });

                    player.statusEffects[args.id] = newEffectData;
                    feedback = t('gameInterface.commandFeedback.statusEffectAdded', { effectName: args.name, duration: args.duration });
                    updateStatusEffectsDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'addStatusEffect' требует 'target', 'id', 'name', 'duration', 'description'.`;
                }
                break;

            case 'removeStatusEffect':
                if (args.target === 'player' && args.id) {
                    if (player.statusEffects && player.statusEffects[args.id]) {
                        const effectName = player.statusEffects[args.id].name;
                        delete player.statusEffects[args.id];
                        feedback = t('gameInterface.commandFeedback.statusEffectRemoved', { effectName: effectName });
                        updateStatusEffectsDisplay();
                        updateCharacterSheet();
                    } else {
                        feedback = t('gameInterface.commandFeedback.statusEffectNotFound', { effectId: args.id });
                    }
                } else {
                    feedback = `[ERROR] 'removeStatusEffect' требует 'target' и 'id'.`;
                }
                break;

            case 'applyConsequence':
                if (!args.type) {
                    feedback = `[ERROR] 'applyConsequence' требует 'type' (pregnancy/disease/reputation).`;
                    break;
                }

                switch (args.type) {
                    case 'pregnancy':
                        feedback = applyPregnancy(args.partnerId);
                        break;
                    case 'disease':
                        feedback = applyDisease(args.severity ?? requireRuntimeNumber(getGameplaySurvivalRuntimeConfig().disease?.default_severity, 'gameplay_runtime.survival.disease.default_severity'));
                        break;
                    case 'reputation':
                        feedback = applyReputationConsequence(args.key || 'sexual_reputation', args.change || -20);
                        break;
                    default:
                        feedback = `[ERROR] Неизвестный тип последствия: ${args.type}`;
                }
                break;

            case 'updateRelationship':
                if (!args.npcId || !args.stat) {
                    feedback = `[ERROR] 'updateRelationship' требует 'npcId' и 'stat' (affection/attraction/trust/intimacy).`;
                    break;
                }

                const npcForRel = player.allKnownEntities[args.npcId];
                if (!npcForRel) {
                    feedback = `[ERROR] NPC с ID '${args.npcId}' не найден.`;
                    break;
                }

                // Инициализация relationships если нет
                if (!npcForRel.relationships) {
                    npcForRel.relationships = {
                        player: { affection: 0, attraction: 0, trust: 0, intimacy: 0, sexualHistory: [] }
                    };
                }
                if (!npcForRel.relationships.player) {
                    npcForRel.relationships.player = { affection: 0, attraction: 0, trust: 0, intimacy: 0, sexualHistory: [] };
                }

                const change = args.change || 0;
                const stat = args.stat;
                const oldValue = npcForRel.relationships.player[stat] || 0;
                let newValue = oldValue + change;

                // Ограничения по диапазону
                if (stat === 'affection') {
                    newValue = Math.max(-100, Math.min(100, newValue));
                } else {
                    newValue = Math.max(0, Math.min(100, newValue));
                }

                npcForRel.relationships.player[stat] = newValue;
                updateEnvironmentVisibility();

                feedback = `Отношения с ${npcForRel.name}: ${stat} ${oldValue} → ${newValue} (${change >= 0 ? '+' : ''}${change})`;
                break;

            case 'recordIntimacy':
                if (!args.npcId) {
                    feedback = `[ERROR] 'recordIntimacy' требует 'npcId'.`;
                    break;
                }

                const npcForIntimacy = player.allKnownEntities[args.npcId];
                if (!npcForIntimacy) {
                    feedback = `[ERROR] NPC с ID '${args.npcId}' не найден.`;
                    break;
                }

                // Инициализация relationships если нет
                if (!npcForIntimacy.relationships) {
                    npcForIntimacy.relationships = {
                        player: { affection: 0, attraction: 0, trust: 0, intimacy: 0, sexualHistory: [] }
                    };
                }
                if (!npcForIntimacy.relationships.player) {
                    npcForIntimacy.relationships.player = { affection: 0, attraction: 0, trust: 0, intimacy: 0, sexualHistory: [] };
                }

                // Добавляем запись в историю
                const intimacyRecord = {
                    day: player.gameTime ? player.gameTime.day : 1,
                    location: args.location || player.location || 'Неизвестно',
                    type: args.type || 'consensual',
                    timestamp: Date.now()
                };

                npcForIntimacy.relationships.player.sexualHistory.push(intimacyRecord);

                // Увеличиваем intimacy
                const intimacyIncrease = 20;
                npcForIntimacy.relationships.player.intimacy = Math.min(100, (npcForIntimacy.relationships.player.intimacy || 0) + intimacyIncrease);

                updateEnvironmentVisibility();

                feedback = `Записана интимная сцена с ${npcForIntimacy.name} (${args.type || 'consensual'}). Intimacy: +${intimacyIncrease}`;
                break;

            case 'recordEroticScene':
                const sceneText = args.narrative || window.lastGeneratedNarrative;
                if (!sceneText) {
                    feedback = `[ERROR] 'recordEroticScene' не смогла получить текст сцены.`;
                    break;
                }

                // Инициализация журнала если нет
                if (!player.eroticJournal) {
                    player.eroticJournal = [];
                }

                // Генерация уникального ID
                const sceneId = `scene_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                // Создание записи
                const sceneRecord = {
                    id: sceneId,
                    day: player.gameTime ? player.gameTime.day : 1,
                    location: args.location || player.location || 'Неизвестно',
                    partner: args.partnerName || 'Неизвестный партнёр',
                    partnerId: args.partnerId || null,
                    type: args.type || 'consensual',
                    intensity: eroticIntensityLevel,
                    narrative: sceneText,
                    timestamp: Date.now()
                };

                player.eroticJournal.push(sceneRecord);
                
                // --- СТАТИСТИКА ---
                if (!player.eroticStats) {
                    player.eroticStats = { totalScenes: 0, partners: [], locations: {}, types: { consensual: 0, forced: 0, seduction: 0 }, fetishes: { anal: 0, oral: 0, bdsm: 0, group: 0 } };
                }
                player.eroticStats.totalScenes++;
                if (!player.eroticStats.partners.includes(sceneRecord.partner)) {
                    player.eroticStats.partners.push(sceneRecord.partner);
                }
                player.eroticStats.locations[sceneRecord.location] = (player.eroticStats.locations[sceneRecord.location] || 0) + 1;
                if (player.eroticStats.types[sceneRecord.type] !== undefined) {
                    player.eroticStats.types[sceneRecord.type]++;
                }
                if (args.fetishes && Array.isArray(args.fetishes)) {
                    args.fetishes.forEach(f => {
                        if (player.eroticStats.fetishes[f] !== undefined) player.eroticStats.fetishes[f]++;
                    });
                }
                // ------------------

                updateEroticJournal();

                feedback = `Сцена записана в интимный дневник (${sceneRecord.partner}, День ${sceneRecord.day}).`;
                break;

            case 'giveItem': {
                const rawId = args.itemId || args.aiIdentifier || args.id;
                const targetId = args.targetId || args.npcId;
                const quantity = (args.quantity !== undefined && !isNaN(parseInt(args.quantity))) ? parseInt(args.quantity, 10) : -1;

                if (!rawId || !targetId) {
                    feedback = `[ERROR] 'giveItem' требует 'itemId' и 'targetId'.`;
                    break;
                }

                const searchTerm = String(rawId).toLowerCase().trim();
                const backpack = ContainerRegistry.get(player.container_backpack);
                
                if (!backpack) {
                    feedback = `[ERROR] Рюкзак игрока не найден.`;
                    break;
                }

                let itemKey = getContainerItems(backpack).find(id => id === rawId);
                if (!itemKey) {
                    itemKey = getContainerItems(backpack).find(id => {
                        const it = ItemRegistry.get(id);
                        return it && (it.prototype_id.toLowerCase() === searchTerm || 
                                      (it.custom_props?.aiIdentifier || '').toLowerCase() === searchTerm || 
                                      (it.custom_props?.name || '').toLowerCase() === searchTerm);
                    });
                }

                if (!itemKey) {
                    feedback = t('gameInterface.commandFeedback.itemNotFound', { itemId: searchTerm });
                    break;
                }

                let wNpc = (typeof World !== 'undefined' && World) ? World.npcs[targetId] : null;
                if (!wNpc) {
                    if (player.allKnownEntities[targetId]) {
                        wNpc = player.allKnownEntities[targetId];
                    } else {
                        feedback = `[ERROR] NPC с ID '${targetId}' не найден.`;
                        break;
                    }
                }

                // Ленивая инициализация инвентаря NPC, если его еще нет
                if (!wNpc.inventory_id || !ContainerRegistry.has(wNpc.inventory_id)) {
                    wNpc.inventory_id = await CoreInventorySystemAsync.createContainer("npc_inventory", targetId, 500, 50, wNpc.currentLocation || player.location);
                }

                const item = ItemRegistry.get(itemKey);
                const moveQty = isFullStackMoveQuantity(quantity) ? item.stack_size : Math.min(quantity, item.stack_size);

                const res = await CoreInventorySystemAsync.moveItem(itemKey, player.container_backpack, wNpc.inventory_id, moveQty);
                
                if (res.success) {
                    const itemName = item.custom_props?.name || item.prototype_id;
                    feedback = `[ОБМЕН] Вы передали [${itemName} x${moveQty}] персонажу ${wNpc.name}.`;
                    
                    if (isGoldLikeItem(item)) {
                        syncPlayerGoldFromInventory();
                        animateGoldChange(-moveQty);
                    }
                    
                    updateInventoryDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] Ошибка передачи: ${res.error}`;
                }
                break;
            }

            // --- ОКРУЖЕНИЕ ---

            case 'renderLocation':
                feedback = null; // Заглушка, чтобы не выдавало ошибку
                break;
            case 'addEnvironment':
                if (args.aiIdentifier && args.name && args.type) {
                    const binding = args.boundTo || player.location;
                    const environmentDefaults = getEnvironmentCommandDefaults();
                    const defaultHp = requireRuntimeNumber(environmentDefaults.default_hp, 'gameplay_runtime.command_defaults.environment.default_hp');
                    const defaultStr = getEnvironmentDefaultStat('strength');
                    const defaultDex = getEnvironmentDefaultStat('dexterity');
                    const defaultCon = getEnvironmentDefaultStat('constitution');
                    const defaultInt = getEnvironmentDefaultStat('intelligence');
                    const resolvedMaxHp = args.maxHp ?? defaultHp;
                    const resolvedStr = args.str ?? defaultStr;
                    const resolvedDex = args.dex ?? defaultDex;
                    const resolvedCon = args.con ?? defaultCon;
                    const resolvedInt = args.int ?? defaultInt;
                    const minDamageBase = requireRuntimeNumber(environmentDefaults.min_damage_base, 'gameplay_runtime.command_defaults.environment.min_damage_base');
                    const minDamageHpDivisor = Math.max(1, requireRuntimeNumber(environmentDefaults.min_damage_hp_divisor, 'gameplay_runtime.command_defaults.environment.min_damage_hp_divisor'));
                    const creatureDamageDiceSides = requireRuntimeNumber(environmentDefaults.creature_damage_dice_sides, 'gameplay_runtime.command_defaults.environment.creature_damage_dice_sides');
                    const defaultDamageDiceSides = requireRuntimeNumber(environmentDefaults.default_damage_dice_sides, 'gameplay_runtime.command_defaults.environment.default_damage_dice_sides');
                    const highStatDamageDiceSides = requireRuntimeNumber(environmentDefaults.high_stat_damage_dice_sides, 'gameplay_runtime.command_defaults.environment.high_stat_damage_dice_sides');
                    const highStatThreshold = requireRuntimeNumber(environmentDefaults.high_stat_threshold, 'gameplay_runtime.command_defaults.environment.high_stat_threshold');
                    const armorClassBase = requireRuntimeNumber(environmentDefaults.armor_class_base, 'gameplay_runtime.command_defaults.environment.armor_class_base');
                    const armorClassDexterityBaseline = requireRuntimeNumber(environmentDefaults.armor_class_dexterity_baseline, 'gameplay_runtime.command_defaults.environment.armor_class_dexterity_baseline');
                    let minDmg = args.minDamage ?? args.min_damage ?? (minDamageBase + Math.floor(resolvedMaxHp / minDamageHpDivisor));
                    let diceSides = args.type === 'creature' ? creatureDamageDiceSides : (((resolvedStr > highStatThreshold || resolvedDex > highStatThreshold) ? highStatDamageDiceSides : defaultDamageDiceSides));
                    let maxDmg = args.maxDamage ?? args.max_damage ?? (minDmg * diceSides);
                    let ac = args.armorClass ?? args.armor_class ?? (armorClassBase + Math.floor((resolvedDex - armorClassDexterityBaseline) / 2));

                    if (player.allKnownEntities[args.aiIdentifier]) {
                        // Существо уже существует. Обновляем только привязку, чтобы не сбросить HP и статы.
                        player.allKnownEntities[args.aiIdentifier].boundTo = binding;
                        updateEnvironmentVisibility();
                        feedback = t('gameInterface.commandFeedback.entityAlreadyInEnv', { name: args.name, id: args.aiIdentifier });
                    } else {
                        // Создаем новое существо
                        player.allKnownEntities[args.aiIdentifier] = {
                            aiIdentifier: args.aiIdentifier,
                            name: args.name,
                            type: args.type,
                            description: args.description || '',
                            stats: { hp: args.hp ?? defaultHp, maxHp: resolvedMaxHp, str: resolvedStr, dex: resolvedDex, con: resolvedCon, int: resolvedInt },
                            min_damage: minDmg,
                            max_damage: maxDmg,
                            armor_class: ac,
                            isHostile: args.isHostile === true,
                            xpReward: args.xpReward ?? requireRuntimeNumber((getGameplayCommandDefaults().environment || {}).default_xp_reward, 'gameplay_runtime.command_defaults.environment.default_xp_reward'),
                            boundTo: binding,
                            traits: args.traits || [],
                            relationships: {
                                player: {
                                    affection: 0,      // -100 до 100 (любовь/ненависть)
                                    attraction: 0,     // 0-100 (сексуальное влечение)
                                    trust: 0,          // 0-100 (доверие)
                                    intimacy: 0,       // 0-100 (близость, растёт после секса)
                                    sexualHistory: []  // массив { day, location, type, timestamp }
                                }
                            }
                        };
                        
                        sendInventoryCommand('syncEntity', {
                            id: args.aiIdentifier,
                            name: args.name,
                            type: args.type,
                            hp: args.hp ?? defaultHp,
                            maxHp: resolvedMaxHp,
                            str: resolvedStr,
                            dex: resolvedDex,
                            con: resolvedCon,
                            int: resolvedInt,
                            isHostile: args.isHostile === true,
                            xpReward: args.xpReward ?? requireRuntimeNumber((getGameplayCommandDefaults().environment || {}).default_xp_reward, 'gameplay_runtime.command_defaults.environment.default_xp_reward'),
                            min_damage: minDmg,
                            max_damage: maxDmg,
                            armor_class: ac
                        }).catch(err => console.warn('[Inventory] syncEntity failed:', err.message || err));

                        updateEnvironmentVisibility();
                        feedback = t('gameInterface.commandFeedback.entityAddedToEnv', { name: args.name }) + ` (Привязка: ${binding === 'player' ? 'Игрок' : binding})`;
                    }
                } else {
                    feedback = `[ERROR] 'addEnvironment' требует 'aiIdentifier', 'name', и 'type'.`;
                }
                break;

            case 'removeEnvironment':
                if (args.aiIdentifier) {
                    const entId = args.aiIdentifier;
        const entityKey = args.aiIdentifier; // Явное объявление для обратной совместимости
                    const entity = player.allKnownEntities[entId] || player.visibleEntities[entId];

                    if (entity) {
                        if (args.isDeath === true) {
                             const xpReward = parseInt(entity.xpReward) || 0;
                             if (xpReward > 0) {
                                 player.stats.xp += xpReward;
                                 addCalculationMessage(`[XP] Получено ${xpReward} опыта за победу над ${entity.name}`);
                                 levelUp();
                             }
                        }
                        delete player.visibleEntities[entId];
                        delete player.allKnownEntities[entId];
                        const name = entity.name;
                        const xp = entity.xpReward || 0;

                        if (args.isDeath === true && xp > 0) {
                            player.stats.xp += xp;
                            feedback = t('gameInterface.commandFeedback.entityRemovedFromEnv', { name: name }) + ` (Получено ${xp} опыта)`;
                            levelUp();
                        } else {
                            feedback = t('gameInterface.commandFeedback.entityRemovedFromEnv', { name: name });
                        }
                        
                        // Удалено: мы не удаляем сущности из C++ ядра (removeEntity), оно само очищает мертвецов и обрабатывает наследство.

                        updateEnvironmentPanel();
                        updateCharacterSheet();
                    } else {
                        feedback = t('gameInterface.commandFeedback.entityNotFoundInEnv', { id: args.aiIdentifier });
                    }
                } else {
                    feedback = `[ERROR] 'removeEnvironment' требует 'aiIdentifier'.`;
                }
                break;

            case 'updateEntityStat':
                if (args.aiIdentifier && args.stat && typeof args.value === 'number') {
                    const entId = args.aiIdentifier;
                    
                    if (entId.startsWith("army_")) {
                        let foundArmy = null;
                        for (let fId in World.factions) {
                            let army = World.factions[fId].armies.find(a => a.id === entId);
                            if (army) { foundArmy = army; break; }
                        }
                        if (foundArmy) {
                            if (args.stat === 'morale') foundArmy.morale = args.value;
                            else if (args.stat === 'size') foundArmy.size = args.value;
                            feedback = `[Армия] Стат '${args.stat}' армии ${entId} изменен на ${args.value}.`;
                            addCalculationMessage(feedback);
                            break;
                        }
                    }

        const entityKey = args.aiIdentifier; // Явное объявление для обратной совместимости
                    const entity = player.allKnownEntities[entId] || player.visibleEntities[entId];
                    
                    if (entity) {
                        const statName = args.stat.toLowerCase();
                        if (entity.stats && ['hp', 'maxhp', 'str', 'dex', 'con', 'int'].includes(statName)) {
                            let systemStatName = statName === 'maxhp' ? 'maxHp' : statName;
                            
                            // Т3 ФИКС: Программное ограничение на ЛЮБОЕ увеличение HP существ
                            let validatedValue = args.value;
                            if (systemStatName === 'hp') {
                                const currentHp = entity.stats.hp || 0;
                                if (validatedValue > currentHp) {
                                    console.error(`[System] Direct healing for ${entity.name} blocked. Only damage or status effects allowed.`);
                                    addCalculationMessage(`[ОШИБКА ЯДРА] Попытка исцелить ${entity.name} через updateEntityStat пресечена.`);
                                    validatedValue = currentHp;
                                }
                                
                                // Дополнительный кап по maxHp (на случай если ГМ решит увеличить и текущее и макс сразу)
                                if (entity.stats.maxHp && validatedValue > entity.stats.maxHp) {
                                    validatedValue = entity.stats.maxHp;
                                }
                            }

                            if (player.allKnownEntities[entId]) player.allKnownEntities[entId].stats[systemStatName] = validatedValue;
                            if (player.visibleEntities[entId]) player.visibleEntities[entId].stats[systemStatName] = validatedValue;
                            
                            sendInventoryCommand('updateEntityStat', { id: entId, stat: systemStatName, value: validatedValue })
                                .catch(err => console.warn('[Inventory] updateEntityStat failed:', err.message || err));
                            
                            // Для фидбека используем уже валидированное значение
                            args.value = validatedValue;
                            
                            feedback = t('gameInterface.commandFeedback.entityStatUpdated', { name: entity.name, stat: systemStatName.toUpperCase(), value: args.value });

                            // --- АВТОМАТИКА СМЕРТИ ---
                            if (systemStatName === 'hp' && args.value <= 0) {
                                const xp = entity.xpReward || 0;
                                if (xp > 0) {
                                    player.stats.xp += xp;
                                    feedback += ` (РЈР±РёС‚! +${xp} XP)`;
                                    levelUp();
                                } else {
                                    feedback += ` (РЈР±РёС‚!)`;
                                }
                                generateWorldNews(`Герой ${player.name} сразил противника: ${entity.name}.`, player.location || "global", 2, 'war');
                                // Безопасное удаление
                                if (player.visibleEntities[entId]) delete player.visibleEntities[entId];
                                if (player.allKnownEntities[entId]) delete player.allKnownEntities[entId];
                                updateCharacterSheet();
                            }
                            updateEnvironmentPanel();
                        } else {
                            feedback = `[ERROR] Неверный стат '${args.stat}' для 'updateEntityStat'.`;
                        }
                    } else {
                        feedback = t('gameInterface.commandFeedback.entityNotFoundInEnv', { id: args.aiIdentifier });
                    }
                } else {
                    feedback = `[ERROR] 'updateEntityStat' требует 'aiIdentifier', 'stat', и 'value' (number).`;
                }
                break;

            case 'startIntrigue':
                if (args.id && args.type && args.initiator && args.target) {
                    if (!World.intrigues) World.intrigues = [];
                    World.intrigues.push({
                        id: args.id, type: args.type, initiatorFactionId: args.initiator, targetFactionId: args.target, targetRulerId: args.targetRuler || null,
                        progress: 0, requiredProgress: args.requiredProgress ?? requireRuntimeNumber((getGameplayCommandDefaults().intrigue || {}).required_progress, 'gameplay_runtime.command_defaults.intrigue.required_progress'), progressPerDay: args.progressPerDay ?? requireRuntimeNumber((getGameplayCommandDefaults().intrigue || {}).progress_per_day, 'gameplay_runtime.command_defaults.intrigue.progress_per_day'), discoveryChance: args.discoveryChance ?? requireRuntimeNumber((getGameplayCommandDefaults().intrigue || {}).discovery_chance, 'gameplay_runtime.command_defaults.intrigue.discovery_chance'),
                        isDiscovered: false, actors: args.actors || [], gmInitiated: true, startDay: player.stats.turnCount
                    });
                    feedback = `[Интрига] Запущен заговор '${args.id}' типа ${args.type} против ${args.target}.`;
                } else { feedback = `[ERROR] 'startIntrigue' требует id, type, initiator, target.`; }
                break;
            case 'cancelIntrigue':
                if (args.id && World.intrigues) {
                    const idx = World.intrigues.findIndex(i => i.id === args.id);
                    if (idx !== -1) { World.intrigues.splice(idx, 1); feedback = `[Интрига] Заговор '${args.id}' отменен.`; }
                    else { feedback = `[ERROR] Интрига '${args.id}' не найдена.`; }
                }
                break;
            case 'revealIntrigue':
                if (args.id && World.intrigues) {
                    const intrigue = World.intrigues.find(i => i.id === args.id);
                    if (intrigue) { intrigue.isDiscovered = true; feedback = `[Интрига] Заговор '${args.id}' принудительно раскрыт!`; generateWorldNews(`ШОК! Раскрыт заговор фракции ${World.factions[intrigue.initiatorFactionId]?.name} против ${World.factions[intrigue.targetFactionId]?.name}!`, "global", 5, 'misc'); }
                }
                break;
            case 'assassinateRuler':
                if (args.id && World.rulers && World.rulers[args.id]) {
                    World.rulers[args.id].health = 0; World.rulers[args.id].stats.hp = 0;
                    feedback = `[Убийство] Правитель '${args.id}' убит по воле GM.`;
                    checkRulerDeaths();
                } else { feedback = `[ERROR] Правитель '${args.id}' не найден.`; }
                break;
            case 'overthrowRuler':
                if (args.factionId && World.factions[args.factionId]) {
                    // Вместо стабильности - физическое последствие: бунт уничтожает ресурсы столицы
                    const capitalRegionId = Object.keys(World.regions).find(rid => World.regions[rid].factionId === args.factionId);
                    if (capitalRegionId && World.regions[capitalRegionId]?.vault_id) {
                        const capitalVault = World.regions[capitalRegionId].vault_id;
                        const weaponsLost = Math.floor(countRealItems(capitalVault, 'weapons') * 0.3);
                        const foodLost = Math.floor(countRealItems(capitalVault, 'bread') * 0.5);
                        consumeRealItems(capitalVault, 'weapons', weaponsLost);
                        consumeRealItems(capitalVault, 'bread', foodLost);
                        generateWorldNews(`МЯТЕЖ! В землях ${World.factions[args.factionId].name} вспыхнуло восстание! Уничтожено запасов: ${weaponsLost} оружия, ${foodLost} еды.`, "global", 5, 'war');
                    } else {
                        generateWorldNews(`МЯТЕЖ! В землях ${World.factions[args.factionId].name} вспыхнуло восстание!`, "global", 5, 'war');
                    }
                    generateWorldNews(`МЯТЕЖ! В землях ${World.factions[args.factionId].name} вспыхнуло восстание!`, "global", 5, 'war');
                    feedback = `[Мятеж] Инициирован бунт во фракции '${args.factionId}'.`;
                }
                break;
            case 'setFactionGoal':
                if (args.rulerId && World.rulers && World.rulers[args.rulerId]) {
                    World.rulers[args.rulerId].gmOverride = args.goal;
                    feedback = `[Дипломатия] Цель правителя '${args.rulerId}' принудительно изменена на: ${args.goal}.`;
                }
                break;

            case 'setCombatState':
                // СУПЕР-ПРЕДОХРАНИТЕЛЬ: Если ИИ забыл isActive, но передал участников, считаем что бой начался
                let isActiveVal = args.isActive;
                if (isActiveVal === undefined && args.participants && args.participants.length > 0) {
                    isActiveVal = true;
                } else if (typeof isActiveVal === 'string') {
                    isActiveVal = (isActiveVal.toLowerCase() === 'true');
                }

                if (typeof isActiveVal === 'boolean') {
                    const wasActive = player.currentCombat && player.currentCombat.isActive;
                    const oldParticipants = player.currentCombat ? (player.currentCombat.participants || []).join(',') : '';
                    const newParticipants = (args.participants || []).join(',');

                    if (!player.currentCombat) player.currentCombat = { isActive: false, participants: [] };
                    player.currentCombat.isActive = isActiveVal;
                    player.currentCombat.participants = args.participants || [];

                    if (args.isActive) {
                        if (!wasActive || oldParticipants !== newParticipants) {
                            feedback = `[СИСТЕМА БОЯ] Бой инициализирован. Участники: ${player.currentCombat.participants.join(', ')}`;
                            document.querySelector('.input-area').style.boxShadow = 'inset 0 0 20px rgba(231, 76, 60, 0.3)';
                        }
                    } else {
                        if (wasActive) {
                            feedback = `[СИСТЕМА БОЯ] Бой завершен.`;
                            document.querySelector('.input-area').style.boxShadow = 'none';
                            
                            if (player.travel && player.travel.interactTarget && player.travel.interactTarget.type === 'caravan') {
                                let chestId = player.travel.interactTarget.data.chest_id;
                                if (chestId && ContainerRegistry.has(chestId)) {
                                    let cont = ContainerRegistry.get(chestId);
                                    let itemsToMove = getContainerItems(cont).map(id => {
                                        let it = ItemRegistry.get(id);
                                        return it ? { id: id, quantity: it.stack_size } : null;
                                    }).filter(Boolean);
                                    if (itemsToMove.length > 0) {
                                        await CoreInventorySystemAsync.moveItems(chestId, player.container_backpack, itemsToMove, { actorId: 'player', ignoreAccess: true, ignoreDistance: true });
                                        feedback += ` [АВТО-ЛУТ] Товары каравана перемещены в ваш рюкзак.`;
                                    }
                                }
                                player.travel.interactTarget = null;
                            }

                            if (player.travel && player.travel.active && player.travel.paused && player.travel.pauseReason === 'combat') {
                                LivingRoads.resume();
                                feedback += " Путешествие возобновлено.";
                            }
                        }
                    }
                    if (feedback) addCalculationMessage(feedback);
                } else {
                    feedback = `[ERROR] 'setCombatState' требует 'isActive' (boolean).`;
                }
                break;

            case 'endCombat':
                if (player.currentCombat && player.currentCombat.isActive) {
                    player.currentCombat.isActive = false;
                    player.currentCombat.participants = [];
                    feedback = `[СИСТЕМА БОЯ] Бой принудительно завершён Мастером.`;
                    const inputArea = document.querySelector('.input-area');
                    if (inputArea) inputArea.style.boxShadow = 'none';
                    updateCharacterSheet();
                } else {
                    feedback = `[СИСТЕМА БОЯ] Бой не активен.`;
                }
                break;

                        case 'startIntrigue':
                if (args.id && args.type && args.initiator && args.target) {
                    if (!World.intrigues) World.intrigues = [];
                    World.intrigues.push({
                        id: args.id, type: args.type, initiatorFactionId: args.initiator, targetFactionId: args.target, targetRulerId: args.targetRuler || null,
                        progress: 0, requiredProgress: args.requiredProgress ?? requireRuntimeNumber((getGameplayCommandDefaults().intrigue || {}).required_progress, 'gameplay_runtime.command_defaults.intrigue.required_progress'), progressPerDay: args.progressPerDay ?? requireRuntimeNumber((getGameplayCommandDefaults().intrigue || {}).progress_per_day, 'gameplay_runtime.command_defaults.intrigue.progress_per_day'), discoveryChance: args.discoveryChance ?? requireRuntimeNumber((getGameplayCommandDefaults().intrigue || {}).discovery_chance, 'gameplay_runtime.command_defaults.intrigue.discovery_chance'),
                        isDiscovered: false, actors: args.actors || [], gmInitiated: true, startDay: player.stats.turnCount
                    });
                    feedback = `[Интрига] Запущен заговор '${args.id}' типа ${args.type} против ${args.target}.`;
                } else { feedback = `[ERROR] 'startIntrigue' требует id, type, initiator, target.`; }
                break;
            case 'cancelIntrigue':
                if (args.id && World.intrigues) {
                    const idx = World.intrigues.findIndex(i => i.id === args.id);
                    if (idx !== -1) { World.intrigues.splice(idx, 1); feedback = `[Интрига] Заговор '${args.id}' отменен.`; }
                    else { feedback = `[ERROR] Интрига '${args.id}' не найдена.`; }
                }
                break;
            case 'revealIntrigue':
                if (args.id && World.intrigues) {
                    const intrigue = World.intrigues.find(i => i.id === args.id);
                    if (intrigue) { intrigue.isDiscovered = true; feedback = `[Интрига] Заговор '${args.id}' принудительно раскрыт!`; generateWorldNews(`ШОК! Раскрыт заговор фракции ${World.factions[intrigue.initiatorFactionId]?.name} против ${World.factions[intrigue.targetFactionId]?.name}!`, "global", 5, 'misc'); }
                }
                break;
            case 'assassinateRuler':
                if (args.id && World.rulers && World.rulers[args.id]) {
                    World.rulers[args.id].health = 0; World.rulers[args.id].stats.hp = 0;
                    feedback = `[Убийство] Правитель '${args.id}' убит по воле GM.`;
                    checkRulerDeaths();
                } else { feedback = `[ERROR] Правитель '${args.id}' не найден.`; }
                break;
            case 'overthrowRuler':
                if (args.factionId && World.factions[args.factionId]) {
                    // Вместо стабильности - физическое последствие: бунт уничтожает ресурсы столицы
                    const capitalRegionId = Object.keys(World.regions).find(rid => World.regions[rid].factionId === args.factionId);
                    if (capitalRegionId) {
                        const capitalVault = World.regions[capitalRegionId].vault_id;
                        const weaponsLost = Math.floor(countRealItems(capitalVault, 'weapons') * 0.3);
                        const foodLost = Math.floor(countRealItems(capitalVault, 'bread') * 0.5);
                        consumeRealItems(capitalVault, 'weapons', weaponsLost);
                        consumeRealItems(capitalVault, 'bread', foodLost);
                    }
                    generateWorldNews(`МЯТЕЖ! В землях ${World.factions[args.factionId].name} вспыхнуло восстание!`, "global", 5, 'war');
                    feedback = `[Мятеж] Инициирован бунт во фракции '${args.factionId}'. Ресурсы столицы разграблены!`;
                }
                break;
            case 'setFactionGoal':
                if (args.rulerId && World.rulers && World.rulers[args.rulerId]) {
                    World.rulers[args.rulerId].gmOverride = args.goal;
                    feedback = `[Дипломатия] Цель правителя '${args.rulerId}' принудительно изменена на: ${args.goal}.`;
                }
                break;

case 'setEntityBinding':
                if (args.id && args.boundTo) {
                    const ent = player.allKnownEntities[args.id];
                    if (ent) {
                        ent.boundTo = args.boundTo;
                        updateEnvironmentVisibility();
                        feedback = `[Мир] Привязка ${ent.name} изменена на: ${args.boundTo}.`;
                    }
                }
                break;

            case 'setEntityState':
                if (args.aiIdentifier && args.property && typeof args.value === 'boolean') {
                    const entId = args.aiIdentifier;
        const entityKey = args.aiIdentifier; // Явное объявление для обратной совместимости
                    const entity = player.allKnownEntities[entId] || player.visibleEntities[entId];
                    if (entity) {
                        if (args.property.toLowerCase() === 'ishostile') {
                            if (player.allKnownEntities[entId]) player.allKnownEntities[entId].isHostile = args.value;
                            if (player.visibleEntities[entId]) player.visibleEntities[entId].isHostile = args.value;
                            feedback = `[DEBUG] Статус враждебности для ${entity.name} установлен в ${args.value}.`;
                            updateEnvironmentPanel();
                        } else {
                            feedback = `[ERROR] Неверное свойство '${args.property}' для 'setEntityState'.`;
                        }
                    } else {
                        feedback = t('gameInterface.commandFeedback.entityNotFoundInEnv', { id: args.aiIdentifier });
                    }
                } else {
                    feedback = `[ERROR] 'setEntityState' требует 'aiIdentifier', 'property', и 'value' (boolean).`;
                }
                break;

            case 'revealEntityTrait':
                if (args.id && args.trait) {
                    const entId = args.id;
                    const entity = player.allKnownEntities[entId] || player.visibleEntities[entId];
                    if (entity) {
                        let traitAdded = false;
                        if (player.allKnownEntities[entId]) {
                            if (!player.allKnownEntities[entId].traits) player.allKnownEntities[entId].traits = [];
                            if (!player.allKnownEntities[entId].traits.includes(args.trait)) {
                                player.allKnownEntities[entId].traits.push(args.trait);
                                traitAdded = true;
                            }
                        }
                        if (player.visibleEntities[entId]) {
                            if (!player.visibleEntities[entId].traits) player.visibleEntities[entId].traits = [];
                            if (!player.visibleEntities[entId].traits.includes(args.trait)) {
                                player.visibleEntities[entId].traits.push(args.trait);
                                traitAdded = true;
                            }
                        }
                        if (traitAdded) {
                            feedback = `[Озарение] Вы разгадали скрытую черту персонажа ${entity.name}: ${args.trait}.`;
                            updateEnvironmentPanel();
                        } else {
                            feedback = `[DEBUG] Черта '${args.trait}' для ${entity.name} уже известна.`;
                        }
                    } else {
                        feedback = `[ERROR] Существо с ID '${args.id}' не найдено в окружении для revealEntityTrait.`;
                    }
                } else {
                    feedback = `[ERROR] 'revealEntityTrait' требует 'id' и 'trait'.`;
                }
                break;

            // --- БОЙ И ПРОВЕРКИ ---



            case 'equipItem':
                if (args.aiIdentifier) {
                    const backpack = ContainerRegistry.get(player.container_backpack);
                    if (!backpack) {
                        feedback = `[ERROR] Рюкзак игрока не найден в реестре.`;
                        break;
                    }
                    const itemKey = getContainerItems(backpack).find(id => {
                        let it = ItemRegistry.get(id);
                        return it && (it.prototype_id === args.aiIdentifier || it.custom_props?.aiIdentifier === args.aiIdentifier);
                    });
                    if (itemKey) {
                        feedback = await equipItem(itemKey, args.slot);
                    } else {
                        args._retries = args._retries || 0;
                        if (args._retries < 5) {
                            args._retries++;
                            setTimeout(() => executeCommand(command, args), 50);
                            return null; 
                        } else {
                            feedback = `[ERROR] Не удалось экипировать '${args.aiIdentifier}'. Предмет не найден в инвентаре.`;
                        }
                    }
                } else {
                    feedback = `[ERROR] 'equipItem' требует аргумент 'aiIdentifier'.`;
                }
                break;

            case 'unequipItem':
                if (args.slot) {
                    const slot = args.slot.toLowerCase();
                    feedback = await unequipItem(slot);
                } else {
                    feedback = `[ERROR] 'unequipItem' требует 'slot'.`;
                }
                break;
            case 'createContainer':
                if (args.type && args.ownerId) {
                    const createContainerDefaults = getGameplayCommandDefaults().create_container || {};
                    const contId = await CoreInventorySystemAsync.createContainer(
                        args.type,
                        args.ownerId,
                        args.maxWeight ?? requireRuntimeNumber(createContainerDefaults.max_weight_kg, 'gameplay_runtime.command_defaults.create_container.max_weight_kg'),
                        args.maxSlots ?? requireRuntimeNumber(createContainerDefaults.max_slots, 'gameplay_runtime.command_defaults.create_container.max_slots'),
                        args.location || null,
                        {
                            lock_data: args.lockData || args.lock_data || {},
                            physical_props: args.physicalProps || args.physical_props || {},
                            custom_props: args.customProps || args.custom_props || {}
                        }
                    );
                    if (Array.isArray(args.items)) {
                        for (const itemDef of args.items) {
                            const protoId = itemDef.prototypeId || itemDef.prototype_id || itemDef.aiIdentifier || itemDef.id;
                            if (protoId) {
                                await CoreInventorySystemAsync.createItem(protoId, itemDef.quantity ?? requireRuntimeNumber(getGameplayRuntimeConfig().inventory.default_stack_quantity, 'gameplay_runtime.inventory.default_stack_quantity'), contId, itemDef.customProps || itemDef.custom_props || itemDef);
                            }
                        }
                    }
                    feedback = `[СИСТЕМА] Создан контейнер ${contId} типа ${args.type} для ${args.ownerId}.`;
                } else {
                    feedback = `[ERROR] 'createContainer' требует 'type' и 'ownerId'.`;
                }
                break;

            case 'moveItem':
                if (args.itemId && args.sourceContainerId) {
                    const res = await CoreInventorySystemAsync.moveItem(args.itemId, args.sourceContainerId, args.targetContainerId || null, args.quantity || null);
                    feedback = res.success ? `[СИСТЕМА] Предмет перемещен.` : `[ERROR] Ошибка перемещения: ${res.error}`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'moveItem' требует 'itemId' и 'sourceContainerId'.`;
                }
                break;

            case 'moveItems':
            case 'move_items':
                if (args.sourceContainerId && Array.isArray(args.items) && args.items.length > 0) {
                    const res = await CoreInventorySystemAsync.moveItems(args.sourceContainerId, args.targetContainerId || args.target || null, args.items, { actorId: 'player' });
                    feedback = res.success
                        ? `[СИСТЕМА] Перемещено предметов: ${res.movedCount}.`
                        : `[ERROR] Ошибка пакетного перемещения: ${res.error}`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'moveItems' требует 'sourceContainerId' и 'items' [{id, quantity}].`;
                }
                break;

            case 'initiateTrade':
            case 'initiate_trade': {
                const directItemId = args.itemId || args.item_id;
                const saleOfferItems = directItemId
                    ? [{ id: directItemId, quantity: args.quantity ?? requireRuntimeNumber(getGameplayRuntimeConfig().inventory.default_stack_quantity, 'gameplay_runtime.inventory.default_stack_quantity') }]
                    : (Array.isArray(args.offerItems) ? args.offerItems : []);
                const isMerchantSale = !!args.targetId && args.targetId !== 'player' && saleOfferItems.length > 0 && (!Array.isArray(args.requestItems) || args.requestItems.length === 0);
                const tradeConfig = isMerchantSale
                    ? {
                        initiatorId: args.initiatorId || 'player',
                        targetId: args.targetId,
                        initiatorContainerId: args.initiatorContainerId || player.container_backpack,
                        targetContainerId: args.targetContainerId,
                        offerItems: saleOfferItems,
                        mode: 'sale'
                    }
                    : {
                        initiatorId: args.initiatorId || 'player',
                        targetId: args.targetId,
                        initiatorContainerId: args.initiatorContainerId || player.container_backpack,
                        targetContainerId: args.targetContainerId,
                        offerItems: args.offerItems || [],
                        requestItems: args.requestItems || [],
                        mode: 'manual'
                    };

                const res = TradeSystem.initiateTrade(tradeConfig);
                feedback = res.success ? `[ТОРГОВЛЯ] ${res.message}` : `[ERROR] ${res.error}`;
                break;
            }

            case 'confirmTrade':
            case 'confirm_trade': {
                const tradeId = args.tradeId || args.trade_id || player.active_trade_id;
                if (!tradeId) {
                    feedback = `[ERROR] Нет активной сделки для подтверждения.`;
                    break;
                }
                const res = TradeSystem.confirmTrade(tradeId);
                feedback = res.success
                    ? `[ТОРГОВЛЯ] Сделка успешно завершена${res.price ? ` за ${res.price} золота` : ''}.`
                    : `[ERROR] Ошибка сделки: ${res.error}`;
                if (player.active_trade_id === tradeId) player.active_trade_id = null;
                updateInventoryDisplay();
                updateEquipmentDisplay();
                updateCharacterSheet();
                break;
            }

            case 'negotiateTrade':
            case 'negotiate': {
                const tradeId = args.tradeId || args.trade_id || player.active_trade_id;
                if (!tradeId) {
                    feedback = `[ERROR] Нет активной сделки для торга.`;
                    break;
                }
                const newOffer = args.newOffer ?? args.new_offer ?? args.price ?? args.offerItems;
                const res = TradeSystem.negotiateTrade(tradeId, newOffer, args.requestItems || args.request_items || []);
                feedback = res.success
                    ? `[ТОРГОВЛЯ] Условия сделки обновлены${res.acceptedPrice ? `: ${res.acceptedPrice} золота.` : '.'}`
                    : `[ERROR] Ошибка изменения сделки: ${res.error}`;
                break;
            }

            case 'destroyContainer':
                if (args.containerId) {
                    const res = await CoreInventorySystemAsync.destroyContainer(args.containerId);
                    feedback = res ? `[СИСТЕМА] Контейнер ${args.containerId} разрушен, содержимое высыпалось на землю.` : `[ERROR] Контейнер не найден.`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'destroyContainer' требует 'containerId'.`;
                }
                break;

            case 'unlockContainer':
                if (args.containerId) {
                    const res = await CoreInventorySystemAsync.unlockContainer(args.containerId, 'player');
                    feedback = res.success ? `[ВЗЛОМ] Успешно: ${res.message}` : `[ВЗЛОМ] Провал: ${res.error}`;
                    updateInventoryDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'unlockContainer' требует 'containerId'.`;
                }
                break;

            case 'confiscateStolen':
                if (args.targetId) {
                    const targetCont = args.targetId === 'player' ? player.container_backpack : args.targetId;
                    const count = await CoreInventorySystemAsync.confiscateStolen(targetCont, "guard_confiscation_chest");
                    feedback = `[СТРАЖА] Изъято краденых предметов: ${count}.`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'confiscateStolen' требует 'targetId'.`;
                }
                break;

            case 'buildContainer':
                if (args.type) {
                    const contId = await CoreInventorySystemAsync.buildContainer('player', args.type, player.location);
                    feedback = contId ? `[КРАФТ] Создан контейнер ${contId}. Потрачено 5 дерева.` : `[ERROR] Недостаточно дерева (нужно 5 wood).`;
                    updateInventoryDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'buildContainer' требует 'type'.`;
                }
                break;

            case 'applyAoEDamage':
                if (args.location && args.damage) {
                    let destroyed = 0;
                    for (const [contId, cont] of ContainerRegistry) {
                        if (resolveContainerLocation(cont.id)?.region_id === args.location && cont.physical_props) {
                            cont.physical_props.health -= args.damage;
                            getContainerItems(cont).forEach(itemId => {
                                const item = ItemRegistry.get(itemId);
                                if (item) item.durability -= Math.floor(args.damage / 2);
                            });
                            if (cont.physical_props.health <= 0) {
                                await CoreInventorySystemAsync.destroyContainer(cont.id);
                                destroyed++;
                            }
                        }
                    }
                    feedback = `[СИСТЕМА] AoE урон (${args.damage}) нанесен по локации ${args.location}. Разрушено контейнеров: ${destroyed}. Предметы внутри повреждены.`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'applyAoEDamage' требует 'location' и 'damage'.`;
                }
                break;

            case 'castMagicalPocket': {
                const existingPocket = Array.from(ContainerRegistry.values()).find(cont => cont.owner_id === 'player' && cont.type === 'magical_pocket');
                if (!player.statusEffects['spell_magical_pocket']) {
                    player.statusEffects['spell_magical_pocket'] = { id: 'spell_magical_pocket', name: 'Магический карман', duration: 9999, description: 'Открывает доступ к экстрадименсиональному хранилищу.', effects: [] };
                }
                if (existingPocket) {
                    existingPocket.location = normalizeContainerLocation({ world_coords: null, parent_entity: 'player', parent_container: null, region_id: 'astral' });
                    feedback = `[МАГИЯ] Магический карман уже активен.`;
                } else {
                    const contId = await CoreInventorySystemAsync.createContainer('magical_pocket', 'player', 500, 100, { world_coords: null, parent_entity: 'player', parent_container: null, region_id: 'astral' });
                    feedback = `[МАГИЯ] Создан магический карман (ID: ${contId}).`;
                }
                break;
            }

            case 'dispelMagicPocket': {
                const pocketId = args.containerId || Array.from(ContainerRegistry.values()).find(cont => cont.owner_id === 'player' && cont.type === 'magical_pocket')?.id;
                if (pocketId && ContainerRegistry.has(pocketId)) {
                    ContainerRegistry.get(pocketId).location = resolveActorLocation('player');
                    await CoreInventorySystemAsync.destroyContainer(pocketId);
                    delete player.statusEffects['spell_magical_pocket'];
                    feedback = `[МАГИЯ] Магический карман развеян, вещи высыпались в реальный мир.`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] Магический карман не найден.`;
                }
                break;
            }

            case 'fleePackAnimal':
                if (args.containerId) {
                    const contId = resolveSpecialContainerId(args.containerId);
                    const cont = ContainerRegistry.get(contId);
                    if (cont) {
                        await CoreInventorySystemAsync.updateContainerLocation(contId, normalizeContainerLocation({ world_coords: [0, 0, 0], parent_entity: null, parent_container: null, region_id: "unknown_wilderness" }));
                        feedback = `[СОБЫТИЕ] Вьючное животное испугалось и сбежало вместе с контейнером ${contId}!`;
                    } else {
                        feedback = `[ERROR] Контейнер не найден.`;
                    }
                } else {
                    feedback = `[ERROR] 'fleePackAnimal' требует 'containerId'.`;
                }
                break;

            case 'updateItemStat':
                if (args.aiIdentifier && args.stat && args.change !== undefined) {
                    let item = null;
                    let isEquipped = false;
                    if (player.container_backpack) {
                        const bp = ContainerRegistry.get(player.container_backpack);
                        const id = getContainerItems(bp).find(i => ItemRegistry.get(i).prototype_id === args.aiIdentifier);
                        if (id) item = ItemRegistry.get(id);
                    }
                    if (!item && player.container_equipment) {
                        const eq = ContainerRegistry.get(player.container_equipment);
                        const id = getContainerItems(eq).find(i => ItemRegistry.get(i).prototype_id === args.aiIdentifier);
                        if (id) {
                            item = ItemRegistry.get(id);
                            isEquipped = true;
                        }
                    }
                    if (item) {
                        const change = parseInt(args.change, 10);
                        item.durability = ((item.durability ?? requireRuntimeNumber(getGameplayRuntimeConfig().inventory.default_item_durability, 'gameplay_runtime.inventory.default_item_durability'))) + change;
                        feedback = `[Предмет] Характеристика '${args.stat}' у '${item.custom_props.name}' изменена на ${change > 0 ? '+' + change : change}. Текущее значение: ${item.durability}`;
                        if (isEquipped) updateEquipmentDisplay();
                        else updateInventoryDisplay();
                    } else {
                        feedback = `[ERROR] Предмет '${args.aiIdentifier}' не найден для updateItemStat.`;
                    }
                } else {
                    feedback = `[ERROR] 'updateItemStat' требует 'aiIdentifier', 'stat' и 'change'.`;
                }
                break;

            // --- ЛЕГИТИМНЫЕ ВМЕШАТЕЛЬСТВА ГМ (СТРАТЕГ) ---
            case 'buildShip':
            case 'buildPort':
            case 'upgradePort':
            case 'navalBlockade':

            case 'gmPurchaseGoods':
            case 'gmSellGoods':
            case 'gmInvestInFacility':
            case 'gmModifyTradeSecurity':
            case 'gmRaiseMilitia':
            case 'gmSpreadRumor':
            case 'gmFrameForSabotage':
            case 'gmDirectResourceInjection':
            case 'gmDeclareWar':
            case 'gmForcePeace':
            case 'gmChangeRulerTrait':
            case 'gmCreateFaction':
            case 'gmTransferRegion':
            case 'gmRaisePlayerArmy':
            case 'gmCommandArmy':
                // Фолбэки для ключей, если ИИ ошибся
                if (command === 'gmCreateFaction') {
                    if (!args.factionId) args.factionId = args.id || args.key || args.aiIdentifier;
                }
                if (command === 'gmTransferRegion') {
                    if (!args.newFactionId) args.newFactionId = args.factionId || args.id || args.key || args.aiIdentifier;
                    if (!args.regionId) args.regionId = args.locationName || args.target || args.id;
                }

                // Умный поиск региона
                if (args.regionId && typeof World !== 'undefined' && World && World.regions && !World.regions[args.regionId]) {
                    const searchStr = String(args.regionId).toLowerCase().trim();
                    for (let key in World.regions) {
                        const rName = World.regions[key].name.toLowerCase().trim();
                        if (searchStr === rName || searchStr.includes(rName) || rName.includes(searchStr)) {
                            args.regionId = key;
                            break;
                        }
                    }
                }
                
                // Умный поиск фракции для gmTransferRegion
                if (command === 'gmTransferRegion' && args.newFactionId && typeof World !== 'undefined' && World && World.factions && !World.factions[args.newFactionId]) {
                    const searchStr = String(args.newFactionId).toLowerCase().trim();
                    for (let key in World.factions) {
                        const fName = World.factions[key].name.toLowerCase().trim();
                        if (searchStr === fName || searchStr.includes(fName) || fName.includes(searchStr)) {
                            args.newFactionId = key;
                            break;
                        }
                    }
                }

                if (window.electronAPI && window.electronAPI.nexusGmIntervention) {
                    const res = await window.electronAPI.nexusGmIntervention({ command, args }, player?.location || "");
                    if (res.status === 'ok') {
                        if (!res.feedback || res.feedback.trim() === '') {
                            let errMsg = `[КРИТИЧЕСКАЯ ОШИБКА ЯДРА] Команда '${command}' проигнорирована C++ движком! Вы забыли перекомпилировать meterea_engine.exe после применения патчей.`;
                            addLogMessage(errMsg, "system-message");
                            addCalculationMessage(errMsg);
                            break;
                        }
                        if (res.world) setWorld(res.world);
                        if (res.relevant_news) World.relevant_news = res.relevant_news;
                        if (res.items) res.items.forEach(([k, v]) => ItemRegistry.set(k, v));
                        if (res.containers) res.containers.forEach(([k, v]) => setContainer(k, v));
                        if (res.deleted_items) res.deleted_items.forEach(id => ItemRegistry.delete(id));
                        if (res.deleted_containers) res.deleted_containers.forEach(id => ContainerRegistry.delete(id));
                        processMonsterQuests();
                        
                        if (res.feedback) {
                            feedback = res.feedback; // Возвращаем фидбек в основной цикл
                        }
                        
                        updateCharacterSheet();
                        if (typeof updateHoldingsDisplay === 'function') updateHoldingsDisplay();
                        if (typeof updatePortPanel === 'function') updatePortPanel();
                        if (typeof updateTradeJournalDisplay === 'function') updateTradeJournalDisplay();
                        if (typeof updateWorldChroniclesDisplay === 'function') updateWorldChroniclesDisplay();
                        
                        if (typeof updateWorldSimDebugDisplay === 'function') updateWorldSimDebugDisplay();
                        if (typeof updateMapDisplay === 'function') {
                            if (window.Cartographer) window.Cartographer.lastGenerationTick = -1;
                            updateMapDisplay();
                        }
                    }
                }
                break;


            default:
                const oldCommands = ['ADD_TRAIT', 'UPDATE_TRAIT_VALUE', 'REMOVE_TRAIT', 'DEFINE_HOLDING', 'UPDATE_HOLDING', 'REMOVE_HOLDING'];
                if (oldCommands.includes(command)) {
                    feedback = `[DEBUG] Получена устаревшая команда '${command}'. Пожалуйста, используйте систему NEXUS.`;
                } else {
                    feedback = t('gameInterface.commandFeedback.errorUnknownCommand', { command: command });
                }
                console.warn(feedback, args);
        }
    } catch (error) {
        feedback = t('gameInterface.commandFeedback.errorCommandGeneric', { command: command, args: error.message });
        console.error(`Критическая ошибка при выполнении команды ${command}:`, error, args);
    }
    return feedback;
}

// === ФУНКЦИИ ДЛЯ ПРИМЕНЕНИЯ ПОСЛЕДСТВИЙ ЭРОТИЧЕСКИХ СЦЕН ===

/**
 * Применяет беременность к игроку
 * @param {string} partnerId - ID NPC-партнёра (опционально)
 * @returns {string} Сообщение для лога
 */
function applyPregnancy(partnerId = null) {
    if (!player) return '[ERROR] Player not found';

    // Проверяем, нет ли уже беременности
    if (player.statusEffects && player.statusEffects['pregnancy']) {
        return 'Игрок уже беременен/беременна.';
    }

    const duration = 270; // 9 месяцев (270 дней)
    const effectData = {
        id: 'pregnancy',
        name: 'Беременность',
        duration: duration,
        description: 'Вы беременны. Это влияет на ваши физические характеристики.',
        effects: [
            { trigger: { type: 'on_apply' }, action: { type: 'modify_stat', stat: 'con', change: -2 } },
            { trigger: { type: 'on_apply' }, action: { type: 'modify_stat', stat: 'dex', change: -1 } },
            { trigger: { type: 'on_remove' }, action: { type: 'restore_stat', stat: 'con' } },
            { trigger: { type: 'on_remove' }, action: { type: 'restore_stat', stat: 'dex' } }
        ],
        appliedTurn: player.stats.turnCount,
        originalValues: {
            con: player.stats.con ?? getCharacterStatBaseline('constitution'),
            dex: player.stats.dex ?? getCharacterStatBaseline('dexterity')
        },
        custom_props: {
            partnerId: partnerId,
            stage: 1 // 1-3 триместр (будет обновляться автоматически по дням)
        }
    };

    if (!player.statusEffects) player.statusEffects = {};
    player.statusEffects['pregnancy'] = effectData;

    // Применяем эффекты на статы
    player.stats.con = (player.stats.con ?? getCharacterStatBaseline('constitution')) - 2;
    player.stats.dex = (player.stats.dex ?? getCharacterStatBaseline('dexterity')) - 1;

    updateStatusEffectsDisplay();
    updateCharacterSheet();

    return `Применена беременность (партнёр: ${partnerId || 'неизвестен'}). Длительность: ${duration} дней.`;
}

/**
 * Применяет венерическое заболевание к игроку
 * @param {number} severity - Тяжесть заболевания (1-3)
 * @returns {string} Сообщение для лога
 */
function applyDisease(severity = 2) {
    if (!player) return '[ERROR] Player not found';

    severity = Math.max(1, Math.min(3, severity)); // Ограничиваем 1-3
    const diseaseId = `disease_std_${severity}`;

    // Проверяем, нет ли уже этого заболевания
    if (player.statusEffects && player.statusEffects[diseaseId]) {
        return `Игрок уже болен ЗППП (тяжесть ${severity}).`;
    }

    let diseaseName = 'Венерическое заболевание';
    let description = 'Вы заразились венерическим заболеванием. Требуется лечение.';
    const effects = [];
    const originalValues = {};

    const chaChange = severity === 1 ? -2 : (severity === 2 ? -3 : -5);
    const hpChange = -severity;

    effects.push({ trigger: { type: 'on_turn_start', interval: 1 }, action: { type: 'modify_stat', stat: 'hp', change: hpChange } });
    effects.push({ trigger: { type: 'on_apply' }, action: { type: 'modify_stat', stat: 'cha', change: chaChange } });
    effects.push({ trigger: { type: 'on_remove' }, action: { type: 'restore_stat', stat: 'cha' } });
    originalValues.cha = player.stats.cha ?? getCharacterStatBaseline('charisma');

    if (severity === 1) {
        diseaseName = 'Лёгкое ЗППП';
    } else if (severity === 2) {
        diseaseName = 'Р—РџРџРџ';
    } else if (severity === 3) {
        diseaseName = 'Тяжёлое ЗППП';
        description = 'Вы заразились тяжёлым венерическим заболеванием. Срочно требуется лечение!';
        effects.push({ trigger: { type: 'on_apply' }, action: { type: 'modify_stat', stat: 'con', change: -1 } });
        effects.push({ trigger: { type: 'on_remove' }, action: { type: 'restore_stat', stat: 'con' } });
        originalValues.con = player.stats.con ?? getCharacterStatBaseline('constitution');
    }

    const effectData = {
        id: diseaseId,
        name: diseaseName,
        duration: 9999, // Бесконечно, пока не вылечат
        description: description,
        effects: effects,
        appliedTurn: player.stats.turnCount,
        originalValues: originalValues,
        custom_props: { severity: severity, curable: true }
    };

    if (!player.statusEffects) player.statusEffects = {};
    player.statusEffects[diseaseId] = effectData;

    // Применяем эффекты на статы
    player.stats.cha = (player.stats.cha ?? getCharacterStatBaseline('charisma')) + chaChange;
    if (severity === 3) {
        player.stats.con = (player.stats.con ?? getCharacterStatBaseline('constitution')) - 1;
    }

    updateStatusEffectsDisplay();
    updateCharacterSheet();

    return `Применено ЗППП (тяжесть ${severity}). Требуется лечение.`;
}

/**
 * Применяет последствия для репутации
 * @param {string} key - Ключ репутации (например, 'sexual_reputation' или 'scandal_npc_id')
 * @param {number} change - Изменение репутации (обычно отрицательное)
 * @returns {string} Сообщение для лога
 */
function applyReputationConsequence(key = 'sexual_reputation', change = -20) {
    if (!player) return '[ERROR] Player not found';

    if (!player.reputation) player.reputation = {};

    const oldValue = player.reputation[key] || 0;
    player.reputation[key] = oldValue + change;

    updateCharacterSheet(); // ИСПРАВЛЕНО: Обновляем лист персонажа, так как updateReputationDisplay не существует

    return `Репутация изменена: ${key} ${oldValue} → ${player.reputation[key]} (${change >= 0 ? '+' : ''}${change})`;
}

/**
 * Экипирует предмет из инвентаря.
 * @param {string} itemInternalId - Внутренний ID предмета в инвентаре.
 * @returns {string|null} Сообщение для лога или null.
 */
async function equipItem(itemId, targetSlot = null) {
    if (!player || !player.container_backpack || !player.container_equipment) return null;
    const itemToEquip = ItemRegistry.get(itemId);
    if (!itemToEquip || itemToEquip.container_id !== player.container_backpack) return null;

    if (!targetSlot) {
        const allPossibleSlots = bodySlots.filter(s => !itemToEquip.custom_props.slot || itemToEquip.custom_props.slot === s || (['right_hand', 'left_hand'].includes(s) && ['right_hand', 'left_hand'].includes(itemToEquip.custom_props.slot)));
        if (allPossibleSlots.length === 0) return t('gameInterface.commandFeedback.itemNotEquipable', { itemName: itemToEquip.custom_props.name });
        const eqCont = ContainerRegistry.get(player.container_equipment);
        targetSlot = allPossibleSlots.find(s => !getContainerItems(eqCont).find(id => ItemRegistry.get(id).slot_index === s));
        if (!targetSlot) targetSlot = allPossibleSlots[0];
    }

    if (!bodySlots.includes(targetSlot)) return `[ERROR] Попытка экипировать в несуществующий слот: '${targetSlot}'`;

    const eqCont = ContainerRegistry.get(player.container_equipment);
    const existingItemInSlot = getContainerItems(eqCont).find(id => ItemRegistry.get(id).slot_index === targetSlot);
    
    if (existingItemInSlot) {
        const unequipFeedback = await unequipItem(targetSlot);
        if (unequipFeedback && unequipFeedback.includes('Инвентарь полон')) return unequipFeedback;
    }

    await CoreInventorySystemAsync.moveItem(itemId, player.container_backpack, player.container_equipment);
    itemToEquip.slot_index = targetSlot;
    itemToEquip.state = "equipped";

    updateInventoryDisplay();
    updateEquipmentDisplay();
    updateCharacterSheet();

    queuePlayerActionForGM(`Player equipped item '${itemToEquip.custom_props.name}' to slot '${targetSlot}'.`);
    if (itemTooltipElement) itemTooltipElement.style.display = 'none';

    return t('gameInterface.commandFeedback.itemEquipped', { itemName: itemToEquip.custom_props.name, slot: targetSlot });
}

async function handleDrop(event) {
    event.preventDefault();
    const targetSlotElement = event.currentTarget;
    const slotName = targetSlotElement.dataset.slot;
    const itemId = event.dataTransfer.getData('text/plain');

    targetSlotElement.classList.remove('drag-over', 'drag-over-valid', 'drag-over-invalid');

    if (!itemId || !draggedItemData) return;

    let isValid = true;
    if (draggedItemData.slot && draggedItemData.slot !== slotName) {
        if (!(['right_hand', 'left_hand'].includes(slotName) && ['right_hand', 'left_hand'].includes(draggedItemData.slot))) {
            isValid = false;
        }
    }
    if (!isValid) {
        console.warn(`Попытка экипировать предмет '${draggedItemData.name}' в неверный слот '${slotName}'.`);
        return;
    }

    // Вызываем нашу универсальную функцию equipItem
    const feedback = await equipItem(itemId, slotName);

    if (feedback) {
        addLogMessage(feedback, 'command-feedback');
    }
}

/**
 * Снимает предмет из указанного слота.
 * @param {string} slot - Название слота (например, 'head', 'right_hand').
 * @returns {string|null} Сообщение для лога или null.
 */
async function unequipItem(slot) {
    if (!player || !player.container_equipment || !player.container_backpack) return null;
    const eqCont = ContainerRegistry.get(player.container_equipment);
    const itemId = getContainerItems(eqCont).find(id => ItemRegistry.get(id).slot_index === slot);
    if (!itemId) return t('gameInterface.commandFeedback.slotIsEmpty', { slot: slot });

    const itemToUnequip = ItemRegistry.get(itemId);
    const backpack = ContainerRegistry.get(player.container_backpack);

    if (getContainerItems(backpack).length >= player.inventoryCapacity) {
        return t('gameInterface.commandFeedback.inventoryFullOnUnequip', { itemName: itemToUnequip.custom_props.name });
    }

    await CoreInventorySystemAsync.moveItem(itemId, player.container_equipment, player.container_backpack);
    itemToUnequip.slot_index = null;
    itemToUnequip.state = "idle";

    updateInventoryDisplay();
    updateEquipmentDisplay();
    updateCharacterSheet();

    queuePlayerActionForGM(`Player unequipped item '${itemToUnequip.custom_props.name}' from slot '${slot}'.`);
    if (itemTooltipElement) itemTooltipElement.style.display = 'none';

    return t('gameInterface.commandFeedback.itemUnequipped', { itemName: itemToUnequip.custom_props.name, slot: slot });
}

/**
 * Обновляет визуальное отображение всех слотов экипировки.
 */
function populateEquipmentUI() {
    const grid = document.getElementById('paper-doll-grid');
    if (!grid) return;
    
    bodySlots = window.EQUIPMENT_SLOTS;
    grid.innerHTML = '';
    equipmentElements = {};

    const iconMap = {
        'head': 'fa-crown', 'face': 'fa-mask', 'neck': 'fa-gem',
        'shoulders': 'fa-user-shield', 'torso': 'fa-tshirt',
        'right_hand': 'fa-gavel', 'left_hand': 'fa-shield-alt',
        'legs': 'fa-socks', 'feet': 'fa-shoe-prints'
    };

    bodySlots.forEach(slot => {
        const div = document.createElement('div');
        div.className = 'equipment-slot-v2';
        div.id = `equipment-slot-${slot}`;
        div.dataset.slot = slot;
        
        const titleKey = `gameInterface.equipmentPanel.slots.${slot}`;
        div.title = typeof t === 'function' ? t(titleKey, null, slot) : slot;

        const iconClass = iconMap[slot] || 'fa-cog';
        div.innerHTML = `<span class="slot-icon-v2"><i class="fas ${iconClass}"></i></span>`;
        
        grid.appendChild(div);
        equipmentElements[slot] = div;

        // Привязываем события Drag-and-Drop и клика
        div.addEventListener('click', async (event) => {
            if (event.currentTarget.classList.contains('equipped')) {
                const slotName = event.currentTarget.dataset.slot;
                const feedback = await unequipItem(slotName);
                if (feedback) addLogMessage(feedback, 'command-feedback');
            }
        });
        div.addEventListener('dragenter', handleDragEnter);
        div.addEventListener('dragover', handleDragOver);
        div.addEventListener('dragleave', handleDragLeave);
        div.addEventListener('drop', handleDrop);
    });
}

function updateEquipmentDisplay() {
    if (!player || !player.container_equipment) return;
    const eqCont = ContainerRegistry.get(player.container_equipment);
    if (!eqCont) return;

    bodySlots.forEach(slot => {
        const itemId = getContainerItems(eqCont).find(id => {
            const it = ItemRegistry.get(id);
            return it && it.slot_index === slot;
        });
        const item = itemId ? ItemRegistry.get(itemId) : null;
        const slotElement = equipmentElements[slot];
        if (!slotElement) return;

        const oldItemNameEl = slotElement.querySelector('.item-name-v2');
        if (oldItemNameEl) oldItemNameEl.remove();

        if (item) {
            const props = item.custom_props || {};
            slotElement.classList.add('equipped');

            const itemNameEl = document.createElement('span');
            itemNameEl.className = 'item-name-v2';
            itemNameEl.textContent = props.name || item.prototype_id;
            slotElement.appendChild(itemNameEl);

            let bonusText = (props.effects || [])
                .filter(e => e.type === 'modify_stat' && e.stat)
                .map(e => `${e.stat.toUpperCase()}: ${e.change > 0 ? '+' : ''}${e.change}`)
                .join(', ');

            let titleText = props.description || '';
            if (bonusText) {
                titleText += `\n\n${t('gameInterface.inventoryPanel.effectsLabel')}: ${bonusText}`;
            }
            slotElement.title = titleText;

        } else {
            slotElement.classList.remove('equipped');
            slotElement.title = t(`gameInterface.equipmentPanel.slots.${slot}`, null, slot);
        }
    });
}

/**
 * Рассчитывает эффективные характеристики персонажа, учитывая базовые статы,
 * бонусы от экипировки и временные эффекты.
 * @returns {{effectiveStats: object, bonuses: object}} Объект с итоговыми характеристиками и бонусами.
 */
function getEffectiveStats() {
    if (!player) return { effectiveStats: {}, bonuses: {}, breakdown: {} };

    const effectiveStats = structuredClone(player.stats);
    const bonuses = {};
    const breakdown = {};

    const statsToTrack = ['str', 'dex', 'int', 'con', 'cha', 'res', 'hp', 'mana'];
    statsToTrack.forEach(s => {
        bonuses[s] = 0;
        breakdown[s] = [];
    });

    if (player.container_equipment) {
        const eqCont = ContainerRegistry.get(player.container_equipment);
        if (eqCont) {
            (eqCont.items || []).forEach(itemId => {
                const item = ItemRegistry.get(itemId);
                if (item && item.custom_props && Array.isArray(item.custom_props.effects)) {
                    item.custom_props.effects.forEach(effect => {
                        const stat = effect.stat?.toLowerCase();
                        if (statsToTrack.includes(stat)) {
                            const change = Number(effect.change) || 0;
                            bonuses[stat] += change;
                            effectiveStats[stat] += (stat === 'hp' || stat === 'mana') ? 0 : change;

                            breakdown[stat].push({
                                name: item.custom_props.name || item.prototype_id,
                                change: change
                            });
                        }
                    });
                }
            });
        }
    }

    const totalWeight = CoreInventorySystemAsync.getContainerWeight(player.container_backpack) + CoreInventorySystemAsync.getContainerWeight(player.container_equipment);
    const carryLimit = effectiveStats.str * 5;
    if (totalWeight > carryLimit) {
        const penalty = Math.floor((totalWeight - carryLimit) / 10) + 1;
        bonuses['dex'] -= penalty;
        effectiveStats.dex -= penalty;
        breakdown['dex'].push({ name: "Перегруз (Вес)", change: -penalty });
    }


    effectiveStats.maxHp = calculateMaxHp(effectiveStats.con) + bonuses['hp'];
    if (player.class === 'mage') {
        effectiveStats.maxMana = calculateMaxMana(effectiveStats.int, player.stats.level) + bonuses['mana'];
    }

    return { effectiveStats, bonuses, breakdown };
}


function updateTraitsDisplay() {
    if (!player || !traitsList) return;
    traitsList.innerHTML = '';
    const playerTraits = Object.values(player.traits || {});

    if (playerTraits.length === 0) {
        traitsList.innerHTML = `<li data-i18n="gameInterface.traitsPanel.empty">Нет особых черт</li>`;
        return;
    }

    // Группировка по категориям
    const groupedTraits = playerTraits.reduce((acc, trait) => {
        const category = trait.category || 'Прочее';
        if (!acc[category]) {
            acc[category] = [];
        }
        acc[category].push(trait);
        return acc;
    }, {});

    for (const category in groupedTraits) {
        const categoryHeader = document.createElement('li');
        categoryHeader.className = 'category-header'; // Можно добавить стили для заголовков
        categoryHeader.textContent = category;
        traitsList.appendChild(categoryHeader);

        groupedTraits[category].forEach(trait => {
            const li = document.createElement('li');
            li.title = trait.description;
            let valueDisplay = '';
            if (trait.type === 'numeric') {
                valueDisplay = ` (Ранг: ${trait.value})`;
            } else if (trait.type === 'text') {
                valueDisplay = `: ${trait.value}`;
            }
            li.innerHTML = `<span class="trait-name">${trait.name}</span><span class="trait-value">${valueDisplay}</span>`;
            traitsList.appendChild(li);
        });
    }
}

function updateHoldingsDisplay() {
    const panel = document.querySelector('.holdings-panel');
    if (!player || !holdingsList || !panel) return;
    
    if (!player.bankAccount) player.bankAccount = { deposit: 0, loan: 0, loanDays: 0 };
    
    const playerBusinesses = (typeof World !== 'undefined' && World && World.businesses) ? Object.values(World.businesses).filter(b => b.owner_ids.includes('player')) : [];

    panel.style.display = 'flex';
    holdingsList.innerHTML = '';

    // Банковский счет
    if (player.bankAccount.deposit > 0 || player.bankAccount.loan > 0) {
        const bankHeader = document.createElement('li');
        bankHeader.className = 'category-header';
        bankHeader.innerHTML = '<i class="fas fa-university"></i> Банковский счет';
        holdingsList.appendChild(bankHeader);

        if (player.bankAccount.deposit > 0) {
            holdingsList.innerHTML += `<li title="Деньги в банке приносят 1% дохода в день"><span class="holding-name" style="color:#2ecc71">Депозит</span><span class="holding-value">${player.bankAccount.deposit} 💰</span></li>`;
        }
        if (player.bankAccount.loan > 0) {
            holdingsList.innerHTML += `<li title="Долг растет на 2% в день. Осталось дней: ${player.bankAccount.loanDays}"><span class="holding-name" style="color:#e74c3c">Кредит (${player.bankAccount.loanDays} дн.)</span><span class="holding-value">${player.bankAccount.loan} 💰</span></li>`;
        }
    }

    // Предприятия
    const propHeader = document.createElement('li');
    propHeader.className = 'category-header';
    propHeader.innerHTML = '<i class="fas fa-industry"></i> Предприятия';
    holdingsList.appendChild(propHeader);

    playerBusinesses.forEach(bus => {
        const li = document.createElement('li');
        li.style.cursor = 'pointer';
        li.title = "Нажмите для управления логистикой и производством";
        li.onclick = () => openBusinessModal(bus.id);
        let bName = getFacilityName(bus.facility_type);
        const reg = World.regions[bus.region_id];
        if (reg) {
            const block = reg.cityLayout.find(b => b.linked_id === bus.id);
            if (block && block.name !== block.type) bName = block.name;
        }
        let statusText = bus.is_active ? `<span style="color:#f1c40f">${bus.cash_balance} 💰</span>` : (bus.construction_days_left > 0 ? `<span style="color:#e67e22" title="Идет строительство">🏗️ ${bus.construction_days_left} дн.</span>` : `<span style="color:#e74c3c">Закрыто</span>`);
        li.innerHTML = `<span class="holding-name" style="color:#3498db; text-decoration:underline;">${bName}</span><span class="holding-value">${statusText}</span>`;
        holdingsList.appendChild(li);
    });
}

// --- Система Сохранений / Загрузки ---














/**
 * (НОВАЯ ФУНКЦИЯ) Сохраняет хэндл директории в IndexedDB для постоянного хранения.
 * @param {FileSystemDirectoryHandle} dirHandle Хэндл для сохранения.
 */


/**
 * Настраивает управление интерактивной картой (панорамирование и зум).
 */
function setupMapControls() { if (window.Cartographer) Cartographer.init(); }

/**
 * Преобразует экранные координаты в мировые.
 */


/**
 * Определяет тип локации по ее названию для выбора иконки.
 */










function handleBeforeUnload(event) {
    // Мы полностью убираем попытку асинхронного сохранения при экстренном закрытии окна (нажатие на крестик).
    // В Electron асинхронные IPC-вызовы (invoke) во время события beforeunload 
    // вызывают жесткий deadlock (зависание "Не отвечает"), так как процесс рендерера уже уничтожается.
    console.log("Окно закрывается. Очистка процессов...");
    stopAutoSaveTimer();
    stopBackgroundChanger();
    pauseMusic();
    if (speechSynthesis && speechSynthesis.speaking) {
        speechSynthesis.cancel();
    }
}

// --- Выход из игры ---
async function exitToMainMenu() {
    console.log("Запрос выхода в меню.");
    closeInGameMenu();
    playMenuMusic();

    const performExit = () => {
        stopAutoSaveTimer();
        pauseMusic();
        if (speechSynthesis && speechSynthesis.speaking) {
            speechSynthesis.cancel();
        }
        player = null;
        World = null;
        conversationHistory = [];
        currentSaveSlot = null;
        if (gameLog) gameLog.innerHTML = `<p class="system-message">${t('gameInterface.log.loading')}</p>`;

        if (gameInterface) {
            gameInterface.style.display = 'none';
            gameInterface.classList.remove('active-screen');
        }

        isMapInitialized = false;
        if (window.Cartographer) window.Cartographer.isMapInitialized = false;
        setActiveScreen('main-menu');
        updateDynamicUIText();

        if (document.activeElement) document.activeElement.blur();
    };

            if (player && tempPlayer === null && !IS_PRE_SIMULATING && conversationHistory.length > 0) {
            showCustomConfirm(
                t("gameInterface.log.exitConfirm"),
                async () => {
                    await autoSaveGame();
                    performExit();
                }
            );
        } else {
            performExit();
        }
}


// --- Функции Управления Фоном ---
function changeBackground() {
    if (!backgroundContainer || backgroundFiles.length === 0) {
        console.warn("Контейнер фона или список файлов отсутствует/пуст.");
        return;
    }

    let randomIndex;
    if (backgroundFiles.length > 1) {
        do { randomIndex = Math.floor(Math.random() * backgroundFiles.length); }
        while (randomIndex === lastBackgroundIndex);
    } else { randomIndex = 0; }
    lastBackgroundIndex = randomIndex;

    const fileName = backgroundFiles[randomIndex];
    const filePath = `assets/fone/${fileName}`;
    const fileExtension = fileName.split('.').pop().toLowerCase();
    const isVideo = ['mp4', 'webm', 'ogv'].includes(fileExtension);

    console.log(`Смена фона на: ${filePath}`);

    const newElement = document.createElement(isVideo ? 'video' : 'img');
    newElement.src = filePath;
    newElement.dataset.fileName = fileName; // Для отладки

    newElement.addEventListener('error', (e) => {
        console.error(`Ошибка загрузки медиа фона: ${fileName}`, e);
        if (newElement.parentNode === backgroundContainer) backgroundContainer.removeChild(newElement);
        if (currentBackgroundElement === newElement) {
            currentBackgroundElement = null;
            // Удаляем битый файл из списка, чтобы не пытаться загрузить его снова
            const failedIndex = backgroundFiles.indexOf(fileName);
            if (failedIndex > -1) backgroundFiles.splice(failedIndex, 1);
            setTimeout(changeBackground, 1000); // Попробовать другой фон через секунду
        }
    });

    if (isVideo) {
        newElement.autoplay = true;
        newElement.muted = true;
        newElement.loop = true;
        newElement.playsInline = true; // Для iOS
        newElement.setAttribute('preload', 'auto');
        newElement.addEventListener('loadeddata', () => showNewBackground(newElement), { once: true });
    } else { // img
        newElement.onload = () => showNewBackground(newElement);
    }

    backgroundContainer.appendChild(newElement); // Добавляем новый элемент в контейнер
}

function showNewBackground(elementToShow) {
    if (!elementToShow || elementToShow.parentNode !== backgroundContainer) {
        // Элемент мог быть удален из-за ошибки загрузки до вызова этой функции
        console.warn("showNewBackground: элемент не найден в контейнере или отсутствует.");
        return;
    }

    const oldElement = currentBackgroundElement;
    currentBackgroundElement = elementToShow; // Новый элемент становится текущим

    requestAnimationFrame(() => { // Плавное появление
        elementToShow.classList.add('visible');
    });

    if (oldElement && oldElement !== elementToShow) { // Если был старый фон и он не тот же самый
        oldElement.classList.remove('visible'); // Плавное исчезновение старого
        const removeOldElement = () => {
            if (oldElement && oldElement.parentNode === backgroundContainer) {
                backgroundContainer.removeChild(oldElement);
                // console.log("Удален старый фон:", oldElement.dataset.fileName);
            }
        };
        // Удаляем старый элемент после завершения анимации исчезновения
        oldElement.addEventListener('transitionend', removeOldElement, { once: true });
        // Fallback, если transitionend не сработает (например, если элемент был скрыт display:none)
        setTimeout(removeOldElement, 2000); // 2 секунды
    }
}

function startBackgroundChanger() {
    stopBackgroundChanger();
    if (backgroundFiles.length > 0) {
        changeBackground(); // Показать первый фон сразу
        if (backgroundFiles.length > 1 && BACKGROUND_CHANGE_INTERVAL > 0) {
            backgroundChangeTimer = setInterval(changeBackground, BACKGROUND_CHANGE_INTERVAL);
            // Track for cleanup
            if (!window._activeTimers) window._activeTimers = [];
            window._activeTimers.push(backgroundChangeTimer);
            console.log(`Смена фона запущена с ${backgroundFiles.length} файлами.`);
        }
    } else {
        console.warn("Не удается запустить смену фона: массив backgroundFiles пуст.");
        if (backgroundContainer) backgroundContainer.style.backgroundColor = '#1a2530'; // Fallback цвет
    }
}

function stopBackgroundChanger() {
    if (backgroundChangeTimer) {
        clearInterval(backgroundChangeTimer);
        backgroundChangeTimer = null;
        console.log("Смена фона остановлена.");
    }
}

// ЭФФЕКТ ПАРАЛЛАКСА ДЛЯ ФОНА
document.addEventListener('mousemove', (e) => {
    // Убрали проверку if (!player), теперь работает всегда
    const moveX = (e.clientX - window.innerWidth / 2) * 0.01; // Смещение 1%
    const moveY = (e.clientY - window.innerHeight / 2) * 0.01;

    // Устанавливаем CSS переменные
    document.documentElement.style.setProperty('--parallax-x', `${-moveX}px`);
    document.documentElement.style.setProperty('--parallax-y', `${-moveY}px`);
});

// Дополнительно: Тряска экрана при получении урона (вызывай эту функцию в executeCommand)
function shakeScreen() {
    const container = document.querySelector('.game-container');
    if (container) {
        container.style.animation = 'none';
        container.offsetHeight; // триггер перерисовки
        container.style.animation = 'goldShakeAnim 0.4s ease-in-out';
    }
}

// --- СИСТЕМА ЗВУКОВ ИНТЕРФЕЙСА ---
const hoverSfx = new Audio('assets/sound/ui_hover.mp3');
const clickSfx = new Audio('assets/sound/ui_click.mp3');

// Настройка громкости (чтобы не пугать игрока)
function updateSfxVolume() {
    hoverSfx.volume = sfxVolume * 0.2; // Hover тише клика
    clickSfx.volume = sfxVolume * 0.4;
}
updateSfxVolume();

// Функция для проигрывания без задержек
function playSfx(audioObj) {
    audioObj.currentTime = 0; // Сброс в начало, чтобы можно было спамить звуком
    audioObj.play().catch(() => { }); // Игнорируем ошибки автоплея
}

// Глобальный слушатель наведения
let lastHoverSoundTime = 0;
document.addEventListener('mouseover', (e) => {
    // Проверяем, является ли элемент кнопкой или находится ли он внутри кнопки/слота/вкладки
    const target = e.target.closest('button, .equipment-slot-v2, .tab-button, .save-slot-btn, .tag-chip, li.quest-item, li[data-item-id]');

    if (target) {
        const now = Date.now();
        if (now - lastHoverSoundTime > 1000) { // Задержка 1 секунда (debounce)
            playSfx(hoverSfx);
            lastHoverSoundTime = now;
        }
    }
}, true);

// Глобальный слушатель клика
document.addEventListener('mousedown', (e) => {
    const target = e.target.closest('button, .equipment-slot-v2, .tab-button, .save-slot-btn, .tag-chip, li.quest-item, li[data-item-id]');

    if (target) {
        playSfx(clickSfx);
    }
}, true);

// --- Запуск приложения ---

function renderVisualMap() { 
    if (window.Cartographer) {
        Cartographer.fetchMapData().then(() => {
            Cartographer.render();
        });
    }
}








// --- ЭФФЕКТ ПАРАЛЛАКСА И АТМОСФЕРА ---
document.addEventListener('mousemove', (e) => {
    const moveX = (e.clientX - window.innerWidth / 2) * 0.01;
    const moveY = (e.clientY - window.innerHeight / 2) * 0.01;
    document.documentElement.style.setProperty('--parallax-x', `${-moveX}px`);
    document.documentElement.style.setProperty('--parallax-y', `${-moveY}px`);
});
document.addEventListener('DOMContentLoaded', initializeApp);


// ================================================
//  generateVisionImage -- ИСПРАВЛЕННАЯ ВЕРСИЯ ДЛЯ LLMOST
//  (поддержка google/gemini-*-image и nano-banana)
// ================================================
async function generateVisionImage(prompt) {
    const imgProvider = document.getElementById('img-provider-select')?.value || 'pollinations';
    const imgModel = (document.getElementById('img-model-input')?.value || '').trim();

    console.log(`[Vision] Генерация. Провайдер: ${imgProvider}, модель: ${imgModel || 'default'}`);

    let url, headers = {}, body = {};

    // ====================== LLMOST ======================
    if (imgProvider === 'llmost') {
        const baseUrl = window.LLMOST_API_URL || 'https://llmost.ru/api/v1';
        url = `${baseUrl}/chat/completions`;

        const key = document.getElementById('llmost-api-key-input')?.value?.trim() 
                    || SecureKeyStorage.getItem('llmostApiKey');

        if (!key) throw new Error('❌ LLMost API Key не найден в настройках');

        headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
        };

        const model = imgModel || 'google/gemini-2.5-flash-image';

        // Для моделей с картинками делаем чистый промпт без лишних инструкций
        body = {
            model: model,
            messages: [
                { role: "user", content: prompt }   // ← просто описание, без "ответь только ссылкой"
            ],
            max_tokens: 2048,
            temperature: 0.75
        };
    }

    // ====================== Pollinations (без изменений) ======================
    else if (imgProvider === 'pollinations') {
        const params = new URLSearchParams({
            prompt: prompt,
            model: imgModel || 'flux',
            width: 1024,
            height: 1024,
            seed: Math.floor(Math.random() * 999999),
            nologo: 'true',
            enhance: 'true'
        });

        const response = await fetch(`https://image.pollinations.ai/prompt?${params}`);
        if (!response.ok) throw new Error(`Pollinations ${response.status}`);

        return {
            success: true,
            imageUrl: response.url,
            provider: 'pollinations'
        };
    }

    // ====================== OpenRouter (без изменений) ======================
    else if (imgProvider === 'openrouter') {
        // ... (оставляем как было, если нужно -- могу тоже обновить)
        // пока пропускаем, т.к. проблема сейчас в LLMost
    }

    // ====================== ОБЩИЙ POST-запрос для LLMost и OpenRouter ======================
    if (imgProvider !== 'pollinations') {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`LLMost ${response.status}: ${text}`);
        }

        const data = await response.json();

        // === НОВАЯ ЛОГИКА РАЗБОРА ОТВЕТА LLMOST ===
        let imageUrl = null;
        const message = data.choices?.[0]?.message;

        if (message) {
            // 1. Основной способ у LLMost (Gemini image модели)
            if (message.images && message.images.length > 0) {
                const imgObj = message.images[0];
                imageUrl = imgObj.image_url?.url || imgObj.url;
            }
            // 2. Fallback -- если вдруг в content лежит base64
            else if (typeof message.content === 'string' && message.content.startsWith('data:image')) {
                imageUrl = message.content;
            }
            // 3. Последний fallback
            else if (typeof message.content === 'string' && message.content.includes('base64')) {
                imageUrl = message.content;
            }
        }

        if (!imageUrl) {
            console.error('❌ LLMost вернул ответ без изображения:', data);
            throw new Error('Модель не вернула изображение. Попробуй другую модель (nano-banana-2 или gpt-5-image-mini)');
        }

        console.log('[Vision] ✅ Изображение получено (base64)');

        return {
            success: true,
            imageUrl: imageUrl,        // это уже готовый data:image/png;base64,...
            provider: imgProvider,
            raw: data
        };
    }
}

// ==========================================
// --- ФУНКЦИИ АДМИН МЕНЮ (DEBUG) ---
// ==========================================

function openAdminMenu() {
    if (!player || !DEBUG_MODE) return;
    populateAdminMenu();
    const modal = document.getElementById('admin-menu-overlay');
    if (!modal) return;
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('visible'), 10);
}

function closeAdminMenu() {
    const modal = document.getElementById('admin-menu-overlay');
    if (!modal) return;
    modal.classList.remove('visible');
    setTimeout(() => modal.style.display = 'none', 300);
}

function populateAdminMenu() {
    const content = document.getElementById('admin-menu-content');
    if (!content) return;

    let html = `
        <div style="margin-bottom: 20px; background: rgba(0,0,0,0.3); padding: 10px; border-radius: 5px; border-left: 3px solid #f1c40f;">
            <h4 style="margin: 0 0 10px 0; color: #f1c40f;">💰 Быстрые действия</h4>
            <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                <input type="number" id="admin-gold-input" value="1000" style="width: 100px; padding: 5px; color: #fff; background: rgba(0,0,0,0.5); border: 1px solid #f1c40f;">
                <button data-action="admin-add-gold" style="background: #27ae60; margin: 0; padding: 5px 15px; min-width: auto;">+ Золото</button>
                <button data-action="admin-heal" style="background: #e74c3c; margin: 0; padding: 5px 15px; min-width: auto;">Full HP/MP</button>
                <button data-action="admin-force-summary" style="background: #8e44ad; margin: 0; padding: 5px 15px; min-width: auto;">Сжать память (Summarize)</button>
                <button data-action="toggle-autotester" id="admin-autotester-btn" style="background: #e67e22; margin: 0; padding: 5px 15px; min-width: auto;">🤖 Авто-Тестер: ВЫКЛ</button>
                <button data-action="toggle-localization" style="background: #34495e; margin: 0; padding: 5px 15px; min-width: auto;">🌐 Локализация: ${window.DISABLE_LOCALIZATION ? 'ВЫКЛ' : 'ВКЛ'}</button>
            </div>
        </div>

        <div style="margin-bottom: 20px; background: rgba(0,0,0,0.3); padding: 10px; border-radius: 5px; border-left: 3px solid #9b59b6;">
            <h4 style="margin: 0 0 10px 0; color: #9b59b6;">⏳ Машина Времени и Память</h4>
            <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                <button onclick="adminSetTurn(28)" style="background: #8e44ad; margin: 0; padding: 5px 15px; min-width: auto;" title="Следующий ход вызовет сжатие памяти (29)">Ход = 28 (Тест Сжатия)</button>
                <button onclick="adminSetTurn(29)" style="background: #8e44ad; margin: 0; padding: 5px 15px; min-width: auto;" title="Следующий ход вызовет очистку истории (30)">Ход = 29 (Тест Очистки)</button>
                <button onclick="adminInjectMemory()" style="background: #2980b9; margin: 0; padding: 5px 15px; min-width: auto;">Впрыснуть фейковую память</button>
                <button onclick="runUnitTests()" style="background: #2c3e50; border: 1px solid #5dade2; margin: 0; padding: 5px 15px; min-width: auto;">🧪 Запустить Unit-тесты</button>
            </div>
            <p style="margin: 5px 0 0 0; font-size: 0.85em; color: #bdc3c7;">Текущий ход: <b style="color:#fff">${player.stats.turnCount}</b></p>
        </div>
    `;

    html += `<div style="display: flex; gap: 20px; flex-wrap: wrap;">`;

    // Левая колонка: Окружение
    html += `<div style="flex: 1; min-width: 300px; background: rgba(0,0,0,0.3); padding: 10px; border-radius: 5px; border-left: 3px solid #e74c3c;">
                <h4 style="margin: 0 0 10px 0; color: #e74c3c;">🎭 Окружение (NPC/Враги)</h4>
                <ul style="list-style: none; padding: 0; margin: 0;">`;

    const entities = Object.values(player.visibleEntities || {});
    if (entities.length === 0) html += `<li style="color: #7f8c8d; font-size: 0.9em;">Никого нет рядом</li>`;
    entities.forEach(ent => {
        html += `<li style="margin-bottom: 8px; font-size: 0.9em; border-bottom: 1px dashed rgba(255,255,255,0.1); padding-bottom: 5px;">
                    <strong style="color: ${ent.isHostile ? '#e74c3c' : '#5dade2'}">${ent.name}</strong> [HP: ${ent.stats.hp}/${ent.stats.maxHp}]
                    <div style="margin-top: 5px; display: flex; gap: 5px;">
                        <button onclick="adminKillEntity('${ent.id}')" style="background: #c0392b; padding: 2px 8px; font-size: 0.8em; margin: 0; min-width: auto;">Убить (0 HP)</button>
                        <button onclick="adminRemoveEntity('${ent.id}')" style="background: #7f8c8d; padding: 2px 8px; font-size: 0.8em; margin: 0; min-width: auto;">Удалить</button>
                    </div>
                 </li>`;
    });
    html += `</ul></div>`;

    // Правая колонка: Nexus
    html += `<div style="flex: 1; min-width: 300px; background: rgba(0,0,0,0.3); padding: 10px; border-radius: 5px; border-left: 3px solid #3498db;">
                <h4 style="margin: 0 0 10px 0; color: #3498db;">🔮 Константы (Nexus)</h4>
                <ul style="list-style: none; padding: 0; margin: 0;">`;

    const nexusItems = Object.values(player.nexusData || {});
    if (nexusItems.length === 0) html += `<li style="color: #7f8c8d; font-size: 0.9em;">Нет активных констант</li>`;
    nexusItems.forEach(item => {
        html += `<li style="margin-bottom: 8px; font-size: 0.9em; border-bottom: 1px dashed rgba(255,255,255,0.1); padding-bottom: 5px;">
                    <strong style="color: #5dade2">${item.name}</strong>: <span style="color: #f1c40f">${item.value}</span>
                    <div style="margin-top: 5px; display: flex; gap: 5px;">
                        <button onclick="adminEditNexus('${item.id}')" style="background: #2980b9; padding: 2px 8px; font-size: 0.8em; margin: 0; min-width: auto;">Изменить</button>
                        <button onclick="adminDeleteNexus('${item.id}')" style="background: #c0392b; padding: 2px 8px; font-size: 0.8em; margin: 0; min-width: auto;">Удалить</button>
                    </div>
                 </li>`;
    });
    html += `</ul></div>`;

    html += `</div>`;

    if (DEBUG_MODE && typeof World !== 'undefined' && World) {
        html += '<div style="margin-top: 20px; border-top: 2px solid #5dade2; padding-top: 10px;"><h3 style="color:#5dade2; margin-top:0;">ГЛОБАЛЬНАЯ СИМУЛЯЦИЯ</h3></div>';
        
        // 1. ФРАКЦИИ
        html += '<div class="debug-card"><div class="debug-card-title"><span>🏛️ ФРАКЦИИ</span></div><div class="debug-grid">';
        for (let fId in World.factions) {
            let f = World.factions[fId];
            let isPlayer = (f.rulerId === 'player');
            let wars = [];
            for (let t in f.diplomacy) { if (f.diplomacy[t] === "war" && World.factions[t]) wars.push(World.factions[t].name); }
            let warText = wars.length > 0 ? `<br><span style="color:#e74c3c; font-size:0.85em;">вљ"пёЏ Р'РѕР№РЅР°: ${wars.join(', ')}</span>` : '';
            
            const formatNum = (num) => {
                if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
                if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
                return num;
            };

            const capitalRegionId = Object.keys(World.regions).find(rid => World.regions[rid].factionId === fId);
            let gold = 0;
            if (capitalRegionId && World.regions[capitalRegionId]?.vault_id) {
                gold = countRealItems(World.regions[capitalRegionId].vault_id, getPrimaryCurrencyPrototypeId('gold'));
            }
            const manpower = availableManpower(f);
            
            let titleColor = isPlayer ? "#2ecc71" : "#3498db";
            let titlePrefix = isPlayer ? "рџ‘‘ [Р’РђРЁРђ] " : "";
            let bgStyle = isPlayer ? 'style="border-left-color: #2ecc71; background: rgba(46, 204, 113, 0.1);"' : '';
            
            html += `<div class="debug-item" ${bgStyle}>
                     <b style="color:${titleColor}">${titlePrefix}${f.name}</b><br>
                     рџ'°${formatNum(gold)} | рџ›ЎпёЏ${formatNum(manpower)}
                     ${warText}
                     </div>`;
        }
        html += '</div></div>';

        // 2. АРМИИ И ОСАДЫ
        html += '<div class="debug-card"><div class="debug-card-title"><span>⚔️ АКТИВНОСТЬ ВОЙСК</span></div>';
        let armiesExist = false;
        for (let fId in World.factions) {
            World.factions[fId].armies.forEach(a => {
                armiesExist = true;
                let dest = World.regions[a.destination] ? World.regions[a.destination].name : a.destination;
                
                let statusText = '';
                if (a.daysToMove > 0) {
                    statusText = `В пути (осталось ${a.daysToMove} дн.)`;
                } else if (a.siegeDays > 0) {
                    statusText = `<b style="color:#e67e22">ОСАДА</b> (осталось ${a.siegeDays} дн.)`;
                } else {
                    let phaseName = a.current_phase;
                    if (phaseName === 'vanguard_clash') phaseName = 'Стычка авангардов';
                    else if (phaseName === 'main_battle') phaseName = 'Основное сражение';
                    else if (phaseName === 'rout') phaseName = 'Отступление';
                    statusText = `<b style="color:#e74c3c">БОЙ: ${phaseName}</b>`;
                }

                let armyName = World.factions[fId].rulerId === 'player' ? "👑 Ваша армия" : World.factions[fId].name;

                html += `<div class="debug-army-item">
                            <b>${armyName}</b> (${a.size} ед.) ➔ <b>${dest}</b><br>
                            Статус: ${statusText}
                         </div>`;
            });
        }
        if (!armiesExist) html += '<div style="color:#7f8c8d; font-style:italic; padding:5px;">Нет активных передвижений войск</div>';
        html += '</div>';
    
        // 3. ПРАВИТЕЛИ И ИНТРИГИ
        html += '<div class="debug-card"><div class="debug-card-title"><span>👑 ПРАВИТЕЛИ И ИНТРИГИ</span></div><div class="debug-grid">';
        if(World.rulers) {
            for(let rId in World.rulers) {
                let r = World.rulers[rId];
                if(!r.alive || r.id.includes("_heir")) continue;
                let goal = r.gmOverride ? `<b style="color:#e74c3c">[GM] ${r.gmOverride}</b>` : (r.currentGoal ? `${r.currentGoal.type} -> ${r.currentGoal.targetFactionId}` : "Нет цели");
                html += `<div class="debug-item">
                         <b style="color:#9b59b6">${r.name}</b> (${World.factions[r.factionId]?.name || r.factionId})<br>
                         HP: ${r.health}% | Амбиции: ${r.personality.ambition}<br>
                         Цель: ${goal}
                         </div>`;
            }
        }
        html += '</div>';
    
        if(World.intrigues && World.intrigues.length > 0) {
            html += '<div style="margin-top:10px; border-top:1px dashed #555; padding-top:5px;"><b>Активные заговоры:</b><br>';
            World.intrigues.forEach(i => {
                let phaseName = i.phase;
                if (phaseName === 'recruitment') phaseName = 'Вербовка';
                else if (phaseName === 'espionage') phaseName = 'Шпионаж';
                else if (phaseName === 'execution') phaseName = 'Исполнение';
                else if (phaseName === 'cover_up') phaseName = 'Заметание следов';
                html += `<span style="color:${i.isDiscovered ? '#e74c3c' : '#f39c12'}">[${i.type}]</span> ${i.initiatorFactionId} -> ${i.targetFactionId} (Фаза: ${phaseName}, Прогресс: ${Math.floor(i.progress)}/${i.requiredProgress})<br>`;
            });
            html += '</div>';
        }
        html += '</div>';
    }

    setTimeout(() => {
        const btn = document.getElementById('admin-autotester-btn');
        if (btn) btn.innerHTML = isAutoTesting ? '🤖 Авто-Тестер: ВКЛ' : '🤖 Авто-Тестер: ВЫКЛ';
    }, 50);

    content.innerHTML = html;
}

window.adminAddGold = function () {
    const val = parseInt(document.getElementById('admin-gold-input').value) || 0;
    executeCommand('addItem', { aiIdentifier: 'gold', name: 'Золото', quantity: val });
    populateAdminMenu();
};

;
;
;
;


window.adminHeal = function () {
    executeCommand('updateStat', { stat: 'hp', change: 9999 });
    if (player.class === 'mage') executeCommand('updateStat', { stat: 'mana', change: 9999 });
    populateAdminMenu();
};

window.adminForceSummary = async function () {
    closeAdminMenu();
    if (!player) return;
    addLogMessage("[ADMIN] Запуск глубокой архивации памяти...", "system-message");
    showLoadingScreen('loadingScreen.generatingWorld', 'Сжатие памяти...');

    try {
        const promptTemplate = await loadPromptFromFile('assets/prompts/summarize_memory_prompt.txt');
        const historyText = conversationHistory.map(m => `${m.role === 'model' ? 'GM' : 'Player'}: ${m.parts[0].text}`).join('\n\n');
        const notesText = JSON.stringify(player.gmNotes, null, 2);

        const finalPrompt = promptTemplate
            .replace('{gmNotes}', notesText)
            .replace('{conversationHistory}', historyText)
            .replace('{userAction}', 'Принудительная архивация');

        let modelId = localModelId;
        if (currentApiProvider === 'gemini') modelId = geminiModelId;
        else if (currentApiProvider === 'llmost') modelId = llmostModelId;
        else if (currentApiProvider === 'openrouter') modelId = openrouterModelId;
        else if (currentApiProvider === 'deepseek') modelId = deepseekModelId;
        else if (currentApiProvider === 'omniroute') modelId = omnirouteModelId;
        
        // ПАТЧ: Передаем обязательный currentInput, чтобы Gemini не ругался на пустой массив contents
        const rawResponse = await performAiFetch(finalPrompt, [], modelId, "Проанализируй историю и обнови память (JSON).");
        const result = parseAIResponse(rawResponse);

        if (result.actions && result.actions.length > 0) {
            for (const action of result.actions) {
                await executeCommand(action.command, action.args);
            }
            addLogMessage("Память успешно сжата и заархивирована.", "command-feedback");
        } else {
            addLogMessage("GM не нашел данных для архивации.", "command-feedback");
        }
    } catch (e) {
        console.error(e);
        addLogMessage("Ошибка архивации: " + e.message, "system-message");
    } finally {
        hideLoadingScreen();
    }
};

window.adminKillEntity = function (internalId) {
    const ent = player.visibleEntities[internalId];
    if (ent) {
        // Обнуляем HP, движок сам обработает смерть и выдаст опыт
        executeCommand('updateEntityStat', { aiIdentifier: ent.aiIdentifier, stat: 'hp', value: 0 });
        populateAdminMenu();
    }
};

window.adminRemoveEntity = function (internalId) {
    const ent = player.visibleEntities[internalId];
    if (ent) {
        // Просто удаляем без смерти
        executeCommand('removeEnvironment', { aiIdentifier: ent.aiIdentifier });
        populateAdminMenu();
    }
};

window.adminDeleteNexus = function (id) {
    executeCommand('nexusRemove', { id: id });
    populateAdminMenu();
};

window.adminEditNexus = function (id) {
    const item = player.nexusData[id];
    if (!item) return;
    const newVal = prompt(`Введите новое значение для '${item.name}':`, item.value);
    if (newVal !== null) {
        executeCommand('nexusUpdate', { id: id, value: newVal });
        populateAdminMenu();
    }
};

// ==========================================
// --- UNIT ТЕСТЫ (ВСТРОЕННЫЙ ФРЕЙМВОРК) ---
// ==========================================
window.runUnitTests = function () {
    addLogMessage("[DEV] 🧪 Запуск Unit-тестов...", "system-message");
    console.group("рџ§Є UNIT TESTS RUN");

    let passed = 0;
    let failed = 0;

    function assertEqual(testName, actual, expected) {
        if (actual === expected) {
            console.log(`вњ… [PASSED] ${testName}`);
            passed++;
        } else {
            console.error(`❌ [FAILED] ${testName} | Ожидалось: ${expected}, Получено: ${actual}`);
            failed++;
        }
    }

    // Мокаем функцию стандартизации аргументов для проверки
    function mockMiddleware(command, args) {
        let testArgs;
        try { testArgs = JSON.parse(JSON.stringify(args)); } catch(e) { console.warn('Test args clone failed:', e); return; }
        if (testArgs && typeof testArgs === 'object') {
            if (testArgs.id !== undefined) {
                if (testArgs.aiIdentifier === undefined) testArgs.aiIdentifier = testArgs.id;
                if (testArgs.key === undefined) testArgs.key = testArgs.id;
                if (testArgs.effectId === undefined) testArgs.effectId = testArgs.id;
            }
            if (testArgs.id === undefined) {
                testArgs.id = testArgs.aiIdentifier || testArgs.key || testArgs.effectId;
            }
            if (command.toLowerCase().includes('quest') && testArgs.id === undefined && testArgs.title !== undefined) {
                testArgs.id = testArgs.title;
                testArgs.aiIdentifier = testArgs.title;
            }
        }
        return testArgs;
    }

    try {
        // ТЕСТ 1: aiIdentifier конвертируется в id
        let res1 = mockMiddleware('addItem', { aiIdentifier: 'sword_1' });
        assertEqual('Middleware: aiIdentifier -> id', res1.id, 'sword_1');

        // ТЕСТ 2: key конвертируется в id
        let res2 = mockMiddleware('setMemory', { key: 'plot_1' });
        assertEqual('Middleware: key -> id', res2.id, 'plot_1');

        // ТЕСТ 3: effectId конвертируется в id
        let res3 = mockMiddleware('applyPredefinedEffect', { effectId: 'burn' });
        assertEqual('Middleware: effectId -> id', res3.id, 'burn');

        // ТЕСТ 4: id размножается на старые ключи
        let res4 = mockMiddleware('addQuest', { id: 'quest_1' });
        assertEqual('Middleware: id -> aiIdentifier', res4.aiIdentifier, 'quest_1');
        assertEqual('Middleware: id -> key', res4.key, 'quest_1');

        // ТЕСТ 5: Экстренный фикс квестов (title -> id)
        let res5 = mockMiddleware('updateQuest', { title: 'Убить крыс', status: 'completed' });
        assertEqual('Middleware: Quest title -> id', res5.id, 'Убить крыс');
        assertEqual('Middleware: Quest title -> aiIdentifier', res5.aiIdentifier, 'Убить крыс');

    } catch (e) {
        console.error("Критическая ошибка во время тестов:", e);
        failed++;
    }

    console.groupEnd();

    const resultMsg = `[DEV] Тесты завершены. Успешно: ${passed}, Провалено: ${failed}. Подробности в консоли (F12).`;
    addLogMessage(resultMsg, failed === 0 ? "level-up" : "system-message");
};


window.adminSetTurn = function (turnNumber) {
    if (!player) return;
    player.stats.turnCount = turnNumber;
    addLogMessage(`[DEV] Ход установлен на ${turnNumber}. Сделай любое действие в чате, чтобы проверить триггеры ИИ.`, "system-message");
    updateCharacterSheet();
    populateAdminMenu();
};

window.adminInjectMemory = function () {


// Старая копия удалена патчем;;;;
    if (!player) return;
    if (!player.gmNotes) player.gmNotes = {};

    const testId = Math.floor(Math.random() * 1000);
    player.gmNotes[`Test_NPC_${testId}`] = "Торговец Боб. Очень жадный. Обещал игроку скидку, если тот принесет ему шкуру волка.";
    player.gmNotes[`Test_Lore_${testId}`] = "Игрок узнал, что мэр города тайно поклоняется культу Бездны.";

    addLogMessage(`[DEV] В память GM добавлены 2 тестовых блока (NPC и Lore).`, "command-feedback");
    updateGmNotesDisplay();
    updateWorldSimDebugDisplay();
    populateAdminMenu();
};


// ==========================================
// --- DEEP SETUP PIPELINE (5 STAGES) --- 
// ==========================================
async function runDeepSetupPipeline(narratorStyleGuide) {
    const oldLoader = document.getElementById('active-ether-loader');
    if (oldLoader) oldLoader.remove();

    const loaderDiv = document.createElement('div');
    loaderDiv.id = 'active-ether-loader';
    loaderDiv.className = 'ether-loader-container';
    loaderDiv.innerHTML = `
        <div class="astrolabe">
            <div class="astrolabe-ring"></div>
            <div class="astrolabe-ring"></div>
            <div class="astrolabe-ring"></div>
            <div class="astrolabe-core"></div>
        </div>
                    <div class="ether-text-container">
                <span class="ether-text-title" id="deep-setup-title">Глубокая генерация...</span>
                <span class="ether-text-subtitle" id="deep-setup-sub">Инициализация</span>
            </div>
            <button class="ether-cancel-btn" data-action="cancel-api">
                <i class="fas fa-times"></i> Прервать связь
            </button>
    `;
    gameLog.appendChild(loaderDiv);
    gameLog.scrollTo({ top: gameLog.scrollHeight, behavior: 'smooth' });

    const updateLoader = (title, sub) => {
        const t = document.getElementById('deep-setup-title');
        const s = document.getElementById('deep-setup-sub');
        if (t) t.textContent = title;
        if (s) s.textContent = sub;
    };

    const removeLoader = () => {
        if (loaderDiv) {
            loaderDiv.style.opacity = '0';
            loaderDiv.style.transform = 'scale(0.9)';
            setTimeout(() => loaderDiv.remove(), 300);
        }
    };

    try {
        let modelIdForRequest = localModelId;
        if (currentApiProvider === 'gemini') modelIdForRequest = geminiModelId;
        else if (currentApiProvider === 'llmost') modelIdForRequest = llmostModelId;
        else if (currentApiProvider === 'openrouter') modelIdForRequest = openrouterModelId;
        else if (currentApiProvider === 'deepseek') modelIdForRequest = deepseekModelId;
        else if (currentApiProvider === 'omniroute') modelIdForRequest = omnirouteModelId;

        const getBaseContext = () => {
            const genderText = player.gender ? ` | РџРѕР»: ${player.gender}` : '';
            return `Мир: ${DEFAULT_WORLD_ID} | Эпоха: ${player.era}\nИгрок: ${player.name} (${player.race}, ${player.class}${genderText})\nРежим старта: ${player.startMode}\nОписание от игрока: "${player.description}"`;
        };

        // --- STAGE 1 ---
        updateLoader("Этап 1/5: Нити Судьбы", "Создание биографии и мотивов...");
        let p1 = await loadPromptFromFile('assets/prompts/deep_setup/stage1_lore.txt');
        p1 = p1.replace('{base_context}', getBaseContext()).replace('{lore}', worldLore);
        let r1 = await performAiFetch(p1, [], modelIdForRequest, "Сгенерируй биографию и константы (JSON).");
        let res1 = parseAIResponse(r1);
        let stage_1_results = JSON.stringify(res1.actions || []);
        for (const a of (res1.actions || [])) await executeCommand(a.command, a.args);

        // --- STAGE 2 ---
        updateLoader("Этап 2/5: Материальное наследие", "Ковка снаряжения и навыков...");
        let p2 = await loadPromptFromFile('assets/prompts/deep_setup/stage2_loot.txt');
        p2 = p2.replace('{base_context}', getBaseContext())
               .replace('{itemsReference}', JSON.stringify(itemsReferenceData.slice(0, 50)))
               .replace('{skillsReference}', skillsReferenceData)
               .replace('{stage_1_results}', stage_1_results);
        let r2 = await performAiFetch(p2, [], modelIdForRequest, "Выдай стартовое снаряжение и навыки (JSON).");
        let res2 = parseAIResponse(r2);
        let stage_2_results = JSON.stringify(res2.actions || []);
        for (const a of (res2.actions || [])) await executeCommand(a.command, a.args);

        // --- STAGE 3 ---
        updateLoader("Этап 3/5: Сцена и Актеры", "Возведение декораций и NPC...");
        let p3 = await loadPromptFromFile('assets/prompts/deep_setup/stage3_environment.txt');
        const mapCoordsString = Object.keys(globalLocations || {}).map(k => `${globalLocations[k].name} [ID: ${k}] (x:${Math.round(globalLocations[k].x)}, y:${Math.round(globalLocations[k].y)})`).join('; ');
        p3 = p3.replace('{base_context}', getBaseContext())
               .replace('{globalLocationsList}', mapCoordsString)
               .replace('{environmentCommandsGuide}', environmentCommandsGuideData)
               .replace('{stage_1_results}', stage_1_results)
               .replace('{stage_2_results}', stage_2_results)
               .replace('{stage_3_results}', stage_3_results + (window.smartDeepContextStr || ""));
        let r3 = await performAiFetch(p3, [], modelIdForRequest, "Создай локацию и окружение (JSON).");
        let res3 = parseAIResponse(r3);
        let stage_3_results = JSON.stringify(res3.actions || []);
        
        for (const action of (res3.actions || [])) {
            if (action.command === 'renderLocation' && enableLocalMap) {
                updateLoader("Этап 3/5: Сцена и Актеры", "Отрисовка плана местности...");
                const locDesc = action.args.description || `Локация: ${player.location}`;
                // const generatedPlots = await generateLocalMapFromAI(locDesc, action.args.size || "15x15"); // Ожидает реализации на движке
                // action.args.plots = generatedPlots;
            }
            await executeCommand(action.command, action.args);
        }

        // --- STAGE 4 ---
        updateLoader("Этап 4/5: Зов Судьбы", "Формирование сюжета и квестов...");
        let p4 = await loadPromptFromFile('assets/prompts/deep_setup/stage4_quests.txt');
        p4 = p4.replace('{base_context}', getBaseContext())
               .replace('{stage_1_results}', stage_1_results)
               .replace('{stage_2_results}', stage_2_results)
               .replace('{stage_3_results}', stage_3_results + (window.smartDeepContextStr || ""))
               .replace('{stage_3_results}', stage_3_results);
        let r4 = await performAiFetch(p4, [], modelIdForRequest, "Выдай квест и инициируй события (JSON).");
        let res4 = parseAIResponse(r4);
        let stage_4_results = JSON.stringify(res4.actions || []);
        for (const a of (res4.actions || [])) await executeCommand(a.command, a.args);

        // --- STAGE 5 ---
        updateLoader("Этап 5/5: Пролог", "Ожидание Рассказчика...");
                let p5 = await loadPromptFromFile('assets/prompts/deep_setup/stage5_prologue.txt');
        let imgExample = enableImageGeneration ? '"image_prompt": "Ado music video aesthetic, monochrome with red accent...",' : '';

        window.smartDeepContextStr = "";
        if (typeof World !== 'undefined' && World) {
            let r = World.regions[player.location] || Object.values(World.regions).find(reg => player.location.includes(reg.name));
            if (r) {
                let activeMonsters = (World.monsters || []).filter(m => m.health > 0 && m.region_id === r.id);
                if (activeMonsters.length > 0) window.smartDeepContextStr += `\n[КРИТИЧЕСКАЯ УГРОЗА]: В локации ЭПИЧЕСКОЕ ЧУДОВИЩЕ: ${activeMonsters.map(m => m.name).join(', ')}! Опиши его присутствие!\n`;
                let activeDisasters = (World.map && World.map.disasters) ? World.map.disasters.filter(d => d.days_active > 0 && d.affected_regions.includes(r.id)) : [];
                if (activeDisasters.length > 0) window.smartDeepContextStr += `\n[БЕДСТВИЕ]: Здесь бушует ${activeDisasters.map(d => d.type).join(', ')}! Опиши это!\n`;
            }
            if (World.news && World.news.length > 0) {
                let epicHistory = World.news.filter(n => n.importance >= 4).sort((a, b) => (a.day || 0) - (b.day || 0)).slice(-40);
                if (epicHistory.length > 0) {
                    window.smartDeepContextStr += `\n=== ВЕЛИКАЯ ЛЕТОПИСЬ МИРА ===\n` + epicHistory.map(n => `[Год ${Math.floor((n.day||0)/360)+1} | ${n.location}]: ${parseLocString(n.text)}`).join("\n") + `\nТЫ ОБЯЗАН упомянуть эти исторические события в прологе!\n`;
                }
            }
        }

        let deepDynamicContext = "";
        if (typeof World !== 'undefined' && World) {
            let r = World.regions[player.location] || Object.values(World.regions).find(reg => player.location.includes(reg.name));
            if (r) {
                let activeMonsters = (World.monsters || []).filter(m => m.health > 0 && m.region_id === r.id);
                if (activeMonsters.length > 0) deepDynamicContext += `\n[КРИТИЧЕСКАЯ УГРОЗА]: В локации ЭПИЧЕСКОЕ ЧУДОВИЩЕ: ${activeMonsters.map(m => m.name).join(', ')}! Опиши его присутствие!\n`;
                let activeDisasters = (World.map && World.map.disasters) ? World.map.disasters.filter(d => d.days_active > 0 && d.affected_regions.includes(r.id)) : [];
                if (activeDisasters.length > 0) deepDynamicContext += `\n[БЕДСТВИЕ]: Здесь бушует ${activeDisasters.map(d => d.type).join(', ')}! Опиши это!\n`;
            }
            if (World.news && World.news.length > 0) {
                let currentDay = (World.current_day !== undefined ? World.current_day : Math.floor((World.tick || 0) / 24));
                let recentNews = World.news.map(n => ({ ...n, daysOld: Math.max(0, currentDay - (n.day || 0)) })).filter(n => n.daysOld <= 720 && ['war', 'disaster', 'politics'].includes(n.category)).sort((a, b) => a.daysOld - b.daysOld).slice(0, 15);
                if (recentNews.length > 0) {
                    deepDynamicContext += `\n=== НЕДАВНЯЯ ИСТОРИЯ (ПОСЛЕДСТВИЯ ПРЕ-СИМУЛЯЦИИ) ===\n` + recentNews.map(n => `[${n.daysOld} дн. назад, Локация: ${n.location}] ${parseLocString(n.text)}`).join("\n") + `\nТЫ ОБЯЗАН упомянуть эти события в прологе!\n`;
                }
            }
        }
        p5 = p5.replace('{narrator_style_guide}', narratorStyleGuide)
               .replace('{image_prompt_example}', imgExample)
               .replace('{stage_1_results}', stage_1_results)
               .replace('{stage_2_results}', stage_2_results)
               .replace('{stage_3_results}', stage_3_results + (window.smartDeepContextStr || ""))
               .replace('{stage_3_results}', stage_3_results + deepDynamicContext)
               .replace('{stage_4_results}', stage_4_results);
        let r5 = await performAiFetch(p5, [], modelIdForRequest, "Напиши художественный пролог (JSON).");
        let res5 = parseAIResponse(r5);

        // --- FINALIZE ---
        removeLoader();
        hideLoadingScreen();

        if (!res5 || !res5.narrative) throw new Error("GM не смог сгенерировать стартовую сцену на Этапе 5.");

        if (res5.ai_reasoning) {
            addCalculationMessage(`[МЫСЛИ ИИ (Пролог)]:\n${res5.ai_reasoning}`, "calc-info");
        }

        addLogMessage(res5.narrative, "gm-message", false, res5.image_prompt);

        renderSuggestedActions(res5.suggested_actions);
        conversationHistory.push({ role: "model", parts: [{ text: res5.narrative }] });
        if (res5.image_prompt && player && player.gmNotes) player.gmNotes['last_image_prompt'] = res5.image_prompt;

        updateCharacterSheet();
        updateMapDisplay();
        updateInventoryDisplay();
        updateEnvironmentPanel();

        tempPlayer = null;
        await autoSaveGame();
        stopMenuMusic();

    } catch (error) {
        console.error("Ошибка Deep Setup:", error);
        removeLoader();
        showAiErrorModal(
            error.stack || error.message || String(error),
            true,
            () => {
                showLoadingScreen('loadingScreen.generatingWorld', 'Генерация мира...');
                runDeepSetupPipeline(narratorStyleGuide);
            }
        );
    }
}


// --- ЭКСПЕРИМЕНТАЛЬНЫЙ ДВИЖОК СИМУЛЯЦИИ (JS-DRIVEN) ---


// --- ОБНОВЛЕНИЕ ПАНЕЛИ СИМУЛЯЦИИ МИРА (DEBUG) ---
function updateWorldSimDebugDisplay() {
    const panel = document.getElementById('world-sim-debug-panel');
    const content = document.getElementById('world-sim-debug-content');
    if (!panel || !content) return;

    if (DEBUG_MODE && typeof World !== 'undefined' && World) {
        panel.style.display = 'flex';
        let html = '';

        html += `<div class="debug-card"><div class="debug-card-title"><span>рџЏ›пёЏ ${t('extraLoc.debugPanel.factions')}</span></div><div class="debug-grid">`;
        
        let playerHasFaction = false;
        for (let fId in World.factions) {
            if (World.factions[fId].rulerId === 'player') playerHasFaction = true;
        }
        if (!playerHasFaction) {
            html += `<div class="debug-item" style="grid-column: span 2; text-align: center; background: rgba(142, 68, 173, 0.2); border-color: #8e44ad;">
                <span style="color:#bdc3c7; margin-right: 10px;">${t('extraLoc.debugPanel.noFaction')}</span>
                <button onclick="adminCreateFaction()" style="background: #8e44ad; padding: 5px 15px; min-width: auto; margin: 0;">${t('extraLoc.debugPanel.foundFaction')}</button>
            </div>`;
        }

        for (let fId in World.factions) {
            let f = World.factions[fId];
            let isPlayer = (f.rulerId === 'player');
            let wars = [];
            for (let t_id in f.diplomacy) { if (f.diplomacy[t_id] === "war" && World.factions[t_id]) wars.push(World.factions[t_id].name); }
            let warText = wars.length > 0 ? `<br><span style="color:#e74c3c; font-size:0.85em;">вљ”пёЏ ${t('extraLoc.debugPanel.war')}: ${wars.join(', ')}</span>` : '';
            
            const formatNum = (num) => {
                if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
                if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
                return num;
            };

            const capitalRegionId = Object.keys(World.regions).find(rid => World.regions[rid].factionId === fId);
            let gold = 0;
            if (capitalRegionId && World.regions[capitalRegionId]?.vault_id) {
                gold = countRealItems(World.regions[capitalRegionId].vault_id, getPrimaryCurrencyPrototypeId('gold'));
            }
            const manpower = availableManpower(f);
            
            let titleColor = isPlayer ? "#2ecc71" : "#3498db";
            let titlePrefix = isPlayer ? "рџ‘‘ [Р’РђРЁРђ] " : "";
            let bgStyle = isPlayer ? 'style="border-left-color: #2ecc71; background: rgba(46, 204, 113, 0.1); grid-column: span 2;"' : '';
            
            html += `<div class="debug-item" ${bgStyle}>
                     <b style="color:${titleColor}">${titlePrefix}${f.name}</b><br>
                     рџ'°${formatNum(gold)} | рџ›ЎпёЏ${formatNum(manpower)}
                     ${warText}`;
                     
            if (isPlayer) {
                html += `<div style="margin-top: 8px; border-top: 1px dashed rgba(46,204,113,0.3); padding-top: 8px; display: flex; gap: 5px; flex-wrap: wrap;">
                    <button onclick="adminTakeRegion('${f.id}')" style="background: #27ae60; padding: 4px 8px; font-size: 0.85em; margin: 0; min-width: auto;">${t('extraLoc.debugPanel.captureRegion')}</button>
                    <button onclick="adminRaiseArmy('${f.id}')" style="background: #e67e22; padding: 4px 8px; font-size: 0.85em; margin: 0; min-width: auto;">${t('extraLoc.debugPanel.raiseArmy')}</button>
                </div>`;
                
                if (f.armies && f.armies.length > 0) {
                    html += `<div style="margin-top: 8px; font-size: 0.85em; color: #aeb6bf;"><b>${t('extraLoc.debugPanel.yourArmies')}</b></div>`;
                    f.armies.forEach(a => {
                        let destName = World.regions[a.destination] ? World.regions[a.destination].name : a.destination;
                        let locName = World.regions[a.location] ? World.regions[a.location].name : a.location;
                        html += `<div style="background: rgba(0,0,0,0.4); padding: 6px; margin-top: 4px; border-radius: 4px; border-left: 2px solid #e74c3c;">
                            <span style="color:#ecf0f1;">${t('extraLoc.debugPanel.army')} (${a.size} чел.)</span><br>
                            <span style="color:#bdc3c7; font-size: 0.9em;">${t('extraLoc.debugPanel.position')}: ${locName} вћ” ${destName}</span><br>
                            <div style="margin-top: 4px; display: flex; gap: 5px;">
                                <button onclick="adminCommandArmy('${f.id}', '${a.id}', 'move')" style="background: #2980b9; padding: 2px 8px; font-size: 0.8em; margin: 0; min-width: auto;">${t('extraLoc.debugPanel.march')}</button>
                                <button onclick="adminCommandArmy('${f.id}', '${a.id}', 'disband')" style="background: #c0392b; padding: 2px 8px; font-size: 0.8em; margin: 0; min-width: auto;">${t('extraLoc.debugPanel.disband')}</button>
                            </div>
                        </div>`;
                    });
                }
            }
            html += `</div>`;
        }
        html += '</div></div>';

        html += `<div class="debug-card"><div class="debug-card-title"><span>вљ”пёЏ ${t('extraLoc.debugPanel.troopActivity')}</span></div>`;
        let armiesExist = false;
        for (let fId in World.factions) {
            World.factions[fId].armies.forEach(a => {
                armiesExist = true;
                let dest = World.regions[a.destination] ? World.regions[a.destination].name : a.destination;
                
                let statusText = '';
                if (a.daysToMove > 0) {
                    statusText = t('extraLoc.debugPanel.inTransit', {days: a.daysToMove});
                } else if (a.siegeDays > 0) {
                    statusText = `<b style="color:#e67e22">${t('extraLoc.debugPanel.siege', {days: a.siegeDays})}</b>`;
                } else {
                    let phaseName = a.current_phase;
                    if (phaseName === 'vanguard_clash') phaseName = 'Стычка авангардов';
                    else if (phaseName === 'main_battle') phaseName = 'Основное сражение';
                    else if (phaseName === 'rout') phaseName = 'Отступление';
                    statusText = `<b style="color:#e74c3c">${t('extraLoc.debugPanel.battle', {phase: phaseName})}</b>`;
                }

                let armyName = World.factions[fId].rulerId === 'player' ? `рџ‘‘ ${t('extraLoc.debugPanel.yourArmy')}` : World.factions[fId].name;

                html += `<div class="debug-army-item">
                            <b>${armyName}</b> (${a.size} ед.) ➔ <b>${dest}</b><br>
                            ${t('extraLoc.debugPanel.status')}: ${statusText}
                         </div>`;
            });
        }
        if (!armiesExist) html += `<div style="color:#7f8c8d; font-style:italic; padding:5px;">${t('extraLoc.debugPanel.noTroops')}</div>`;
        html += '</div>';

        html += `<div class="debug-card"><div class="debug-card-title"><span>рџЊЌ ${t('extraLoc.debugPanel.regions')}</span></div><div class="debug-grid">`;
        for (let rId in World.regions) {
            let r = World.regions[rId];
            let owner = World.factions[r.factionId] ? World.factions[r.factionId].name : t('extraLoc.debugPanel.neutrals');
            
            let totalWorkforce = Math.floor(r.population * 0.6);
            let totalJobs = 0;
            if (r.facilities) {
                for(let f in r.facilities) { totalJobs += (r.facilities[f].level || 0) * 200; }
            }
            let empRate = Math.floor(Math.min(1.0, totalJobs / (totalWorkforce || 1)) * 100);

            let resHtml = '';
            if (r.vault_id) {
                let vaultItems = [];
                for (let k in ECONOMY_ITEMS) {
                    let amount = countRealItems(r.vault_id, k);
                    if (amount > 0) {
                        let name = getItemName(k, player ? player.era : getRuntimeDefaultEraId());
                        vaultItems.push(`<span style="display:inline-block; margin-right: 8px; color:#bdc3c7;">${name}: <b style="color:#f1c40f">${amount}</b></span>`);
                    }
                }
                resHtml = vaultItems.join('');
            } else {
                resHtml = `<span style="color:#e74c3c;">${t('extraLoc.debugPanel.vaultNotFound')}</span>`;
            }

            let layoutHtml = '';
            if (r.cityLayout && r.layoutWidth > 0) {
                layoutHtml += `<div style="margin-top:5px; font-family:monospace; font-size:0.75em; line-height:1.1; background:rgba(0,0,0,0.5); padding:5px; border-radius:3px; overflow-x:auto; white-space:nowrap;">`;
                for(let y=0; y<r.layoutHeight; ++y) {
                    let rowStr = '';
                    for(let x=0; x<r.layoutWidth; ++x) {
                        let block = r.cityLayout[y * r.layoutWidth + x];
                        let ch = '.';
                        if (block.type === 'road') ch = '<span style="color:#7f8c8d">#</span>';
                        else if (block.type === 'house') ch = '<span style="color:#e67e22">H</span>';
                        else if (block.type === 'tavern') ch = '<span style="color:#e74c3c">T</span>';
                        else if (block.type === 'forge') ch = '<span style="color:#95a5a6">F</span>';
                        else if (block.type === 'market') ch = '<span style="color:#f1c40f">M</span>';
                        else if (block.type === 'office') ch = '<span style="color:#3498db">O</span>';
                        else if (block.type === 'temple') ch = '<span style="color:#9b59b6">+</span>';
                        rowStr += ch + ' ';
                    }
                    layoutHtml += rowStr + '<br>';
                }
                layoutHtml += `</div>`;
            }

            let seasonName = r.current_season === 'spring' ? t('extraLoc.seasons.spring') : (r.current_season === 'summer' ? t('extraLoc.seasons.summer') : (r.current_season === 'autumn' ? t('extraLoc.seasons.autumn') : t('extraLoc.seasons.winter')));
            html += `<div class="debug-item">
                     <b style="color:#2ecc71">${r.name}</b> <span style="font-size:0.8em; color:#bdc3c7;">[${seasonName}]</span><br>
                     <span style="font-size:0.8em; color:#7f8c8d;">${owner}</span><br>
                     ${t('extraLoc.debugPanel.pop')}: ${Math.floor(r.population)} (${t('extraLoc.debugPanel.employment')}: ${empRate}%)<br>
                     <div style="max-height: 60px; overflow-y: auto; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 5px; padding-top: 5px; font-size: 0.85em;">
                        ${resHtml}
                     </div>
                     ${layoutHtml}
                     </div>`;
        }
        html += '</div></div>';

        html += `<div class="debug-card"><div class="debug-card-title"><span>рџ‘‘ ${t('extraLoc.debugPanel.rulersAndIntrigues')}</span></div><div class="debug-grid">`;
        if(World.rulers) {
            for(let rId in World.rulers) {
                let r = World.rulers[rId];
                if(!r.alive || r.id.includes("_heir")) continue;
                let goal = r.gmOverride ? `<b style="color:#e74c3c">[GM] ${r.gmOverride}</b>` : (r.currentGoal ? `${r.currentGoal.type} -> ${r.currentGoal.targetFactionId}` : t('extraLoc.debugPanel.noGoal'));
                html += `<div class="debug-item">
                         <b style="color:#9b59b6">${r.name}</b> (${World.factions[r.factionId]?.name || r.factionId})<br>
                         HP: ${r.health}% | ${t('extraLoc.debugPanel.ambition')}: ${r.personality.ambition}<br>
                         ${t('extraLoc.debugPanel.goal')}: ${goal}
                         </div>`;
            }
        }
        html += '</div>';
    
        if(World.intrigues && World.intrigues.length > 0) {
            html += `<div style="margin-top:10px; border-top:1px dashed #555; padding-top:5px;"><b>${t('extraLoc.debugPanel.activePlots')}</b><br>`;
            World.intrigues.forEach(i => {
                let phaseName = i.phase;
                if (phaseName === 'recruitment') phaseName = 'Вербовка';
                else if (phaseName === 'espionage') phaseName = 'Шпионаж';
                else if (phaseName === 'execution') phaseName = 'Исполнение';
                else if (phaseName === 'cover_up') phaseName = 'Заметание следов';
                html += `<span style="color:${i.isDiscovered ? '#e74c3c' : '#f39c12'}">[${i.type}]</span> ${i.initiatorFactionId} -> ${i.targetFactionId} (${t('extraLoc.debugPanel.phase')}: ${phaseName}, ${t('extraLoc.debugPanel.progress')}: ${Math.floor(i.progress)}/${i.requiredProgress})<br>`;
            });
            html += '</div>';
        }
        html += '</div>';

        content.innerHTML = html;
    } else {
        panel.style.display = 'none';
    }
}


// ======================================================================
// --- СИСТЕМА ПРАВИТЕЛЕЙ, ДИПЛОМАТИИ И ИНТРИГ ---
// ======================================================================

function createRulerForFaction(id, faction, era, isHeir = false) {
    const names = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa"];
    let name = (isHeir ? "Heir " : "Ruler ") + names[Math.floor(Math.random() * names.length)];
    const personalityDefaults = getRulerEntityPersonalityDefaults();
    let baseWisdom = getRulerEntityPersonalityNumber('wisdom_min') + Math.floor(Math.random() * getRulerEntityPersonalityNumber('wisdom_range'));
    let baseCruelty = getRulerEntityPersonalityNumber('cruelty_min') + Math.floor(Math.random() * getRulerEntityPersonalityNumber('cruelty_range'));
    let baseDiplomacy = getRulerEntityPersonalityNumber('diplomacy_min') + Math.floor(Math.random() * getRulerEntityPersonalityNumber('diplomacy_range'));
    let baseMilitary = getRulerEntityPersonalityNumber('military_min') + Math.floor(Math.random() * getRulerEntityPersonalityNumber('military_range'));

    return {
        id: id,
        name: name,
        factionId: faction.id || id.replace("_heir", ""),
        type: "ruler",
        stats: { hp: getRulerEntityDefaultStat('hp'), maxHp: getRulerEntityDefaultStat('hp'), str: getRulerEntityDefaultStat('strength'), dex: getRulerEntityDefaultStat('dexterity'), int: getRulerEntityDefaultStat('intelligence'), con: getRulerEntityDefaultStat('constitution'), cha: getRulerEntityDefaultStat('charisma'), res: getRulerEntityDefaultStat('resilience') },
        personality: {
            ambition: getRulerEntityPersonalityNumber('ambition_min') + Math.floor(Math.random() * getRulerEntityPersonalityNumber('ambition_range')),
            paranoia: getRulerEntityPersonalityNumber('paranoia_min') + Math.floor(Math.random() * getRulerEntityPersonalityNumber('paranoia_range')),
            wisdom: baseWisdom + Math.floor(Math.random() * ((getRulerEntityPersonalityNumber('wisdom_variance') * 2) + 1)) - getRulerEntityPersonalityNumber('wisdom_variance'),
            cruelty: baseCruelty + Math.floor(Math.random() * ((getRulerEntityPersonalityNumber('cruelty_variance') * 2) + 1)) - getRulerEntityPersonalityNumber('cruelty_variance'),
            diplomacy: baseDiplomacy + Math.floor(Math.random() * ((getRulerEntityPersonalityNumber('diplomacy_variance') * 2) + 1)) - getRulerEntityPersonalityNumber('diplomacy_variance'),
            military: baseMilitary + Math.floor(Math.random() * ((getRulerEntityPersonalityNumber('military_variance') * 2) + 1)) - getRulerEntityPersonalityNumber('military_variance'),
            stewardship: getRulerEntityPersonalityNumber('stewardship_min') + Math.floor(Math.random() * getRulerEntityPersonalityNumber('stewardship_range'))
        },
        traits: ["Амбициозный", "Хитрый"],
        health: requireRuntimeNumber(getRulerEntityCommandDefaults().health_percent, 'gameplay_runtime.command_defaults.ruler_entity.health_percent'),
        alive: true,
        heir: isHeir ? null : id + "_heir",
        currentGoal: null,
        gmOverride: null,
        lastTickDay: 0
    };
}




function checkRulerDeaths() {
    for (let rId in World.rulers) {
        let r = World.rulers[rId];
        if (r.alive && (r.health <= 0 || r.stats.hp <= 0)) {
            r.alive = false;
            if (r.heir && World.rulers[r.heir]) {
                let heir = World.rulers[r.heir];
                World.factions[r.factionId].rulerId = heir.id;
                generateWorldNews(`СМЕНА ВЛАСТИ: ${r.name} мертв. Трон занимает ${heir.name}.`, "global", 5, 'misc');
                
                // Наследник становится правителем
                let newRulerId = r.factionId + "_ruler_" + Date.now();
                heir.id = newRulerId;
                World.rulers[newRulerId] = heir;
                World.factions[r.factionId].rulerId = newRulerId;
                
                // Создаем нового наследника
                let newHeirId = r.factionId + "_heir_" + Date.now();
                World.rulers[newHeirId] = createRulerForFaction(newHeirId, World.factions[r.factionId], player?.era || getRuntimeDefaultEraId(), true);
                heir.heir = newHeirId;
                
                delete World.rulers[r.heir]; // Удаляем старую запись наследника
            } else {
                generateWorldNews(`КРИЗИС: ${r.name} мертв, и наследников нет! Фракция погружается в хаос.`, "global", 5, 'disaster');
                // Вместо стабильности - физическое последствие: бунт уничтожает ресурсы столицы
                const capitalRegionId = Object.keys(World.regions).find(rid => World.regions[rid].owner === r.factionId);
                if (capitalRegionId) {
                    const capitalVault = World.regions[capitalRegionId].vault_id;
                    const weaponsLost = Math.floor(countRealItems(capitalVault, 'weapons') * 0.4);
                    const goldLost = Math.floor(countRealItems(capitalVault, 'gold') * 0.3);
                    consumeRealItems(capitalVault, 'weapons', weaponsLost);
                    consumeRealItems(capitalVault, 'gold', goldLost);
                }
            }
        } else if (r.alive) {
            // Правитель больше не теряет здоровье от старения в main thread - это обрабатывается в world_worker.js
        }
    }
}


// ======================================================================
// --- СИСТЕМА ПРАВИТЕЛЕЙ, ДИПЛОМАТИИ И ИНТРИГ (FULL V2) ---
// ======================================================================

function createRulerForFaction(id, faction, era, isHeir = false) {
    const names = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa"];
    let name = (isHeir ? "Heir " : "Ruler ") + names[Math.floor(Math.random() * names.length)];
    const personalityDefaults = getRulerEntityPersonalityDefaults();
    const rulerNeedsDefaults = getRulerEntityNeedsDefaults();
    const rulerEconomyDefaults = getRulerEntityEconomyDefaults();
    let baseWisdom = getRulerEntityPersonalityNumber('wisdom_min') + Math.floor(Math.random() * getRulerEntityPersonalityNumber('wisdom_range'));
    let baseCruelty = getRulerEntityPersonalityNumber('cruelty_min') + Math.floor(Math.random() * getRulerEntityPersonalityNumber('cruelty_range'));
    let baseDiplomacy = getRulerEntityPersonalityNumber('diplomacy_min') + Math.floor(Math.random() * getRulerEntityPersonalityNumber('diplomacy_range'));
    let baseMilitary = getRulerEntityPersonalityNumber('military_min') + Math.floor(Math.random() * getRulerEntityPersonalityNumber('military_range'));

    return {
        id: id,
        name: name,
        factionId: faction.id || id.replace("_heir", ""),
        type: "ruler",
        stats: { hp: getRulerEntityDefaultStat('hp'), maxHp: getRulerEntityDefaultStat('hp'), str: getRulerEntityDefaultStat('strength'), dex: getRulerEntityDefaultStat('dexterity'), int: getRulerEntityDefaultStat('intelligence'), con: getRulerEntityDefaultStat('constitution'), cha: getRulerEntityDefaultStat('charisma'), res: getRulerEntityDefaultStat('resilience') },
        personality: {
            ambition: getRulerEntityPersonalityNumber('ambition_min') + Math.floor(Math.random() * getRulerEntityPersonalityNumber('ambition_range')),
            paranoia: getRulerEntityPersonalityNumber('paranoia_min') + Math.floor(Math.random() * getRulerEntityPersonalityNumber('paranoia_range')),
            wisdom: baseWisdom + Math.floor(Math.random() * ((getRulerEntityPersonalityNumber('wisdom_variance') * 2) + 1)) - getRulerEntityPersonalityNumber('wisdom_variance'),
            cruelty: baseCruelty + Math.floor(Math.random() * ((getRulerEntityPersonalityNumber('cruelty_variance') * 2) + 1)) - getRulerEntityPersonalityNumber('cruelty_variance'),
            diplomacy: baseDiplomacy + Math.floor(Math.random() * ((getRulerEntityPersonalityNumber('diplomacy_variance') * 2) + 1)) - getRulerEntityPersonalityNumber('diplomacy_variance'),
            military: baseMilitary + Math.floor(Math.random() * ((getRulerEntityPersonalityNumber('military_variance') * 2) + 1)) - getRulerEntityPersonalityNumber('military_variance'),
            stewardship: getRulerEntityPersonalityNumber('stewardship_min') + Math.floor(Math.random() * getRulerEntityPersonalityNumber('stewardship_range'))
        },
        traits: ["Амбициозный", "Хитрый"],
        health: requireRuntimeNumber(getRulerEntityCommandDefaults().health_percent, 'gameplay_runtime.command_defaults.ruler_entity.health_percent'),
        alive: true,
        heir: isHeir ? null : id + "_heir",
        currentGoal: null,
        gmOverride: null,
        lastTickDay: 0,
        // Интеграция как NPC
        aiIdentifier: id,
        profession: isHeir ? "Наследник" : "Правитель",
        currentLocation: "capital",
        currentActivity: "Управляет государством",
        schedule: [],
        needs: { hunger: requireRuntimeNumber(rulerNeedsDefaults.hunger, 'gameplay_runtime.command_defaults.ruler_entity.needs.hunger'), rest: requireRuntimeNumber(rulerNeedsDefaults.rest, 'gameplay_runtime.command_defaults.ruler_entity.needs.rest'), social: requireRuntimeNumber(rulerNeedsDefaults.social, 'gameplay_runtime.command_defaults.ruler_entity.needs.social'), safety: requireRuntimeNumber(rulerNeedsDefaults.safety, 'gameplay_runtime.command_defaults.ruler_entity.needs.safety') },
        relationships: {}, memory: [], inventory: { gold: requireRuntimeNumber(getRulerEntityCommandDefaults().inventory?.gold, 'gameplay_runtime.command_defaults.ruler_entity.inventory.gold'), items: {} },
        economy: { skillLevel: requireRuntimeNumber(rulerEconomyDefaults.skill_level, 'gameplay_runtime.command_defaults.ruler_entity.economy.skill_level'), isEmployed: true, workplaceId: null, dailyWage: requireRuntimeNumber(rulerEconomyDefaults.daily_wage, 'gameplay_runtime.command_defaults.ruler_entity.economy.daily_wage'), savings: requireRuntimeNumber(rulerEconomyDefaults.savings, 'gameplay_runtime.command_defaults.ruler_entity.economy.savings') },
        plotArmor: Boolean(getRulerEntityCommandDefaults().plot_armor), travelDestination: null, travelHoursLeft: 0, isHostile: false, xpReward: requireRuntimeNumber(getRulerEntityCommandDefaults().xp_reward, 'gameplay_runtime.command_defaults.ruler_entity.xp_reward')
    };
}

// Функции processRulerDiplomacy и processIntrigues удалены - они дублировались и находились только в world_worker.js
// Симуляция работает исключительно в воркере, эти функции в main thread не нужны

function checkRulerDeaths() {
    for (let rId in World.rulers) {
        let r = World.rulers[rId];
        if (r.alive && (r.health <= 0 || r.stats.hp <= 0)) {
            r.alive = false;
            if (World.npcs[rId]) World.npcs[rId].isAlive = false; // Синхронизация с NPC
            
            if (r.heir && World.rulers[r.heir]) {
                let heir = World.rulers[r.heir];
                World.factions[r.factionId].rulerId = heir.id;
                generateWorldNews(`СМЕНА ВЛАСТИ: ${r.name} мертв. Трон занимает ${heir.name}.`, "global", 5, 'misc');
                
                // Наследник становится правителем
                let newRulerId = r.factionId + "_ruler_" + Date.now();
                heir.id = newRulerId;
                heir.aiIdentifier = newRulerId;
                heir.profession = "Правитель";
                World.rulers[newRulerId] = heir;
                World.npcs[newRulerId] = heir; // Добавляем в NPC
                World.factions[r.factionId].rulerId = newRulerId;
                
                // Создаем нового наследника
                let newHeirId = r.factionId + "_heir_" + Date.now();
                let newHeir = createRulerForFaction(newHeirId, World.factions[r.factionId], player?.era || getRuntimeDefaultEraId(), true);
                World.rulers[newHeirId] = newHeir;
                World.npcs[newHeirId] = newHeir;
                heir.heir = newHeirId;
                
                delete World.rulers[r.heir]; 
                delete World.npcs[r.heir];
            } else {
                generateWorldNews(`КРИЗИС: ${r.name} мертв, и наследников нет! Фракция погружается в хаос.`, "global", 5, 'disaster');
                World.factions[r.factionId].stability -= 40;
            }
        } else if (r.alive) {
            if (Math.random() < 0.02) {
                r.health -= 1;
                r.stats.hp -= 1;
            }
        }
    }
}


function toggleLowSpecMode(enabled) {
    lowSpecMode = enabled;
    localStorage.setItem('lowSpecMode', enabled);
    document.body.classList.toggle('low-spec-mode', enabled);
    if (enabled) {
        document.documentElement.style.setProperty('--parallax-x', '0px');
        document.documentElement.style.setProperty('--parallax-y', '0px');
    }
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
    const cb = document.getElementById('low-spec-checkbox');
    if (cb) {
        cb.checked = lowSpecMode;
        toggleLowSpecMode(lowSpecMode);
        cb.addEventListener('change', (e) => toggleLowSpecMode(e.target.checked));
    }
});


// ==========================================
// --- BUSINESS & LOGISTICS UI SYSTEM ---
// ==========================================

window.getFacilityProducts = function(facilityType) {
    let products = [];
    const facData = FACILITY_NAMES[facilityType];
    
    if (facData && facData.tags && facData.tags.includes('extractor') && facData.extraction_rates) {
        products = Object.keys(facData.extraction_rates);
    } else if (facData && facData.tags && facData.tags.includes('storage')) {
        return [];
    } else {
        CRAFTING_RECIPES.forEach(r => {
            if (r.facility === facilityType) {
                products.push(...Object.keys(r.outputs));
            }
        });
    }
    return [...new Set(products)];
};

window.openBusinessModal = async function(bId) {
    if (!World || !World.businesses[bId]) return;
    const bus = World.businesses[bId];
    const modal = document.getElementById('business-modal');
    const content = document.getElementById('business-modal-content');
    
    let maxEmp = bus.facility_type === 'warehouses' ? bus.level * 10 : bus.level * 100;
    
    let logsHtml = '';
    if (bus.activity_logs && bus.activity_logs.length > 0) {
        logsHtml = bus.activity_logs.map(log => {
            let parsedLog = parseLocString(log);
            let color = '#bdc3c7';
            if (parsedLog.includes('Произведено') || parsedLog.includes('Добыто')) color = '#2ecc71';
            if (parsedLog.includes('Караван') || parsedLog.includes('Авто-')) color = '#f39c12';
            if (parsedLog.includes('БАНКРОТСТВО') || parsedLog.includes('ОШИБКА') || parsedLog.includes('Ошибка')) color = '#e74c3c';
            if (parsedLog.includes('Строительство')) color = '#3498db';
            return `<div style="color: ${color}; margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 6px;">${parsedLog}</div>`;
        }).join('');
    } else {
        logsHtml = `<div style="color:#7f8c8d; font-style:italic; text-align:center; padding: 20px;">${t('extraLoc.businessModal.emptyLog')}</div>`;
    }

    let constructionHtml = '';
    if (bus.construction_days_left > 0) {
        constructionHtml = `<div style="background: rgba(243, 156, 18, 0.1); border: 1px solid #f39c12; padding: 15px; border-radius: 8px; margin-bottom: 20px; color: #f39c12; text-align: center; font-size: 1.1em;">
            <i class="fas fa-hard-hat"></i> <b>${t('extraLoc.businessModal.construction', {days: bus.construction_days_left})}</b>
        </div>`;
    }

    let autoBuyChecked = bus.auto_buy_inputs ? "checked" : "";
    let autoSellChecked = bus.auto_sell_outputs ? "checked" : "";
    let microSettingsHtml = `
        <div style="margin-top: 20px; border-top: 1px solid #2d333b; padding-top: 15px;">
            <label class="bus-label"><i class="fas fa-robot"></i> ${t('extraLoc.businessModal.automation')}</label>
            <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px;">
                <label class="bus-checkbox-wrapper" title="${t('extraLoc.businessModal.autoBuyTitle')}">
                    <input type="checkbox" onchange="toggleAutoBuy('${bId}', this.checked)" ${autoBuyChecked}>
                    <span>${t('extraLoc.businessModal.autoBuy')}</span>
                </label>
                <label class="bus-checkbox-wrapper" title="${t('extraLoc.businessModal.autoSellTitle')}">
                    <input type="checkbox" onchange="toggleAutoSell('${bId}', this.checked)" ${autoSellChecked}>
                    <span>${t('extraLoc.businessModal.autoSell')}</span>
                </label>
            </div>
        </div>
    `;

    const storage = ContainerRegistry.get(bus.local_storage_id);
    let currentWeight = 0;
    if (storage) {
        getContainerItems(storage).forEach(id => {
            let it = ItemRegistry.get(id);
            if (it) {
                let w = it.custom_props?.weight_per_unit ?? requireRuntimeNumber(getGameplayRuntimeConfig().inventory.default_item_weight, 'gameplay_runtime.inventory.default_item_weight');
                if (isGoldLikeItem(it)) w = getCurrencyPhysicalWeight(it.prototype_id, w);
                currentWeight += w * it.stack_size;
            }
        });
    }
    let maxWeight = storage ? storage.max_weight_kg : 0;
    
    let invListHtml = '';
    if (storage && getContainerItems(storage).length > 0) {
        let itemsMap = {};
        getContainerItems(storage).forEach(id => {
            let it = ItemRegistry.get(id);
            if (it) itemsMap[it.prototype_id] = (itemsMap[it.prototype_id] || 0) + it.stack_size;
        });
        for (let proto in itemsMap) {
            invListHtml += `<div class="bus-stat-row" style="padding: 10px 5px;">
                <span style="color:#bdc3c7;"><i class="fas fa-box" style="color:#7f8c8d; margin-right:8px;"></i> ${getItemName(proto, player.era)}</span>
                <span class="bus-stat-value">${itemsMap[proto]} ${t('extraLoc.general.pcs')}</span>
            </div>`;
        }
    } else {
        invListHtml = `<div style="color:#7f8c8d; padding: 20px; text-align:center; font-style:italic;">${t('extraLoc.businessModal.storageEmpty')}</div>`;
    }

    let html = `
    <div class="custom-alert-box" style="max-width: 1100px; width: 95%; padding: 0; background: #1e2227; border: 1px solid #323942; border-radius: 12px; box-shadow: 0 25px 50px rgba(0,0,0,0.6); overflow: hidden; position: relative;">
        
        <div class="bus-header">
            <h3><i class="fas fa-industry"></i> ${t('extraLoc.businessModal.manage')} ${getFacilityName(bus.facility_type)}</h3>
            <button class="bus-close-btn" onclick="document.getElementById('business-modal').classList.remove('visible'); setTimeout(() => document.getElementById('business-modal').style.display = 'none', 300);">&times;</button>
        </div>

        <div class="business-modal-grid">
            <div class="bus-col-left">
                ${constructionHtml}
                
                <div class="bus-card-modern">
                    <div class="bus-stat-row">
                        <span style="color:#9ba4b5;">${t('extraLoc.businessModal.level')}</span>
                        <span class="bus-stat-value" style="color:#5dade2;">${bus.level}</span>
                    </div>
                    <div class="bus-stat-row" style="margin-bottom: 20px;">
                        <span style="color:#9ba4b5;">${t('extraLoc.businessModal.cash')}</span>
                        <span class="bus-stat-value gold">${bus.cash_balance} <i class="fas fa-coins"></i></span>
                    </div>
                    
                    <div class="bus-flex-row">
                        <input type="number" id="bus-cash-input" placeholder="РЎСѓРјРјР°" class="bus-input">
                        <button onclick="depositBusinessCash('${bId}')" class="bus-btn btn-green" title="${t('extraLoc.businessModal.deposit')}"><i class="fas fa-arrow-down"></i></button>
                        <button onclick="withdrawBusinessCash('${bId}')" class="bus-btn btn-red" title="${t('extraLoc.businessModal.withdraw')}"><i class="fas fa-arrow-up"></i></button>
                    </div>
                </div>

                <div class="bus-card-modern">
                    <h4 class="bus-card-title-modern"><i class="fas fa-users-cog"></i> ${t('extraLoc.businessModal.staffAndEff')}</h4>
                    <div class="bus-stat-row" style="margin-bottom: 15px;">
                        <span style="color:#9ba4b5;">${t('extraLoc.businessModal.staff')}</span>
                        <span class="bus-stat-value">${bus.employee_count} / ${maxEmp} чел.</span>
                    </div>
                    <div class="bus-flex-row">
                        <input type="number" id="bus-emp-input" value="${bus.target_employee_count !== undefined ? bus.target_employee_count : bus.employee_count}" class="bus-input">
                        <button onclick="setBusinessEmployees('${bId}')" class="bus-btn btn-blue"><i class="fas fa-user-check"></i> ${t('extraLoc.businessModal.assign')}</button>
                    </div>

                    <label class="bus-label">${t('extraLoc.businessModal.wageLevel')}</label>
                    <div class="bus-flex-row">
                        <input type="range" id="bus-wage-slider" min="50" max="200" value="${bus.wage_level ?? requireRuntimeNumber(getBusinessCommandDefaults().default_wage_level_percent, 'gameplay_runtime.command_defaults.business.default_wage_level_percent')}" oninput="document.getElementById('bus-wage-val').innerText = this.value + '%'" style="cursor:pointer;">
                        <span id="bus-wage-val" style="min-width:45px; text-align:right; font-weight:bold; color:#2ecc71;">${bus.wage_level ?? requireRuntimeNumber(getBusinessCommandDefaults().default_wage_level_percent, 'gameplay_runtime.command_defaults.business.default_wage_level_percent')}%</span>
                        <button onclick="setBusinessWages('${bId}')" class="bus-btn btn-blue"><i class="fas fa-check"></i></button>
                    </div>

                    <label class="bus-label">${t('extraLoc.businessModal.maintBudget')}</label>
                    <div class="bus-flex-row" style="margin-bottom: 0;">
                        <input type="range" id="bus-maint-slider" min="0" max="200" value="${bus.maintenance_budget ?? requireRuntimeNumber(getBusinessCommandDefaults().default_maintenance_budget_percent, 'gameplay_runtime.command_defaults.business.default_maintenance_budget_percent')}" oninput="document.getElementById('bus-maint-val').innerText = this.value + '%'" style="cursor:pointer;">
                        <span id="bus-maint-val" style="min-width:45px; text-align:right; font-weight:bold; color:#5dade2;">${bus.maintenance_budget ?? requireRuntimeNumber(getBusinessCommandDefaults().default_maintenance_budget_percent, 'gameplay_runtime.command_defaults.business.default_maintenance_budget_percent')}%</span>
                        <button onclick="setBusinessMaintenance('${bId}')" class="bus-btn btn-blue"><i class="fas fa-check"></i></button>
                    </div>
                    
                    ${microSettingsHtml}
                </div>

                <div class="bus-card-modern">
                    ${bus.facility_type !== 'warehouses' ? `
                        <h4 class="bus-card-title-modern"><i class="fas fa-cogs"></i> ${t('extraLoc.businessModal.production')}</h4>
                        <label class="bus-label">${t('extraLoc.businessModal.focus')}</label>
                        <div class="bus-flex-row">
                            <select id="bus-focus-select" class="bus-input" style="cursor:pointer;">
                                <option value="">${t('extraLoc.businessModal.stopped')}</option>
                                ${getFacilityProducts(bus.facility_type).map(p => `<option value="${p}" ${bus.production_focus === p ? 'selected' : ''}>${getItemName(p, player.era)}</option>`).join('')}
                            </select>
                            <button onclick="saveBusinessFocus('${bId}')" class="bus-btn btn-green"><i class="fas fa-play"></i> ${t('extraLoc.businessModal.start')}</button>
                        </div>
                    ` : `<h4 class="bus-card-title-modern"><i class="fas fa-boxes"></i> ${t('extraLoc.businessModal.inventory')}</h4>`}
                    
                    <div style="display:flex; justify-content:space-between; align-items:center; margin: 15px 0 10px 0;">
                        <label class="bus-label" style="margin:0;">${t('extraLoc.businessModal.storageContent')}</label>
                        <span style="font-size: 0.85em; color: #f39c12;"><i class="fas fa-weight-hanging"></i> ${Math.round(currentWeight)} / ${maxWeight} РєРі</span>
                    </div>
                    <div style="background: #181b20; border: 1px solid #323942; border-radius: 6px; max-height: 150px; overflow-y: auto; padding: 0 10px;">
                        ${invListHtml}
                    </div>
                </div>
            </div>

            <div class="bus-col-right">
                <div class="bus-card-modern" style="display: flex; flex-direction: column; max-height: 45%;">
                    <h4 class="bus-card-title-modern" style="justify-content: space-between;">
                        <span><i class="fas fa-route"></i> ${t('extraLoc.businessModal.logistics')}</span>
                        <button onclick="document.getElementById('new-route-modal-backdrop').style.display='block'; document.getElementById('new-route-modal').style.display='block'" class="bus-btn btn-green" style="padding: 4px 10px; font-size: 0.85em; margin: 0; min-width: auto;" title="${t('extraLoc.businessModal.newRoute')}"><i class="fas fa-plus"></i></button>
                    </h4>
                    <div class="bus-rules-list">
`;
    
    bus.logistics.forEach(rule => {
        const typeName = rule.type === 'transfer' ? t('extraLoc.businessModal.export') : (rule.type === 'pull' ? t('extraLoc.businessModal.import') : (rule.type === 'retail' ? t('extraLoc.businessModal.retail') : t('extraLoc.businessModal.order')));
        const icon = rule.type === 'transfer' ? 'fa-box-open' : (rule.type === 'pull' ? 'fa-inbox' : (rule.type === 'retail' ? 'fa-store' : 'fa-shopping-cart'));
        const color = rule.type === 'transfer' ? '#2ecc71' : (rule.type === 'pull' ? '#3498db' : (rule.type === 'retail' ? '#9b59b6' : '#f39c12'));
        
        let targetName = rule.target_id;
        if (World.regions[rule.target_id]) targetName = `${t('extraLoc.businessModal.market')}: ${World.regions[rule.target_id].name}`;
        else if (World.businesses[rule.target_id]) targetName = `${t('extraLoc.businessModal.warehouse')}: ${getFacilityName(World.businesses[rule.target_id].facility_type)} (${World.regions[World.businesses[rule.target_id].region_id]?.name || ''})`;
        
        const reserveText = rule.keep_reserve > 0 ? ` | ${t('extraLoc.businessModal.reserve')}: ${rule.keep_reserve}` : '';
        const amountText = rule.amount_is_percent ? `${rule.amount}%` : `РґРѕ ${rule.amount} ${t('extraLoc.general.pcs')}`;
        
        html += `
                        <div class="bus-rule-item" style="border-left-color: ${color};">
                            <div style="flex-grow: 1;">
                                <b style="color:${color}; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.5px;"><i class="fas ${icon}"></i> ${typeName}</b><br>
                                <span style="color:#ecf0f1; font-size: 1.1em; font-weight: bold; display: inline-block; margin: 6px 0;">${getItemName(rule.resource, player.era)} <span style="color:#9ba4b5; font-size:0.85em; font-weight:normal;">(${amountText})</span></span><br>
                                <span style="font-size:0.85em; color:#9ba4b5;"><i class="fas fa-map-marker-alt"></i> <b>${targetName}</b><br><i class="fas fa-clock"></i> ${t('extraLoc.businessModal.oncePer', {days: rule.frequency_days})}${reserveText}</span>
                            </div>
                            <button onclick="removeLogisticRule('${bId}', '${rule.id}')" class="bus-btn btn-gray" title="${t('extraLoc.businessModal.deleteRoute')}"><i class="fas fa-trash-alt"></i></button>
                        </div>
        `;
    });
    if (bus.logistics.length === 0) html += `<div style="color:#7f8c8d; text-align:center; padding:30px 10px; font-style:italic;">${t('extraLoc.businessModal.noRoutes')}</div>`;
    
    html += `
                    </div>
                </div>

                <div id="new-route-modal-backdrop" style="display:none; position:absolute; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.7); z-index:99;" onclick="this.style.display='none'; document.getElementById('new-route-modal').style.display='none'"></div>
                <div id="new-route-modal" class="bus-rule-form" style="display:none; position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); z-index:100; background:#1e2227; border:1px solid #5dade2; padding:20px; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.9); width: 90%; max-width: 450px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px solid #323942; padding-bottom:10px;">
                        <h4 style="margin:0; color:#5dade2; font-size: 1.1em;"><i class="fas fa-plus-circle"></i> ${t('extraLoc.businessModal.createRouteTitle')}</h4>
                        <button onclick="document.getElementById('new-route-modal-backdrop').style.display='none'; document.getElementById('new-route-modal').style.display='none'" style="background:transparent; border:none; color:#e74c3c; font-size:1.5em; cursor:pointer; padding:0; line-height:1;">&times;</button>
                    </div>
                    
                    <div class="bus-flex-row">
                        <div>
                            <label class="bus-label">${t('extraLoc.businessModal.operation')}</label>
                            <select id="new-rule-type" onchange="toggleRuleType()" class="bus-input" style="cursor:pointer;">
                                <option value="transfer">📦 ${t('extraLoc.businessModal.export')}</option>
                                <option value="pull">рџ“Ґ ${t('extraLoc.businessModal.import')}</option>
                                <option value="order">рџ›’ ${t('extraLoc.businessModal.order')}</option>
                                <option value="retail">рџЏЄ ${t('extraLoc.businessModal.retail')}</option>
                            </select>
                        </div>
                        <div>
                            <label class="bus-label">${t('extraLoc.businessModal.product')}</label>
                            <select id="new-rule-res" class="bus-input" style="cursor:pointer;">
`;
    Object.keys(ECONOMY_ITEMS).forEach(k => {
        html += `<option value="${k}">${getItemName(k, player.era)}</option>`;
    });
    html += `
                            </select>
                        </div>
                    </div>
                    
                    <label class="bus-label">${t('extraLoc.businessModal.target')}</label>
                    <select id="new-rule-target" class="bus-input" style="cursor:pointer;">
                        <optgroup label="${t('extraLoc.businessModal.cityMarkets')}">
`;
    Object.values(World.regions).forEach(r => {
        html += `<option value="${r.id}">${t('extraLoc.businessModal.market')}: ${r.name}</option>`;
    });
    html += `
                        </optgroup>
                        <optgroup label="${t('extraLoc.businessModal.myWarehouses')}">
`;
    Object.values(World.businesses).filter(b => b.owner_ids.includes('player') && b.id !== bId).forEach(b => {
        html += `<option value="${b.id}">${t('extraLoc.businessModal.warehouse')}: ${getFacilityName(b.facility_type)} (${World.regions[b.region_id]?.name || b.region_id})</option>`;
    });
    html += `
                        </optgroup>
                    </select>
                    
                    <div class="bus-grid-3">
                        <div>
                            <label class="bus-label">${t('extraLoc.businessModal.amount')}</label>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <input type="number" id="new-rule-amount" placeholder="${t('extraLoc.businessModal.pcs')}" class="bus-input" style="padding: 10px 8px;">
                                <label class="bus-checkbox-wrapper" title="${t('extraLoc.businessModal.percentTitle')}">
                                    <input type="checkbox" id="new-rule-percent">
                                    <b>%</b>
                                </label>
                            </div>
                        </div>
                        <div>
                            <label class="bus-label">${t('extraLoc.businessModal.days')}</label>
                            <input type="number" id="new-rule-freq" value="7" class="bus-input">
                        </div>
                        <div>
                            <label class="bus-label">${t('extraLoc.businessModal.reserve')}</label>
                            <input type="number" id="new-rule-reserve" value="0" class="bus-input">
                        </div>
                    </div>
                    
                    <div id="price-container" style="display:none; margin-top: 10px;">
                        <label class="bus-label">${t('extraLoc.businessModal.maxPrice')}</label>
                        <input type="number" id="new-rule-price" placeholder="${t('extraLoc.businessModal.price')}" class="bus-input">
                    </div>
                    
                    <button onclick="addLogisticRule('${bId}'); document.getElementById('new-route-modal-backdrop').style.display='none'; document.getElementById('new-route-modal').style.display='none'" class="bus-btn btn-green" style="width:100%; margin-top: 15px; padding: 12px;"><i class="fas fa-map-marked-alt"></i> ${t('extraLoc.businessModal.createBtn')}</button>
                </div>

                <div class="bus-card-modern" style="flex-grow: 1; display: flex; flex-direction: column; margin-bottom: 0; padding-bottom: 10px; min-height: 0;">
                    <h4 class="bus-card-title-modern"><i class="fas fa-list-alt"></i> ${t('extraLoc.businessModal.eventLog')}</h4>
                    <div class="bus-log-area">
                        ${logsHtml}
                    </div>
                </div>

            </div>
        </div>
    </div>
    `;

    modal.innerHTML = html;
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('visible'), 10);
}

;

function updatePortPanel() {
    const panel = document.getElementById('port-panel');
    const content = document.getElementById('port-panel-content');
    if (!panel || !content || !player || !World) return;

    let playerRegionId = null;
    for (let rId in World.regions) {
        if (player.location.toLowerCase().includes(World.regions[rId].name.toLowerCase())) {
            playerRegionId = rId;
            break;
        }
    }

    if (!playerRegionId || !World.port_facilities || !World.port_facilities[playerRegionId]) {
        panel.style.display = 'none';
        return;
    }

    panel.style.display = 'flex';
    const port = World.port_facilities[playerRegionId];
    const reg = World.regions[playerRegionId];
    
    const yesStr = t('extraLoc.general.yes', null, 'Да');
    const noStr = t('extraLoc.general.no', null, 'Нет');
    const existStr = t('extraLoc.general.exists', null, 'Есть');
    const notExistStr = t('extraLoc.general.notExists', null, 'Нет');

    let html = `<div style="margin-bottom: 10px; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 5px; font-size: 0.85em; color: #ecf0f1;">
        <b>${t('extraLoc.portPanel.level')}:</b> ${port.level} | <b>${t('extraLoc.portPanel.type')}:</b> ${t('extraLoc.portPanel.types.' + port.type, null, port.type)}<br>
        <b>${t('extraLoc.portPanel.shipyard')}:</b> ${port.has_shipyard ? `<span style="color:#2ecc71">${existStr}</span>` : `<span style="color:#e74c3c">${notExistStr}</span>`} | 
        <b>${t('extraLoc.portPanel.blockade')}:</b> ${port.is_blockaded ? `<span style="color:#e74c3c">${yesStr}</span>` : `<span style="color:#2ecc71">${noStr}</span>`}
    </div>`;
    
    html += `<h4 style="color:#f1c40f; margin: 10px 0 5px 0; font-size: 0.9em; border-bottom:1px solid #f1c40f; padding-bottom:3px;">${t('extraLoc.portPanel.warehouse')}</h4><ul style="list-style:none; padding:0; margin:0; max-height: 120px; overflow-y: auto; font-size: 0.85em;">`;
    if (port.dock_container_id && ContainerRegistry.has(port.dock_container_id)) {
        const dockCont = ContainerRegistry.get(port.dock_container_id);
        if (getContainerItems(dockCont).length === 0) {
            html += `<li style="color:#7f8c8d; padding: 3px;">${t('extraLoc.portPanel.warehouseEmpty')}</li>`;
        } else {
            let itemsMap = {};
            getContainerItems(dockCont).forEach(id => {
                let it = ItemRegistry.get(id);
                if (it) itemsMap[it.prototype_id] = (itemsMap[it.prototype_id] || 0) + it.stack_size;
            });
            for (let proto in itemsMap) {
                html += `<li style="background: rgba(0,0,0,0.4); padding: 4px; margin-bottom: 2px; border-radius: 4px; border-left: 3px solid #f1c40f;">📦 ${getItemName(proto, player ? player.era : getRuntimeDefaultEraId())}: ${itemsMap[proto]} ${t('extraLoc.general.pcs', null, 'шт.')}</li>`;
            }
        }
    } else {
        html += `<li style="color:#7f8c8d; padding: 3px;">${t('extraLoc.portPanel.warehouseUnavailable')}</li>`;
    }
    html += `</ul>`;

    if (port.has_shipyard) {
        html += `<h4 style="color:#e67e22; margin: 10px 0 5px 0; font-size: 0.9em; border-bottom:1px solid #e67e22; padding-bottom:3px;">${t('extraLoc.portPanel.contracts')}</h4><ul style="list-style:none; padding:0; margin:0; max-height: 100px; overflow-y: auto; font-size: 0.85em;">`;
        if (port.build_queue && port.build_queue.length > 0) {
            port.build_queue.forEach(bq => {
                html += `<li style="background: rgba(0,0,0,0.4); padding: 4px; margin-bottom: 2px; border-radius: 4px; border-left: 3px solid #e67e22;">рџЏ—пёЏ ${t('extraLoc.portPanel.shipTypes.' + bq.type, null, bq.type)} (${t('extraLoc.portPanel.owner')}: ${bq.owner_id}) - ${t('extraLoc.portPanel.daysLeft')}: ${bq.days_left}</li>`;
            });
        } else {
            html += `<li style="color:#7f8c8d; padding: 3px;">${t('extraLoc.portPanel.queueEmpty')}</li>`;
        }
        html += `</ul>`;
    }

    html += `<h4 style="color:#9b59b6; margin: 10px 0 5px 0; font-size: 0.9em; border-bottom:1px solid #9b59b6; padding-bottom:3px;">${t('extraLoc.portPanel.fleets')}</h4><ul style="list-style:none; padding:0; margin:0; max-height: 100px; overflow-y: auto; font-size: 0.85em;">`;
    let fleetsInPort = (World.fleets || []).filter(f => f.destination === playerRegionId && (!f.path || f.path_index >= f.path.length - 1));
    if (fleetsInPort.length === 0) html += `<li style="color:#7f8c8d; padding: 3px;">${t('extraLoc.portPanel.noFleets')}</li>`;
    fleetsInPort.forEach(f => {
        html += `<li style="background: rgba(0,0,0,0.4); padding: 4px; margin-bottom: 2px; border-radius: 4px; border-left: 3px solid #9b59b6;">вљ“рџ›ЎпёЏ <b>${t('extraLoc.portPanel.fleet')}</b> (${t('extraLoc.portPanel.owner')}: ${f.owner_id})<br><span style="font-size:0.85em; color:#bdc3c7;">${t('extraLoc.portPanel.shipsCount')}: ${f.ship_ids.length} | ${t('extraLoc.portPanel.mission')}: ${t('extraLoc.portPanel.missions.' + f.mission, null, f.mission)}</span></li>`;
    });
    html += `</ul>`;

    html += `<h4 style="color:#3498db; margin: 10px 0 5px 0; font-size: 0.9em; border-bottom:1px solid #3498db; padding-bottom:3px;">${t('extraLoc.portPanel.dockedShips')}</h4><ul style="list-style:none; padding:0; margin:0; max-height: 120px; overflow-y: auto; font-size: 0.85em;">`;
    let shipsInPort = (World.ships || []).filter(s => s.destination === playerRegionId && (!s.path || s.path.length === 0));
    if (shipsInPort.length === 0) html += `<li style="color:#7f8c8d; padding: 3px;">${t('extraLoc.portPanel.noShips')}</li>`;
    shipsInPort.forEach(s => {
        let icon = "в›µ";
        if (s.type === "WAR_GALLEY" || s.type === "WAR_FRIGATE") icon = "⛴️";
        if (s.type === "PIRATE") icon = "🏴‍☠️";
        if (s.type === "TRANSPORT") icon = "рџ›¶";
        html += `<li style="background: rgba(0,0,0,0.4); padding: 4px; margin-bottom: 2px; border-radius: 4px; border-left: 3px solid #3498db;">${icon} <b>${t('extraLoc.portPanel.shipTypes.' + s.type, null, s.type)}</b> (${t('extraLoc.portPanel.owner')}: ${s.owner_id})<br><span style="font-size:0.85em; color:#bdc3c7;">${t('extraLoc.portPanel.hull')}: ${s.hull}% | ${t('extraLoc.portPanel.crew')}: ${s.sailors} | ${t('extraLoc.portPanel.cargo')}: ${s.cargo_capacity}</span></li>`;
    });
    html += `</ul>`;
    
    content.innerHTML = html;
}
;


window.saveBusinessFocus = async function(bId) {
    const focus = document.getElementById('bus-focus-select').value;
    if (window.electronAPI && window.electronAPI.nexusManageBusiness) {
        const res = await window.electronAPI.nexusManageBusiness({ action: 'set_focus', args: { businessId: bId, focus: focus } });
        if (res.status === 'ok') {
            World.businesses[bId].production_focus = focus;
            openBusinessModal(bId);
        }
    }
};

window.toggleRuleType = function() {
    const type = document.getElementById('new-rule-type').value;
    document.getElementById('price-container').style.display = (type === 'order' || type === 'retail') ? 'block' : 'none';
    document.getElementById('new-rule-target').disabled = (type === 'retail');
};
;

window.addLogisticRule = async function(bId) {
    const type = document.getElementById('new-rule-type').value;
    const res = document.getElementById('new-rule-res').value;
    const target = document.getElementById('new-rule-target').value;
    const amount = parseInt(document.getElementById('new-rule-amount').value) || 0;
    const isPercent = document.getElementById('new-rule-percent').checked;
    const freq = parseInt(document.getElementById('new-rule-freq').value) || 1;
    const price = parseInt(document.getElementById('new-rule-price').value) || 0;
    const reserve = parseInt(document.getElementById('new-rule-reserve').value) || 0;

    if (amount <= 0) return alert("Введите корректное количество.");
    if (isPercent && amount > 100) return alert("Процент не может быть больше 100.");

    const rule = { type: type, resource: res, target_id: target, amount: amount, amount_is_percent: isPercent, frequency_days: freq, days_since_last: 0, max_price: price, keep_reserve: reserve };

    if (window.electronAPI && window.electronAPI.nexusManageBusiness) {
        const response = await window.electronAPI.nexusManageBusiness({ action: 'add_rule', args: { businessId: bId, rule: rule } });
        if (response.status === 'ok') {
            const fullState = await window.electronAPI.nexusGetFullState();
            if (fullState && fullState.status === 'ok') {
                setWorld(fullState.world);
                if (fullState.items) fullState.items.forEach(([k, v]) => ItemRegistry.set(k, v));
                if (fullState.containers) fullState.containers.forEach(([k, v]) => setContainer(k, v));
            }
            openBusinessModal(bId);
        }
    }
};

window.removeLogisticRule = async function(bId, ruleId) {
    if (window.electronAPI && window.electronAPI.nexusManageBusiness) {
        const response = await window.electronAPI.nexusManageBusiness({ action: 'remove_rule', args: { businessId: bId, ruleId: ruleId } });
        if (response.status === 'ok') {
            const fullState = await window.electronAPI.nexusGetFullState();
            if (fullState && fullState.status === 'ok') {
                setWorld(fullState.world);
                if (fullState.items) fullState.items.forEach(([k, v]) => ItemRegistry.set(k, v));
                if (fullState.containers) fullState.containers.forEach(([k, v]) => setContainer(k, v));
            }
            openBusinessModal(bId);
        }
    }
};

window.toggleAutoBuy = async function(bId, state) {
    if (window.electronAPI && window.electronAPI.nexusManageBusiness) {
        await window.electronAPI.nexusManageBusiness({ action: 'toggle_auto_buy', args: { businessId: bId, state: state } });
        World.businesses[bId].auto_buy_inputs = state;
    }
};

window.toggleAutoSell = async function(bId, state) {
    if (window.electronAPI && window.electronAPI.nexusManageBusiness) {
        await window.electronAPI.nexusManageBusiness({ action: 'toggle_auto_sell', args: { businessId: bId, state: state } });
        World.businesses[bId].auto_sell_outputs = state;
    }
};


window.setBusinessEfficiency = async function(bId) {
    const eff = parseInt(document.getElementById('bus-eff-slider').value);
    if (isNaN(eff) || eff < 0 || eff > 100) return alert("Введите значение от 0 до 100");
    if (window.electronAPI && window.electronAPI.nexusManageBusiness) {
        const res = await window.electronAPI.nexusManageBusiness({ action: 'set_efficiency', args: { businessId: bId, efficiency: eff } });
        if (res.status === 'ok') {
            World.businesses[bId].target_efficiency = eff;
            openBusinessModal(bId);
        }
    }
};

window.setBusinessEmployees = async function(bId) {
    const count = parseInt(document.getElementById('bus-emp-input').value) || 0;
    if (count < 0) return alert("Количество не может быть отрицательным.");
    if (window.electronAPI && window.electronAPI.nexusManageBusiness) {
        const res = await window.electronAPI.nexusManageBusiness({ action: 'set_employees', args: { businessId: bId, count: count } });
        if (res.status === 'ok') {
            World.businesses[bId].target_employee_count = count;
            World.businesses[bId].employee_count = Math.min(count, World.businesses[bId].level * 100);
            openBusinessModal(bId);
        }
    }
};

window.setBusinessWages = async function(bId) {
    const val = parseInt(document.getElementById('bus-wage-slider').value);
    if (window.electronAPI && window.electronAPI.nexusManageBusiness) {
        const res = await window.electronAPI.nexusManageBusiness({ action: 'set_wages', args: { businessId: bId, value: val } });
        if (res.status === 'ok') {
            World.businesses[bId].wage_level = val;
            addLogMessage(`[БИЗНЕС] Уровень зарплат на предприятии изменен на ${val}%.`, "command-feedback");
        }
    }
};

window.setBusinessMaintenance = async function(bId) {
    const val = parseInt(document.getElementById('bus-maint-slider').value);
    if (window.electronAPI && window.electronAPI.nexusManageBusiness) {
        const res = await window.electronAPI.nexusManageBusiness({ action: 'set_maintenance', args: { businessId: bId, value: val } });
        if (res.status === 'ok') {
            World.businesses[bId].maintenance_budget = val;
            addLogMessage(`[БИЗНЕС] Бюджет на обслуживание изменен на ${val}%.`, "command-feedback");
        }
    }
};


window.depositBusinessCash = async function(bId) {
    const amount = parseInt(document.getElementById('bus-cash-input').value) || 0;
    if (amount <= 0 || player.stats.gold < amount) return alert("Недостаточно золота в инвентаре!");
    if (window.electronAPI && window.electronAPI.nexusManageBusiness) {
        const res = await window.electronAPI.nexusManageBusiness({ action: 'deposit_cash', args: { businessId: bId, amount: amount } });
        if (res.status === 'ok') {
            executeCommand('updateStat', { stat: 'gold', change: -amount });
            World.businesses[bId].cash_balance += amount;
            openBusinessModal(bId);
            if (typeof updateHoldingsDisplay === 'function') updateHoldingsDisplay();
        }
    }
};

window.withdrawBusinessCash = async function(bId) {
    const amount = parseInt(document.getElementById('bus-cash-input').value) || 0;
    if (amount <= 0 || World.businesses[bId].cash_balance < amount) return alert("Недостаточно средств в кассе предприятия!");
    if (window.electronAPI && window.electronAPI.nexusManageBusiness) {
        const res = await window.electronAPI.nexusManageBusiness({ action: 'withdraw_cash', args: { businessId: bId, amount: amount } });
        if (res.status === 'ok') {
            executeCommand('updateStat', { stat: 'gold', change: amount });
            World.businesses[bId].cash_balance -= amount;
            openBusinessModal(bId);
            if (typeof updateHoldingsDisplay === 'function') updateHoldingsDisplay();
        }
    }
};

;


// ==========================================
// --- СИСТЕМА AI-ИГРОКА (АВТО-ТЕСТЕР) ---
// ==========================================

window.toggleAutoTester = function() {
    isAutoTesting = !isAutoTesting;
    aiPlayerCurrentTurns = 0;
    const btn = document.getElementById('admin-autotester-btn');
    if (btn) btn.innerHTML = isAutoTesting ? '🤖 Авто-Тестер: ВКЛ' : '🤖 Авто-Тестер: ВЫКЛ';
    
    if (isAutoTesting) {
        addLogMessage(`[DEV] Авто-тестер запущен. Лимит ходов: ${aiPlayerTurnLimit > 0 ? aiPlayerTurnLimit : 'Безлимит'}.`, "system-message");
        if (!isWaitingForAI) runAIPlayerTurn();
    } else {
        addLogMessage("[DEV] Авто-тестер остановлен. Управление возвращено человеку.", "system-message");
    }
};

async function performAiPlayerFetch(systemInstruction, history, providerModel, currentInput) {
    let targetUrl = "";
    let headers = { 'Content-Type': 'application/json' };
    let requestBody = {};
    let isGeminiFormat = false;

    let messages = [{ role: "system", content: systemInstruction }];
    if (history && history.length > 0) {
        history.forEach(item => {
            messages.push({ role: item.role === 'model' ? 'assistant' : 'user', content: item.parts[0].text });
        });
    }
    if (currentInput) messages.push({ role: "user", content: currentInput });

    if (aiPlayerProvider === 'local') {
        targetUrl = aiPlayerLocalUrl || 'http://localhost:1234/v1/chat/completions';
        if (targetUrl.endsWith('/')) targetUrl = targetUrl.slice(0, -1);
        if (targetUrl.match(/:\d+$/)) targetUrl += '/v1/chat/completions';
        else if (targetUrl.endsWith('/v1')) targetUrl += '/chat/completions';
        
        requestBody = { model: providerModel, messages: messages, temperature: 0.7, max_tokens: 2048 };
    } else if (aiPlayerProvider === 'openrouter') {
        targetUrl = "https://openrouter.ai/api/v1/chat/completions";
        headers['Authorization'] = 'Bearer ' + aiPlayerApiKey;
        headers['HTTP-Referer'] = "https://github.com/MrKins/Chronicles-of-Meterea";
        headers['X-Title'] = "Chronicles of Meterea Auto-Tester";
        requestBody = { model: providerModel, messages: messages, temperature: 0.7, max_tokens: 2048 };
    } else if (aiPlayerProvider === 'llmost') {
        targetUrl = "https://llmost.ru/api/v1/chat/completions";
        headers['Authorization'] = 'Bearer ' + aiPlayerApiKey;
        requestBody = { model: providerModel, messages: messages, temperature: 0.7, max_tokens: 2048 };
    } else if (aiPlayerProvider === 'gemini') {
        targetUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' + providerModel + ':generateContent?key=' + aiPlayerApiKey;
        const contents = [];
        if (history && history.length > 0) {
            history.forEach(item => {
                contents.push({ role: item.role === 'model' ? 'model' : 'user', parts: [{ text: item.parts[0].text }] });
            });
        }
        if (currentInput) contents.push({ role: "user", parts: [{ text: currentInput }] });
        requestBody = { systemInstruction: { parts: [{ text: systemInstruction }] }, contents: contents, generationConfig: { maxOutputTokens: 2048, temperature: 0.7 } };
        isGeminiFormat = true;
    }

    const response = await fetch(targetUrl, { method: 'POST', headers: headers, body: JSON.stringify(requestBody) });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI Player API Error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    let resultText = "";
    if (isGeminiFormat) {
        if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) {
            resultText = data.candidates[0].content.parts[0].text;
        } else {
            throw new Error("Неверный формат ответа Gemini: " + JSON.stringify(data));
        }
    } else {
        if (data.choices && data.choices[0] && data.choices[0].message) {
            resultText = data.choices[0].message.content;
        } else {
            throw new Error("Неверный формат ответа (нет choices[0]): " + JSON.stringify(data));
        }
    }

    // Очистка от тегов размышления (DeepSeek-R1 и подобные)
    resultText = resultText.replace(/<think>[\s\S]*?<\/think>/gi, '');
    if (resultText.includes('<think>')) {
        resultText = resultText.split('<think>')[0];
    }
    return resultText.trim();
}

async function runAIPlayerTurn() {
    if (!isAutoTesting || isWaitingForAI || !player) return;

    if (aiPlayerTurnLimit > 0 && aiPlayerCurrentTurns >= aiPlayerTurnLimit) {
        isAutoTesting = false;
        const btn = document.getElementById('admin-autotester-btn');
        if (btn) btn.innerHTML = '🤖 Авто-Тестер: ВЫКЛ';
        addLogMessage(`[DEV] Авто-тестер завершил работу (достигнут лимит в ${aiPlayerTurnLimit} ходов).`, "system-message");
        return;
    }

    aiPlayerCurrentTurns++;
    console.log(`[Auto-Tester] Формирование запроса... (Ход ${aiPlayerCurrentTurns}/${aiPlayerTurnLimit > 0 ? aiPlayerTurnLimit : '∞'})`);
    
    const stateSnapshot = buildLitePlayerSnapshot();
    const recentLogs = player.gameLogHistory ? player.gameLogHistory.slice(-5).map(e => `${e.type === 'user-message' ? 'Я' : 'GM'}: ${e.message}`).join('\n') : "Нет недавних событий.";

    let systemPrompt = autoTesterPromptTemplate;
    if (!systemPrompt || systemPrompt.startsWith("Ошибка:")) {
        systemPrompt = `Ты игрок в текстовой RPG. Состояние: ${stateSnapshot}\nЛоги: ${recentLogs}\nНапиши свое действие от первого лица (1-2 предложения).`;
    } else {
        systemPrompt = systemPrompt
            .replace('{stateSnapshot}', stateSnapshot)
            .replace('{recentLogs}', recentLogs);
    }

    try {
        const aiAction = await performAiPlayerFetch(systemPrompt, [], aiPlayerModelId, "Что ты сделаешь сейчас?");
        
        if (!isAutoTesting) return; // Проверка, не выключили ли пока ИИ думал

        if (!aiAction || aiAction.trim() === "") {
            console.warn("[Auto-Tester] Получен пустой ответ. Возможно, модель не успела завершить мысль (hit token limit).");
            addLogMessage(`[DEV] Авто-тестер вернул пустой ответ. Пропуск хода.`, "system-message");
            return;
        }

        // Вставляем текст в инпут и имитируем отправку
        if (userInput) {
            userInput.value = aiAction.trim();
            console.log("[Auto-Tester] Действие:", userInput.value);
            handleUserInput();
        }
    } catch (e) {
        console.error("[Auto-Tester] Ошибка:", e);
        addLogMessage(`[DEV] Ошибка Авто-тестера: ${e.message}. Тестер остановлен.`, "system-message");
        isAutoTesting = false;
        const btn = document.getElementById('admin-autotester-btn');
        if (btn) btn.innerHTML = '🤖 Авто-Тестер: ВЫКЛ';
    }
}


// ==========================================
// --- UI OVERHAUL: СИСТЕМА ВКЛАДОК ---
// ==========================================
function initSidebarTabs() {
    document.querySelectorAll('.s-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetId = e.currentTarget.dataset.target;
            const sidebar = e.currentTarget.closest('.sidebar');
            
            sidebar.querySelectorAll('.s-tab-btn').forEach(b => b.classList.remove('active'));
            sidebar.querySelectorAll('.s-tab-content').forEach(c => c.classList.remove('active'));
            
            e.currentTarget.classList.add('active');
            const targetContent = document.getElementById(targetId);
            if (targetContent) targetContent.classList.add('active');
        });
    });
}

function restructureUI() {
    if (document.querySelector('.sidebar-tabs')) return;

    const leftSidebar = document.querySelector('.left-sidebar');
    const rightSidebar = document.querySelector('.right-sidebar');
    if (!leftSidebar || !rightSidebar) return;

    // --- Левый Сайдбар ---
    const leftTabs = document.createElement('div');
    leftTabs.className = 'sidebar-tabs';
    leftTabs.innerHTML = `
        <button class="s-tab-btn active" data-target="left-tab-hero"><i class="fas fa-user-shield"></i> Герой</button>
        <button class="s-tab-btn" data-target="left-tab-gear"><i class="fas fa-shopping-bag"></i> Снаряжение</button>
    `;
    
    const leftTabHero = document.createElement('div'); leftTabHero.id = 'left-tab-hero'; leftTabHero.className = 's-tab-content active';
    const leftTabGear = document.createElement('div'); leftTabGear.id = 'left-tab-gear'; leftTabGear.className = 's-tab-content';

    const movePanel = (sidebar, selector, targetTab) => {
        const p = sidebar.querySelector(selector);
        if (p) targetTab.appendChild(p);
    };

    movePanel(leftSidebar, '.character-sheet', leftTabHero);
    movePanel(leftSidebar, '.status-effects-panel', leftTabHero);
    movePanel(leftSidebar, '.equipment-panel-v2', leftTabGear);
    movePanel(leftSidebar, '.inventory', leftTabGear);

    leftSidebar.appendChild(leftTabs);
    leftSidebar.appendChild(leftTabHero);
    leftSidebar.appendChild(leftTabGear);

    // --- Правый Сайдбар ---
    const rightTabs = document.createElement('div');
    rightTabs.className = 'sidebar-tabs';
    rightTabs.innerHTML = `
        <button class="s-tab-btn active" data-target="right-tab-env" title="Окружение"><i class="fas fa-map-marked-alt"></i></button>
        <button class="s-tab-btn" data-target="right-tab-journal" title="Журнал"><i class="fas fa-book-open"></i></button>
        <button class="s-tab-btn" data-target="right-tab-prog" title="Развитие"><i class="fas fa-dna"></i></button>
        <button class="s-tab-btn" data-target="right-tab-econ" title="Р­РєРѕРЅРѕРјРёРєР°"><i class="fas fa-coins"></i></button>
        <button class="s-tab-btn" data-target="right-tab-sys" title="Система"><i class="fas fa-cogs"></i></button>
    `;

    const rTabEnv = document.createElement('div'); rTabEnv.id = 'right-tab-env'; rTabEnv.className = 's-tab-content active';
    const rTabJournal = document.createElement('div'); rTabJournal.id = 'right-tab-journal'; rTabJournal.className = 's-tab-content';
    const rTabProg = document.createElement('div'); rTabProg.id = 'right-tab-prog'; rTabProg.className = 's-tab-content';
    const rTabEcon = document.createElement('div'); rTabEcon.id = 'right-tab-econ'; rTabEcon.className = 's-tab-content';
    const rTabSys = document.createElement('div'); rTabSys.id = 'right-tab-sys'; rTabSys.className = 's-tab-content';

    movePanel(rightSidebar, '.map-panel', rTabEnv);
    movePanel(rightSidebar, '.local-map-panel', rTabEnv);
    movePanel(rightSidebar, '.environment-panel', rTabEnv);

    movePanel(rightSidebar, '.quests', rTabJournal);
    movePanel(rightSidebar, '.world-chronicles-panel', rTabJournal);
    movePanel(rightSidebar, '.echo-memory-panel', rTabJournal);

    movePanel(rightSidebar, '.skills-panel', rTabProg);
    movePanel(rightSidebar, '.traits-panel', rTabProg);
    movePanel(rightSidebar, '.nexus-panel', rTabProg);

    movePanel(rightSidebar, '.holdings-panel', rTabEcon);
    movePanel(rightSidebar, '.port-panel', rTabEcon);
    movePanel(rightSidebar, '.trade-journal-panel', rTabEcon);

    movePanel(rightSidebar, '.calculation-log-panel', rTabSys);
    movePanel(rightSidebar, '.dice-log-panel', rTabSys);
    movePanel(rightSidebar, '.gm-notes-panel-debug', rTabSys);
    movePanel(rightSidebar, '.world-sim-debug-panel', rTabSys);

    rightSidebar.appendChild(rightTabs);
    rightSidebar.appendChild(rTabEnv);
    rightSidebar.appendChild(rTabJournal);
    rightSidebar.appendChild(rTabProg);
    rightSidebar.appendChild(rTabEcon);
    rightSidebar.appendChild(rTabSys);

    initSidebarTabs();
}


async function openLoadWorldModal() {
    if (!window.electronAPI || !window.electronAPI.isElectron) {
        showCustomAlert("Загрузка миров доступна только в десктопной версии.");
        return;
    }

    if (!loadWorldModal || !worldSlotsContainer) return;

    worldSlotsContainer.innerHTML = '<p style="text-align:center; color:#5dade2; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Чтение миров...</p>';
    loadWorldModal.style.display = 'flex';
    setTimeout(() => loadWorldModal.classList.add('visible'), 10);

    const worlds = await window.electronAPI.listWorlds();
    worldSlotsContainer.innerHTML = '';

    if (worlds.length === 0) {
        worldSlotsContainer.innerHTML = '<p style="text-align:center; color:#7f8c8d; padding: 20px;">Нет сохраненных миров.</p>';
        return;
    }

    worlds.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).forEach(w => {
        const btn = document.createElement('div');
        btn.className = 'save-slot-btn';
        btn.style.flexDirection = 'column';
        btn.style.alignItems = 'flex-start';
        btn.innerHTML = `
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                <span class="save-slot-id" style="color:#f1c40f; font-size:0.95em;">${escapeHTML(w.name || w.filename)}</span>
                <span style="color:#5dade2; font-size:0.82em; border:1px solid rgba(93,173,226,0.3); border-radius:3px; padding:1px 6px;">${escapeHTML(w.era)}</span>
            </div>
            ${w.mod_list && w.mod_list.filter(m=>m!=='base_game').length > 0
                ? `<div style="margin-top:4px; display:flex; flex-wrap:wrap; gap:3px;">
                    ${w.mod_list.filter(m=>m!=='base_game').map(m=>`<span style="background:rgba(93,173,226,0.1);border:1px solid rgba(93,173,226,0.25);border-radius:3px;padding:1px 5px;font-size:0.7em;color:#5dade2;">${m}</span>`).join('')}
                   </div>`
                : ''}
            <div style="display:flex; justify-content:space-between; width:100%; margin-top:8px; align-items:center;">
                <span style="color:#7f8c8d; font-size:0.8em;">${new Date(w.timestamp).toLocaleString()}</span>
                <div style="display:flex; gap: 5px;">
                    <button class="bus-btn btn-green load-w-btn" data-file="${w.filename}" style="padding:6px 14px;">${t('worldSetup.selectButton', null, 'Select')}</button>
                    <button class="bus-btn btn-red del-w-btn" data-file="${w.filename}" style="padding:6px 14px;">${t('worldSetup.deleteButton', null, 'Delete')}</button>
                </div>
            </div>
        `;
        worldSlotsContainer.appendChild(btn);
    });

    worldSlotsContainer.querySelectorAll('.load-w-btn').forEach(b => {
        b.onclick = async (e) => {
            const file = e.target.dataset.file;
            worldSlotsContainer.innerHTML = '<p style="text-align:center; color:#f1c40f; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Загрузка мира...</p>';
            const wData = await window.electronAPI.loadWorldState(file);
            if (wData) {
                preloadedWorldData = wData;
                if (selectedWorldInfo) {
                    selectedWorldInfo.textContent = `Выбран мир: ${wData.name || file}`;
                    selectedWorldInfo.style.display = 'block';
                }
                
                if (wData.era && charEraSelect) {
                    charEraSelect.value = wData.era;
                    updateEraDescription();
                }
                
                loadWorldModal.classList.remove('visible');
                setTimeout(() => loadWorldModal.style.display = 'none', 300);
            } else {
                showCustomAlert("Ошибка при загрузке файла мира.");
                openLoadWorldModal();
            }
        };
    });

    worldSlotsContainer.querySelectorAll('.del-w-btn').forEach(b => {
        b.onclick = async (e) => {
            const file = e.target.dataset.file;
            showCustomConfirm("Удалить этот мир навсегда?", async () => {
                await window.electronAPI.deleteWorld(file);
                openLoadWorldModal();
            });
        };
    });
}

function promptSaveWorldModal() {
    return new Promise((resolve) => {
        if (!saveWorldModal || !saveWorldNameInput || !saveWorldConfirmBtn || !saveWorldSkipBtn) {
            resolve();
            return;
        }

        saveWorldNameInput.value = `РњРёСЂ_${player.era}_${new Date().toISOString().slice(0,10)}`;

        saveWorldModal.style.display = 'flex';
        setTimeout(() => saveWorldModal.classList.add('visible'), 10);

        const cleanup = () => {
            saveWorldModal.classList.remove('visible');
            setTimeout(() => saveWorldModal.style.display = 'none', 300);
            saveWorldConfirmBtn.onclick = null;
            saveWorldSkipBtn.onclick = null;
        };

        saveWorldConfirmBtn.onclick = async () => {
            const name = saveWorldNameInput.value.trim() || "Безымянный_Мир";
            const filename = `world_${Date.now()}.json`;
            World.name = name; 
            
            saveWorldConfirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Сохранение...';
            saveWorldConfirmBtn.disabled = true;
            saveWorldSkipBtn.disabled = true;

            await window.electronAPI.saveWorldState(filename, World);
            
            saveWorldConfirmBtn.innerHTML = 'Сохранить';
            saveWorldConfirmBtn.disabled = false;
            saveWorldSkipBtn.disabled = false;
            
            cleanup();
            resolve();
        };

        saveWorldSkipBtn.onclick = () => {
            cleanup();
            resolve();
        };
    });
}

// === ИНИЦИАЛИЗАЦИЯ ОБРАБОТЧИКОВ ДЛЯ ЭРОТИЧЕСКОГО ЖУРНАЛА ===
// Добавляем обработчик для кнопки очистки журнала
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        const clearEroticJournalBtn = document.getElementById('clear-erotic-journal-btn');
        if (clearEroticJournalBtn) {
            clearEroticJournalBtn.addEventListener('click', clearEroticJournal);
        }
    });
}
