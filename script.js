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
    _seed: Date.now(),
    /**
     * Seed the RNG. Call once at game start or on load.
     * @param {number} seed
     */
    seed(seed) { this._seed = seed >>> 0; },
    /**
     * Mulberry32 вЂ” fast 32-bit PRNG. Returns [0, 1).
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
 * Р“Р°СЂР°РЅС‚РёСЂСѓРµС‚, С‡С‚Рѕ Сѓ РёРіСЂРѕРєР° РµСЃС‚СЊ СЂСЋРєР·Р°Рє Рё РєРѕРЅС‚РµР№РЅРµСЂ СЌРєРёРїРёСЂРѕРІРєРё.
 * Р•СЃР»Рё РѕРЅРё РѕС‚СЃСѓС‚СЃС‚РІСѓСЋС‚ (null/undefined РёР»Рё РЅРµ РІ СЂРµРµСЃС‚СЂРµ) вЂ” СЃРѕР·РґР°С‘С‚ РёС….
 * Р’С‹Р·С‹РІР°С‚СЊ РїРµСЂРµРґ Р»СЋР±РѕР№ РѕРїРµСЂР°С†РёРµР№ СЃ РёРЅРІРµРЅС‚Р°СЂС‘Рј, РµСЃР»Рё РµСЃС‚СЊ СЃРѕРјРЅРµРЅРёСЏ.
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
                console.warn('[DataArch] РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ data/system_containers.json:', error.message);
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
        console.warn("[Inventory] Р СЋРєР·Р°Рє РёРіСЂРѕРєР° РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚ РёР»Рё РЅРµ РІ СЂРµРµСЃС‚СЂРµ. РџРµСЂРµСЃРѕР·РґР°С‘Рј РёР· data/system_containers.json.");
        player.container_backpack = await createConfiguredSystemContainer('player_backpack');

        if (!player.container_backpack || !ContainerRegistry.has(player.container_backpack)) {
            throw new Error("[Inventory] РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕР·РґР°С‚СЊ player_backpack С‡РµСЂРµР· data/system_containers.json");
        }
    }

    const needsEquipment = !player.container_equipment || !ContainerRegistry.has(player.container_equipment);
    if (needsEquipment) {
        console.warn("[Inventory] РљРѕРЅС‚РµР№РЅРµСЂ СЌРєРёРїРёСЂРѕРІРєРё РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚ РёР»Рё РЅРµ РІ СЂРµРµСЃС‚СЂРµ. РџРµСЂРµСЃРѕР·РґР°С‘Рј РёР· data/system_containers.json.");
        player.container_equipment = await createConfiguredSystemContainer('player_equipment');

        if (!player.container_equipment || !ContainerRegistry.has(player.container_equipment)) {
            throw new Error("[Inventory] РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕР·РґР°С‚СЊ player_equipment С‡РµСЂРµР· data/system_containers.json");
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
        throw new Error("[Inventory] РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕР·РґР°С‚СЊ guard_confiscation_chest С‡РµСЂРµР· data/system_containers.json");
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
            // then it was moved via filter+push вЂ” but createItem already adds to container's .items array,
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
                trapMsg = ` РЎСЂР°Р±РѕС‚Р°Р»Р° Р»РѕРІСѓС€РєР°! РЈСЂРѕРЅ: ${cont.lock_data.trap.amount}.`;
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
        // FALLBACK: IPC РЅРµРґРѕСЃС‚СѓРїРµРЅ вЂ” РёСЃРїРѕР»СЊР·СѓРµРј Р»РѕРєР°Р»СЊРЅСѓСЋ СЂРµР°Р»РёР·Р°С†РёСЋ (OldCoreInventorySystem)
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

        // Р•СЃР»Рё РґРІРёР¶РѕРє РЅРµ РіРѕС‚РѕРІ вЂ” РїРѕРІС‚РѕСЂСЏРµРј РїРѕРїС‹С‚РєСѓ СЃ Р·Р°РґРµСЂР¶РєРѕР№ (race condition РїСЂРё Р·Р°РіСЂСѓР·РєРµ РјРёСЂР°)
        const isEngineNotReady = res.status === 'error' && (
            (res.message && (
                res.message.includes('Engine not ready') ||
                res.message.includes('Engine restarted') ||
                res.message.includes('timed out') ||
                res.message.includes('crashed')
            )) ||
            // Р•СЃР»Рё РґРІРёР¶РѕРє РІРµСЂРЅСѓР» РѕС€РёР±РєСѓ Р±РµР· РґРµС‚Р°Р»РµР№ вЂ” С‚РѕР¶Рµ РїСЂРѕР±СѓРµРј РµС‰С‘ СЂР°Р·
            (!res.message && _retryCount === 0)
        );
        if (isEngineNotReady && _retryCount < MAX_RETRIES) {
            const delay = Math.floor(RETRY_DELAY_MS * (1 + (_retryCount * RETRY_BACKOFF_MULTIPLIER)));
            console.warn(`[Inventory] Engine not ready for '${action}' (attempt ${_retryCount + 1}/${MAX_RETRIES}). Retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            return await sendInventoryCommand(action, args, _retryCount + 1);
        }

        // IPC РІРµСЂРЅСѓР» РѕС€РёР±РєСѓ РїРѕСЃР»Рµ РІСЃРµС… РїРѕРїС‹С‚РѕРє вЂ” fallback РЅР° Р»РѕРєР°Р»СЊРЅСѓСЋ СЂРµР°Р»РёР·Р°С†РёСЋ
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
 * Р›РѕРєР°Р»СЊРЅР°СЏ СЂРµР°Р»РёР·Р°С†РёСЏ РёРЅРІРµРЅС‚Р°СЂСЏ вЂ” fallback РєРѕРіРґР° C++ РґРІРёР¶РѕРє / IPC РЅРµРґРѕСЃС‚СѓРїРЅС‹.
 * Р”РµР»РµРіРёСЂСѓРµС‚ Рє OldCoreInventorySystem (СЂР°Р±РѕС‚Р°РµС‚ РЅР°РїСЂСЏРјСѓСЋ СЃ ContainerRegistry / ItemRegistry).
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
            // РљРѕРјР°РЅРґС‹ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРё NPC/Entity вЂ” СЂР°Р±РѕС‚Р°СЋС‚ С‚РѕР»СЊРєРѕ С‡РµСЂРµР· C++ РґРІРёР¶РѕРє.
            // Р›РѕРєР°Р»СЊРЅРѕ РЅРµС‚ СЂРµРµСЃС‚СЂР° NPC, РїРѕСЌС‚РѕРјСѓ РїСЂРѕСЃС‚Рѕ РІРѕР·РІСЂР°С‰Р°РµРј OK (fire-and-forget).
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
                trapMsg = ` РЎСЂР°Р±РѕС‚Р°Р»Р° Р»РѕРІСѓС€РєР°! РЈСЂРѕРЅ: ${cont.lock_data.trap.amount}.`;
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
//   Use OldCoreInventorySystem directly вЂ” it operates on local registries only.
// - For code that NEEDS engine synchronization (persisting to C++ engine):
//   Use CoreInventorySystemAsync and ALWAYS await the result.
// - NEVER call CoreInventorySystemAsync methods without await.
// - If you see "CoreInventorySystem" in code, replace it with either
//   OldCoreInventorySystem (sync, local) or CoreInventorySystemAsync (async, networked).

// Backward compatibility wrapper that warns when used without proper async handling
const CoreInventorySystem = new Proxy(OldCoreInventorySystem, {
    get(target, prop) {
        if (prop in CoreInventorySystemAsync && typeof CoreInventorySystemAsync[prop] === 'function') {
            // Return the async version but log a deprecation warning
            const asyncFn = CoreInventorySystemAsync[prop];
            return function(...args) {
                const stackHint = new Error().stack?.split('\n')[2]?.trim() || 'unknown caller';
                console.warn(`[DEPRECATED] CoreInventorySystem.${prop}() called вЂ” this returns a Promise. Use "await CoreInventorySystemAsync.${prop}()" instead. Called from: ${stackHint}`);
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

    if (!bodySlots.includes(targetSlot)) return `[ERROR] РџРѕРїС‹С‚РєР° СЌРєРёРїРёСЂРѕРІР°С‚СЊ РІ РЅРµСЃСѓС‰РµСЃС‚РІСѓСЋС‰РёР№ СЃР»РѕС‚: '${targetSlot}'`;

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
                // Fallback Рє Р¶РµСЃС‚РєРѕ Р·Р°РєРѕРґРёСЂРѕРІР°РЅРЅРѕРјСѓ СЃРїРёСЃРєСѓ
                this.registry = {
                    horse: { id: 'horse', speedMultiplier: 2.0, cargoBonus: 5, name: 'Р›РѕС€Р°РґСЊ', basePrice: 500, rarity: 'РќРµРѕР±С‹С‡РЅС‹Р№' },
                    warhorse: { id: 'warhorse', speedMultiplier: 1.8, cargoBonus: 3, name: 'Р‘РѕРµРІРѕР№ РєРѕРЅСЊ', basePrice: 1200, rarity: 'Р РµРґРєРёР№' },
                    cart: { id: 'cart', speedMultiplier: 1.3, cargoBonus: 15, name: 'РўРµР»РµР¶РєР°', basePrice: 300, rarity: 'РћР±С‹С‡РЅС‹Р№' },
                    wagon: { id: 'wagon', speedMultiplier: 1.5, cargoBonus: 30, name: 'РўРѕСЂРіРѕРІР°СЏ РїРѕРІРѕР·РєР°', basePrice: 500, rarity: 'РќРµРѕР±С‹С‡РЅС‹Р№' },
                    ship_deed: { id: 'ship_deed', speedMultiplier: 2.5, cargoBonus: 50, name: 'Р”РѕРєСѓРјРµРЅС‚ РЅР° РєРѕСЂР°Р±Р»СЊ', basePrice: 2000, rarity: 'Р РµРґРєРёР№' }
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

    // Р“РµРЅРµСЂР°С†РёСЏ РґРѕРєСѓРјРµРЅС‚Р°С†РёРё РґР»СЏ Р“Рњ
    generateGMDocumentation() {
        if (!this.registry) return '';

        let doc = '=== [РЎР›РЈР–Р•Р‘РќРђРЇ РРќР¤РћР РњРђР¦РРЇ Р”Р›РЇ Р“Рњ - РќР• Р’Р«Р’РћР”РРўР¬ РР“Р РћРљРЈ] ===\n';
        doc += 'РўР РђРќРЎРџРћР Рў: Р”РћРџРЈРЎРўРРњР«Р• ID (РЎРўР РћР“Рћ!)\n';
        doc += 'РџСЂРё СЃРѕР·РґР°РЅРёРё С‚СЂР°РЅСЃРїРѕСЂС‚Р° С‡РµСЂРµР· addItem РёСЃРїРѕР»СЊР·СѓР№ РўРћР›Р¬РљРћ СЌС‚Рё aiIdentifier:\n\n';

        for (const [id, data] of Object.entries(this.registry)) {
            doc += `  "${id}" - ${data.name || data.nameEn} (СЃРєРѕСЂРѕСЃС‚СЊ Г—${data.speedMultiplier}, +${data.cargoBonus} СЃР»РѕС‚РѕРІ)\n`;
        }

        doc += '\nРџР РђР’РР›Р¬РќРћ:\n';
        doc += '  { "command": "addItem", "args": { "aiIdentifier": "horse", "name": "Р“РЅРµРґР°СЏ Р»РѕС€Р°РґСЊ" } }\n';
        doc += '  { "command": "mountTransport", "args": { "itemId": "horse" } }\n';
        doc += '\nРќР•РџР РђР’РР›Р¬РќРћ:\n';
        doc += '  { "command": "addItem", "args": { "aiIdentifier": "horse_brown" } } вќЊ\n';
        doc += '  { "command": "addItem", "args": { "aiIdentifier": "Р»РѕС€Р°РґСЊ" } } вќЊ\n';
        doc += '=== [РљРћРќР•Р¦ РЎР›РЈР–Р•Р‘РќРћР™ РРќР¤РћР РњРђР¦РР] ===\n';

        return doc;
    }
};

// РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ РїСЂРё Р·Р°РіСЂСѓР·РєРµ
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
            addLogMessage(res.success ? "[РўРћР Р“РћР’Р›РЇ] РЎРґРµР»РєР° РїРѕРґС‚РІРµСЂР¶РґРµРЅР° РёРіСЂРѕРєРѕРј Рё СѓСЃРїРµС€РЅРѕ Р·Р°РІРµСЂС€РµРЅР°." : `[ERROR] РћС€РёР±РєР° СЃРґРµР»РєРё: ${res.error}`, "system-message");
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

    console.log("Р’С‹РїРѕР»РЅРµРЅРёРµ РєРѕРјР°РЅРґС‹ (ASYNC):", command, args);
    let feedback = null;

    // Р“Р°СЂР°РЅС‚РёСЂСѓРµРј, С‡С‚Рѕ СЂСЋРєР·Р°Рє Рё СЌРєРёРїРёСЂРѕРІРєР° СЃСѓС‰РµСЃС‚РІСѓСЋС‚ РїРµСЂРµРґ РІС‹РїРѕР»РЅРµРЅРёРµРј РєРѕРјР°РЅРґ
    const inventoryCommands = ['addItem', 'removeItem', 'equipItem', 'unequipItem', 'moveItem', 'updateStat', 'createContainer', 'destroyContainer', 'useItem', 'openContainer', 'trade', 'sell'];
    if (inventoryCommands.includes(command)) {
        await ensurePlayerContainers();
    }

    try {
        // --- РРќРўР•Р“Р РђР¦РРЇ РњРћР”РћР’: РљР°СЃС‚РѕРјРЅС‹Рµ РєРѕРјР°РЅРґС‹ ---
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
                        feedback = `[ERROR] РљРѕРЅС‚РµР№РЅРµСЂ ${targetContId} РЅРµ РЅР°Р№РґРµРЅ.`;
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
                        // Рў3 Р¤РРљРЎ: РџСЂРѕРІРµСЂРєР° РІРµСЃР°
                    const currentWeight = CoreInventorySystemAsync.getContainerWeight(targetContId);
                    let itemWeight = 1.0;
                    if (isCurrencyAiIdentifier(aiId)) {
                        itemWeight = 0.01;
                    } else if (typeof ECONOMY_ITEMS !== 'undefined' && ECONOMY_ITEMS[aiId]) {
                        itemWeight = 1.0;
                    }
                    const addedWeight = quantity * itemWeight;

                    if (cont.owner_id !== 'player' && currentWeight + addedWeight > cont.max_weight_kg) {
                        feedback = `[РћРЁРР‘РљРђ РЇР”Р Рђ] РљРѕРЅС‚РµР№РЅРµСЂ РїРµСЂРµРіСЂСѓР¶РµРЅ! Р›РёРјРёС‚: ${cont.max_weight_kg} РєРі. РќРµРІРѕР·РјРѕР¶РЅРѕ РґРѕР±Р°РІРёС‚СЊ ${quantity} С€С‚. '${name}' (Р’РµСЃ: ${addedWeight.toFixed(2)} РєРі). РСЃРїРѕР»СЊР·СѓР№С‚Рµ Р±Р°РЅРє, СЃСѓРЅРґСѓРєРё РёР»Рё РїРѕРІРѕР·РєСѓ!`;
                        break;
                    }

                    if (getContainerItems(cont).length >= cont.max_slots) {
                            feedback = t('gameInterface.commandFeedback.inventoryFull', { itemName: name });
                        } else {
                            // РџСЂРѕРІРµСЂРєР° С‚СЂР°РЅСЃРїРѕСЂС‚Р° С‡РµСЂРµР· С†РµРЅС‚СЂР°Р»РёР·РѕРІР°РЅРЅС‹Р№ СЂРµРµСЃС‚СЂ
                            const isTransport = TransportSystem.isTransportId(aiId);
                            const transportData = isTransport ? TransportSystem.getTransportData(aiId) : null;

                            const customProps = {
                                name: name,
                                aiIdentifier: aiId,
                                description: args.description || t('itemDescriptions.noDescription'),
                                rarity: args.rarity || (transportData?.rarity) || 'РћР±С‹С‡РЅС‹Р№',
                                itemType: args.itemType || (isTransport ? 'vehicle' : 'misc'),
                                slot: args.slot || null,
                                effects: args.effects || [],
                                value: args.value ?? (transportData?.basePrice) ?? 0,
                                quality: args.quality ?? requireRuntimeNumber(getGameplayRuntimeConfig().inventory.default_item_quality, 'gameplay_runtime.inventory.default_item_quality'),
                                isTransport: isTransport,
                                speedMultiplier: transportData?.speedMultiplier,
                                cargoBonus: transportData?.cargoBonus
                            };

                            // Р’Р°Р»РёРґР°С†РёСЏ: РїСЂРµРґСѓРїСЂРµР¶РґРµРЅРёРµ РµСЃР»Рё Р“Рњ РїС‹С‚Р°РµС‚СЃСЏ СЃРѕР·РґР°С‚СЊ "РїРѕС…РѕР¶РёР№" ID
                            if (!isTransport && (aiId.toLowerCase().includes('horse') || aiId.toLowerCase().includes('cart') || aiId.toLowerCase().includes('wagon'))) {
                                const validIds = TransportSystem.getAllTransportIds();
                                console.warn(`[addItem] Suspicious transport-like ID "${aiId}". Valid transport IDs: ${validIds.join(', ')}`);
                                await CoreInventorySystemAsync.createItem(aiId, quantity, targetContId, customProps);
                                feedback = t('gameInterface.commandFeedback.itemAdded', { itemName: name, quantity: quantity }) + ` [WARNING] ID "${aiId}" РЅРµ СЏРІР»СЏРµС‚СЃСЏ С‚СЂР°РЅСЃРїРѕСЂС‚РѕРј. РСЃРїРѕР»СЊР·СѓР№С‚Рµ: ${validIds.join(', ')}`;
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
                    feedback = `[ERROR] 'addItem' С‚СЂРµР±СѓРµС‚ 'aiIdentifier' Рё 'name'.`;
                }
                break;

                                    case 'removeItem': {
                const rawId = args.itemId || args.id || args.aiIdentifier;
                if (!rawId) {
                    feedback = `[ERROR] 'removeItem' С‚СЂРµР±СѓРµС‚ 'itemId' РёР»Рё 'aiIdentifier'.`;
                    break;
                }

                const searchTerm = String(rawId).trim();

                // 2. РџРѕРёСЃРє РїСЂРµРґРјРµС‚Р°
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
                    feedback = `[ERROR] 'equipItem' С‚СЂРµР±СѓРµС‚ Р°СЂРіСѓРјРµРЅС‚ 'aiIdentifier'.`;
                    break;
                }

                const searchTerm = String(rawId).trim();
                const backpack = ContainerRegistry.get(player.container_backpack);
                
                if (!backpack) {
                    feedback = `[ERROR] Р СЋРєР·Р°Рє РёРіСЂРѕРєР° РЅРµ РЅР°Р№РґРµРЅ РІ СЂРµРµСЃС‚СЂРµ.`;
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
                    feedback = `[ERROR] РќРµ СѓРґР°Р»РѕСЃСЊ СЌРєРёРїРёСЂРѕРІР°С‚СЊ '${searchTerm}'. РџСЂРµРґРјРµС‚ РЅРµ РЅР°Р№РґРµРЅ РІ РёРЅРІРµРЅС‚Р°СЂРµ.`;
                }
                break;
            }

            case 'unequipItem':
                if (args.slot) {
                    const slot = args.slot.toLowerCase();
                    feedback = await unequipItemAsync(slot);
                } else {
                    feedback = `[ERROR] 'unequipItem' С‚СЂРµР±СѓРµС‚ 'slot'.`;
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
                    feedback = `[РЎРРЎРўР•РњРђ] РЎРѕР·РґР°РЅ РєРѕРЅС‚РµР№РЅРµСЂ ${contId} С‚РёРїР° ${args.type} РґР»СЏ ${args.ownerId}.`;
                } else {
                    feedback = `[ERROR] 'createContainer' С‚СЂРµР±СѓРµС‚ 'type' Рё 'ownerId'.`;
                }
                break;

            case 'moveItem':
                if (args.itemId && args.sourceContainerId) {
                    const res = await CoreInventorySystemAsync.moveItem(args.itemId, args.sourceContainerId, args.targetContainerId || null, args.quantity || null);
                    feedback = res.success ? `[РЎРРЎРўР•РњРђ] РџСЂРµРґРјРµС‚ РїРµСЂРµРјРµС‰РµРЅ.` : `[ERROR] РћС€РёР±РєР° РїРµСЂРµРјРµС‰РµРЅРёСЏ: ${res.error}`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'moveItem' С‚СЂРµР±СѓРµС‚ 'itemId' Рё 'sourceContainerId'.`;
                }
                break;

            case 'moveItems':
            case 'move_items':
                if (args.sourceContainerId && Array.isArray(args.items) && args.items.length > 0) {
                    const res = await CoreInventorySystemAsync.moveItems(args.sourceContainerId, args.targetContainerId || args.target || null, args.items, { actorId: getInventoryActorId('default') });
                    feedback = res.success
                        ? `[РЎРРЎРўР•РњРђ] РџРµСЂРµРјРµС‰РµРЅРѕ РїСЂРµРґРјРµС‚РѕРІ: ${res.movedCount}.`
                        : `[ERROR] РћС€РёР±РєР° РїР°РєРµС‚РЅРѕРіРѕ РїРµСЂРµРјРµС‰РµРЅРёСЏ: ${res.error}`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'moveItems' С‚СЂРµР±СѓРµС‚ 'sourceContainerId' Рё 'items' [{id, quantity}].`;
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
                feedback = res.success ? `[РўРћР Р“РћР’Р›РЇ] ${res.message}` : `[ERROR] ${res.error}`;
                break;
            }

            case 'confirmTrade':
            case 'confirm_trade': {
                const tradeId = args.tradeId || args.trade_id || player.active_trade_id;
                if (!tradeId) {
                    feedback = `[ERROR] РќРµС‚ Р°РєС‚РёРІРЅРѕР№ СЃРґРµР»РєРё РґР»СЏ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ.`;
                    break;
                }
                const res = await TradeSystemAsync.confirmTrade(tradeId);
                feedback = res.success
                    ? `[РўРћР Р“РћР’Р›РЇ] РЎРґРµР»РєР° СѓСЃРїРµС€РЅРѕ Р·Р°РІРµСЂС€РµРЅР°${res.price ? ` Р·Р° ${res.price} Р·РѕР»РѕС‚Р°` : ''}.`
                    : `[ERROR] РћС€РёР±РєР° СЃРґРµР»РєРё: ${res.error}`;
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
                    feedback = `[ERROR] РќРµС‚ Р°РєС‚РёРІРЅРѕР№ СЃРґРµР»РєРё РґР»СЏ С‚РѕСЂРіР°.`;
                    break;
                }
                const newOffer = args.newOffer ?? args.new_offer ?? args.price ?? args.offerItems;
                const res = await TradeSystemAsync.negotiateTrade(tradeId, newOffer, args.requestItems || args.request_items || []);
                feedback = res.success
                    ? `[РўРћР Р“РћР’Р›РЇ] РЈСЃР»РѕРІРёСЏ СЃРґРµР»РєРё РѕР±РЅРѕРІР»РµРЅС‹${res.acceptedPrice ? `: ${res.acceptedPrice} Р·РѕР»РѕС‚Р°.` : '.'}`
                    : `[ERROR] РћС€РёР±РєР° РёР·РјРµРЅРµРЅРёСЏ СЃРґРµР»РєРё: ${res.error}`;
                break;
            }

            case 'destroyContainer':
                if (args.containerId) {
                    const res = await CoreInventorySystemAsync.destroyContainer(args.containerId);
                    feedback = res ? `[РЎРРЎРўР•РњРђ] РљРѕРЅС‚РµР№РЅРµСЂ ${args.containerId} СЂР°Р·СЂСѓС€РµРЅ, СЃРѕРґРµСЂР¶РёРјРѕРµ РІС‹СЃС‹РїР°Р»РѕСЃСЊ РЅР° Р·РµРјР»СЋ.` : `[ERROR] РљРѕРЅС‚РµР№РЅРµСЂ РЅРµ РЅР°Р№РґРµРЅ.`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'destroyContainer' С‚СЂРµР±СѓРµС‚ 'containerId'.`;
                }
                break;

            case 'unlockContainer':
                if (args.containerId) {
                    const res = await CoreInventorySystemAsync.unlockContainer(args.containerId, 'player');
                    feedback = res.success ? `[Р’Р—Р›РћРњ] РЈСЃРїРµС€РЅРѕ: ${res.message}` : `[Р’Р—Р›РћРњ] РџСЂРѕРІР°Р»: ${res.error}`;
                    updateInventoryDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'unlockContainer' С‚СЂРµР±СѓРµС‚ 'containerId'.`;
                }
                break;

            case 'confiscateStolen':
                if (args.targetId) {
                    const targetCont = args.targetId === 'player' ? player.container_backpack : args.targetId;
                    const count = await CoreInventorySystemAsync.confiscateStolen(targetCont, "guard_confiscation_chest");
                    feedback = `[РЎРўР РђР–Рђ] РР·СЉСЏС‚Рѕ РєСЂР°РґРµРЅС‹С… РїСЂРµРґРјРµС‚РѕРІ: ${count}.`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'confiscateStolen' С‚СЂРµР±СѓРµС‚ 'targetId'.`;
                }
                break;

            case 'buildContainer':
                if (args.type) {
                    const contId = await CoreInventorySystemAsync.buildContainer('player', args.type, player.location);
                    feedback = contId ? `[РљР РђР¤Рў] РЎРѕР·РґР°РЅ РєРѕРЅС‚РµР№РЅРµСЂ ${contId}. РџРѕС‚СЂР°С‡РµРЅРѕ 5 РґРµСЂРµРІР°.` : `[ERROR] РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РґРµСЂРµРІР° (РЅСѓР¶РЅРѕ 5 wood).`;
                    updateInventoryDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'buildContainer' С‚СЂРµР±СѓРµС‚ 'type'.`;
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
                    feedback = `[РЎРРЎРўР•РњРђ] AoE СѓСЂРѕРЅ (${args.damage}) РЅР°РЅРµСЃРµРЅ РїРѕ Р»РѕРєР°С†РёРё ${args.location}. Р Р°Р·СЂСѓС€РµРЅРѕ РєРѕРЅС‚РµР№РЅРµСЂРѕРІ: ${destroyed}. РџСЂРµРґРјРµС‚С‹ РІРЅСѓС‚СЂРё РїРѕРІСЂРµР¶РґРµРЅС‹.`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'applyAoEDamage' С‚СЂРµР±СѓРµС‚ 'location' Рё 'damage'.`;
                }
                break;

            case 'castMagicalPocket': {
                const existingPocket = Array.from(ContainerRegistry.values()).find(cont => cont.owner_id === 'player' && cont.type === 'magical_pocket');
                if (!player.statusEffects['spell_magical_pocket']) {
                    player.statusEffects['spell_magical_pocket'] = { id: 'spell_magical_pocket', name: 'РњР°РіРёС‡РµСЃРєРёР№ РєР°СЂРјР°РЅ', duration: 9999, description: 'РћС‚РєСЂС‹РІР°РµС‚ РґРѕСЃС‚СѓРї Рє СЌРєСЃС‚СЂР°РґРёРјРµРЅСЃРёРѕРЅР°Р»СЊРЅРѕРјСѓ С…СЂР°РЅРёР»РёС‰Сѓ.', effects: [] };
                }
                if (existingPocket) {
                    await CoreInventorySystemAsync.updateContainerLocation(existingPocket.id, normalizeContainerLocation({ world_coords: null, parent_entity: 'player', parent_container: null, region_id: 'astral' }));
                    feedback = `[РњРђР“РРЇ] РњР°РіРёС‡РµСЃРєРёР№ РєР°СЂРјР°РЅ СѓР¶Рµ Р°РєС‚РёРІРµРЅ.`;
                } else {
                    const contId = await CoreInventorySystemAsync.createContainer('magical_pocket', 'player', 500, 100, { world_coords: null, parent_entity: 'player', parent_container: null, region_id: 'astral' });
                    feedback = `[РњРђР“РРЇ] РЎРѕР·РґР°РЅ РјР°РіРёС‡РµСЃРєРёР№ РєР°СЂРјР°РЅ (ID: ${contId}).`;
                }
                break;
            }

            case 'dispelMagicPocket': {
                const pocketId = args.containerId || Array.from(ContainerRegistry.values()).find(cont => cont.owner_id === 'player' && cont.type === 'magical_pocket')?.id;
                if (pocketId && ContainerRegistry.has(pocketId)) {
                    await CoreInventorySystemAsync.updateContainerLocation(pocketId, resolveActorLocation('player'));
                    await CoreInventorySystemAsync.destroyContainer(pocketId);
                    delete player.statusEffects['spell_magical_pocket'];
                    feedback = `[РњРђР“РРЇ] РњР°РіРёС‡РµСЃРєРёР№ РєР°СЂРјР°РЅ СЂР°Р·РІРµСЏРЅ, РІРµС‰Рё РІС‹СЃС‹РїР°Р»РёСЃСЊ РІ СЂРµР°Р»СЊРЅС‹Р№ РјРёСЂ.`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] РњР°РіРёС‡РµСЃРєРёР№ РєР°СЂРјР°РЅ РЅРµ РЅР°Р№РґРµРЅ.`;
                }
                break;
            }

            case 'fleePackAnimal':
                if (args.containerId) {
                    const contId = resolveSpecialContainerId(args.containerId);
                    const cont = ContainerRegistry.get(contId);
                    if (cont) {
                        await CoreInventorySystemAsync.updateContainerLocation(contId, normalizeContainerLocation({ world_coords: [0, 0, 0], parent_entity: null, parent_container: null, region_id: "unknown_wilderness" }));
                        feedback = `[РЎРћР‘Р«РўРР•] Р’СЊСЋС‡РЅРѕРµ Р¶РёРІРѕС‚РЅРѕРµ РёСЃРїСѓРіР°Р»РѕСЃСЊ Рё СЃР±РµР¶Р°Р»Рѕ РІРјРµСЃС‚Рµ СЃ РєРѕРЅС‚РµР№РЅРµСЂРѕРј ${contId}!`;
                    } else {
                        feedback = `[ERROR] РљРѕРЅС‚РµР№РЅРµСЂ РЅРµ РЅР°Р№РґРµРЅ.`;
                    }
                } else {
                    feedback = `[ERROR] 'fleePackAnimal' С‚СЂРµР±СѓРµС‚ 'containerId'.`;
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
                        feedback = `[РџСЂРµРґРјРµС‚] РҐР°СЂР°РєС‚РµСЂРёСЃС‚РёРєР° '${args.stat}' Сѓ '${item.custom_props.name}' РёР·РјРµРЅРµРЅР° РЅР° ${change > 0 ? '+' + change : change}.`;
                        if (isEquipped) updateEquipmentDisplay();
                        else updateInventoryDisplay();
                    } else {
                        feedback = `[ERROR] РџСЂРµРґРјРµС‚ '${searchTerm}' РЅРµ РЅР°Р№РґРµРЅ РґР»СЏ updateItemStat.`;
                    }
                } else {
                    feedback = `[ERROR] 'updateItemStat' С‚СЂРµР±СѓРµС‚ 'aiIdentifier', 'stat' Рё 'change'.`;
                }
                break;
            }

            case 'mountTransport': {
                const itemId = args.itemId || args.aiIdentifier || args.id;
                if (!itemId) {
                    feedback = `[ERROR] 'mountTransport' С‚СЂРµР±СѓРµС‚ 'itemId'.`;
                    break;
                }

                const backpackId = player.container_backpack;
                const backpack = ContainerRegistry.get(backpackId);
                if (!backpack) {
                    feedback = `[ERROR] Р СЋРєР·Р°Рє РёРіСЂРѕРєР° РЅРµ РЅР°Р№РґРµРЅ.`;
                    break;
                }

                const item = getContainerItems(backpack).map(id => ItemRegistry.get(id)).find(it =>
                    it && (it.id === itemId || it.prototype_id === itemId || it.custom_props?.aiIdentifier === itemId)
                );

                if (!item) {
                    feedback = `[ERROR] РџСЂРµРґРјРµС‚ С‚СЂР°РЅСЃРїРѕСЂС‚Р° РЅРµ РЅР°Р№РґРµРЅ РІ РёРЅРІРµРЅС‚Р°СЂРµ.`;
                    break;
                }

                // Р¦РµРЅС‚СЂР°Р»РёР·РѕРІР°РЅРЅР°СЏ РІР°Р»РёРґР°С†РёСЏ С‡РµСЂРµР· TransportSystem
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
                    feedback = `[ERROR] РўСЂР°РЅСЃРїРѕСЂС‚ РЅРµ Р°РєС‚РёРІРёСЂРѕРІР°РЅ.`;
                    break;
                }

                player.activeTransport = null;
                feedback = t('transport.dismounted');
                updateCharacterSheet();
                break;
            }

            default:
                feedback = `[ERROR] РќРµРёР·РІРµСЃС‚РЅР°СЏ РєРѕРјР°РЅРґР° (ASYNC): ${command}`;
                console.warn(feedback, args);
        }
    } catch (error) {
        feedback = t('gameInterface.commandFeedback.errorCommandGeneric', { command: command, args: error.message });
        console.error(`РљСЂРёС‚РёС‡РµСЃРєР°СЏ РѕС€РёР±РєР° РїСЂРё РІС‹РїРѕР»РЅРµРЅРёРё РєРѕРјР°РЅРґС‹ ${command} (ASYNC):`, error, args);
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
            addLogMessage(res.success ? "[РўРћР Р“РћР’Р›РЇ] РЎРґРµР»РєР° РїРѕРґС‚РІРµСЂР¶РґРµРЅР° РёРіСЂРѕРєРѕРј Рё СѓСЃРїРµС€РЅРѕ Р·Р°РІРµСЂС€РµРЅР°." : `[ERROR] РћС€РёР±РєР° СЃРґРµР»РєРё: ${res.error}`, "system-message");
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
                ? `РЎРґРµР»РєР° РїРѕРґРіРѕС‚РѕРІР»РµРЅР°. РўРѕСЂРіРѕРІРµС† РїСЂРµРґР»Р°РіР°РµС‚ ${trade.final_price} Р·РѕР»РѕС‚Р°.`
                : `РЎРґРµР»РєР° РїРѕРґРіРѕС‚РѕРІР»РµРЅР°. РћР¶РёРґР°РЅРёРµ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ.`
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
                    // Р”РѕР±Р°РІР»СЏРµРј С„РёР·РёС‡РµСЃРєРѕРµ Р·РѕР»РѕС‚Рѕ РІ СЃРєР»Р°Рґ СЂРµРіРёРѕРЅР°
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
                text: `РРіСЂРѕРє СѓСЃРїРµС€РЅРѕ Р·Р°РІРµСЂС€РёР» СЃРґРµР»РєСѓ СЃ ${trade.target} РЅР° СЃСѓРјРјСѓ ${trade.final_price || 0} Р·РѕР»РѕС‚Р°.`,
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
    if (!chestId || !ContainerRegistry.has(chestId)) return "РџСѓСЃС‚Рѕ";
    const cont = ContainerRegistry.get(chestId);
    if (!cont.items || cont.items.length === 0) return "РџСѓСЃС‚Рѕ";
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
    if (!data) return "РќРµС‚ РґР°РЅРЅС‹С…";
    if (objType === 'caravan') {
        let goods = getCaravanContents(data.chest_id);
        return `РљР°СЂР°РІР°РЅ (ID: ${data.id}). РњР°СЂС€СЂСѓС‚: ${data.origin} -> ${data.destination}. РћС…СЂР°РЅР°: ${data.guards} РЅР°РµРјРЅРёРєРѕРІ. Р“СЂСѓР· (chest_id: ${data.chest_id}): ${goods}.`;
    } else if (objType === 'army') {
        return `РђСЂРјРёСЏ (ID: ${data.id}). Р¤СЂР°РєС†РёСЏ: ${data.faction_name || 'РќРµРёР·РІРµСЃС‚РЅРѕ'}. Р§РёСЃР»РµРЅРЅРѕСЃС‚СЊ: ${data.size}. РњРѕСЂР°Р»СЊ: ${data.morale}. РќР°РїСЂР°РІР»СЏРµС‚СЃСЏ РІ: ${data.destination}. Р¤Р°Р·Р°: ${data.current_phase}. РЎСѓРЅРґСѓРє СЃРЅР°Р±Р¶РµРЅРёСЏ: ${data.supply_chest_id || 'РќРµС‚'}.`;
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
        if (!player) return { success: false, error: "РРіСЂРѕРє РЅРµ РЅР°Р№РґРµРЅ" };
        
        let dest = globalLocations[destinationId] || (player.mapMarkers && player.mapMarkers[destinationId]);
        const allPoints = [
            ...Object.keys(globalLocations || {}).map(k => ({ ...globalLocations[k], id: k })),
            ...Object.values(player.mapMarkers || {})
        ];

        if (!dest) {
            const searchName = String(destinationId).toLowerCase().trim();
            
            // 1. РџРѕРёСЃРє РїРѕ РёРјРµРЅРё
            dest = allPoints.find(p => p.name && p.name.toLowerCase().trim().includes(searchName));
            
            // 2. РџРѕРёСЃРє РїРѕ С‡Р°СЃС‚СЏРј ID (СѓСЃС‚РѕР№С‡РёРІРѕСЃС‚СЊ Рє РїРµСЂРµСЃС‚Р°РЅРѕРІРєРµ СЃР»РѕРІ, РЅР°РїСЂ. aquilon_capital)
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
            
            // 3. РџРѕРёСЃРє РїРѕ С‡Р°СЃС‚СЏРј РёРјРµРЅРё
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
            addLogMessage(`[Р’РќРРњРђРќРР•] Р›РѕРєР°С†РёСЏ '${destinationId}' РЅРµ РЅР°Р№РґРµРЅР° РІ Р°С‚Р»Р°СЃРµ. РњР°СЂС€СЂСѓС‚ РїСЂРѕР»РѕР¶РµРЅ РЅР°СѓРіР°Рґ, Р»РѕРєР°С†РёСЏ РґРѕР±Р°РІР»РµРЅР° РЅР° РєР°СЂС‚Сѓ.`, "system-message");
            
            let startX = 128, startY = 128;
            if (globalLocations[startLocId]) { startX = globalLocations[startLocId].x; startY = globalLocations[startLocId].y; }
            
            await executeCommand('addMapMarker', {
                id: destinationId,
                name: capitalizedName,
                description: "РќРµРёР·РІРµРґР°РЅРЅРѕРµ РјРµСЃС‚Рѕ, СѓРїРѕРјСЏРЅСѓС‚РѕРµ РІ РїСѓС‚Рё.",
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
                addLogMessage(`[РЎРРЎРўР•РњРђ] РџСѓС‚РµС€РµСЃС‚РІРёРµ РІ ${dest.name} РЅР°С‡Р°С‚Рѕ. Р Р°СЃС‡РµС‚РЅРѕРµ РІСЂРµРјСЏ: ${res.total_hours} С‡.`, "system-message");
            }
        }
        this.resume();
        return { success: true };
    },

        tick: async function() {
        if (!player || !player.travel || !player.travel.active || player.travel.paused || this.isProcessing) return;
        this.isProcessing = true;
        this.isGeneratingHour = true;
        updateCharacterSheet(); // РџРѕРєР°Р·С‹РІР°РµРј Р·Р°РіСЂСѓР·РєСѓ

        try {
            // Р–РґРµРј РѕС‚РІРµС‚Р° РѕС‚ РґРІРёР¶РєР°, С‡С‚РѕР±С‹ РЅРµ СЃРїР°РјРёС‚СЊ Р·Р°РїСЂРѕСЃР°РјРё
            await new Promise(resolve => {
                const prev = window.isSimulatingTime;
                window.isSimulatingTime = true; // РџРѕРґР°РІР»СЏРµРј Р±Р»РѕРєРёСЂРѕРІРєСѓ РІРІРѕРґР° РЅР° РІСЂРµРјСЏ С‚РёРєР°
                
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
                        
                        // РЎРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ РїСЂРѕРіСЂРµСЃСЃР° РїСѓС‚Рё РёР· C++
                        if (res.world && res.world.player_trek) {
                            player.travel.active = res.world.player_trek.active;
                            // Р—Р°С‰РёС‚Р° РѕС‚ СЂР°СЃСЃРёРЅС…СЂРѕРЅР°: РµСЃР»Рё РёРіСЂРѕРє РЅР°Р¶Р°Р» РїР°СѓР·Сѓ, РЅРµ РїРµСЂРµР·Р°РїРёСЃС‹РІР°РµРј СЃС‚Р°СЂС‹Рј СЃС‚РµР№С‚РѕРј
                            if (!player.travel.paused || res.world.player_trek.paused) {
                                player.travel.paused = res.world.player_trek.paused;
                            }
                            player.travel.elapsedHours = res.world.player_trek.elapsed_hours;
                            player.travel.totalHours = res.world.player_trek.total_hours;
                            player.travel.currentX = res.world.player_trek.current_x;
                            player.travel.currentY = res.world.player_trek.current_y;
                        }
                        
                        // Р”РІРёРіР°РµРј С‡Р°СЃС‹ UI
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
                    updateCharacterSheet(); // РћР±РЅРѕРІР»СЏРµРј UI РїРѕСЃР»Рµ РїРѕР»СѓС‡РµРЅРёСЏ РґР°РЅРЅС‹С…
                    if (typeof updateHoldingsDisplay === 'function') updateHoldingsDisplay();
                    resolve();
                }).catch(err => {
                    console.error("РћС€РёР±РєР° С‚РёРєР° РїСѓС‚Рё:", err);
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
        addLogMessage(`[РЎРРЎРўР•РњРђ] РџСѓС‚РµС€РµСЃС‚РІРёРµ РїСЂРёРѕСЃС‚Р°РЅРѕРІР»РµРЅРѕ. РџСЂРёС‡РёРЅР°: ${reason}`, "system-message");
    },

        resume: async function() {
        if (!player || !player.travel || !player.travel.active) return;
        player.travel.paused = false;
        player.travel.pauseReason = null;
        player.travel.currentEvents = null; // РћС‡РёС‰Р°РµРј СЃРѕР±С‹С‚РёСЏ РїСЂРё РїСЂРѕРґРѕР»Р¶РµРЅРёРё РїСѓС‚Рё
        player.travel.isFastForwarding = false;
        if (window.electronAPI && window.electronAPI.nexusResumeTrek) await window.electronAPI.nexusResumeTrek();
        if (this.timer) clearInterval(this.timer);
        const interval = requireRuntimeNumber(
            typeof TREK_CONFIG !== 'undefined' ? TREK_CONFIG.tick_interval_ms : NaN,
            'TREK_CONFIG.tick_interval_ms'
        );
        this.timer = setInterval(() => this.tick(), interval);
        updateCharacterSheet();
        addLogMessage(`[РЎРРЎРўР•РњРђ] РџСѓС‚РµС€РµСЃС‚РІРёРµ РІРѕР·РѕР±РЅРѕРІР»РµРЅРѕ.`, "system-message");
    },

    cancel: async function() {
        if (!player || !player.travel || !player.travel.active) return;
        player.travel.active = false;
        player.travel.isFastForwarding = false;
        if (this.timer) clearInterval(this.timer);
        if (window.electronAPI && window.electronAPI.nexusCancelTrek) await window.electronAPI.nexusCancelTrek();
        addLogMessage(`[РЎРРЎРўР•РњРђ] РџСѓС‚РµС€РµСЃС‚РІРёРµ РѕС‚РјРµРЅРµРЅРѕ. Р’С‹ РѕСЃС‚Р°Р»РёСЃСЊ РІ РґРёРєРѕР№ РјРµСЃС‚РЅРѕСЃС‚Рё.`, "system-message");
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
        // РЈСЃРєРѕСЂСЏРµРј РґРѕ 50РјСЃ
        this.timer = setInterval(() => this.tick(), 50);
        addLogMessage(`[РЎРРЎРўР•РњРђ] РџСѓС‚РµС€РµСЃС‚РІРёРµ СѓСЃРєРѕСЂРµРЅРѕ.`, "system-message");
        updateCharacterSheet();
    },

        handleEvents: function(events) {
        if (!events || events.length === 0) return;
        
        let arrivalEvent = events.find(ev => ev.object_type === 'arrival');
        let otherEvents = events.filter(ev => ev.object_type !== 'arrival');

        if (otherEvents.length > 0) {
            // РЎРѕС…СЂР°РЅСЏРµРј СЃРѕР±С‹С‚РёСЏ РґР»СЏ РѕС‚РѕР±СЂР°Р¶РµРЅРёСЏ РІ UI
            player.travel.currentEvents = otherEvents;
            player.travel.paused = true;
            player.travel.pauseReason = "event";
            player.travel.isFastForwarding = false;
            if (this.timer) clearInterval(this.timer);
            
            // Р”СѓР±Р»РёСЂСѓРµРј РІ Р»РѕРі РґР»СЏ РёСЃС‚РѕСЂРёРё
            otherEvents.forEach(ev => {
                // РћР±СЂР°Р±РѕС‚РєР° Р»РѕРєР°Р»РёР·Р°С†РёРё РґР»СЏ Р»РѕРіР°
                let description = '';
                let descObj = ev.description;

                // Р•СЃР»Рё description - СЌС‚Рѕ JSON-СЃС‚СЂРѕРєР°, РїР°СЂСЃРёРј РµС‘
                if (typeof descObj === 'string') {
                    try {
                        const parsed = JSON.parse(descObj);
                        if (typeof parsed === 'object' && parsed !== null) {
                            descObj = parsed;
                        } else {
                            description = descObj;
                        }
                    } catch (e) {
                        // РќРµ JSON, РёСЃРїРѕР»СЊР·СѓРµРј РєР°Рє РµСЃС‚СЊ
                        description = descObj;
                    }
                }

                // Р•СЃР»Рё РµС‰С‘ РЅРµ СѓСЃС‚Р°РЅРѕРІР»РµРЅРѕ Рё СЌС‚Рѕ РѕР±СЉРµРєС‚
                if (!description && typeof descObj === 'object' && descObj !== null) {
                    if (descObj.loc_key) {
                        // РСЃРїРѕР»СЊР·СѓРµРј СЃРёСЃС‚РµРјСѓ Р»РѕРєР°Р»РёР·Р°С†РёРё СЃ РєР»СЋС‡РѕРј Рё Р°СЂРіСѓРјРµРЅС‚Р°РјРё
                        description = t(descObj.loc_key, descObj.loc_args || {});
                    } else if (descObj[currentLanguage]) {
                        description = descObj[currentLanguage] || descObj['ru'] || descObj['en'];
                    } else {
                        description = JSON.stringify(descObj);
                    }
                }

                if (!description) {
                    description = String(ev.description || 'РќРµРёР·РІРµСЃС‚РЅРѕРµ СЃРѕР±С‹С‚РёРµ');
                }

                addLogMessage(`<div style="border-left: 3px solid #f39c12; padding-left: 10px; margin: 5px 0;"><strong style="color:#f39c12;">[РЎРћР‘Р«РўРР• Р’ РџРЈРўР]</strong> ${description}</div>`, "system-message");
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
        
        let prompt = `[SYSTEM: РџРЈРўР•РЁР•РЎРўР’РР• РџР РРћРЎРўРђРќРћР’Р›Р•РќРћ]\nРЎРѕР±С‹С‚РёРµ РІ РїСѓС‚Рё: ${description || objType}\n`;
        if (formattedData) {
            prompt += `Р”Р°РЅРЅС‹Рµ РѕР±СЉРµРєС‚Р° РѕС‚ РґРІРёР¶РєР°: ${formattedData}\n`;
        }
        prompt += `РћРїРёС€Рё СЃС†РµРЅСѓ (РєР°Рє СЌС‚Рѕ РІС‹РіР»СЏРґРёС‚, Р·РІСѓРєРё, Р·Р°РїР°С…Рё) Рё СЃРїСЂРѕСЃРё РёРіСЂРѕРєР°, С‡С‚Рѕ РѕРЅ Р±СѓРґРµС‚ РґРµР»Р°С‚СЊ. Р–РґРё РѕС‚РІРµС‚Р° РёРіСЂРѕРєР°.`;
                sendApiRequest(prompt, false, false, [], false);
    },

    finish: function() {
        if (this.timer) clearInterval(this.timer);
        executeCommand('setLocation', { locationName: player.travel.destinationName });
        addLogMessage(`[РЎРРЎРўР•РњРђ] РџСѓС‚РµС€РµСЃС‚РІРёРµ Р·Р°РІРµСЂС€РµРЅРѕ. Р’С‹ РїСЂРёР±С‹Р»Рё РІ: ${player.travel.destinationName}.`, "system-message");
        player.travel.active = false;
        updateCharacterSheet();
        updateMapDisplay();
        const prompt = `[SYSTEM: РџРЈРўР•РЁР•РЎРўР’РР• Р—РђР’Р•Р РЁР•РќРћ] РРіСЂРѕРє СѓСЃРїРµС€РЅРѕ РїСЂРёР±С‹Р» РІ ${player.travel.destinationName}. РћРїРёС€Рё РїСЂРёР±С‹С‚РёРµ Рё РѕР±СЃС‚Р°РЅРѕРІРєСѓ РІРѕРєСЂСѓРі.`;
        sendApiRequest(prompt, false, false, [], false);
    }
};

// --- РРќРўР•Р“Р РђР¦РРЇ WEB WORKER Р”Р›РЇ РЎРРњРЈР›РЇР¦РР РњРР Рђ ---
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

function parseLocString(str, disableLoc = window.DISABLE_LOCALIZATION) {
    if (typeof str !== 'string') return str;
    let result = str;

    if (!disableLoc && str.includes('"loc_key"')) {
        const processParsed = (data, originalStr) => {
            if (data.loc_args) {
                for (let k in data.loc_args) {
                    let argStr = data.loc_args[k];
                    if (typeof argStr === 'string') {
                        if (typeof ECONOMY_ITEMS !== 'undefined') {
                            Object.keys(ECONOMY_ITEMS).forEach(itemId => {
                                const r = new RegExp('\\b' + itemId + '\\b', 'g');
                                if (r.test(argStr)) {
                                    argStr = argStr.replace(r, getItemName(itemId, player ? player.era : getRuntimeDefaultEraId()));
                                }
                            });
                        }
                        if (typeof FACILITY_NAMES !== 'undefined') {
                            Object.keys(FACILITY_NAMES).forEach(facId => {
                                const r = new RegExp('\\b' + facId + '\\b', 'g');
                                if (r.test(argStr)) {
                                    argStr = argStr.replace(r, getFacilityName(facId, player ? player.era : getRuntimeDefaultEraId()));
                                }
                            });
                        }
                        if (argStr.includes('"loc_key"')) {
                            argStr = parseLocString(argStr, disableLoc);
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

// Р’СЃРїРѕРјРѕРіР°С‚РµР»СЊРЅР°СЏ С„СѓРЅРєС†РёСЏ РґР»СЏ РіРµРЅРµСЂР°С†РёРё РЅРѕРІРѕСЃС‚РµР№ РІ Р›РµС‚РѕРїРёСЃСЊ РњРёСЂР°
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
// Defensive getter for World state вЂ” prevents null reference errors
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

// worldWorker СѓРґР°Р»РµРЅ, РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РЅР°С‚РёРІРЅС‹Р№ C++ Nexus Engine

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
        if (titleEl) titleEl.textContent = 'Р›РµС‚РѕРїРёСЃСЊ РњРёСЂР°';
        const loadingText = document.getElementById('loading-text');
        if (loadingText) loadingText.textContent = `РЎРёРЅС‚РµР· РёСЃС‚РѕСЂРёРё Р·Р° ${yearsToSimulate} Р»РµС‚ (РІС‹С‡РёСЃР»СЏРµС‚СЃСЏ РІ Nexus Engine)...`;

        console.log(`[Nexus] Р—Р°РїСѓСЃРє РїСЂРµ-СЃРёРјСѓР»СЏС†РёРё ${totalTicks} С‚РёРєРѕРІ РІ C++...`);
        const res = await window.electronAPI.nexusPreSimulate(World, totalTicks);
        console.log(`[Nexus] РћС‚РІРµС‚ РїСЂРµ-СЃРёРјСѓР»СЏС†РёРё РїРѕР»СѓС‡РµРЅ:`, res ? `status=${res.status}` : 'null');
        if (res.status === 'ok') {
            if (res.world) setWorld(res.world);
            if (res.relevant_news) World.relevant_news = res.relevant_news;
            if (res.items) res.items.forEach(([k, v]) => ItemRegistry.set(k, v));
            if (res.containers) res.containers.forEach(([k, v]) => setContainer(k, v));
            if (res.deleted_items) res.deleted_items.forEach(id => ItemRegistry.delete(id));
            if (res.deleted_containers) res.deleted_containers.forEach(id => ContainerRegistry.delete(id));
                    processMonsterQuests();
            
            IS_PRE_SIMULATING = false;
            if (loadingText) loadingText.textContent = 'Р“РµРЅРµСЂР°С†РёСЏ РјРёСЂР° Р·Р°РІРµСЂС€РµРЅР°...';
            updateWorldChroniclesDisplay();
            updateTradeJournalDisplay();
            updatePortPanel();
            if (typeof updateHoldingsDisplay === 'function') updateHoldingsDisplay();
            document.dispatchEvent(new Event('PreSimulateComplete'));
            return;
        } else {
            console.error("[Nexus] РћС€РёР±РєР° РїСЂРµ-СЃРёРјСѓР»СЏС†РёРё:", res);
        }
    } else {
        console.error("[Nexus] РќР°С‚РёРІРЅС‹Р№ РґРІРёР¶РѕРє РЅРµРґРѕСЃС‚СѓРїРµРЅ РґР»СЏ РїСЂРµ-СЃРёРјСѓР»СЏС†РёРё!");
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
            // Р’С‹РґР°РµРј РєРІРµСЃС‚ РўРћР›Р¬РљРћ РµСЃР»Рё РјРѕРЅСЃС‚СЂ РЅР°С…РѕРґРёС‚СЃСЏ РІ С‚РµРєСѓС‰РµРј СЂРµРіРёРѕРЅРµ РёРіСЂРѕРєР°
            if (m.region_id === playerRegionId) {
                const questId = "hunt_" + m.id;
                if (!player.quests[questId]) {
                    player.quests[questId] = {
                        id: questId,
                        aiIdentifier: questId,
                        title: "Р’РµР»РёРєР°СЏ РћС…РѕС‚Р°: " + m.name,
                        objective: "РЈРЅРёС‡С‚РѕР¶РёС‚СЊ С‡СѓРґРѕРІРёС‰Рµ РІ СЂРµРіРёРѕРЅРµ " + (World.regions[m.region_id] ? World.regions[m.region_id].name : m.region_id),
                        description: "РњРµСЃС‚РЅС‹Рµ Р¶РёС‚РµР»Рё РІ СѓР¶Р°СЃРµ. Р­РїРёС‡РµСЃРєРѕРµ С‡СѓРґРѕРІРёС‰Рµ С‚РµСЂСЂРѕСЂРёР·РёСЂСѓРµС‚ СЌС‚Рё Р·РµРјР»Рё. РќР°РіСЂР°РґР° Р·Р° РµРіРѕ РіРѕР»РѕРІСѓ Р±СѓРґРµС‚ С‰РµРґСЂРѕР№.",
                        reward: "РЎРѕРєСЂРѕРІРёС‰Р° Р»РѕРіРѕРІР°, РЎР»Р°РІР°",
                        issuer: "РњРµСЃС‚РЅС‹Рµ СЃР»СѓС…Рё",
                        status: 'active'
                    };
                    // Р‘Р»РѕРєРёСЂСѓРµРј СЃРїР°Рј РІ Р»РѕРі РІРѕ РІСЂРµРјСЏ РїСЂРµ-СЃРёРјСѓР»СЏС†РёРё Рё С„РѕРЅРѕРІС‹С… СЂР°СЃС‡РµС‚РѕРІ
                    if (!IS_PRE_SIMULATING && !window.isSimulatingTime) {
                        addLogMessage(`[РђР’РўРћ-РљР’Р•РЎРў] Р”РѕР±Р°РІР»РµРЅРѕ РјРµСЃС‚РЅРѕРµ Р·Р°РґР°РЅРёРµ: Р’РµР»РёРєР°СЏ РћС…РѕС‚Р° РЅР° ${m.name}!`, "system-message");
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
            // Р•СЃР»Рё РјРѕРЅСЃС‚СЂ РјРµСЂС‚РІ РР›Р РІРѕРѕР±С‰Рµ РёСЃС‡РµР· РёР· РјР°СЃСЃРёРІР° (СѓР±РёС‚ Р°СЂРјРёРµР№)
            if (!monster || monster.health <= 0) {
                player.quests[qId].status = 'completed';
                if (!IS_PRE_SIMULATING && !window.isSimulatingTime) {
                    addLogMessage(`[РђР’РўРћ-РљР’Р•РЎРў] Р—Р°РґР°РЅРёРµ РІС‹РїРѕР»РЅРµРЅРѕ: ${player.quests[qId].title}!`, "level-up");
                    questsUpdated = true;
                }
            }
        }
    });

    if (questsUpdated && !IS_PRE_SIMULATING && !window.isSimulatingTime) {
        updateQuestList();
    }
}

// Р¤Р»Р°Рі СЂРµР°Р»С‚Р°Р№Рј-СЂРµР¶РёРјР° РґРІРёР¶РєР°
let _realtimeActive = false;

function updateWorldSimulation(pulses) {
    if (!World) return;
    
    if (window.electronAPI && window.electronAPI.nexusStartRealtime) {
        World.time = World.time || { accumulatedMinutes: 0 };
        World.time.accumulatedMinutes += pulses * 5;
        
        let ticks = Math.floor(World.time.accumulatedMinutes / 60);
        if (ticks > 0) {
            World.time.accumulatedMinutes -= ticks * 60;

            // Р РµР°Р»С‚Р°Р№Рј-СЂРµР¶РёРј: РґРІРёР¶РѕРє СЃРёРјСѓР»РёСЂСѓРµС‚ Рё СЃС‚СЂРёРјРёС‚ РѕР±РЅРѕРІР»РµРЅРёСЏ РјРёСЂР°
            // РєР°Р¶РґС‹Рµ 500РјСЃ (РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ). JS РїРѕР»СѓС‡Р°РµС‚ РјРёСЂ РјРіРЅРѕРІРµРЅРЅРѕ С‡РµСЂРµР· onNexusRealtimeUpdate.
            // Р—Р°РїСѓСЃРєР°РµРј СЂРµР°Р»С‚Р°Р№Рј РµСЃР»Рё РµС‰С‘ РЅРµ Р·Р°РїСѓС‰РµРЅ, Рё РѕС‚РїСЂР°РІР»СЏРµРј С‚РёРєРё.
            const startRealtimeIfNeeded = async () => {
                if (!_realtimeActive) {
                    try {
                        await window.electronAPI.nexusStartRealtime(500);
                        _realtimeActive = true;
                    } catch (e) {
                        console.warn("[Nexus] РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РїСѓСЃС‚РёС‚СЊ СЂРµР°Р»С‚Р°Р№Рј-СЂРµР¶РёРј, fallback РЅР° Р±Р»РѕРєРёСЂСѓСЋС‰РёР№:", e);
                    }
                }
                // РћС‚РїСЂР°РІР»СЏРµРј С‚РёРєРё РґР»СЏ СЃРёРјСѓР»СЏС†РёРё
                window.electronAPI.nexusSimulate(World, ticks, player?.location || "").then(res => {
                    if (res.status === 'ok') {
                        // Р РµР°Р»С‚Р°Р№Рј-РѕР±РЅРѕРІР»РµРЅРёСЏ РїСЂРёС…РѕРґСЏС‚ С‡РµСЂРµР· onNexusRealtimeUpdate,
                        // РЅРѕ С„РёРЅР°Р»СЊРЅС‹Р№ РѕС‚РІРµС‚ С‚РѕР¶Рµ РѕР±СЂР°Р±Р°С‚С‹РІР°РµРј РґР»СЏ trek_events Рё UI
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
                        console.error("[Nexus] РћС€РёР±РєР° СЃРёРјСѓР»СЏС†РёРё:", res);
                    }
                }).catch(err => {
                    console.error("[Nexus] РћС€РёР±РєР° РІС‹Р·РѕРІР° nexusSimulate:", err);
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
        console.error("[Nexus] РќР°С‚РёРІРЅС‹Р№ РґРІРёР¶РѕРє РЅРµРґРѕСЃС‚СѓРїРµРЅ РґР»СЏ СЃРёРјСѓР»СЏС†РёРё РІСЂРµРјРµРЅРё!");
    }
}

// РћСЃС‚Р°РЅРѕРІРєР° СЂРµР°Р»С‚Р°Р№Рј-СЂРµР¶РёРјР° РїСЂРё Р·Р°РІРµСЂС€РµРЅРёРё/РїР°СѓР·Рµ
async function stopRealtimeSimulation() {
    if (_realtimeActive && window.electronAPI && window.electronAPI.nexusStopRealtime) {
        try {
            await window.electronAPI.nexusStopRealtime();
            _realtimeActive = false;
        } catch (e) {
            console.warn("[Nexus] РћС€РёР±РєР° РѕСЃС‚Р°РЅРѕРІРєРё СЂРµР°Р»С‚Р°Р№Рј:", e);
        }
    }
}

async function runWorldSimulationTick() {
    if (isSimulatingWorld) return;
    isSimulatingWorld = true;
    isWaitingForAI = true;
    if (userInput) userInput.disabled = true;
    if (sendButton) sendButton.disabled = true;
    
    addCalculationMessage("[РЎРРЎРўР•РњРђ: РЎРРњРЈР›РЇР¦РРЇ] РњРёСЂ РїСЂРёС…РѕРґРёС‚ РІ РґРІРёР¶РµРЅРёРµ...");
    const loaderDiv = document.createElement('div');
    loaderDiv.id = 'world-sim-loader';
    loaderDiv.className = 'ether-loader-container';
    loaderDiv.innerHTML = `
        <div class="astrolabe" style="filter: hue-rotate(120deg) brightness(0.8);">
            <div class="astrolabe-ring"></div><div class="astrolabe-ring"></div><div class="astrolabe-ring"></div><div class="astrolabe-core"></div>
        </div>
                    <div class="ether-text-container">
                <span class="ether-text-title" style="color: #e74c3c; text-shadow: 0 0 10px #e74c3c;">РџР•Р Р•РЎРўР РћР™РљРђ Р Р•РђР›Р¬РќРћРЎРўР...</span>
                <span class="ether-text-subtitle">Р”РІРёР¶РѕРє РњРёСЂР° Р°РЅР°Р»РёР·РёСЂСѓРµС‚ СЃРѕР±С‹С‚РёСЏ</span>
            </div>
            <button class="ether-cancel-btn" data-action="cancel-api">
                <i class="fas fa-times"></i> РџСЂРµСЂРІР°С‚СЊ СЃРІСЏР·СЊ
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

        let worldSummary = "=== РўР•РљРЈР©Р•Р• РЎРћРЎРўРћРЇРќРР• РњРР Рђ (РЎР«Р Р«Р• Р”РђРќРќР«Р•) ===\n";
        for (let rId in World.regions) {
            let r = World.regions[rId];
            let ownerName = World.factions[r.factionId] ? World.factions[r.factionId].name : "РќРµС‚ РІР»Р°РґРµР»СЊС†Р°";
            
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
            let resStr = resArr.length > 0 ? resArr.slice(0, 6).join(', ') : "РџСѓСЃС‚Рѕ";

            worldSummary += `Р РµРіРёРѕРЅ: ${r.name} (Р’Р»Р°РґРµР»РµС†: ${ownerName}). РќР°СЃРµР»РµРЅРёРµ: ${r.population}. РџРѕРіРѕРґР°: ${r.weather || "РќРѕСЂРјР°Р»СЊРЅР°СЏ"}. Р РµСЃСѓСЂСЃС‹: ${resStr}.\n`;
        }
        
        let activeWars = [];
        for (let fId in World.factions) {
            let f = World.factions[fId];
            // Р—РѕР»РѕС‚Рѕ СЃС‡РёС‚Р°РµРј РёР· С„РёР·РёС‡РµСЃРєРёС… Р·Р°РїР°СЃРѕРІ СЃС‚РѕР»РёС‡РЅРѕРіРѕ СЂРµРіРёРѕРЅР°
            const capitalRegionId = Object.keys(World.regions).find(rid => World.regions[rid].factionId === fId);
            let gold = 0;
            if (capitalRegionId && World.regions[capitalRegionId]?.vault_id) {
                gold = countRealItems(World.regions[capitalRegionId].vault_id, getPrimaryCurrencyPrototypeId('gold'));
            }
            const manpower = availableManpower(f);
            worldSummary += `Р¤СЂР°РєС†РёСЏ: ${f.name}. Р”РѕСЃС‚СѓРїРЅР°СЏ Р¶РёРІР°СЏ СЃРёР»Р°: ${manpower}. Р—РѕР»РѕС‚Рѕ РІ СЃС‚РѕР»РёС†Рµ: ${gold}. РђСЂРјРёР№ РІ РїРѕС…РѕРґРµ РЎР•Р™Р§РђРЎ: ${f.armies.length}.\n`;
            for (let target in f.diplomacy) {
                if (f.diplomacy[target] === "war") activeWars.push(`${f.name} РІРѕСЋРµС‚ СЃ ${World.factions[target].name}`);
            }
        }
        if (activeWars.length > 0) worldSummary += `\nР’РѕР№РЅС‹: ${[...new Set(activeWars)].join(", ")}\n`;

        let recentNews = World.news
            .map(n => ({ ...n, daysOld: Math.max(0, currentDay - (n.day || 0)) }))
            .filter(n => n.daysOld <= daysPassed)
            .filter(n => n.importance >= 2)
            .sort((a, b) => b.daysOld - a.daysOld)
            .map(n => `[${n.daysOld} РґРЅ. РЅР°Р·Р°Рґ, Р›РѕРєР°С†РёСЏ: ${n.location}]: ${parseLocString(n.text)}`)
            .join("\n");
        worldSummary += `\nРҐСЂРѕРЅРѕР»РѕРіРёСЏ СЃРёСЃС‚РµРјРЅС‹С… СЃРѕР±С‹С‚РёР№ Р·Р° СЌС‚РѕС‚ РїРµСЂРёРѕРґ:\n${recentNews || "РќРµС‚ СЃРІРµР¶РёС… РґР°РЅРЅС‹С…"}\n`;

        let mName = "РњРµСЃСЏС†Р°";
        if (window.WORLD_CONFIG && window.WORLD_CONFIG.months && window.WORLD_CONFIG.months[player.gameTime.month - 1]) {
            const m = window.WORLD_CONFIG.months[player.gameTime.month - 1];
            mName = typeof t === 'function' ? t(m.name_i18n_key, null, m.id) : m.id;
        }
        let currentDateStr = `${player.gameTime.day} ${mName}, ${player.gameTime.year} РіРѕРґР°`;
        
        const prompt = `### Р”РР Р•РљРўРР’Рђ: Р”Р’РР–РћРљ РњРР Рђ (WORLD SIMULATOR) v5.0\nРўС‹ вЂ” Р°РЅР°Р»РёС‚РёС‡РµСЃРєРёР№ РјРѕРґСѓР»СЊ. РўРІРѕСЏ Р·Р°РґР°С‡Р°: РЅР°РїРёСЃР°С‚СЊ РёСЃС‚РѕСЂРёС‡РµСЃРєСѓСЋ СЃРІРѕРґРєСѓ ("Р’РµСЃС‚Рё РёР· Р­С„РёСЂР°") РЅР° РѕСЃРЅРѕРІРµ РЎР«Р Р«РҐ Р”РђРќРќР«РҐ.\n\n[РЎРРЎРўР•РњРќРћР• Р’Р Р•РњРЇ]:\n- РўРµРєСѓС‰Р°СЏ РґР°С‚Р°: ${currentDateStr}\n- Р’СЂРµРјРµРЅРё РїСЂРѕС€Р»Рѕ СЃ РїСЂРѕС€Р»РѕР№ СЃРІРѕРґРєРё: СЂРѕРІРЅРѕ ${daysPassed} РґРЅРµР№.\n\n${worldSummary}\n\nРџР РРљРђР—Р« (Р›РћР“РРљРђ Р Р¤РђРљРўР«):\n1. Р’РЅРёРјР°С‚РµР»СЊРЅРѕ РёР·СѓС‡Рё "РҐСЂРѕРЅРѕР»РѕРіРёСЋ СЃРёСЃС‚РµРјРЅС‹С… СЃРѕР±С‹С‚РёР№". РћР±СЂР°С‰Р°Р№ РІРЅРёРјР°РЅРёРµ РЅР° РїРѕРјРµС‚РєСѓ "[X РґРЅ. РЅР°Р·Р°Рґ]". Р•СЃР»Рё РѕСЃР°РґР° РЅР°С‡Р°Р»Р°СЃСЊ 14 РґРЅРµР№ РЅР°Р·Р°Рґ Рё РґР»РёР»Р°СЃСЊ 4 РґРЅСЏ, Р·РЅР°С‡РёС‚ РћРќРђ РЈР–Р• Р—РђР’Р•Р РЁРР›РђРЎР¬. РќРµ СЃРјРµР№ РїРёСЃР°С‚СЊ, С‡С‚Рѕ РіРѕСЂРѕРґ "РїСЂРѕРґРµСЂР¶РёС‚СЃСЏ РµС‰Рµ 4 РґРЅСЏ"!\n2. РЎРІРµСЂСЊСЃСЏ СЃ "РўР•РљРЈР©РРњ РЎРћРЎРўРћРЇРќРР•Рњ РњРР Рђ". Р•СЃР»Рё РІ СЃРїРёСЃРєРµ "РђСЂРјРёР№ РІ РїРѕС…РѕРґРµ РЎР•Р™Р§РђРЎ" Сѓ С„СЂР°РєС†РёРё 0 Р°СЂРјРёР№, Р·РЅР°С‡РёС‚ РІ Р”РђРќРќР«Р™ РњРћРњР•РќРў РѕРЅР° РЅРёРєРѕРіРѕ РЅРµ РѕСЃР°Р¶РґР°РµС‚ Рё РЅРёРєСѓРґР° РЅРµ РёРґРµС‚. Р’СЃРµ РµС‘ РїРѕС…РѕРґС‹ РёР· РҐСЂРѕРЅРѕР»РѕРіРёРё СѓР¶Рµ Р·Р°РІРµСЂС€РµРЅС‹, РѕРїРёСЃС‹РІР°Р№ РёС… РєР°Рє РїСЂРѕС€Р»С‹Рµ СЃРѕР±С‹С‚РёСЏ.\n3. РћРїРёС€Рё СЃРѕР±С‹С‚РёСЏ РІ РїСЂРѕС€РµРґС€РµРј РІСЂРµРјРµРЅРё, РєР°Рє РёСЃС‚РѕСЂРёРє, РїРѕРґРІРѕРґСЏС‰РёР№ РёС‚РѕРіРё Р·Р° ${daysPassed} РґРЅРµР№. РћРїРµСЂРёСЂСѓР№ С‚РѕР»СЊРєРѕ С„Р°РєС‚Р°РјРё РёР· СЃРІРѕРґРєРё, РќР• Р’Р«Р”РЈРњР«Р’РђР™ РґРµР№СЃС‚РІРёСЏ Р°СЂРјРёР№, РµСЃР»Рё РёС… РЅРµС‚ РІ Р»РѕРіР°С….\n4. РќР°С‡РЅРё С‚РµРєСЃС‚ СЃ С‡РµС‚РєРѕРіРѕ РѕР±РѕР·РЅР°С‡РµРЅРёСЏ РїСЂРѕС€РµРґС€РµРіРѕ РІСЂРµРјРµРЅРё (РќР°РїСЂРёРјРµСЂ: "Р—Р° РјРёРЅСѓРІС€РёРµ ${daysPassed} РґРЅРµР№...", "Рљ ${currentDateStr} СЃРёС‚СѓР°С†РёСЏ...").\n5. РўРІРѕР№ РѕС‚РІРµС‚ Р”РћР›Р–Р•Рќ Р‘Р«РўР¬ РЎРўР РћР“Рћ Р’РђР›РР”РќР«Рњ JSON РћР‘РЄР•РљРўРћРњ. РњР°СЃСЃРёРІ actions РѕСЃС‚Р°РІР»СЏР№ РџРЈРЎРўР«Рњ [].\nР¤РѕСЂРјР°С‚:\n{\n  "narrative": "РўРІРѕСЏ С‚РѕС‡РЅР°СЏ Рё Р»РѕРіРёС‡РЅР°СЏ С…СЂРѕРЅРёРєР° СЃРѕР±С‹С‚РёР№...",\n  "actions": []\n}`;
        
        let modelId = localModelId;
        if (currentApiProvider === 'gemini') modelId = geminiModelId;
        else if (currentApiProvider === 'llmost') modelId = llmostModelId;
        else if (currentApiProvider === 'openrouter') modelId = openrouterModelId;
        else if (currentApiProvider === 'deepseek') modelId = deepseekModelId;
        else if (currentApiProvider === 'omniroute') modelId = omnirouteModelId;
        
        const raw = await performAiFetch(prompt, [], modelId, `РђРЅР°Р»РёР· РґР°РЅРЅС‹С… Р·Р° ${daysPassed} РґРЅРµР№.`);
        const res = parseAIResponse(raw);
    if (window.ModAPI) await ModAPI.emit('onAIResponseReceived', {raw, parsed: res, location: player?.location});
        
        if (loaderDiv) loaderDiv.remove();
        
        if (res.ai_reasoning) {
            addCalculationMessage(`[РњР«РЎР›Р РР (РЎРёРјСѓР»СЏС†РёСЏ)]:\n${res.ai_reasoning}`, "calc-info");
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
            "РЎР±РѕР№ Р­С„РёСЂРЅРѕР№ РЎРµС‚Рё",
            "РџСЂРѕРёР·РѕС€РµР» СЃР±РѕР№ РїСЂРё РіРµРЅРµСЂР°С†РёРё Р’РµСЃС‚РµР№ РёР· Р­С„РёСЂР° (РЎРёРјСѓР»СЏС†РёСЏ РњРёСЂР°). РџРѕРІС‚РѕСЂРёС‚СЊ РїРѕРїС‹С‚РєСѓ?"
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

// --- РЎРРЎРўР•РњРђ Р›РћРљРђР›Р¬РќРћР™ РљРђР РўР« (Canvas + Sprite) ---
let TILESET_IMAGE = null;
const SOURCE_TILE_SIZE = 16; // РСЃС…РѕРґРЅС‹Р№ СЂР°Р·РјРµСЂ С‚Р°Р№Р»Р° РІ Kenney 1-bit
const SPACING = 1;           // РћС‚СЃС‚СѓРї РјРµР¶РґСѓ С‚Р°Р№Р»Р°РјРё РІ СЃРїСЂР°Р№С‚-Р»РёСЃС‚Рµ
const RENDER_TILE_SIZE = 48; // Р Р°Р·РјРµСЂ РѕС‚СЂРёСЃРѕРІРєРё РЅР° СЌРєСЂР°РЅРµ
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
                console.log(`[TileSet] Р—Р°РіСЂСѓР¶РµРЅ РјР°РїРїРёРЅРі С‚Р°Р№Р»РѕРІ: ${Object.keys(TILE_SPRITE_MAP).length} С€С‚.`);
            }
        } else {
            console.warn('[TileSet] РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ tileset.json');
        }
    } catch (e) {
        console.error('[TileSet] РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё tileset.json:', e);
    }

    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            TILESET_IMAGE = img;
            console.log('[TileSet] Р—Р°РіСЂСѓР¶РµРЅ СЃРїСЂР°Р№С‚-Р»РёСЃС‚ Kenney 1-Bit');
            resolve(true);
        };
        img.onerror = (err) => {
            console.error('[TileSet] РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё СЃРїСЂР°Р№С‚-Р»РёСЃС‚Р°, РёСЃРїРѕР»СЊР·СѓРµРј fallback CSS', err);
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
            description: 'РћР±РЅРѕРІР»РµРЅРѕ'
        };
        buildLocalMap(args);
        const fullscreenCanvas = document.getElementById('fullscreen-map-canvas');
        if (fullscreenCanvas && fullscreenCanvas.parentElement) {
            renderCanvasMap(currentLocalMapPlots, currentLocalMapSize.width, currentLocalMapSize.height, fullscreenCanvas);
        }
    }
}







// --- РџР•Р Р•РњР•РќРќР«Р• РљРђР РўР« РџР•Р Р•РќР•РЎР•РќР« Р’ Nexus Cartographer ---

// Р“Р»РѕР±Р°Р»СЊРЅС‹Рµ РїРµСЂРµРјРµРЅРЅС‹Рµ РґР»СЏ РЅРѕРІРѕР№ СЃРёСЃС‚РµРјС‹ СЌРєРёРїРёСЂРѕРІРєРё
let bodySlots = []; // Р—Р°РїРѕР»РЅСЏРµС‚СЃСЏ РґРёРЅР°РјРёС‡РµСЃРєРё РёР· window.EQUIPMENT_SLOTS
let equipmentElements = {}; // Р‘СѓРґРµС‚ Р·Р°РїРѕР»РЅРµРЅ РґРёРЅР°РјРёС‡РµСЃРєРё
const inventoryTabsContainer = document.querySelector('.inventory-tabs');

// Р”РѕР±Р°РІРёС‚СЊ Рє РѕСЃС‚Р°Р»СЊРЅС‹Рј РіР»РѕР±Р°Р»СЊРЅС‹Рј РїРµСЂРµРјРµРЅРЅС‹Рј
let currentInventoryFilter = 'all';

// РЎР»РѕРІР°СЂСЊ С‚РёРїРѕРІ РґР»СЏ Р»РѕРєР°Р»СЊРЅРѕР№ РєР°СЂС‚С‹
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

// --- Р”Р•РўР•РљРўРћР  РЎР Р•Р”Р« (Electron РёР»Рё Р‘СЂР°СѓР·РµСЂ) ---
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
// Sanitize HTML content вЂ” strip dangerous tags while preserving safe formatting
function sanitizeHTML(html) {
    if (typeof html !== 'string') return '';
    // Use DOMPurify if available (loaded in index.html), otherwise fallback to basic sanitization
    if (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) {
        return DOMPurify.sanitize(html, { ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'span', 'br', 'p', 'div', 'ul', 'ol', 'li', 'a'], ALLOWED_ATTR: ['class', 'href', 'style', 'title'] });
    }
    // Fallback: basic regex sanitization (less secure than DOMPurify)
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
        .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
        .replace(/<embed\b[^>]*>/gi, '')
        .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
        .replace(/on\w+\s*=\s*'[^']*'/gi, '')
        .replace(/on\w+\s*=\s*[^\s>]+/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/<svg\b[^>]*>/gi, '')
        .replace(/<img\b[^>]*onerror\b[^>]*>/gi, '');
}

// --- РЈРќРР’Р•Р РЎРђР›Р¬РќР«Р™ РљР РђРЎРР’Р«Р™ РўРЈР›РўРРџ ---
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

let worldLore = "Р—Р°РіСЂСѓР·РєР° Р»РѕСЂР°...";
let globalLocations = {};
let skillsReferenceData = "Р—Р°РіСЂСѓР·РєР° СЃРїСЂР°РІРѕС‡РЅРёРєР° СѓРјРµРЅРёР№...";
let environmentCommandsGuideData = "Р—Р°РіСЂСѓР·РєР° СЂСѓРєРѕРІРѕРґСЃС‚РІР° РїРѕ РєРѕРјР°РЅРґР°Рј РѕРєСЂСѓР¶РµРЅРёСЏ...";

let activeEraSpecialLore = "";

async function loadActiveEraLore(eraId) {
// РљСЌС€ РґР»СЏ РїРµСЂРµРјРµРЅРЅС‹С… РїСЂРѕРјРїС‚Р°, С‡С‚РѕР±С‹ РЅРµ РїРѕРґРіСЂСѓР¶Р°С‚СЊ РєР°Р¶РґС‹Р№ СЂР°Р·
let promptVariablesCache = {};
    if (!eraId) return;

    if (window.ModAPI && window.ModAPI.isTotalConversion) {
        console.log(`[Total Conversion] РџСЂРѕРїСѓСЃРє Р·Р°РіСЂСѓР·РєРё РІР°РЅРёР»СЊРЅРѕРіРѕ Р»РѕСЂР° СЌРїРѕС…Рё ${eraId}.`);
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
        
        // --- РРќРўР•Р“Р РђР¦РРЇ РњРћР”РћР’ (Р­РџРћРҐРђ) ---
        if (window.ModAPI) {
            const hookData = { lore: activeEraSpecialLore };
            await window.ModAPI.emit('onEraLoreLoad', hookData, eraId);
            activeEraSpecialLore = hookData.lore;
        }
        // ------------------------------
        
        console.log(`[Context] Р‘Р°Р·Р° РґР°РЅРЅС‹С… СЌРїРѕС…Рё ${eraId} РёРЅС‚РµРіСЂРёСЂРѕРІР°РЅР°.`);
    } catch (e) {
        console.error("[Context] РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё РґР°РЅРЅС‹С… СЌРїРѕС…Рё:", e);
        activeEraSpecialLore = "// Р”РѕРїРѕР»РЅРёС‚РµР»СЊРЅС‹Рµ РґР°РЅРЅС‹Рµ РїРѕ СЌРїРѕС…Рµ РЅРµРґРѕСЃС‚СѓРїРЅС‹.";
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
// Defensive getter for player state вЂ” prevents null reference errors
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
let nextInternalQuestId = 1; // <--- РќРћР’Р«Р™ РЎР§Р•РўР§РРљ

// РќР°СЃС‚СЂРѕР№РєРё СЌСЂРѕС‚РёС‡РµСЃРєРѕРіРѕ РєРѕРЅС‚РµРЅС‚Р°
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
    const names = ['РЎС‚СЂР°РЅРЅРёРє', 'РќР°РµРјРЅРёРє', 'РСЃРєР°С‚РµР»СЊ', 'РўРµРЅСЊ', 'Р’РµСЃС‚РЅРёРє', 'Р‘СЂРѕРґСЏРіР°'];

    charRaceSelect.value = defaultRace;
    charClassSelect.value = defaultClass;
    charEraSelect.value = defaultEra;
    const genderSelect = document.getElementById('char-gender-select');
    if (genderSelect) genderSelect.value = Math.random() > 0.5 ? 'male' : 'female';

    handleRaceOrClassChange();

    charNameInput.value = names[Math.floor(Math.random() * names.length)] + " " + (Math.floor(Math.random() * Math.max(1, requireRuntimeNumber(quickStart.name_suffix_range, 'gameplay_runtime.character_creation.quick_start.name_suffix_range'))) + requireRuntimeNumber(quickStart.name_suffix_min, 'gameplay_runtime.character_creation.quick_start.name_suffix_min'));
    charDescInput.value = "РђРІР°РЅС‚СЋСЂРёСЃС‚, РїСЂРёР±С‹РІС€РёР№ РёР· СЃС‚Р°СЂРѕР№ РґРµСЂРµРІРЅРё РЅР° СЃРµРІРµСЂРµ.";

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

let currentAudio = null; // Р”Р»СЏ СѓРїСЂР°РІР»РµРЅРёСЏ РІРѕСЃРїСЂРѕРёР·РІРµРґРµРЅРёРµРј РѕС„С„Р»Р°Р№РЅ TTS

function openSettingsFromGame() {
    console.log("РћС‚РєСЂС‹С‚РёРµ РЅР°СЃС‚СЂРѕРµРє РёР· РёРіСЂРѕРІРѕРіРѕ РјРµРЅСЋ.");
    closeInGameMenu();
    settingsReturnScreen = 'game-interface'; // Р—Р°РїРѕРјРёРЅР°РµРј, С‡С‚Рѕ РјС‹ РїСЂРёС€Р»Рё РёР· РёРіСЂС‹
    setActiveScreen('settings-menu');
}

// Р¤СѓРЅРєС†РёСЏ РґР»СЏ РІС‹Р·РѕРІР° РѕРєРЅР° РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ
function showCustomConfirm(message, onYesCallback) {
    const modal = document.getElementById('custom-confirm-modal');
    const msgEl = document.getElementById('custom-confirm-message');
    const yesBtn = document.getElementById('confirm-yes-btn');
    const noBtn = document.getElementById('confirm-no-btn');

    if (!modal) return;

    msgEl.textContent = message;
    modal.style.display = 'flex';

    // РђРЅРёРјР°С†РёСЏ
    requestAnimationFrame(() => {
        modal.classList.add('visible');
    });

    // РћС‡РёСЃС‚РєР° СЃРѕР±С‹С‚РёР№ РїРµСЂРµРґ РЅР°Р·РЅР°С‡РµРЅРёРµРј РЅРѕРІС‹С… (С‡С‚РѕР±С‹ РЅРµ СЃС‚Р°РєР°Р»РёСЃСЊ)
    const closeModal = () => {
        modal.classList.remove('visible');
        setTimeout(() => modal.style.display = 'none', 300);
        yesBtn.onclick = null;
        noBtn.onclick = null;

        // Р¤РРљРЎ Р¤РћРљРЈРЎРђ: Р’РѕР·РІСЂР°С‰Р°РµРј С„РѕРєСѓСЃ РЅР° body РїРѕСЃР»Рµ Р·Р°РєСЂС‹С‚РёСЏ
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
 * РћР±РЅРѕРІР»СЏРµС‚ РїР°РЅРµР»СЊ Р·Р°РјРµС‚РѕРє GM.
 * РџР°РЅРµР»СЊ РІРёРґРЅР° С‚РѕР»СЊРєРѕ РµСЃР»Рё DEBUG_MODE === true.
 */
function updateEchoMemoryDisplay() {
    const listEl = document.getElementById('echo-memory-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!player || !player.echoMemory || !player.echoMemory.items || player.echoMemory.items.length === 0) {
        listEl.innerHTML = `<li data-i18n="gameInterface.echoMemoryPanel.empty">${t('gameInterface.echoMemoryPanel.empty', 'РќРµС‚ Р°РєС‚РёРІРЅС‹С… С„Р°РєС‚РѕРІ')}</li>`;
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
            <button class="echo-delete-btn" data-index="${idx}" title="РЈРґР°Р»РёС‚СЊ">вњ–</button>
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
            showCustomConfirm(t('gameInterface.echoMemoryPanel.confirmClear', 'РћС‡РёСЃС‚РёС‚СЊ РІСЃСЋ СЌС…Рѕ-РїР°РјСЏС‚СЊ?'), () => {
                executeCommand('clearEchoMemory', { confirm: true });
            });
        };
    }
}

function updateGmNotesDisplay() {

// --- РРЎРџР РђР’Р›Р•РќРќРђРЇ Р¤РЈРќРљР¦РРЇ Р“Р•РќР•Р РђР¦РР РР—РћР‘Р РђР–Р•РќРР™ --- 




    if (!gmNotesPanel || !gmNotesContent) return;
    if (DEBUG_MODE && player) {
        gmNotesPanel.style.display = 'flex';
        let displayHtml = '<strong>РђРљРўРР’РќРђРЇ РџРђРњРЇРўР¬:</strong>\n';
        for (const [key, value] of Object.entries(player.gmNotes || {})) {
            displayHtml += `<span style="color:#5dade2">[${key}]</span>: ${value}\n`;
        }
        displayHtml += '\n<strong>РђР РҐРР’Р« (РЎРІРѕРґРєР°):</strong>\n';
        for (const [key, summary] of Object.entries(player.archiveSummaries || {})) {
            displayHtml += `<span style="color:#f39c12">[${key}]</span>: ${summary}\n`;
        }
        gmNotesContent.innerHTML = sanitizeHTML(displayHtml) || t('gameInterface.gmNotesPanel.empty', 'Р—Р°РјРµС‚РѕРє РїРѕРєР° РЅРµС‚.');
    } else {
        gmNotesPanel.style.display = 'none';
    }
}

// --- Р¤СѓРЅРєС†РёРё РЈРїСЂР°РІР»РµРЅРёСЏ Р Р°СЃСЃРєР°Р·С‡РёРєР°РјРё (РќРћР’РћР•) ---

async function loadNarrators() {
    try {
        if (typeof window.ensureRuntimeDataLoaded === 'function') {
            await window.ensureRuntimeDataLoaded();
        }
        narrators = Array.isArray(window.NARRATORS_DATA) ? window.NARRATORS_DATA : [];
        if (narrators.length === 0) throw new Error('Narrators registry is empty');
        console.log("Р Р°СЃСЃРєР°Р·С‡РёРєРё Р·Р°РіСЂСѓР¶РµРЅС‹:", narrators);
    } catch (error) {
        console.error("РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё СЂР°СЃСЃРєР°Р·С‡РёРєРѕРІ:", error);
        // Fallback, РµСЃР»Рё С„Р°Р№Р» РЅРµ РЅР°Р№РґРµРЅ
        narrators = [{
            id: "classic",
            name: "РљР»Р°СЃСЃРёС‡РµСЃРєРёР№ Р Р°СЃСЃРєР°Р·С‡РёРє",
            description: "РџСЂРѕРёР·РѕС€Р»Р° РѕС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё. Р”РѕСЃС‚СѓРїРµРЅ С‚РѕР»СЊРєРѕ РєР»Р°СЃСЃРёС‡РµСЃРєРёР№ СЂРµР¶РёРј.",
            image: "assets/narrators/classic.jpg",
            promptFile: "assets/narrators/style_classic.txt"
        }];
    }
}

function showNarrator(index) {
    if (!narrators || narrators.length === 0) return;
    currentNarratorIndex = (index + narrators.length) % narrators.length;
    const narrator = narrators[currentNarratorIndex];

    // РќР°С…РѕРґРёРј РєР°СЂС‚РѕС‡РєСѓ РїРѕ ID, РєРѕС‚РѕСЂС‹Р№ РјС‹ РґРѕР±Р°РІРёР»Рё РІ HTML
    // const narratorCard = document.getElementById('narrator-card'); // РЈР¶Рµ РѕР±СЉСЏРІР»РµРЅР° РіР»РѕР±Р°Р»СЊРЅРѕ

    if (narratorCard) {
        // РњРµРЅСЏРµРј С„РѕРЅРѕРІРѕРµ РёР·РѕР±СЂР°Р¶РµРЅРёРµ РєР°СЂС‚РѕС‡РєРё
        narratorCard.style.backgroundImage = `url('${narrator.image}')`;
    } else {
        console.error("Р­Р»РµРјРµРЅС‚ narrator-card РЅРµ РЅР°Р№РґРµРЅ!");
    }

    // РћР±РЅРѕРІР»СЏРµРј С‚РµРєСЃС‚ РєР°Рє Рё СЂР°РЅСЊС€Рµ
    narratorName.textContent = t(`narrators.${narrator.id}.name`, null, narrator.name);
    narratorDesc.textContent = t(`narrators.${narrator.id}.desc`, null, narrator.description);
}

// --- Р¤СѓРЅРєС†РёРё РЈРїСЂР°РІР»РµРЅРёСЏ Р­РєСЂР°РЅРѕРј Р—Р°РіСЂСѓР·РєРё (РќРћР’РћР•) ---

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
    charRaceSelect.innerHTML = `<option value="" disabled ${!currentValue ? 'selected' : ''} data-i18n="characterCreation.racePlaceholder">${typeof t === 'function' ? t('characterCreation.racePlaceholder') : '-- Р’С‹Р±РµСЂРёС‚Рµ СЂР°СЃСѓ --'}</option>`;
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
    charClassSelect.innerHTML = `<option value="" disabled ${!currentValue ? 'selected' : ''} data-i18n="characterCreation.classPlaceholder">${typeof t === 'function' ? t('characterCreation.classPlaceholder') : '-- Р’С‹Р±РµСЂРёС‚Рµ РєР»Р°СЃСЃ --'}</option>`;
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

    // РќР°С…РѕРґРёРј РІС‹Р±СЂР°РЅРЅС‹Р№ СЌР»РµРјРµРЅС‚ <option>
    const selectedOption = charEraSelect.options[charEraSelect.selectedIndex];
    if (!selectedOption) {
        eraDescriptionBox.classList.remove('visible');
        eraDescriptionBox.innerHTML = '';
        return;
    }

    // РџРѕР»СѓС‡Р°РµРј РєР»СЋС‡ РґР»СЏ С‚РµРєСЃС‚Р° РЅР°РїСЂСЏРјСѓСЋ РёР· data-Р°С‚СЂРёР±СѓС‚Р°
    const descriptionKey = selectedOption.dataset.descriptionKey;
    const descriptionText = t(descriptionKey, null, '');

    // РџСЂСЏС‡РµРј Р±Р»РѕРє, С‡С‚РѕР±С‹ СЃРјРµРЅРёС‚СЊ С‚РµРєСЃС‚ Рё Р·Р°РїСѓСЃС‚РёС‚СЊ Р°РЅРёРјР°С†РёСЋ Р·Р°РЅРѕРІРѕ
    eraDescriptionBox.classList.remove('visible');

    setTimeout(() => {
        if (descriptionText) {
            eraDescriptionBox.innerHTML = sanitizeHTML(descriptionText);
            eraDescriptionBox.classList.add('visible');
        } else {
            eraDescriptionBox.innerHTML = '';
        }
    }, 200); // РќРµР±РѕР»СЊС€Р°СЏ Р·Р°РґРµСЂР¶РєР° РґР»СЏ РїР»Р°РІРЅРѕР№ Р°РЅРёРјР°С†РёРё
}

// --- Р¤СѓРЅРєС†РёРё File System Access API ---



// 1. РљРѕРЅС„РёРіСѓСЂР°С†РёСЏ РєРЅРѕРїРѕРє (РўРёРїС‹ Р±СЂРѕСЃРєРѕРІ)
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

// 2. РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ РїР°РЅРµР»Рё РєРЅРѕРїРѕРє (Р’С‹Р·С‹РІР°РµС‚СЃСЏ РїСЂРё СЃС‚Р°СЂС‚Рµ РёРіСЂС‹)
function initQuickTags() {
    const container = document.getElementById('quick-tags-bar');
    if (!container) return;

    container.innerHTML = ''; // РћС‡РёСЃС‚РєР° РїРµСЂРµРґ СЃРѕР·РґР°РЅРёРµРј

    quickTags.forEach(tag => {
        const btn = document.createElement('div');
        btn.className = `tag-chip ${tag.type}`;
        btn.textContent = tag.label;

        // РџСЂРё РєР»РёРєРµ СЃРѕР·РґР°РµРј РЅРµ С‚РµРєСЃС‚, Р° РІРёР·СѓР°Р»СЊРЅСѓСЋ РїР»Р°С€РєСѓ
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

// 3. РЎРѕР·РґР°РЅРёРµ РїР»Р°С€РєРё СЃ СЂРµР·СѓР»СЊС‚Р°С‚РѕРј (РњР°С‚РµРјР°С‚РёРєР° РїСЂРѕРёСЃС…РѕРґРёС‚ Р·РґРµСЃСЊ)
function createRollBadge(statKey, labelText) {
    if (!player) return;

    const container = document.getElementById('active-rolls-container');
    if (!container) return;

    if (container.children.length >= 5) return;

    // --- РђРќРўРР§РРў: Р—РђРџРћРњРРќРђРќРР• Р‘Р РћРЎРљРђ ---
    // Р•СЃР»Рё РёРіСЂРѕРє СѓР¶Рµ Р±СЂРѕСЃР°Р» СЌС‚РѕС‚ РєСѓР±РёРє РІ СЌС‚РѕРј С…РѕРґСѓ, Р±РµСЂРµРј СЃС‚Р°СЂРѕРµ Р·РЅР°С‡РµРЅРёРµ.
    // Р­С‚Рѕ РЅРµ РґР°РµС‚ "РїРµСЂРµР±СЂР°СЃС‹РІР°С‚СЊ" РєСѓР±РёРє, СѓРґР°Р»СЏСЏ РїР»Р°С€РєСѓ.
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

    // РџСЂРѕРІРµСЂСЏРµРј, РЅРµС‚ Р»Рё СѓР¶Рµ С‚Р°РєРѕР№ РїР»Р°С€РєРё РІРёР·СѓР°Р»СЊРЅРѕ, С‡С‚РѕР±С‹ РЅРµ РґСѓР±Р»РёСЂРѕРІР°С‚СЊ
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
    badge.dataset.statKey = statKey; // Р”Р»СЏ РїСЂРѕРІРµСЂРєРё РґСѓР±Р»РёРєР°С‚РѕРІ

    if (roll === 20) badge.classList.add('crit-success');
    if (roll === 1) badge.classList.add('crit-fail');

    badge.dataset.resultText = resultText;

    // РўРµРїРµСЂСЊ РёРіСЂРѕРє РІРёРґРёС‚ РёС‚РѕРіРѕРІСѓСЋ СЃСѓРјРјСѓ Рё РёР· С‡РµРіРѕ РѕРЅР° СЃРѕСЃС‚РѕРёС‚
    const modDisplay = modifier !== 0 ? ` <small style="opacity:0.7; font-size:0.85em;">(${roll}${sign}${modifier})</small>` : ` <small style="opacity:0.7; font-size:0.85em;">(${roll})</small>`;
    badge.innerHTML = `
        <span>${cleanLabel}: ${total}${modDisplay}</span>
        <span class="roll-badge-close" title="РЈРґР°Р»РёС‚СЊ Р±СЂРѕСЃРѕРє">вњ–</span>
    `;

    badge.querySelector('.roll-badge-close').addEventListener('click', () => {
        badge.remove();
    });

    container.appendChild(badge);
    return true;
}


// 4. РџР°СЂСЃРµСЂ С‚РµРіРѕРІ (РїСЂРµРІСЂР°С‰Р°РµС‚ {d20_str} РІ СЂРµР·СѓР»СЊС‚Р°С‚ Р±СЂРѕСЃРєР°)
function parseInlineRolls(text) {
    if (!player) return text;

    // Р РµРіСѓР»СЏСЂРєР° РёС‰РµС‚ РІСЃС‘ РІ С„РёРіСѓСЂРЅС‹С… СЃРєРѕР±РєР°С…
    return text.replace(/\{(.*?)\}/g, (match, content) => {
        const tag = content.toLowerCase().trim();

        // Р•СЃР»Рё СЌС‚Рѕ РєРѕРјР°РЅРґР° Р±СЂРѕСЃРєР° (РЅР°С‡РёРЅР°РµС‚СЃСЏ СЃ d20_) РёР»Рё РїСЂРѕСЃС‚Рѕ d20
        if (tag.startsWith('d20')) {
            let roll = rollRuntimeD20();
            let modifier = 0;
            let label = "D20";

            // Р•СЃР»Рё СЌС‚Рѕ СЃРїРµС†РёС„РёС‡РЅС‹Р№ Р±СЂРѕСЃРѕРє (РЅР°РїСЂРёРјРµСЂ d20_str)
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
                        // РђРІС‚Рѕ-РІС‹Р±РѕСЂ СЃС‚Р°С‚Р° РґР»СЏ Р°С‚Р°РєРё
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

            // Р¤РѕСЂРјР°С‚ РІС‹РІРѕРґР°: [рџЋІ STR Check: 15 (roll:12+3)]
            return `[рџЋІ ${label}: ${total} (roll:${roll}${sign}${modifier})]`;
        }

        // Р•СЃР»Рё С‚РµРі РЅРµ СЂР°СЃРїРѕР·РЅР°РЅ, РІРѕР·РІСЂР°С‰Р°РµРј РєР°Рє РµСЃС‚СЊ
        return match;
    });
}



/**
 * РЈРќРР’Р•Р РЎРђР›Р¬РќР«Р™ Р РџРћР›РќР«Р™ РЎР›Р•РџРћРљ Р”РђРќРќР«РҐ (SNAPSHOT)
 * Р—РґРµСЃСЊ СЃРѕР±СЂР°РЅС‹ Р’РЎР• РґР°РЅРЅС‹Рµ РѕР±СЉРµРєС‚Р° player Р±РµР· РёСЃРєР»СЋС‡РµРЅРёР№.
 */
/**
 * РћР‘Р›Р•Р“Р§Р•РќРќР«Р™ РЎР›Р•РџРћРљ Р”Р›РЇ РђР’РўРћ-РўР•РЎРўР•Р Рђ
 * РЎРѕРґРµСЂР¶РёС‚ С‚РѕР»СЊРєРѕ С‚Рѕ, С‡С‚Рѕ РІРёРґРёС‚ СЃР°Рј РёРіСЂРѕРє, С‡С‚РѕР±С‹ РЅРµ РїРµСЂРµРіСЂСѓР¶Р°С‚СЊ РєРѕРЅС‚РµРєСЃС‚ Р»РѕРєР°Р»СЊРЅС‹С… РјРѕРґРµР»РµР№.
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
    if (!player) return "РљР РРўРР§Р•РЎРљРђРЇ РћРЁРР‘РљРђ: Р”РђРќРќР«Р• РР“Р РћРљРђ РћРўРЎРЈРўРЎРўР’РЈР®Рў";

    const inHands = player.equipment.right_hand ? player.equipment.right_hand.name : 'РќРёС‡РµРіРѕ';
    
            let worldContextString = "";
        
        const allMapPoints = [
            ...Object.keys(globalLocations || {}).map(k => ({ ...globalLocations[k], id: k })),
            ...Object.values(player.mapMarkers || {})
        ].filter(p => p && p.name);
        const mapCoordsString = allMapPoints.map(p => `${p.name} [ID: ${p.id}]`).join('; ');
        worldContextString += `\n=== РљРђР РўРђ РњРР Рђ (Р”РћРЎРўРЈРџРќР«Р• Р›РћРљРђР¦РР Р РРҐ ID) ===\n${mapCoordsString}\n==================================================\n`;

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

        let recentNewsStr = "РќРµС‚ СЃРІРµР¶РёС… РЅРѕРІРѕСЃС‚РµР№.";
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
        worldContextString += "\n=== Р­РџРР§Р•РЎРљРР• Р§РЈР”РћР’РР©Рђ Р’ РњРР Р• (Р“Р›РћР‘РђР›Р¬РќРђРЇ РЈР“Р РћР—Рђ) ===\n";
        World.monsters.forEach(m => {
            if (m.health > 0) {
                worldContextString += `вЂў ${m.name} (РўРёРї: ${m.type}, РЈСЂ: ${m.level}, HP: ${m.health}/${m.maxHealth}, РђС‚Р°РєР°: ${m.attack}, Р—Р°С‰РёС‚Р°: ${m.defense}). Р›РѕРєР°С†РёСЏ: ${m.region_id}. Р›РѕРіРѕРІРѕ: РєРѕРЅС‚РµР№РЅРµСЂ ${m.treasure_chest_id}.\n`;
            }
        });
        worldContextString += "Р“Рњ РРќРЎРўР РЈРљР¦РРЇ: Р•СЃР»Рё РёРіСЂРѕРє РІСЃС‚СѓРїР°РµС‚ РІ Р±РѕР№ СЃ С‡СѓРґРѕРІРёС‰РµРј, РёСЃРїРѕР»СЊР·СѓР№ РєРѕРјР°РЅРґСѓ `addEnvironment` СЃ СЌС‚РёРјРё СЃС‚Р°С‚Р°РјРё. РџСЂРё РµРіРѕ СЃРјРµСЂС‚Рё РћР‘РЇР—РђРўР•Р›Р¬РќРћ РІС‹Р·РѕРІРё РєРѕРјР°РЅРґСѓ `killMonster` СЃ Р°СЂРіСѓРјРµРЅС‚РѕРј `monsterId`, С‡С‚РѕР±С‹ СѓРґР°Р»РёС‚СЊ РµРіРѕ СЃ РіР»РѕР±Р°Р»СЊРЅРѕР№ РєР°СЂС‚С‹.\n==================================================\n";
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
    // Р”Р»СЏ РІРµР±Р° РІРѕР·РІСЂР°С‰Р°РµРј false (РёР»Рё СЃС‚Р°СЂСѓСЋ Р»РѕРіРёРєСѓ, РµСЃР»Рё РѕРЅР° С‚Р°Рј РѕСЃС‚Р°Р»Р°СЃСЊ)
    return false;
}





function updateReputationModal() {
    if (!player || !reputationModal) return;
    const modalTitle = document.querySelector('#reputation-modal h4');
    if (modalTitle) modalTitle.textContent = t('gameInterface.reputationModal.title', null, 'Р РµРїСѓС‚Р°С†РёСЏ');

    const reputations = player.stats.reputation;
    const contentDiv = document.getElementById('reputation-modal-content');
    if (!contentDiv) return;

    contentDiv.innerHTML = ''; // РћС‡РёС‰Р°РµРј СЃС‚Р°СЂРѕРµ СЃРѕРґРµСЂР¶РёРјРѕРµ
    let htmlContent = '';

    const factionKeys = Object.keys(reputations).sort((a, b) => {
        if (a === 'global') return -1; // global РІСЃРµРіРґР° РїРµСЂРІР°СЏ
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
    const yOffset = -10; // РџРѕСЏРІР»СЏРµС‚СЃСЏ С‡СѓС‚СЊ РІС‹С€Рµ РєСѓСЂСЃРѕСЂР°

    let newX = event.clientX + xOffset;
    let newY = event.clientY + yOffset;

    const modalRect = reputationModal.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // РџСЂРµРґРѕС‚РІСЂР°С‰Р°РµРј РІС‹С…РѕРґ Р·Р° РїСЂР°РІС‹Р№ РєСЂР°Р№ СЌРєСЂР°РЅР°
    if (newX + modalRect.width > viewportWidth - 10) {
        newX = event.clientX - modalRect.width - xOffset;
    }
    // РџСЂРµРґРѕС‚РІСЂР°С‰Р°РµРј РІС‹С…РѕРґ Р·Р° РЅРёР¶РЅРёР№ РєСЂР°Р№, СЃРґРІРёРіР°СЏ РІРІРµСЂС…
    if (newY + modalRect.height > viewportHeight - 10) {
        newY = viewportHeight - modalRect.height - 10;
    }
    // РџСЂРµРґРѕС‚РІСЂР°С‰Р°РµРј РІС‹С…РѕРґ Р·Р° Р»РµРІС‹Р№ Рё РІРµСЂС…РЅРёР№ РєСЂР°СЏ
    if (newX < 10) newX = 10;
    if (newY < 10) newY = 10;

    reputationModal.style.left = `${newX}px`;
    reputationModal.style.top = `${newY}px`;
}

function pruneGameLog() {
    const MAX_LOG_MESSAGES = 100; // РҐСЂР°РЅРёРј РІ DOM С‚РѕР»СЊРєРѕ РїРѕСЃР»РµРґРЅРёРµ 100 СЃРѕРѕР±С‰РµРЅРёР№
    if (gameLog && gameLog.children.length > MAX_LOG_MESSAGES) {
        // РЈРґР°Р»СЏРµРј СЃС‚Р°СЂС‹Рµ СЃРѕРѕР±С‰РµРЅРёСЏ, РїРѕРєР° РёС… РЅРµ РѕСЃС‚Р°РЅРµС‚СЃСЏ РЅСѓР¶РЅРѕРµ РєРѕР»РёС‡РµСЃС‚РІРѕ
        while (gameLog.children.length > MAX_LOG_MESSAGES) {
            gameLog.removeChild(gameLog.firstChild);
        }
    }
}










// --- Р¤СѓРЅРєС†РёРё РґР»СЏ localStorage (Fallback) ---




// --- РћС‚РѕР±СЂР°Р¶РµРЅРёРµ СЃРѕС…СЂР°РЅРµРЅРЅРѕР№ РёСЃС‚РѕСЂРёРё С‡Р°С‚Р° ---
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



// --- РќРћР’РђРЇ РЎРРЎРўР•РњРђ РћР‘Р РђР‘РћРўРљР РЎРўРђРўРЈРЎ-Р­Р¤Р¤Р•РљРўРћР’ ---

/**
 * Р“Р»Р°РІРЅР°СЏ С„СѓРЅРєС†РёСЏ, РѕР±СЂР°Р±Р°С‚С‹РІР°СЋС‰Р°СЏ РІСЃРµ Р°РєС‚РёРІРЅС‹Рµ СЃС‚Р°С‚СѓСЃ-СЌС„С„РµРєС‚С‹ РґР»СЏ СЃСѓС‰РЅРѕСЃС‚Рё (РёРіСЂРѕРєР°).
 * Р’С‹Р·С‹РІР°РµС‚СЃСЏ РІ РЅР°С‡Р°Р»Рµ РєР°Р¶РґРѕРіРѕ С…РѕРґР°.
 * @returns {Array<string>} РњР°СЃСЃРёРІ СЃРѕРѕР±С‰РµРЅРёР№ РґР»СЏ РёРіСЂРѕРІРѕРіРѕ Р»РѕРіР°.
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

        // --- РќРћР’РђРЇ Р›РћР“РРљРђ РџР РћР’Р•Р РљР Р”Р›РРўР•Р›Р¬РќРћРЎРўР ---
        // РЎРЅР°С‡Р°Р»Р° РїСЂРѕРІРµСЂСЏРµРј, РЅРµ РёСЃС‚РµРє Р»Рё СЌС„С„РµРєС‚ РІ РќРђР§РђР›Р• СЌС‚РѕРіРѕ С…РѕРґР°.
        if (effect.duration <= 0) {
            effectsToRemove.push(effectId);
            expiredEffectNames.push(effect.name);
            continue; // РџРµСЂРµС…РѕРґРёРј Рє СЃР»РµРґСѓСЋС‰РµРјСѓ СЌС„С„РµРєС‚Сѓ, РЅРµ РѕР±СЂР°Р±Р°С‚С‹РІР°СЏ РµРіРѕ С‚СЂРёРіРіРµСЂС‹ РІ СЌС‚РѕРј С…РѕРґСѓ
        }

        // 1. РћР±СЂР°Р±РѕС‚РєР° С‚СЂРёРіРіРµСЂРѕРІ РґР»СЏ РђРљРўРР’РќР«РҐ СЌС„С„РµРєС‚РѕРІ
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

        // 2. РЈРјРµРЅСЊС€РµРЅРёРµ РґР»РёС‚РµР»СЊРЅРѕСЃС‚Рё Р’ РљРћРќР¦Р• РѕР±СЂР°Р±РѕС‚РєРё С…РѕРґР°.
        // РўРµРїРµСЂСЊ СЌС„С„РµРєС‚ СЃ duration: 1 Р±СѓРґРµС‚ РґРµР№СЃС‚РІРѕРІР°С‚СЊ СЌС‚РѕС‚ С…РѕРґ Рё РёСЃС‚РµС‡РµС‚ Рє РЅР°С‡Р°Р»Сѓ СЃР»РµРґСѓСЋС‰РµРіРѕ.
        effect.duration--;
    }

    // 4. РЈРґР°Р»РµРЅРёРµ РёСЃС‚РµРєС€РёС… СЌС„С„РµРєС‚РѕРІ Рё Р·Р°РїСѓСЃРє РёС… on_remove РґРµР№СЃС‚РІРёР№
    if (effectsToRemove.length > 0) {
        effectsToRemove.forEach(idToRemove => {
            const removedEffect = player.statusEffects[idToRemove];
            if (removedEffect) {
                let specificActionOccurred = false;

                // Р—Р°РїСѓСЃРєР°РµРј on_remove РґРµР№СЃС‚РІРёСЏ
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

                // РџСЂРёРЅСѓРґРёС‚РµР»СЊРЅРѕРµ РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ СЃС‚Р°С‚РѕРІ
                if (removedEffect.originalValues && typeof removedEffect.originalValues === 'object') {
                    for (const statToRestore in removedEffect.originalValues) {
                        const restoreAction = { type: 'restore_stat', stat: statToRestore };
                        const message = applyEffectAction(player, removedEffect, restoreAction);
                        if (message) {
                            logMessages.push(message);
                            specificActionOccurred = true;
                            console.warn(`РџСЂРёРЅСѓРґРёС‚РµР»СЊРЅРѕРµ РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ СЃС‚Р°С‚Р° '${statToRestore}' РґР»СЏ СЌС„С„РµРєС‚Р° '${removedEffect.name}', С‚.Рє. GM РЅРµ РїСЂРµРґРѕСЃС‚Р°РІРёР» С‚СЂРёРіРіРµСЂ on_remove.`);
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

    // 5. РћР±РЅРѕРІР»СЏРµРј UI, РµСЃР»Рё С‡С‚Рѕ-С‚Рѕ РёР·РјРµРЅРёР»РѕСЃСЊ
    if (logMessages.length > 0) {
        updateStatusEffectsDisplay();
        updateCharacterSheet();
    }

    // Р’РѕР·РІСЂР°С‰Р°РµРј РёРјРµРЅР° РёСЃС‚РµРєС€РёС… СЌС„С„РµРєС‚РѕРІ РґР»СЏ РїРµСЂРµРґР°С‡Рё GM
    player.expiredEffectsForGM = expiredEffectNames;
    return logMessages;
}

/**
 * РџСЂРѕРІРµСЂСЏРµС‚, РґРѕР»Р¶РµРЅ Р»Рё СЃСЂР°Р±РѕС‚Р°С‚СЊ С‚СЂРёРіРіРµСЂ СЌС„С„РµРєС‚Р° РІ С‚РµРєСѓС‰РµРј С…РѕРґСѓ.
 * @param {object} effect - РџРѕР»РЅС‹Р№ РѕР±СЉРµРєС‚ СЃС‚Р°С‚СѓСЃ-СЌС„С„РµРєС‚Р°.
 * @param {object} trigger - РћР±СЉРµРєС‚ С‚СЂРёРіРіРµСЂР°.
 * @returns {boolean} - true, РµСЃР»Рё С‚СЂРёРіРіРµСЂ СЃСЂР°Р±РѕС‚Р°Р».
 */
function checkEffectTrigger(effect, trigger) {
    if (trigger.type === 'on_turn_start') {
        const interval = trigger.interval || 1;
        const turnsPassed = player.stats.turnCount - effect.appliedTurn;
        // РЎСЂР°Р±Р°С‚С‹РІР°РµС‚ РІ 0-Р№ С…РѕРґ (СЃСЂР°Р·Сѓ РїСЂРё РїСЂРёРјРµРЅРµРЅРёРё) Рё РєР°Р¶РґС‹Р№ 'interval' С…РѕРґ РїРѕСЃР»Рµ
        return turnsPassed >= 0 && turnsPassed % interval === 0;
    }
    // Р—РґРµСЃСЊ РјРѕР¶РЅРѕ РґРѕР±Р°РІРёС‚СЊ РґСЂСѓРіРёРµ С‚РёРїС‹ С‚СЂРёРіРіРµСЂРѕРІ: on_damage_taken, on_attack, Рё С‚.Рґ.
    return false;
}

/**
 * РџСЂРёРјРµРЅСЏРµС‚ РєРѕРЅРєСЂРµС‚РЅРѕРµ РґРµР№СЃС‚РІРёРµ СЌС„С„РµРєС‚Р° Рє СЃСѓС‰РЅРѕСЃС‚Рё.
 * @param {object} entity - РЎСѓС‰РЅРѕСЃС‚СЊ, РЅР° РєРѕС‚РѕСЂСѓСЋ РґРµР№СЃС‚РІСѓРµС‚ СЌС„С„РµРєС‚ (РїРѕРєР° С‚РѕР»СЊРєРѕ player).
 * @param {object} effect - Р РѕРґРёС‚РµР»СЊСЃРєРёР№ СЃС‚Р°С‚СѓСЃ-СЌС„С„РµРєС‚ (РґР»СЏ С…СЂР°РЅРµРЅРёСЏ originalValues).
 * @param {object} action - РћР±СЉРµРєС‚ РґРµР№СЃС‚РІРёСЏ.
 * @returns {string|null} РЎРѕРѕР±С‰РµРЅРёРµ РґР»СЏ Р»РѕРіР° РёР»Рё null.
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

                // РћРіСЂР°РЅРёС‡РµРЅРёСЏ
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

                // РЎРѕС…СЂР°РЅСЏРµРј РѕСЂРёРіРёРЅР°Р»СЊРЅРѕРµ Р·РЅР°С‡РµРЅРёРµ, РµСЃР»Рё РѕРЅРѕ РµС‰Рµ РЅРµ СЃРѕС…СЂР°РЅРµРЅРѕ
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
                    delete effect.originalValues[stat]; // РћС‡РёС‰Р°РµРј СЃРѕС…СЂР°РЅРµРЅРЅРѕРµ Р·РЅР°С‡РµРЅРёРµ
                }
                break;
            }
        }
    } catch (e) {
        console.error("РћС€РёР±РєР° РїСЂРёРјРµРЅРµРЅРёСЏ РґРµР№СЃС‚РІРёСЏ СЌС„С„РµРєС‚Р°:", e, action);
    }
    return message;
}

// --- РЎРёСЃС‚РµРјР° РЎРѕС…СЂР°РЅРµРЅРёР№ / Р—Р°РіСЂСѓР·РєРё (РћСЃРЅРѕРІРЅС‹Рµ С„СѓРЅРєС†РёРё) ---


/**
 * Р—Р°РіСЂСѓР¶Р°РµС‚ РёРіСЂСѓ РёР· СѓРєР°Р·Р°РЅРЅРѕРіРѕ СЃР»РѕС‚Р°.
 * РџСЂРёРѕСЂРёС‚РµС‚ РѕС‚РґР°РµС‚СЃСЏ File System Access API, РµСЃР»Рё РґРѕСЃС‚СѓРїРЅРѕ, РёРЅР°С‡Рµ РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ localStorage.
 * РћР±РµСЃРїРµС‡РёРІР°РµС‚ РѕР±СЂР°С‚РЅСѓСЋ СЃРѕРІРјРµСЃС‚РёРјРѕСЃС‚СЊ СЃРѕ СЃС‚Р°СЂС‹РјРё СЃРѕС…СЂР°РЅРµРЅРёСЏРјРё.
 * @param {string} slotType - 'manual' РёР»Рё 'auto'.
 * @param {number} slotId - ID СЃР»РѕС‚Р°.
 */











// --- Р¤СѓРЅРєС†РёРё РЈРїСЂР°РІР»РµРЅРёСЏ Р­РєСЂР°РЅР°РјРё ---
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

    // РђРЅРёРјР°С†РёСЏ СѓС…РѕРґР° РёР· РіР»Р°РІРЅРѕРіРѕ РјРµРЅСЋ
    if (currentActive && currentActive.id === 'main-menu' && screenId !== 'main-menu') {
        const leftBlock = currentActive.querySelector('.mm-left-block');
        if (leftBlock) leftBlock.style.animation = 'slideOutLeft 0.3s forwards cubic-bezier(0.7, 0, 0.3, 1)';
        setTimeout(executeSwap, 250);
    } 
    // РђРЅРёРјР°С†РёСЏ РІРѕР·РІСЂР°С‚Р° РІ РіР»Р°РІРЅРѕРµ РјРµРЅСЋ
    else if (screenId === 'main-menu') {
        if (currentActive) currentActive.classList.remove('active-screen'); // РќР°С‡РёРЅР°РµРј С„РµР№Рґ-Р°СѓС‚ С‚РµРєСѓС‰РµРіРѕ
        setTimeout(() => {
            executeSwap();
            const leftBlock = targetScreen.querySelector('.mm-left-block');
            if (leftBlock) leftBlock.style.animation = 'slideInLeft 0.4s forwards cubic-bezier(0.2, 0.8, 0.2, 1)';
        }, 200);
    } 
    // РћР±С‹С‡РЅС‹Р№ РїРµСЂРµС…РѕРґ
    else {
        executeSwap();
    }
}

// --- Р¤СѓРЅРєС†РёРё РґР»СЏ РІРєР»Р°РґРѕРє РџРѕРјРѕС‰Рё ---
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
        titleH3.innerHTML = `<i class="fas fa-exclamation-triangle"></i> РћС€РёР±РєР° РњР°СЃС‚РµСЂР° РРіСЂС‹`;
    }

    let mainText = "";
    let detailsText = errorText;

    // Р Р°Р·РґРµР»СЏРµРј С‡РµР»РѕРІРµРєРѕС‡РёС‚Р°РµРјСѓСЋ С‡Р°СЃС‚СЊ Рё С‚РµС…РЅРёС‡РµСЃРєРёРµ РґРµС‚Р°Р»Рё
    if (typeof errorText === 'string' && errorText.includes('\n\n[РљРѕРґ:')) {
        let parts = errorText.split('\n\n[РљРѕРґ:');
        mainText = parts[0];
        detailsText = '[РљРѕРґ:' + parts[1];
    }

    if (customDesc) {
        aiErrorMessage.textContent = customDesc;
        aiErrorCancelBtn.textContent = "РћС‚РјРµРЅР°";
    } else if (mainText) {
        // FIX: Р’С‹РІРѕРґРёРј РїРѕРЅСЏС‚РЅСѓСЋ РїСЂРёС‡РёРЅСѓ РѕС€РёР±РєРё РїСЂСЏРјРѕ РІ С†РµРЅС‚СЂ РѕРєРЅР°
        aiErrorMessage.textContent = mainText;
        aiErrorCancelBtn.textContent = isInitial ? "Р’ РіР»Р°РІРЅРѕРµ РјРµРЅСЋ" : "РћС‚РјРµРЅР° (РћСЃС‚Р°С‚СЊСЃСЏ РІ РёРіСЂРµ)";
    } else if (isInitial) {
        aiErrorMessage.textContent = "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРіРµРЅРµСЂРёСЂРѕРІР°С‚СЊ РјРёСЂ. РњР°РіРёС‡РµСЃРєРёРµ РїРѕС‚РѕРєРё РїСЂРµСЂРІР°Р»РёСЃСЊ.";
        aiErrorCancelBtn.textContent = "Р’ РіР»Р°РІРЅРѕРµ РјРµРЅСЋ";
    } else {
        aiErrorMessage.textContent = "РњР°СЃС‚РµСЂ РРіСЂС‹ РїРѕС‚РµСЂСЏР» РЅРёС‚СЊ РїРѕРІРµСЃС‚РІРѕРІР°РЅРёСЏ. РџСЂРѕРёР·РѕС€Р»Р° РѕС€РёР±РєР° РіРµРЅРµСЂР°С†РёРё.";
        aiErrorCancelBtn.textContent = "РћС‚РјРµРЅР° (РћСЃС‚Р°С‚СЊСЃСЏ РІ РёРіСЂРµ)";
    }

    aiErrorDetailsContent.textContent = detailsText;
    aiErrorDetailsContent.style.display = 'none';
    aiErrorDetailsToggle.textContent = "РџРѕРєР°Р·Р°С‚СЊ РґРµС‚Р°Р»Рё РѕС€РёР±РєРё";

    aiErrorModal.style.display = 'flex';
    setTimeout(() => aiErrorModal.classList.add('visible'), 10);

    const isRateLimitOrUnavailable = typeof errorText === 'string' && (errorText.includes('429') || errorText.includes('503'));
    if (isRateLimitOrUnavailable && !isInitial) {
        aiErrorRetryBtn.textContent = "РЎРјРµРЅРёС‚СЊ РјРѕРґРµР»СЊ (Fallback) Рё РїРѕРІС‚РѕСЂРёС‚СЊ";
        aiErrorRetryBtn.onclick = () => {
            closeAiErrorModal();
            // Fallback РЅР° СЃС‚Р°Р±РёР»СЊРЅСѓСЋ Р±РµСЃРїР»Р°С‚РЅСѓСЋ/РґРµС€РµРІСѓСЋ РјРѕРґРµР»СЊ
            if (currentApiProvider === 'openrouter') {
                openrouterModelId = 'google/gemini-2.0-flash-lite-preview-02-05:free';
                localStorage.setItem('openrouterModelId', openrouterModelId);
            } else if (currentApiProvider === 'gemini') {
                geminiModelId = 'gemini-2.0-flash-lite';
                localStorage.setItem('geminiModelId', geminiModelId);
            }
            addLogMessage("вљ пёЏ РњРѕРґРµР»СЊ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё РёР·РјРµРЅРµРЅР° РЅР° СЂРµР·РµСЂРІРЅСѓСЋ РёР·-Р·Р° РЅРµРґРѕСЃС‚СѓРїРЅРѕСЃС‚Рё СЃРµСЂРІРµСЂР°.", "system-message");
            if (onRetry) onRetry();
        };
    } else {
        aiErrorRetryBtn.textContent = "РџРѕРІС‚РѕСЂРёС‚СЊ Р·Р°РїСЂРѕСЃ";
        aiErrorRetryBtn.onclick = () => {
            closeAiErrorModal();
            if (isInitial) {
                // РџРѕР»РЅС‹Р№ СЃР±СЂРѕСЃ Рє СЃРѕСЃС‚РѕСЏРЅРёСЋ РґРѕ СЃС‚Р°СЂС‚Р°
                if (player) exitToMainMenu();
                startNewGameSetup(); // РџРµСЂРµР·Р°РїСѓСЃРє СЃ РЅСѓР»СЏ
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
            
            // FIX: Р“Р»СѓР±РѕРєР°СЏ РѕС‡РёСЃС‚РєР° СЃРѕСЃС‚РѕСЏРЅРёР№ РїСѓС‚РµС€РµСЃС‚РІРёСЏ РґР»СЏ СЂР°Р·Р±Р»РѕРєРёСЂРѕРІРєРё UI
            if (player && player.travel && player.travel.active) {
                player.travel.paused = true;
                player.travel.pauseReason = "api_error";
                player.travel.currentEvents = null; // РЈРґР°Р»СЏРµРј Р·Р°РІРёСЃС€РёРµ СЃРѕР±С‹С‚РёСЏ, Р±Р»РѕРєРёСЂСѓСЋС‰РёРµ РёРЅРїСѓС‚
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
                // Р’РѕСЃСЃС‚Р°РЅР°РІР»РёРІР°РµРј С‚РµРєСЃС‚ РёРіСЂРѕРєР°, РІС‹СЂРµР·Р°СЏ СЃРёСЃС‚РµРјРЅС‹Рµ С‚СЌРіРё РєСѓР±РёРєРѕРІ
                if (lastUserMessageForRetry && !lastUserMessageForRetry.includes("[SYSTEM:")) {
                    userInput.value = lastUserMessageForRetry.replace(/\[ROLL_RESULT:.*?\]/gi, '').trim();
                }
                userInput.focus();
            }
            if (sendButton) sendButton.disabled = false;
            
            updateCharacterSheet(); // РџСЂРёРЅСѓРґРёС‚РµР»СЊРЅРѕ РїРµСЂРµСЂРёСЃРѕРІС‹РІР°РµРј РёРЅС‚РµСЂС„РµР№СЃ
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
                aiErrorDetailsToggle.textContent = "РЎРєСЂС‹С‚СЊ РґРµС‚Р°Р»Рё РѕС€РёР±РєРё";
            } else {
                aiErrorDetailsContent.style.display = 'none';
                aiErrorDetailsToggle.textContent = "РџРѕРєР°Р·Р°С‚СЊ РґРµС‚Р°Р»Рё РѕС€РёР±РєРё";
            }
        });
    }
});

// --- С„СѓРЅРєС†РёРё СЂР°СЃС‡РµС‚Р° РґРµР№СЃС‚РІРёСЏ ---
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
    // Р—Р°РіР»СѓС€РєР° РґР»СЏ РІСЃС‚СЂРѕРµРЅРЅС‹С… РєР»СЋС‡РµР№ (РІРѕР·РІСЂР°С‰Р°РµРј РїСѓСЃС‚РѕР№ РјР°СЃСЃРёРІ, С‡С‚РѕР±С‹ РёР·Р±РµР¶Р°С‚СЊ ReferenceError)
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
    console.log("Р’С‹Р±СЂР°РЅ РІСЃС‚СЂРѕРµРЅРЅС‹Р№ API РєР»СЋС‡.");
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
        newGameButton.title = keyIsMissing ? t('mainMenu.tooltips.newGameDisabled', 'Р’РІРµРґРёС‚Рµ API РєР»СЋС‡ РІ РЅР°СЃС‚СЂРѕР№РєР°С…, С‡С‚РѕР±С‹ РЅР°С‡Р°С‚СЊ') : t('mainMenu.tooltips.newGame', 'РќР°С‡Р°С‚СЊ РЅРѕРІРѕРµ РїСЂРёРєР»СЋС‡РµРЅРёРµ');
    }
}

function saveApiKey() {
    const newKey = document.getElementById('api-key-input').value.trim();
    if (newKey) {
        localStorage.setItem('geminiApiKey', newKey);
        GEMINI_API_KEY = newKey;
        isUsingBuiltInKey = false;
        localStorage.setItem('useBuiltInApiKey_v1', 'false');
        // Р—РђРњР•РќРђ ALERT
        showCustomAlert(t('settingsMenu.apiKeySaved', null, 'API РєР»СЋС‡ СЃРѕС…СЂР°РЅРµРЅ!'));
    } else {
        localStorage.removeItem('geminiApiKey');
        GEMINI_API_KEY = '';
        // Р—РђРњР•РќРђ ALERT
        showCustomAlert(t('settingsMenu.apiKeyRemovedOrEmpty', null, 'API РєР»СЋС‡ СѓРґР°Р»РµРЅ.'));
    }
    updateApiKeyStatus();
}

// --- Р¤СѓРЅРєС†РёРё РњСѓР·С‹РєРё ---
// --- Р•Р”РРќРђРЇ Р›РћР“РРљРђ РњРЈР—Р«РљР ---
function playMenuMusic() {
    if (!audioPlayer) return;
    if (!audioPlayer.paused) return; // РЈР¶Рµ РёРіСЂР°РµС‚

    playMusic(0); // Р—Р°РїСѓСЃРєР°РµРј menu_theme.mp3

    // РћР±СЂР°Р±РѕС‚РєР° Р±Р»РѕРєРёСЂРѕРІРєРё Р°РІС‚РѕРїР»РµСЏ Р±СЂР°СѓР·РµСЂРѕРј
    if (audioPlayer.paused) {
        document.addEventListener('click', () => {
            if (audioPlayer.paused) playMusic(0);
        }, { once: true });
    }
}

function stopMenuMusic() {
    // РњСѓР·С‹РєР° Р±РѕР»СЊС€Рµ РЅРµ РѕСЃС‚Р°РЅР°РІР»РёРІР°РµС‚СЃСЏ РїСЂРё РїРµСЂРµС…РѕРґРµ РІ РёРіСЂСѓ!
    // РћРЅР° РїР»Р°РІРЅРѕ РїСЂРѕРґРѕР»Р¶Р°РµС‚ РёРіСЂР°С‚СЊ С„РѕРЅРѕРј.
    console.log("РџРµСЂРµС…РѕРґ РІ РёРіСЂСѓ: РјСѓР·С‹РєР° РїСЂРѕРґРѕР»Р¶Р°РµС‚ РёРіСЂР°С‚СЊ.");
}

// Р—Р°РїСѓСЃРєР°РµРј РїСЂРё Р·Р°РіСЂСѓР·РєРµ СЃС‚СЂР°РЅРёС†С‹
window.addEventListener('DOMContentLoaded', () => {
    playMenuMusic();
});

function playMusic(index) {
    if (!audioPlayer || musicFiles.length === 0 || index < 0 || index >= musicFiles.length) {
        console.warn("РќРµ СѓРґР°РµС‚СЃСЏ РІРѕСЃРїСЂРѕРёР·РІРµСЃС‚Рё РјСѓР·С‹РєСѓ: РЅРµС‚ РїР»РµРµСЂР°, РЅРµС‚ С„Р°Р№Р»РѕРІ РёР»Рё РЅРµРІРµСЂРЅС‹Р№ РёРЅРґРµРєСЃ.", index);
        return;
    }
    if (!userInteractedForMusic && currentTrackIndex !== -1) {
        console.log("РњСѓР·С‹РєР° Р·Р°Р±Р»РѕРєРёСЂРѕРІР°РЅР° РґРѕ РїРµСЂРІРѕРіРѕ РІР·Р°РёРјРѕРґРµР№СЃС‚РІРёСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ СЃ РєРЅРѕРїРєРѕР№ РїРµСЂРµРєР»СЋС‡РµРЅРёСЏ.");
        return;
    }

    const trackSrc = SOUND_FOLDER_PATH + musicFiles[index];
    if (audioPlayer.currentSrc.endsWith(trackSrc) && !audioPlayer.paused) {
        console.log(`РўСЂРµРє ${musicFiles[index]} СѓР¶Рµ РёРіСЂР°РµС‚.`);
        return;
    }

    console.log(`РџРѕРїС‹С‚РєР° РІРѕСЃРїСЂРѕРёР·РІРµСЃС‚Рё РјСѓР·С‹РєСѓ: ${musicFiles[index]}`);
    audioPlayer.src = trackSrc;
    audioPlayer.volume = musicVolume;
    audioPlayer.loop = true; // Р—Р°С†РёРєР»РёРІР°РµРј С‚СЂРµРє

    const playPromise = audioPlayer.play();

    if (playPromise !== undefined) {
        playPromise.then(_ => {
            console.log(`РРіСЂР°РµС‚: ${musicFiles[index]}`);
            isMusicPlaying = true;
            currentTrackIndex = index;
            updateMusicToggleButton(true);
        }).catch(error => {
            console.warn(`Р’РѕСЃРїСЂРѕРёР·РІРµРґРµРЅРёРµ РјСѓР·С‹РєРё РЅРµ СѓРґР°Р»РѕСЃСЊ РґР»СЏ ${musicFiles[index]}:`, error);
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
    console.log("РњСѓР·С‹РєР° РЅР° РїР°СѓР·Рµ.");
}

function toggleMusic() {
    if (!toggleMusicButton) return;

    if (!userInteractedForMusic) {
        userInteractedForMusic = true;
        console.log("РћР±РЅР°СЂСѓР¶РµРЅРѕ РІР·Р°РёРјРѕРґРµР№СЃС‚РІРёРµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ, РІРєР»СЋС‡РµРЅРёРµ РІРѕСЃРїСЂРѕРёР·РІРµРґРµРЅРёСЏ РјСѓР·С‹РєРё.");
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
                }).catch(e => console.error("РћС€РёР±РєР° РІРѕР·РѕР±РЅРѕРІР»РµРЅРёСЏ РјСѓР·С‹РєРё:", e));
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
        toggleMusicButton.title = t('gameInterface.toggleMusicButtonTitlePause', "РџР°СѓР·Р°");
    } else {
        toggleMusicIcon.classList.remove('fa-volume-high', 'fa-pause');
        toggleMusicIcon.classList.add('fa-volume-off');
        toggleMusicButton.title = t('gameInterface.toggleMusicButtonTitlePlay', "Р’РєР»СЋС‡РёС‚СЊ РјСѓР·С‹РєСѓ");
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

// --- Р¤СѓРЅРєС†РёРё TTS (Text-to-Speech) ---
function setupTTS() {
    if (!hasElectronAPI) {
        console.warn("Р›РѕРєР°Р»СЊРЅС‹Р№ TTS СЂР°Р±РѕС‚Р°РµС‚ С‚РѕР»СЊРєРѕ РІ Electron-РІРµСЂСЃРёРё.");
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
    // Р–РµСЃС‚РєРѕ Р·Р°РґР°РЅРЅС‹Р№ СЃРїРёСЃРѕРє РјРѕРґРµР»РµР№, РєРѕС‚РѕСЂС‹Рµ РјС‹ РїРѕР»РѕР¶РёРј РІ РїР°РїРєСѓ assets/tts
    ttsVoices = [
        { name: "РСЂРёРЅР° (Р СѓСЃСЃРєРёР№, Р–РµРЅСЃРєРёР№)", file: "ru_RU-irina-medium.onnx", lang: "ru" },
        { name: "Р”РјРёС‚СЂРёР№ (Р СѓСЃСЃРєРёР№, РњСѓР¶СЃРєРѕР№)", file: "ru_RU-dmitri-medium.onnx", lang: "ru" },
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
        console.log(`[TTS] Р’С‹Р±СЂР°РЅ Р»РѕРєР°Р»СЊРЅС‹Р№ РіРѕР»РѕСЃ: ${voice.name}`);
        speakText(t('tts.voiceTest', 'РўРµСЃС‚ РіРѕР»РѕСЃР°'));
    }
}

/**
 * Р Р°СЃСЃС‡РёС‚С‹РІР°РµС‚ РџРћР›РќР«Р™ РјРѕРґРёС„РёРєР°С‚РѕСЂ РґР»СЏ С…Р°СЂР°РєС‚РµСЂРёСЃС‚РёРєРё, СѓС‡РёС‚С‹РІР°СЏ СЃС‚Р°С‚С‹, СЌС„С„РµРєС‚С‹ Рё СѓРјРµРЅРёСЏ.
 * @param {string} statKey - РљР»СЋС‡ С…Р°СЂР°РєС‚РµСЂРёСЃС‚РёРєРё ('str', 'dex', 'int', 'con', 'cha').
 * @returns {number} - РС‚РѕРіРѕРІС‹Р№ РјРѕРґРёС„РёРєР°С‚РѕСЂ.
 */
function getStatModifier(statKey) {
    if (!player || !player.stats[statKey]) {
        return 0;
    }

    // РЁР°Рі 1: Р‘Р°Р·РѕРІС‹Р№ РјРѕРґРёС„РёРєР°С‚РѕСЂ РѕС‚ С…Р°СЂР°РєС‚РµСЂРёСЃС‚РёРєРё
    let baseModifier = Math.floor((player.stats[statKey] - 10) / 2);
    let totalBonus = 0;
    let logMessages = [];

    // РЁР°Рі 2: РЈС‡РµС‚ Р±Р°С„С„РѕРІ Рё РґРµР±Р°С„С„РѕРІ РѕС‚ СЃС‚Р°С‚СѓСЃ-СЌС„С„РµРєС‚РѕРІ
    if (player.statusEffects) {
        for (const effectId in player.statusEffects) {
            const effect = player.statusEffects[effectId];
            if (effect.effects && Array.isArray(effect.effects)) {
                for (const subEffect of effect.effects) {
                    if (subEffect.action && subEffect.action.stat === statKey && subEffect.action.type === 'modify_stat') {
                        const change = parseInt(subEffect.action.change, 10);
                        if (!isNaN(change)) {
                            totalBonus += change;
                            logMessages.push(`Р­С„С„РµРєС‚ '${effect.name}': ${change > 0 ? '+' : ''}${change} Рє ${statKey.toUpperCase()}`);
                        }
                    }
                }
            }
        }
    }

    // РЁР°Рі 3: РЈС‡РµС‚ Р±РѕРЅСѓСЃРѕРІ РѕС‚ РїР°СЃСЃРёРІРЅС‹С… СѓРјРµРЅРёР№ (РЈРЅРёРІРµСЂСЃР°Р»СЊРЅС‹Р№ РїР°СЂСЃРµСЂ)
    if (player.skills) {
        for (const skillId in player.skills) {
            const skill = player.skills[skillId];
            if (skill.skillType && skill.skillType.toLowerCase().includes('РїР°СЃСЃРёРІ') && skill.effectsJSON) {
                try {
                    const parsedEffects = typeof skill.effectsJSON === 'string' ? JSON.parse(skill.effectsJSON) : skill.effectsJSON;
                    for (const subEffect of parsedEffects) {
                        if (subEffect.action && subEffect.action.stat === statKey && subEffect.action.type === 'modify_stat') {
                            const change = parseInt(subEffect.action.change, 10);
                            if (!isNaN(change)) {
                                totalBonus += change;
                                logMessages.push(`РЈРјРµРЅРёРµ '${skill.name}': ${change > 0 ? '+' : ''}${change}`);
                            }
                        }
                    }
                } catch (e) { console.error("Error parsing skill effects", e); }
            }
        }
    }

    // РЁР°Рі 4: (Р—Р°РґРµР» РЅР° Р±СѓРґСѓС‰РµРµ) РЈС‡РµС‚ Р±РѕРЅСѓСЃРѕРІ РѕС‚ СЌРєРёРїРёСЂРѕРІР°РЅРЅС‹С… РїСЂРµРґРјРµС‚РѕРІ
    // for (const itemId in player.equipment) { ... }

    const finalModifier = baseModifier + totalBonus;

    if (logMessages.length > 0) {
        console.log(`[getStatModifier] Р Р°СЃС‡РµС‚ РґР»СЏ ${statKey.toUpperCase()}: Р‘Р°Р·Р° ${baseModifier}, Р‘РѕРЅСѓСЃС‹ ${totalBonus} -> РС‚РѕРі ${finalModifier}. РџСЂРёС‡РёРЅС‹:`, logMessages.join('; '));
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
    const statusMessage = isTTSEnabled ? t('tts.enabled', 'РћР·РІСѓС‡РєР° РІРєР»СЋС‡РµРЅР°.') : t('tts.disabled', 'РћР·РІСѓС‡РєР° РІС‹РєР»СЋС‡РµРЅР°.');
    console.log(statusMessage);
}

function updateTTSToggleButton(isEnabled) {
    if (!toggleTTSIcon || !toggleTTSButton) return;
    if (isEnabled) {
        toggleTTSIcon.classList.remove('fa-comment-dots');
        toggleTTSIcon.classList.add('fa-comment-slash');
        toggleTTSButton.title = t('gameInterface.toggleTTSButtonTitlePause', "Р’С‹РєР»СЋС‡РёС‚СЊ РѕР·РІСѓС‡РєСѓ");
    } else {
        toggleTTSIcon.classList.remove('fa-comment-slash');
        toggleTTSIcon.classList.add('fa-comment-dots');
        toggleTTSButton.title = t('gameInterface.toggleTTSButtonTitlePlay', "Р’РєР»СЋС‡РёС‚СЊ РѕР·РІСѓС‡РєСѓ");
    }
    toggleTTSButton.dataset.i18n = isEnabled
        ? "[title]gameInterface.toggleTTSButtonTitlePause"
        : "[title]gameInterface.toggleTTSButtonTitlePlay";
}

async function speakText(text) {
    if (!text || text.trim() === '' || !selectedTTSVoice) return;

    // РћСЃС‚Р°РЅР°РІР»РёРІР°РµРј РїСЂРµРґС‹РґСѓС‰СѓСЋ СЂРµС‡СЊ, РµСЃР»Рё РѕРЅР° Р±С‹Р»Р°
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }

    console.log(`[TTS] Р“РµРЅРµСЂР°С†РёСЏ Р°СѓРґРёРѕ РґР»СЏ: "${text.substring(0, 30)}..."`);

    try {
        // РћС‚РїСЂР°РІР»СЏРµРј С‚РµРєСЃС‚ РІ Node.js РґР»СЏ РіРµРЅРµСЂР°С†РёРё С‡РµСЂРµР· Piper
        const result = await window.electronAPI.speakText(text, selectedTTSVoice.file);

        if (result.success) {
            currentAudio = new Audio(result.audioPath);
            currentAudio.volume = 0.8;
            currentAudio.play();
        } else {
            console.error("[TTS] РћС€РёР±РєР° РіРµРЅРµСЂР°С†РёРё:", result.error);
            showCustomAlert("РћС€РёР±РєР° TTS: Р”РІРёР¶РѕРє РёР»Рё РјРѕРґРµР»СЊ РіРѕР»РѕСЃР° РЅРµ РЅР°Р№РґРµРЅС‹. РџСЂРѕРІРµСЂСЊС‚Рµ РїР°РїРєСѓ assets/tts/");
        }
    } catch (e) {
        console.error("[TTS] РљСЂРёС‚РёС‡РµСЃРєР°СЏ РѕС€РёР±РєР° РІС‹Р·РѕРІР° IPC:", e);
    }
}

// Р¤СѓРЅРєС†РёСЏ РіРµРЅРµСЂР°С†РёРё РёР·РѕР±СЂР°Р¶РµРЅРёР№ СѓРґР°Р»РµРЅР°


async function loadItemsReference() {
    if (window.ModAPI && window.ModAPI.isTotalConversion) {
        console.log(`[Total Conversion] РџСЂРѕРїСѓСЃРє Р·Р°РіСЂСѓР·РєРё РІР°РЅРёР»СЊРЅРѕРіРѕ СЃРїСЂР°РІРѕС‡РЅРёРєР° РїСЂРµРґРјРµС‚РѕРІ.`);
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
    console.log(`РџРѕРїС‹С‚РєР° Р·Р°РіСЂСѓР·РёС‚СЊ СЃРїСЂР°РІРѕС‡РЅРёРє РїСЂРµРґРјРµС‚РѕРІ РёР·: ${filePath}`);
    try {
        let response = await fetch(`${filePath}?t=${Date.now()}`);
        if (!response.ok && !isDefault) {
            response = await fetch(`${fallback}?t=${Date.now()}`);
        }
        if (!response.ok) throw new Error(`HTTP РѕС€РёР±РєР°! СЃС‚Р°С‚СѓСЃ: ${response.status}`);
        
        itemsReferenceData = await response.json();
        console.log(`РЎРїСЂР°РІРѕС‡РЅРёРє РїСЂРµРґРјРµС‚РѕРІ (${itemsReferenceData.length} С€С‚.) СѓСЃРїРµС€РЅРѕ Р·Р°РіСЂСѓР¶РµРЅ Рё СЂР°Р·РѕР±СЂР°РЅ.`);
    } catch (error) {
        console.error(`РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РёР»Рё СЂР°Р·РѕР±СЂР°С‚СЊ СЃРїСЂР°РІРѕС‡РЅРёРє РїСЂРµРґРјРµС‚РѕРІ:`, error);
        itemsReferenceData = [];
    }
}

// --- Р¤СѓРЅРєС†РёРё Р›РѕРєР°Р»РёР·Р°С†РёРё ---
async function loadLanguagesConfig() {
    try {
        const response = await fetch('assets/localizations/languages.json');
        if (!response.ok) throw new Error(`HTTP РѕС€РёР±РєР°! СЃС‚Р°С‚СѓСЃ: ${response.status}`);
        availableLanguages = await response.json();
        console.log("Р”РѕСЃС‚СѓРїРЅС‹Рµ СЏР·С‹РєРё Р·Р°РіСЂСѓР¶РµРЅС‹:", availableLanguages);
        populateLanguageSelector();
    } catch (error) {
        console.error("РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РєРѕРЅС„РёРіСѓСЂР°С†РёСЋ СЏР·С‹РєРѕРІ:", error);
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
        console.error(`РљРѕРЅС„РёРіСѓСЂР°С†РёСЏ С„Р°Р№Р»Р° РїРµСЂРµРІРѕРґР° РЅРµ РЅР°Р№РґРµРЅР° РґР»СЏ СЏР·С‹РєР°: ${langCode}`);
        translations = {};
        return;
    }

    const fileUrl = `${langConfig.file}?t=${Date.now()}`;
    console.log(`РџРѕРїС‹С‚РєР° Р·Р°РіСЂСѓР·РёС‚СЊ РїРµСЂРµРІРѕРґС‹ РёР·: ${fileUrl}`);

    try {
        const response = await fetch(fileUrl, {
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });

        if (!response.ok) throw new Error(`HTTP РѕС€РёР±РєР°! СЃС‚Р°С‚СѓСЃ: ${response.status}, РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ ${response.url}`);
        const responseText = await response.text();

        try {
            translations = JSON.parse(responseText);
            console.log(`РџРµСЂРµРІРѕРґС‹ РґР»СЏ '${langCode}' СѓСЃРїРµС€РЅРѕ СЂР°Р·РѕР±СЂР°РЅС‹.`);
        } catch (parseError) {
            console.error(`РќРµ СѓРґР°Р»РѕСЃСЊ Р РђР—РћР‘Р РђРўР¬ РїРµСЂРµРІРѕРґС‹ РґР»СЏ ${langCode} РїРѕСЃР»Рµ Р·Р°РіСЂСѓР·РєРё. РћС€РёР±РєР°:`, parseError);
            console.error("--- РџСЂРѕР±Р»РµРјРЅС‹Р№ JSON С‚РµРєСЃС‚, РїРѕР»СѓС‡РµРЅРЅС‹Р№ Р±СЂР°СѓР·РµСЂРѕРј: ---");
            const errorPosition = parseError.message.match(/position (\d+)/);
            if (errorPosition && errorPosition[1]) {
                const pos = parseInt(errorPosition[1], 10);
                const contextLength = 50;
                console.error(responseText.substring(Math.max(0, pos - contextLength), Math.min(responseText.length, pos + contextLength)));
                console.error(`^^^ РћС€РёР±РєР°, РІРµСЂРѕСЏС‚РЅРѕ, РѕРєРѕР»Рѕ РїРѕР·РёС†РёРё ${pos} ^^^`);
            } else {
                console.error(responseText.substring(0, 500) + '...');
            }
            console.error("---------------------------------------------");
            translations = {};
        }

    } catch (fetchError) {
        console.error(`РќРµ СѓРґР°Р»РѕСЃСЊ Р—РђР“Р РЈР—РРўР¬ РїРµСЂРµРІРѕРґС‹ РґР»СЏ ${langCode}:`, fetchError);
        translations = {};
    }
}

async function setLanguage(langCode) {
    if (!availableLanguages[langCode]) {
        console.warn(`РџРѕРїС‹С‚РєР° СѓСЃС‚Р°РЅРѕРІРёС‚СЊ РЅРµРїРѕРґРґРµСЂР¶РёРІР°РµРјС‹Р№ СЏР·С‹Рє: ${langCode}. Р’РѕР·РІСЂР°С‚ Рє СЏР·С‹РєСѓ РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ.`);
        langCode = DEFAULT_LANGUAGE;
    }

    const previousLanguage = currentLanguage;
    currentLanguage = langCode;
    localStorage.setItem(LANGUAGE_STORAGE_KEY, currentLanguage);
    console.log(`РЈСЃС‚Р°РЅРѕРІРєР° СЏР·С‹РєР° РЅР°: ${currentLanguage}`);

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
        if (el.id === 'level-info') { // level-info РѕР±РЅРѕРІР»СЏРµС‚СЃСЏ РѕС‚РґРµР»СЊРЅРѕ С‡РµСЂРµР· updateCharacterSheet
            return;
        }

        const keyWithOptions = el.dataset.i18n;
        let key = keyWithOptions;
        let attribute = 'textContent'; // РџРѕ СѓРјРѕР»С‡Р°РЅРёСЋ РѕР±РЅРѕРІР»СЏРµРј С‚РµРєСЃС‚РѕРІРѕРµ СЃРѕРґРµСЂР¶РёРјРѕРµ

        // РџСЂРѕРІРµСЂСЏРµРј, СѓРєР°Р·Р°РЅ Р»Рё Р°С‚СЂРёР±СѓС‚ РІ data-i18n (РЅР°РїСЂРёРјРµСЂ, [placeholder]key.name)
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
                // Р—Р°РјРµРЅСЏРµРј РѕРґРёРЅР°СЂРЅС‹Рµ РєР°РІС‹С‡РєРё РЅР° РґРІРѕР№РЅС‹Рµ РґР»СЏ РєРѕСЂСЂРµРєС‚РЅРѕРіРѕ JSON.parse
                const jsonString = el.dataset.i18nVariables.replace(/'/g, '"');
                variables = JSON.parse(jsonString);
            } catch (e) {
                console.error(`РћС€РёР±РєР° СЂР°Р·Р±РѕСЂР° РїРµСЂРµРјРµРЅРЅС‹С… i18n РґР»СЏ РєР»СЋС‡Р° "${key}":`, e, el.dataset.i18nVariables);
            }
        }

        let translation = t(key, variables); // РџРѕР»СѓС‡Р°РµРј РїРµСЂРµРІРѕРґ

        if (translation !== key) { // Р•СЃР»Рё РїРµСЂРµРІРѕРґ РЅР°Р№РґРµРЅ Рё РѕРЅ РЅРµ СЂР°РІРµРЅ СЃР°РјРѕРјСѓ РєР»СЋС‡Сѓ
            if (attribute === 'textContent') {
                el.textContent = translation; // Safe: textContent doesn't parse HTML
            } else if (attribute === 'innerHTML') {
                el.innerHTML = sanitizeHTML(translation);
            } else if (el.hasAttribute(attribute)) {
                el.setAttribute(attribute, translation);
            } else {
                // Р•СЃР»Рё СЌС‚Рѕ СЃРїРµС†РёР°Р»СЊРЅС‹Р№ Р°С‚СЂРёР±СѓС‚, РєРѕС‚РѕСЂС‹Р№ РЅРµ СЏРІР»СЏРµС‚СЃСЏ СЃС‚Р°РЅРґР°СЂС‚РЅС‹Рј HTML Р°С‚СЂРёР±СѓС‚РѕРј
                // (РЅР°РїСЂРёРјРµСЂ, data-custom-attr), С‚Рѕ el.setAttribute СЃСЂР°Р±РѕС‚Р°РµС‚.
                // Р•СЃР»Рё СЌС‚Рѕ СЃРІРѕР№СЃС‚РІРѕ РѕР±СЉРµРєС‚Р° (РЅР°РїСЂРёРјРµСЂ, el.value), С‚Рѕ РЅСѓР¶РЅРѕ РѕР±СЂР°Р±Р°С‚С‹РІР°С‚СЊ РѕС‚РґРµР»СЊРЅРѕ РёР»Рё СѓР±РµРґРёС‚СЊСЃСЏ,
                // С‡С‚Рѕ С‚Р°РєРёРµ СЃР»СѓС‡Р°Рё РїРѕРєСЂС‹С‚С‹ РІ updateDynamicUIText РёР»Рё РґСЂСѓРіРёС… С„СѓРЅРєС†РёСЏС….
                // Р”Р»СЏ Р±РѕР»СЊС€РёРЅСЃС‚РІР° СЃР»СѓС‡Р°РµРІ (title, placeholder) setAttribute СЃСЂР°Р±РѕС‚Р°РµС‚.
                el.setAttribute(attribute, translation);
                // console.warn(`Р¦РµР»РµРІРѕР№ Р°С‚СЂРёР±СѓС‚ "${attribute}" РЅРµ РЅР°Р№РґРµРЅ РёР»Рё РЅРµ СЏРІР»СЏРµС‚СЃСЏ СЃС‚Р°РЅРґР°СЂС‚РЅС‹Рј РЅР° СЌР»РµРјРµРЅС‚Рµ РґР»СЏ РєР»СЋС‡Р°: ${key}. РџРѕРїС‹С‚РєР° СѓСЃС‚Р°РЅРѕРІРёС‚СЊ С‡РµСЂРµР· setAttribute.`);
            }
        } else if (!el.innerHTML && (attribute === 'textContent' || attribute === 'innerHTML')) {
            // Р•СЃР»Рё РїРµСЂРµРІРѕРґ РЅРµ РЅР°Р№РґРµРЅ Рё СЌР»РµРјРµРЅС‚ РїСѓСЃС‚, РїРѕРєР°Р·С‹РІР°РµРј РєР»СЋС‡ РґР»СЏ РѕС‚Р»Р°РґРєРё
            el.innerHTML = `[${key}]`;
        }
    });
    // updateApiKeyStatus(); // РЈР¶Рµ РІС‹Р·С‹РІР°РµС‚СЃСЏ РІ setLanguage
}

function t(key, variables = null, fallback = null) {
    let translation = undefined;
    
    // РЎРЅР°С‡Р°Р»Р° РёС‰РµРј РїРµСЂРµРІРѕРґ РІ СЃР»РѕРІР°СЂСЏС… РјРѕРґРѕРІ
    if (window.ModAPI && window.ModAPI.customTranslations && window.ModAPI.customTranslations[currentLanguage]) {
        translation = key.split('.').reduce((obj, i) => obj?.[i], window.ModAPI.customTranslations[currentLanguage]);
    }
    
    // Р•СЃР»Рё РјРѕРґ РЅРµ РїРµСЂРµРѕРїСЂРµРґРµР»РёР» СЃС‚СЂРѕРєСѓ, РёС‰РµРј РІ Р±Р°Р·РѕРІРѕР№ РёРіСЂРµ
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
        tradeJournalPanelTitle.textContent = t('gameInterface.tradeJournalPanel.title', null, 'РўРѕСЂРіРѕРІС‹Р№ Р–СѓСЂРЅР°Р»');
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

    if (typeof populateRacesUI === 'function' && window.RACES_DATA) populateRacesUI(window.RACES_DATA);
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
    // РљРЅРѕРїРєРё РјСѓР·С‹РєРё Рё TTS СѓРґР°Р»РµРЅС‹ РёР· РІРµСЂС…РЅРµР№ РїР°РЅРµР»Рё
    if (globalLocationsList && globalLocationsList.children.length === 1 && globalLocationsList.firstElementChild.tagName === 'LI') {
        const li = globalLocationsList.firstElementChild;
        if (Object.keys(globalLocations || {}).filter(key => key !== 'startLocation').length === 0) {
            if (worldLore.startsWith(t('error.prefix', 'РћС€РёР±РєР°:')) || worldLore === "Р—Р°РіСЂСѓР·РєР° Р»РѕСЂР°...") {
                li.textContent = t('gameInterface.mapPanel.errorWorldData');
            } else {
                li.textContent = t('gameInterface.mapPanel.noGlobal');
            }
        }
    }
}

// --- РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ РџСЂРёР»РѕР¶РµРЅРёСЏ ---
async function initializeApp() {

    // РЎР»СѓС€Р°С‚РµР»СЊ РїСЂРѕРіСЂРµСЃСЃР° РЅР°С‚РёРІРЅРѕРіРѕ РґРІРёР¶РєР°
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

    // РЎР»СѓС€Р°С‚РµР»СЊ СЂРµР°Р»С‚Р°Р№Рј-РѕР±РЅРѕРІР»РµРЅРёР№ РѕС‚ РґРІРёР¶РєР° вЂ” РјРёСЂ РѕР±РЅРѕРІР»СЏРµС‚СЃСЏ РјРіРЅРѕРІРµРЅРЅРѕ
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


    console.log("РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ РїСЂРёР»РѕР¶РµРЅРёСЏ...");

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
    try { geminiApiKeys = JSON.parse(localStorage.getItem('geminiApiKeys')) || []; } catch (e) { geminiApiKeys = []; }
    geminiApiKey = geminiApiKeys.length > 0 ? geminiApiKeys[0] : '';
    geminiModelId = localStorage.getItem('geminiModelId') || 'gemini-3.1-flash-lite-preview';
    llmostApiKey = localStorage.getItem('llmostApiKey') || '';
    llmostModelId = localStorage.getItem('llmostModelId') || 'openai/gpt-4';
    openrouterApiKey = localStorage.getItem('openrouterApiKey') || '';
    openrouterModelId = localStorage.getItem('openrouterModelId') || 'anthropic/claude-3-haiku';
    deepseekApiKey = localStorage.getItem('deepseekApiKey') || '';
    deepseekModelId = localStorage.getItem('deepseekModelId') || 'deepseek-chat';
    omnirouteApiKey = localStorage.getItem('omnirouteApiKey') || '';
    omnirouteModelId = localStorage.getItem('omnirouteModelId') || 'anthropic/claude-3-sonnet';
    omnirouteBaseUrl = localStorage.getItem('omnirouteBaseUrl') || 'https://api.omniroute.ai/v1/chat/completions';
    localApiUrl = localStorage.getItem('localApiUrl') || 'http://localhost:1234/v1/chat/completions';
    localModelId = localStorage.getItem('localModelId') || 'local-model';
    imgApiProvider = localStorage.getItem('imgApiProvider') || 'pollinations';
    imgApiKey = localStorage.getItem('imgApiKey') || '';
    
    aiPlayerProvider = localStorage.getItem('aiPlayerProvider') || 'openrouter';
    aiPlayerModelId = localStorage.getItem('aiPlayerModelId') || 'google/gemma-2-9b-it:free';
    aiPlayerApiKey = localStorage.getItem('aiPlayerApiKey') || '';
    aiPlayerLocalUrl = localStorage.getItem('aiPlayerLocalUrl') || 'http://localhost:1234/v1/chat/completions';
    aiPlayerTurnLimit = parseInt(localStorage.getItem('aiPlayerTurnLimit')) || 20;

    imgModelId = localStorage.getItem('imgModelId') || 'dall-e-3';
    enableImageGeneration = localStorage.getItem('enableImageGeneration') !== 'false';
    enableLocalMap = localStorage.getItem('enableLocalMap') !== 'false';
    enableDeepSetup = localStorage.getItem('enableDeepSetup') === 'true';

    initSettingsUI();

    // РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ ModKit Р”Рћ Р·Р°РіСЂСѓР·РєРё Р»РѕСЂР° Рё Р»РѕРєР°С†РёР№
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

    const results = await Promise.allSettled([
        (typeof window.ensureRuntimeDataLoaded === 'function'
            ? window.ensureRuntimeDataLoaded().then(() => syncRuntimeRegistries())
            : Promise.resolve()),
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
        console.error("РљР РРўРР§Р•РЎРљРђРЇ РћРЁРР‘РљРђ: РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РѕСЃРЅРѕРІРЅС‹Рµ С„Р°Р№Р»С‹ РёРіСЂС‹:");
        failedLoads.forEach(result => console.error(result.reason));

        if (worldLore.startsWith('РћС€РёР±РєР°:') || Object.keys(globalLocations).length === 0) {
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

    // equipmentElements С‚РµРїРµСЂСЊ Р·Р°РїРѕР»РЅСЏРµС‚СЃСЏ РґРёРЅР°РјРёС‡РµСЃРєРё РІ populateEquipmentUI()

    startBackgroundChanger();
    updateDynamicUIText();

    console.log("РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ РїСЂРёР»РѕР¶РµРЅРёСЏ Р·Р°РІРµСЂС€РµРЅР°.");
}


// --- РЈРџР РђР’Р›Р•РќРР• UI РќРђРЎРўР РћР•Рљ ---
function initSettingsUI() {
    const providerSelect = document.getElementById('api-provider-select');
    const modelIdInput = document.getElementById('model-id-input');

    // РќР°С…РѕРґРёРј РІСЃРµ РіСЂСѓРїРїС‹ РЅР°СЃС‚СЂРѕРµРє
    const settingsGroups = {
        gemini: document.getElementById('gemini-settings-group'),
        llmost: document.getElementById('llmost-settings-group'),
        openrouter: document.getElementById('openrouter-settings-group'),
        deepseek: document.getElementById('deepseek-settings-group'),
        omniroute: document.getElementById('omniroute-settings-group'),
        local: document.getElementById('local-settings-group')
    };

    // РќР°С…РѕРґРёРј РІСЃРµ РїРѕР»СЏ РґР»СЏ API РєР»СЋС‡РµР№
    const keyInputs = {
        gemini: document.getElementById('gemini-api-key-input'),
        llmost: document.getElementById('llmost-api-key-input'),
        openrouter: document.getElementById('openrouter-api-key-input'),
        deepseek: document.getElementById('deepseek-api-key-input'),
        omniroute: document.getElementById('omniroute-api-key-input')
    };

    const localUrlInput = document.getElementById('local-url-input');

    // Р¤СѓРЅРєС†РёСЏ РґР»СЏ РїРµСЂРµРєР»СЋС‡РµРЅРёСЏ РІРёРґРёРјРѕСЃС‚Рё Рё Р·Р°РіСЂСѓР·РєРё РґР°РЅРЅС‹С…
    const switchProviderView = (provider) => {
        // 1. РЎРєСЂС‹РІР°РµРј РІСЃРµ РіСЂСѓРїРїС‹
        Object.values(settingsGroups).forEach(group => {
            if (group) group.style.display = 'none';
        });

        // 2. РџРѕРєР°Р·С‹РІР°РµРј РЅСѓР¶РЅСѓСЋ РіСЂСѓРїРїСѓ
        if (settingsGroups[provider]) {
            settingsGroups[provider].style.display = 'block';
        }

        // 3. Р—Р°РіСЂСѓР¶Р°РµРј Рё СѓСЃС‚Р°РЅР°РІР»РёРІР°РµРј ID РјРѕРґРµР»Рё РґР»СЏ РІС‹Р±СЂР°РЅРЅРѕРіРѕ РїСЂРѕРІР°Р№РґРµСЂР°
        let modelId = '';
        switch (provider) {
            case 'gemini': modelId = geminiModelId; break;
            case 'llmost': modelId = llmostModelId; break;
            case 'openrouter': modelId = openrouterModelId; break;
            case 'deepseek': modelId = deepseekModelId; break;
            case 'omniroute': modelId = omnirouteModelId; break;
            case 'local': modelId = localModelId; break; // Р”Р»СЏ LM Studio СЌС‚Рѕ С‚РѕР¶Рµ ID
            case 'dummy': modelId = 'dummy-test-model'; break;
        }
        if (modelIdInput) modelIdInput.value = modelId;

        // РћР±РЅРѕРІР»СЏРµРј Р·Р°РіРѕР»РѕРІРѕРє РґР»СЏ РїРѕР»СЏ РІРІРѕРґР° РјРѕРґРµР»Рё
        const modelLabel = document.querySelector('#model-id-input-group label');
        if (modelLabel) modelLabel.textContent = t('settingsMenu.modelIdLabelFor', { provider: provider.charAt(0).toUpperCase() + provider.slice(1) });
    };

    // РЈСЃС‚Р°РЅР°РІР»РёРІР°РµРј РЅР°С‡Р°Р»СЊРЅС‹Рµ Р·РЅР°С‡РµРЅРёСЏ РёР· РіР»РѕР±Р°Р»СЊРЅС‹С… РїРµСЂРµРјРµРЅРЅС‹С…
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

        // РџРѕРєР°Р·Р°С‚СЊ/СЃРєСЂС‹С‚СЊ СЌСЂРѕС‚РёС‡РµСЃРєРёРµ РЅР°СЃС‚СЂРѕР№РєРё РІ Р·Р°РІРёСЃРёРјРѕСЃС‚Рё РѕС‚ NSFW
        if (eroticSettingsGroup) {
            eroticSettingsGroup.style.display = allowNSFW ? 'block' : 'none';
        }

        // РћР±СЂР°Р±РѕС‚С‡РёРє РёР·РјРµРЅРµРЅРёСЏ NSFW С‡РµРєР±РѕРєСЃР°
        nsfwCheckbox.addEventListener('change', (e) => {
            if (eroticSettingsGroup) {
                eroticSettingsGroup.style.display = e.target.checked ? 'block' : 'none';
            }
        });
    }

    // РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ СЌСЂРѕС‚РёС‡РµСЃРєРёС… РЅР°СЃС‚СЂРѕРµРє
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

    // РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ РІРЅСѓС‚СЂРµРЅРЅРёС… РІРєР»Р°РґРѕРє (Sub-tabs) С‚РѕР»СЊРєРѕ РґР»СЏ РЅР°СЃС‚СЂРѕРµРє
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


    // РЈСЃС‚Р°РЅР°РІР»РёРІР°РµРј РїРµСЂРІРѕРЅР°С‡Р°Р»СЊРЅРѕРµ РѕС‚РѕР±СЂР°Р¶РµРЅРёРµ
    switchProviderView(currentApiProvider);

    // Р’РµС€Р°РµРј РѕР±СЂР°Р±РѕС‚С‡РёРє СЃРѕР±С‹С‚РёСЏ
    if (providerSelect) {
        providerSelect.addEventListener('change', () => {
            currentApiProvider = providerSelect.value;
            switchProviderView(currentApiProvider);
        });
    }

    // РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ РІРєР»Р°РґРѕРє РЅР°СЃС‚СЂРѕРµРє
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

    // РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ РїРѕР»Р·СѓРЅРєРѕРІ Р·РІСѓРєР°
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
            playSfx(clickSfx); // РџСЂРѕРёРіСЂС‹РІР°РµРј Р·РІСѓРє РґР»СЏ С‚РµСЃС‚Р° РіСЂРѕРјРєРѕСЃС‚Рё
        });
    }
}

// --- РЎРћРҐР РђРќР•РќРР• РќРђРЎРўР РћР•Рљ ---
// Р—Р°РјРµРЅРё СЃС‚Р°СЂСѓСЋ С„СѓРЅРєС†РёСЋ saveApiKey РЅР° СЌС‚Сѓ (РёР»Рё РѕР±РЅРѕРІРё СЃР»СѓС€Р°С‚РµР»СЊ СЃРѕР±С‹С‚РёСЏ)
function getFriendlyApiErrorMessage(status, rawText) {
    // РҐР°СЂРґРєРѕРґРЅС‹Р№ СЃР»РѕРІР°СЂСЊ РЅР° СЃР»СѓС‡Р°Р№ СЃР±РѕСЏ СЃРёСЃС‚РµРјС‹ Р»РѕРєР°Р»РёР·Р°С†РёРё (t())
    const fallbacks = {
        400: "РќРµРІРµСЂРЅС‹Р№ Р·Р°РїСЂРѕСЃ. Р’РѕР·РјРѕР¶РЅРѕ, РєРѕРЅС‚РµРєСЃС‚ СЃР»РёС€РєРѕРј РІРµР»РёРє РёР»Рё РјРѕРґРµР»СЊ РЅРµ РїРѕРґРґРµСЂР¶РёРІР°РµС‚ РІС‹Р±СЂР°РЅРЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹.",
        401: "РћС€РёР±РєР° Р°РІС‚РѕСЂРёР·Р°С†РёРё. РџСЂРѕРІРµСЂСЊС‚Рµ РїСЂР°РІРёР»СЊРЅРѕСЃС‚СЊ API РєР»СЋС‡Р°.",
        402: "РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ СЃСЂРµРґСЃС‚РІ РЅР° Р±Р°Р»Р°РЅСЃРµ РїСЂРѕРІР°Р№РґРµСЂР°. РџРѕРїРѕР»РЅРёС‚Рµ СЃС‡С‘С‚ РёР»Рё СЃРјРµРЅРёС‚Рµ РјРѕРґРµР»СЊ.",
        403: "Р”РѕСЃС‚СѓРї Р·Р°РїСЂРµС‰РµРЅ. РџСЂРѕРІРµСЂСЊС‚Рµ API РєР»СЋС‡ РёР»Рё РѕРіСЂР°РЅРёС‡РµРЅРёСЏ РїСЂРѕРІР°Р№РґРµСЂР°.",
        429: "РЎР»РёС€РєРѕРј РјРЅРѕРіРѕ Р·Р°РїСЂРѕСЃРѕРІ (Р›РёРјРёС‚ РёСЃС‡РµСЂРїР°РЅ). Р•СЃР»Рё СЌС‚Рѕ Р±РµСЃРїР»Р°С‚РЅР°СЏ РјРѕРґРµР»СЊ, РїРѕРґРѕР¶РґРёС‚Рµ РЅРµРјРЅРѕРіРѕ РёР»Рё СЃРјРµРЅРёС‚Рµ РјРѕРґРµР»СЊ.",
        500: "Р’РЅСѓС‚СЂРµРЅРЅСЏСЏ РѕС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРѕРІР°Р№РґРµСЂР° РР.",
        502: "РџР»РѕС…РѕР№ С€Р»СЋР·. РЎРµСЂРІРµСЂ РїСЂРѕРІР°Р№РґРµСЂР° РР РІСЂРµРјРµРЅРЅРѕ РЅРµРґРѕСЃС‚СѓРїРµРЅ.",
        503: "РЎРµСЂРІРµСЂ РїСЂРѕРІР°Р№РґРµСЂР° РР РїРµСЂРµРіСЂСѓР¶РµРЅ. РџРѕРІС‚РѕСЂРёС‚Рµ РїРѕРїС‹С‚РєСѓ РїРѕР·Р¶Рµ.",
        504: "Р’СЂРµРјСЏ РѕР¶РёРґР°РЅРёСЏ РѕС‚РІРµС‚Р° РѕС‚ СЃРµСЂРІРµСЂР° РР РёСЃС‚РµРєР»Рѕ.",
        'network': "РћС€РёР±РєР° СЃРµС‚Рё. РџСЂРѕРІРµСЂСЊС‚Рµ РїРѕРґРєР»СЋС‡РµРЅРёРµ Рє РёРЅС‚РµСЂРЅРµС‚Сѓ РёР»Рё РѕС‚РєР»СЋС‡РёС‚Рµ VPN/AdBlock."
    };
    
    let friendlyText = t(`apiErrors.${status}`, null, "");
    // Р•СЃР»Рё РїРµСЂРµРІРѕРґ РЅРµ РЅР°Р№РґРµРЅ РёР»Рё РІРµСЂРЅСѓР» СЃР°Рј РєР»СЋС‡
    if (!friendlyText || friendlyText === `apiErrors.${status}`) {
        friendlyText = fallbacks[status] || t('apiErrors.unknown', null, "РќРµРёР·РІРµСЃС‚РЅР°СЏ РѕС€РёР±РєР° API.");
    }
    return `${friendlyText}\n\n[РљРѕРґ: ${status}] Р”РµС‚Р°Р»Рё: ${rawText}`;
}


async function pingProvider() {
    const provider = document.getElementById('api-provider-select').value;
    const resultDiv = document.getElementById('ping-provider-result');
    const btn = document.getElementById('ping-provider-btn');
    if (!resultDiv || !btn) return;

    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<i class="fas fa-spinner fa-spin" style="color: #f39c12;"></i> РџРёРЅРі РїСЂРѕРІР°Р№РґРµСЂР°...';
    btn.disabled = true;

    let url = ''; let headers = {}; let key = '';
    try {
        switch (provider) {
            case 'gemini':
                key = document.getElementById('gemini-api-key-input').value.trim() || geminiApiKey;
                if (!key) throw new Error("РљР»СЋС‡ РЅРµ РІРІРµРґРµРЅ");
                url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
                break;
            case 'openrouter':
                key = document.getElementById('openrouter-api-key-input').value.trim() || openrouterApiKey;
                if (!key) throw new Error("РљР»СЋС‡ РЅРµ РІРІРµРґРµРЅ");
                url = "https://openrouter.ai/api/v1/auth/key";
                headers['Authorization'] = `Bearer ${key}`;
                break;
            case 'llmost':
                key = document.getElementById('llmost-api-key-input').value.trim() || llmostApiKey;
                if (!key) throw new Error("РљР»СЋС‡ РЅРµ РІРІРµРґРµРЅ");
                url = "https://llmost.ru/api/v1/models";
                headers['Authorization'] = `Bearer ${key}`;
                break;
            case 'deepseek':
                key = document.getElementById('deepseek-api-key-input').value.trim() || deepseekApiKey;
                if (!key) throw new Error("РљР»СЋС‡ РЅРµ РІРІРµРґРµРЅ");
                url = "https://api.deepseek.com/models";
                headers['Authorization'] = `Bearer ${key}`;
                headers['Accept'] = 'application/json';
                break;
            case 'omniroute':
                key = document.getElementById('omniroute-api-key-input').value.trim() || omnirouteApiKey;
                let baseUrl = document.getElementById('omniroute-base-url-input').value.trim() || omnirouteBaseUrl;
                if (!key) throw new Error("РљР»СЋС‡ РЅРµ РІРІРµРґРµРЅ");
                url = baseUrl.replace(/\/chat\/completions\/?$/, '/models');
                headers['Authorization'] = `Bearer ${key}`;
                break;
            case 'local':
                let lUrl = document.getElementById('local-url-input').value.trim() || localApiUrl;
                url = lUrl.replace(/\/chat\/completions\/?$/, '/models');
                break;
            case 'dummy':
                resultDiv.innerHTML = '<span style="color: #2ecc71;"><i class="fas fa-check"></i> Р—Р°РіР»СѓС€РєР° РіРѕС‚РѕРІР°!</span>';
                btn.disabled = false;
                setTimeout(() => resultDiv.style.display = 'none', 3000);
                return;
        }

        const response = await fetch(url, { method: 'GET', headers: headers });
        if (response.ok) {
            resultDiv.innerHTML = `<span style="color: #2ecc71;"><i class="fas fa-check"></i> РЎРѕРµРґРёРЅРµРЅРёРµ СѓСЃС‚Р°РЅРѕРІР»РµРЅРѕ! РљР»СЋС‡ РІР°Р»РёРґРµРЅ.</span>`;
        } else {
            const errText = await response.text();
            let shortMsg = t(`apiErrors.${response.status}`, null, `РћС€РёР±РєР° ${response.status}`);
            resultDiv.innerHTML = `<span style="color: #e74c3c;" title="${errText.replace(/"/g, '&quot;')}"><i class="fas fa-times"></i> ${shortMsg} (РљРѕРґ: ${response.status})</span>`;
        }
    } catch (e) {
        let shortMsg = e.message.includes('fetch') ? t('apiErrors.network', null, 'РћС€РёР±РєР° СЃРµС‚Рё') : e.message;
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
                if (!key) throw new Error("РљР»СЋС‡ РЅРµ РІРІРµРґРµРЅ");
                url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
                isGemini = true;
                break;
            case 'openrouter':
                key = document.getElementById('openrouter-api-key-input').value.trim() || openrouterApiKey;
                if (!key) throw new Error("РљР»СЋС‡ РЅРµ РІРІРµРґРµРЅ");
                url = "https://openrouter.ai/api/v1/models";
                headers['Authorization'] = `Bearer ${key}`;
                break;
            case 'llmost':
                key = document.getElementById('llmost-api-key-input').value.trim() || llmostApiKey;
                if (!key) throw new Error("РљР»СЋС‡ РЅРµ РІРІРµРґРµРЅ");
                url = "https://llmost.ru/api/v1/models";
                headers['Authorization'] = `Bearer ${key}`;
                break;
            case 'deepseek':
                key = document.getElementById('deepseek-api-key-input').value.trim() || deepseekApiKey;
                if (!key) throw new Error("РљР»СЋС‡ РЅРµ РІРІРµРґРµРЅ");
                url = "https://api.deepseek.com/models";
                headers['Authorization'] = `Bearer ${key}`;
                headers['Accept'] = 'application/json';
                break;
            case 'omniroute':
                key = document.getElementById('omniroute-api-key-input').value.trim() || omnirouteApiKey;
                let baseUrl = document.getElementById('omniroute-base-url-input').value.trim() || omnirouteBaseUrl;
                if (!key) throw new Error("РљР»СЋС‡ РЅРµ РІРІРµРґРµРЅ");
                url = baseUrl.replace(/\/chat\/completions\/?$/, '/models');
                headers['Authorization'] = `Bearer ${key}`;
                break;
            case 'local':
                let lUrl = document.getElementById('local-url-input').value.trim() || localApiUrl;
                url = lUrl.replace(/\/chat\/completions\/?$/, '/models');
                break;
            case 'dummy':
                if (typeof showCustomAlert === 'function') showCustomAlert("Р—Р°РіР»СѓС€РєР° РЅРµ РёРјРµРµС‚ СЃРїРёСЃРєР° РјРѕРґРµР»РµР№.");
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
                        id: id, name: m.displayName || id, desc: m.description || 'РћС„РёС†РёР°Р»СЊРЅР°СЏ РјРѕРґРµР»СЊ Google Gemini.',
                        type: type, free: false, context: m.inputTokenLimit || null, priceText: 'Р›РёРјРёС‚С‹ API (Free Tier)',
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
                    if (isFree) priceText = 'Р‘РµСЃРїР»Р°С‚РЅРѕ';
                    else if (p_prompt >= 0 && p_comp >= 0) {
                        let pr_str = p_prompt < 0.01 ? p_prompt.toFixed(4) : p_prompt.toFixed(2);
                        let cmp_str = p_comp < 0.01 ? p_comp.toFixed(4) : p_comp.toFixed(2);
                        priceText = `$${pr_str} / $${cmp_str} Р·Р° 1M`;
                    } else priceText = 'РџР»Р°С‚РЅР°СЏ';
                    
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
                    return { id: m.id, name: m.name || m.id, desc: '', type: 'text', free: false, priceText: 'РџРѕ С‚Р°СЂРёС„Сѓ РїСЂРѕРІР°Р№РґРµСЂР°', caching: false, thinking: isThinking };
                });
            } else if (Array.isArray(data)) {
                models = data.map(m => {
                    let idLower = (m.id || m.name || "").toLowerCase();
                    let isThinking = idLower.includes('r1') || idLower.includes('o1') || idLower.includes('o3') || idLower.includes('thinking') || idLower.includes('reasoning');
                    return { id: m.id || m.name, name: m.name || m.id, desc: '', type: 'text', free: false, priceText: 'РџРѕ С‚Р°СЂРёС„Сѓ РїСЂРѕРІР°Р№РґРµСЂР°', caching: false, thinking: isThinking };
                });
            }

            models = models.filter(m => m.type !== 'embedding');

            if (models.length > 0) {
                showModelSelector(models);
            } else {
                if (typeof showCustomAlert === 'function') showCustomAlert("РЎРІСЏР·СЊ РµСЃС‚СЊ, РЅРѕ СЃРїРёСЃРѕРє РјРѕРґРµР»РµР№ РїСѓСЃС‚.");
            }
        } else {
            const errText = await response.text();
            if (typeof showCustomAlert === 'function') showCustomAlert(getFriendlyApiErrorMessage(response.status, errText));
        }
    } catch (e) {
        let shortMsg = e.message.includes('fetch') ? t('apiErrors.network', null, 'РћС€РёР±РєР° СЃРµС‚Рё') : e.message;
        if (typeof showCustomAlert === 'function') showCustomAlert("РћС€РёР±РєР° РїРѕР»СѓС‡РµРЅРёСЏ СЃРїРёСЃРєР° РјРѕРґРµР»РµР№: " + shortMsg);
    } finally {
        btn.innerHTML = originalIcon;
        btn.disabled = false;
    }
}


function getFriendlyApiErrorMessage(status, rawText) {
    // РҐР°СЂРґРєРѕРґРЅС‹Р№ СЃР»РѕРІР°СЂСЊ РЅР° СЃР»СѓС‡Р°Р№ СЃР±РѕСЏ СЃРёСЃС‚РµРјС‹ Р»РѕРєР°Р»РёР·Р°С†РёРё (t())
    const fallbacks = {
        400: "РќРµРІРµСЂРЅС‹Р№ Р·Р°РїСЂРѕСЃ. Р’РѕР·РјРѕР¶РЅРѕ, РєРѕРЅС‚РµРєСЃС‚ СЃР»РёС€РєРѕРј РІРµР»РёРє РёР»Рё РјРѕРґРµР»СЊ РЅРµ РїРѕРґРґРµСЂР¶РёРІР°РµС‚ РІС‹Р±СЂР°РЅРЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹.",
        401: "РћС€РёР±РєР° Р°РІС‚РѕСЂРёР·Р°С†РёРё. РџСЂРѕРІРµСЂСЊС‚Рµ РїСЂР°РІРёР»СЊРЅРѕСЃС‚СЊ API РєР»СЋС‡Р°.",
        402: "РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ СЃСЂРµРґСЃС‚РІ РЅР° Р±Р°Р»Р°РЅСЃРµ РїСЂРѕРІР°Р№РґРµСЂР°. РџРѕРїРѕР»РЅРёС‚Рµ СЃС‡С‘С‚ РёР»Рё СЃРјРµРЅРёС‚Рµ РјРѕРґРµР»СЊ.",
        403: "Р”РѕСЃС‚СѓРї Р·Р°РїСЂРµС‰РµРЅ. РџСЂРѕРІРµСЂСЊС‚Рµ API РєР»СЋС‡ РёР»Рё РѕРіСЂР°РЅРёС‡РµРЅРёСЏ РїСЂРѕРІР°Р№РґРµСЂР°.",
        429: "РЎР»РёС€РєРѕРј РјРЅРѕРіРѕ Р·Р°РїСЂРѕСЃРѕРІ (Р›РёРјРёС‚ РёСЃС‡РµСЂРїР°РЅ). Р•СЃР»Рё СЌС‚Рѕ Р±РµСЃРїР»Р°С‚РЅР°СЏ РјРѕРґРµР»СЊ, РїРѕРґРѕР¶РґРёС‚Рµ РЅРµРјРЅРѕРіРѕ РёР»Рё СЃРјРµРЅРёС‚Рµ РјРѕРґРµР»СЊ.",
        500: "Р’РЅСѓС‚СЂРµРЅРЅСЏСЏ РѕС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРѕРІР°Р№РґРµСЂР° РР.",
        502: "РџР»РѕС…РѕР№ С€Р»СЋР·. РЎРµСЂРІРµСЂ РїСЂРѕРІР°Р№РґРµСЂР° РР РІСЂРµРјРµРЅРЅРѕ РЅРµРґРѕСЃС‚СѓРїРµРЅ.",
        503: "РЎРµСЂРІРµСЂ РїСЂРѕРІР°Р№РґРµСЂР° РР РїРµСЂРµРіСЂСѓР¶РµРЅ. РџРѕРІС‚РѕСЂРёС‚Рµ РїРѕРїС‹С‚РєСѓ РїРѕР·Р¶Рµ.",
        504: "Р’СЂРµРјСЏ РѕР¶РёРґР°РЅРёСЏ РѕС‚РІРµС‚Р° РѕС‚ СЃРµСЂРІРµСЂР° РР РёСЃС‚РµРєР»Рѕ.",
        'network': "РћС€РёР±РєР° СЃРµС‚Рё. РџСЂРѕРІРµСЂСЊС‚Рµ РїРѕРґРєР»СЋС‡РµРЅРёРµ Рє РёРЅС‚РµСЂРЅРµС‚Сѓ РёР»Рё РѕС‚РєР»СЋС‡РёС‚Рµ VPN/AdBlock."
    };
    
    let friendlyText = t(`apiErrors.${status}`, null, "");
    // Р•СЃР»Рё РїРµСЂРµРІРѕРґ РЅРµ РЅР°Р№РґРµРЅ РёР»Рё РІРµСЂРЅСѓР» СЃР°Рј РєР»СЋС‡
    if (!friendlyText || friendlyText === `apiErrors.${status}`) {
        friendlyText = fallbacks[status] || t('apiErrors.unknown', null, "РќРµРёР·РІРµСЃС‚РЅР°СЏ РѕС€РёР±РєР° API.");
    }
    return `${friendlyText}\n\n[РљРѕРґ: ${status}] Р”РµС‚Р°Р»Рё: ${rawText}`;
}


async function testApiConnection() {
    const provider = document.getElementById('api-provider-select').value;
    const resultDiv = document.getElementById('test-api-result');
    const btn = document.getElementById('test-api-connection-btn');

    if (!resultDiv || !btn) return;

    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<i class="fas fa-spinner fa-spin" style="color: #f39c12;"></i> РџРѕРґРєР»СЋС‡РµРЅРёРµ...';
    btn.disabled = true;

    let url = '';
    let headers = {};
    let key = '';
    let isGemini = false;

    try {
        switch (provider) {
            case 'gemini':
                key = document.getElementById('gemini-api-key-input').value.trim() || geminiApiKey;
                if (!key) throw new Error("РљР»СЋС‡ РЅРµ РІРІРµРґРµРЅ");
                url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
                isGemini = true;
                break;
            case 'openrouter':
                key = document.getElementById('openrouter-api-key-input').value.trim() || openrouterApiKey;
                if (!key) throw new Error("РљР»СЋС‡ РЅРµ РІРІРµРґРµРЅ");
                url = "https://openrouter.ai/api/v1/models";
                headers['Authorization'] = `Bearer ${key}`;
                break;
            case 'llmost':
                key = document.getElementById('llmost-api-key-input').value.trim() || llmostApiKey;
                if (!key) throw new Error("РљР»СЋС‡ РЅРµ РІРІРµРґРµРЅ");
                url = "https://llmost.ru/api/v1/models";
                headers['Authorization'] = `Bearer ${key}`;
                break;
            case 'deepseek':
                key = document.getElementById('deepseek-api-key-input').value.trim() || deepseekApiKey;
                if (!key) throw new Error("РљР»СЋС‡ РЅРµ РІРІРµРґРµРЅ");
                url = "https://api.deepseek.com/models";
                headers['Authorization'] = `Bearer ${key}`;
                headers['Accept'] = 'application/json';
                break;
            case 'omniroute':
                key = document.getElementById('omniroute-api-key-input').value.trim() || omnirouteApiKey;
                let baseUrl = document.getElementById('omniroute-base-url-input').value.trim() || omnirouteBaseUrl;
                if (!key) throw new Error("РљР»СЋС‡ РЅРµ РІРІРµРґРµРЅ");
                url = baseUrl.replace(/\/chat\/completions\/?$/, '/models');
                headers['Authorization'] = `Bearer ${key}`;
                break;
            case 'local':
                let lUrl = document.getElementById('local-url-input').value.trim() || localApiUrl;
                url = lUrl.replace(/\/chat\/completions\/?$/, '/models');
                break;
            case 'dummy':
                resultDiv.innerHTML = '<span style="color: #2ecc71;"><i class="fas fa-check"></i> Р—Р°РіР»СѓС€РєР° РіРѕС‚РѕРІР°!</span>';
                btn.disabled = false;
                setTimeout(() => resultDiv.style.display = 'none', 2000);
                return;
        }

        const response = await fetch(url, { method: 'GET', headers: headers });

        if (response.ok) {
            const data = await response.json();
            resultDiv.innerHTML = `<span style="color: #2ecc71;"><i class="fas fa-check"></i> РЈСЃРїРµС€РЅРѕ! Р—Р°РіСЂСѓР·РєР° СЃРїРёСЃРєР°...</span>`;
            
            let models = [];
            if (isGemini && data.models) {
                models = data.models.map(m => {
                    let id = m.name.replace('models/', '');
                    // Р­РІСЂРёСЃС‚РёРєР° С‚РёРїРѕРІ РґР»СЏ Gemini
                    let type = 'text';
                    if (id.includes('vision') || id.includes('image') || id.includes('nano-banana')) type = 'vision';
                    else if (id.includes('tts') || id.includes('audio')) type = 'audio';
                    else if (id.includes('embed')) type = 'embedding';
                    
                    return {
                        id: id,
                        name: m.displayName || id,
                        desc: m.description || 'РћС„РёС†РёР°Р»СЊРЅР°СЏ РјРѕРґРµР»СЊ Google Gemini.',
                        type: type,
                        free: false, // FIX: РЈР±СЂР°Р»Рё Р»РѕР¶РЅС‹Р№ СЃС‚Р°С‚СѓСЃ "Р‘РµСЃРїР»Р°С‚РЅРѕ", С‚Р°Рє РєР°Рє РµСЃС‚СЊ Р¶РµСЃС‚РєРёРµ Р»РёРјРёС‚С‹ (Rate Limits)
                        context: m.inputTokenLimit || null,
                        priceText: 'Р›РёРјРёС‚С‹ API (Free Tier)' // Р§РµСЃС‚РЅРѕРµ РїСЂРµРґСѓРїСЂРµР¶РґРµРЅРёРµ
                    };
                });
            } else if (provider === 'openrouter' && data.data) {
                models = data.data.map(m => {
                    let type = 'text';
                    if (m.id.includes('vision') || (m.architecture && m.architecture.modality && m.architecture.modality.includes('image'))) type = 'vision';
                    
                    // Р Р°СЃС‡РµС‚ С†РµРЅС‹ Р·Р° 1 РјРёР»Р»РёРѕРЅ С‚РѕРєРµРЅРѕРІ (Р·Р°С‰РёС‚Р° РѕС‚ undefined)
                    let p_prompt = m.pricing && m.pricing.prompt ? parseFloat(m.pricing.prompt) * 1000000 : -1;
                    let p_comp = m.pricing && m.pricing.completion ? parseFloat(m.pricing.completion) * 1000000 : -1;
                    
                    let isFree = (p_prompt === 0 && p_comp === 0) || m.id.endsWith(':free');
                    let priceText = '';
                    
                    if (isFree) {
                        priceText = 'Р‘РµСЃРїР»Р°С‚РЅРѕ';
                    } else if (p_prompt >= 0 && p_comp >= 0) {
                        // Р¤РѕСЂРјР°С‚РёСЂСѓРµРј С†РµРЅСѓ: РµСЃР»Рё РјРµРЅСЊС€Рµ С†РµРЅС‚Р°, РїРѕРєР°Р·С‹РІР°РµРј 4 Р·РЅР°РєР°, РёРЅР°С‡Рµ 2
                        let pr_str = p_prompt < 0.01 ? p_prompt.toFixed(4) : p_prompt.toFixed(2);
                        let cmp_str = p_comp < 0.01 ? p_comp.toFixed(4) : p_comp.toFixed(2);
                        priceText = `$${pr_str} / $${cmp_str} Р·Р° 1M`;
                    } else {
                        priceText = 'РџР»Р°С‚РЅР°СЏ';
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
                models = data.data.map(m => ({ id: m.id, name: m.name || m.id, desc: '', type: 'text', free: false, priceText: 'РџРѕ С‚Р°СЂРёС„Сѓ РїСЂРѕРІР°Р№РґРµСЂР°' }));
            } else if (Array.isArray(data)) {
                models = data.map(m => ({ id: m.id || m.name, name: m.name || m.id, desc: '', type: 'text', free: false, priceText: 'РџРѕ С‚Р°СЂРёС„Сѓ РїСЂРѕРІР°Р№РґРµСЂР°' }));
            }

            // РЈР±РёСЂР°РµРј СЌРјР±РµРґРґРёРЅРіРё, РѕРЅРё РЅРµ РЅСѓР¶РЅС‹ РґР»СЏ С‡Р°С‚Р°
            models = models.filter(m => m.type !== 'embedding');

            if (models.length > 0) {
                showModelSelector(models);
                setTimeout(() => resultDiv.style.display = 'none', 2000);
            } else {
                resultDiv.innerHTML = `<span style="color: #f1c40f;"><i class="fas fa-check"></i> РЎРІСЏР·СЊ РµСЃС‚СЊ, РЅРѕ СЃРїРёСЃРѕРє РјРѕРґРµР»РµР№ РїСѓСЃС‚.</span>`;
            }

        } else {
            const errText = await response.text();
            let shortMsg = t(`apiErrors.${response.status}`, null, `РћС€РёР±РєР° ${response.status}`);
            resultDiv.innerHTML = `<span style="color: #e74c3c;" title="${errText.replace(/"/g, '&quot;')}"><i class="fas fa-times"></i> ${shortMsg} (РљРѕРґ: ${response.status})</span>`;
            console.error("Ping error:", errText);
        }
    } catch (e) {
        let shortMsg = e.message.includes('fetch') ? t('apiErrors.network', null, 'РћС€РёР±РєР° СЃРµС‚Рё') : e.message;
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
    
    // РЎР±СЂРѕСЃ РєРЅРѕРїРѕРє С„РёР»СЊС‚СЂРѕРІ
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

    // РћР±СЂР°Р±РѕС‚С‡РёРє РїРѕРёСЃРєР°
    searchInput.oninput = () => applyModelFilters();

    // РћР±СЂР°Р±РѕС‚С‡РёРєРё С„РёР»СЊС‚СЂРѕРІ
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
        // 1. РџРѕРёСЃРє РїРѕ С‚РµРєСЃС‚Сѓ
        const matchesSearch = m.id.toLowerCase().includes(query) || (m.name && m.name.toLowerCase().includes(query));
        if (!matchesSearch) return false;
        
        // 2. Р¤РёР»СЊС‚СЂ РїРѕ РєР°С‚РµРіРѕСЂРёРё
        if (currentModelFilter === 'all') return true;
        if (currentModelFilter === 'free') return m.free === true;
        return m.type === currentModelFilter;
    });
    
    renderModelList(filtered);
}

function applyModelFilters() {
    const query = document.getElementById('model-search-input').value.toLowerCase();
    
    const filtered = currentModelsList.filter(m => {
        // 1. РџРѕРёСЃРє РїРѕ С‚РµРєСЃС‚Сѓ
        const matchesSearch = m.id.toLowerCase().includes(query) || (m.name && m.name.toLowerCase().includes(query));
        if (!matchesSearch) return false;
        
        // 2. Р¤РёР»СЊС‚СЂ РїРѕ РєР°С‚РµРіРѕСЂРёРё
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
    
    if (countBadge) countBadge.textContent = `${models.length} РјРѕРґРµР»РµР№`;
    
    if (models.length === 0) {
        container.innerHTML = '<div style="padding: 20px; color: #7f8c8d; text-align: center; font-style: italic;">РџРѕ РІР°С€РµРјСѓ Р·Р°РїСЂРѕСЃСѓ РЅРёС‡РµРіРѕ РЅРµ РЅР°Р№РґРµРЅРѕ.</div>';
        return;
    }

    models.forEach(m => {
        const item = document.createElement('div');
        item.className = 'model-card';
        
        let badgesHtml = '';
        if (m.free) badgesHtml += `<span class="model-badge badge-free"><i class="fas fa-gift"></i> Р‘РµСЃРїР»Р°С‚РЅРѕ</span>`;
        else if (m.priceText) badgesHtml += `<span class="model-badge badge-price"><i class="fas fa-coins"></i> ${m.priceText}</span>`;
        
        if (m.context) {
            let ctxStr = m.context >= 1000 ? Math.round(m.context/1000) + 'k' : m.context;
            badgesHtml += `<span class="model-badge badge-ctx"><i class="fas fa-brain"></i> ${ctxStr} ctx</span>`;
        }
        
        if (m.type === 'vision') badgesHtml += `<span class="model-badge badge-type-vision"><i class="fas fa-eye"></i> Vision</span>`;
        if (m.type === 'audio') badgesHtml += `<span class="model-badge badge-type-audio"><i class="fas fa-volume-up"></i> Audio</span>`;
        
        if (m.caching) badgesHtml += `<span class="model-badge badge-caching" title="РџРѕРґРґРµСЂР¶РёРІР°РµС‚ Prompt Caching (СЃРЅРёР¶Р°РµС‚ С†РµРЅСѓ Рё СѓСЃРєРѕСЂСЏРµС‚ РѕС‚РІРµС‚)"><i class="fas fa-bolt"></i> Caching</span>`;
        if (m.thinking) badgesHtml += `<span class="model-badge badge-thinking" title="РџРѕРґРґРµСЂР¶РёРІР°РµС‚ СЂРµР¶РёРј СЂР°Р·РјС‹С€Р»РµРЅРёСЏ (Reasoning)"><i class="fas fa-brain"></i> Thinking</span>`;

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
                
                // РђРІС‚РѕРјР°С‚РёС‡РµСЃРєРё СЃРѕС…СЂР°РЅСЏРµРј РЅР°СЃС‚СЂРѕР№РєРё РїСЂРё РІС‹Р±РѕСЂРµ РјРѕРґРµР»Рё
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

    // РЎРѕС…СЂР°РЅРµРЅРёРµ СЌСЂРѕС‚РёС‡РµСЃРєРёС… РЅР°СЃС‚СЂРѕРµРє
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

    // РЎРѕС…СЂР°РЅСЏРµРј ID РјРѕРґРµР»Рё РґР»СЏ РўР•РљРЈР©Р•Р“Рћ РїСЂРѕРІР°Р№РґРµСЂР°
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

    // РЎРѕС…СЂР°РЅСЏРµРј РєР»СЋС‡Рё Рё URL
    const geminiKeyInput = document.getElementById('gemini-api-key-input')?.value.trim() || '';
    geminiApiKeys = geminiKeyInput.split(/[\n,]+/).map(k => k.trim()).filter(k => k.length > 10);
    geminiApiKey = geminiApiKeys.length > 0 ? geminiApiKeys[0] : '';
    localStorage.setItem('geminiApiKeys', JSON.stringify(geminiApiKeys));
    currentGeminiKeyIndex = 0;

    const llmostKey = document.getElementById('llmost-api-key-input')?.value.trim() || '';
    llmostApiKey = llmostKey;
    localStorage.setItem('llmostApiKey', llmostKey);

    const openrouterKey = document.getElementById('openrouter-api-key-input')?.value.trim() || '';
    openrouterApiKey = openrouterKey;
    localStorage.setItem('openrouterApiKey', openrouterKey);

    const deepseekKey = document.getElementById('deepseek-api-key-input')?.value.trim() || '';
    deepseekApiKey = deepseekKey;
    localStorage.setItem('deepseekApiKey', deepseekKey);

    const omnirouteKey = document.getElementById('omniroute-api-key-input')?.value.trim() || '';
    omnirouteApiKey = omnirouteKey;
    localStorage.setItem('omnirouteApiKey', omnirouteKey);

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
    localStorage.setItem('imgApiKey', imgApiKey);
    
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
    localStorage.setItem('aiPlayerApiKey', aiPlayerApiKey);
    localStorage.setItem('aiPlayerLocalUrl', aiPlayerLocalUrl);
    aiPlayerTurnLimit = parseInt(document.getElementById('ai-player-turn-limit')?.value) || 0;
    localStorage.setItem('aiPlayerTurnLimit', aiPlayerTurnLimit);



    // РЎРѕС…СЂР°РЅСЏРµРј Р·РІСѓРє
    localStorage.setItem('musicVolume', musicVolume);
    localStorage.setItem('sfxVolume', sfxVolume);


    const autoSaveSelect = document.getElementById('autosave-interval-select');
    if (autoSaveSelect) {
        autoSaveIntervalMs = parseInt(autoSaveSelect.value, 10);
        localStorage.setItem('autoSaveInterval', autoSaveIntervalMs);
        if (typeof startAutoSaveTimer === 'function') startAutoSaveTimer();
    }

    // РћР±РЅРѕРІР»СЏРµРј РіР»РѕР±Р°Р»СЊРЅСѓСЋ РїРµСЂРµРјРµРЅРЅСѓСЋ С‚РµРєСѓС‰РµРіРѕ РїСЂРѕРІР°Р№РґРµСЂР°
    currentApiProvider = provider;
    localStorage.setItem('apiProvider', currentApiProvider);



    updateApiKeyStatus();
    showCustomAlert(t('settingsMenu.apiKeySaved', 'РќР°СЃС‚СЂРѕР№РєРё СѓСЃРїРµС€РЅРѕ СЃРѕС…СЂР°РЅРµРЅС‹!'));

    if (document.activeElement) document.activeElement.blur();
}

async function loadEnvironmentCommandsGuide(worldId, langCode) {
    try {
        environmentCommandsGuideData = await loadPromptFromFile('environment_commands_guide');
        console.log(`Р СѓРєРѕРІРѕРґСЃС‚РІРѕ РїРѕ РєРѕРјР°РЅРґР°Рј РѕРєСЂСѓР¶РµРЅРёСЏ РґР»СЏ '${worldId}' (СЏР·С‹Рє: ${langCode}) СѓСЃРїРµС€РЅРѕ Р·Р°РіСЂСѓР¶РµРЅРѕ.`);
    } catch (error) {
        console.error(`РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ СЂСѓРєРѕРІРѕРґСЃС‚РІРѕ РїРѕ РєРѕРјР°РЅРґР°Рј РѕРєСЂСѓР¶РµРЅРёСЏ РґР»СЏ '${worldId}' (СЏР·С‹Рє: ${langCode}):`, error);
        environmentCommandsGuideData = t('error.envGuideNotLoadedLang', { worldId: worldId, lang: langCode, error: error.message }, `// РћС€РёР±РєР°: РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ СЂСѓРєРѕРІРѕРґСЃС‚РІРѕ РїРѕ РєРѕРјР°РЅРґР°Рј РѕРєСЂСѓР¶РµРЅРёСЏ РґР»СЏ РјРёСЂР° '${worldId}' (РЇР·С‹Рє: ${langCode}). ${error.message}`);
    }
}


async function loadSkillsReference() {
    try {
        skillsReferenceData = await loadPromptFromFile('skills_reference');
        console.log(`РЎРїСЂР°РІРѕС‡РЅРёРє СѓРјРµРЅРёР№ СѓСЃРїРµС€РЅРѕ Р·Р°РіСЂСѓР¶РµРЅ.`);
    } catch (error) {
        console.error(`РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ СЃРїСЂР°РІРѕС‡РЅРёРє СѓРјРµРЅРёР№:`, error);
        skillsReferenceData = t('error.skillsRefNotLoaded', '// РћС€РёР±РєР°: РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ СЃРїСЂР°РІРѕС‡РЅРёРє СѓРјРµРЅРёР№.');
    }
}

// --- Р—Р°РіСЂСѓР·РєР° Р”Р°РЅРЅС‹С… РњРёСЂР° ---
async function loadLore(worldId, langCode) {
    if (!worldId) {
        console.error("РќРµ СѓРґР°РµС‚СЃСЏ Р·Р°РіСЂСѓР·РёС‚СЊ Р»РѕСЂ: worldId РЅРµ РїСЂРµРґРѕСЃС‚Р°РІР»РµРЅ.");
        worldLore = t('error.worldNotSpecified', 'РћС€РёР±РєР°: РњРёСЂ РЅРµ СѓРєР°Р·Р°РЅ.');
        return;
    }

    if (window.ModAPI && window.ModAPI.isTotalConversion) {
        console.log(`[Total Conversion] РџСЂРѕРїСѓСЃРє Р·Р°РіСЂСѓР·РєРё РІР°РЅРёР»СЊРЅРѕРіРѕ Р»РѕСЂР° РјРёСЂР°.`);
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
    console.log(`РџРѕРїС‹С‚РєР° Р·Р°РіСЂСѓР·РёС‚СЊ Р»РѕСЂ РёР·: ${filePath}`);

    try {
        const response = await fetch(`${filePath}?t=${Date.now()}`);
        if (!response.ok) {
            throw new Error(`HTTP РѕС€РёР±РєР°! СЃС‚Р°С‚СѓСЃ: ${response.status}. РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ ${response.url}`);
        }
        worldLore = await response.text();
        
        // --- РРќРўР•Р“Р РђР¦РРЇ РњРћР”РћР’ (Р›РћР ) ---
        if (window.ModAPI) {
            const hookData = { lore: worldLore };
            await window.ModAPI.emit('onLoreLoad', hookData, worldId, langCode);
            worldLore = hookData.lore;
        }
        // ------------------------------
        
        console.log(`Р›РѕСЂ РјРёСЂР° РґР»СЏ '${worldId}' (СЏР·С‹Рє: ${langCode}) СѓСЃРїРµС€РЅРѕ Р·Р°РіСЂСѓР¶РµРЅ.`);
    } catch (error) {
        console.error(`РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ Р»РѕСЂ РјРёСЂР° РґР»СЏ '${worldId}' (СЏР·С‹Рє: ${langCode}):`, error);
        worldLore = t('error.loadLoreFailedLang', { worldId: worldId, lang: langCode, error: error.message }, `РћС€РёР±РєР°: РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ Р»РѕСЂ РґР»СЏ РјРёСЂР° '${worldId}' (РЇР·С‹Рє: ${langCode}).`);
        globalLocations = {};
        updateMapDisplay();
    }
}

async function loadGlobalLocations(worldId, langCode, eraId = getRuntimeDefaultEraId()) {
    if (!worldId) {
        console.error("РќРµ СѓРґР°РµС‚СЃСЏ Р·Р°РіСЂСѓР·РёС‚СЊ Р»РѕРєР°С†РёРё: worldId РЅРµ РїСЂРµРґРѕСЃС‚Р°РІР»РµРЅ.");
        globalLocations = {};
        return;
    }

    if (window.ModAPI && window.ModAPI.isTotalConversion) {
        console.log(`[Total Conversion] РџСЂРѕРїСѓСЃРє Р·Р°РіСЂСѓР·РєРё РІР°РЅРёР»СЊРЅС‹С… Р»РѕРєР°С†РёР№.`);
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
    console.log(`РџРѕРїС‹С‚РєР° Р·Р°РіСЂСѓР·РёС‚СЊ Р»РѕРєР°С†РёРё РёР·: ${filePath}`);

    try {
        const response = await fetch(`${filePath}?t=${Date.now()}`);
        if (!response.ok) {
            throw new Error(`HTTP РѕС€РёР±РєР°! СЃС‚Р°С‚СѓСЃ: ${response.status}. РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ ${response.url}`);
        }
        globalLocations = await response.json();
        
        // --- РРќРўР•Р“Р РђР¦РРЇ РњРћР”РћР’ (Р›РћРљРђР¦РР) ---
        if (window.ModAPI) {
            const hookData = { locations: globalLocations };
            await window.ModAPI.emit('onLocationsLoad', hookData, worldId, langCode, eraId);
            globalLocations = hookData.locations;
        }
        // ----------------------------------
        
        console.log(`Р“Р»РѕР±Р°Р»СЊРЅС‹Рµ Р»РѕРєР°С†РёРё РґР»СЏ '${worldId}' (СЏР·С‹Рє: ${langCode}) СѓСЃРїРµС€РЅРѕ Р·Р°РіСЂСѓР¶РµРЅС‹:`, globalLocations);
    } catch (error) {
        console.error(`РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РіР»РѕР±Р°Р»СЊРЅС‹Рµ Р»РѕРєР°С†РёРё РґР»СЏ '${worldId}' (СЏР·С‹Рє: ${langCode}):`, error);
        globalLocations = {};
        if (globalLocationsList) globalLocationsList.innerHTML = `<li>${t('gameInterface.mapPanel.errorLoadingWorldDataLang', { worldId: worldId, lang: langCode })}</li>`;
    }
    updateMapDisplay();
}

// --- РќР°СЃС‚СЂРѕР№РєР° РЎР»СѓС€Р°С‚РµР»РµР№ РЎРѕР±С‹С‚РёР№ ---
function setupEventListeners() {
    // --- Р“Р»Р°РІРЅРѕРµ РјРµРЅСЋ ---
    if (newGameButton) newGameButton.addEventListener('click', startNewGameSetup);
    if (loadGameButton) loadGameButton.addEventListener('click', () => showLoadGameScreen());
    if (mainSettingsButton) mainSettingsButton.addEventListener('click', () => {
        settingsReturnScreen = 'main-menu'; // РЈСЃС‚Р°РЅР°РІР»РёРІР°РµРј СЌРєСЂР°РЅ РІРѕР·РІСЂР°С‚Р°
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

    // --- РњРµРЅСЋ РЅР°СЃС‚СЂРѕРµРє ---
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

    // РЈРЅРёРІРµСЂСЃР°Р»СЊРЅР°СЏ Р»РѕРіРёРєР° РґР»СЏ РІСЃРµС… РєРЅРѕРїРѕРє СЃРєСЂС‹С‚РёСЏ/РїРѕРєР°Р·Р° API РєР»СЋС‡РµР№
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



    // --- РЎРѕР·РґР°РЅРёРµ РїРµСЂСЃРѕРЅР°Р¶Р° ---
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
                charDescInput.value = "РР СЃРіРµРЅРµСЂРёСЂСѓРµС‚ РјСЂР°С‡РЅСѓСЋ Рё РіР»СѓР±РѕРєСѓСЋ РїСЂРµРґС‹СЃС‚РѕСЂРёСЋ, РІРїР»РµС‚СЏ РµС‘ РІ Р»РѕСЂ РјРёСЂР°...";
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

    // РСЃРїРѕР»СЊР·СѓРµРј СЂР°Р·РѕРІРѕРµ РїРѕР»СѓС‡РµРЅРёРµ СЌР»РµРјРµРЅС‚Р° Р±РµР· РїРѕРІС‚РѕСЂРЅРѕРіРѕ РѕР±СЉСЏРІР»РµРЅРёСЏ С‡РµСЂРµР· const
    const qsBtn = document.getElementById('quick-start-button');
    if (qsBtn) qsBtn.addEventListener('click', handleQuickStart);

    // --- Р’С‹Р±РѕСЂ Р Р°СЃСЃРєР°Р·С‡РёРєР° ---
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

    // --- РљРЅРѕРїРєРё "РќР°Р·Р°Рґ" ---
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

    // --- РЎРІРѕСЂР°С‡РёРІР°РµРјС‹Рµ РїР°РЅРµР»Рё ---
    collapsiblePanels.forEach(panel => {
        const toggle = panel.querySelector('.panel-toggle');
        if (toggle) {
            toggle.addEventListener('click', () => {
                const content = panel.querySelector('.panel-content');
                const icon = toggle.querySelector('.toggle-icon');
                const isExpanded = panel.classList.toggle('expanded');

                if (icon) icon.textContent = isExpanded ? 'в–ј' : 'в–¶';

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

    // --- Р“Р»РѕР±Р°Р»СЊРЅР°СЏ РљР°СЂС‚Р° (РњРѕРґР°Р»СЊРЅРѕРµ РѕРєРЅРѕ) ---
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

    // --- Р’РЅСѓС‚СЂРёРёРіСЂРѕРІРѕРµ РјРµРЅСЋ ---
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

    // --- РЈРІРµР»РёС‡РµРЅРёРµ С…Р°СЂР°РєС‚РµСЂРёСЃС‚РёРє ---
    if (statIncreaseButtons) {
        statIncreaseButtons.forEach(button => {
            button.addEventListener('click', handleStatIncrease);
        });
    }

    // --- Р’РІРѕРґ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ (РўРµРєСЃС‚ Рё Р“РѕР»РѕСЃ) ---
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
        
        // --- РРќРўР•Р“Р РђР¦РРЇ РњРћР”РћР’: РҐРѕС‚РєРµРё ---
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

    // --- РњРѕРґР°Р»СЊРЅРѕРµ РѕРєРЅРѕ СЂРµРїСѓС‚Р°С†РёРё ---
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

    // --- [РРЎРџР РђР’Р›Р•РќРР•] РћР±СЂР°Р±РѕС‚С‡РёРє РєР»РёРєРѕРІ РїРѕ OOC-РјР°СЂРєРµСЂР°Рј ---
    const oocTooltip = document.getElementById('ooc-tooltip');
    const oocTooltipContent = document.getElementById('ooc-tooltip-content');
    if (gameLog && oocTooltip && oocTooltipContent) {
        gameLog.addEventListener('click', (event) => {
            const marker = event.target.closest('.ooc-marker');
            if (marker) {
                event.stopPropagation(); // РћСЃС‚Р°РЅР°РІР»РёРІР°РµРј РІСЃРїР»С‹С‚РёРµ, С‡С‚РѕР±С‹ body РЅРµ Р·Р°РєСЂС‹Р» РѕРєРЅРѕ СЃСЂР°Р·Сѓ

                const text = marker.dataset.oocText;
                oocTooltipContent.textContent = text;

                // РџРѕР·РёС†РёРѕРЅРёСЂСѓРµРј Рё РїРѕРєР°Р·С‹РІР°РµРј
                const rect = marker.getBoundingClientRect();
                oocTooltip.style.left = `${rect.left}px`;
                oocTooltip.style.top = `${rect.bottom + 5}px`; // Р§СѓС‚СЊ РЅРёР¶Рµ РјР°СЂРєРµСЂР°
                oocTooltip.classList.add('visible');
            }
        });

        // РљР»РёРє РІ Р»СЋР±РѕРј РґСЂСѓРіРѕРј РјРµСЃС‚Рµ Р·Р°РєСЂС‹РІР°РµС‚ РїРѕРґСЃРєР°Р·РєСѓ
        document.body.addEventListener('click', () => {
            if (oocTooltip.classList.contains('visible')) {
                oocTooltip.classList.remove('visible');
            }
        });
    }
    // --- [РљРћРќР•Р¦ РРЎРџР РђР’Р›Р•РќРРЇ] ---

    // --- РЎРѕР±С‹С‚РёРµ Р·Р°РєСЂС‹С‚РёСЏ РѕРєРЅР°/РІРєР»Р°РґРєРё ---
    window.addEventListener('beforeunload', handleBeforeUnload);

    // --- РђРґРјРёРЅ РњРµРЅСЋ (F4) ---
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
            resultDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> РћС‚РїСЂР°РІРєР° Р·Р°РїСЂРѕСЃР°...';
            
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
                const response = await performAiPlayerFetch("РўС‹ С‚РµСЃС‚РѕРІС‹Р№ РР. РћС‚РІРµС‚СЊ 'РўРµСЃС‚ РїСЂРѕР№РґРµРЅ СѓСЃРїРµС€РЅРѕ, СЃРёСЃС‚РµРјС‹ РІ РЅРѕСЂРјРµ.'", [], mod, "РџСЂРѕРІРµСЂРєР° СЃРІСЏР·Рё.");
                resultDiv.innerHTML = `<span style="color: #2ecc71;">вњ… РЈСЃРїРµС…:</span><br>${response}`;
            } catch (e) {
                resultDiv.innerHTML = `<span style="color: #e74c3c;">вќЊ РћС€РёР±РєР°:</span><br>${e.message}`;
            } finally {
                aiPlayerProvider = oldProv;
                aiPlayerModelId = oldMod;
                aiPlayerApiKey = oldKey;
                aiPlayerLocalUrl = oldUrl;
            }
        });
    }


    // --- РћР±СЂР°Р±РѕС‚РєР° РІРєР»Р°РґРѕРє РёРЅРІРµРЅС‚Р°СЂСЏ ---
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

    // РћР±СЂР°Р±РѕС‚РєР° СЃР»РѕС‚РѕРІ СЌРєРёРїРёСЂРѕРІРєРё С‚РµРїРµСЂСЊ РїСЂРѕРёСЃС…РѕРґРёС‚ РґРёРЅР°РјРёС‡РµСЃРєРё РІ populateEquipmentUI()
}

function handleDragStart(event, itemData) {
    // РЎРѕС…СЂР°РЅСЏРµРј ID РїСЂРµРґРјРµС‚Р° РґР»СЏ СЃРѕР±С‹С‚РёСЏ drop
    event.dataTransfer.setData('text/plain', itemData.id);
    // РЎРѕС…СЂР°РЅСЏРµРј РїРѕР»РЅС‹Рµ РґР°РЅРЅС‹Рµ Рѕ РїСЂРµРґРјРµС‚Рµ РІ РіР»РѕР±Р°Р»СЊРЅСѓСЋ РїРµСЂРµРјРµРЅРЅСѓСЋ РґР»СЏ РїСЂРѕРІРµСЂРѕРє РІ dragover
    draggedItemData = itemData;
    // Р”РѕР±Р°РІР»СЏРµРј РєР»Р°СЃСЃ Рє РїРµСЂРµС‚Р°СЃРєРёРІР°РµРјРѕРјСѓ СЌР»РµРјРµРЅС‚Сѓ РґР»СЏ СЃС‚РёР»РёР·Р°С†РёРё
    event.currentTarget.classList.add('dragging');
}

function handleDragEnd(event) {
    // РћС‡РёС‰Р°РµРј РґР°РЅРЅС‹Рµ Рё СѓР±РёСЂР°РµРј РєР»Р°СЃСЃС‹ СЃС‚РёР»РёР·Р°С†РёРё
    draggedItemData = null;
    event.currentTarget.classList.remove('dragging');
    // РЈР±РёСЂР°РµРј РІСЃСЋ РїРѕРґСЃРІРµС‚РєСѓ СЃРѕ СЃР»РѕС‚РѕРІ РЅР° РІСЃСЏРєРёР№ СЃР»СѓС‡Р°Р№
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

    // РџСЂРѕРІРµСЂСЏРµРј, РїРѕРґС…РѕРґРёС‚ Р»Рё РїСЂРµРґРјРµС‚ РґР»СЏ СЌС‚РѕРіРѕ СЃР»РѕС‚Р°
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
    // РћР±СЏР·Р°С‚РµР»СЊРЅРѕ РІС‹Р·С‹РІР°РµРј preventDefault, С‡С‚РѕР±С‹ СЂР°Р·СЂРµС€РёС‚СЊ drop
    event.preventDefault();
}

function handleDragLeave(event) {
    // РЈР±РёСЂР°РµРј РїРѕРґСЃРІРµС‚РєСѓ, РєРѕРіРґР° РєСѓСЂСЃРѕСЂ СѓС…РѕРґРёС‚ СЃРѕ СЃР»РѕС‚Р°
    event.currentTarget.classList.remove('drag-over', 'drag-over-valid', 'drag-over-invalid');
}

// --- Р›РѕРіРёРєР° РЎС‚Р°СЂС‚Р° РќРѕРІРѕР№ РРіСЂС‹ ---
function startNewGameSetup() {
    if (window.ModAPI) ModAPI.emit('onNewGameStarted', {player: player || {}, world: World || {}});

    clearPromptCache(); // РЎР±СЂР°СЃС‹РІР°РµРј РєСЌС€ РїСЂРѕРјРїС‚Р° РїСЂРё РЅРѕРІРѕР№ РёРіСЂРµ

    // --- [РРЎРџР РђР’Р›Р•РќРР•] РЈРЅРёРІРµСЂСЃР°Р»СЊРЅР°СЏ РїСЂРѕРІРµСЂРєР° API РєР»СЋС‡Р° ---
    let keyIsMissing = false;
    let requiredKey = '';

    // РџСЂРѕРІРµСЂСЏРµРј РєР»СЋС‡ С‚РѕР»СЊРєРѕ РµСЃР»Рё РїСЂРѕРІР°Р№РґРµСЂ РЅРµ 'local' Рё РЅРµ 'dummy'
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
        // РСЃРїРѕР»СЊР·СѓРµРј РєР°СЃС‚РѕРјРЅС‹Р№ alert РІРјРµСЃС‚Рѕ СЃС‚Р°РЅРґР°СЂС‚РЅРѕРіРѕ
        const providerName = currentApiProvider.charAt(0).toUpperCase() + currentApiProvider.slice(1);
        showCustomAlert(t('error.apiKeyNeededForProvider', { provider: providerName }, `Р”Р»СЏ РЅР°С‡Р°Р»Р° РёРіСЂС‹ С‚СЂРµР±СѓРµС‚СЃСЏ API РєР»СЋС‡ РґР»СЏ РїСЂРѕРІР°Р№РґРµСЂР° ${providerName}. РџРѕР¶Р°Р»СѓР№СЃС‚Р°, РІРІРµРґРёС‚Рµ РµРіРѕ РІ РЅР°СЃС‚СЂРѕР№РєР°С….`));
        settingsReturnScreen = 'main-menu'; // РЈР±РµРґРёРјСЃСЏ, С‡С‚Рѕ РІРµСЂРЅРµРјСЃСЏ РІ РіР»Р°РІРЅРѕРµ РјРµРЅСЋ
        setActiveScreen('settings-menu');
        return;
    }
    // --- [РљРћРќР•Р¦ РРЎРџР РђР’Р›Р•РќРРЇ] ---

    // Р•СЃР»Рё РїСЂРѕРІРµСЂРєР° РїСЂРѕС€Р»Р°, РѕСЃС‚Р°Р»СЊРЅР°СЏ С‡Р°СЃС‚СЊ С„СѓРЅРєС†РёРё РІС‹РїРѕР»РЅСЏРµС‚СЃСЏ РєР°Рє Рё СЂР°РЅСЊС€Рµ
    if (worldLore.startsWith(t('error.prefix', "РћС€РёР±РєР°:")) || Object.keys(globalLocations).length === 0) {
        alert(t('error.worldLoadFailed', { worldId: DEFAULT_WORLD_ID }, `РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РґР°РЅРЅС‹Рµ РґР»СЏ РјРёСЂР° РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ (${DEFAULT_WORLD_ID}). РџСЂРѕРІРµСЂСЊС‚Рµ РєРѕРЅСЃРѕР»СЊ (F12) Рё С„Р°Р№Р»С‹ Р»РѕСЂР°.`));
        return;
    }

    console.log(`РќР°С‡Р°Р»Рѕ РЅР°СЃС‚СЂРѕР№РєРё РЅРѕРІРѕР№ РёРіСЂС‹ РґР»СЏ РјРёСЂР° РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ: ${DEFAULT_WORLD_ID}`);

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
    
    // РћС‡РёСЃС‚РєР° СЂРµРµСЃС‚СЂРѕРІ РѕС‚ РїСЂРµРґС‹РґСѓС‰РёС… СЃРµСЃСЃРёР№ (Fix Memory Leak)
    ItemRegistry.clear();
    ContainerRegistry.clear();

    resetCharacterCreation();
    setActiveScreen('character-creation-screen');
    updateDynamicUIText();
}


/**
 * РћР±РЅРѕРІР»СЏРµС‚ Рё Р°РЅРёРјРёСЂСѓРµС‚ Р±Р»РѕРє СЃ РѕРїРёСЃР°РЅРёРµРј РІС‹Р±СЂР°РЅРЅРѕР№ СЌРїРѕС…Рё.
 */
function updateEraDescription() {
    if (!charEraSelect || !eraDescriptionBox) return;

    // РќР°С…РѕРґРёРј РІС‹Р±СЂР°РЅРЅС‹Р№ СЌР»РµРјРµРЅС‚ <option>
    const selectedOption = charEraSelect.options[charEraSelect.selectedIndex];
    if (!selectedOption) {
        eraDescriptionBox.classList.remove('visible');
        eraDescriptionBox.innerHTML = '';
        return;
    }

    // РџРѕР»СѓС‡Р°РµРј РєР»СЋС‡ РґР»СЏ С‚РµРєСЃС‚Р° РЅР°РїСЂСЏРјСѓСЋ РёР· data-Р°С‚СЂРёР±СѓС‚Р°
    const descriptionKey = selectedOption.dataset.descriptionKey;
    const descriptionText = t(descriptionKey, null, '');

    // РџСЂСЏС‡РµРј Р±Р»РѕРє, С‡С‚РѕР±С‹ СЃРјРµРЅРёС‚СЊ С‚РµРєСЃС‚ Рё Р·Р°РїСѓСЃС‚РёС‚СЊ Р°РЅРёРјР°С†РёСЋ Р·Р°РЅРѕРІРѕ
    eraDescriptionBox.classList.remove('visible');

    setTimeout(() => {
        if (descriptionText) {
            eraDescriptionBox.innerHTML = sanitizeHTML(descriptionText);
            eraDescriptionBox.classList.add('visible');
        } else {
            eraDescriptionBox.innerHTML = '';
        }
    }, 200); // РќРµР±РѕР»СЊС€Р°СЏ Р·Р°РґРµСЂР¶РєР° РґР»СЏ РїР»Р°РІРЅРѕР№ Р°РЅРёРјР°С†РёРё
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

            if (backup.race && backup.class) {
                statDistributionSection.style.display = 'block';
                currentCreationStats = backup.stats || {};
                availableStatPoints = backup.availablePoints !== undefined ? backup.availablePoints : INITIAL_STAT_POINTS;

                baseStatsForDistribution = {};
                Object.keys(BASE_CLASS_STATS.default).forEach(stat => {
                    const classData = BASE_CLASS_STATS[backup.class] || BASE_CLASS_STATS.default;
                    const classStat = classData[stat] !== undefined ? classData[stat] : BASE_CLASS_STATS.default[stat];
                    const raceData = RACE_MODIFIERS[backup.race] || {};
                    const raceMod = raceData[stat] || 0;
                    baseStatsForDistribution[stat] = classStat + raceMod;
                });
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

    if (selectedRace && selectedClass && RACE_MODIFIERS[selectedRace] && BASE_CLASS_STATS[selectedClass]) {
        statDistributionSection.style.display = 'block';
        currentCreationStats = {};
        baseStatsForDistribution = {};

        Object.keys(BASE_CLASS_STATS.default).forEach(stat => {
            const classStat = BASE_CLASS_STATS[selectedClass][stat] || BASE_CLASS_STATS.default[stat];
            const raceMod = RACE_MODIFIERS[selectedRace][stat] || 0;
            baseStatsForDistribution[stat] = classStat + raceMod;
            currentCreationStats[stat] = baseStatsForDistribution[stat];
        });

        availableStatPoints = INITIAL_STAT_POINTS;
        updateStatCreationDisplay();
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
    // Р›РёРјРёС‚С‹ РЅР° РєРѕР»РёС‡РµСЃС‚РІРѕ СЃРёРјРІРѕР»РѕРІ РїРѕР»РЅРѕСЃС‚СЊСЋ СѓРґР°Р»РµРЅС‹
    const nameValid = charNameInput.value.trim().length > 0;
    const genderValid = document.getElementById('char-gender-select').value !== '';
    const raceValid = charRaceSelect.value !== '';
    const classValid = charClassSelect.value !== '';
    const descValid = charDescInput.value.trim().length > 0;

    // РљРЅРѕРїРєР° Р°РєС‚РёРІРёСЂСѓРµС‚СЃСЏ, РµСЃР»Рё РІСЃРµ РїРѕР»СЏ РїСЂРѕСЃС‚Рѕ Р·Р°РїРѕР»РЅРµРЅС‹
    startGameButton.disabled = !(nameValid && genderValid && raceValid && classValid && descValid);
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
            timeOfDay: "РЈС‚СЂРѕ",
            equipment: {},
            holdings: {},
            bankAccount: { deposit: 0, loan: 0, loanDays: 0 },
                        inventory: {}, // Legacy
            container_backpack: null, // РРЎРџР РђР’Р›Р•РќРР•: Р‘СѓРґРµС‚ СЃРѕР·РґР°РЅРѕ РїРѕСЃР»Рµ РіРµРЅРµСЂР°С†РёРё РјРёСЂР° C++ СЏРґСЂРѕРј
            container_equipment: null, // РРЎРџР РђР’Р›Р•РќРР•: Р‘СѓРґРµС‚ СЃРѕР·РґР°РЅРѕ РїРѕСЃР»Рµ РіРµРЅРµСЂР°С†РёРё РјРёСЂР° C++ СЏРґСЂРѕРј
            echoMemory: { items: [], maxItems: ECHO_MEMORY_MAX_ITEMS, version: 1 },
gmNotes: { "Main_Plot": "РќР°С‡Р°Р»Рѕ РїСѓС‚Рё. РРіСЂРѕРє РїРѕСЏРІР»СЏРµС‚СЃСЏ РІ СЃС‚Р°СЂС‚РѕРІРѕР№ Р»РѕРєР°С†РёРё." },
            memoryArchives: {},
            archiveSummaries: {},
            factionData: { global: t('factions.global', null, 'РћР±С‰Р°СЏ') },
            location: t('world.generatingStartLocation', "Р“РµРЅРµСЂР°С†РёСЏ СЃС‚Р°СЂС‚РѕРІРѕР№ С‚РѕС‡РєРё..."),
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
            eroticJournal: [],  // Р–СѓСЂРЅР°Р» СЌСЂРѕС‚РёС‡РµСЃРєРёС… СЃС†РµРЅ
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

        console.log("РџРµСЂСЃРѕРЅР°Р¶ РІСЂРµРјРµРЅРЅРѕ СЃРѕР·РґР°РЅ РґР»СЏ СЌРїРѕС…Рё '" + selectedEra + "', РїРµСЂРµС…РѕРґ Рє РІС‹Р±РѕСЂСѓ СЂР°СЃСЃРєР°Р·С‡РёРєР°:", tempPlayer);

        // Рў3 Р¤РРљРЎ: РЈРґР°Р»СЏРµРј РІС‹Р±РѕСЂ СЂР°СЃСЃРєР°Р·С‡РёРєРѕРІ. РРґРµРј СЃСЂР°Р·Сѓ Рє РЅР°СЃС‚СЂРѕР№РєРµ РјРёСЂР°.
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
 * РЎРѕС…СЂР°РЅСЏРµС‚ С‚РµРєСѓС‰РёРµ РґР°РЅРЅС‹Рµ РёР· С„РѕСЂРјС‹ СЃРѕР·РґР°РЅРёСЏ РїРµСЂСЃРѕРЅР°Р¶Р° РІ РѕР±СЉРµРєС‚.
 * РСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РґР»СЏ РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёСЏ С„РѕСЂРјС‹ РІ СЃР»СѓС‡Р°Рµ РѕС€РёР±РєРё API.
 * @returns {object|null} РћР±СЉРµРєС‚ СЃ РґР°РЅРЅС‹РјРё С„РѕСЂРјС‹ РёР»Рё null, РµСЃР»Рё СЌРєСЂР°РЅ СЃРѕР·РґР°РЅРёСЏ РЅРµ Р°РєС‚РёРІРµРЅ.
 */
function backupCreationForm() {
    // РЈР±РµР¶РґР°РµРјСЃСЏ, С‡С‚Рѕ РјС‹ РЅР° СЌРєСЂР°РЅРµ СЃРѕР·РґР°РЅРёСЏ РїРµСЂСЃРѕРЅР°Р¶Р°
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
        // РЎРѕС…СЂР°РЅСЏРµРј СЂР°СЃРїСЂРµРґРµР»РµРЅРЅС‹Рµ СЃС‚Р°С‚С‹ Рё РѕСЃС‚Р°РІС€РёРµСЃСЏ РѕС‡РєРё
        stats: { ...currentCreationStats },
        availablePoints: availableStatPoints
    };
}

async function startGameWithNarrator() {
    if (!tempPlayer) {
        console.error("РћС€РёР±РєР°: Р’СЂРµРјРµРЅРЅС‹Рµ РґР°РЅРЅС‹Рµ РёРіСЂРѕРєР° РѕС‚СЃСѓС‚СЃС‚РІСѓСЋС‚. Р’РѕР·РІСЂР°С‚ Рє СЃРѕР·РґР°РЅРёСЋ РїРµСЂСЃРѕРЅР°Р¶Р°.");
        setActiveScreen('character-creation-screen');
        return;
    }
    // РџРµСЂРµС…РѕРґРёРј Рє СЌРєСЂР°РЅСѓ РЅР°СЃС‚СЂРѕР№РєРё СЃРёРјСѓР»СЏС†РёРё РјРёСЂР°
    setActiveScreen('world-setup-screen');
}

async function finalizeWorldSetupAndStart() {
    const yearsToSimulate = parseInt(worldYearsSlider.value, 10);
    const initialAgents = parseInt(worldAgentsSlider.value, 10);

    player = tempPlayer;
    await loadActiveEraLore(player.era);
    await loadGlobalLocations(DEFAULT_WORLD_ID, currentLanguage, player.era);

    conversationHistory = [];
    currentSaveSlot = null;
    nextInternalQuestId = 1;
    nextInternalItemId = 1;
    nextInternalEntityId = 1;

    console.log("РРіСЂР° РЅР°С‡РёРЅР°РµС‚СЃСЏ СЃ РїРµСЂСЃРѕРЅР°Р¶РµРј:", player);

    await initializeGameInterface();
    setActiveScreen('game-interface');
    showLoadingScreen('loadingScreen.generatingWorld', 'Р“РµРЅРµСЂР°С†РёСЏ РјРёСЂР°...');

    const absoluteStartDay = calculateAbsoluteStartDay(player.gameTime);

    if (preloadedWorldData) {
        console.log("РСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РїСЂРµРґР·Р°РіСЂСѓР¶РµРЅРЅС‹Р№ РјРёСЂ.");
        setWorld(preloadedWorldData);
        // РРЅРёС†РёР°Р»РёР·РёСЂСѓРµРј РґРІРёР¶РѕРє, РЅРѕ РќР• СЃРёРЅС…СЂРѕРЅРёР·РёСЂСѓРµРј РјРёСЂ СЃРµР№С‡Р°СЃ вЂ”
        // World JSON СЃР»РёС€РєРѕРј Р±РѕР»СЊС€РѕР№ (1.5РњР‘+), syncState С‚Р°Р№РјР°СѓС‚РёС‚СЃСЏ.
        // РЎРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ Р±СѓРґРµС‚ РІС‹РїРѕР»РЅРµРЅР° РїРѕР·Р¶Рµ, РїРѕСЃР»Рµ СЃРѕР·РґР°РЅРёСЏ РєРѕРЅС‚РµР№РЅРµСЂРѕРІ.
        if (window.electronAPI && window.electronAPI.nexusInit) {
            const initRes = await window.electronAPI.nexusInit(true);
            if (initRes.status !== 'ok') {
                console.warn('[Nexus] Init failed for preloaded world:', initRes.message);
            }
        }
    } else {
        setWorld(await initWorldSimulator(initialAgents, absoluteStartDay));
        if (!World) {
            hideLoadingScreen();
            return; // РџСЂРµСЂС‹РІР°РµРј Р·Р°РїСѓСЃРє, С‚Р°Рє РєР°Рє СЏРґСЂРѕ СѓРїР°Р»Рѕ РёР»Рё РЅРµ РёРЅРёС†РёР°Р»РёР·РёСЂРѕРІР°Р»РѕСЃСЊ
        }

        // --- BOOTSTRAP PHASE ---
        if (window.electronAPI && window.electronAPI.nexusBootstrap) {
            const totalPop = Object.values(World.regions).reduce((sum, r) => sum + r.population, 0);
            const bootstrapDays = calculateBootstrapDays(totalPop);
            
            const loadingText = document.getElementById('loading-text');
            if (loadingText) loadingText.textContent = `Р­РєРѕРЅРѕРјРёС‡РµСЃРєР°СЏ Р±Р°Р»Р°РЅСЃРёСЂРѕРІРєР° (${bootstrapDays} РґРЅ.)...`;
            console.log(`[Nexus] Р—Р°РїСѓСЃРє Bootstrap РЅР° ${bootstrapDays} РґРЅРµР№...`);
            
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
            if (loadingText) loadingText.textContent = t('loadingScreen.finalizing', null, 'Р—Р°РІРµСЂС€РµРЅРёРµ...');
        }

        if (window.electronAPI && window.electronAPI.isElectron) {
            hideLoadingScreen();
            await promptSaveWorldModal();
            showLoadingScreen('loadingScreen.generatingWorld', 'Р—Р°РІРµСЂС€РµРЅРёРµ РЅР°СЃС‚СЂРѕР№РєРё...');
        }
    }

    // --- Р’Р«Р‘РћР  РЎРўРђР РўРћР’РћР™ Р›РћРљРђР¦РР Р”Рћ Р“Р•РќР•Р РђР¦РР РЎРќРђРџРЁРћРўРђ ---
    let startRegionId = null;
    // Рў3 Р¤РРљРЎ: РџРµСЂРµРґР°РµРј РѕС‚РІРµС‚СЃС‚РІРµРЅРЅРѕСЃС‚СЊ Р·Р° РІС‹Р±РѕСЂ СЃС‚Р°СЂС‚РѕРІРѕР№ Р»РѕРєР°С†РёРё Р“РµР№Рј-РњР°СЃС‚РµСЂСѓ
    player.location = "РќРµ РѕРїСЂРµРґРµР»РµРЅР° (Р“Рњ РћР‘РЇР—РђРќ РІС‹Р±СЂР°С‚СЊ Р»РѕРіРёС‡РЅСѓСЋ СЃС‚Р°СЂС‚РѕРІСѓСЋ Р»РѕРєР°С†РёСЋ)";

    await ensurePlayerContainers();

    // Р”Р»СЏ РїСЂРµРґР·Р°РіСЂСѓР¶РµРЅРЅРѕРіРѕ РјРёСЂР°: СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ С‡РµСЂРµР· Р¤РђР™Р›, Р° РЅРµ С‡РµСЂРµР· stdin.
    // syncState С‡РµСЂРµР· stdin Р±Р»РѕРєРёСЂСѓРµС‚ РґРІРёР¶РѕРє (1.5MB+ JSON в†’ 64KB pipe buffer в†’ timeout).
    // РќРѕРІС‹Р№ РїРѕРґС…РѕРґ: Р·Р°РїРёСЃС‹РІР°РµРј РјРёСЂ РІ С„Р°Р№Р», РґРІРёР¶РѕРє С‡РёС‚Р°РµС‚ РµРіРѕ РЅР°РїСЂСЏРјСѓСЋ С‡РµСЂРµР· loadWorldFile.
    if (preloadedWorldData && window.electronAPI && window.electronAPI.nexusWriteSyncFile) {
        const syncItems = Array.from(ItemRegistry.entries());
        const syncContainers = Array.from(ContainerRegistry.entries());
        const worldFileData = { world: World, items: syncItems, containers: syncContainers };
        console.log('[Nexus] Р—Р°РїСѓСЃРє С„Р°Р№Р»РѕРІРѕР№ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРё РїСЂРµРґР·Р°РіСЂСѓР¶РµРЅРЅРѕРіРѕ РјРёСЂР°...');
        try {
            // РЁР°Рі 1: Р—Р°РїРёСЃС‹РІР°РµРј РґР°РЅРЅС‹Рµ РјРёСЂР° РІРѕ РІСЂРµРјРµРЅРЅС‹Р№ С„Р°Р№Р» С‡РµСЂРµР· IPC
            const writeRes = await window.electronAPI.nexusWriteSyncFile(worldFileData);
            if (writeRes.status === 'ok' && writeRes.path) {
                // РЁР°Рі 2: РћС‚РїСЂР°РІР»СЏРµРј РєРѕРјР°РЅРґСѓ РґРІРёР¶РєСѓ РїСЂРѕС‡РёС‚Р°С‚СЊ С„Р°Р№Р» РЅР°РїСЂСЏРјСѓСЋ
                const loadRes = await window.electronAPI.nexusLoadWorldFile(writeRes.path);
                if (loadRes.status === 'ok') {
                    console.log('[Nexus] Р¤Р°Р№Р»РѕРІР°СЏ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ РјРёСЂР° Р·Р°РІРµСЂС€РµРЅР°:', loadRes.message);
                } else {
                    console.warn('[Nexus] loadWorldFile РЅРµ СѓРґР°Р»СЃСЏ:', loadRes.message || loadRes.error || 'unknown error');
                }
            } else {
                console.warn('[Nexus] РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РїРёСЃР°С‚СЊ РІСЂРµРјРµРЅРЅС‹Р№ С„Р°Р№Р»:', writeRes.message);
            }
        } catch (err) {
            console.warn('[Nexus] РћС€РёР±РєР° С„Р°Р№Р»РѕРІРѕР№ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРё:', err.message || err);
        }
    }

    const narratorStyleGuide = `
    ### РўР’РћР™ РЎРўРР›Р¬: THE PRISM MASTER
    - РўС‹ вЂ” С…Р°СЂРёР·РјР°С‚РёС‡РЅС‹Р№, РЅРµРїСЂРµРґСЃРєР°Р·СѓРµРјС‹Р№ Рё РіР»СѓР±РѕРєРёР№ СЂР°СЃСЃРєР°Р·С‡РёРє. 
    - РўРІРѕСЏ Р±Р°Р·Р°: Р“Р°Р№ Р РёС‡Рё + РҐР°СЏРѕ РњРёСЏРґР·Р°РєРё + Р“Р°РЅРЅРёР±Р°Р» Р›РµРєС‚РµСЂ. 
    - РљРћРќРўР РђРЎРў: РЈРјРµР№ Р±С‹С‚СЊ РјРёР»С‹Рј Рё РЅСЏС€РЅС‹Рј РІ РѕРґРёРЅ РјРѕРјРµРЅС‚, Рё РїСЂРµРІСЂР°С‰Р°С‚СЊ СЃС†РµРЅСѓ РІ РєСЂРѕРІР°РІС‹Р№ РєРѕС€РјР°СЂ РІ СЃР»РµРґСѓСЋС‰РёР№.
    - РџР•Р РЎРћРќРђР–Р: Р”Р°РІР°Р№ РёРј РґСѓС€Сѓ. РўРІРѕРё NPC РґРѕР»Р¶РЅС‹ Р·Р°РїРѕРјРёРЅР°С‚СЊСЃСЏ СЃС‚СЂР°РЅРЅРѕСЃС‚СЏРјРё, С€СѓС‚РєР°РјРё, РјР°С‚Р°РјРё РёР»Рё РїСѓРіР°СЋС‰РёРј СЃРїРѕРєРѕР№СЃС‚РІРёРµРј.
    - РќРРљРђРљРћР™ РЎРљРЈРљР: Р•СЃР»Рё РёРіСЂРѕРє РїСЂРѕСЃС‚Рѕ РёРґРµС‚ РїРѕ РґРѕСЂРѕРіРµ вЂ” Р·Р°СЃС‚Р°РІСЊ РµРіРѕ РїРѕС‡СѓРІСЃС‚РІРѕРІР°С‚СЊ Р»РёР±Рѕ РЅРµРІРµСЂРѕСЏС‚РЅСѓСЋ РєСЂР°СЃРѕС‚Сѓ РїСЂРёСЂРѕРґС‹, Р»РёР±Рѕ РїР°СЂР°РЅРѕР№СЋ, С‡С‚Рѕ Р·Р° РЅРёРј СЃР»РµРґСЏС‚.
    - РСЃРїРѕР»СЊР·СѓР№ РјР°С‚ Рё Р¶Р°СЂРіРѕРЅ РґР»СЏ Р°РєС†РµРЅС‚РѕРІ, РЅРµ РґРµР»Р°Р№ РёР· СЌС‚РѕРіРѕ СЃР°РјРѕС†РµР»СЊ, РЅРѕ Рё РЅРµ СЃС‚РµСЃРЅСЏР№СЃСЏ.`;

    if (enableDeepSetup) {
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

    console.log(`Р—Р°РіСЂСѓР·РєР° СЃС‚Р°СЂС‚РѕРІРѕРіРѕ РїСЂРѕРјРїС‚Р° РґР»СЏ СЌРїРѕС…Рё '${player.era}': ${initialPromptFile}`);
    const initialPromptTemplate = await loadPromptFromFile(initialPromptFile);

    if (initialPromptTemplate.startsWith('РћС€РёР±РєР°:')) {
        addLogMessage(t('error.loadPromptFailed', { filePath: initialPromptFile }), 'system-message');
        hideLoadingScreen();
        isWaitingForAI = false;
        if (userInput) userInput.disabled = false;
        if (sendButton) sendButton.disabled = false;
        return;
    }

    let itemsRefStringInitial = "РЎРїСЂР°РІРѕС‡РЅРёРє РїСЂРµРґРјРµС‚РѕРІ РЅРµ Р·Р°РіСЂСѓР¶РµРЅ РёР»Рё РїСѓСЃС‚.";
    if (Array.isArray(itemsReferenceData) && itemsReferenceData.length > 0) {
        try {
            const itemsForPrompt = itemsReferenceData.slice(0, 50).map(item => ({ id: item.id, name: item.name, type: item.type, rarity: item.rarity, description: item.description.substring(0, 100) + "..." }));
            itemsRefStringInitial = JSON.stringify(itemsForPrompt, null, 2);
            if (itemsReferenceData.length > 50) itemsRefStringInitial += "\n... (Рё РґСЂСѓРіРёРµ РїСЂРµРґРјРµС‚С‹)";
        } catch (e) { console.error("РћС€РёР±РєР° СЃРµСЂРёР°Р»РёР·Р°С†РёРё itemsReferenceData РґР»СЏ РЅР°С‡Р°Р»СЊРЅРѕРіРѕ РїСЂРѕРјРїС‚Р°:", e); }
    }

    // РђРІС‚РѕРјР°С‚РёС‡РµСЃРєРё РіРµРЅРµСЂРёСЂСѓРµРј Р°РєС‚СѓР°Р»СЊРЅСѓСЋ РґРѕРєСѓРјРµРЅС‚Р°С†РёСЋ РїРѕ С‚СЂР°РЅСЃРїРѕСЂС‚Сѓ
    // РЈР±РµР¶РґР°РµРјСЃСЏ, С‡С‚Рѕ СЂРµРµСЃС‚СЂ Р·Р°РіСЂСѓР¶РµРЅ
    await TransportSystem.init();
    const transportDocs = TransportSystem.generateGMDocumentation();
    if (transportDocs) {
        itemsRefStringInitial = transportDocs + '\n\n' + itemsRefStringInitial;
    }

    const startModeInstruction = (player.startMode === 'calm') 
        ? "РЎРџРћРљРћР™РќР«Р™ РЎРўРђР Рў: РќР°С‡РЅРё РёРіСЂСѓ РјР°РєСЃРёРјР°Р»СЊРЅРѕ РјРёСЂРЅРѕ. РРіСЂРѕРє РІ Р±РµР·РѕРїР°СЃРЅРѕСЃС‚Рё (РґРѕРј, С‚Р°РІРµСЂРЅР°, РїСЂРёРІР°Р»). Р”Р°Р№ РІСЂРµРјСЏ РѕСЃРјРѕС‚СЂРµС‚СЊСЃСЏ Рё РїРѕРіРѕРІРѕСЂРёС‚СЊ. РќРёРєР°РєРѕР№ РЅРµРјРµРґР»РµРЅРЅРѕР№ СѓРіСЂРѕР·С‹."
        : "РђР”Р Р•РќРђР›РРќРћР’Р«Р™ РЎРўРђР Рў: РќР°С‡РЅРё РІ СЃР°РјРѕР№ РіСѓС‰Рµ СЃРѕР±С‹С‚РёР№! РљСЂРёС‚РёС‡РµСЃРєР°СЏ СЃРёС‚СѓР°С†РёСЏ: РїРѕРіРѕРЅСЏ, Р·Р°СЃР°РґР°, РґСѓСЌР»СЊ РёР»Рё РєР°С‚Р°СЃС‚СЂРѕС„Р°. РўСЂРµР±СѓР№ РЅРµРјРµРґР»РµРЅРЅС‹С… РґРµР№СЃС‚РІРёР№.";

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
            dynamicContextStr += `\n[РљР РРўРР§Р•РЎРљРђРЇ РЈР“Р РћР—Рђ Р’ Р Р•Р“РРћРќР•]: РўР« РљРђРўР•Р“РћР РР§Р•РЎРљР РћР‘РЇР—РђРќ СЃРґРµР»Р°С‚СЊ РјРѕРЅСЃС‚СЂР° РіР»Р°РІРЅРѕР№ С‚РµРјРѕР№ СЃС‚Р°СЂС‚РѕРІРѕРіРѕ РѕРїРёСЃР°РЅРёСЏ (С‚РµРЅСЊ РЅР°Рґ РіРѕСЂРѕРґРѕРј, СЂРµРІ РІРґР°Р»РµРєРµ, СЂР°Р·СЂСѓС€РµРЅРёСЏ, РїР°РЅРёРєР° Р¶РёС‚РµР»РµР№)!\n`;
        }
        
        let activeDisasters = (World.map && World.map.disasters) ? World.map.disasters.filter(d => d.days_active > 0 && d.affected_regions.includes(startRegionId)) : [];
        if (activeDisasters.length > 0) {
            dynamicContextStr += `[DISASTER_VEC | ACT:${activeDisasters.map(d => `${d.type}:${d.affected_regions.join('-')}`).join(',')}]\n`;
            dynamicContextStr += `\n[РђРљРўРР’РќРћР• Р‘Р•Р”РЎРўР’РР• Р’ Р Р•Р“РРћРќР•]: РўР« РћР‘РЇР—РђРќ РѕРїРёСЃР°С‚СЊ СЌС‚Рѕ РІ СЃС‚Р°СЂС‚РѕРІРѕРј С‚РµРєСЃС‚Рµ!\n`;
        }
    }

    if (typeof World !== 'undefined' && World && World.relevant_news && World.relevant_news.length > 0) {
        let recentNewsStr = World.relevant_news.map(n => {
            let daysOld = Math.max(0, (World.current_day || 0) - (n.day || 0));
            return `[${daysOld}d ago, ${n.location}] ${parseLocString(n.text)}`;
        }).join("\n");
        if (recentNewsStr) {
            dynamicContextStr += `\n=== RELEVANT EVENTS ===\n${recentNewsStr}\n`;
            dynamicContextStr += `\nРўР« РћР‘РЇР—РђРќ РѕСЂРіР°РЅРёС‡РЅРѕ РІРїР»РµСЃС‚Рё СЌС‚Рё РЅРµРґР°РІРЅРёРµ СЃРѕР±С‹С‚РёСЏ РІ СЃС‚Р°СЂС‚РѕРІРѕРµ РїРѕРІРµСЃС‚РІРѕРІР°РЅРёРµ!\n`;
        }
    }
    if (typeof World !== 'undefined' && World && startRegionId && World.regions[startRegionId]) {
        let r = World.regions[startRegionId];
        dynamicContextStr += `\n=== РЎРРњРЈР›РЇР¦РРЇ РњРР Рђ (Р›РћРљРђР›Р¬РќР«Р• Р”РђРќРќР«Р•) ===\n`;
        let seasonName = r.current_season === 'spring' ? 'Р’РµСЃРЅР°' : (r.current_season === 'summer' ? 'Р›РµС‚Рѕ' : (r.current_season === 'autumn' ? 'РћСЃРµРЅСЊ' : 'Р—РёРјР°'));
        dynamicContextStr += `[Р’РђРЁРђ Р›РћРљРђР¦РРЇ] Р РµРіРёРѕРЅ: ${r.name}. РЎРµР·РѕРЅ: ${seasonName}. РџРѕРіРѕРґР°: ${r.weather || "РќРѕСЂРјР°Р»СЊРЅР°СЏ"}\n`;
        
        let activeMonsters = (World.monsters || []).filter(m => m.health > 0 && m.region_id === startRegionId);
        if (activeMonsters.length > 0) {
            dynamicContextStr += `\n[РљР РРўРР§Р•РЎРљРђРЇ РЈР“Р РћР—Рђ Р’ Р Р•Р“РРћРќР•]: РџСЂСЏРјРѕ СЃРµР№С‡Р°СЃ РІ СЌС‚РѕР№ Р»РѕРєР°С†РёРё РЅР°С…РѕРґРёС‚СЃСЏ Р­РџРР§Р•РЎРљРћР• Р§РЈР”РћР’РР©Р•: ${activeMonsters.map(m => m.name).join(', ')}! РўР« РљРђРўР•Р“РћР РР§Р•РЎРљР РћР‘РЇР—РђРќ СЃРґРµР»Р°С‚СЊ СЌС‚Рѕ С‡Р°СЃС‚СЊСЋ СЃС‚Р°СЂС‚РѕРІРѕРіРѕ РѕРїРёСЃР°РЅРёСЏ (С‚РµРЅСЊ РЅР°Рґ РіРѕСЂРѕРґРѕРј, СЂРµРІ РІРґР°Р»РµРєРµ, СЂР°Р·СЂСѓС€РµРЅРёСЏ, РїР°РЅРёРєР° Р¶РёС‚РµР»РµР№)!\n`;
        }
        
        let activeDisasters = (World.map && World.map.disasters) ? World.map.disasters.filter(d => d.days_active > 0 && d.affected_regions.includes(startRegionId)) : [];
        if (activeDisasters.length > 0) {
            dynamicContextStr += `\n[РђРљРўРР’РќРћР• Р‘Р•Р”РЎРўР’РР• Р’ Р Р•Р“РРћРќР•]: РџСЂСЏРјРѕ СЃРµР№С‡Р°СЃ Р·РґРµСЃСЊ Р±СѓС€СѓРµС‚ РєР°С‚Р°РєР»РёР·Рј: ${activeDisasters.map(d => d.type).join(', ')}! РўР« РћР‘РЇР—РђРќ РѕРїРёСЃР°С‚СЊ СЌС‚Рѕ РІ СЃС‚Р°СЂС‚РѕРІРѕРј С‚РµРєСЃС‚Рµ!\n`;
        }
        
        if (r.isOccupied) {
            let occName = World.factions[r.occupierFactionId] ? World.factions[r.occupierFactionId].name : r.occupierFactionId;
            dynamicContextStr += `\n[Р’РћР•РќРќРћР• РџРћР›РћР–Р•РќРР•]: Р РµРіРёРѕРЅ РѕРєРєСѓРїРёСЂРѕРІР°РЅ РІСЂР°Р¶РµСЃРєРёРјРё РІРѕР№СЃРєР°РјРё (${occName})! РџРѕРІСЃСЋРґСѓ РїР°С‚СЂСѓР»Рё, СЂР°Р·СЂСѓС…Р° Рё СЃС‚СЂР°С….\n`;
        }
    }

    if (typeof World !== 'undefined' && World && World.news && World.news.length > 0) {
        let currentDay = (World.current_day !== undefined ? World.current_day : Math.floor((World.tick || 0) / 24));
        let recentNews = World.news
            .map(n => ({ ...n, daysOld: Math.max(0, currentDay - (n.day || 0)) }))
            .filter(n => n.daysOld <= 720) // Р—Р° РїРѕСЃР»РµРґРЅРёРµ 2 РіРѕРґР°
            .filter(n => ['war', 'disaster', 'politics'].includes(n.category)) // РўРѕР»СЊРєРѕ СЃР°РјС‹Рµ РєСЂСѓРїРЅС‹Рµ РїРѕС‚СЂСЏСЃРµРЅРёСЏ
            .sort((a, b) => a.daysOld - b.daysOld)
            .slice(0, 15);
            
        if (recentNews.length > 0) {
            dynamicContextStr += `\n=== РќР•Р”РђР’РќРЇРЇ РРЎРўРћР РРЇ (РџРћРЎР›Р•Р”РЎРўР’РРЇ РџР Р•-РЎРРњРЈР›РЇР¦РР) ===\n`;
            dynamicContextStr += recentNews.map(n => `[${n.daysOld} РґРЅ. РЅР°Р·Р°Рґ, Р›РѕРєР°С†РёСЏ: ${n.location}] ${parseLocString(n.text)}`).join("\n");
            dynamicContextStr += `\nРўР« РћР‘РЇР—РђРќ РѕСЂРіР°РЅРёС‡РЅРѕ РІРїР»РµСЃС‚Рё СЌС‚Рё РЅРµРґР°РІРЅРёРµ СЃРѕР±С‹С‚РёСЏ РІ СЃС‚Р°СЂС‚РѕРІРѕРµ РїРѕРІРµСЃС‚РІРѕРІР°РЅРёРµ (Рѕ С‡РµРј С€РµРїС‡СѓС‚СЃСЏ РІС‹Р¶РёРІС€РёРµ, СЃР»РµРґС‹ РЅРµРґР°РІРЅРµР№ РІРѕР№РЅС‹, РїРѕСЃР»РµРґСЃС‚РІРёСЏ РєР°С‚Р°СЃС‚СЂРѕС„)!\n`;
        }
    }

    let imgExample = enableImageGeneration ? '"image_prompt": "Ado music video aesthetic, monochrome with red accent, dark gothic anime, creepy vibe, masterpiece",' : '';
    const genBackstoryText = player.generateBackstory ? "TRUE (РўР« РћР‘РЇР—РђРќ РџР РР”РЈРњРђРўР¬ РџР Р•Р”Р«РЎРўРћР РР® Р Р’Р«Р—Р’РђРўР¬ setPlayerDescription)" : "FALSE";
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

    sendApiRequest(startPrompt, true);

    tempPlayer = null;
    stopMenuMusic();
}

// --- Р’СЃРїРѕРјРѕРіР°С‚РµР»СЊРЅС‹Рµ С„СѓРЅРєС†РёРё РґР»СЏ РїРµСЂСЃРѕРЅР°Р¶Р° ---
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
            showLoadingScreen('loadingScreen.generatingWorld', 'РЎРёРјСѓР»СЏС†РёСЏ РІСЂРµРјРµРЅРё Рё СЃРѕР±С‹С‚РёР№...');
            isWaitingForAI = true;
            window.isSimulatingTime = true;
        }
        updateWorldSimulation(pulses);
    }
    updateTimeDisplay();
}

function checkTimeTriggers(oldHour, newHour) {
    if (oldHour === newHour) return;

    let timeOfDay = "Р”РµРЅСЊ";
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
        addLogMessage("РќР° РјРёСЂ РѕРїСѓСЃРєР°РµС‚СЃСЏ РЅРѕС‡СЊ. РЎС‚Р°РЅРѕРІРёС‚СЃСЏ С‚РµРјРЅРµРµ Рё РѕРїР°СЃРЅРµРµ.", "system-message");
        for (let key in player.visibleEntities) {
            let ent = player.visibleEntities[key];
            if (!ent.isHostile && ent.type === 'npc') ent.isSleeping = true;
        }
        updateEnvironmentPanel();
    }
    if (oldHour < 6 && newHour >= 6) {
        addLogMessage("Р’СЃС…РѕРґРёС‚ СЃРѕР»РЅС†Рµ. РќР°С‡РёРЅР°РµС‚СЃСЏ РЅРѕРІС‹Р№ РґРµРЅСЊ.", "system-message");
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
        let icon = (gt.hour >= 6 && gt.hour < 20) ? 'вЂпёЏ' : 'рџЊ™';
        
        let mName = "РњРµСЃСЏС†Р°";
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
  const runtimeEraId = getGameplayRuntimeConfig().engine_world?.default_era_id;
  if (typeof runtimeEraId === 'string' && runtimeEraId.trim()) {
    return runtimeEraId;
  }
  if (Array.isArray(window.ERAS_DATA) && window.ERAS_DATA.length > 0 && typeof window.ERAS_DATA[0]?.id === 'string') {
    return window.ERAS_DATA[0].id;
  }
  throw new Error('[RuntimeData] Unable to resolve default era id.');
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
        console.error("РЎРїСЂР°РІРѕС‡РЅРёРє РїСЂРµРґРјРµС‚РѕРІ РЅРµ Р·Р°РіСЂСѓР¶РµРЅ РёР»Рё РёРјРµРµС‚ РЅРµРІРµСЂРЅС‹Р№ С„РѕСЂРјР°С‚. РќРµРІРѕР·РјРѕР¶РЅРѕ РІС‹РґР°С‚СЊ СЃС‚Р°СЂС‚РѕРІС‹Р№ РёРЅРІРµРЅС‚Р°СЂСЊ.");
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
            console.warn(`[getStartingInventory] РЎСЃС‹Р»РєР° РЅР° РїСЂРµРґРјРµС‚ РЅРµ РЅР°Р№РґРµРЅР° РґР»СЏ ID: ${itemAiId}. РџСЂРµРґРјРµС‚ РЅРµ РґРѕР±Р°РІР»РµРЅ.`);
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
        player.stats.xp = Math.max(0, excessXp); // РћРїС‹С‚ РїРµСЂРµРЅРѕСЃРёС‚СЃСЏ
        player.stats.xpNext = calculateXpForNextLevel(player.stats.level);

        const oldMaxHp = player.stats.maxHp;
        player.stats.maxHp = calculateMaxHp(player.stats.con);
        const hpGainThisLevel = player.stats.maxHp - oldMaxHp;
        totalHpGainThisCycle += hpGainThisLevel;
        player.stats.hp = player.stats.maxHp; // РџРѕР»РЅРѕРµ РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ HP РїСЂРё СѓСЂРѕРІРЅРµ

        if (player.class === 'mage') {
            player.stats.maxMana = calculateMaxMana(player.stats.int, player.stats.level);
            player.stats.mana = player.stats.maxMana; // РџРѕР»РЅРѕРµ РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ РјР°РЅС‹
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
        generateWorldNews(`Р“РµСЂРѕР№ ${player.name} РґРѕСЃС‚РёРі ${player.stats.level} СѓСЂРѕРІРЅСЏ!`, player.location || "global", 3, 'misc');
        updateCharacterSheet(); // РћР±РЅРѕРІРёС‚ РѕС‚РѕР±СЂР°Р¶РµРЅРёРµ, РІРєР»СЋС‡Р°СЏ РєРЅРѕРїРєРё "+"
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

    // РЎРѕРѕР±С‰Р°РµРј GM Рѕ РґРµР№СЃС‚РІРёРё
    queuePlayerActionForGM(`Player increased attribute '${statToIncrease.toUpperCase()}' to ${player.stats[statToIncrease]}.`);

    updateCharacterSheet();
}

function updateNexusDisplay() {
    const nexusList = document.getElementById('nexus-list');
    if (!player || !nexusList) return;

    nexusList.innerHTML = '';
    const nexusData = Object.values(player.nexusData || {});

    // Р¤РёР»СЊС‚СЂСѓРµРј СЃР»СѓР¶РµР±РЅС‹Рµ СЌР»РµРјРµРЅС‚С‹ Рё СЃРєСЂС‹РІР°РµРј РњРёСЂРѕРІС‹Рµ РЎРѕР±С‹С‚РёСЏ (РѕРЅРё С‚РµРїРµСЂСЊ РІ Р›РµС‚РѕРїРёСЃРё РњРёСЂР°)
    const actualItems = nexusData.filter(item => {
        if (!item || typeof item.name !== 'string' || item.name === item.category) return false;
        if (item.category === 'World_Event' || item.category === 'РњРёСЂРѕРІРѕРµ РЎРѕР±С‹С‚РёРµ' || item.id.startsWith('event_')) return false;
        return true;
    });

    if (actualItems.length === 0) {
        nexusList.innerHTML = `<li data-i18n="gameInterface.nexusPanel.empty">${t('gameInterface.nexusPanel.empty', 'РќРµС‚ РґР°РЅРЅС‹С…')}</li>`;
        return;
    }

    // Р“СЂСѓРїРїРёСЂСѓРµРј РѕС‚С„РёР»СЊС‚СЂРѕРІР°РЅРЅС‹Рµ СЌР»РµРјРµРЅС‚С‹ РїРѕ РєР°С‚РµРіРѕСЂРёСЏРј
    const groupedData = actualItems.reduce((acc, item) => {
        const category = item.category || t('gameInterface.nexusPanel.defaultCategory', 'РџСЂРѕС‡РµРµ');
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
            // *** Р—РђР©РРўРђ: Р”РѕРїРѕР»РЅРёС‚РµР»СЊРЅР°СЏ РїСЂРѕРІРµСЂРєР° РЅР° РєРѕСЂСЂРµРєС‚РЅРѕСЃС‚СЊ РѕР±СЉРµРєС‚Р° ***
            if (!item || typeof item.name !== 'string' || typeof item.value === 'undefined') {
                console.error("РџСЂРѕРїСѓС‰РµРЅ РЅРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ СЌР»РµРјРµРЅС‚ Nexus:", item);
                return; // РџСЂРѕРїСѓСЃРєР°РµРј СЂРµРЅРґРµСЂРёРЅРі СЃР»РѕРјР°РЅРЅРѕРіРѕ СЌР»РµРјРµРЅС‚Р°
            }

            const li = document.createElement('li');
            li.className = 'nexus-item';
            // РљР°СЃС‚РѕРјРЅС‹Р№ С‚СѓР»С‚РёРї РґР»СЏ Nexus
            li.addEventListener('mouseenter', (e) => {
                const desc = item.description || 'РќРµС‚ РїРѕРґСЂРѕР±РЅРѕРіРѕ РѕРїРёСЃР°РЅРёСЏ.';
                const content = `<div style="color:#5d4a36; font-style:italic; margin-bottom: 5px; border-bottom: 1px solid rgba(0,0,0,0.1); padding-bottom: 3px;">РљР°С‚РµРіРѕСЂРёСЏ: ${item.category || 'РџСЂРѕС‡РµРµ'}</div>
                                 <div style="color:#1a110a; line-height: 1.4; font-size: 0.95em; font-weight: 500;">${desc}</div>`;
                showGenericTooltip(e, item.name, content);
            });
            li.addEventListener('mouseleave', hideGenericTooltip);
            li.addEventListener('mousemove', moveGenericTooltip);

            let valueDisplay = '';
            switch (item.displayType) {
                case 'boolean':
                    valueDisplay = item.value === 'true'
                        ? t('gameInterface.nexusPanel.boolTrue', 'Р”Р°')
                        : t('gameInterface.nexusPanel.boolFalse', 'РќРµС‚');
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
            console.log(`РџРѕРїС‹С‚РєР° Р·Р°РіСЂСѓР·РёС‚СЊ РїСЂРµРґРѕРїСЂРµРґРµР»РµРЅРЅС‹Рµ СЌС„С„РµРєС‚С‹ РёР·: ${primary || fallback}`);
            let response = await fetch(`${(primary || fallback)}?t=${Date.now()}`);
            if (!response.ok && !isDefault) {
                response = await fetch(`${fallback}?t=${Date.now()}`);
            }
            if (!response.ok) throw new Error(`HTTP РѕС€РёР±РєР°! СЃС‚Р°С‚СѓСЃ: ${response.status}`);
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

        console.log(`РџСЂРµРґРѕРїСЂРµРґРµР»РµРЅРЅС‹Рµ СЌС„С„РµРєС‚С‹ (${Object.keys(predefinedStatusEffects).length} С€С‚.) СѓСЃРїРµС€РЅРѕ Р·Р°РіСЂСѓР¶РµРЅС‹.`);
    } catch (error) {
        console.error(`РљСЂРёС‚РёС‡РµСЃРєР°СЏ РѕС€РёР±РєР°: РЅРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РёР»Рё СЂР°Р·РѕР±СЂР°С‚СЊ РїСЂРµРґРѕРїСЂРµРґРµР»РµРЅРЅС‹Рµ СЌС„С„РµРєС‚С‹:`, error);
        predefinedStatusEffects = {};
        showCustomAlert(`РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё Р±Р°Р·РѕРІС‹С… РёРіСЂРѕРІС‹С… РґР°РЅРЅС‹С… (СЌС„С„РµРєС‚С‹). РРіСЂР° РјРѕР¶РµС‚ СЂР°Р±РѕС‚Р°С‚СЊ РЅРµРєРѕСЂСЂРµРєС‚РЅРѕ. Р”РµС‚Р°Р»Рё: ${error.message}`);
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
                            addLogMessage(`РљРѕРЅСЃС‚Р°РЅС‚Р° '${nexusItem.name}' РїРѕРІР»РёСЏР»Р° РЅР° РІР°СЃ! (${stat.toUpperCase()} ${change > 0 ? '+' : ''}${change})`, 'level-up');
                            addCalculationMessage(`[NEXUS_AUTO] Р­С„С„РµРєС‚ '${key}' РїСЂРёРјРµРЅРµРЅ. ${stat.toUpperCase()} ${change > 0 ? '+' : ''}${change}.`);
                        }
                    }
                }
                nexusItem.effectApplied = true;
            } catch (e) { console.error("Error parsing nexus effects", e); }
        }
    }

    updateCharacterSheet();
}

// --- РћР±РЅРѕРІР»РµРЅРёРµ РРЅС‚РµСЂС„РµР№СЃР° ---
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

    // --- Р›РћР“РРљРђ РЎРљР РРџРўРћР’РћР“Рћ РџРЈРўР•РЁР•РЎРўР’РРЇ ---
    window.advanceJourney = async function () {
        if (!player || !player.currentJourney) return;

        if (player.currentCombat && player.currentCombat.isActive) {
            showCustomAlert("РЎРЅР°С‡Р°Р»Р° Р·Р°РІРµСЂС€РёС‚Рµ Р±РѕР№!");
            return;
        }

        player.currentJourney.currentPoint++;
        advanceTime(48); // 4 С‡Р°СЃР° РЅР° РѕРґРёРЅ СЌС‚Р°Рї РїСѓС‚Рё
        player.currentJourney.isPausedForCheck = false; // РЎРЅРёРјР°РµРј РїР°СѓР·Сѓ РїСЂРё РїРµСЂРµС…РѕРґРµ
        updateCharacterSheet();

        // Р•СЃР»Рё РґРѕС€Р»Рё РґРѕ РєРѕРЅС†Р°
        if (player.currentJourney.currentPoint > player.currentJourney.points) {
            journeyContinueBtn.style.display = 'none';
            userInput.disabled = false;
            sendButton.style.display = 'block';
            userInput.value = `[SYSTEM: РџРЈРўР•РЁР•РЎРўР’РР• Р—РђР’Р•Р РЁР•РќРћ. РРіСЂРѕРє РїСЂРёР±С‹Р» РІ ${player.currentJourney.destination}. РћРїРёС€Рё РїСЂРёР±С‹С‚РёРµ Рё РІС‹Р·РѕРІРё РєРѕРјР°РЅРґСѓ endJourney]`;
            handleUserInput();
            return;
        }

        // РџРѕР»СѓС‡Р°РµРј СЃРѕР±С‹С‚РёСЏ РґР»СЏ С‚РµРєСѓС‰РµР№ С‚РѕС‡РєРё
        const pointData = player.currentJourney.events[player.currentJourney.currentPoint - 1];
        const options = pointData.options || [];

        if (options.length === 0) {
            addLogMessage(`*Р”РµРЅСЊ ${player.currentJourney.currentPoint} РїСЂРѕС…РѕРґРёС‚ Р±РµР· РїСЂРѕРёСЃС€РµСЃС‚РІРёР№.*`, "gm-message");
            return;
        }

        // Р Р°РЅРґРѕРјРЅС‹Р№ РІС‹Р±РѕСЂ СЃРѕР±С‹С‚РёСЏ СЃРєСЂРёРїС‚РѕРј
        const randomIndex = Math.floor(Math.random() * options.length);
        const selectedEvent = options[randomIndex];

        // РћС‚СЂРёСЃРѕРІРєР° С‚РµРєСЃС‚Р° СЃРѕР±С‹С‚РёСЏ
        addLogMessage(`**[Р­С‚Р°Рї РїСѓС‚Рё ${player.currentJourney.currentPoint}/${player.currentJourney.points}]**\n${selectedEvent.text}`, "gm-message");

        // РћР±СЂР°Р±РѕС‚РєР° РјРµС…Р°РЅРёРєРё СЃРѕР±С‹С‚РёСЏ
        if (selectedEvent.type === 'combat') {
            let participants = [];
            if (selectedEvent.enemies && selectedEvent.enemies.length > 0) {
                                        for (let idx = 0; idx < selectedEvent.enemies.length; idx++) {
                            const en = selectedEvent.enemies[idx];
                            const eId = `j_enemy_${Date.now()}_${idx}`;
                            await executeCommand('addEnvironment', {
                                aiIdentifier: eId,
                                name: en.name || "Р’СЂР°Рі",
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
                executeCommand('addEnvironment', { aiIdentifier: eId, name: "Р Р°Р·Р±РѕР№РЅРёРє", type: "enemy", hp: requireRuntimeNumber(getEnvironmentCommandDefaults().journey_bandit_default_hp, 'gameplay_runtime.command_defaults.environment.journey_bandit_default_hp'), maxHp: requireRuntimeNumber(getEnvironmentCommandDefaults().journey_bandit_default_hp, 'gameplay_runtime.command_defaults.environment.journey_bandit_default_hp'), isHostile: true, xpReward: requireRuntimeNumber(getEnvironmentCommandDefaults().journey_bandit_default_xp_reward, 'gameplay_runtime.command_defaults.environment.journey_bandit_default_xp_reward') });
                participants.push(eId);
            }
            executeCommand('setCombatState', { isActive: true, participants: participants });
            updateCharacterSheet();
        }
 else if (selectedEvent.type === 'check') {
            player.currentJourney.isPausedForCheck = true;
            updateCharacterSheet();
            addLogMessage(`(( РЎРРЎРўР•РњРђ: РџСѓС‚СЊ РїСЂРµСЂРІР°РЅ РїСЂРµРїСЏС‚СЃС‚РІРёРµРј. РўСЂРµР±СѓРµС‚СЃСЏ РїСЂРѕРІРµСЂРєР°: ${selectedEvent.stat.toUpperCase()} (РЎР»РѕР¶РЅРѕСЃС‚СЊ: ${selectedEvent.dc}). РЎРѕРІРµСЂС€РёС‚Рµ РґРµР№СЃС‚РІРёРµ РёР»Рё Р±СЂРѕСЃРѕРє! ))`, "system-message");
        } else if (selectedEvent.type === getInventoryLootRuntimeConfig().event_type) {
            if (selectedEvent.itemId) {
                executeCommand('addItem', { aiIdentifier: selectedEvent.itemId, name: selectedEvent.itemName || "РќР°С…РѕРґРєР°", quantity: selectedEvent.amount ?? requireRuntimeNumber(getInventoryLootRuntimeConfig().default_quantity, 'gameplay_runtime.inventory_loot.default_quantity') });
            }
        }
    };

    if (!player) return;

    // --- РђРљРўРР’РР РЈР•Рњ РЈРџР РђР’Р›Р•РќРР• РљРђР РўРћР™ Р—Р”Р•РЎР¬! ---
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
    updateEquipmentDisplay(); // <--- Р”РћР‘РђР’Р›Р•Рќ Р’Р«Р—РћР’
    updateHoldingsDisplay();
    updateEchoMemoryDisplay();

    updateDiceLogDisplay();
    updateInventoryDisplay();
    updateStatusEffectsDisplay();
    updateQuestList();
    updateSkillsDisplay();
    updateMapDisplay(); // Р­С‚Р° С„СѓРЅРєС†РёСЏ РІС‹Р·РѕРІРµС‚ renderVisualMap
    updateWorldChroniclesDisplay();
    updateTradeJournalDisplay();
    updatePortPanel();

    // Р›РѕРєР°Р»СЊРЅР°СЏ РєР°СЂС‚Р° (CityGen) РѕС‚РєР»СЋС‡РµРЅР° СЃРѕРіР»Р°СЃРЅРѕ РўР— Nexus Cartographer
    const localMapPanel = document.getElementById('local-map-panel');
    if (localMapPanel) {
        localMapPanel.style.display = 'none';
    }

    // Р”Р°РµРј РІСЂРµРјСЏ CSS-Р°РЅРёРјР°С†РёСЏРј Р·Р°РІРµСЂС€РёС‚СЊСЃСЏ, С‡С‚РѕР±С‹ РєР°РЅРІР°СЃ РїРѕР»СѓС‡РёР» СЂРµР°Р»СЊРЅС‹Р№ СЂР°Р·РјРµСЂ
    setTimeout(() => {
        if (window.Cartographer) {
            Cartographer.isMapInitialized = false;
            Cartographer.render();
        }
    }, 500);
    updateEnvironmentPanel();
    updateTimeDisplay();
    
    // Р’РѕР·РѕР±РЅРѕРІР»РµРЅРёРµ С‚Р°Р№РјРµСЂР° РїСѓС‚РµС€РµСЃС‚РІРёСЏ РїСЂРё Р·Р°РіСЂСѓР·РєРµ, РµСЃР»Рё РѕРЅ Р±С‹Р» Р°РєС‚РёРІРµРЅ
    if (player && player.travel && player.travel.active && !player.travel.paused) {
        LivingRoads.resume();
    }

toggleStatIncreaseButtons();

    // РЎРёРЅС…СЂРѕРЅРёР·РёСЂСѓРµРј СЃРѕСЃС‚РѕСЏРЅРёРµ РїР»РµРµСЂР°
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
        if (icon) icon.textContent = shouldBeExpanded ? 'в–ј' : 'в–¶';

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
 * RPG Health Bar вЂ” СЃРѕР·РґР°РµС‚ Рё РѕР±РЅРѕРІР»СЏРµС‚ Р°РЅРёРјРёСЂРѕРІР°РЅРЅСѓСЋ РїРѕР»РѕСЃСѓ Р·РґРѕСЂРѕРІСЊСЏ
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
 * RPG Mana Bar вЂ” СЃРѕР·РґР°РµС‚ Рё РѕР±РЅРѕРІР»СЏРµС‚ Р°РЅРёРјРёСЂРѕРІР°РЅРЅСѓСЋ РїРѕР»РѕСЃСѓ РјР°РЅС‹
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
 * РџРѕР»РЅРѕСЃС‚СЊСЋ РѕР±РЅРѕРІР»СЏРµС‚ РїР°РЅРµР»СЊ РїРµСЂСЃРѕРЅР°Р¶Р° РІ РёРіСЂРѕРІРѕРј РёРЅС‚РµСЂС„РµР№СЃРµ,
 * РѕС‚РѕР±СЂР°Р¶Р°СЏ Р°РєС‚СѓР°Р»СЊРЅС‹Рµ РґР°РЅРЅС‹Рµ РёР· РѕР±СЉРµРєС‚Р° player.
 * Р’РєР»СЋС‡Р°РµС‚ Р»РѕРіРёРєСѓ РґР»СЏ РІРёР·СѓР°Р»СЊРЅРѕРіРѕ РІС‹РґРµР»РµРЅРёСЏ С…Р°СЂР°РєС‚РµСЂРёСЃС‚РёРє,
 * РЅР° РєРѕС‚РѕСЂС‹Рµ РґРµР№СЃС‚РІСѓСЋС‚ Р±Р°С„С„С‹ РёР»Рё РґРµР±Р°С„С„С‹.
 */
function updateCharacterSheet() {
        // РЈРїСЂР°РІР»РµРЅРёРµ UI РїСѓС‚РµС€РµСЃС‚РІРёСЏ Рё Р±Р»РѕРєРёСЂРѕРІРєР° РІРІРѕРґР°
    if (player && player.travel && player.travel.active) {
        if (locationStatLine) locationStatLine.style.display = 'none';
        if (journeyContainer) {
            journeyContainer.style.display = 'flex';
            journeyDest.textContent = `Р’ РїСѓС‚Рё: ${player.travel.destinationName}`;
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
                        // РћР±СЂР°Р±РѕС‚РєР° Р»РѕРєР°Р»РёР·Р°С†РёРё: РµСЃР»Рё description СЃРѕРґРµСЂР¶РёС‚ loc_key, РёСЃРїРѕР»СЊР·СѓРµРј t()
                        let description = '';
                        let descObj = ev.description;

                        // Р•СЃР»Рё description - СЌС‚Рѕ JSON-СЃС‚СЂРѕРєР°, РїР°СЂСЃРёРј РµС‘
                        if (typeof descObj === 'string') {
                            try {
                                const parsed = JSON.parse(descObj);
                                if (typeof parsed === 'object' && parsed !== null) {
                                    descObj = parsed;
                                } else {
                                    description = descObj;
                                }
                            } catch (e) {
                                // РќРµ JSON, РёСЃРїРѕР»СЊР·СѓРµРј РєР°Рє РµСЃС‚СЊ
                                description = descObj;
                            }
                        }

                        // Р•СЃР»Рё РµС‰С‘ РЅРµ СѓСЃС‚Р°РЅРѕРІР»РµРЅРѕ Рё СЌС‚Рѕ РѕР±СЉРµРєС‚
                        if (!description && typeof descObj === 'object' && descObj !== null) {
                            if (descObj.loc_key) {
                                // РСЃРїРѕР»СЊР·СѓРµРј СЃРёСЃС‚РµРјСѓ Р»РѕРєР°Р»РёР·Р°С†РёРё СЃ РєР»СЋС‡РѕРј Рё Р°СЂРіСѓРјРµРЅС‚Р°РјРё
                                description = t(descObj.loc_key, descObj.loc_args || {});
                            } else if (descObj[currentLanguage]) {
                                // Р•СЃР»Рё СЌС‚Рѕ РѕР±СЉРµРєС‚ Р»РѕРєР°Р»РёР·Р°С†РёРё, Р±РµСЂС‘Рј С‚РµРєСѓС‰РёР№ СЏР·С‹Рє
                                description = descObj[currentLanguage] || descObj['ru'] || descObj['en'];
                            } else {
                                description = JSON.stringify(descObj);
                            }
                        }

                        if (!description) {
                            description = String(ev.description || 'РќРµРёР·РІРµСЃС‚РЅРѕРµ СЃРѕР±С‹С‚РёРµ');
                        }

                        let safeDesc = description.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                        htmlText += `<div class="journey-event-row">
                                        <div class="journey-event-text-container"><strong>[РЎРѕР±С‹С‚РёРµ]</strong> ${description}</div>`;
                        if (ev.can_interact) {
                            htmlText += `<div class="journey-event-btn-container">
                                            <button class="travel-action-btn" onclick="LivingRoads.interact('${ev.object_type}', '${ev.sim_object_id}', '${safeDesc}')"><i class="fas fa-search"></i> РСЃСЃР»РµРґРѕРІР°С‚СЊ</button>
                                         </div>`;
                        }
                        htmlText += `</div>`;
                    });
                    if (journeyEventText) journeyEventText.innerHTML = htmlText;
                    if (journeyEventActions) {
                        // Рў3 Р¤РРљРЎ: РљСЂРёС‚РёС‡РµСЃРєРёРµ СЃРѕР±С‹С‚РёСЏ (СЂРµРєР°, Р±Р°РЅРґРёС‚С‹, Р±РµРґСЃС‚РІРёСЏ) РЅРµР»СЊР·СЏ РїСЂРѕСЃС‚Рѕ РїСЂРѕРїСѓСЃС‚РёС‚СЊ
                        const hasCriticalEvent = player.travel.currentEvents.some(ev => ['river_crossing', 'bandit', 'disaster'].includes(ev.object_type));
                        if (hasCriticalEvent) {
                            journeyEventActions.innerHTML = `<div style="text-align:center; color:#e74c3c; font-size:0.8em; padding:5px;"><i class="fas fa-exclamation-triangle"></i> Р­С‚Рѕ РїСЂРµРїСЏС‚СЃС‚РІРёРµ РЅРµРІРѕР·РјРѕР¶РЅРѕ РїСЂРѕСЃС‚Рѕ РѕР±РѕР№С‚Рё. РќСѓР¶РЅРѕ СЂРµС€РµРЅРёРµ.</div>`;
                        } else {
                            journeyEventActions.innerHTML = `<button class="travel-action-btn btn-continue" style="width: 100%; margin: 0;" onclick="LivingRoads.resume()"><i class="fas fa-shoe-prints"></i> РЈР№С‚Рё РґР°Р»СЊС€Рµ</button>`;
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
                    travelPauseBtn.title = player.travel.paused ? 'РџСЂРѕРґРѕР»Р¶РёС‚СЊ РїСѓС‚СЊ' : 'РћСЃС‚Р°РЅРѕРІРёС‚СЊСЃСЏ (РџР°СѓР·Р°)';
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
                userInput.placeholder = (player.currentCombat && player.currentCombat.isActive) ? "Р§С‚Рѕ РІС‹ Р±СѓРґРµС‚Рµ РґРµР»Р°С‚СЊ РІ Р±РѕСЋ?" : "РџСѓС‚СЊ РїСЂРёРѕСЃС‚Р°РЅРѕРІР»РµРЅ. Р§С‚Рѕ РґРµР»Р°РµРј?";
            }
        } else {
            if (sendButton) sendButton.style.display = 'none';
            if (userInput) {
                userInput.disabled = true;
                userInput.placeholder = LivingRoads.isGeneratingHour ? "Р“РµРЅРµСЂР°С†РёСЏ РїСѓС‚Рё..." : (player.travel.currentEvents && player.travel.currentEvents.length > 0 ? "РЎРґРµР»Р°Р№С‚Рµ РІС‹Р±РѕСЂ РІ РїР°РЅРµР»Рё РІС‹С€Рµ" : "Р’С‹ РІ РїСѓС‚Рё... (РРґРµС‚ РІСЂРµРјСЏ)");
            }
        }
    } else if (player && player.currentJourney) {
        if (locationStatLine) locationStatLine.style.display = 'none';
        if (journeyContainer) {
            journeyContainer.style.display = 'flex';
            // Р’РёР·СѓР°Р»СЊРЅР°СЏ РёРЅРґРёРєР°С†РёСЏ Р±РѕСЏ РІ РїСѓС‚РµС€РµСЃС‚РІРёРё
            if (player.currentCombat && player.currentCombat.isActive) {
                journeyDest.innerHTML = `Р’ РїСѓС‚Рё: ${player.currentJourney.destination} <span style="color: #e74c3c;">[Р‘РћР™!]</span>`;
            } else {
                journeyDest.textContent = `Р’ РїСѓС‚Рё: ${player.currentJourney.destination}`;
            }
            journeyProgressText.textContent = `${player.currentJourney.currentPoint} / ${player.currentJourney.points}`;
            const pct = Math.min(100, (player.currentJourney.currentPoint / player.currentJourney.points) * 100);
            journeyProgressBar.style.width = `${pct}%`;
        }
        if ((player.currentCombat && player.currentCombat.isActive) || player.currentJourney.isPausedForCheck) {
            // Р‘РѕР№ Р°РєС‚РёРІРµРЅ РёР»Рё С‚СЂРµР±СѓРµС‚СЃСЏ РїСЂРѕРІРµСЂРєР° - Р±Р»РѕРєРёСЂСѓРµРј РєРЅРѕРїРєСѓ РїСЂРѕРґРѕР»Р¶РµРЅРёСЏ РїСѓС‚РµС€РµСЃС‚РІРёСЏ
            if (journeyContinueBtn) journeyContinueBtn.style.display = 'none';
            if (sendButton) sendButton.style.display = 'block';
            if (userInput) {
                if (!isWaitingForAI) userInput.disabled = false;
                userInput.placeholder = "Р§С‚Рѕ РІС‹ Р±СѓРґРµС‚Рµ РґРµР»Р°С‚СЊ РІ Р±РѕСЋ?";
            }
        } else {
            // РџСѓС‚РµС€РµСЃС‚РІРёРµ РёРґС‘С‚ РЅРѕСЂРјР°Р»СЊРЅРѕ - РїРѕРєР°Р·С‹РІР°РµРј РєРЅРѕРїРєСѓ РїСЂРѕРґРѕР»Р¶РµРЅРёСЏ
            if (journeyContinueBtn) journeyContinueBtn.style.display = 'block';
            if (sendButton) sendButton.style.display = 'none';
            if (userInput) {
                userInput.disabled = true;
                userInput.placeholder = "Р’С‹ РІ РїСѓС‚Рё... (РЈСЃС‚Р°СЂРµРІС€Р°СЏ СЃРёСЃС‚РµРјР°)";
            }
        }
            } else {
            // РќРµС‚ РїСѓС‚РµС€РµСЃС‚РІРёСЏ - СЃС‚Р°РЅРґР°СЂС‚РЅС‹Р№ UI
            if (locationStatLine) locationStatLine.style.display = 'flex';
            if (journeyContainer) journeyContainer.style.display = 'none';
            if (journeyContinueBtn) journeyContinueBtn.style.display = 'none';

            if (sendButton) sendButton.style.display = 'block';
            if (userInput) {
                if (!isWaitingForAI && !window.isSimulatingTime) userInput.disabled = false;
                userInput.placeholder = "Р§С‚Рѕ РІС‹ Р±СѓРґРµС‚Рµ РґРµР»Р°С‚СЊ?";
            }
        }

    if (!player) return;

    const { effectiveStats, bonuses, breakdown } = getEffectiveStats();

    // РћР±РЅРѕРІР»РµРЅРёРµ РРјРµРЅРё, Р Р°СЃС‹, РљР»Р°СЃСЃР°
    charNameDisplay.querySelector('span:last-child').textContent = player.name || "???";
    charNameDisplay.style.cursor = 'pointer';
    charNameDisplay.title = "РќР°Р¶РјРёС‚Рµ, С‡С‚РѕР±С‹ РѕС‚РєСЂС‹С‚СЊ РїРѕР»РЅСѓСЋ Р»РµС‚РѕРїРёСЃСЊ (РїСЂРµРґС‹СЃС‚РѕСЂРёСЋ)";
    charNameDisplay.onclick = () => {
        const modal = document.getElementById('biography-modal');
        const content = document.getElementById('biography-modal-content');
        const title = document.getElementById('biography-modal-title');
        if (modal && content) {
            title.textContent = `Р›РµС‚РѕРїРёСЃСЊ: ${player.name}`;
            content.textContent = player.description || "РџСЂРµРґС‹СЃС‚РѕСЂРёСЏ СЃРєСЂС‹С‚Р° РІ С‚СѓРјР°РЅРµ РІСЂРµРјРµРЅРё...";
            modal.style.display = 'flex';
            setTimeout(() => modal.classList.add('visible'), 10);
        }
    };

    charRaceDisplay.querySelector('span:last-child').textContent = t(`characterCreation.race${player.race.charAt(0).toUpperCase() + player.race.slice(1)}`, null, player.race);
    charClassDisplay.querySelector('span:last-child').textContent = t(`characterCreation.class${player.class.charAt(0).toUpperCase() + player.class.slice(1)}`, null, player.class);

    // РћР±РЅРѕРІР»РµРЅРёРµ Р—РґРѕСЂРѕРІСЊСЏ Рё РњР°РЅС‹
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

            // РћР±РЅРѕРІР»РµРЅРёРµ РѕСЃРЅРѕРІРЅС‹С… С…Р°СЂР°РєС‚РµСЂРёСЃС‚РёРє СЃ РљР РђРЎРР’Р«РњР С‚СѓР»С‚РёРїР°РјРё
        const statsToUpdate = ['str', 'dex', 'int', 'con', 'cha', 'res'];
        statsToUpdate.forEach(statKey => {
            const statLine = document.querySelector(`.stat-line[data-stat="${statKey}"]`);
            const statValueElement = document.getElementById(`stat-${statKey}`);
            if (!statValueElement || !statLine) return;

            const base = player.stats[statKey];
            const bonus = bonuses[statKey] || 0;

            // РЈРґР°Р»СЏРµРј СЃС‚Р°СЂС‹Р№ СЃРёСЃС‚РµРјРЅС‹Р№ С‚СѓР»С‚РёРї
            statLine.removeAttribute('title');

            // РџСЂРёРІСЏР·С‹РІР°РµРј РЅР°С€ РєСЂР°СЃРёРІС‹Р№ С‚СѓР»С‚РёРї
            statLine.onmouseenter = (e) => {
                let content = `<div style="color:#1a110a; font-size: 1.1em; margin-bottom:5px; border-bottom: 1px solid rgba(0,0,0,0.2); padding-bottom: 3px;">РС‚РѕРіРѕРІРѕРµ Р·РЅР°С‡РµРЅРёРµ: <b>${effectiveStats[statKey]}</b></div>`;
                content += `<div style="color:#2c1e14; margin-bottom:5px;">Р‘Р°Р·РѕРІРѕРµ Р·РЅР°С‡РµРЅРёРµ: <b>${base}</b></div>`;
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

    // РћР±РЅРѕРІР»РµРЅРёРµ РіР»Р°РІРЅРѕР№ РїРѕР»РѕСЃРєРё СЂРµРїСѓС‚Р°С†РёРё
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
        if (currentInventoryFilter === 'potion' && (iType === 'potion' || iType === 'Р·РµР»СЊРµ' || iType === 'consumable')) return true;
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

            const itemName = props.name || item.prototype_id || 'РќРµРёР·РІРµСЃС‚РЅС‹Р№ РїСЂРµРґРјРµС‚';
            let rarityClass = props.rarity ? props.rarity.toLowerCase().replace(/[^a-zР°-СЏС‘0-9]/g, '-') : '';

            // РџСЂРѕРІРµСЂРєР°: СЏРІР»СЏРµС‚СЃСЏ Р»Рё РїСЂРµРґРјРµС‚ С‚СЂР°РЅСЃРїРѕСЂС‚РѕРј (С‡РµСЂРµР· С†РµРЅС‚СЂР°Р»РёР·РѕРІР°РЅРЅС‹Р№ TransportSystem)
            const isTransport = TransportSystem.isTransportId(item.prototype_id) ||
                               TransportSystem.isTransportId(props.aiIdentifier) ||
                               props.isTransport === true;

            li.innerHTML = `
                <span class="item-name ${rarityClass}">${itemName}</span>
                <span class="item-quantity">(x${item.stack_size})</span>
            `;

            // Р”РѕР±Р°РІР»СЏРµРј РєРЅРѕРїРєСѓ "РћСЃРµРґР»Р°С‚СЊ" РґР»СЏ С‚СЂР°РЅСЃРїРѕСЂС‚Р°
            if (isTransport) {
                // РРЅРёС†РёР°Р»РёР·РёСЂСѓРµРј activeTransport, РµСЃР»Рё РЅРµ СЃСѓС‰РµСЃС‚РІСѓРµС‚
                if (!player.activeTransport) {
                    player.activeTransport = null;
                }

                const isMounted = player.activeTransport && player.activeTransport.itemId === item.id;
                const mountBtn = document.createElement('button');
                mountBtn.textContent = isMounted ? t('transport.dismount', 'РЎРїРµС€РёС‚СЊСЃСЏ') : t('transport.mount', 'РћСЃРµРґР»Р°С‚СЊ');
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

            // Р”РѕР±Р°РІР»СЏРµРј РєРЅРѕРїРєСѓ "РР·СѓС‡РёС‚СЊ" (Р›РµС‚РѕРїРёСЃСЊ)
            const examineBtn = document.createElement('button');
            examineBtn.innerHTML = '<i class="fas fa-search"></i>';
            examineBtn.className = 'btn-small';
            examineBtn.style.marginLeft = '10px';
            examineBtn.style.backgroundColor = 'rgba(142, 68, 173, 0.7)';
            examineBtn.style.borderColor = '#8e44ad';
            examineBtn.title = 'РР·СѓС‡РёС‚СЊ РїСЂРµРґРјРµС‚ (Р›РµС‚РѕРїРёСЃСЊ)';
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

    document.getElementById('examine-title').textContent = parseLocString(item.name) || 'РќРµРёР·РІРµСЃС‚РЅС‹Р№ РїСЂРµРґРјРµС‚';
    
    const rarityEl = document.getElementById('examine-rarity');
    rarityEl.textContent = item.rarity || 'РћР±С‹С‡РЅС‹Р№';
    rarityEl.style.color = getRarityColor(item.rarity);

    document.getElementById('examine-desc').textContent = parseLocString(item.description) || 'РќРµС‚ РѕРїРёСЃР°РЅРёСЏ.';

    let statsHtml = '';
    if (item.effects && item.effects.length > 0) {
        statsHtml += `<div><strong>Р­С„С„РµРєС‚С‹:</strong> ${item.effects.map(e => `${e.stat.toUpperCase()} ${e.change > 0 ? '+' : ''}${e.change}`).join(', ')}</div>`;
    }
    statsHtml += `<div><strong>Р¦РµРЅРЅРѕСЃС‚СЊ:</strong> ${item.value || 0} рџ’°</div>`;
    document.getElementById('examine-stats').innerHTML = statsHtml || 'РќРµС‚ С…Р°СЂР°РєС‚РµСЂРёСЃС‚РёРє';

    const historyEl = document.getElementById('examine-history-content');
    if (item.history && item.history.length > 0) {
        historyEl.innerHTML = item.history.map(h => `<div style="margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 2px;"><span style="color:#f39c12;">[Р”РµРЅСЊ ${h.day}]</span> ${parseLocString(h.event)}</div>`).join('');
    } else {
        historyEl.innerHTML = '<div style="font-style:italic;">РСЃС‚РѕСЂРёСЏ СЌС‚РѕРіРѕ РїСЂРµРґРјРµС‚Р° СЃРєСЂС‹С‚Р° РІРѕ С‚СЊРјРµ РІРµРєРѕРІ...</div>';
    }

    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('visible'), 10);
}


// РќРћР’РђРЇ Р¤РЈРќРљР¦РРЇ: РћР±РЅРѕРІР»РµРЅРёРµ РїР°РЅРµР»Рё СЃС‚Р°С‚СѓСЃ-СЌС„С„РµРєС‚РѕРІ
function updateStatusEffectsDisplay() {
    if (!player || !statusEffectsList) return;
    statusEffectsList.innerHTML = '';
    const effects = Object.values(player.statusEffects || {});

    if (effects.length === 0) {
        statusEffectsList.innerHTML = `<li data-i18n="gameInterface.statusEffectsPanel.empty">${t('gameInterface.statusEffectsPanel.empty', 'РќРµС‚ Р°РєС‚РёРІРЅС‹С… СЌС„С„РµРєС‚РѕРІ')}</li>`;
    } else {
        effects.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        effects.forEach(effect => {
            const li = document.createElement('li');
            li.classList.add('status-effect-item');
            li.title = effect.description || t('gameInterface.statusEffectsPanel.noDescription', 'РќРµС‚ РїРѕРґСЂРѕР±РЅРѕРіРѕ РѕРїРёСЃР°РЅРёСЏ.');

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
            const title = quest.title || t('quests.defaultTitle', null, 'Р‘РµР· РЅР°Р·РІР°РЅРёСЏ');
            const objective = quest.objective || '?';
            const description = quest.description || t('quests.noDescription', null, 'РќРµС‚ РѕРїРёСЃР°РЅРёСЏ');
            let rawReward = quest.reward;
            let rawIssuer = quest.issuer;
            let rewardValue = t('quests.unknown', null, 'РќРµРёР·РІРµСЃС‚РЅРѕ');
            const trimmedLowerReward = String(rawReward || '').trim().toLowerCase();
            if (rawReward !== undefined && rawReward !== null && trimmedLowerReward !== '' && trimmedLowerReward !== '?' && !trimmedLowerReward.startsWith('?,')) {
                rewardValue = rawReward;
            }
            let issuerValue = t('quests.unknown', null, 'РќРµРёР·РІРµСЃС‚РЅРѕ');
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

        // РўРѕР»СЊРєРѕ РїСЂРѕРІРµСЂСЏРµРј СЃС‚РѕРёРјРѕСЃС‚СЊ, СЃРїРёС€РµРј РїСЂРё РѕС‚РїСЂР°РІРєРµ С…РѕРґР°
        let costVal = parseInt(skill.cost) || 0;
        let costType = (skill.costType || '').toLowerCase();
        if (costType.includes('mp') || costType.includes('РјР°РЅ')) {
            if (player.stats.mana < costVal) { showCustomAlert("РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РјР°РЅС‹!"); return; }
        } else if (costType.includes('hp') || costType.includes('Р·РґРѕСЂРѕРІСЊ') || costType.includes('stamina') || costType.includes('РІС‹РЅРѕСЃР»РёРІРѕСЃС‚')) {
            if (player.stats.hp <= costVal) { showCustomAlert("РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ Р·РґРѕСЂРѕРІСЊСЏ/РІС‹РЅРѕСЃР»РёРІРѕСЃС‚Рё!"); return; }
        }

        createSkillBadge(skillId, skill.name, skill.effect);
    };

    function createSkillBadge(skillId, skillName, skillEffect) {
        const container = document.getElementById('active-rolls-container');
        if (!container) return;

        const existing = container.querySelectorAll('.skill-badge');
        for (let b of existing) {
            if (b.dataset.skillId === skillId) return; // РЈР¶Рµ РґРѕР±Р°РІР»РµРЅРѕ
        }

        const badge = document.createElement('div');
        badge.className = 'roll-badge skill-badge';
        badge.dataset.skillId = skillId;
        badge.dataset.resultText = `[SYSTEM_MECHANIC: РђРљРўРР’РР РћР’РђРќРћ РЈРњР•РќРР• | РРњРЇ: ${skillName} | Р­Р¤Р¤Р•РљРў: ${skillEffect}]`;

        badge.innerHTML = `
        <span>вњЁ ${skillName}</span>
        <span class="roll-badge-close" title="РћС‚РјРµРЅРёС‚СЊ">вњ–</span>
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
            li.title = skill.description || t('skills.noDescription', null, 'РќРµС‚ РѕРїРёСЃР°РЅРёСЏ');

            let detailsHTML = '';
            if (skill.damage && String(skill.damage).toLowerCase() !== 'РЅРµС‚') {
                detailsHTML += `<span><strong>${t('skills.damageLabel', 'РЈСЂРѕРЅ')}:</strong> ${skill.damage}</span>`;
            }
            if (skill.cost && skill.costType && String(skill.costType).toLowerCase() !== 'РЅРµС‚') {
                detailsHTML += `<span><strong>${t('skills.costLabel', 'РЎС‚РѕРёРјРѕСЃС‚СЊ')}:</strong> ${skill.cost} ${skill.costType}</span>`;
            } else if (skill.cost && String(skill.cost).toLowerCase() !== '0' && String(skill.cost).toLowerCase() !== 'РЅРµС‚') {
                detailsHTML += `<span><strong>${t('skills.costLabel', 'РЎС‚РѕРёРјРѕСЃС‚СЊ')}:</strong> ${skill.cost}</span>`;
            }
            if (skill.duration && String(skill.duration).toLowerCase() !== 'РЅРµС‚') {
                detailsHTML += `<span><strong>${t('skills.durationLabel', 'Р”Р»РёС‚.')}:</strong> ${skill.duration}</span>`;
            }
            if (skill.cooldown && String(skill.cooldown).toLowerCase() !== 'РЅРµС‚') {
                detailsHTML += `<span><strong>${t('skills.cooldownLabel', 'РџРµСЂРµР·Р°СЂ.')}:</strong> ${skill.cooldown}</span>`;
            }
            if (skill.skillType && String(skill.skillType).toLowerCase() !== 'РЅРµС‚') {
                detailsHTML += `<span><strong>${t('skills.typeLabel', 'РўРёРї')}:</strong> ${skill.skillType}</span>`;
            }

            let effectDisplay = skill.effect || '';
            if (effectDisplay.toLowerCase() === 'РЅРµС‚') effectDisplay = '';

            let cdText = '';
            let isUsable = false;
            if (skill.skillType && skill.skillType.toLowerCase().includes('Р°РєС‚РёРІ')) {
                isUsable = true;
                if (skill.currentCooldown > 0) {
                    cdText = `<span style="color:#e74c3c; font-weight:bold; margin-left:10px; font-size:0.85em;">(РћС‚РєР°С‚: ${skill.currentCooldown} С…РѕРґ.)</span>`;
                }
            }

            li.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                    <span class="skill-name" style="margin:0;">${skill.name || skill.id} ${cdText}</span>
                    ${isUsable && (!skill.currentCooldown || skill.currentCooldown <= 0) ? `<button class="use-skill-btn" data-id="${skill.id}">${t('gameInterface.skills.use', null, 'РџСЂРёРјРµРЅРёС‚СЊ')}</button>` : ''}
                </div>
                <span class="skill-description">${skill.description || ''}</span>
                ${detailsHTML ? `<div class="skill-details">${detailsHTML}</div>` : ''}
                ${effectDisplay ? `<div class="skill-effect"><strong>${t('skills.effectLabel', 'Р­С„С„РµРєС‚')}:</strong> ${effectDisplay}</div>` : ''}
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
                    <button class="c-filter-btn ${currentChronicleFilter === 'trade' ? 'active' : ''}" data-filter="trade">рџ’° ${t('extraLoc.chronicles.economy')}</button>
                    <button class="c-filter-btn ${currentChronicleFilter === 'business' ? 'active' : ''}" data-filter="business">рџЏ­ ${t('extraLoc.chronicles.business')}</button>
                    <button class="c-filter-btn ${currentChronicleFilter === 'market' ? 'active' : ''}" data-filter="market">вљ–пёЏ ${t('extraLoc.chronicles.market')}</button>
                    <button class="c-filter-btn ${currentChronicleFilter === 'logistics' ? 'active' : ''}" data-filter="logistics">рџ“¦ ${t('extraLoc.chronicles.logistics')}</button>
                    <button class="c-filter-btn ${currentChronicleFilter === 'politics' ? 'active' : ''}" data-filter="politics">рџЏ›пёЏ РџРѕР»РёС‚РёРєР°</button>
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
        item.category === 'World_Event' || item.category === 'РњРёСЂРѕРІРѕРµ РЎРѕР±С‹С‚РёРµ' || item.id.startsWith('event_')
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

    // РЎРќРђР§РђР›Рђ simNews (СЃРѕСЂС‚РёСЂРѕРІРєР° РїРѕ СЃРІРµР¶РµСЃС‚Рё)
    simNews.sort((a, b) => a.daysOld - b.daysOld).forEach(news => {
        currentChronicleList.push({ type: 'sim', data: news });
    });

    // Р—РђРўР•Рњ events (РєРѕРЅСЃС‚Р°РЅС‚С‹ Nexus)
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
            const isActive = (ev.value === 'РђРљРўРР’РќРћ' || ev.value === 'active' || ev.value === 'РђРєС‚РёРІРЅРѕ' || ev.value === 'ACTIVE');
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
            if (news.category === 'politics') { icon = '<i class="fas fa-landmark"></i>'; catName = t('extraLoc.chronicles.politics', null, 'РџРѕР»РёС‚РёРєР°'); color = '#8e44ad'; }

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
        btnNext.innerHTML = `${t('extraLoc.chronicles.forward')} в–¶`;
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
            <span style="color:#bdc3c7">рџ“¦ ${name}</span>
            <span style="color:#f5b041; font-weight:bold;">${price.toFixed(1)} рџ’°</span>
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
            offersHtml += `<li style="display:flex; justify-content:space-between; padding: 2px 0; font-size: 0.85em;"><span style="color:#bdc3c7">${goodName} (x${offer.quantity})</span><span style="color:#f5b041;">${offer.price.toFixed(1)} рџ’°</span></li>`;
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
            // Р РµРЅРґРµСЂ Р·Р°РїСѓСЃРєР°РµС‚СЃСЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё С‡РµСЂРµР· requestAnimationFrame РІРЅСѓС‚СЂРё Cartographer
        });
    }
}

// РќРћР’РђРЇ Р¤РЈРќРљР¦РРЇ РґР»СЏ РѕР±РЅРѕРІР»РµРЅРёСЏ РїР°РЅРµР»Рё РѕРєСЂСѓР¶РµРЅРёСЏ
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
            nameSpan.textContent = entity.name || entity.id || t('gameInterface.environmentPanel.unknownEntity', 'РќРµРёР·РІРµСЃС‚РЅРѕРµ СЃСѓС‰РµСЃС‚РІРѕ');

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
                description: entity.description || t('gameInterface.environmentPanel.noDescription', 'РќРµС‚ РїРѕРґСЂРѕР±РЅРѕРіРѕ РѕРїРёСЃР°РЅРёСЏ.'),
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
            
            // === Р”РћР‘РђР’Р›Р•РќРћ: РљР»РёРє РїРѕ С‚РѕСЂРіРѕРІС†Сѓ РѕС‚РєСЂС‹РІР°РµС‚ СЂС‹РЅРѕРє ===
            const isMerchant = entity.type === 'npc' && entity.traits &&
                ['merchant', 'trader', 'peddler', 'С‚РѕСЂРіРѕРІРµС†', 'РєСѓРїРµС†'].some(t =>
                    entity.traits.some(trait => trait.toLowerCase().includes(t))
                );

            if (isMerchant) {
                li.style.cursor = 'pointer';
                li.addEventListener('click', () => openMarketInterface(entity));
                li.title = "РќР°Р¶РјРёС‚Рµ С‡С‚РѕР±С‹ РѕС‚РєСЂС‹С‚СЊ С‚РѕСЂРіРѕРІР»СЋ";
            } else if (entity.type === 'npc') {
                // РљР»РёРє РїРѕ РѕР±С‹С‡РЅРѕРјСѓ NPC РѕС‚РєСЂС‹РІР°РµС‚ РјРѕРґР°Р»СЊРЅРѕРµ РѕРєРЅРѕ СЃ РѕС‚РЅРѕС€РµРЅРёСЏРјРё
                li.style.cursor = 'pointer';
                li.addEventListener('click', () => showNPCDetailsModal(entity.aiIdentifier));
                li.title = "РќР°Р¶РјРёС‚Рµ С‡С‚РѕР±С‹ РїРѕСЃРјРѕС‚СЂРµС‚СЊ РґРµС‚Р°Р»Рё";
            }

            environmentList.appendChild(li);
        });
    }
}

// РќРћР’Р«Р• Р¤РЈРќРљР¦РР РґР»СЏ РІСЃРїР»С‹РІР°СЋС‰РµР№ РїРѕРґСЃРєР°Р·РєРё
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
            Р­С„С„РµРєС‚С‹: ${item.effects.map(e => `${e.stat.toUpperCase()} ${e.change > 0 ? '+' : ''}${e.change}`).join(', ')}
        </div>`;
    }

    let historyHtml = '';
    if (item.history && item.history.length > 0) {
        const historyItems = item.history.slice(-3).map(h => `[Р”РµРЅСЊ ${h.day}] ${parseLocString(h.event)}`).join('<br>');
        historyHtml = `<div style="margin-top:8px; border-top:1px dashed #2c1e14; padding-top:5px; font-size:0.85em; color:#d35400;">
            <strong>Р›РµС‚РѕРїРёСЃСЊ РїСЂРµРґРјРµС‚Р°:</strong><br>${historyItems}
        </div>`;
    }

    itemTooltipElement.innerHTML = `
        <div class="item-card-header">${parseLocString(item.name)}</div>
        <div class="item-card-body">
            <span class="item-card-rarity" style="color: ${rarityColor}">${item.rarity || 'РћР±С‹С‡РЅС‹Р№'}</span>
            <div style="font-style:italic;">${parseLocString(item.description)}</div>
            ${effectsHtml}
            ${historyHtml}
            <div style="margin-top:8px; font-size:0.85em; text-align:right; opacity:0.8;">рџ’° Р¦РµРЅРЅРѕСЃС‚СЊ: ${item.value || 0}</div>
        </div>
    `;

    itemTooltipElement.style.display = 'block';
    moveItemTooltip(event);
}


function getRarityColor(r) {
    const s = String(r).toLowerCase();
    if (s.includes('РЅРµРѕР±С‹С‡')) return '#1eff00';
    if (s.includes('СЂРµРґРє')) return '#0070dd';
    if (s.includes('СЌРїРёС‡')) return '#a335ee';
    if (s.includes('Р»РµРіРµРЅРґ')) return '#ff8000';
    return '#5d4a36';
}

function moveItemTooltip(e) {
    if (!itemTooltipElement) return;
    let x = e.pageX + 20;
    let y = e.pageY - 150; // РџРѕРґРЅРёРјР°РµРј РІС‹С€Рµ РєСѓСЂСЃРѕСЂР°
    if (x + 230 > window.innerWidth) x = e.pageX - 250;
    if (y < 10) y = e.pageY + 20; // Р•СЃР»Рё СЃРІРµСЂС…Сѓ РјР°Р»Рѕ РјРµСЃС‚Р°, РєРёРґР°РµРј РІРЅРёР·
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
    if (data.str !== undefined) statsHtml += `<p><span class="stat-label">${t('gameInterface.characterPanel.str', 'вљ”пёЏ РЎРёР»Р°')}:</span> <span class="stat-value">${data.str}</span></p>`;
    if (data.dex !== undefined) statsHtml += `<p><span class="stat-label">${t('gameInterface.characterPanel.dex', 'рџ¤ё Р›РѕРІРєРѕСЃС‚СЊ')}:</span> <span class="stat-value">${data.dex}</span></p>`;
    if (data.con !== undefined) statsHtml += `<p><span class="stat-label">${t('gameInterface.characterPanel.con', 'л§· Р’С‹РЅРѕСЃР»РёРІРѕСЃС‚СЊ')}:</span> <span class="stat-value">${data.con}</span></p>`;
    if (data.int !== undefined) statsHtml += `<p><span class="stat-label">${t('gameInterface.characterPanel.int', 'рџ’Ў РРЅС‚РµР»Р»РµРєС‚')}:</span> <span class="stat-value">${data.int}</span></p>`;
    if (allowNSFW && data.lust !== undefined) statsHtml += `<p><span class="stat-label" style="color:#e91e63;">рџ’‹ РџРѕС…РѕС‚СЊ:</span> <span class="stat-value" style="color:#e91e63;">${data.lust}%</span></p>`;

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
        healthText = `<p><strong>${t('gameInterface.environmentPanel.tooltip.health', 'Р—РґРѕСЂРѕРІСЊРµ')}:</strong> <span class="stat-value">${data.hp} / ${data.maxHp}</span></p>`;
    }


    let traitsHtml = '';
    if (data.traits && data.traits.length > 0) {
        traitsHtml = `<p><strong style="color: #9b59b6;">Р§РµСЂС‚С‹:</strong> <span style="color: #ecf0f1; font-style: italic;">${data.traits.join(', ')}</span></p>`;
    }

    let econHtml = '';
    if (data.profession_type && data.profession_type !== 'none') {
        const profMap = { 'farmer': 'РљСЂРµСЃС‚СЊСЏРЅРёРЅ', 'artisan': 'Р РµРјРµСЃР»РµРЅРЅРёРє', 'merchant': 'РљСѓРїРµС†', 'innkeeper': 'РўСЂР°РєС‚РёСЂС‰РёРє', 'ruler': 'Р¤РµРѕРґР°Р»', 'cleric': 'РЎРІСЏС‰РµРЅРЅРёРє', 'mage': 'РњР°Рі', 'mercenary': 'РќР°РµРјРЅРёРє' };
        econHtml = `<p><strong style="color: #2ecc71;">Р РѕР»СЊ:</strong> <span style="color: #ecf0f1;">${profMap[data.profession_type] || data.profession_type}</span> | <strong style="color: #f1c40f;">РљР°РїРёС‚Р°Р»:</strong> ${data.savings} Р·.</p>`;
    }

    let woundsHtml = '';
    if (typeof World !== 'undefined' && World && World.npcs && World.npcs[data.id] && World.npcs[data.id].wounds) {
        const wounds = World.npcs[data.id].wounds;
        if (wounds.length > 0) {
            const wList = wounds.map(w => `${w.type} (С‚СЏР¶РµСЃС‚СЊ: ${w.severity})`).join(', ');
            woundsHtml = `<p><strong style="color: #e74c3c;">Р Р°РЅРµРЅРёСЏ:</strong> <span style="color: #ffcccc;">${wList}</span></p>`;
        }
    }

    entityTooltip.innerHTML = `
        <h4>${data.name}</h4>
        <p><strong>${t('gameInterface.environmentPanel.tooltip.type', 'РўРёРї')}:</strong> ${data.type}</p>
        ${econHtml}
        ${traitsHtml}
        ${woundsHtml}
        ${healthText}
        ${healthBarHtml}
        ${statsHtml}
        <p class="description-text">${data.description}</p>
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
        const xOffset = 25; // Рў3 Р¤РРљРЎ: РЈРІРµР»РёС‡РµРЅ РѕС‚СЃС‚СѓРї, С‡С‚РѕР±С‹ РѕРєРЅРѕ РЅРµ РїРµСЂРµРєСЂС‹РІР°Р»Рѕ РєСѓСЂСЃРѕСЂ
        const yOffset = 15;
        let newX = event.pageX + xOffset;
        let newY = event.pageY + yOffset;

        const tooltipRect = entityTooltip.getBoundingClientRect();
        const bodyRect = document.body.getBoundingClientRect();

        // РџСЂРµРґРѕС‚РІСЂР°С‰РµРЅРёРµ РІС‹С…РѕРґР° Р·Р° РїСЂРµРґРµР»С‹ СЌРєСЂР°РЅР°
        if (newX + tooltipRect.width > window.innerWidth - 10) { // 10px РѕС‚СЃС‚СѓРї РѕС‚ РєСЂР°СЏ
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

// === РњРћР”РђР›Р¬РќРћР• РћРљРќРћ Р”Р›РЇ РћРўРћР‘Р РђР–Р•РќРРЇ РћРўРќРћРЁР•РќРР™ РЎ NPC ===
function showNPCDetailsModal(npcId) {
    const npc = player.allKnownEntities[npcId];
    if (!npc) return;

    // РЎРѕР·РґР°С‘Рј РјРѕРґР°Р»СЊРЅРѕРµ РѕРєРЅРѕ
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

    // РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ relationships РµСЃР»Рё РЅРµС‚
    if (!npc.relationships) {
        npc.relationships = {
            player: { affection: 0, attraction: 0, trust: 0, intimacy: 0, sexualHistory: [] }
        };
    }
    if (!npc.relationships.player) {
        npc.relationships.player = { affection: 0, attraction: 0, trust: 0, intimacy: 0, sexualHistory: [] };
    }

    const rel = npc.relationships.player;

    // Р¤СѓРЅРєС†РёСЏ РґР»СЏ РїРѕР»СѓС‡РµРЅРёСЏ С†РІРµС‚Р° РїСЂРѕРіСЂРµСЃСЃ-Р±Р°СЂР°
    const getBarColor = (value, isAffection = false) => {
        if (isAffection) {
            if (value >= 50) return '#27ae60'; // Р—РµР»С‘РЅС‹Р№ (Р»СЋР±РѕРІСЊ)
            if (value >= 0) return '#f39c12'; // РћСЂР°РЅР¶РµРІС‹Р№ (РЅРµР№С‚СЂР°Р»СЊРЅРѕРµ)
            if (value >= -50) return '#e67e22'; // РўС‘РјРЅРѕ-РѕСЂР°РЅР¶РµРІС‹Р№ (РЅРµРїСЂРёСЏР·РЅСЊ)
            return '#e74c3c'; // РљСЂР°СЃРЅС‹Р№ (РЅРµРЅР°РІРёСЃС‚СЊ)
        } else {
            if (value >= 75) return '#27ae60'; // Р—РµР»С‘РЅС‹Р№
            if (value >= 50) return '#2ecc71'; // РЎРІРµС‚Р»Рѕ-Р·РµР»С‘РЅС‹Р№
            if (value >= 25) return '#f39c12'; // РћСЂР°РЅР¶РµРІС‹Р№
            return '#95a5a6'; // РЎРµСЂС‹Р№
        }
    };

    // Р¤СѓРЅРєС†РёСЏ РґР»СЏ СЃРѕР·РґР°РЅРёСЏ РїСЂРѕРіСЂРµСЃСЃ-Р±Р°СЂР°
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

    // РСЃС‚РѕСЂРёСЏ РёРЅС‚РёРјРЅС‹С… СЃС†РµРЅ
    let historyHtml = '';
    if (rel.sexualHistory && rel.sexualHistory.length > 0) {
        const historyItems = rel.sexualHistory.slice(-5).reverse().map(h => {
            const typeLabel = h.type === 'consensual' ? 'рџ’• РљРѕРЅСЃРµРЅСЃСѓР°Р»СЊРЅС‹Р№' :
                             h.type === 'forced' ? 'вљ пёЏ РџСЂРёРЅСѓР¶РґРµРЅРёРµ' :
                             h.type === 'seduction' ? 'рџЏ РЎРѕР±Р»Р°Р·РЅРµРЅРёРµ' : h.type;
            return `
                <div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px; margin-bottom: 8px; border-left: 3px solid #e74c3c;">
                    <div style="font-size: 0.9em;"><strong>Р”РµРЅСЊ ${h.day}</strong> вЂ” ${h.location}</div>
                    <div style="font-size: 0.85em; color: #95a5a6; margin-top: 3px;">${typeLabel}</div>
                </div>
            `;
        }).join('');

        historyHtml = `
            <div style="margin-top: 20px; padding-top: 20px; border-top: 2px solid #5d4a36;">
                <h3 style="margin: 0 0 15px 0; color: #e74c3c;">рџ’‹ РСЃС‚РѕСЂРёСЏ РёРЅС‚РёРјРЅС‹С… СЃС†РµРЅ</h3>
                ${historyItems}
                ${rel.sexualHistory.length > 5 ? `<div style="text-align: center; color: #95a5a6; font-size: 0.85em; margin-top: 10px;">...Рё РµС‰С‘ ${rel.sexualHistory.length - 5} СЃС†РµРЅ</div>` : ''}
            </div>
        `;
    } else {
        historyHtml = `
            <div style="margin-top: 20px; padding-top: 20px; border-top: 2px solid #5d4a36;">
                <h3 style="margin: 0 0 10px 0; color: #95a5a6;">рџ’‹ РСЃС‚РѕСЂРёСЏ РёРЅС‚РёРјРЅС‹С… СЃС†РµРЅ</h3>
                <div style="text-align: center; color: #7f8c8d; font-style: italic; padding: 20px;">РџРѕРєР° РЅРµС‚ РёРЅС‚РёРјРЅС‹С… СЃС†РµРЅ СЃ СЌС‚РёРј РїРµСЂСЃРѕРЅР°Р¶РµРј</div>
            </div>
        `;
    }

    modalContent.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2 style="margin: 0; color: #d4af37; font-size: 1.5em;">${npc.name}</h2>
            <button id="close-npc-modal" style="background: #e74c3c; border: none; color: white; padding: 8px 15px; border-radius: 6px; cursor: pointer; font-weight: bold;">вњ• Р—Р°РєСЂС‹С‚СЊ</button>
        </div>

        <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
            <div style="font-style: italic; color: #bdc3c7;">${npc.description || 'РќРµС‚ РѕРїРёСЃР°РЅРёСЏ'}</div>
        </div>

        <h3 style="margin: 20px 0 15px 0; color: #d4af37;">рџ’ћ РћС‚РЅРѕС€РµРЅРёСЏ СЃ РІР°РјРё</h3>

        ${createProgressBar('вќ¤пёЏ РџСЂРёРІСЏР·Р°РЅРЅРѕСЃС‚СЊ (Affection)', rel.affection, -100, 100)}
        ${createProgressBar('рџ”Ґ Р’Р»РµС‡РµРЅРёРµ (Attraction)', rel.attraction, 0, 100)}
        ${createProgressBar('рџ¤ќ Р”РѕРІРµСЂРёРµ (Trust)', rel.trust, 0, 100)}
        ${createProgressBar('рџ’‹ Р‘Р»РёР·РѕСЃС‚СЊ (Intimacy)', rel.intimacy, 0, 100)}

        ${historyHtml}
    `;

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Р—Р°РєСЂС‹С‚РёРµ РїРѕ РєР»РёРєСѓ РЅР° РєРЅРѕРїРєСѓ
    document.getElementById('close-npc-modal').addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    // Р—Р°РєСЂС‹С‚РёРµ РїРѕ РєР»РёРєСѓ РІРЅРµ РѕРєРЅР°
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });

    // Р—Р°РєСЂС‹С‚РёРµ РїРѕ ESC
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

// === Р¤РЈРќРљР¦РР Р”Р›РЇ Р РђР‘РћРўР« РЎ Р­Р РћРўРР§Р•РЎРљРРњ Р–РЈР РќРђР›РћРњ ===

/**
 * РћР±РЅРѕРІР»СЏРµС‚ РѕС‚РѕР±СЂР°Р¶РµРЅРёРµ СЌСЂРѕС‚РёС‡РµСЃРєРѕРіРѕ Р¶СѓСЂРЅР°Р»Р°
 */
function updateEroticJournal() {
    const journalList = document.getElementById('erotic-journal-list');
    const journalPanel = document.getElementById('erotic-journal-panel');
    const clearButton = document.getElementById('clear-erotic-journal-btn');

    if (!journalList || !player) return;

    // РџРѕРєР°Р·С‹РІР°РµРј РїР°РЅРµР»СЊ С‚РѕР»СЊРєРѕ РµСЃР»Рё NSFW РІРєР»СЋС‡РµРЅ Рё РµСЃС‚СЊ Р·Р°РїРёСЃРё
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
        let favLoc = "РќРµС‚";
        let maxLoc = 0;
        for (const [loc, count] of Object.entries(stats.locations)) {
            if (count > maxLoc) { maxLoc = count; favLoc = loc; }
        }
        let fetishesStr = [];
        if (stats.fetishes.anal > 0) fetishesStr.push(`РђРЅР°Р» (${stats.fetishes.anal})`);
        if (stats.fetishes.oral > 0) fetishesStr.push(`РћСЂР°Р» (${stats.fetishes.oral})`);
        if (stats.fetishes.bdsm > 0) fetishesStr.push(`Р‘Р”РЎРњ (${stats.fetishes.bdsm})`);
        if (stats.fetishes.group > 0) fetishesStr.push(`Р“СЂСѓРїРїРѕРІРѕР№ (${stats.fetishes.group})`);
        let fetishesDisplay = fetishesStr.length > 0 ? fetishesStr.join(', ') : "РќРµС‚";

        statsDiv.innerHTML = `
            <strong style="color: #e74c3c;">рџ“Љ РЎС‚Р°С‚РёСЃС‚РёРєР°:</strong><br>
            Р’СЃРµРіРѕ СЃС†РµРЅ: ${stats.totalScenes} | РЈРЅРёРєР°Р»СЊРЅС‹С… РїР°СЂС‚РЅС‘СЂРѕРІ: ${stats.partners.length}<br>
            РљРѕРЅСЃРµРЅСЃСѓР°Р»СЊРЅРѕ: ${stats.types.consensual || 0} | РЎРѕР±Р»Р°Р·РЅРµРЅРёРµ: ${stats.types.seduction || 0} | РџСЂРёРЅСѓР¶РґРµРЅРёРµ: ${stats.types.forced || 0}<br>
            Р›СЋР±РёРјР°СЏ Р»РѕРєР°С†РёСЏ: ${favLoc} (${maxLoc} СЂР°Р·)<br>
            Р¤РµС‚РёС€Рё: ${fetishesDisplay}
        `;
        statsDiv.style.display = 'block';
    } else {
        statsDiv.style.display = 'none';
    }

    if (!player.eroticJournal || player.eroticJournal.length === 0) {
        journalList.innerHTML = `<li style="color: #7f8c8d; font-style: italic; text-align: center; padding: 20px;" data-i18n="gameInterface.eroticJournalPanel.empty">${t('gameInterface.eroticJournalPanel.empty', 'РџРѕРєР° РЅРµС‚ Р·Р°РїРёСЃРµР№ РІ РґРЅРµРІРЅРёРєРµ')}</li>`;
        return;
    }

    // РЎРѕСЂС‚РёСЂСѓРµРј РїРѕ РґР°С‚Рµ (РЅРѕРІС‹Рµ СЃРІРµСЂС…Сѓ)
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
                         scene.type === 'seduction' ? 'рџЏ' : 'рџ’‹';

        li.innerHTML = `
            <div style="font-weight: bold; color: #e74c3c; margin-bottom: 5px;">
                ${typeLabel} ${scene.partner}
            </div>
            <div style="font-size: 0.85em; color: #bdc3c7;">
                рџ“… Р”РµРЅСЊ ${scene.day} вЂў рџ“Ќ ${scene.location}
            </div>
        `;

        li.addEventListener('click', () => showEroticSceneModal(scene.id));
        journalList.appendChild(li);
    });
}

/**
 * РџРѕРєР°Р·С‹РІР°РµС‚ РјРѕРґР°Р»СЊРЅРѕРµ РѕРєРЅРѕ СЃ РїРѕР»РЅС‹Рј С‚РµРєСЃС‚РѕРј СЌСЂРѕС‚РёС‡РµСЃРєРѕР№ СЃС†РµРЅС‹
 */
function showEroticSceneModal(sceneId) {
    if (!player || !player.eroticJournal) return;

    const scene = player.eroticJournal.find(s => s.id === sceneId);
    if (!scene) return;

    // РЎРѕР·РґР°С‘Рј РјРѕРґР°Р»СЊРЅРѕРµ РѕРєРЅРѕ
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

    const typeLabel = scene.type === 'consensual' ? t('gameInterface.eroticJournalPanel.typeConsensual', 'рџ’• РљРѕРЅСЃРµРЅСЃСѓР°Р»СЊРЅС‹Р№') :
                     scene.type === 'forced' ? t('gameInterface.eroticJournalPanel.typeForced', 'вљ пёЏ РџСЂРёРЅСѓР¶РґРµРЅРёРµ') :
                     scene.type === 'seduction' ? t('gameInterface.eroticJournalPanel.typeSeduction', 'рџЏ РЎРѕР±Р»Р°Р·РЅРµРЅРёРµ') : scene.type;

    const intensityLabel = scene.intensity === 0 ? 'Fade to black' :
                          scene.intensity === 1 ? 'Sensual' :
                          scene.intensity === 2 ? 'Explicit' :
                          scene.intensity === 3 ? 'Extreme' : scene.intensity;

    modalContent.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 2px solid #e74c3c; padding-bottom: 15px;">
            <h2 style="margin: 0; color: #e74c3c; font-size: 1.5em;">рџ’‹ ${scene.partner}</h2>
            <button id="close-scene-modal" style="background: #c0392b; border: none; color: white; padding: 8px 15px; border-radius: 6px; cursor: pointer; font-weight: bold;">вњ• ${t('gameInterface.eroticJournalPanel.closeModal', 'Р—Р°РєСЂС‹С‚СЊ')}</button>
        </div>

        <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.9em;">
                <div><strong>рџ“… ${t('gameInterface.eroticJournalPanel.sceneDay', 'Р”РµРЅСЊ')}:</strong> ${scene.day}</div>
                <div><strong>рџ“Ќ ${t('gameInterface.eroticJournalPanel.sceneLocation', 'Р›РѕРєР°С†РёСЏ')}:</strong> ${scene.location}</div>
                <div><strong>рџ’ћ ${t('gameInterface.eroticJournalPanel.sceneType', 'РўРёРї')}:</strong> ${typeLabel}</div>
                <div><strong>рџ”Ґ РРЅС‚РµРЅСЃРёРІРЅРѕСЃС‚СЊ:</strong> ${intensityLabel}</div>
            </div>
        </div>

        <div style="background: rgba(0,0,0,0.2); padding: 20px; border-radius: 8px; line-height: 1.8; font-size: 1em; white-space: pre-wrap; word-wrap: break-word;">
            ${scene.narrative}
        </div>
    `;

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Р—Р°РєСЂС‹С‚РёРµ РїРѕ РєР»РёРєСѓ РЅР° РєРЅРѕРїРєСѓ
    document.getElementById('close-scene-modal').addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    // Р—Р°РєСЂС‹С‚РёРµ РїРѕ РєР»РёРєСѓ РІРЅРµ РѕРєРЅР°
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });

    // Р—Р°РєСЂС‹С‚РёРµ РїРѕ ESC
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
 * РћС‡РёС‰Р°РµС‚ СЌСЂРѕС‚РёС‡РµСЃРєРёР№ Р¶СѓСЂРЅР°Р» СЃ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµРј
 */
function clearEroticJournal() {
    if (!player || !player.eroticJournal || player.eroticJournal.length === 0) return;

    const confirmMessage = t('gameInterface.eroticJournalPanel.confirmClear', 'Р’С‹ СѓРІРµСЂРµРЅС‹, С‡С‚Рѕ С…РѕС‚РёС‚Рµ СѓРґР°Р»РёС‚СЊ РІСЃРµ Р·Р°РїРёСЃРё РёР· РёРЅС‚РёРјРЅРѕРіРѕ РґРЅРµРІРЅРёРєР°? Р­С‚Рѕ РґРµР№СЃС‚РІРёРµ РЅРµРѕР±СЂР°С‚РёРјРѕ.');

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
            // РљР›Р®Р§Р•Р’РћР• РР—РњР•РќР•РќРР•: РСЃРїРѕР»СЊР·СѓРµРј aiIdentifier РєР°Рє РєР»СЋС‡ РІРјРµСЃС‚Рѕ С†РёС„СЂ
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
                console.log(`РџСЂРѕРјРїС‚ СѓСЃРїРµС€РЅРѕ РїРѕР»СѓС‡РµРЅ РёР· runtime registry: ${filePath}`);
                return runtimePrompt.content;
            }
        }
        const response = await fetch(`${filePath}?t=${Date.now()}`); // Cache busting
        if (!response.ok) {
            throw new Error(`HTTP РѕС€РёР±РєР°! СЃС‚Р°С‚СѓСЃ: ${response.status}, РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ ${response.url}`);
        }
        const promptText = await response.text();
        console.log(`РџСЂРѕРјРїС‚ СѓСЃРїРµС€РЅРѕ Р·Р°РіСЂСѓР¶РµРЅ РёР·: ${filePath}`);
        return promptText;
    } catch (error) {
        console.error(`РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РїСЂРѕРјРїС‚ РёР· ${filePath}:`, error);
        return `РћС€РёР±РєР°: РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РїСЂРѕРјРїС‚ РёР· ${filePath}. ${error.message}`;
    }
}

// --- РРіСЂРѕРІРѕРµ РњРµРЅСЋ ---
function repeatLastAction() {
    if (isWaitingForAI || !player || lastUserMessageForRetry === null) return;
    
    // Р’СЃС‚Р°РІР»СЏРµРј С‡РёСЃС‚С‹Р№ С‚РµРєСЃС‚ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
    userInput.value = lastUserMessageForRetry;
    
    // Р’РѕСЃСЃС‚Р°РЅР°РІР»РёРІР°РµРј РїР»Р°С€РєРё Р±СЂРѕСЃРєРѕРІ
    const rollsContainer = document.getElementById('active-rolls-container');
    if (window.lastRollsStateForRetry && rollsContainer) {
        rollsContainer.innerHTML = window.lastRollsStateForRetry;
        // РџРµСЂРµРЅР°Р·РЅР°С‡Р°РµРј РѕР±СЂР°Р±РѕС‚С‡РёРєРё СѓРґР°Р»РµРЅРёСЏ
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
    }, 300); // Р’СЂРµРјСЏ Р°РЅРёРјР°С†РёРё
}

// --- Р›РѕРі Рё Р’РІРѕРґ ---
function addLogMessage(message, type = "gm-message", isRestoring = false, imagePrompt = "", savedImageBase64 = null) {
    if (!gameLog) return;
    message = parseLocString(message); // РђРІС‚Рѕ-Р»РѕРєР°Р»РёР·Р°С†РёСЏ

    // --- РЎРРЎРўР•РњРђ РЎРћРҐР РђРќР•РќРРЇ Р›РћР“РћР’ ---
    let currentHistoryEntry = null;
    if (player) {
        if (!player.gameLogHistory) player.gameLogHistory = [];
        if (!isRestoring) {
            currentHistoryEntry = { message, type, imagePrompt, savedImageBase64 };
            player.gameLogHistory.push(currentHistoryEntry);
            if (player.gameLogHistory.length > 100) player.gameLogHistory.shift();
        } else {
            // РџСЂРё Р·Р°РіСЂСѓР·РєРµ РЅР°С…РѕРґРёРј РєРѕРЅРєСЂРµС‚РЅС‹Р№ Р»РѕРі РїРѕ С‚РµРєСЃС‚Сѓ, С‡С‚РѕР±С‹ РїСЂРёРІСЏР·Р°С‚СЊ РєРЅРѕРїРєСѓ РёРјРµРЅРЅРѕ Рє РЅРµРјСѓ
            currentHistoryEntry = player.gameLogHistory.find(e => e.message === message && e.imagePrompt === imagePrompt);
        }
    }

    // РћРїСЂРµРґРµР»СЏРµРј РєР°С‚РµРіРѕСЂРёСЋ РґР»СЏ СЃС‚РёР»СЏ РїСѓР·С‹СЂСЏ
            let category = 'gm';
        if (type === 'user-message') category = 'user';
        else if (['system-message', 'command-feedback', 'level-up', 'calc-info'].includes(type)) category = 'system';
        else if (type === 'world-event') category = 'world-event';

        let textToSpeak = message;
    let cleanHtml = "";

    // РћР±СЂР°Р±РѕС‚РєР° С‚РµРєСЃС‚Р° (Markdown, RP-С‚РµРіРё, РЎР°РЅРёС‚Р°Р№Р·РµСЂ)
    try {
        if (type === 'world-event') {
            let sanitizedText = DOMPurify.sanitize(marked.parse(message));
            cleanHtml = `
                <div class="world-event-card">
                    <div class="world-event-header"><i class="fas fa-globe-europe"></i> Р’Р•РЎРўР РР— Р­Р¤РР Рђ</div>
                    <div class="world-event-body">${sanitizedText}</div>
                    <div style="margin-top: 15px; font-size: 0.85em; color: #7f8c8d; font-style: italic; border-top: 1px solid rgba(184,134,11,0.2); padding-top: 10px;">
                        РЎРѕР±С‹С‚РёРµ РѕР±РЅРѕРІРёР»Рѕ РєР°СЂС‚Сѓ Рё Р±Р°Р»Р°РЅСЃ СЃРёР». РџРѕСЃР»РµРґСЃС‚РІРёСЏ РЅРµРёР·Р±РµР¶РЅС‹.
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
                    return `<span class="ooc-marker" data-ooc-text="${oocText}" title="${t('gameInterface.log.oocTooltip', 'OOC РЎРѕРѕР±С‰РµРЅРёРµ')}">OOC</span>`;
                }
                if (dialogue) return `<span class="dialogue-text">${dialogue}</span>`;
                if (action) return `<span class="action-text">${action}</span>`;
                return match;
            });

            let markdownHtml = marked.parse(processedHtml);
            cleanHtml = DOMPurify.sanitize(markdownHtml, { ADD_ATTR: ['data-ooc-text'], USE_PROFILES: { html: true } });

            // Р“РѕС‚РѕРІРёРј С‚РµРєСЃС‚ РґР»СЏ РѕР·РІСѓС‡РєРё (Р±РµР· OOC)
            const speechTempDiv = document.createElement('div');
            speechTempDiv.innerHTML = cleanHtml;
            speechTempDiv.querySelectorAll('.ooc-marker').forEach(m => m.remove());
            textToSpeak = speechTempDiv.textContent || speechTempDiv.innerText || "";
        } else {
            // Р”Р»СЏ СЃРёСЃС‚РµРјРЅС‹С… Рё РїРѕР»СЊР·РѕРІР°С‚РµР»СЊСЃРєРёС… СЃРѕРѕР±С‰РµРЅРёР№
            cleanHtml = `<p class="${type}">${DOMPurify.sanitize(message, { USE_PROFILES: { html: true } })}</p>`;
            textToSpeak = message.replace(/<[^>]*>?/gm, '');
        }
    } catch (e) {
        console.error("РћС€РёР±РєР° РїСЂРё СЂРµРЅРґРµСЂРёРЅРіРµ СЃРѕРѕР±С‰РµРЅРёСЏ:", e);
        cleanHtml = `<p class="${type}">>>> [РћС€РёР±РєР° РѕС‚РѕР±СЂР°Р¶РµРЅРёСЏ]</p>`;
        textToSpeak = "";
    }

    // Р“СЂСѓРїРїРёСЂРѕРІРєР° СЃРёСЃС‚РµРјРЅС‹С… Р»РѕРіРѕРІ (С‡С‚РѕР±С‹ РЅРµ СЃРїР°РјРёС‚СЊ РїСѓР·С‹СЂСЏРјРё)
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
            hintDiv.innerHTML = '<i class="fas fa-chevron-down"></i> РЎРёСЃС‚РµРјРЅС‹Рµ Р»РѕРіРё';
            bubble.appendChild(contentDiv);
            bubble.appendChild(hintDiv);

            bubble.addEventListener('click', (e) => {
                if (e.target.closest('.tts-speak-btn')) return;
                const isCollapsed = bubble.classList.toggle('collapsed');
                bubble.classList.toggle('expanded', !isCollapsed);
                hintDiv.innerHTML = isCollapsed ? `<i class="fas fa-chevron-down"></i> ${t('gameInterface.log.systemLogs', null, 'РЎРёСЃС‚РµРјРЅС‹Рµ Р»РѕРіРё')}` : `<i class="fas fa-chevron-up"></i> ${t('gameInterface.log.collapse', null, 'РЎРІРµСЂРЅСѓС‚СЊ')}`;
            });
        } else {
            bubble.innerHTML = cleanHtml;
        }

        wrapper.appendChild(bubble);
        gameLog.appendChild(wrapper);
    }

    // --- РљРќРћРџРљРђ Р РЈР§РќРћР™ РћР—Р’РЈР§РљР (TTS) ---
    if (textToSpeak && textToSpeak.trim() !== '' && category !== 'system') {
        if (!bubbleElement.querySelector('.tts-controls-wrapper')) {
            const ttsWrapper = document.createElement('div');
            ttsWrapper.className = 'tts-controls-wrapper';

            const ttsBtn = document.createElement('button');
            ttsBtn.className = 'tts-speak-btn';
            ttsBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
            ttsBtn.title = t('gameInterface.tooltip.speak', null, 'РћР·РІСѓС‡РёС‚СЊ');
            ttsBtn.dataset.state = 'idle';

            const stopBtn = document.createElement('button');
            stopBtn.className = 'tts-stop-btn';
            stopBtn.innerHTML = '<i class="fas fa-stop"></i>';
            stopBtn.title = t('gameInterface.tooltip.stop', null, 'РћСЃС‚Р°РЅРѕРІРёС‚СЊ');
            stopBtn.style.display = 'none';

            const resetThisUI = () => {
                ttsBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
                ttsBtn.dataset.state = 'idle';
                stopBtn.style.display = 'none';
            };

            ttsBtn.onclick = async (e) => {
                e.stopPropagation();

                // Р•СЃР»Рё СѓР¶Рµ РёРіСЂР°РµС‚ РёРјРµРЅРЅРѕ СЌС‚РѕС‚ С‚РµРєСЃС‚ - СЃС‚Р°РІРёРј РЅР° РїР°СѓР·Сѓ
                if (ttsBtn.dataset.state === 'playing') {
                    if (currentAudio && !currentAudio.paused) {
                        currentAudio.pause();
                        ttsBtn.innerHTML = '<i class="fas fa-play"></i>';
                        ttsBtn.dataset.state = 'paused';
                    }
                    return;
                }

                // Р•СЃР»Рё РЅР° РїР°СѓР·Рµ РёРјРµРЅРЅРѕ СЌС‚РѕС‚ С‚РµРєСЃС‚ - СЃРЅРёРјР°РµРј СЃ РїР°СѓР·С‹
                if (ttsBtn.dataset.state === 'paused') {
                    if (currentAudio && currentAudio.paused) {
                        currentAudio.play();
                        ttsBtn.innerHTML = '<i class="fas fa-pause"></i>';
                        ttsBtn.dataset.state = 'playing';
                    }
                    return;
                }

                // РРЅР°С‡Рµ (СЃРѕСЃС‚РѕСЏРЅРёРµ idle) - РіРµРЅРµСЂРёСЂСѓРµРј Рё Р·Р°РїСѓСЃРєР°РµРј
                let toRead = bubbleElement.innerText.replace('OOC', '').trim();

                // РЎР±СЂР°СЃС‹РІР°РµРј UI РІСЃРµС… РѕСЃС‚Р°Р»СЊРЅС‹С… РєРЅРѕРїРѕРє РЅР° СЃС‚СЂР°РЅРёС†Рµ
                document.querySelectorAll('.tts-controls-wrapper').forEach(wrapper => {
                    const btn = wrapper.querySelector('.tts-speak-btn');
                    const sBtn = wrapper.querySelector('.tts-stop-btn');
                    if (btn) {
                        btn.innerHTML = '<i class="fas fa-volume-up"></i>';
                        btn.dataset.state = 'idle';
                    }
                    if (sBtn) sBtn.style.display = 'none';
                });

                // РђРЅРёРјР°С†РёСЏ Р·Р°РіСЂСѓР·РєРё
                ttsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                ttsBtn.style.pointerEvents = 'none';

                try {
                    await speakText(toRead);

                    // РџРѕСЃР»Рµ СѓСЃРїРµС€РЅРѕР№ РіРµРЅРµСЂР°С†РёРё (speakText СЃР°Рј Р·Р°РїСѓСЃРєР°РµС‚ play)
                    if (currentAudio) {
                        ttsBtn.dataset.state = 'playing';
                        ttsBtn.innerHTML = '<i class="fas fa-pause"></i>';
                        stopBtn.style.display = 'flex';

                        // Р’РµС€Р°РµРј СЃР»СѓС€Р°С‚РµР»Рё РЅР° С‚РµРєСѓС‰РёР№ Р°СѓРґРёРѕ-РѕР±СЉРµРєС‚
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

            // РљРђР РўРРќРљРђ РР›Р РљРќРћРџРљРђ Р“Р•РќР•Р РђР¦РР
            const attachImageToChat = (srcBase64) => {
                const cleanSrc = srcBase64.replace(/[\r\n]+/g, '');
                const finalSrc = cleanSrc.startsWith('data:image') || cleanSrc.startsWith('http') ? cleanSrc : 'data:image/jpeg;base64,' + cleanSrc;
                
                const imgContainer = document.createElement('div');
                imgContainer.className = 'chat-illustration-container';
                
                const imgEl = document.createElement('img');
                imgEl.src = finalSrc;
                imgEl.alt = "Р­С„РёСЂРЅРѕРµ РІРёРґРµРЅРёРµ";
                imgEl.title = "РќР°Р¶РјРё, С‡С‚РѕР±С‹ РѕС‚РєСЂС‹С‚СЊ РѕСЂРёРіРёРЅР°Р»";
                imgEl.style.cursor = "pointer";
                imgEl.onclick = () => {
                    const w = window.open('');
                    w.document.write('<style>body{margin:0;background:#000;display:flex;justify-content:center;align-items:center;height:100vh;}img{max-width:100%;max-height:100vh;object-fit:contain;}</style><img id="fullImg">');
                    w.document.getElementById('fullImg').src = finalSrc;
                };
                
                const watermark = document.createElement('div');
                watermark.className = 'img-watermark';
                watermark.textContent = t('gameInterface.tooltip.etherealSnapshot', null, 'Р­С„РёСЂРЅС‹Р№ РЎР»РµРїРѕРє');
                
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
                imgBtn.title = t('gameInterface.tooltip.visualize', null, 'Р’РёР·СѓР°Р»РёР·РёСЂРѕРІР°С‚СЊ СЃС†РµРЅСѓ');
                imgBtn.onclick = async (e) => {
                    e.stopPropagation();
                    imgBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    imgBtn.style.pointerEvents = 'none';
                    try {
                        const res = await window.generateVisionImage(imagePrompt);
                        if (res && res.success && res.imageUrl) {
                            const finalSrc = attachImageToChat(res.imageUrl);
                            // РЎРѕС…СЂР°РЅСЏРµРј РєР°СЂС‚РёРЅРєСѓ СЃС‚СЂРѕРіРѕ РІ С‚РѕС‚ РѕР±СЉРµРєС‚ РёСЃС‚РѕСЂРёРё, Рє РєРѕС‚РѕСЂРѕРјСѓ РїСЂРёРІСЏР·Р°РЅР° РєРЅРѕРїРєР°
                            if (currentHistoryEntry) {
                                currentHistoryEntry.savedImageBase64 = finalSrc;
                            } else if (player && player.gameLogHistory) {
                                const fallbackEntry = player.gameLogHistory.find(e => e.message === message);
                                if (fallbackEntry) fallbackEntry.savedImageBase64 = finalSrc;
                            }
                            imgBtn.remove();
                        }
                    } catch (err) {
                        console.error("РћС€РёР±РєР° РіРµРЅРµСЂР°С†РёРё РєР°СЂС‚РёРЅРєРё:", err);
                        imgBtn.innerHTML = '<i class="fas fa-exclamation-triangle" style="color:#e74c3c"></i>';
                        imgBtn.title = 'РћС€РёР±РєР°: ' + err.message;
                        setTimeout(() => {
                            imgBtn.innerHTML = '<i class="fas fa-eye"></i>';
                            imgBtn.style.pointerEvents = 'auto';
                            imgBtn.title = t('gameInterface.tooltip.visualize', null, 'Р’РёР·СѓР°Р»РёР·РёСЂРѕРІР°С‚СЊ СЃС†РµРЅСѓ');
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
        return []; // Р’РѕР·РІСЂР°С‰Р°РµРј РїСѓСЃС‚РѕР№ РјР°СЃСЃРёРІ, РµСЃР»Рё РЅРµС‡РµРіРѕ РѕР±СЂР°Р±Р°С‚С‹РІР°С‚СЊ
    }

    const effectsToRemove = [];
    const expiredEffectNames = []; // >>>>> РќРћР’РћР•: РЎРѕР±РёСЂР°РµРј РёРјРµРЅР° РёСЃС‚РµРєС€РёС… СЌС„С„РµРєС‚РѕРІ

    for (const effectId in player.statusEffects) {
        const effect = player.statusEffects[effectId];

        if (effect.duration > 0) {
            effect.duration--;
        }

        if (effect.duration <= 0) {
            effectsToRemove.push(effectId);
            expiredEffectNames.push(effect.name); // >>>>> РќРћР’РћР•: Р”РѕР±Р°РІР»СЏРµРј РёРјСЏ РІ СЃРїРёСЃРѕРє
            addLogMessage(t('gameInterface.commandFeedback.statusEffectRemoved', { effectName: effect.name }), "command-feedback");
        }
    }

    if (effectsToRemove.length > 0) {
        effectsToRemove.forEach(id => {
            delete player.statusEffects[id];
        });
    }

    updateStatusEffectsDisplay();

    return expiredEffectNames; // >>>>> РќРћР’РћР•: Р’РѕР·РІСЂР°С‰Р°РµРј СЃРїРёСЃРѕРє РёРјРµРЅ
}

async function loadCombatSystemRules() {
    try {
        combatSystemRulesData = await loadPromptFromFile('combat_system_rules');
        console.log(`РџСЂР°РІРёР»Р° Р±РѕРµРІРѕР№ СЃРёСЃС‚РµРјС‹ СѓСЃРїРµС€РЅРѕ Р·Р°РіСЂСѓР¶РµРЅС‹.`);
    } catch (error) {
        console.error(`РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РїСЂР°РІРёР»Р° Р±РѕРµРІРѕР№ СЃРёСЃС‚РµРјС‹:`, error);
        combatSystemRulesData = "// РћС€РёР±РєР°: РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РїСЂР°РІРёР»Р° Р±РѕРµРІРѕР№ СЃРёСЃС‚РµРјС‹. Р‘РѕР№ РјРѕР¶РµС‚ Р±С‹С‚СЊ РЅРµРїСЂРµРґСЃРєР°Р·СѓРµРјС‹Рј.";
    }
}

// --- Р¤СѓРЅРєС†РёРё РЈРїСЂР°РІР»РµРЅРёСЏ Р­РєСЂР°РЅРѕРј Р—Р°РіСЂСѓР·РєРё (РќРћР’РћР•) ---

function showLoadingScreen(textKey = 'loadingScreen.generatingWorld', fallbackText = 'Р“РµРЅРµСЂР°С†РёСЏ РјРёСЂР°...') {
    if (!loadingOverlay) return;

    const titleEl = document.getElementById('loading-title');
    if (titleEl) {
        titleEl.textContent = t(textKey, null, fallbackText);
    } else if (loadingText) {
        loadingText.textContent = t(textKey, null, fallbackText);
    }

    const textEl = document.getElementById('loading-text');
    if (textEl && titleEl) {
        textEl.textContent = 'РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ...';
    }

    loadingOverlay.style.display = 'flex';

    // РќРµР±РѕР»СЊС€Р°СЏ Р·Р°РґРµСЂР¶РєР° РїРµСЂРµРґ РґРѕР±Р°РІР»РµРЅРёРµРј РєР»Р°СЃСЃР° РґР»СЏ СЃСЂР°Р±Р°С‚С‹РІР°РЅРёСЏ transition
    setTimeout(() => {
        loadingOverlay.classList.add('visible');
    }, 10);
}

function hideLoadingScreen() {
    if (!loadingOverlay) return;

    loadingOverlay.classList.remove('visible');

    // РЎРєСЂС‹РІР°РµРј СЌР»РµРјРµРЅС‚ РїРѕСЃР»Рµ Р·Р°РІРµСЂС€РµРЅРёСЏ Р°РЅРёРјР°С†РёРё
    setTimeout(() => {
        loadingOverlay.style.display = 'none';
    }, 500); // Р”РѕР»Р¶РЅРѕ СЃРѕРІРїР°РґР°С‚СЊ СЃРѕ РІСЂРµРјРµРЅРµРј transition РІ CSS
}

// --- Р’Р·Р°РёРјРѕРґРµР№СЃС‚РІРёРµ СЃ Gemini ---
/**
 * РћСЃРЅРѕРІРЅР°СЏ С„СѓРЅРєС†РёСЏ РґР»СЏ РІР·Р°РёРјРѕРґРµР№СЃС‚РІРёСЏ СЃ Gemini API.
 * РЎРѕР±РёСЂР°РµС‚ РІСЃРµ СЃРѕСЃС‚РѕСЏРЅРёРµ РёРіСЂС‹, С„РѕСЂРјРёСЂСѓРµС‚ РїСЂРѕРјРїС‚, РѕС‚РїСЂР°РІР»СЏРµС‚ Р·Р°РїСЂРѕСЃ Рё РѕР±СЂР°Р±Р°С‚С‹РІР°РµС‚ РѕС‚РІРµС‚.
 * @param {string} promptTextForAI - РўРµРєСЃС‚ РѕС‚ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ РёР»Рё СЃРёСЃС‚РµРјРЅС‹Р№ РїСЂРѕРјРїС‚ РґР»СЏ РёРЅРёС†РёР°Р»РёР·Р°С†РёРё.
 * @param {boolean} [isInitialPrompt=false] - Р¤Р»Р°Рі, СѓРєР°Р·С‹РІР°СЋС‰РёР№, С‡С‚Рѕ СЌС‚Рѕ РїРµСЂРІС‹Р№ Р·Р°РїСЂРѕСЃ РґР»СЏ РЅР°С‡Р°Р»Р° РЅРѕРІРѕР№ РёРіСЂС‹.
 * @param {boolean} [isDiceRollResponse=false] - Р¤Р»Р°Рі, СѓРєР°Р·С‹РІР°СЋС‰РёР№, С‡С‚Рѕ СЌС‚Рѕ РІРЅСѓС‚СЂРµРЅРЅРёР№ РѕС‚РІРµС‚ РЅР° Р·Р°РїСЂРѕСЃ Р±СЂРѕСЃРєР° РєСѓР±РёРєР°.
 * @param {Array<string>} [expiredEffects=[]] - РњР°СЃСЃРёРІ РёРјРµРЅ СЃС‚Р°С‚СѓСЃ-СЌС„С„РµРєС‚РѕРІ, РєРѕС‚РѕСЂС‹Рµ РёСЃС‚РµРєР»Рё РІ СЌС‚РѕРј С…РѕРґСѓ.
 */


/**
 * (РџРћР›РќРђРЇ РћР‘РќРћР’Р›Р•РќРќРђРЇ Р’Р•Р РЎРРЇ v3.0 - РђР“Р•РќРўРЎРљРР™ Р¦РРљР› Р РџРћР’РўРћР Р«)
 */
async function handleUserInput() {
    let text = userInput.value.trim();

    // --- РђРќРўРР§РРў: РЈРґР°Р»СЏРµРј РІСЂСѓС‡РЅСѓСЋ РІРїРёСЃР°РЅРЅС‹Рµ Р±СЂРѕСЃРєРё ---
    text = text.replace(/\[ROLL_RESULT:.*?\]/gi, '').trim();


    // РћС‡РёС‰Р°РµРј РїСЂРµРґР»РѕР¶РµРЅРЅС‹Рµ РґРµР№СЃС‚РІРёСЏ РїСЂРё Р»СЋР±РѕРј РІРІРѕРґРµ
    const suggestedContainer = document.getElementById('suggested-actions-container');
    if (suggestedContainer) {
        suggestedContainer.innerHTML = '';
        suggestedContainer.style.display = 'none';
    }

    // ==========================================
    // --- [DEV] РџРђРќР•Р›Р¬ Р РђР—Р РђР‘РћРўР§РРљРђ Р§Р•Р Р•Р— Р§РђРў ---
    // ==========================================
    if (DEBUG_MODE && text.startsWith('/dev ')) {
        const args = text.split(' ');
        const cmd = args[1];
        const val = parseInt(args[2]);

        if (cmd === 'turn') {
            player.stats.turnCount = val || 0;
            addLogMessage(`[DEV] РўРµРєСѓС‰РёР№ С…РѕРґ СѓСЃС‚Р°РЅРѕРІР»РµРЅ РЅР°: ${player.stats.turnCount}`, "system-message");
            updateCharacterSheet();
        }
        else if (cmd === 'addmem') {
            if (!player.gmNotes) player.gmNotes = {};
            player.gmNotes[`Test_Data_${Date.now()}`] = "Р­С‚Рѕ С‚РµСЃС‚РѕРІР°СЏ Р·Р°РїРёСЃСЊ РґР»СЏ РїСЂРѕРІРµСЂРєРё СЃРёСЃС‚РµРјС‹ Р°СЂС…РёРІР°С†РёРё РїР°РјСЏС‚Рё. РРіСЂРѕРє РЅР°С€РµР» СЂР¶Р°РІС‹Р№ РіРІРѕР·РґСЊ Рё РїРѕРіРѕРІРѕСЂРёР» СЃ РїСЂРёР·СЂР°РєРѕРј.";
            addLogMessage(`[DEV] Р’ РїР°РјСЏС‚СЊ GM РґРѕР±Р°РІР»РµРЅР° С‚РµСЃС‚РѕРІР°СЏ Р·Р°РїРёСЃСЊ. РћС‚РєСЂРѕР№ F4, С‡С‚РѕР±С‹ РїСЂРѕРІРµСЂРёС‚СЊ.`, "system-message");
            updateGmNotesDisplay();
    updateWorldSimDebugDisplay();
        }
        else if (cmd === 'killall') {
            Object.values(player.visibleEntities).forEach(ent => {
                executeCommand('updateEntityStat', { aiIdentifier: ent.aiIdentifier, stat: 'hp', value: 0 });
            });
            addLogMessage(`[DEV] Р’СЃРµ РІРёРґРёРјС‹Рµ СЃСѓС‰РµСЃС‚РІР° СѓР±РёС‚С‹.`, "system-message");
        }
        else if (cmd === 'skip') {
            const skipAmount = val || 1;
            player.stats.turnCount += skipAmount;
            addLogMessage(`[DEV] РџСЂРѕРїСѓС‰РµРЅРѕ С…РѕРґРѕРІ: ${skipAmount}. РўРµРєСѓС‰РёР№ С…РѕРґ: ${player.stats.turnCount}
РРіСЂРѕРІРѕРµ РІСЂРµРјСЏ: Р”РµРЅСЊ ${player.gameTime.day}, ${player.gameTime.hour < 10 ? '0'+player.gameTime.hour : player.gameTime.hour}:${player.gameTime.minute < 10 ? '0'+player.gameTime.minute : player.gameTime.minute} (${player.timeOfDay})
[Р’Р Р•РњРЇ РЎ РџР РћРЁР›РћР“Рћ РҐРћР”Рђ]: ${(() => {
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
            addLogMessage(`[DEV] РќРµРёР·РІРµСЃС‚РЅР°СЏ РєРѕРјР°РЅРґР°. Р”РѕСЃС‚СѓРїРЅРѕ: /dev turn [С‡РёСЃР»Рѕ], /dev addmem, /dev killall, /dev skip [С‡РёСЃР»Рѕ], /dev test`, "system-message");
        }

        userInput.value = '';
        return; // РџСЂРµСЂС‹РІР°РµРј РІС‹РїРѕР»РЅРµРЅРёРµ, С‡С‚РѕР±С‹ РЅРµ РѕС‚РїСЂР°РІР»СЏС‚СЊ СЌС‚Рѕ РР
    }
    // ==========================================

    // РљР»РёРµРЅС‚СЃРєР°СЏ РІР°Р»РёРґР°С†РёСЏ: РЅРµ РґР°РІР°С‚СЊ РѕС‚РїСЂР°РІР»СЏС‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ СЃ С‚СЂРµР±РѕРІР°РЅРёСЏРјРё Р±СЂРѕСЃРєР°, РµСЃР»Рё Р±СЂРѕСЃРєРѕРІ РЅРµС‚
    const rollsContainer = document.getElementById('active-rolls-container');
    const attackKeywords = /Р°С‚Р°РєСѓСЋ|Р±СЊСЋ|СЃС‚СЂРµР»СЏСЋ|СЂСѓР±Р»СЋ|РєРѕР»СЋ|СѓРґР°СЂСЏСЋ|РєР°СЃС‚СѓСЋ|РёСЃРїРѕР»СЊР·СѓСЋ СѓРјРµРЅРёРµ/i;
    if (attackKeywords.test(text) && (!rollsContainer || rollsContainer.children.length === 0)) {
        addLogMessage("вљ пёЏ Р’С‹ РѕРїРёСЃР°Р»Рё Р±РѕРµРІРѕРµ РґРµР№СЃС‚РІРёРµ, РЅРѕ РЅРµ РґРѕР±Р°РІРёР»Рё Р±СЂРѕСЃРѕРє РєСѓР±РёРєР°! РСЃРїРѕР»СЊР·СѓР№С‚Рµ РєРЅРѕРїРєРё РјР°РєСЂРѕСЃРѕРІ (вљ”пёЏ Attack, рџЋІ D20) РїРµСЂРµРґ РѕС‚РїСЂР°РІРєРѕР№.", "system-message");
        return;
    }

    // РЎРѕС…СЂР°РЅСЏРµРј Р§РРЎРўР«Р™ С‚РµРєСЃС‚ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ Рё СЃРѕСЃС‚РѕСЏРЅРёРµ РїР»Р°С€РµРє РґР»СЏ С„СѓРЅРєС†РёРё "РџРѕРІС‚РѕСЂРёС‚СЊ РґРµР№СЃС‚РІРёРµ"
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

            // РЎРїРёСЃС‹РІР°РµРј СЂРµСЃСѓСЂСЃС‹ Рё РІРµС€Р°РµРј РљР” С‚РѕР»СЊРєРѕ РІ РјРѕРјРµРЅС‚ РѕС‚РїСЂР°РІРєРё
            if (badge.classList.contains('skill-badge')) {
                const sId = badge.dataset.skillId;
                const skill = player.skills[sId];
                if (skill) {
                    let costVal = parseInt(skill.cost) || 0;
                    let costType = (skill.costType || '').toLowerCase();
                    if (costType.includes('mp') || costType.includes('РјР°РЅ')) player.stats.mana -= costVal;
                    else if (costType.includes('hp') || costType.includes('Р·РґРѕСЂРѕРІСЊ')) damagePlayerHP(costVal);

                    let cdVal = parseInt(skill.cooldown) || 0;
                    if (cdVal > 0) skill.currentCooldown = cdVal;
                }
            }
        });
    }

    if (rollResultsArray.length > 0) {
        rollsBlock = "\n\n=== Р‘Р РћРЎРљР РР“Р РћРљРђ ===\n" + rollResultsArray.join("\n") + "\n========================\n";
        addCalculationMessage(`[РЎРРЎРўР•РњРђ] РћС‚РїСЂР°РІР»РµРЅРѕ Р±СЂРѕСЃРєРѕРІ: ${rollResultsArray.length}`);
        
        if (!player.diceLogHistory) player.diceLogHistory = [];
        player.diceLogHistory.push({ turn: player.stats.turnCount + 1, rolls: rollResultsArray });
        if (player.diceLogHistory.length > 10) player.diceLogHistory.shift();
        updateDiceLogDisplay();
    }

    if ((!text && !hasRolls) || isWaitingForAI || !player) {
        if (!player && !isWaitingForAI) addLogMessage(t("gameInterface.log.gameNotActive"), "system-message");
        return;
    }

    // --- РћРўРћР‘Р РђР–Р•РќРР• Р”Р›РЇ РР“Р РћРљРђ (РЎРєСЂС‹РІР°РµРј С‚РµС…РЅРёС‡РµСЃРєРёРµ С‚РµРіРё, РїРѕРєР°Р·С‹РІР°РµРј РєСЂР°СЃРёРІС‹Рµ РїР»Р°С€РєРё) ---
    // Р­РєСЂР°РЅРёСЂСѓРµРј СЃС‹СЂРѕР№ С‚РµРєСЃС‚ РёРіСЂРѕРєР°, С‡С‚РѕР±С‹ РЅРµ СЃР»РѕРјР°С‚СЊ РІРµСЂСЃС‚РєСѓ, РЅРѕ РѕСЃС‚Р°РІР»СЏРµРј СЃРіРµРЅРµСЂРёСЂРѕРІР°РЅРЅС‹Рµ РїР»Р°С€РєРё РєСѓР±РёРєРѕРІ
    let safeText = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let displayMessage = safeText || "*РЎРѕРІРµСЂС€Р°РµС‚ РґРµР№СЃС‚РІРёРµ...*";

    if (rollsContainer && rollsContainer.children.length > 0) {
        let rollsHtml = '<div class="chat-rolls-display-block"><div class="chat-rolls-header"><i class="fas fa-dice"></i> Р‘СЂРѕСЃРєРё РєСѓР±РёРєРѕРІ</div><div class="chat-rolls-content">';
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

    // --- Р¤РћР РњРР РћР’РђРќРР• Р—РђРџР РћРЎРђ Р”Р›РЇ GM ---
    let finalMessageForGM = `[Р”Р•Р™РЎРўР’РР•/РўР•РљРЎРў РР“Р РћРљРђ]:\n${text || "*Р–РґРµС‚*"}`;
    if (rollsBlock) finalMessageForGM += rollsBlock;

    // --- РЎР‘РћР  РљРћРќРўР•РљРЎРўРќР«РҐ РўР•Р“РћР’ Р РРќР•Р Р¦РР (MOMENTUM) ---
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

    let contextInjection = `\n\n[SYSTEM CONTEXT: РРЅРµСЂС†РёСЏ СЃС†РµРЅС‹ (Momentum): ${player.stats.momentum || 0} (РѕС‚ -5 РґРѕ 5). РђРєС‚РёРІРЅС‹Рµ С‚РµРіРё: ${activeTags.length > 0 ? activeTags.join(', ') : 'РќРµС‚'}.]`;
    finalMessageForGM += contextInjection;


    // Р”РѕР±Р°РІР»СЏРµРј РѕС‡РµСЂРµРґСЊ СЃРёСЃС‚РµРјРЅС‹С… РґРµР№СЃС‚РІРёР№ (РЅР°РїСЂРёРјРµСЂ, Р°РєС‚РёРІР°С†РёСЏ СЃРєРёР»Р»РѕРІ)
    if (playerActionQueue.length > 0) {
        finalMessageForGM += "\n\n" + playerActionQueue.join("\n");
        playerActionQueue = []; // РћС‡РёС‰Р°РµРј РѕС‡РµСЂРµРґСЊ
    }

    // --- РџР Р•Р”РЎРљРђР—РђРўР•Р›Р¬РќРђРЇ Р—РђР“Р РЈР—РљРђ РџРђРњРЇРўР (PREFETCHING / ARIGRAPH) ---
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
                let recalledMemoryStr = `\n\n[RECALLED_MEMORY: Р’СЃРїР»С‹РІС€РёРµ С„Р°РєС‚С‹ РёР· AriGraph РґР»СЏ (${matchedQueryIds.join(', ')})]\n`;
                recalledMemoryStr += graphContext.map(n => {
                    let daysOld = Math.max(0, (World.current_day || 0) - (n.day || 0));
                    return `[${daysOld}d ago, ${n.location}] ${parseLocString(n.text)}`;
                }).join("\n");
                finalMessageForGM += recalledMemoryStr;
                addCalculationMessage(`[AriGraph] РР·РІР»РµС‡РµРЅРѕ ${graphContext.length} РІРѕСЃРїРѕРјРёРЅР°РЅРёР№ РґР»СЏ: ${matchedQueryIds.join(', ')}`);
            }
        }
    }

    // --- РђР’РўРћРњРђРўРР—РР РћР’РђРќРќРђРЇ Р‘РћР•Р’РђРЇ РЎРРЎРўР•РњРђ ---
    if (player.currentCombat && player.currentCombat.isActive) {
        // 1. РџСЂРѕРІРµСЂРєР° РЅР° Р°РІС‚Рѕ-Р·Р°РІРµСЂС€РµРЅРёРµ Р±РѕСЏ
        const activeEnemies = player.currentCombat.participants.filter(id => player.visibleEntities[id]);

        if (activeEnemies.length === 0) {
            player.currentCombat.isActive = false;
            player.currentCombat.participants = [];
            finalMessageForGM += "\n\n[SYSTEM: Р‘РѕР№ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё Р·Р°РІРµСЂС€РµРЅ. Р’СЃРµ РїСЂРѕС‚РёРІРЅРёРєРё СѓСЃС‚СЂР°РЅРµРЅС‹ РёР»Рё РїРѕРєРёРЅСѓР»Рё РїРѕР»Рµ Р±РѕСЏ. РћРїРёС€Рё РёСЃС…РѕРґ Р±РѕСЏ Рё РїРѕР±РµРґРёС‚РµР»СЏ.]";
            addCalculationMessage("[РЎРРЎРўР•РњРђ] Р‘РѕР№ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё Р·Р°РІРµСЂС€РµРЅ.");
            if (player.travel && player.travel.active && player.travel.paused && player.travel.pauseReason === 'combat') {
                TravelSystem.resume();
                finalMessageForGM += " [SYSTEM: РџРЈРўР•РЁР•РЎРўР’РР• Р’РћР—РћР‘РќРћР’Р›Р•РќРћ. РЈРїРѕРјСЏРЅРё, С‡С‚Рѕ РіРµСЂРѕР№ РїСЂРѕРґРѕР»Р¶Р°РµС‚ РїСѓС‚СЊ.]";
            }
        } else {
            // 2. Р Р°СЃС‡РµС‚ Р°С‚Р°Рє РїСЂРѕС‚РёРІРЅРёРєРѕРІ С‡РµСЂРµР· C++ СЏРґСЂРѕ
            let playerDef = 10 + Math.floor((player.stats.dex - 10) / 2);
            const { bonuses } = getEffectiveStats();
            playerDef += (bonuses['res'] || 0);

            let enemiesData = activeEnemies; // РџСЂРѕСЃС‚Рѕ РїРµСЂРµРґР°РµРј РјР°СЃСЃРёРІ ID

            const combatRes = await sendInventoryCommand('resolveEnemyAttacks', { player_def: playerDef, enemies: enemiesData });
            
            let enemyRollsText = "\n\n[SYSTEM: Р Р•Р—РЈР›Р¬РўРђРўР« РђРўРђРљ РџР РћРўРР’РќРРљРћР’ Р’ Р­РўРћРњ РҐРћР”РЈ:\n";
            if (combatRes.success && combatRes.combat_log) {
                combatRes.combat_log.forEach(logLine => {
                    enemyRollsText += "- " + logLine + "\n";
                });
                if (combatRes.total_damage > 0) {
                    damagePlayerHP(combatRes.total_damage);
                    enemyRollsText += `РРўРћР“Рћ РЈР РћРќРђ РџРћ РР“Р РћРљРЈ: ${combatRes.total_damage}. HP РёРіСЂРѕРєР° СЃРЅРёР¶РµРЅРѕ.\n`;
                } else {
                    enemyRollsText += "РРіСЂРѕРє СѓСЃРїРµС€РЅРѕ СѓРєР»РѕРЅРёР»СЃСЏ/Р·Р°Р±Р»РѕРєРёСЂРѕРІР°Р» РІСЃРµ Р°С‚Р°РєРё.\n";
                }
            }
            enemyRollsText += "РЎРўР РћР–РђР™РЁРР™ РџР РРљРђР—: Р’Р РђР“Р Р–РР’Р« (HP > 0)! РўР« РћР‘РЇР—РђРќ СѓС‡РµСЃС‚СЊ СЌС‚Рё СЂРµР·СѓР»СЊС‚Р°С‚С‹ РІ СЃРІРѕРµРј С…СѓРґРѕР¶РµСЃС‚РІРµРЅРЅРѕРј РѕРїРёСЃР°РЅРёРё! Р—РђРџР Р•Р©Р•РќРћ Р·Р°РІРµСЂС€Р°С‚СЊ Р±РѕР№, РІС‹РґР°РІР°С‚СЊ Р»СѓС‚ РёР»Рё РѕР±РЅРѕРІР»СЏС‚СЊ РєРІРµСЃС‚С‹! РќР°РїРёС€Рё РџРѕСЌС‚Сѓ РІ logic_summary: 'Р‘РћР™ РџР РћР”РћР›Р–РђР•РўРЎРЇ. РћРїРёС€Рё РѕС‚РІРµС‚РЅС‹Р№ СѓРґР°СЂ РІСЂР°РіРѕРІ'.]";
            finalMessageForGM += enemyRollsText;
        }
    }

    // --- РќРђР§РђР›Рћ Р›РћР“РРљР РњР•РҐРђРќРР—РњРђ РџРђРњРЇРўР ---
    player.stats.turnCount++;
    player.lastTurnPulses = player.gameTime.totalPulses; // Р—Р°РїРѕРјРёРЅР°РµРј РІСЂРµРјСЏ Р”Рћ РІС‹РїРѕР»РЅРµРЅРёСЏ РґРµР№СЃС‚РІРёСЏ
    const turn = player.stats.turnCount;

    // РЈРјРµРЅСЊС€Р°РµРј РєСѓР»РґР°СѓРЅС‹ СЃРєРёР»Р»РѕРІ
    if (player.skills) {
        Object.values(player.skills).forEach(s => {
            if (s.currentCooldown > 0) s.currentCooldown--;
        });
        updateSkillsDisplay();
    }


    // РђСЂС…РёРІР°С†РёСЏ РїРµСЂРµРЅРµСЃРµРЅР° РІ РєРѕРЅРµС† sendApiRequest, С‡С‚РѕР±С‹ РЅРµ РїСЂРµСЂС‹РІР°С‚СЊ С‚РµРєСѓС‰РёР№ С…РѕРґ РёРіСЂРѕРєР°.

    if (turn > 0 && turn % MEMORY_PRUNE_TURN === 0) {
        addLogMessage(t('optimization.clearing', "РљРѕРЅС‚РµРєСЃС‚ РґРёР°Р»РѕРіРѕРІ Р±С‹Р» РѕС‡РёС‰РµРЅ РґР»СЏ РѕРїС‚РёРјРёР·Р°С†РёРё. РљР»СЋС‡РµРІС‹Рµ СЃРѕР±С‹С‚РёСЏ СЃРѕС…СЂР°РЅРµРЅС‹ РІ РїР°РјСЏС‚Рё GM."), "command-feedback");
        conversationHistory = [];
    }

    processAutomatedNexusEffects();
    const effectLogMessages = processStatusEffects();
    
    if (player.stats.hp <= 0 && !player.statusEffects['ghost_form']) {
        if (window.ModAPI) await ModAPI.emit('onPlayerDied', {cause: 'combat', location: player.location, hp: player.stats.hp});
        updateCharacterSheet();
        effectLogMessages.forEach(msg => addLogMessage(msg, "command-feedback"));
        await handlePlayerDeath();
        return; // РџСЂРµСЂС‹РІР°РµРј РѕР±С‹С‡РЅС‹Р№ С…РѕРґ, С‚Р°Рє РєР°Рє РёРіСЂРѕРє СѓРјРµСЂ РґРѕ РѕС‚РІРµС‚Р° GM (РѕС‚ СЏРґР° РёР»Рё Р°РІС‚Рѕ-Р±РѕСЏ)
    }

    updateCharacterSheet();
    effectLogMessages.forEach(msg => addLogMessage(msg, "command-feedback"));

    const expiredEffectsForGM = player.expiredEffectsForGM || [];
    player.expiredEffectsForGM = [];

    // --- РЎРРЎРўР•РњРђ РўР РђР’Рњ ---
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
            traumaInstruction = `\n\n[SYSTEM CRITICAL: РџРµСЂСЃРѕРЅР°Р¶ РїРѕР»СѓС‡РёР» РўРЇР–Р•Р›РЈР® РўР РђР’РњРЈ. РћРїРёС€Рё СЌС‚Рѕ Рё РЅР°Р»РѕР¶Рё РґРµР±Р°С„С„ РєРѕРјР°РЅРґРѕР№ addStatusEffect.]`;
        }
    }

        let hasGuards = Object.values(player.visibleEntities).some(e => e.type === 'npc' && (e.profession?.toLowerCase().includes('СЃС‚СЂР°Р¶') || (e.traits && e.traits.includes('РЎС‚СЂР°Р¶РЅРёРє'))));
    if (hasGuards) {
        let bp = ContainerRegistry.get(player.container_backpack);
        let hasStolen = bp && getContainerItems(bp).some(id => ItemRegistry.get(id)?.flags?.stolen);
        if (hasStolen) {
            let count = await CoreInventorySystemAsync.confiscateStolen(player.container_backpack, "guard_confiscation_chest");
            finalMessageForGM += `\n\n[SYSTEM CRITICAL: РЎС‚СЂР°Р¶Р° РђР’РўРћРќРћРњРќРћ РѕР±С‹СЃРєР°Р»Р° РёРіСЂРѕРєР° Рё РЅР°С€Р»Р° РєСЂР°РґРµРЅРѕРµ! РР·СЉСЏС‚Рѕ РїСЂРµРґРјРµС‚РѕРІ: ${count}. РўР« РћР‘РЇР—РђРќ РѕРїРёСЃР°С‚СЊ СЃС†РµРЅСѓ Р°СЂРµСЃС‚Р°, С€С‚СЂР°С„Р° РёР»Рё РЅР°РїР°РґРµРЅРёСЏ СЃС‚СЂР°Р¶Рё!]`;
        }
    }


finalMessageForGM += traumaInstruction;
    sendApiRequest(finalMessageForGM, false, false, expiredEffectsForGM, false);

    userInput.value = '';
    if (rollsContainer) rollsContainer.innerHTML = '';
    turnRollMemory = {};
}





/**
 * Р’СЃРїРѕРјРѕРіР°С‚РµР»СЊРЅР°СЏ С„СѓРЅРєС†РёСЏ РґР»СЏ РІС‹РїРѕР»РЅРµРЅРёСЏ Р·Р°РїСЂРѕСЃР° Рє API.
 * РРЅРєР°РїСЃСѓР»РёСЂСѓРµС‚ Р»РѕРіРёРєСѓ РїСЂРѕРІР°Р№РґРµСЂРѕРІ, Р·Р°РіРѕР»РѕРІРєРѕРІ Рё РєР»СЋС‡РµР№.
 */
let lastApiRequestTime = 0;
const API_DELAY_MS = 3500; // 3.5 СЃРµРєСѓРЅРґС‹ Р·Р°РґРµСЂР¶РєРё РјРµР¶РґСѓ Р»СЋР±С‹РјРё Р·Р°РїСЂРѕСЃР°РјРё
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

    // --- РџР РћР’РђР™Р”Р•Р -Р—РђР“Р›РЈРЁРљРђ (Р”Р›РЇ РўР•РЎРўРћР’) ---
    if (currentApiProvider === 'dummy') {
        await new Promise(resolve => setTimeout(resolve, 500)); // РРјРёС‚Р°С†РёСЏ Р·Р°РґРµСЂР¶РєРё
        if (currentInput === "[INITIAL_GAME_SETUP_START_OF_STORY]") {
            return JSON.stringify({
                "director_notes": "Dummy initial setup.",
                "time_passed": { "days": 0, "hours": 0, "minutes": 5 },
                "narrative": "(( РўР•РЎРўРћР’Р«Р™ РЎРўРђР Рў. Р’С‹ РїРѕСЏРІРёР»РёСЃСЊ РІ РјРёСЂРµ. Р”РІРёР¶РѕРє Рё UI РіРѕС‚РѕРІС‹ Рє С‚РµСЃС‚Р°Рј. ))",
                "actions": [
                    { "command": "setLocation", "args": { "locationName": "capital_aquilon" } },
                    { "command": "renderLocation", "args": { "locationId": "dummy_start", "size": "15x15", "description": "РўРµСЃС‚РѕРІР°СЏ Р»РѕРєР°С†РёСЏ" } },
                    { "command": "addItem", "args": { "id": "sword_short_common", "name": "РўРµСЃС‚РѕРІС‹Р№ РјРµС‡", "slot": "right_hand", "effects": [{"type": "modify_stat", "stat": "str", "change": 1}] } },
                    { "command": "equipItem", "args": { "id": "sword_short_common", "slot": "right_hand" } },
                    { "command": "addItem", "args": { "id": "leather_armor_light_common", "name": "РўРµСЃС‚РѕРІР°СЏ Р±СЂРѕРЅСЏ", "slot": "torso", "effects": [{"type": "modify_stat", "stat": "res", "change": 2}] } },
                    { "command": "equipItem", "args": { "id": "leather_armor_light_common", "slot": "torso" } },
                    { "command": "addItem", "args": { "id": "boots_common", "name": "РўРµСЃС‚РѕРІС‹Рµ СЃР°РїРѕРіРё", "slot": "feet", "effects": [{"type": "modify_stat", "stat": "res", "change": 1}] } },
                    { "command": "equipItem", "args": { "id": "boots_common", "slot": "feet" } },
                    { "command": "addItem", "args": { "id": "pants_common", "name": "РўРµСЃС‚РѕРІС‹Рµ С€С‚Р°РЅС‹", "slot": "legs", "effects": [{"type": "modify_stat", "stat": "res", "change": 1}] } },
                    { "command": "equipItem", "args": { "id": "pants_common", "slot": "legs" } },
                    { "command": "updateStat", "args": { "stat": "gold", "change": 100 } }
                ]
            });
        } else {
            return JSON.stringify({
                "director_notes": "Dummy response.",
                "time_passed": { "days": 0, "hours": 1, "minutes": 0 },
                "narrative": "(( РўР•РЎРўРћР’Р«Р™ РћРўР’Р•Рў Р—РђР“Р›РЈРЁРљР. Р’СЂРµРјСЏ РїСЂРѕРґРІРёРЅСѓС‚Рѕ РЅР° 1 С‡Р°СЃ. ))\n\nР’Р°С€ Р·Р°РїСЂРѕСЃ: *" + currentInput + "*",
                "actions": []
            });
        }
    }


    // --- Р“Р›РћР‘РђР›Р¬РќРђРЇ Р—РђР”Р•Р Р–РљРђ (RATE LIMIT) ---
    const now = Date.now();
    const currentDelay = (currentInput === "[INITIAL_GAME_SETUP_START_OF_STORY]") ? 15000 : API_DELAY_MS;
    const timeSinceLastRequest = now - lastApiRequestTime;
    if (timeSinceLastRequest < currentDelay) {
        const waitTime = currentDelay - timeSinceLastRequest;
        console.log(`[Rate Limit] РћР¶РёРґР°РЅРёРµ ${waitTime}РјСЃ РїРµСЂРµРґ РѕС‚РїСЂР°РІРєРѕР№ Р·Р°РїСЂРѕСЃР°...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    lastApiRequestTime = Date.now();
    // ----------------------------------------

            let attempts = 0;
        const maxAttempts = (currentApiProvider === 'gemini' && geminiApiKeys.length > 0) ? geminiApiKeys.length : 1;

        // FIX: РЎРѕС…СЂР°РЅСЏРµРј РіР»РѕР±Р°Р»СЊРЅС‹Рµ РЅР°СЃС‚СЂРѕР№РєРё РґР»СЏ Р±РµР·РѕРїР°СЃРЅРѕРіРѕ С„РѕР»Р±СЌРєР°
        let originalUseCaching = usePromptCaching;
        let originalUseThinking = useThinkingMode;
        let fallbackRetries = 0;

        try {
            while (attempts < maxAttempts) {
        let targetUrl = "";
        let headers = { 'Content-Type': 'application/json' };
        let requestBody = {};
        let isGeminiFormat = false;

        // 1. РџРѕРґРіРѕС‚РѕРІРєР° СЃС‚Р°РЅРґР°СЂС‚РЅРѕРіРѕ РјР°СЃСЃРёРІР° СЃРѕРѕР±С‰РµРЅРёР№ (OpenAI С„РѕСЂРјР°С‚)
        let messages = [];
        
        // РЇР’РќРћР• РљР­РЁРР РћР’РђРќРР• (Anthropic / Gemini С‡РµСЂРµР· LLMost/OpenRouter)
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

        // --- РРќРўР•Р“Р РђР¦РРЇ РњРћР”РћР’: Р¤РёР»СЊС‚СЂС‹ РџСЂРѕРјРїС‚РѕРІ ---
        if (window.ModAPI && window.ModAPI.promptFilters && window.ModAPI.promptFilters.length > 0) {
            for (const filter of window.ModAPI.promptFilters) {
                try {
                    const modified = filter(messages, providerModel, currentInput);
                    if (modified) {
                        if (modified.messages) messages = modified.messages;
                        if (modified.currentInput) currentInput = modified.currentInput;
                    }
                } catch(e) { console.error("[ModAPI] РћС€РёР±РєР° РІ С„РёР»СЊС‚СЂРµ РїСЂРѕРјРїС‚РѕРІ:", e); }
            }
        }
        // ------------------------------------------

        // --- Р’РЎР• Р—РђРџР РћРЎР« РР”РЈРў РќРђРџР РЇРњРЈР® РџР РћР’РђР™Р”Р•Р РЈ ---
        // --- РџРћР”Р“РћРўРћР’РљРђ РџРђР РђРњР•РўР РћР’ THINKING ---
        let finalTemperature = 0.7;
        let finalMaxTokens = 4096;
        let thinkingParams = null;
        let reasoningParams = null;

        if (useThinkingMode) {
            finalTemperature = 1.0; // РњРѕРґРµР»Рё СЃ Thinking С‚СЂРµР±СѓСЋС‚ С‚РµРјРїРµСЂР°С‚СѓСЂСѓ 1.0
            finalMaxTokens = thinkingBudget + 4096; // Р‘СЋРґР¶РµС‚ РЅР° РјС‹СЃР»Рё + РјРµСЃС‚Рѕ РґР»СЏ СЃР°РјРѕРіРѕ РѕС‚РІРµС‚Р°
            thinkingParams = {
                type: "enabled",
                budget_tokens: thinkingBudget
            };
            reasoningParams = reasoningEffort;
        }

        if (currentInput === "[INITIAL_GAME_SETUP_START_OF_STORY]") {
            finalMaxTokens = 16384; // РЈРІРµР»РёС‡РёРІР°РµРј Р»РёРјРёС‚ РґР»СЏ РіРµРЅРµСЂР°С†РёРё РјРёСЂР°
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
                // РЈР±СЂР°РЅРѕ response_format: { type: "json_object" } РґР»СЏ СЃРѕРІРјРµСЃС‚РёРјРѕСЃС‚Рё СЃ LM Studio
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

            // Gemini API С‚СЂРµР±СѓРµС‚ СЃРїРµС†РёС„РёС‡РЅС‹Р№ С„РѕСЂРјР°С‚ РЅР°РїСЂСЏРјСѓСЋ
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

        console.log('РћС‚РїСЂР°РІРєР° РџР РЇРњРћР“Рћ Р·Р°РїСЂРѕСЃР° (' + currentApiProvider + ') РЅР°: ' + targetUrl);

        // 3. РћС‚РїСЂР°РІРєР° Р·Р°РїСЂРѕСЃР°
        let response;
        try {
            response = await fetch(targetUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestBody),
                signal: currentApiAbortController.signal
            });

            if (response.status === 429 && currentApiProvider === 'gemini' && geminiApiKeys.length > 1) {
                console.warn('[KeyRotation] РљР»СЋС‡ #' + currentGeminiKeyIndex + ' РёСЃС‡РµСЂРїР°РЅ (429). РџСЂРѕР±СѓСЋ СЃР»РµРґСѓСЋС‰РёР№...');
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

                // РђРІС‚Рѕ-РѕС‚РєР»СЋС‡РµРЅРёРµ РЅРµРїРѕРґРґРµСЂР¶РёРІР°РµРјС‹С… РїР°СЂР°РјРµС‚СЂРѕРІ (РІСЂРµРјРµРЅРЅРѕ РјРµРЅСЏРµРј РіР»РѕР±Р°Р»СЊРЅС‹Рµ С„Р»Р°РіРё)
                if (errText.includes("prompt_caching") && usePromptCaching) {
                    console.warn('[API] РњРѕРґРµР»СЊ РЅРµ РїРѕРґРґРµСЂР¶РёРІР°РµС‚ prompt_caching, РѕС‚РєР»СЋС‡Р°СЋ...');
                    usePromptCaching = false;
                    retry = true;
                }
                if (errText.includes("cache_control") && usePromptCaching) {
                    console.warn('[API] РњРѕРґРµР»СЊ РЅРµ РїРѕРґРґРµСЂР¶РёРІР°РµС‚ cache_control, РѕС‚РєР»СЋС‡Р°СЋ...');
                    usePromptCaching = false;
                    retry = true;
                }
                if ((errText.includes("thinking") || errText.includes("reasoning_effort") || errText.includes("include_reasoning")) && useThinkingMode) {
                    console.warn('[API] РњРѕРґРµР»СЊ РЅРµ РїРѕРґРґРµСЂР¶РёРІР°РµС‚ thinking mode, РѕС‚РєР»СЋС‡Р°СЋ...');
                    useThinkingMode = false;
                    retry = true;
                }

                if (retry) {
                    fallbackRetries++;
                    if (fallbackRetries > 3) {
                        throw new Error("РљСЂРёС‚РёС‡РµСЃРєРёР№ СЃР±РѕР№ API: Р±РµСЃРєРѕРЅРµС‡РЅС‹Р№ С†РёРєР» С„РѕР»Р±СЌРєРѕРІ. РўРµРєСЃС‚ РѕС€РёР±РєРё: " + errText);
                    }
                    addLogMessage("[РЎРРЎРўР•РњРђ] РњРѕРґРµР»СЊ РЅРµ РїРѕРґРґРµСЂР¶РёРІР°РµС‚ РїР°СЂР°РјРµС‚СЂС‹ РР (Thinking/Caching), РѕС‚РєР»СЋС‡Р°СЋ РёС… Рё РїРѕРІС‚РѕСЂСЏСЋ Р·Р°РїСЂРѕСЃ...", "system-message");
                    continue;
                }
                // FIX: РСЃРїРѕР»СЊР·СѓРµРј С‡РµР»РѕРІРµРєРѕС‡РёС‚Р°РµРјСѓСЋ РѕС€РёР±РєСѓ
                throw new Error(getFriendlyApiErrorMessage(response.status, errText));
            }

        const data = await response.json();

        // 4. РћР±СЂР°Р±РѕС‚РєР° РѕС‚РІРµС‚Р°
        if (isGeminiFormat) {
            if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
                return data.candidates[0].content.parts[0].text;
            }
        } else {
            if (data.choices && data.choices[0] && data.choices[0].message) {
                let content = data.choices[0].message.content || "";
                let reasoning = data.choices[0].message.reasoning || "";
                
                // Р•СЃР»Рё API РІРµСЂРЅСѓР»Рѕ reasoning РѕС‚РґРµР»СЊРЅС‹Рј РїРѕР»РµРј, РІС€РёРІР°РµРј РµРіРѕ РІ РєРѕРЅС‚РµРЅС‚ РґР»СЏ РїР°СЂСЃРµСЂР°
                if (reasoning) {
                    content = "<think>\n" + reasoning + "\n</think>\n" + content;
                }
                return content;
            }
        }

                throw new Error("РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ С‚РµРєСЃС‚ РёР· РѕС‚РІРµС‚Р° РјРѕРґРµР»Рё.");
            }
            
            // Р—Р°С‰РёС‚Р° РѕС‚ С‚РёС…РѕРіРѕ РІС‹С…РѕРґР° РёР· С†РёРєР»Р° (РµСЃР»Рё maxAttempts РёСЃС‡РµСЂРїР°РЅ)
            throw new Error("РџСЂРµРІС‹С€РµРЅРѕ РєРѕР»РёС‡РµСЃС‚РІРѕ РїРѕРїС‹С‚РѕРє Р·Р°РїСЂРѕСЃР° Рє API РёР»Рё РїСЂРѕРёР·РѕС€РµР» СЃР±РѕР№ С„РѕР»Р±СЌРєР°.");
        } finally {
            // FIX: Р’РѕСЃСЃС‚Р°РЅР°РІР»РёРІР°РµРј РіР»РѕР±Р°Р»СЊРЅС‹Рµ РЅР°СЃС‚СЂРѕР№РєРё РїРѕСЃР»Рµ Р·Р°РІРµСЂС€РµРЅРёСЏ Р·Р°РїСЂРѕСЃР°
            usePromptCaching = originalUseCaching;
            useThinkingMode = originalUseThinking;
        }
}

/**
 * РћРЎРќРћР’РќРђРЇ Р¤РЈРќРљР¦РРЇ (РћР РљР•РЎРўР РђРўРћР ): РЎС‡РµС‚РѕРІРѕРґ -> РџРѕСЌС‚
 */


async function handlePlayerDeath() {
    isWaitingForAI = true;
    addLogMessage("Р’С‹ С‡СѓРІСЃС‚РІСѓРµС‚Рµ, РєР°Рє С…РѕР»РѕРґ РѕС…РІР°С‚С‹РІР°РµС‚ РІР°С€Рµ С‚РµР»Рѕ. РўСЊРјР° Р·Р°СЃС‚РёР»Р°РµС‚ РіР»Р°Р·Р°. Р’С‹ РјРµСЂС‚РІС‹...", "system-message");

    const corpseId = await CoreInventorySystemAsync.createContainer("static_chest", "system", 999999, 1000, player.location, {
        custom_props: { name: `РћСЃС‚Р°РЅРєРё (${player.name})` }
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

    player.location = "РўРµРЅСЊ (РР·РЅР°РЅРєР° РњРёСЂР°)";
    player.currentSublocation = null;
    player.stats.hp = player.stats.maxHp;
    
    await executeCommand('addStatusEffect', {
        target: "player", id: "ghost_form", name: "Р­С…Рѕ (РџСЂРёР·СЂР°Рє)", duration: 9999,
        description: "Р’С‹ РјРµСЂС‚РІС‹. Р¤РёР·РёС‡РµСЃРєРёР№ РјРёСЂ РЅРµРґРѕСЃС‚СѓРїРµРЅ. РќР°Р№РґРёС‚Рµ Р­С„РёСЂРЅС‹Р№ Р Р°Р·Р»РѕРј, С‡С‚РѕР±С‹ РІРѕСЃРєСЂРµСЃРЅСѓС‚СЊ.", effectsJSON: "[]"
    });

    await executeCommand('addQuest', {
        aiIdentifier: "quest_resurrection", title: "РџСѓС‚СЊ РёР· РўРµРЅРё",
        objective: "РќР°Р№С‚Рё Р­С„РёСЂРЅС‹Р№ Р Р°Р·Р»РѕРј РІ РўРµРЅРё Рё С€Р°РіРЅСѓС‚СЊ РІ РЅРµРіРѕ.",
        description: "Р’Р°С€Рµ С‚РµР»Рѕ РјРµСЂС‚РІРѕ, Р° РІРµС‰Рё РѕСЃС‚Р°Р»РёСЃСЊ РЅР° РјРµСЃС‚Рµ РіРёР±РµР»Рё. Р”СѓС€Р° Р·Р°СЃС‚СЂСЏР»Р° РІ РўРµРЅРё. РќР°Р№РґРёС‚Рµ СЂР°Р·Р»РѕРј РІ С‚РєР°РЅРё СЂРµР°Р»СЊРЅРѕСЃС‚Рё, С‡С‚РѕР±С‹ РїРµСЂРµСЂРѕРґРёС‚СЊСЃСЏ.",
        reward: "Р’РѕСЃРєСЂРµС€РµРЅРёРµ", issuer: "РЎРјРµСЂС‚СЊ"
    });

            syncPlayerGoldFromInventory();
        updateCharacterSheet();
        updateInventoryDisplay();
        updateEquipmentDisplay();
        updateMapDisplay();
        
        const deathPrompt = "[SYSTEM CRITICAL: РР“Р РћРљ РўРћР›Р¬РљРћ Р§РўРћ РЈРњР•Р  (HP СѓРїР°Р»Рѕ РґРѕ 0). РћРїРёС€Рё РјРѕРјРµРЅС‚ СЃРјРµСЂС‚Рё, РєР°Рє РґСѓС€Р° РѕС‚СЂС‹РІР°РµС‚СЃСЏ РѕС‚ С‚РµР»Р° Рё РїР°РґР°РµС‚ РІ РўРµРЅСЊ (Umbra) вЂ” С…РѕР»РѕРґРЅРѕРµ, СЃРµСЂРѕРµ, РёСЃРєР°Р¶РµРЅРЅРѕРµ РѕС‚СЂР°Р¶РµРЅРёРµ РњРµС‚РµСЂС‹. Р’РѕРєСЂСѓРі Р±СЂРѕРґСЏС‚ РџРѕР¶РёСЂР°С‚РµР»Рё Р”СѓС€ Рё РґСЂСѓРіРёРµ РїСЂРёР·СЂР°РєРё. РРіСЂРѕРє РїРѕС‚РµСЂСЏР» РІСЃРµ РІРµС‰Рё (РѕРЅРё РѕСЃС‚Р°Р»РёСЃСЊ РЅР° С‚СЂСѓРїРµ). Р§С‚РѕР±С‹ РІРѕСЃРєСЂРµСЃРЅСѓС‚СЊ, РµРјСѓ РЅСѓР¶РЅРѕ РЅР°Р№С‚Рё Р­С„РёСЂРЅС‹Р№ Р Р°Р·Р»РѕРј (Aether Rift). РћРїРёС€Рё СЌС‚Рѕ Р¶СѓС‚РєРѕРµ РјРµСЃС‚Рѕ Рё СЃРїСЂРѕСЃРё, С‡С‚Рѕ РёРіСЂРѕРє Р±СѓРґРµС‚ РґРµР»Р°С‚СЊ РІ РІРёРґРµ РїСЂРёР·СЂР°РєР°. Р”РР Р•РљРўРР’Рђ Р”Р’РР–РљРђ: Р”РІРёР¶РѕРє РЈР–Р• РїРµСЂРµРЅРµСЃ РёРіСЂРѕРєР° РІ РўРµРЅСЊ, РѕР±РЅСѓР»РёР» РёРЅРІРµРЅС‚Р°СЂСЊ, РІС‹РґР°Р» РєРІРµСЃС‚ РЅР° РІРѕСЃРєСЂРµС€РµРЅРёРµ Рё РЅР°Р»РѕР¶РёР» СЃС‚Р°С‚СѓСЃ РїСЂРёР·СЂР°РєР°. РўР•Р‘Р• РљРђРўР•Р“РћР РР§Р•РЎРљР Р—РђРџР Р•Р©Р•РќРћ РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ РєРѕРјР°РЅРґС‹ setLocation, addQuest, addStatusEffect РёР»Рё РёР·РјРµРЅСЏС‚СЊ HP РІ СЌС‚РѕРј РѕС‚РІРµС‚Рµ! Р’РµСЂРЅРё РїСѓСЃС‚РѕР№ РјР°СЃСЃРёРІ actions.]";
    
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

    const thinkingTitle = isInitialPrompt ? "РЎРѕС‚РІРѕСЂРµРЅРёРµ РјРёСЂР°..." : "РЎРїР»РµС‚РµРЅРёРµ РЅРёС‚РµР№ СЃСѓРґСЊР±С‹...";
    const thinkingSub = isInitialPrompt ? "РЎРёРЅС‚РµР· РїРµСЂРІРѕР·РґР°РЅРЅРѕР№ РјР°С‚РµСЂРёРё" : "Р•РґРёРЅС‹Р№ СЂР°Р·СѓРј РѕР±СЂР°Р±Р°С‚С‹РІР°РµС‚ СЂРµР°Р»СЊРЅРѕСЃС‚СЊ";

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
                <i class="fas fa-times"></i> РџСЂРµСЂРІР°С‚СЊ СЃРІСЏР·СЊ
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
            console.log(">>> Р—Р°РїСѓСЃРє РРЅРёС†РёР°Р»РёР·Р°С†РёРё (Single Pass)...");
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
                        currentErrors.push(`РљРѕРјР°РЅРґР° ${action.command} СЃ Р°СЂРіСѓРјРµРЅС‚Р°РјРё ${JSON.stringify(action.args)} РІС‹Р·РІР°Р»Р° РѕС€РёР±РєСѓ: ${feedback}`);
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
            console.log(">>> Р—Р°РїСѓСЃРє Р•РґРёРЅРѕРіРѕ GM...");
            
            const unifiedPrompt = await prepareUnifiedPrompt();
            const dynamicContext = buildDynamicContext(expiredEffects);
            const finalInput = `${dynamicContext}\n\n=== Р’Р’РћР” РР“Р РћРљРђ Р РЎРРЎРўР•РњРќР«Р• Р”РђРќРќР«Р• РҐРћР”Рђ ===\n${promptTextForAI}`;

            const rawResponse = await performAiFetch(unifiedPrompt, conversationHistory, modelIdForRequest, finalInput);
            const result = parseAIResponse(rawResponse);

            if (!result || (!result.narrative && !result.actions)) throw new Error("Р•РґРёРЅС‹Р№ GM РІРµСЂРЅСѓР» РїСѓСЃС‚РѕР№ РѕС‚РІРµС‚.");
            if (!validateTime(result)) throw new Error("MISSING_TIME_PASSED");

            timeToApply = result.time_passed;
            allPendingActions = result.actions || [];
            
            let valErrors = validateActionsArray(allPendingActions);
            if (valErrors.length > 0) throw new Error("VALIDATION_FAILED|" + valErrors.join("; "));

            const narrativeText = result.narrative || "Р”РµР№СЃС‚РІРёРµ РІС‹РїРѕР»РЅРµРЅРѕ.";
            window.lastGeneratedNarrative = narrativeText;

            removeEtherLoader();
            
            if (result.ai_reasoning) {
                addCalculationMessage(`[РњР«РЎР›Р РР (Reasoning)]:\n${result.ai_reasoning}`, "calc-info");
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
                        currentErrors.push(`РљРѕРјР°РЅРґР° ${action.command} СЃ Р°СЂРіСѓРјРµРЅС‚Р°РјРё ${JSON.stringify(action.args)} РІС‹Р·РІР°Р»Р° РѕС€РёР±РєСѓ: ${feedback}`);
                    }
                }
            }
            player.gmErrors = currentErrors;

            updateCharacterSheet();
            updateMapDisplay();
            updateInventoryDisplay();
            updateEnvironmentPanel();

            // РџСЂРѕРІРµСЂРєР° РЅР° СЃРјРµСЂС‚СЊ РѕС‚ РєРѕРјР°РЅРґ Р“Рњ (РЅР°РїСЂРёРјРµСЂ, updateStat hp -100)
            if (player.stats.hp <= 0 && !player.statusEffects['ghost_form']) {
                setTimeout(() => { handlePlayerDeath(); }, 500);
            }
        }

                if (isAutoTesting && !isInitialPrompt && !isSummarizationRequest) {
            setTimeout(runAIPlayerTurn, 2500); // Р—Р°РґРµСЂР¶РєР° 2.5 СЃРµРє РїРµСЂРµРґ С…РѕРґРѕРј РР-РёРіСЂРѕРєР° РґР»СЏ РёРјРёС‚Р°С†РёРё С‡С‚РµРЅРёСЏ
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
            console.log("[Network] РћР±СЂР°Р±РѕС‚РєР° РѕС‚РјРµРЅС‹: Р·Р°РїСЂРѕСЃ РїСЂРµСЂРІР°РЅ.");
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
            addLogMessage("(( РЎРІСЏР·СЊ СЃ Р­С„РёСЂРѕРј РїСЂРёРЅСѓРґРёС‚РµР»СЊРЅРѕ СЂР°Р·РѕСЂРІР°РЅР°. Р“РµРЅРµСЂР°С†РёСЏ РѕСЃС‚Р°РЅРѕРІР»РµРЅР°. ))", "system-message");
            return;
        }


        if (error.message === "INCOMPLETE_RESPONSE" && timeRetryCount < 3) {
            console.warn(`GM РїСЂРёСЃР»Р°Р» РЅРµРїРѕР»РЅС‹Р№ РѕС‚РІРµС‚. РџРѕРїС‹С‚РєР° ${timeRetryCount + 1} РёР· 3...`);
            const timeErrorPrompt = promptTextForAI + "\n\n[РЎРРЎРўР•РњРќРђРЇ РћРЁРР‘РљРђ]: РўРІРѕР№ РїСЂРµРґС‹РґСѓС‰РёР№ РѕС‚РІРµС‚ Р±С‹Р» РѕС‚РєР»РѕРЅС‘РЅ. РўС‹ РљРђРўР•Р“РћР РР§Р•РЎРљР Р—РђР‘Р«Р› РґРѕР±Р°РІРёС‚СЊ РѕР±СЏР·Р°С‚РµР»СЊРЅС‹Рµ РїРѕР»СЏ (narrative, actions РёР»Рё time_passed). РЎРіРµРЅРµСЂРёСЂСѓР№ РїРѕР»РЅС‹Р№ РІР°Р»РёРґРЅС‹Р№ JSON.";
            const loaderSub = document.querySelector('.ether-text-subtitle');
            if (loaderSub) loaderSub.textContent = "Р’РѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ СЃС‚СЂСѓРєС‚СѓСЂС‹ РѕС‚РІРµС‚Р°...";
            return sendApiRequest(timeErrorPrompt, isInitialPrompt, isDiceRollResponse, expiredEffects, isSummarizationRequest, timeRetryCount + 1);
        }
        
        if (error.message === "MISSING_TIME_PASSED" && timeRetryCount < 3) {
            console.warn(`GM Р·Р°Р±С‹Р» СѓРєР°Р·Р°С‚СЊ time_passed. РџРѕРїС‹С‚РєР° ${timeRetryCount + 1} РёР· 3...`);
            const timeErrorPrompt = promptTextForAI + "\n\n[РЎРРЎРўР•РњРќРђРЇ РћРЁРР‘РљРђ]: РўРІРѕР№ РїСЂРµРґС‹РґСѓС‰РёР№ РѕС‚РІРµС‚ Р±С‹Р» РѕС‚РєР»РѕРЅС‘РЅ. РўС‹ РљРђРўР•Р“РћР РР§Р•РЎРљР Р—РђР‘Р«Р› РґРѕР±Р°РІРёС‚СЊ РѕР±СЏР·Р°С‚РµР»СЊРЅРѕРµ РїРѕР»Рµ \"time_passed\" РЅР° РІРµСЂС…РЅРµРј СѓСЂРѕРІРЅРµ JSON РёР»Рё СѓРєР°Р·Р°Р» С‚Р°Рј РЅСѓР»Рё. РћС†РµРЅРё, СЃРєРѕР»СЊРєРѕ РІСЂРµРјРµРЅРё Р·Р°РЅСЏР»Рѕ РґРµР№СЃС‚РІРёРµ РёРіСЂРѕРєР° (РґР°Р¶Рµ РµСЃР»Рё СЌС‚Рѕ 5 РјРёРЅСѓС‚ РЅР° СЂР°Р·РіРѕРІРѕСЂ), РґРѕР±Р°РІСЊ РїРѕР»Рµ \"time_passed\": {\"days\": 0, \"hours\": 0, \"minutes\": 5} Рё СЃРіРµРЅРµСЂРёСЂСѓР№ РѕС‚РІРµС‚ Р·Р°РЅРѕРІРѕ.";
            const loaderSub = document.querySelector('.ether-text-subtitle');
            if (loaderSub) loaderSub.textContent = "РљРѕСЂСЂРµРєС‚РёСЂРѕРІРєР° РІСЂРµРјРµРЅРЅРѕРіРѕ РїРѕС‚РѕРєР°...";
            return sendApiRequest(timeErrorPrompt, isInitialPrompt, isDiceRollResponse, expiredEffects, isSummarizationRequest, timeRetryCount + 1);
        }
        
        if (error.message.startsWith("VALIDATION_FAILED|") && timeRetryCount < 3) {
            console.warn(`GM РїСЂРёСЃР»Р°Р» РЅРµРІР°Р»РёРґРЅС‹Рµ РєРѕРјР°РЅРґС‹. РџРѕРїС‹С‚РєР° ${timeRetryCount + 1} РёР· 3...`);
            let errs = error.message.split("|")[1];
            const validationErrorPrompt = promptTextForAI + `\n\n[РЎРРЎРўР•РњРќРђРЇ РћРЁРР‘РљРђ]: РўРІРѕР№ РїСЂРµРґС‹РґСѓС‰РёР№ РѕС‚РІРµС‚ Р±С‹Р» РѕС‚РєР»РѕРЅС‘РЅ РёР·-Р·Р° РЅРµРІРµСЂРЅС‹С… Р°СЂРіСѓРјРµРЅС‚РѕРІ РІ РєРѕРјР°РЅРґР°С…:\n${errs}\nРРЎРџР РђР’Р¬ Р­РўР РћРЁРР‘РљР Р РЎР“Р•РќР•Р РР РЈР™ РћРўР’Р•Рў Р—РђРќРћР’Рћ. РРЎРџРћР›Р¬Р—РЈР™ РўРћР›Р¬РљРћ РЎРЈР©Р•РЎРўР’РЈР®Р©РР• ID Р РўРРџР«!`;
            const loaderSub = document.querySelector('.ether-text-subtitle');
            if (loaderSub) loaderSub.textContent = "РСЃРїСЂР°РІР»РµРЅРёРµ Р»РѕРіРёС‡РµСЃРєРёС… РѕС€РёР±РѕРє...";
            return sendApiRequest(validationErrorPrompt, isInitialPrompt, isDiceRollResponse, expiredEffects, isSummarizationRequest, timeRetryCount + 1);
        }

        console.error("РћС€РёР±РєР° API:", error);
        removeEtherLoader();

        const oldRetryBtn = document.getElementById('retry-request-btn');
        if (oldRetryBtn) oldRetryBtn.remove();

        if (isInitialPrompt) {
            clearPromptCache(); // РћС‡РёС‰Р°РµРј РєСЌС€ РїСЂРѕРјРїС‚Р°, С‡С‚РѕР±С‹ СЃР»РµРґСѓСЋС‰РёР№ Р·Р°РїСЂРѕСЃ СЃРѕР±СЂР°Р» СЃРІРµР¶РёРµ РґР°РЅРЅС‹Рµ
            hideLoadingScreen();
        }

        showAiErrorModal(
            error.stack || error.message || String(error),
            isInitialPrompt,
            () => {
                if (isInitialPrompt) showLoadingScreen('loadingScreen.generatingWorld', 'Р“РµРЅРµСЂР°С†РёСЏ РјРёСЂР°...');
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
 * РЈРќРР’Р•Р РЎРђР›Р¬РќР«Р™ РџРђР РЎР•Р 
 * Р“Р°СЂР°РЅС‚РёСЂСѓРµС‚ РёР·РІР»РµС‡РµРЅРёРµ РґР°РЅРЅС‹С… РёР· JSON РґР°Р¶Рµ РµСЃР»Рё РјРѕРґРµР»СЊ РїСЂРёСЃР»Р°Р»Р° Р»РёС€РЅРёР№ С‚РµРєСЃС‚.
 */
async function runBackgroundSummarization() {
    isWaitingForAI = true;
    if (userInput) userInput.disabled = true;
    if (sendButton) sendButton.disabled = true;

    try {
        const promptTemplate = await loadPromptFromFile('assets/promts/summarize_memory_prompt.txt');
        const historyText = conversationHistory.map(m => `${m.role === 'model' ? 'GM' : 'Player'}: ${m.parts[0].text}`).join('\n\n');
        const notesText = JSON.stringify(player.gmNotes, null, 2);

        const finalPrompt = promptTemplate
            .replace('{gmNotes}', notesText)
            .replace('{conversationHistory}', historyText)
            .replace('{userAction}', 'РђРІС‚РѕРјР°С‚РёС‡РµСЃРєР°СЏ Р°СЂС…РёРІР°С†РёСЏ РїРѕСЃР»Рµ Р·Р°РІРµСЂС€РµРЅРёСЏ С…РѕРґР°');

        let modelId = localModelId;
        if (currentApiProvider === 'gemini') modelId = geminiModelId;
        else if (currentApiProvider === 'llmost') modelId = llmostModelId;
        else if (currentApiProvider === 'openrouter') modelId = openrouterModelId;
        else if (currentApiProvider === 'deepseek') modelId = deepseekModelId;
        else if (currentApiProvider === 'omniroute') modelId = omnirouteModelId;
        
        // РџРђРўР§: РџРµСЂРµРґР°РµРј РѕР±СЏР·Р°С‚РµР»СЊРЅС‹Р№ currentInput, С‡С‚РѕР±С‹ Gemini РЅРµ СЂСѓРіР°Р»СЃСЏ РЅР° РїСѓСЃС‚РѕР№ РјР°СЃСЃРёРІ contents
        const rawResponse = await performAiFetch(finalPrompt, [], modelId, "РџСЂРѕР°РЅР°Р»РёР·РёСЂСѓР№ РёСЃС‚РѕСЂРёСЋ Рё РѕР±РЅРѕРІРё РїР°РјСЏС‚СЊ (JSON).");
        const result = parseAIResponse(rawResponse);

        if (result.actions && result.actions.length > 0) {
            for (const action of result.actions) {
                await executeCommand(action.command, action.args);
            }
            addLogMessage("РџР°РјСЏС‚СЊ СѓСЃРїРµС€РЅРѕ СЃР¶Р°С‚Р° Рё Р·Р°Р°СЂС…РёРІРёСЂРѕРІР°РЅР°.", "command-feedback");
        } else {
            console.log("[Memory] GM РЅРµ РЅР°С€РµР» РґР°РЅРЅС‹С… РґР»СЏ Р°СЂС…РёРІР°С†РёРё РІ СЌС‚РѕС‚ СЂР°Р·.");
        }
    } catch (e) {
        console.error("РћС€РёР±РєР° С„РѕРЅРѕРІРѕР№ Р°СЂС…РёРІР°С†РёРё:", e);
        addLogMessage("РЎР±РѕР№ СЃРёСЃС‚РµРјС‹ Р°СЂС…РёРІР°С†РёРё РїР°РјСЏС‚Рё.", "system-message");
    } finally {
        isWaitingForAI = false;
        if (userInput) userInput.disabled = false;
        if (sendButton) sendButton.disabled = false;
        if (userInput) userInput.focus();
    }
}

function parseAIResponse(rawResponse) {
    // FIX: РЎС‚СЂРѕРіР°СЏ Р·Р°С‰РёС‚Р° РѕС‚ undefined/null, РµСЃР»Рё API РІРµСЂРЅСѓР»Рѕ РїСѓСЃС‚РѕР№ РѕС‚РІРµС‚ РёР»Рё РїСЂРѕРёР·РѕС€РµР» СЃР±РѕР№
    if (typeof rawResponse !== 'string') {
        console.warn("[Parser] РџРѕР»СѓС‡РµРЅ РЅРµСЃС‚СЂРѕРєРѕРІС‹Р№ РѕС‚РІРµС‚ РѕС‚ API, РєРѕРЅРІРµСЂС‚РёСЂСѓРµРј РІ РїСѓСЃС‚СѓСЋ СЃС‚СЂРѕРєСѓ.", rawResponse);
        rawResponse = String(rawResponse || "");
    }

    // --- РРќРўР•Р“Р РђР¦РРЇ РњРћР”РћР’: Р¤РёР»СЊС‚СЂС‹ РћС‚РІРµС‚РѕРІ ---
    if (window.ModAPI && window.ModAPI.responseFilters && window.ModAPI.responseFilters.length > 0) {
        for (const filter of window.ModAPI.responseFilters) {
            try {
                rawResponse = filter(rawResponse) || rawResponse;
            } catch(e) { console.error("[ModAPI] РћС€РёР±РєР° РІ С„РёР»СЊС‚СЂРµ РѕС‚РІРµС‚РѕРІ:", e); }
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

    // РР·РІР»РµРєР°РµРј Р±Р»РѕРє <think> (Reasoning)
    const thinkMatch = rawResponse.match(/<think>([\s\S]*?)<\/think>/i);
    if (thinkMatch) {
        ai_reasoning = thinkMatch[1].trim();
        // РЈРґР°Р»СЏРµРј Р±Р»РѕРє think РёР· СЃС‹СЂРѕРіРѕ РѕС‚РІРµС‚Р°, С‡С‚РѕР±С‹ РѕРЅ РЅРµ РјРµС€Р°Р» РїР°СЂСЃРёРЅРіСѓ JSON
        rawResponse = rawResponse.replace(/<think>[\s\S]*?<\/think>/i, "");
    }

    // 1. РћС‡РёСЃС‚РєР° РѕС‚ РјР°СЂРєРґР°СѓРЅР° СЃСЂР°Р·Сѓ
    let cleanRaw = rawResponse.replace(/```json/gi, "").replace(/```/g, "").trim();

            // 2. Р­РљРЎРўР Р•РќРќРђРЇ РџР РћР’Р•Р РљРђ: Р•СЃР»Рё РР РїСЂРёСЃР»Р°Р» РїСЂРѕСЃС‚Рѕ РјР°СЃСЃРёРІ РґРµР№СЃС‚РІРёР№ Р±РµР· РіР»Р°РІРЅРѕРіРѕ РѕР±СЉРµРєС‚Р°
        if (cleanRaw.startsWith('[')) {
            try {
                let parsedArray = JSON.parse(cleanRaw);
                if (Array.isArray(parsedArray)) {
                    actions = parsedArray;
                    return { narrative: "(( РЎРёСЃС‚РµРјРЅРѕРµ РґРµР№СЃС‚РІРёРµ РІС‹РїРѕР»РЅРµРЅРѕ. Р­С„РёСЂРЅС‹Рµ РїРѕРјРµС…Рё СЃРєСЂС‹Р»Рё РґРµС‚Р°Р»Рё СЃРѕР±С‹С‚РёСЏ. ))", actions, logic_summary, image_prompt };
                }
            } catch(e) {
                // РџСЂРѕРІР°Р»РёРІР°РµРјСЃСЏ РґР°Р»СЊС€Рµ, РµСЃР»Рё РЅРµ СЂР°СЃРїР°СЂСЃРёР»РѕСЃСЊ
            }
        }

        // 3. РС‰РµРј РіР»Р°РІРЅС‹Р№ РѕР±СЉРµРєС‚ {}
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
            // РЈРјРЅС‹Р№ С…РёСЂСѓСЂРі JSON
            let fixedJsonString = jsonString
                .replace(/,\s*([\]}\]])/g, '$1')
                .replace(/}\s*{/g, '},{')
                .replace(/\]\s*\[/g, '],[');

            // РЎР°РЅРёС‚Р°Р№Р·РµСЂ РЅРµСЌРєСЂР°РЅРёСЂРѕРІР°РЅРЅС‹С… РїРµСЂРµРЅРѕСЃРѕРІ СЃС‚СЂРѕРє (Bad control character fix)
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
                        else if (char.charCodeAt(0) < 32) sanitizedJson += ''; // РЈРґР°Р»СЏРµРј РїСЂРѕС‡РёРµ РЅРµРІРёРґРёРјС‹Рµ СЃРїРµС†СЃРёРјРІРѕР»С‹
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

            // РђР’РўРћ-Р¤РРљРЎ Р’Р Р•РњР•РќР: Р•СЃР»Рё РїРѕР»СЏ РЅРµС‚, СЃРѕР·РґР°РµРј РµРіРѕ (1 РјРёРЅСѓС‚Р° РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ)
            if (!parsed.time_passed) {
                console.warn("[Parser] GM Р·Р°Р±С‹Р» time_passed, СЃС‚Р°РІР»СЋ 1 РјРёРЅСѓС‚Сѓ.");
                time_passed = { days: 0, hours: 0, minutes: 1 };
            } else {
                time_passed = {
                    days: parseInt(parsed.time_passed.days) || 0,
                    hours: parseInt(parsed.time_passed.hours) || 0,
                    minutes: parseInt(parsed.time_passed.minutes) || 0
                };
            }

        } catch (jsonErr) {
            console.error("РљР РРўРР§Р•РЎРљРђРЇ РћРЁРР‘РљРђ РџРђР РЎРРќР“Рђ:", jsonErr);
            throw new Error("РћС‚РІРµС‚ РР СЃРѕРґРµСЂР¶РёС‚ РЅРµРІР°Р»РёРґРЅС‹Р№ СЃРёРЅС‚Р°РєСЃРёСЃ JSON. РўСЂРµР±СѓРµС‚СЃСЏ РїРѕРІС‚РѕСЂРЅС‹Р№ Р·Р°РїСЂРѕСЃ.\nР”РµС‚Р°Р»Рё: " + jsonErr.message);
        }

        // Р•СЃР»Рё narrative РїСѓСЃС‚, РїС‹С‚Р°РµРјСЃСЏ РІР·СЏС‚СЊ С‚РµРєСЃС‚ Р”Рћ РёР»Рё РџРћРЎР›Р• JSON
        if (!narrative.trim()) {
            let textOutside = cleanRaw.replace(jsonString, "").trim();
            // Р—РђР©РРўРђ РћРў РЈРўР•Р§РљР: Р•СЃР»Рё СЃРЅР°СЂСѓР¶Рё РѕСЃС‚Р°Р»СЃСЏ РєСѓСЃРѕРє РјР°СЃСЃРёРІР°, РёРіРЅРѕСЂРёСЂСѓРµРј РµРіРѕ
            if (!textOutside.includes('"command":') && !textOutside.includes('"args":')) {
                narrative = textOutside;
            }
        }
    } else {
        // JSON РЅРµ РЅР°Р№РґРµРЅ РІРѕРѕР±С‰Рµ, РІРµСЃСЊ РѕС‚РІРµС‚ - СЌС‚Рѕ С‚РµРєСЃС‚
        narrative = cleanRaw;
    }

    // --- РђР‘РЎРћР›Р®РўРќРђРЇ Р—РђР©РРўРђ (Р“РР›Р¬РћРўРРќРђ) ---
    // Р•СЃР»Рё РІ РёС‚РѕРіРѕРІРѕРј С‚РµРєСЃС‚Рµ РІСЃС‘ РµС‰С‘ С‚РѕСЂС‡Р°С‚ РєСѓСЃРєРё JSON-РєРѕРјР°РЅРґ, РІС‹СЂРµР·Р°РµРј РёС… Р¶РµСЃС‚РєРѕ
    if (narrative.includes('"command":') || narrative.includes('"args":') || narrative.includes('{"id":')) {
        console.error("РћР‘РќРђР РЈР–Р•РќРђ РЈРўР•Р§РљРђ JSON Р’ Р§РђРў! РўРµРєСЃС‚ РѕС‡РёС‰РµРЅ РїСЂРёРЅСѓРґРёС‚РµР»СЊРЅРѕ.");
        narrative = "(( РЎРёСЃС‚РµРјРЅС‹Р№ СЃР±РѕР№ СЃРІСЏР·Рё СЃ Р­С„РёСЂРѕРј. РњР°СЃС‚РµСЂ РРіСЂС‹ РїСЂРёСЃР»Р°Р» С‚РµС…РЅРёС‡РµСЃРєРёР№ РєРѕРґ РІРјРµСЃС‚Рѕ С‚РµРєСЃС‚Р°. Р”РµР№СЃС‚РІРёСЏ РІС‹РїРѕР»РЅРµРЅС‹. ))";
    }

    return { narrative, actions, logic_summary, image_prompt, time_passed, suggested_actions, ai_reasoning };
}

function animateGoldChange(amount) {
    const goldDisplay = document.getElementById('stat-gold');
    if (!goldDisplay) return;

    // РЎРѕР·РґР°РµРј СЌР»РµРјРµРЅС‚ С‡Р°СЃС‚РёС†С‹
    const particle = document.createElement('span');
    particle.className = 'coin-particle';
    const isPositive = amount > 0;
    particle.textContent = (isPositive ? '+$' : '$') + Math.abs(amount);
    if (!isPositive) particle.style.color = '#e74c3c'; // РљСЂР°СЃРЅС‹Р№ РґР»СЏ СѓР±С‹С‚РєР°

    // Р”РѕР±Р°РІР»СЏРµРј РёРєРѕРЅРєСѓ РјРѕРЅРµС‚РєРё
    const coinIcon = document.createElement('i');
    coinIcon.className = 'fas fa-coins';
    coinIcon.style.marginLeft = '5px';
    particle.appendChild(coinIcon);

    // РџРѕР·РёС†РёРѕРЅРёСЂСѓРµРј РІРѕР·Р»Рµ СЃС‡РµС‚С‡РёРєР° Р·РѕР»РѕС‚Р°
    const rect = goldDisplay.getBoundingClientRect();
    particle.style.left = `20px`;
    particle.style.top = `-10px`;

    goldDisplay.parentElement.style.position = 'relative';
    goldDisplay.parentElement.appendChild(particle);

    // Р­С„С„РµРєС‚ С‚СЂСЏСЃРєРё РґР»СЏ СЂРѕРґРёС‚РµР»СЏ РїСЂРё С‚СЂР°С‚Рµ
    if (!isPositive) {
        goldDisplay.parentElement.classList.add('shake');
        setTimeout(() => goldDisplay.parentElement.classList.remove('shake'), 300);
    }

    // РЈРґР°Р»СЏРµРј РїРѕСЃР»Рµ Р°РЅРёРјР°С†РёРё
    setTimeout(() => particle.remove(), 1000);
}

/**
 * РџРћР›РќРђРЇ РЎР‘РћР РљРђ Р”Р›РЇ РЎР§Р•РўРћР’РћР”Рђ (LOGIC)
 * Р’РєР»СЋС‡Р°РµС‚: logic_rules + rules_and_instructions + combat_rules + env_guide + items_ref + snapshot
 */
function buildDynamicContext(expiredEffects) {
    let echoMemoryString = '';
    if (player && player.echoMemory && player.echoMemory.items && player.echoMemory.items.length > 0) {
        const itemsList = player.echoMemory.items.map((item, idx) => `${idx+1}. ${item}`).join('\n');
        echoMemoryString = `\n### Р­РҐРћ-РџРђРњРЇРўР¬ (РљР›Р®Р§Р•Р’Р«Р• Р¤РђРљРўР«, РќРРљРћР“Р”Рђ РќР• Р—РђР‘Р«Р’РђР™):\n${itemsList}\n`;
    }
    const snapshot = buildFullPlayerSnapshot();
    const expiredText = expiredEffects && expiredEffects.length > 0 ? `Р’РќРРњРђРќРР•: РСЃС‚РµРєР»Рё СЌС„С„РµРєС‚С‹: ${expiredEffects.join(', ')}` : "";
    const errorText = (player && player.gmErrors && player.gmErrors.length > 0) ? `\n\n[РљР РРўРР§Р•РЎРљРђРЇ РЎРРЎРўР•РњРќРђРЇ РћРЁРР‘РљРђ РџР РћРЁР›РћР“Рћ РҐРћР”Рђ]\nРўС‹ РґРѕРїСѓСЃС‚РёР» РѕС€РёР±РєРё РІ JSON-РєРѕРјР°РЅРґР°С… РІ РїСЂРѕС€Р»РѕРј РѕС‚РІРµС‚Рµ:\n${player.gmErrors.join('\n')}\nРўР’РћР™ РђР‘РЎРћР›Р®РўРќР«Р™ РџР РРћР РРўР•Рў Р’ Р­РўРћРњ РҐРћР”РЈ: РРЎРџР РђР’РРўР¬ Р­РўР РћРЁРР‘РљР! Р’С‹Р·РѕРІРё РїСЂР°РІРёР»СЊРЅС‹Рµ РєРѕРјР°РЅРґС‹ СЃ РІРµСЂРЅС‹РјРё Р°СЂРіСѓРјРµРЅС‚Р°РјРё, РїСЂРµР¶РґРµ С‡РµРј РїСЂРѕРґРѕР»Р¶Р°С‚СЊ СЃСЋР¶РµС‚!` : "";
    const ghostText = (player && player.statusEffects && player.statusEffects['ghost_form']) ? "\n\n[SYSTEM CRITICAL: РР“Р РћРљ РњР•Р РўР’ (РџР РР—Р РђРљ Р’ РўР•РќР). РћРЅ РЅР°С…РѕРґРёС‚СЃСЏ РІ РёР·РЅР°РЅРєРµ РјРёСЂР°. РћРЅ РЅРµ РјРѕР¶РµС‚ РІР·Р°РёРјРѕРґРµР№СЃС‚РІРѕРІР°С‚СЊ СЃ Р¶РёРІС‹РјРё, Р±СЂР°С‚СЊ С„РёР·РёС‡РµСЃРєРёРµ РїСЂРµРґРјРµС‚С‹ РёР»Рё РїРѕР»СѓС‡Р°С‚СЊ С„РёР·РёС‡РµСЃРєРёР№ СѓСЂРѕРЅ. РћРЅ РґРѕР»Р¶РµРЅ РЅР°Р№С‚Рё Р­С„РёСЂРЅС‹Р№ Р Р°Р·Р»РѕРј (Aether Rift). РљРѕРіРґР° РѕРЅ РЅР°Р№РґРµС‚ РµРіРѕ Рё С€Р°РіРЅРµС‚ С‚СѓРґР°, РўР« РћР‘РЇР—РђРќ РРЎРџРћР›Р¬Р—РћР’РђРўР¬ РљРћРњРђРќР”РЈ removeStatusEffect РґР»СЏ 'ghost_form', РІС‹РґР°С‚СЊ РєРІРµСЃС‚ 'completed' Рё setLocation РґР»СЏ РІРѕР·РІСЂР°С‰РµРЅРёСЏ РµРіРѕ РІ СЂРµР°Р»СЊРЅС‹Р№ РјРёСЂ!]" : "";
    
    return `======================================================================\n=== Р”РРќРђРњРР§Р•РЎРљРР• Р”РђРќРќР«Р• (РР—РњР•РќРЇР®РўРЎРЇ РљРђР–Р”Р«Р™ РҐРћР”) ===\n======================================================================\n${echoMemoryString}\n${snapshot}\n${expiredText}\n${errorText}\n${ghostText}\n`;
}

function getPromptRuntimeConfig() {
  const defaults = {
    prompt_files: {
      logic_rules: 'assets/promts/logic_rules.txt',
      narrative_rules: 'assets/promts/narrative_rules.txt',
      master_instructions: 'assets/promts/1.txt',
      rules_and_instructions: 'assets/promts/rules_and_instructions.txt',
      combat_rules: 'assets/promts/combat_system_rules.txt',
      environment_commands_guide: 'assets/promts/environment_commands_guide.txt',
      skills_reference: 'assets/promts/skills_reference_prompt.txt',
      supreme_gm_style: 'assets/promts/supreme_gm_style.txt',
      nsfw_rules_advanced: 'assets/promts/nsfw_rules_advanced.txt'
    },
    image_generation: {
      prompt_field_template: '"image_prompt": "РћР‘РЇР—РђРўР•Р›Р¬РќРћ! РћРїРёСЃР°РЅРёРµ РўР•РљРЈР©Р•Р™ СЃС†РµРЅС‹ РЎРўР РћР“Рћ РќРђ РђРќР“Р›РР™РЎРљРћРњ РЇР—Р«РљР• РґР»СЏ РЅРµР№СЂРѕСЃРµС‚Рё РіРµРЅРµСЂР°С†РёРё РєР°СЂС‚РёРЅРѕРє. РџРёС€Рё С‚РµРіР°РјРё С‡РµСЂРµР· Р·Р°РїСЏС‚СѓСЋ. РЈРєР°Р¶Рё РїРµСЂСЃРѕРЅР°Р¶РµР№ Рё РґРµС‚Р°Р»Рё. РћР±СЏР·Р°С‚РµР»СЊРЅРѕ РґРѕР±Р°РІР»СЏР№ РІ РєРѕРЅС†Рµ: \'Ado music video aesthetic, monochrome anime style with one spot color, dark gothic, creepy vibe, extreme contrast, inverted colors, masterpiece, highly detailed\'.",',
      format_field_template: '"image_prompt": "РћРїРёСЃР°РЅРёРµ СЃС†РµРЅС‹ РЅР° РђРќР“Р›РР™РЎРљРћРњ СЏР·С‹РєРµ РґР»СЏ РіРµРЅРµСЂР°С‚РѕСЂР° РєР°СЂС‚РёРЅРѕРє (РћР‘РЇР—РђРўР•Р›Р¬РќРћ).",'
    },
    response_languages: { ru: 'Russian', en: 'English', default: 'English' },
    unified_response: {
      default_time_passed: { days: 0, hours: 0, minutes: 5 },
      suggested_action_template: { text: 'Р”РµР№СЃС‚РІРёРµ', roll_stat: null }
    },
    fallback_texts: {
      items_reference_error: 'DATABASE ERROR',
      missing_era_context: 'Р”Р°РЅРЅС‹Рµ РїРѕ СЌРїРѕС…Рµ РѕС‚СЃСѓС‚СЃС‚РІСѓСЋС‚.',
      critical_logic_error: 'Critical logic error'
    },
    injection_headers: {
      custom_commands: '// === РљРђРЎРўРћРњРќР«Р• РљРћРњРђРќР”Р« (РР— РњРћР”РћР’) ===',
      custom_world_rules: '// === РљРђРЎРўРћРњРќР«Р• РџР РђР’РР›Рђ РњРР Рђ (РР— РњРћР”РћР’) ==='
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
  const action = runtimeConfig.unified_response.suggested_action_template || { text: 'Р”РµР№СЃС‚РІРёРµ', roll_stat: null };
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
    console.log("[Cache] РЎРёСЃС‚РµРјРЅС‹Р№ РїСЂРѕРјРїС‚ СЃР±СЂРѕС€РµРЅ.");
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

### Р Р•Р•РЎРўР  РўР•РљРЈР©Р•Р™ Р­РџРћРҐР:
${eraContext}

### Р›РћР  РњРР Рђ:
${worldLore}

### РЎРџР РђР’РћР§РќРРљ РџР Р•Р”РњР•РўРћР’:
${itemsRefString}

### РЎРўРР›Р¬ РџРћР’Р•РЎРўР’РћР’РђРќРРЇ:
${style}

РЇР—Р«Рљ РћРўР’Р•РўРђ (РљР РРўРР§Р•РЎРљР Р’РђР–РќРћ): РЎРўР РћР“Рћ ${responseLanguage.toUpperCase()}! Р’РµСЃСЊ С‚РµРєСЃС‚ РІ РїРѕР»СЏС… "narrative", "director_notes" Рё "logic_summary" РћР‘РЇР—РђРќ Р±С‹С‚СЊ РЅР° СЌС‚РѕРј СЏР·С‹РєРµ. Р—Р°РїСЂРµС‰РµРЅРѕ РѕС‚РІРµС‡Р°С‚СЊ РЅР° РґСЂСѓРіРѕРј СЏР·С‹РєРµ!

### РРќРЎРўР РЈРљР¦РРЇ (Р•Р”РРќР«Р™ Р Р•Р–РРњ):
РўС‹ РґРѕР»Р¶РµРЅ РѕРґРЅРѕРІСЂРµРјРµРЅРЅРѕ РІС‹РїРѕР»РЅРёС‚СЊ Р»РѕРіРёС‡РµСЃРєРёРµ СЂР°СЃС‡РµС‚С‹ (РёР·РјРµРЅРёС‚СЊ СЃС‚Р°С‚С‹, РІС‹РґР°С‚СЊ Р»СѓС‚, РїСЂРѕРІРµСЃС‚Рё Р±РѕР№) Р РЅР°РїРёСЃР°С‚СЊ РєСЂР°СЃРёРІС‹Р№ С…СѓРґРѕР¶РµСЃС‚РІРµРЅРЅС‹Р№ РѕС‚РІРµС‚.
РўРІРѕР№ РѕС‚РІРµС‚ Р”РћР›Р–Р•Рќ Р‘Р«РўР¬ РЎРўР РћР“Рћ Р’РђР›РР”РќР«Рњ JSON.
Р¤РѕСЂРјР°С‚: { ${buildImagePromptFormatField(promptRuntime)} "time_passed": ${buildPromptTimePassed(promptRuntime)}, "suggested_actions": [ ${buildPromptSuggestedAction(promptRuntime)} ], "narrative": "РўРІРѕР№ С…СѓРґРѕР¶РµСЃС‚РІРµРЅРЅС‹Р№ С‚РµРєСЃС‚...", "actions": [ ...РјР°СЃСЃРёРІ РєРѕРјР°РЅРґ... ], "logic_summary": "РљСЂР°С‚РєР°СЏ СЃРІРѕРґРєР° С‚РІРѕРёС… СЂР°СЃС‡РµС‚РѕРІ (РѕРїС†РёРѕРЅР°Р»СЊРЅРѕ)" }

### Р’РђР–РќРћ: Р•СЃР»Рё РёРіСЂРѕРє РёСЃРїРѕР»СЊР·СѓРµС‚ С‚РµРіРё {d20}, {str} Рё С‚.Рґ. вЂ” РёРЅС‚РµСЂРїСЂРµС‚РёСЂСѓР№ РёС… РєР°Рє Р±СЂРѕСЃРєРё РєСѓР±РёРєРѕРІ Рё РІРєР»СЋС‡Р°Р№ СЂРµР·СѓР»СЊС‚Р°С‚ РІ РїРѕРІРµСЃС‚РІРѕРІР°РЅРёРµ.
${nsfwRules}`;

        // РРЅСЉРµРєС†РёСЏ РґРѕРєСѓРјРµРЅС‚Р°С†РёРё РєР°СЃС‚РѕРјРЅС‹С… РєРѕРјР°РЅРґ РёР· РјРѕРґРѕРІ
        if (window.ModAPI && window.ModAPI.commandDocs && window.ModAPI.commandDocs.length > 0) {
            finalPrompt += `\n\n${promptRuntime.injection_headers.custom_commands}\n` + window.ModAPI.commandDocs.join('\n');
        }

        // РРЅСЉРµРєС†РёСЏ РєР°СЃС‚РѕРјРЅС‹С… РїСЂР°РІРёР» Р»РѕСЂР°/Р»РѕРіРёРєРё РёР· РјРѕРґРѕРІ
        if (window.ModAPI && window.ModAPI.promptInjections && window.ModAPI.promptInjections.length > 0) {
            finalPrompt += `\n\n${promptRuntime.injection_headers.custom_world_rules}\n` + window.ModAPI.promptInjections.join('\n\n');
        }

        GLOBAL_CACHED_SYSTEM_PROMPT = finalPrompt;
        console.log("[Cache] РЎРёСЃС‚РµРјРЅС‹Р№ РїСЂРѕРјРїС‚ СѓСЃРїРµС€РЅРѕ СЃРѕР±СЂР°РЅ Рё Р·Р°РєСЌС€РёСЂРѕРІР°РЅ РІ РїР°РјСЏС‚Рё.");
        return finalPrompt;
    } catch (error) {
        console.error("Error in prepareUnifiedPrompt:", error);
        return getPromptRuntimeConfig().fallback_texts.critical_logic_error;
    }
}









/**
 * РџРћР›РќРђРЇ РЎР‘РћР РљРђ Р”Р›РЇ РџРћР­РўРђ (NARRATIVE)
 * Р’РєР»СЋС‡Р°РµС‚: narrative_rules + rules_and_instructions + skills_ref + lore + snapshot + logic_summary
 */





// --- РћР±СЂР°Р±РѕС‚РєР° РљРѕРјР°РЅРґ РѕС‚ Gemini ---
/**
 * РР·РІР»РµРєР°РµС‚ РєРѕРјР°РЅРґС‹ РёР· С‚РµРєСЃС‚Р° GM Рё СЂР°Р·РґРµР»СЏРµС‚ РёС… РЅР° РєРѕРјР°РЅРґСѓ Рё Р°СЂРіСѓРјРµРЅС‚С‹.
 * РСЃРїРѕР»СЊР·СѓРµС‚ СЃРїРµС†РёР°Р»СЊРЅСѓСЋ Р»РѕРіРёРєСѓ РґР»СЏ РєРѕРјР°РЅРґ, Сѓ РєРѕС‚РѕСЂС‹С… РїРѕСЃР»РµРґРЅРёР№ Р°СЂРіСѓРјРµРЅС‚ РјРѕР¶РµС‚ СЃРѕРґРµСЂР¶Р°С‚СЊ СЂР°Р·РґРµР»РёС‚РµР»Рё.
 * @param {string} text - РўРµРєСЃС‚ РѕС‚РІРµС‚Р° РѕС‚ Gemini.
 * @returns {{narrative: string, commands: Array<object>}} - РћР±СЉРµРєС‚ СЃ РЅР°СЂСЂР°С‚РёРІРѕРј Рё РјР°СЃСЃРёРІРѕРј РєРѕРјР°РЅРґ.
 */
function processCommands(text) {
    if (!text) return { narrative: "", commands: [] };

    let narrativeText = text;
    const commandsToExecute = [];
    const commandParserConfig = getPromptRuntimeConfig().command_parser; const commandStartTag = commandParserConfig.start_tag || '[COMMAND:'; const commandEndTag = commandParserConfig.end_tag || ']'; const delimiter = commandParserConfig.delimiter || '|:|';

    let startIndex = narrativeText.indexOf(commandStartTag);

    while (startIndex !== -1) {
        const endIndex = narrativeText.indexOf(commandEndTag, startIndex + commandStartTag.length);
        if (endIndex === -1) break;

        const fullMatch = narrativeText.substring(startIndex, endIndex + commandEndTag.length);
        const commandContent = fullMatch.substring(commandStartTag.length, fullMatch.length - commandEndTag.length);

        const firstColonIndex = commandContent.indexOf(':');
        if (firstColonIndex !== -1) {
            const command = commandContent.substring(0, firstColonIndex).trim();
            const argsString = commandContent.substring(firstColonIndex + 1);

            // *** РќРћР’Р«Р™ РЎРЈРџР•Р -РќРђР”Р•Р–РќР«Р™ РџРђР РЎР•Р  ***
            // 1. Р Р°Р·РґРµР»СЏРµРј СЃС‚СЂРѕРєСѓ РїРѕ РЅР°С€РµРјСѓ СЂР°Р·РґРµР»РёС‚РµР»СЋ
            // 2. РћР±СЂРµР·Р°РµРј РїСЂРѕР±РµР»С‹ Сѓ РєР°Р¶РґРѕРіРѕ Р°СЂРіСѓРјРµРЅС‚Р°
            // 3. Р¤РёР»СЊС‚СЂСѓРµРј РїСѓСЃС‚С‹Рµ СЌР»РµРјРµРЅС‚С‹, РєРѕС‚РѕСЂС‹Рµ РјРѕРіР»Рё РїРѕСЏРІРёС‚СЊСЃСЏ РёР·-Р·Р° РѕС€РёР±РѕРє GM (РЅР°РїСЂРёРјРµСЂ, `|:||:|`)
            const args = argsString.split(delimiter)
                .map(arg => arg.trim())
                .filter(arg => arg.length > 0);

            commandsToExecute.push({ command, args });
        }

        narrativeText = narrativeText.replace(fullMatch, '');
        startIndex = narrativeText.indexOf(commandStartTag);
    }

    return {
        narrative: narrativeText.trim(),
        commands: commandsToExecute
    };
}

/**
 * РћР±РЅРѕРІР»СЏРµС‚ РїР°РЅРµР»СЊ "РљРѕРЅСЃС‚Р°РЅС‚С‹" (Nexus), РєРѕСЂСЂРµРєС‚РЅРѕ РѕС‚РѕР±СЂР°Р¶Р°СЏ РёРµСЂР°СЂС…РёСЋ
 * РєР°С‚РµРіРѕСЂРёР№ Рё СЌР»РµРјРµРЅС‚РѕРІ.
 * Р­С‚Р° РІРµСЂСЃРёСЏ С„РёР»СЊС‚СЂСѓРµС‚ СЃР»СѓР¶РµР±РЅС‹Рµ СЌР»РµРјРµРЅС‚С‹, РєРѕС‚РѕСЂС‹Рµ РёСЃРїРѕР»СЊР·СѓСЋС‚СЃСЏ РґР»СЏ РѕРїСЂРµРґРµР»РµРЅРёСЏ
 * РєР°С‚РµРіРѕСЂРёРё (РЅР°РїСЂРёРјРµСЂ, СЌР»РµРјРµРЅС‚ СЃ name: "Р’Р»Р°РґРµРЅРёСЏ" Рё category: "Р’Р»Р°РґРµРЅРёСЏ"),
 * Рё РЅРµ РѕС‚РѕР±СЂР°Р¶Р°РµС‚ РёС… РєР°Рє РѕС‚РґРµР»СЊРЅС‹Рµ РїСѓРЅРєС‚С‹.
 */
/**
 * (РџРћР›РќРђРЇ РћР‘РќРћР’Р›Р•РќРќРђРЇ Р’Р•Р РЎРРЇ v2.0)
 * Р’С‹РїРѕР»РЅСЏРµС‚ РєРѕРјР°РЅРґСѓ, РїРѕР»СѓС‡РµРЅРЅСѓСЋ РѕС‚ GM РІ РІРёРґРµ СЃС‚СЂСѓРєС‚СѓСЂРёСЂРѕРІР°РЅРЅРѕРіРѕ РѕР±СЉРµРєС‚Р°.
 * РЎРѕС…СЂР°РЅСЏРµС‚ 100% С„СѓРЅРєС†РёРѕРЅР°Р»Р° РѕСЂРёРіРёРЅР°Р»СЊРЅРѕР№ РІРµСЂСЃРёРё, СЂР°Р±РѕС‚Р°РІС€РµР№ РЅР° СЃС‚СЂРѕРєР°С….
 * @param {string} command - РРјСЏ РєРѕРјР°РЅРґС‹ РІ С„РѕСЂРјР°С‚Рµ camelCase (РЅР°РїСЂРёРјРµСЂ, "addItem").
 * @param {object} args - РћР±СЉРµРєС‚ СЃ РёРјРµРЅРѕРІР°РЅРЅС‹РјРё Р°СЂРіСѓРјРµРЅС‚Р°РјРё РґР»СЏ РєРѕРјР°РЅРґС‹.
 * @returns {string|null} - РЎРѕРѕР±С‰РµРЅРёРµ РґР»СЏ Р»РѕРіР° РѕР±СЂР°С‚РЅРѕР№ СЃРІСЏР·Рё РёР»Рё null, РµСЃР»Рё РѕР±СЂР°С‚РЅР°СЏ СЃРІСЏР·СЊ РЅРµ С‚СЂРµР±СѓРµС‚СЃСЏ.
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
        addCalculationMessage(`[Р’Р Р•РњРЇ] РџСЂРѕС€Р»Рѕ: ${timeStrings.join(', ')}.`);
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
    // --- РРќРўР•Р“Р РђР¦РРЇ РњРћР”РћР’: Р’Р°Р»РёРґР°С†РёСЏ РєР°СЃС‚РѕРјРЅС‹С… РєРѕРјР°РЅРґ ---
    if (window.ModAPI && window.ModAPI.customCommands && window.ModAPI.customCommands[command]) {
        return { valid: true }; // РљР°СЃС‚РѕРјРЅС‹Рµ РєРѕРјР°РЅРґС‹ СЃС‡РёС‚Р°СЋС‚СЃСЏ РІР°Р»РёРґРЅС‹РјРё
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
            if (!testArgs.facilityType || !FACILITY_NAMES[testArgs.facilityType]) return { valid: false, error: `РќРµРёР·РІРµСЃС‚РЅС‹Р№ С‚РёРї РїСЂРµРґРїСЂРёСЏС‚РёСЏ '${testArgs.facilityType}'. Р”РѕРїСѓСЃС‚РёРјС‹Рµ: ${Object.keys(FACILITY_NAMES).join(', ')}` };
            if (!testArgs.name || testArgs.name.trim() === '') return { valid: false, error: "РРјСЏ РїСЂРµРґРїСЂРёСЏС‚РёСЏ РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ РїСѓСЃС‚С‹Рј." };
            break;
        case 'gmPurchaseGoods':
            if (!testArgs.factionId) return { valid: false, error: "РќРµ СѓРєР°Р·Р°РЅ factionId." };
            if (!testArgs.regionId) return { valid: false, error: "РќРµ СѓРєР°Р·Р°РЅ regionId." };
            if (!testArgs.goodType || !ECONOMY_ITEMS[testArgs.goodType]) return { valid: false, error: `РќРµРёР·РІРµСЃС‚РЅС‹Р№ С‚РёРї С‚РѕРІР°СЂР° '${testArgs.goodType}'.` };
            if (!testArgs.quantity || isNaN(parseInt(testArgs.quantity)) || parseInt(testArgs.quantity) <= 0) return { valid: false, error: "РљРѕР»РёС‡РµСЃС‚РІРѕ РґРѕР»Р¶РЅРѕ Р±С‹С‚СЊ РїРѕР»РѕР¶РёС‚РµР»СЊРЅС‹Рј С‡РёСЃР»РѕРј." };
            if (typeof World !== 'undefined' && World) {
                let r = World.regions[testArgs.regionId];
                if (!r) return { valid: false, error: `Р РµРіРёРѕРЅ '${testArgs.regionId}' РЅРµ РЅР°Р№РґРµРЅ.` };
                let price = r.markets[testArgs.goodType] ?? ECONOMY_ITEMS[testArgs.goodType].basePrice ?? requireRuntimeNumber(getGameplayRuntimeConfig().economy.min_price, 'gameplay_runtime.economy.min_price');
                let cost = price * testArgs.quantity;
                let gold = getFactionGold(testArgs.factionId);
                if (gold < cost) return { valid: false, error: `РЈ С„СЂР°РєС†РёРё '${testArgs.factionId}' РЅРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ Р·РѕР»РѕС‚Р°. РќСѓР¶РЅРѕ ${cost}, РµСЃС‚СЊ ${gold}.` };
                let stock = getRegionGoodStock(testArgs.regionId, testArgs.goodType);
                if (stock < testArgs.quantity) return { valid: false, error: `Р’ СЂРµРіРёРѕРЅРµ '${testArgs.regionId}' РЅРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ С‚РѕРІР°СЂР° '${testArgs.goodType}'. РќСѓР¶РЅРѕ ${testArgs.quantity}, РµСЃС‚СЊ ${stock}.` };
            }
            break;
        case 'gmSellGoods':
            if (!testArgs.factionId) return { valid: false, error: "РќРµ СѓРєР°Р·Р°РЅ factionId." };
            if (!testArgs.regionId) return { valid: false, error: "РќРµ СѓРєР°Р·Р°РЅ regionId." };
            if (!testArgs.goodType || !ECONOMY_ITEMS[testArgs.goodType]) return { valid: false, error: `РќРµРёР·РІРµСЃС‚РЅС‹Р№ С‚РёРї С‚РѕРІР°СЂР° '${testArgs.goodType}'.` };
            if (!testArgs.quantity || isNaN(parseInt(testArgs.quantity)) || parseInt(testArgs.quantity) <= 0) return { valid: false, error: "РљРѕР»РёС‡РµСЃС‚РІРѕ РґРѕР»Р¶РЅРѕ Р±С‹С‚СЊ РїРѕР»РѕР¶РёС‚РµР»СЊРЅС‹Рј С‡РёСЃР»РѕРј." };
            if (typeof World !== 'undefined' && World) {
                let stock = getFactionGoodStock(testArgs.factionId, testArgs.goodType);
                if (stock < testArgs.quantity) return { valid: false, error: `РЈ С„СЂР°РєС†РёРё '${testArgs.factionId}' РЅРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ С‚РѕРІР°СЂР° '${testArgs.goodType}' РґР»СЏ РїСЂРѕРґР°Р¶Рё. РќСѓР¶РЅРѕ ${testArgs.quantity}, РµСЃС‚СЊ ${stock}.` };
            }
            break;
        case 'gmInvestInFacility':
            if (!testArgs.factionId || !testArgs.regionId || !testArgs.facilityType || !testArgs.action) return { valid: false, error: "РћС‚СЃСѓС‚СЃС‚РІСѓСЋС‚ РѕР±СЏР·Р°С‚РµР»СЊРЅС‹Рµ Р°СЂРіСѓРјРµРЅС‚С‹." };
            if (typeof World !== 'undefined' && World) {
                let cost = testArgs.action === 'repair' ? 500 : 2000;
                let gold = getFactionGold(testArgs.factionId);
                if (gold < cost) return { valid: false, error: `РЈ С„СЂР°РєС†РёРё '${testArgs.factionId}' РЅРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ Р·РѕР»РѕС‚Р° РґР»СЏ РёРЅРІРµСЃС‚РёС†РёРё. РќСѓР¶РЅРѕ ${cost}, РµСЃС‚СЊ ${gold}.` };
            }
            break;
        case 'gmSpreadRumor':
            if (!testArgs.factionId || !testArgs.targetFactionId || !testArgs.type || testArgs.investmentGold === undefined) return { valid: false, error: "РћС‚СЃСѓС‚СЃС‚РІСѓСЋС‚ РѕР±СЏР·Р°С‚РµР»СЊРЅС‹Рµ Р°СЂРіСѓРјРµРЅС‚С‹." };
            if (typeof World !== 'undefined' && World) {
                let cost = parseInt(testArgs.investmentGold);
                let gold = getFactionGold(testArgs.factionId);
                if (gold < cost) return { valid: false, error: `РЈ С„СЂР°РєС†РёРё '${testArgs.factionId}' РЅРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ Р·РѕР»РѕС‚Р° РґР»СЏ СЃР»СѓС…РѕРІ. РќСѓР¶РЅРѕ ${cost}, РµСЃС‚СЊ ${gold}.` };
            }
            break;
        case 'gmFrameForSabotage':
            if (!testArgs.factionId || !testArgs.targetFactionId || !testArgs.regionId) return { valid: false, error: "РћС‚СЃСѓС‚СЃС‚РІСѓСЋС‚ РѕР±СЏР·Р°С‚РµР»СЊРЅС‹Рµ Р°СЂРіСѓРјРµРЅС‚С‹." };
            if (typeof World !== 'undefined' && World) {
                let gold = getFactionGold(testArgs.factionId);
                if (gold < 3000) return { valid: false, error: `РЈ С„СЂР°РєС†РёРё '${testArgs.factionId}' РЅРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ Р·РѕР»РѕС‚Р° РґР»СЏ СЃР°Р±РѕС‚Р°Р¶Р°. РќСѓР¶РЅРѕ 3000, РµСЃС‚СЊ ${gold}.` };
            }
            break;
        case 'gmDirectResourceInjection':
            if (!testArgs.regionId || !testArgs.goodType || !testArgs.quantity) return { valid: false, error: "РћС‚СЃСѓС‚СЃС‚РІСѓСЋС‚ РѕР±СЏР·Р°С‚РµР»СЊРЅС‹Рµ Р°СЂРіСѓРјРµРЅС‚С‹." };
            if (typeof World !== 'undefined' && World) {
                let currentDay = Math.floor((World.tick || 0) / 24);
                let lastDay = World.lastDirectInjectionDay || -999;
                if (currentDay - lastDay < 7) {
                    return { valid: false, error: `РљРѕРјР°РЅРґР° gmDirectResourceInjection РЅР° РєСѓР»РґР°СѓРЅРµ. РџСЂРѕС€Р»Рѕ ${currentDay - lastDay} РґРЅРµР№ РёР· 7 РЅРµРѕР±С…РѕРґРёРјС‹С….` };
                }
            }
            break;
        case 'gmDeclareWar':
            if (!testArgs.fromFactionId || !testArgs.toFactionId) return { valid: false, error: "РќРµ СѓРєР°Р·Р°РЅС‹ fromFactionId РёР»Рё toFactionId." };
            break;
        case 'gmForcePeace':
            if (!testArgs.factionId1 || !testArgs.factionId2) return { valid: false, error: "РќРµ СѓРєР°Р·Р°РЅС‹ factionId1 РёР»Рё factionId2." };
            break;
        case 'gmChangeRulerTrait':
            if (!testArgs.rulerId || !testArgs.trait || testArgs.value === undefined) return { valid: false, error: "РќРµ СѓРєР°Р·Р°РЅС‹ rulerId, trait РёР»Рё value." };
            const allowedTraits = ['ambition', 'paranoia', 'wisdom', 'cruelty', 'diplomacy', 'military', 'stewardship'];
            if (!allowedTraits.includes(testArgs.trait)) return { valid: false, error: `РќРµРёР·РІРµСЃС‚РЅР°СЏ С‡РµСЂС‚Р° '${testArgs.trait}'. Р”РѕРїСѓСЃС‚РёРјС‹Рµ: ${allowedTraits.join(', ')}` };
            break;

        case 'startIntrigue':
            if (!testArgs.id || !testArgs.type || !testArgs.initiator || !testArgs.target) return { valid: false, error: "РќРµ СѓРєР°Р·Р°РЅС‹ id, type, initiator РёР»Рё target." };
            const allowedIntrigues = ['assassination', 'sabotage', 'rebellion', 'bribery'];
            if (!allowedIntrigues.includes(testArgs.type)) return { valid: false, error: `РќРµРёР·РІРµСЃС‚РЅС‹Р№ С‚РёРї РёРЅС‚СЂРёРіРё '${testArgs.type}'. Р”РѕРїСѓСЃС‚РёРјС‹Рµ: ${allowedIntrigues.join(', ')}` };
            break;

        case 'startTravel':
            if (!testArgs.destinationId) return { valid: false, error: "РќРµ СѓРєР°Р·Р°РЅ destinationId." };
            let destExists = false;
            if (globalLocations && globalLocations[testArgs.destinationId]) destExists = true;
            if (player && player.mapMarkers && player.mapMarkers[testArgs.destinationId]) destExists = true;
            if (typeof World !== 'undefined' && World && World.subLocations && World.subLocations[testArgs.destinationId]) destExists = true;
            if (player && player.subLocations && player.subLocations[testArgs.destinationId]) destExists = true;
            if (!destExists) return { valid: false, error: `Р›РѕРєР°С†РёСЏ '${testArgs.destinationId}' РЅРµ РЅР°Р№РґРµРЅР° РЅР° РєР°СЂС‚Рµ. РСЃРїРѕР»СЊР·СѓР№ С‚РѕР»СЊРєРѕ СЃСѓС‰РµСЃС‚РІСѓСЋС‰РёРµ ID.` };
            break;
        case 'setPlayerDescription':
            if (!testArgs.text && !testArgs.description && !testArgs.bio && !testArgs.value && !testArgs.narrative && !testArgs.biography && !testArgs.background && !testArgs.history && !testArgs.lore) return { valid: false, error: "РќРµ СѓРєР°Р·Р°РЅ text РёР»Рё description." };
            break;
        case 'updateStat':
        case 'setStat':
            if (!testArgs.stat) return { valid: false, error: "РќРµ СѓРєР°Р·Р°РЅ stat." };
            const allowedStats = ['hp', 'mana', 'gold', 'statPoints', 'xp', 'str', 'dex', 'int', 'con', 'cha', 'res'];
            let baseStat = testArgs.stat.split('.')[0];
            if (!allowedStats.includes(baseStat) && baseStat !== 'reputation') {
                return { valid: false, error: `РР·РјРµРЅРµРЅРёРµ СЃС‚Р°С‚Р° '${testArgs.stat}' Р·Р°РїСЂРµС‰РµРЅРѕ. Р Р°Р·СЂРµС€РµРЅС‹: ${allowedStats.join(', ')}, reputation.*` };
            }
            break;
        case 'addEnvironment':
            if (!testArgs.id) return { valid: false, error: "РќРµ СѓРєР°Р·Р°РЅ id." };
            if (!testArgs.name) return { valid: false, error: "РќРµ СѓРєР°Р·Р°РЅРѕ РёРјСЏ (name)." };
            if (!testArgs.type || !['npc', 'creature', 'enemy'].includes(testArgs.type)) return { valid: false, error: "РўРёРї (type) РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ npc, creature РёР»Рё enemy." };
            break;
        case 'renderLocation':
            // CityGen СѓРґР°Р»РµРЅ. Р—Р°РіР»СѓС€РєР° РґР»СЏ РѕР±СЂР°С‚РЅРѕР№ СЃРѕРІРјРµСЃС‚РёРјРѕСЃС‚Рё.
            break;
    }
    return { valid: true };
}

function validateActionsArray(actions) {
    let errors = [];
    if (!Array.isArray(actions)) return ["РџРѕР»Рµ 'actions' РґРѕР»Р¶РЅРѕ Р±С‹С‚СЊ РјР°СЃСЃРёРІРѕРј."];
    for (let action of actions) {
        if (!action.command) continue;
        let val = validateGMCommand(action.command, action.args);
        if (!val.valid) errors.push(`РљРѕРјР°РЅРґР° '${action.command}': ${val.error}`);
    }
    return errors;
}


async function executeNonInventoryCommand(command, args) {
    if (!command) return null;
    if (!player) return t('gameInterface.commandFeedback.errorPlayerMissing');

    // --- РЎРўРђРќР”РђР РўРР—РђР¦РРЇ РђР Р“РЈРњР•РќРўРћР’ (Р‘Р РћРќРЇ РћРў Р”РЈР РђРљРђ) ---
    if (args && typeof args === 'object') {
        // 0. Р•СЃР»Рё РР РїСЂРёСЃР»Р°Р» entityKey РёР»Рё target РІРјРµСЃС‚Рѕ aiIdentifier
        if (args.entityKey !== undefined && args.aiIdentifier === undefined) {
            args.aiIdentifier = args.entityKey;
        }
        if (args.target !== undefined && args.aiIdentifier === undefined && args.target !== 'player') {
            args.aiIdentifier = args.target;
        }
        
        // 1. Р•СЃР»Рё РР РїСЂРёСЃР»Р°Р» СѓРЅРёРІРµСЂСЃР°Р»СЊРЅС‹Р№ 'id', РїСЂРѕРєРёРґС‹РІР°РµРј РµРіРѕ РІ СЃС‚Р°СЂС‹Рµ РїРµСЂРµРјРµРЅРЅС‹Рµ
        if (args.id !== undefined) {
            if (args.aiIdentifier === undefined) args.aiIdentifier = args.id;
            if (args.key === undefined) args.key = args.id;
            if (args.effectId === undefined) args.effectId = args.id;
        }
        // 2. Р•СЃР»Рё РР РїРѕ СЃС‚Р°СЂРѕР№ РїР°РјСЏС‚Рё РїСЂРёСЃР»Р°Р» СЃС‚Р°СЂС‹Р№ С„Р»Р°Рі, РїСЂРѕРєРёРґС‹РІР°РµРј РµРіРѕ РІ 'id'
        if (args.id === undefined) {
            args.id = args.aiIdentifier || args.key || args.effectId;
        }
        // 3. Р­РєСЃС‚СЂРµРЅРЅС‹Р№ С„РёРєСЃ РґР»СЏ РєРІРµСЃС‚РѕРІ (РµСЃР»Рё РР РїСЂРёСЃР»Р°Р» С‚РѕР»СЊРєРѕ title)
        if (command.toLowerCase().includes('quest') && args.id === undefined && args.title !== undefined) {
            args.id = args.title;
            args.aiIdentifier = args.title;
        }
    }

    console.log("Р’С‹РїРѕР»РЅРµРЅРёРµ РєРѕРјР°РЅРґС‹:", command, args);
    let feedback = null;

    try {
        switch (command) {

            // --- РћР‘Р©РР• РљРћРњРђРќР”Р« Р РЎРћРЎРўРћРЇРќРР• ---

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
                        feedback = `[ERROR] 'echoMemory' РїРѕР»СѓС‡РёР» РїСѓСЃС‚РѕР№ С‚РµРєСЃС‚.`;
                    }
                } else {
                    feedback = `[ERROR] 'echoMemory' С‚СЂРµР±СѓРµС‚ Р°СЂРіСѓРјРµРЅС‚ 'text' (string).`;
                }
                break;
            case 'clearEchoMemory':
                if (args.confirm === true || DEBUG_MODE) {
                    if (player.echoMemory) player.echoMemory.items = [];
                    feedback = t('gameInterface.commandFeedback.echoMemoryCleared');
                    updateEchoMemoryDisplay();

    updateDiceLogDisplay();
                } else {
                    feedback = `[ERROR] 'clearEchoMemory' С‚СЂРµР±СѓРµС‚ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ (confirm: true).`;
                }
                break;
            case 'removeEchoMemoryItem':
                if (player.echoMemory && player.echoMemory.items) {
                    if (args.index !== undefined && typeof args.index === 'number') {
                        if (player.echoMemory.items[args.index]) {
                            const removed = player.echoMemory.items.splice(args.index, 1);
                            feedback = t('gameInterface.commandFeedback.echoMemoryItemRemoved', { text: removed[0] });
                        } else {
                            feedback = `[ERROR] РРЅРґРµРєСЃ ${args.index} РІРЅРµ РґРёР°РїР°Р·РѕРЅР°.`;
                        }
                    } else if (args.contains && typeof args.contains === 'string') {
                        const idx = player.echoMemory.items.findIndex(item => item.includes(args.contains));
                        if (idx !== -1) {
                            const removed = player.echoMemory.items.splice(idx, 1);
                            feedback = t('gameInterface.commandFeedback.echoMemoryItemRemoved', { text: removed[0] });
                        } else {
                            feedback = `[ERROR] РўРµРєСЃС‚ '${args.contains}' РЅРµ РЅР°Р№РґРµРЅ РІ СЌС…Рѕ-РїР°РјСЏС‚Рё.`;
                        }
                    } else {
                        feedback = `[ERROR] 'removeEchoMemoryItem' С‚СЂРµР±СѓРµС‚ 'index' РёР»Рё 'contains'.`;
                    }
                    updateEchoMemoryDisplay();

    updateDiceLogDisplay();
                }
                break;

            case 'setPlayerDescription':
                let bioText = args.text || args.description || args.bio || args.value || args.narrative || args.biography || args.background || args.history || args.lore;
                if (bioText) {
                    player.description = bioText;
                    feedback = `[РЎРРЎРўР•РњРђ] РџСЂРµРґС‹СЃС‚РѕСЂРёСЏ РїРµСЂСЃРѕРЅР°Р¶Р° СѓСЃРїРµС€РЅРѕ СЃРіРµРЅРµСЂРёСЂРѕРІР°РЅР° Рё СЃРѕС…СЂР°РЅРµРЅР° РІ РїСЂРѕС„РёР»СЊ.`;
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'setPlayerDescription' С‚СЂРµР±СѓРµС‚ 'text' РёР»Рё 'description'. РџРѕР»СѓС‡РµРЅРѕ: ${JSON.stringify(args)}`;
                }
                break;

            case 'setMemory':
                if (args.key && args.text) {
                    if (!player.gmNotes) player.gmNotes = {};
                    player.gmNotes[args.key] = args.text;
                    console.log(`[Memory] Р‘Р»РѕРє '${args.key}' РѕР±РЅРѕРІР»РµРЅ.`);
                    updateGmNotesDisplay();
    updateWorldSimDebugDisplay();
                }
                break;
            case 'deleteMemory':
                if (args.key && player.gmNotes && player.gmNotes[args.key]) {
                    delete player.gmNotes[args.key];
                    console.log(`[Memory] Р‘Р»РѕРє '${args.key}' СѓРґР°Р»РµРЅ.`);
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
                        console.log(`[Memory] Р‘Р»РѕРє '${args.key}' Р·Р°Р°СЂС…РёРІРёСЂРѕРІР°РЅ.`);
                        updateGmNotesDisplay();
    updateWorldSimDebugDisplay();
                    }
                }
                break;

            case 'setLocation':
                let locId = args.id || args.aiIdentifier || args.locationName;
                let locName = args.locationName;
                let foundLoc = false;

                // --- РЈРњРќР«Р™ РџРћРРЎРљ РџРћР”Р›РћРљРђР¦РР™ (Рў3 Р¤РРљРЎ) ---
                // Р•СЃР»Рё Р“Рњ РїСЂРёСЃР»Р°Р» С‚РµРєСЃС‚ РІРјРµСЃС‚Рѕ ID (РЅР°РїСЂРёРјРµСЂ "РўР°РІРµСЂРЅР° 'Р’РµСЃРµР»С‹Р№ РњРѕРЅР°С…'"), РёС‰РµРј СЃРѕРІРїР°РґРµРЅРёРµ
                if (locId && typeof World !== 'undefined' && World && World.subLocations && !World.subLocations[locId]) {
                    const searchStr = String(locId).toLowerCase().trim();
                    for (let key in World.subLocations) {
                        const subName = World.subLocations[key].name.toLowerCase().trim();
                        // РС‰РµРј РїРµСЂРµРєСЂРµСЃС‚РЅРѕРµ РІС…РѕР¶РґРµРЅРёРµ СЃС‚СЂРѕРє
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
                        feedback = `[РћРЁРР‘РљРђ РЇР”Р Рђ] Р›РѕРєР°С†РёСЏ '${locName}' РЅРµ РЅР°Р№РґРµРЅР° РІ СЂРµРµСЃС‚СЂРµ РјРёСЂР°! Р—Р°РїСЂРµС‰РµРЅРѕ С‚РµР»РµРїРѕСЂС‚РёСЂРѕРІР°С‚СЊ РёРіСЂРѕРєР° РІ РІС‹РґСѓРјР°РЅРЅС‹Рµ РјРµСЃС‚Р° (РёРіСЂРѕРє СѓР»РµС‚РёС‚ РІ РѕРєРµР°РЅ). РЎРЅР°С‡Р°Р»Р° С„РёР·РёС‡РµСЃРєРё СЃРѕР·РґР°Р№С‚Рµ Р·РґР°РЅРёРµ С‡РµСЂРµР· addSubLocation РёР»Рё Р»РѕРєР°С†РёСЋ С‡РµСЂРµР· addMapMarker.`;
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
                    updateEnvironmentVisibility(); // РђРІС‚Рѕ-СЃРєСЂС‹С‚РёРµ/РїРѕРєР°Р· NPC
                    updateCharacterSheet();
                    updateMapDisplay();
                } else {
                    feedback = `[ERROR] 'setLocation' С‚СЂРµР±СѓРµС‚ РєРѕСЂСЂРµРєС‚РЅС‹Р№ 'id' РёР»Рё 'locationName'.`;
                }
                break;

            case 'gmDeclareWar':
            if (!testArgs.fromFactionId || !testArgs.toFactionId) return { valid: false, error: "РќРµ СѓРєР°Р·Р°РЅС‹ fromFactionId РёР»Рё toFactionId." };
            break;
        case 'gmForcePeace':
            if (!testArgs.factionId1 || !testArgs.factionId2) return { valid: false, error: "РќРµ СѓРєР°Р·Р°РЅС‹ factionId1 РёР»Рё factionId2." };
            break;
        case 'gmChangeRulerTrait':
            if (!testArgs.rulerId || !testArgs.trait || testArgs.value === undefined) return { valid: false, error: "РќРµ СѓРєР°Р·Р°РЅС‹ rulerId, trait РёР»Рё value." };
            const allowedTraits = ['ambition', 'paranoia', 'wisdom', 'cruelty', 'diplomacy', 'military', 'stewardship'];
            if (!allowedTraits.includes(testArgs.trait)) return { valid: false, error: `РќРµРёР·РІРµСЃС‚РЅР°СЏ С‡РµСЂС‚Р° '${testArgs.trait}'. Р”РѕРїСѓСЃС‚РёРјС‹Рµ: ${allowedTraits.join(', ')}` };
            break;

        case 'startIntrigue':
            if (!testArgs.id || !testArgs.type || !testArgs.initiator || !testArgs.target) return { valid: false, error: "РќРµ СѓРєР°Р·Р°РЅС‹ id, type, initiator РёР»Рё target." };
            const allowedIntrigues = ['assassination', 'sabotage', 'rebellion', 'bribery'];
            if (!allowedIntrigues.includes(testArgs.type)) return { valid: false, error: `РќРµРёР·РІРµСЃС‚РЅС‹Р№ С‚РёРї РёРЅС‚СЂРёРіРё '${testArgs.type}'. Р”РѕРїСѓСЃС‚РёРјС‹Рµ: ${allowedIntrigues.join(', ')}` };
            break;

        case 'startTravel':
                if (args.destinationId) {
                    LivingRoads.start(args.destinationId);
                    feedback = `[РЎРРЎРўР•РњРђ] РџСѓС‚РµС€РµСЃС‚РІРёРµ РёРЅРёС†РёРёСЂРѕРІР°РЅРѕ.`;
                } else {
                    feedback = `[ERROR] 'startTravel' С‚СЂРµР±СѓРµС‚ 'destinationId'.`;
                }
                break;
            case 'pauseTravel':
                LivingRoads.pause("gm_intervention");
                feedback = `[РЎРРЎРўР•РњРђ] РџСѓС‚РµС€РµСЃС‚РІРёРµ РїСЂРёРѕСЃС‚Р°РЅРѕРІР»РµРЅРѕ РњР°СЃС‚РµСЂРѕРј.`;
                break;
            case 'resumeTravel':
                LivingRoads.resume();
                feedback = `[РЎРРЎРўР•РњРђ] РџСѓС‚РµС€РµСЃС‚РІРёРµ РІРѕР·РѕР±РЅРѕРІР»РµРЅРѕ.`;
                break;
            case 'cancelTravel':
                if (player.currentJourney && player.currentJourney.currentLocation) {
                    // Р•СЃР»Рё GM СѓСЃС‚Р°РЅРѕРІРёР» РїСЂРѕРјРµР¶СѓС‚РѕС‡РЅСѓСЋ Р»РѕРєР°С†РёСЋ, РѕСЃС‚Р°С‘РјСЃСЏ РІ РЅРµР№
                    executeCommand('setLocation', { locationName: player.currentJourney.currentLocation });
                    feedback = `[РЎРРЎРўР•РњРђ] РџСѓС‚РµС€РµСЃС‚РІРёРµ РѕС‚РјРµРЅРµРЅРѕ. Р’С‹ РѕСЃС‚Р°С‘С‚РµСЃСЊ РІ: ${player.location}.`;
                    player.currentJourney = null;
                } else {
                    // РРЅР°С‡Рµ РІРѕР·РІСЂР°С‰Р°РµРјСЃСЏ РІ С‚РѕС‡РєСѓ СЃС‚Р°СЂС‚Р° (СЃС‚Р°СЂРѕРµ РїРѕРІРµРґРµРЅРёРµ)
                    feedback = `[РЎРРЎРўР•РњРђ] РџСѓС‚РµС€РµСЃС‚РІРёРµ РѕС‚РјРµРЅРµРЅРѕ. Р’С‹ РІРµСЂРЅСѓР»РёСЃСЊ РІ С‚РѕС‡РєСѓ СЃС‚Р°СЂС‚Р°.`;
                }
                LivingRoads.cancel();
                break;
            case 'fastForwardTravel':
                LivingRoads.fastForward();
                feedback = `[РЎРРЎРўР•РњРђ] РџСѓС‚РµС€РµСЃС‚РІРёРµ СѓСЃРєРѕСЂРµРЅРѕ.`;
                break;


            case 'startJourney':
                if (!args.destination) {
                    feedback = `[ERROR] 'startJourney' РїСЂРѕРІР°Р»РµРЅР°: РЅРµС‚ 'destination'.`;
                } else if (!args.events || !Array.isArray(args.events) || args.events.length === 0) {
                    feedback = `[ERROR] 'startJourney' РїСЂРѕРІР°Р»РµРЅР°: РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚ РјР°СЃСЃРёРІ 'events'. РўС‹ РѕР±СЏР·Р°РЅ СЃРіРµРЅРµСЂРёСЂРѕРІР°С‚СЊ С‚РѕС‡РєРё РїСѓС‚Рё!`;
                } else {
                    let valid = true;
                    for (let i = 0; i < args.events.length; i++) {
                        if (!args.events[i].options || args.events[i].options.length < 2) {
                            valid = false;
                            feedback = `[ERROR] 'startJourney' РїСЂРѕРІР°Р»РµРЅР°: РІ С‚РѕС‡РєРµ ${i + 1} РЅРµС‚ РјР°СЃСЃРёРІР° 'options' (РјРёРЅРёРјСѓРј 2 РІР°СЂРёР°РЅС‚Р°).`;
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
                            currentLocation: null  // РџСЂРѕРјРµР¶СѓС‚РѕС‡РЅР°СЏ Р»РѕРєР°С†РёСЏ РґР»СЏ СЃРѕР±С‹С‚РёР№ РІРѕ РІСЂРµРјСЏ РїСѓС‚РµС€РµСЃС‚РІРёСЏ
                        };
                        feedback = `[РЎРРЎРўР•РњРђ] РќР°С‡Р°С‚Рѕ РїСѓС‚РµС€РµСЃС‚РІРёРµ РІ ${destName}.`;
                        updateCharacterSheet();
                        setTimeout(() => { if (window.advanceJourney) window.advanceJourney(); }, 1500);
                    }
                }
                break;

            case 'endJourney':
            if (player.currentJourney) {
                // Р•СЃР»Рё РµСЃС‚СЊ РїСЂРѕРјРµР¶СѓС‚РѕС‡РЅР°СЏ Р»РѕРєР°С†РёСЏ, РѕСЃС‚Р°С‘РјСЃСЏ РІ РЅРµР№, РёРЅР°С‡Рµ РёРґС‘Рј РІ destination
                const finalLocation = player.currentJourney.currentLocation ||
                                     player.currentJourney.destinationId ||
                                     player.currentJourney.destination;
                executeCommand('setLocation', { locationName: finalLocation });
                feedback = `[РЎРРЎРўР•РњРђ] РџСѓС‚РµС€РµСЃС‚РІРёРµ Р·Р°РІРµСЂС€РµРЅРѕ. Р’С‹ РЅР°С…РѕРґРёС‚РµСЃСЊ РІ: ${player.location}.`;
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
                    // РќРµРјРµРґР»РµРЅРЅРѕ РѕР±РЅРѕРІР»СЏРµРј player.location РґР»СЏ РєРѕСЂСЂРµРєС‚РЅРѕРіРѕ РѕС‚РѕР±СЂР°Р¶РµРЅРёСЏ
                    executeCommand('setLocation', { locationName: locId });
                    feedback = `[РЎРРЎРўР•РњРђ РџРЈРўР•РЁР•РЎРўР’РРЇ] РўРµРєСѓС‰Р°СЏ Р»РѕРєР°С†РёСЏ РЅР° РјР°СЂС€СЂСѓС‚Рµ СѓСЃС‚Р°РЅРѕРІР»РµРЅР°: ${locId}`;
                } else {
                    feedback = `[ERROR] 'setJourneyLocation' С‚СЂРµР±СѓРµС‚ 'locationId' РёР»Рё 'locationName'.`;
                }
            } else {
                feedback = `[ERROR] 'setJourneyLocation' РјРѕР¶РЅРѕ РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ С‚РѕР»СЊРєРѕ РІРѕ РІСЂРµРјСЏ Р°РєС‚РёРІРЅРѕРіРѕ РїСѓС‚РµС€РµСЃС‚РІРёСЏ.`;
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
                    feedback = `[DEBUG] Р¤СЂР°РєС†РёСЏ '${args.key}' РѕРїСЂРµРґРµР»РµРЅР° РєР°Рє '${args.name}'.`;
                    addCalculationMessage(feedback);
                } else {
                    feedback = `[ERROR] 'defineFaction' С‚СЂРµР±СѓРµС‚ 'key' Рё 'name'.`;
                }
                break;

            // --- РџР•Р РЎРћРќРђР– ---

            case 'updateStat':
                // Р”РµР»Р°РµРј РїР°СЂСЃРµСЂ СѓРјРЅРµРµ: РїРѕРЅРёРјР°РµРј change, value, amount Рё РїРµСЂРµРІРѕРґРёРј СЃС‚СЂРѕРєРё РІ С‡РёСЃР»Р°
                let changeVal = args.change !== undefined ? args.change : (args.value !== undefined ? args.value : args.amount);
                changeVal = parseInt(changeVal, 10);

                if (args.stat && !isNaN(changeVal)) {
                    const stat = args.stat;
                    const change = changeVal;

                    // --- РЎРРќРҐР РћРќРР—РђР¦РРЇ Р¤РР—РР§Р•РЎРљРћР“Рћ Р—РћР›РћРўРђ ---
                    if (stat === 'gold') {
                        if (change > 0) {
                            const addRes = await executeCommand('addItem', { aiIdentifier: 'gold', name: 'Р—РѕР»РѕС‚Рѕ', quantity: change });
                            if (addRes && addRes.includes("[РћРЁРР‘РљРђ")) {
                                feedback = addRes; // РџСЂРѕР±СЂР°СЃС‹РІР°РµРј РѕС€РёР±РєСѓ РїРµСЂРµРіСЂСѓР·Р°
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
                    
                    // Рў3 Р¤РРљРЎ: РЎРёСЃС‚РµРјРЅС‹Р№ Р·Р°РїСЂРµС‚ РЅР° РїСЂСЏРјРѕРµ РёСЃС†РµР»РµРЅРёРµ РёРіСЂРѕРєР° С‡РµСЂРµР· updateStat
                    if (stat === 'hp' && change > 0) {
                        console.error("[System] GM attempted direct healing via updateStat. Action blocked.");
                        addCalculationMessage("[РћРЁРР‘РљРђ РЇР”Р Рђ] РџСЂСЏРјРѕРµ РёСЃС†РµР»РµРЅРёРµ С‡РµСЂРµР· updateStat Р·Р°РїСЂРµС‰РµРЅРѕ. РСЃРїРѕР»СЊР·СѓР№С‚Рµ СЃС‚Р°С‚СѓСЃ-СЌС„С„РµРєС‚С‹!");
                        change = 0;
                    }

                    currentStatObject[finalStatName] = oldValue + change;

                    if (stat === 'hp') {
                        player.stats.hp = Math.max(0, Math.min(player.stats.hp, player.stats.maxHp || 0));
                        feedback = t('gameInterface.commandFeedback.hpChanged', { change: change > 0 ? `+${change}` : change, hp: player.stats.hp, maxHp: player.stats.maxHp || 0 });
                        if (player.stats.hp <= player.stats.maxHp * 0.2) {
                            executeCommand('echoMemory', { text: `вљ пёЏ РљСЂРёС‚РёС‡РµСЃРєРѕРµ Р·РґРѕСЂРѕРІСЊРµ! (${player.stats.hp}/${player.stats.maxHp})` });
                        }
                    } else if (stat.startsWith('reputation.')) {
                        feedback = t('gameInterface.commandFeedback.reputationChanged', { change: change > 0 ? `+${change}` : change, reputation: currentStatObject[finalStatName] });
                        if (Math.abs(change) >= 20) {
                            executeCommand('echoMemory', { text: `Р РµРїСѓС‚Р°С†РёСЏ СЂРµР·РєРѕ РёР·РјРµРЅРёР»Р°СЃСЊ РЅР° ${change > 0 ? '+'+change : change} (С‚РµРїРµСЂСЊ: ${currentStatObject[finalStatName]})` });
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
                    feedback = `[ERROR] 'updateStat' С‚СЂРµР±СѓРµС‚ 'stat' (string) Рё 'change' (number).`;
                }
                break;

            case 'setStat':
                if (args.stat && typeof args.value === 'number') {
                    const { stat, value } = args;

                    // --- РЎРРќРҐР РћРќРР—РђР¦РРЇ Р¤РР—РР§Р•РЎРљРћР“Рћ Р—РћР›РћРўРђ ---
                    if (stat === 'gold') {
                        let currentGold = syncPlayerGoldFromInventory();
                        let diff = value - currentGold;
                        if (diff > 0) {
                            const addRes = await executeCommand('addItem', { aiIdentifier: 'gold', name: 'Р—РѕР»РѕС‚Рѕ', quantity: diff });
                            if (addRes && addRes.includes("[РћРЁРР‘РљРђ")) {
                                feedback = addRes;
                                break;
                            }
                        }
                        else if (diff < 0) await executeCommand(getInventoryCommandName('remove_item'), { aiIdentifier: getPrimaryCurrencyPrototypeId('gold'), quantity: Math.abs(diff) });
                        feedback = `Р—РѕР»РѕС‚Рѕ СѓСЃС‚Р°РЅРѕРІР»РµРЅРѕ РЅР° ${value}.`;
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
                    feedback = `[ERROR] 'setStat' С‚СЂРµР±СѓРµС‚ 'stat' (string) Рё 'value' (number).`;
                }
                break;

            // --- РРќР’Р•РќРўРђР Р¬ ---
                        case 'addItem':
                if (args.aiIdentifier && args.name) {
                    const aiId = String(args.aiIdentifier);
                    const name = String(args.name);
                    const quantity = (args.quantity !== undefined && !isNaN(parseInt(args.quantity))) ? parseInt(args.quantity) : 1;
                    const targetContId = resolveSpecialContainerId(args.containerId || player.container_backpack);
                    
                    if (!ContainerRegistry.has(targetContId)) {
                        feedback = `[ERROR] РљРѕРЅС‚РµР№РЅРµСЂ ${targetContId} РЅРµ РЅР°Р№РґРµРЅ.`;
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
                        // Рў3 Р¤РРљРЎ: РџСЂРѕРІРµСЂРєР° РІРµСЃР°
                    const currentWeight = CoreInventorySystemAsync.getContainerWeight(targetContId);
                    let itemWeight = 1.0;
                    if (isCurrencyAiIdentifier(aiId)) {
                        itemWeight = 0.01;
                    } else if (typeof ECONOMY_ITEMS !== 'undefined' && ECONOMY_ITEMS[aiId]) {
                        itemWeight = 1.0;
                    }
                    const addedWeight = quantity * itemWeight;

                    if (cont.owner_id !== 'player' && currentWeight + addedWeight > cont.max_weight_kg) {
                        feedback = `[РћРЁРР‘РљРђ РЇР”Р Рђ] РљРѕРЅС‚РµР№РЅРµСЂ РїРµСЂРµРіСЂСѓР¶РµРЅ! Р›РёРјРёС‚: ${cont.max_weight_kg} РєРі. РќРµРІРѕР·РјРѕР¶РЅРѕ РґРѕР±Р°РІРёС‚СЊ ${quantity} С€С‚. '${name}' (Р’РµСЃ: ${addedWeight.toFixed(2)} РєРі). РСЃРїРѕР»СЊР·СѓР№С‚Рµ Р±Р°РЅРє, СЃСѓРЅРґСѓРєРё РёР»Рё РїРѕРІРѕР·РєСѓ!`;
                        break;
                    }

                    if (getContainerItems(cont).length >= cont.max_slots) {
                            feedback = t('gameInterface.commandFeedback.inventoryFull', { itemName: name });
                        } else {
                            const customProps = {
                                name: name,
                                description: args.description || t('itemDescriptions.noDescription'),
                                rarity: args.rarity || 'РћР±С‹С‡РЅС‹Р№',
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
                    feedback = `[ERROR] 'addItem' С‚СЂРµР±СѓРµС‚ 'aiIdentifier' Рё 'name'.`;
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
                    feedback = `[ERROR] 'removeItem' С‚СЂРµР±СѓРµС‚ 'itemId' РёР»Рё 'aiIdentifier'.`;
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
                        feedback = `[РЎРРЎРўР•РњРђ] Р—Р°РјРѕРє РєРѕРЅС‚РµР№РЅРµСЂР° ${args.containerId} РѕР±РЅРѕРІР»РµРЅ.`;
                    } else {
                        feedback = `[ERROR] РљРѕРЅС‚РµР№РЅРµСЂ РЅРµ РЅР°Р№РґРµРЅ.`;
                    }
                } else {
                    feedback = `[ERROR] 'lockContainer' С‚СЂРµР±СѓРµС‚ 'containerId'.`;
                }
                break;

            // --- РљР’Р•РЎРўР« ---

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
                        executeCommand('echoMemory', { text: `[РљРІРµСЃС‚] ${args.title}: ${args.objective}` });
                    } else {
                        feedback = t('gameInterface.commandFeedback.questAlreadyActive', { description: existingQuest.title });
                    }
                } else {
                    feedback = `[ERROR] 'addQuest' С‚СЂРµР±СѓРµС‚ 'aiIdentifier' Рё 'title'.`;
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

                    // Рў3 Р¤РРљРЎ: РЈР»СѓС‡С€РµРЅРЅС‹Р№ РїРѕРёСЃРє РєРІРµСЃС‚Р° (Fuzzy Search)
                    if (!questKey) {
                        // Р•СЃР»Рё РЅРµ РЅР°С€Р»Рё РїРѕ ID, РёС‰РµРј РєРІРµСЃС‚, РІ Р·Р°РіРѕР»РѕРІРєРµ РєРѕС‚РѕСЂРѕРіРѕ Р•РЎРўР¬ РёСЃРєРѕРјР°СЏ С„СЂР°Р·Р°
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
                                    feedback = t('gameInterface.commandFeedback.questStatusUpdated', { description: quest.title, status: statusLocalized }) + ` РџРѕР»СѓС‡РµРЅРѕ ${xpReward} XP.`;
                                    generateWorldNews(`Р“РµСЂРѕР№ ${player.name} СѓСЃРїРµС€РЅРѕ Р·Р°РІРµСЂС€РёР» Р·Р°РґР°РЅРёРµ: "${quest.title}".`, player.location || "global", 2, 'misc');
                                } else {
                                    feedback = t('gameInterface.commandFeedback.questStatusUpdated', { description: quest.title, status: statusLocalized });
                                }
                            } else {
                                feedback = t('gameInterface.commandFeedback.questSameStatus', { description: quest.title });
                            }
                            updateQuestList();
                        } else {
                            feedback = `[ERROR] РќРµРІРµСЂРЅС‹Р№ СЃС‚Р°С‚СѓСЃ РґР»СЏ 'updateQuest': ${args.status}.`;
                        }
                    } else {
                        feedback = t('gameInterface.commandFeedback.questNotFound', { questId: uqId });
                    }
                } else {
                    feedback = `[ERROR] 'updateQuest' С‚СЂРµР±СѓРµС‚ 'aiIdentifier' (РёР»Рё 'title') Рё 'status'.`;
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

                        // --- РРЎРџР РђР’Р›Р•РќРР• ---
                        // Р’РјРµСЃС‚Рѕ РїРѕР»РЅРѕРіРѕ СѓРґР°Р»РµРЅРёСЏ, РјС‹ РјРµРЅСЏРµРј СЃС‚Р°С‚СѓСЃ РЅР° "failed".
                        // Р­С‚Рѕ РіР°СЂР°РЅС‚РёСЂРѕРІР°РЅРЅРѕ СѓР±РµСЂРµС‚ РµРіРѕ РёР· СЃРїРёСЃРєР°, С‚Р°Рє РєР°Рє СЌС‚Р° Р»РѕРіРёРєР° СѓР¶Рµ СЂР°Р±РѕС‚Р°РµС‚.
                        quest.status = 'failed';
                        // -------------------

                        feedback = t('gameInterface.commandFeedback.questRemoved', { description: title });
                        updateQuestList(); // Р­С‚Р° С„СѓРЅРєС†РёСЏ С‚РµРїРµСЂСЊ РєРѕСЂСЂРµРєС‚РЅРѕ РѕС‚СЂР°Р±РѕС‚Р°РµС‚ РёР·РјРµРЅРµРЅРёРµ СЃС‚Р°С‚СѓСЃР°
                    } else {
                        feedback = t('gameInterface.commandFeedback.questNotFoundForRemoval', { questId: rqId });
                    }
                } else {
                    feedback = `[ERROR] 'removeQuest' С‚СЂРµР±СѓРµС‚ 'aiIdentifier' (РёР»Рё 'title').`;
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
                            feedback = `[ERROR] РќРµРІРµСЂРЅРѕРµ РїРѕР»Рµ РґР»СЏ 'editQuest': ${args.field}.`;
                        }
                    } else {
                        feedback = t('gameInterface.commandFeedback.questNotFound', { questId: eqId });
                    }
                } else {
                    feedback = `[ERROR] 'editQuest' С‚СЂРµР±СѓРµС‚ 'aiIdentifier' (РёР»Рё 'title'), 'field', Рё 'value'.`;
                }
                break;

            // --- РЈРњР•РќРРЇ ---

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
                    feedback = `[ERROR] 'addSkill' С‚СЂРµР±СѓРµС‚ 'id' Рё 'name'.`;
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
                    feedback = `[ERROR] 'removeSkill' С‚СЂРµР±СѓРµС‚ 'id'.`;
                }
                break;

            // --- РљРђР РўРђ ---

            case 'addDiscoveredLocation': // РЎС‚Р°СЂРѕРµ РЅР°Р·РІР°РЅРёРµ, СЃРѕС…СЂР°РЅСЏРµРј РґР»СЏ СЃРѕРІРјРµСЃС‚РёРјРѕСЃС‚Рё РїСЂРѕРјРїС‚Р°
            case 'addMapMarker':
                // РџСЂРёРЅСѓРґРёС‚РµР»СЊРЅРѕ РїСЂРµРІСЂР°С‰Р°РµРј РєРѕРѕСЂРґРёРЅР°С‚С‹ РІ С‡РёСЃР»Р°, РґР°Р¶Рµ РµСЃР»Рё РР РїСЂРёСЃР»Р°Р» СЃС‚СЂРѕРєРё
                const safeX = Number(args.x);
                const safeY = Number(args.y);
                if (args.id && args.name && !isNaN(safeX) && !isNaN(safeY)) {
                    if (!player.mapMarkers) player.mapMarkers = {};

                    let newX = safeX;
                    let newY = safeY;

                    // РђРќРўР-Р”РЈР‘Р›РРљРђРў: РџСЂРѕРІРµСЂСЏРµРј, РЅРµС‚ Р»Рё СѓР¶Рµ С‚Р°РєРѕР№ Р»РѕРєР°С†РёРё
                    const searchName = String(args.name).toLowerCase().trim();
                    const existsGlobal = Object.values(globalLocations || {}).some(l => l.name && l.name.toLowerCase().trim() === searchName);
                    const existsCustom = Object.values(player.mapMarkers || {}).some(l => l.name && l.name.toLowerCase().trim() === searchName);
                    const existsRegion = (typeof World !== 'undefined' && World && World.regions) ? Object.values(World.regions).some(r => r.name && r.name.toLowerCase().trim() === searchName) : false;
                    
                    if (existsGlobal || existsCustom || existsRegion) {
                        feedback = `[РЎРРЎРўР•РњРђ РљРђР РўР«] РћС‚РєР°Р·: Р›РѕРєР°С†РёСЏ '${args.name}' СѓР¶Рµ СЃСѓС‰РµСЃС‚РІСѓРµС‚ РЅР° РєР°СЂС‚Рµ. Р”СѓР±Р»РёРєР°С‚ РїСЂРѕРёРіРЅРѕСЂРёСЂРѕРІР°РЅ.`;
                        break;
                    }


                    // РђРќРўР-РљР›РђРЎРўР•Р : Р•СЃР»Рё РР РїСЂРёСЃР»Р°Р» (0,0) РёР»Рё РєРѕРѕСЂРґРёРЅР°С‚С‹ РІРЅРµ РєР°СЂС‚С‹, 
                    // РїСЂРёРІСЏР·С‹РІР°РµРј РјР°СЂРєРµСЂ Рє С‚РµРєСѓС‰РµР№ Р»РѕРєР°С†РёРё РёРіСЂРѕРєР°.
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
                    const MIN_DISTANCE = 45; // РЈРІРµР»РёС‡РµРЅРѕ СЂР°СЃСЃС‚РѕСЏРЅРёРµ РѕС‚С‚Р°Р»РєРёРІР°РЅРёСЏ РјРµС‚РѕРє РґСЂСѓРі РѕС‚ РґСЂСѓРіР°

                    // --- [РќРђР§РђР›Рћ РќРћР’РћР™ Р›РћР“РРљР] - РџСЂРѕРІРµСЂРєР° РєРѕР»Р»РёР·РёР№ ---
                    let collisionDetected = false;
                    let attempts = 0;
                    const MAX_ATTEMPTS = 50; // Р§С‚РѕР±С‹ РёР·Р±РµР¶Р°С‚СЊ Р±РµСЃРєРѕРЅРµС‡РЅРѕРіРѕ С†РёРєР»Р°

                    // РЎРѕР±РёСЂР°РµРј РІСЃРµ СЃСѓС‰РµСЃС‚РІСѓСЋС‰РёРµ С‚РѕС‡РєРё РЅР° РєР°СЂС‚Рµ
                    const allPoints = [
                        ...Object.values(globalLocations || {}),
                        ...Object.values(player.mapMarkers || {})
                    ].filter(p => p.id !== args.id); // РСЃРєР»СЋС‡Р°РµРј СЃР°РјСѓ СЃРµР±СЏ, РµСЃР»Рё СЌС‚Рѕ РѕР±РЅРѕРІР»РµРЅРёРµ

                    do {
                        collisionDetected = false;
                        for (const point of allPoints) {
                            if (typeof point.x === 'number' && typeof point.y === 'number') {
                                // Р Р°СЃСЃС‡РёС‚С‹РІР°РµРј СЂР°СЃСЃС‚РѕСЏРЅРёРµ РјРµР¶РґСѓ РЅРѕРІРѕР№ С‚РѕС‡РєРѕР№ Рё СЃСѓС‰РµСЃС‚РІСѓСЋС‰РµР№
                                const distance = Math.hypot(newX - point.x, newY - point.y);

                                if (distance < MIN_DISTANCE) {
                                    collisionDetected = true;
                                    // Р•СЃР»Рё РЅР°С€Р»Рё РєРѕР»Р»РёР·РёСЋ, СЃРґРІРёРіР°РµРј РЅРѕРІСѓСЋ С‚РѕС‡РєСѓ РІ СЃР»СѓС‡Р°Р№РЅРѕРј РЅР°РїСЂР°РІР»РµРЅРёРё РїРѕ СЃРїРёСЂР°Р»Рё
                                    const angle = Math.random() * 2 * Math.PI;
                                    newX += Math.cos(angle) * (MIN_DISTANCE * 0.75);
                                    newY += Math.sin(angle) * (MIN_DISTANCE * 0.75);
                                    attempts++;
                                    break; // РќР°С‡РёРЅР°РµРј РїСЂРѕРІРµСЂРєСѓ Р·Р°РЅРѕРІРѕ СЃ РЅРѕРІС‹РјРё РєРѕРѕСЂРґРёРЅР°С‚Р°РјРё
                                }
                            }
                        }
                    } while (collisionDetected && attempts < MAX_ATTEMPTS);

                    if (attempts > 0) {
                        console.log(`[Map Collision] РћР±РЅР°СЂСѓР¶РµРЅРѕ РЅР°Р»РѕР¶РµРЅРёРµ РјРµС‚РѕРє. РќРѕРІР°СЏ РјРµС‚РєР° '${args.name}' Р±С‹Р»Р° СЃРґРІРёРЅСѓС‚Р° РёР· (${args.x},${args.y}) РІ (${Math.round(newX)},${Math.round(newY)}).`);
                    }
                    // --- [РљРћРќР•Р¦ РќРћР’РћР™ Р›РћР“РРљР] ---

                    const isUpdate = !!player.mapMarkers[args.id];
                    player.mapMarkers[args.id] = {
                        id: args.id,
                        name: args.name,
                        description: args.description || '',
                        x: newX, // РСЃРїРѕР»СЊР·СѓРµРј РЅРѕРІС‹Рµ, СЃРєРѕСЂСЂРµРєС‚РёСЂРѕРІР°РЅРЅС‹Рµ РєРѕРѕСЂРґРёРЅР°С‚С‹
                        y: newY  // РСЃРїРѕР»СЊР·СѓРµРј РЅРѕРІС‹Рµ, СЃРєРѕСЂСЂРµРєС‚РёСЂРѕРІР°РЅРЅС‹Рµ РєРѕРѕСЂРґРёРЅР°С‚С‹
                    };

                    feedback = isUpdate
                        ? t('gameInterface.commandFeedback.mapMarkerUpdated', { markerName: args.name })
                        : t('gameInterface.commandFeedback.mapMarkerAdded', { markerName: args.name });
                    updateMapDisplay();
                } else {
                    feedback = `[ERROR] 'addMapMarker' С‚СЂРµР±СѓРµС‚ 'id', 'name', 'x' (number), Рё 'y' (number).`;
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
                    feedback = `[ERROR] 'removeMapMarker' С‚СЂРµР±СѓРµС‚ 'id'.`;
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
                    feedback = `[РЎРРЎРўР•РњРђ РљРђР РўР«] РћС‚РєСЂС‹С‚Р° РїРѕРґР»РѕРєР°С†РёСЏ '${args.name}' (Р’РЅСѓС‚СЂРё: ${args.parentId}).`;
                    updateMapDisplay();
                } else {
                    feedback = `[ERROR] 'addSubLocation' С‚СЂРµР±СѓРµС‚ 'id', 'name' Рё 'parentId'.`;
                }
                break;

            case 'removeSubLocation':
                if (args.id && player.subLocations && player.subLocations[args.id]) {
                    const subName = player.subLocations[args.id].name;
                    delete player.subLocations[args.id];
                    feedback = `[РЎРРЎРўР•РњРђ РљРђР РўР«] РџРѕРґР»РѕРєР°С†РёСЏ '${subName}' СѓРґР°Р»РµРЅР°.`;
                    updateMapDisplay();
                } else {
                    feedback = `[ERROR] РџРѕРґР»РѕРєР°С†РёСЏ '${args.id}' РЅРµ РЅР°Р№РґРµРЅР°.`;
                }
                break;



            // --- Р­РљРћРќРћРњРРљРђ РР“Р РћРљРђ (Р‘РђРќРљР Р Р’Р›РђР”Р•РќРРЇ) ---
            case 'buildBusiness':
                if (args.facilityType && args.name) {
                    let playerRegionId = null;
                    let pLoc = player.location.toLowerCase().trim();

                    // 1. РџСЂСЏРјРѕР№ РЅРµС‡РµС‚РєРёР№ РїРѕРёСЃРє РїРѕ СЂРµРіРёРѕРЅР°Рј
                    for (let rId in World.regions) {
                        let rName = World.regions[rId].name.toLowerCase();
                        if (pLoc.includes(rName) || rName.includes(pLoc) || pLoc === rId.toLowerCase()) {
                            playerRegionId = rId; break;
                        }
                    }

                    // 2. РџРѕРёСЃРє С‡РµСЂРµР· РїРѕРґР»РѕРєР°С†РёРё (РґРµСЂРµРІРЅРё, С‚Р°РІРµСЂРЅС‹)
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
                        feedback = `[РћРЁРР‘РљРђ] РќРµРІРѕР·РјРѕР¶РЅРѕ РїРѕСЃС‚СЂРѕРёС‚СЊ Р±РёР·РЅРµСЃ. Р›РѕРєР°С†РёСЏ '${player.location}' вЂ” СЌС‚Рѕ РґРёРєР°СЏ РјРµСЃС‚РЅРѕСЃС‚СЊ Р±РµР· СЌРєРѕРЅРѕРјРёРєРё. Р‘РёР·РЅРµСЃ РјРѕР¶РЅРѕ СЃС‚СЂРѕРёС‚СЊ С‚РѕР»СЊРєРѕ РІ РјР°РєСЂРѕ-СЂРµРіРёРѕРЅР°С…: ${availRegs}. РСЃРїРѕР»СЊР·СѓР№ setLocation, С‡С‚РѕР±С‹ РїРµСЂРµРјРµСЃС‚РёС‚СЊ РёРіСЂРѕРєР° РІ РіРѕСЂРѕРґ, РёР»Рё РѕС‚РєР°Р¶Рё РµРјСѓ РІ РїРѕСЃС‚СЂРѕР№РєРµ.`;
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
                                        addLogMessage(`[РЎРРЎРўР•РњРђ] РљРѕРЅС‚СЂР°РєС‚ РїРѕРґРїРёСЃР°РЅ! РЎС‚СЂРѕРёС‚РµР»СЊСЃС‚РІРѕ РїСЂРµРґРїСЂРёСЏС‚РёСЏ '${args.name}' РЅР°С‡Р°С‚Рѕ. Р­С‚Рѕ Р·Р°Р№РјРµС‚ 14 РёРіСЂРѕРІС‹С… РґРЅРµР№.`, "command-feedback");
                                        generateWorldNews(`Р“РµСЂРѕР№ ${player.name} РЅР°С‡Р°Р» СЃС‚СЂРѕРёС‚РµР»СЊСЃС‚РІРѕ РїСЂРµРґРїСЂРёСЏС‚РёСЏ '${args.name}' РІ СЂРµРіРёРѕРЅРµ ${World.regions[playerRegionId]?.name || playerRegionId}.`, playerRegionId, 3, 'business');
                                        showCustomAlert(`РЎС‚СЂРѕРёС‚РµР»СЊСЃС‚РІРѕ РЅР°С‡Р°С‚Рѕ! РЎР»РµРґРёС‚Рµ Р·Р° РїСЂРѕРіСЂРµСЃСЃРѕРј РІ РїР°РЅРµР»Рё 'Р’Р»Р°РґРµРЅРёСЏ'. РџСЂРµРґРїСЂРёСЏС‚РёРµ РЅР°С‡РЅРµС‚ СЂР°Р±РѕС‚Сѓ С‚РѕР»СЊРєРѕ РїРѕСЃР»Рµ Р·Р°РІРµСЂС€РµРЅРёСЏ СЃС‚СЂРѕР№РєРё.`);
                                    } else {
                                        addLogMessage(`[РћРЁРР‘РљРђ] РЎР±РѕР№ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРё РјРёСЂР° РїРѕСЃР»Рµ РїРѕСЃС‚СЂРѕР№РєРё.`, "system-message");
                                    }
                                } else {
                                    addLogMessage(`[РћРЁРР‘РљРђ Р”Р’РР–РљРђ] ${response.message || 'РќРµРёР·РІРµСЃС‚РЅР°СЏ РѕС€РёР±РєР° РїСЂРё СЃРѕР·РґР°РЅРёРё Р±РёР·РЅРµСЃР°.'}`, "system-message");
                                }
                            } catch (err) {
                                addLogMessage(`[РљР РРўРР§Р•РЎРљРђРЇ РћРЁРР‘РљРђ] РЎР±РѕР№ UI РїСЂРё РїРѕСЃС‚СЂРѕР№РєРµ: ${err.message}`, "system-message");
                                console.error("Business creation UI error:", err);
                            }
                        }).catch(err => {
                            addLogMessage(`[РљР РРўРР§Р•РЎРљРђРЇ РћРЁРР‘РљРђ] РЎР±РѕР№ IPC РїСЂРё РїРѕСЃС‚СЂРѕР№РєРµ: ${err.message}`, "system-message");
                            console.error("Business creation IPC error:", err);
                        });
                        feedback = `[РЎРўР РћРРўР•Р›Р¬РЎРўР’Рћ] Р—Р°РїСЂРѕСЃ РЅР° РїРѕСЃС‚СЂРѕР№РєСѓ '${args.name}' РѕС‚РїСЂР°РІР»РµРЅ РёРЅР¶РµРЅРµСЂР°Рј. РћР¶РёРґР°РЅРёРµ РѕС‚РІРµС‚Р° РѕС‚ СЏРґСЂР°...`;
                    }
                } else {
                    feedback = `[ERROR] 'buildBusiness' С‚СЂРµР±СѓРµС‚ 'facilityType' Рё 'name'.`;
                }
                break;

            case 'buyHolding':
                if (args.id && args.name && args.baseProfit) {
                    if (!player.holdings) player.holdings = {};
                    player.holdings[args.id] = {
                        id: args.id, name: args.name, description: args.description || '',
                        region: args.region || player.location, baseProfit: args.baseProfit
                    };
                    feedback = `[Р­РєРѕРЅРѕРјРёРєР°] РџСЂРёРѕР±СЂРµС‚РµРЅРѕ РІР»Р°РґРµРЅРёРµ: ${args.name}. РћР¶РёРґР°РµРјС‹Р№ РґРѕС…РѕРґ: ${args.baseProfit} Р·/РґРµРЅСЊ.`;
                    generateWorldNews(`Р“РµСЂРѕР№ ${player.name} РїСЂРёРѕР±СЂРµР» РІР»Р°РґРµРЅРёРµ: ${args.name}.`, player.location || "global", 2, 'economy');
                    updateHoldingsDisplay();
                } else {
                    feedback = `[ERROR] 'buyHolding' С‚СЂРµР±СѓРµС‚ 'id', 'name', 'baseProfit'.`;
                }
                break;

            case 'sellHolding':
                if (args.id && player.holdings && player.holdings[args.id]) {
                    let hName = player.holdings[args.id].name;
                    delete player.holdings[args.id];
                    feedback = `[Р­РєРѕРЅРѕРјРёРєР°] Р’Р»Р°РґРµРЅРёРµ РїСЂРѕРґР°РЅРѕ: ${hName}.`;
                    updateHoldingsDisplay();
                } else {
                    feedback = `[ERROR] Р’Р»Р°РґРµРЅРёРµ '${args.id}' РЅРµ РЅР°Р№РґРµРЅРѕ.`;
                }
                break;

            case 'bankTransaction':
                if (!player.bankAccount) player.bankAccount = { deposit: 0, loan: 0, loanDays: 0 };
                let amount = parseInt(args.amount, 10);
                if (isNaN(amount) || amount <= 0) {
                    feedback = `[ERROR] РќРµРІРµСЂРЅР°СЏ СЃСѓРјРјР° РґР»СЏ С‚СЂР°РЅР·Р°РєС†РёРё.`;
                    break;
                }
                if (args.type === 'deposit') {
                    if (player.stats.gold >= amount) {
                        player.stats.gold -= amount;
                        player.bankAccount.deposit += amount;
                        feedback = `[Р‘Р°РЅРє] Р’РЅРµСЃРµРЅРѕ ${amount} Р·. РќР° СЃС‡РµС‚Сѓ: ${player.bankAccount.deposit} Р·.`;
                    } else feedback = `[ERROR] РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ Р·РѕР»РѕС‚Р° РґР»СЏ РґРµРїРѕР·РёС‚Р°.`;
                } else if (args.type === 'withdraw') {
                    if (player.bankAccount.deposit >= amount) {
                        player.bankAccount.deposit -= amount;
                        player.stats.gold += amount;
                        feedback = `[Р‘Р°РЅРє] РЎРЅСЏС‚Рѕ ${amount} Р·. РќР° СЃС‡РµС‚Сѓ: ${player.bankAccount.deposit} Р·.`;
                    } else feedback = `[ERROR] РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ Р·РѕР»РѕС‚Р° РЅР° СЃС‡РµС‚Сѓ.`;
                } else if (args.type === 'loan') {
                    player.bankAccount.loan += amount;
                    player.stats.gold += amount;
                    player.bankAccount.loanDays = args.days ?? requireRuntimeNumber((getGameplayCommandDefaults().bank_loan || {}).default_days, 'gameplay_runtime.command_defaults.bank_loan.default_days');
                    feedback = `[Р‘Р°РЅРє] Р’Р·СЏС‚ РєСЂРµРґРёС‚ ${amount} Р·. РЎСЂРѕРє: ${player.bankAccount.loanDays} РґРЅ.`;
                } else if (args.type === 'repay') {
                    if (player.stats.gold >= amount) {
                        let actualRepay = Math.min(amount, player.bankAccount.loan);
                        player.stats.gold -= actualRepay;
                        player.bankAccount.loan -= actualRepay;
                        feedback = `[Р‘Р°РЅРє] РџРѕРіР°С€РµРЅРѕ ${actualRepay} Р·. РћСЃС‚Р°С‚РѕРє РґРѕР»РіР°: ${player.bankAccount.loan} Р·.`;
                    } else feedback = `[ERROR] РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ Р·РѕР»РѕС‚Р° РґР»СЏ РїРѕРіР°С€РµРЅРёСЏ.`;
                } else {
                    feedback = `[ERROR] РќРµРёР·РІРµСЃС‚РЅС‹Р№ С‚РёРї С‚СЂР°РЅР·Р°РєС†РёРё: ${args.type}`;
                }
                updateCharacterSheet();
                updateHoldingsDisplay();
                break;


            // --- РљРћРќРЎРўРђРќРўР« (NEXUS) ---

            case 'nexusDefine':
                let dType = args.displayType || 'text'; // Р—Р°С‰РёС‚Р° РѕС‚ РѕС€РёР±РѕРє РР
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
                    feedback = `[ERROR] 'nexusDefine' С‚СЂРµР±СѓРµС‚ 'id', 'name', 'category', 'value'.`;
                }
                break;

            case 'nexusUpdate':
                if (args.id && args.value !== undefined) {
                                        // РРќРўР•Р“Р РђР¦РРЇ РЎ РРќРўР РР“РђРњР (РЈСЃРєРѕСЂРµРЅРёРµ РїСЂРѕРіСЂРµСЃСЃР° С‡РµСЂРµР· Nexus)
                    if (args.id.includes("_progress") && typeof World !== 'undefined' && World.intrigues) {
                        let intrId = args.id.replace("_progress", "");
                        let intr = World.intrigues.find(i => i.id === intrId);
                        if (intr) {
                            intr.progress = parseInt(args.value, 10);
                            feedback = `[РРЅС‚СЂРёРіР°] РџСЂРѕРіСЂРµСЃСЃ Р·Р°РіРѕРІРѕСЂР° '${intrId}' РїСЂРёРЅСѓРґРёС‚РµР»СЊРЅРѕ СѓСЃС‚Р°РЅРѕРІР»РµРЅ РЅР° ${intr.progress}.`;
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
                        feedback = `[ERROR] РљРѕРЅСЃС‚Р°РЅС‚Р° Nexus '${args.id}' РЅРµ РЅР°Р№РґРµРЅР°.`;
                    }
                } else {
                    feedback = `[ERROR] 'nexusUpdate' С‚СЂРµР±СѓРµС‚ 'id' Рё 'value'.`;
                }
                break;

            case 'nexusRemove':
                if (args.id) {
                                        // РРќРўР•Р“Р РђР¦РРЇ РЎ РРќРўР РР“РђРњР (РЈСЃРєРѕСЂРµРЅРёРµ РїСЂРѕРіСЂРµСЃСЃР° С‡РµСЂРµР· Nexus)
                    if (args.id.includes("_progress") && typeof World !== 'undefined' && World.intrigues) {
                        let intrId = args.id.replace("_progress", "");
                        let intr = World.intrigues.find(i => i.id === intrId);
                        if (intr) {
                            intr.progress = parseInt(args.value, 10);
                            feedback = `[РРЅС‚СЂРёРіР°] РџСЂРѕРіСЂРµСЃСЃ Р·Р°РіРѕРІРѕСЂР° '${intrId}' РїСЂРёРЅСѓРґРёС‚РµР»СЊРЅРѕ СѓСЃС‚Р°РЅРѕРІР»РµРЅ РЅР° ${intr.progress}.`;
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
                        feedback = `[ERROR] РљРѕРЅСЃС‚Р°РЅС‚Р° Nexus '${args.id}' РЅРµ РЅР°Р№РґРµРЅР° РґР»СЏ СѓРґР°Р»РµРЅРёСЏ.`;
                    }
                } else {
                    feedback = `[ERROR] 'nexusRemove' С‚СЂРµР±СѓРµС‚ 'id'.`;
                }
                break;

            case 'repairFacility':
                if (args.regionId && args.facilityType) {
                    let region = World.regions[args.regionId];
                    let fac = region.facilities[args.facilityType];
                    if (fac && fac.durability < 100) {
                        fac.durability = 100;
                        feedback = `[Р РµРјРѕРЅС‚] ${args.facilityType} РІ ${region.name} РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅР°.`;
                    } else {
                        feedback = `[Р РµРјРѕРЅС‚] Р—РґР°РЅРёРµ РЅРµ С‚СЂРµР±СѓРµС‚ СЂРµРјРѕРЅС‚Р°.`;
                    }
                }
                break;

            case 'repairFacility':
                if (args.regionId && args.facilityType) {
                    let region = World.regions[args.regionId];
                    let fac = region.facilities[args.facilityType];
                    if (fac && fac.durability < 100) {
                        fac.durability = 100;
                        feedback = `[Р РµРјРѕРЅС‚] ${args.facilityType} РІ ${region.name} РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅР°.`;
                    } else {
                        feedback = `[Р РµРјРѕРЅС‚] Р—РґР°РЅРёРµ РЅРµ С‚СЂРµР±СѓРµС‚ СЂРµРјРѕРЅС‚Р°.`;
                    }
                }
                break;

            // --- РЎРўРђРўРЈРЎ-Р­Р¤Р¤Р•РљРўР« ---

            case 'applyPredefinedEffect':
                if (args.target === 'player' && args.effectId && typeof args.duration === 'number') {
                    const predefinedEffect = predefinedStatusEffects[args.effectId.toLowerCase()]; // РС‰РµРј РІ РЅРёР¶РЅРµРј СЂРµРіРёСЃС‚СЂРµ РґР»СЏ РЅР°РґРµР¶РЅРѕСЃС‚Рё

                    if (predefinedEffect) {
                        // Р•СЃР»Рё СЌС„С„РµРєС‚ РќРђР™Р”Р•Рќ РІ РЅР°С€РµРј СЃРїРёСЃРєРµ, СЃРѕР·РґР°РµРј РµРіРѕ РєР»РѕРЅ
                        const newEffectInstance = structuredClone(predefinedEffect);
                        // Р РІС‹Р·С‹РІР°РµРј РѕСЃРЅРѕРІРЅСѓСЋ РєРѕРјР°РЅРґСѓ addStatusEffect, РїРµСЂРµРґР°РІР°СЏ РІСЃРµ РґР°РЅРЅС‹Рµ РёР· РЅР°С€РµРіРѕ С€Р°Р±Р»РѕРЅР°
                        // Р­С‚Рѕ С†РµРЅС‚СЂР°Р»РёР·СѓРµС‚ Р»РѕРіРёРєСѓ СЃРѕР·РґР°РЅРёСЏ СЌС„С„РµРєС‚РѕРІ
                        executeCommand('addStatusEffect', {
                            target: 'player',
                            id: args.effectId, // РСЃРїРѕР»СЊР·СѓРµРј РѕСЂРёРіРёРЅР°Р»СЊРЅС‹Р№ ID, РєРѕС‚РѕСЂС‹Р№ РїСЂРёСЃР»Р°Р» GM
                            name: newEffectInstance.name,
                            duration: args.duration,
                            description: newEffectInstance.description,
                            effectsJSON: newEffectInstance.effectsJSON
                        });
                        // РЇРІРЅС‹Р№ С„РёРґР±СЌРє РЅРµ РЅСѓР¶РµРЅ, С‚.Рє. РµРіРѕ РґР°СЃС‚ РІР»РѕР¶РµРЅРЅР°СЏ РєРѕРјР°РЅРґР° addStatusEffect
                    } else {
                        // --- [РљР›Р®Р§Р•Р’РћР• РРЎРџР РђР’Р›Р•РќРР•] ---
                        // Р•СЃР»Рё СЌС„С„РµРєС‚ РќР• РќРђР™Р”Р•Рќ, РјС‹ Р±РѕР»СЊС€Рµ РЅРµ РІС‹РґР°РµРј РѕС€РёР±РєСѓ.
                        // РњС‹ Р»РѕРіРёСЂСѓРµРј СЌС‚Рѕ РґР»СЏ РѕС‚Р»Р°РґРєРё Рё РґР°РµРј GM РїРѕРґСЃРєР°Р·РєСѓ.
                        feedback = `[INFO] GM РїРѕРїС‹С‚Р°Р»СЃСЏ РїСЂРёРјРµРЅРёС‚СЊ РЅРµРѕРїСЂРµРґРµР»РµРЅРЅС‹Р№ СЌС„С„РµРєС‚ '${args.effectId}'. Р”Р»СЏ СЃРѕР·РґР°РЅРёСЏ СѓРЅРёРєР°Р»СЊРЅС‹С… СЌС„С„РµРєС‚РѕРІ СЃР»РµРґСѓРµС‚ РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ РєРѕРјР°РЅРґСѓ 'addStatusEffect' СЃРѕ РІСЃРµРјРё РїР°СЂР°РјРµС‚СЂР°РјРё.`;
                        console.warn(feedback);
                    }
                } else {
                    feedback = `[ERROR] 'applyPredefinedEffect' С‚СЂРµР±СѓРµС‚ 'target', 'effectId', Рё 'duration'.`;
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
                        console.error(`РћС€РёР±РєР° СЂР°Р·Р±РѕСЂР° effectsJSON РґР»СЏ СЌС„С„РµРєС‚Р° '${args.id}':`, e, args.effectsJSON);
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
                    feedback = `[ERROR] 'addStatusEffect' С‚СЂРµР±СѓРµС‚ 'target', 'id', 'name', 'duration', 'description'.`;
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
                    feedback = `[ERROR] 'removeStatusEffect' С‚СЂРµР±СѓРµС‚ 'target' Рё 'id'.`;
                }
                break;

            case 'applyConsequence':
                if (!args.type) {
                    feedback = `[ERROR] 'applyConsequence' С‚СЂРµР±СѓРµС‚ 'type' (pregnancy/disease/reputation).`;
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
                        feedback = `[ERROR] РќРµРёР·РІРµСЃС‚РЅС‹Р№ С‚РёРї РїРѕСЃР»РµРґСЃС‚РІРёСЏ: ${args.type}`;
                }
                break;

            case 'updateRelationship':
                if (!args.npcId || !args.stat) {
                    feedback = `[ERROR] 'updateRelationship' С‚СЂРµР±СѓРµС‚ 'npcId' Рё 'stat' (affection/attraction/trust/intimacy).`;
                    break;
                }

                const npcForRel = player.allKnownEntities[args.npcId];
                if (!npcForRel) {
                    feedback = `[ERROR] NPC СЃ ID '${args.npcId}' РЅРµ РЅР°Р№РґРµРЅ.`;
                    break;
                }

                // РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ relationships РµСЃР»Рё РЅРµС‚
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

                // РћРіСЂР°РЅРёС‡РµРЅРёСЏ РїРѕ РґРёР°РїР°Р·РѕРЅСѓ
                if (stat === 'affection') {
                    newValue = Math.max(-100, Math.min(100, newValue));
                } else {
                    newValue = Math.max(0, Math.min(100, newValue));
                }

                npcForRel.relationships.player[stat] = newValue;
                updateEnvironmentVisibility();

                feedback = `РћС‚РЅРѕС€РµРЅРёСЏ СЃ ${npcForRel.name}: ${stat} ${oldValue} в†’ ${newValue} (${change >= 0 ? '+' : ''}${change})`;
                break;

            case 'recordIntimacy':
                if (!args.npcId) {
                    feedback = `[ERROR] 'recordIntimacy' С‚СЂРµР±СѓРµС‚ 'npcId'.`;
                    break;
                }

                const npcForIntimacy = player.allKnownEntities[args.npcId];
                if (!npcForIntimacy) {
                    feedback = `[ERROR] NPC СЃ ID '${args.npcId}' РЅРµ РЅР°Р№РґРµРЅ.`;
                    break;
                }

                // РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ relationships РµСЃР»Рё РЅРµС‚
                if (!npcForIntimacy.relationships) {
                    npcForIntimacy.relationships = {
                        player: { affection: 0, attraction: 0, trust: 0, intimacy: 0, sexualHistory: [] }
                    };
                }
                if (!npcForIntimacy.relationships.player) {
                    npcForIntimacy.relationships.player = { affection: 0, attraction: 0, trust: 0, intimacy: 0, sexualHistory: [] };
                }

                // Р”РѕР±Р°РІР»СЏРµРј Р·Р°РїРёСЃСЊ РІ РёСЃС‚РѕСЂРёСЋ
                const intimacyRecord = {
                    day: player.gameTime ? player.gameTime.day : 1,
                    location: args.location || player.location || 'РќРµРёР·РІРµСЃС‚РЅРѕ',
                    type: args.type || 'consensual',
                    timestamp: Date.now()
                };

                npcForIntimacy.relationships.player.sexualHistory.push(intimacyRecord);

                // РЈРІРµР»РёС‡РёРІР°РµРј intimacy
                const intimacyIncrease = 20;
                npcForIntimacy.relationships.player.intimacy = Math.min(100, (npcForIntimacy.relationships.player.intimacy || 0) + intimacyIncrease);

                updateEnvironmentVisibility();

                feedback = `Р—Р°РїРёСЃР°РЅР° РёРЅС‚РёРјРЅР°СЏ СЃС†РµРЅР° СЃ ${npcForIntimacy.name} (${args.type || 'consensual'}). Intimacy: +${intimacyIncrease}`;
                break;

            case 'recordEroticScene':
                const sceneText = args.narrative || window.lastGeneratedNarrative;
                if (!sceneText) {
                    feedback = `[ERROR] 'recordEroticScene' РЅРµ СЃРјРѕРіР»Р° РїРѕР»СѓС‡РёС‚СЊ С‚РµРєСЃС‚ СЃС†РµРЅС‹.`;
                    break;
                }

                // РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ Р¶СѓСЂРЅР°Р»Р° РµСЃР»Рё РЅРµС‚
                if (!player.eroticJournal) {
                    player.eroticJournal = [];
                }

                // Р“РµРЅРµСЂР°С†РёСЏ СѓРЅРёРєР°Р»СЊРЅРѕРіРѕ ID
                const sceneId = `scene_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                // РЎРѕР·РґР°РЅРёРµ Р·Р°РїРёСЃРё
                const sceneRecord = {
                    id: sceneId,
                    day: player.gameTime ? player.gameTime.day : 1,
                    location: args.location || player.location || 'РќРµРёР·РІРµСЃС‚РЅРѕ',
                    partner: args.partnerName || 'РќРµРёР·РІРµСЃС‚РЅС‹Р№ РїР°СЂС‚РЅС‘СЂ',
                    partnerId: args.partnerId || null,
                    type: args.type || 'consensual',
                    intensity: eroticIntensityLevel,
                    narrative: sceneText,
                    timestamp: Date.now()
                };

                player.eroticJournal.push(sceneRecord);
                
                // --- РЎРўРђРўРРЎРўРРљРђ ---
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

                feedback = `РЎС†РµРЅР° Р·Р°РїРёСЃР°РЅР° РІ РёРЅС‚РёРјРЅС‹Р№ РґРЅРµРІРЅРёРє (${sceneRecord.partner}, Р”РµРЅСЊ ${sceneRecord.day}).`;
                break;

            case 'giveItem': {
                const rawId = args.itemId || args.aiIdentifier || args.id;
                const targetId = args.targetId || args.npcId;
                const quantity = (args.quantity !== undefined && !isNaN(parseInt(args.quantity))) ? parseInt(args.quantity, 10) : -1;

                if (!rawId || !targetId) {
                    feedback = `[ERROR] 'giveItem' С‚СЂРµР±СѓРµС‚ 'itemId' Рё 'targetId'.`;
                    break;
                }

                const searchTerm = String(rawId).toLowerCase().trim();
                const backpack = ContainerRegistry.get(player.container_backpack);
                
                if (!backpack) {
                    feedback = `[ERROR] Р СЋРєР·Р°Рє РёРіСЂРѕРєР° РЅРµ РЅР°Р№РґРµРЅ.`;
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
                        feedback = `[ERROR] NPC СЃ ID '${targetId}' РЅРµ РЅР°Р№РґРµРЅ.`;
                        break;
                    }
                }

                // Р›РµРЅРёРІР°СЏ РёРЅРёС†РёР°Р»РёР·Р°С†РёСЏ РёРЅРІРµРЅС‚Р°СЂСЏ NPC, РµСЃР»Рё РµРіРѕ РµС‰Рµ РЅРµС‚
                if (!wNpc.inventory_id || !ContainerRegistry.has(wNpc.inventory_id)) {
                    wNpc.inventory_id = await CoreInventorySystemAsync.createContainer("npc_inventory", targetId, 500, 50, wNpc.currentLocation || player.location);
                }

                const item = ItemRegistry.get(itemKey);
                const moveQty = isFullStackMoveQuantity(quantity) ? item.stack_size : Math.min(quantity, item.stack_size);

                const res = await CoreInventorySystemAsync.moveItem(itemKey, player.container_backpack, wNpc.inventory_id, moveQty);
                
                if (res.success) {
                    const itemName = item.custom_props?.name || item.prototype_id;
                    feedback = `[РћР‘РњР•Рќ] Р’С‹ РїРµСЂРµРґР°Р»Рё [${itemName} x${moveQty}] РїРµСЂСЃРѕРЅР°Р¶Сѓ ${wNpc.name}.`;
                    
                    if (isGoldLikeItem(item)) {
                        syncPlayerGoldFromInventory();
                        animateGoldChange(-moveQty);
                    }
                    
                    updateInventoryDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] РћС€РёР±РєР° РїРµСЂРµРґР°С‡Рё: ${res.error}`;
                }
                break;
            }

            // --- РћРљР РЈР–Р•РќРР• ---

            case 'renderLocation':
                feedback = null; // Р—Р°РіР»СѓС€РєР°, С‡С‚РѕР±С‹ РЅРµ РІС‹РґР°РІР°Р»Рѕ РѕС€РёР±РєСѓ
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
                        // РЎСѓС‰РµСЃС‚РІРѕ СѓР¶Рµ СЃСѓС‰РµСЃС‚РІСѓРµС‚. РћР±РЅРѕРІР»СЏРµРј С‚РѕР»СЊРєРѕ РїСЂРёРІСЏР·РєСѓ, С‡С‚РѕР±С‹ РЅРµ СЃР±СЂРѕСЃРёС‚СЊ HP Рё СЃС‚Р°С‚С‹.
                        player.allKnownEntities[args.aiIdentifier].boundTo = binding;
                        updateEnvironmentVisibility();
                        feedback = t('gameInterface.commandFeedback.entityAlreadyInEnv', { name: args.name, id: args.aiIdentifier });
                    } else {
                        // РЎРѕР·РґР°РµРј РЅРѕРІРѕРµ СЃСѓС‰РµСЃС‚РІРѕ
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
                                    affection: 0,      // -100 РґРѕ 100 (Р»СЋР±РѕРІСЊ/РЅРµРЅР°РІРёСЃС‚СЊ)
                                    attraction: 0,     // 0-100 (СЃРµРєСЃСѓР°Р»СЊРЅРѕРµ РІР»РµС‡РµРЅРёРµ)
                                    trust: 0,          // 0-100 (РґРѕРІРµСЂРёРµ)
                                    intimacy: 0,       // 0-100 (Р±Р»РёР·РѕСЃС‚СЊ, СЂР°СЃС‚С‘С‚ РїРѕСЃР»Рµ СЃРµРєСЃР°)
                                    sexualHistory: []  // РјР°СЃСЃРёРІ { day, location, type, timestamp }
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
                        feedback = t('gameInterface.commandFeedback.entityAddedToEnv', { name: args.name }) + ` (РџСЂРёРІСЏР·РєР°: ${binding === 'player' ? 'РРіСЂРѕРє' : binding})`;
                    }
                } else {
                    feedback = `[ERROR] 'addEnvironment' С‚СЂРµР±СѓРµС‚ 'aiIdentifier', 'name', Рё 'type'.`;
                }
                break;

            case 'removeEnvironment':
                if (args.aiIdentifier) {
                    const entId = args.aiIdentifier;
        const entityKey = args.aiIdentifier; // РЇРІРЅРѕРµ РѕР±СЉСЏРІР»РµРЅРёРµ РґР»СЏ РѕР±СЂР°С‚РЅРѕР№ СЃРѕРІРјРµСЃС‚РёРјРѕСЃС‚Рё
                    const entity = player.allKnownEntities[entId] || player.visibleEntities[entId];

                    if (entity) {
                        if (args.isDeath === true) {
                             const xpReward = parseInt(entity.xpReward) || 0;
                             if (xpReward > 0) {
                                 player.stats.xp += xpReward;
                                 addCalculationMessage(`[XP] РџРѕР»СѓС‡РµРЅРѕ ${xpReward} РѕРїС‹С‚Р° Р·Р° РїРѕР±РµРґСѓ РЅР°Рґ ${entity.name}`);
                                 levelUp();
                             }
                        }
                        delete player.visibleEntities[entId];
                        delete player.allKnownEntities[entId];
                        const name = entity.name;
                        const xp = entity.xpReward || 0;

                        if (args.isDeath === true && xp > 0) {
                            player.stats.xp += xp;
                            feedback = t('gameInterface.commandFeedback.entityRemovedFromEnv', { name: name }) + ` (РџРѕР»СѓС‡РµРЅРѕ ${xp} РѕРїС‹С‚Р°)`;
                            levelUp();
                        } else {
                            feedback = t('gameInterface.commandFeedback.entityRemovedFromEnv', { name: name });
                        }
                        
                        // РЈРґР°Р»РµРЅРѕ: РјС‹ РЅРµ СѓРґР°Р»СЏРµРј СЃСѓС‰РЅРѕСЃС‚Рё РёР· C++ СЏРґСЂР° (removeEntity), РѕРЅРѕ СЃР°РјРѕ РѕС‡РёС‰Р°РµС‚ РјРµСЂС‚РІРµС†РѕРІ Рё РѕР±СЂР°Р±Р°С‚С‹РІР°РµС‚ РЅР°СЃР»РµРґСЃС‚РІРѕ.

                        updateEnvironmentPanel();
                        updateCharacterSheet();
                    } else {
                        feedback = t('gameInterface.commandFeedback.entityNotFoundInEnv', { id: args.aiIdentifier });
                    }
                } else {
                    feedback = `[ERROR] 'removeEnvironment' С‚СЂРµР±СѓРµС‚ 'aiIdentifier'.`;
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
                            feedback = `[РђСЂРјРёСЏ] РЎС‚Р°С‚ '${args.stat}' Р°СЂРјРёРё ${entId} РёР·РјРµРЅРµРЅ РЅР° ${args.value}.`;
                            addCalculationMessage(feedback);
                            break;
                        }
                    }

        const entityKey = args.aiIdentifier; // РЇРІРЅРѕРµ РѕР±СЉСЏРІР»РµРЅРёРµ РґР»СЏ РѕР±СЂР°С‚РЅРѕР№ СЃРѕРІРјРµСЃС‚РёРјРѕСЃС‚Рё
                    const entity = player.allKnownEntities[entId] || player.visibleEntities[entId];
                    
                    if (entity) {
                        const statName = args.stat.toLowerCase();
                        if (entity.stats && ['hp', 'maxhp', 'str', 'dex', 'con', 'int'].includes(statName)) {
                            let systemStatName = statName === 'maxhp' ? 'maxHp' : statName;
                            
                            // Рў3 Р¤РРљРЎ: РџСЂРѕРіСЂР°РјРјРЅРѕРµ РѕРіСЂР°РЅРёС‡РµРЅРёРµ РЅР° Р›Р®Р‘РћР• СѓРІРµР»РёС‡РµРЅРёРµ HP СЃСѓС‰РµСЃС‚РІ
                            let validatedValue = args.value;
                            if (systemStatName === 'hp') {
                                const currentHp = entity.stats.hp || 0;
                                if (validatedValue > currentHp) {
                                    console.error(`[System] Direct healing for ${entity.name} blocked. Only damage or status effects allowed.`);
                                    addCalculationMessage(`[РћРЁРР‘РљРђ РЇР”Р Рђ] РџРѕРїС‹С‚РєР° РёСЃС†РµР»РёС‚СЊ ${entity.name} С‡РµСЂРµР· updateEntityStat РїСЂРµСЃРµС‡РµРЅР°.`);
                                    validatedValue = currentHp;
                                }
                                
                                // Р”РѕРїРѕР»РЅРёС‚РµР»СЊРЅС‹Р№ РєР°Рї РїРѕ maxHp (РЅР° СЃР»СѓС‡Р°Р№ РµСЃР»Рё Р“Рњ СЂРµС€РёС‚ СѓРІРµР»РёС‡РёС‚СЊ Рё С‚РµРєСѓС‰РµРµ Рё РјР°РєСЃ СЃСЂР°Р·Сѓ)
                                if (entity.stats.maxHp && validatedValue > entity.stats.maxHp) {
                                    validatedValue = entity.stats.maxHp;
                                }
                            }

                            if (player.allKnownEntities[entId]) player.allKnownEntities[entId].stats[systemStatName] = validatedValue;
                            if (player.visibleEntities[entId]) player.visibleEntities[entId].stats[systemStatName] = validatedValue;
                            
                            sendInventoryCommand('updateEntityStat', { id: entId, stat: systemStatName, value: validatedValue })
                                .catch(err => console.warn('[Inventory] updateEntityStat failed:', err.message || err));
                            
                            // Р”Р»СЏ С„РёРґР±РµРєР° РёСЃРїРѕР»СЊР·СѓРµРј СѓР¶Рµ РІР°Р»РёРґРёСЂРѕРІР°РЅРЅРѕРµ Р·РЅР°С‡РµРЅРёРµ
                            args.value = validatedValue;
                            
                            feedback = t('gameInterface.commandFeedback.entityStatUpdated', { name: entity.name, stat: systemStatName.toUpperCase(), value: args.value });

                            // --- РђР’РўРћРњРђРўРРљРђ РЎРњР•Р РўР ---
                            if (systemStatName === 'hp' && args.value <= 0) {
                                const xp = entity.xpReward || 0;
                                if (xp > 0) {
                                    player.stats.xp += xp;
                                    feedback += ` (РЈР±РёС‚! +${xp} XP)`;
                                    levelUp();
                                } else {
                                    feedback += ` (РЈР±РёС‚!)`;
                                }
                                generateWorldNews(`Р“РµСЂРѕР№ ${player.name} СЃСЂР°Р·РёР» РїСЂРѕС‚РёРІРЅРёРєР°: ${entity.name}.`, player.location || "global", 2, 'war');
                                // Р‘РµР·РѕРїР°СЃРЅРѕРµ СѓРґР°Р»РµРЅРёРµ
                                if (player.visibleEntities[entId]) delete player.visibleEntities[entId];
                                if (player.allKnownEntities[entId]) delete player.allKnownEntities[entId];
                                updateCharacterSheet();
                            }
                            updateEnvironmentPanel();
                        } else {
                            feedback = `[ERROR] РќРµРІРµСЂРЅС‹Р№ СЃС‚Р°С‚ '${args.stat}' РґР»СЏ 'updateEntityStat'.`;
                        }
                    } else {
                        feedback = t('gameInterface.commandFeedback.entityNotFoundInEnv', { id: args.aiIdentifier });
                    }
                } else {
                    feedback = `[ERROR] 'updateEntityStat' С‚СЂРµР±СѓРµС‚ 'aiIdentifier', 'stat', Рё 'value' (number).`;
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
                    feedback = `[РРЅС‚СЂРёРіР°] Р—Р°РїСѓС‰РµРЅ Р·Р°РіРѕРІРѕСЂ '${args.id}' С‚РёРїР° ${args.type} РїСЂРѕС‚РёРІ ${args.target}.`;
                } else { feedback = `[ERROR] 'startIntrigue' С‚СЂРµР±СѓРµС‚ id, type, initiator, target.`; }
                break;
            case 'cancelIntrigue':
                if (args.id && World.intrigues) {
                    const idx = World.intrigues.findIndex(i => i.id === args.id);
                    if (idx !== -1) { World.intrigues.splice(idx, 1); feedback = `[РРЅС‚СЂРёРіР°] Р—Р°РіРѕРІРѕСЂ '${args.id}' РѕС‚РјРµРЅРµРЅ.`; }
                    else { feedback = `[ERROR] РРЅС‚СЂРёРіР° '${args.id}' РЅРµ РЅР°Р№РґРµРЅР°.`; }
                }
                break;
            case 'revealIntrigue':
                if (args.id && World.intrigues) {
                    const intrigue = World.intrigues.find(i => i.id === args.id);
                    if (intrigue) { intrigue.isDiscovered = true; feedback = `[РРЅС‚СЂРёРіР°] Р—Р°РіРѕРІРѕСЂ '${args.id}' РїСЂРёРЅСѓРґРёС‚РµР»СЊРЅРѕ СЂР°СЃРєСЂС‹С‚!`; generateWorldNews(`РЁРћРљ! Р Р°СЃРєСЂС‹С‚ Р·Р°РіРѕРІРѕСЂ С„СЂР°РєС†РёРё ${World.factions[intrigue.initiatorFactionId]?.name} РїСЂРѕС‚РёРІ ${World.factions[intrigue.targetFactionId]?.name}!`, "global", 5, 'misc'); }
                }
                break;
            case 'assassinateRuler':
                if (args.id && World.rulers && World.rulers[args.id]) {
                    World.rulers[args.id].health = 0; World.rulers[args.id].stats.hp = 0;
                    feedback = `[РЈР±РёР№СЃС‚РІРѕ] РџСЂР°РІРёС‚РµР»СЊ '${args.id}' СѓР±РёС‚ РїРѕ РІРѕР»Рµ GM.`;
                    checkRulerDeaths();
                } else { feedback = `[ERROR] РџСЂР°РІРёС‚РµР»СЊ '${args.id}' РЅРµ РЅР°Р№РґРµРЅ.`; }
                break;
            case 'overthrowRuler':
                if (args.factionId && World.factions[args.factionId]) {
                    // Р’РјРµСЃС‚Рѕ СЃС‚Р°Р±РёР»СЊРЅРѕСЃС‚Рё - С„РёР·РёС‡РµСЃРєРѕРµ РїРѕСЃР»РµРґСЃС‚РІРёРµ: Р±СѓРЅС‚ СѓРЅРёС‡С‚РѕР¶Р°РµС‚ СЂРµСЃСѓСЂСЃС‹ СЃС‚РѕР»РёС†С‹
                    const capitalRegionId = Object.keys(World.regions).find(rid => World.regions[rid].factionId === args.factionId);
                    if (capitalRegionId && World.regions[capitalRegionId]?.vault_id) {
                        const capitalVault = World.regions[capitalRegionId].vault_id;
                        const weaponsLost = Math.floor(countRealItems(capitalVault, 'weapons') * 0.3);
                        const foodLost = Math.floor(countRealItems(capitalVault, 'bread') * 0.5);
                        consumeRealItems(capitalVault, 'weapons', weaponsLost);
                        consumeRealItems(capitalVault, 'bread', foodLost);
                        generateWorldNews(`РњРЇРўР•Р–! Р’ Р·РµРјР»СЏС… ${World.factions[args.factionId].name} РІСЃРїС‹С…РЅСѓР»Рѕ РІРѕСЃСЃС‚Р°РЅРёРµ! РЈРЅРёС‡С‚РѕР¶РµРЅРѕ Р·Р°РїР°СЃРѕРІ: ${weaponsLost} РѕСЂСѓР¶РёСЏ, ${foodLost} РµРґС‹.`, "global", 5, 'war');
                    } else {
                        generateWorldNews(`РњРЇРўР•Р–! Р’ Р·РµРјР»СЏС… ${World.factions[args.factionId].name} РІСЃРїС‹С…РЅСѓР»Рѕ РІРѕСЃСЃС‚Р°РЅРёРµ!`, "global", 5, 'war');
                    }
                    generateWorldNews(`РњРЇРўР•Р–! Р’ Р·РµРјР»СЏС… ${World.factions[args.factionId].name} РІСЃРїС‹С…РЅСѓР»Рѕ РІРѕСЃСЃС‚Р°РЅРёРµ!`, "global", 5, 'war');
                    feedback = `[РњСЏС‚РµР¶] РРЅРёС†РёРёСЂРѕРІР°РЅ Р±СѓРЅС‚ РІРѕ С„СЂР°РєС†РёРё '${args.factionId}'.`;
                }
                break;
            case 'setFactionGoal':
                if (args.rulerId && World.rulers && World.rulers[args.rulerId]) {
                    World.rulers[args.rulerId].gmOverride = args.goal;
                    feedback = `[Р”РёРїР»РѕРјР°С‚РёСЏ] Р¦РµР»СЊ РїСЂР°РІРёС‚РµР»СЏ '${args.rulerId}' РїСЂРёРЅСѓРґРёС‚РµР»СЊРЅРѕ РёР·РјРµРЅРµРЅР° РЅР°: ${args.goal}.`;
                }
                break;

            case 'setCombatState':
                // РЎРЈРџР•Р -РџР Р•Р”РћРҐР РђРќРРўР•Р›Р¬: Р•СЃР»Рё РР Р·Р°Р±С‹Р» isActive, РЅРѕ РїРµСЂРµРґР°Р» СѓС‡Р°СЃС‚РЅРёРєРѕРІ, СЃС‡РёС‚Р°РµРј С‡С‚Рѕ Р±РѕР№ РЅР°С‡Р°Р»СЃСЏ
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
                            feedback = `[РЎРРЎРўР•РњРђ Р‘РћРЇ] Р‘РѕР№ РёРЅРёС†РёР°Р»РёР·РёСЂРѕРІР°РЅ. РЈС‡Р°СЃС‚РЅРёРєРё: ${player.currentCombat.participants.join(', ')}`;
                            document.querySelector('.input-area').style.boxShadow = 'inset 0 0 20px rgba(231, 76, 60, 0.3)';
                        }
                    } else {
                        if (wasActive) {
                            feedback = `[РЎРРЎРўР•РњРђ Р‘РћРЇ] Р‘РѕР№ Р·Р°РІРµСЂС€РµРЅ.`;
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
                                        feedback += ` [РђР’РўРћ-Р›РЈРў] РўРѕРІР°СЂС‹ РєР°СЂР°РІР°РЅР° РїРµСЂРµРјРµС‰РµРЅС‹ РІ РІР°С€ СЂСЋРєР·Р°Рє.`;
                                    }
                                }
                                player.travel.interactTarget = null;
                            }

                            if (player.travel && player.travel.active && player.travel.paused && player.travel.pauseReason === 'combat') {
                                LivingRoads.resume();
                                feedback += " РџСѓС‚РµС€РµСЃС‚РІРёРµ РІРѕР·РѕР±РЅРѕРІР»РµРЅРѕ.";
                            }
                        }
                    }
                    if (feedback) addCalculationMessage(feedback);
                } else {
                    feedback = `[ERROR] 'setCombatState' С‚СЂРµР±СѓРµС‚ 'isActive' (boolean).`;
                }
                break;

            case 'endCombat':
                if (player.currentCombat && player.currentCombat.isActive) {
                    player.currentCombat.isActive = false;
                    player.currentCombat.participants = [];
                    feedback = `[РЎРРЎРўР•РњРђ Р‘РћРЇ] Р‘РѕР№ РїСЂРёРЅСѓРґРёС‚РµР»СЊРЅРѕ Р·Р°РІРµСЂС€С‘РЅ РњР°СЃС‚РµСЂРѕРј.`;
                    const inputArea = document.querySelector('.input-area');
                    if (inputArea) inputArea.style.boxShadow = 'none';
                    updateCharacterSheet();
                } else {
                    feedback = `[РЎРРЎРўР•РњРђ Р‘РћРЇ] Р‘РѕР№ РЅРµ Р°РєС‚РёРІРµРЅ.`;
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
                    feedback = `[РРЅС‚СЂРёРіР°] Р—Р°РїСѓС‰РµРЅ Р·Р°РіРѕРІРѕСЂ '${args.id}' С‚РёРїР° ${args.type} РїСЂРѕС‚РёРІ ${args.target}.`;
                } else { feedback = `[ERROR] 'startIntrigue' С‚СЂРµР±СѓРµС‚ id, type, initiator, target.`; }
                break;
            case 'cancelIntrigue':
                if (args.id && World.intrigues) {
                    const idx = World.intrigues.findIndex(i => i.id === args.id);
                    if (idx !== -1) { World.intrigues.splice(idx, 1); feedback = `[РРЅС‚СЂРёРіР°] Р—Р°РіРѕРІРѕСЂ '${args.id}' РѕС‚РјРµРЅРµРЅ.`; }
                    else { feedback = `[ERROR] РРЅС‚СЂРёРіР° '${args.id}' РЅРµ РЅР°Р№РґРµРЅР°.`; }
                }
                break;
            case 'revealIntrigue':
                if (args.id && World.intrigues) {
                    const intrigue = World.intrigues.find(i => i.id === args.id);
                    if (intrigue) { intrigue.isDiscovered = true; feedback = `[РРЅС‚СЂРёРіР°] Р—Р°РіРѕРІРѕСЂ '${args.id}' РїСЂРёРЅСѓРґРёС‚РµР»СЊРЅРѕ СЂР°СЃРєСЂС‹С‚!`; generateWorldNews(`РЁРћРљ! Р Р°СЃРєСЂС‹С‚ Р·Р°РіРѕРІРѕСЂ С„СЂР°РєС†РёРё ${World.factions[intrigue.initiatorFactionId]?.name} РїСЂРѕС‚РёРІ ${World.factions[intrigue.targetFactionId]?.name}!`, "global", 5, 'misc'); }
                }
                break;
            case 'assassinateRuler':
                if (args.id && World.rulers && World.rulers[args.id]) {
                    World.rulers[args.id].health = 0; World.rulers[args.id].stats.hp = 0;
                    feedback = `[РЈР±РёР№СЃС‚РІРѕ] РџСЂР°РІРёС‚РµР»СЊ '${args.id}' СѓР±РёС‚ РїРѕ РІРѕР»Рµ GM.`;
                    checkRulerDeaths();
                } else { feedback = `[ERROR] РџСЂР°РІРёС‚РµР»СЊ '${args.id}' РЅРµ РЅР°Р№РґРµРЅ.`; }
                break;
            case 'overthrowRuler':
                if (args.factionId && World.factions[args.factionId]) {
                    // Р’РјРµСЃС‚Рѕ СЃС‚Р°Р±РёР»СЊРЅРѕСЃС‚Рё - С„РёР·РёС‡РµСЃРєРѕРµ РїРѕСЃР»РµРґСЃС‚РІРёРµ: Р±СѓРЅС‚ СѓРЅРёС‡С‚РѕР¶Р°РµС‚ СЂРµСЃСѓСЂСЃС‹ СЃС‚РѕР»РёС†С‹
                    const capitalRegionId = Object.keys(World.regions).find(rid => World.regions[rid].factionId === args.factionId);
                    if (capitalRegionId) {
                        const capitalVault = World.regions[capitalRegionId].vault_id;
                        const weaponsLost = Math.floor(countRealItems(capitalVault, 'weapons') * 0.3);
                        const foodLost = Math.floor(countRealItems(capitalVault, 'bread') * 0.5);
                        consumeRealItems(capitalVault, 'weapons', weaponsLost);
                        consumeRealItems(capitalVault, 'bread', foodLost);
                    }
                    generateWorldNews(`РњРЇРўР•Р–! Р’ Р·РµРјР»СЏС… ${World.factions[args.factionId].name} РІСЃРїС‹С…РЅСѓР»Рѕ РІРѕСЃСЃС‚Р°РЅРёРµ!`, "global", 5, 'war');
                    feedback = `[РњСЏС‚РµР¶] РРЅРёС†РёРёСЂРѕРІР°РЅ Р±СѓРЅС‚ РІРѕ С„СЂР°РєС†РёРё '${args.factionId}'. Р РµСЃСѓСЂСЃС‹ СЃС‚РѕР»РёС†С‹ СЂР°Р·РіСЂР°Р±Р»РµРЅС‹!`;
                }
                break;
            case 'setFactionGoal':
                if (args.rulerId && World.rulers && World.rulers[args.rulerId]) {
                    World.rulers[args.rulerId].gmOverride = args.goal;
                    feedback = `[Р”РёРїР»РѕРјР°С‚РёСЏ] Р¦РµР»СЊ РїСЂР°РІРёС‚РµР»СЏ '${args.rulerId}' РїСЂРёРЅСѓРґРёС‚РµР»СЊРЅРѕ РёР·РјРµРЅРµРЅР° РЅР°: ${args.goal}.`;
                }
                break;

case 'setEntityBinding':
                if (args.id && args.boundTo) {
                    const ent = player.allKnownEntities[args.id];
                    if (ent) {
                        ent.boundTo = args.boundTo;
                        updateEnvironmentVisibility();
                        feedback = `[РњРёСЂ] РџСЂРёРІСЏР·РєР° ${ent.name} РёР·РјРµРЅРµРЅР° РЅР°: ${args.boundTo}.`;
                    }
                }
                break;

            case 'setEntityState':
                if (args.aiIdentifier && args.property && typeof args.value === 'boolean') {
                    const entId = args.aiIdentifier;
        const entityKey = args.aiIdentifier; // РЇРІРЅРѕРµ РѕР±СЉСЏРІР»РµРЅРёРµ РґР»СЏ РѕР±СЂР°С‚РЅРѕР№ СЃРѕРІРјРµСЃС‚РёРјРѕСЃС‚Рё
                    const entity = player.allKnownEntities[entId] || player.visibleEntities[entId];
                    if (entity) {
                        if (args.property.toLowerCase() === 'ishostile') {
                            if (player.allKnownEntities[entId]) player.allKnownEntities[entId].isHostile = args.value;
                            if (player.visibleEntities[entId]) player.visibleEntities[entId].isHostile = args.value;
                            feedback = `[DEBUG] РЎС‚Р°С‚СѓСЃ РІСЂР°Р¶РґРµР±РЅРѕСЃС‚Рё РґР»СЏ ${entity.name} СѓСЃС‚Р°РЅРѕРІР»РµРЅ РІ ${args.value}.`;
                            updateEnvironmentPanel();
                        } else {
                            feedback = `[ERROR] РќРµРІРµСЂРЅРѕРµ СЃРІРѕР№СЃС‚РІРѕ '${args.property}' РґР»СЏ 'setEntityState'.`;
                        }
                    } else {
                        feedback = t('gameInterface.commandFeedback.entityNotFoundInEnv', { id: args.aiIdentifier });
                    }
                } else {
                    feedback = `[ERROR] 'setEntityState' С‚СЂРµР±СѓРµС‚ 'aiIdentifier', 'property', Рё 'value' (boolean).`;
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
                            feedback = `[РћР·Р°СЂРµРЅРёРµ] Р’С‹ СЂР°Р·РіР°РґР°Р»Рё СЃРєСЂС‹С‚СѓСЋ С‡РµСЂС‚Сѓ РїРµСЂСЃРѕРЅР°Р¶Р° ${entity.name}: ${args.trait}.`;
                            updateEnvironmentPanel();
                        } else {
                            feedback = `[DEBUG] Р§РµСЂС‚Р° '${args.trait}' РґР»СЏ ${entity.name} СѓР¶Рµ РёР·РІРµСЃС‚РЅР°.`;
                        }
                    } else {
                        feedback = `[ERROR] РЎСѓС‰РµСЃС‚РІРѕ СЃ ID '${args.id}' РЅРµ РЅР°Р№РґРµРЅРѕ РІ РѕРєСЂСѓР¶РµРЅРёРё РґР»СЏ revealEntityTrait.`;
                    }
                } else {
                    feedback = `[ERROR] 'revealEntityTrait' С‚СЂРµР±СѓРµС‚ 'id' Рё 'trait'.`;
                }
                break;

            // --- Р‘РћР™ Р РџР РћР’Р•Р РљР ---



            case 'equipItem':
                if (args.aiIdentifier) {
                    const backpack = ContainerRegistry.get(player.container_backpack);
                    if (!backpack) {
                        feedback = `[ERROR] Р СЋРєР·Р°Рє РёРіСЂРѕРєР° РЅРµ РЅР°Р№РґРµРЅ РІ СЂРµРµСЃС‚СЂРµ.`;
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
                            feedback = `[ERROR] РќРµ СѓРґР°Р»РѕСЃСЊ СЌРєРёРїРёСЂРѕРІР°С‚СЊ '${args.aiIdentifier}'. РџСЂРµРґРјРµС‚ РЅРµ РЅР°Р№РґРµРЅ РІ РёРЅРІРµРЅС‚Р°СЂРµ.`;
                        }
                    }
                } else {
                    feedback = `[ERROR] 'equipItem' С‚СЂРµР±СѓРµС‚ Р°СЂРіСѓРјРµРЅС‚ 'aiIdentifier'.`;
                }
                break;

            case 'unequipItem':
                if (args.slot) {
                    const slot = args.slot.toLowerCase();
                    feedback = await unequipItem(slot);
                } else {
                    feedback = `[ERROR] 'unequipItem' С‚СЂРµР±СѓРµС‚ 'slot'.`;
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
                    feedback = `[РЎРРЎРўР•РњРђ] РЎРѕР·РґР°РЅ РєРѕРЅС‚РµР№РЅРµСЂ ${contId} С‚РёРїР° ${args.type} РґР»СЏ ${args.ownerId}.`;
                } else {
                    feedback = `[ERROR] 'createContainer' С‚СЂРµР±СѓРµС‚ 'type' Рё 'ownerId'.`;
                }
                break;

            case 'moveItem':
                if (args.itemId && args.sourceContainerId) {
                    const res = await CoreInventorySystemAsync.moveItem(args.itemId, args.sourceContainerId, args.targetContainerId || null, args.quantity || null);
                    feedback = res.success ? `[РЎРРЎРўР•РњРђ] РџСЂРµРґРјРµС‚ РїРµСЂРµРјРµС‰РµРЅ.` : `[ERROR] РћС€РёР±РєР° РїРµСЂРµРјРµС‰РµРЅРёСЏ: ${res.error}`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'moveItem' С‚СЂРµР±СѓРµС‚ 'itemId' Рё 'sourceContainerId'.`;
                }
                break;

            case 'moveItems':
            case 'move_items':
                if (args.sourceContainerId && Array.isArray(args.items) && args.items.length > 0) {
                    const res = await CoreInventorySystemAsync.moveItems(args.sourceContainerId, args.targetContainerId || args.target || null, args.items, { actorId: 'player' });
                    feedback = res.success
                        ? `[РЎРРЎРўР•РњРђ] РџРµСЂРµРјРµС‰РµРЅРѕ РїСЂРµРґРјРµС‚РѕРІ: ${res.movedCount}.`
                        : `[ERROR] РћС€РёР±РєР° РїР°РєРµС‚РЅРѕРіРѕ РїРµСЂРµРјРµС‰РµРЅРёСЏ: ${res.error}`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'moveItems' С‚СЂРµР±СѓРµС‚ 'sourceContainerId' Рё 'items' [{id, quantity}].`;
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
                feedback = res.success ? `[РўРћР Р“РћР’Р›РЇ] ${res.message}` : `[ERROR] ${res.error}`;
                break;
            }

            case 'confirmTrade':
            case 'confirm_trade': {
                const tradeId = args.tradeId || args.trade_id || player.active_trade_id;
                if (!tradeId) {
                    feedback = `[ERROR] РќРµС‚ Р°РєС‚РёРІРЅРѕР№ СЃРґРµР»РєРё РґР»СЏ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ.`;
                    break;
                }
                const res = TradeSystem.confirmTrade(tradeId);
                feedback = res.success
                    ? `[РўРћР Р“РћР’Р›РЇ] РЎРґРµР»РєР° СѓСЃРїРµС€РЅРѕ Р·Р°РІРµСЂС€РµРЅР°${res.price ? ` Р·Р° ${res.price} Р·РѕР»РѕС‚Р°` : ''}.`
                    : `[ERROR] РћС€РёР±РєР° СЃРґРµР»РєРё: ${res.error}`;
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
                    feedback = `[ERROR] РќРµС‚ Р°РєС‚РёРІРЅРѕР№ СЃРґРµР»РєРё РґР»СЏ С‚РѕСЂРіР°.`;
                    break;
                }
                const newOffer = args.newOffer ?? args.new_offer ?? args.price ?? args.offerItems;
                const res = TradeSystem.negotiateTrade(tradeId, newOffer, args.requestItems || args.request_items || []);
                feedback = res.success
                    ? `[РўРћР Р“РћР’Р›РЇ] РЈСЃР»РѕРІРёСЏ СЃРґРµР»РєРё РѕР±РЅРѕРІР»РµРЅС‹${res.acceptedPrice ? `: ${res.acceptedPrice} Р·РѕР»РѕС‚Р°.` : '.'}`
                    : `[ERROR] РћС€РёР±РєР° РёР·РјРµРЅРµРЅРёСЏ СЃРґРµР»РєРё: ${res.error}`;
                break;
            }

            case 'destroyContainer':
                if (args.containerId) {
                    const res = await CoreInventorySystemAsync.destroyContainer(args.containerId);
                    feedback = res ? `[РЎРРЎРўР•РњРђ] РљРѕРЅС‚РµР№РЅРµСЂ ${args.containerId} СЂР°Р·СЂСѓС€РµРЅ, СЃРѕРґРµСЂР¶РёРјРѕРµ РІС‹СЃС‹РїР°Р»РѕСЃСЊ РЅР° Р·РµРјР»СЋ.` : `[ERROR] РљРѕРЅС‚РµР№РЅРµСЂ РЅРµ РЅР°Р№РґРµРЅ.`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'destroyContainer' С‚СЂРµР±СѓРµС‚ 'containerId'.`;
                }
                break;

            case 'unlockContainer':
                if (args.containerId) {
                    const res = await CoreInventorySystemAsync.unlockContainer(args.containerId, 'player');
                    feedback = res.success ? `[Р’Р—Р›РћРњ] РЈСЃРїРµС€РЅРѕ: ${res.message}` : `[Р’Р—Р›РћРњ] РџСЂРѕРІР°Р»: ${res.error}`;
                    updateInventoryDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'unlockContainer' С‚СЂРµР±СѓРµС‚ 'containerId'.`;
                }
                break;

            case 'confiscateStolen':
                if (args.targetId) {
                    const targetCont = args.targetId === 'player' ? player.container_backpack : args.targetId;
                    const count = await CoreInventorySystemAsync.confiscateStolen(targetCont, "guard_confiscation_chest");
                    feedback = `[РЎРўР РђР–Рђ] РР·СЉСЏС‚Рѕ РєСЂР°РґРµРЅС‹С… РїСЂРµРґРјРµС‚РѕРІ: ${count}.`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'confiscateStolen' С‚СЂРµР±СѓРµС‚ 'targetId'.`;
                }
                break;

            case 'buildContainer':
                if (args.type) {
                    const contId = await CoreInventorySystemAsync.buildContainer('player', args.type, player.location);
                    feedback = contId ? `[РљР РђР¤Рў] РЎРѕР·РґР°РЅ РєРѕРЅС‚РµР№РЅРµСЂ ${contId}. РџРѕС‚СЂР°С‡РµРЅРѕ 5 РґРµСЂРµРІР°.` : `[ERROR] РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РґРµСЂРµРІР° (РЅСѓР¶РЅРѕ 5 wood).`;
                    updateInventoryDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'buildContainer' С‚СЂРµР±СѓРµС‚ 'type'.`;
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
                    feedback = `[РЎРРЎРўР•РњРђ] AoE СѓСЂРѕРЅ (${args.damage}) РЅР°РЅРµСЃРµРЅ РїРѕ Р»РѕРєР°С†РёРё ${args.location}. Р Р°Р·СЂСѓС€РµРЅРѕ РєРѕРЅС‚РµР№РЅРµСЂРѕРІ: ${destroyed}. РџСЂРµРґРјРµС‚С‹ РІРЅСѓС‚СЂРё РїРѕРІСЂРµР¶РґРµРЅС‹.`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] 'applyAoEDamage' С‚СЂРµР±СѓРµС‚ 'location' Рё 'damage'.`;
                }
                break;

            case 'castMagicalPocket': {
                const existingPocket = Array.from(ContainerRegistry.values()).find(cont => cont.owner_id === 'player' && cont.type === 'magical_pocket');
                if (!player.statusEffects['spell_magical_pocket']) {
                    player.statusEffects['spell_magical_pocket'] = { id: 'spell_magical_pocket', name: 'РњР°РіРёС‡РµСЃРєРёР№ РєР°СЂРјР°РЅ', duration: 9999, description: 'РћС‚РєСЂС‹РІР°РµС‚ РґРѕСЃС‚СѓРї Рє СЌРєСЃС‚СЂР°РґРёРјРµРЅСЃРёРѕРЅР°Р»СЊРЅРѕРјСѓ С…СЂР°РЅРёР»РёС‰Сѓ.', effects: [] };
                }
                if (existingPocket) {
                    existingPocket.location = normalizeContainerLocation({ world_coords: null, parent_entity: 'player', parent_container: null, region_id: 'astral' });
                    feedback = `[РњРђР“РРЇ] РњР°РіРёС‡РµСЃРєРёР№ РєР°СЂРјР°РЅ СѓР¶Рµ Р°РєС‚РёРІРµРЅ.`;
                } else {
                    const contId = await CoreInventorySystemAsync.createContainer('magical_pocket', 'player', 500, 100, { world_coords: null, parent_entity: 'player', parent_container: null, region_id: 'astral' });
                    feedback = `[РњРђР“РРЇ] РЎРѕР·РґР°РЅ РјР°РіРёС‡РµСЃРєРёР№ РєР°СЂРјР°РЅ (ID: ${contId}).`;
                }
                break;
            }

            case 'dispelMagicPocket': {
                const pocketId = args.containerId || Array.from(ContainerRegistry.values()).find(cont => cont.owner_id === 'player' && cont.type === 'magical_pocket')?.id;
                if (pocketId && ContainerRegistry.has(pocketId)) {
                    ContainerRegistry.get(pocketId).location = resolveActorLocation('player');
                    await CoreInventorySystemAsync.destroyContainer(pocketId);
                    delete player.statusEffects['spell_magical_pocket'];
                    feedback = `[РњРђР“РРЇ] РњР°РіРёС‡РµСЃРєРёР№ РєР°СЂРјР°РЅ СЂР°Р·РІРµСЏРЅ, РІРµС‰Рё РІС‹СЃС‹РїР°Р»РёСЃСЊ РІ СЂРµР°Р»СЊРЅС‹Р№ РјРёСЂ.`;
                    updateInventoryDisplay();
                    updateEquipmentDisplay();
                    updateCharacterSheet();
                } else {
                    feedback = `[ERROR] РњР°РіРёС‡РµСЃРєРёР№ РєР°СЂРјР°РЅ РЅРµ РЅР°Р№РґРµРЅ.`;
                }
                break;
            }

            case 'fleePackAnimal':
                if (args.containerId) {
                    const contId = resolveSpecialContainerId(args.containerId);
                    const cont = ContainerRegistry.get(contId);
                    if (cont) {
                        await CoreInventorySystemAsync.updateContainerLocation(contId, normalizeContainerLocation({ world_coords: [0, 0, 0], parent_entity: null, parent_container: null, region_id: "unknown_wilderness" }));
                        feedback = `[РЎРћР‘Р«РўРР•] Р’СЊСЋС‡РЅРѕРµ Р¶РёРІРѕС‚РЅРѕРµ РёСЃРїСѓРіР°Р»РѕСЃСЊ Рё СЃР±РµР¶Р°Р»Рѕ РІРјРµСЃС‚Рµ СЃ РєРѕРЅС‚РµР№РЅРµСЂРѕРј ${contId}!`;
                    } else {
                        feedback = `[ERROR] РљРѕРЅС‚РµР№РЅРµСЂ РЅРµ РЅР°Р№РґРµРЅ.`;
                    }
                } else {
                    feedback = `[ERROR] 'fleePackAnimal' С‚СЂРµР±СѓРµС‚ 'containerId'.`;
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
                        feedback = `[РџСЂРµРґРјРµС‚] РҐР°СЂР°РєС‚РµСЂРёСЃС‚РёРєР° '${args.stat}' Сѓ '${item.custom_props.name}' РёР·РјРµРЅРµРЅР° РЅР° ${change > 0 ? '+' + change : change}. РўРµРєСѓС‰РµРµ Р·РЅР°С‡РµРЅРёРµ: ${item.durability}`;
                        if (isEquipped) updateEquipmentDisplay();
                        else updateInventoryDisplay();
                    } else {
                        feedback = `[ERROR] РџСЂРµРґРјРµС‚ '${args.aiIdentifier}' РЅРµ РЅР°Р№РґРµРЅ РґР»СЏ updateItemStat.`;
                    }
                } else {
                    feedback = `[ERROR] 'updateItemStat' С‚СЂРµР±СѓРµС‚ 'aiIdentifier', 'stat' Рё 'change'.`;
                }
                break;

            // --- Р›Р•Р“РРўРРњРќР«Р• Р’РњР•РЁРђРўР•Р›Р¬РЎРўР’Рђ Р“Рњ (РЎРўР РђРўР•Р“) ---
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
                // Р¤РѕР»Р±СЌРєРё РґР»СЏ РєР»СЋС‡РµР№, РµСЃР»Рё РР РѕС€РёР±СЃСЏ
                if (command === 'gmCreateFaction') {
                    if (!args.factionId) args.factionId = args.id || args.key || args.aiIdentifier;
                }
                if (command === 'gmTransferRegion') {
                    if (!args.newFactionId) args.newFactionId = args.factionId || args.id || args.key || args.aiIdentifier;
                    if (!args.regionId) args.regionId = args.locationName || args.target || args.id;
                }

                // РЈРјРЅС‹Р№ РїРѕРёСЃРє СЂРµРіРёРѕРЅР°
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
                
                // РЈРјРЅС‹Р№ РїРѕРёСЃРє С„СЂР°РєС†РёРё РґР»СЏ gmTransferRegion
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
                            let errMsg = `[РљР РРўРР§Р•РЎРљРђРЇ РћРЁРР‘РљРђ РЇР”Р Рђ] РљРѕРјР°РЅРґР° '${command}' РїСЂРѕРёРіРЅРѕСЂРёСЂРѕРІР°РЅР° C++ РґРІРёР¶РєРѕРј! Р’С‹ Р·Р°Р±С‹Р»Рё РїРµСЂРµРєРѕРјРїРёР»РёСЂРѕРІР°С‚СЊ meterea_engine.exe РїРѕСЃР»Рµ РїСЂРёРјРµРЅРµРЅРёСЏ РїР°С‚С‡РµР№.`;
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
                            feedback = res.feedback; // Р’РѕР·РІСЂР°С‰Р°РµРј С„РёРґР±РµРє РІ РѕСЃРЅРѕРІРЅРѕР№ С†РёРєР»
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
                    feedback = `[DEBUG] РџРѕР»СѓС‡РµРЅР° СѓСЃС‚Р°СЂРµРІС€Р°СЏ РєРѕРјР°РЅРґР° '${command}'. РџРѕР¶Р°Р»СѓР№СЃС‚Р°, РёСЃРїРѕР»СЊР·СѓР№С‚Рµ СЃРёСЃС‚РµРјСѓ NEXUS.`;
                } else {
                    feedback = t('gameInterface.commandFeedback.errorUnknownCommand', { command: command });
                }
                console.warn(feedback, args);
        }
    } catch (error) {
        feedback = t('gameInterface.commandFeedback.errorCommandGeneric', { command: command, args: error.message });
        console.error(`РљСЂРёС‚РёС‡РµСЃРєР°СЏ РѕС€РёР±РєР° РїСЂРё РІС‹РїРѕР»РЅРµРЅРёРё РєРѕРјР°РЅРґС‹ ${command}:`, error, args);
    }
    return feedback;
}

// === Р¤РЈРќРљР¦РР Р”Р›РЇ РџР РРњР•РќР•РќРРЇ РџРћРЎР›Р•Р”РЎРўР’РР™ Р­Р РћРўРР§Р•РЎРљРРҐ РЎР¦Р•Рќ ===

/**
 * РџСЂРёРјРµРЅСЏРµС‚ Р±РµСЂРµРјРµРЅРЅРѕСЃС‚СЊ Рє РёРіСЂРѕРєСѓ
 * @param {string} partnerId - ID NPC-РїР°СЂС‚РЅС‘СЂР° (РѕРїС†РёРѕРЅР°Р»СЊРЅРѕ)
 * @returns {string} РЎРѕРѕР±С‰РµРЅРёРµ РґР»СЏ Р»РѕРіР°
 */
function applyPregnancy(partnerId = null) {
    if (!player) return '[ERROR] Player not found';

    // РџСЂРѕРІРµСЂСЏРµРј, РЅРµС‚ Р»Рё СѓР¶Рµ Р±РµСЂРµРјРµРЅРЅРѕСЃС‚Рё
    if (player.statusEffects && player.statusEffects['pregnancy']) {
        return 'РРіСЂРѕРє СѓР¶Рµ Р±РµСЂРµРјРµРЅРµРЅ/Р±РµСЂРµРјРµРЅРЅР°.';
    }

    const duration = 270; // 9 РјРµСЃСЏС†РµРІ (270 РґРЅРµР№)
    const effectData = {
        id: 'pregnancy',
        name: 'Р‘РµСЂРµРјРµРЅРЅРѕСЃС‚СЊ',
        duration: duration,
        description: 'Р’С‹ Р±РµСЂРµРјРµРЅРЅС‹. Р­С‚Рѕ РІР»РёСЏРµС‚ РЅР° РІР°С€Рё С„РёР·РёС‡РµСЃРєРёРµ С…Р°СЂР°РєС‚РµСЂРёСЃС‚РёРєРё.',
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
            stage: 1 // 1-3 С‚СЂРёРјРµСЃС‚СЂ (Р±СѓРґРµС‚ РѕР±РЅРѕРІР»СЏС‚СЊСЃСЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё РїРѕ РґРЅСЏРј)
        }
    };

    if (!player.statusEffects) player.statusEffects = {};
    player.statusEffects['pregnancy'] = effectData;

    // РџСЂРёРјРµРЅСЏРµРј СЌС„С„РµРєС‚С‹ РЅР° СЃС‚Р°С‚С‹
    player.stats.con = (player.stats.con ?? getCharacterStatBaseline('constitution')) - 2;
    player.stats.dex = (player.stats.dex ?? getCharacterStatBaseline('dexterity')) - 1;

    updateStatusEffectsDisplay();
    updateCharacterSheet();

    return `РџСЂРёРјРµРЅРµРЅР° Р±РµСЂРµРјРµРЅРЅРѕСЃС‚СЊ (РїР°СЂС‚РЅС‘СЂ: ${partnerId || 'РЅРµРёР·РІРµСЃС‚РµРЅ'}). Р”Р»РёС‚РµР»СЊРЅРѕСЃС‚СЊ: ${duration} РґРЅРµР№.`;
}

/**
 * РџСЂРёРјРµРЅСЏРµС‚ РІРµРЅРµСЂРёС‡РµСЃРєРѕРµ Р·Р°Р±РѕР»РµРІР°РЅРёРµ Рє РёРіСЂРѕРєСѓ
 * @param {number} severity - РўСЏР¶РµСЃС‚СЊ Р·Р°Р±РѕР»РµРІР°РЅРёСЏ (1-3)
 * @returns {string} РЎРѕРѕР±С‰РµРЅРёРµ РґР»СЏ Р»РѕРіР°
 */
function applyDisease(severity = 2) {
    if (!player) return '[ERROR] Player not found';

    severity = Math.max(1, Math.min(3, severity)); // РћРіСЂР°РЅРёС‡РёРІР°РµРј 1-3
    const diseaseId = `disease_std_${severity}`;

    // РџСЂРѕРІРµСЂСЏРµРј, РЅРµС‚ Р»Рё СѓР¶Рµ СЌС‚РѕРіРѕ Р·Р°Р±РѕР»РµРІР°РЅРёСЏ
    if (player.statusEffects && player.statusEffects[diseaseId]) {
        return `РРіСЂРѕРє СѓР¶Рµ Р±РѕР»РµРЅ Р—РџРџРџ (С‚СЏР¶РµСЃС‚СЊ ${severity}).`;
    }

    let diseaseName = 'Р’РµРЅРµСЂРёС‡РµСЃРєРѕРµ Р·Р°Р±РѕР»РµРІР°РЅРёРµ';
    let description = 'Р’С‹ Р·Р°СЂР°Р·РёР»РёСЃСЊ РІРµРЅРµСЂРёС‡РµСЃРєРёРј Р·Р°Р±РѕР»РµРІР°РЅРёРµРј. РўСЂРµР±СѓРµС‚СЃСЏ Р»РµС‡РµРЅРёРµ.';
    const effects = [];
    const originalValues = {};

    const chaChange = severity === 1 ? -2 : (severity === 2 ? -3 : -5);
    const hpChange = -severity;

    effects.push({ trigger: { type: 'on_turn_start', interval: 1 }, action: { type: 'modify_stat', stat: 'hp', change: hpChange } });
    effects.push({ trigger: { type: 'on_apply' }, action: { type: 'modify_stat', stat: 'cha', change: chaChange } });
    effects.push({ trigger: { type: 'on_remove' }, action: { type: 'restore_stat', stat: 'cha' } });
    originalValues.cha = player.stats.cha ?? getCharacterStatBaseline('charisma');

    if (severity === 1) {
        diseaseName = 'Р›С‘РіРєРѕРµ Р—РџРџРџ';
    } else if (severity === 2) {
        diseaseName = 'Р—РџРџРџ';
    } else if (severity === 3) {
        diseaseName = 'РўСЏР¶С‘Р»РѕРµ Р—РџРџРџ';
        description = 'Р’С‹ Р·Р°СЂР°Р·РёР»РёСЃСЊ С‚СЏР¶С‘Р»С‹Рј РІРµРЅРµСЂРёС‡РµСЃРєРёРј Р·Р°Р±РѕР»РµРІР°РЅРёРµРј. РЎСЂРѕС‡РЅРѕ С‚СЂРµР±СѓРµС‚СЃСЏ Р»РµС‡РµРЅРёРµ!';
        effects.push({ trigger: { type: 'on_apply' }, action: { type: 'modify_stat', stat: 'con', change: -1 } });
        effects.push({ trigger: { type: 'on_remove' }, action: { type: 'restore_stat', stat: 'con' } });
        originalValues.con = player.stats.con ?? getCharacterStatBaseline('constitution');
    }

    const effectData = {
        id: diseaseId,
        name: diseaseName,
        duration: 9999, // Р‘РµСЃРєРѕРЅРµС‡РЅРѕ, РїРѕРєР° РЅРµ РІС‹Р»РµС‡Р°С‚
        description: description,
        effects: effects,
        appliedTurn: player.stats.turnCount,
        originalValues: originalValues,
        custom_props: { severity: severity, curable: true }
    };

    if (!player.statusEffects) player.statusEffects = {};
    player.statusEffects[diseaseId] = effectData;

    // РџСЂРёРјРµРЅСЏРµРј СЌС„С„РµРєС‚С‹ РЅР° СЃС‚Р°С‚С‹
    player.stats.cha = (player.stats.cha ?? getCharacterStatBaseline('charisma')) + chaChange;
    if (severity === 3) {
        player.stats.con = (player.stats.con ?? getCharacterStatBaseline('constitution')) - 1;
    }

    updateStatusEffectsDisplay();
    updateCharacterSheet();

    return `РџСЂРёРјРµРЅРµРЅРѕ Р—РџРџРџ (С‚СЏР¶РµСЃС‚СЊ ${severity}). РўСЂРµР±СѓРµС‚СЃСЏ Р»РµС‡РµРЅРёРµ.`;
}

/**
 * РџСЂРёРјРµРЅСЏРµС‚ РїРѕСЃР»РµРґСЃС‚РІРёСЏ РґР»СЏ СЂРµРїСѓС‚Р°С†РёРё
 * @param {string} key - РљР»СЋС‡ СЂРµРїСѓС‚Р°С†РёРё (РЅР°РїСЂРёРјРµСЂ, 'sexual_reputation' РёР»Рё 'scandal_npc_id')
 * @param {number} change - РР·РјРµРЅРµРЅРёРµ СЂРµРїСѓС‚Р°С†РёРё (РѕР±С‹С‡РЅРѕ РѕС‚СЂРёС†Р°С‚РµР»СЊРЅРѕРµ)
 * @returns {string} РЎРѕРѕР±С‰РµРЅРёРµ РґР»СЏ Р»РѕРіР°
 */
function applyReputationConsequence(key = 'sexual_reputation', change = -20) {
    if (!player) return '[ERROR] Player not found';

    if (!player.reputation) player.reputation = {};

    const oldValue = player.reputation[key] || 0;
    player.reputation[key] = oldValue + change;

    updateCharacterSheet(); // РРЎРџР РђР’Р›Р•РќРћ: РћР±РЅРѕРІР»СЏРµРј Р»РёСЃС‚ РїРµСЂСЃРѕРЅР°Р¶Р°, С‚Р°Рє РєР°Рє updateReputationDisplay РЅРµ СЃСѓС‰РµСЃС‚РІСѓРµС‚

    return `Р РµРїСѓС‚Р°С†РёСЏ РёР·РјРµРЅРµРЅР°: ${key} ${oldValue} в†’ ${player.reputation[key]} (${change >= 0 ? '+' : ''}${change})`;
}

/**
 * Р­РєРёРїРёСЂСѓРµС‚ РїСЂРµРґРјРµС‚ РёР· РёРЅРІРµРЅС‚Р°СЂСЏ.
 * @param {string} itemInternalId - Р’РЅСѓС‚СЂРµРЅРЅРёР№ ID РїСЂРµРґРјРµС‚Р° РІ РёРЅРІРµРЅС‚Р°СЂРµ.
 * @returns {string|null} РЎРѕРѕР±С‰РµРЅРёРµ РґР»СЏ Р»РѕРіР° РёР»Рё null.
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

    if (!bodySlots.includes(targetSlot)) return `[ERROR] РџРѕРїС‹С‚РєР° СЌРєРёРїРёСЂРѕРІР°С‚СЊ РІ РЅРµСЃСѓС‰РµСЃС‚РІСѓСЋС‰РёР№ СЃР»РѕС‚: '${targetSlot}'`;

    const eqCont = ContainerRegistry.get(player.container_equipment);
    const existingItemInSlot = getContainerItems(eqCont).find(id => ItemRegistry.get(id).slot_index === targetSlot);
    
    if (existingItemInSlot) {
        const unequipFeedback = await unequipItem(targetSlot);
        if (unequipFeedback && unequipFeedback.includes('РРЅРІРµРЅС‚Р°СЂСЊ РїРѕР»РѕРЅ')) return unequipFeedback;
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
        console.warn(`РџРѕРїС‹С‚РєР° СЌРєРёРїРёСЂРѕРІР°С‚СЊ РїСЂРµРґРјРµС‚ '${draggedItemData.name}' РІ РЅРµРІРµСЂРЅС‹Р№ СЃР»РѕС‚ '${slotName}'.`);
        return;
    }

    // Р’С‹Р·С‹РІР°РµРј РЅР°С€Сѓ СѓРЅРёРІРµСЂСЃР°Р»СЊРЅСѓСЋ С„СѓРЅРєС†РёСЋ equipItem
    const feedback = await equipItem(itemId, slotName);

    if (feedback) {
        addLogMessage(feedback, 'command-feedback');
    }
}

/**
 * РЎРЅРёРјР°РµС‚ РїСЂРµРґРјРµС‚ РёР· СѓРєР°Р·Р°РЅРЅРѕРіРѕ СЃР»РѕС‚Р°.
 * @param {string} slot - РќР°Р·РІР°РЅРёРµ СЃР»РѕС‚Р° (РЅР°РїСЂРёРјРµСЂ, 'head', 'right_hand').
 * @returns {string|null} РЎРѕРѕР±С‰РµРЅРёРµ РґР»СЏ Р»РѕРіР° РёР»Рё null.
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
 * РћР±РЅРѕРІР»СЏРµС‚ РІРёР·СѓР°Р»СЊРЅРѕРµ РѕС‚РѕР±СЂР°Р¶РµРЅРёРµ РІСЃРµС… СЃР»РѕС‚РѕРІ СЌРєРёРїРёСЂРѕРІРєРё.
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

        // РџСЂРёРІСЏР·С‹РІР°РµРј СЃРѕР±С‹С‚РёСЏ Drag-and-Drop Рё РєР»РёРєР°
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
 * Р Р°СЃСЃС‡РёС‚С‹РІР°РµС‚ СЌС„С„РµРєС‚РёРІРЅС‹Рµ С…Р°СЂР°РєС‚РµСЂРёСЃС‚РёРєРё РїРµСЂСЃРѕРЅР°Р¶Р°, СѓС‡РёС‚С‹РІР°СЏ Р±Р°Р·РѕРІС‹Рµ СЃС‚Р°С‚С‹,
 * Р±РѕРЅСѓСЃС‹ РѕС‚ СЌРєРёРїРёСЂРѕРІРєРё Рё РІСЂРµРјРµРЅРЅС‹Рµ СЌС„С„РµРєС‚С‹.
 * @returns {{effectiveStats: object, bonuses: object}} РћР±СЉРµРєС‚ СЃ РёС‚РѕРіРѕРІС‹РјРё С…Р°СЂР°РєС‚РµСЂРёСЃС‚РёРєР°РјРё Рё Р±РѕРЅСѓСЃР°РјРё.
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
        breakdown['dex'].push({ name: "РџРµСЂРµРіСЂСѓР· (Р’РµСЃ)", change: -penalty });
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
        traitsList.innerHTML = `<li data-i18n="gameInterface.traitsPanel.empty">РќРµС‚ РѕСЃРѕР±С‹С… С‡РµСЂС‚</li>`;
        return;
    }

    // Р“СЂСѓРїРїРёСЂРѕРІРєР° РїРѕ РєР°С‚РµРіРѕСЂРёСЏРј
    const groupedTraits = playerTraits.reduce((acc, trait) => {
        const category = trait.category || 'РџСЂРѕС‡РµРµ';
        if (!acc[category]) {
            acc[category] = [];
        }
        acc[category].push(trait);
        return acc;
    }, {});

    for (const category in groupedTraits) {
        const categoryHeader = document.createElement('li');
        categoryHeader.className = 'category-header'; // РњРѕР¶РЅРѕ РґРѕР±Р°РІРёС‚СЊ СЃС‚РёР»Рё РґР»СЏ Р·Р°РіРѕР»РѕРІРєРѕРІ
        categoryHeader.textContent = category;
        traitsList.appendChild(categoryHeader);

        groupedTraits[category].forEach(trait => {
            const li = document.createElement('li');
            li.title = trait.description;
            let valueDisplay = '';
            if (trait.type === 'numeric') {
                valueDisplay = ` (Р Р°РЅРі: ${trait.value})`;
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

    // Р‘Р°РЅРєРѕРІСЃРєРёР№ СЃС‡РµС‚
    if (player.bankAccount.deposit > 0 || player.bankAccount.loan > 0) {
        const bankHeader = document.createElement('li');
        bankHeader.className = 'category-header';
        bankHeader.innerHTML = '<i class="fas fa-university"></i> Р‘Р°РЅРєРѕРІСЃРєРёР№ СЃС‡РµС‚';
        holdingsList.appendChild(bankHeader);

        if (player.bankAccount.deposit > 0) {
            holdingsList.innerHTML += `<li title="Р”РµРЅСЊРіРё РІ Р±Р°РЅРєРµ РїСЂРёРЅРѕСЃСЏС‚ 1% РґРѕС…РѕРґР° РІ РґРµРЅСЊ"><span class="holding-name" style="color:#2ecc71">Р”РµРїРѕР·РёС‚</span><span class="holding-value">${player.bankAccount.deposit} рџ’°</span></li>`;
        }
        if (player.bankAccount.loan > 0) {
            holdingsList.innerHTML += `<li title="Р”РѕР»Рі СЂР°СЃС‚РµС‚ РЅР° 2% РІ РґРµРЅСЊ. РћСЃС‚Р°Р»РѕСЃСЊ РґРЅРµР№: ${player.bankAccount.loanDays}"><span class="holding-name" style="color:#e74c3c">РљСЂРµРґРёС‚ (${player.bankAccount.loanDays} РґРЅ.)</span><span class="holding-value">${player.bankAccount.loan} рџ’°</span></li>`;
        }
    }

    // РџСЂРµРґРїСЂРёСЏС‚РёСЏ
    const propHeader = document.createElement('li');
    propHeader.className = 'category-header';
    propHeader.innerHTML = '<i class="fas fa-industry"></i> РџСЂРµРґРїСЂРёСЏС‚РёСЏ';
    holdingsList.appendChild(propHeader);

    playerBusinesses.forEach(bus => {
        const li = document.createElement('li');
        li.style.cursor = 'pointer';
        li.title = "РќР°Р¶РјРёС‚Рµ РґР»СЏ СѓРїСЂР°РІР»РµРЅРёСЏ Р»РѕРіРёСЃС‚РёРєРѕР№ Рё РїСЂРѕРёР·РІРѕРґСЃС‚РІРѕРј";
        li.onclick = () => openBusinessModal(bus.id);
        let bName = getFacilityName(bus.facility_type);
        const reg = World.regions[bus.region_id];
        if (reg) {
            const block = reg.cityLayout.find(b => b.linked_id === bus.id);
            if (block && block.name !== block.type) bName = block.name;
        }
        let statusText = bus.is_active ? `<span style="color:#f1c40f">${bus.cash_balance} рџ’°</span>` : (bus.construction_days_left > 0 ? `<span style="color:#e67e22" title="РРґРµС‚ СЃС‚СЂРѕРёС‚РµР»СЊСЃС‚РІРѕ">рџЏ—пёЏ ${bus.construction_days_left} РґРЅ.</span>` : `<span style="color:#e74c3c">Р—Р°РєСЂС‹С‚Рѕ</span>`);
        li.innerHTML = `<span class="holding-name" style="color:#3498db; text-decoration:underline;">${bName}</span><span class="holding-value">${statusText}</span>`;
        holdingsList.appendChild(li);
    });
}

// --- РЎРёСЃС‚РµРјР° РЎРѕС…СЂР°РЅРµРЅРёР№ / Р—Р°РіСЂСѓР·РєРё ---














/**
 * (РќРћР’РђРЇ Р¤РЈРќРљР¦РРЇ) РЎРѕС…СЂР°РЅСЏРµС‚ С…СЌРЅРґР» РґРёСЂРµРєС‚РѕСЂРёРё РІ IndexedDB РґР»СЏ РїРѕСЃС‚РѕСЏРЅРЅРѕРіРѕ С…СЂР°РЅРµРЅРёСЏ.
 * @param {FileSystemDirectoryHandle} dirHandle РҐСЌРЅРґР» РґР»СЏ СЃРѕС…СЂР°РЅРµРЅРёСЏ.
 */


/**
 * РќР°СЃС‚СЂР°РёРІР°РµС‚ СѓРїСЂР°РІР»РµРЅРёРµ РёРЅС‚РµСЂР°РєС‚РёРІРЅРѕР№ РєР°СЂС‚РѕР№ (РїР°РЅРѕСЂР°РјРёСЂРѕРІР°РЅРёРµ Рё Р·СѓРј).
 */
function setupMapControls() { if (window.Cartographer) Cartographer.init(); }

/**
 * РџСЂРµРѕР±СЂР°Р·СѓРµС‚ СЌРєСЂР°РЅРЅС‹Рµ РєРѕРѕСЂРґРёРЅР°С‚С‹ РІ РјРёСЂРѕРІС‹Рµ.
 */


/**
 * РћРїСЂРµРґРµР»СЏРµС‚ С‚РёРї Р»РѕРєР°С†РёРё РїРѕ РµРµ РЅР°Р·РІР°РЅРёСЋ РґР»СЏ РІС‹Р±РѕСЂР° РёРєРѕРЅРєРё.
 */










function handleBeforeUnload(event) {
    // РњС‹ РїРѕР»РЅРѕСЃС‚СЊСЋ СѓР±РёСЂР°РµРј РїРѕРїС‹С‚РєСѓ Р°СЃРёРЅС…СЂРѕРЅРЅРѕРіРѕ СЃРѕС…СЂР°РЅРµРЅРёСЏ РїСЂРё СЌРєСЃС‚СЂРµРЅРЅРѕРј Р·Р°РєСЂС‹С‚РёРё РѕРєРЅР° (РЅР°Р¶Р°С‚РёРµ РЅР° РєСЂРµСЃС‚РёРє).
    // Р’ Electron Р°СЃРёРЅС…СЂРѕРЅРЅС‹Рµ IPC-РІС‹Р·РѕРІС‹ (invoke) РІРѕ РІСЂРµРјСЏ СЃРѕР±С‹С‚РёСЏ beforeunload 
    // РІС‹Р·С‹РІР°СЋС‚ Р¶РµСЃС‚РєРёР№ deadlock (Р·Р°РІРёСЃР°РЅРёРµ "РќРµ РѕС‚РІРµС‡Р°РµС‚"), С‚Р°Рє РєР°Рє РїСЂРѕС†РµСЃСЃ СЂРµРЅРґРµСЂРµСЂР° СѓР¶Рµ СѓРЅРёС‡С‚РѕР¶Р°РµС‚СЃСЏ.
    console.log("РћРєРЅРѕ Р·Р°РєСЂС‹РІР°РµС‚СЃСЏ. РћС‡РёСЃС‚РєР° РїСЂРѕС†РµСЃСЃРѕРІ...");
    stopAutoSaveTimer();
    stopBackgroundChanger();
    pauseMusic();
    if (speechSynthesis && speechSynthesis.speaking) {
        speechSynthesis.cancel();
    }
}

// --- Р’С‹С…РѕРґ РёР· РёРіСЂС‹ ---
async function exitToMainMenu() {
    console.log("Р—Р°РїСЂРѕСЃ РІС‹С…РѕРґР° РІ РјРµРЅСЋ.");
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


// --- Р¤СѓРЅРєС†РёРё РЈРїСЂР°РІР»РµРЅРёСЏ Р¤РѕРЅРѕРј ---
function changeBackground() {
    if (!backgroundContainer || backgroundFiles.length === 0) {
        console.warn("РљРѕРЅС‚РµР№РЅРµСЂ С„РѕРЅР° РёР»Рё СЃРїРёСЃРѕРє С„Р°Р№Р»РѕРІ РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚/РїСѓСЃС‚.");
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

    console.log(`РЎРјРµРЅР° С„РѕРЅР° РЅР°: ${filePath}`);

    const newElement = document.createElement(isVideo ? 'video' : 'img');
    newElement.src = filePath;
    newElement.dataset.fileName = fileName; // Р”Р»СЏ РѕС‚Р»Р°РґРєРё

    newElement.addEventListener('error', (e) => {
        console.error(`РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё РјРµРґРёР° С„РѕРЅР°: ${fileName}`, e);
        if (newElement.parentNode === backgroundContainer) backgroundContainer.removeChild(newElement);
        if (currentBackgroundElement === newElement) {
            currentBackgroundElement = null;
            // РЈРґР°Р»СЏРµРј Р±РёС‚С‹Р№ С„Р°Р№Р» РёР· СЃРїРёСЃРєР°, С‡С‚РѕР±С‹ РЅРµ РїС‹С‚Р°С‚СЊСЃСЏ Р·Р°РіСЂСѓР·РёС‚СЊ РµРіРѕ СЃРЅРѕРІР°
            const failedIndex = backgroundFiles.indexOf(fileName);
            if (failedIndex > -1) backgroundFiles.splice(failedIndex, 1);
            setTimeout(changeBackground, 1000); // РџРѕРїСЂРѕР±РѕРІР°С‚СЊ РґСЂСѓРіРѕР№ С„РѕРЅ С‡РµСЂРµР· СЃРµРєСѓРЅРґСѓ
        }
    });

    if (isVideo) {
        newElement.autoplay = true;
        newElement.muted = true;
        newElement.loop = true;
        newElement.playsInline = true; // Р”Р»СЏ iOS
        newElement.setAttribute('preload', 'auto');
        newElement.addEventListener('loadeddata', () => showNewBackground(newElement), { once: true });
    } else { // img
        newElement.onload = () => showNewBackground(newElement);
    }

    backgroundContainer.appendChild(newElement); // Р”РѕР±Р°РІР»СЏРµРј РЅРѕРІС‹Р№ СЌР»РµРјРµРЅС‚ РІ РєРѕРЅС‚РµР№РЅРµСЂ
}

function showNewBackground(elementToShow) {
    if (!elementToShow || elementToShow.parentNode !== backgroundContainer) {
        // Р­Р»РµРјРµРЅС‚ РјРѕРі Р±С‹С‚СЊ СѓРґР°Р»РµРЅ РёР·-Р·Р° РѕС€РёР±РєРё Р·Р°РіСЂСѓР·РєРё РґРѕ РІС‹Р·РѕРІР° СЌС‚РѕР№ С„СѓРЅРєС†РёРё
        console.warn("showNewBackground: СЌР»РµРјРµРЅС‚ РЅРµ РЅР°Р№РґРµРЅ РІ РєРѕРЅС‚РµР№РЅРµСЂРµ РёР»Рё РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚.");
        return;
    }

    const oldElement = currentBackgroundElement;
    currentBackgroundElement = elementToShow; // РќРѕРІС‹Р№ СЌР»РµРјРµРЅС‚ СЃС‚Р°РЅРѕРІРёС‚СЃСЏ С‚РµРєСѓС‰РёРј

    requestAnimationFrame(() => { // РџР»Р°РІРЅРѕРµ РїРѕСЏРІР»РµРЅРёРµ
        elementToShow.classList.add('visible');
    });

    if (oldElement && oldElement !== elementToShow) { // Р•СЃР»Рё Р±С‹Р» СЃС‚Р°СЂС‹Р№ С„РѕРЅ Рё РѕРЅ РЅРµ С‚РѕС‚ Р¶Рµ СЃР°РјС‹Р№
        oldElement.classList.remove('visible'); // РџР»Р°РІРЅРѕРµ РёСЃС‡РµР·РЅРѕРІРµРЅРёРµ СЃС‚Р°СЂРѕРіРѕ
        const removeOldElement = () => {
            if (oldElement && oldElement.parentNode === backgroundContainer) {
                backgroundContainer.removeChild(oldElement);
                // console.log("РЈРґР°Р»РµРЅ СЃС‚Р°СЂС‹Р№ С„РѕРЅ:", oldElement.dataset.fileName);
            }
        };
        // РЈРґР°Р»СЏРµРј СЃС‚Р°СЂС‹Р№ СЌР»РµРјРµРЅС‚ РїРѕСЃР»Рµ Р·Р°РІРµСЂС€РµРЅРёСЏ Р°РЅРёРјР°С†РёРё РёСЃС‡РµР·РЅРѕРІРµРЅРёСЏ
        oldElement.addEventListener('transitionend', removeOldElement, { once: true });
        // Fallback, РµСЃР»Рё transitionend РЅРµ СЃСЂР°Р±РѕС‚Р°РµС‚ (РЅР°РїСЂРёРјРµСЂ, РµСЃР»Рё СЌР»РµРјРµРЅС‚ Р±С‹Р» СЃРєСЂС‹С‚ display:none)
        setTimeout(removeOldElement, 2000); // 2 СЃРµРєСѓРЅРґС‹
    }
}

function startBackgroundChanger() {
    stopBackgroundChanger();
    if (backgroundFiles.length > 0) {
        changeBackground(); // РџРѕРєР°Р·Р°С‚СЊ РїРµСЂРІС‹Р№ С„РѕРЅ СЃСЂР°Р·Сѓ
        if (backgroundFiles.length > 1 && BACKGROUND_CHANGE_INTERVAL > 0) {
            backgroundChangeTimer = setInterval(changeBackground, BACKGROUND_CHANGE_INTERVAL);
            // Track for cleanup
            if (!window._activeTimers) window._activeTimers = [];
            window._activeTimers.push(backgroundChangeTimer);
            console.log(`РЎРјРµРЅР° С„РѕРЅР° Р·Р°РїСѓС‰РµРЅР° СЃ ${backgroundFiles.length} С„Р°Р№Р»Р°РјРё.`);
        }
    } else {
        console.warn("РќРµ СѓРґР°РµС‚СЃСЏ Р·Р°РїСѓСЃС‚РёС‚СЊ СЃРјРµРЅСѓ С„РѕРЅР°: РјР°СЃСЃРёРІ backgroundFiles РїСѓСЃС‚.");
        if (backgroundContainer) backgroundContainer.style.backgroundColor = '#1a2530'; // Fallback С†РІРµС‚
    }
}

function stopBackgroundChanger() {
    if (backgroundChangeTimer) {
        clearInterval(backgroundChangeTimer);
        backgroundChangeTimer = null;
        console.log("РЎРјРµРЅР° С„РѕРЅР° РѕСЃС‚Р°РЅРѕРІР»РµРЅР°.");
    }
}

// Р­Р¤Р¤Р•РљРў РџРђР РђР›Р›РђРљРЎРђ Р”Р›РЇ Р¤РћРќРђ
document.addEventListener('mousemove', (e) => {
    // РЈР±СЂР°Р»Рё РїСЂРѕРІРµСЂРєСѓ if (!player), С‚РµРїРµСЂСЊ СЂР°Р±РѕС‚Р°РµС‚ РІСЃРµРіРґР°
    const moveX = (e.clientX - window.innerWidth / 2) * 0.01; // РЎРјРµС‰РµРЅРёРµ 1%
    const moveY = (e.clientY - window.innerHeight / 2) * 0.01;

    // РЈСЃС‚Р°РЅР°РІР»РёРІР°РµРј CSS РїРµСЂРµРјРµРЅРЅС‹Рµ
    document.documentElement.style.setProperty('--parallax-x', `${-moveX}px`);
    document.documentElement.style.setProperty('--parallax-y', `${-moveY}px`);
});

// Р”РѕРїРѕР»РЅРёС‚РµР»СЊРЅРѕ: РўСЂСЏСЃРєР° СЌРєСЂР°РЅР° РїСЂРё РїРѕР»СѓС‡РµРЅРёРё СѓСЂРѕРЅР° (РІС‹Р·С‹РІР°Р№ СЌС‚Сѓ С„СѓРЅРєС†РёСЋ РІ executeCommand)
function shakeScreen() {
    const container = document.querySelector('.game-container');
    if (container) {
        container.style.animation = 'none';
        container.offsetHeight; // С‚СЂРёРіРіРµСЂ РїРµСЂРµСЂРёСЃРѕРІРєРё
        container.style.animation = 'goldShakeAnim 0.4s ease-in-out';
    }
}

// --- РЎРРЎРўР•РњРђ Р—Р’РЈРљРћР’ РРќРўР•Р Р¤Р•Р™РЎРђ ---
const hoverSfx = new Audio('assets/sound/ui_hover.mp3');
const clickSfx = new Audio('assets/sound/ui_click.mp3');

// РќР°СЃС‚СЂРѕР№РєР° РіСЂРѕРјРєРѕСЃС‚Рё (С‡С‚РѕР±С‹ РЅРµ РїСѓРіР°С‚СЊ РёРіСЂРѕРєР°)
function updateSfxVolume() {
    hoverSfx.volume = sfxVolume * 0.2; // Hover С‚РёС€Рµ РєР»РёРєР°
    clickSfx.volume = sfxVolume * 0.4;
}
updateSfxVolume();

// Р¤СѓРЅРєС†РёСЏ РґР»СЏ РїСЂРѕРёРіСЂС‹РІР°РЅРёСЏ Р±РµР· Р·Р°РґРµСЂР¶РµРє
function playSfx(audioObj) {
    audioObj.currentTime = 0; // РЎР±СЂРѕСЃ РІ РЅР°С‡Р°Р»Рѕ, С‡С‚РѕР±С‹ РјРѕР¶РЅРѕ Р±С‹Р»Рѕ СЃРїР°РјРёС‚СЊ Р·РІСѓРєРѕРј
    audioObj.play().catch(() => { }); // РРіРЅРѕСЂРёСЂСѓРµРј РѕС€РёР±РєРё Р°РІС‚РѕРїР»РµСЏ
}

// Р“Р»РѕР±Р°Р»СЊРЅС‹Р№ СЃР»СѓС€Р°С‚РµР»СЊ РЅР°РІРµРґРµРЅРёСЏ
let lastHoverSoundTime = 0;
document.addEventListener('mouseover', (e) => {
    // РџСЂРѕРІРµСЂСЏРµРј, СЏРІР»СЏРµС‚СЃСЏ Р»Рё СЌР»РµРјРµРЅС‚ РєРЅРѕРїРєРѕР№ РёР»Рё РЅР°С…РѕРґРёС‚СЃСЏ Р»Рё РѕРЅ РІРЅСѓС‚СЂРё РєРЅРѕРїРєРё/СЃР»РѕС‚Р°/РІРєР»Р°РґРєРё
    const target = e.target.closest('button, .equipment-slot-v2, .tab-button, .save-slot-btn, .tag-chip, li.quest-item, li[data-item-id]');

    if (target) {
        const now = Date.now();
        if (now - lastHoverSoundTime > 1000) { // Р—Р°РґРµСЂР¶РєР° 1 СЃРµРєСѓРЅРґР° (debounce)
            playSfx(hoverSfx);
            lastHoverSoundTime = now;
        }
    }
}, true);

// Р“Р»РѕР±Р°Р»СЊРЅС‹Р№ СЃР»СѓС€Р°С‚РµР»СЊ РєР»РёРєР°
document.addEventListener('mousedown', (e) => {
    const target = e.target.closest('button, .equipment-slot-v2, .tab-button, .save-slot-btn, .tag-chip, li.quest-item, li[data-item-id]');

    if (target) {
        playSfx(clickSfx);
    }
}, true);

// --- Р—Р°РїСѓСЃРє РїСЂРёР»РѕР¶РµРЅРёСЏ ---

function renderVisualMap() { 
    if (window.Cartographer) {
        Cartographer.fetchMapData().then(() => {
            Cartographer.render();
        });
    }
}








// --- Р­Р¤Р¤Р•РљРў РџРђР РђР›Р›РђРљРЎРђ Р РђРўРњРћРЎР¤Р•Р Рђ ---
document.addEventListener('mousemove', (e) => {
    const moveX = (e.clientX - window.innerWidth / 2) * 0.01;
    const moveY = (e.clientY - window.innerHeight / 2) * 0.01;
    document.documentElement.style.setProperty('--parallax-x', `${-moveX}px`);
    document.documentElement.style.setProperty('--parallax-y', `${-moveY}px`);
});
document.addEventListener('DOMContentLoaded', initializeApp);


// ================================================
//  generateVisionImage вЂ” РРЎРџР РђР’Р›Р•РќРќРђРЇ Р’Р•Р РЎРРЇ Р”Р›РЇ LLMOST
//  (РїРѕРґРґРµСЂР¶РєР° google/gemini-*-image Рё nano-banana)
// ================================================
async function generateVisionImage(prompt) {
    const imgProvider = document.getElementById('img-provider-select')?.value || 'pollinations';
    const imgModel = (document.getElementById('img-model-input')?.value || '').trim();

    console.log(`[Vision] Р“РµРЅРµСЂР°С†РёСЏ. РџСЂРѕРІР°Р№РґРµСЂ: ${imgProvider}, РјРѕРґРµР»СЊ: ${imgModel || 'default'}`);

    let url, headers = {}, body = {};

    // ====================== LLMOST ======================
    if (imgProvider === 'llmost') {
        const baseUrl = window.LLMOST_API_URL || 'https://llmost.ru/api/v1';
        url = `${baseUrl}/chat/completions`;

        const key = document.getElementById('llmost-api-key-input')?.value?.trim() 
                    || localStorage.getItem('llmostApiKey');

        if (!key) throw new Error('вќЊ LLMost API Key РЅРµ РЅР°Р№РґРµРЅ РІ РЅР°СЃС‚СЂРѕР№РєР°С…');

        headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
        };

        const model = imgModel || 'google/gemini-2.5-flash-image';

        // Р”Р»СЏ РјРѕРґРµР»РµР№ СЃ РєР°СЂС‚РёРЅРєР°РјРё РґРµР»Р°РµРј С‡РёСЃС‚С‹Р№ РїСЂРѕРјРїС‚ Р±РµР· Р»РёС€РЅРёС… РёРЅСЃС‚СЂСѓРєС†РёР№
        body = {
            model: model,
            messages: [
                { role: "user", content: prompt }   // в†ђ РїСЂРѕСЃС‚Рѕ РѕРїРёСЃР°РЅРёРµ, Р±РµР· "РѕС‚РІРµС‚СЊ С‚РѕР»СЊРєРѕ СЃСЃС‹Р»РєРѕР№"
            ],
            max_tokens: 2048,
            temperature: 0.75
        };
    }

    // ====================== Pollinations (Р±РµР· РёР·РјРµРЅРµРЅРёР№) ======================
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

    // ====================== OpenRouter (Р±РµР· РёР·РјРµРЅРµРЅРёР№) ======================
    else if (imgProvider === 'openrouter') {
        // ... (РѕСЃС‚Р°РІР»СЏРµРј РєР°Рє Р±С‹Р»Рѕ, РµСЃР»Рё РЅСѓР¶РЅРѕ вЂ” РјРѕРіСѓ С‚РѕР¶Рµ РѕР±РЅРѕРІРёС‚СЊ)
        // РїРѕРєР° РїСЂРѕРїСѓСЃРєР°РµРј, С‚.Рє. РїСЂРѕР±Р»РµРјР° СЃРµР№С‡Р°СЃ РІ LLMost
    }

    // ====================== РћР‘Р©РР™ POST-Р·Р°РїСЂРѕСЃ РґР»СЏ LLMost Рё OpenRouter ======================
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

        // === РќРћР’РђРЇ Р›РћР“РРљРђ Р РђР—Р‘РћР Рђ РћРўР’Р•РўРђ LLMOST ===
        let imageUrl = null;
        const message = data.choices?.[0]?.message;

        if (message) {
            // 1. РћСЃРЅРѕРІРЅРѕР№ СЃРїРѕСЃРѕР± Сѓ LLMost (Gemini image РјРѕРґРµР»Рё)
            if (message.images && message.images.length > 0) {
                const imgObj = message.images[0];
                imageUrl = imgObj.image_url?.url || imgObj.url;
            }
            // 2. Fallback вЂ” РµСЃР»Рё РІРґСЂСѓРі РІ content Р»РµР¶РёС‚ base64
            else if (typeof message.content === 'string' && message.content.startsWith('data:image')) {
                imageUrl = message.content;
            }
            // 3. РџРѕСЃР»РµРґРЅРёР№ fallback
            else if (typeof message.content === 'string' && message.content.includes('base64')) {
                imageUrl = message.content;
            }
        }

        if (!imageUrl) {
            console.error('вќЊ LLMost РІРµСЂРЅСѓР» РѕС‚РІРµС‚ Р±РµР· РёР·РѕР±СЂР°Р¶РµРЅРёСЏ:', data);
            throw new Error('РњРѕРґРµР»СЊ РЅРµ РІРµСЂРЅСѓР»Р° РёР·РѕР±СЂР°Р¶РµРЅРёРµ. РџРѕРїСЂРѕР±СѓР№ РґСЂСѓРіСѓСЋ РјРѕРґРµР»СЊ (nano-banana-2 РёР»Рё gpt-5-image-mini)');
        }

        console.log('[Vision] вњ… РР·РѕР±СЂР°Р¶РµРЅРёРµ РїРѕР»СѓС‡РµРЅРѕ (base64)');

        return {
            success: true,
            imageUrl: imageUrl,        // СЌС‚Рѕ СѓР¶Рµ РіРѕС‚РѕРІС‹Р№ data:image/png;base64,...
            provider: imgProvider,
            raw: data
        };
    }
}

// ==========================================
// --- Р¤РЈРќРљР¦РР РђР”РњРРќ РњР•РќР® (DEBUG) ---
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
            <h4 style="margin: 0 0 10px 0; color: #f1c40f;">рџ’° Р‘С‹СЃС‚СЂС‹Рµ РґРµР№СЃС‚РІРёСЏ</h4>
            <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                <input type="number" id="admin-gold-input" value="1000" style="width: 100px; padding: 5px; color: #fff; background: rgba(0,0,0,0.5); border: 1px solid #f1c40f;">
                <button data-action="admin-add-gold" style="background: #27ae60; margin: 0; padding: 5px 15px; min-width: auto;">+ Р—РѕР»РѕС‚Рѕ</button>
                <button data-action="admin-heal" style="background: #e74c3c; margin: 0; padding: 5px 15px; min-width: auto;">Full HP/MP</button>
                <button data-action="admin-force-summary" style="background: #8e44ad; margin: 0; padding: 5px 15px; min-width: auto;">РЎР¶Р°С‚СЊ РїР°РјСЏС‚СЊ (Summarize)</button>
                <button data-action="toggle-autotester" id="admin-autotester-btn" style="background: #e67e22; margin: 0; padding: 5px 15px; min-width: auto;">рџ¤– РђРІС‚Рѕ-РўРµСЃС‚РµСЂ: Р’Р«РљР›</button>
                <button data-action="toggle-localization" style="background: #34495e; margin: 0; padding: 5px 15px; min-width: auto;">рџЊђ Р›РѕРєР°Р»РёР·Р°С†РёСЏ: ${window.DISABLE_LOCALIZATION ? 'Р’Р«РљР›' : 'Р’РљР›'}</button>
            </div>
        </div>

        <div style="margin-bottom: 20px; background: rgba(0,0,0,0.3); padding: 10px; border-radius: 5px; border-left: 3px solid #9b59b6;">
            <h4 style="margin: 0 0 10px 0; color: #9b59b6;">вЏі РњР°С€РёРЅР° Р’СЂРµРјРµРЅРё Рё РџР°РјСЏС‚СЊ</h4>
            <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                <button onclick="adminSetTurn(28)" style="background: #8e44ad; margin: 0; padding: 5px 15px; min-width: auto;" title="РЎР»РµРґСѓСЋС‰РёР№ С…РѕРґ РІС‹Р·РѕРІРµС‚ СЃР¶Р°С‚РёРµ РїР°РјСЏС‚Рё (29)">РҐРѕРґ = 28 (РўРµСЃС‚ РЎР¶Р°С‚РёСЏ)</button>
                <button onclick="adminSetTurn(29)" style="background: #8e44ad; margin: 0; padding: 5px 15px; min-width: auto;" title="РЎР»РµРґСѓСЋС‰РёР№ С…РѕРґ РІС‹Р·РѕРІРµС‚ РѕС‡РёСЃС‚РєСѓ РёСЃС‚РѕСЂРёРё (30)">РҐРѕРґ = 29 (РўРµСЃС‚ РћС‡РёСЃС‚РєРё)</button>
                <button onclick="adminInjectMemory()" style="background: #2980b9; margin: 0; padding: 5px 15px; min-width: auto;">Р’РїСЂС‹СЃРЅСѓС‚СЊ С„РµР№РєРѕРІСѓСЋ РїР°РјСЏС‚СЊ</button>
                <button onclick="runUnitTests()" style="background: #2c3e50; border: 1px solid #5dade2; margin: 0; padding: 5px 15px; min-width: auto;">рџ§Є Р—Р°РїСѓСЃС‚РёС‚СЊ Unit-С‚РµСЃС‚С‹</button>
            </div>
            <p style="margin: 5px 0 0 0; font-size: 0.85em; color: #bdc3c7;">РўРµРєСѓС‰РёР№ С…РѕРґ: <b style="color:#fff">${player.stats.turnCount}</b></p>
        </div>
    `;

    html += `<div style="display: flex; gap: 20px; flex-wrap: wrap;">`;

    // Р›РµРІР°СЏ РєРѕР»РѕРЅРєР°: РћРєСЂСѓР¶РµРЅРёРµ
    html += `<div style="flex: 1; min-width: 300px; background: rgba(0,0,0,0.3); padding: 10px; border-radius: 5px; border-left: 3px solid #e74c3c;">
                <h4 style="margin: 0 0 10px 0; color: #e74c3c;">рџЋ­ РћРєСЂСѓР¶РµРЅРёРµ (NPC/Р’СЂР°РіРё)</h4>
                <ul style="list-style: none; padding: 0; margin: 0;">`;

    const entities = Object.values(player.visibleEntities || {});
    if (entities.length === 0) html += `<li style="color: #7f8c8d; font-size: 0.9em;">РќРёРєРѕРіРѕ РЅРµС‚ СЂСЏРґРѕРј</li>`;
    entities.forEach(ent => {
        html += `<li style="margin-bottom: 8px; font-size: 0.9em; border-bottom: 1px dashed rgba(255,255,255,0.1); padding-bottom: 5px;">
                    <strong style="color: ${ent.isHostile ? '#e74c3c' : '#5dade2'}">${ent.name}</strong> [HP: ${ent.stats.hp}/${ent.stats.maxHp}]
                    <div style="margin-top: 5px; display: flex; gap: 5px;">
                        <button onclick="adminKillEntity('${ent.id}')" style="background: #c0392b; padding: 2px 8px; font-size: 0.8em; margin: 0; min-width: auto;">РЈР±РёС‚СЊ (0 HP)</button>
                        <button onclick="adminRemoveEntity('${ent.id}')" style="background: #7f8c8d; padding: 2px 8px; font-size: 0.8em; margin: 0; min-width: auto;">РЈРґР°Р»РёС‚СЊ</button>
                    </div>
                 </li>`;
    });
    html += `</ul></div>`;

    // РџСЂР°РІР°СЏ РєРѕР»РѕРЅРєР°: Nexus
    html += `<div style="flex: 1; min-width: 300px; background: rgba(0,0,0,0.3); padding: 10px; border-radius: 5px; border-left: 3px solid #3498db;">
                <h4 style="margin: 0 0 10px 0; color: #3498db;">рџ”® РљРѕРЅСЃС‚Р°РЅС‚С‹ (Nexus)</h4>
                <ul style="list-style: none; padding: 0; margin: 0;">`;

    const nexusItems = Object.values(player.nexusData || {});
    if (nexusItems.length === 0) html += `<li style="color: #7f8c8d; font-size: 0.9em;">РќРµС‚ Р°РєС‚РёРІРЅС‹С… РєРѕРЅСЃС‚Р°РЅС‚</li>`;
    nexusItems.forEach(item => {
        html += `<li style="margin-bottom: 8px; font-size: 0.9em; border-bottom: 1px dashed rgba(255,255,255,0.1); padding-bottom: 5px;">
                    <strong style="color: #5dade2">${item.name}</strong>: <span style="color: #f1c40f">${item.value}</span>
                    <div style="margin-top: 5px; display: flex; gap: 5px;">
                        <button onclick="adminEditNexus('${item.id}')" style="background: #2980b9; padding: 2px 8px; font-size: 0.8em; margin: 0; min-width: auto;">РР·РјРµРЅРёС‚СЊ</button>
                        <button onclick="adminDeleteNexus('${item.id}')" style="background: #c0392b; padding: 2px 8px; font-size: 0.8em; margin: 0; min-width: auto;">РЈРґР°Р»РёС‚СЊ</button>
                    </div>
                 </li>`;
    });
    html += `</ul></div>`;

    html += `</div>`;

    if (DEBUG_MODE && typeof World !== 'undefined' && World) {
        html += '<div style="margin-top: 20px; border-top: 2px solid #5dade2; padding-top: 10px;"><h3 style="color:#5dade2; margin-top:0;">Р“Р›РћР‘РђР›Р¬РќРђРЇ РЎРРњРЈР›РЇР¦РРЇ</h3></div>';
        
        // 1. Р¤Р РђРљР¦РР
        html += '<div class="debug-card"><div class="debug-card-title"><span>рџЏ›пёЏ Р¤Р РђРљР¦РР</span></div><div class="debug-grid">';
        for (let fId in World.factions) {
            let f = World.factions[fId];
            let isPlayer = (f.rulerId === 'player');
            let wars = [];
            for (let t in f.diplomacy) { if (f.diplomacy[t] === "war" && World.factions[t]) wars.push(World.factions[t].name); }
            let warText = wars.length > 0 ? `<br><span style="color:#e74c3c; font-size:0.85em;">вљ”пёЏ Р’РѕР№РЅР°: ${wars.join(', ')}</span>` : '';
            
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
                     рџ’°${formatNum(gold)} | рџ›ЎпёЏ${formatNum(manpower)}
                     ${warText}
                     </div>`;
        }
        html += '</div></div>';

        // 2. РђР РњРР Р РћРЎРђР”Р«
        html += '<div class="debug-card"><div class="debug-card-title"><span>вљ”пёЏ РђРљРўРР’РќРћРЎРўР¬ Р’РћР™РЎРљ</span></div>';
        let armiesExist = false;
        for (let fId in World.factions) {
            World.factions[fId].armies.forEach(a => {
                armiesExist = true;
                let dest = World.regions[a.destination] ? World.regions[a.destination].name : a.destination;
                
                let statusText = '';
                if (a.daysToMove > 0) {
                    statusText = `Р’ РїСѓС‚Рё (РѕСЃС‚Р°Р»РѕСЃСЊ ${a.daysToMove} РґРЅ.)`;
                } else if (a.siegeDays > 0) {
                    statusText = `<b style="color:#e67e22">РћРЎРђР”Рђ</b> (РѕСЃС‚Р°Р»РѕСЃСЊ ${a.siegeDays} РґРЅ.)`;
                } else {
                    let phaseName = a.current_phase;
                    if (phaseName === 'vanguard_clash') phaseName = 'РЎС‚С‹С‡РєР° Р°РІР°РЅРіР°СЂРґРѕРІ';
                    else if (phaseName === 'main_battle') phaseName = 'РћСЃРЅРѕРІРЅРѕРµ СЃСЂР°Р¶РµРЅРёРµ';
                    else if (phaseName === 'rout') phaseName = 'РћС‚СЃС‚СѓРїР»РµРЅРёРµ';
                    statusText = `<b style="color:#e74c3c">Р‘РћР™: ${phaseName}</b>`;
                }

                let armyName = World.factions[fId].rulerId === 'player' ? "рџ‘‘ Р’Р°С€Р° Р°СЂРјРёСЏ" : World.factions[fId].name;

                html += `<div class="debug-army-item">
                            <b>${armyName}</b> (${a.size} РµРґ.) вћ” <b>${dest}</b><br>
                            РЎС‚Р°С‚СѓСЃ: ${statusText}
                         </div>`;
            });
        }
        if (!armiesExist) html += '<div style="color:#7f8c8d; font-style:italic; padding:5px;">РќРµС‚ Р°РєС‚РёРІРЅС‹С… РїРµСЂРµРґРІРёР¶РµРЅРёР№ РІРѕР№СЃРє</div>';
        html += '</div>';
    
        // 3. РџР РђР’РРўР•Р›Р Р РРќРўР РР“Р
        html += '<div class="debug-card"><div class="debug-card-title"><span>рџ‘‘ РџР РђР’РРўР•Р›Р Р РРќРўР РР“Р</span></div><div class="debug-grid">';
        if(World.rulers) {
            for(let rId in World.rulers) {
                let r = World.rulers[rId];
                if(!r.alive || r.id.includes("_heir")) continue;
                let goal = r.gmOverride ? `<b style="color:#e74c3c">[GM] ${r.gmOverride}</b>` : (r.currentGoal ? `${r.currentGoal.type} -> ${r.currentGoal.targetFactionId}` : "РќРµС‚ С†РµР»Рё");
                html += `<div class="debug-item">
                         <b style="color:#9b59b6">${r.name}</b> (${World.factions[r.factionId]?.name || r.factionId})<br>
                         HP: ${r.health}% | РђРјР±РёС†РёРё: ${r.personality.ambition}<br>
                         Р¦РµР»СЊ: ${goal}
                         </div>`;
            }
        }
        html += '</div>';
    
        if(World.intrigues && World.intrigues.length > 0) {
            html += '<div style="margin-top:10px; border-top:1px dashed #555; padding-top:5px;"><b>РђРєС‚РёРІРЅС‹Рµ Р·Р°РіРѕРІРѕСЂС‹:</b><br>';
            World.intrigues.forEach(i => {
                let phaseName = i.phase;
                if (phaseName === 'recruitment') phaseName = 'Р’РµСЂР±РѕРІРєР°';
                else if (phaseName === 'espionage') phaseName = 'РЁРїРёРѕРЅР°Р¶';
                else if (phaseName === 'execution') phaseName = 'РСЃРїРѕР»РЅРµРЅРёРµ';
                else if (phaseName === 'cover_up') phaseName = 'Р—Р°РјРµС‚Р°РЅРёРµ СЃР»РµРґРѕРІ';
                html += `<span style="color:${i.isDiscovered ? '#e74c3c' : '#f39c12'}">[${i.type}]</span> ${i.initiatorFactionId} -> ${i.targetFactionId} (Р¤Р°Р·Р°: ${phaseName}, РџСЂРѕРіСЂРµСЃСЃ: ${Math.floor(i.progress)}/${i.requiredProgress})<br>`;
            });
            html += '</div>';
        }
        html += '</div>';
    }

    setTimeout(() => {
        const btn = document.getElementById('admin-autotester-btn');
        if (btn) btn.innerHTML = isAutoTesting ? 'рџ¤– РђРІС‚Рѕ-РўРµСЃС‚РµСЂ: Р’РљР›' : 'рџ¤– РђРІС‚Рѕ-РўРµСЃС‚РµСЂ: Р’Р«РљР›';
    }, 50);

    content.innerHTML = html;
}

window.adminAddGold = function () {
    const val = parseInt(document.getElementById('admin-gold-input').value) || 0;
    executeCommand('addItem', { aiIdentifier: 'gold', name: 'Р—РѕР»РѕС‚Рѕ', quantity: val });
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
    addLogMessage("[ADMIN] Р—Р°РїСѓСЃРє РіР»СѓР±РѕРєРѕР№ Р°СЂС…РёРІР°С†РёРё РїР°РјСЏС‚Рё...", "system-message");
    showLoadingScreen('loadingScreen.generatingWorld', 'РЎР¶Р°С‚РёРµ РїР°РјСЏС‚Рё...');

    try {
        const promptTemplate = await loadPromptFromFile('assets/promts/summarize_memory_prompt.txt');
        const historyText = conversationHistory.map(m => `${m.role === 'model' ? 'GM' : 'Player'}: ${m.parts[0].text}`).join('\n\n');
        const notesText = JSON.stringify(player.gmNotes, null, 2);

        const finalPrompt = promptTemplate
            .replace('{gmNotes}', notesText)
            .replace('{conversationHistory}', historyText)
            .replace('{userAction}', 'РџСЂРёРЅСѓРґРёС‚РµР»СЊРЅР°СЏ Р°СЂС…РёРІР°С†РёСЏ');

        let modelId = localModelId;
        if (currentApiProvider === 'gemini') modelId = geminiModelId;
        else if (currentApiProvider === 'llmost') modelId = llmostModelId;
        else if (currentApiProvider === 'openrouter') modelId = openrouterModelId;
        else if (currentApiProvider === 'deepseek') modelId = deepseekModelId;
        else if (currentApiProvider === 'omniroute') modelId = omnirouteModelId;
        
        // РџРђРўР§: РџРµСЂРµРґР°РµРј РѕР±СЏР·Р°С‚РµР»СЊРЅС‹Р№ currentInput, С‡С‚РѕР±С‹ Gemini РЅРµ СЂСѓРіР°Р»СЃСЏ РЅР° РїСѓСЃС‚РѕР№ РјР°СЃСЃРёРІ contents
        const rawResponse = await performAiFetch(finalPrompt, [], modelId, "РџСЂРѕР°РЅР°Р»РёР·РёСЂСѓР№ РёСЃС‚РѕСЂРёСЋ Рё РѕР±РЅРѕРІРё РїР°РјСЏС‚СЊ (JSON).");
        const result = parseAIResponse(rawResponse);

        if (result.actions && result.actions.length > 0) {
            for (const action of result.actions) {
                await executeCommand(action.command, action.args);
            }
            addLogMessage("РџР°РјСЏС‚СЊ СѓСЃРїРµС€РЅРѕ СЃР¶Р°С‚Р° Рё Р·Р°Р°СЂС…РёРІРёСЂРѕРІР°РЅР°.", "command-feedback");
        } else {
            addLogMessage("GM РЅРµ РЅР°С€РµР» РґР°РЅРЅС‹С… РґР»СЏ Р°СЂС…РёРІР°С†РёРё.", "command-feedback");
        }
    } catch (e) {
        console.error(e);
        addLogMessage("РћС€РёР±РєР° Р°СЂС…РёРІР°С†РёРё: " + e.message, "system-message");
    } finally {
        hideLoadingScreen();
    }
};

window.adminKillEntity = function (internalId) {
    const ent = player.visibleEntities[internalId];
    if (ent) {
        // РћР±РЅСѓР»СЏРµРј HP, РґРІРёР¶РѕРє СЃР°Рј РѕР±СЂР°Р±РѕС‚Р°РµС‚ СЃРјРµСЂС‚СЊ Рё РІС‹РґР°СЃС‚ РѕРїС‹С‚
        executeCommand('updateEntityStat', { aiIdentifier: ent.aiIdentifier, stat: 'hp', value: 0 });
        populateAdminMenu();
    }
};

window.adminRemoveEntity = function (internalId) {
    const ent = player.visibleEntities[internalId];
    if (ent) {
        // РџСЂРѕСЃС‚Рѕ СѓРґР°Р»СЏРµРј Р±РµР· СЃРјРµСЂС‚Рё
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
    const newVal = prompt(`Р’РІРµРґРёС‚Рµ РЅРѕРІРѕРµ Р·РЅР°С‡РµРЅРёРµ РґР»СЏ '${item.name}':`, item.value);
    if (newVal !== null) {
        executeCommand('nexusUpdate', { id: id, value: newVal });
        populateAdminMenu();
    }
};

// ==========================================
// --- UNIT РўР•РЎРўР« (Р’РЎРўР РћР•РќРќР«Р™ Р¤Р Р•Р™РњР’РћР Рљ) ---
// ==========================================
window.runUnitTests = function () {
    addLogMessage("[DEV] рџ§Є Р—Р°РїСѓСЃРє Unit-С‚РµСЃС‚РѕРІ...", "system-message");
    console.group("рџ§Є UNIT TESTS RUN");

    let passed = 0;
    let failed = 0;

    function assertEqual(testName, actual, expected) {
        if (actual === expected) {
            console.log(`вњ… [PASSED] ${testName}`);
            passed++;
        } else {
            console.error(`вќЊ [FAILED] ${testName} | РћР¶РёРґР°Р»РѕСЃСЊ: ${expected}, РџРѕР»СѓС‡РµРЅРѕ: ${actual}`);
            failed++;
        }
    }

    // РњРѕРєР°РµРј С„СѓРЅРєС†РёСЋ СЃС‚Р°РЅРґР°СЂС‚РёР·Р°С†РёРё Р°СЂРіСѓРјРµРЅС‚РѕРІ РґР»СЏ РїСЂРѕРІРµСЂРєРё
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
        // РўР•РЎРў 1: aiIdentifier РєРѕРЅРІРµСЂС‚РёСЂСѓРµС‚СЃСЏ РІ id
        let res1 = mockMiddleware('addItem', { aiIdentifier: 'sword_1' });
        assertEqual('Middleware: aiIdentifier -> id', res1.id, 'sword_1');

        // РўР•РЎРў 2: key РєРѕРЅРІРµСЂС‚РёСЂСѓРµС‚СЃСЏ РІ id
        let res2 = mockMiddleware('setMemory', { key: 'plot_1' });
        assertEqual('Middleware: key -> id', res2.id, 'plot_1');

        // РўР•РЎРў 3: effectId РєРѕРЅРІРµСЂС‚РёСЂСѓРµС‚СЃСЏ РІ id
        let res3 = mockMiddleware('applyPredefinedEffect', { effectId: 'burn' });
        assertEqual('Middleware: effectId -> id', res3.id, 'burn');

        // РўР•РЎРў 4: id СЂР°Р·РјРЅРѕР¶Р°РµС‚СЃСЏ РЅР° СЃС‚Р°СЂС‹Рµ РєР»СЋС‡Рё
        let res4 = mockMiddleware('addQuest', { id: 'quest_1' });
        assertEqual('Middleware: id -> aiIdentifier', res4.aiIdentifier, 'quest_1');
        assertEqual('Middleware: id -> key', res4.key, 'quest_1');

        // РўР•РЎРў 5: Р­РєСЃС‚СЂРµРЅРЅС‹Р№ С„РёРєСЃ РєРІРµСЃС‚РѕРІ (title -> id)
        let res5 = mockMiddleware('updateQuest', { title: 'РЈР±РёС‚СЊ РєСЂС‹СЃ', status: 'completed' });
        assertEqual('Middleware: Quest title -> id', res5.id, 'РЈР±РёС‚СЊ РєСЂС‹СЃ');
        assertEqual('Middleware: Quest title -> aiIdentifier', res5.aiIdentifier, 'РЈР±РёС‚СЊ РєСЂС‹СЃ');

    } catch (e) {
        console.error("РљСЂРёС‚РёС‡РµСЃРєР°СЏ РѕС€РёР±РєР° РІРѕ РІСЂРµРјСЏ С‚РµСЃС‚РѕРІ:", e);
        failed++;
    }

    console.groupEnd();

    const resultMsg = `[DEV] РўРµСЃС‚С‹ Р·Р°РІРµСЂС€РµРЅС‹. РЈСЃРїРµС€РЅРѕ: ${passed}, РџСЂРѕРІР°Р»РµРЅРѕ: ${failed}. РџРѕРґСЂРѕР±РЅРѕСЃС‚Рё РІ РєРѕРЅСЃРѕР»Рё (F12).`;
    addLogMessage(resultMsg, failed === 0 ? "level-up" : "system-message");
};


window.adminSetTurn = function (turnNumber) {
    if (!player) return;
    player.stats.turnCount = turnNumber;
    addLogMessage(`[DEV] РҐРѕРґ СѓСЃС‚Р°РЅРѕРІР»РµРЅ РЅР° ${turnNumber}. РЎРґРµР»Р°Р№ Р»СЋР±РѕРµ РґРµР№СЃС‚РІРёРµ РІ С‡Р°С‚Рµ, С‡С‚РѕР±С‹ РїСЂРѕРІРµСЂРёС‚СЊ С‚СЂРёРіРіРµСЂС‹ РР.`, "system-message");
    updateCharacterSheet();
    populateAdminMenu();
};

window.adminInjectMemory = function () {


// РЎС‚Р°СЂР°СЏ РєРѕРїРёСЏ СѓРґР°Р»РµРЅР° РїР°С‚С‡РµРј;;;;
    if (!player) return;
    if (!player.gmNotes) player.gmNotes = {};

    const testId = Math.floor(Math.random() * 1000);
    player.gmNotes[`Test_NPC_${testId}`] = "РўРѕСЂРіРѕРІРµС† Р‘РѕР±. РћС‡РµРЅСЊ Р¶Р°РґРЅС‹Р№. РћР±РµС‰Р°Р» РёРіСЂРѕРєСѓ СЃРєРёРґРєСѓ, РµСЃР»Рё С‚РѕС‚ РїСЂРёРЅРµСЃРµС‚ РµРјСѓ С€РєСѓСЂСѓ РІРѕР»РєР°.";
    player.gmNotes[`Test_Lore_${testId}`] = "РРіСЂРѕРє СѓР·РЅР°Р», С‡С‚Рѕ РјСЌСЂ РіРѕСЂРѕРґР° С‚Р°Р№РЅРѕ РїРѕРєР»РѕРЅСЏРµС‚СЃСЏ РєСѓР»СЊС‚Сѓ Р‘РµР·РґРЅС‹.";

    addLogMessage(`[DEV] Р’ РїР°РјСЏС‚СЊ GM РґРѕР±Р°РІР»РµРЅС‹ 2 С‚РµСЃС‚РѕРІС‹С… Р±Р»РѕРєР° (NPC Рё Lore).`, "command-feedback");
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
                <span class="ether-text-title" id="deep-setup-title">Р“Р»СѓР±РѕРєР°СЏ РіРµРЅРµСЂР°С†РёСЏ...</span>
                <span class="ether-text-subtitle" id="deep-setup-sub">РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ</span>
            </div>
            <button class="ether-cancel-btn" data-action="cancel-api">
                <i class="fas fa-times"></i> РџСЂРµСЂРІР°С‚СЊ СЃРІСЏР·СЊ
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
            return `РњРёСЂ: ${DEFAULT_WORLD_ID} | Р­РїРѕС…Р°: ${player.era}\nРРіСЂРѕРє: ${player.name} (${player.race}, ${player.class}${genderText})\nР РµР¶РёРј СЃС‚Р°СЂС‚Р°: ${player.startMode}\nРћРїРёСЃР°РЅРёРµ РѕС‚ РёРіСЂРѕРєР°: "${player.description}"`;
        };

        // --- STAGE 1 ---
        updateLoader("Р­С‚Р°Рї 1/5: РќРёС‚Рё РЎСѓРґСЊР±С‹", "РЎРѕР·РґР°РЅРёРµ Р±РёРѕРіСЂР°С„РёРё Рё РјРѕС‚РёРІРѕРІ...");
        let p1 = await loadPromptFromFile('assets/promts/deep_setup/stage1_lore.txt');
        p1 = p1.replace('{base_context}', getBaseContext()).replace('{lore}', worldLore);
        let r1 = await performAiFetch(p1, [], modelIdForRequest, "РЎРіРµРЅРµСЂРёСЂСѓР№ Р±РёРѕРіСЂР°С„РёСЋ Рё РєРѕРЅСЃС‚Р°РЅС‚С‹ (JSON).");
        let res1 = parseAIResponse(r1);
        let stage_1_results = JSON.stringify(res1.actions || []);
        for (const a of (res1.actions || [])) await executeCommand(a.command, a.args);

        // --- STAGE 2 ---
        updateLoader("Р­С‚Р°Рї 2/5: РњР°С‚РµСЂРёР°Р»СЊРЅРѕРµ РЅР°СЃР»РµРґРёРµ", "РљРѕРІРєР° СЃРЅР°СЂСЏР¶РµРЅРёСЏ Рё РЅР°РІС‹РєРѕРІ...");
        let p2 = await loadPromptFromFile('assets/promts/deep_setup/stage2_loot.txt');
        p2 = p2.replace('{base_context}', getBaseContext())
               .replace('{itemsReference}', JSON.stringify(itemsReferenceData.slice(0, 50)))
               .replace('{skillsReference}', skillsReferenceData)
               .replace('{stage_1_results}', stage_1_results);
        let r2 = await performAiFetch(p2, [], modelIdForRequest, "Р’С‹РґР°Р№ СЃС‚Р°СЂС‚РѕРІРѕРµ СЃРЅР°СЂСЏР¶РµРЅРёРµ Рё РЅР°РІС‹РєРё (JSON).");
        let res2 = parseAIResponse(r2);
        let stage_2_results = JSON.stringify(res2.actions || []);
        for (const a of (res2.actions || [])) await executeCommand(a.command, a.args);

        // --- STAGE 3 ---
        updateLoader("Р­С‚Р°Рї 3/5: РЎС†РµРЅР° Рё РђРєС‚РµСЂС‹", "Р’РѕР·РІРµРґРµРЅРёРµ РґРµРєРѕСЂР°С†РёР№ Рё NPC...");
        let p3 = await loadPromptFromFile('assets/promts/deep_setup/stage3_environment.txt');
        const mapCoordsString = Object.keys(globalLocations || {}).map(k => `${globalLocations[k].name} [ID: ${k}] (x:${Math.round(globalLocations[k].x)}, y:${Math.round(globalLocations[k].y)})`).join('; ');
        p3 = p3.replace('{base_context}', getBaseContext())
               .replace('{globalLocationsList}', mapCoordsString)
               .replace('{environmentCommandsGuide}', environmentCommandsGuideData)
               .replace('{stage_1_results}', stage_1_results)
               .replace('{stage_2_results}', stage_2_results)
               .replace('{stage_3_results}', stage_3_results + (window.smartDeepContextStr || ""));
        let r3 = await performAiFetch(p3, [], modelIdForRequest, "РЎРѕР·РґР°Р№ Р»РѕРєР°С†РёСЋ Рё РѕРєСЂСѓР¶РµРЅРёРµ (JSON).");
        let res3 = parseAIResponse(r3);
        let stage_3_results = JSON.stringify(res3.actions || []);
        
        for (const action of (res3.actions || [])) {
            if (action.command === 'renderLocation' && enableLocalMap) {
                updateLoader("Р­С‚Р°Рї 3/5: РЎС†РµРЅР° Рё РђРєС‚РµСЂС‹", "РћС‚СЂРёСЃРѕРІРєР° РїР»Р°РЅР° РјРµСЃС‚РЅРѕСЃС‚Рё...");
                const locDesc = action.args.description || `Р›РѕРєР°С†РёСЏ: ${player.location}`;
                // const generatedPlots = await generateLocalMapFromAI(locDesc, action.args.size || "15x15"); // РћР¶РёРґР°РµС‚ СЂРµР°Р»РёР·Р°С†РёРё РЅР° РґРІРёР¶РєРµ
                // action.args.plots = generatedPlots;
            }
            await executeCommand(action.command, action.args);
        }

        // --- STAGE 4 ---
        updateLoader("Р­С‚Р°Рї 4/5: Р—РѕРІ РЎСѓРґСЊР±С‹", "Р¤РѕСЂРјРёСЂРѕРІР°РЅРёРµ СЃСЋР¶РµС‚Р° Рё РєРІРµСЃС‚РѕРІ...");
        let p4 = await loadPromptFromFile('assets/promts/deep_setup/stage4_quests.txt');
        p4 = p4.replace('{base_context}', getBaseContext())
               .replace('{stage_1_results}', stage_1_results)
               .replace('{stage_2_results}', stage_2_results)
               .replace('{stage_3_results}', stage_3_results + (window.smartDeepContextStr || ""))
               .replace('{stage_3_results}', stage_3_results);
        let r4 = await performAiFetch(p4, [], modelIdForRequest, "Р’С‹РґР°Р№ РєРІРµСЃС‚ Рё РёРЅРёС†РёРёСЂСѓР№ СЃРѕР±С‹С‚РёСЏ (JSON).");
        let res4 = parseAIResponse(r4);
        let stage_4_results = JSON.stringify(res4.actions || []);
        for (const a of (res4.actions || [])) await executeCommand(a.command, a.args);

        // --- STAGE 5 ---
        updateLoader("Р­С‚Р°Рї 5/5: РџСЂРѕР»РѕРі", "РћР¶РёРґР°РЅРёРµ Р Р°СЃСЃРєР°Р·С‡РёРєР°...");
                let p5 = await loadPromptFromFile('assets/promts/deep_setup/stage5_prologue.txt');
        let imgExample = enableImageGeneration ? '"image_prompt": "Ado music video aesthetic, monochrome with red accent...",' : '';

        window.smartDeepContextStr = "";
        if (typeof World !== 'undefined' && World) {
            let r = World.regions[player.location] || Object.values(World.regions).find(reg => player.location.includes(reg.name));
            if (r) {
                let activeMonsters = (World.monsters || []).filter(m => m.health > 0 && m.region_id === r.id);
                if (activeMonsters.length > 0) window.smartDeepContextStr += `\n[РљР РРўРР§Р•РЎРљРђРЇ РЈР“Р РћР—Рђ]: Р’ Р»РѕРєР°С†РёРё Р­РџРР§Р•РЎРљРћР• Р§РЈР”РћР’РР©Р•: ${activeMonsters.map(m => m.name).join(', ')}! РћРїРёС€Рё РµРіРѕ РїСЂРёСЃСѓС‚СЃС‚РІРёРµ!\n`;
                let activeDisasters = (World.map && World.map.disasters) ? World.map.disasters.filter(d => d.days_active > 0 && d.affected_regions.includes(r.id)) : [];
                if (activeDisasters.length > 0) window.smartDeepContextStr += `\n[Р‘Р•Р”РЎРўР’РР•]: Р—РґРµСЃСЊ Р±СѓС€СѓРµС‚ ${activeDisasters.map(d => d.type).join(', ')}! РћРїРёС€Рё СЌС‚Рѕ!\n`;
            }
            if (World.news && World.news.length > 0) {
                let epicHistory = World.news.filter(n => n.importance >= 4).sort((a, b) => (a.day || 0) - (b.day || 0)).slice(-40);
                if (epicHistory.length > 0) {
                    window.smartDeepContextStr += `\n=== Р’Р•Р›РРљРђРЇ Р›Р•РўРћРџРРЎР¬ РњРР Рђ ===\n` + epicHistory.map(n => `[Р“РѕРґ ${Math.floor((n.day||0)/360)+1} | ${n.location}]: ${parseLocString(n.text)}`).join("\n") + `\nРўР« РћР‘РЇР—РђРќ СѓРїРѕРјСЏРЅСѓС‚СЊ СЌС‚Рё РёСЃС‚РѕСЂРёС‡РµСЃРєРёРµ СЃРѕР±С‹С‚РёСЏ РІ РїСЂРѕР»РѕРіРµ!\n`;
                }
            }
        }

        let deepDynamicContext = "";
        if (typeof World !== 'undefined' && World) {
            let r = World.regions[player.location] || Object.values(World.regions).find(reg => player.location.includes(reg.name));
            if (r) {
                let activeMonsters = (World.monsters || []).filter(m => m.health > 0 && m.region_id === r.id);
                if (activeMonsters.length > 0) deepDynamicContext += `\n[РљР РРўРР§Р•РЎРљРђРЇ РЈР“Р РћР—Рђ]: Р’ Р»РѕРєР°С†РёРё Р­РџРР§Р•РЎРљРћР• Р§РЈР”РћР’РР©Р•: ${activeMonsters.map(m => m.name).join(', ')}! РћРїРёС€Рё РµРіРѕ РїСЂРёСЃСѓС‚СЃС‚РІРёРµ!\n`;
                let activeDisasters = (World.map && World.map.disasters) ? World.map.disasters.filter(d => d.days_active > 0 && d.affected_regions.includes(r.id)) : [];
                if (activeDisasters.length > 0) deepDynamicContext += `\n[Р‘Р•Р”РЎРўР’РР•]: Р—РґРµСЃСЊ Р±СѓС€СѓРµС‚ ${activeDisasters.map(d => d.type).join(', ')}! РћРїРёС€Рё СЌС‚Рѕ!\n`;
            }
            if (World.news && World.news.length > 0) {
                let currentDay = (World.current_day !== undefined ? World.current_day : Math.floor((World.tick || 0) / 24));
                let recentNews = World.news.map(n => ({ ...n, daysOld: Math.max(0, currentDay - (n.day || 0)) })).filter(n => n.daysOld <= 720 && ['war', 'disaster', 'politics'].includes(n.category)).sort((a, b) => a.daysOld - b.daysOld).slice(0, 15);
                if (recentNews.length > 0) {
                    deepDynamicContext += `\n=== РќР•Р”РђР’РќРЇРЇ РРЎРўРћР РРЇ (РџРћРЎР›Р•Р”РЎРўР’РРЇ РџР Р•-РЎРРњРЈР›РЇР¦РР) ===\n` + recentNews.map(n => `[${n.daysOld} РґРЅ. РЅР°Р·Р°Рґ, Р›РѕРєР°С†РёСЏ: ${n.location}] ${parseLocString(n.text)}`).join("\n") + `\nРўР« РћР‘РЇР—РђРќ СѓРїРѕРјСЏРЅСѓС‚СЊ СЌС‚Рё СЃРѕР±С‹С‚РёСЏ РІ РїСЂРѕР»РѕРіРµ!\n`;
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
        let r5 = await performAiFetch(p5, [], modelIdForRequest, "РќР°РїРёС€Рё С…СѓРґРѕР¶РµСЃС‚РІРµРЅРЅС‹Р№ РїСЂРѕР»РѕРі (JSON).");
        let res5 = parseAIResponse(r5);

        // --- FINALIZE ---
        removeLoader();
        hideLoadingScreen();

        if (!res5 || !res5.narrative) throw new Error("GM РЅРµ СЃРјРѕРі СЃРіРµРЅРµСЂРёСЂРѕРІР°С‚СЊ СЃС‚Р°СЂС‚РѕРІСѓСЋ СЃС†РµРЅСѓ РЅР° Р­С‚Р°РїРµ 5.");

        if (res5.ai_reasoning) {
            addCalculationMessage(`[РњР«РЎР›Р РР (РџСЂРѕР»РѕРі)]:\n${res5.ai_reasoning}`, "calc-info");
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
        console.error("РћС€РёР±РєР° Deep Setup:", error);
        removeLoader();
        showAiErrorModal(
            error.stack || error.message || String(error),
            true,
            () => {
                showLoadingScreen('loadingScreen.generatingWorld', 'Р“РµРЅРµСЂР°С†РёСЏ РјРёСЂР°...');
                runDeepSetupPipeline(narratorStyleGuide);
            }
        );
    }
}


// --- Р­РљРЎРџР•Р РРњР•РќРўРђР›Р¬РќР«Р™ Р”Р’РР–РћРљ РЎРРњРЈР›РЇР¦РР (JS-DRIVEN) ---


// --- РћР‘РќРћР’Р›Р•РќРР• РџРђРќР•Р›Р РЎРРњРЈР›РЇР¦РР РњРР Рђ (DEBUG) ---
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
                     рџ’°${formatNum(gold)} | рџ›ЎпёЏ${formatNum(manpower)}
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
                            <span style="color:#ecf0f1;">${t('extraLoc.debugPanel.army')} (${a.size} С‡РµР».)</span><br>
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
                    if (phaseName === 'vanguard_clash') phaseName = 'РЎС‚С‹С‡РєР° Р°РІР°РЅРіР°СЂРґРѕРІ';
                    else if (phaseName === 'main_battle') phaseName = 'РћСЃРЅРѕРІРЅРѕРµ СЃСЂР°Р¶РµРЅРёРµ';
                    else if (phaseName === 'rout') phaseName = 'РћС‚СЃС‚СѓРїР»РµРЅРёРµ';
                    statusText = `<b style="color:#e74c3c">${t('extraLoc.debugPanel.battle', {phase: phaseName})}</b>`;
                }

                let armyName = World.factions[fId].rulerId === 'player' ? `рџ‘‘ ${t('extraLoc.debugPanel.yourArmy')}` : World.factions[fId].name;

                html += `<div class="debug-army-item">
                            <b>${armyName}</b> (${a.size} РµРґ.) вћ” <b>${dest}</b><br>
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
                if (phaseName === 'recruitment') phaseName = 'Р’РµСЂР±РѕРІРєР°';
                else if (phaseName === 'espionage') phaseName = 'РЁРїРёРѕРЅР°Р¶';
                else if (phaseName === 'execution') phaseName = 'РСЃРїРѕР»РЅРµРЅРёРµ';
                else if (phaseName === 'cover_up') phaseName = 'Р—Р°РјРµС‚Р°РЅРёРµ СЃР»РµРґРѕРІ';
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
// --- РЎРРЎРўР•РњРђ РџР РђР’РРўР•Р›Р•Р™, Р”РРџР›РћРњРђРўРР Р РРќРўР РР“ ---
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
        traits: ["РђРјР±РёС†РёРѕР·РЅС‹Р№", "РҐРёС‚СЂС‹Р№"],
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
                generateWorldNews(`РЎРњР•РќРђ Р’Р›РђРЎРўР: ${r.name} РјРµСЂС‚РІ. РўСЂРѕРЅ Р·Р°РЅРёРјР°РµС‚ ${heir.name}.`, "global", 5, 'misc');
                
                // РќР°СЃР»РµРґРЅРёРє СЃС‚Р°РЅРѕРІРёС‚СЃСЏ РїСЂР°РІРёС‚РµР»РµРј
                let newRulerId = r.factionId + "_ruler_" + Date.now();
                heir.id = newRulerId;
                World.rulers[newRulerId] = heir;
                World.factions[r.factionId].rulerId = newRulerId;
                
                // РЎРѕР·РґР°РµРј РЅРѕРІРѕРіРѕ РЅР°СЃР»РµРґРЅРёРєР°
                let newHeirId = r.factionId + "_heir_" + Date.now();
                World.rulers[newHeirId] = createRulerForFaction(newHeirId, World.factions[r.factionId], player?.era || getRuntimeDefaultEraId(), true);
                heir.heir = newHeirId;
                
                delete World.rulers[r.heir]; // РЈРґР°Р»СЏРµРј СЃС‚Р°СЂСѓСЋ Р·Р°РїРёСЃСЊ РЅР°СЃР»РµРґРЅРёРєР°
            } else {
                generateWorldNews(`РљР РР—РРЎ: ${r.name} РјРµСЂС‚РІ, Рё РЅР°СЃР»РµРґРЅРёРєРѕРІ РЅРµС‚! Р¤СЂР°РєС†РёСЏ РїРѕРіСЂСѓР¶Р°РµС‚СЃСЏ РІ С…Р°РѕСЃ.`, "global", 5, 'disaster');
                // Р’РјРµСЃС‚Рѕ СЃС‚Р°Р±РёР»СЊРЅРѕСЃС‚Рё - С„РёР·РёС‡РµСЃРєРѕРµ РїРѕСЃР»РµРґСЃС‚РІРёРµ: Р±СѓРЅС‚ СѓРЅРёС‡С‚РѕР¶Р°РµС‚ СЂРµСЃСѓСЂСЃС‹ СЃС‚РѕР»РёС†С‹
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
            // РџСЂР°РІРёС‚РµР»СЊ Р±РѕР»СЊС€Рµ РЅРµ С‚РµСЂСЏРµС‚ Р·РґРѕСЂРѕРІСЊРµ РѕС‚ СЃС‚Р°СЂРµРЅРёСЏ РІ main thread - СЌС‚Рѕ РѕР±СЂР°Р±Р°С‚С‹РІР°РµС‚СЃСЏ РІ world_worker.js
        }
    }
}


// ======================================================================
// --- РЎРРЎРўР•РњРђ РџР РђР’РРўР•Р›Р•Р™, Р”РРџР›РћРњРђРўРР Р РРќРўР РР“ (FULL V2) ---
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
        traits: ["РђРјР±РёС†РёРѕР·РЅС‹Р№", "РҐРёС‚СЂС‹Р№"],
        health: requireRuntimeNumber(getRulerEntityCommandDefaults().health_percent, 'gameplay_runtime.command_defaults.ruler_entity.health_percent'),
        alive: true,
        heir: isHeir ? null : id + "_heir",
        currentGoal: null,
        gmOverride: null,
        lastTickDay: 0,
        // РРЅС‚РµРіСЂР°С†РёСЏ РєР°Рє NPC
        aiIdentifier: id,
        profession: isHeir ? "РќР°СЃР»РµРґРЅРёРє" : "РџСЂР°РІРёС‚РµР»СЊ",
        currentLocation: "capital",
        currentActivity: "РЈРїСЂР°РІР»СЏРµС‚ РіРѕСЃСѓРґР°СЂСЃС‚РІРѕРј",
        schedule: [],
        needs: { hunger: requireRuntimeNumber(rulerNeedsDefaults.hunger, 'gameplay_runtime.command_defaults.ruler_entity.needs.hunger'), rest: requireRuntimeNumber(rulerNeedsDefaults.rest, 'gameplay_runtime.command_defaults.ruler_entity.needs.rest'), social: requireRuntimeNumber(rulerNeedsDefaults.social, 'gameplay_runtime.command_defaults.ruler_entity.needs.social'), safety: requireRuntimeNumber(rulerNeedsDefaults.safety, 'gameplay_runtime.command_defaults.ruler_entity.needs.safety') },
        relationships: {}, memory: [], inventory: { gold: requireRuntimeNumber(getRulerEntityCommandDefaults().inventory?.gold, 'gameplay_runtime.command_defaults.ruler_entity.inventory.gold'), items: {} },
        economy: { skillLevel: requireRuntimeNumber(rulerEconomyDefaults.skill_level, 'gameplay_runtime.command_defaults.ruler_entity.economy.skill_level'), isEmployed: true, workplaceId: null, dailyWage: requireRuntimeNumber(rulerEconomyDefaults.daily_wage, 'gameplay_runtime.command_defaults.ruler_entity.economy.daily_wage'), savings: requireRuntimeNumber(rulerEconomyDefaults.savings, 'gameplay_runtime.command_defaults.ruler_entity.economy.savings') },
        plotArmor: Boolean(getRulerEntityCommandDefaults().plot_armor), travelDestination: null, travelHoursLeft: 0, isHostile: false, xpReward: requireRuntimeNumber(getRulerEntityCommandDefaults().xp_reward, 'gameplay_runtime.command_defaults.ruler_entity.xp_reward')
    };
}

// Р¤СѓРЅРєС†РёРё processRulerDiplomacy Рё processIntrigues СѓРґР°Р»РµРЅС‹ - РѕРЅРё РґСѓР±Р»РёСЂРѕРІР°Р»РёСЃСЊ Рё РЅР°С…РѕРґРёР»РёСЃСЊ С‚РѕР»СЊРєРѕ РІ world_worker.js
// РЎРёРјСѓР»СЏС†РёСЏ СЂР°Р±РѕС‚Р°РµС‚ РёСЃРєР»СЋС‡РёС‚РµР»СЊРЅРѕ РІ РІРѕСЂРєРµСЂРµ, СЌС‚Рё С„СѓРЅРєС†РёРё РІ main thread РЅРµ РЅСѓР¶РЅС‹

function checkRulerDeaths() {
    for (let rId in World.rulers) {
        let r = World.rulers[rId];
        if (r.alive && (r.health <= 0 || r.stats.hp <= 0)) {
            r.alive = false;
            if (World.npcs[rId]) World.npcs[rId].isAlive = false; // РЎРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ СЃ NPC
            
            if (r.heir && World.rulers[r.heir]) {
                let heir = World.rulers[r.heir];
                World.factions[r.factionId].rulerId = heir.id;
                generateWorldNews(`РЎРњР•РќРђ Р’Р›РђРЎРўР: ${r.name} РјРµСЂС‚РІ. РўСЂРѕРЅ Р·Р°РЅРёРјР°РµС‚ ${heir.name}.`, "global", 5, 'misc');
                
                // РќР°СЃР»РµРґРЅРёРє СЃС‚Р°РЅРѕРІРёС‚СЃСЏ РїСЂР°РІРёС‚РµР»РµРј
                let newRulerId = r.factionId + "_ruler_" + Date.now();
                heir.id = newRulerId;
                heir.aiIdentifier = newRulerId;
                heir.profession = "РџСЂР°РІРёС‚РµР»СЊ";
                World.rulers[newRulerId] = heir;
                World.npcs[newRulerId] = heir; // Р”РѕР±Р°РІР»СЏРµРј РІ NPC
                World.factions[r.factionId].rulerId = newRulerId;
                
                // РЎРѕР·РґР°РµРј РЅРѕРІРѕРіРѕ РЅР°СЃР»РµРґРЅРёРєР°
                let newHeirId = r.factionId + "_heir_" + Date.now();
                let newHeir = createRulerForFaction(newHeirId, World.factions[r.factionId], player?.era || getRuntimeDefaultEraId(), true);
                World.rulers[newHeirId] = newHeir;
                World.npcs[newHeirId] = newHeir;
                heir.heir = newHeirId;
                
                delete World.rulers[r.heir]; 
                delete World.npcs[r.heir];
            } else {
                generateWorldNews(`РљР РР—РРЎ: ${r.name} РјРµСЂС‚РІ, Рё РЅР°СЃР»РµРґРЅРёРєРѕРІ РЅРµС‚! Р¤СЂР°РєС†РёСЏ РїРѕРіСЂСѓР¶Р°РµС‚СЃСЏ РІ С…Р°РѕСЃ.`, "global", 5, 'disaster');
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

// РРЅРёС†РёР°Р»РёР·Р°С†РёСЏ РїСЂРё Р·Р°РіСЂСѓР·РєРµ
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
            if (parsedLog.includes('РџСЂРѕРёР·РІРµРґРµРЅРѕ') || parsedLog.includes('Р”РѕР±С‹С‚Рѕ')) color = '#2ecc71';
            if (parsedLog.includes('РљР°СЂР°РІР°РЅ') || parsedLog.includes('РђРІС‚Рѕ-')) color = '#f39c12';
            if (parsedLog.includes('Р‘РђРќРљР РћРўРЎРўР’Рћ') || parsedLog.includes('РћРЁРР‘РљРђ') || parsedLog.includes('РћС€РёР±РєР°')) color = '#e74c3c';
            if (parsedLog.includes('РЎС‚СЂРѕРёС‚РµР»СЊСЃС‚РІРѕ')) color = '#3498db';
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
                        <span class="bus-stat-value">${bus.employee_count} / ${maxEmp} С‡РµР».</span>
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
                                <option value="transfer">рџ“¦ ${t('extraLoc.businessModal.export')}</option>
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
    
    const yesStr = t('extraLoc.general.yes', null, 'Р”Р°');
    const noStr = t('extraLoc.general.no', null, 'РќРµС‚');
    const existStr = t('extraLoc.general.exists', null, 'Р•СЃС‚СЊ');
    const notExistStr = t('extraLoc.general.notExists', null, 'РќРµС‚');

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
                html += `<li style="background: rgba(0,0,0,0.4); padding: 4px; margin-bottom: 2px; border-radius: 4px; border-left: 3px solid #f1c40f;">рџ“¦ ${getItemName(proto, player ? player.era : getRuntimeDefaultEraId())}: ${itemsMap[proto]} ${t('extraLoc.general.pcs', null, 'С€С‚.')}</li>`;
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
        if (s.type === "WAR_GALLEY" || s.type === "WAR_FRIGATE") icon = "в›ґпёЏ";
        if (s.type === "PIRATE") icon = "рџЏґвЂЌв пёЏ";
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

    if (amount <= 0) return alert("Р’РІРµРґРёС‚Рµ РєРѕСЂСЂРµРєС‚РЅРѕРµ РєРѕР»РёС‡РµСЃС‚РІРѕ.");
    if (isPercent && amount > 100) return alert("РџСЂРѕС†РµРЅС‚ РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ Р±РѕР»СЊС€Рµ 100.");

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
    if (isNaN(eff) || eff < 0 || eff > 100) return alert("Р’РІРµРґРёС‚Рµ Р·РЅР°С‡РµРЅРёРµ РѕС‚ 0 РґРѕ 100");
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
    if (count < 0) return alert("РљРѕР»РёС‡РµСЃС‚РІРѕ РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ РѕС‚СЂРёС†Р°С‚РµР»СЊРЅС‹Рј.");
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
            addLogMessage(`[Р‘РР—РќР•РЎ] РЈСЂРѕРІРµРЅСЊ Р·Р°СЂРїР»Р°С‚ РЅР° РїСЂРµРґРїСЂРёСЏС‚РёРё РёР·РјРµРЅРµРЅ РЅР° ${val}%.`, "command-feedback");
        }
    }
};

window.setBusinessMaintenance = async function(bId) {
    const val = parseInt(document.getElementById('bus-maint-slider').value);
    if (window.electronAPI && window.electronAPI.nexusManageBusiness) {
        const res = await window.electronAPI.nexusManageBusiness({ action: 'set_maintenance', args: { businessId: bId, value: val } });
        if (res.status === 'ok') {
            World.businesses[bId].maintenance_budget = val;
            addLogMessage(`[Р‘РР—РќР•РЎ] Р‘СЋРґР¶РµС‚ РЅР° РѕР±СЃР»СѓР¶РёРІР°РЅРёРµ РёР·РјРµРЅРµРЅ РЅР° ${val}%.`, "command-feedback");
        }
    }
};


window.depositBusinessCash = async function(bId) {
    const amount = parseInt(document.getElementById('bus-cash-input').value) || 0;
    if (amount <= 0 || player.stats.gold < amount) return alert("РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ Р·РѕР»РѕС‚Р° РІ РёРЅРІРµРЅС‚Р°СЂРµ!");
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
    if (amount <= 0 || World.businesses[bId].cash_balance < amount) return alert("РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ СЃСЂРµРґСЃС‚РІ РІ РєР°СЃСЃРµ РїСЂРµРґРїСЂРёСЏС‚РёСЏ!");
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
// --- РЎРРЎРўР•РњРђ AI-РР“Р РћРљРђ (РђР’РўРћ-РўР•РЎРўР•Р ) ---
// ==========================================

window.toggleAutoTester = function() {
    isAutoTesting = !isAutoTesting;
    aiPlayerCurrentTurns = 0;
    const btn = document.getElementById('admin-autotester-btn');
    if (btn) btn.innerHTML = isAutoTesting ? 'рџ¤– РђРІС‚Рѕ-РўРµСЃС‚РµСЂ: Р’РљР›' : 'рџ¤– РђРІС‚Рѕ-РўРµСЃС‚РµСЂ: Р’Р«РљР›';
    
    if (isAutoTesting) {
        addLogMessage(`[DEV] РђРІС‚Рѕ-С‚РµСЃС‚РµСЂ Р·Р°РїСѓС‰РµРЅ. Р›РёРјРёС‚ С…РѕРґРѕРІ: ${aiPlayerTurnLimit > 0 ? aiPlayerTurnLimit : 'Р‘РµР·Р»РёРјРёС‚'}.`, "system-message");
        if (!isWaitingForAI) runAIPlayerTurn();
    } else {
        addLogMessage("[DEV] РђРІС‚Рѕ-С‚РµСЃС‚РµСЂ РѕСЃС‚Р°РЅРѕРІР»РµРЅ. РЈРїСЂР°РІР»РµРЅРёРµ РІРѕР·РІСЂР°С‰РµРЅРѕ С‡РµР»РѕРІРµРєСѓ.", "system-message");
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
            throw new Error("РќРµРІРµСЂРЅС‹Р№ С„РѕСЂРјР°С‚ РѕС‚РІРµС‚Р° Gemini: " + JSON.stringify(data));
        }
    } else {
        if (data.choices && data.choices[0] && data.choices[0].message) {
            resultText = data.choices[0].message.content;
        } else {
            throw new Error("РќРµРІРµСЂРЅС‹Р№ С„РѕСЂРјР°С‚ РѕС‚РІРµС‚Р° (РЅРµС‚ choices[0]): " + JSON.stringify(data));
        }
    }

    // РћС‡РёСЃС‚РєР° РѕС‚ С‚РµРіРѕРІ СЂР°Р·РјС‹С€Р»РµРЅРёСЏ (DeepSeek-R1 Рё РїРѕРґРѕР±РЅС‹Рµ)
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
        if (btn) btn.innerHTML = 'рџ¤– РђРІС‚Рѕ-РўРµСЃС‚РµСЂ: Р’Р«РљР›';
        addLogMessage(`[DEV] РђРІС‚Рѕ-С‚РµСЃС‚РµСЂ Р·Р°РІРµСЂС€РёР» СЂР°Р±РѕС‚Сѓ (РґРѕСЃС‚РёРіРЅСѓС‚ Р»РёРјРёС‚ РІ ${aiPlayerTurnLimit} С…РѕРґРѕРІ).`, "system-message");
        return;
    }

    aiPlayerCurrentTurns++;
    console.log(`[Auto-Tester] Р¤РѕСЂРјРёСЂРѕРІР°РЅРёРµ Р·Р°РїСЂРѕСЃР°... (РҐРѕРґ ${aiPlayerCurrentTurns}/${aiPlayerTurnLimit > 0 ? aiPlayerTurnLimit : 'в€ћ'})`);
    
    const stateSnapshot = buildLitePlayerSnapshot();
    const recentLogs = player.gameLogHistory ? player.gameLogHistory.slice(-5).map(e => `${e.type === 'user-message' ? 'РЇ' : 'GM'}: ${e.message}`).join('\n') : "РќРµС‚ РЅРµРґР°РІРЅРёС… СЃРѕР±С‹С‚РёР№.";

    let systemPrompt = autoTesterPromptTemplate;
    if (!systemPrompt || systemPrompt.startsWith("РћС€РёР±РєР°:")) {
        systemPrompt = `РўС‹ РёРіСЂРѕРє РІ С‚РµРєСЃС‚РѕРІРѕР№ RPG. РЎРѕСЃС‚РѕСЏРЅРёРµ: ${stateSnapshot}\nР›РѕРіРё: ${recentLogs}\nРќР°РїРёС€Рё СЃРІРѕРµ РґРµР№СЃС‚РІРёРµ РѕС‚ РїРµСЂРІРѕРіРѕ Р»РёС†Р° (1-2 РїСЂРµРґР»РѕР¶РµРЅРёСЏ).`;
    } else {
        systemPrompt = systemPrompt
            .replace('{stateSnapshot}', stateSnapshot)
            .replace('{recentLogs}', recentLogs);
    }

    try {
        const aiAction = await performAiPlayerFetch(systemPrompt, [], aiPlayerModelId, "Р§С‚Рѕ С‚С‹ СЃРґРµР»Р°РµС€СЊ СЃРµР№С‡Р°СЃ?");
        
        if (!isAutoTesting) return; // РџСЂРѕРІРµСЂРєР°, РЅРµ РІС‹РєР»СЋС‡РёР»Рё Р»Рё РїРѕРєР° РР РґСѓРјР°Р»

        if (!aiAction || aiAction.trim() === "") {
            console.warn("[Auto-Tester] РџРѕР»СѓС‡РµРЅ РїСѓСЃС‚РѕР№ РѕС‚РІРµС‚. Р’РѕР·РјРѕР¶РЅРѕ, РјРѕРґРµР»СЊ РЅРµ СѓСЃРїРµР»Р° Р·Р°РІРµСЂС€РёС‚СЊ РјС‹СЃР»СЊ (hit token limit).");
            addLogMessage(`[DEV] РђРІС‚Рѕ-С‚РµСЃС‚РµСЂ РІРµСЂРЅСѓР» РїСѓСЃС‚РѕР№ РѕС‚РІРµС‚. РџСЂРѕРїСѓСЃРє С…РѕРґР°.`, "system-message");
            return;
        }

        // Р’СЃС‚Р°РІР»СЏРµРј С‚РµРєСЃС‚ РІ РёРЅРїСѓС‚ Рё РёРјРёС‚РёСЂСѓРµРј РѕС‚РїСЂР°РІРєСѓ
        if (userInput) {
            userInput.value = aiAction.trim();
            console.log("[Auto-Tester] Р”РµР№СЃС‚РІРёРµ:", userInput.value);
            handleUserInput();
        }
    } catch (e) {
        console.error("[Auto-Tester] РћС€РёР±РєР°:", e);
        addLogMessage(`[DEV] РћС€РёР±РєР° РђРІС‚Рѕ-С‚РµСЃС‚РµСЂР°: ${e.message}. РўРµСЃС‚РµСЂ РѕСЃС‚Р°РЅРѕРІР»РµРЅ.`, "system-message");
        isAutoTesting = false;
        const btn = document.getElementById('admin-autotester-btn');
        if (btn) btn.innerHTML = 'рџ¤– РђРІС‚Рѕ-РўРµСЃС‚РµСЂ: Р’Р«РљР›';
    }
}


// ==========================================
// --- UI OVERHAUL: РЎРРЎРўР•РњРђ Р’РљР›РђР”РћРљ ---
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

    // --- Р›РµРІС‹Р№ РЎР°Р№РґР±Р°СЂ ---
    const leftTabs = document.createElement('div');
    leftTabs.className = 'sidebar-tabs';
    leftTabs.innerHTML = `
        <button class="s-tab-btn active" data-target="left-tab-hero"><i class="fas fa-user-shield"></i> Р“РµСЂРѕР№</button>
        <button class="s-tab-btn" data-target="left-tab-gear"><i class="fas fa-shopping-bag"></i> РЎРЅР°СЂСЏР¶РµРЅРёРµ</button>
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

    // --- РџСЂР°РІС‹Р№ РЎР°Р№РґР±Р°СЂ ---
    const rightTabs = document.createElement('div');
    rightTabs.className = 'sidebar-tabs';
    rightTabs.innerHTML = `
        <button class="s-tab-btn active" data-target="right-tab-env" title="РћРєСЂСѓР¶РµРЅРёРµ"><i class="fas fa-map-marked-alt"></i></button>
        <button class="s-tab-btn" data-target="right-tab-journal" title="Р–СѓСЂРЅР°Р»"><i class="fas fa-book-open"></i></button>
        <button class="s-tab-btn" data-target="right-tab-prog" title="Р Р°Р·РІРёС‚РёРµ"><i class="fas fa-dna"></i></button>
        <button class="s-tab-btn" data-target="right-tab-econ" title="Р­РєРѕРЅРѕРјРёРєР°"><i class="fas fa-coins"></i></button>
        <button class="s-tab-btn" data-target="right-tab-sys" title="РЎРёСЃС‚РµРјР°"><i class="fas fa-cogs"></i></button>
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
        showCustomAlert("Р—Р°РіСЂСѓР·РєР° РјРёСЂРѕРІ РґРѕСЃС‚СѓРїРЅР° С‚РѕР»СЊРєРѕ РІ РґРµСЃРєС‚РѕРїРЅРѕР№ РІРµСЂСЃРёРё.");
        return;
    }

    if (!loadWorldModal || !worldSlotsContainer) return;

    worldSlotsContainer.innerHTML = '<p style="text-align:center; color:#5dade2; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Р§С‚РµРЅРёРµ РјРёСЂРѕРІ...</p>';
    loadWorldModal.style.display = 'flex';
    setTimeout(() => loadWorldModal.classList.add('visible'), 10);

    const worlds = await window.electronAPI.listWorlds();
    worldSlotsContainer.innerHTML = '';

    if (worlds.length === 0) {
        worldSlotsContainer.innerHTML = '<p style="text-align:center; color:#7f8c8d; padding: 20px;">РќРµС‚ СЃРѕС…СЂР°РЅРµРЅРЅС‹С… РјРёСЂРѕРІ.</p>';
        return;
    }

    worlds.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).forEach(w => {
        const btn = document.createElement('div');
        btn.className = 'save-slot-btn';
        btn.style.flexDirection = 'column';
        btn.style.alignItems = 'flex-start';
        btn.innerHTML = `
            <div style="display:flex; justify-content:space-between; width:100%;">
                <span class="save-slot-id" style="color:#f1c40f;">${w.name}</span>
                <span style="color:#bdc3c7; font-size:0.85em;">Р­РїРѕС…Р°: ${w.era}</span>
            </div>
            <div style="display:flex; justify-content:space-between; width:100%; margin-top:10px; align-items: center;">
                <span style="color:#7f8c8d; font-size:0.8em;">${new Date(w.timestamp).toLocaleString()}</span>
                <div style="display:flex; gap: 5px;">
                    <button class="bus-btn btn-green load-w-btn" data-file="${w.filename}" style="padding:6px 12px; font-size:0.85em; margin:0; min-width:auto;">Р’С‹Р±СЂР°С‚СЊ</button>
                    <button class="bus-btn btn-red del-w-btn" data-file="${w.filename}" style="padding:6px 12px; font-size:0.85em; margin:0; min-width:auto;">РЈРґР°Р»РёС‚СЊ</button>
                </div>
            </div>
        `;
        worldSlotsContainer.appendChild(btn);
    });

    worldSlotsContainer.querySelectorAll('.load-w-btn').forEach(b => {
        b.onclick = async (e) => {
            const file = e.target.dataset.file;
            worldSlotsContainer.innerHTML = '<p style="text-align:center; color:#f1c40f; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Р—Р°РіСЂСѓР·РєР° РјРёСЂР°...</p>';
            const wData = await window.electronAPI.loadWorldState(file);
            if (wData) {
                preloadedWorldData = wData;
                if (selectedWorldInfo) {
                    selectedWorldInfo.textContent = `Р’С‹Р±СЂР°РЅ РјРёСЂ: ${wData.name || file}`;
                    selectedWorldInfo.style.display = 'block';
                }
                
                if (wData.era && charEraSelect) {
                    charEraSelect.value = wData.era;
                    updateEraDescription();
                }
                
                loadWorldModal.classList.remove('visible');
                setTimeout(() => loadWorldModal.style.display = 'none', 300);
            } else {
                showCustomAlert("РћС€РёР±РєР° РїСЂРё Р·Р°РіСЂСѓР·РєРµ С„Р°Р№Р»Р° РјРёСЂР°.");
                openLoadWorldModal();
            }
        };
    });

    worldSlotsContainer.querySelectorAll('.del-w-btn').forEach(b => {
        b.onclick = async (e) => {
            const file = e.target.dataset.file;
            showCustomConfirm("РЈРґР°Р»РёС‚СЊ СЌС‚РѕС‚ РјРёСЂ РЅР°РІСЃРµРіРґР°?", async () => {
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
            const name = saveWorldNameInput.value.trim() || "Р‘РµР·С‹РјСЏРЅРЅС‹Р№_РњРёСЂ";
            const filename = `world_${Date.now()}.json`;
            World.name = name; 
            
            saveWorldConfirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> РЎРѕС…СЂР°РЅРµРЅРёРµ...';
            saveWorldConfirmBtn.disabled = true;
            saveWorldSkipBtn.disabled = true;

            await window.electronAPI.saveWorldState(filename, World);
            
            saveWorldConfirmBtn.innerHTML = 'РЎРѕС…СЂР°РЅРёС‚СЊ';
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

// === РРќРР¦РРђР›РР—РђР¦РРЇ РћР‘Р РђР‘РћРўР§РРљРћР’ Р”Р›РЇ Р­Р РћРўРР§Р•РЎРљРћР“Рћ Р–РЈР РќРђР›Рђ ===
// Р”РѕР±Р°РІР»СЏРµРј РѕР±СЂР°Р±РѕС‚С‡РёРє РґР»СЏ РєРЅРѕРїРєРё РѕС‡РёСЃС‚РєРё Р¶СѓСЂРЅР°Р»Р°
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        const clearEroticJournalBtn = document.getElementById('clear-erotic-journal-btn');
        if (clearEroticJournalBtn) {
            clearEroticJournalBtn.addEventListener('click', clearEroticJournal);
        }
    });
}
