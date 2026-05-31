# Chronicles of Meterea - Complete Engine Analysis Summary

## Project Overview
**Chronicles of Meterea** is a hybrid game engine combining:
- **C++ native simulation core** (16K+ lines) - Full port of world_worker.js
- **JavaScript/Electron frontend** - UI, rendering, modding system
- **AI-driven narrative** - Gemini API integration for GM functionality
- **Data-driven design** - All game balance from JSON configs

---

## C++ Engine Architecture

### Core Files Analyzed

| File | Lines | Purpose |
|------|-------|---------|
| json_wrapper.h | 220 | JSON value wrapper with cached serialization |
| core_types.h | 461 | PhysicalItem, Storage, ObjectPool, ThreadPool |
| item_system.h/cpp | 78 | Item template registry system |
| definitions.h | 128 | Biome, Monster, Race, Profession definitions |
| npc_personality.h | 13 | NPC name/background generation declarations |
| meterea_mod_sdk.h | 419 | ModKit 3.0 C-API for native plugins |
| meterea_engine.cpp | 16194 | Main simulation engine |

### Key C++ Systems

#### 1. JsonValue (json_wrapper.h)
- **Problem Solved**: Previously stored data TWICE (nlohmann::json + native types)
- **Fix**: obj_val/arr_val are now sole source of truth
- **Result**: ~50% memory reduction, 3-5x faster serialization
- **Features**: Dirty flag caching, thread-local null values, mutable operator[]

#### 2. PhysicalItem (core_types.h)
- Stack-based inventory items
- Bidirectional sync: legacy direct fields ↔ flags struct (Issue #8)
- History tracking, order data, custom properties
- Serialization with consistency guarantees

#### 3. ObjectPool<T> (core_types.h)
- Memory-efficient entity storage
- Slot reuse via free_slots vector
- O(1) ID-to-index lookup
- Used for: g_items, g_containers

#### 4. ThreadPool (core_types.h)
- Configurable worker threads
- Task queue with condition variable
- Future-based async execution
- Global singleton via getThreadPool()

#### 5. Database (meterea_engine.cpp)
```cpp
struct Database {
    // Items & Recipes
    std::unordered_map<std::string, ItemDef> items;
    std::vector<RecipeDef> recipes;
    
    // World Generation
    std::vector<BiomeDef> biomes;
    std::unordered_map<std::string, MonsterDef> monsters;
    std::unordered_map<std::string, DisasterDef> disasters;
    
    // Character System
    std::unordered_map<std::string, RaceDef> races;
    std::unordered_map<std::string, ProfessionDef> professions;
    std::unordered_map<std::string, TraitDef> traits;
    std::unordered_map<std::string, NameGroupDef> name_groups;
    
    // Faction System
    FactionRelationsDef faction_relations;
    
    // Configuration
    WorldConfigDef world_config;
};
```

#### 6. GameplayRuntimeConfig
- Container type descriptors (lock, health, capacity)
- Transport registry (speed multipliers, cargo bonus)
- Ship types (combat, build cost, crew requirements)
- Simulation parameters:
  - Hunger thresholds (critical: 25, shopping: 50)
  - Army morale (mutiny: 50, collapse: 20)
  - Region stability/trade/threat levels
  - Population reserve ratios
  - Facility job counts per level
  - Race-specific facility modifiers

#### 7. ModKit 3.0 C-API (meterea_mod_sdk.h)
**Plugin Lifecycle:**
1. dlopen/LoadLibrary → MeteraPlugin_GetAPI()
2. MeteraPlugin_Init(plugin_id) → register callbacks
3. MeteraPlugin_OnLoad() → one-time setup
4. Callback execution during simulation
5. MeteraPlugin_Shutdown() → cleanup

**Security Warning:**
⚠️ Native plugins have FULL process privileges
- No sandboxing
- Can access all memory, execute commands, modify state
- Mitigation: Plugin allowlist for signed DLLs

**API Categories (v3.3.0):**
- **World Queries** (read-only): population, stability, faction, biome, tile data
- **World Mutations** (deferred): stability, population, prices, items, disasters
- **Map Operations**: set biome/road/water/flooded, add/remove locations
- **Factions**: relations, war/peace, money supply
- **NPCs**: HP, gold, teleport, spawn army
- **Generation**: update world config, regenerate map

---

## JavaScript Engine Architecture

### Module Structure

| Module | Files | Total Lines | Purpose |
|--------|-------|-------------|---------|
| core/ | 12 files | ~80K | Core systems, utilities, registries |
| mods/ | 4 files | ~130K | ModLoader (ModKit v2.0/v3.0) |
| saves/ | 3 files | ~55K | Save/load with FSA/Electron backends |
| cartographer/ | 1 file | ~85K | World map rendering |

### Key JS Systems

#### 1. globals.js - State Management
**Global Registries:**
```javascript
const ItemRegistry = new Map();      // Item prototypes
const ContainerRegistry = new Map(); // Container instances
```

**EventBus (Pub/Sub):**
```javascript
EventBus.on('player:hpChanged', handler);
EventBus.emit('player:hpChanged', { oldHp: 100, newHp: 80 });
EventBus.once(event, callback);  // Auto-remove after first trigger
```

**Utilities:**
- `normalizeContainer()`: Engine→JS data normalization
- `generateUUID()`: Crypto-based or fallback
- `yieldThread()`: Non-blocking async operations

#### 2. constants.js - Runtime Configuration
**Dynamic Constants:**
- Loaded from data/ui_runtime.json
- Fallback to RUNTIME_CONSTANT_DEFAULTS
- localStorage persistence for user preferences

**Categories:**
- Debug mode (NODE_ENV controlled)
- Save settings (max saves, autosave interval)
- Memory limits (history pairs, prune turns)
- Progression (stat points per level)
- Audio volumes, background images

#### 3. ModLoader.js (1512 lines) - ModKit v2.0/v3.0
**ModAPI Object:**
```javascript
window.ModAPI = {
    mods: {},              // Loaded mod metadata
    hooks: {},             // Event subscriptions
    customCommands: {},    // GM command extensions
    promptInjections: [],  // AI prompt modifications
    hotkeys: {},           // Keyboard shortcuts
    promptFilters: [],     // Request/response filters
    saveHandlers: {},      // Save/load callbacks
    customTranslations: {},
    apiVersion: '2.0'
}
```

**Security Features:**
- `_sanitizeHTML()`: Iterative tag removal
  - Handles nested bypasses, entity-encoded URLs
  - Blocks javascript:, vbscript:, data: schemes
  - Removes on* event handlers
  
- `_validateModMeta()`: Manifest validation
  - Required: id, name, version
  - ID format: lowercase alphanumeric + underscore

**Lifecycle Tracking:**
- `_originalFunctions`: Monkey-patch rollback
- `_injectedStyles`: CSS removal
- `_injectedUI`: DOM element cleanup

**Core Methods:**
| Method | Purpose |
|--------|---------|
| patchFunction/unpatchFunction | Monkey-patch with rollback |
| addUI/addStyle/removeStyle | DOM/CSS injection with tracking |
| registerHook/unregisterHook | Event subscription |
| addCommand | GM command registration |
| addPromptInjection | AI prompt modification (2000 char limit) |
| unloadMod | Full mod cleanup |

#### 4. SaveManager.js (540 lines)
**Storage Backends:**
- Electron: Native IPC file I/O
- Browser: File System Access API
- Fallback: localStorage

**Features:**
- Streaming saves (chunked writes with yieldThread)
- Auto-save (configurable interval, default 5 min)
- Manual saves (max 5 slots)
- Auto-saves (max 20 slots)
- Import/export functionality

#### 5. globalMap.js (1622 lines)
**Rendering:**
- Canvas-based 256x256 tile map
- Level-of-detail optimization
- Tile caching for performance
- Pan/zoom controls

**Visual Layers:**
- Biome colors
- Region/faction overlays
- Location markers (cities, ruins, anomalies)
- Road levels (0-3)
- Water depth
- Flood visualization

---

## Design Patterns

### 1. Data-Driven Architecture
- All game balance from JSON configs
- Tag-based queries for flexibility
- Canonical IDs via semantic tags
- Runtime config loading with fallbacks

### 2. Registry Pattern
- C++: g_itemRegistry, g_facilityRegistry
- JS: ItemRegistry, ContainerRegistry (Maps)
- Centralized entity lookup

### 3. Object Pooling
- C++: ObjectPool<T> with slot reuse
- Prevents allocation churn for entities

### 4. Pub/Sub (EventBus)
- Decoupled event handling
- Listener lifecycle management
- Once/off support

### 5. Strategy Pattern
- StorageProvider: interchangeable backends
- Unified API surface

### 6. Decorator Pattern
- ModAPI.patchFunction: function wrapping
- Original preservation for rollback

### 7. Deferred Mutation
- C++: Changes apply on next tick
- Prevents simulation loop blocking
- Safe mod callbacks

---

## Security Model

### C++ Plugins (ModKit 3.0)
⚠️ **FULL PRIVILEGES** - No sandbox
- Can access all memory
- Can execute system commands
- Can modify engine state directly
- **Mitigation**: Plugin allowlist for signed DLLs

### JavaScript Mods (ModKit v2.0)
⚠️ **FULL PAGE ACCESS** - Limited sandbox
- Can access all DOM elements
- Can intercept network requests
- Can modify global variables
- **Mitigations**:
  - HTML sanitization for UI injections
  - Manifest validation
  - Length limits on prompt injections (2000 chars)
  - Iterative XSS prevention

### Save Data Integrity
- Text encoding validation (textEncodingGuard.js)
- JSON structure verification
- Error cooldown (FSA_ERROR_COOLDOWN: 10s)

---

## Performance Optimizations

### C++ Engine
- **Cached Serialization**: Dirty flag pattern
- **Object Pooling**: Slot reuse, O(1) lookup
- **Thread Pool**: Parallel simulation tasks
- **Thread-Local Storage**: Null value handling

### JavaScript Frontend
- **Canvas Rendering**: Not DOM-based for map
- **Tile Caching**: LOD optimization
- **Streaming Saves**: Chunked writes with yieldThread
- **Reference Caching**: itemsReferenceData
- **Container Normalization**: Deep clone prevention

---

## Integration Points

### C++ ↔ JS Communication
- stdin/stdout JSON protocol
- Container/item synchronization
- World state updates
- Mod callback bridging (ModLoaderIntegration.js)

### Electron IPC
- File I/O operations
- Native dialog access
- System integration

### AI API (Gemini)
- Prompt injection system
- Response filtering
- Narrative generation

---

## Known Issues & Fixes

| Issue | Component | Description | Fix |
|-------|-----------|-------------|-----|
| #2 | ModLoader | Mod unload incomplete | Added _originalFunctions tracking |
| #4 | ModLoader | Prompt injection overflow | Added 2000 char limit |
| #5 | ModLoader | XSS via mod UI | Improved HTML sanitization |
| #6 | ModLoader | Invalid mod manifests | Added _validateModMeta() |
| #8 | C++ Core | C++/JS flag desync | Bidirectional sync in PhysicalItem |
| #14 | ModLoader | Nested tag bypass | Iterative sanitization |
| #77 | json_wrapper | Exponential serialization | Cached serialization with dirty flag |
| #82 | meterea_engine | Double truncation | readJsonIntOrDefault now rounds |
| #101 | globals.js | Unused variable | Removed lastFSAErrorTime |
| #129 | ModLoader | Entity-encoded XSS | Added &#61; pattern matching |
| #131 | json_wrapper | Thread safety | thread_local for null values |

---

## File Locations

### C++ Engine (/workspace/engine/)
- `json_wrapper.h` - JSON value system
- `core_types.h` - Core data structures
- `item_system.h/cpp` - Item templates
- `definitions.h` - Game definitions
- `meterea_mod_sdk.h` - Mod API
- `meterea_engine.cpp` - Main engine (16K lines)

### JavaScript Frontend (/workspace/js/)
- `core/globals.js` - Global state
- `core/constants.js` - Runtime config
- `mods/ModLoader.js` - Mod system
- `saves/SaveManager.js` - Save/load
- `cartographer/globalMap.js` - World map

### Analysis Cache (/workspace/.analysis_cache/)
- `cpp_engine_analysis.md` - Detailed C++ analysis
- `js_engine_analysis.md` - Detailed JS analysis
- `summary.md` - This summary document

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Simulation Core | C++17 |
| Frontend | JavaScript (ES6+) |
| UI Framework | Electron |
| Rendering | HTML5 Canvas |
| Data Format | JSON |
| AI Integration | Google Gemini API |
| Modding | C++ DLL/SO + JS scripts |
| Build System | npm |

---

## Conclusion

Chronicles of Meterea is a sophisticated hybrid game engine with:
- **Deep simulation**: 16K line C++ core handling complex world mechanics
- **Flexible modding**: Dual-layer system (native C++ plugins + JS scripts)
- **AI integration**: Gemini-powered narrative generation
- **Performance focus**: Object pooling, cached serialization, streaming saves
- **Security awareness**: Sanitization, validation, deferred mutations

The codebase demonstrates mature engineering practices with comprehensive issue tracking and systematic fixes for identified problems.
