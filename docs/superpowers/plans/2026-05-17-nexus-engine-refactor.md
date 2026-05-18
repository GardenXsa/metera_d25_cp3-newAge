# Nexus Engine Data-Driven Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the C++ Nexus Engine to be fully data-driven, loading all world-building data (biomes, monsters, etc.) from JSON files instead of using hardcoded values.

**Architecture:** The core C++ `meterea_engine.exe` will become a "blind calculator". We will remove all game-specific enums and strings from the C++ code. New data structures (`BiomeDef`, `MonsterDef`, etc.) will be created and populated at runtime by parsing JSON data passed from the JavaScript frontend. The JS `ModLoader` will be updated to read these new JSON files.

**Tech Stack:** C++17, nlohmann/json, JavaScript (Electron, Node.js)

---

### Task 1: Update C++ Data Structures

**Files:**
- Modify: `engine/definitions.h`
- Modify: `engine/meterea_engine.cpp`

- [ ] **Step 1: Update `MapTile` struct in `meterea_engine.cpp`**
  - The `definitions.h` file is a red herring. The actual definitions are inside `meterea_engine.cpp`.
  - Replace `TileType type` with `uint8_t biome_id`.

- [ ] **Step 2: Remove `enum class TileType`**
  - Delete the entire `enum class TileType` block from `meterea_engine.cpp`.

- [ ] **Step 3: Remove `enum class MonsterType` and related functions**
  - Delete the `enum class MonsterType` block.
  - Delete the `monsterTypeToString` and `stringToMonsterType` helper functions.

---

### Task 2: Implement JSON Data Loading in C++

**Files:**
- Modify: `engine/meterea_engine.cpp`

- [ ] **Step 1: Find the main command loop**
  - Locate the `main()` function and the `while(true)` loop that reads commands from `stdin`.

- [ ] **Step 2: Enhance `loadDatabase` command handler**
  - In the `loadDatabase` case, add parsing logic for `biomes`, `city_gen`, `monsters`, and `disasters` using `nlohmann/json`.
  - Populate the corresponding new registries in the global `g_db` object.
  - Ensure safe parsing with `j.contains()` checks and provide default values.
  - For biomes, populate both `g_db.biomes` vector and the `g_db.biome_string_to_id` map. Assign numeric IDs during this process.

---

### Task 3: Refactor C++ Engine Logic

**Files:**
- Modify: `engine/meterea_engine.cpp`

- [ ] **Step 1: Refactor Map Generation**
  - Search for all usages of the old `TileType` enum, especially in the map generation logic (Perlin noise section).
  - Replace hardcoded threshold values with lookups from `g_db.biomes` based on the current noise values (elevation, temperature, moisture).
  - Replace direct assignments like `map.tiles[i].type = TileType::FOREST;` with `map.tiles[i].biome_id = g_db.biome_string_to_id["forest"];`.
  - Update `getTileCost()` to use `g_db.biomes[tile.biome_id].movement_cost`.

- [ ] **Step 2: Refactor City Generation**
  - Find `generateCityLayout` function.
  - Remove hardcoded vectors like `tavern_names`.
  - Replace name generation with random selections from `g_db.city_gen_rules.facility_names`.

- [ ] **Step 3: Refactor Monster Spawning**
  - Find code related to monster spawning (likely uses the old `MonsterType`).
  - Replace it with logic that uses the `g_db.monsters` registry.
  - When spawning a monster, select a `MonsterDef` based on biome tags or other rules.

- [ ] **Step 4: Refactor Disasters**
  - Find `processDisasters` function.
  - Remove hardcoded disaster logic.
  - Replace it with logic that iterates through `g_db.disasters` and triggers them based on their definitions.

- [ ] **Step 5: Final Hardcode Audit**
  - Search the entire `meterea_engine.cpp` file for any remaining Russian strings or game-specific terms like "Dragon", "Tavern", etc. and remove them.

---

### Task 4: Update JavaScript Integration

**Files:**
- Modify: `js/mods/ModLoaderIntegration.js`
- Modify: `main.js`

- [ ] **Step 1: Update `ModLoaderIntegration.js`**
  - In `loadDatabaseWithModsAndInitEngine`, add calls to `modLoader.readJsonFile` for the new data files:
    - `database.biomes = await modLoader.readJsonFile('./data/biomes.json');`
    - `database.city_gen = await modLoader.readJsonFile('./data/city_gen.json');`
    - `database.monsters = await modLoader.readJsonFile('./data/monsters.json');`
    - `database.disasters = await modLoader.readJsonFile('./data/disasters.json');`
  - Pass the new database properties in the `onDatabaseLoad` event.

- [ ] **Step 2: Update `nexusLoadDatabase` call**
  - Modify the call to `window.electronAPI.nexusLoadDatabase` to include the new data.
  ```javascript
  const loadDbResult = await window.electronAPI.nexusLoadDatabase(
      database.items, 
      database.recipes, 
      database.facilities,
      database.biomes,
      database.city_gen,
      database.monsters,
      database.disasters
  );
  ```

- [ ] **Step 3: Update `main.js` IPC Handler**
  - Modify the `nexus-load-database` IPC handler to accept the new arguments.
  ```javascript
  ipcMain.handle('nexus-load-database', async (event, items, recipes, facilities, biomes, cityGen, monsters, disasters) => {
      return await sendCommand('loadDatabase', { items, recipes, facilities, biomes, city_gen: cityGen, monsters, disasters });
  });
  ```
---

### Task 5: Verification

**Files:**
- Test: `engine/test_engine.py` (or other relevant test files)

- [ ] **Step 1: Review Existing Tests**
  - Examine existing tests to see if they are affected by the core changes.
  - It's likely many tests will break due to the removal of enums and hardcoded data.

- [ ] **Step 2: Create a temporary test script**
  - Since this is a major refactor, creating a simple JS script or modifying `script.js` to load the game and verify the map generates without crashing might be the most effective initial test.

- [ ] **Step 3: Run the application**
  - The final test is to run the application and start a new game. If the world generates and the game doesn't crash, the refactor is broadly successful. Check the console for any C++ or JS errors.

