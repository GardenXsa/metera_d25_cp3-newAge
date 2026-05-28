# C++ Engine Analysis - Chronicles of Meterea

## Core Architecture

### 1. json_wrapper.h - JSON Value System
- **Purpose**: Lightweight wrapper around nlohmann::json for game data
- **Key Fix**: Removed data duplication - obj_val/arr_val are now sole source of truth
- **Performance**: ~50% memory reduction, 3-5x faster serialization
- **Features**:
  - Type system: NULL_VAL, OBJECT, ARRAY, STRING, INT, DOUBLE, BOOLEAN
  - Cached serialization with dirty flag (_dirty, _cached_data)
  - Thread-safe null value handling (thread_local)
  - Mutable operator[] for nested mutations

### 2. core_types.h - Core Data Structures
- **PhysicalItem**: Game items with stack management, spoilage, flags
  - Bidirectional sync: legacy direct fields ↔ flags struct (Issue #8 fix)
  - History tracking for item events
  - Order data for trade orders
  - Serialization to/from JSON
  
- **Storage**: Container system
  - Item inventory management
  - Lock data, physical properties
  - Cached stocks by type
  
- **FacilityTemplate/FacilityRegistry**: Building templates
  - Extraction rates, race modifiers, weather modifiers
  - Tag-based queries
  
- **ObjectPool<T>**: Memory-efficient entity storage
  - Slot reuse via free_slots vector
  - ID-to-index mapping for O(1) access
  
- **ThreadPool**: Worker thread pool
  - Configurable thread count
  - Task queue with condition variable
  - Future-based async execution

- **locStr()**: Localization string builder with escape handling

### 3. item_system.h/.cpp - Item Template System
- **ItemTemplate**: Prototype definitions
  - Base price, tags, flexible properties
  - Tag-based queries
  
- **ItemRegistry**: Global registry (g_itemRegistry)
  - Load from JSON files
  - Template lookup by ID or tag

### 4. meterea_engine.cpp - Main Simulation Engine (16194 lines)
Full port of world_worker.js (2099 lines) to C++17

#### Global Registries:
- g_items: ObjectPool<PhysicalItem>
- g_containers: ObjectPool<Storage>
- g_facilityRegistry: FacilityRegistry
- g_db: Database with all game definitions

#### Database Structure:
- Items, recipes, facility names
- Placement resources (data-driven)
- Tag defaults (canonical IDs by semantic tag)
- Biomes, monsters, disasters
- Character data: races, professions, traits, name groups
- Faction relations
- World generation config

#### GameplayRuntimeConfig:
- Container types with lock/health/capacity descriptors
- Transport registry (speed multipliers, cargo bonus)
- Ship types (combat, capacity, build cost)
- Simulation parameters:
  - Hunger thresholds
  - Army morale settings
  - Region stability/threat levels
  - Population food/weapon reserves
  - Facility job counts
  - Race-specific modifiers
  - Water/mountain biome lists
- World events (harvest blessing, gold rush)

#### Key Functions:
- loadGameplayRuntimeConfig(): Parse runtime config JSON
- getContainerTypeDescriptor(): Lookup container properties
- getTransportDescriptor(): Lookup transport properties
- getShipTypeDescriptor(): Lookup ship properties
- normalizeShipTypeRuntimeId(): Case-insensitive normalization

## Design Patterns

1. **Data-Driven Architecture**: All game balance from JSON configs
2. **Tag-Based Queries**: Flexible item/facility categorization
3. **Object Pooling**: Efficient memory management for entities
4. **Bidirectional Sync**: Legacy compatibility with new flag system
5. **Cached Serialization**: Dirty flag pattern for performance

## Threading Model
- ThreadPool for parallel simulation tasks
- Thread-local storage for null values
- Atomic stop flag for graceful shutdown

## Memory Optimizations
- Single source of truth for JSON data
- Slot reuse in object pools
- Cached serialization results

## 5. definitions.h - Game Definition Structures

### BiomeDef (Biome Registry)
- Numeric/string IDs, name, movement cost
- Tags: is_water, is_impassable
- Color hex for rendering
- Resources available in biome
- Generation rules: elevation, temp, moisture ranges

### MonsterDef (Epic Monster Registry)
- Base stats: HP, attack, defense
- Spawn biome tag, corruption effect
- Loot table ID

### DisasterDef (Disaster Registry)
- Radius, duration, damage percentages
- Facility damage, stability penalty
- Affected biomes, tile transformations
- Item spawn on disaster

### RaceDef (Race Registry)
- Faction preferences, biome preferences
- Stat modifiers (str, dex, int, con, cha)
- Class-specific stat bonuses

### ProfessionDef (Profession Registry)
- Type: farmer, artisan, merchant, etc.
- Tool tag and chance
- Production type, demand pattern
- Special abilities
- Preferred facility

### TraitDef (Trait Registry)
- Personality bias map (aggression, greed, etc.)

### NameGroupDef (Name Group Registry)
- First/last names by race

### FactionRelationsDef (Faction Relations Registry)
- Biome preferences, corruption effects
- Era-based relation rules

### ContainerTypeDef (Stage 8)
- Lock state, decay behavior
- Category, special logic
- Health, lock difficulty, flammability
- Capacity, weight limits
- Spell requirements

## 6. meterea_mod_sdk.h - ModKit 3.0 C-API

### Plugin Lifecycle
1. Engine loads DLL/SO via dlopen/LoadLibrary
2. Engine calls MeteraPlugin_GetAPI() → plugin receives function table
3. Engine calls MeteraPlugin_Init(plugin_id) → plugin registers callbacks
4. Engine calls MeteraPlugin_OnLoad() → one-time setup
5. During simulation, engine fires registered callbacks
6. On shutdown, engine calls MeteraPlugin_Shutdown()

### Security Model
⚠️ **WARNING**: Native plugins run with FULL process privileges
- NO sandbox for native code
- Only load from trusted sources
- Malicious plugin can:
  - Access all memory (read/write)
  - Execute arbitrary system commands
  - Access filesystem without restrictions
  - Modify engine internal state directly

**Mitigation**: Plugin allowlist (whitelist) for signed/verified DLLs

### Callback Model
- **Deferred Response**: Run AFTER current tick, changes apply NEXT tick
- **Fire and Forget**: Visual/audio callbacks, no return value

### Hook Types (MeteraHookType)
- ON_DAILY_TICK, ON_HOURLY_TICK
- ON_REGION_CHANGED, ON_NPC_DEATH
- ON_BATTLE, ON_TRADE, ON_DISASTER
- ON_BUILDING_BUILT

### API Categories

#### World Queries (Read-Only)
- Region: population, stability, faction, biome, NPC count, money supply, threat
- World: total population, current day/hour, map dimensions
- Tile: biome, road level, water depth, flooded state, location at coords
- NPC: HP, location, gold
- Economy: item price, business cash
- Faction: relations, state

#### World Mutations (Deferred)
- Region: stability, population delta, money delta, threat
- Faction: set relations, force war/peace
- NPC: teleport, gold delta, spawn army
- Economy: multiply prices (all or specific), business cash delta
- Items: spawn in container, remove from container
- Disasters: trigger disaster, spawn monster
- Map: set tile biome/road/water/flooded, add/remove location
- News: add chronicle entry
- Config: update world config, biome defs, regenerate map

#### Utility
- Logging to engine console

### API Version: 3.3.0
- v3.2: Map Terrain & Locations
- v3.3: Map Generation & Config

### Opaque Handles
- MeteraHandle: Generic handle (region, NPC, etc.)
- MeteraStringHandle: Interned string handle

### Result Codes
- METERA_OK (0)
- METERA_ERR_INVALID_HANDLE (-1)
- METERA_ERR_NOT_FOUND (-2)
- METERA_ERR_INVALID_ARG (-3)
- METERA_ERR_PERMISSION (-4)
- METERA_ERR_OVERFLOW (-5)

### Required Plugin Exports
- MeteraPlugin_GetName(): Static string name
- MeteraPlugin_GetVersion(): Version string
- MeteraPlugin_GetAPI(const MeteraAPI* api): Receive API table
- MeteraPlugin_Init(int32_t plugin_id): Register callbacks
- MeteraPlugin_OnLoad(): Optional one-time setup
- MeteraPlugin_Shutdown(): Optional cleanup

## Design Philosophy

### Data-Driven Everything
- All game balance from JSON configs
- Tag-based queries for flexibility
- Canonical IDs via semantic tags

### Performance Optimizations
- Object pooling for entities
- Cached serialization with dirty flags
- Thread-local storage for null values
- Slot reuse in pools

### Safety Mechanisms
- Deferred mutations (next-tick application)
- Opaque handles (no direct pointer access)
- Error codes instead of exceptions
- Const-correct read-only APIs

### Modding Support
- Stable ABI via extern "C"
- Callback-based extensibility
- Global string storage for mod data exchange
- Comprehensive world manipulation APIs
