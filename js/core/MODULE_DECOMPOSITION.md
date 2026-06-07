/**
 * script.js Module Decomposition Plan
 * ====================================
 * FIX (Issue #19): script.js (18 710 lines) is a monolith that should be decomposed.
 * This file documents the planned module boundaries. Each module will be extracted
 * into js/core/<name>.js and imported via <script> tags in index.html.
 *
 * DECOMPOSITION PLAN:
 *
 * 1. js/core/game_rng.js          (~30 lines)  — GameRNG seeded PRNG
 * 2. js/core/secure_storage.js    (~60 lines)  — SecureKeyStorage XOR encryption
 * 3. js/core/state_registry.js    (~35 lines)  — MetereaState centralized registry
 * 4. js/core/inventory_system.js  (~500 lines) — OldCoreInventorySystem + CoreInventorySystemAsync + Proxy
 * 5. js/core/command_executor.js  (~2000 lines)— executeCommand + all command handlers
 * 6. js/core/prompt_system.js     (~1500 lines)— Prompt building, processCommands, AI response handling
 * 7. js/core/character_creation.js(~800 lines) — Character creation UI + finalization
 * 8. js/core/map_system.js        (~600 lines) — Cartographer integration, location management
 * 9. js/core/combat_system.js     (~400 lines) — Combat state, damage calculation
 * 10. js/core/economy_system.js   (~500 lines) — Trading, prices, business management
 * 11. js/core/quest_system.js     (~400 lines) — Quest tracking, objectives, completion
 * 12. js/core/travel_system.js    (~600 lines) — Journey, trek, travel events
 * 13. js/core/ui_manager.js       (~2000 lines)— All UI update functions, panel management
 * 14. js/core/settings_manager.js (~800 lines) — Settings load/save, API key management
 * 15. js/core/ai_provider.js      (~1500 lines)— AI provider routing, API calls, response parsing
 *
 * MIGRATION STRATEGY:
 * - Phase 1: Extract pure-logic modules (RNG, storage, state) — no DOM dependencies
 * - Phase 2: Extract data modules (inventory, economy, combat) — depend on registries only
 * - Phase 3: Extract UI modules (character creation, settings, map) — depend on DOM
 * - Phase 4: Wire everything together via MetereaState and EventBus
 *
 * Each extracted module should:
 * - Use 'use strict'
 * - Export via window.<ModuleName> or module.exports
 * - Import dependencies explicitly at the top
 * - Have its own test file in tests/
 */
