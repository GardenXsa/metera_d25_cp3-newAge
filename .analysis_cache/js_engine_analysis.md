# JavaScript Engine Analysis - Chronicles of Meterea

## Architecture Overview

The JS codebase is organized into 4 main modules:
- **core/**: Core engine systems (globals, constants, types, utilities)
- **mods/**: ModLoader system (ModKit v2.0/v3.0)
- **saves/**: Save/Load management with FSA/Electron backends
- **cartographer/**: World map rendering and interaction

## Core Module (/js/core/)

### globals.js - Global State Management
**Key Variables:**
- `narrators`, `currentNarratorIndex`: AI narrator system
- `tempPlayer`: Temporary character storage
- `preloadedWorldData`: Cached world data
- `directoryHandle`: File System Access API handle
- `itemsReferenceData`: Item database cache
- `gmFeedbackMessages`: Game master feedback queue
- `playerActionQueue`: Player action queue for async processing
- `currentApiAbortController`: API request cancellation
- `turnRollMemory`: Anti-cheat roll tracking
- `draggedItemData`: Drag-and-drop state

**Registries:**
- `ItemRegistry` (Map): Item prototype definitions
- `ContainerRegistry` (Map): Container instances

**Utility Functions:**
- `normalizeContainer()`: Normalizes container data from engine (item_ids → items)
- `getContainerItems()`: Safe getter for container items array
- `setContainer()`: Safe setter with normalization
- `generateUUID()`: Crypto-based or fallback UUID generation

**EventBus (Pub/Sub):**
```javascript
EventBus.on('player:hpChanged', handler)
EventBus.emit('player:hpChanged', { oldHp, newHp })
EventBus.once(event, callback)  // Auto-remove after first trigger
EventBus.off(event, callback)   // Remove listener
```

**Electron Detection:**
- `hasElectronAPI`: Checks for window.electronAPI.isElectron
- `fsaApiAvailable`: Electron OR native File System Access API

### constants.js - Runtime Configuration
**RUNTIME_CONSTANT_DEFAULTS:**
- Debug mode (NODE_ENV controlled)
- Save settings: prefix, extension, max saves, autosave interval
- Memory limits: history pairs, summary/prune turns
- Progression: initial stat points, points per level
- Audio: music/sfx volumes, file paths
- Backgrounds: file list, change interval

**Dynamic Constants (via applyRuntimeConstants):**
- DEBUG_MODE, SAVE_FILE_PREFIX, MAX_HISTORY
- AUTOSAVE_INTERVAL, INITIAL_STAT_POINTS
- Music/sfx volumes (localStorage persisted)

**Predefined Status Effects:**
- Data-driven from predefined_effects.json
- Inline fallback effects:
  - Debuffs: minor_burn_dot, weak_poison_dot, curse_of_clumsiness
  - Buffs: blessing_of_might, blessing_of_luck, minor_regeneration

**Standard Item Descriptions:**
- Data-driven from item_descriptions.json
- i18n key-based localization
- Fallback descriptions for core items

### types.js - Type Definitions
(Structure for game entities - needs full review)

### characterStatsResolver.js - Stat Resolution
- Resolves character stats from race/class/trait modifiers
- Contract validation for mod compatibility

### devConsole.js - Developer Console
- In-game console for debugging
- Command execution interface

### dom_elements.js - DOM Cache
- Cached element references for performance
- UI update helpers

### keyMapper.js - Input Handling
- Keyboard mapping system
- Hotkey registration

### runtimeLog.js - Logging System
- Structured logging with categories
- Runtime error tracking

### textEncodingGuard.js - Encoding Safety
- Prevents encoding issues in save data
- UTF-8 validation

### game_rng.js - Random Number Generation
- Seeded RNG for reproducibility
- Anti-cheat roll tracking

### ai_config.js - AI Configuration
- Gemini API settings
- Prompt template management

## Mods Module (/js/mods/)

### ModLoader.js (1512 lines) - ModKit v2.0/v3.0

**ModAPI Object:**
```javascript
window.ModAPI = {
    mods: {},              // Loaded mod metadata
    hooks: {},             // Event hook registry
    customCommands: {},    // GM command extensions
    promptInjections: [],  // System prompt modifications
    hotkeys: {},           // Mod hotkey registry
    promptFilters: [],     // Request/response filters
    responseFilters: [],
    textFilters: [],
    saveHandlers: {},      // Save/load callbacks
    customTranslations: {},
    initialized: false,
    isTotalConversion: false,
    apiVersion: '2.0'
}
```

**Security Features:**
- `_sanitizeHTML()`: Removes dangerous tags (script, iframe, etc.)
  - Iterative removal for nested bypasses
  - Handles entity-encoded URLs (&#61;, &#x3D;)
  - Blocks javascript:, vbscript:, data: URLs
  - Removes on* event handlers

**Lifecycle Tracking (Issue #2):**
- `_originalFunctions`: Stores originals for monkey-patch rollback
- `_injectedStyles`: Tracks injected CSS for removal
- `_injectedUI`: Tracks injected DOM elements

**Core API Methods:**

| Method | Purpose |
|--------|---------|
| `addCommand(name, handler, docs)` | Register GM command |
| `addPromptInjection(text)` | Inject into system prompt (2000 char limit) |
| `patchFunction(obj, funcName, callback)` | Monkey-patch with original storage |
| `unpatchFunction(obj, funcName)` | Restore original function |
| `addUI(html, selector)` | Inject sanitized HTML |
| `addStyle(id, css)` | Inject CSS with tracking |
| `removeStyle(id)` | Remove tracked CSS |
| `registerHotkey(combo, callback)` | Register keyboard shortcut |
| `unregisterHotkey(combo)` | Remove hotkey |
| `registerHook(eventName, callback)` | Subscribe to game events |
| `unregisterHook(eventName, callback)` | Unsubscribe from events |
| `unloadMod(modId)` | Full mod cleanup |

**Validation:**
- `_validateModMeta()`: Validates mod manifest
  - Required: id, name, version
  - ID format: lowercase alphanumeric + underscore only
  - Type checks for dependencies, scripts, total_conversion

### ModLoaderIntegration.js - Engine Integration
- Bridges ModLoader with C++ engine
- IPC communication for mod events
- Callback registration for simulation hooks

### ModManagerUI.js - Mod Management UI
- Mod enable/disable interface
- Load order management
- Dependency resolution display

### runtimeData.js - Mod Runtime Data
- Persistent mod data storage
- Cross-mod data exchange

## Saves Module (/js/saves/)

### SaveManager.js (540 lines)
**Save/Load Operations:**
- Streaming save for large worlds (yieldThread)
- Auto-save with configurable interval
- Manual save slots (max 5)
- Auto-save slots (max 20)

**Storage Backends:**
- Electron: Native file I/O via IPC
- Browser: File System Access API (showDirectoryPicker)
- Fallback: localStorage (limited)

**Save Structure:**
- Player state
- World state (regions, NPCs, factions)
- Inventory (items, containers)
- Game log history
- Mod state

### SaveUI.js - Save/Load Interface
- Save slot management UI
- Import/export functionality
- Save preview/metadata display

### StorageProvider.js - Abstract Storage Layer
- Unified API for different storage backends
- Error handling with cooldown (FSA_ERROR_COOLDOWN: 10s)
- Streaming write support

## Cartographer Module (/js/cartographer/)

### globalMap.js (1622 lines) - World Map
**Features:**
- 256x256 tile rendering
- Biome visualization
- Region/faction overlays
- Location markers (cities, ruins, anomalies)
- Road/water depth rendering
- Flood visualization
- Interactive tile inspection

**Rendering Pipeline:**
- Canvas-based rendering
- Level-of-detail optimization
- Tile caching for performance
- Pan/zoom controls

**Data Sources:**
- C++ engine world state
- Biome registry
- Location database

## Design Patterns

### 1. Registry Pattern
- ItemRegistry, ContainerRegistry (Maps)
- Centralized entity lookup

### 2. Pub/Sub (EventBus)
- Decoupled event handling
- Listener lifecycle management

### 3. Strategy Pattern (StorageProvider)
- Interchangeable storage backends
- Unified API surface

### 4. Decorator Pattern (ModAPI.patchFunction)
- Function wrapping with original preservation
- Rollback capability

### 5. Singleton Pattern
- ModAPI as global singleton
- EventBus as central hub

## Security Considerations

### HTML Sanitization
- Iterative tag removal (nested bypass prevention)
- Entity decoding for URL schemes
- Event handler stripping

### Mod Sandboxing Limitations
⚠️ **JS mods run with FULL page privileges:**
- Can access all DOM elements
- Can intercept all network requests
- Can modify any global variable
- No execution time limits

**Mitigations:**
- Manifest validation
- HTML sanitization for UI injections
- Length limits on prompt injections

### Save Data Integrity
- Text encoding validation
- JSON structure verification
- Error cooldown to prevent spam

## Performance Optimizations

### Rendering
- Canvas-based (not DOM) for map
- Tile caching
- LOD for zoom levels

### Memory
- Streaming saves (chunked writes)
- Reference data caching
- Container normalization (deep clone prevention)

### Threading
- yieldThread() for non-blocking saves
- Async/await for I/O operations
- AbortController for cancellable requests

## Integration Points

### C++ ↔ JS Communication
- stdin/stdout JSON protocol
- Container/item synchronization
- World state updates

### Electron IPC
- File I/O operations
- Native dialog access
- System integration

### AI API
- Gemini integration
- Prompt injection system
- Response filtering

## Known Issues & Fixes

| Issue | Description | Fix |
|-------|-------------|-----|
| #2 | Mod unload incomplete | Added _originalFunctions tracking |
| #4 | Prompt injection overflow | Added 2000 char limit |
| #5 | XSS via mod UI | Improved HTML sanitization |
| #6 | Invalid mod manifests | Added _validateModMeta() |
| #8 | C++/JS flag desync | Bidirectional sync in PhysicalItem |
| #14 | Nested tag bypass | Iterative sanitization |
| #101 | Unused variable | Removed lastFSAErrorTime |
| #129 | Entity-encoded XSS | Added &#61; pattern matching |
