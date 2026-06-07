/**
 * meterea_engine.cpp Module Decomposition Plan
 * =============================================
 * FIX (Issue #20): meterea_engine.cpp (16 188 lines) is a monolith that should be
 * decomposed into separate translation units. This file documents the planned
 * module boundaries. Each module will become a .cpp/.h pair compiled separately.
 *
 * CURRENT SECTION MAP (by line number):
 *
 * Lines    1-60:    Includes, forward declarations
 * Lines   60-810:   Data structures (Database, ItemDef, RecipeDef, etc.)
 * Lines  811-1432:  Utility functions (getItemNumericProperty, getCoreIdsByTag, etc.)
 * Lines 1433-4137:  Core simulation (tick, simulate, buildWorld, bootstrap)
 * Lines 4138-4297:  Plugin/mod system (MeteraPlugin_*, mod SDK)
 * Lines 4298-4865:  Network/HTTP server
 * Lines 4866-14659: Subsystems (economy, combat, NPC AI, quests, map, etc.)
 * Lines 14660-16188: JSON I/O, command dispatch, main loop
 *
 * DECOMPOSITION PLAN:
 *
 * 1. engine/core/database.h + database.cpp
 *    — Database struct, ItemDef, RecipeDef, all data structures
 *    — Unified item access: itemExists(), getItemTemplate(), getItemDef()
 *
 * 2. engine/core/item_helpers.h + item_helpers.cpp
 *    — getItemNumericProperty, getCoreIdByTag, getCoreIdsByTagList
 *    — Item creation, property resolution
 *
 * 3. engine/core/simulation.h + simulation.cpp
 *    — World tick, simulate, homeostasis, time cascade
 *    — buildWorld, bootstrapWorld, simulateTicks
 *
 * 4. engine/core/npc_ai.h + npc_ai.cpp
 *    — NPC decision making, personality, goals, schedule
 *
 * 5. engine/core/economy.h + economy.cpp
 *    — Market pricing, trade, business management
 *    — Port facilities, ship routes
 *
 * 6. engine/core/combat.h + combat.cpp
 *    — Combat resolution, damage calculation, wounds
 *
 * 7. engine/core/factions.h + factions.cpp
 *    — Faction relations, ruler AI, intrigues
 *
 * 8. engine/core/quests.h + quests.cpp
 *    — Quest generation, objective tracking
 *
 * 9. engine/core/map_gen.h + map_gen.cpp
 *    — Terrain generation, biome assignment, roads
 *
 * 10. engine/core/json_io.h + json_io.cpp
 *     — Database loading, world serialization, command parsing
 *
 * 11. engine/core/command_dispatch.h + command_dispatch.cpp
 *     — Command routing, validation, execution
 *
 * 12. engine/core/mod_system.h + mod_system.cpp
 *     — Plugin loading, mod SDK, hook dispatch
 *
 * 13. engine/core/http_server.h + http_server.cpp
 *     — Static file serving, rate limiting, CSP headers
 *
 * MIGRATION STRATEGY:
 * - Phase 1: Extract data structures into database.h (header-only, no code changes)
 * - Phase 2: Extract utility functions (item_helpers.cpp) — depends on database.h
 * - Phase 3: Extract subsystems one by one — each includes database.h + json_wrapper.h
 * - Phase 4: Update Makefile/CMakeLists to compile all .cpp files separately
 * - Phase 5: meterea_engine.cpp becomes a thin main() that includes headers and calls init
 *
 * Each extracted module should:
 * - Include json_wrapper.h and database.h as needed
 * - Use forward declarations instead of #include when possible
 * - Have its own test in engine/tests/
 * - Not depend on global state beyond g_db and g_itemRegistry
 */
