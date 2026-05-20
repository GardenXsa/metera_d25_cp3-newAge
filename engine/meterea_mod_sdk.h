/**
 * meterea_mod_sdk.h — ModKit 3.0 Opaque C-API
 *
 * Stable ABI interface for native C++ plugins (DLL/SO).
 * All interaction between the engine core and mods goes through
 * strictly typed extern "C" functions — NO raw pointers to C++ objects.
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
#define METERA_API_VERSION_MINOR 0
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

    // World mutations (deferred)
    MeteraSetRegionStabilityFunc      setRegionStability;
    MeteraModifyRegionPopulationFunc  modifyRegionPopulation;
    MeteraMultiplyAllPricesFunc       multiplyAllPrices;
    MeteraMultiplyItemPriceFunc       multiplyItemPrice;
    MeteraSetGlobalStringFunc         setGlobalString;

    // Utility
    MeteraLogFunc log;
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
