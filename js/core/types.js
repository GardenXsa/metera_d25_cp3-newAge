/**
 * @fileoverview Type definitions for Chronicles of Meterea
 *
 * FIX (Issue #68): JSDoc type annotations for the JS codebase.
 * These types provide IDE autocompletion and static analysis via:
 *   - VS Code / WebStorm built-in JSDoc support
 *   - `npx tsc --checkJs --noEmit` for type checking without migration
 *
 * To enable type checking, add a tsconfig.json:
 *   { "compilerOptions": { "allowJs": true, "checkJs": true, "noEmit": true, "strict": false } }
 *
 * Full TypeScript migration is deferred — JSDoc annotations provide 80% of
 * the benefits with 0% of the migration cost.
 */

// ============================================================================
// Core Game Types
// ============================================================================

/**
 * @typedef {Object} Player
 * @property {string} name - Player character name
 * @property {string} race - Race ID (human, elf, dwarf, orc)
 * @property {string} class - Class ID (warrior, mage, rogue, bard, etc.)
 * @property {string} era - Era ID (rebirth, etc.)
 * @property {string} location - Current location string
 * @property {PlayerStats} stats - Player statistics
 * @property {string|null} container_backpack - Backpack container ID
 * @property {string|null} container_equipment - Equipment container ID
 * @property {Object<string, string>} equipment - Slot→itemId mapping
 * @property {Object<string, Object>} quests - Active quests
 * @property {Object<string, Object>} skills - Unlocked skills
 * @property {Object<string, number>} statusEffects - Active effects
 * @property {Object<string, Object>} visibleEntities - Nearby entities
 * @property {Object<string, Object>} allKnownEntities - All discovered entities
 * @property {string[]} visitedLocations - Location history
 */

/**
 * @typedef {Object} PlayerStats
 * @property {number} str - Strength
 * @property {number} dex - Dexterity
 * @property {number} int - Intelligence
 * @property {number} con - Constitution
 * @property {number} cha - Charisma
 * @property {number} res - Resilience
 * @property {number} hp - Current hit points
 * @property {number} maxHp - Maximum hit points
 * @property {number} mana - Current mana
 * @property {number} maxMana - Maximum mana
 * @property {number} level - Character level
 * @property {number} xp - Experience points
 * @property {number} gold - Gold coins
 * @property {number} turnCount - Total turns played
 * @property {Object<string, number>} reputation - Reputation per faction
 */

/**
 * @typedef {Object} Item
 * @property {string} id - Unique item instance ID
 * @property {string} prototype_id - Reference to item template
 * @property {string} name - Display name
 * @property {number} stack_size - Quantity in stack
 * @property {string} container_id - Containing container ID
 * @property {string|null} slot_index - Equipment slot
 * @property {string} state - Item state (idle, equipped, etc.)
 * @property {ItemFlags} flags - Item flags
 * @property {number} durability - Current durability
 * @property {ItemCustomProps} custom_props - Extended properties
 */

/**
 * @typedef {Object} ItemFlags
 * @property {boolean} quest_item - Cannot be dropped
 * @property {string|null} bound_to_owner - Soulbound to owner ID
 * @property {boolean} stolen - Marked as stolen goods
 * @property {boolean} magical - Has magical properties
 * @property {boolean} fragile - Breaks on drop
 */

/**
 * @typedef {Object} ItemCustomProps
 * @property {number} weight_per_unit - Weight in kg per unit
 * @property {string} name - Override display name
 * @property {string} [slot] - Equipment slot override
 * @property {string} [aiIdentifier] - AI reference identifier
 */

/**
 * @typedef {Object} Container
 * @property {string} id - Unique container ID
 * @property {string} type - Container type (player_backpack, static_chest, etc.)
 * @property {number} max_weight_kg - Maximum weight capacity
 * @property {number} max_slots - Maximum item slots
 * @property {string} owner_id - Owner entity ID
 * @property {ContainerLocation} location - Spatial location
 * @property {ContainerLockData} lock_data - Lock information
 * @property {ContainerPhysicalProps} physical_props - Physical properties
 * @property {Object} custom_props - Extended properties
 * @property {string[]} items - Item IDs in this container
 */

/**
 * @typedef {Object} ContainerLocation
 * @property {number[]|null} world_coords - [x, y, z] world coordinates
 * @property {string|null} parent_entity - Parent entity ID
 * @property {string|null} parent_container - Parent container ID
 * @property {string|null} region_id - Region ID
 */

/**
 * @typedef {Object} World
 * @property {number} tick - Current simulation tick
 * @property {string} era - Current era
 * @property {Object} time - Time of day
 * @property {Object<string, Object>} regions - Region data by ID
 * @property {Object<string, Object>} npcs - NPC data by ID
 * @property {Object<string, Object>} factions - Faction data by ID
 * @property {Object} homeostasis - World equilibrium metrics
 */

/**
 * @typedef {Object} RaceDef
 * @property {string} id - Race identifier
 * @property {string} name - Display name
 * @property {boolean} base_race - Whether this is the default race
 * @property {string[]} faction_preference - Preferred faction IDs
 * @property {string} biome_preference - Preferred biome tag
 * @property {Object<string, number>} stat_modifiers - Stat modifiers
 * @property {Object<string, ClassStats>} class_stats - Stats per class
 */

/**
 * @typedef {Object} ClassStats
 * @property {number} str - Strength
 * @property {number} dex - Dexterity
 * @property {number} int - Intelligence
 * @property {number} con - Constitution
 * @property {number} cha - Charisma
 * @property {number} res - Resilience
 */

/**
 * @typedef {Object} ModMeta
 * @property {string} id - Mod identifier
 * @property {string} name - Display name
 * @property {string} version - Semver version string
 * @property {string} [apiVersion] - ModKit API version
 * @property {string[]} [dependencies] - Required mod IDs
 * @property {boolean} [total_conversion] - Whether this replaces base game
 */

// ============================================================================
// API Types
// ============================================================================

/**
 * @typedef {Object} EngineCommand
 * @property {string} command - Command name
 * @property {Object} [params] - Command parameters
 */

/**
 * @typedef {Object} EngineResponse
 * @property {'ok'|'error'|'progress'|'hook_request'|'hook_event'|'realtime_update'} status
 * @property {string} [message] - Status message
 * @property {Object} [world] - World state (for sync responses)
 * @property {Array} [items] - Item registry entries
 * @property {Array} [containers] - Container registry entries
 */

/**
 * @typedef {Object} ParsedCommand
 * @property {string} narrative - Text without commands
 * @property {Array<{command: string, args: string[]}>} commands - Extracted commands
 */

// ============================================================================
// ModAPI Types
// ============================================================================

/**
 * @typedef {Object} ModAPI
 * @property {string} apiVersion - Current ModKit version
 * @property {Object<string, Object>} mods - Loaded mods
 * @property {Object<string, Function[]>} hooks - Registered hooks
 * @property {Object<string, Function>} customCommands - Custom command handlers
 * @property {Object<string, Function>} saveHandlers - Save/load handlers per mod
 * @property {function(string, Function): void} hookFunction - Register a hook
 * @property {function(string): void} unhookFunction - Remove mod's hooks
 * @property {function(string, string): string} resolveAsset - Get metera-mod:// URL
 * @property {function(Object): void} queueMutation - Queue a C-API mutation
 * @property {function(string, ...*): void} emit - Emit a mod event
 */
