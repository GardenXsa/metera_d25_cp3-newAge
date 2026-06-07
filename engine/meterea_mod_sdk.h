/**
 * meterea_mod_sdk.h — ModKit 3.0 Opaque C-API
 *
 * Stable ABI interface for native C++ plugins (DLL/SO).
 * All interaction between the engine core and mods goes through
 * strictly typed extern "C" functions — NO raw pointers to C++ objects.
 *
 * ⚠️ SECURITY WARNING: Native plugins (DLL/SO) run with FULL process
 * privileges. There is NO sandbox for native code. Only load plugins
 * from trusted sources. A malicious plugin can:
 *   - Access all memory (read/write)
 *   - Execute arbitrary system commands
 *   - Access the filesystem without restrictions
 *   - Modify the engine's internal state directly
 *
 * Mitigation: Engine should implement a plugin allowlist (whitelist)
 * that only loads signed/verified DLLs. See METERA_PLUGIN_ALLOWLIST below.
 *
 * Version: 3.0.0
 *
 * === PLUGIN LIFECYCLE ===
 *
 * 1. Engine loads DLL/SO via dlopen/LoadLibrary
 * 2. Engine calls MeteraPlugin_GetAPI() → plugin receives function table
 * 3. Engine calls MeteraPlugin_Init(plugin_id) → plugin registers callbacks
 * 4. Engine calls MeteraPlugin_OnLoad() → plugin performs one-time setup
 * 5. During simulation, engine fires registered callbacks
 * 6. On shutdown, engine calls MeteraPlugin_Shutdown()
 *
 * === CALLBACK MODEL ===
 *
 * Callbacks are "Deferred Response" — they run AFTER the current tick.
 * If a mod needs to change simulation state, changes apply on the NEXT tick.
 * This prevents blocking the simulation loop.
 *
 * Visual/audio callbacks are "Fire and Forget" — no return value expected.
 */

#pragma once

#include <stdint.h>

#ifdef _WIN32
#   define METERA_EXPORT __declspec(dllexport)
#else
#   define METERA_EXPORT __attribute__((visibility("default")))
#endif

// ============================================================================
// API VERSION
// ============================================================================
#define METERA_API_VERSION_MAJOR 3
#define METERA_API_VERSION_MINOR 3
#define METERA_API_VERSION_PATCH 0

// ============================================================================
// OPAQUE HANDLES — plugins never see internal structures
// ============================================================================
typedef int32_t MeteraHandle;         // Generic handle (region, NPC, etc.)
typedef int32_t MeteraStringHandle;   // Handle to an interned string

// ============================================================================
// ENUMS
// ============================================================================
typedef enum {
    METERA_OK = 0,
    METERA_ERR_INVALID_HANDLE = -1,
    METERA_ERR_NOT_FOUND = -2,
    METERA_ERR_INVALID_ARG = -3,
    METERA_ERR_PERMISSION = -4,
    METERA_ERR_OVERFLOW = -5,
} MeteraResult;

typedef enum {
    METERA_HOOK_ON_DAILY_TICK = 0,
    METERA_HOOK_ON_HOURLY_TICK = 1,
    METERA_HOOK_ON_REGION_CHANGED = 2,
    METERA_HOOK_ON_NPC_DEATH = 3,
    METERA_HOOK_ON_BATTLE = 4,
    METERA_HOOK_ON_TRADE = 5,
    METERA_HOOK_ON_DISASTER = 6,
    METERA_HOOK_ON_BUILDING_BUILT = 7,
    METERA_HOOK_COUNT
} MeteraHookType;

typedef enum {
    METERA_CALLBACK_DEFERRED = 0,   // Changes apply next tick
    METERA_CALLBACK_FIRE_AND_FORGET = 1,  // No return value
} MeteraCallbackMode;

// ============================================================================
// CALLBACK PROTOTYPES
// ============================================================================

// Daily tick callback: called after each game day
typedef void (*MeteraOnDailyTickFunc)(int32_t day);

// Hourly tick callback: called after each game hour
typedef void (*MeteraOnHourlyTickFunc)(int32_t day, int32_t hour);

// Region changed callback: called when region stats change significantly
typedef void (*MeteraOnRegionChangedFunc)(const char* region_id, const char* change_type);

// NPC death callback
typedef void (*MeteraOnNpcDeathFunc)(const char* npc_id, const char* cause);

// Battle callback
typedef void (*MeteraOnBattleFunc)(const char* region_id, int32_t attacker_count, int32_t defender_count);

// Trade callback
typedef void (*MeteraOnTradeFunc)(const char* from_region, const char* to_region, const char* item_id, int32_t quantity);

// Disaster callback
typedef void (*MeteraOnDisasterFunc)(const char* disaster_id, const char* region_id, int32_t severity);

// Building built callback
typedef void (*MeteraOnBuildingBuiltFunc)(const char* region_id, const char* facility_type);

// Generic callback for deferred state changes
typedef void (*MeteraGenericCallback)(void);

// ============================================================================
// ENGINE → PLUGIN API (functions the engine provides TO plugins)
// ============================================================================

// --- World Queries (read-only) ---

// Get region population. Returns -1 on error.
typedef int32_t (*MeteraGetRegionPopulationFunc)(const char* region_id);

// Get region stability (0-100). Returns -1 on error.
typedef int32_t (*MeteraGetRegionStabilityFunc)(const char* region_id);

// Get region faction ID. Returns "" if not found. Caller must NOT free.
typedef const char* (*MeteraGetRegionFactionFunc)(const char* region_id);

// Get region biome type. Returns "" if not found. Caller must NOT free.
typedef const char* (*MeteraGetRegionBiomeFunc)(const char* region_id);

// Get total world population across all regions.
typedef int64_t (*MeteraGetWorldPopulationFunc)(void);

// Get current game day.
typedef int32_t (*MeteraGetCurrentDayFunc)(void);

// Get current game hour (0-23).
typedef int32_t (*MeteraGetCurrentHourFunc)(void);

// Get NPC count in a region. Returns -1 on error.
typedef int32_t (*MeteraGetRegionNpcCountFunc)(const char* region_id);

// Get item price from the economy database. Returns -1.0 on error.
typedef double (*MeteraGetItemPriceFunc)(const char* item_id);

// Get a global string value by key (for mod data exchange). Returns NULL if not found.
typedef const char* (*MeteraGetGlobalStringFunc)(const char* key);

// Get NPC HP. Returns -1 if not found.
typedef int32_t (*MeteraGetNpcHpFunc)(const char* npc_id);

// Get item count in a specific container by prototype ID.
typedef int32_t (*MeteraGetContainerItemCountFunc)(const char* container_id, const char* item_prototype);


// Remove items from a container. Returns the actual amount removed.
typedef int32_t (*MeteraRemoveItemFunc)(const char* container_id, const char* item_prototype, int32_t quantity);


// Get map dimensions.
typedef int32_t (*MeteraGetMapWidthFunc)(void);
typedef int32_t (*MeteraGetMapHeightFunc)(void);

// Get biome ID of a specific tile. Returns -1 if out of bounds.
typedef int32_t (*MeteraGetTileBiomeFunc)(int32_t x, int32_t y);


// Get road level of a specific tile (0=none, 1=dirt, 2=paved, 3=highway).
typedef int32_t (*MeteraGetTileRoadLevelFunc)(int32_t x, int32_t y);

// Get water depth of a specific tile.
typedef int32_t (*MeteraGetTileWaterDepthFunc)(int32_t x, int32_t y);

// Check if a specific tile is flooded.
typedef bool (*MeteraIsTileFloodedFunc)(int32_t x, int32_t y);

// Get location ID at specific coordinates. Returns "" if none.
typedef const char* (*MeteraGetLocationAtFunc)(int32_t x, int32_t y);


// --- World Mutations (deferred — applied on next tick) ---

// Set region stability (0-100). Applied on next tick.
typedef MeteraResult (*MeteraSetRegionStabilityFunc)(const char* region_id, int32_t value);

// Modify region population by delta. Applied on next tick.
typedef MeteraResult (*MeteraModifyRegionPopulationFunc)(const char* region_id, int32_t delta);

// Multiply all item prices by a factor. Applied on next tick. For total conversion mods.
typedef MeteraResult (*MeteraMultiplyAllPricesFunc)(double factor);

// Multiply specific item price by a factor. Applied on next tick.
typedef MeteraResult (*MeteraMultiplyItemPriceFunc)(const char* item_id, double factor);

// Set a global string value (for mod data exchange). Persists across ticks.
typedef MeteraResult (*MeteraSetGlobalStringFunc)(const char* key, const char* value);

// Spawn an item in a container. Applied on next tick.
typedef MeteraResult (*MeteraSpawnItemFunc)(const char* item_id, int32_t quantity, const char* container_id);

// Trigger a disaster in a region. Applied on next tick.
typedef MeteraResult (*MeteraTriggerDisasterFunc)(const char* disaster_type, const char* region_id, int32_t severity);

// Spawn an epic monster in a region. Applied on next tick.
typedef MeteraResult (*MeteraSpawnMonsterFunc)(const char* monster_type, const char* region_id);

// Add a news entry to the world chronicles. Applied on next tick.
typedef MeteraResult (*MeteraAddNewsFunc)(const char* text, const char* location, int32_t importance, const char* category);


// Set NPC HP. Applied immediately for combat logic.
typedef MeteraResult (*MeteraSetNpcHpFunc)(const char* npc_id, int32_t hp);


// Block 1: Factions & Diplomacy
typedef int32_t (*MeteraGetFactionRelationFunc)(const char* f1, const char* f2);
typedef const char* (*MeteraGetFactionStateFunc)(const char* faction_id);
typedef MeteraResult (*MeteraSetFactionRelationFunc)(const char* f1, const char* f2, int32_t value);
typedef MeteraResult (*MeteraForceWarFunc)(const char* f1, const char* f2);
typedef MeteraResult (*MeteraForcePeaceFunc)(const char* f1, const char* f2);

// Block 2: Economy
typedef double (*MeteraGetRegionMoneySupplyFunc)(const char* region_id);
typedef int32_t (*MeteraGetBusinessCashFunc)(const char* business_id);
typedef MeteraResult (*MeteraModifyRegionMoneyFunc)(const char* region_id, double delta);
typedef MeteraResult (*MeteraModifyBusinessCashFunc)(const char* business_id, int32_t delta);

// Block 3: NPC & Armies
typedef const char* (*MeteraGetNpcLocationFunc)(const char* npc_id);
typedef int32_t (*MeteraGetNpcGoldFunc)(const char* npc_id);
typedef MeteraResult (*MeteraTeleportNpcFunc)(const char* npc_id, const char* region_id);
typedef MeteraResult (*MeteraModifyNpcGoldFunc)(const char* npc_id, int32_t delta);
typedef MeteraResult (*MeteraSpawnArmyFunc)(const char* faction_id, const char* region_id, int32_t size);

// Block 4: Infrastructure & Threats
typedef int32_t (*MeteraGetRegionThreatFunc)(const char* region_id);
typedef MeteraResult (*MeteraSetRegionThreatFunc)(const char* region_id, int32_t value);
typedef MeteraResult (*MeteraSetRoadStateFunc)(const char* from_region, const char* to_region, int32_t state);


// Set biome ID of a specific tile. Applied on next tick.
typedef MeteraResult (*MeteraSetTileBiomeFunc)(int32_t x, int32_t y, int32_t biome_id);


// Set road level of a specific tile. Applied on next tick.
typedef MeteraResult (*MeteraSetTileRoadLevelFunc)(int32_t x, int32_t y, int32_t level);

// Set water depth of a specific tile. Applied on next tick.
typedef MeteraResult (*MeteraSetTileWaterDepthFunc)(int32_t x, int32_t y, int32_t depth);

// Set flooded state of a specific tile. Applied on next tick.
typedef MeteraResult (*MeteraSetTileFloodedFunc)(int32_t x, int32_t y, bool is_flooded);

// Add a new location (city/ruins/anomaly) to the map. Applied on next tick.
typedef MeteraResult (*MeteraAddLocationFunc)(const char* id, const char* name, int32_t x, int32_t y, const char* type, const char* faction);

// Remove a location from the map by ID. Applied on next tick.
typedef MeteraResult (*MeteraRemoveLocationFunc)(const char* id);


// Update world generation configuration. Applied on next tick.
typedef MeteraResult (*MeteraUpdateWorldConfigFunc)(const char* json_config);

// Update biome generation rules and properties. Applied on next tick.
typedef MeteraResult (*MeteraUpdateBiomeDefFunc)(const char* biome_id, const char* json_def);

// Regenerate the entire world map using current config and biome rules. Applied on next tick.
typedef MeteraResult (*MeteraRegenerateMapFunc)(int32_t seed);


// Log a message to the engine log (visible in console/debug output).
typedef void (*MeteraLogFunc)(const char* message);

// ============================================================================
// API TABLE — passed to plugin on init
// ============================================================================

typedef struct MeteraAPI {
    uint32_t version_major;
    uint32_t version_minor;
    uint32_t version_patch;

    // World queries (read-only)
    MeteraGetRegionPopulationFunc  getRegionPopulation;
    MeteraGetRegionStabilityFunc   getRegionStability;
    MeteraGetRegionFactionFunc     getRegionFaction;
    MeteraGetRegionBiomeFunc       getRegionBiome;
    MeteraGetWorldPopulationFunc   getWorldPopulation;
    MeteraGetCurrentDayFunc        getCurrentDay;
    MeteraGetCurrentHourFunc       getCurrentHour;
    MeteraGetRegionNpcCountFunc    getRegionNpcCount;
    MeteraGetItemPriceFunc         getItemPrice;
    MeteraGetGlobalStringFunc      getGlobalString;

    MeteraGetNpcHpFunc             getNpcHp;
    MeteraGetContainerItemCountFunc getContainerItemCount;

    MeteraRemoveItemFunc           removeItem;

    MeteraGetMapWidthFunc          getMapWidth;
    MeteraGetMapHeightFunc         getMapHeight;
    MeteraGetTileBiomeFunc         getTileBiome;

    MeteraGetFactionRelationFunc   getFactionRelation;
    MeteraGetFactionStateFunc      getFactionState;
    MeteraGetRegionMoneySupplyFunc getRegionMoneySupply;
    MeteraGetBusinessCashFunc      getBusinessCash;
    MeteraGetNpcLocationFunc       getNpcLocation;
    MeteraGetNpcGoldFunc           getNpcGold;
    MeteraGetRegionThreatFunc      getRegionThreat;

    // World mutations (deferred)
    MeteraSetRegionStabilityFunc      setRegionStability;
    MeteraModifyRegionPopulationFunc  modifyRegionPopulation;
    MeteraMultiplyAllPricesFunc       multiplyAllPrices;
    MeteraMultiplyItemPriceFunc       multiplyItemPrice;
    MeteraSetGlobalStringFunc         setGlobalString;

    MeteraSpawnItemFunc               spawnItem;
    MeteraTriggerDisasterFunc         triggerDisaster;
    MeteraSpawnMonsterFunc            spawnMonster;
    MeteraAddNewsFunc                 addNews;

    MeteraSetNpcHpFunc                setNpcHp;

    MeteraSetTileBiomeFunc            setTileBiome;

    MeteraSetFactionRelationFunc      setFactionRelation;
    MeteraForceWarFunc                forceWar;
    MeteraForcePeaceFunc              forcePeace;
    MeteraModifyRegionMoneyFunc       modifyRegionMoney;
    MeteraModifyBusinessCashFunc      modifyBusinessCash;
    MeteraTeleportNpcFunc             teleportNpc;
    MeteraModifyNpcGoldFunc           modifyNpcGold;
    MeteraSpawnArmyFunc               spawnArmy;
    MeteraSetRegionThreatFunc         setRegionThreat;
    MeteraSetRoadStateFunc            setRoadState;


    // Utility
    MeteraLogFunc log;

    // Map Terrain & Locations (v3.2)
    MeteraGetTileRoadLevelFunc     getTileRoadLevel;
    MeteraGetTileWaterDepthFunc    getTileWaterDepth;
    MeteraIsTileFloodedFunc        isTileFlooded;
    MeteraGetLocationAtFunc        getLocationAt;
    MeteraSetTileRoadLevelFunc     setTileRoadLevel;
    MeteraSetTileWaterDepthFunc    setTileWaterDepth;
    MeteraSetTileFloodedFunc       setTileFlooded;
    MeteraAddLocationFunc          addLocation;
    MeteraRemoveLocationFunc       removeLocation;


    // Map Generation & Config (v3.3)
    MeteraUpdateWorldConfigFunc    updateWorldConfig;
    MeteraUpdateBiomeDefFunc       updateBiomeDef;
    MeteraRegenerateMapFunc        regenerateMap;
} MeteraAPI;

// ============================================================================
// PLUGIN EXPORTED FUNCTIONS — every DLL/SO must implement these
// ============================================================================

#ifdef __cplusplus
extern "C" {
#endif

/**
 * REQUIRED: Return plugin name. Engine uses this for identification.
 * Must return a static string (not heap-allocated).
 */
METERA_EXPORT const char* MeteraPlugin_GetName(void);

/**
 * REQUIRED: Return plugin version string.
 */
METERA_EXPORT const char* MeteraPlugin_GetVersion(void);

/**
 * REQUIRED: Engine calls this to provide the API function table.
 * Plugin should store the pointer for later use.
 *
 * @param api  Pointer to the API table. Valid for the entire lifetime of the plugin.
 */
METERA_EXPORT void MeteraPlugin_GetAPI(const MeteraAPI* api);

/**
 * REQUIRED: Initialize the plugin. Called after GetAPI.
 * Plugin should register its callbacks here.
 *
 * @param plugin_id  Unique integer ID assigned by the engine.
 * @return METERA_OK on success, error code on failure.
 */
METERA_EXPORT MeteraResult MeteraPlugin_Init(int32_t plugin_id);

/**
 * OPTIONAL: Called after Init. Perform one-time setup (load config, etc.)
 */
METERA_EXPORT void MeteraPlugin_OnLoad(void);

/**
 * OPTIONAL: Called when the engine is shutting down.
 * Plugin should release all resources.
 */
METERA_EXPORT void MeteraPlugin_Shutdown(void);

#ifdef __cplusplus
} // extern "C"
#endif
