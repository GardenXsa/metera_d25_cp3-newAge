/*
 * NEXUS ENGINE - Native World Simulation Core for Chronicles of Meterea
 * Full port of world_worker.js (2099 lines) to C++17
 * 
 * Architecture Layers:
 * 1. Data Layer (generated_data.h) - Auto-generated enums, constants, recipes from JSON
 * 2. Core Types - PhysicalItem, Storage (batch-based spoilage, stack management)
 * 3. World State - World, Region, Faction, NPC, Caravan, News with full serialization
 * 4. Simulation Engine - All systems from world_worker.js
 * 5. Protocol Layer - stdin/stdout JSON communication with Electron
 */

#include <iostream>
#include <string>
#include <vector>

#include <initializer_list>
#include <map>
#include <unordered_map>
#include <set>
#include <algorithm>
#include <cmath>
#include <cctype>
#include <sstream>
#include <random>
#include <cstdint>
#include <optional>
#include <variant>
#include <chrono>
#include <numeric>
#include <queue>
#include <future>
#include <thread>
#include <functional>
#include <memory>
#include <type_traits>
#include <stdexcept>

#include <thread>
#include <mutex>
#include <atomic>
#include <filesystem>
#ifdef _WIN32
#include <windows.h>
#else
#include <dlfcn.h>
#endif

// Tag-based architecture active
#include "json_wrapper.h"
#include "core_types.h"
#include "definitions.h"
#include "item_system.h"
#include "npc_personality.h"
#include <fstream>

// SINGLE DEFINITION OF GLOBAL REGISTRIES
ObjectPool<PhysicalItem> g_items;
ObjectPool<Storage> g_containers;
FacilityRegistry g_facilityRegistry;

// ============================================================================
// NEW TAG-BASED ITEM ARCHITECTURE
// ============================================================================

// A flexible property value (defined in item_system.h, do not redefine)
// using PropertyValue = std::variant<int, double, std::string>;

struct ItemDef { std::string id; int basePrice; std::string category; int shelfLife; JsonValue properties = JsonValue::object(); };
struct RecipeDef { std::string facility; std::unordered_map<std::string, int> inputs; std::unordered_map<std::string, int> outputs; };
struct Database {
    std::vector<std::string> all_item_ids;
    std::unordered_map<std::string, ItemDef> items;
    std::vector<RecipeDef> recipes;
    std::unordered_map<std::string, std::string> facility_names;

    // Data-driven canonical ids by semantic tag, loaded from data/tag_defaults.json
    std::unordered_map<std::string, std::string> tag_defaults;
    std::unordered_map<std::string, std::vector<std::string>> tag_default_lists;

    // New Data-Driven Registries
    std::vector<BiomeDef> biomes;
    std::unordered_map<std::string, uint8_t> biome_string_to_id;
    std::unordered_map<uint8_t, size_t> biome_numeric_to_index;
    std::vector<std::string> biome_legacy_numeric_ids; // Data-driven: legacy save migration list
    CityGenDef city_gen_rules;
    std::unordered_map<std::string, MonsterDef> monsters;
    std::unordered_map<std::string, DisasterDef> disasters;

    // Phase 1: Character Registries
    std::unordered_map<std::string, RaceDef> races;
    std::vector<std::string> race_ids; // Ordered list for random selection
    std::unordered_map<std::string, ProfessionDef> professions;
    std::vector<std::string> profession_ids; // Ordered list for random selection
    std::unordered_map<std::string, TraitDef> traits;
    std::vector<std::string> trait_ids;
    std::unordered_map<std::string, NameGroupDef> name_groups; // key = race id
    std::unordered_map<std::string, std::string> faction_to_race;
    std::unordered_map<std::string, std::vector<std::string>> backgrounds; // key = "poor", "rich", "insane"

    // Phase 1: Faction Relations Registry
    FactionRelationsDef faction_relations;

    // World Generation Config
    struct WorldContinentConfig {
        double noise_frequency = 0.8;
        int noise_octaves = 4;
        double elevation_shift = 0.42;
        double edge_falloff_power = 2.5;
        double edge_falloff_range = 0.65;
        double edge_ocean_elevation = -0.6;
        double min_land_ratio = 0.55;
        bool connectivity_pass = true;
        int land_bridge_max_gap = 4;
        int remove_islands_under = 80;
        int smoothing_passes = 2;
    };
    struct WorldRiverConfig {
        double noise_frequency = 3.0;
        int noise_octaves = 3;
        double threshold_default = 0.025;
        double threshold_plains = 0.04;
        double threshold_mountains = 0.015;
    };
    struct WorldVolcanoConfig {
        int count = 5;
        int min_radius = 3;
        int max_radius = 6;
    };
    struct WorldConfigDef {
        int map_width = 256;
        int map_height = 256;
        std::string landform = "continent";
        WorldContinentConfig continent;
        WorldRiverConfig rivers;
        WorldVolcanoConfig volcanoes;
    };
    WorldConfigDef world_config;
};




// Global database instance
Database g_db;

struct GameplayRuntimeConfig {
    struct ContainerTypeDescriptor {
        bool has_is_locked = false;
        bool is_locked = false;
        bool has_health = false;
        int health = 0;
        bool has_lock_difficulty = false;
        int lock_difficulty = 0;
        bool has_flammable = false;
        bool flammable = true;
        bool has_capacity = false;
        int capacity = 0;
        bool has_max_weight = false;
        int max_weight = 0;
    };

    struct TransportDescriptor {
        std::string id;
        bool has_speed_multiplier = false;
        double speed_multiplier = 1.0;
        bool has_cargo_bonus = false;
        int cargo_bonus = 0;
        bool has_water_only = false;
        bool water_only = false;
    };

    struct ShipTypeDescriptor {
        std::string id;
        bool has_speed = false;
        double speed = 1.0;
        bool has_capacity = false;
        int capacity = 0;
        bool has_hull = false;
        int hull = 0;
        bool has_sailors = false;
        int sailors = 0;
        bool has_cannons = false;
        int cannons = 0;
        bool has_marines = false;
        int marines = 0;
        bool has_combat_power = false;
        int combat_power = 0;
        bool has_is_monster = false;
        bool is_monster = false;
        bool has_build_days = false;
        int build_days = 0;
        std::unordered_map<std::string, int> build_cost;
    };

    std::string container_id_prefix = "cont_";
    std::string item_id_prefix = "item_";
    double default_item_weight = 1.0;
    int default_lock_difficulty = 10;
    int default_container_health = 200;
    std::set<std::string> non_flammable_container_types = {"faction_vault"};
    std::unordered_map<std::string, ContainerTypeDescriptor> container_types;
    std::unordered_map<std::string, TransportDescriptor> transport_registry;
    std::unordered_map<std::string, ShipTypeDescriptor> ship_types;
    double trek_base_travel_speed = 0.5;
    int trek_bandit_cooldown_hours = 4;
    int npc_reserve_gold = 100;
    int npc_initial_gold_max = 100;
    int build_port_gold_cost = 5000;
    int infra_port_stone_cost = 2000;
    int infra_port_wood_cost = 1000;
    int infra_port_upgrade_stone_per_level = 1000;
    int infra_port_upgrade_wood_per_level = 500;
    int npc_luxury_spend_threshold = 500;
    int npc_mercenary_medical_threshold = 200;
    int npc_mercenary_weapon_threshold = 500;
    int npc_merchant_vehicle_threshold = 1000;
    int npc_merchant_vehicle_max_owned = 5;
    int infra_dam_gold_cost = 5000;
    int infra_dam_wood_cost = 1000;
    int infra_aqueduct_gold_cost = 8000;
    int infra_aqueduct_iron_cost = 500;
    int infra_well_gold_cost = 2000;
    int infra_road_gold_cost = 10000;
    int infra_road_wood_cost = 2000;
    double war_declare_min_desire = 50.0;
    int war_declare_min_wealth = 5000;
    int war_imperialism_wealth_ceiling = 20000;
    int war_total_food_threshold = 3000;
    int war_total_weapons_threshold = 1000;
    int war_total_gold_threshold = 5000;
    int war_limited_food_threshold = 500;
    int war_limited_weapons_threshold = 200;
    int war_limited_gold_threshold = 1000;
    int war_border_food_threshold = 100;
    int war_border_weapons_threshold = 50;
    int war_border_gold_threshold = 200;
    int gm_sabotage_cost = 3000;
    int monster_bounty_gold_cost = 5000;
    int path_impassable_cost_threshold = 9000;
    std::string default_race_id;
    std::string faction_vault_container_type = "faction_vault";
    std::string ruins_stash_container_type = "ruins_stash";
    std::string default_era_id;
    std::unordered_map<std::string, double> currency_physical_weights;
};

GameplayRuntimeConfig g_gameplay_runtime;

void resetGameplayRuntimeConfig() {
    g_gameplay_runtime = GameplayRuntimeConfig{};
}

double readJsonNumberOrDefault(const JsonValue& value, double fallback) {
    if (value.type == JsonValue::INT || value.type == JsonValue::DOUBLE) return value.asDouble();
    return fallback;
}

int readJsonIntOrDefault(const JsonValue& value, int fallback) {
    if (value.type == JsonValue::INT || value.type == JsonValue::DOUBLE) return value.asInt();
    return fallback;
}

bool readJsonBoolOrDefault(const JsonValue& value, bool fallback) {
    if (value.type == JsonValue::BOOLEAN || value.type == JsonValue::INT) return value.asBool();
    return fallback;
}

std::string normalizeShipTypeRuntimeId(const std::string& value) {
    std::string normalized = value;
    std::transform(
        normalized.begin(),
        normalized.end(),
        normalized.begin(),
        [](unsigned char ch) { return (char)std::tolower(ch); }
    );
    return normalized;
}

const GameplayRuntimeConfig::ContainerTypeDescriptor* getContainerTypeDescriptor(const std::string& type) {
    auto descriptorIt = g_gameplay_runtime.container_types.find(type);
    if (descriptorIt == g_gameplay_runtime.container_types.end()) return nullptr;
    return &descriptorIt->second;
}

const GameplayRuntimeConfig::TransportDescriptor* getTransportDescriptor(const std::string& prototypeId) {
    auto descriptorIt = g_gameplay_runtime.transport_registry.find(prototypeId);
    if (descriptorIt == g_gameplay_runtime.transport_registry.end()) return nullptr;
    return &descriptorIt->second;
}

const GameplayRuntimeConfig::ShipTypeDescriptor* getShipTypeDescriptor(const std::string& shipTypeId) {
    auto descriptorIt = g_gameplay_runtime.ship_types.find(normalizeShipTypeRuntimeId(shipTypeId));
    if (descriptorIt == g_gameplay_runtime.ship_types.end()) return nullptr;
    return &descriptorIt->second;
}

void loadGameplayRuntimeConfig(const JsonValue& gameplayRuntime) {
    resetGameplayRuntimeConfig();
    if (gameplayRuntime.type != JsonValue::OBJECT) return;

    if (gameplayRuntime.has("inventory_engine") && gameplayRuntime["inventory_engine"].type == JsonValue::OBJECT) {
        JsonValue inventoryEngine = gameplayRuntime["inventory_engine"];
        if (inventoryEngine.has("id_prefixes") && inventoryEngine["id_prefixes"].type == JsonValue::OBJECT) {
            JsonValue idPrefixes = inventoryEngine["id_prefixes"];
            if (idPrefixes.has("container") && idPrefixes["container"].type == JsonValue::STRING) {
                g_gameplay_runtime.container_id_prefix = idPrefixes["container"].asString();
            }
            if (idPrefixes.has("item") && idPrefixes["item"].type == JsonValue::STRING) {
                g_gameplay_runtime.item_id_prefix = idPrefixes["item"].asString();
            }
        }
    }

    if (gameplayRuntime.has("inventory") && gameplayRuntime["inventory"].type == JsonValue::OBJECT) {
        JsonValue inventory = gameplayRuntime["inventory"];
        if (inventory.has("default_item_weight")) {
            g_gameplay_runtime.default_item_weight = readJsonNumberOrDefault(
                inventory["default_item_weight"],
                g_gameplay_runtime.default_item_weight
            );
        }
        if (inventory.has("default_lock_difficulty")) {
            g_gameplay_runtime.default_lock_difficulty = readJsonIntOrDefault(
                inventory["default_lock_difficulty"],
                g_gameplay_runtime.default_lock_difficulty
            );
        }
        if (inventory.has("default_container_health")) {
            g_gameplay_runtime.default_container_health = readJsonIntOrDefault(
                inventory["default_container_health"],
                g_gameplay_runtime.default_container_health
            );
        }
        if (inventory.has("non_flammable_container_types") &&
            inventory["non_flammable_container_types"].type == JsonValue::ARRAY) {
            g_gameplay_runtime.non_flammable_container_types.clear();
            for (size_t i = 0; i < inventory["non_flammable_container_types"].size(); ++i) {
                if (inventory["non_flammable_container_types"][i].type == JsonValue::STRING) {
                    g_gameplay_runtime.non_flammable_container_types.insert(
                        inventory["non_flammable_container_types"][i].asString()
                    );
                }
            }
        }
    }

    if (gameplayRuntime.has("currency") && gameplayRuntime["currency"].type == JsonValue::OBJECT) {
        JsonValue currency = gameplayRuntime["currency"];
        if (currency.has("physical_weights") && currency["physical_weights"].type == JsonValue::OBJECT) {
            g_gameplay_runtime.currency_physical_weights.clear();
            for (const auto& [itemId, value] : currency["physical_weights"].obj_val) {
                if (value.type == JsonValue::INT || value.type == JsonValue::DOUBLE) {
                    g_gameplay_runtime.currency_physical_weights[itemId] = value.asDouble();
                }
            }
        }
    }

    if (gameplayRuntime.has("engine_economy") && gameplayRuntime["engine_economy"].type == JsonValue::OBJECT) {
        JsonValue engineEconomy = gameplayRuntime["engine_economy"];
        if (engineEconomy.has("npc_reserve_gold")) {
            g_gameplay_runtime.npc_reserve_gold = std::max(
                0,
                readJsonIntOrDefault(engineEconomy["npc_reserve_gold"], g_gameplay_runtime.npc_reserve_gold)
            );
        }
        if (engineEconomy.has("npc_initial_gold_max")) {
            g_gameplay_runtime.npc_initial_gold_max = std::max(
                0,
                readJsonIntOrDefault(engineEconomy["npc_initial_gold_max"], g_gameplay_runtime.npc_initial_gold_max)
            );
        }
        if (engineEconomy.has("build_port_gold_cost")) {
            g_gameplay_runtime.build_port_gold_cost = std::max(
                1,
                readJsonIntOrDefault(engineEconomy["build_port_gold_cost"], g_gameplay_runtime.build_port_gold_cost)
            );
        }
        if (engineEconomy.has("infra_port_stone_cost")) g_gameplay_runtime.infra_port_stone_cost = std::max(0, readJsonIntOrDefault(engineEconomy["infra_port_stone_cost"], g_gameplay_runtime.infra_port_stone_cost));
        if (engineEconomy.has("infra_port_wood_cost")) g_gameplay_runtime.infra_port_wood_cost = std::max(0, readJsonIntOrDefault(engineEconomy["infra_port_wood_cost"], g_gameplay_runtime.infra_port_wood_cost));
        if (engineEconomy.has("infra_port_upgrade_stone_per_level")) g_gameplay_runtime.infra_port_upgrade_stone_per_level = std::max(0, readJsonIntOrDefault(engineEconomy["infra_port_upgrade_stone_per_level"], g_gameplay_runtime.infra_port_upgrade_stone_per_level));
        if (engineEconomy.has("infra_port_upgrade_wood_per_level")) g_gameplay_runtime.infra_port_upgrade_wood_per_level = std::max(0, readJsonIntOrDefault(engineEconomy["infra_port_upgrade_wood_per_level"], g_gameplay_runtime.infra_port_upgrade_wood_per_level));
        if (engineEconomy.has("npc_luxury_spend_threshold")) {
            g_gameplay_runtime.npc_luxury_spend_threshold = std::max(0, readJsonIntOrDefault(engineEconomy["npc_luxury_spend_threshold"], g_gameplay_runtime.npc_luxury_spend_threshold));
        }
        if (engineEconomy.has("npc_mercenary_medical_threshold")) {
            g_gameplay_runtime.npc_mercenary_medical_threshold = std::max(0, readJsonIntOrDefault(engineEconomy["npc_mercenary_medical_threshold"], g_gameplay_runtime.npc_mercenary_medical_threshold));
        }
        if (engineEconomy.has("npc_mercenary_weapon_threshold")) {
            g_gameplay_runtime.npc_mercenary_weapon_threshold = std::max(0, readJsonIntOrDefault(engineEconomy["npc_mercenary_weapon_threshold"], g_gameplay_runtime.npc_mercenary_weapon_threshold));
        }
        if (engineEconomy.has("npc_merchant_vehicle_threshold")) {
            g_gameplay_runtime.npc_merchant_vehicle_threshold = std::max(0, readJsonIntOrDefault(engineEconomy["npc_merchant_vehicle_threshold"], g_gameplay_runtime.npc_merchant_vehicle_threshold));
        }
        if (engineEconomy.has("npc_merchant_vehicle_max_owned")) {
            g_gameplay_runtime.npc_merchant_vehicle_max_owned = std::max(0, readJsonIntOrDefault(engineEconomy["npc_merchant_vehicle_max_owned"], g_gameplay_runtime.npc_merchant_vehicle_max_owned));
        }
        if (engineEconomy.has("infra_dam_gold_cost")) {
            g_gameplay_runtime.infra_dam_gold_cost = std::max(1, readJsonIntOrDefault(engineEconomy["infra_dam_gold_cost"], g_gameplay_runtime.infra_dam_gold_cost));
        }
        if (engineEconomy.has("infra_dam_wood_cost")) {
            g_gameplay_runtime.infra_dam_wood_cost = std::max(1, readJsonIntOrDefault(engineEconomy["infra_dam_wood_cost"], g_gameplay_runtime.infra_dam_wood_cost));
        }
        if (engineEconomy.has("infra_aqueduct_gold_cost")) {
            g_gameplay_runtime.infra_aqueduct_gold_cost = std::max(1, readJsonIntOrDefault(engineEconomy["infra_aqueduct_gold_cost"], g_gameplay_runtime.infra_aqueduct_gold_cost));
        }
        if (engineEconomy.has("infra_aqueduct_iron_cost")) {
            g_gameplay_runtime.infra_aqueduct_iron_cost = std::max(1, readJsonIntOrDefault(engineEconomy["infra_aqueduct_iron_cost"], g_gameplay_runtime.infra_aqueduct_iron_cost));
        }
        if (engineEconomy.has("infra_well_gold_cost")) {
            g_gameplay_runtime.infra_well_gold_cost = std::max(1, readJsonIntOrDefault(engineEconomy["infra_well_gold_cost"], g_gameplay_runtime.infra_well_gold_cost));
        }
        if (engineEconomy.has("infra_road_gold_cost")) {
            g_gameplay_runtime.infra_road_gold_cost = std::max(1, readJsonIntOrDefault(engineEconomy["infra_road_gold_cost"], g_gameplay_runtime.infra_road_gold_cost));
        }
        if (engineEconomy.has("infra_road_wood_cost")) {
            g_gameplay_runtime.infra_road_wood_cost = std::max(1, readJsonIntOrDefault(engineEconomy["infra_road_wood_cost"], g_gameplay_runtime.infra_road_wood_cost));
        }
        if (engineEconomy.has("war_declare_min_desire")) g_gameplay_runtime.war_declare_min_desire = readJsonNumberOrDefault(engineEconomy["war_declare_min_desire"], g_gameplay_runtime.war_declare_min_desire);
        if (engineEconomy.has("war_declare_min_wealth")) g_gameplay_runtime.war_declare_min_wealth = std::max(0, readJsonIntOrDefault(engineEconomy["war_declare_min_wealth"], g_gameplay_runtime.war_declare_min_wealth));
        if (engineEconomy.has("war_imperialism_wealth_ceiling")) g_gameplay_runtime.war_imperialism_wealth_ceiling = std::max(0, readJsonIntOrDefault(engineEconomy["war_imperialism_wealth_ceiling"], g_gameplay_runtime.war_imperialism_wealth_ceiling));
        if (engineEconomy.has("war_total_food_threshold")) g_gameplay_runtime.war_total_food_threshold = std::max(0, readJsonIntOrDefault(engineEconomy["war_total_food_threshold"], g_gameplay_runtime.war_total_food_threshold));
        if (engineEconomy.has("war_total_weapons_threshold")) g_gameplay_runtime.war_total_weapons_threshold = std::max(0, readJsonIntOrDefault(engineEconomy["war_total_weapons_threshold"], g_gameplay_runtime.war_total_weapons_threshold));
        if (engineEconomy.has("war_total_gold_threshold")) g_gameplay_runtime.war_total_gold_threshold = std::max(0, readJsonIntOrDefault(engineEconomy["war_total_gold_threshold"], g_gameplay_runtime.war_total_gold_threshold));
        if (engineEconomy.has("war_limited_food_threshold")) g_gameplay_runtime.war_limited_food_threshold = std::max(0, readJsonIntOrDefault(engineEconomy["war_limited_food_threshold"], g_gameplay_runtime.war_limited_food_threshold));
        if (engineEconomy.has("war_limited_weapons_threshold")) g_gameplay_runtime.war_limited_weapons_threshold = std::max(0, readJsonIntOrDefault(engineEconomy["war_limited_weapons_threshold"], g_gameplay_runtime.war_limited_weapons_threshold));
        if (engineEconomy.has("war_limited_gold_threshold")) g_gameplay_runtime.war_limited_gold_threshold = std::max(0, readJsonIntOrDefault(engineEconomy["war_limited_gold_threshold"], g_gameplay_runtime.war_limited_gold_threshold));
        if (engineEconomy.has("war_border_food_threshold")) g_gameplay_runtime.war_border_food_threshold = std::max(0, readJsonIntOrDefault(engineEconomy["war_border_food_threshold"], g_gameplay_runtime.war_border_food_threshold));
        if (engineEconomy.has("war_border_weapons_threshold")) g_gameplay_runtime.war_border_weapons_threshold = std::max(0, readJsonIntOrDefault(engineEconomy["war_border_weapons_threshold"], g_gameplay_runtime.war_border_weapons_threshold));
        if (engineEconomy.has("war_border_gold_threshold")) g_gameplay_runtime.war_border_gold_threshold = std::max(0, readJsonIntOrDefault(engineEconomy["war_border_gold_threshold"], g_gameplay_runtime.war_border_gold_threshold));
        if (engineEconomy.has("gm_sabotage_cost")) g_gameplay_runtime.gm_sabotage_cost = std::max(1, readJsonIntOrDefault(engineEconomy["gm_sabotage_cost"], g_gameplay_runtime.gm_sabotage_cost));
        if (engineEconomy.has("monster_bounty_gold_cost")) g_gameplay_runtime.monster_bounty_gold_cost = std::max(1, readJsonIntOrDefault(engineEconomy["monster_bounty_gold_cost"], g_gameplay_runtime.monster_bounty_gold_cost));
        if (engineEconomy.has("path_impassable_cost_threshold")) g_gameplay_runtime.path_impassable_cost_threshold = std::max(1, readJsonIntOrDefault(engineEconomy["path_impassable_cost_threshold"], g_gameplay_runtime.path_impassable_cost_threshold));
    }

    if (gameplayRuntime.has("engine_world") && gameplayRuntime["engine_world"].type == JsonValue::OBJECT) {
        JsonValue engineWorld = gameplayRuntime["engine_world"];
        if (engineWorld.has("default_race_id") && engineWorld["default_race_id"].type == JsonValue::STRING) {
            g_gameplay_runtime.default_race_id = engineWorld["default_race_id"].asString();
        }
        if (engineWorld.has("faction_vault_container_type") && engineWorld["faction_vault_container_type"].type == JsonValue::STRING) {
            g_gameplay_runtime.faction_vault_container_type = engineWorld["faction_vault_container_type"].asString();
        }
        if (engineWorld.has("ruins_stash_container_type") && engineWorld["ruins_stash_container_type"].type == JsonValue::STRING) {
            g_gameplay_runtime.ruins_stash_container_type = engineWorld["ruins_stash_container_type"].asString();
        }
        if (engineWorld.has("default_era_id") && engineWorld["default_era_id"].type == JsonValue::STRING) {
            g_gameplay_runtime.default_era_id = engineWorld["default_era_id"].asString();
        }
    }
}

void loadContainerTypeRuntimeConfig(const JsonValue& containerTypes) {
    g_gameplay_runtime.container_types.clear();
    if (containerTypes.type != JsonValue::OBJECT) return;

    for (const auto& [typeId, descriptorValue] : containerTypes.obj_val) {
        if (descriptorValue.type != JsonValue::OBJECT) continue;
        GameplayRuntimeConfig::ContainerTypeDescriptor descriptor;

        if (descriptorValue.has("is_locked")) {
            descriptor.has_is_locked = true;
            descriptor.is_locked = readJsonBoolOrDefault(descriptorValue["is_locked"], false);
        }
        if (descriptorValue.has("health")) {
            descriptor.has_health = true;
            descriptor.health = readJsonIntOrDefault(descriptorValue["health"], 0);
        }
        if (descriptorValue.has("lock_difficulty")) {
            descriptor.has_lock_difficulty = true;
            descriptor.lock_difficulty = readJsonIntOrDefault(descriptorValue["lock_difficulty"], 0);
        }
        if (descriptorValue.has("flammable")) {
            descriptor.has_flammable = true;
            descriptor.flammable = readJsonBoolOrDefault(descriptorValue["flammable"], true);
        }
        if (descriptorValue.has("capacity")) {
            descriptor.has_capacity = true;
            descriptor.capacity = readJsonIntOrDefault(descriptorValue["capacity"], 0);
        }
        if (descriptorValue.has("max_weight")) {
            descriptor.has_max_weight = true;
            descriptor.max_weight = readJsonIntOrDefault(descriptorValue["max_weight"], 0);
        } else if (descriptorValue.has("max_weight_kg")) {
            descriptor.has_max_weight = true;
            descriptor.max_weight = readJsonIntOrDefault(descriptorValue["max_weight_kg"], 0);
        } else if (descriptorValue.has("weight_limit")) {
            descriptor.has_max_weight = true;
            descriptor.max_weight = readJsonIntOrDefault(descriptorValue["weight_limit"], 0);
        }

        g_gameplay_runtime.container_types[typeId] = descriptor;
    }
}

void loadTransportRuntimeConfig(const JsonValue& transportRegistry) {
    g_gameplay_runtime.transport_registry.clear();
    if (transportRegistry.type != JsonValue::OBJECT) return;

    for (const auto& [prototypeId, descriptorValue] : transportRegistry.obj_val) {
        if (descriptorValue.type != JsonValue::OBJECT) continue;
        GameplayRuntimeConfig::TransportDescriptor descriptor;
        descriptor.id = descriptorValue.has("id") && descriptorValue["id"].type == JsonValue::STRING
            ? descriptorValue["id"].asString()
            : prototypeId;

        if (descriptorValue.has("speedMultiplier")) {
            descriptor.has_speed_multiplier = true;
            descriptor.speed_multiplier = readJsonNumberOrDefault(descriptorValue["speedMultiplier"], 1.0);
        } else if (descriptorValue.has("speed_mult")) {
            descriptor.has_speed_multiplier = true;
            descriptor.speed_multiplier = readJsonNumberOrDefault(descriptorValue["speed_mult"], 1.0);
        }

        if (descriptorValue.has("cargoBonus")) {
            descriptor.has_cargo_bonus = true;
            descriptor.cargo_bonus = readJsonIntOrDefault(descriptorValue["cargoBonus"], 0);
        } else if (descriptorValue.has("cargo_bonus")) {
            descriptor.has_cargo_bonus = true;
            descriptor.cargo_bonus = readJsonIntOrDefault(descriptorValue["cargo_bonus"], 0);
        }

        if (descriptorValue.has("waterOnly")) {
            descriptor.has_water_only = true;
            descriptor.water_only = readJsonBoolOrDefault(descriptorValue["waterOnly"], false);
        } else if (descriptorValue.has("water_only")) {
            descriptor.has_water_only = true;
            descriptor.water_only = readJsonBoolOrDefault(descriptorValue["water_only"], false);
        }

        g_gameplay_runtime.transport_registry[prototypeId] = descriptor;
    }
}

void loadTrekRuntimeConfig(const JsonValue& trekConfig) {
    if (trekConfig.type != JsonValue::OBJECT) return;

    if (trekConfig.has("base_travel_speed")) {
        double configuredSpeed = readJsonNumberOrDefault(
            trekConfig["base_travel_speed"],
            g_gameplay_runtime.trek_base_travel_speed
        );
        if (configuredSpeed > 0.0) {
            g_gameplay_runtime.trek_base_travel_speed = configuredSpeed;
        }
    }

    if (trekConfig.has("bandit_cooldown_hours")) {
        g_gameplay_runtime.trek_bandit_cooldown_hours = std::max(
            0,
            readJsonIntOrDefault(
                trekConfig["bandit_cooldown_hours"],
                g_gameplay_runtime.trek_bandit_cooldown_hours
            )
        );
    }
}

void loadShipTypeRuntimeConfig(const JsonValue& shipTypesValue) {
    g_gameplay_runtime.ship_types.clear();

    JsonValue descriptors = shipTypesValue;
    if (shipTypesValue.type == JsonValue::OBJECT && shipTypesValue.has("ship_types")) {
        descriptors = shipTypesValue["ship_types"];
    }
    if (descriptors.type != JsonValue::ARRAY) return;

    for (size_t i = 0; i < descriptors.size(); ++i) {
        const JsonValue& descriptorValue = descriptors[i];
        if (descriptorValue.type != JsonValue::OBJECT || !descriptorValue.has("id")) continue;

        GameplayRuntimeConfig::ShipTypeDescriptor descriptor;
        descriptor.id = normalizeShipTypeRuntimeId(descriptorValue["id"].asString());
        if (descriptor.id.empty()) continue;

        if (descriptorValue.has("speed")) {
            descriptor.has_speed = true;
            descriptor.speed = readJsonNumberOrDefault(descriptorValue["speed"], 1.0);
        }
        if (descriptorValue.has("capacity")) {
            descriptor.has_capacity = true;
            descriptor.capacity = readJsonIntOrDefault(descriptorValue["capacity"], 0);
        }
        if (descriptorValue.has("hull")) {
            descriptor.has_hull = true;
            descriptor.hull = readJsonIntOrDefault(descriptorValue["hull"], 0);
        }
        if (descriptorValue.has("sailors")) {
            descriptor.has_sailors = true;
            descriptor.sailors = readJsonIntOrDefault(descriptorValue["sailors"], 0);
        }
        if (descriptorValue.has("cannons")) {
            descriptor.has_cannons = true;
            descriptor.cannons = readJsonIntOrDefault(descriptorValue["cannons"], 0);
        }
        if (descriptorValue.has("marines")) {
            descriptor.has_marines = true;
            descriptor.marines = readJsonIntOrDefault(descriptorValue["marines"], 0);
        }
        if (descriptorValue.has("combat_power")) {
            descriptor.has_combat_power = true;
            descriptor.combat_power = readJsonIntOrDefault(descriptorValue["combat_power"], 0);
        }
        if (descriptorValue.has("is_monster")) {
            descriptor.has_is_monster = true;
            descriptor.is_monster = readJsonBoolOrDefault(descriptorValue["is_monster"], false);
        }
        if (descriptorValue.has("build_days")) {
            descriptor.has_build_days = true;
            descriptor.build_days = readJsonIntOrDefault(descriptorValue["build_days"], 0);
        }
        if (descriptorValue.has("build_cost") && descriptorValue["build_cost"].type == JsonValue::OBJECT) {
            for (const auto& [tagId, costValue] : descriptorValue["build_cost"].obj_val) {
                if (costValue.type == JsonValue::INT || costValue.type == JsonValue::DOUBLE) {
                    descriptor.build_cost[tagId] = std::max(0, costValue.asInt());
                }
            }
        }

        g_gameplay_runtime.ship_types[descriptor.id] = descriptor;
    }
}

int getShipBuildCost(const GameplayRuntimeConfig::ShipTypeDescriptor* descriptor, const std::string& tagId, int fallback) {
    if (!descriptor) return fallback;
    auto it = descriptor->build_cost.find(tagId);
    if (it == descriptor->build_cost.end()) return fallback;
    return std::max(0, it->second);
}

// ============================================================================
// NpcGen — Data-driven implementation (was in npc_personality.h)
// ============================================================================
namespace NpcGen {

    std::string generateName(const std::string& factionId, std::mt19937& gen) {
        // Resolve race from faction, or fall back to first available race
        std::string raceId = g_gameplay_runtime.default_race_id;
        auto ftrIt = g_db.faction_to_race.find(factionId);
        if (ftrIt != g_db.faction_to_race.end()) raceId = ftrIt->second;

        // Look up name group for this race
        auto ngIt = g_db.name_groups.find(raceId);
        if (ngIt != g_db.name_groups.end() && !ngIt->second.first_names.empty() && !ngIt->second.last_names.empty()) {
            const auto& ng = ngIt->second;
            const std::string& fn = ng.first_names[gen() % ng.first_names.size()];
            const std::string& ln = ng.last_names[gen() % ng.last_names.size()];
            return fn + " " + ln;
        }

        // Fallback: try any available name group
        for (const auto& [rid, ng] : g_db.name_groups) {
            if (!ng.first_names.empty() && !ng.last_names.empty()) {
                const std::string& fn = ng.first_names[gen() % ng.first_names.size()];
                const std::string& ln = ng.last_names[gen() % ng.last_names.size()];
                return fn + " " + ln;
            }
        }

        // Last resort: generic placeholder
        return "Unknown " + std::to_string(gen() % 9999);
    }

    std::string generateBackground(int wealth_level, int paranoia, std::mt19937& gen) {
        std::string category;
        if (paranoia > 80) category = "insane";
        else if (wealth_level > 70) category = "rich";
        else if (wealth_level > 30) category = "middle";
        else category = "poor";

        auto bgIt = g_db.backgrounds.find(category);
        if (bgIt != g_db.backgrounds.end() && !bgIt->second.empty()) {
            return bgIt->second[gen() % bgIt->second.size()];
        }

        // Fallback: try "poor" category
        bgIt = g_db.backgrounds.find("poor");
        if (bgIt != g_db.backgrounds.end() && !bgIt->second.empty()) {
            return bgIt->second[gen() % bgIt->second.size()];
        }

        return "No background available.";
    }
}

bool hasBiomeTag(uint8_t biome_id, const std::string& tag) {
    auto it = g_db.biome_numeric_to_index.find(biome_id);
    if (it == g_db.biome_numeric_to_index.end()) return false;
    const auto& tags = g_db.biomes[it->second].tags;
    return std::find(tags.begin(), tags.end(), tag) != tags.end();
}

uint8_t getBiomeIdByTag(const std::string& tag, uint8_t fallback = 0) {
    for (const auto& b : g_db.biomes) {
        if (std::find(b.tags.begin(), b.tags.end(), tag) != b.tags.end()) return b.numeric_id;
    }
    return fallback;
}

// Safely get BiomeDef pointer by numeric_id (uses lookup map instead of direct array index)
const BiomeDef* getBiomeById(uint8_t biome_id) {
    auto it = g_db.biome_numeric_to_index.find(biome_id);
    if (it == g_db.biome_numeric_to_index.end()) return nullptr;
    return &g_db.biomes[it->second];
}

// Helper: get biome string_id by numeric_id
std::string getBiomeStringId(uint8_t biome_id) {
    auto* b = getBiomeById(biome_id);
    return b ? b->string_id : "";
}


extern FacilityRegistry g_facilityRegistry;

std::string getFacilityName(const std::string& id) {
    const FacilityTemplate* tpl = ::g_facilityRegistry.getTemplate(id);
    if (tpl) {
        if (!g_gameplay_runtime.default_era_id.empty()) {
            auto it = tpl->names.find(g_gameplay_runtime.default_era_id);
            if (it != tpl->names.end()) return it->second;
        }
        if (!tpl->names.empty()) return tpl->names.begin()->second;
    }
    return id;
}

// Global registries
static std::vector<std::string> g_deleted_items;
static std::vector<std::string> g_deleted_containers;
static bool g_bootstrap = false;

// Thread Safety Primitives

static std::recursive_mutex g_registry_mutex;
static std::mutex g_news_mutex;
static std::mutex g_sublocations_mutex;
static std::mutex g_npc_state_mutex;
static std::mutex g_output_mutex; // Protects std::cout from concurrent writes
    static std::mutex g_faction_state_mutex;
    static std::map<std::pair<std::string, std::string>, std::vector<std::pair<int,int>>> g_path_cache;
    static std::atomic<bool> g_path_cache_dirty{true};

        void rebuildContainerIndices() {
        std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
        for (size_t i=0; i<g_containers.data.size(); ++i) {
            if (!g_containers.active[i]) continue;
            Storage& cont = g_containers.data[i];
            cont.items_by_type.clear();
            cont.cached_stocks.clear();
            for (const auto& itemId : cont.item_ids) {
                if (g_items.count(itemId)) {
                    cont.items_by_type[g_items[itemId].prototype_id].push_back(itemId);
                    cont.cached_stocks[g_items[itemId].prototype_id] += g_items[itemId].stack_size;
                }
            }
        }
    }

// Thread-safe RNG (No std::random_device to prevent MinGW crashes)
inline int thread_safe_rand() {
    thread_local std::mt19937 gen(static_cast<unsigned int>(std::chrono::system_clock::now().time_since_epoch().count()) ^ static_cast<unsigned int>(std::hash<std::thread::id>{}(std::this_thread::get_id())));
    thread_local std::uniform_int_distribution<> dist(0, 32767);
    return dist(gen);
}

// Helper: Generate UUID (Thread-safe)
std::string generateUUID() {
    thread_local std::mt19937 gen(static_cast<unsigned int>(std::chrono::system_clock::now().time_since_epoch().count()) + static_cast<unsigned int>(std::hash<std::thread::id>{}(std::this_thread::get_id())) + 1);
    std::uniform_int_distribution<> hex_dist(0, 15);
    const char* hex = "0123456789abcdef";
    std::string uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
    for (size_t i = 0; i < uuid.size(); i++) {
        if (uuid[i] == 'x') uuid[i] = hex[hex_dist(gen)];
        else if (uuid[i] == 'y') uuid[i] = hex[(hex_dist(gen) & 0x3) | 0x8];
    }
    return uuid;
}

// Item management
int getShelfLifeDays(const std::string& type); // Forward declaration for item stacking

struct WorldMap;
enum class MovementType : uint8_t {
    LAND,
    WATER,
    AIR,
    ANY
};

struct AStarNode {
    int x, y;
    int g, f;

};

struct AStarCompare {
    bool operator()(const AStarNode& a, const AStarNode& b) const {
        return a.f > b.f;
    }
};


// Forward declaration for A* pathfinding
std::vector<std::pair<int,int>> findPath(const WorldMap& map, int startX, int startY, int goalX, int goalY, const std::vector<bool>& has_road, const std::vector<int>& path_status, MovementType moveType, int entity_size = 0);

std::string createContainer(const std::string& type, const std::string& ownerId, 
                            int maxWeight, int maxSlots, const std::string& regionId = "",
                            const std::string& parentEntity = "", const std::string& parentContainer = "") {
    std::string new_id = g_gameplay_runtime.container_id_prefix + generateUUID();
    std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
    const GameplayRuntimeConfig::ContainerTypeDescriptor* descriptor = getContainerTypeDescriptor(type);
    Storage cont;
    cont.id = new_id;
    cont.type = type;
    cont.owner_id = ownerId;
    cont.max_weight_kg = maxWeight > 0
        ? maxWeight
        : ((descriptor && descriptor->has_max_weight) ? descriptor->max_weight : 999999);
    cont.max_slots = maxSlots > 0
        ? maxSlots
        : ((descriptor && descriptor->has_capacity) ? descriptor->capacity : 1000);
    
    if (!regionId.empty()) cont.location.set("region_id", regionId);
    if (!parentEntity.empty()) cont.location.set("parent_entity", parentEntity);
    if (!parentContainer.empty()) cont.location.set("parent_container", parentContainer);
    
    cont.lock_data.set("is_locked", (descriptor && descriptor->has_is_locked) ? descriptor->is_locked : false);
    cont.lock_data.set(
        "difficulty",
        (descriptor && descriptor->has_lock_difficulty)
            ? descriptor->lock_difficulty
            : g_gameplay_runtime.default_lock_difficulty
    );
    cont.physical_props.set(
        "health",
        (descriptor && descriptor->has_health)
            ? descriptor->health
            : g_gameplay_runtime.default_container_health
    );
    cont.physical_props.set(
        "flammable",
        (descriptor && descriptor->has_flammable)
            ? descriptor->flammable
            : (g_gameplay_runtime.non_flammable_container_types.count(type) == 0)
    );
    
    cont.is_dirty = true;
    g_containers[cont.id] = cont;
    return cont.id;
}

std::string getCoreIdByTag(const std::string& tag) {
    // Strict data-driven path: canonical ids MUST come from data/tag_defaults.json.
    // No registry-order fallback here — missing mappings are data contract errors.
    auto defaultIt = g_db.tag_defaults.find(tag);
    if (defaultIt == g_db.tag_defaults.end()) {
        std::cerr << ("DATA ERROR: missing required tag_defaults entry for tag '" + tag + "'") << std::endl;
        return "";
    }

    const std::string& defaultId = defaultIt->second;
    const ItemTemplate* tpl = g_itemRegistry.getTemplate(defaultId);

    if (!tpl) {
        std::cerr << ("DATA ERROR: tag_defaults['" + tag + "'] points to missing item id '" + defaultId + "'") << std::endl;
        return "";
    }

    if (!tpl->hasTag(tag)) {
        std::cerr << ("DATA ERROR: tag_defaults['" + tag + "']='" + defaultId + "' exists, but item does not have required tag '" + tag + "'") << std::endl;
        return "";
    }

    return defaultId;
}


std::vector<std::string> getCoreIdsByTagList(const std::string& listKey) {
    std::vector<std::string> ids;

    auto listIt = g_db.tag_default_lists.find(listKey);
    if (listIt != g_db.tag_default_lists.end()) {
        for (const std::string& itemId : listIt->second) {
            if (g_db.items.count(itemId) || g_itemRegistry.getTemplate(itemId)) {
                ids.push_back(itemId);
            } else {
                std::cerr << "DATA ERROR: tag_defaults['" << listKey << "'] contains missing item id '" << itemId << "'" << std::endl;
            }
        }
    }

    if (ids.empty()) {
        std::string scalarFallback = getCoreIdByTag(listKey);
        if (!scalarFallback.empty()) ids.push_back(scalarFallback);
    }

    return ids;
}

double getItemNumericProperty(const std::string& itemId, const std::string& propertyKey, double defaultValue = 0.0) {
    const ItemTemplate* tpl = g_itemRegistry.getTemplate(itemId);
    if (!tpl) return defaultValue;
    auto it = tpl->properties.find(propertyKey);
    if (it == tpl->properties.end()) return defaultValue;
    if (std::holds_alternative<int>(it->second)) return static_cast<double>(std::get<int>(it->second));
    if (std::holds_alternative<double>(it->second)) return std::get<double>(it->second);
    return defaultValue;
}

bool itemHasTag(const std::string& itemId, const std::string& tag) {
    const ItemTemplate* tpl = g_itemRegistry.getTemplate(itemId);
    return tpl && tpl->hasTag(tag);
}

double getFoodPriority(const std::string& itemId, const std::string& propertyKey = "army_supply_priority") {
    double explicitPriority = getItemNumericProperty(itemId, propertyKey, -1.0);
    if (explicitPriority >= 0.0) return explicitPriority;

    const ItemTemplate* tpl = g_itemRegistry.getTemplate(itemId);
    if (!tpl) return 0.0;

    if (tpl->hasTag("preserved_food")) return 100.0;
    if (tpl->hasTag("meat")) return 90.0;
    if (tpl->hasTag("fish")) return 85.0;
    if (tpl->hasTag("processed_food")) return 80.0;
    if (tpl->hasTag("bakery_product")) return 75.0;
    if (tpl->hasTag("grain") || tpl->hasTag("taxable_crop")) return 55.0;
    if (tpl->hasTag("raw_food")) return 45.0;
    if (tpl->hasTag("food")) return 60.0;
    return 0.0;
}

double getFoodReserveDays(const std::string& itemId) {
    double explicitDays = getItemNumericProperty(itemId, "reserve_days", -1.0);
    if (explicitDays >= 0.0) return explicitDays;

    const ItemTemplate* tpl = g_itemRegistry.getTemplate(itemId);
    if (!tpl) return 14.0;

    if (tpl->hasTag("grain") || tpl->hasTag("taxable_crop") || tpl->hasTag("preserved_food")) return 30.0;
    if (tpl->hasTag("processed_food") || tpl->hasTag("bakery_product")) return 14.0;
    if (tpl->hasTag("raw_food")) return 7.0;
    if (tpl->hasTag("food")) return 10.0;
    return 0.0;
}

double getSeasonalDemandMultiplier(const std::string& itemId, const std::string& season) {
    if (season.empty()) return 1.0;

    const double explicitMult = getItemNumericProperty(itemId, season + "_demand_mult", -1.0);
    if (explicitMult >= 0.0) return explicitMult;

    const ItemTemplate* tpl = g_itemRegistry.getTemplate(itemId);
    if (!tpl) return 1.0;

    if (season == "winter") {
        if (tpl->hasTag("food")) return 2.0;
        if (tpl->hasTag("construction_material") || tpl->hasTag("animal_product")) return 1.5;
    } else if (season == "autumn") {
        if (tpl->hasTag("food")) return 0.5;
    } else if (season == "spring") {
        if (tpl->hasTag("tool")) return 2.0;
    } else if (season == "summer") {
        if (tpl->hasTag("luxury") || tpl->hasTag("potion")) return 1.5;
    }

    return 1.0;
}

std::vector<std::string> getContainerItemTypesByTagSorted(const std::string& containerId, const std::string& tag, const std::string& priorityProperty = "army_supply_priority") {
    std::vector<std::pair<double, std::string>> rankedItems;
    if (!g_containers.count(containerId)) return {};

    for (const auto& [itemType, qty] : g_containers[containerId].cached_stocks) {
        if (qty <= 0 || !itemHasTag(itemType, tag)) continue;
        rankedItems.push_back({getFoodPriority(itemType, priorityProperty), itemType});
    }

    std::sort(rankedItems.begin(), rankedItems.end(), [](const auto& left, const auto& right) {
        if (left.first != right.first) return left.first > right.first;
        return left.second < right.second;
    });

    std::vector<std::string> itemTypes;
    itemTypes.reserve(rankedItems.size());
    for (const auto& [priority, itemType] : rankedItems) {
        itemTypes.push_back(itemType);
    }
    return itemTypes;
}

std::string getMappedId(const std::string& id) {
    if (g_db.items.count(id)) return id;
    return id; // Engine now expects correct IDs or uses tags directly.
}


std::string createItem(const std::string& requestedPrototypeId, int quantity, const std::string& containerId,
                       int currentDay = 0, const std::string& event = "Created") {
    std::string prototypeId = getMappedId(requestedPrototypeId);
    std::string new_id = g_gameplay_runtime.item_id_prefix + generateUUID();
    std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
    
    if (!containerId.empty() && g_containers.count(containerId)) {
        Storage& cont = g_containers[containerId];
        auto it = cont.items_by_type.find(prototypeId);
        if (it != cont.items_by_type.end()) {
            for (const std::string& existingId : it->second) {
                if (g_items.count(existingId)) {
                    PhysicalItem& exItem = g_items[existingId];
                    bool canStack = false;
                    if (!exItem.order_data.has_value() && !exItem.quest_item && exItem.durability == 100) {
                        if (!prototypeId.empty()) {
                            if (getShelfLifeDays(prototypeId) == 999999) canStack = true;
                            else if (exItem.batch_day == currentDay) canStack = true;
                        }
                    }
                    if (canStack) {
                        exItem.stack_size += quantity;
                        exItem.is_dirty = true;
                        cont.cached_stocks[prototypeId] += quantity;
                        cont.is_dirty = true;
                        return existingId;
                    }
                }
            }
        }
    }
    
    PhysicalItem item;
    item.id = new_id;
    item.prototype_id = prototypeId;
    item.stack_size = quantity;
    item.container_id = containerId;
    item.created_at = currentDay;
    item.last_moved_at = currentDay;
    item.batch_day = currentDay;
    item.history.push_back({currentDay, event});
    
    if (g_db.items.count(prototypeId)) {
        item.custom_props = g_db.items[prototypeId].properties;
    }
    
    double baseWeight = g_gameplay_runtime.default_item_weight;
    if (item.custom_props.has("weight_per_unit")) {
        baseWeight = readJsonNumberOrDefault(item.custom_props["weight_per_unit"], baseWeight);
    }
    auto runtimeWeightIt = g_gameplay_runtime.currency_physical_weights.find(prototypeId);
    if (runtimeWeightIt != g_gameplay_runtime.currency_physical_weights.end()) {
        baseWeight = runtimeWeightIt->second;
    }
    item.custom_props.set("weight_per_unit", baseWeight);
    
    g_items[item.id] = item;
    
    if (!containerId.empty() && g_containers.count(containerId)) {
        g_containers[containerId].item_ids.push_back(item.id);
        g_containers[containerId].items_by_type[prototypeId].push_back(item.id);
        g_containers[containerId].cached_stocks[prototypeId] += quantity;
        g_containers[containerId].is_dirty = true;
    }
    
    return item.id;
}

bool removeItem(const std::string& itemId, int quantity) {
    std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
    if (!g_items.count(itemId)) return false;
    
    PhysicalItem& item = g_items[itemId];
    if (item.stack_size <= quantity) {
        if (!item.container_id.empty() && g_containers.count(item.container_id)) {
            Storage& cont = g_containers[item.container_id];
            auto csIt = cont.cached_stocks.find(item.prototype_id);
            if (csIt != cont.cached_stocks.end()) {
                csIt->second -= item.stack_size;
                if (csIt->second < 0) csIt->second = 0; // Prevent underflow
            }
            auto& vec = cont.item_ids;
            auto it = std::find(vec.begin(), vec.end(), itemId);
            if (it != vec.end()) {
                *it = std::move(vec.back());
                vec.pop_back();
            }
            auto& type_vec = cont.items_by_type[item.prototype_id];
            auto it2 = std::find(type_vec.begin(), type_vec.end(), itemId);
            if (it2 != type_vec.end()) {
                *it2 = std::move(type_vec.back());
                type_vec.pop_back();
            }
            cont.is_dirty = true;
        }
        g_deleted_items.push_back(itemId);
        g_items.erase(itemId);
    } else {
        item.stack_size -= quantity;
        item.is_dirty = true;
        if (!item.container_id.empty() && g_containers.count(item.container_id)) {
            auto& cs = g_containers[item.container_id].cached_stocks;
            auto csIt = cs.find(item.prototype_id);
            if (csIt != cs.end()) {
                csIt->second -= quantity;
                if (csIt->second < 0) csIt->second = 0; // Prevent underflow
            }
        }
    }
    return true;
}

bool moveItem(const std::string& itemId, const std::string& targetContainerId);

        int countItemsInContainer(const std::string& containerId, const std::string& requestedPrototypeId) {
        std::string prototypeId = getMappedId(requestedPrototypeId);
        std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
        if (!g_containers.count(containerId)) return 0;
        if (prototypeId.empty()) return 0;
        auto it = g_containers[containerId].cached_stocks.find(prototypeId);
        return (it != g_containers[containerId].cached_stocks.end()) ? it->second : 0;
    }

double calculateContainerWeight(const std::string& containerId) {
    std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
    if (!g_containers.count(containerId)) return 0.0;
    double totalWeight = 0.0;
    for (const auto& itemId : g_containers[containerId].item_ids) {
        if (g_items.count(itemId)) {
            const PhysicalItem& item = g_items[itemId];
            double w = item.custom_props.has("weight_per_unit") ? item.custom_props["weight_per_unit"].asDouble() : 1.0;
            totalWeight += w * item.stack_size;
        }
    }
    return totalWeight;
}

int consumeItemsFromContainer(const std::string& containerId, const std::string& requestedPrototypeId, int quantity) {
    std::string prototypeId = getMappedId(requestedPrototypeId);
    std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
    if (!g_containers.count(containerId)) return 0;
    if (prototypeId.empty()) return 0;
    
    Storage& cont = g_containers[containerId];
    int taken = 0;
    int remaining = quantity;
    
    std::vector<std::pair<int, std::string>> itemsByAge;
    auto it = cont.items_by_type.find(prototypeId);
    if (it != cont.items_by_type.end()) {
        for (const auto& itemId : it->second) {
            if (g_items.count(itemId)) {
                itemsByAge.push_back({g_items[itemId].batch_day, itemId});
            }
        }
    }
    std::sort(itemsByAge.begin(), itemsByAge.end());
    
    for (const auto& [day, itemId] : itemsByAge) {
        if (remaining <= 0) break;
        if (!g_items.count(itemId)) continue;
        
        PhysicalItem& item = g_items[itemId];
        int take = std::min(item.stack_size, remaining);
        if (take > 0) {
            removeItem(itemId, take);
            remaining -= take;
            taken += take;
        }
    }
    
    return taken;
}

int getCategoryAmount(const std::string& vault_id, const std::string& category) {
    int total = 0;
    if (g_containers.count(vault_id)) {
        for (const auto& [item_type, qty] : g_containers[vault_id].cached_stocks) {
            const ItemTemplate* tpl = g_itemRegistry.getTemplate(item_type);
            if (tpl && tpl->hasTag(category)) total += qty;
        }
    }
    return total;
}

int getFoodAmount(const std::string& vault_id) {
    return getCategoryAmount(vault_id, "food");
}

int consumeCategory(const std::string& vault_id, const std::string& category, int amount, const std::string& priorityProperty = "") {
    int remaining = amount;
    if (!g_containers.count(vault_id)) return 0;

    std::vector<std::string> itemTypes;
    if (!priorityProperty.empty()) {
        itemTypes = getContainerItemTypesByTagSorted(vault_id, category, priorityProperty);
    } else {
        for (const auto& [item_type, qty] : g_containers[vault_id].cached_stocks) {
            const ItemTemplate* tpl = g_itemRegistry.getTemplate(item_type);
            if (tpl && tpl->hasTag(category)) itemTypes.push_back(item_type);
        }
    }

    for (const auto& itemType : itemTypes) {
        int taken = consumeItemsFromContainer(vault_id, itemType, remaining);
        remaining -= taken;
        if (remaining <= 0) break;
    }
    return amount - remaining;
}

int consumeFood(const std::string& vault_id, int amount) {
    return consumeCategory(vault_id, "food", amount, "reserve_priority");
}

std::string getPreferredAvailableFoodId(const std::string& vaultId) {
    auto rankedFoods = getContainerItemTypesByTagSorted(vaultId, "food", "market_priority");
    if (!rankedFoods.empty()) return rankedFoods.front();
    return getCoreIdByTag("food");
}

int getTaggedAmountFromStocks(const std::unordered_map<std::string, int>& stocks, const std::string& tag) {
    int total = 0;
    for (const auto& [itemId, qty] : stocks) {
        if (qty > 0 && itemHasTag(itemId, tag)) total += qty;
    }
    return total;
}

struct Region;
std::string inferLegacyPlacementTypeFromRegionName(const std::string& regionName);
std::set<std::string> inferRegionRawResourcesLegacy(const Region& region);


// ============================================================================
// WORLD STATE STRUCTURES
// ============================================================================

struct News {
    std::string id;
    std::string text;
    std::string location;
    int importance; // 1=minor, 2=notable, 3=major
    std::string category; // "trade", "war", "disaster", "politics", "misc"
    int day = 0;
    std::string causal_link; // ID of the event that caused this news
    double base_weight = 0.0;
    double current_weight = 0.0;

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("id", id);
        obj.set("text", text);
        obj.set("location", location);
        obj.set("importance", importance);
        obj.set("category", category);
        obj.set("day", day);
        obj.set("causal_link", causal_link);
        obj.set("base_weight", base_weight);
        obj.set("current_weight", current_weight);
        return obj;
    }
};

struct Caravan {
    std::string id;
    std::string merchant_id; // Владелец каравана (NPC)
    std::string owner_business_id; // ID предприятия-владельца
    std::string origin;
    std::string destination;
    int hoursLeft = 0;
    double x = 0.0;
    double y = 0.0;
    std::vector<std::pair<int, int>> path;
    int path_index = 0;
    std::string chest_id; // Container with goods
    int wagons = 0;       // Количество повозок в караване
    int guards = 0;       // Количество нанятой охраны
    int guard_cost = 0;   // Затраты на охрану
    int transport_cost = 0; // Затраты на транспорт
    
    // Legacy goods map (for compatibility)
    std::map<std::string, int> goods;
    
            

    JsonValue toJson() const {
            JsonValue obj = JsonValue::object();
            obj.set("id", id);
            obj.set("merchant_id", merchant_id);
            obj.set("owner_business_id", owner_business_id);
            obj.set("origin", origin);
            obj.set("destination", destination);
            obj.set("hoursLeft", hoursLeft);
            obj.set("x", x);
            obj.set("y", y);
            obj.set("path_index", path_index);
            JsonValue pArr = JsonValue::array();
            for (const auto& pt : path) {
                JsonValue ptArr = JsonValue::array();
                ptArr.push(pt.first); ptArr.push(pt.second);
                pArr.push(ptArr);
            }
            obj.set("path", pArr);
            obj.set("chest_id", chest_id);
            obj.set("wagons", wagons);
            obj.set("guards", guards);
            obj.set("guard_cost", guard_cost);
            obj.set("transport_cost", transport_cost);
        
        JsonValue g = JsonValue::object();
        for (const auto& [key, val] : goods) g.set(key, val);
        obj.set("goods", g);
        
        return obj;
    }
    
            static Caravan fromJson(const JsonValue& j) {
            Caravan c;
            c.id = j["id"].asString();
            if (j.has("merchant_id")) c.merchant_id = j["merchant_id"].asString();
            if (j.has("owner_business_id")) c.owner_business_id = j["owner_business_id"].asString();
            c.origin = j["origin"].asString();
            c.destination = j["destination"].asString();
            c.hoursLeft = j["hoursLeft"].asInt();
            if (j.has("x")) c.x = j["x"].asDouble();
            if (j.has("y")) c.y = j["y"].asDouble();
            if (j.has("path_index")) c.path_index = j["path_index"].asInt();
            if (j.has("path")) {
                for (size_t i = 0; i < j["path"].size(); i++) {
                    if (j["path"][i].size() >= 2) {
                        c.path.push_back({j["path"][i][0].asInt(), j["path"][i][1].asInt()});
                    }
                }
            }
            c.chest_id = j["chest_id"].asString();
            if (j.has("wagons")) c.wagons = j["wagons"].asInt();
            if (j.has("guards")) c.guards = j["guards"].asInt();
            if (j.has("guard_cost")) c.guard_cost = j["guard_cost"].asInt();
            if (j.has("transport_cost")) c.transport_cost = j["transport_cost"].asInt();
        
        if (j.has("goods")) {
            for (const auto& kv : j["goods"].obj_val) {
                c.goods[kv.first] = kv.second.asInt();
            }
        }
        
        return c;
    }
};

struct Wound {
    std::string type; // e.g., "deep_wound", "broken_arm", "scar"
    int severity = 0;     // 1-10
    int day_received = 0;

    

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("type", type);
        obj.set("severity", severity);
        obj.set("day_received", day_received);
        return obj;
    }

    static Wound fromJson(const JsonValue& j) {
        Wound w;
        if (j.has("type")) w.type = j["type"].asString();
        if (j.has("severity")) w.severity = j["severity"].asInt();
        if (j.has("day_received")) w.day_received = j["day_received"].asInt();
        return w;
    }
};

struct NPC {
    std::string id;
    std::string name;
    std::string type = "npc"; // "npc" or "ruler"
    std::string profession;
    std::string homeLocation;
    std::string currentLocation;
    std::string currentActivity;
    
    // Schedule
    struct ScheduleEntry {
        int start, end;
        std::string activity;
        std::string location;
    };
    std::vector<ScheduleEntry> schedule;
    
    // Needs (0-100)
    struct Needs {
        int hunger = 100;
        int rest = 100;
        int social = 100;
        int safety = 100;
    } needs;
    
    // Personality (0-100)
    struct Personality {
        int aggression = 50;
        int sociability = 50;
        int greed = 50;
        int loyalty = 50;
        int lust = 0;
    } personality;
    
    // Economy
    struct Economy {
        int skillLevel = 5;
        bool isEmployed = false;
        std::string workplaceId;
        int dailyWage = 0;
        int savings = 0;
        std::string profession_type = "none"; // farmer, artisan, merchant, innkeeper, ruler, cleric, mage, mercenary
        std::string personal_inventory_id;
        std::string storage_id;

        int reserve_gold = g_gameplay_runtime.npc_reserve_gold;
        int reserve_food = 5;
    } economy;
    
    // Inventory
    int gold = 0;
    std::string inventory_id; // Container ID for physical items
    
    // Demographics & Life Cycle
        std::string race = g_gameplay_runtime.default_race_id;
    int age_days = 0;
    bool is_male = true;
    std::string father_id;
    std::string mother_id;
    std::vector<std::string> children_ids;
    std::string spouse_id;
    std::vector<std::string> diseases;
    std::vector<Wound> wounds;
    std::vector<std::string> traits;
    int immunity = 100;
    std::vector<std::string> owned_businesses;
    int death_day = -1;
    std::string death_cause;

    int professionChangeTimestamp = 0;
    int currentWealthLevel = 0;

    // Status
    bool isAlive = true;
    int hp = 20;
    int maxHp = 20;
    bool plotArmor = false;
    
    // Travel
    std::string travelDestination;
    int travelHoursLeft = 0;
    std::string delivery_target_id;
    
    // For rulers
    int str = 10;
    int dex = 10;
    int con = 10;
    int int_ = 10;
    int cha = 10;
    int res = 10;
    int min_damage = 1;
    int max_damage = 6;
    int armor_class = 10;
    bool isHostile = false;
    int xpReward = 20;

    std::string factionId;
    struct RulerStats {
        int hp = 80, maxHp = 80;
        int str = 10, dex = 10, int_ = 14, con = 12, cha = 16, res = 10;
    } rulerStats;
    struct RulerPersonality {
        int ambition = 60;
        int paranoia = 50;
        int wisdom = 50;
        int cruelty = 50;
        int diplomacy = 50;
        int military = 50;
        int stewardship = 50;

        int supportLevel = 100;
    } rulerPersonality;
    int health = 100;
    bool alive = true;
    std::string heir;
    std::string currentGoal;
    std::string gmOverride;
    int lastTickDay = 0;
    
    std::map<std::string, int> relationships;
    std::vector<std::string> memory;
    
    

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("id", id);
        obj.set("name", name);
        obj.set("type", type);
        obj.set("profession", profession);
        obj.set("homeLocation", homeLocation);
        obj.set("currentLocation", currentLocation);
        obj.set("currentActivity", currentActivity);
        obj.set("isAlive", isAlive);
        obj.set("hp", hp);
        obj.set("maxHp", maxHp);
        obj.set("race", race);
        obj.set("age_days", age_days);
        obj.set("is_male", is_male);
        obj.set("father_id", father_id);
        obj.set("mother_id", mother_id);
        obj.set("spouse_id", spouse_id);
        obj.set("immunity", immunity);
        obj.set("death_day", death_day);
        obj.set("death_cause", death_cause);
        
        obj.set("str", str);
        obj.set("dex", dex);
        obj.set("con", con);
        obj.set("int", int_);
        obj.set("cha", cha);
        obj.set("res", res);
        obj.set("min_damage", min_damage);
        obj.set("max_damage", max_damage);
        obj.set("armor_class", armor_class);
        obj.set("isHostile", isHostile);
        obj.set("xpReward", xpReward);

        obj.set("professionChangeTimestamp", professionChangeTimestamp);
        obj.set("currentWealthLevel", currentWealthLevel);
        
        JsonValue childs = JsonValue::array();
        for (const auto& c : children_ids) childs.push(JsonValue(c));
        obj.set("children_ids", childs);

        JsonValue bus = JsonValue::array();
        for (const auto& b : owned_businesses) bus.push(JsonValue(b));
        obj.set("owned_businesses", bus);

        JsonValue dis = JsonValue::array();
        for (const auto& d : diseases) dis.push(JsonValue(d));
        obj.set("diseases", dis);

        JsonValue wnds = JsonValue::array();
        for (const auto& w : wounds) wnds.push(w.toJson());
        obj.set("wounds", wnds);

        JsonValue trts = JsonValue::array();
        for (const auto& t : traits) trts.push(JsonValue(t));
        obj.set("traits", trts);

        obj.set("gold", gold);
        obj.set("inventory_id", inventory_id);
        obj.set("travelDestination", travelDestination);
        obj.set("travelHoursLeft", travelHoursLeft);
        obj.set("delivery_target_id", delivery_target_id);
        
        JsonValue n = JsonValue::object();
        n.set("hunger", needs.hunger);
        n.set("rest", needs.rest);
        n.set("social", needs.social);
        n.set("safety", needs.safety);
        obj.set("needs", n);
        
        JsonValue p = JsonValue::object();
        p.set("aggression", personality.aggression);
        p.set("sociability", personality.sociability);
        p.set("greed", personality.greed);
        p.set("loyalty", personality.loyalty);
        p.set("lust", personality.lust);
        obj.set("personality", p);
        
        JsonValue e = JsonValue::object();
        e.set("skillLevel", economy.skillLevel);
        e.set("isEmployed", economy.isEmployed);
        e.set("workplaceId", economy.workplaceId);
        e.set("dailyWage", economy.dailyWage);
        e.set("savings", economy.savings);
        e.set("profession_type", economy.profession_type);
        e.set("personal_inventory_id", economy.personal_inventory_id);
        e.set("storage_id", economy.storage_id);

        e.set("reserve_gold", economy.reserve_gold);
        e.set("reserve_food", economy.reserve_food);
        obj.set("economy", e);
        
        JsonValue rels = JsonValue::object();
        for (const auto& [k, v] : relationships) rels.set(k, v);
        obj.set("relationships", rels);

        JsonValue mems = JsonValue::array();
        for (const auto& m : memory) mems.push(JsonValue(m));
        obj.set("memory", mems);


        // Schedule
        JsonValue sched = JsonValue::array();
        for (const auto& s : schedule) {
            JsonValue entry = JsonValue::object();
            entry.set("start", s.start);
            entry.set("end", s.end);
            entry.set("activity", s.activity);
            entry.set("location", s.location);
            sched.push(entry);
        }
        obj.set("schedule", sched);
        
        // Ruler-specific
        if (type == "ruler") {
            obj.set("factionId", factionId);
            obj.set("health", health);
            obj.set("alive", alive);
            obj.set("heir", heir);
            
            JsonValue rs = JsonValue::object();
            rs.set("hp", rulerStats.hp);
            rs.set("str", rulerStats.str);
            rs.set("dex", rulerStats.dex);
            rs.set("int", rulerStats.int_);
            rs.set("con", rulerStats.con);
            rs.set("cha", rulerStats.cha);
            rs.set("res", rulerStats.res);
            obj.set("rulerStats", rs);
            
            JsonValue rp = JsonValue::object();
            rp.set("ambition", rulerPersonality.ambition);
            rp.set("paranoia", rulerPersonality.paranoia);
            rp.set("wisdom", rulerPersonality.wisdom);
            rp.set("cruelty", rulerPersonality.cruelty);
            rp.set("diplomacy", rulerPersonality.diplomacy);
            rp.set("military", rulerPersonality.military);
            rp.set("stewardship", rulerPersonality.stewardship);

            rp.set("supportLevel", rulerPersonality.supportLevel);
            obj.set("rulerPersonality", rp);
        }
        
        return obj;
    }
    
    static NPC fromJson(const JsonValue& j) {
        NPC npc;
        npc.id = j["id"].asString();
        npc.name = j["name"].asString();
        npc.type = j["type"].asString();
        npc.profession = j["profession"].asString();
        npc.homeLocation = j["homeLocation"].asString();
        npc.currentLocation = j["currentLocation"].asString();
        npc.currentActivity = j["currentActivity"].asString();
        npc.isAlive = j.has("isAlive") ? j["isAlive"].asBool() : true;
        npc.hp = j["hp"].asInt();
        if (j.has("maxHp")) npc.maxHp = j["maxHp"].asInt(); else npc.maxHp = npc.hp;
        if (j.has("race")) npc.race = j["race"].asString();
        if (j.has("age_days")) npc.age_days = j["age_days"].asInt();
        if (j.has("is_male")) npc.is_male = j["is_male"].asBool();
        if (j.has("father_id")) npc.father_id = j["father_id"].asString();
        if (j.has("mother_id")) npc.mother_id = j["mother_id"].asString();
        if (j.has("spouse_id")) npc.spouse_id = j["spouse_id"].asString();
        if (j.has("immunity")) npc.immunity = j["immunity"].asInt(); else npc.immunity = 100;
        if (j.has("death_day")) npc.death_day = j["death_day"].asInt();
        if (j.has("death_cause")) npc.death_cause = j["death_cause"].asString();

        if (j.has("str")) npc.str = j["str"].asInt();
        if (j.has("dex")) npc.dex = j["dex"].asInt();
        if (j.has("con")) npc.con = j["con"].asInt();
        if (j.has("int")) npc.int_ = j["int"].asInt();
        if (j.has("cha")) npc.cha = j["cha"].asInt();
        if (j.has("res")) npc.res = j["res"].asInt();
        if (j.has("min_damage")) npc.min_damage = j["min_damage"].asInt();
        if (j.has("max_damage")) npc.max_damage = j["max_damage"].asInt();
        if (j.has("armor_class")) npc.armor_class = j["armor_class"].asInt();
        if (j.has("isHostile")) npc.isHostile = j["isHostile"].asBool();
        if (j.has("xpReward")) npc.xpReward = j["xpReward"].asInt();

        if (j.has("professionChangeTimestamp")) npc.professionChangeTimestamp = j["professionChangeTimestamp"].asInt();
        if (j.has("currentWealthLevel")) npc.currentWealthLevel = j["currentWealthLevel"].asInt();

        if (j.has("children_ids")) {
            for (size_t i = 0; i < j["children_ids"].size(); i++) npc.children_ids.push_back(j["children_ids"][i].asString());
        }
        if (j.has("owned_businesses")) {
            for (size_t i = 0; i < j["owned_businesses"].size(); i++) npc.owned_businesses.push_back(j["owned_businesses"][i].asString());
        }
        if (j.has("diseases")) {
            for (size_t i = 0; i < j["diseases"].size(); i++) npc.diseases.push_back(j["diseases"][i].asString());
        }

        if (j.has("wounds")) {
            for (size_t i = 0; i < j["wounds"].size(); i++) npc.wounds.push_back(Wound::fromJson(j["wounds"][i]));
        }
        if (j.has("traits")) {
            for (size_t i = 0; i < j["traits"].size(); i++) npc.traits.push_back(j["traits"][i].asString());
        }

        npc.gold = j["gold"].asInt();
        npc.inventory_id = j["inventory_id"].asString();
        if (j.has("travelDestination")) npc.travelDestination = j["travelDestination"].asString();
        if (j.has("travelHoursLeft")) npc.travelHoursLeft = j["travelHoursLeft"].asInt();
        if (j.has("delivery_target_id")) npc.delivery_target_id = j["delivery_target_id"].asString();
        
        if (j.has("needs")) {
            npc.needs.hunger = j["needs"]["hunger"].asInt();
            npc.needs.rest = j["needs"]["rest"].asInt();
            npc.needs.social = j["needs"]["social"].asInt();
            npc.needs.safety = j["needs"]["safety"].asInt();
        }
        
        if (j.has("personality")) {
            npc.personality.aggression = j["personality"]["aggression"].asInt();
            npc.personality.sociability = j["personality"]["sociability"].asInt();
            npc.personality.greed = j["personality"]["greed"].asInt();
            npc.personality.loyalty = j["personality"]["loyalty"].asInt();
            if (j["personality"].has("lust")) npc.personality.lust = j["personality"]["lust"].asInt();
        }
        
        if (j.has("economy")) {
            npc.economy.skillLevel = j["economy"]["skillLevel"].asInt();
            npc.economy.isEmployed = j["economy"]["isEmployed"].asBool();
            npc.economy.workplaceId = j["economy"]["workplaceId"].asString();
            npc.economy.dailyWage = j["economy"]["dailyWage"].asInt();
            npc.economy.savings = j["economy"]["savings"].asInt();
            if (j["economy"].has("profession_type")) npc.economy.profession_type = j["economy"]["profession_type"].asString();
            if (j["economy"].has("personal_inventory_id")) npc.economy.personal_inventory_id = j["economy"]["personal_inventory_id"].asString();
            if (j["economy"].has("storage_id")) npc.economy.storage_id = j["economy"]["storage_id"].asString();

            if (j["economy"].has("reserve_gold")) npc.economy.reserve_gold = j["economy"]["reserve_gold"].asInt();
            if (j["economy"].has("reserve_food")) npc.economy.reserve_food = j["economy"]["reserve_food"].asInt();
        }
        
        if (j.has("relationships")) {
            for (const auto& kv : j["relationships"].obj_val) {
                npc.relationships[kv.first] = kv.second.asInt();
            }
        }
        if (j.has("memory")) {
            for (size_t i = 0; i < j["memory"].size(); i++) {
                npc.memory.push_back(j["memory"][i].asString());
            }
        }


        if (j.has("schedule")) {
            for (size_t i = 0; i < j["schedule"].size(); i++) {
                ScheduleEntry s;
                s.start = j["schedule"][i]["start"].asInt();
                s.end = j["schedule"][i]["end"].asInt();
                s.activity = j["schedule"][i]["activity"].asString();
                s.location = j["schedule"][i]["location"].asString();
                npc.schedule.push_back(s);
            }
        }
        
        if (j.has("factionId")) {
            npc.factionId = j["factionId"].asString();
            npc.health = j["health"].asInt();
            npc.alive = j["alive"].asBool();
            npc.heir = j["heir"].asString();
            
            if (j.has("rulerStats")) {
                npc.rulerStats.hp = j["rulerStats"]["hp"].asInt();
                npc.rulerStats.str = j["rulerStats"]["str"].asInt();
                npc.rulerStats.dex = j["rulerStats"]["dex"].asInt();
                npc.rulerStats.int_ = j["rulerStats"]["int"].asInt();
                npc.rulerStats.con = j["rulerStats"]["con"].asInt();
                npc.rulerStats.cha = j["rulerStats"]["cha"].asInt();
                npc.rulerStats.res = j["rulerStats"]["res"].asInt();
            }
            
            if (j.has("rulerPersonality")) {
                npc.rulerPersonality.ambition = j["rulerPersonality"]["ambition"].asInt();
                npc.rulerPersonality.paranoia = j["rulerPersonality"]["paranoia"].asInt();
                npc.rulerPersonality.wisdom = j["rulerPersonality"]["wisdom"].asInt();
                npc.rulerPersonality.cruelty = j["rulerPersonality"]["cruelty"].asInt();
                npc.rulerPersonality.diplomacy = j["rulerPersonality"]["diplomacy"].asInt();
                npc.rulerPersonality.military = j["rulerPersonality"]["military"].asInt();
                npc.rulerPersonality.stewardship = j["rulerPersonality"]["stewardship"].asInt();

                if (j["rulerPersonality"].has("supportLevel")) npc.rulerPersonality.supportLevel = j["rulerPersonality"]["supportLevel"].asInt();
            }
        }
        
        return npc;
    }
};

struct Facility {
    int level = 0;
    int durability = 100;
    
    

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("level", level);
        obj.set("durability", durability);
        return obj;
    }
    static Facility fromJson(const JsonValue& j) {
        Facility f;
        if (j.has("level")) f.level = j["level"].asInt();
        if (j.has("durability")) f.durability = j["durability"].asInt();
        return f;
    }
};

struct Animals {
    int herbivores = 0;
    int carnivores = 0;
    
    

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("herbivores", herbivores);
        obj.set("carnivores", carnivores);
        return obj;
    }
    static Animals fromJson(const JsonValue& j) {
        Animals a;
        if (j.has("herbivores")) a.herbivores = j["herbivores"].asInt();
        if (j.has("carnivores")) a.carnivores = j["carnivores"].asInt();
        return a;
    }
};

struct CityBlock {
    int x = 0, y = 0;
    std::string type;
    std::string name;
    std::string linked_id;
    std::string sublocation_id;

    

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("x", x);
        obj.set("y", y);
        obj.set("type", type);
        obj.set("name", name);
        obj.set("linked_id", linked_id);
        obj.set("sublocation_id", sublocation_id);
        return obj;
    }

    static CityBlock fromJson(const JsonValue& j) {
        CityBlock b;
        if (j.has("x")) b.x = j["x"].asInt();
        if (j.has("y")) b.y = j["y"].asInt();
        if (j.has("type")) b.type = j["type"].asString();
        if (j.has("name")) b.name = j["name"].asString();
        if (j.has("linked_id")) b.linked_id = j["linked_id"].asString();
        if (j.has("sublocation_id")) b.sublocation_id = j["sublocation_id"].asString();
        return b;
    }
};


struct LogisticRule {
    std::string id;
    std::string type;
    std::string resource;
    std::string target_id;
    int amount = 0;
    bool amount_is_percent = false;
    int frequency_days = 1;
    int days_since_last = 0;
    int max_price = 0;
    int keep_reserve = 0;

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("id", id);
        obj.set("type", type);
        obj.set("resource", resource);
        obj.set("target_id", target_id);
        obj.set("amount", amount);
        obj.set("amount_is_percent", amount_is_percent);
        obj.set("frequency_days", frequency_days);
        obj.set("days_since_last", days_since_last);
        obj.set("max_price", max_price);
        obj.set("keep_reserve", keep_reserve);
        return obj;
    }

    static LogisticRule fromJson(const JsonValue& j) {
        LogisticRule r;
        if (j.has("id")) r.id = j["id"].asString();
        if (j.has("type")) r.type = j["type"].asString();
        if (j.has("resource")) r.resource = j["resource"].asString();
        if (j.has("target_id")) r.target_id = j["target_id"].asString();
        if (j.has("amount")) r.amount = j["amount"].asInt();
        if (j.has("amount_is_percent")) r.amount_is_percent = j["amount_is_percent"].asBool();
        if (j.has("frequency_days")) r.frequency_days = j["frequency_days"].asInt();
        if (j.has("days_since_last")) r.days_since_last = j["days_since_last"].asInt();
        if (j.has("max_price")) r.max_price = j["max_price"].asInt();
        if (j.has("keep_reserve")) r.keep_reserve = j["keep_reserve"].asInt();
        return r;
    }
};


struct Business {
    std::string id;
    std::vector<std::string> owner_ids;
    std::string region_id;
    std::string facility_type;
    int level = 1;
    int durability = 100;
    int cash_balance = 0;
    int reinvestment_pool = 0;
    std::string manager_id;
    int employee_count = 0;
    int target_employee_count = 100;
    int target_efficiency = 100;
    bool is_active = true;
    int construction_days_left = 0;
    bool auto_buy_inputs = false;
    bool auto_sell_outputs = false;
    int wage_level = 100; // 100% от среднего по региону
    int maintenance_budget = 100; // 100% от нормы
    int months_loss_streak = 0;
    std::string production_focus; // Specific GoodType string, e.g., "wheat"
    std::string local_storage_id; // Container ID for inputs/outputs
    std::vector<LogisticRule> logistics;
    std::vector<std::string> activity_logs;

    void addLog(int day, const std::string& msg) {
        int year = day / 360 + 1;
        int month = (day % 360) / 30 + 1;
        int d = (day % 30) + 1;
        std::string entry = "[Год " + std::to_string(year) + ", Месяц " + std::to_string(month) + ", День " + std::to_string(d) + "] " + msg;
        activity_logs.insert(activity_logs.begin(), entry);
        if (activity_logs.size() > 50) activity_logs.pop_back();
    }

    

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("id", id);
        JsonValue owners = JsonValue::array();
        for (const auto& o : owner_ids) owners.push(JsonValue(o));
        obj.set("owner_ids", owners);
        obj.set("region_id", region_id);
        obj.set("facility_type", facility_type);
        obj.set("level", level);
        obj.set("durability", durability);
        obj.set("cash_balance", cash_balance);
        obj.set("reinvestment_pool", reinvestment_pool);
        obj.set("manager_id", manager_id);
        obj.set("employee_count", employee_count);
        obj.set("target_employee_count", target_employee_count);
        obj.set("target_efficiency", target_efficiency);
        obj.set("is_active", is_active);
        obj.set("construction_days_left", construction_days_left);
        obj.set("auto_buy_inputs", auto_buy_inputs);
        obj.set("auto_sell_outputs", auto_sell_outputs);
        obj.set("wage_level", wage_level);
        obj.set("maintenance_budget", maintenance_budget);
        obj.set("months_loss_streak", months_loss_streak);
        obj.set("production_focus", production_focus);
        obj.set("local_storage_id", local_storage_id);
        JsonValue logs = JsonValue::array();
        for (const auto& l : logistics) logs.push(l.toJson());
        obj.set("logistics", logs);
        JsonValue alogs = JsonValue::array();
        for (const auto& l : activity_logs) alogs.push(JsonValue(l));
        obj.set("activity_logs", alogs);
        return obj;
    }

    static Business fromJson(const JsonValue& j) {
        Business b;
        if (j.has("id")) b.id = j["id"].asString();
        if (j.has("owner_ids")) {
            for (size_t i = 0; i < j["owner_ids"].size(); i++) b.owner_ids.push_back(j["owner_ids"][i].asString());
        }
        if (j.has("region_id")) b.region_id = j["region_id"].asString();
        if (j.has("facility_type")) b.facility_type = j["facility_type"].asString();
        if (j.has("level")) b.level = j["level"].asInt();
        if (j.has("durability")) b.durability = j["durability"].asInt();
        if (j.has("cash_balance")) b.cash_balance = j["cash_balance"].asInt();
        if (j.has("reinvestment_pool")) b.reinvestment_pool = j["reinvestment_pool"].asInt();
        if (j.has("manager_id")) b.manager_id = j["manager_id"].asString();
        if (j.has("employee_count")) b.employee_count = j["employee_count"].asInt();
        if (j.has("target_employee_count")) b.target_employee_count = j["target_employee_count"].asInt(); else b.target_employee_count = b.employee_count;
        if (j.has("target_efficiency")) b.target_efficiency = j["target_efficiency"].asInt(); else b.target_efficiency = 100;
        if (j.has("is_active")) b.is_active = j["is_active"].asBool();
        if (j.has("construction_days_left")) b.construction_days_left = j["construction_days_left"].asInt();
        if (j.has("auto_buy_inputs")) b.auto_buy_inputs = j["auto_buy_inputs"].asBool();
        if (j.has("auto_sell_outputs")) b.auto_sell_outputs = j["auto_sell_outputs"].asBool();
        if (j.has("wage_level")) b.wage_level = j["wage_level"].asInt();
        if (j.has("maintenance_budget")) b.maintenance_budget = j["maintenance_budget"].asInt();
        if (j.has("months_loss_streak")) b.months_loss_streak = j["months_loss_streak"].asInt();
        if (j.has("production_focus")) b.production_focus = j["production_focus"].asString();
        if (j.has("local_storage_id")) b.local_storage_id = j["local_storage_id"].asString();
        if (j.has("logistics")) {
            for (size_t i = 0; i < j["logistics"].size(); i++) {
                b.logistics.push_back(LogisticRule::fromJson(j["logistics"][i]));
            }
        }
        if (j.has("activity_logs")) {
            for (size_t i = 0; i < j["activity_logs"].size(); i++) {
                b.activity_logs.push_back(j["activity_logs"][i].asString());
            }
        }
        return b;
    }
};


struct MarketOffer {
    std::string id;
    std::string seller_id;
    std::string good;
    int quantity = 0;
    double price = 0.0;

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("id", id);
        obj.set("seller_id", seller_id);
        obj.set("good", good);
        obj.set("quantity", quantity);
        obj.set("price", price);
        return obj;
    }

    static MarketOffer fromJson(const JsonValue& j) {
        MarketOffer o;
        if (j.has("id")) o.id = j["id"].asString();
        if (j.has("seller_id")) o.seller_id = j["seller_id"].asString();
        if (j.has("good")) o.good = j["good"].asString();
        if (j.has("quantity")) o.quantity = j["quantity"].asInt();
        if (j.has("price")) o.price = j["price"].asDouble();
        return o;
    }
};

struct PriceHistory {
    std::vector<double> history;
    int index = 0;

    void add(double price) {
        if (history.size() < 30) {
            history.push_back(price);
        } else {
            history[index] = price;
            index = (index + 1) % 30;
        }
    }

    double getAvg(int days) const {
        if (history.empty()) return 0.0;
        int count = std::min((int)history.size(), days);
        double sum = 0;
        int curr = index - 1;
        for (int i = 0; i < count; i++) {
            if (curr < 0) curr = history.size() - 1;
            sum += history[curr];
            curr--;
        }
        return sum / count;
    }

    

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        JsonValue arr = JsonValue::array();
        for (double p : history) arr.push(JsonValue(p));
        obj.set("history", arr);
        obj.set("index", index);
        return obj;
    }

    static PriceHistory fromJson(const JsonValue& j) {
        PriceHistory ph;
        if (j.has("history")) {
            for (size_t i = 0; i < j["history"].size(); i++) {
                ph.history.push_back(j["history"][i].asDouble());
            }
        }
        if (j.has("index")) ph.index = j["index"].asInt();
        return ph;
    }
};


enum class DiplomaticState : uint8_t {
    PEACE, NON_AGGRESSION_PACT, DEFENSIVE_ALLIANCE, FULL_ALLIANCE,
    COLD_WAR, BORDER_CONFLICT, LIMITED_WAR, TOTAL_WAR
};

inline std::string diploStateToString(DiplomaticState s) {
    switch(s) {
        case DiplomaticState::PEACE: return "PEACE";
        case DiplomaticState::NON_AGGRESSION_PACT: return "NON_AGGRESSION_PACT";
        case DiplomaticState::DEFENSIVE_ALLIANCE: return "DEFENSIVE_ALLIANCE";
        case DiplomaticState::FULL_ALLIANCE: return "FULL_ALLIANCE";
        case DiplomaticState::COLD_WAR: return "COLD_WAR";
        case DiplomaticState::BORDER_CONFLICT: return "BORDER_CONFLICT";
        case DiplomaticState::LIMITED_WAR: return "LIMITED_WAR";
        case DiplomaticState::TOTAL_WAR: return "TOTAL_WAR";
        default: return "PEACE";
    }
}

inline DiplomaticState stringToDiploState(const std::string& s) {
    if (s == "NON_AGGRESSION_PACT") return DiplomaticState::NON_AGGRESSION_PACT;
    if (s == "DEFENSIVE_ALLIANCE") return DiplomaticState::DEFENSIVE_ALLIANCE;
    if (s == "FULL_ALLIANCE") return DiplomaticState::FULL_ALLIANCE;
    if (s == "COLD_WAR") return DiplomaticState::COLD_WAR;
    if (s == "BORDER_CONFLICT") return DiplomaticState::BORDER_CONFLICT;
    if (s == "LIMITED_WAR") return DiplomaticState::LIMITED_WAR;
    if (s == "TOTAL_WAR") return DiplomaticState::TOTAL_WAR;
    return DiplomaticState::PEACE;
}

enum class CasusBelli : uint8_t {
    NONE, BORDER_INCIDENT, RECLAIM_CORES, HUMANITARIAN, PREEMPTIVE, IMPERIALISM
};

inline std::string cbToString(CasusBelli cb) {
    switch(cb) {
        case CasusBelli::BORDER_INCIDENT: return "BORDER_INCIDENT";
        case CasusBelli::RECLAIM_CORES: return "RECLAIM_CORES";
        case CasusBelli::HUMANITARIAN: return "HUMANITARIAN";
        case CasusBelli::PREEMPTIVE: return "PREEMPTIVE";
        case CasusBelli::IMPERIALISM: return "IMPERIALISM";
        default: return "NONE";
    }
}

inline CasusBelli stringToCb(const std::string& s) {
    if (s == "BORDER_INCIDENT") return CasusBelli::BORDER_INCIDENT;
    if (s == "RECLAIM_CORES") return CasusBelli::RECLAIM_CORES;
    if (s == "HUMANITARIAN") return CasusBelli::HUMANITARIAN;
    if (s == "PREEMPTIVE") return CasusBelli::PREEMPTIVE;
    if (s == "IMPERIALISM") return CasusBelli::IMPERIALISM;
    return CasusBelli::NONE;
}

struct WarGoal {
    std::string targetRegionId;
    bool achieved = false;
    int deadlineDays = 0;

    

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("targetRegionId", targetRegionId);
        obj.set("achieved", achieved);
        obj.set("deadlineDays", deadlineDays);
        return obj;
    }

    static WarGoal fromJson(const JsonValue& j) {
        WarGoal w;
        if (j.has("targetRegionId")) w.targetRegionId = j["targetRegionId"].asString();
        if (j.has("achieved")) w.achieved = j["achieved"].asBool();
        if (j.has("deadlineDays")) w.deadlineDays = j["deadlineDays"].asInt();
        return w;
    }
};

struct Ultimatum {
    std::string fromFactionId;
    std::string toFactionId;
    std::string demand;
    int expiresDay = 0;
    bool accepted = false;

    

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("fromFactionId", fromFactionId);
        obj.set("toFactionId", toFactionId);
        obj.set("demand", demand);
        obj.set("expiresDay", expiresDay);
        obj.set("accepted", accepted);
        return obj;
    }

    static Ultimatum fromJson(const JsonValue& j) {
        Ultimatum u;
        if (j.has("fromFactionId")) u.fromFactionId = j["fromFactionId"].asString();
        if (j.has("toFactionId")) u.toFactionId = j["toFactionId"].asString();
        if (j.has("demand")) u.demand = j["demand"].asString();
        if (j.has("expiresDay")) u.expiresDay = j["expiresDay"].asInt();
        if (j.has("accepted")) u.accepted = j["accepted"].asBool();
        return u;
    }
};

struct Coalition {
    std::string leaderFactionId;
    std::string targetFactionId;
    std::vector<std::string> members;
    int formedOnDay = 0;

    

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("leaderFactionId", leaderFactionId);
        obj.set("targetFactionId", targetFactionId);
        obj.set("formedOnDay", formedOnDay);
        JsonValue mems = JsonValue::array();
        for (const auto& m : members) mems.push(JsonValue(m));
        obj.set("members", mems);
        return obj;
    }

    static Coalition fromJson(const JsonValue& j) {
        Coalition c;
        if (j.has("leaderFactionId")) c.leaderFactionId = j["leaderFactionId"].asString();
        if (j.has("targetFactionId")) c.targetFactionId = j["targetFactionId"].asString();
        if (j.has("formedOnDay")) c.formedOnDay = j["formedOnDay"].asInt();
        if (j.has("members")) {
            for (size_t i = 0; i < j["members"].size(); i++) {
                c.members.push_back(j["members"][i].asString());
            }
        }
        return c;
    }
};


struct PlannedHarvest {
    int days_left = 0;
    std::string good;
    int amount = 0;

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("days_left", days_left);
        obj.set("good", good);
        obj.set("amount", amount);
        return obj;
    }

    static PlannedHarvest fromJson(const JsonValue& j) {
        PlannedHarvest p;
        if (j.has("days_left")) p.days_left = j["days_left"].asInt();
        if (j.has("good")) p.good = j["good"].asString();
        if (j.has("amount")) p.amount = j["amount"].asInt();
        return p;
    }
};


enum class ShipType { MERCHANT, TRANSPORT, WAR_GALLEY, WAR_FRIGATE, EXPLORER, PIRATE, SEA_MONSTER };

inline std::string shipTypeToString(ShipType t) {
    switch(t) {
        case ShipType::MERCHANT: return "MERCHANT";
        case ShipType::TRANSPORT: return "TRANSPORT";
        case ShipType::WAR_GALLEY: return "WAR_GALLEY";
        case ShipType::WAR_FRIGATE: return "WAR_FRIGATE";
        case ShipType::EXPLORER: return "EXPLORER";
        case ShipType::PIRATE: return "PIRATE";
        case ShipType::SEA_MONSTER: return "SEA_MONSTER";

        default: return "MERCHANT";
    }
}

inline ShipType stringToShipType(const std::string& s) {
    if (s == "TRANSPORT") return ShipType::TRANSPORT;
    if (s == "WAR_GALLEY") return ShipType::WAR_GALLEY;
    if (s == "WAR_FRIGATE") return ShipType::WAR_FRIGATE;
    if (s == "EXPLORER") return ShipType::EXPLORER;
    if (s == "PIRATE") return ShipType::PIRATE;
    if (s == "SEA_MONSTER") return ShipType::SEA_MONSTER;

    return ShipType::MERCHANT;
}

struct Ship {
    std::string id;
    std::string owner_id;
    ShipType type = ShipType::MERCHANT;
    int hull = 100;
    int sailors = 10;
    int cargo_capacity = 100;
    std::string chest_id;
    double speed = 1.0;
    double x = 0.0;
    double y = 0.0;
    std::string destination;
    std::vector<std::pair<int,int>> path;
    int path_index = 0;
    int cannons = 0;
    int marines = 0;

    std::string fleet_id;

    

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("id", id);
        obj.set("owner_id", owner_id);
        obj.set("type", shipTypeToString(type));
        obj.set("hull", hull);
        obj.set("sailors", sailors);
        obj.set("cargo_capacity", cargo_capacity);
        obj.set("chest_id", chest_id);
        obj.set("speed", speed);
        obj.set("x", x);
        obj.set("y", y);
        obj.set("destination", destination);
        obj.set("path_index", path_index);
        JsonValue pArr = JsonValue::array();
        for (const auto& pt : path) {
            JsonValue ptArr = JsonValue::array();
            ptArr.push(pt.first); ptArr.push(pt.second);
            pArr.push(ptArr);
        }
        obj.set("path", pArr);
        obj.set("cannons", cannons);
        obj.set("marines", marines);

        obj.set("fleet_id", fleet_id);
        return obj;
    }

    static Ship fromJson(const JsonValue& j) {
        Ship s;
        if (j.has("id")) s.id = j["id"].asString();
        if (j.has("owner_id")) s.owner_id = j["owner_id"].asString();
        if (j.has("type")) s.type = stringToShipType(j["type"].asString());
        if (j.has("hull")) s.hull = j["hull"].asInt();
        if (j.has("sailors")) s.sailors = j["sailors"].asInt();
        if (j.has("cargo_capacity")) s.cargo_capacity = j["cargo_capacity"].asInt();
        if (j.has("chest_id")) s.chest_id = j["chest_id"].asString();
        if (j.has("speed")) s.speed = j["speed"].asDouble();
        if (j.has("x")) s.x = j["x"].asDouble();
        if (j.has("y")) s.y = j["y"].asDouble();
        if (j.has("destination")) s.destination = j["destination"].asString();
        if (j.has("path_index")) s.path_index = j["path_index"].asInt();
        if (j.has("path")) {
            for (size_t i = 0; i < j["path"].size(); i++) {
                if (j["path"][i].size() >= 2) {
                    s.path.push_back({j["path"][i][0].asInt(), j["path"][i][1].asInt()});
                }
            }
        }
        if (j.has("cannons")) s.cannons = j["cannons"].asInt();
        if (j.has("marines")) s.marines = j["marines"].asInt();

        if (j.has("fleet_id")) s.fleet_id = j["fleet_id"].asString();
        return s;
    }
};

void applyShipTypeRuntimeDescriptor(Ship& ship) {
    const GameplayRuntimeConfig::ShipTypeDescriptor* descriptor =
        getShipTypeDescriptor(shipTypeToString(ship.type));
    if (!descriptor) return;

    if (descriptor->has_capacity) {
        ship.cargo_capacity = descriptor->capacity;
    }
    if (descriptor->has_hull) {
        ship.hull = std::max(1, descriptor->hull);
    }
    if (descriptor->has_sailors) {
        ship.sailors = std::max(0, descriptor->sailors);
    }
    if (descriptor->has_speed && descriptor->speed > 0.0) {
        ship.speed = descriptor->speed;
    }
    if (descriptor->has_cannons) {
        ship.cannons = std::max(0, descriptor->cannons);
    }
    if (descriptor->has_marines) {
        ship.marines = std::max(0, descriptor->marines);
    }
}

struct Fleet {
    std::string id;
    std::string owner_id;
    std::vector<std::string> ship_ids;
    std::string admiral_id;
    double x = 0.0;
    double y = 0.0;
    std::string destination;
    std::vector<std::pair<int,int>> path;
    int path_index = 0;
    std::string mission = "patrol";

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("id", id);
        obj.set("owner_id", owner_id);
        JsonValue sArr = JsonValue::array();
        for (const auto& sid : ship_ids) sArr.push(JsonValue(sid));
        obj.set("ship_ids", sArr);
        obj.set("admiral_id", admiral_id);
        obj.set("x", x);
        obj.set("y", y);
        obj.set("destination", destination);
        obj.set("path_index", path_index);
        JsonValue pArr = JsonValue::array();
        for (const auto& pt : path) {
            JsonValue ptArr = JsonValue::array();
            ptArr.push(pt.first); ptArr.push(pt.second);
            pArr.push(ptArr);
        }
        obj.set("path", pArr);
        obj.set("mission", mission);
        return obj;
    }

    static Fleet fromJson(const JsonValue& j) {
        Fleet f;
        if (j.has("id")) f.id = j["id"].asString();
        if (j.has("owner_id")) f.owner_id = j["owner_id"].asString();
        if (j.has("ship_ids")) {
            for (size_t i = 0; i < j["ship_ids"].size(); i++) f.ship_ids.push_back(j["ship_ids"][i].asString());
        }
        if (j.has("admiral_id")) f.admiral_id = j["admiral_id"].asString();
        if (j.has("x")) f.x = j["x"].asDouble();
        if (j.has("y")) f.y = j["y"].asDouble();
        if (j.has("destination")) f.destination = j["destination"].asString();
        if (j.has("path_index")) f.path_index = j["path_index"].asInt();
        if (j.has("path")) {
            for (size_t i = 0; i < j["path"].size(); i++) {
                if (j["path"][i].size() >= 2) f.path.push_back({j["path"][i][0].asInt(), j["path"][i][1].asInt()});
            }
        }
        if (j.has("mission")) f.mission = j["mission"].asString();
        return f;
    }
};


enum class PortType { NONE, FISHING, TRADE, MILITARY };

inline std::string portTypeToString(PortType t) {
    switch(t) {
        case PortType::FISHING: return "FISHING";
        case PortType::TRADE: return "TRADE";
        case PortType::MILITARY: return "MILITARY";
        default: return "NONE";
    }
}

inline PortType stringToPortType(const std::string& s) {
    if (s == "FISHING") return PortType::FISHING;
    if (s == "TRADE") return PortType::TRADE;
    if (s == "MILITARY") return PortType::MILITARY;
    return PortType::NONE;
}

struct ShipBuildOrder {
    std::string id;
    ShipType type;
    int days_left;
    std::string owner_id;

    

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("id", id);
        obj.set("type", shipTypeToString(type));
        obj.set("days_left", days_left);
        obj.set("owner_id", owner_id);
        return obj;
    }

    static ShipBuildOrder fromJson(const JsonValue& j) {
        ShipBuildOrder o;
        if (j.has("id")) o.id = j["id"].asString();
        if (j.has("type")) o.type = stringToShipType(j["type"].asString());
        if (j.has("days_left")) o.days_left = j["days_left"].asInt();
        if (j.has("owner_id")) o.owner_id = j["owner_id"].asString();
        return o;
    }
};

struct PortFacility {
    int level = 1;
    int durability = 100;
    PortType type = PortType::NONE;
    std::string dock_container_id;
    std::vector<std::string> docked_ship_ids;
    bool is_blockaded = false;

    bool has_shipyard = false;
    std::vector<ShipBuildOrder> build_queue;

    

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("level", level);
        obj.set("durability", durability);
        obj.set("type", portTypeToString(type));
        obj.set("dock_container_id", dock_container_id);
        JsonValue shipsArr = JsonValue::array();
        for (const auto& sid : docked_ship_ids) shipsArr.push(JsonValue(sid));
        obj.set("docked_ship_ids", shipsArr);
        obj.set("has_shipyard", has_shipyard);

        obj.set("is_blockaded", is_blockaded);
        JsonValue bqArr = JsonValue::array();
        for (const auto& bq : build_queue) bqArr.push(bq.toJson());
        obj.set("build_queue", bqArr);
        return obj;
    }

    static PortFacility fromJson(const JsonValue& j) {
        PortFacility p;
        if (j.has("level")) p.level = j["level"].asInt();
        if (j.has("durability")) p.durability = j["durability"].asInt();
        if (j.has("type")) p.type = stringToPortType(j["type"].asString());
        if (j.has("dock_container_id")) p.dock_container_id = j["dock_container_id"].asString();
        if (j.has("docked_ship_ids")) {
            for (size_t i = 0; i < j["docked_ship_ids"].size(); i++) {
                p.docked_ship_ids.push_back(j["docked_ship_ids"][i].asString());
            }
        }
        if (j.has("has_shipyard")) p.has_shipyard = j["has_shipyard"].asBool();

        if (j.has("is_blockaded")) p.is_blockaded = j["is_blockaded"].asBool();
        if (j.has("build_queue")) {
            for (size_t i = 0; i < j["build_queue"].size(); i++) {
                p.build_queue.push_back(ShipBuildOrder::fromJson(j["build_queue"][i]));
            }
        }
        return p;
    }
};


struct EpicMonster {
    std::string id;
    std::string type = "dragon";
    std::string name;
    std::string state = "ACTIVE"; // DORMANT, RISING, ACTIVE, WEAKENED, DEFEATED
    int level = 1;
    int health = 1000;
    int maxHealth = 1000;
    int attack = 50;
    int defense = 30;
    std::string region_id;
    int lair_x = 0;
    int lair_y = 0;
    int dread_contribution = 20;
    bool is_visible_on_map = true;
    std::string treasure_chest_id;
    int days_active = 0;
    std::vector<std::string> special_abilities;

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("id", id);
        obj.set("type", type);
        obj.set("name", name);
        obj.set("state", state);
        obj.set("level", level);
        obj.set("health", health);
        obj.set("maxHealth", maxHealth);
        obj.set("attack", attack);
        obj.set("defense", defense);
        obj.set("region_id", region_id);
        obj.set("lair_x", lair_x);
        obj.set("lair_y", lair_y);
        obj.set("dread_contribution", dread_contribution);
        obj.set("is_visible_on_map", is_visible_on_map);
        obj.set("treasure_chest_id", treasure_chest_id);
        obj.set("days_active", days_active);
        JsonValue abils = JsonValue::array();
        for (const auto& a : special_abilities) abils.push(JsonValue(a));
        obj.set("special_abilities", abils);
        return obj;
    }

    static EpicMonster fromJson(const JsonValue& j) {
        EpicMonster m;
        if (j.has("id")) m.id = j["id"].asString();
        if (j.has("type")) {
            std::string t = j["type"].asString();
            std::transform(t.begin(), t.end(), t.begin(), [](unsigned char c){ return std::tolower(c); });
            m.type = t;
        }
        if (j.has("name")) m.name = j["name"].asString();
        if (j.has("state")) m.state = j["state"].asString();
        if (j.has("level")) m.level = j["level"].asInt();
        if (j.has("health")) m.health = j["health"].asInt();
        if (j.has("maxHealth")) m.maxHealth = j["maxHealth"].asInt();
        if (j.has("attack")) m.attack = j["attack"].asInt();
        if (j.has("defense")) m.defense = j["defense"].asInt();
        if (j.has("region_id")) m.region_id = j["region_id"].asString();
        if (j.has("lair_x")) m.lair_x = j["lair_x"].asInt();
        if (j.has("lair_y")) m.lair_y = j["lair_y"].asInt();
        if (j.has("dread_contribution")) m.dread_contribution = j["dread_contribution"].asInt();
        if (j.has("is_visible_on_map")) m.is_visible_on_map = j["is_visible_on_map"].asBool();
        if (j.has("treasure_chest_id")) m.treasure_chest_id = j["treasure_chest_id"].asString();
        if (j.has("days_active")) m.days_active = j["days_active"].asInt();
        if (j.has("special_abilities")) {
            for (size_t i = 0; i < j["special_abilities"].size(); i++) {
                m.special_abilities.push_back(j["special_abilities"][i].asString());
            }
        }
        return m;
    }
};


struct Region {
    std::string id;
    std::string name;
    std::string factionId;
    int population = 0;
    std::vector<double> age_pyramid; // 121 elements (0..120 years)
    int labor_force = 0;
    double unemployment_rate = 0.0;
    int average_wage = 60;
    bool no_road = false;

    double moneySupply = 0;
    std::string vault_id; // Container ID for faction storage
    
    int threat_level = 0;
    int dread = 0;                 // 0-100 Ужас региона (для призыва эпических монстров)          // 0-100 (0 - идеальная безопасность)
    int storage_capacity = 10000;  // максимальная вместимость склада (ед. веса)
    std::string bandit_stash_id;   // ID контейнера с награбленным

    
    // Markets (good -> price)
    std::unordered_map<std::string, double> markets;
    std::vector<MarketOffer> market_square; // T3: Physical market offers
    std::string current_season = "spring"; // T3: Seasonality
    
    // Caravans departing from this region
    std::vector<Caravan> caravans;
    
    // Weather & Climate
    double fertility = 1.0;
    double mineral_wealth = 1.0;
    std::string weather = "Ясно";
    int weatherDaysLeft = 0;
    std::string climate = "temperate";
    std::string placement_type;
    std::string base_type; // Explicit location type (city, fort, anomaly, etc.)
    
    // Production facilities
    std::map<std::string, Facility> facilities;
    
    // Animals
    Animals animals;

    // Available raw resources based on geography/climate
    std::set<std::string> available_raw_resources;

    // City Layout (CityGen)
    std::vector<CityBlock> cityLayout;
    std::unordered_map<std::string, PriceHistory> priceHistory;
    int starvation_days = 0;

    double attractivenessIndex = 0.0;
    int migrationCooldown = 0;

    std::vector<PlannedHarvest> planned_harvests;
    std::unordered_map<std::string, int> reserveTargets;

    std::unordered_map<std::string, double> prodModifiers;
    JsonValue custom_props = JsonValue::object();
    int layoutWidth = 0;
    int layoutHeight = 0;
    
    // T3: War & Stability mechanics
    int stability = 70;
    int unrest = 0;
    bool isOccupied = false;
    std::string occupierFactionId;
    int daysUnderOccupation = 0;
    int productionBlockedDays = 0;
    
    

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("id", id);
        obj.set("name", name);
        obj.set("factionId", factionId);
        obj.set("population", population);
        obj.set("fertility", fertility);
        obj.set("mineral_wealth", mineral_wealth);
        JsonValue pyr = JsonValue::array();
        for (double val : age_pyramid) pyr.push(JsonValue(val));
        obj.set("age_pyramid", pyr);
        obj.set("labor_force", labor_force);
        obj.set("unemployment_rate", unemployment_rate);
        obj.set("average_wage", average_wage);
        obj.set("no_road", no_road);
        obj.set("moneySupply", moneySupply);
        obj.set("vault_id", vault_id);
        obj.set("threat_level", threat_level);
        obj.set("dread", dread);
        obj.set("storage_capacity", storage_capacity);
        obj.set("bandit_stash_id", bandit_stash_id);
        obj.set("weather", weather);
        obj.set("weatherDaysLeft", weatherDaysLeft);
        obj.set("placement_type", placement_type);
        obj.set("base_type", base_type);
        
        JsonValue m = JsonValue::object();
        for (const auto& [k, v] : markets) m.set(k, v);
        obj.set("markets", m);
        
        JsonValue msq = JsonValue::array();
        for (const auto& offer : market_square) msq.push(offer.toJson());
        obj.set("market_square", msq);
        
        obj.set("current_season", current_season);
        
        JsonValue cars = JsonValue::array();
        for (const auto& c : caravans) cars.push(c.toJson());
        obj.set("caravans", cars);
        
        obj.set("climate", climate);
        
        JsonValue facs = JsonValue::object();
        for (const auto& [k, v] : facilities) facs.set(k, v.toJson());
        obj.set("facilities", facs);
        
        obj.set("animals", animals.toJson());
        
        obj.set("layoutWidth", layoutWidth);
        obj.set("layoutHeight", layoutHeight);
        
        JsonValue resArr = JsonValue::array();
        for (const auto& g : available_raw_resources) {
            resArr.push(JsonValue(g));
        }
        obj.set("available_raw_resources", resArr);
        JsonValue layoutArr = JsonValue::array();
        for (const auto& block : cityLayout) layoutArr.push(block.toJson());
        obj.set("cityLayout", layoutArr);
        JsonValue phObj = JsonValue::object();
        for (const auto& [k, v] : priceHistory) phObj.set(k, v.toJson());
        obj.set("priceHistory", phObj);
        obj.set("starvation_days", starvation_days);

        obj.set("attractivenessIndex", attractivenessIndex);
        obj.set("migrationCooldown", migrationCooldown);

        JsonValue phArr = JsonValue::array();
        for (const auto& ph : planned_harvests) phArr.push(ph.toJson());
        obj.set("planned_harvests", phArr);

        JsonValue rtObj = JsonValue::object();
        for (const auto& [k, v] : reserveTargets) rtObj.set(k, v);
        obj.set("reserveTargets", rtObj);


        JsonValue pmObj = JsonValue::object();
        for (const auto& [k, v] : prodModifiers) pmObj.set(k, v);
        obj.set("prodModifiers", pmObj);
        obj.set("custom_props", custom_props);
        
        // T3
        obj.set("stability", stability);
        obj.set("unrest", unrest);
        obj.set("isOccupied", isOccupied);
        obj.set("occupierFactionId", occupierFactionId);
        obj.set("daysUnderOccupation", daysUnderOccupation);
        obj.set("productionBlockedDays", productionBlockedDays);

        

        return obj;
    }
    
    static Region fromJson(const JsonValue& j) {
        Region r;
        r.id = j["id"].asString();
        r.name = j["name"].asString();
        r.factionId = j["factionId"].asString();
        r.population = j["population"].asInt();
        if (j.has("fertility")) r.fertility = j["fertility"].asDouble();
        if (j.has("mineral_wealth")) r.mineral_wealth = j["mineral_wealth"].asDouble();
        if (j.has("age_pyramid")) {
            for (size_t i = 0; i < j["age_pyramid"].size(); i++) r.age_pyramid.push_back(j["age_pyramid"][i].asDouble());
        }
        if (j.has("labor_force")) r.labor_force = j["labor_force"].asInt();
        if (j.has("unemployment_rate")) r.unemployment_rate = j["unemployment_rate"].asDouble();
        if (j.has("average_wage")) r.average_wage = j["average_wage"].asInt();
        else r.average_wage = 60;
        if (j.has("no_road")) r.no_road = j["no_road"].asBool();
        r.moneySupply = j["moneySupply"].asDouble();
        r.vault_id = j["vault_id"].asString();
        if (j.has("threat_level")) r.threat_level = j["threat_level"].asInt();
        if (j.has("dread")) r.dread = j["dread"].asInt();
        if (j.has("storage_capacity")) r.storage_capacity = j["storage_capacity"].asInt();
        if (j.has("bandit_stash_id")) r.bandit_stash_id = j["bandit_stash_id"].asString();
        r.weather = j["weather"].asString();
        r.weatherDaysLeft = j["weatherDaysLeft"].asInt();
        if (j.has("placement_type")) r.placement_type = j["placement_type"].asString();
        if (j.has("base_type")) r.base_type = j["base_type"].asString();
        
        if (j.has("markets")) {
            for (const auto& kv : j["markets"].obj_val) {
                r.markets[kv.first] = kv.second.asDouble();
            }
        }
        
        if (j.has("market_square")) {
            for (size_t i = 0; i < j["market_square"].size(); i++) {
                r.market_square.push_back(MarketOffer::fromJson(j["market_square"][i]));
            }
        }
        
        if (j.has("current_season")) r.current_season = j["current_season"].asString();
        
        if (j.has("caravans")) {
            for (size_t i = 0; i < j["caravans"].size(); i++) {
                r.caravans.push_back(Caravan::fromJson(j["caravans"][i]));
            }
        }
        
        if (j.has("climate")) r.climate = j["climate"].asString();
        
        if (j.has("facilities")) {
            for (const auto& kv : j["facilities"].obj_val) {
                r.facilities[kv.first] = Facility::fromJson(kv.second);
            }
        }
        
        if (j.has("animals")) {
            r.animals = Animals::fromJson(j["animals"]);
        }
        
        if (j.has("layoutWidth")) r.layoutWidth = j["layoutWidth"].asInt();
        if (j.has("layoutHeight")) r.layoutHeight = j["layoutHeight"].asInt();
        if (j.has("cityLayout")) {
            for (size_t i = 0; i < j["cityLayout"].size(); i++) {
                r.cityLayout.push_back(CityBlock::fromJson(j["cityLayout"][i]));
            }
        }
        
                if (j.has("priceHistory")) {
            for (const auto& kv : j["priceHistory"].obj_val) {
                r.priceHistory[kv.first] = PriceHistory::fromJson(kv.second);
            }
        }
        if (j.has("starvation_days")) r.starvation_days = j["starvation_days"].asInt();

        if (j.has("attractivenessIndex")) r.attractivenessIndex = j["attractivenessIndex"].asDouble();
        if (j.has("migrationCooldown")) r.migrationCooldown = j["migrationCooldown"].asInt();

        if (j.has("planned_harvests")) {
            for (size_t i = 0; i < j["planned_harvests"].size(); i++) {
                r.planned_harvests.push_back(PlannedHarvest::fromJson(j["planned_harvests"][i]));
            }
        }
        if (j.has("reserveTargets")) {
            for (const auto& kv : j["reserveTargets"].obj_val) {
                r.reserveTargets[kv.first] = kv.second.asInt();
            }
        }

        if (j.has("prodModifiers")) {
            for (const auto& kv : j["prodModifiers"].obj_val) {
                r.prodModifiers[kv.first] = kv.second.asDouble();
            }
        }
        if (j.has("custom_props")) r.custom_props = j["custom_props"];

        if (j.has("available_raw_resources")) {
            for (size_t i = 0; i < j["available_raw_resources"].size(); i++) {
                r.available_raw_resources.insert(j["available_raw_resources"][i].asString());
            }
        }
        
                // T3
        if (j.has("stability")) r.stability = j["stability"].asInt();
        if (j.has("unrest")) r.unrest = j["unrest"].asInt();
        if (j.has("isOccupied")) r.isOccupied = j["isOccupied"].asBool();
        if (j.has("occupierFactionId")) r.occupierFactionId = j["occupierFactionId"].asString();
        if (j.has("daysUnderOccupation")) r.daysUnderOccupation = j["daysUnderOccupation"].asInt();
        if (j.has("productionBlockedDays")) r.productionBlockedDays = j["productionBlockedDays"].asInt();

        
// Backward compatibility for old saves
        if (r.available_raw_resources.empty()) {
            Region legacyRegion = r;
            if (legacyRegion.placement_type.empty()) {
                legacyRegion.placement_type = inferLegacyPlacementTypeFromRegionName(r.name);
            }
            r.available_raw_resources = inferRegionRawResourcesLegacy(legacyRegion);
        }
        

        return r;
    }
};

struct Army {
    std::string id;
    int size = 0;
    int morale = 100;
    std::string location;
    std::string destination;
    int daysToMove = 0;
    int siegeDays = -1;
    double x = 0.0;
    double y = 0.0;
    std::vector<std::pair<int, int>> path;
    int path_index = 0;
    std::string supply_chest_id;
    std::string general_id;
    std::string current_phase = "march"; // march, vanguard_clash, main_battle, rout, victory

    std::string embarked_ship_id;
    std::string target_monster_id;
    
    

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("id", id);
        obj.set("size", size);
        obj.set("morale", morale);
        obj.set("location", location);
        obj.set("destination", destination);
        obj.set("daysToMove", daysToMove);
        obj.set("siegeDays", siegeDays);
        obj.set("x", x);
        obj.set("y", y);
        obj.set("path_index", path_index);
        JsonValue pArr = JsonValue::array();
        for (const auto& pt : path) {
            JsonValue ptArr = JsonValue::array();
            ptArr.push(pt.first); ptArr.push(pt.second);
            pArr.push(ptArr);
        }
        obj.set("path", pArr);
        obj.set("supply_chest_id", supply_chest_id);
        obj.set("general_id", general_id);
        obj.set("current_phase", current_phase);

        obj.set("embarked_ship_id", embarked_ship_id);
        obj.set("target_monster_id", target_monster_id);
        return obj;
    }
    static Army fromJson(const JsonValue& j) {
        Army a;
        if(j.has("id")) a.id = j["id"].asString();
        if(j.has("size")) a.size = j["size"].asInt();
        if(j.has("morale")) a.morale = j["morale"].asInt();
        if(j.has("location")) a.location = j["location"].asString();
        if(j.has("destination")) a.destination = j["destination"].asString();
        if(j.has("daysToMove")) a.daysToMove = j["daysToMove"].asInt();
        if(j.has("siegeDays")) a.siegeDays = j["siegeDays"].asInt();
        if(j.has("x")) a.x = j["x"].asDouble();
        if(j.has("y")) a.y = j["y"].asDouble();
        if(j.has("path_index")) a.path_index = j["path_index"].asInt();
        if (j.has("path")) {
            for (size_t i = 0; i < j["path"].size(); i++) {
                if (j["path"][i].size() >= 2) {
                    a.path.push_back({j["path"][i][0].asInt(), j["path"][i][1].asInt()});
                }
            }
        }
        if(j.has("supply_chest_id")) a.supply_chest_id = j["supply_chest_id"].asString();
        if(j.has("general_id")) a.general_id = j["general_id"].asString();
        if(j.has("current_phase")) a.current_phase = j["current_phase"].asString();

        if(j.has("embarked_ship_id")) a.embarked_ship_id = j["embarked_ship_id"].asString();
        if(j.has("target_monster_id")) a.target_monster_id = j["target_monster_id"].asString();
        return a;
    }
};

struct Faction {
    std::string id;
    std::string name;
    std::vector<std::string> regions;
    std::unordered_map<std::string, int> relations;
    std::unordered_map<std::string, std::string> diplomacy;
    std::vector<Army> armies;
    std::string rulerId;

    int warExhaustion = 0;
    
    // T3: Advanced Diplomacy & War
    DiplomaticState warType = DiplomaticState::PEACE;
    int stability = 70;
    int legitimacy = 100;
    WarGoal activeWarGoal;
    std::vector<Ultimatum> ultimatums;
    std::vector<Coalition> coalitions;
    int daysInCurrentWar = 0;
    CasusBelli currentCasusBelli = CasusBelli::NONE;
    std::unordered_map<std::string, int> truceUntil;
    
    

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("id", id);
        obj.set("name", name);
        
        JsonValue regs = JsonValue::array();
        for (const auto& r : regions) regs.push(JsonValue(r));
        obj.set("regions", regs);
        
        JsonValue rel = JsonValue::object();
        for (const auto& [k, v] : relations) rel.set(k, v);
        obj.set("relations", rel);
        
        JsonValue dip = JsonValue::object();
        for (const auto& [k, v] : diplomacy) dip.set(k, v);
        obj.set("diplomacy", dip);
        
        JsonValue arms = JsonValue::array();
        for (const auto& a : armies) arms.push(a.toJson());
        obj.set("armies", arms);
        
        obj.set("rulerId", rulerId);

        obj.set("warExhaustion", warExhaustion);
        
        // T3
        obj.set("warType", diploStateToString(warType));
        obj.set("stability", stability);
        obj.set("legitimacy", legitimacy);
        obj.set("activeWarGoal", activeWarGoal.toJson());
        
        JsonValue ults = JsonValue::array();
        for (const auto& u : ultimatums) ults.push(u.toJson());
        obj.set("ultimatums", ults);
        
        JsonValue coals = JsonValue::array();
        for (const auto& c : coalitions) coals.push(c.toJson());
        obj.set("coalitions", coals);
        
        obj.set("daysInCurrentWar", daysInCurrentWar);
        obj.set("currentCasusBelli", cbToString(currentCasusBelli));
        
        JsonValue truces = JsonValue::object();
        for (const auto& [k, v] : truceUntil) truces.set(k, v);
        obj.set("truceUntil", truces);

        return obj;
    }
    
    static Faction fromJson(const JsonValue& j) {
        Faction f;
        f.id = j["id"].asString();
        f.name = j["name"].asString();
        
        if (j.has("regions")) {
            for (size_t i = 0; i < j["regions"].size(); i++) {
                f.regions.push_back(j["regions"][i].asString());
            }
        }
        
        if (j.has("relations")) {
            for (const auto& kv : j["relations"].obj_val) {
                f.relations[kv.first] = kv.second.asInt();
            }
        }
        
        if (j.has("diplomacy")) {
            for (const auto& kv : j["diplomacy"].obj_val) {
                f.diplomacy[kv.first] = kv.second.asString();
            }
        }
        
        if (j.has("armies")) {
            for (size_t i = 0; i < j["armies"].size(); i++) {
                f.armies.push_back(Army::fromJson(j["armies"][i]));
            }
        }
        
        if (j.has("rulerId")) f.rulerId = j["rulerId"].asString();

        if (j.has("warExhaustion")) f.warExhaustion = j["warExhaustion"].asInt();
        
        // T3
        if (j.has("warType")) f.warType = stringToDiploState(j["warType"].asString());
        if (j.has("stability")) f.stability = j["stability"].asInt();
        if (j.has("legitimacy")) f.legitimacy = j["legitimacy"].asInt();
        if (j.has("activeWarGoal")) f.activeWarGoal = WarGoal::fromJson(j["activeWarGoal"]);
        
        if (j.has("ultimatums")) {
            for (size_t i = 0; i < j["ultimatums"].size(); i++) {
                f.ultimatums.push_back(Ultimatum::fromJson(j["ultimatums"][i]));
            }
        }
        if (j.has("coalitions")) {
            for (size_t i = 0; i < j["coalitions"].size(); i++) {
                f.coalitions.push_back(Coalition::fromJson(j["coalitions"][i]));
            }
        }
        if (j.has("daysInCurrentWar")) f.daysInCurrentWar = j["daysInCurrentWar"].asInt();
        if (j.has("currentCasusBelli")) f.currentCasusBelli = stringToCb(j["currentCasusBelli"].asString());
        
        if (j.has("truceUntil")) {
            for (const auto& kv : j["truceUntil"].obj_val) {
                f.truceUntil[kv.first] = kv.second.asInt();
            }
        }

        return f;
    }
};

struct Intrigue {
    std::string id;
    std::string type;
    std::string initiatorFactionId;
    std::string targetFactionId;
    std::string targetRulerId;
    int progress = 0;
    int requiredProgress = 60;
    int progressPerDay = 5;
    int discoveryChance = 3;
    bool isDiscovered = false;
    int startDay = 0;
    std::string phase = "recruitment"; // recruitment, espionage, execution, cover_up
    std::string agent_id; // NPC executing the plot

    

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("id", id);
        obj.set("type", type);
        obj.set("initiatorFactionId", initiatorFactionId);
        obj.set("targetFactionId", targetFactionId);
        obj.set("targetRulerId", targetRulerId);
        obj.set("progress", progress);
        obj.set("requiredProgress", requiredProgress);
        obj.set("progressPerDay", progressPerDay);
        obj.set("discoveryChance", discoveryChance);
        obj.set("isDiscovered", isDiscovered);
        obj.set("startDay", startDay);
        obj.set("phase", phase);
        obj.set("agent_id", agent_id);
        return obj;
    }

    static Intrigue fromJson(const JsonValue& j) {
        Intrigue i;
        if(j.has("id")) i.id = j["id"].asString();
        if(j.has("type")) i.type = j["type"].asString();
        if(j.has("initiatorFactionId")) i.initiatorFactionId = j["initiatorFactionId"].asString();
        if(j.has("targetFactionId")) i.targetFactionId = j["targetFactionId"].asString();
        if(j.has("targetRulerId")) i.targetRulerId = j["targetRulerId"].asString();
        if(j.has("progress")) i.progress = j["progress"].asInt();
        if(j.has("requiredProgress")) i.requiredProgress = j["requiredProgress"].asInt();
        if(j.has("progressPerDay")) i.progressPerDay = j["progressPerDay"].asInt();
        if(j.has("discoveryChance")) i.discoveryChance = j["discoveryChance"].asInt();
        if(j.has("isDiscovered")) i.isDiscovered = j["isDiscovered"].asBool();
        if(j.has("startDay")) i.startDay = j["startDay"].asInt();
        if(j.has("phase")) i.phase = j["phase"].asString();
        if(j.has("agent_id")) i.agent_id = j["agent_id"].asString();
        return i;
    }
};

struct TrekEvent {
    std::string id;
    std::string description;
    std::string object_type;
    std::string sim_object_id;
    bool can_interact = true;

    

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("id", id);
        obj.set("description", description);
        obj.set("object_type", object_type);
        obj.set("sim_object_id", sim_object_id);
        obj.set("can_interact", can_interact);
        return obj;
    }
};

struct TrekState {
    bool active = false;
    bool paused = false;
    std::string destination_id;
    int total_hours = 0;
    int elapsed_hours = 0;
    int hours_since_last_bandit = 4;
    double current_x = 0.0;
    double current_y = 0.0;
    std::vector<std::pair<int,int>> path;
    int path_index = 0;
    std::set<std::string> seen_object_ids;
    std::vector<TrekEvent> pending_events;

    // Transport system
    std::string active_transport_id;
    std::string transport_type = "none";
    double transport_speed_mult = 1.0;
    int transport_cargo_bonus = 0;
    bool transport_water_only = false;



    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("active", active);
        obj.set("paused", paused);
        obj.set("destination_id", destination_id);
        obj.set("total_hours", total_hours);
        obj.set("elapsed_hours", elapsed_hours);
        obj.set("hours_since_last_bandit", hours_since_last_bandit);
        obj.set("current_x", current_x);
        obj.set("current_y", current_y);
        obj.set("path_index", path_index);
        JsonValue pArr = JsonValue::array();
        for (const auto& pt : path) {
            JsonValue ptArr = JsonValue::array();
            ptArr.push(pt.first); ptArr.push(pt.second);
            pArr.push(ptArr);
        }
        obj.set("path", pArr);
        JsonValue seen = JsonValue::array();
        for (const auto& id : seen_object_ids) seen.push(JsonValue(id));
        obj.set("seen_object_ids", seen);

        // Transport fields
        obj.set("active_transport_id", active_transport_id);
        obj.set("transport_type", transport_type);
        obj.set("transport_speed_mult", transport_speed_mult);
        obj.set("transport_cargo_bonus", transport_cargo_bonus);
        obj.set("transport_water_only", transport_water_only);

        return obj;
    }

    static TrekState fromJson(const JsonValue& j) {
        TrekState t;
        if (j.has("active")) t.active = j["active"].asBool();
        if (j.has("paused")) t.paused = j["paused"].asBool();
        if (j.has("destination_id")) t.destination_id = j["destination_id"].asString();
        if (j.has("total_hours")) t.total_hours = j["total_hours"].asInt();
        if (j.has("elapsed_hours")) t.elapsed_hours = j["elapsed_hours"].asInt();
        if (j.has("hours_since_last_bandit")) t.hours_since_last_bandit = j["hours_since_last_bandit"].asInt();
        if (j.has("current_x")) t.current_x = j["current_x"].asDouble();
        if (j.has("current_y")) t.current_y = j["current_y"].asDouble();
        if (j.has("path_index")) t.path_index = j["path_index"].asInt();
        if (j.has("path")) {
            for (size_t i = 0; i < j["path"].size(); i++) {
                if (j["path"][i].size() >= 2) {
                    t.path.push_back({j["path"][i][0].asInt(), j["path"][i][1].asInt()});
                }
            }
        }
        if (j.has("seen_object_ids")) {
            for (size_t i = 0; i < j["seen_object_ids"].size(); i++) {
                t.seen_object_ids.insert(j["seen_object_ids"][i].asString());
            }
        }

        // Transport fields
        if (j.has("active_transport_id")) t.active_transport_id = j["active_transport_id"].asString();
        if (j.has("transport_type")) t.transport_type = j["transport_type"].asString();
        if (j.has("transport_speed_mult")) t.transport_speed_mult = j["transport_speed_mult"].asDouble();
        if (j.has("transport_cargo_bonus")) t.transport_cargo_bonus = j["transport_cargo_bonus"].asInt();
        if (j.has("transport_water_only")) t.transport_water_only = j["transport_water_only"].asBool();

        return t;
    }
};

struct MapTile {
    uint8_t biome_id = 0;
    uint8_t road_level = 0;   // 0-none, 1-dirt, 2-paved, 3-highway
    uint8_t bridge_flag = 0;  // 1-bridge
    uint8_t water_depth = 0;  // 0-5
    bool is_flooded = false;
    uint8_t road_condition = 0; // 0-normal, 1-ruined

    

    JsonValue toJson() const {
        JsonValue arr = JsonValue::array();
        arr.push(JsonValue((int)biome_id));
        arr.push(JsonValue((int)road_level));
        arr.push(JsonValue((int)bridge_flag));
        arr.push(JsonValue((int)water_depth));
        arr.push(JsonValue(is_flooded));
        arr.push(JsonValue((int)road_condition));
        return arr;
    }

    static MapTile fromJson(const JsonValue& j) {
        MapTile t;
        if (j.type == JsonValue::ARRAY && j.size() >= 5) {
            t.biome_id = j[0].asInt();
            t.road_level = j[1].asInt();
            t.bridge_flag = j[2].asInt();
            t.water_depth = j[3].asInt();
            t.is_flooded = j[4].asBool();
            if (j.size() >= 6) t.road_condition = j[5].asInt();
        }
        return t;
    }
};

struct Disaster {
    std::string id;
    std::string type;
    int epicenter_x = 0;
    int epicenter_y = 0;
    int radius = 0;
    int strength = 0;
    int days_active = 0;
    std::vector<std::pair<int,int>> affected_tiles;
    std::vector<std::string> affected_regions;

    

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("id", id);
        obj.set("type", type);
        obj.set("epicenter_x", epicenter_x);
        obj.set("epicenter_y", epicenter_y);
        obj.set("radius", radius);
        obj.set("strength", strength);
        obj.set("days_active", days_active);
        JsonValue tiles = JsonValue::array();
        for (const auto& pt : affected_tiles) {
            JsonValue ptArr = JsonValue::array();
            ptArr.push(JsonValue(pt.first)); ptArr.push(JsonValue(pt.second));
            tiles.push(ptArr);
        }
        obj.set("affected_tiles", tiles);
        JsonValue regs = JsonValue::array();
        for (const auto& r : affected_regions) regs.push(JsonValue(r));
        obj.set("affected_regions", regs);
        return obj;
    }

    static Disaster fromJson(const JsonValue& j) {
        Disaster d;
        if (j.has("id")) d.id = j["id"].asString();
        if (j.has("type")) d.type = j["type"].asString();
        if (j.has("epicenter_x")) d.epicenter_x = j["epicenter_x"].asInt();
        if (j.has("epicenter_y")) d.epicenter_y = j["epicenter_y"].asInt();
        if (j.has("radius")) d.radius = j["radius"].asInt();
        if (j.has("strength")) d.strength = j["strength"].asInt();
        if (j.has("days_active")) d.days_active = j["days_active"].asInt();
        if (j.has("affected_tiles")) {
            for (size_t i = 0; i < j["affected_tiles"].size(); i++) {
                if (j["affected_tiles"][i].size() >= 2) {
                    d.affected_tiles.push_back({j["affected_tiles"][i][0].asInt(), j["affected_tiles"][i][1].asInt()});
                }
            }
        }
        if (j.has("affected_regions")) {
            for (size_t i = 0; i < j["affected_regions"].size(); i++) d.affected_regions.push_back(j["affected_regions"][i].asString());
        }
        return d;
    }
};

struct MapLocation {
    std::string id;
    std::string name;
    int x = 0;
    int y = 0;
    std::string type;
    std::string faction;
    bool no_road = false;

    

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("id", id);
        obj.set("name", name);
        obj.set("x", x);
        obj.set("y", y);
        obj.set("type", type);
        obj.set("faction", faction);
        obj.set("no_road", no_road);
        return obj;
    }

    static MapLocation fromJson(const JsonValue& j) {
        MapLocation loc;
        if (j.has("id")) loc.id = j["id"].asString();
        if (j.has("name")) loc.name = j["name"].asString();
        if (j.has("x")) loc.x = j["x"].asInt();
        if (j.has("y")) loc.y = j["y"].asInt();
        if (j.has("type")) loc.type = j["type"].asString();
        if (j.has("faction")) loc.faction = j["faction"].asString();
        if (j.has("no_road")) loc.no_road = j["no_road"].asBool();
        return loc;
    }
};

struct MapRoad {
    std::string from;
    std::string to;
    std::string condition;
    std::string type = "dirt"; // dirt, paved, bridge, tunnel, ferry, highway
    int integrity = 100;
    std::vector<std::pair<int, int>> waypoints;

    

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("from", from);
        obj.set("to", to);
        obj.set("condition", condition);
        obj.set("type", type);
        obj.set("integrity", integrity);
        JsonValue wp = JsonValue::array();
        for (const auto& p : waypoints) {
            JsonValue pt = JsonValue::array();
            pt.push(JsonValue(p.first));
            pt.push(JsonValue(p.second));
            wp.push(pt);
        }
        obj.set("waypoints", wp);
        return obj;
    }

    static MapRoad fromJson(const JsonValue& j) {
        MapRoad r;
        if (j.has("from")) r.from = j["from"].asString();
        if (j.has("to")) r.to = j["to"].asString();
        if (j.has("condition")) r.condition = j["condition"].asString();
        if (j.has("type")) r.type = j["type"].asString();
        if (j.has("integrity")) r.integrity = j["integrity"].asInt();
        if (j.has("waypoints")) {
            for (size_t i = 0; i < j["waypoints"].size(); i++) {
                if (j["waypoints"][i].size() >= 2) {
                    r.waypoints.push_back({j["waypoints"][i][0].asInt(), j["waypoints"][i][1].asInt()});
                }
            }
        }
        return r;
    }
};

struct WorldMap {
    int width = 256;
    int height = 256;
    std::vector<MapTile> grid;
    std::map<std::string, MapLocation> locations;
    std::vector<MapRoad> roads;
    std::vector<Disaster> disasters;
    int generation_tick = 0;

    

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("width", width);
        obj.set("height", height);
        obj.set("generation_tick", generation_tick);
        obj.set("version", 2);
        
        // FIX: Serialize grid directly to nlohmann::json for massive speedup.
        // Previously, each MapTile.toJson() created 6 JsonValue objects, then
        // gridArr.push() rebuilt them into nlohmann::json. For 65536 tiles,
        // this meant ~400K JsonValue allocations and 65536 nlohmann rebuilds.
        // Now we build the nlohmann::json array directly — one allocation.
        nlohmann::json gridJson = nlohmann::json::array();
        gridJson.get_ref<nlohmann::json::array_t&>().reserve(grid.size());
        for (const auto& t : grid) {
            gridJson.push_back({(int)t.biome_id, (int)t.road_level, (int)t.bridge_flag,
                               (int)t.water_depth, t.is_flooded, (int)t.road_condition});
        }
        obj.set("grid", JsonValue(gridJson));
        
        JsonValue locs = JsonValue::object();
        for (const auto& [id, loc] : locations) {
            locs.set(id, loc.toJson());
        }
        obj.set("locations", locs);
        
        JsonValue rds = JsonValue::array();
        rds.arr_val.reserve(roads.size());
        for (const auto& r : roads) {
            rds.push(r.toJson());
        }
        obj.set("roads", rds);

        JsonValue disArr = JsonValue::array();
        for (const auto& d : disasters) disArr.push(d.toJson());
        obj.set("disasters", disArr);
        
        return obj;
    }

    static WorldMap fromJson(const JsonValue& j) {
        WorldMap m;
        if (j.has("width")) m.width = j["width"].asInt();
        if (j.has("height")) m.height = j["height"].asInt();
        if (j.has("generation_tick")) m.generation_tick = j["generation_tick"].asInt();
        int version = j.has("version") ? j["version"].asInt() : 1;
        
        // Data-driven: legacy numeric biome ID list loaded from biomes.json "legacy_numeric_ids"
        // Fallback inline list kept for saves created before data/biomes.json had this field
        const std::vector<std::string>* legacy_map_ptr = nullptr;
        std::vector<std::string> legacy_map_fallback = {
            "ocean", "shallow_water", "plains", "forest", "mountains", "hills", "desert", "swamp",
            "tundra", "ruins", "anomaly", "river", "volcano", "riverbank", "lake", "floodplain", "lava", "ash"
        };
        if (!g_db.biome_legacy_numeric_ids.empty()) {
            legacy_map_ptr = &g_db.biome_legacy_numeric_ids;
        } else {
            legacy_map_ptr = &legacy_map_fallback;
        }
        const std::vector<std::string>& legacy_map = *legacy_map_ptr;

        if (j.has("grid")) {
            for (size_t i = 0; i < j["grid"].size(); i++) {
                MapTile t = MapTile::fromJson(j["grid"][i]);
                if (version < 2 && t.biome_id < legacy_map.size()) {
                    std::string b_str = legacy_map[t.biome_id];
                    t.biome_id = g_db.biome_string_to_id.count(b_str) ? g_db.biome_string_to_id[b_str] : 0;
                }
                m.grid.push_back(t);
            }
        } else if (j.has("tiles")) { // Legacy support
            for (size_t i = 0; i < j["tiles"].size(); i++) {
                MapTile t;
                int old_id = j["tiles"][i].asInt();
                if (old_id >= 0 && old_id < legacy_map.size()) {
                    std::string b_str = legacy_map[old_id];
                    t.biome_id = g_db.biome_string_to_id.count(b_str) ? g_db.biome_string_to_id[b_str] : 0;
                } else {
                    t.biome_id = 0;
                }
                m.grid.push_back(t);
            }
            if (j.has("road_grid")) {
                for (size_t i = 0; i < j["road_grid"].size() && i < m.grid.size(); i++) {
                    m.grid[i].road_level = j["road_grid"][i].asInt();
                }
            }
        }
        if (j.has("disasters")) {
            for (size_t i = 0; i < j["disasters"].size(); i++) {
                m.disasters.push_back(Disaster::fromJson(j["disasters"][i]));
            }
        }
        
        if (j.has("locations")) {
            for (const auto& kv : j["locations"].obj_val) {
                m.locations[kv.first] = MapLocation::fromJson(kv.second);
            }
        }
        
        if (j.has("roads")) {
            for (size_t i = 0; i < j["roads"].size(); i++) {
                m.roads.push_back(MapRoad::fromJson(j["roads"][i]));
            }
        }
        return m;
    }
};


struct KnowledgeGraph {
    std::unordered_map<std::string, std::vector<std::string>> entity_to_events;
    std::unordered_map<std::string, std::vector<std::string>> location_to_events;

    void addEvent(const std::string& news_id, const std::string& location, const std::vector<std::string>& entities) {
        if (!location.empty() && location != "global") {
            location_to_events[location].push_back(news_id);
        }
        for (const auto& ent : entities) {
            if (!ent.empty()) {
                entity_to_events[ent].push_back(news_id);
            }
        }
    }

    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        JsonValue locs = JsonValue::object();
        for (const auto& [k, v] : location_to_events) {
            JsonValue arr = JsonValue::array();
            for (const auto& id : v) arr.push(JsonValue(id));
            locs.set(k, arr);
        }
        obj.set("location_to_events", locs);
        
        JsonValue ents = JsonValue::object();
        for (const auto& [k, v] : entity_to_events) {
            JsonValue arr = JsonValue::array();
            for (const auto& id : v) arr.push(JsonValue(id));
            ents.set(k, arr);
        }
        obj.set("entity_to_events", ents);
        return obj;
    }

    static KnowledgeGraph fromJson(const JsonValue& j) {
        KnowledgeGraph kg;
        if (j.has("location_to_events")) {
            for (const auto& kv : j["location_to_events"].obj_val) {
                for (size_t i = 0; i < kv.second.size(); i++) {
                    kg.location_to_events[kv.first].push_back(kv.second[i].asString());
                }
            }
        }
        if (j.has("entity_to_events")) {
            for (const auto& kv : j["entity_to_events"].obj_val) {
                for (size_t i = 0; i < kv.second.size(); i++) {
                    kg.entity_to_events[kv.first].push_back(kv.second[i].asString());
                }
            }
        }
        return kg;
    }
};


struct World {
    int tick = 0;
    int current_day = 0;
    std::string era = g_gameplay_runtime.default_era_id;
    
    // Time tracking
    struct Time {
        int accumulatedMinutes = 0;
        int lastEventPulse = 0;
        int internalHour = 0;
    } time;
    
    // Homeostasis
    struct Homeostasis {
        int warWeariness = 0;
        double fertility = 1.0;
        int peaceBoredom = 0;
    } homeostasis;
    
    // Game objects
    std::unordered_map<std::string, Region> regions;
    std::unordered_map<std::string, Faction> factions;
    std::map<std::string, NPC> npcs;
    std::map<std::string, Business> businesses;
    std::vector<News> news;
    KnowledgeGraph ari_graph;
    
    // GM intervention tracking
    std::vector<std::string> gmInterventionHistory;
    int lastDirectInjectionDay = -999;
    bool needsGlobalEvent = false;
    
    // Intrigues in progress
    std::vector<Intrigue> intrigues;
    std::map<std::string, JsonValue> nexusData;
    std::vector<Ship> ships;

    std::vector<Fleet> fleets;
    std::vector<EpicMonster> monsters;
    std::map<std::string, PortFacility> port_facilities;

        std::map<std::string, JsonValue> subLocations; // CityGen sublocations
    WorldMap map; // Global World Map
    TrekState player_trek;
    
    

    JsonValue getGraphContext(const std::vector<std::string>& query_ids, int limit) const {
        std::set<std::string> event_ids;
        for (const auto& q : query_ids) {
            if (ari_graph.location_to_events.count(q)) {
                for (const auto& eid : ari_graph.location_to_events.at(q)) event_ids.insert(eid);
            }
            if (ari_graph.entity_to_events.count(q)) {
                for (const auto& eid : ari_graph.entity_to_events.at(q)) event_ids.insert(eid);
            }
        }
        
        std::vector<News> matched_news;
        for (const auto& nw : news) {
            if (event_ids.count(nw.id)) {
                matched_news.push_back(nw);
            }
        }
        
        std::sort(matched_news.begin(), matched_news.end(), [](const News& a, const News& b) {
            return a.day > b.day;
        });
        
        if (matched_news.size() > static_cast<size_t>(limit)) {
            matched_news.resize(limit);
        }
        
        JsonValue arr = JsonValue::array();
        for (const auto& nw : matched_news) arr.push(nw.toJson());
        return arr;
    }


    JsonValue getRelevantNewsJson(const std::string& player_location, int limit) const {
        std::vector<News> sorted_news = news;
        int px = -1, py = -1;
        if (!player_location.empty() && map.locations.count(player_location)) {
            px = map.locations.at(player_location).x;
            py = map.locations.at(player_location).y;
        }

        for (auto& nw : sorted_news) {
            int days_passed = std::max(0, current_day - nw.day);
            double distance_penalty = 1.0;
            
            if (px != -1 && py != -1 && map.locations.count(nw.location)) {
                int nx = map.locations.at(nw.location).x;
                int ny = map.locations.at(nw.location).y;
                double dist = std::hypot(nx - px, ny - py);
                distance_penalty = std::max(0.1, 1.0 - (dist * 0.05)); 
            } else if (nw.location == "global") {
                distance_penalty = 1.0;
            } else {
                distance_penalty = 0.5;
            }
            
            nw.current_weight = nw.base_weight * std::pow(0.95, days_passed) * distance_penalty;
        }

        std::sort(sorted_news.begin(), sorted_news.end(), [](const News& a, const News& b) {
            return a.current_weight > b.current_weight;
        });

        if (sorted_news.size() > static_cast<size_t>(limit)) {
            sorted_news.resize(limit);
        }

        JsonValue arr = JsonValue::array();
        for (const auto& nw : sorted_news) arr.push(nw.toJson());
        return arr;
    }


    JsonValue toJson() const {
        JsonValue obj = JsonValue::object();
        obj.set("tick", tick);
        obj.set("current_day", current_day);
        obj.set("era", era);
        
        JsonValue t = JsonValue::object();
        t.set("accumulatedMinutes", time.accumulatedMinutes);
        t.set("lastEventPulse", time.lastEventPulse);
        t.set("internalHour", time.internalHour);
        obj.set("time", t);
        
        JsonValue h = JsonValue::object();
        h.set("warWeariness", homeostasis.warWeariness);
        h.set("fertility", homeostasis.fertility);
        h.set("peaceBoredom", homeostasis.peaceBoredom);
        obj.set("homeostasis", h);
        
        JsonValue regs = JsonValue::object();
        for (const auto& [k, v] : regions) regs.set(k, v.toJson());
        obj.set("regions", regs);
        
        JsonValue facts = JsonValue::object();
        for (const auto& [k, v] : factions) facts.set(k, v.toJson());
        obj.set("factions", facts);
        
        JsonValue n = JsonValue::object();
        for (const auto& [k, v] : npcs) n.set(k, v.toJson());
        obj.set("npcs", n);

        JsonValue bus = JsonValue::object();
        for (const auto& [k, v] : businesses) bus.set(k, v.toJson());
        obj.set("businesses", bus);
        
        JsonValue newsArr = JsonValue::array();
        for (const auto& nw : news) newsArr.push(nw.toJson());
        obj.set("news", newsArr);
        obj.set("ari_graph", ari_graph.toJson());
        
        JsonValue intrs = JsonValue::array();
        for (const auto& i : intrigues) intrs.push(i.toJson());
        obj.set("intrigues", intrs);
        
        JsonValue nd = JsonValue::object();
        for (const auto& [k, v] : nexusData) nd.set(k, v);
        obj.set("nexusData", nd);
        JsonValue shipsArr = JsonValue::array();
        for (const auto& s : ships) shipsArr.push(s.toJson());
        obj.set("ships", shipsArr);

        JsonValue fleetsArr = JsonValue::array();
        for (const auto& f : fleets) fleetsArr.push(f.toJson());
        obj.set("fleets", fleetsArr);
        JsonValue monsArr = JsonValue::array();
        for (const auto& m : monsters) monsArr.push(m.toJson());
        obj.set("monsters", monsArr);
        
        JsonValue portsObj = JsonValue::object();
        for (const auto& [k, v] : port_facilities) portsObj.set(k, v.toJson());
        obj.set("port_facilities", portsObj);

                JsonValue sl = JsonValue::object();
        for (const auto& [k, v] : subLocations) sl.set(k, v);
        obj.set("subLocations", sl);
        obj.set("map", map.toJson());
        obj.set("player_trek", player_trek.toJson());
        
        obj.set("needsGlobalEvent", needsGlobalEvent);
        obj.set("lastDirectInjectionDay", lastDirectInjectionDay);
        
        return obj;
    }
    
    static World fromJson(const JsonValue& j) {
        World w;
        w.tick = j["tick"].asInt();
        if (j.has("current_day")) w.current_day = j["current_day"].asInt();
        w.era = j["era"].asString();
        
        if (j.has("time")) {
            w.time.accumulatedMinutes = j["time"]["accumulatedMinutes"].asInt();
            w.time.lastEventPulse = j["time"]["lastEventPulse"].asInt();
            w.time.internalHour = j["time"]["internalHour"].asInt();
        }
        
        if (j.has("homeostasis")) {
            w.homeostasis.warWeariness = j["homeostasis"]["warWeariness"].asInt();
            w.homeostasis.fertility = j["homeostasis"]["fertility"].asDouble();
            if (j["homeostasis"].has("peaceBoredom")) w.homeostasis.peaceBoredom = j["homeostasis"]["peaceBoredom"].asInt();
        }
        
        if (j.has("regions")) {
            for (const auto& kv : j["regions"].obj_val) {
                w.regions[kv.first] = Region::fromJson(kv.second);
            }
        }
        
        if (j.has("factions")) {
            for (const auto& kv : j["factions"].obj_val) {
                w.factions[kv.first] = Faction::fromJson(kv.second);
            }
        }
        
        if (j.has("npcs")) {
            for (const auto& kv : j["npcs"].obj_val) {
                w.npcs[kv.first] = NPC::fromJson(kv.second);
            }
        }

        if (j.has("businesses")) {
            for (const auto& kv : j["businesses"].obj_val) {
                w.businesses[kv.first] = Business::fromJson(kv.second);
            }
        }
        
        if (j.has("news")) {
            for (size_t i = 0; i < j["news"].size(); i++) {
                News nw;
                nw.text = j["news"][i]["text"].asString();
                nw.location = j["news"][i]["location"].asString();
                nw.importance = j["news"][i]["importance"].asInt();
                nw.category = j["news"][i]["category"].asString();
                nw.day = j["news"][i]["day"].asInt();
                if (j["news"][i].has("id")) nw.id = j["news"][i]["id"].asString();
                if (j["news"][i].has("causal_link")) nw.causal_link = j["news"][i]["causal_link"].asString();
                if (j["news"][i].has("base_weight")) nw.base_weight = j["news"][i]["base_weight"].asDouble();
                else nw.base_weight = nw.importance * 20.0;
                if (j["news"][i].has("current_weight")) nw.current_weight = j["news"][i]["current_weight"].asDouble();
                else nw.current_weight = nw.base_weight;
                w.news.push_back(nw);
            }
        }
        
        if (j.has("ari_graph")) w.ari_graph = KnowledgeGraph::fromJson(j["ari_graph"]);
        
        if (j.has("intrigues")) {
            for (size_t i = 0; i < j["intrigues"].size(); i++) {
                w.intrigues.push_back(Intrigue::fromJson(j["intrigues"][i]));
            }
        }
        
        if (j.has("nexusData")) {
            for (const auto& kv : j["nexusData"].obj_val) {
                w.nexusData[kv.first] = kv.second;
            }
        }
        if (j.has("ships")) {
            for (size_t i = 0; i < j["ships"].size(); i++) {
                w.ships.push_back(Ship::fromJson(j["ships"][i]));
            }
        }

        if (j.has("fleets")) {
            for (size_t i = 0; i < j["fleets"].size(); i++) {
                w.fleets.push_back(Fleet::fromJson(j["fleets"][i]));
            }
        }
        if (j.has("monsters")) {
            for (size_t i = 0; i < j["monsters"].size(); i++) {
                w.monsters.push_back(EpicMonster::fromJson(j["monsters"][i]));
            }
        }
        if (j.has("port_facilities")) {
            for (const auto& kv : j["port_facilities"].obj_val) {
                w.port_facilities[kv.first] = PortFacility::fromJson(kv.second);
            }
        }

                if (j.has("subLocations")) {
            for (const auto& kv : j["subLocations"].obj_val) {
                w.subLocations[kv.first] = kv.second;
            }
        }
        if (j.has("map")) w.map = WorldMap::fromJson(j["map"]);
        w.needsGlobalEvent = j["needsGlobalEvent"].asBool();
        w.lastDirectInjectionDay = j["lastDirectInjectionDay"].asInt();
        if (j.has("player_trek")) w.player_trek = TrekState::fromJson(j["player_trek"]);
        
        return w;
    }
};

// Global world state
static World g_world;
static std::string g_playerId;
static std::set<std::string> g_active_hooks;


// ============================================================================
// C++ PLUGIN SYSTEM (NATIVE MODDING)
// ============================================================================
extern "C" {
    typedef void (*MetereaPluginInitFunc)(World*, Database*, ItemRegistry*, FacilityRegistry*);
    typedef void (*MetereaDailyTickFunc)();
}

class PluginManager {
private:
    std::vector<void*> loaded_libraries;
    std::vector<MetereaDailyTickFunc> daily_hooks;
public:
    void loadPlugins(const std::string& base_dir, const std::vector<std::string>& active_mods, World* w, Database* db, ItemRegistry* ir, FacilityRegistry* fr) {
        for (const auto& mod_id : active_mods) {
            if (mod_id == "base_game") continue;
            std::string mod_dir = base_dir + "/" + mod_id;
            if (!std::filesystem::exists(mod_dir)) continue;
            try {
                for (const auto& entry : std::filesystem::recursive_directory_iterator(mod_dir)) {
                    if (entry.is_regular_file()) {
                        std::string ext = entry.path().extension().string();
                        if (ext == ".dll" || ext == ".so") {
                            void* handle = nullptr;
                            #ifdef _WIN32
                            handle = (void*)LoadLibraryA(entry.path().string().c_str());
                            #else
                            handle = dlopen(entry.path().string().c_str(), RTLD_LAZY);
                            #endif
                            
                            if (handle) {
                                loaded_libraries.push_back(handle);
                                MetereaPluginInitFunc initFunc = nullptr;
                                MetereaDailyTickFunc tickFunc = nullptr;
                                
                                #ifdef _WIN32
                                initFunc = (MetereaPluginInitFunc)GetProcAddress((HMODULE)handle, "MetereaPluginInit");
                                tickFunc = (MetereaDailyTickFunc)GetProcAddress((HMODULE)handle, "MetereaDailyTick");
                                #else
                                initFunc = (MetereaPluginInitFunc)dlsym(handle, "MetereaPluginInit");
                                tickFunc = (MetereaDailyTickFunc)dlsym(handle, "MetereaDailyTick");
                                #endif
                                
                                if (initFunc) initFunc(w, db, ir, fr);
                                if (tickFunc) daily_hooks.push_back(tickFunc);
                            }
                        }
                    }
                }
            } catch (...) {}
        }
    }
    
    void runDailyHooks() {
        for (auto hook : daily_hooks) {
            if (hook) hook();
        }
    }
};

PluginManager g_pluginManager;

void triggerJsHook(const std::string& hookName) {
    if (g_active_hooks.count(hookName) == 0) return;
    
    JsonValue req = JsonValue::object();
    req.set("status", "hook_request");
    req.set("hook", hookName);
    req.set("world", g_world.toJson());
    
    {
        std::lock_guard<std::mutex> outLock(g_output_mutex);
        std::cout << req.toString() << std::endl;
        std::cout.flush();
    }

    // Read response with 10-second timeout to prevent indefinite hang
    std::string line;
    auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(10);
    while (std::chrono::steady_clock::now() < deadline) {
        // Non-blocking check: use short timeout approach
        if (std::cin.rdbuf()->in_avail() > 0 || std::cin.peek() != std::char_traits<char>::eof()) {
            if (std::getline(std::cin, line)) {
                if (line.empty()) continue;
                JsonValue resp = parseJson(line);
                if (resp.has("command") && resp["command"].asString() == "hook_response") {
                    if (resp.has("world")) {
                        g_world = World::fromJson(resp["world"]);
                    }
                    break;
                }
            }
        } else {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
    }
    // If timeout, continue without hook response — don't block engine
}

bool moveItem(const std::string& itemId, const std::string& targetContainerId) {
    std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
    if (!g_items.count(itemId)) return false;
    if (!g_containers.count(targetContainerId)) return false;
    
    PhysicalItem& item = g_items[itemId];
    std::string oldOwner = "";
    
    if (!item.container_id.empty() && g_containers.count(item.container_id)) {
        Storage& oldCont = g_containers[item.container_id];
        auto csIt = oldCont.cached_stocks.find(item.prototype_id);
        if (csIt != oldCont.cached_stocks.end()) {
            csIt->second -= item.stack_size;
            if (csIt->second < 0) csIt->second = 0; // Prevent underflow
        }
        oldOwner = oldCont.owner_id;
        auto& vec = oldCont.item_ids;
        auto it = std::find(vec.begin(), vec.end(), itemId);
        if (it != vec.end()) {
            *it = std::move(vec.back());
            vec.pop_back();
        }
        auto& type_vec = oldCont.items_by_type[item.prototype_id];
        auto it2 = std::find(type_vec.begin(), type_vec.end(), itemId);
        if (it2 != type_vec.end()) {
            *it2 = std::move(type_vec.back());
            type_vec.pop_back();
        }
        oldCont.is_dirty = true;
    }
    
    std::string newOwner = g_containers[targetContainerId].owner_id;
    if (!oldOwner.empty() && !newOwner.empty() && oldOwner != newOwner) {
        item.history.push_back({g_world.current_day, "Владелец сменился: " + oldOwner + " -> " + newOwner});
    }

    item.container_id = targetContainerId;
    item.is_dirty = true;
    g_containers[targetContainerId].item_ids.push_back(itemId);
    g_containers[targetContainerId].items_by_type[item.prototype_id].push_back(itemId);
    g_containers[targetContainerId].cached_stocks[item.prototype_id] += item.stack_size;
    g_containers[targetContainerId].is_dirty = true;
    
    return true;
}

// ============================================================================
// SIMULATION FUNCTIONS
// ============================================================================

// Shelf life in days for each good type
int getShelfLifeDays(const std::string& type) {
    if (type.empty()) return 999999;
    auto it = g_db.items.find(type);
    if (it != g_db.items.end()) return it->second.shelfLife;
    return 999999;
}

// Maximum news items retained — prevents unbounded memory growth during long simulations.
// Old news beyond this limit is pruned on every addNews() call.
static constexpr size_t MAX_NEWS_ITEMS = 500;

std::string addNews(const std::string& text, const std::string& location, int importance, const std::string& category = "misc", const std::string& causal_link = "", const std::vector<std::string>& entities = {}) {
    std::lock_guard<std::mutex> lock(g_news_mutex);
    News nw;
    nw.id = "news_" + generateUUID();
    nw.text = text;
    nw.location = location;
    nw.importance = importance;
    nw.category = category;
    nw.day = g_world.current_day;
    nw.causal_link = causal_link;
    nw.base_weight = importance * 20.0;
    nw.current_weight = nw.base_weight;
    g_world.news.push_back(nw);
    g_world.ari_graph.addEvent(nw.id, location, entities);

    // Prune old news to prevent unbounded memory growth.
    // Keep only the most recent MAX_NEWS_ITEMS entries.
    if (g_world.news.size() > MAX_NEWS_ITEMS) {
        size_t excess = g_world.news.size() - MAX_NEWS_ITEMS;
        g_world.news.erase(g_world.news.begin(), g_world.news.begin() + excess);
    }

    // Prune ari_graph: remove event references older than MAX_NEWS_ITEMS
    if (g_world.ari_graph.entity_to_events.size() > MAX_NEWS_ITEMS * 2) {
        for (auto& [k, v] : g_world.ari_graph.entity_to_events) {
            if (v.size() > 50) {
                v.erase(v.begin(), v.begin() + (v.size() - 50));
            }
        }
    }
    if (g_world.ari_graph.location_to_events.size() > MAX_NEWS_ITEMS * 2) {
        for (auto& [k, v] : g_world.ari_graph.location_to_events) {
            if (v.size() > 50) {
                v.erase(v.begin(), v.begin() + (v.size() - 50));
            }
        }
    }

    return nw.id;
}

std::string getGoodName(const std::string& good) {
    return good;
}

// Process spoilage for all items in all containers
void processSpoilage() {
    std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
    for (size_t i=0; i<g_containers.data.size(); ++i) {
        if (!g_containers.active[i]) continue;
        Storage& container = g_containers.data[i];
        double heatMod = 1.0;
        double coldMod = 1.0;
        
        std::string regionId = container.location.has("region_id") ? container.location["region_id"].asString() : "";
        if (!regionId.empty() && g_world.regions.count(regionId)) {
            std::string weather = g_world.regions[regionId].weather;
            if (weather == "Жара") heatMod = 2.0;
            if (weather == "Снег" || weather == "Метель") coldMod = 0.3;
        }
        
        for (const auto& itemId : container.item_ids) {
            if (!g_items.count(itemId)) continue;
            
            PhysicalItem& item = g_items[itemId];

            int maxLife = getShelfLifeDays(item.prototype_id);
            if (maxLife == 999999) continue;
            
            int age = g_world.current_day - item.batch_day;
            
            double effectiveAge = age;
            // Data-driven: use tags from ItemRegistry instead of hardcoded IDs
            const ItemTemplate* tpl = g_itemRegistry.getTemplate(item.prototype_id);
            bool isPerishable = (tpl && (tpl->hasTag("food") || tpl->hasTag("raw_food") || tpl->hasTag("consumable")));
            if (isPerishable) {
                effectiveAge = age * heatMod * coldMod;
            }
            
            if (effectiveAge >= maxLife) {
                item.history.push_back({g_world.current_day, "Сгнило полностью"});
                item.stack_size = 0;
                item.is_dirty = true;
            } else {
                double freshness = 1.0 - (effectiveAge / (double)maxLife);
                freshness = std::max(0.1, freshness);
                
                // Data-driven: use tags instead of hardcoded IDs
                bool isDegrading = (tpl && (tpl->hasTag("raw_material") || tpl->hasTag("weapon") || tpl->hasTag("armor")));
                if (isDegrading) {
                    if (effectiveAge > maxLife * 0.5) {
                        freshness *= 0.5;
                        item.durability = std::max(1, (int)(item.durability * 0.5));
                        item.is_dirty = true;
                    }
                }
                double old_quality = item.custom_props.has("quality") ? item.custom_props["quality"].asDouble() : -1.0;
                if (std::abs(old_quality - freshness) > 0.01 || item.is_dirty) {
                    item.custom_props.set("quality", freshness);
                    item.is_dirty = true;
                }
            }
        }
    }
    
    std::vector<std::string> toRemove;
    for (size_t i=0; i<g_items.data.size(); ++i) {
        if (!g_items.active[i]) continue;
        if (g_items.data[i].stack_size <= 0) {
            toRemove.push_back(g_items.data[i].id);
        }
    }
    for (const auto& itemId : toRemove) {
        removeItem(itemId, 999999);
    }
}

// Process NPC consumption of food (Multi-threaded)
void processConsumption() {
    std::vector<NPC*> active_npcs;
    for (auto& [id, npc] : g_world.npcs) if (npc.isAlive && npc.type != "ruler") active_npcs.push_back(&npc);
    
    std::unordered_map<std::string, std::unique_ptr<std::mutex>> r_locks;
    for (const auto& [rid, r] : g_world.regions) r_locks[rid] = std::make_unique<std::mutex>();

    int num_threads = std::thread::hardware_concurrency();
    if (num_threads == 0) num_threads = 4;
    int chunk_size = active_npcs.size() / num_threads + 1;
    std::vector<std::future<void>> futures;

    for (int t = 0; t < num_threads; ++t) {
        int start_idx = t * chunk_size;
        int end_idx = std::min((int)active_npcs.size(), (t + 1) * chunk_size);
        if (start_idx >= active_npcs.size()) break;

        futures.push_back(getThreadPool()->enqueue([start_idx, end_idx, &active_npcs, &r_locks]() {
            for (int i = start_idx; i < end_idx; ++i) {
                NPC& npc = *active_npcs[i];
                auto rit = g_world.regions.find(npc.currentLocation);
                if (rit == g_world.regions.end()) continue;
                Region& region = rit->second;
                if (region.vault_id.empty()) continue;
                
                npc.needs.hunger -= (1 + (thread_safe_rand() % 2));
                npc.needs.rest -= (2 + (thread_safe_rand() % 2));
                npc.needs.social -= 1;
                
                if (!npc.travelDestination.empty()) {
                    npc.travelHoursLeft--;
                    std::string destName = g_world.regions.count(npc.travelDestination) ? g_world.regions[npc.travelDestination].name : npc.travelDestination;
                    npc.currentActivity = locStr("engine.npc.traveling_to", {{"dest", destName}});
                    npc.needs.rest -= 1;
                    if (npc.travelHoursLeft <= 0) {
                        npc.currentLocation = npc.travelDestination;
                        npc.travelDestination = "";
                        npc.currentActivity = locStr("engine.npc.arrived");
                    }
                    continue;
                }
                
                if (npc.needs.hunger < 25) {
                    npc.currentActivity = locStr("engine.npc.searching_food");
                    
                    auto edibleItems = g_itemRegistry.findTemplatesWithTag("food");
                    std::string chosenFood = getCoreIdByTag("food");
                    int foodPrice = 5;
                    bool foundFood = false;

                    if (!edibleItems.empty()) {
                        for (const auto* item : edibleItems) {
                            if (countItemsInContainer(region.vault_id, item->id) > 0) {
                                chosenFood = item->id;
                                foodPrice = (int)region.markets[getMappedId(chosenFood)];
                                if (foodPrice == 0) foodPrice = item->basePrice;
                                foundFood = true;
                                break;
                            }
                        }
                    } else {
                        if (!chosenFood.empty() && countItemsInContainer(region.vault_id, chosenFood) > 0) {
                            chosenFood = getCoreIdByTag("food");
                            foodPrice = (int)region.markets[getMappedId(chosenFood)];
                            if (foodPrice == 0) foodPrice = 5;
                            foundFood = true;
                        }
                    }
                    
                    if (foundFood && npc.gold >= foodPrice) {
                        npc.gold -= foodPrice;
                        consumeItemsFromContainer(region.vault_id, chosenFood, 1);
                        {
                            std::lock_guard<std::mutex> lock(*r_locks[region.id]);
                            region.moneySupply += foodPrice;
                        }
                        npc.needs.hunger = 100;
                        npc.currentActivity = locStr("engine.npc.eating");
                    } else {
                        if (npc.personality.greed > 60 || npc.personality.aggression > 50) {
                            npc.currentActivity = locStr("engine.npc.stealing_food");
                            npc.needs.hunger += 40;
                        } else {
                            npc.currentActivity = locStr("engine.npc.starving");
                        }
                    }
                } else if (npc.needs.rest < 20) {
                    npc.currentActivity = locStr("engine.npc.sleeping");
                    npc.needs.rest += 50;
                } else {
                    int currentHour = g_world.time.internalHour;
                    for (const auto& sched : npc.schedule) {
                        if (currentHour >= sched.start && currentHour <= sched.end) {
                            npc.currentActivity = sched.activity;
                            if (sched.activity == "Working") {
                                npc.needs.rest -= 2;
                                if (npc.economy.profession_type == "merchant") {
                                    npc.gold += (thread_safe_rand() % 15) + 5;
                                    if ((thread_safe_rand() % 10) == 0 && !npc.inventory_id.empty()) {
                                        if (!region.markets.empty()) {
                                            int idx = thread_safe_rand() % region.markets.size();
                                            int j = 0;
                                            std::string good;
                                            for (const auto& [g, p] : region.markets) {
                                                if (j == idx) { good = g; break; }
                                                j++;
                                            }
                                            if (!good.empty()) {
                                                int price = (int)region.markets[good];
                                                int available = countItemsInContainer(region.vault_id, good);
                                                if (npc.gold >= price && available > 0) {
                                                    npc.gold -= price;
                                                    consumeItemsFromContainer(region.vault_id, good, 1);
                                                    createItem(good, 1, npc.inventory_id, g_world.current_day, locStr("engine.reason.bought"));
                                                }
                                            }
                                        }
                                    }
                                } else {
                                    int wage = std::max(1, (int)((region.moneySupply / std::max(1, region.population)) * npc.economy.skillLevel * 0.5));
                                    npc.gold += wage;
                                }
                            }
                            break;
                        }
                    }
                }
                
                npc.needs.hunger = std::max(0, std::min(100, npc.needs.hunger));
                npc.needs.rest = std::max(0, std::min(100, npc.needs.rest));
                npc.needs.social = std::max(0, std::min(100, npc.needs.social));
                
                if (npc.needs.hunger == 0 || npc.hp <= 0) {
                    npc.isAlive = false;
                    npc.currentActivity = (npc.needs.hunger == 0) ? locStr("engine.npc.dead_starvation") : locStr("engine.npc.dead_killed");
                }
            }
        }));
    }
    for (auto& f : futures) f.get();
}

    // Process caravans movement and delivery
    void processCaravans() {
    std::vector<Region*> active_regions;
    for (auto& [rid, r] : g_world.regions) {
        if (!r.caravans.empty()) active_regions.push_back(&r);
    }
    if (active_regions.empty()) return;

    std::vector<bool> has_road(g_world.map.width * g_world.map.height, false);
    std::vector<int> path_status(g_world.map.width * g_world.map.height, 0);
    for (const auto& road : g_world.map.roads) {
        if (road.condition == "blocked") {
            for (const auto& wp : road.waypoints) path_status[wp.second * g_world.map.width + wp.first] = 2;
        } else if (road.condition == "ruined") {
            for (const auto& wp : road.waypoints) {
                path_status[wp.second * g_world.map.width + wp.first] = 1;
                has_road[wp.second * g_world.map.width + wp.first] = true;
            }
        } else {
            for (const auto& wp : road.waypoints) has_road[wp.second * g_world.map.width + wp.first] = true;
        }
    }

    std::mutex arrived_mutex;
    struct ArrivedCaravan { Caravan c; std::string origin_id; };
    std::vector<ArrivedCaravan> arrived_caravans;
    std::vector<MapRoad> new_roads_buffer;

    int num_threads = std::thread::hardware_concurrency();
    if (num_threads == 0) num_threads = 4;
    int chunk_size = active_regions.size() / num_threads + 1;
    std::vector<std::future<void>> futures;

    for (int t = 0; t < num_threads; ++t) {
        int start_idx = t * chunk_size;
        int end_idx = std::min((int)active_regions.size(), (t + 1) * chunk_size);
        if (start_idx >= active_regions.size()) break;

        futures.push_back(getThreadPool()->enqueue([start_idx, end_idx, &active_regions, &arrived_mutex, &arrived_caravans, &new_roads_buffer, &has_road, &path_status]() {
            for (int idx = start_idx; idx < end_idx; ++idx) {
                Region& region = *active_regions[idx];
                for (int i = (int)region.caravans.size() - 1; i >= 0; i--) {
                    Caravan& caravan = region.caravans[i];
                    double speedMod = 1.0;
                    if (region.weather == "Метель" || region.weather == "Тропический ливень") speedMod = 0.5;
                    else if (region.weather == "Эфирный шторм") speedMod = 0.0;
                    else if (region.current_season == "winter") speedMod = 0.7;
                    
                    if (speedMod > 0) {
                        double speed = 0.5 * speedMod;
                        while (speed > 0 && caravan.path_index < (int)caravan.path.size() - 1) {
                            double target_x = caravan.path[caravan.path_index + 1].first;
                            double target_y = caravan.path[caravan.path_index + 1].second;
                            
                            int tx = (int)target_x, ty = (int)target_y;
                            if (tx < 0 || tx >= g_world.map.width || ty < 0 || ty >= g_world.map.height) break;
                            int nIdx = ty * g_world.map.width + tx;
                            bool is_goal = false;
                            if (g_world.map.locations.count(caravan.destination)) {
                                auto destLoc = g_world.map.locations.at(caravan.destination);
                                is_goal = (tx == destLoc.x && ty == destLoc.y);
                            }
                            
                            if (path_status[nIdx] == 1) {
                                speedMod /= 3.0;
                                if ((thread_safe_rand() % 1000) < 5) {
                                    caravan.wagons = std::max(0, caravan.wagons - 1);
                                    addNews(locStr("engine.news.caravan_accident"), caravan.origin, 2, "logistics");
                                }
                            }
                            if (path_status[nIdx] == 2 || (!has_road[nIdx] && !is_goal)) {
                                int goalX = 0, goalY = 0;
                                if (g_world.map.locations.count(caravan.destination)) {
                                    goalX = g_world.map.locations.at(caravan.destination).x;
                                    goalY = g_world.map.locations.at(caravan.destination).y;
                                }
                                auto new_path = findPath(g_world.map, caravan.x, caravan.y, goalX, goalY, has_road, path_status, MovementType::LAND, caravan.wagons * 20);
                                if (new_path.empty()) {
                                    new_path = findPath(g_world.map, caravan.x, caravan.y, goalX, goalY, has_road, path_status, MovementType::ANY, caravan.wagons * 20);
                                    if (!new_path.empty()) {
                                        MapRoad bypass;
                                        bypass.from = "bypass_" + generateUUID();
                                        bypass.to = caravan.destination;
                                        bypass.condition = "dirt";
                                        bypass.waypoints = new_path;
                                        {
                                            std::lock_guard<std::mutex> lock(arrived_mutex);
                                            new_roads_buffer.push_back(bypass);
                                        }
                                        addNews(locStr("engine.news.new_trade_route", {{"dest", caravan.destination}}), region.id, 2, "misc");
                                    }
                                }
                                if (new_path.empty()) {
                                    addNews(locStr("engine.news.caravan_lost", {{"origin", region.name}}), caravan.destination, 4, "disaster");
                                    region.caravans.erase(region.caravans.begin() + i);
                                    speed = 0;
                                    break;
                                } else {
                                    caravan.path = new_path;
                                    caravan.path_index = 0;
                                    target_x = caravan.path[1].first;
                                    target_y = caravan.path[1].second;
                                }
                            }
                            
                            double dx = target_x - caravan.x;
                            double dy = target_y - caravan.y;
                            double dist = std::hypot(dx, dy);
                            if (dist <= speed) {
                                caravan.x = target_x;
                                caravan.y = target_y;
                                speed -= dist;
                                caravan.path_index++;
                            } else {
                                caravan.x += (dx / dist) * speed;
                                caravan.y += (dy / dist) * speed;
                                speed = 0;
                            }
                        }
                    }
                    
                    if (caravan.path.empty() || caravan.path_index >= (int)caravan.path.size() - 1) {
                        std::lock_guard<std::mutex> lock(arrived_mutex);
                        arrived_caravans.push_back({caravan, region.id});
                        region.caravans.erase(region.caravans.begin() + i);
                    }
                }
            }
        }));
    }
    for (auto& f : futures) f.get();

    if (!new_roads_buffer.empty()) {
        for (const auto& r : new_roads_buffer) {
            g_world.map.roads.push_back(r);
        }
        g_path_cache_dirty = true;
    }

    for (const auto& ac : arrived_caravans) {
        Caravan caravan = ac.c;
        std::string origin_id = ac.origin_id;
        Region& region = g_world.regions[origin_id];
        
        auto destIt = g_world.regions.find(caravan.destination);
        if (destIt != g_world.regions.end() && !caravan.chest_id.empty()) {
            Region& destRegion = destIt->second;
            
            if (destRegion.threat_level > 90) {
                if (thread_safe_rand() % 100 < 80) {
                    caravan.destination = caravan.origin;
                    caravan.origin = destRegion.id;
                    caravan.hoursLeft = 24 + (thread_safe_rand() % 48);
                    addNews(locStr("engine.news.caravan_blockade", {{"dest", destRegion.name}}), destRegion.id, 4, "disaster");
                    region.caravans.push_back(caravan);
                    continue;
                }
            }
            
            int threat = destRegion.threat_level;
            int banditChance = std::min(80, threat);
            bool isAttacked = (thread_safe_rand() % 100) < banditChance;
            bool isRobbed = false;
            
            if (isAttacked) {
                int defenseChance = std::min(90, caravan.guards * 4);
                if ((thread_safe_rand() % 100) < defenseChance) {
                    addNews(locStr("engine.news.caravan_attacked_defended", {{"origin", region.name}, {"dest", destRegion.name}, {"guards", std::to_string(caravan.guards)}}), destRegion.id, 2, "trade");
                } else {
                    isRobbed = true;
                    std::string guardLost = caravan.guards > 0 ? locStr("engine.news.guard_lost") : locStr("engine.news.no_guard");
                    addNews(locStr("engine.news.caravan_robbed", {{"origin", region.name}, {"dest", destRegion.name}, {"guard_info", guardLost}}), destRegion.id, 3, "disaster");
                }
            }
            
            if (isRobbed) {
                if (!caravan.merchant_id.empty() && g_world.npcs.count(caravan.merchant_id)) {
                    NPC& merchant = g_world.npcs[caravan.merchant_id];
                    if (thread_safe_rand() % 100 < 50) {
                        merchant.isAlive = false;
                        merchant.death_cause = "Убит бандитами в пути";
                    } else {
                        merchant.currentLocation = destRegion.id;
                        merchant.currentActivity = "Разорен бандитами";
                    }
                }
                
                if (destRegion.bandit_stash_id.empty() || !g_containers.count(destRegion.bandit_stash_id)) {
                    destRegion.bandit_stash_id = createContainer("bandit_stash", "bandits", 999999, 1000, destRegion.id);
                }
                
                if (g_containers.count(caravan.chest_id)) {
                    Storage& chest = g_containers[caravan.chest_id];
                    std::vector<std::string> items_to_move = chest.item_ids;
                    for (const auto& itemId : items_to_move) {
                        moveItem(itemId, destRegion.bandit_stash_id);
                    }
                    std::lock_guard<std::recursive_mutex> reg_lock(g_registry_mutex);
                    g_deleted_containers.push_back(caravan.chest_id);
                    g_containers.erase(caravan.chest_id);
                }
                continue;
            }
            
            if (g_containers.count(caravan.chest_id)) {
                Storage& chest = g_containers[caravan.chest_id];
                double totalRevenue = 0;
                std::map<std::string, int> deliveredGoods;
                std::vector<std::string> items_to_move = chest.item_ids;
                
                                    for (const auto& itemId : items_to_move) {
                        if (!g_items.count(itemId)) continue;
                        
                        PhysicalItem& item = g_items[itemId];
                        if (item.stack_size <= 0) continue;
                        
                        double price = destRegion.markets[item.prototype_id];
                        if (price <= 0) {
                            auto it = g_db.items.find(item.prototype_id);
                            price = (it != g_db.items.end()) ? it->second.basePrice : 1;
                        }
                        
                        int qty = item.stack_size;
                        double cost = qty * price;
                        
                        // Город платит сколько может, но товар забирает весь (купец терпит убытки, но экономика не теряет ресурсы)
                        if (destRegion.moneySupply >= cost) {
                            destRegion.moneySupply -= cost;
                            totalRevenue += cost;
                        } else {
                            totalRevenue += destRegion.moneySupply;
                            destRegion.moneySupply = 0;
                        }
                        
                        deliveredGoods[item.prototype_id] += qty;
                        moveItem(itemId, destRegion.vault_id); // Всегда перемещаем физический товар в город!
                    }
                    
                    // Анти-спам: Если караван приехал пустым (всё сгнило в пути), не пишем новость
                    if (deliveredGoods.empty()) {
                        std::lock_guard<std::recursive_mutex> reg_lock(g_registry_mutex);
                        g_deleted_containers.push_back(caravan.chest_id);
                        g_containers.erase(caravan.chest_id);
                        continue;
                    }
                
                int tax = totalRevenue * 0.1;
                destRegion.moneySupply += tax;
                int netRevenue = totalRevenue - tax;

                if (!caravan.merchant_id.empty() && g_world.npcs.count(caravan.merchant_id)) {
                    NPC& merchant = g_world.npcs[caravan.merchant_id];
                    merchant.economy.savings += netRevenue;
                    merchant.currentLocation = caravan.destination;
                    merchant.currentActivity = "Торгует на рынке";
                } else if (!caravan.owner_business_id.empty() && g_world.businesses.count(caravan.owner_business_id)) {
                    Business& bus = g_world.businesses[caravan.owner_business_id];
                    bus.cash_balance += netRevenue;
                    bus.addLog(g_world.current_day, locStr("engine.log.caravan_profit", {{"revenue", std::to_string(netRevenue)}, {"dest", destRegion.name}}));
                } else {
                    if (g_world.regions.count(caravan.origin)) {
                        g_world.regions[caravan.origin].moneySupply += netRevenue;
                    }
                }
                
                std::string goodsList;
                for (const auto& [gt, amount] : deliveredGoods) {
                    if (!goodsList.empty()) goodsList += ", ";
                    goodsList += std::to_string(amount) + " " + getGoodName(gt);
                }
                if (goodsList.empty()) goodsList = "ничего";
                
                addNews(locStr("engine.news.caravan_arrived", {{"origin", region.name}, {"dest", destRegion.name}, {"goods", goodsList}, {"revenue", std::to_string((int)totalRevenue)}}), destRegion.id, 1, "trade");

                if (g_world.factions.count(region.factionId) && g_world.factions.count(destRegion.factionId)) {
                    if (region.factionId != destRegion.factionId) {
                        if (g_world.factions[region.factionId].relations[destRegion.factionId] < 50) {
                            g_world.factions[region.factionId].relations[destRegion.factionId] += 1;
                            g_world.factions[destRegion.factionId].relations[region.factionId] += 1;
                        }
                    }
                }
                
                std::lock_guard<std::recursive_mutex> reg_lock(g_registry_mutex);
                g_deleted_containers.push_back(caravan.chest_id);
                g_containers.erase(caravan.chest_id);
            }
        }
    }
}

// === КАСКАДНАЯ МОДЕЛЬ ВРЕМЕНИ: ПОДСИСТЕМЫ ===

void updateWeather() {
    int month = ((g_world.current_day / 30) % 12) + 1;
    for (auto& [rid, region] : g_world.regions) {
        std::string season = "spring";
        if (region.climate == "cold") {
            if (month >= 4 && month <= 5) season = "spring";
            else if (month >= 6 && month <= 7) season = "summer";
            else if (month >= 8 && month <= 9) season = "autumn";
            else season = "winter";
        } else if (region.climate == "tropical") {
            if (month >= 4 && month <= 9) season = "summer";
            else season = "spring";
        } else {
            if (month >= 3 && month <= 5) season = "spring";
            else if (month >= 6 && month <= 8) season = "summer";
            else if (month >= 9 && month <= 11) season = "autumn";
            else season = "winter";
        }
        region.current_season = season;
        if (region.weatherDaysLeft > 0) region.weatherDaysLeft--;
        else {
            std::vector<std::string> weathers = {"clear", "cloudy"};
            if (region.climate == "tropical") {
                weathers.push_back("tropical_rain"); weathers.push_back("heatwave");
            } else if (region.climate == "cold") {
                weathers.push_back("heavy_snow"); weathers.push_back("blizzard");
            } else {
                if (season == "winter") { weathers.push_back("snow"); weathers.push_back("blizzard"); }
                else if (season == "spring" || season == "autumn") { weathers.push_back("rain"); weathers.push_back("fog"); }
                else { weathers.push_back("rain"); weathers.push_back("heatwave"); }
            }
            if (thread_safe_rand() % 100 < 1) weathers.push_back("aether_storm");
            region.weather = weathers[thread_safe_rand() % weathers.size()];
            region.weatherDaysLeft = 3 + (thread_safe_rand() % 4);
        }
    }
}




void checkGlobalEvents() {
    // Еженедельные глобальные события
    if ((thread_safe_rand() % 100) < 2) {
        addNews(locStr("engine.news.magic_currents_changed"), "global", 3, "misc");
    }
}

bool hasPendingOrder(const std::string& containerId, const std::string& good) {
    std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
    if (!g_containers.count(containerId)) return false;
    const Storage& cont = g_containers[containerId];
    for (const auto& itemId : cont.item_ids) {
        if (g_items.count(itemId)) {
            const PhysicalItem& item = g_items[itemId];
            if (item.prototype_id == "document_order" && item.order_data.has_value()) {
                if (item.order_data->item_prototype == good && 
                    (item.order_data->status == "pending" || item.order_data->status == "in_progress")) {
                    return true;
                }
            }
        }
    }
    return false;
}


bool isResourceValidForFacility(const std::string& res, const std::string& facType) {
    if (facType == "warehouses" || facType == "market" || facType == "tavern" || facType == "banks") return true;
    for (const auto& r : g_db.recipes) {
        if (r.facility == facType && r.inputs.count(res)) return true;
    }
    return false;
}

void processDailyBusinesses() {
    for (auto& [bId, bus] : g_world.businesses) {
        if (bus.construction_days_left > 0) {
            bus.construction_days_left--;
            if (bus.construction_days_left == 0) {
                bus.is_active = true;
                addNews("CONSTRUCTION: Facility " + std::string(getFacilityName(bus.facility_type)) + " is built and ready for operation!", bus.region_id, 2, "business");
                bus.addLog(g_world.current_day, "🏗️ Construction complete. Facility operational.");
            }
        }
        
        if (!bus.is_active && bus.construction_days_left > 0) continue;

        if (!g_world.regions.count(bus.region_id)) continue;
        Region& r = g_world.regions[bus.region_id];
        
        const FacilityTemplate* facTpl = g_facilityRegistry.getTemplate(bus.facility_type);
        int base_maint = facTpl ? facTpl->base_maintenance : 50;
        int maintenance_cost = bus.level * base_maint * (bus.maintenance_budget / 100.0);
        bus.cash_balance -= maintenance_cost;
        
        if (bus.maintenance_budget < 100 && (thread_safe_rand() % 100 < (100 - bus.maintenance_budget))) {
            bus.durability -= 1;
        }

        if (bus.is_active && bus.auto_sell_outputs && !bus.production_focus.empty()) {
            std::string focusStr = bus.production_focus;
            int stock = countItemsInContainer(bus.local_storage_id, focusStr);
            if (stock > 0) {
                double price = r.markets[focusStr];
                if (price <= 0) price = (g_db.items.count(focusStr) ? g_db.items.at(focusStr).basePrice : 1);
                
                double itemWeight = (focusStr == getCoreIdByTag("currency")) ? 0.01 : 1.0;
                double currentVaultWeight = calculateContainerWeight(r.vault_id);
                int maxCanSell = (r.storage_capacity - currentVaultWeight) / itemWeight;
                int actualSell = std::min(stock, maxCanSell);
                
                if (actualSell > 0) {
                    int revenue = actualSell * price;
                    if (r.moneySupply >= revenue) {
                        r.moneySupply -= revenue;
                        bus.cash_balance += revenue;
                        consumeItemsFromContainer(bus.local_storage_id, focusStr, actualSell);
                        createItem(focusStr, actualSell, r.vault_id, g_world.current_day, "Business auto-sale");
                        bus.addLog(g_world.current_day, "💰 Auto-sale to city (" + getGoodName(focusStr) + ", " + std::to_string(actualSell) + " pcs.): +" + std::to_string(revenue) + " g.");
                    } else {
                        bus.addLog(g_world.current_day, "⚠️ City treasury empty. Sale impossible.");
                    }
                } else if (stock > 0) {
                    bus.addLog(g_world.current_day, "⚠️ City vault full. Sale impossible.");
                }
            }
        }
        
        if (bus.is_active && bus.auto_buy_inputs && !bus.production_focus.empty()) {
            std::string focusStr = bus.production_focus;
            const RecipeDef* activeRecipe = nullptr;
            for (const auto& rec : g_db.recipes) {
                if (rec.facility == bus.facility_type && rec.outputs.count(focusStr)) {
                    activeRecipe = &rec; break;
                }
            }
            if (activeRecipe) {
                for (const auto& in : activeRecipe->inputs) {
                    std::string inStr = in.first;
                    int stock = countItemsInContainer(bus.local_storage_id, inStr);
                    int needed = (bus.employee_count / 2) * in.second;
                    if (stock < needed * 3) {
                        int to_buy = (needed * 3) - stock;
                        double price = r.markets[inStr];
                        if (price <= 0) {
                            auto it = g_db.items.find(inStr);
                            price = (it != g_db.items.end()) ? it->second.basePrice : 1;
                        }
                        
                        int remaining_to_buy = to_buy;
                        
                        // 1. Buy from market_square (NPCs)
                        for (auto it = r.market_square.begin(); it != r.market_square.end() && remaining_to_buy > 0; ) {
                            MarketOffer& offer = *it;
                            if (offer.good == inStr) {
                                int buy_qty = std::min(offer.quantity, remaining_to_buy);
                                int cost = buy_qty * price;
                                if (bus.cash_balance >= cost) {
                                    bus.cash_balance -= cost;
                                    if (g_world.npcs.count(offer.seller_id)) {
                                        std::lock_guard<std::mutex> npc_lock(g_npc_state_mutex);
                                        g_world.npcs[offer.seller_id].economy.savings += cost;
                                        std::string sellerCont = g_world.npcs[offer.seller_id].economy.storage_id.empty() ? g_world.npcs[offer.seller_id].inventory_id : g_world.npcs[offer.seller_id].economy.storage_id;
                                        consumeItemsFromContainer(sellerCont, offer.good, buy_qty);
                                    }
                                    createItem(inStr, buy_qty, bus.local_storage_id, g_world.current_day, "Auto-buy (Market)");
                                    offer.quantity -= buy_qty;
                                    remaining_to_buy -= buy_qty;
                                    std::string sellerName = g_world.npcs.count(offer.seller_id) ? g_world.npcs[offer.seller_id].name : (g_world.businesses.count(offer.seller_id) ? std::string(getFacilityName(g_world.businesses[offer.seller_id].facility_type)) : "Unknown");
                                    bus.addLog(g_world.current_day, "🛒 Auto-buy from agent '" + sellerName + "' (" + getGoodName(inStr) + ", " + std::to_string(buy_qty) + " pcs.): -" + std::to_string(cost) + " g.");
                                }
                            }
                            if (offer.quantity <= 0) it = r.market_square.erase(it);
                            else ++it;
                        }
                        
                        // 2. Buy from State Vault
                        if (remaining_to_buy > 0) {
                            int avail_in_vault = countItemsInContainer(r.vault_id, inStr);
                            int actual_buy = std::min(remaining_to_buy, avail_in_vault);
                            if (actual_buy > 0) {
                                int cost = actual_buy * price;
                                if (bus.cash_balance >= cost) {
                                    bus.cash_balance -= cost;
                                    r.moneySupply += cost;
                                    consumeItemsFromContainer(r.vault_id, inStr, actual_buy);
                                    createItem(inStr, actual_buy, bus.local_storage_id, g_world.current_day, "Auto-buy (Vault)");
                                    bus.addLog(g_world.current_day, "🛒 Auto-buy from city vault (" + getGoodName(inStr) + ", " + std::to_string(actual_buy) + " pcs.): -" + std::to_string(cost) + " g.");
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}


void processLogistics() {
    for (auto& [bId, bus] : g_world.businesses) {
        if (!bus.is_active) continue;
        for (auto& rule : bus.logistics) {
            rule.days_since_last++;
            if (rule.days_since_last >= rule.frequency_days) {
                if (rule.type == "transfer") {
                    std::string targetCont = rule.target_id;
                    std::string targetRegion = rule.target_id;
                    if (g_world.businesses.count(rule.target_id)) {
                        targetCont = g_world.businesses[rule.target_id].local_storage_id;
                        targetRegion = g_world.businesses[rule.target_id].region_id;
                    } else if (g_world.regions.count(rule.target_id)) {
                        targetCont = g_world.regions[rule.target_id].vault_id;
                    }
                    
                    if (!targetCont.empty() && g_containers.count(bus.local_storage_id)) {
                        std::string targetFacType = "";
                        if (g_world.businesses.count(rule.target_id)) targetFacType = g_world.businesses[rule.target_id].facility_type;
                        if (!targetFacType.empty() && !isResourceValidForFacility(rule.resource, targetFacType)) {
                            bus.addLog(g_world.current_day, locStr("engine.log.logistics_error_receiver", {{"good", getGoodName(rule.resource)}}));
                            rule.days_since_last = 0;
                            continue;
                        }

                        int available = countItemsInContainer(bus.local_storage_id, rule.resource);
                        int calc_amount = rule.amount_is_percent ? (available * rule.amount / 100) : rule.amount;
                        int to_move = std::min(std::max(0, available - rule.keep_reserve), calc_amount);

                        if (g_world.regions.count(targetRegion)) {
                            Storage& targetContainer = g_containers[targetCont];
                            double currentWeight = calculateContainerWeight(targetCont);
                            
                            if (targetContainer.type != "business_storage") {
                                Region& receiverReg = g_world.regions[targetRegion];
                                int freeSpace = receiverReg.storage_capacity - currentWeight;
                                if (freeSpace <= 0) {
                                    bus.addLog(g_world.current_day, locStr("engine.log.logistics_error_city_full"));
                                    rule.days_since_last = 0; continue;
                                }
                                to_move = std::min(to_move, freeSpace);
                            } else {
                                int freeSpace = targetContainer.max_weight_kg - currentWeight;
                                if (freeSpace <= 0) {
                                    bus.addLog(g_world.current_day, locStr("engine.log.logistics_error_bus_full"));
                                    rule.days_since_last = 0; continue;
                                }
                                to_move = std::min(to_move, freeSpace);
                            }
                        }

                        if (g_world.businesses.count(rule.target_id)) {
                            Business& receiverBus = g_world.businesses[rule.target_id];
                            if (std::find(receiverBus.owner_ids.begin(), receiverBus.owner_ids.end(), "player") != receiverBus.owner_ids.end()) {
                                double price = g_world.regions[bus.region_id].markets[rule.resource];
                                if (price <= 0) {
                                    auto it = g_db.items.find(rule.resource);
                                    price = (it != g_db.items.end()) ? it->second.basePrice : 1;
                                }
                                int internalCost = to_move * price * 0.75;
                                
                                if (receiverBus.cash_balance >= internalCost) {
                                    receiverBus.cash_balance -= internalCost;
                                    bus.cash_balance += internalCost;
                                    bus.addLog(g_world.current_day, locStr("engine.log.internal_sale", {{"good", getGoodName(rule.resource)}, {"amount", std::to_string(to_move)}, {"facility", getFacilityName(receiverBus.facility_type)}, {"cost", std::to_string(internalCost)}}));
                                    receiverBus.addLog(g_world.current_day, locStr("engine.log.internal_purchase", {{"good", getGoodName(rule.resource)}, {"amount", std::to_string(to_move)}, {"facility", getFacilityName(bus.facility_type)}, {"cost", std::to_string(internalCost)}}));
                                } else {
                                    bus.addLog(g_world.current_day, locStr("engine.log.internal_no_money"));
                                    rule.days_since_last = 0; continue;
                                }
                            }
                        }
                        if (to_move > 0) {
                            int moved = 0;
                            Storage& src = g_containers[bus.local_storage_id];
                            std::vector<std::string> items_to_move;
                            for (const auto& itemId : src.item_ids) {
                                if (g_items.count(itemId) && g_items[itemId].prototype_id == rule.resource) items_to_move.push_back(itemId);
                            }
                            
                            std::vector<std::pair<int,int>> caravan_path;
                            if (targetRegion != bus.region_id && !targetRegion.empty()) {
                                if (g_path_cache.count({bus.region_id, targetRegion})) {
                                    caravan_path = g_path_cache[{bus.region_id, targetRegion}];
                                }
                                if (caravan_path.empty()) continue;
                            }

                            if (targetRegion == bus.region_id || targetRegion.empty()) {
                                if (g_containers.count(targetCont)) {
                                    if (!g_world.businesses.count(rule.target_id) && g_world.regions.count(rule.target_id)) {
                                        Region& targetReg = g_world.regions[rule.target_id];
                                        double price = targetReg.markets[rule.resource];
                                        if (price <= 0) {
                                            auto it = g_db.items.find(rule.resource);
                                            price = (it != g_db.items.end()) ? it->second.basePrice : 1;
                                        }
                                        int cost = to_move * price;
                                        if (targetReg.moneySupply >= cost) {
                                            targetReg.moneySupply -= cost;
                                            bus.cash_balance += cost;
                                            bus.addLog(g_world.current_day, locStr("engine.log.export_city", {{"good", getGoodName(rule.resource)}, {"amount", std::to_string(to_move)}, {"cost", std::to_string(cost)}}));
                                        } else {
                                            bus.addLog(g_world.current_day, locStr("engine.log.city_no_money"));
                                            rule.days_since_last = 0; continue;
                                        }
                                    }

                                    for (const auto& itemId : items_to_move) {
                                        if (moved >= to_move) break;
                                        if (!g_items.count(itemId)) continue;
                                        PhysicalItem& item = g_items[itemId];
                                        int take = std::min(item.stack_size, to_move - moved);
                                        if (take == item.stack_size) { moveItem(itemId, targetCont); moved += take; }
                                        else { removeItem(itemId, take); createItem(rule.resource, take, targetCont, g_world.current_day, "Логистика"); moved += take; }
                                    }
                                    if (moved > 0) addNews(locStr("engine.news.local_delivery", {{"amount", std::to_string(moved)}, {"good", getGoodName(rule.resource)}, {"facility", getFacilityName(bus.facility_type)}}), bus.region_id, 1, "logistics");
                                    if (moved > 0) bus.addLog(g_world.current_day, locStr("engine.log.local_delivery_sent", {{"amount", std::to_string(moved)}, {"good", getGoodName(rule.resource)}}));
                                }
                            } else {
                                std::string chestId = createContainer("caravan_chest", "business", 999999, 1000, bus.region_id);
                                for (const auto& itemId : items_to_move) {
                                    if (moved >= to_move) break;
                                    if (!g_items.count(itemId)) continue;
                                    PhysicalItem& item = g_items[itemId];
                                    int take = std::min(item.stack_size, to_move - moved);
                                    if (take == item.stack_size) { moveItem(itemId, chestId); moved += take; }
                                    else { removeItem(itemId, take); createItem(rule.resource, take, chestId, g_world.current_day, "Логистика"); moved += take; }
                                }
                                if (moved > 0) {
                                    Caravan caravan;
                                    caravan.id = "caravan_" + generateUUID();
                                    caravan.merchant_id = ""; 
                                    caravan.owner_business_id = bId;
                                    caravan.origin = bus.region_id;
                                    caravan.destination = targetRegion;
                                    caravan.chest_id = chestId;
                                    caravan.wagons = 1 + (moved / 50);
                                    caravan.guards = 2;
                                    caravan.hoursLeft = 24 + (rand() % 48);
                                    if (g_path_cache.count({bus.region_id, targetRegion})) {
                                        caravan.path = g_path_cache[{bus.region_id, targetRegion}];
                                        if (!caravan.path.empty()) { caravan.x = caravan.path[0].first; caravan.y = caravan.path[0].second; }
                                    }
                                    g_world.regions[bus.region_id].caravans.push_back(caravan);
                                    std::string destName = g_world.regions.count(targetRegion) ? g_world.regions[targetRegion].name : targetRegion;
                                    addNews(locStr("engine.news.corp_caravan_sent", {{"facility", getFacilityName(bus.facility_type)}, {"dest", destName}, {"amount", std::to_string(moved)}, {"good", getGoodName(rule.resource)}}), bus.region_id, 2, "logistics");
                                    bus.addLog(g_world.current_day, locStr("engine.log.corp_caravan_sent", {{"amount", std::to_string(moved)}, {"good", getGoodName(rule.resource)}, {"dest", destName}}));
                                }
                            }
                        }
                    }
                } else if (rule.type == "pull") {
                    std::string sourceCont = rule.target_id;
                    std::string sourceRegion = rule.target_id;
                    if (g_world.businesses.count(rule.target_id)) {
                        sourceCont = g_world.businesses[rule.target_id].local_storage_id;
                        sourceRegion = g_world.businesses[rule.target_id].region_id;
                    } else if (g_world.regions.count(rule.target_id)) {
                        sourceCont = g_world.regions[rule.target_id].vault_id;
                    }
                    
                    if (!sourceCont.empty() && g_containers.count(sourceCont) && g_containers.count(bus.local_storage_id)) {
                        if (!isResourceValidForFacility(rule.resource, bus.facility_type)) {
                            bus.addLog(g_world.current_day, locStr("engine.log.logistics_error_receiver", {{"good", getGoodName(rule.resource)}}));
                            rule.days_since_last = 0; continue;
                        }

                        Region& ourReg = g_world.regions[bus.region_id];
                        Storage& ourContainer = g_containers[bus.local_storage_id];
                        int ourFreeSpace = ourContainer.max_weight_kg - calculateContainerWeight(bus.local_storage_id);
                        
                        int available = countItemsInContainer(sourceCont, rule.resource);
                        int calc_amount = rule.amount_is_percent ? (available * rule.amount / 100) : rule.amount;
                        int to_move = std::min({std::max(0, available - rule.keep_reserve), calc_amount, ourFreeSpace});

                        if (g_world.businesses.count(rule.target_id)) {
                            Business& senderBus = g_world.businesses[rule.target_id];
                            double price = ourReg.markets[rule.resource];
                            if (price <= 0) {
                                auto it = g_db.items.find(rule.resource);
                                price = (it != g_db.items.end()) ? it->second.basePrice : 1;
                            }
                            int internalCost = to_move * price * 0.75;

                            if (bus.cash_balance >= internalCost) {
                                bus.cash_balance -= internalCost;
                                senderBus.cash_balance += internalCost;
                                bus.addLog(g_world.current_day, locStr("engine.log.internal_purchase", {{"good", getGoodName(rule.resource)}, {"amount", std::to_string(to_move)}, {"facility", getFacilityName(senderBus.facility_type)}, {"cost", std::to_string(internalCost)}}));
                                senderBus.addLog(g_world.current_day, locStr("engine.log.internal_sale", {{"good", getGoodName(rule.resource)}, {"amount", std::to_string(to_move)}, {"facility", getFacilityName(bus.facility_type)}, {"cost", std::to_string(internalCost)}}));
                            } else {
                                bus.addLog(g_world.current_day, locStr("engine.log.internal_no_money"));
                                rule.days_since_last = 0; continue;
                            }
                        } else if (g_world.regions.count(rule.target_id)) {
                            Region& sourceReg = g_world.regions[rule.target_id];
                            double price = sourceReg.markets[rule.resource];
                            if (price <= 0) {
                                auto it = g_db.items.find(rule.resource);
                                price = (it != g_db.items.end()) ? it->second.basePrice : 1;
                            }
                            int cost = to_move * price;
                            if (bus.cash_balance >= cost) {
                                bus.cash_balance -= cost;
                                sourceReg.moneySupply += cost;
                                bus.addLog(g_world.current_day, locStr("engine.log.import_city", {{"good", getGoodName(rule.resource)}, {"amount", std::to_string(to_move)}, {"cost", std::to_string(cost)}}));
                            } else {
                                bus.addLog(g_world.current_day, locStr("engine.log.no_money_import"));
                                rule.days_since_last = 0; continue;
                            }
                        }
                        
                        if (to_move > 0) {
                            int moved = 0;
                            Storage& src = g_containers[sourceCont];
                            std::vector<std::string> items_to_move;
                            for (const auto& itemId : src.item_ids) {
                                if (g_items.count(itemId) && g_items[itemId].prototype_id == rule.resource) items_to_move.push_back(itemId);
                            }
                            
                            std::vector<std::pair<int,int>> caravan_path;
                            if (sourceRegion != bus.region_id && !sourceRegion.empty()) {
                                if (g_path_cache.count({sourceRegion, bus.region_id})) {
                                    caravan_path = g_path_cache[{sourceRegion, bus.region_id}];
                                }
                                if (caravan_path.empty()) continue;
                            }

                            if (sourceRegion == bus.region_id || sourceRegion.empty()) {
                                for (const auto& itemId : items_to_move) {
                                    if (moved >= to_move) break;
                                    if (!g_items.count(itemId)) continue;
                                    PhysicalItem& item = g_items[itemId];
                                    int take = std::min(item.stack_size, to_move - moved);
                                    if (take == item.stack_size) { moveItem(itemId, bus.local_storage_id); moved += take; }
                                    else { removeItem(itemId, take); createItem(rule.resource, take, bus.local_storage_id, g_world.current_day, "Логистика (забор)"); moved += take; }
                                }
                                if (moved > 0) addNews(locStr("engine.news.local_pickup", {{"amount", std::to_string(moved)}, {"good", getGoodName(rule.resource)}, {"facility", getFacilityName(bus.facility_type)}}), bus.region_id, 1, "logistics");
                                if (moved > 0) bus.addLog(g_world.current_day, locStr("engine.log.local_pickup", {{"amount", std::to_string(moved)}, {"good", getGoodName(rule.resource)}}));
                            } else {
                                std::string chestId = createContainer("caravan_chest", "business", 999999, 1000, sourceRegion);
                                for (const auto& itemId : items_to_move) {
                                    if (moved >= to_move) break;
                                    if (!g_items.count(itemId)) continue;
                                    PhysicalItem& item = g_items[itemId];
                                    int take = std::min(item.stack_size, to_move - moved);
                                    if (take == item.stack_size) { moveItem(itemId, chestId); moved += take; }
                                    else { removeItem(itemId, take); createItem(rule.resource, take, chestId, g_world.current_day, "Логистика (забор)"); moved += take; }
                                }
                                if (moved > 0) {
                                    Caravan caravan;
                                    caravan.id = "caravan_" + generateUUID();
                                    caravan.merchant_id = ""; 
                                    caravan.owner_business_id = bId;
                                    caravan.origin = sourceRegion;
                                    caravan.destination = bus.region_id;
                                    caravan.chest_id = chestId;
                                    caravan.wagons = 1 + (moved / 50);
                                    caravan.guards = 2;
                                    caravan.hoursLeft = 24 + (rand() % 48);
                                    if (g_path_cache.count({sourceRegion, bus.region_id})) {
                                        caravan.path = g_path_cache[{sourceRegion, bus.region_id}];
                                        if (!caravan.path.empty()) { caravan.x = caravan.path[0].first; caravan.y = caravan.path[0].second; }
                                    }
                                    g_world.regions[sourceRegion].caravans.push_back(caravan);
                                    std::string sourceName = g_world.regions.count(sourceRegion) ? g_world.regions[sourceRegion].name : sourceRegion;
                                    addNews(locStr("engine.news.corp_caravan_pickup", {{"amount", std::to_string(moved)}, {"good", getGoodName(rule.resource)}, {"source", sourceName}}), sourceRegion, 2, "logistics");
                                    bus.addLog(g_world.current_day, locStr("engine.log.corp_caravan_pickup", {{"amount", std::to_string(moved)}, {"good", getGoodName(rule.resource)}, {"source", sourceName}}));
                                }
                            }
                        }
                    }
                } else if (rule.type == "order") {
                    if (g_world.regions.count(bus.region_id)) {
                        std::string vaultId = g_world.regions[bus.region_id].vault_id;
                        std::string orderId = createItem("document_order", 1, vaultId, g_world.current_day, "Логистический заказ");
                        if (g_items.count(orderId)) {
                            OrderData od;
                            od.issuer_id = bus.region_id;
                            od.issuer_name = "Бизнес: " + bus.id;
                            od.item_prototype = rule.resource;
                            od.quantity = rule.amount;
                            auto it = g_db.items.find(rule.resource);
                            int baseP = (it != g_db.items.end()) ? it->second.basePrice : 1;
                            od.max_price_per_unit = rule.max_price > 0 ? rule.max_price : baseP * 2;
                            od.deadline_days = 14;
                            od.status = "pending";
                            od.created_date = g_world.current_day;
                            od.target_container_id = bus.local_storage_id;
                            g_items[orderId].order_data = od;
                            g_items[orderId].custom_props.set("name", "Заказ: " + rule.resource);
                            addNews(locStr("engine.news.order_placed", {{"facility", getFacilityName(bus.facility_type)}, {"amount", std::to_string(rule.amount)}, {"good", getGoodName(rule.resource)}}), bus.region_id, 1, "logistics");
                            bus.addLog(g_world.current_day, locStr("engine.log.order_placed", {{"amount", std::to_string(rule.amount)}, {"good", getGoodName(rule.resource)}}));
                        }
                    }
                } else if (rule.type == "retail") {
                    Region& localReg = g_world.regions[bus.region_id];
                    int available = countItemsInContainer(bus.local_storage_id, rule.resource);
                    int calc_amount = rule.amount_is_percent ? (available * rule.amount / 100) : rule.amount;
                    int to_offer = std::min(std::max(0, available - rule.keep_reserve), calc_amount);

                    if (to_offer > 0) {
                        bool merged = false;
                        for (auto& ex_offer : localReg.market_square) {
                            if (ex_offer.seller_id == bId && ex_offer.good == rule.resource) {
                                ex_offer.quantity = to_offer;
                                if (rule.max_price > 0) ex_offer.price = rule.max_price;
                                else ex_offer.price = localReg.markets[rule.resource];
                                merged = true; break;
                            }
                        }
                        if (!merged) {
                            MarketOffer offer;
                            offer.id = "offer_" + generateUUID();
                            offer.seller_id = bId;
                            offer.good = rule.resource;
                            offer.quantity = to_offer;
                            if (rule.max_price > 0) offer.price = rule.max_price;
                            else {
                                double p = localReg.markets[rule.resource];
                                if (p <= 0) {
                                    auto it = g_db.items.find(rule.resource);
                                    p = (it != g_db.items.end()) ? it->second.basePrice : 1;
                                }
                                offer.price = p;
                            }
                            localReg.market_square.push_back(offer);
                        }
                        bus.addLog(g_world.current_day, locStr("engine.log.retail_offer", {{"good", getGoodName(rule.resource)}, {"amount", std::to_string(to_offer)}}));
                    } else {
                        for (auto it = localReg.market_square.begin(); it != localReg.market_square.end(); ) {
                            if (it->seller_id == bId && it->good == rule.resource) {
                                it = localReg.market_square.erase(it);
                            } else {
                                ++it;
                            }
                        }
                    }
                }
                rule.days_since_last = 0;
            }
        }
    }
}

void processPrivateProduction() {
    for (auto& [bId, bus] : g_world.businesses) {
        if (!bus.is_active || bus.employee_count <= 0 || bus.local_storage_id.empty() || bus.production_focus.empty() || (g_world.regions.count(bus.region_id) && g_world.regions[bus.region_id].productionBlockedDays > 0)) continue;
        
        std::string focusTypeStr = bus.production_focus;
        std::string focusType = focusTypeStr;
        int capacity = bus.employee_count / 2;
        double prodRatio = bus.target_efficiency / 100.0;
        
        const FacilityTemplate* facTpl = g_facilityRegistry.getTemplate(bus.facility_type);
        bool isExtractor = facTpl && facTpl->hasTag("extractor");
        
        double weatherMod = 1.0;
        if (facTpl && g_world.regions.count(bus.region_id)) {
            Region& r = g_world.regions[bus.region_id];
            if (facTpl->weather_modifiers.count(r.weather)) weatherMod = facTpl->weather_modifiers.at(r.weather);
            else if (facTpl->weather_modifiers.count(r.current_season)) weatherMod = facTpl->weather_modifiers.at(r.current_season);
        }
        
        if (isExtractor) {
            if (g_world.regions.count(bus.region_id)) {
                Region& r = g_world.regions[bus.region_id];
                if (r.available_raw_resources.count(focusTypeStr) && facTpl && facTpl->extraction_rates.count(focusTypeStr)) {
                    double curWeight = calculateContainerWeight(bus.local_storage_id);
                    if (curWeight >= g_containers[bus.local_storage_id].max_weight_kg) {
                        bus.addLog(g_world.current_day, locStr("engine.log.storage_full_mining"));
                        continue;
                    }
                    double extRate = facTpl->extraction_rates.at(focusTypeStr);
                    int amount = capacity * prodRatio * weatherMod * extRate;
                    if (amount > 0) {
                        createItem(focusTypeStr, amount, bus.local_storage_id, g_world.current_day, "Частное производство");
                        addNews(locStr("engine.news.mined", {{"facility", getFacilityName(bus.facility_type)}, {"amount", std::to_string(amount)}, {"good", getGoodName(focusTypeStr)}, {"eff", std::to_string((int)(prodRatio*100))}}), bus.region_id, 1, "business");
                        bus.addLog(g_world.current_day, locStr("engine.log.mined", {{"amount", std::to_string(amount)}, {"good", getGoodName(focusTypeStr)}, {"eff", std::to_string((int)(prodRatio*100))}}));
                    }
                } else {
                    bus.addLog(g_world.current_day, locStr("engine.log.wrong_product"));
                }
            }
        } else {
            const RecipeDef* activeRecipe = nullptr;
            for (const auto& r : g_db.recipes) {
                if (r.facility == bus.facility_type && r.outputs.count(focusType)) {
                    activeRecipe = &r;
                    break;
                }
            }
            if (!activeRecipe) {
                bus.addLog(g_world.current_day, locStr("engine.log.wrong_product"));
            } else {
                int maxCrafts = capacity * prodRatio * weatherMod;
                bool missing_mats = false;
                std::string missing_mat_name = "";
                for (const auto& in : activeRecipe->inputs) {
                    std::string inStr = in.first;
                    int avail = countItemsInContainer(bus.local_storage_id, inStr);
                    if (in.second > 0) {
                        if (avail < in.second) {
                            missing_mats = true;
                            missing_mat_name = getGoodName(inStr);
                        }
                        maxCrafts = std::min(maxCrafts, avail / in.second);
                    }
                }
                if (missing_mats && maxCrafts == 0) {
                    bus.addLog(g_world.current_day, locStr("engine.log.missing_mats", {{"mat", missing_mat_name}}));
                } else if (maxCrafts > 0) {
                    double curWeight = calculateContainerWeight(bus.local_storage_id);
                    if (curWeight >= g_containers[bus.local_storage_id].max_weight_kg) {
                        bus.addLog(g_world.current_day, locStr("engine.log.storage_full_prod"));
                    } else {
                        for (const auto& in : activeRecipe->inputs) {
                            consumeItemsFromContainer(bus.local_storage_id, in.first, maxCrafts * in.second);
                        }
                        for (const auto& out : activeRecipe->outputs) {
                            std::string outStr = out.first;
                            createItem(outStr, maxCrafts * out.second, bus.local_storage_id, g_world.current_day, "Частное производство");
                            addNews(locStr("engine.news.produced", {{"facility", getFacilityName(bus.facility_type)}, {"amount", std::to_string(maxCrafts * out.second)}, {"good", getGoodName(outStr)}, {"eff", std::to_string((int)(prodRatio*100))}}), bus.region_id, 1, "business");
                            bus.addLog(g_world.current_day, locStr("engine.log.produced", {{"amount", std::to_string(maxCrafts * out.second)}, {"good", getGoodName(outStr)}, {"eff", std::to_string((int)(prodRatio*100))}}));
                        }
                    }
                }
            }
        }
    }
}


// Forward declarations for data-architecture helper layer.
// These helpers are defined later in the file, but production/business systems
// above that section need their declarations for a single-file C++ build.
const ProfessionDef* getProfessionData(const NPC& npc);
std::string getNpcProfessionType(const NPC& npc);
bool npcHasProfessionType(const NPC& npc, const std::vector<std::string>& types);

bool npcHasProfessionType(const NPC& npc, std::initializer_list<const char*> types);
bool npcHasProfessionAbility(const NPC& npc, const std::string& ability);
std::string getNpcToolItemId(const NPC& npc);
bool regionHasFacility(const Region& region, const std::string& facilityId);
double getNpcFacilityRaceModifier(const NPC& npc, const std::string& facilityId);
std::string getLegacyCraftFacilityForProfession(const NPC& npc);
std::vector<std::string> getFacilityCandidateProducts(const std::string& facilityId);
bool facilityIsExtractor(const std::string& facilityId);
const RecipeDef* getPreferredRecipeForFacilityOutput(
    const std::string& facilityId,
    const std::string& preferredOutputId,
    const std::string& requiredOutputTag
);
std::string getPreferredFacilityOutputForRegion(
    const Region& region,
    const std::string& facilityId,
    const std::string& preferredTag,
    const std::vector<std::string>& preferredIds,
    const std::vector<std::string>& preferredTags
);
inline std::string getPreferredFacilityOutputForRegion(
    const Region& region,
    const std::string& facilityId,
    const std::string& preferredTag,
    const std::vector<std::string>& preferredIds
) {
    return getPreferredFacilityOutputForRegion(region, facilityId, preferredTag, preferredIds, {});
}
void upsertNpcMarketOffer(
    Region& region,
    const std::string& sellerId,
    const std::string& goodId,
    int quantity,
    double priceMultiplier
);
inline void upsertNpcMarketOffer(
    Region& region,
    const std::string& sellerId,
    const std::string& goodId,
    int quantity
) {
    upsertNpcMarketOffer(region, sellerId, goodId, quantity, 1.0);
}
bool isInnkeeperFoodItem(const std::string& itemId);
bool isClericSupplyItem(const std::string& itemId);


static bool resolveTransportFromItemData(const std::string& prototypeId, std::string& transport_type, double& speed_mult, int& cargo_bonus, bool& water_only) {
    auto defIt = g_db.items.find(prototypeId);
    const JsonValue* props = nullptr;
    if (defIt != g_db.items.end()) {
        props = &defIt->second.properties;
    }

    const GameplayRuntimeConfig::TransportDescriptor* descriptor = getTransportDescriptor(prototypeId);
    const bool propsDeclareTransport = props && props->has("isTransport") && (*props)["isTransport"].asBool();
    if (!propsDeclareTransport && descriptor == nullptr) return false;

    transport_type = (props && props->has("transport_type"))
        ? (*props)["transport_type"].asString()
        : (descriptor ? descriptor->id : prototypeId);
    speed_mult = (props && props->has("speed_mult"))
        ? (*props)["speed_mult"].asDouble()
        : ((descriptor && descriptor->has_speed_multiplier) ? descriptor->speed_multiplier : 1.0);
    cargo_bonus = (props && props->has("cargo_bonus"))
        ? (*props)["cargo_bonus"].asInt()
        : ((descriptor && descriptor->has_cargo_bonus) ? descriptor->cargo_bonus : 0);
    water_only = (props && props->has("water_only"))
        ? (*props)["water_only"].asBool()
        : ((descriptor && descriptor->has_water_only) ? descriptor->water_only : false);
    return transport_type != "none";
}

void processFarmers() {
    std::vector<NPC*> active_npcs;
    for (auto& [id, npc] : g_world.npcs) {
        if (!npc.isAlive) continue;
        if (npcHasProfessionType(npc, {"farmer", "fisherman"}) ||
            npcHasProfessionAbility(npc, "hunting") ||
            npcHasProfessionAbility(npc, "apiculture")) {
            active_npcs.push_back(&npc);
        }
    }
    std::unordered_map<std::string, std::unique_ptr<std::mutex>> r_locks;
    for (const auto& [rid, r] : g_world.regions) r_locks[rid] = std::make_unique<std::mutex>();

    int num_threads = std::thread::hardware_concurrency();
    if (num_threads == 0) num_threads = 4;
    int chunk_size = active_npcs.size() / num_threads + 1;
    std::vector<std::future<void>> futures;

    for (int t = 0; t < num_threads; ++t) {
        int start_idx = t * chunk_size;
        int end_idx = std::min((int)active_npcs.size(), (t + 1) * chunk_size);
        if (start_idx >= active_npcs.size()) break;

        futures.push_back(getThreadPool()->enqueue([start_idx, end_idx, &active_npcs, &r_locks]() {
            for (int i = start_idx; i < end_idx; ++i) {
                NPC& npc = *active_npcs[i];
                if (!g_world.regions.count(npc.currentLocation)) continue;
                Region& r = g_world.regions[npc.currentLocation];
                std::string contId = npc.economy.storage_id.empty() ? npc.inventory_id : npc.economy.storage_id;
                if (contId.empty()) continue;

                double seasonMod = 1.0;
                if (r.current_season == "spring") seasonMod = 1.2;
                else if (r.current_season == "summer") seasonMod = 1.5;
                else if (r.current_season == "autumn") seasonMod = 2.0;
                else if (r.current_season == "winter") seasonMod = 0.2;
                if (r.weather == "Эфирный шторм") seasonMod = 0.0;
                
                double yield = npc.economy.skillLevel * r.fertility * seasonMod;
                const std::string toolItemId = getNpcToolItemId(npc);
                if (!toolItemId.empty() && countItemsInContainer(contId, toolItemId) > 0) yield *= 1.5;
                int amount = std::max(1, (int)yield);

                std::vector<std::string> goodsToCheck;
                if (npcHasProfessionAbility(npc, "hunting") && regionHasFacility(r, "hunting_lodges")) {
                    const double raceMod = getNpcFacilityRaceModifier(npc, "hunting_lodges");
                    const int scaledAmount = std::max(1, (int)(amount * raceMod));
                    const std::string foodOutput = getPreferredFacilityOutputForRegion(r, "hunting_lodges", "food", {"meat"}, {"meat", "raw_food"});
                    const std::string materialOutput = getPreferredFacilityOutputForRegion(r, "hunting_lodges", "raw_material", {"fur"}, {"animal_product", "raw_material"});
                    const std::string trophyOutput = getPreferredFacilityOutputForRegion(r, "hunting_lodges", "", {"monster_parts"});

                    if (!foodOutput.empty()) {
                        createItem(foodOutput, scaledAmount, contId, g_world.current_day, "Hunt");
                        goodsToCheck.push_back(foodOutput);
                    }
                    if (!materialOutput.empty()) {
                        createItem(materialOutput, std::max(1, scaledAmount / 2), contId, g_world.current_day, "Hunt");
                        goodsToCheck.push_back(materialOutput);
                    }
                    if (!trophyOutput.empty() && trophyOutput != foodOutput && trophyOutput != materialOutput && thread_safe_rand() % 100 < 20) {
                        createItem(trophyOutput, std::max(1, scaledAmount / 10), contId, g_world.current_day, "Hunt");
                        goodsToCheck.push_back(trophyOutput);
                    }
                } else if (npcHasProfessionAbility(npc, "apiculture") && regionHasFacility(r, "apiaries")) {
                    const std::string foodOutput = getPreferredFacilityOutputForRegion(r, "apiaries", "", {"honey"}, {"raw_food", "food"});
                    const std::string materialOutput = getPreferredFacilityOutputForRegion(r, "apiaries", "raw_material", {"wax"}, {"raw_material"});
                    if (!foodOutput.empty()) {
                        createItem(foodOutput, amount, contId, g_world.current_day, "Apiary");
                        goodsToCheck.push_back(foodOutput);
                    }
                    if (!materialOutput.empty()) {
                        createItem(materialOutput, std::max(1, amount / 2), contId, g_world.current_day, "Apiary");
                        goodsToCheck.push_back(materialOutput);
                    }
                } else if (npcHasProfessionAbility(npc, "fishing") && regionHasFacility(r, "fisheries")) {
                    const std::string fishOutput = getPreferredFacilityOutputForRegion(r, "fisheries", "food", {"fish"}, {"seafood", "raw_food"});
                    if (!fishOutput.empty()) {
                        createItem(fishOutput, amount, contId, g_world.current_day, "Fishing");
                        goodsToCheck.push_back(fishOutput);
                    }
                } else if (npcHasProfessionAbility(npc, "farming") && regionHasFacility(r, "farms")) {
                    const std::string cropOutput = getPreferredFacilityOutputForRegion(r, "farms", "food", {"wheat"}, {"crop", "raw_food"});
                    const std::string materialOutput = getPreferredFacilityOutputForRegion(r, "farms", "raw_material", {"cotton"}, {"raw_material"});
                    if (!cropOutput.empty()) {
                        createItem(cropOutput, amount, contId, g_world.current_day, "Harvest");
                        goodsToCheck.push_back(cropOutput);
                    }
                    if (!materialOutput.empty() && thread_safe_rand() % 100 < 30) {
                        createItem(materialOutput, std::max(1, amount / 2), contId, g_world.current_day, "Harvest");
                        goodsToCheck.push_back(materialOutput);
                    }
                }
                std::sort(goodsToCheck.begin(), goodsToCheck.end());
                goodsToCheck.erase(std::unique(goodsToCheck.begin(), goodsToCheck.end()), goodsToCheck.end());
                for (const std::string& gt : goodsToCheck) {
                    int stock = countItemsInContainer(contId, gt);
                    if (stock > 10) {
                        std::lock_guard<std::mutex> lock(*r_locks.at(r.id));
                        upsertNpcMarketOffer(r, npc.id, gt, stock - 5);
                    }
                }
            }
        }));
    }
    for (auto& f : futures) f.get();
}

void processGatherers() {
    std::vector<NPC*> active_npcs;
    for (auto& [id, npc] : g_world.npcs) {
        if (npc.isAlive && (npcHasProfessionType(npc, {"gatherer"}) || npcHasProfessionAbility(npc, "research"))) {
            active_npcs.push_back(&npc);
        }
    }
    std::unordered_map<std::string, std::unique_ptr<std::mutex>> r_locks;
    for (const auto& [rid, r] : g_world.regions) r_locks[rid] = std::make_unique<std::mutex>();

    int num_threads = std::thread::hardware_concurrency();
    if (num_threads == 0) num_threads = 4;
    int chunk_size = active_npcs.size() / num_threads + 1;
    std::vector<std::future<void>> futures;

    for (int t = 0; t < num_threads; ++t) {
        int start_idx = t * chunk_size;
        int end_idx = std::min((int)active_npcs.size(), (t + 1) * chunk_size);
        if (start_idx >= active_npcs.size()) break;

        futures.push_back(getThreadPool()->enqueue([start_idx, end_idx, &active_npcs, &r_locks]() {
            for (int i = start_idx; i < end_idx; ++i) {
                NPC& npc = *active_npcs[i];
                if (!g_world.regions.count(npc.currentLocation)) continue;
                Region& r = g_world.regions[npc.currentLocation];
                std::string contId = npc.economy.storage_id.empty() ? npc.inventory_id : npc.economy.storage_id;
                
                if (npcHasProfessionAbility(npc, "research") && regionHasFacility(r, "observatories")) {
                    if (thread_safe_rand() % 100 < 20) {
                        const std::string outputId = getPreferredFacilityOutputForRegion(r, "observatories", "", {"ether_dust"});
                        if (outputId.empty()) continue;
                        createItem(outputId, 1 + (npc.economy.skillLevel / 3), contId, g_world.current_day, "Observations");
                        int stock = countItemsInContainer(contId, outputId);
                        if (stock > 2) {
                            std::lock_guard<std::mutex> lock(*r_locks.at(r.id));
                            upsertNpcMarketOffer(r, npc.id, outputId, stock - 1, 1.5);
                        }
                    }
                }
            }
        }));
    }
    for (auto& f : futures) f.get();
}

void processArtisans() {
    std::vector<NPC*> active_npcs;
    for (auto& [id, npc] : g_world.npcs) {
        if (npc.isAlive && (npcHasProfessionType(npc, {"artisan"}) || npcHasProfessionAbility(npc, "crafting"))) {
            active_npcs.push_back(&npc);
        }
    }
    std::unordered_map<std::string, std::unique_ptr<std::mutex>> r_locks;
    for (const auto& [rid, r] : g_world.regions) r_locks[rid] = std::make_unique<std::mutex>();

    int num_threads = std::thread::hardware_concurrency();
    if (num_threads == 0) num_threads = 4;
    int chunk_size = active_npcs.size() / num_threads + 1;
    std::vector<std::future<void>> futures;

    for (int t = 0; t < num_threads; ++t) {
        int start_idx = t * chunk_size;
        int end_idx = std::min((int)active_npcs.size(), (t + 1) * chunk_size);
        if (start_idx >= active_npcs.size()) break;

        futures.push_back(getThreadPool()->enqueue([start_idx, end_idx, &active_npcs, &r_locks]() {
            for (int i = start_idx; i < end_idx; ++i) {
                NPC& npc = *active_npcs[i];
                if (!g_world.regions.count(npc.currentLocation)) continue;
                Region& r = g_world.regions[npc.currentLocation];
                std::string contId = npc.economy.storage_id.empty() ? npc.inventory_id : npc.economy.storage_id;
                if (contId.empty()) continue;

                std::string reqFacility = getLegacyCraftFacilityForProfession(npc);
                
                if (reqFacility.empty() || !r.facilities.count(reqFacility) || r.facilities[reqFacility].level <= 0) continue;

                                for (const auto& recipe : g_db.recipes) {
                    if (recipe.facility != reqFacility) continue;

                    bool canCraft = true;
                    int maxCrafts = npc.economy.skillLevel;
                    
                    for (const auto& in : recipe.inputs) {
                        std::string inStr = in.first;
                        int avail = countItemsInContainer(contId, inStr);
                        if (avail < in.second) {
                            canCraft = false;
                            double price = r.markets[inStr];
                            if (price <= 0) {
                                auto it = g_db.items.find(inStr);
                                price = (it != g_db.items.end()) ? it->second.basePrice : 1;
                            }
                            int cost = in.second * price;
                            
                            if (npc.economy.savings >= cost) {
                                std::lock_guard<std::mutex> lock(*r_locks.at(r.id));
                                for (auto it = r.market_square.begin(); it != r.market_square.end(); ++it) {
                                    if (it->good == inStr && it->quantity >= in.second) {
                                        npc.economy.savings -= cost;
                                        {
                                            std::lock_guard<std::mutex> npc_lock(g_npc_state_mutex);
                                            if (g_world.npcs.count(it->seller_id)) g_world.npcs[it->seller_id].economy.savings += cost;
                                        }
                                        it->quantity -= in.second;
                                        createItem(inStr, in.second, contId, g_world.current_day, "Raw material purchase");
                                        canCraft = true;
                                        break;
                                    }
                                }
                            }
                            if (!canCraft) break;
                        }
                        maxCrafts = std::min(maxCrafts, avail / in.second);
                    }
                    
                    if (canCraft && maxCrafts > 0) {
                        double raceMod = getNpcFacilityRaceModifier(npc, recipe.facility);
                        int finalCrafts = std::max(1, (int)(maxCrafts * raceMod));

                        for (const auto& in : recipe.inputs) {
                            std::string inStr = in.first;
                            consumeItemsFromContainer(contId, inStr, maxCrafts * in.second);
                        }
                        for (const auto& out : recipe.outputs) {
                            std::string outStr = out.first;
                            createItem(outStr, finalCrafts * out.second, contId, g_world.current_day, "Crafting");
                            
                            std::lock_guard<std::mutex> lock(*r_locks.at(r.id));
                            int current_stock = countItemsInContainer(contId, outStr);
                            upsertNpcMarketOffer(r, npc.id, outStr, current_stock, 1.5);
                        }
                        break; 
                    }
                }
            }
        }));
    }
    for (auto& f : futures) f.get();
}


// Old processArtisans removed to fix redefinition

void processMages() {
    std::vector<NPC*> active_npcs;
    for (auto& [id, npc] : g_world.npcs) {
        if (npc.isAlive && (npcHasProfessionType(npc, {"mage"}) || npcHasProfessionAbility(npc, "spellcasting"))) {
            active_npcs.push_back(&npc);
        }
    }
    std::unordered_map<std::string, std::unique_ptr<std::mutex>> r_locks;
    for (const auto& [rid, r] : g_world.regions) r_locks[rid] = std::make_unique<std::mutex>();

    int num_threads = std::thread::hardware_concurrency();
    if (num_threads == 0) num_threads = 4;
    int chunk_size = active_npcs.size() / num_threads + 1;
    std::vector<std::future<void>> futures;

    for (int t = 0; t < num_threads; ++t) {
        int start_idx = t * chunk_size;
        int end_idx = std::min((int)active_npcs.size(), (t + 1) * chunk_size);
        if (start_idx >= active_npcs.size()) break;

        futures.push_back(getThreadPool()->enqueue([start_idx, end_idx, &active_npcs, &r_locks]() {
            for (int i = start_idx; i < end_idx; ++i) {
                NPC& npc = *active_npcs[i];
                if (!g_world.regions.count(npc.currentLocation)) continue;
                Region& r = g_world.regions[npc.currentLocation];
                std::string contId = npc.economy.storage_id.empty() ? npc.inventory_id : npc.economy.storage_id;
                if (contId.empty() || !regionHasFacility(r, "alchemists")) continue;

                const RecipeDef* potionRecipe = getPreferredRecipeForFacilityOutput("alchemists", "potions", "");
                if (!potionRecipe) continue;
                
                for (const auto& [inputId, inputQty] : potionRecipe->inputs) {
                    int available = countItemsInContainer(contId, inputId);
                    if (available >= inputQty) continue;

                    std::lock_guard<std::mutex> lock(*r_locks.at(r.id));
                    for (auto it = r.market_square.begin(); it != r.market_square.end(); ++it) {
                        if (it->good == inputId && it->quantity >= inputQty) {
                            double price = r.markets[inputId];
                            if (price <= 0) {
                                auto db_it = g_db.items.find(inputId);
                                price = (db_it != g_db.items.end()) ? db_it->second.basePrice : 1;
                            }
                            int cost = inputQty * price;
                            if (npc.economy.savings >= cost) {
                                npc.economy.savings -= cost;
                                {
                                    std::lock_guard<std::mutex> npc_lock(g_npc_state_mutex);
                                    if (g_world.npcs.count(it->seller_id)) g_world.npcs[it->seller_id].economy.savings += cost;
                                }
                                it->quantity -= inputQty;
                                createItem(inputId, inputQty, contId, g_world.current_day, "Reagent purchase");
                                break;
                            }
                        }
                    }
                }
                
                int maxCrafts = npc.economy.skillLevel;
                for (const auto& [inputId, inputQty] : potionRecipe->inputs) {
                    int available = countItemsInContainer(contId, inputId);
                    if (available < inputQty) {
                        maxCrafts = 0;
                        break;
                    }
                    maxCrafts = std::min(maxCrafts, available / inputQty);
                }

                if (maxCrafts > 0) {
                    const std::string outputId = potionRecipe->outputs.begin()->first;
                    const int outputQty = potionRecipe->outputs.begin()->second;
                    if (!outputId.empty()) {
                        double raceMod = getNpcFacilityRaceModifier(npc, "alchemists");
                        int finalCrafts = std::max(1, (int)(maxCrafts * raceMod));
                        
                        for (const auto& [inputId, inputQty] : potionRecipe->inputs) {
                            consumeItemsFromContainer(contId, inputId, maxCrafts * inputQty);
                        }
                        createItem(outputId, finalCrafts * outputQty, contId, g_world.current_day, "Alchemy");
                        
                        std::lock_guard<std::mutex> lock(*r_locks.at(r.id));
                        int current_stock = countItemsInContainer(contId, outputId);
                        upsertNpcMarketOffer(r, npc.id, outputId, current_stock, 2.0);
                    }
                }
            }
        }));
    }
    for (auto& f : futures) f.get();
}

void processServices() {
    std::vector<NPC*> active_npcs;
    for (auto& [id, npc] : g_world.npcs) {
        if (npc.isAlive && (npcHasProfessionType(npc, {"innkeeper", "cleric"}) ||
            npcHasProfessionAbility(npc, "hospitality") ||
            npcHasProfessionAbility(npc, "religious"))) {
            active_npcs.push_back(&npc);
        }
    }
    std::unordered_map<std::string, std::unique_ptr<std::mutex>> r_locks;
    for (const auto& [rid, r] : g_world.regions) r_locks[rid] = std::make_unique<std::mutex>();

    int num_threads = std::thread::hardware_concurrency();
    if (num_threads == 0) num_threads = 4;
    int chunk_size = active_npcs.size() / num_threads + 1;
    std::vector<std::future<void>> futures;

    for (int t = 0; t < num_threads; ++t) {
        int start_idx = t * chunk_size;
        int end_idx = std::min((int)active_npcs.size(), (t + 1) * chunk_size);
        if (start_idx >= active_npcs.size()) break;

        futures.push_back(getThreadPool()->enqueue([start_idx, end_idx, &active_npcs, &r_locks]() {
            for (int i = start_idx; i < end_idx; ++i) {
                NPC& npc = *active_npcs[i];
                if (!g_world.regions.count(npc.currentLocation)) continue;
                Region& r = g_world.regions[npc.currentLocation];

                if (npcHasProfessionType(npc, {"innkeeper"}) || npcHasProfessionAbility(npc, "hospitality")) {
                    int visitors = 5 + (r.caravans.size() * 2) + (r.population / 1000);
                    int foodNeeded = visitors;
                    int foodBought = 0;
                    
                    std::lock_guard<std::mutex> lock(*r_locks.at(r.id));
                    for (auto it = r.market_square.begin(); it != r.market_square.end(); ) {
                        MarketOffer& offer = *it;
                        if (foodBought >= foodNeeded) break;
                        
                        if (isInnkeeperFoodItem(offer.good)) {
                            int buy_qty = std::min(offer.quantity, foodNeeded - foodBought);
                            int cost = buy_qty * offer.price;
                            
                            if (npc.economy.savings >= cost) {
                                npc.economy.savings -= cost;
                                {
                                    std::lock_guard<std::mutex> npc_lock(g_npc_state_mutex);
                                    if (g_world.npcs.count(offer.seller_id)) {
                                        g_world.npcs[offer.seller_id].economy.savings += cost;
                                        std::string contId = g_world.npcs[offer.seller_id].economy.storage_id.empty() ? g_world.npcs[offer.seller_id].inventory_id : g_world.npcs[offer.seller_id].economy.storage_id;
                                        consumeItemsFromContainer(contId, offer.good, buy_qty);
                                    }
                                }
                                offer.quantity -= buy_qty;
                                foodBought += buy_qty;
                            }
                        }
                        if (offer.quantity <= 0) it = r.market_square.erase(it);
                        else ++it;
                    }
                    int profit = foodBought * 8;
                    npc.economy.savings += profit;
                    
                } else if (npcHasProfessionType(npc, {"cleric"}) || npcHasProfessionAbility(npc, "religious")) {
                    int rituals = 2 + (r.population / 2000);
                    int suppliesBought = 0;
                    
                    std::lock_guard<std::mutex> lock(*r_locks.at(r.id));
                    for (auto it = r.market_square.begin(); it != r.market_square.end(); ) {
                        MarketOffer& offer = *it;
                        if (suppliesBought >= rituals) break;
                        
                        if (isClericSupplyItem(offer.good)) {
                            int buy_qty = std::min(offer.quantity, rituals - suppliesBought);
                            int cost = buy_qty * offer.price;
                            
                            if (npc.economy.savings >= cost) {
                                npc.economy.savings -= cost;
                                {
                                    std::lock_guard<std::mutex> npc_lock(g_npc_state_mutex);
                                    if (g_world.npcs.count(offer.seller_id)) {
                                        g_world.npcs[offer.seller_id].economy.savings += cost;
                                        std::string contId = g_world.npcs[offer.seller_id].economy.storage_id.empty() ? g_world.npcs[offer.seller_id].inventory_id : g_world.npcs[offer.seller_id].economy.storage_id;
                                        consumeItemsFromContainer(contId, offer.good, buy_qty);
                                    }
                                }
                                offer.quantity -= buy_qty;
                                suppliesBought += buy_qty;
                            }
                        }
                        if (offer.quantity <= 0) it = r.market_square.erase(it);
                        else ++it;
                    }
                    int donations = suppliesBought * 15 + (thread_safe_rand() % 10);
                    npc.economy.savings += donations;
                }
            }
        }));
    }
    for (auto& f : futures) f.get();
}

void processDailyEconomy() {
    int month = ((g_world.current_day / 30) % 12) + 1;
    std::string season = "winter";
    if (month >= 3 && month <= 5) season = "spring";
    else if (month >= 6 && month <= 8) season = "summer";
    else if (month >= 9 && month <= 11) season = "autumn";

    std::vector<Region*> active_regions;
    for (auto& [rid, r] : g_world.regions) {
        if (r.population > 0 && r.base_type != "ruins" && r.base_type != "anomaly") {
            active_regions.push_back(&r);
        }
    }

    int num_threads = std::thread::hardware_concurrency();
    if (num_threads == 0) num_threads = 4;
    int chunk_size = active_regions.size() / num_threads + 1;
    std::vector<std::future<void>> futures;

    for (int t = 0; t < num_threads; ++t) {
        int start_idx = t * chunk_size;
        int end_idx = std::min((int)active_regions.size(), (t + 1) * chunk_size);
        if (start_idx >= active_regions.size()) break;

        futures.push_back(getThreadPool()->enqueue([start_idx, end_idx, &active_regions, season]() {
            for (int idx = start_idx; idx < end_idx; ++idx) {
                Region& region = *active_regions[idx];
                std::string rid = region.id;
                
                std::unordered_map<std::string, int> vaultStocks;
                {
                    std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
                    if (!region.vault_id.empty() && g_containers.count(region.vault_id)) {
                        vaultStocks = g_containers[region.vault_id].cached_stocks;
                    }
                }

                int totalFood = getFoodAmount(region.vault_id);
                
                double foodPerCapita = totalFood / (double)std::max(1, region.population);
                
                if (!g_bootstrap && region.population > 20000 && foodPerCapita < 0.5 && (thread_safe_rand() % 100) < 5) {
                    int deaths = region.population * (0.1 + (thread_safe_rand() % 10) / 100.0);
                    region.population = std::max(0, region.population - deaths);
                    addNews(locStr("engine.news.plague_outbreak", {{"region", region.name}, {"deaths", std::to_string(deaths)}}), rid, 5, "disaster");
                }
                
                if (!g_bootstrap && (season == "summer" || region.weather == "Жара") && (thread_safe_rand() % 1000) < 2) {
                    int wheatAmount = vaultStocks[getCoreIdByTag("crop")];
                    int woodAmount = vaultStocks[getCoreIdByTag("wood")];
                    int cw = consumeItemsFromContainer(region.vault_id, getCoreIdByTag("crop"), wheatAmount * 0.8);
                    vaultStocks[getCoreIdByTag("crop")] -= cw;
                    int cwo = consumeItemsFromContainer(region.vault_id, getCoreIdByTag("wood"), woodAmount * 0.7);
                    vaultStocks[getCoreIdByTag("wood")] -= cwo;
                    addNews(locStr("engine.news.drought_struck", {{"region", region.name}}), rid, 4, "disaster");
                }
                
                int totalWorkforce = region.labor_force > 0 ? region.labor_force : (region.population * 0.6);
                int totalJobs = 0;
                for (const auto& [fId, fac] : region.facilities) {
                    totalJobs += fac.level * 100;
                }
                for (const auto& [bId, bus] : g_world.businesses) {
                    if (bus.region_id == rid && bus.is_active) totalJobs += bus.employee_count;
                }
                double employmentRate = totalWorkforce > 0 ? std::min(1.0, (double)totalJobs / totalWorkforce) : 1.0;
                int activeWorkers = totalWorkforce * employmentRate;

                if (!g_bootstrap && employmentRate < 0.15 && (thread_safe_rand() % 100) < 2) {
                    addNews(locStr("engine.news.hunger_riots", {{"region", region.name}}), rid, 4, "disaster");
                    int weaponsAvailable = vaultStocks[getCoreIdByTag("weapon")];
                    int cw = consumeItemsFromContainer(region.vault_id, getCoreIdByTag("weapon"), std::min(100, weaponsAvailable));
                    vaultStocks[getCoreIdByTag("weapon")] -= cw;
                    if (region.facilities.count("forges")) {
                        region.facilities["forges"].durability -= 30;
                        if (region.facilities["forges"].durability < 0) region.facilities["forges"].durability = 0;
                    }
                }

                int numFacilities = std::max(1, (int)region.facilities.size());
                int workersPerSector = activeWorkers / numFacilities;
                
                double weatherMod = (region.weather == "Ясно") ? 1.2 : (region.weather == "Гроза" || region.weather == "Снег" || region.weather == "Метель" || region.weather == "Тропический ливень" || region.weather == "Снегопад") ? 0.5 : 1.0;
                double fert = g_world.homeostasis.fertility;

                for (const auto& gt : g_db.all_item_ids) {
                    if (itemHasTag(gt, "food")) {
                        region.reserveTargets[gt] = static_cast<int>(region.population * 0.005 * getFoodReserveDays(gt));
                    } else if (itemHasTag(gt, "weapon")) {
                        region.reserveTargets[gt] = region.population * 0.1;
                    }
                }

                auto getProdMod = [&](const std::string& gtStr) -> double {
                    double curPrice = region.markets[gtStr];
                    double basePrice = 1.0;
                    auto it = g_db.items.find(gtStr);
                    if (it != g_db.items.end()) basePrice = it->second.basePrice;
                    if (curPrice <= 0) curPrice = basePrice;
                    
                    double targetMod = std::clamp(curPrice / basePrice, 0.1, 1.2);
                    
                    int stock = vaultStocks[gtStr];
                    int reserve = region.reserveTargets[gtStr];
                    if (reserve == 0) reserve = region.population * 0.05;
                    
                    if (stock > reserve * 3) targetMod *= 0.5;
                    if (stock > reserve * 5) targetMod *= 0.2;
                    if (stock < reserve) targetMod = 1.2;
                    
                    double currentMod = region.prodModifiers.count(gtStr) ? region.prodModifiers[gtStr] : 1.0;
                    
                    if (targetMod > currentMod + 0.1) currentMod += 0.1;
                    else if (targetMod < currentMod - 0.1) currentMod -= 0.1;
                    else currentMod = targetMod;
                    
                    region.prodModifiers[gtStr] = currentMod;
                    return currentMod;
                };

                auto getToolEfficiency = [&](const std::string& facName, const std::string& toolType, int workers) -> double {
                    if (toolType.empty()) return 1.0;
                    int toolsAvailable = vaultStocks[toolType];
                    int toolsNeeded = std::max(1, workers / 50);
                    if (toolsAvailable >= toolsNeeded) {
                        int broken = 0;
                        for(int i=0; i<toolsNeeded; ++i) if(thread_safe_rand()%100 < 2) broken++;
                        if (broken > 0) {
                            int cb = consumeItemsFromContainer(region.vault_id, toolType, broken);
                            vaultStocks[toolType] -= cb;
                        }
                        return 1.0;
                    } else {
                        double eff = 0.2 + 0.8 * ((double)toolsAvailable / toolsNeeded);
                        int deficit = toolsNeeded - toolsAvailable;
                        if (!hasPendingOrder(region.vault_id, toolType)) {
                            std::string orderId = createItem("document_order", 1, region.vault_id, g_world.current_day, "Заказ инструментов");
                            std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
                            if (g_items.count(orderId)) {
                                OrderData od;
                                od.issuer_id = rid;
                                od.issuer_name = region.name + " (" + facName + ")";
                                od.item_prototype = toolType;
                                od.quantity = deficit + 5;
                                auto it = g_db.items.find(toolType);
                                od.max_price_per_unit = ((it != g_db.items.end()) ? it->second.basePrice : 1) * 3;
                                od.deadline_days = 21;
                                od.status = "pending";
                                od.created_date = g_world.current_day;
                                g_items[orderId].order_data = od;
                                g_items[orderId].custom_props.set("name", "Заказ: " + toolType);
                            }
                        }
                        return eff;
                    }
                };
                
                for (auto& [fId, fac] : region.facilities) {
                    if (fac.level <= 0) continue;
                    const FacilityTemplate* facTpl = g_facilityRegistry.getTemplate(fId);
                    if (!facTpl) continue;
                    
                    if (facTpl->hasTag("extractor")) {
                        double eff = getToolEfficiency(fId, facTpl->required_tool, workersPerSector);
                        double wMod = 1.0;
                        if (facTpl->weather_modifiers.count(region.weather)) wMod = facTpl->weather_modifiers.at(region.weather);
                        else if (facTpl->weather_modifiers.count(region.current_season)) wMod = facTpl->weather_modifiers.at(region.current_season);
                        
                        double multTypeVal = 1.0;
                        if (facTpl->resource_multiplier_type == "fertility") multTypeVal = fert * region.fertility;
                        else if (facTpl->resource_multiplier_type == "mineral") multTypeVal = region.mineral_wealth;

                        for (const auto& [res, rate] : facTpl->extraction_rates) {
                            if (region.available_raw_resources.count(res)) {
                                double modRes = getProdMod(res);
                                if (res == "wheat" && g_world.nexusData.count("global_harvest_blessing") && g_world.nexusData["global_harvest_blessing"].asInt() > g_world.current_day) modRes *= 1.15;
                                if (res == "gold_ore" && g_world.nexusData.count("global_gold_rush") && g_world.nexusData["global_gold_rush"].asInt() > g_world.current_day) modRes *= 2.0;
                                
                                int amount = workersPerSector * fac.level * rate * wMod * multTypeVal * eff * modRes;
                                
                                if (amount > 0) {
                                    if (res == "wheat" || res == "cotton" || res == "herbs") {
                                        region.planned_harvests.push_back({14, res, amount});
                                    } else {
                                        createItem(res, amount, region.vault_id, g_world.current_day, getFacilityName(fId));
                                        vaultStocks[res] += amount;
                                    }
                                }
                            }
                        }
                    }
                }
                
                for (auto it = region.planned_harvests.begin(); it != region.planned_harvests.end(); ) {
                    it->days_left--;
                    if (it->days_left <= 0) {
                        if (it->amount > 0) {
                            createItem(it->good, it->amount, region.vault_id, g_world.current_day, "Сбор урожая");
                            vaultStocks[it->good] += it->amount;
                        }
                        it = region.planned_harvests.erase(it);
                    } else {
                        ++it;
                    }
                }
                
                for (auto& [fId, fac] : region.facilities) {
                    if (fac.level > 0) {
                        if (thread_safe_rand() % 100 < 20) fac.durability--;
                        if (fac.durability < 0) fac.durability = 0;
                        if (fac.durability < 20) fac.level = std::max(0, (int)(fac.level * 0.5));
                        
                        if (fac.durability < 50) {
                            int woodAvailable = vaultStocks[getCoreIdByTag("building")];
                            if (woodAvailable >= 5) {
                                fac.durability += 20;
                                int cw = consumeItemsFromContainer(region.vault_id, getCoreIdByTag("building"), 5);
                                vaultStocks[getCoreIdByTag("building")] -= cw;
                            }
                        }
                    }
                }

                for (const auto& recipe : g_db.recipes) {
                    if (!region.facilities.count(recipe.facility) || region.facilities[recipe.facility].level <= 0) continue;
                    if (region.productionBlockedDays > 0) continue;
                    int facLevel = region.facilities[recipe.facility].level;
                    int capacity = workersPerSector * (facLevel / 2.0);
                    if (capacity <= 0) continue;
                    
                    const FacilityTemplate* facTpl = g_facilityRegistry.getTemplate(recipe.facility);
                    std::string reqTool = facTpl ? facTpl->required_tool : "";
                    double eff = getToolEfficiency(recipe.facility, reqTool, workersPerSector);
                    double modRecipe = 1.0;
                    if (!recipe.outputs.empty()) {
                        std::string outStr = recipe.outputs.begin()->first;
                        modRecipe = getProdMod(outStr);
                        int maxCrafts = capacity * eff * modRecipe;
                        for (const auto& in : recipe.inputs) {
                            std::string inStr = in.first;
                            int avail = vaultStocks[inStr];
                            if (in.second > 0) {
                                int possible = avail / in.second;
                                if (possible < capacity) {
                                    maxCrafts = std::min(maxCrafts, possible);
                                    int deficit = (capacity * in.second) - avail;
                                    if (deficit > 0 && !hasPendingOrder(region.vault_id, inStr)) {
                                        std::string orderId = createItem("document_order", 1, region.vault_id, g_world.current_day, "Заказ сырья");
                                        std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
                                        if (g_items.count(orderId)) {
                                            OrderData od;
                                            od.issuer_id = rid;
                                            od.issuer_name = region.name + " (" + recipe.facility + ")";
                                            od.item_prototype = inStr;
                                            od.quantity = deficit * 7;
                                            auto it = g_db.items.find(inStr);
                                            od.max_price_per_unit = ((it != g_db.items.end()) ? it->second.basePrice : 1) * 2;
                                            od.deadline_days = 14;
                                            od.status = "pending";
                                            od.created_date = g_world.current_day;
                                            g_items[orderId].order_data = od;
                                            g_items[orderId].custom_props.set("name", "Заказ: " + inStr);
                                        }
                                    }
                                }
                            }
                        }
                        if (maxCrafts > 0) {
                            double currentWeight = calculateContainerWeight(region.vault_id);
                            double weightPerCraft = 0.0;
                            for (const auto& out : recipe.outputs) {
                                std::string outS = out.first;
                                double w = (outS == getCoreIdByTag("currency")) ? 0.01 : 1.0;
                                weightPerCraft += w * out.second;
                            }
                            if (weightPerCraft > 0) {
                                if (currentWeight + (maxCrafts * weightPerCraft) > region.storage_capacity) {
                                    maxCrafts = (region.storage_capacity - currentWeight) / weightPerCraft;
                                }
                            }
                            if (maxCrafts > 0) {
                                for (const auto& in : recipe.inputs) {
                                    std::string inStr = in.first;
                                    int c = consumeItemsFromContainer(region.vault_id, inStr, maxCrafts * in.second);
                                    vaultStocks[inStr] -= c;
                                }
                                for (const auto& out : recipe.outputs) {
                                    std::string outStrFinal = out.first;
                                    createItem(outStrFinal, maxCrafts * out.second, region.vault_id, g_world.current_day, "Производство");
                                    vaultStocks[outStrFinal] += maxCrafts * out.second;
                                }
                            }
                        }
                    }
                }
                
                double baseFoodNeed = region.population * 0.005;
                double elasticFactor = std::clamp(foodPerCapita / 1.0, 0.4, 1.2);
                int reserveFoodTarget = static_cast<int>(region.population * 0.005 * 14);
                if (getFoodAmount(region.vault_id) < reserveFoodTarget) {
                    elasticFactor *= 0.8;
                }
                int foodNeed = (int)(baseFoodNeed * elasticFactor);
                
                int eaten = consumeFood(region.vault_id, foodNeed);
                
                if (eaten < foodNeed) {
                    region.starvation_days++;
                    if (region.starvation_days == 7 && (thread_safe_rand() % 100 < 20)) {
                        addNews(locStr("engine.news.starvation_starts", {{"region", region.name}}), rid, 3, "disaster");
                    }
                } else {
                    region.starvation_days = 0;
                }
                
                double dailyGDP = region.population * (region.average_wage / 100.0) * 0.5;
                region.moneySupply += dailyGDP;

                if (g_world.factions.count(region.factionId)) {
                    int taxRevenue = region.moneySupply * 0.02;
                    region.moneySupply -= taxRevenue;
                    if (taxRevenue > 0) {
                        createItem(getCoreIdByTag("currency"), taxRevenue, region.vault_id, g_world.current_day, "Налоги");
                        vaultStocks[getCoreIdByTag("currency")] += taxRevenue;
                    }
                }
                
                for (const auto& gt : g_db.all_item_ids) {
                    double base = g_db.items[gt].basePrice;
                    int stock = vaultStocks[gt];
                    int reserve = region.reserveTargets[gt];
                    int effective_stock = std::max(1, stock - reserve);
                    double demand = region.population * 0.01;
                    
                    double ratio = demand / (double)effective_stock;
                    
                    double elasticity = 0.65;
                    std::string cat = g_db.items[gt].category;
                    if (cat == "raw_food" || cat == "processed_food" || cat == "consumable") {
                        elasticity = 1.2;
                    } else if (cat == "luxury") {
                        elasticity = 0.3;
                    } else if (cat == "weapon" || cat == "armor") {
                        elasticity = 0.8;
                    }
                    double soft_ratio = std::pow(ratio, elasticity);
                    
                    double raw_price = base * soft_ratio;
                    
                    double avg7d = region.priceHistory[gt].getAvg(7);
                    double final_price = raw_price;
                    if (avg7d > 0.0) {
                        final_price = 0.8 * avg7d + 0.2 * raw_price;
                    }

                    bool hasRuinedRoads = false;
                    for (const auto& road : g_world.map.roads) {
                        if ((road.from == rid || road.to == rid) && road.condition == "ruined") {
                            hasRuinedRoads = true; break;
                        }
                    }
                    if (hasRuinedRoads) final_price *= 1.5;
                    
                    final_price = std::clamp(final_price, base * 0.3, base * 4.0);
                    region.markets[gt] = final_price;
                    region.priceHistory[gt].add(final_price);
                    
                    if ((final_price >= base * 2.0 && final_price < base * 3.0) || (final_price <= base * 0.5 && final_price > base * 0.3)) {
                        if (thread_safe_rand() % 100 < 15) {
                            std::string direction = (final_price > base) ? "up" : "down";
                            addNews(locStr("engine.news.price_" + direction, {{"good", gt}, {"region", region.name}}), rid, 1, "market");
                        }
                    }
                    if (final_price >= base * 3.0 && effective_stock < demand * 0.2 && (thread_safe_rand() % 100 < 3)) {
                        addNews(locStr("engine.news.acute_shortage", {{"good", gt}, {"region", region.name}}), rid, 2, "market");
                    }
                    if (final_price <= base * 0.35 && effective_stock > demand * 10) {
                        if (thread_safe_rand() % 100 < 2) {
                            addNews(locStr("engine.news.overproduction", {{"good", gt}, {"region", region.name}}), rid, 1, "market");
                        }
                    }
                    
                    if (stock > reserve * 10 && reserve > 0) {
                        int excess = stock - (reserve * 10);
                        int consumed = consumeItemsFromContainer(region.vault_id, gt, excess);
                        vaultStocks[gt] -= consumed;
                    }
                }
            }
        }));
    }
    for (auto& f : futures) f.get();
    futures.clear();

    std::vector<NPC*> active_npcs;
    for (auto& [id, npc] : g_world.npcs) if (npc.isAlive) active_npcs.push_back(&npc);
    chunk_size = active_npcs.size() / num_threads + 1;

    for (int t = 0; t < num_threads; ++t) {
        int start_idx = t * chunk_size;
        int end_idx = std::min((int)active_npcs.size(), (t + 1) * chunk_size);
        if (start_idx >= active_npcs.size()) break;

        futures.push_back(getThreadPool()->enqueue([start_idx, end_idx, &active_npcs]() {
            for (int idx = start_idx; idx < end_idx; ++idx) {
                NPC& npc = *active_npcs[idx];
                if (g_world.regions.count(npc.currentLocation)) {
                    Region& r = g_world.regions[npc.currentLocation];
                    if (!npc.economy.isEmployed && (thread_safe_rand() % 100) < 10) npc.economy.isEmployed = true;
                    else if (npc.economy.isEmployed && (thread_safe_rand() % 100) < 2) npc.economy.isEmployed = false;

                    if (npc.economy.isEmployed) {
                        int wage = std::max(1, (int)((r.moneySupply / std::max(1, r.population)) * npc.economy.skillLevel * 0.1));
                        npc.economy.savings += wage;
                    }
                    
                    std::string marketFoodId = getPreferredAvailableFoodId(r.vault_id);
                    int foodPrice = (!marketFoodId.empty() && r.markets.count(marketFoodId)) ? (int)r.markets[marketFoodId] : 5;
                    int availableFood = marketFoodId.empty() ? 0 : countItemsInContainer(r.vault_id, marketFoodId);
                    if (!marketFoodId.empty() && npc.economy.savings >= foodPrice && availableFood > 0) {
                        npc.economy.savings -= foodPrice;
                        consumeItemsFromContainer(r.vault_id, marketFoodId, 1);
                        {
                            std::lock_guard<std::mutex> lock(g_npc_state_mutex);
                            r.moneySupply += foodPrice;
                        }
                        npc.needs.hunger = 100;
                    }
                }
            }
        }));
    }
    for (auto& f : futures) f.get();
}


void processMarkets() {
    std::vector<Region*> active_regions;
    for (auto& [rid, r] : g_world.regions) {
        if (r.population > 0 && r.base_type != "ruins" && r.base_type != "anomaly") {
            active_regions.push_back(&r);
        }
    }

    int num_threads = std::thread::hardware_concurrency();
    if (num_threads == 0) num_threads = 4;
    int chunk_size = active_regions.size() / num_threads + 1;
    std::vector<std::future<void>> futures;

    for (int t = 0; t < num_threads; ++t) {
        int start_idx = t * chunk_size;
        int end_idx = std::min((int)active_regions.size(), (t + 1) * chunk_size);
        if (start_idx >= active_regions.size()) break;

        futures.push_back(getThreadPool()->enqueue([start_idx, end_idx, &active_regions]() {
            for (int idx = start_idx; idx < end_idx; ++idx) {
                Region& r = *active_regions[idx];
                std::string rid = r.id;
                std::map<std::string, int> supply;
                std::map<std::string, int> demand;
                
                for (const auto& gt : g_db.all_item_ids) {
                    double baseDemand = r.population * 0.03;
                    
                    std::string cat = g_db.items[gt].category;
                    if (cat == "consumable" || cat == "raw_food" || cat == "processed_food") {
                        baseDemand = r.population * 0.1;
                    } else if (cat == "luxury" || cat == "potion") {
                        baseDemand = r.population * 0.01;
                    }
                    
                    baseDemand *= getSeasonalDemandMultiplier(gt, r.current_season);
                    
                    demand[gt] = std::max(1, (int)baseDemand); 
                }

                for (const auto& offer : r.market_square) {
                    supply[offer.good] += offer.quantity;
                }

                for (const auto& [gt, sup] : supply) {
                    if (sup > 0) {
                        double base = g_db.items[gt].basePrice;
                        double price = base * ((double)demand[gt] / sup);
                        price = std::clamp(price, base * 0.2, base * 5.0);
                        r.markets[gt] = price;
                    }
                }

                for (auto& [npcId, npc] : g_world.npcs) {
                    if (!npc.isAlive || npc.currentLocation != rid) continue;
                    
                    std::vector<std::string> shoppingList;
                    std::string contId = npc.economy.storage_id.empty() ? npc.inventory_id : npc.economy.storage_id;
                    
                    auto edibleItems = g_itemRegistry.findTemplatesWithTag("food");
                    int totalFoodInInv = 0;
                    for (const auto* item : edibleItems) {
                        totalFoodInInv += countItemsInContainer(contId, item->id);
                    }
                    
                    if (edibleItems.empty()) {
                        std::string f_id = getCoreIdByTag("food");
                        totalFoodInInv = countItemsInContainer(contId, f_id);
                        if (npc.needs.hunger < 50 || totalFoodInInv < npc.economy.reserve_food) shoppingList.push_back(f_id);
                    } else {
                        if (npc.needs.hunger < 50 || totalFoodInInv < npc.economy.reserve_food) {
                            shoppingList.push_back(edibleItems[0]->id);
                        }
                        if (npc.needs.hunger < 30 && edibleItems.size() > 1) {
                            shoppingList.push_back(edibleItems[1]->id);
                        }
                    }
                    
                    // Data-driven: profession tool purchase from g_db.professions
                    {
                        auto profIt = g_db.professions.find(npc.profession);
                        if (profIt != g_db.professions.end() && !profIt->second.tool_tag.empty() && thread_safe_rand() % 100 < profIt->second.tool_chance) {
                            std::string toolId = getCoreIdByTag("tool");
                            if (!toolId.empty()) shoppingList.push_back(toolId);
                        }
                    }
                    
                    if (npc.economy.savings > npc.economy.reserve_gold + g_gameplay_runtime.npc_luxury_spend_threshold) {
                        if (thread_safe_rand() % 100 < 15) shoppingList.push_back(getCoreIdByTag("luxury"));
                    }
                    
                    if (npc.economy.profession_type == "mercenary" || npc.economy.profession_type == "mage") {
                        if (npc.economy.savings > npc.economy.reserve_gold + g_gameplay_runtime.npc_mercenary_medical_threshold && thread_safe_rand() % 100 < 10) shoppingList.push_back(getCoreIdByTag("medical"));
                        if (npc.economy.savings > npc.economy.reserve_gold + g_gameplay_runtime.npc_mercenary_weapon_threshold && thread_safe_rand() % 100 < 2) shoppingList.push_back(getCoreIdByTag("weapon"));
                        if (npc.economy.savings > npc.economy.reserve_gold + g_gameplay_runtime.npc_mercenary_weapon_threshold && thread_safe_rand() % 100 < 2) shoppingList.push_back(getCoreIdByTag("armor"));
                    }
                    
                    if (npc.economy.profession_type == "merchant") {
                        if (npc.economy.savings > npc.economy.reserve_gold + g_gameplay_runtime.npc_merchant_vehicle_threshold &&
                            countItemsInContainer(contId, getCoreIdByTag("vehicle")) < g_gameplay_runtime.npc_merchant_vehicle_max_owned) shoppingList.push_back(getCoreIdByTag("vehicle"));
                    }
                    
                    for (const std::string& neededGood : shoppingList) {
                        for (auto it = r.market_square.begin(); it != r.market_square.end(); ) {
                            MarketOffer& offer = *it;
                            if (offer.good == neededGood && offer.quantity > 0) {
                                double price = r.markets[offer.good];
                                if (price <= 0) {
                                    auto db_it = g_db.items.find(offer.good);
                                    price = (db_it != g_db.items.end()) ? db_it->second.basePrice : 1;
                                }
                                int cost = price;
                                
                                if (npc.economy.savings >= cost) {
                                    std::lock_guard<std::mutex> lock(g_npc_state_mutex);
                                    if (npc.economy.savings >= cost) { 
                                        npc.economy.savings -= cost;
                                        int tax = cost * 0.05;
                                        int net_profit = cost - tax;
                                        r.moneySupply += tax;
                                        
                                        if (g_world.npcs.count(offer.seller_id)) {
                                            NPC& seller = g_world.npcs[offer.seller_id];
                                            seller.economy.savings += net_profit;
                                            std::string sellerCont = seller.economy.storage_id.empty() ? seller.inventory_id : seller.economy.storage_id;
                                            consumeItemsFromContainer(sellerCont, offer.good, 1);
                                        } else if (g_world.businesses.count(offer.seller_id)) {
                                            Business& sellerBus = g_world.businesses[offer.seller_id];
                                            sellerBus.cash_balance += net_profit;
                                            consumeItemsFromContainer(sellerBus.local_storage_id, offer.good, 1);
                                            sellerBus.addLog(g_world.current_day, "🛒 Розничная продажа агенту '" + npc.name + "' (" + offer.good + ", 1 шт.): +" + std::to_string(net_profit) + " з.");
                                        }
                                        
                                        const ItemTemplate* tpl = g_itemRegistry.getTemplate(offer.good);
                                        if (tpl && tpl->hasTag("food")) {
                                            npc.needs.hunger += 40;
                                        } else {
                                            std::string buyerCont = npc.economy.storage_id.empty() ? npc.inventory_id : npc.economy.storage_id;
                                            createItem(offer.good, 1, buyerCont, g_world.current_day, "Market purchase");
                                        }
                                        
                                        offer.quantity -= 1;
                                        demand[offer.good] -= 1;
                                        break;
                                    }
                                }
                            }
                            ++it;
                        }
                    }
                }

                for (auto it = r.market_square.begin(); it != r.market_square.end(); ) {
                    MarketOffer& offer = *it;
                    int buy_qty = std::min(offer.quantity, demand[offer.good]);
                    
                    if (buy_qty > 0 && r.moneySupply > 0) {
                        double price = r.markets[offer.good];
                        if (price <= 0) {
                            auto db_it = g_db.items.find(offer.good);
                            price = (db_it != g_db.items.end()) ? db_it->second.basePrice : 1;
                        }
                        
                        if (r.moneySupply < buy_qty * price) {
                            buy_qty = std::floor(r.moneySupply / price);
                        }
                        
                        int cost = buy_qty * price;
                        
                        if (buy_qty > 0 && r.moneySupply >= cost) {
                            std::lock_guard<std::mutex> lock(g_npc_state_mutex);
                            if (r.moneySupply >= cost) { 
                                r.moneySupply -= cost;
                                int tax = cost * 0.05;
                                int net_profit = cost - tax;
                                r.moneySupply += tax;
                                
                                if (g_world.npcs.count(offer.seller_id)) {
                                    NPC& seller = g_world.npcs[offer.seller_id];
                                    seller.economy.savings += net_profit;
                                    std::string contId = seller.economy.storage_id.empty() ? seller.inventory_id : seller.economy.storage_id;
                                    consumeItemsFromContainer(contId, offer.good, buy_qty);
                                } else if (g_world.businesses.count(offer.seller_id)) {
                                    Business& sellerBus = g_world.businesses[offer.seller_id];
                                    sellerBus.cash_balance += net_profit;
                                    consumeItemsFromContainer(sellerBus.local_storage_id, offer.good, buy_qty);
                                    sellerBus.addLog(g_world.current_day, "📦 Оптовая продажа городу (" + offer.good + ", " + std::to_string(buy_qty) + " шт.): +" + std::to_string(net_profit) + " з.");
                                }
                                offer.quantity -= buy_qty;
                                demand[offer.good] -= buy_qty;
                            }
                        }
                    }
                    
                    if (offer.quantity <= 0) {
                        it = r.market_square.erase(it);
                    } else {
                        ++it;
                    }
                }
            }
        }));
    }
    for (auto& f : futures) f.get();
}

void processDailyMilitary() {
    std::unordered_map<std::string, std::unordered_map<std::string, int>> vaultStocks;
    {
        std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
        for (const auto& [rid, r] : g_world.regions) {
            if (!r.vault_id.empty() && g_containers.count(r.vault_id)) {
                vaultStocks[rid] = g_containers[r.vault_id].cached_stocks;
            } else {
                vaultStocks[rid] = {};
            }
        }
    }

    std::vector<Faction*> active_factions;
    for (auto& [fid, f] : g_world.factions) active_factions.push_back(&f);

    int num_threads = std::thread::hardware_concurrency();
    if (num_threads == 0) num_threads = 4;
    int chunk_size = active_factions.size() / num_threads + 1;
    std::vector<std::future<void>> futures;

    for (int t = 0; t < num_threads; ++t) {
        int start_idx = t * chunk_size;
        int end_idx = std::min((int)active_factions.size(), (t + 1) * chunk_size);
        if (start_idx >= active_factions.size()) break;

        futures.push_back(getThreadPool()->enqueue([start_idx, end_idx, &active_factions, &vaultStocks]() {
            for (int idx = start_idx; idx < end_idx; ++idx) {
                Faction& f = *active_factions[idx];
                std::string fid = f.id;
                
                int globalWeapons = 0;
                int globalFood = 0;
                int totalPopulation = 0;
                int regionCount = 0;
                
                for (const auto& rId : f.regions) {
                    if (g_world.regions.count(rId)) {
                        const Region& r = g_world.regions[rId];
                        globalWeapons += getTaggedAmountFromStocks(vaultStocks[rId], "weapon");
                        globalFood += getTaggedAmountFromStocks(vaultStocks[rId], "food");
                        totalPopulation += r.population;
                        regionCount++;
                    }
                }
                
                std::string capitalRegionId = f.regions.empty() ? "" : f.regions[0];
                if (!capitalRegionId.empty() && g_world.regions.count(capitalRegionId)) {
                    int passiveIncome = regionCount * 500;
                    if (f.warType == DiplomaticState::PEACE) {
                        passiveIncome = regionCount * 1500;
                    }
                    if (passiveIncome > 0) {
                        std::string g_id = getCoreIdByTag("currency");
                        createItem(g_id, passiveIncome, g_world.regions[capitalRegionId].vault_id, g_world.current_day, "Passive income");
                        vaultStocks[capitalRegionId][g_id] += passiveIncome;
                    }
                }
                
                int armyUpkeep = f.armies.size() * 500;
                int stateUpkeep = regionCount * 100;
                int luxuryUpkeep = 200;
                if (f.warType >= DiplomaticState::LIMITED_WAR) {
                    for (const auto& rId : f.regions) {
                        if (g_world.regions.count(rId)) {
                            Region& r = g_world.regions[rId];
                            if (r.stability >= 40) {
                                int recruits = r.population * 0.01;
                                r.population = std::max(0, r.population - recruits);
                                std::string w_id = getCoreIdByTag("weapon");
                                int wAvail = vaultStocks[rId][w_id];
                                int wTaken = wAvail * 0.005;
                                if (wTaken > 0) {
                                    consumeItemsFromContainer(r.vault_id, w_id, wTaken);
                                    vaultStocks[rId][w_id] -= wTaken;
                                }
                            }
                        }
                    }
                }
                

                int goldToRemove = armyUpkeep + stateUpkeep + luxuryUpkeep;
                
                for (const auto& rId : f.regions) {
                    if (goldToRemove <= 0) break;
                    if (g_world.regions.count(rId)) {
                        const Region& r = g_world.regions[rId];
                        std::string g_id = getCoreIdByTag("currency");
                        int regionGold = vaultStocks[rId][g_id];
                        int toRemove = std::min(regionGold, goldToRemove);
                        if (toRemove > 0) {
                            int c = consumeItemsFromContainer(r.vault_id, g_id, toRemove);
                            vaultStocks[rId][g_id] -= c;
                            goldToRemove -= c;
                        }
                    }
                }
                
                if (!capitalRegionId.empty() && g_world.regions.count(capitalRegionId)) {
                    Region& cap = g_world.regions[capitalRegionId];
                    std::string g_id = getCoreIdByTag("currency");
                    std::string w_id = getCoreIdByTag("weapon");
                    std::string l_id = getCoreIdByTag("luxury");
                    int goldAvailable = vaultStocks[capitalRegionId][g_id];
                    
                    if (goldAvailable > 500) {
                        double wPrice = cap.markets[w_id];
                        if (wPrice <= 0) {
                            auto it = g_db.items.find(w_id);
                            wPrice = (it != g_db.items.end()) ? it->second.basePrice : 1;
                        }
                        int wToBuy = (int)(goldAvailable * 0.2 / wPrice);
                        if (wToBuy > 0 && cap.moneySupply >= 0) {
                            consumeItemsFromContainer(cap.vault_id, g_id, wToBuy * wPrice);
                            cap.moneySupply += wToBuy * wPrice;
                            createItem(w_id, wToBuy, cap.vault_id, g_world.current_day, "State purchase");
                            vaultStocks[capitalRegionId][w_id] += wToBuy;
                            goldAvailable -= wToBuy * wPrice;
                        }
                        
                        double lPrice = cap.markets[l_id];
                        if (lPrice <= 0) {
                            auto it = g_db.items.find(l_id);
                            lPrice = (it != g_db.items.end()) ? it->second.basePrice : 1;
                        }
                        int lToBuy = (int)(goldAvailable * 0.1 / lPrice);
                        if (lToBuy > 0) {
                            consumeItemsFromContainer(cap.vault_id, g_id, lToBuy * lPrice);
                            cap.moneySupply += lToBuy * lPrice;
                        }
                    }
                }
                
                if (goldToRemove > 0) {
                    for (const auto& rId : f.regions) {
                        if (goldToRemove <= 0) break;
                        if (g_world.regions.count(rId)) {
                            const Region& r = g_world.regions[rId];
                            std::string w_id = getCoreIdByTag("weapon");
                            int weaponsAvailable = vaultStocks[rId][w_id];
                            int toRemove = std::min(weaponsAvailable, goldToRemove / 10);
                            if (toRemove > 0) {
                                int c = consumeItemsFromContainer(r.vault_id, w_id, toRemove);
                                vaultStocks[rId][w_id] -= c;
                                goldToRemove -= c * 10;
                            }
                        }
                    }
                    if (goldToRemove > 0 && !f.armies.empty()) {
                        for (auto& mutinousArmy : f.armies) {
                            mutinousArmy.morale -= 5;
                            std::string homeRegion = mutinousArmy.location;
                        if (mutinousArmy.morale < 50) {
                            mutinousArmy.size = std::max(0, (int)(mutinousArmy.size * 0.9));
                            if (!homeRegion.empty() && g_world.regions.count(homeRegion)) {
                                g_world.regions[homeRegion].threat_level = std::min(100, g_world.regions[homeRegion].threat_level + 5);
                            }
                            addNews(locStr("engine.news.army_desertion", {{"faction", f.name}}), homeRegion, 3, "war");
                        }
                        if (mutinousArmy.morale < 20) {
                            for (const auto& rId : f.regions) {
                                if (g_world.regions.count(rId)) {
                                    int weaponsAvailable = vaultStocks[rId][getCoreIdByTag("weapon")];
                                    int toRemove = std::min(weaponsAvailable, goldToRemove / 10);
                                    if (toRemove > 0) {
                                        consumeItemsFromContainer(g_world.regions[rId].vault_id, getCoreIdByTag("weapon"), toRemove);
                                        vaultStocks[rId][getCoreIdByTag("weapon")] -= toRemove;
                                        goldToRemove -= toRemove * 10;
                                        if (goldToRemove <= 0) break;
                                    }
                                }
                            }
                        }
                        }
                    }
                }
                
                double foodPerCapita = globalFood / (double)std::max(1, totalPopulation);
                if (foodPerCapita < 0.5) {
                    for (const auto& rId : f.regions) {
                        if (g_world.regions.count(rId)) {
                            Region& r = g_world.regions[rId];
                            int deaths = r.population * 0.01;
                            r.population = std::max(0, r.population - deaths);
                            r.threat_level = std::min(100, r.threat_level + 10);
                            if ((thread_safe_rand() % 100) < 10) {
                                addNews(locStr("engine.news.hunger_riot", {{"region", r.name}}), rId, 4, "disaster");
                            }
                        }
                    }
                }
            }
        }));
    }
    for (auto& f : futures) f.get();
    futures.clear();

    for (auto& [fid, faction] : g_world.factions) {
        std::vector<std::string> available_warships;
        for (auto& s : g_world.ships) {
            if (s.owner_id == fid && s.fleet_id.empty() && (s.type == ShipType::WAR_GALLEY || s.type == ShipType::WAR_FRIGATE)) {
                available_warships.push_back(s.id);
            }
        }
        if (available_warships.size() >= 2) {
            Fleet fl;
            fl.id = "fleet_" + generateUUID();
            fl.owner_id = fid;
            fl.ship_ids = available_warships;
            for (auto& [nid, npc] : g_world.npcs) {
                if (npc.isAlive && npc.factionId == fid && npcHasProfessionType(npc, {"admiral", "sailor"})) {
                    fl.admiral_id = nid; break;
                }
            }
            std::string targetPort = "";
            for (const auto& [enemyId, state] : faction.diplomacy) {
                if (state == "war" && g_world.factions.count(enemyId)) {
                    for (const auto& erid : g_world.factions[enemyId].regions) {
                        if (g_world.port_facilities.count(erid)) { targetPort = erid; break; }
                    }
                }
                if (!targetPort.empty()) break;
            }
            for (auto& s : g_world.ships) {
                if (s.id == available_warships[0]) { fl.x = s.x; fl.y = s.y; break; }
            }
            if (!targetPort.empty()) {
                fl.destination = targetPort;
                fl.mission = "blockade";
                std::string startRegion = "";
                for (const auto& [rid, loc] : g_world.map.locations) {
                    if (std::abs(loc.x - fl.x) <= 2 && std::abs(loc.y - fl.y) <= 2) { startRegion = rid; break; }
                }
                if (!startRegion.empty() && g_world.map.locations.count(targetPort)) {
                    auto loc1 = g_world.map.locations[startRegion];
                    auto loc2 = g_world.map.locations[targetPort];
                    std::vector<bool> dummy_has_road(g_world.map.width * g_world.map.height, false);
                    std::vector<int> dummy_path_status(g_world.map.width * g_world.map.height, 0);
                    fl.path = findPath(g_world.map, loc1.x, loc1.y, loc2.x, loc2.y, dummy_has_road, dummy_path_status, MovementType::WATER, 10);
                }
                addNews(locStr("engine.news.fleet_formed", {{"faction", faction.name}, {"dest", g_world.regions[targetPort].name}}), targetPort, 5, "war");
            } else {
                fl.mission = "patrol";
            }
            for (auto& s : g_world.ships) {
                if (std::find(available_warships.begin(), available_warships.end(), s.id) != available_warships.end()) {
                    s.fleet_id = fl.id;
                }
            }
            g_world.fleets.push_back(fl);
        }
    }

    std::vector<bool> has_road(g_world.map.width * g_world.map.height, false);
    std::vector<int> path_status(g_world.map.width * g_world.map.height, 0);
    for (const auto& road : g_world.map.roads) {
        if (road.condition == "blocked") {
            for (const auto& wp : road.waypoints) path_status[wp.second * g_world.map.width + wp.first] = 2;
        } else if (road.condition == "ruined") {
            for (const auto& wp : road.waypoints) {
                path_status[wp.second * g_world.map.width + wp.first] = 1;
                has_road[wp.second * g_world.map.width + wp.first] = true;
            }
        } else {
            for (const auto& wp : road.waypoints) has_road[wp.second * g_world.map.width + wp.first] = true;
        }
    }

    for (auto& [fid, faction] : g_world.factions) {
        for (int i = faction.armies.size() - 1; i >= 0; i--) {
            Army& a = faction.armies[i];

            if (!a.embarked_ship_id.empty()) {
                bool ship_exists = false;
                for (auto& s : g_world.ships) {
                    if (s.id == a.embarked_ship_id) {
                        a.x = s.x; a.y = s.y;
                        ship_exists = true;
                        if (s.path.empty() && s.destination == a.destination) {
                            a.embarked_ship_id = "";
                            a.location = a.destination;
                            addNews(locStr("engine.news.naval_invasion", {{"faction", faction.name}, {"dest", g_world.regions[a.destination].name}}), a.destination, 4, "war");
                        }
                        break;
                    }
                }
                if (!ship_exists) {
                    a.morale = 0;
                }
                continue;
            }

            if (!a.supply_chest_id.empty() && g_containers.count(a.supply_chest_id)) {
                int dailyNeed = std::max(1, (int)(a.size * 0.02)); 
                int consumed = consumeCategory(a.supply_chest_id, "food", dailyNeed, "army_supply_priority");
                
                if (consumed < dailyNeed && !a.location.empty() && g_world.regions.count(a.location)) {
                    Region& r = g_world.regions[a.location];
                    if (r.factionId != fid && r.threat_level < 100) {
                        int forageAmount = std::min(dailyNeed - consumed, (int)(r.population * 0.01));
                        if (forageAmount > 0) {
                            int fTaken = consumeFood(r.vault_id, forageAmount);
                            consumed += fTaken;
                            r.threat_level = std::min(100, r.threat_level + 2);
                        }
                    }
                }

                if (consumed < dailyNeed) {
                    a.morale -= 5;
                } else {
                    a.morale = std::min(100, a.morale + 1);
                }
            } else {
                a.morale -= 5;
            }

            if (a.morale < 20 && a.morale > 0) {
                int deserters = std::max(1, (int)(a.size * 0.02));
                a.size -= deserters;
                if (!a.location.empty() && g_world.regions.count(a.location)) {
                    g_world.regions[a.location].population += deserters;
                }
            } else if (a.morale <= 0) {
                addNews(locStr("engine.news.army_starved", {{"faction", faction.name}}), a.location, 4, "war");
                if (!a.location.empty() && g_world.regions.count(a.location)) {
                    g_world.regions[a.location].population += a.size;
                }
                faction.armies.erase(faction.armies.begin() + i);
                continue;
            }

            if (!a.path.empty() && a.path_index < (int)a.path.size() - 1) {
                double speed = 3.0;
                while (speed > 0 && a.path_index < (int)a.path.size() - 1) {
                    double target_x = a.path[a.path_index + 1].first;
                    double target_y = a.path[a.path_index + 1].second;
                    
                    int tx = (int)target_x, ty = (int)target_y;
                    if (tx < 0 || tx >= g_world.map.width || ty < 0 || ty >= g_world.map.height) break;
                    int nIdx = ty * g_world.map.width + tx;
                    bool is_goal = false;
                    if (g_world.map.locations.count(a.destination)) {
                        auto destLoc = g_world.map.locations.at(a.destination);
                        is_goal = (tx == destLoc.x && ty == destLoc.y);
                    }
                    
                    if (path_status[nIdx] == 1) speed /= 3.0;

                    uint8_t b_id = g_world.map.grid[nIdx].biome_id;
                    std::string b_str = getBiomeStringId(b_id);
                    bool is_water = (b_str == "ocean" || b_str == "shallow_water" || b_str == "lake" || b_str == "river");
                    bool has_bridge = g_world.map.grid[nIdx].bridge_flag;
                    
                    if (is_water && !has_bridge) {
                        bool boarded = false;
                        for (auto& s : g_world.ships) {
                            if (s.owner_id == fid && (s.type == ShipType::TRANSPORT || s.type == ShipType::WAR_GALLEY || s.type == ShipType::WAR_FRIGATE)) {
                                if (std::hypot(s.x - a.x, s.y - a.y) <= 3.0) {
                                    a.embarked_ship_id = s.id;
                                    s.destination = a.destination;
                                    auto loc1 = g_world.map.locations[a.location];
                                    auto loc2 = g_world.map.locations[a.destination];
                                    std::vector<bool> dummy_has_road(g_world.map.width * g_world.map.height, false);
                                    std::vector<int> dummy_path_status(g_world.map.width * g_world.map.height, 0);
                                    auto sea_path = findPath(g_world.map, loc1.x, loc1.y, loc2.x, loc2.y, dummy_has_road, dummy_path_status, MovementType::WATER, 10);
                                    if (!sea_path.empty()) {
                                        s.path = sea_path;
                                        s.path_index = 0;
                                    }
                                    addNews(locStr("engine.news.army_embarked", {{"faction", faction.name}, {"dest", g_world.regions[a.destination].name}}), a.location, 3, "war");
                                    boarded = true;
                                    break;
                                }
                            }
                        }
                        if (!boarded) {
                            speed = 0;
                            if (g_world.port_facilities.count(a.location) && g_world.port_facilities[a.location].has_shipyard) {
                                bool already_building = false;
                                for (const auto& bq : g_world.port_facilities[a.location].build_queue) {
                                    if (bq.owner_id == fid && bq.type == ShipType::TRANSPORT) already_building = true;
                                }
                                if (!already_building) {
                                    std::string capId = faction.regions.empty() ? "" : faction.regions[0];
                                    if (!capId.empty() && g_world.regions.count(capId)) {
                                        int boards = countItemsInContainer(g_world.regions[capId].vault_id, getCoreIdByTag("building"));
                                        int cloth = countItemsInContainer(g_world.regions[capId].vault_id, getCoreIdByTag("cloth"));
                                        if (boards >= 500 && cloth >= 50) {
                                            consumeItemsFromContainer(g_world.regions[capId].vault_id, getCoreIdByTag("building"), 500);
                                            consumeItemsFromContainer(g_world.regions[capId].vault_id, getCoreIdByTag("cloth"), 50);
                                            ShipBuildOrder order;
                                            order.id = "build_" + generateUUID();
                                            order.type = ShipType::TRANSPORT;
                                            order.days_left = 10;
                                            order.owner_id = fid;
                                            g_world.port_facilities[a.location].build_queue.push_back(order);
                                            addNews(locStr("engine.news.military_ship_order", {{"faction", faction.name}}), a.location, 2, "war");
                                        }
                                    }
                                }
                            }
                            break;
                        }
                    }
                    if (path_status[nIdx] == 2 || (!has_road[nIdx] && !is_goal)) {
                        int goalX = 0, goalY = 0;
                        if (g_world.map.locations.count(a.destination)) {
                            goalX = g_world.map.locations.at(a.destination).x;
                            goalY = g_world.map.locations.at(a.destination).y;
                        }
                        auto new_path = findPath(g_world.map, a.x, a.y, goalX, goalY, has_road, path_status, MovementType::LAND, a.size);
                        if (new_path.empty()) {
                            new_path = findPath(g_world.map, a.x, a.y, goalX, goalY, has_road, path_status, MovementType::ANY, a.size);
                            if (!new_path.empty()) {
                                MapRoad bypass;
                                bypass.from = "bypass_" + generateUUID();
                                bypass.to = a.destination;
                                bypass.condition = "dirt";
                                bypass.waypoints = new_path;
                                g_world.map.roads.push_back(bypass);
                                g_path_cache_dirty = true;
                                for (const auto& wp : new_path) has_road[wp.second * g_world.map.width + wp.first] = true;
                                addNews(locStr("engine.news.military_road_built", {{"faction", faction.name}, {"dest", a.destination}}), a.location, 2, "war");
                            }
                        }
                        if (new_path.empty()) {
                            addNews(locStr("engine.news.army_lost", {{"faction", faction.name}}), a.location, 4, "war");
                            faction.armies.erase(faction.armies.begin() + i);
                            break;
                        } else {
                            a.path = new_path;
                            a.path_index = 0;
                            target_x = a.path[1].first;
                            target_y = a.path[1].second;
                        }
                    }
                    
                    double dx = target_x - a.x;
                    double dy = target_y - a.y;
                    double dist = std::hypot(dx, dy);
                    if (dist <= speed) {
                        a.x = target_x;
                        a.y = target_y;
                        speed -= dist;
                        a.path_index++;
                    } else {
                        a.x += (dx / dist) * speed;
                        a.y += (dy / dist) * speed;
                        speed = 0;
                    }
                }
                continue;
            }
            std::string targetLoc = a.destination;
            bool armySurvived = true;
            bool isCombatActive = false;

            std::string enemyFactionId = "";
            int defArmyIndex = -1;
            for (auto& [eId, eFaction] : g_world.factions) {
                if (eId != fid && faction.diplomacy[eId] == "war") {
                    for (size_t j = 0; j < eFaction.armies.size(); j++) {
                        if (eFaction.armies[j].destination == targetLoc || eFaction.armies[j].location == targetLoc) {
                            enemyFactionId = eId;
                            defArmyIndex = j;
                            break;
                        }
                    }
                }
                if (!enemyFactionId.empty()) break;
            }

            if (!enemyFactionId.empty()) {
                isCombatActive = true;
                Faction& defender = g_world.factions[enemyFactionId];
                Army& defArmy = defender.armies[defArmyIndex];

                auto assignGeneral = [&](Army& army, const std::string& fId) {
                    if (army.general_id.empty()) {
                        for (auto& [nid, npc] : g_world.npcs) {
                            if (npc.isAlive && npc.factionId == fId && (npc.type == "ruler" || npcHasProfessionType(npc, {"general", "commander"}))) {
                                army.general_id = nid; break;
                            }
                        }
                    }
                };
                assignGeneral(a, fid);
                assignGeneral(defArmy, enemyFactionId);

                std::string locName = g_world.regions.count(targetLoc) ? g_world.regions[targetLoc].name : targetLoc;

                if (a.current_phase == "march" || a.current_phase == "") {
                    a.current_phase = "vanguard_clash";
                    defArmy.current_phase = "vanguard_clash";
                    addNews(locStr("engine.news.vanguard_clash", {{"faction1", faction.name}, {"faction2", defender.name}, {"loc", locName}}), targetLoc, 3, "war");
                } else if (a.current_phase == "vanguard_clash") {
                    a.size -= a.size * 0.05;
                    defArmy.size -= defArmy.size * 0.05;
                    a.current_phase = "main_battle";
                    defArmy.current_phase = "main_battle";
                    addNews(locStr("engine.news.main_battle", {{"faction1", faction.name}, {"faction2", defender.name}, {"loc", locName}}), targetLoc, 4, "war");
                } else if (a.current_phase == "main_battle") {
                    double atkPower = a.size * (a.morale / 100.0) * ((thread_safe_rand() % 50) / 100.0 + 0.8);
                    double defPower = defArmy.size * (defArmy.morale / 100.0) * ((thread_safe_rand() % 50) / 100.0 + 1.0);

                    auto applyDisasterPenalty = [&](const std::string& fId, double& power, std::string& causeText, std::string& causalLink) {
                        std::string dayKey = fId + "_last_disaster_day";
                        if (g_world.nexusData.count(dayKey)) {
                            int dDay = g_world.nexusData[dayKey].asInt();
                            if (g_world.current_day - dDay <= 14) {
                                power *= 0.7;
                                causeText = locStr("engine.news.weakened_by_disaster", {{"type", g_world.nexusData[fId + "_last_disaster_type"].asString()}});
                                causalLink = g_world.nexusData[fId + "_last_disaster_news"].asString();
                            }
                        }
                    };

                    std::string atkCause, defCause, atkLink, defLink;
                    applyDisasterPenalty(fid, atkPower, atkCause, atkLink);
                    applyDisasterPenalty(enemyFactionId, defPower, defCause, defLink);

                    auto applyWound = [&](const std::string& genId) {
                        if (genId.empty() || !g_world.npcs.count(genId)) return;
                        NPC& gen = g_world.npcs[genId];
                        if (gen.isAlive && (thread_safe_rand() % 100) < 15) {
                            gen.hp -= (10 + thread_safe_rand() % 20);
                            if (gen.hp > 0) {
                                std::vector<std::string> wTypes = {"глубокая рана", "сломанная рука", "шрам"};
                                Wound w;
                                w.type = wTypes[thread_safe_rand() % wTypes.size()];
                                w.severity = 3 + thread_safe_rand() % 5;
                                w.day_received = g_world.current_day;
                                gen.wounds.push_back(w);
                                addNews(locStr("engine.news.general_wounded", {{"general", gen.name}, {"wound", w.type}}), targetLoc, 4, "war");
                            }
                        }
                    };
                    applyWound(a.general_id);
                    applyWound(defArmy.general_id);

                    if (atkPower > defPower) {
                        int casualties = std::max(1, (int)(defArmy.size * 0.6));
                        a.size -= std::max(1, (int)(a.size * 0.15));
                        std::string newsText = locStr("engine.news.army_routed", {{"atkCause", atkCause}, {"faction", faction.name}, {"defCause", defCause}, {"defender", defender.name}, {"loc", locName}, {"casualties", std::to_string(casualties)}});
                        addNews(newsText, targetLoc, 5, "war", !defLink.empty() ? defLink : atkLink);
                        defender.armies.erase(defender.armies.begin() + defArmyIndex);
                        isCombatActive = false;
                        a.current_phase = "march";
                        defender.warExhaustion += 10;
                        if (a.size < 10) {
                            addNews(locStr("engine.news.army_remnants_fled", {{"faction", faction.name}, {"loc", locName}}), targetLoc, 3, "war");
                            faction.armies.erase(faction.armies.begin() + i);
                            armySurvived = false;
                        }
                    } else {
                        int casualties = std::max(1, (int)(a.size * 0.6));
                        defArmy.size -= std::max(1, (int)(defArmy.size * 0.15));
                        std::string newsText = locStr("engine.news.army_defended", {{"defCause", defCause}, {"defender", defender.name}, {"atkCause", atkCause}, {"faction", faction.name}, {"loc", locName}, {"casualties", std::to_string(casualties)}});
                        addNews(newsText, targetLoc, 5, "war", !atkLink.empty() ? atkLink : defLink);
                        faction.armies.erase(faction.armies.begin() + i);
                        armySurvived = false;
                        defArmy.current_phase = "march";
                        faction.warExhaustion += 10;
                        if (defArmy.size < 10) {
                            addNews(locStr("engine.news.army_remnants_fled", {{"faction", defender.name}, {"loc", locName}}), targetLoc, 3, "war");
                            defender.armies.erase(defender.armies.begin() + defArmyIndex);
                        }
                    }
                }
            } else if (g_world.regions.count(targetLoc)) {
                Region& targetRegion = g_world.regions[targetLoc];
                if (faction.diplomacy[targetRegion.factionId] == "war") {
                    isCombatActive = true;
                    if (a.siegeDays == -1) {
                        a.siegeDays = 3 + thread_safe_rand() % 4;
                        addNews(locStr("engine.news.siege_started", {{"faction", faction.name}, {"region", targetRegion.name}}), targetLoc, 4, "war");
                    } else if (a.siegeDays > 0) {
                        a.siegeDays--;
                        
                        if ((thread_safe_rand() % 100) < 10) {
                            for (auto& road : g_world.map.roads) {
                                if (road.type == "bridge" && (road.from == targetLoc || road.to == targetLoc)) {
                                    road.condition = "ruined";
                                    road.integrity = 0;
                                    g_path_cache_dirty = true;
                                }
                            }
                        }

                        int cityBread = vaultStocks[targetLoc][getCoreIdByTag("food")];
                        if (cityBread > 0) {
                            int forage = std::min((int)(a.size * 0.2), cityBread / 10);
                            consumeItemsFromContainer(targetRegion.vault_id, getCoreIdByTag("food"), forage);
                            vaultStocks[targetLoc][getCoreIdByTag("food")] -= forage;
                            if (!a.supply_chest_id.empty()) {
                                createItem(getCoreIdByTag("food"), forage, a.supply_chest_id, g_world.current_day, "Фуражировка");
                            }
                        }
                        
                        if (armySurvived) {
                            std::string enemyCapital = g_world.factions[targetRegion.factionId].regions.empty() ? "" : g_world.factions[targetRegion.factionId].regions[0];
                            if (targetLoc == enemyCapital) {
                                targetRegion.population = std::max(0, (int)(targetRegion.population * 0.98));
                                int w = vaultStocks[targetLoc][getCoreIdByTag("weapon")];
                                int f1 = vaultStocks[targetLoc][getCoreIdByTag("food")];
                                int wLost = w * 0.05; int f1Lost = f1 * 0.05;
                                consumeItemsFromContainer(targetRegion.vault_id, getCoreIdByTag("weapon"), wLost);
                                consumeItemsFromContainer(targetRegion.vault_id, getCoreIdByTag("food"), f1Lost);
                                vaultStocks[targetLoc][getCoreIdByTag("weapon")] -= wLost;
                                vaultStocks[targetLoc][getCoreIdByTag("food")] -= f1Lost;
                            } else {
                                targetRegion.population = std::max(0, targetRegion.population - (thread_safe_rand() % 200));
                            }
                            int cityBread = vaultStocks[targetLoc][getCoreIdByTag("food")];
                            if (cityBread > 0) {
                                int c = consumeItemsFromContainer(targetRegion.vault_id, getCoreIdByTag("food"), cityBread * 0.2);
                                vaultStocks[targetLoc][getCoreIdByTag("food")] -= c;
                            }
                            if (targetRegion.facilities.count("farms")) {
                                targetRegion.facilities["farms"].durability -= 10;
                                if (targetRegion.facilities["farms"].durability < 0) targetRegion.facilities["farms"].durability = 0;
                            }
                        }
                    } else if (a.siegeDays == 0) {
                        int garrisonPower = targetRegion.population / 100;
                        if (a.size > garrisonPower) {
                            std::string oldFactionId = targetRegion.factionId;
                            
                            if (targetRegion.isOccupied && targetRegion.factionId == fid) {
                                targetRegion.isOccupied = false;
                                targetRegion.occupierFactionId = "";
                                targetRegion.daysUnderOccupation = 0;
                                addNews(locStr("engine.news.liberation", {{"faction", faction.name}, {"region", targetRegion.name}}), targetLoc, 5, "war");
                            } else {
                                targetRegion.isOccupied = true;
                                targetRegion.occupierFactionId = fid;
                                targetRegion.daysUnderOccupation = 0;
                                addNews(locStr("engine.news.occupation", {{"region", targetRegion.name}, {"faction", faction.name}}), targetLoc, 5, "war");
                                
                                if (faction.warType == DiplomaticState::LIMITED_WAR && faction.activeWarGoal.targetRegionId == targetLoc) {
                                    faction.activeWarGoal.achieved = true;
                                    faction.warType = DiplomaticState::PEACE;
                                    faction.warExhaustion = 0;
                                    targetRegion.factionId = fid;
                                    targetRegion.isOccupied = false;
                                    if (g_world.factions.count(oldFactionId)) {
                                        auto& oldRegs = g_world.factions[oldFactionId].regions;
                                        oldRegs.erase(std::remove(oldRegs.begin(), oldRegs.end(), targetLoc), oldRegs.end());
                                    }
                                    faction.regions.push_back(targetLoc);
                                    addNews(locStr("engine.news.annexation", {{"faction", faction.name}, {"region", targetRegion.name}}), "global", 5, "diplomacy");
                                    for (auto& [otherId, state] : faction.diplomacy) {
                                        if (state == "war") {
                                            faction.diplomacy[otherId] = "neutral";
                                            faction.truceUntil[otherId] = g_world.current_day + 360;
                                            if (g_world.factions.count(otherId)) {
                                                g_world.factions[otherId].diplomacy[fid] = "neutral";
                                                g_world.factions[otherId].truceUntil[fid] = g_world.current_day + 360;
                                            }
                                        }
                                    }
                                }
                                
                                std::string enemyCapital = g_world.factions[oldFactionId].regions.empty() ? "" : g_world.factions[oldFactionId].regions[0];
                                if (targetLoc == enemyCapital && faction.warType != DiplomaticState::PEACE) {
                                    addNews(locStr("engine.news.capital_fallen", {{"region", targetRegion.name}, {"oldFaction", g_world.factions[oldFactionId].name}, {"newFaction", faction.name}}), "global", 5, "war");
                                    for (const auto& rId : g_world.factions[oldFactionId].regions) {
                                        if (g_world.regions.count(rId)) {
                                            g_world.regions[rId].factionId = fid;
                                            g_world.regions[rId].isOccupied = false;
                                            faction.regions.push_back(rId);
                                        }
                                    }
                                    g_world.factions[oldFactionId].regions.clear();
                                    g_world.factions[oldFactionId].warType = DiplomaticState::PEACE;
                                    faction.warType = DiplomaticState::PEACE;
                                    faction.warExhaustion = 0;
                                    for (auto& [otherId, state] : faction.diplomacy) {
                                        if (state == "war") {
                                            faction.diplomacy[otherId] = "neutral";
                                            faction.truceUntil[otherId] = g_world.current_day + 360;
                                            if (g_world.factions.count(otherId)) {
                                                g_world.factions[otherId].diplomacy[fid] = "neutral";
                                                g_world.factions[otherId].truceUntil[fid] = g_world.current_day + 360;
                                            }
                                        }
                                    }
                                }
                            }
                            
                            targetRegion.moneySupply *= 0.5;
                            isCombatActive = false;
                        } else {
                            addNews(locStr("engine.news.siege_lifted", {{"region", targetRegion.name}, {"faction", faction.name}}), targetLoc, 5, "war");
                            faction.armies.erase(faction.armies.begin() + i);
                            armySurvived = false;
                        }
                    }
                }
            }
            
            if (armySurvived && !isCombatActive && i < faction.armies.size()) {
                if (faction.armies[i].size < 10) {
                    faction.armies.erase(faction.armies.begin() + i);
                    continue;
                }
                std::string homeRegionId = faction.armies[i].location;
                if (!homeRegionId.empty() && g_world.regions.count(homeRegionId)) {
                    Region& homeRegion = g_world.regions[homeRegionId];
                    
                    int survivors = faction.armies[i].size;
                    if (survivors > 0) {
                        homeRegion.population += survivors;
                        double addedPerYear = (double)survivors / 23.0;
                        for(int p = 18; p <= 40; p++) homeRegion.age_pyramid[p] += addedPerYear;
                    }

                    int returnedWeapons = faction.armies[i].size * 0.8;
                    if (returnedWeapons > 0) {
                        std::string w_id = getCoreIdByTag("weapon");
                        createItem(w_id, returnedWeapons, homeRegion.vault_id, g_world.current_day, "Army return");
                        vaultStocks[homeRegionId][w_id] += returnedWeapons;
                    }
                }
                faction.armies.erase(faction.armies.begin() + i);
            }
        }
    }
}


std::string getSubContainer(const std::string& parentId, const std::string& type) {
    for (size_t i=0; i<g_containers.data.size(); ++i) {
        if (!g_containers.active[i]) continue;
        const Storage& cont = g_containers.data[i];
        if (cont.type == type && cont.location.has("parent_container") && cont.location["parent_container"].asString() == parentId) {
            return cont.id;
        }
    }
    return "";
}

void processMonthlyDemographics() {
    for (auto& [rid, r] : g_world.regions) {
        if (r.age_pyramid.empty() || r.age_pyramid.size() < 121) {
            r.age_pyramid.assign(121, 0.0);
            double children = r.population * 0.20;
            double workers = r.population * 0.60;
            double elders = r.population * 0.20;
            for(int i=0; i<=17; i++) r.age_pyramid[i] = children / 18.0;
            for(int i=18; i<=65; i++) r.age_pyramid[i] = workers / 48.0;
            for(int i=66; i<=120; i++) r.age_pyramid[i] = elders / 55.0;
        }

        int food = getFoodAmount(r.vault_id);
        double food_per_capita = food / (double)std::max(1, r.population);

        double famine_mult = 1.0;
        if (food_per_capita < 0.5) famine_mult += (0.5 - food_per_capita) * 2.0;

        auto get_mortality = [](int age) -> double {
            if (age == 0) return 0.02 / 12.0;
            if (age <= 4) return 0.005 / 12.0;
            if (age <= 14) return 0.002 / 12.0;
            if (age <= 49) return 0.003 / 12.0;
            if (age <= 64) return 0.01 / 12.0;
            if (age <= 79) return 0.03 / 12.0;
            return 0.10 / 12.0;
        };

        for (int i = 0; i <= 120; i++) {
            double deaths = r.age_pyramid[i] * get_mortality(i) * famine_mult;
            if (g_bootstrap) deaths = 0.0;
            r.age_pyramid[i] = std::max(0.0, r.age_pyramid[i] - deaths);
        }

        double optimalCapacity = r.storage_capacity * 2.0;
        double birth_rate = 0.001 * std::clamp(1.0 - (r.population / optimalCapacity), 0.2, 1.0) * std::clamp(food_per_capita, 0.4, 1.0);

        double births = r.population * birth_rate;
        r.age_pyramid[0] += births;

        // Рождение NPC-агентов (5% от статистических рождений)
        int npc_births = (int)(births * 0.05);
        if (npc_births > 0) {
            std::vector<std::string> potential_parents;
            for (const auto& [nid, npc] : g_world.npcs) {
                if (npc.homeLocation == rid && npc.age_days >= 18 * 360 && npc.age_days <= 50 * 360) {
                    potential_parents.push_back(nid);
                }
            }
            for (int i = 0; i < npc_births; i++) {
                NPC child;
                child.id = "npc_" + generateUUID();
                child.name = "Ребенок_" + std::to_string(thread_safe_rand() % 1000);
                child.type = "npc";
                child.profession = "none";
                child.homeLocation = rid;
                child.currentLocation = rid;
                child.currentActivity = "Играет";
                child.age_days = 0;
                child.is_male = (thread_safe_rand() % 2 == 0);
                child.immunity = 40 + thread_safe_rand() % 60;
                child.hp = 10;
                child.maxHp = 10;
                
                // Assign parents first, then inherit race
                if (potential_parents.size() >= 2) {
                    std::string p1 = potential_parents[thread_safe_rand() % potential_parents.size()];
                    std::string p2 = potential_parents[thread_safe_rand() % potential_parents.size()];
                    if (p1 != p2) {
                        child.mother_id = p1;
                        child.father_id = p2;
                        g_world.npcs[p1].children_ids.push_back(child.id);
                        g_world.npcs[p2].children_ids.push_back(child.id);
                    }
                }

                // Наследование расы от матери (или отца, если матери нет)
                if (!child.mother_id.empty() && g_world.npcs.count(child.mother_id)) {
                    child.race = g_world.npcs[child.mother_id].race;
                } else if (!child.father_id.empty() && g_world.npcs.count(child.father_id)) {
                    child.race = g_world.npcs[child.father_id].race;
                }
                g_world.npcs[child.id] = child;
            }
        }

        for (int i = 119; i >= 0; i--) {
            double moving = r.age_pyramid[i] / 12.0;
            r.age_pyramid[i] -= moving;
            r.age_pyramid[i+1] += moving;
        }

        double new_pop = 0;
        double new_labor = 0;
        for (int i = 0; i <= 120; i++) {
            new_pop += r.age_pyramid[i];
            if (i >= 18 && i <= 65) new_labor += r.age_pyramid[i];
        }
        r.population = (int)new_pop;
        r.labor_force = (int)new_labor;

        int totalJobs = 0;
        for (const auto& [fId, fac] : r.facilities) totalJobs += fac.level * 100;
        for (const auto& [bId, bus] : g_world.businesses) {
            if (bus.region_id == rid && bus.is_active) totalJobs += bus.employee_count;
        }

        r.unemployment_rate = r.labor_force > 0 ? std::max(0.0, 1.0 - (double)totalJobs / r.labor_force) : 0.0;

        if (r.unemployment_rate < 0.1) r.average_wage = std::min(200, (int)(r.average_wage * 1.1));
        else if (r.unemployment_rate > 0.3) r.average_wage = std::max(30, (int)(r.average_wage * 0.9));

        r.attractivenessIndex = (r.average_wage / 100.0) - (r.unemployment_rate * 3.0) + (food_per_capita * 5.0);
        if (r.migrationCooldown > 0) r.migrationCooldown--;
    }

    // Фаза миграции (Социальный гомеостаз)
    for (auto& [rid, r] : g_world.regions) {
        if (r.migrationCooldown > 0 || r.population <= 100) continue;

        std::string best_target = "";
        double max_diff = 0.0;

        for (const auto& road : g_world.map.roads) {
            if (road.condition == "blocked") continue;
            std::string neighbor_id = "";
            if (road.from == rid) neighbor_id = road.to;
            else if (road.to == rid) neighbor_id = road.from;

            if (!neighbor_id.empty() && g_world.regions.count(neighbor_id)) {
                Region& neighbor = g_world.regions[neighbor_id];
                
                bool atWar = false;
                if (g_world.factions.count(r.factionId) && g_world.factions[r.factionId].diplomacy.count(neighbor.factionId)) {
                    if (g_world.factions[r.factionId].diplomacy.at(neighbor.factionId) == "war") atWar = true;
                }
                if (atWar) continue;

                double diff = neighbor.attractivenessIndex - r.attractivenessIndex;
                if (diff > 2.0 && diff > max_diff) {
                    max_diff = diff;
                    best_target = neighbor_id;
                }
            }
        }

        if (!best_target.empty()) {
            Region& target = g_world.regions[best_target];
            double migration_rate = 0.01 + (r.unemployment_rate * 0.05);
            double migrants = r.population * migration_rate;

            double factor = 1.0 - (migrants / r.population);
            for (int i = 0; i <= 120; i++) {
                double moving = r.age_pyramid[i] * (1.0 - factor);
                r.age_pyramid[i] -= moving;
                target.age_pyramid[i] += moving;
            }
            r.population -= migrants;
            target.population += migrants;

            r.migrationCooldown = 3;
        }
    }
}

void placePrivateBusinessOnMap(Region& r, const Business& b, World& w) {
    std::vector<int> empty_spots;
    for (size_t i = 0; i < r.cityLayout.size(); i++) {
        if (r.cityLayout[i].type == "empty") empty_spots.push_back(i);
    }
    if (!empty_spots.empty()) {
        int idx = empty_spots[rand() % empty_spots.size()];
        r.cityLayout[idx].type = b.facility_type;
        r.cityLayout[idx].name = "Private: " + b.facility_type;
        r.cityLayout[idx].linked_id = b.id;
        r.cityLayout[idx].sublocation_id = "sub_" + r.id + "_" + b.id;
        
        JsonValue subLoc = JsonValue::object();
        subLoc.set("id", r.cityLayout[idx].sublocation_id);
        subLoc.set("name", r.cityLayout[idx].name);
        subLoc.set("parentId", r.id);
        subLoc.set("type", b.facility_type);
        w.subLocations[r.cityLayout[idx].sublocation_id] = subLoc;
    }
}

void removePrivateBusinessFromMap(Region& r, const std::string& bId, World& w) {
    for (auto& block : r.cityLayout) {
        if (block.linked_id == bId) {
            block.type = "empty";
            block.name = "Abandoned Building";
            block.linked_id = "";
            w.subLocations.erase(block.sublocation_id);
            block.sublocation_id = "";
            break;
        }
    }
}


void processMonthlyBusinesses() {
    for (auto& [id, npc] : g_world.npcs) {
        if (!npc.isAlive || npc.age_days < 18 * 360) continue;
        if (!g_world.regions.count(npc.currentLocation)) continue;
        
        Region& r = g_world.regions[npc.currentLocation];
        int monthly_payroll = 100 * r.average_wage;
        if (npc.economy.savings < 200 + (monthly_payroll * 2)) continue;
        
        if ((rand() % 100) < 10) {
            std::string best_type = "";
            double best_profit = -999999.0;
            std::string best_focus = "";

            for (const auto& recipe : g_db.recipes) {
                double cost = 0;
                for (const auto& in : recipe.inputs) {
                    std::string inStr = in.first;
                    cost += (r.markets.count(inStr) ? r.markets.at(inStr) : 0) * in.second;
                }
                double rev = 0;
                for (const auto& out : recipe.outputs) {
                    std::string outStr = out.first;
                    rev += (r.markets.count(outStr) ? r.markets.at(outStr) : 0) * out.second;
                }
                
                double margin = rev - cost;
                if (margin > best_profit) {
                    best_profit = margin;
                    best_type = recipe.facility;
                    best_focus = recipe.outputs.begin()->first;
                }
            }
            
            for (const auto& [fId, facTpl] : g_facilityRegistry.getAll()) {
                if (facTpl.hasTag("extractor")) {
                    for (const auto& [res, rate] : facTpl.extraction_rates) {
                        if (r.available_raw_resources.count(res)) {
                            double price = r.markets.count(res) ? r.markets.at(res) : 0;
                            if (price <= 0) price = (g_db.items.count(res) ? g_db.items.at(res).basePrice : 1);
                            double profit = price * rate * 10.0;
                            if (profit > best_profit) {
                                best_profit = profit;
                                best_type = fId;
                                best_focus = res;
                            }
                        }
                    }
                }
            }
            
            if (!best_type.empty() && best_profit > 0) {
                const FacilityTemplate* bestFacTpl = g_facilityRegistry.getTemplate(best_type);
                int build_cost = bestFacTpl ? bestFacTpl->build_cost : 500;
                
                int required_capital = build_cost + (monthly_payroll * 2);
                if (npc.economy.savings >= required_capital) {
                    Business b;
                    b.id = "bus_" + generateUUID();
                    b.owner_ids.push_back(id);
                    b.region_id = npc.currentLocation;
                    b.facility_type = best_type;
                    b.level = 1;
                    b.cash_balance = monthly_payroll * 2;
                    b.reinvestment_pool = 0;
                    b.employee_count = std::min(500, (int)(npc.economy.savings / r.average_wage));
                    b.is_active = true;
                    b.months_loss_streak = 0;
                    b.production_focus = best_focus;
                    b.local_storage_id = createContainer("business_storage", id, 999999, 1000, npc.currentLocation);
                    
                    LogisticRule autoSell;
                    autoSell.id = "log_" + generateUUID();
                    autoSell.type = "transfer";
                    autoSell.resource = best_focus;
                    autoSell.target_id = npc.currentLocation;
                    autoSell.amount = 9999;
                    autoSell.frequency_days = 7;
                    b.logistics.push_back(autoSell);
                    
                    npc.economy.savings -= required_capital;
                    npc.owned_businesses.push_back(b.id);
                    g_world.businesses[b.id] = b;
                    
                    placePrivateBusinessOnMap(r, b, g_world);
                    addNews(locStr("engine.news.merchant_investment", {{"merchant", npc.name}, {"business", b.facility_type}}), b.region_id, 1, "business");
                }
            }
        }
    }

    std::vector<std::string> bankruptcies;
    for (auto& [bId, bus] : g_world.businesses) {
        if (!bus.is_active) continue;
        if (!g_world.regions.count(bus.region_id)) continue;
        Region& r = g_world.regions[bus.region_id];
        
        const FacilityTemplate* facTpl = g_facilityRegistry.getTemplate(bus.facility_type);
        int max_emp = facTpl ? bus.level * facTpl->max_employees_per_level : bus.level * 100;
        if (std::find(bus.owner_ids.begin(), bus.owner_ids.end(), "player") != bus.owner_ids.end()) {
            bus.employee_count = std::min(bus.target_employee_count, max_emp);
        } else {
            bus.employee_count = max_emp;
        }
        int wage_cost = bus.employee_count * r.average_wage;
        double market_mod = 1.0 + ((rand() % 50) - 15) / 100.0;
        if (r.threat_level > 50) market_mod -= 0.2;
        int revenue = (int)(wage_cost * market_mod);
        
        if (bus.facility_type == "brothels" || bus.facility_type == "bathhouses") {
            std::vector<std::string> luxuryGoods;
            luxuryGoods = getCoreIdsByTagList(bus.facility_type == "brothels" ? "brothel_luxury_goods" : "bathhouse_luxury_goods");

            int buy_amount = bus.level * 2;
            for (const auto& lg : luxuryGoods) {
                double price = r.markets.count(lg) ? r.markets.at(lg) : 0;
                if (price <= 0) price = (g_db.items.count(lg) ? g_db.items.at(lg).basePrice : 1);
                int available = countItemsInContainer(r.vault_id, lg);
                int actual_buy = std::min(buy_amount, available);
                if (actual_buy > 0 && bus.cash_balance >= price * actual_buy) {
                    bus.cash_balance -= price * actual_buy;
                    r.moneySupply += price * actual_buy;
                    consumeItemsFromContainer(r.vault_id, lg, actual_buy);
                    revenue += price * actual_buy * 3;
                }
            }
        }
        
        int profit = revenue - wage_cost;
        if (profit < 0) {
            bus.cash_balance += profit; 
            if (bus.cash_balance < 0) {
                bus.months_loss_streak++;
                if (bus.months_loss_streak >= 6) {
                    bus.is_active = false;
                    bankruptcies.push_back(bId);
                    removePrivateBusinessFromMap(r, bId, g_world);
                    addNews("Large facility (" + bus.facility_type + ") went bankrupt. " + std::to_string(bus.employee_count) + " workers lost their jobs.", bus.region_id, 2, "business");
                    bus.addLog(g_world.current_day, "❌ BANKRUPTCY: Facility closed due to debts.");
                }
            }
        } else {
            bus.months_loss_streak = 0;
            int dividend = profit * 0.50;
            int to_cash = profit * 0.30;
            int to_reinvest = profit - dividend - to_cash;
            bus.cash_balance += to_cash;
            bus.reinvestment_pool += to_reinvest;
            
            if (dividend > 0 && !bus.owner_ids.empty()) {
                int per_owner = dividend / (int)bus.owner_ids.size();
                for (const auto& oId : bus.owner_ids) {
                    if (g_world.npcs.count(oId)) g_world.npcs[oId].economy.savings += per_owner;
                }
            }
            if (bus.reinvestment_pool > 2000 * bus.level) {
                bus.reinvestment_pool -= 2000 * bus.level;
                bus.level++;
                addNews("Facility (" + bus.facility_type + ") prospers and expands to level " + std::to_string(bus.level) + "! New workers hired.", bus.region_id, 1, "business");
                bus.addLog(g_world.current_day, "⬆️ UPGRADE: Level increased to " + std::to_string(bus.level) + "!");
            }
        }
        
        if (bus.is_active && !bus.production_focus.empty()) {
            std::string bestRegion = bus.region_id;
            double bestPrice = r.markets.count(bus.production_focus) ? r.markets.at(bus.production_focus) : 0;
            for (const auto& [rid, target_r] : g_world.regions) {
                double price = target_r.markets.count(bus.production_focus) ? target_r.markets.at(bus.production_focus) : 0;
                if (price > bestPrice * 1.3 && target_r.moneySupply > price * 50) {
                    bestPrice = price;
                    bestRegion = rid;
                }
            }
            if (!bus.logistics.empty() && bus.logistics[0].target_id != bestRegion) {
                bus.logistics[0].target_id = bestRegion;
                addNews("MARKET: Owner of facility (" + bus.facility_type + ") from " + g_world.regions[bus.region_id].name + " redirected supplies to " + g_world.regions[bestRegion].name + " due to high prices, ignoring politics.", bus.region_id, 1, "market");
            }
            
            if (std::find(bus.owner_ids.begin(), bus.owner_ids.end(), "player") == bus.owner_ids.end()) {
                std::vector<std::string> possible_products = getFacilityCandidateProducts(bus.facility_type);

                if (possible_products.size() > 1) {
                    std::string best_focus_new = bus.production_focus;
                    double best_profit_new = -999999.0;
                    double current_profit_val = -999999.0;

                    for (const auto& prod : possible_products) {
                        bool isExtractor = facilityIsExtractor(bus.facility_type);
                        if (isExtractor && !r.available_raw_resources.count(prod)) continue;

                        double price = r.markets.count(prod) ? r.markets.at(prod) : 0;
                        if (price <= 0) price = (g_db.items.count(prod) ? g_db.items.at(prod).basePrice : 1);
                        double profit = price;

                        for (const auto& rec : g_db.recipes) {
                            std::string outType = prod;
                            if (rec.facility == bus.facility_type && rec.outputs.count(outType)) {
                                double cost = 0;
                                for (const auto& in : rec.inputs) {
                                    std::string in_str = in.first;
                                    double in_price = r.markets.count(in_str) ? r.markets.at(in_str) : 0;
                                    if (in_price <= 0) in_price = (g_db.items.count(in_str) ? g_db.items.at(in_str).basePrice : 1);
                                    cost += in_price * in.second;
                                }
                                profit = (price * rec.outputs.at(outType)) - cost;
                                break;
                            }
                        }
                        if (prod == bus.production_focus) current_profit_val = profit;
                        if (profit > best_profit_new) {
                            best_profit_new = profit;
                            best_focus_new = prod;
                        }
                    }

                    if (best_focus_new != bus.production_focus && best_profit_new > current_profit_val * 1.2) {
                        bus.production_focus = best_focus_new;
                        for (auto& rule : bus.logistics) {
                            if (rule.type == "transfer" || rule.type == "retail") {
                                rule.resource = best_focus_new;
                            }
                        }
                        bus.addLog(g_world.current_day, "🔄 FOCUS CHANGE: Facility switched to producing " + getGoodName(best_focus_new) + " due to market conditions.");
                    }
                }
            }
        }
    }

    for (const auto& bId : bankruptcies) {
        g_world.businesses.erase(bId);
    }
}


void processTaxation() {
    // Ежемесячный земельный налог (сбор урожая в казну)
    for (auto& [id, npc] : g_world.npcs) {
        if (!npc.isAlive) continue;
        // Data-driven: check if profession_type is in the farmer category
        {
            auto profIt = g_db.professions.find(npc.profession);
            if (profIt == g_db.professions.end() || profIt->second.profession_type != "farmer") continue;
        }
        if (!g_world.regions.count(npc.currentLocation)) continue;
        
        Region& r = g_world.regions[npc.currentLocation];
        std::string contId = npc.economy.storage_id.empty() ? npc.inventory_id : npc.economy.storage_id;
        if (contId.empty() || r.vault_id.empty()) continue;

        if (r.isOccupied && r.daysUnderOccupation < 30) continue; // T3: 7.2 No taxes during early occupation

        // Лорд забирает 25% пшеницы и мяса
        std::vector<std::string> taxGoods = getCoreIdsByTagList("tax_goods_list");
        for (const std::string& gt : taxGoods) {
            int stock = countItemsInContainer(contId, gt);
            int tax = stock * 0.25;
            if (tax > 0) {
                consumeItemsFromContainer(contId, gt, tax);
                createItem(gt, tax, r.vault_id, g_world.current_day, "Земельный налог");
            }
        }
    }

    // Ежегодный подушный налог (золотом)
    if (g_world.current_day > 0 && g_world.current_day % 360 == 0) {
        for (auto& [rid, r] : g_world.regions) {
            if (r.factionId.empty() || !g_world.factions.count(r.factionId)) continue;
            if (r.isOccupied && r.daysUnderOccupation < 30) continue; // T3: 7.2 No taxes during early occupation
            Faction& f = g_world.factions[r.factionId];
            std::string capId = f.regions.empty() ? "" : f.regions[0];
            if (capId.empty() || !g_world.regions.count(capId)) continue;
            
            Region& capital = g_world.regions[capId];
            
            // Налог: 1 золото с каждого трудоспособного
            int taxAmount = r.labor_force * 1;
            if (r.moneySupply >= taxAmount) {
                r.moneySupply -= taxAmount;
                createItem(getCoreIdByTag("currency"), taxAmount, capital.vault_id, g_world.current_day, "Подушный налог");
            } else {
                // Недоимка вызывает рост угрозы (недовольство)
                r.threat_level = std::min(100, r.threat_level + 10);
            }
        }
    }
}

void processInfrastructureProjects() {
    for (auto& [fid, f] : g_world.factions) {
        std::string capId = f.regions.empty() ? "" : f.regions[0];
        if (capId.empty() || !g_world.regions.count(capId)) continue;
        
        std::string g_id = getCoreIdByTag("currency");
        std::string w_id = getCoreIdByTag("building");
        std::string i_id = getCoreIdByTag("metal_ingot");
        int gold = countItemsInContainer(g_world.regions[capId].vault_id, g_id);
        int wood = countItemsInContainer(g_world.regions[capId].vault_id, w_id);
        int iron = countItemsInContainer(g_world.regions[capId].vault_id, i_id);
        
        for (const auto& rid : f.regions) {
            if (!g_world.regions.count(rid)) continue;
            Region& r = g_world.regions[rid];
            
            // 1. Дамбы (Dams) - защита от наводнений и осушение пойм
            if (gold >= g_gameplay_runtime.infra_dam_gold_cost && wood >= g_gameplay_runtime.infra_dam_wood_cost && !r.custom_props.has("has_dam")) {
                bool has_river = false;
                if (g_world.map.locations.count(rid)) {
                    auto loc = g_world.map.locations[rid];
                    for (int dy = -3; dy <= 3; dy++) {
                        for (int dx = -3; dx <= 3; dx++) {
                            int nx = loc.x + dx, ny = loc.y + dy;
                            if (nx >= 0 && nx < g_world.map.width && ny >= 0 && ny < g_world.map.height) {
                                uint8_t b_id = g_world.map.grid[ny * g_world.map.width + nx].biome_id;
                                std::string b_str = getBiomeStringId(b_id);
                                if (b_str == "river") has_river = true;
                            }
                        }
                    }
                    if (has_river) {
                        consumeItemsFromContainer(g_world.regions[capId].vault_id, g_id, g_gameplay_runtime.infra_dam_gold_cost);
                        consumeItemsFromContainer(g_world.regions[capId].vault_id, w_id, g_gameplay_runtime.infra_dam_wood_cost);
                        gold -= g_gameplay_runtime.infra_dam_gold_cost; wood -= g_gameplay_runtime.infra_dam_wood_cost;
                        r.custom_props.set("has_dam", true);
                        
                        for (int dy = -3; dy <= 3; dy++) {
                            for (int dx = -3; dx <= 3; dx++) {
                                int nx = loc.x + dx, ny = loc.y + dy;
                                if (nx >= 0 && nx < g_world.map.width && ny >= 0 && ny < g_world.map.height) {
                                                                    int idx = ny * g_world.map.width + nx;
                                uint8_t b_id = g_world.map.grid[idx].biome_id;
                                std::string b_str = getBiomeStringId(b_id);
                                if (b_str == "floodplain") {
                                    g_world.map.grid[idx].biome_id = g_db.biome_string_to_id.count("plains") ? g_db.biome_string_to_id["plains"] : 0;
                                }
                                }
                            }
                        }
                        g_world.map.generation_tick = g_world.tick;
                        addNews(locStr("engine.news.infrastructure.dam_built", {{"faction", f.name}, {"region", r.name}}), rid, 3, "politics");
                    }
                }
            }
            
            // 2. Акведуки (Aqueducts) - повышение фертильности
            if (gold >= g_gameplay_runtime.infra_aqueduct_gold_cost && iron >= g_gameplay_runtime.infra_aqueduct_iron_cost && !r.custom_props.has("has_aqueduct")) {
                consumeItemsFromContainer(g_world.regions[capId].vault_id, g_id, g_gameplay_runtime.infra_aqueduct_gold_cost);
                consumeItemsFromContainer(g_world.regions[capId].vault_id, i_id, g_gameplay_runtime.infra_aqueduct_iron_cost);
                gold -= g_gameplay_runtime.infra_aqueduct_gold_cost; iron -= g_gameplay_runtime.infra_aqueduct_iron_cost;
                r.custom_props.set("has_aqueduct", true);
                r.fertility += 0.5;
                addNews(locStr("engine.news.infrastructure.aqueduct_built", {{"region", r.name}}), rid, 3, "politics");
            }
            
            // 2.5 Колодцы (Санитария) - предотвращение эпидемий
            if (gold >= g_gameplay_runtime.infra_well_gold_cost && r.population > r.storage_capacity && !r.custom_props.has("has_well")) {
                consumeItemsFromContainer(g_world.regions[capId].vault_id, g_id, g_gameplay_runtime.infra_well_gold_cost);
                gold -= g_gameplay_runtime.infra_well_gold_cost;
                r.custom_props.set("has_well", true);
                addNews(locStr("engine.news.infrastructure.wells_built", {{"region", r.name}}), rid, 2, "politics");
            }
        }
        
        // 3. Строительство новых мостов и трактов к изолированным регионам
        for (const auto& rid : f.regions) {
            if (gold >= g_gameplay_runtime.infra_road_gold_cost && wood >= g_gameplay_runtime.infra_road_wood_cost) {
                if (g_world.map.locations.count(rid) && g_world.map.locations[rid].no_road) {
                    auto loc1 = g_world.map.locations[rid];
                    auto loc2 = g_world.map.locations[capId];
                    std::vector<bool> has_road(g_world.map.width * g_world.map.height, false);
                    std::vector<int> path_status(g_world.map.width * g_world.map.height, 0);
                    for (const auto& road : g_world.map.roads) {
                        for (const auto& wp : road.waypoints) has_road[wp.second * g_world.map.width + wp.first] = true;
                    }
                    auto path = findPath(g_world.map, loc1.x, loc1.y, loc2.x, loc2.y, has_road, path_status, MovementType::ANY);
                    if (!path.empty()) {
                        consumeItemsFromContainer(g_world.regions[capId].vault_id, g_id, g_gameplay_runtime.infra_road_gold_cost);
                        consumeItemsFromContainer(g_world.regions[capId].vault_id, w_id, g_gameplay_runtime.infra_road_wood_cost);
                        gold -= g_gameplay_runtime.infra_road_gold_cost; wood -= g_gameplay_runtime.infra_road_wood_cost;
                        g_world.map.locations[rid].no_road = false;
                        
                        std::vector<MapRoad> new_segments;
                        MapRoad current_segment;
                        current_segment.from = rid;
                        current_segment.to = capId;
                        current_segment.condition = "paved";
                        
                        int initial_idx = path[0].second * g_world.map.width + path[0].first;
                        uint8_t initial_b_id = g_world.map.grid[initial_idx].biome_id;
                        std::string initial_t = getBiomeStringId(initial_b_id);
                        if (initial_t == "river" || initial_t == "shallow_water" || initial_t == "ocean" || initial_t == "lake") {
                            current_segment.type = (g_world.map.grid[initial_idx].water_depth >= 3) ? "ferry" : "bridge";
                        } else if (initial_t == "mountains" || initial_t == "hills") {
                            current_segment.type = "tunnel";
                        } else {
                            current_segment.type = "paved";
                        }

                        for (size_t i = 0; i < path.size(); ++i) {
                            auto wp = path[i];
                            int idx = wp.second * g_world.map.width + wp.first;
                            
                            uint8_t b_id = g_world.map.grid[idx].biome_id;
                            std::string t = getBiomeStringId(b_id);
                            bool is_water = (t == "river" || t == "shallow_water" || t == "ocean" || t == "lake");
                            
                            std::string target_type;
                            if (is_water) {
                                g_world.map.grid[idx].bridge_flag = 1;
                                target_type = (g_world.map.grid[idx].water_depth >= 3) ? "ferry" : "bridge";
                            } else if (t == "mountains" || t == "hills") {
                                target_type = "tunnel";
                            } else {
                                target_type = "paved";
                            }

                            if (current_segment.type != target_type && !current_segment.waypoints.empty()) {
                                current_segment.waypoints.push_back(wp);
                                new_segments.push_back(current_segment);
                                
                                current_segment.waypoints.clear();
                                current_segment.type = target_type;
                                if (i > 0) {
                                    current_segment.waypoints.push_back(path[i-1]);
                                }
                            }
                            
                            if (current_segment.waypoints.empty() || current_segment.waypoints.back() != wp) {
                                current_segment.waypoints.push_back(wp);
                            }
                        }
                        if (!current_segment.waypoints.empty()) new_segments.push_back(current_segment);
                        
                        for (const auto& seg : new_segments) {
                            g_world.map.roads.push_back(seg);
                        }
                        
                        g_path_cache_dirty = true;
                        g_world.map.generation_tick = g_world.tick;
                        addNews(locStr("engine.news.infrastructure.road_built", {{"faction", f.name}, {"region", g_world.regions[rid].name}}), rid, 4, "politics");
                    }
                }
            }
        }
    }
}


void monthlyTick() {
    processMonthlyDemographics();
    processMonthlyBusinesses();
    processTaxation();
    processInfrastructureProjects();
}


void dailyTick();
void weeklyTick();
void processFactionTrade();
void processDisasters();
void processNavalCombat();




// Forward declarations
// void simulateOneDay(); (replaced by dailyTick)

// Simulate one hour
void processFleets() {
    for (auto& [rid, port] : g_world.port_facilities) port.is_blockaded = false;

    for (auto it = g_world.fleets.begin(); it != g_world.fleets.end(); ) {
        Fleet& f = *it;
        f.ship_ids.erase(std::remove_if(f.ship_ids.begin(), f.ship_ids.end(), [](const std::string& sid) {
            bool found = false;
            for (const auto& s : g_world.ships) if (s.id == sid && s.hull > 0) found = true;
            return !found;
        }), f.ship_ids.end());

        if (f.ship_ids.empty()) {
            it = g_world.fleets.erase(it);
            continue;
        }

        if (!f.path.empty() && f.path_index < (int)f.path.size() - 1) {
            double speed = 1.2;
            std::string current_region = "";
            for (const auto& [rid, loc] : g_world.map.locations) {
                if (std::abs(loc.x - f.x) <= 2 && std::abs(loc.y - f.y) <= 2) { current_region = rid; break; }
            }
            if (!current_region.empty() && g_world.regions.count(current_region)) {
                std::string w = g_world.regions[current_region].weather;
                if (w == "Эфирный шторм" || w == "Метель") speed *= 0.2;
                else if (w == "Дождь" || w == "Тропический ливень") speed *= 0.7;
                else if (w == "Туман") speed *= 0.5;
            }

            while (speed > 0 && f.path_index < (int)f.path.size() - 1) {
                double target_x = f.path[f.path_index + 1].first;
                double target_y = f.path[f.path_index + 1].second;
                double dx = target_x - f.x;
                double dy = target_y - f.y;
                double dist = std::hypot(dx, dy);
                
                if (dist <= speed) {
                    f.x = target_x; f.y = target_y;
                    speed -= dist; f.path_index++;
                } else {
                    f.x += (dx / dist) * speed; f.y += (dy / dist) * speed;
                    speed = 0;
                }
            }
        }

        for (auto& s : g_world.ships) {
            if (s.fleet_id == f.id) { s.x = f.x; s.y = f.y; }
        }

        if (f.path_index >= (int)f.path.size() - 1 && f.mission == "blockade") {
            if (g_world.port_facilities.count(f.destination)) {
                g_world.port_facilities[f.destination].is_blockaded = true;
            }
        }
        ++it;
    }
}


void processShips() {
    for (auto& ship : g_world.ships) {

        if (!ship.fleet_id.empty()) continue;

        if (ship.type == ShipType::SEA_MONSTER) {
            double min_dist = 9999;
            Ship* target = nullptr;
            for (auto& s : g_world.ships) {
                if (s.id != ship.id && s.type != ShipType::SEA_MONSTER && s.hull > 0) {
                    double d = std::hypot(s.x - ship.x, s.y - ship.y);
                    if (d < min_dist) { min_dist = d; target = &s; }
                }
            }
            if (target) {
                if (min_dist <= 1.5) {
                    if (target->cannons > 0 || target->marines > 0) {
                        ship.hull -= (target->cannons * 10 + target->marines * 5);
                        target->hull -= 30;
                        addNews(locStr("engine.news.naval.sea_monster_battle"), "global", 4, "war");
                        if (ship.hull <= 0) addNews(locStr("engine.news.naval.sea_monster_killed"), "global", 5, "war");
                    } else {
                        target->hull -= 50;
                        addNews(locStr("engine.news.naval.sea_monster_attacks_trade"), "global", 4, "disaster");
                    }
                } else {
                    double dx = target->x - ship.x;
                    double dy = target->y - ship.y;
                    ship.x += (dx / min_dist) * ship.speed;
                    ship.y += (dy / min_dist) * ship.speed;
                }
            }
            continue;
        }
        if (ship.path.empty() || ship.path_index >= (int)ship.path.size() - 1) continue;
        
        double speed = ship.speed;
        if (g_world.regions.count(ship.destination)) {
            std::string w = g_world.regions[ship.destination].weather;
            if (w == "Эфирный шторм" || w == "Метель") speed *= 0.2;
            else if (w == "Дождь" || w == "Туман" || w == "Тропический ливень") speed *= 0.7;
        }
        
        while (speed > 0 && ship.path_index < (int)ship.path.size() - 1) {
            double target_x = ship.path[ship.path_index + 1].first;
            double target_y = ship.path[ship.path_index + 1].second;
            double dx = target_x - ship.x;
            double dy = target_y - ship.y;
            double dist = std::hypot(dx, dy);
            
            if (dist <= speed) {
                ship.x = target_x;
                ship.y = target_y;
                speed -= dist;
                ship.path_index++;
            } else {
                ship.x += (dx / dist) * speed;
                ship.y += (dy / dist) * speed;
                speed = 0;
            }
        }
        
        if (ship.path_index >= (int)ship.path.size() - 1) {
            std::string dest = ship.destination;
            if (g_world.regions.count(dest) && g_world.port_facilities.count(dest)) {
                if (g_world.port_facilities[dest].is_blockaded) {
                    addNews(locStr("engine.news.naval.blockade_trade_blocked", {{"port", g_world.regions[dest].name}}), dest, 3, "trade");
                    ship.path.clear();
                    ship.path_index = 0;
                    continue;
                }
                Region& destReg = g_world.regions[dest];
                if (ship.type == ShipType::MERCHANT && g_containers.count(ship.chest_id)) {
                    Storage& chest = g_containers[ship.chest_id];
                    double totalRevenue = 0;
                    std::map<std::string, int> deliveredGoods;
                    std::vector<std::string> items_to_move = chest.item_ids;
                    
                    for (const auto& itemId : items_to_move) {
                        if (!g_items.count(itemId)) continue;
                        PhysicalItem& item = g_items[itemId];
                        
                        double price = destReg.markets[item.prototype_id];
                        if (price <= 0) {
                            auto it = g_db.items.find(item.prototype_id);
                            price = (it != g_db.items.end()) ? it->second.basePrice : 1;
                        }
                        
                        int affordable_qty = item.stack_size;
                        double itemRev = item.stack_size * price;
                        
                        if (destReg.moneySupply < itemRev) {
                            affordable_qty = std::floor(destReg.moneySupply / price);
                            itemRev = affordable_qty * price;
                        }
                        
                        if (affordable_qty > 0) {
                            deliveredGoods[item.prototype_id] += affordable_qty;
                            totalRevenue += itemRev;
                            destReg.moneySupply -= itemRev;
                            
                            if (affordable_qty == item.stack_size) {
                                moveItem(itemId, destReg.vault_id);
                            } else {
                                removeItem(itemId, affordable_qty);
                                createItem(item.prototype_id, affordable_qty, destReg.vault_id, g_world.current_day, "Морская торговля");
                            }
                        }
                    }
                    
                    int portFee = totalRevenue * 0.15;
                    destReg.moneySupply += portFee;
                    int netRevenue = totalRevenue - portFee;
                    
                    if (g_world.factions.count(ship.owner_id)) {
                        std::string capId = g_world.factions[ship.owner_id].regions.empty() ? "" : g_world.factions[ship.owner_id].regions[0];
                        if (!capId.empty() && g_world.regions.count(capId)) {
                            createItem(getCoreIdByTag("currency"), netRevenue, g_world.regions[capId].vault_id, g_world.current_day, "Морская торговля");
                        }
                    } else if (g_world.npcs.count(ship.owner_id)) {
                        g_world.npcs[ship.owner_id].economy.savings += netRevenue;
                    }
                    
                    std::string goodsList;
                    for (const auto& [gt, amount] : deliveredGoods) {
                        if (!goodsList.empty()) goodsList += ", ";
                        goodsList += std::to_string(amount) + " " + getGoodName(gt);
                    }
                    if (goodsList.empty()) goodsList = "ничего";
                    
                    addNews(locStr("engine.news.naval.trade_arrived", {{"port", destReg.name}, {"goods", goodsList}, {"revenue", std::to_string((int)totalRevenue)}, {"fee", std::to_string(portFee)}}), dest, 2, "trade");
                }
            }
            ship.path.clear();
            ship.path_index = 0;
        }
    }
}

// Export surplus goods from region vaults to port docks for naval trade
void exportGoodsToPortDocks() {
    for (auto& [rid, port] : g_world.port_facilities) {
        if (port.is_blockaded) continue;
        if (!g_world.regions.count(rid)) continue;
        Region& r = g_world.regions[rid];
        
        // Export surplus goods: if region has more than reserve threshold, move excess to dock
        for (const auto& [gtStr, itemDef] : g_db.items) {
            if (itemDef.category == "document") continue;
            int inVault = countItemsInContainer(r.vault_id, gtStr);
            if (inVault <= 100) continue; // Keep minimum reserve in vault
            
            int inDock = countItemsInContainer(port.dock_container_id, gtStr);
            if (inDock >= 200) continue; // Dock already has enough
            
            int toExport = std::min(inVault - 80, 200 - inDock); // Export up to 200 in dock, keep 80 in vault
            if (toExport <= 0) continue;
            
            consumeItemsFromContainer(r.vault_id, gtStr, toExport);
            createItem(gtStr, toExport, port.dock_container_id, g_world.current_day, "Экспорт в порт");
        }
    }
}

void processNavalTrade() {
    std::vector<bool> dummy_has_road(g_world.map.width * g_world.map.height, false);
    std::vector<int> dummy_path_status(g_world.map.width * g_world.map.height, 0);

    for (auto& ship : g_world.ships) {
        if (ship.type != ShipType::MERCHANT || !ship.path.empty()) continue;

        std::string current_port = "";
        for (const auto& [rid, port] : g_world.port_facilities) {
            if (g_world.map.locations.count(rid)) {
                auto loc = g_world.map.locations[rid];
                if (std::abs(loc.x - ship.x) <= 1 && std::abs(loc.y - ship.y) <= 1) {
                    current_port = rid;
                    break;
                }
            }
        }

        if (current_port.empty() || !g_world.regions.count(current_port)) continue;
        if (g_world.port_facilities[current_port].is_blockaded) continue;
        Region& localReg = g_world.regions[current_port];
        PortFacility& localPort = g_world.port_facilities[current_port];

        std::string bestDest = "";
        std::string bestGood = "";
        double maxProfit = 0;
        double buyPrice = 0;

        for (const auto& [gtStr, itemDef] : g_db.items) {
            if (itemDef.category == "document") continue;
            int available = countItemsInContainer(localPort.dock_container_id, gtStr);
            if (available < 50) continue;

            double localP = localReg.markets.count(gtStr) ? localReg.markets.at(gtStr) : itemDef.basePrice;
            if (localP <= 0) localP = itemDef.basePrice;

            for (const auto& [destId, destPort] : g_world.port_facilities) {
                if (destId == current_port || destPort.is_blockaded || !g_world.regions.count(destId)) continue;
                Region& destReg = g_world.regions[destId];
                double destP = destReg.markets.count(gtStr) ? destReg.markets.at(gtStr) : itemDef.basePrice;
                if (destReg.moneySupply < destP * 50) continue;

                double profitMargin = destP - localP;
                if (profitMargin > maxProfit && profitMargin > localP * 0.2) {
                    maxProfit = profitMargin;
                    bestDest = destId;
                    bestGood = gtStr;
                    buyPrice = localP;
                }
            }
        }

        if (!bestDest.empty() && !bestGood.empty()) {
            int amountToBuy = std::min(countItemsInContainer(localPort.dock_container_id, bestGood), ship.cargo_capacity);
            bool canLoad = false;

            if (g_world.factions.count(ship.owner_id)) {
                if (localReg.factionId == ship.owner_id) {
                    canLoad = true;
                } else {
                    std::string capId = g_world.factions[ship.owner_id].regions.empty() ? "" : g_world.factions[ship.owner_id].regions[0];
                    if (!capId.empty() && g_world.regions.count(capId)) {
                        int gold = countItemsInContainer(g_world.regions[capId].vault_id, getCoreIdByTag("currency"));
                        int cost = amountToBuy * buyPrice;
                        if (gold >= cost) {
                            consumeItemsFromContainer(g_world.regions[capId].vault_id, getCoreIdByTag("currency"), cost);
                            localReg.moneySupply += cost;
                            canLoad = true;
                        }
                    }
                }
            } else if (g_world.npcs.count(ship.owner_id)) {
                int cost = amountToBuy * buyPrice;
                if (g_world.npcs[ship.owner_id].economy.savings >= cost) {
                    g_world.npcs[ship.owner_id].economy.savings -= cost;
                    localReg.moneySupply += cost;
                    canLoad = true;
                }
            }

            if (canLoad) {
                consumeItemsFromContainer(localPort.dock_container_id, bestGood, amountToBuy);
                createItem(bestGood, amountToBuy, ship.chest_id, g_world.current_day, "Погрузка на корабль");
                
                auto loc1 = g_world.map.locations[current_port];
                auto loc2 = g_world.map.locations[bestDest];
                auto path = findPath(g_world.map, loc1.x, loc1.y, loc2.x, loc2.y, dummy_has_road, dummy_path_status, MovementType::WATER, 10);
                if (!path.empty()) {
                    ship.path = path;
                    ship.path_index = 0;
                    ship.destination = bestDest;
                    addNews(locStr("engine.news.naval.ship_departed", {{"ship", ship.id}, {"origin", localReg.name}, {"dest", g_world.regions[bestDest].name}, {"cargo", getGoodName(bestGood)}}), current_port, 1, "logistics");
                } else {
                    // No water path found — unload cargo back to dock
                    consumeItemsFromContainer(ship.chest_id, bestGood, amountToBuy);
                    createItem(bestGood, amountToBuy, localPort.dock_container_id, g_world.current_day, "Разгрузка (нет пути)");
                }
            }
        }
    }
}


void processCouriers() {
    for (auto& [npcId, npc] : g_world.npcs) {
        if (!npc.isAlive || npc.economy.profession_type != "courier") continue;

        if (!npc.travelDestination.empty()) {
            npc.travelHoursLeft--;
            std::string destName = g_world.regions.count(npc.travelDestination) ? g_world.regions[npc.travelDestination].name : npc.travelDestination;
            npc.currentActivity = locStr("engine.npc.delivering_letter", {{"dest", destName}});
            npc.needs.rest -= 1;

            if (npc.travelHoursLeft <= 0) {
                npc.currentLocation = npc.travelDestination;
                npc.travelDestination = "";
                npc.currentActivity = locStr("engine.npc.arrived");

                if (!npc.delivery_target_id.empty() && g_containers.count(npc.delivery_target_id)) {
                    if (!npc.inventory_id.empty() && g_containers.count(npc.inventory_id)) {
                        Storage& inv = g_containers[npc.inventory_id];
                        std::vector<std::string> to_move;
                        for (const auto& itemId : inv.item_ids) {
                            if (g_items.count(itemId) && g_items[itemId].prototype_id == "document_order") {
                                to_move.push_back(itemId);
                            }
                        }
                        for (const auto& itemId : to_move) {
                            moveItem(itemId, npc.delivery_target_id);
                        }
                    }
                }
                npc.delivery_target_id = "";
            }
            continue;
        }

        if (g_world.regions.count(npc.currentLocation)) {
            Region& r = g_world.regions[npc.currentLocation];
            if (!r.vault_id.empty() && g_containers.count(r.vault_id)) {
                Storage& vault = g_containers[r.vault_id];
                std::string orderToDeliver = "";
                for (const auto& itemId : vault.item_ids) {
                    if (g_items.count(itemId) && g_items[itemId].prototype_id == "document_order") {
                        orderToDeliver = itemId;
                        break;
                    }
                }

                if (!orderToDeliver.empty()) {
                    std::string targetInbox = "";
                    std::string targetRegion = "";
                    for (const auto& [nId, merchant] : g_world.npcs) {
                        if (npcHasProfessionType(merchant, {"merchant"}) && !merchant.economy.workplaceId.empty()) {
                            targetInbox = getSubContainer(merchant.economy.workplaceId, "inbox");
                            targetRegion = merchant.homeLocation;
                            if (!targetInbox.empty()) break;
                        }
                    }

                    if (!targetInbox.empty()) {
                        moveItem(orderToDeliver, npc.inventory_id);
                        npc.travelDestination = targetRegion;
                        npc.delivery_target_id = targetInbox;
                        npc.travelHoursLeft = (npc.currentLocation == targetRegion) ? 2 : 24 + (rand() % 24);
                        std::string tName = g_world.regions.count(targetRegion) ? g_world.regions[targetRegion].name : targetRegion;
                        npc.currentActivity = locStr("engine.npc.took_order", {{"dest", tName}});
                    }
                } else {
                    npc.currentActivity = locStr("engine.npc.waiting_orders");
                }
            }
        }
    }
}


void processMerchantOrders() {
    for (auto& [npcId, merchant] : g_world.npcs) {
        if (!merchant.isAlive || !npcHasProfessionType(merchant, {"merchant"}) || merchant.economy.workplaceId.empty()) continue;

        if (!merchant.travelDestination.empty()) {
            merchant.travelHoursLeft--;
            std::string destName = g_world.regions.count(merchant.travelDestination) ? g_world.regions[merchant.travelDestination].name : merchant.travelDestination;
            merchant.currentActivity = locStr("engine.npc.transporting_goods", {{"dest", destName}});
            merchant.needs.rest -= 1;
            if (merchant.travelHoursLeft <= 0) {
                merchant.currentLocation = merchant.travelDestination;
                merchant.travelDestination = "";
                merchant.currentActivity = locStr("engine.npc.arrived_for_trade");
            }
            continue;
        }

        std::string archiveId = getSubContainer(merchant.economy.workplaceId, "archive");
        std::string safeId = getSubContainer(merchant.economy.workplaceId, "safe");
        if (archiveId.empty() || safeId.empty() || !g_containers.count(merchant.inventory_id)) continue;

        Storage& inv = g_containers[merchant.inventory_id];
        std::vector<std::string> completed_orders;

        for (const auto& itemId : inv.item_ids) {
            if (g_items.count(itemId)) {
                PhysicalItem& item = g_items[itemId];
                if (item.prototype_id == "document_order" && item.order_data.has_value()) {
                    OrderData& od = item.order_data.value();
                    if (od.status == "in_progress") {
                        int has_qty = countItemsInContainer(merchant.inventory_id, od.item_prototype);
                        if (has_qty >= od.quantity) {
                            if (merchant.currentLocation == od.issuer_id) {
                                if (g_world.regions.count(od.issuer_id)) {
                                    Region& targetReg = g_world.regions[od.issuer_id];
                                    consumeItemsFromContainer(merchant.inventory_id, od.item_prototype, od.quantity);
                                    std::string delivery_cont = od.target_container_id.empty() ? targetReg.vault_id : od.target_container_id;
                                    createItem(od.item_prototype, od.quantity, delivery_cont, g_world.current_day, locStr("engine.reason.order_delivery"));
                                    int payment = od.quantity * od.max_price_per_unit;
                                    createItem(getCoreIdByTag("currency"), payment, safeId, g_world.current_day, locStr("engine.reason.order_payment"));
                                    od.status = "delivered";
                                    item.is_dirty = true;
                                    completed_orders.push_back(itemId);
                                    merchant.currentActivity = locStr("engine.npc.order_completed");
                                }
                            } else {
                                merchant.travelDestination = od.issuer_id;
                                merchant.travelHoursLeft = 24 + (rand() % 24);
                            }
                        } else {
                            if (g_world.regions.count(merchant.currentLocation)) {
                                Region& curReg = g_world.regions[merchant.currentLocation];
                                int needed = od.quantity - has_qty;
                                int available = countItemsInContainer(curReg.vault_id, od.item_prototype);
                                if (available >= needed) {
                                                                        int baseP = 1;
                                        auto db_it = g_db.items.find(od.item_prototype);
                                        if (db_it != g_db.items.end()) baseP = db_it->second.basePrice;
                                        int cost = needed * baseP;
                                    consumeItemsFromContainer(curReg.vault_id, od.item_prototype, needed);
                                    createItem(od.item_prototype, needed, merchant.inventory_id, g_world.current_day, locStr("engine.reason.order_purchase"));
                                    curReg.moneySupply += cost;
                                    merchant.currentActivity = locStr("engine.npc.buying_goods");
                                }
                            }
                        }
                        break;
                    }
                }
            }
        }

        for (const auto& cId : completed_orders) {
            moveItem(cId, archiveId);
        }
    }
}





void processTrekTick() {
    if (!g_world.player_trek.active || g_world.player_trek.paused) return;

    g_world.player_trek.elapsed_hours++;
    bool event_triggered = false;

    // Get current tile type to check terrain
    int current_tile_x = (int)std::round(g_world.player_trek.current_x);
    int current_tile_y = (int)std::round(g_world.player_trek.current_y);
    current_tile_x = std::clamp(current_tile_x, 0, g_world.map.width - 1);
    current_tile_y = std::clamp(current_tile_y, 0, g_world.map.height - 1);
    int tile_idx = current_tile_y * g_world.map.width + current_tile_x;
    uint8_t current_biome_id = g_world.map.grid[tile_idx].biome_id;
    bool is_water_tile = false;
    const BiomeDef* biome = getBiomeById(current_biome_id);
    if (biome) {
        is_water_tile = biome->is_water;
    }

    // Calculate speed with transport multiplier
    double base_speed = g_gameplay_runtime.trek_base_travel_speed;
    double transport_mult = g_world.player_trek.transport_speed_mult;

    // If transport is water-only and we're on land, don't apply speed bonus
    if (g_world.player_trek.transport_water_only && !is_water_tile) {
        transport_mult = 1.0;
    }

    double speed = base_speed * transport_mult;

    std::string current_region = g_world.player_trek.destination_id;
    double min_dist = 9999.0;
    for (const auto& [rid, loc] : g_world.map.locations) {
        double d = std::hypot(loc.x - g_world.player_trek.current_x, loc.y - g_world.player_trek.current_y);
        if (d < min_dist) {
            min_dist = d;
            current_region = rid;
        }
    }
    
    if (g_world.regions.count(current_region)) {
        std::string w = g_world.regions[current_region].weather;
        if (w == "Эфирный шторм" || w == "Метель") speed *= 0.2;
        else if (w == "Дождь" || w == "Тропический ливень" || w == "Снегопад") speed *= 0.7;
    }

    if (!g_world.player_trek.path.empty() && g_world.player_trek.path_index < (int)g_world.player_trek.path.size() - 1) {
        while (speed > 0 && g_world.player_trek.path_index < (int)g_world.player_trek.path.size() - 1) {
            double target_x = g_world.player_trek.path[g_world.player_trek.path_index + 1].first;
            double target_y = g_world.player_trek.path[g_world.player_trek.path_index + 1].second;
            
            double dx = target_x - g_world.player_trek.current_x;
            double dy = target_y - g_world.player_trek.current_y;
            double dist = std::hypot(dx, dy);
            
            if (dist <= speed) {
                g_world.player_trek.current_x = target_x;
                g_world.player_trek.current_y = target_y;
                speed -= dist;
                g_world.player_trek.path_index++;
            } else {
                g_world.player_trek.current_x += (dx / dist) * speed;
                g_world.player_trek.current_y += (dy / dist) * speed;
                speed = 0;
            }
        }
    }

    double cx = g_world.player_trek.current_x;
    double cy = g_world.player_trek.current_y;

    min_dist = 9999.0;
    for (const auto& [rid, loc] : g_world.map.locations) {
        double d = std::hypot(loc.x - cx, loc.y - cy);
        if (d < min_dist) {
            min_dist = d;
            current_region = rid;
        }
    }

    int icx = (int)cx;
    int icy = (int)cy;
    if (icx >= 0 && icx < g_world.map.width && icy >= 0 && icy < g_world.map.height) {
        int idx = icy * g_world.map.width + icx;
        uint8_t t = g_world.map.grid[idx].biome_id;
        std::string b_str = getBiomeStringId(t);

        if (b_str == "river" && g_world.map.grid[idx].bridge_flag == 0 && g_world.map.grid[idx].road_level == 0) {
            std::string rKey = "river_" + std::to_string(icx) + "_" + std::to_string(icy);
            if (g_world.player_trek.seen_object_ids.count(rKey) == 0) {
                g_world.player_trek.seen_object_ids.insert(rKey);
                TrekEvent ev;
                ev.id = "evt_" + generateUUID();
                ev.object_type = "river_crossing";
                ev.description = locStr("engine.trek.river_crossing");
                g_world.player_trek.pending_events.push_back(ev);
                event_triggered = true;
            }
        }
        
        if (b_str == "ruins" && (thread_safe_rand() % 100) < 5) {
            std::string rKey = "ruin_flavor_" + std::to_string(icx) + "_" + std::to_string(icy);
            if (g_world.player_trek.seen_object_ids.count(rKey) == 0) {
                g_world.player_trek.seen_object_ids.insert(rKey);
                TrekEvent ev;
                ev.id = "evt_" + generateUUID();
                ev.object_type = "ruin_discovery";
                ev.description = locStr("engine.trek.ruin_discovery");
                g_world.player_trek.pending_events.push_back(ev);
                event_triggered = true;
            }
        }
    }

    for (const auto& [rid, r] : g_world.regions) {
        for (const auto& c : r.caravans) {
            if (std::hypot(c.x - cx, c.y - cy) <= 2.0) {
                if (g_world.player_trek.seen_object_ids.count(c.id) == 0) {
                    g_world.player_trek.seen_object_ids.insert(c.id);
                    TrekEvent ev;
                    ev.id = "evt_" + generateUUID();
                    ev.object_type = "caravan";
                    ev.sim_object_id = c.id;
                    std::string destName = g_world.regions.count(c.destination) ? g_world.regions[c.destination].name : c.destination;
                    ev.description = locStr("engine.trek.caravan_spotted", {{"wagons", std::to_string(c.wagons)}, {"dest", destName}, {"guards", std::to_string(c.guards)}});
                    g_world.player_trek.pending_events.push_back(ev);
                    event_triggered = true;
                }
            }
        }
    }

    for (const auto& [fid, f] : g_world.factions) {
        for (const auto& a : f.armies) {
            if (std::hypot(a.x - cx, a.y - cy) <= 2.0) {
                if (g_world.player_trek.seen_object_ids.count(a.id) == 0) {
                    g_world.player_trek.seen_object_ids.insert(a.id);
                    TrekEvent ev;
                    ev.id = "evt_" + generateUUID();
                    ev.object_type = "army";
                    ev.sim_object_id = a.id;
                    std::string stateDesc = (a.current_phase == "march") ? locStr("engine.trek.state_march") : locStr("engine.trek.state_combat");
                    if (a.morale < 40) stateDesc = locStr("engine.trek.state_exhausted");
                    ev.description = locStr("engine.trek.army_spotted", {{"faction", f.name}, {"size", std::to_string(a.size)}, {"state", stateDesc}});
                    g_world.player_trek.pending_events.push_back(ev);
                    event_triggered = true;
                }
            }
        }
    }

    if (g_world.regions.count(current_region)) {
        Region& r = g_world.regions[current_region];
        
        if (g_world.player_trek.hours_since_last_bandit >= g_gameplay_runtime.trek_bandit_cooldown_hours) {
            int banditChance = r.threat_level / 10;
            if ((thread_safe_rand() % 100) < banditChance) {
                g_world.player_trek.hours_since_last_bandit = 0;
                TrekEvent ev;
                ev.id = "evt_" + generateUUID();
                ev.object_type = "bandit";
                ev.sim_object_id = "bandits_" + generateUUID();
                ev.description = locStr("engine.trek.bandit_ambush");
                g_world.player_trek.pending_events.push_back(ev);
                event_triggered = true;
            }
        } else {
            g_world.player_trek.hours_since_last_bandit++;
        }
        
        std::string wKey = "weather_" + r.weather;
        if (g_world.player_trek.seen_object_ids.count(wKey) == 0) {
            g_world.player_trek.seen_object_ids.insert(wKey);
            TrekEvent ev;
            ev.id = "evt_" + generateUUID();
            ev.object_type = "weather";
            ev.sim_object_id = r.weather;
            ev.description = locStr("engine.trek.weather_changed", {{"weather", r.weather}});
            ev.can_interact = false;
            g_world.player_trek.pending_events.push_back(ev);
        }
    }

    for (const auto& d : g_world.map.disasters) {
        if (std::hypot(cx - d.epicenter_x, cy - d.epicenter_y) <= d.radius) {
            if (g_world.player_trek.seen_object_ids.count(d.id) == 0) {
                g_world.player_trek.seen_object_ids.insert(d.id);
                TrekEvent ev;
                ev.id = "evt_" + generateUUID();
                ev.object_type = "disaster";
                ev.sim_object_id = d.id;
                std::string dName = d.type;
                if (d.type == "wildfire") dName = "Лесной пожар";
                else if (d.type == "aether_storm") dName = "Эфирный шторм";
                else if (d.type == "monster_invasion") dName = "Орда чудовищ";
                ev.description = locStr("engine.trek.disaster_zone", {{"disaster", dName}});
                g_world.player_trek.pending_events.push_back(ev);
                event_triggered = true;
            }
        }
    }

    if (event_triggered) {
        g_world.player_trek.paused = true;
    }

    if (g_world.player_trek.path.empty() || g_world.player_trek.path_index >= (int)g_world.player_trek.path.size() - 1) {
        g_world.player_trek.active = false;
        TrekEvent ev;
        ev.id = "evt_arrive";
        ev.object_type = "arrival";
        ev.description = locStr("engine.trek.arrival");
        ev.can_interact = false;
        g_world.player_trek.pending_events.push_back(ev);
    }
}


void globalHomeostasis() {
    int starvingRegions = 0;
    std::vector<double> wealthList;
    
    for (const auto& [rid, r] : g_world.regions) {
        if (r.starvation_days > 7) starvingRegions++;
        wealthList.push_back(r.moneySupply);
    }
    
    double globalStarvation = g_world.regions.empty() ? 0.0 : (double)starvingRegions / g_world.regions.size();
    
    int warringFactions = 0;
    for (const auto& [fid, f] : g_world.factions) {
        for (const auto& [tid, status] : f.diplomacy) {
            if (status == "war") {
                warringFactions++;
                break;
            }
        }
    }
    double globalWarRate = g_world.factions.empty() ? 0.0 : (double)warringFactions / g_world.factions.size();
    
    double medianWealth = 0.0;
    if (!wealthList.empty()) {
        std::sort(wealthList.begin(), wealthList.end());
        medianWealth = wealthList[wealthList.size() / 2];
    }

    if (globalStarvation > 0.20) {
        g_world.nexusData["global_harvest_blessing"] = JsonValue(g_world.current_day + 180);
        addNews(locStr("engine.news.harvest_blessing"), "global", 5, "misc");
    }

    if (globalWarRate > 0.50) {
        for (auto& [fid, f] : g_world.factions) {
            f.warExhaustion += 30;
        }
        addNews(locStr("engine.news.war_weariness"), "global", 5, "misc");
    }

    if (medianWealth < 5000.0) {
        g_world.nexusData["global_gold_rush"] = JsonValue(g_world.current_day + 90);
        addNews(locStr("engine.news.gold_rush"), "global", 5, "trade");
    }
}


void hourlyTick() {
    triggerJsHook("onBeforeHourlyTick");
    processConsumption();
    processCaravans();

    processFleets();

    exportGoodsToPortDocks();
    processNavalTrade();

    processShips();

    processCouriers();

    processMerchantOrders();
    processTrekTick();
    
    if (g_world.time.internalHour % 4 == 0) {
        updateWeather();
    }
    
    g_world.time.internalHour++;
    if (g_world.time.internalHour >= 24) {
        g_world.time.internalHour = 0;
        dailyTick();
        if (g_world.current_day % 7 == 0) {
            weeklyTick();
        }
        if (g_world.current_day > 0 && g_world.current_day % 30 == 0) {
            monthlyTick();
        }
        if (g_world.current_day > 0 && g_world.current_day % 360 == 0) {
            globalHomeostasis();
        }
    }
    triggerJsHook("onAfterHourlyTick");
}

// Simulate one day
int availableManpower(const Faction& f, std::unordered_map<std::string, std::unordered_map<std::string, int>>& vaultStocks) {
    int total = 0;
    for (const auto& rid : f.regions) {
        if (g_world.regions.count(rid) == 0) continue;
        const Region& r = g_world.regions.at(rid);
        int weapons = getCategoryAmount(g_world.regions[rid].vault_id, "weapon");
        int food = getFoodAmount(g_world.regions[rid].vault_id);
        // Максимальный резерв ~14% от населения
        int possible = std::min(r.population / 7, weapons);
        if (food < possible * 0.5) continue;
        total += possible;
    }
    return total;
}

void processRulerDiplomacy() {
    std::unordered_map<std::string, std::unordered_map<std::string, int>> vaultStocks;
    {
        std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
        for (const auto& [rid, r] : g_world.regions) {
            if (!r.vault_id.empty() && g_containers.count(r.vault_id)) {
                vaultStocks[rid] = g_containers[r.vault_id].cached_stocks;
            } else {
                vaultStocks[rid] = {};
            }
        }
    }

    std::vector<std::string> fKeys;
    for (const auto& [fid, f] : g_world.factions) fKeys.push_back(fid);

    for (auto& [rId, ruler] : g_world.npcs) {
        if (ruler.type != "ruler" || !ruler.isAlive || ruler.id.find("_heir") != std::string::npos) continue;
        
        if (g_world.factions.count(ruler.factionId) == 0) continue;
        Faction& faction = g_world.factions[ruler.factionId];

        std::string goalKey = ruler.factionId + "_goal";
        if (g_world.nexusData.count(goalKey)) {
            ruler.gmOverride = g_world.nexusData[goalKey]["value"].asString();
        }

        if (!ruler.gmOverride.empty()) {
            ruler.currentGoal = "gm_override -> " + ruler.gmOverride;
            continue;
        }

        int totalWeapons = 0;
        int totalFood = 0;
        for (const auto& rid : faction.regions) {
            if (g_world.regions.count(rid)) {
                totalWeapons += getCategoryAmount(g_world.regions[rid].vault_id, "weapon");
                totalFood += getFoodAmount(g_world.regions[rid].vault_id);
            }
        }
        int security = (totalWeapons > 100 ? 50 : totalWeapons) + (faction.armies.size() * 10);

        std::string capitalRegionId = faction.regions.empty() ? "" : faction.regions[0];
        std::string capitalVault = capitalRegionId.empty() ? "" : g_world.regions[capitalRegionId].vault_id;
        int wealth = capitalRegionId.empty() ? 0 : vaultStocks[capitalRegionId][getCoreIdByTag("currency")];

        int power = availableManpower(faction, vaultStocks);

        // Распределяем нагрузку ИИ: правители думают раз в 3 дня, в разные дни (зависит от хэша ID)
        int ruler_hash = std::hash<std::string>{}(ruler.id) % 3;
        if (g_world.current_day % 3 == ruler_hash) {
            std::set<std::string> neighbors;
            for (const auto& road : g_world.map.roads) {
                if (road.condition == "blocked") continue;
                std::string f1 = g_world.regions.count(road.from) ? g_world.regions[road.from].factionId : "";
                std::string f2 = g_world.regions.count(road.to) ? g_world.regions[road.to].factionId : "";
                if (f1 == ruler.factionId && !f2.empty() && f2 != ruler.factionId) neighbors.insert(f2);
                if (f2 == ruler.factionId && !f1.empty() && f1 != ruler.factionId) neighbors.insert(f1);
            }
            
            int hostile_power = 0;
            int neutral_power = 0;
            std::string best_ally = "";
            int best_ally_power = -1;

            for (const auto& nid : neighbors) {
                if (g_world.factions.count(nid)) {
                    int nPower = availableManpower(g_world.factions[nid], vaultStocks);
                    if (faction.diplomacy[nid] == "war") hostile_power += nPower;
                    else {
                        neutral_power += nPower;
                        if (nPower > best_ally_power) {
                            best_ally_power = nPower;
                            best_ally = nid;
                        }
                    }
                }
            }

            // Динамическая паранойя при окружении
            if (hostile_power > power * 1.5) {
                ruler.rulerPersonality.paranoia = std::min(100, ruler.rulerPersonality.paranoia + 2);
            } else if (hostile_power < power * 0.5) {
                ruler.rulerPersonality.paranoia = std::max(0, ruler.rulerPersonality.paranoia - 1);
            }

            // Защитный союз при высокой паранойе
            if (ruler.rulerPersonality.paranoia > 70 && !best_ally.empty() && faction.diplomacy[best_ally] != "war") {
                { // Лимит на поиск союзов снят
                    ruler.currentGoal = "offer_alliance -> " + best_ally;
                    faction.relations[best_ally] = std::min(100, faction.relations[best_ally] + 20);
                    g_world.factions[best_ally].relations[ruler.factionId] = std::min(100, g_world.factions[best_ally].relations[ruler.factionId] + 20);
                    addNews(locStr("engine.news.diplomacy.defensive_pact", {{"ruler", ruler.name}, {"ally", g_world.factions[best_ally].name}}), "global", 3, "diplomacy");
                }
                continue;
            }

            std::string targetF = "";
            if (!neighbors.empty()) {
                auto it = neighbors.begin();
                std::advance(it, rand() % neighbors.size());
                targetF = *it;
            } else {
                targetF = fKeys[rand() % fKeys.size()];
            }
            
            if (targetF == ruler.factionId || targetF.empty()) continue;
            Faction& targetFaction = g_world.factions[targetF];
            int targetPower = availableManpower(targetFaction, vaultStocks);

            // 1. ПОДДЕРЖКА И УСТАЛОСТЬ (Гомеостаз)
            int avgThreat = 0;
            for (const auto& rid : faction.regions) {
                if (g_world.regions.count(rid)) avgThreat += g_world.regions[rid].threat_level;
            }
            if (!faction.regions.empty()) avgThreat /= faction.regions.size();
            
            ruler.rulerPersonality.supportLevel = std::clamp(100 - avgThreat - faction.warExhaustion, 0, 100);
            
            if (faction.warExhaustion > 0 && (rand() % 100) < 10) faction.warExhaustion--;
            
            // Динамическая агрессивность
            if (faction.warExhaustion == 0 && ruler.rulerPersonality.ambition < 90) {
                if ((rand() % 100) < 5) ruler.rulerPersonality.ambition++;
            } else if (faction.warExhaustion > 50 && ruler.rulerPersonality.ambition > 20) {
                if ((rand() % 100) < 10) ruler.rulerPersonality.ambition--;
            }

            // 2. АВТОМАТИЧЕСКИЙ МИР ПРИ ИСТОЩЕНИИ
            if (faction.diplomacy[targetF] == "war") {
                if (faction.warExhaustion > 80 && targetFaction.warExhaustion > 80) {
                    faction.diplomacy[targetF] = "neutral";
                    targetFaction.diplomacy[ruler.factionId] = "neutral";
                    addNews(locStr("engine.news.diplomacy.peace_treaty", {{"faction1", faction.name}, {"faction2", targetFaction.name}}), "global", 5, "war");
                    continue;
                }
            }

            // 3. НЕЧЕТКАЯ ЛОГИКА АГРЕССИИ
            double powerRatio = targetPower > 0 ? (double)power / targetPower : 2.0;
            double warDesire = (ruler.rulerPersonality.ambition * 0.6) + (powerRatio * 25.0) - (faction.warExhaustion * 0.5) + (ruler.rulerPersonality.supportLevel * 0.2);
            
            std::string aggroKey = ruler.factionId + "_aggro_against_" + targetF;
            if (g_world.nexusData.count(aggroKey) && g_world.nexusData[aggroKey].asInt() > g_world.current_day) {
                warDesire += 30.0;
            }

            bool hasTruce = faction.truceUntil.count(targetF) && faction.truceUntil[targetF] > g_world.current_day;
            // Ограничения на войны сняты
                        if (warDesire > g_gameplay_runtime.war_declare_min_desire && wealth >= g_gameplay_runtime.war_declare_min_wealth && faction.warType == DiplomaticState::PEACE && faction.diplomacy[targetF] != "war" && !hasTruce) { // Снято ограничение в 360 дней и снижен порог богатства
                CasusBelli cb = CasusBelli::BORDER_INCIDENT;
                std::string motiveText = "Территориальные претензии";
                if (targetPower < power * 0.5 && wealth < g_gameplay_runtime.war_imperialism_wealth_ceiling) {
                    cb = CasusBelli::IMPERIALISM;
                    motiveText = "Захват ресурсов и расширение границ";
                } else if (faction.relations[targetF] < -50) {
                    cb = CasusBelli::BORDER_INCIDENT;
                    motiveText = "Кровная вражда и старые обиды";
                } else {
                    for (const auto& trid : targetFaction.regions) {
                        if (g_world.regions.count(trid) && g_world.regions[trid].unrest > 50) {
                            cb = CasusBelli::HUMANITARIAN;
                            motiveText = "Наведение порядка на нестабильных территориях";
                            break;
                        }
                    }
                }
                
                DiplomaticState newWarType = DiplomaticState::BORDER_CONFLICT;
                int totalFood = 0, totalWeapons = 0, totalGold = 0;
                for (const auto& rid : faction.regions) {
                    if (g_world.regions.count(rid) && !g_world.regions[rid].vault_id.empty() && g_containers.count(g_world.regions[rid].vault_id)) {
                        const Storage& vault = g_containers[g_world.regions[rid].vault_id];
                        for (const auto& itemId : vault.item_ids) {
                            if (g_items.count(itemId)) {
                                const PhysicalItem& item = g_items[itemId];
                                std::string cat = g_db.items.count(item.prototype_id) ? g_db.items[item.prototype_id].category : "";
                                if (cat == "consumable" || cat == "raw_food" || cat == "processed_food") totalFood += item.stack_size;
                                else if (cat == "weapon") totalWeapons += item.stack_size;
                                else if (item.prototype_id == getCoreIdByTag("currency")) totalGold += item.stack_size;
                            }
                        }
                    }
                }
                
                if (totalFood >= g_gameplay_runtime.war_total_food_threshold && totalWeapons >= g_gameplay_runtime.war_total_weapons_threshold && totalGold >= g_gameplay_runtime.war_total_gold_threshold) newWarType = DiplomaticState::TOTAL_WAR;
                else if (totalFood >= g_gameplay_runtime.war_limited_food_threshold && totalWeapons >= g_gameplay_runtime.war_limited_weapons_threshold && totalGold >= g_gameplay_runtime.war_limited_gold_threshold) newWarType = DiplomaticState::LIMITED_WAR;
                else if (totalFood >= g_gameplay_runtime.war_border_food_threshold && totalWeapons >= g_gameplay_runtime.war_border_weapons_threshold && totalGold >= g_gameplay_runtime.war_border_gold_threshold) newWarType = DiplomaticState::BORDER_CONFLICT;
                else newWarType = DiplomaticState::PEACE;
                
                if (newWarType != DiplomaticState::PEACE) {
                    ruler.currentGoal = "declare_war -> " + targetF;
                    faction.diplomacy[targetF] = "war";
                    targetFaction.diplomacy[ruler.factionId] = "war";
                    faction.warType = newWarType;
                    faction.currentCasusBelli = cb;
                    if (newWarType == DiplomaticState::LIMITED_WAR && !targetFaction.regions.empty()) {
                        faction.activeWarGoal.targetRegionId = targetFaction.regions[0];
                        faction.activeWarGoal.deadlineDays = 60;
                    }
                    addNews(locStr("engine.news.war.war_declared", {{"ruler", ruler.name}, {"faction", faction.name}, {"target", targetFaction.name}, {"motive", motiveText}}), "global", 5, "war");
                }
            }
            // 3. ИНТРИГИ
            else if (ruler.rulerPersonality.paranoia > 40 && (targetPower + 50) >= power * 0.5) {
                std::string cdKey = ruler.factionId + "_intrigue_cooldown";
                if (!g_world.nexusData.count(cdKey) || g_world.nexusData[cdKey].asInt() <= g_world.current_day) {
                    int activeIntrigues = 0;
                    bool alreadyPlotting = false;
                    for (const auto& intr : g_world.intrigues) {
                        if (intr.initiatorFactionId == ruler.factionId) activeIntrigues++;
                        if (intr.initiatorFactionId == ruler.factionId && intr.targetFactionId == targetF) alreadyPlotting = true;
                    }
                    if (!alreadyPlotting && activeIntrigues < 10) { // Лимит интриг увеличен с 2 до 10
                        std::vector<std::string> intrigueTypes = {"sabotage", "bribery"};
                    if (ruler.rulerPersonality.cruelty > 70) intrigueTypes.push_back("assassination");
                    if (ruler.rulerPersonality.ambition > 60) intrigueTypes.push_back("rebellion");
                    std::string selectedType = intrigueTypes[rand() % intrigueTypes.size()];
                    ruler.currentGoal = "start_intrigue -> " + targetF;
                
                Intrigue intr;
                intr.id = "intr_" + generateUUID();
                intr.type = selectedType;
                intr.initiatorFactionId = ruler.factionId;
                intr.targetFactionId = targetF;
                intr.targetRulerId = targetFaction.rulerId;
                intr.progress = 0;
                intr.requiredProgress = (selectedType == "rebellion") ? 120 : 60;
                intr.progressPerDay = std::max(1, ruler.rulerPersonality.paranoia / 15);
                intr.discoveryChance = 3;
                intr.isDiscovered = false;
                intr.startDay = g_world.current_day;
                    g_world.intrigues.push_back(intr);
                    
                    addNews(locStr("engine.news.war.intrigue_launched", {{"ruler", ruler.name}, {"type", selectedType}, {"target", targetFaction.name}}), "global", 3, "war");
                    }
                }
            }
            // 4. ЭКОНОМИКА И СОЮЗЫ
            else if (ruler.rulerPersonality.stewardship > 50 && wealth < 10000) {
                ruler.currentGoal = "trade_pact -> " + targetF;
                faction.relations[targetF] += 10;
                if (!capitalVault.empty()) {
                    createItem(getCoreIdByTag("currency"), 2000, capitalVault, g_world.current_day, "Торговое соглашение");
                    vaultStocks[capitalRegionId][getCoreIdByTag("currency")] += 2000;
                }
                addNews(locStr("engine.news.diplomacy.trade_agreement", {{"ruler", ruler.name}, {"target", targetFaction.name}}), "global", 2, "misc");
            }
            // 5. ДИПЛОМАТИЯ И БРАКИ
            else if (ruler.rulerPersonality.diplomacy > 55 && faction.relations[targetF] > 50) {
                bool hasHeir = !ruler.heir.empty() && g_world.npcs.count(ruler.heir);
                bool targetHasHeir = !targetFaction.rulerId.empty() && g_world.npcs.count(targetFaction.rulerId) && !g_world.npcs[targetFaction.rulerId].heir.empty();
                
                if (hasHeir && targetHasHeir && (rand() % 100) < 40) {
                    ruler.currentGoal = "marriage_alliance -> " + targetF;
                    faction.relations[targetF] = 100;
                    targetFaction.relations[ruler.factionId] = 100;
                    addNews(locStr("engine.news.diplomacy.dynastic_marriage", {{"faction1", faction.name}, {"faction2", targetFaction.name}}), "global", 5, "misc");
                } else {
                    ruler.currentGoal = "offer_alliance -> " + targetF;
                    faction.relations[targetF] = std::min(100, faction.relations[targetF] + 20);
                    addNews(locStr("engine.news.diplomacy.alliance_strengthened", {{"ruler", ruler.name}, {"target", targetFaction.name}}), "global", 2, "misc");
                }
            }
        }
    }
    
    for (auto& [fid, faction] : g_world.factions) {
        int power = availableManpower(faction, vaultStocks);
        std::string atWarWith = "";
        for (const auto& [k, v] : faction.diplomacy) {
            if (v == "war") { atWarWith = k; break; }
        }

        if (!atWarWith.empty()) {
            std::string homeRegionId = "";
            for (const auto& rid : faction.regions) {
                if (g_world.regions.count(rid)) {
                                        int w = vaultStocks[rid][getCoreIdByTag("weapon")];
                    if (w > 10) { homeRegionId = rid; break; }
                }
            }

            if (!homeRegionId.empty() && power > 100) {
                Region& homeRegion = g_world.regions[homeRegionId];
                std::string targetRegionId = "";
                if (faction.warType == DiplomaticState::LIMITED_WAR && !faction.activeWarGoal.targetRegionId.empty()) {
                    targetRegionId = faction.activeWarGoal.targetRegionId;
                } else {
                    targetRegionId = g_world.factions[atWarWith].regions.empty() ? "" : g_world.factions[atWarWith].regions[0];
                }
                
                bool alreadyAttacking = false;
                for (const auto& a : faction.armies) {
                    if (a.destination == targetRegionId) alreadyAttacking = true;
                }

                if (!targetRegionId.empty() && !alreadyAttacking) {
                    std::vector<std::pair<int,int>> army_path;
                    if (g_path_cache.count({homeRegionId, targetRegionId})) {
                        army_path = g_path_cache[{homeRegionId, targetRegionId}];
                    }
                    if (army_path.empty()) continue; // Нет наземного пути для атаки

                    // Генерал собирает от 40% до 75% доступного резерва, оставляя часть на защиту
                    int armySize = power * (0.40 + (rand() % 35) / 100.0);
                    if (armySize < 50) armySize = power;
                    if (armySize < 50) continue; // Армии меньше 50 человек не формируются

                    int weaponsAvailable = vaultStocks[homeRegionId][getCoreIdByTag("weapon")];
                    int foodAvailable = getFoodAmount(homeRegion.vault_id);
                    
                    // --- ИНТЕГРАЦИЯ ДЕМОГРАФИИ И АРМИИ ---
                    int maxDraft = homeRegion.population * 0.30; // Лимит призыва увеличен с 3% до 30% (Тотальная мобилизация)
                    if (armySize > maxDraft) armySize = maxDraft;
                    
                    // Забираем людей из региона
                    double draftFactor = 1.0 - ((double)armySize / std::max(1, homeRegion.population));
                    for (int p = 0; p <= 120; p++) homeRegion.age_pyramid[p] *= draftFactor;
                    homeRegion.population -= armySize;

                    int estimated_days = army_path.empty() ? 30 : (int)(army_path.size() / 3.0) * 2 + 15;
                    int daily_need = std::max(1, (int)(armySize * 0.02));
                    int calculatedFoodNeed = daily_need * estimated_days;
                    
                    // Оставляем городу еды минимум на неделю, чтобы не вызвать голодомор
                    int cityReserve = homeRegion.population * 0.005 * 7; 
                    int safeFoodAvailable = std::max(0, foodAvailable - cityReserve);
                    
                    int foodToTake = std::min(calculatedFoodNeed, safeFoodAvailable);
                    if (foodToTake < calculatedFoodNeed * 0.3) {
                        // Если еды критически мало, берем сколько нужно, но не больше чем есть вообще
                        foodToTake = std::min(calculatedFoodNeed, foodAvailable);
                    }
                    
                    std::string w_id = getCoreIdByTag("weapon");
                    std::string f_id = getCoreIdByTag("food");
                    int weaponsToTake = std::min(armySize, weaponsAvailable);
                    
                    int c = consumeItemsFromContainer(homeRegion.vault_id, w_id, weaponsToTake);
                    vaultStocks[homeRegionId][w_id] -= c;
                    
                    int foodTaken = consumeCategory(homeRegion.vault_id, "food", foodToTake);
                    
                    std::string armyChestId = createContainer("army_supply_chest", fid, 999999, 1000, homeRegionId);
                    if (foodTaken > 0) createItem(f_id, foodTaken, armyChestId, g_world.current_day, "Army supplies");
                    
                    int armyMorale = 100;
                    if (weaponsToTake < armySize * 0.5) armyMorale -= 25;
                    if (foodToTake < armySize) armyMorale -= 25;
                    
                    Army army;
                    army.id = "army_" + generateUUID();
                    army.size = armySize;
                    army.morale = armyMorale;
                    army.location = homeRegionId;
                    army.destination = targetRegionId;
                    army.daysToMove = 3;
                    army.siegeDays = -1;
                    army.supply_chest_id = armyChestId;
                    
                    if (g_path_cache.count({homeRegionId, targetRegionId})) {
                        army.path = g_path_cache[{homeRegionId, targetRegionId}];
                        if (!army.path.empty()) {
                            army.x = army.path[0].first;
                            army.y = army.path[0].second;
                        }
                    }
                    
                    faction.armies.push_back(army);
                    std::string targetName = g_world.regions.count(targetRegionId) ? g_world.regions[targetRegionId].name : targetRegionId;
                    addNews(locStr("engine.news.warmy_deployed", {{"faction", faction.name}, {"size", std::to_string(armySize)}, {"origin", homeRegion.name}, {"target", targetName}}), homeRegionId, 4, "war");
                }
            }
        }
    }
}

void checkRulerDeaths() {
    std::vector<std::string> deadRulers;
    for (auto& [id, npc] : g_world.npcs) {
        if (npc.type == "ruler" && npc.isAlive) {
            std::string capital;
            if (g_world.factions.count(npc.factionId) && !g_world.factions[npc.factionId].regions.empty()) {
                capital = g_world.factions[npc.factionId].regions[0];
            }
            
            if (!capital.empty() && g_world.regions.count(capital)) {
                Region& capReg = g_world.regions[capital];
                int totalFood = getFoodAmount(capReg.vault_id);
                
                if (totalFood < 20) {
                    std::string f_id = getCoreIdByTag("food");
                    double foodPrice = capReg.markets[f_id];
                    if (foodPrice <= 0) {
                        auto db_it = g_db.items.find(f_id);
                        foodPrice = (db_it != g_db.items.end() && db_it->second.basePrice > 0) ? db_it->second.basePrice : 5;
                    }
                    
                    if (capReg.moneySupply >= foodPrice * 10) {
                        capReg.moneySupply -= foodPrice * 10;
                        createItem(f_id, 10, capReg.vault_id, g_world.current_day, "State Purchase");
                        addNews("Ruler supplied", capital, 1, "trade");
                        continue; 
                    }
                }
            }

            if ((rand() % 1000) < 2) {
                npc.isAlive = false;
                deadRulers.push_back(id);
                addNews("Ruler starved", "global", 5, "disaster");
            }
            else if ((rand() % 10000) < 1) {
                npc.isAlive = false;
                deadRulers.push_back(id);
                addNews("Ruler died of old age", "global", 5, "misc");
            }
        }
    }
    for (const auto& id : deadRulers) {
        NPC& r = g_world.npcs[id];
        if (!r.heir.empty() && g_world.npcs.count(r.heir)) {
            NPC& heir = g_world.npcs[r.heir];
            g_world.factions[r.factionId].rulerId = heir.id;
            heir.profession = locStr("engine.npc.ruler");
            addNews(locStr("engine.news.succession", {{"ruler", r.name}, {"heir", heir.name}}), "global", 5, "misc");
        } else {
            std::string capital;
            if (!g_world.factions[r.factionId].regions.empty()) capital = g_world.factions[r.factionId].regions[0];
            addNews(locStr("engine.news.no_heir_crisis", {{"ruler", r.name}}), "global", 5, "disaster");
            if (!capital.empty() && g_world.regions.count(capital)) {
                std::string vault = g_world.regions[capital].vault_id;
                std::string w_id = getCoreIdByTag("weapon");
                int w = countItemsInContainer(vault, w_id);
                consumeItemsFromContainer(vault, w_id, w * 0.5);
            }
        }
    }
}

void processIntrigues() {
    for (int i = g_world.intrigues.size() - 1; i >= 0; i--) {
        auto& intr = g_world.intrigues[i];
        
        std::string tName = locStr("engine.intrigue." + intr.type);
        std::string initName = g_world.factions[intr.initiatorFactionId].name;
        std::string targetName = g_world.factions[intr.targetFactionId].name;

        if (intr.phase == "recruitment" || intr.phase == "") {
            for (auto& [nid, npc] : g_world.npcs) {
                if (npc.isAlive && npc.personality.greed > 60 && npc.factionId != intr.targetFactionId) {
                    intr.agent_id = nid;
                    intr.phase = "espionage";
                    break;
                }
            }
            if (intr.agent_id.empty()) {
                intr.progress += 1;
                if (intr.progress > 30) g_world.intrigues.erase(g_world.intrigues.begin() + i);
                continue;
            }
        } else if (intr.phase == "espionage") {
            intr.progress += intr.progressPerDay;
            if (intr.progress >= intr.requiredProgress) intr.phase = "execution";
        } else if (intr.phase == "execution") {
            if (!intr.isDiscovered && (rand() % 100) < intr.discoveryChance) {
                intr.isDiscovered = true;
                std::string cdKey = intr.initiatorFactionId + "_intrigue_cooldown";
                g_world.nexusData[cdKey] = JsonValue(g_world.current_day + 30);
                addNews(locStr("engine.news.intrigue_discovered", {{"type", tName}, {"initiator", initName}, {"target", targetName}}), "global", 4, "war");
                g_world.factions[intr.targetFactionId].relations[intr.initiatorFactionId] -= 60;
                
                if (!intr.agent_id.empty() && g_world.npcs.count(intr.agent_id)) {
                    NPC& agent = g_world.npcs[intr.agent_id];
                    agent.currentLocation = locStr("engine.npc.prison_of", {{"target", targetName}});
                    agent.currentActivity = locStr("engine.npc.in_prison");
                    agent.hp -= 10;
                    addNews(locStr("engine.news.agent_captured", {{"agent", agent.name}, {"type", tName}}), "global", 3, "misc");
                }

                if (g_world.factions[intr.targetFactionId].relations[intr.initiatorFactionId] < -50) {
                    if (g_world.current_day > 180) { 
                        g_world.factions[intr.targetFactionId].diplomacy[intr.initiatorFactionId] = "war";
                        g_world.factions[intr.initiatorFactionId].diplomacy[intr.targetFactionId] = "war";
                        addNews(locStr("engine.news.war_from_intrigue"), "global", 5, "war");
                    } else {
                        addNews(locStr("engine.news.diplomatic_crisis"), "global", 4, "diplomacy");
                    }
                }
                g_world.intrigues.erase(g_world.intrigues.begin() + i);
                continue;
            }

            if (intr.type == "assassination" && !intr.targetRulerId.empty() && g_world.npcs.count(intr.targetRulerId)) {
                g_world.npcs[intr.targetRulerId].isAlive = false;
                g_world.npcs[intr.targetRulerId].alive = false;
                std::string newsId = addNews(locStr("engine.news.ruler_assassinated", {{"target", targetName}, {"initiator", initName}}), "global", 5, "war");
                g_world.nexusData[intr.targetFactionId + "_last_disaster_news"] = JsonValue(newsId);
                g_world.nexusData[intr.targetFactionId + "_last_disaster_day"] = JsonValue(g_world.current_day);
                g_world.nexusData[intr.targetFactionId + "_last_disaster_type"] = JsonValue(locStr("engine.disaster.ruler_assassinated"));
            } else if (intr.type == "sabotage") {
                std::string cap;
                if (!g_world.factions[intr.targetFactionId].regions.empty()) cap = g_world.factions[intr.targetFactionId].regions[0];
                if (!cap.empty() && g_world.regions.count(cap)) {
                    std::string vault = g_world.regions[cap].vault_id;
                    std::string w_id = getCoreIdByTag("weapon");
                    int w = countItemsInContainer(vault, w_id);
                    consumeItemsFromContainer(vault, w_id, w * 0.1);
                    addNews(locStr("engine.news.sabotage", {{"region", g_world.regions[cap].name}, {"target", targetName}, {"initiator", initName}}), cap, 3, "disaster");
                }
            } else if (intr.type == "rebellion") {
                for (const auto& rid : g_world.factions[intr.targetFactionId].regions) {
                    if(g_world.regions.count(rid)) {
                        g_world.regions[rid].population *= 0.7;
                        std::string w_id = getCoreIdByTag("weapon");
                        int w = countItemsInContainer(g_world.regions[rid].vault_id, w_id);
                        consumeItemsFromContainer(g_world.regions[rid].vault_id, w_id, w * 0.4);
                        std::string newsId = addNews(locStr("engine.news.rebellion", {{"region", g_world.regions[rid].name}, {"target", targetName}, {"initiator", initName}}), rid, 5, "war");
                        g_world.nexusData[intr.targetFactionId + "_last_disaster_news"] = JsonValue(newsId);
                        g_world.nexusData[intr.targetFactionId + "_last_disaster_day"] = JsonValue(g_world.current_day);
                        g_world.nexusData[intr.targetFactionId + "_last_disaster_type"] = JsonValue(locStr("engine.disaster.rebellion"));
                        break; 
                    }
                }
            } else if (intr.type == "bribery") {
                std::string cap;
                if (!g_world.factions[intr.targetFactionId].regions.empty()) cap = g_world.factions[intr.targetFactionId].regions[0];
                if (!cap.empty() && g_world.regions.count(cap)) {
                    double stolen = g_world.regions[cap].moneySupply * 0.1;
                    g_world.regions[cap].moneySupply -= stolen;
                    std::string initCap = g_world.factions[intr.initiatorFactionId].regions.empty() ? "" : g_world.factions[intr.initiatorFactionId].regions[0];
                    if (!initCap.empty() && g_world.regions.count(initCap)) {
                        g_world.regions[initCap].moneySupply += stolen;
                        std::string g_id = getCoreIdByTag("currency");
                        int goldAmount = stolen;
                        consumeItemsFromContainer(g_world.regions[cap].vault_id, g_id, goldAmount);
                        createItem(g_id, goldAmount, g_world.regions[initCap].vault_id, g_world.current_day, locStr("engine.reason.bribery"));
                    }
                    addNews(locStr("engine.news.corruption", {{"target", targetName}, {"initiator", initName}}), cap, 4, "war");
                }
            }
            std::string aggroKey = intr.initiatorFactionId + "_aggro_against_" + intr.targetFactionId;
            g_world.nexusData[aggroKey] = JsonValue(g_world.current_day + 90);
            std::string cdKey = intr.initiatorFactionId + "_intrigue_cooldown";
            g_world.nexusData[cdKey] = JsonValue(g_world.current_day + 60);
            intr.phase = "cover_up";
        } else if (intr.phase == "cover_up") {
            if ((rand() % 100) < 20) {
                if (!intr.agent_id.empty() && g_world.npcs.count(intr.agent_id)) {
                    NPC& agent = g_world.npcs[intr.agent_id];
                    agent.currentLocation = locStr("engine.npc.prison_of", {{"target", targetName}});
                    agent.currentActivity = locStr("engine.npc.in_prison");
                    addNews(locStr("engine.news.agent_caught_fleeing", {{"agent", agent.name}}), "global", 3, "misc");
                }
            }
            g_world.intrigues.erase(g_world.intrigues.begin() + i);
        }
    }
}

std::string processGmIntervention(const JsonValue& command) {
    std::string cmd = command["command"].asString();
    const JsonValue& args = command["args"];
    std::string feedback = "";

    if (cmd == "buildShip") {
        std::string regionId = args["regionId"].asString();
        ShipType sType = stringToShipType(args["shipType"].asString());
        std::string ownerId = args["ownerId"].asString();

        if (g_world.regions.count(regionId) && g_world.port_facilities.count(regionId)) {
            PortFacility& port = g_world.port_facilities[regionId];
            if (!port.has_shipyard) {
                feedback = locStr("engine.gm.shipyard_no_port", {{"region", g_world.regions[regionId].name}});
            } else {
                std::string capitalRegionId = "";
                if (g_world.factions.count(ownerId) && !g_world.factions[ownerId].regions.empty()) {
                    capitalRegionId = g_world.factions[ownerId].regions[0];
                }
                std::string vaultToUse = capitalRegionId.empty() ? g_world.regions[regionId].vault_id : g_world.regions[capitalRegionId].vault_id;
                const GameplayRuntimeConfig::ShipTypeDescriptor* shipDescriptor =
                    getShipTypeDescriptor(shipTypeToString(sType));

                int woodCost = getShipBuildCost(
                    shipDescriptor,
                    "building",
                    (sType == ShipType::WAR_GALLEY || sType == ShipType::WAR_FRIGATE) ? 800 : 500
                );
                int ironCost = getShipBuildCost(
                    shipDescriptor,
                    "metal_ingot",
                    (sType == ShipType::WAR_GALLEY || sType == ShipType::WAR_FRIGATE) ? 300 : 100
                );
                int clothCost = getShipBuildCost(
                    shipDescriptor,
                    "cloth",
                    (sType == ShipType::MERCHANT || sType == ShipType::TRANSPORT) ? 50 : 0
                );
                int weaponCost = getShipBuildCost(
                    shipDescriptor,
                    "weapon",
                    (sType == ShipType::WAR_GALLEY || sType == ShipType::WAR_FRIGATE) ? 50 : 0
                );
                int goldCost = getShipBuildCost(
                    shipDescriptor,
                    "currency",
                    (sType == ShipType::WAR_GALLEY || sType == ShipType::WAR_FRIGATE) ? 1000 : 0
                );

                std::string w_id = getCoreIdByTag("building");
                std::string i_id = getCoreIdByTag("metal_ingot");
                std::string c_id = getCoreIdByTag("cloth");
                std::string wp_id = getCoreIdByTag("weapon");
                std::string g_id = getCoreIdByTag("currency");

                int woodAvail = countItemsInContainer(vaultToUse, w_id);
                int ironAvail = countItemsInContainer(vaultToUse, i_id);
                int clothAvail = countItemsInContainer(vaultToUse, c_id);
                int weaponAvail = countItemsInContainer(vaultToUse, wp_id);
                int goldAvail = countItemsInContainer(vaultToUse, g_id);

                if (woodAvail >= woodCost && ironAvail >= ironCost && clothAvail >= clothCost && weaponAvail >= weaponCost && goldAvail >= goldCost) {
                    consumeItemsFromContainer(vaultToUse, w_id, woodCost);
                    consumeItemsFromContainer(vaultToUse, i_id, ironCost);
                    if (clothCost > 0) consumeItemsFromContainer(vaultToUse, c_id, clothCost);
                    if (weaponCost > 0) consumeItemsFromContainer(vaultToUse, wp_id, weaponCost);
                    if (goldCost > 0) consumeItemsFromContainer(vaultToUse, g_id, goldCost);

                    ShipBuildOrder order;
                    order.id = "build_" + generateUUID();
                    order.type = sType;
                    order.days_left =
                        (shipDescriptor && shipDescriptor->has_build_days)
                            ? std::max(1, shipDescriptor->build_days)
                            : ((sType == ShipType::WAR_GALLEY || sType == ShipType::WAR_FRIGATE) ? 30 : 14);
                    order.owner_id = ownerId;
                    port.build_queue.push_back(order);
                    
                    feedback = locStr("engine.gm.shipyard_built", {{"type", shipTypeToString(sType)}, {"region", g_world.regions[regionId].name}});
                    g_world.gmInterventionHistory.push_back(cmd);
                } else {
                    feedback = locStr("engine.gm.shipyard_no_res");
                }
            }
        }
    } else if (cmd == "buildPort") {
        std::string regionId = args["regionId"].asString();
        std::string factionId = args["factionId"].asString();
        if (g_world.regions.count(regionId)) {
            if (g_world.port_facilities.count(regionId)) {
                feedback = locStr("engine.gm.port_exists", {{"region", g_world.regions[regionId].name}});
            } else {
                Region& reg = g_world.regions[regionId];
                std::string capitalRegionId = "";
                if (g_world.factions.count(factionId) && !g_world.factions[factionId].regions.empty()) {
                    capitalRegionId = g_world.factions[factionId].regions[0];
                }
                std::string vaultToUse = capitalRegionId.empty() ? reg.vault_id : g_world.regions[capitalRegionId].vault_id;

                int stoneCost = g_gameplay_runtime.infra_port_stone_cost;
                int woodCost = g_gameplay_runtime.infra_port_wood_cost;
                int goldCost = g_gameplay_runtime.build_port_gold_cost;

                std::string s_id = getCoreIdByTag("stone");
                std::string w_id = getCoreIdByTag("building");
                std::string g_id = getCoreIdByTag("currency");

                int stoneAvail = countItemsInContainer(vaultToUse, s_id);
                int woodAvail = countItemsInContainer(vaultToUse, w_id);
                int goldAvail = countItemsInContainer(vaultToUse, g_id);

                if (stoneAvail >= stoneCost && woodAvail >= woodCost && goldAvail >= goldCost) {
                    consumeItemsFromContainer(vaultToUse, s_id, stoneCost);
                    consumeItemsFromContainer(vaultToUse, w_id, woodCost);
                    consumeItemsFromContainer(vaultToUse, g_id, goldCost);

                    PortFacility port;
                    port.type = PortType::TRADE;
                    port.dock_container_id = createContainer("port_dock", factionId, 999999, 1000, regionId);
                    port.has_shipyard = false;
                    g_world.port_facilities[regionId] = port;

                    feedback = locStr("engine.gm.port_built", {{"region", reg.name}});
                    addNews(locStr("engine.news.port_built_news", {{"faction", g_world.factions[factionId].name}, {"region", reg.name}}), regionId, 4, "politics");
                    g_world.gmInterventionHistory.push_back(cmd);
                } else {
                    feedback = locStr("engine.gm.port_no_res");
                }
            }
        } else {
            feedback = locStr("engine.gm.port_not_found");
        }
    } else if (cmd == "navalBlockade") {
        std::string factionId = args["factionId"].asString();
        std::string regionId = args["regionId"].asString();
        if (g_world.regions.count(regionId) && g_world.port_facilities.count(regionId)) {
            g_world.port_facilities[regionId].is_blockaded = true;
            feedback = locStr("engine.gm.blockade_set", {{"faction", g_world.factions[factionId].name}, {"region", g_world.regions[regionId].name}});
            addNews(locStr("engine.news.blockade_set_news", {{"region", g_world.regions[regionId].name}}), regionId, 4, "war");
            g_world.gmInterventionHistory.push_back(cmd);
        } else {
            feedback = locStr("engine.gm.blockade_no_port");
        }
    } else if (cmd == "upgradePort") {
        std::string regionId = args["regionId"].asString();
        if (g_world.regions.count(regionId) && g_world.port_facilities.count(regionId)) {
            PortFacility& port = g_world.port_facilities[regionId];
            std::string factionId = g_world.regions[regionId].factionId;
            std::string capitalRegionId = "";
            if (g_world.factions.count(factionId) && !g_world.factions[factionId].regions.empty()) {
                capitalRegionId = g_world.factions[factionId].regions[0];
            }
            std::string vaultToUse = capitalRegionId.empty() ? g_world.regions[regionId].vault_id : g_world.regions[capitalRegionId].vault_id;

            int stoneCost = g_gameplay_runtime.infra_port_upgrade_stone_per_level * port.level;
            int woodCost = g_gameplay_runtime.infra_port_upgrade_wood_per_level * port.level;
            
            std::string s_id = getCoreIdByTag("stone");
            std::string w_id = getCoreIdByTag("building");

            int stoneAvail = countItemsInContainer(vaultToUse, s_id);
            int woodAvail = countItemsInContainer(vaultToUse, w_id);

            if (stoneAvail >= stoneCost && woodAvail >= woodCost) {
                consumeItemsFromContainer(vaultToUse, s_id, stoneCost);
                consumeItemsFromContainer(vaultToUse, w_id, woodCost);
                port.level++;
                if (port.level >= 3 && !port.has_shipyard) port.has_shipyard = true;
                feedback = locStr("engine.gm.port_upgraded", {{"region", g_world.regions[regionId].name}, {"level", std::to_string(port.level)}});
                g_world.gmInterventionHistory.push_back(cmd);
            } else {
                feedback = locStr("engine.gm.port_upg_no_res");
            }
        }
    } else if (cmd == "gmPurchaseGoods") {
        std::string factionId = args["factionId"].asString();
        std::string regionId = args["regionId"].asString();
                std::string goodType = args["goodType"].asString();
        int quantity = args["quantity"].asInt();

        if (g_world.factions.count(factionId) && g_world.regions.count(regionId) && quantity > 0) {
            Faction& fac = g_world.factions[factionId];
            Region& reg = g_world.regions[regionId];
            double price = reg.markets[goodType];
            if (price == 0) price = 1;
            int cost = price * quantity;

            int supply = countItemsInContainer(reg.vault_id, goodType);
            std::string capitalRegionId = fac.regions.empty() ? "" : fac.regions[0];
            std::string g_id = getCoreIdByTag("currency");
            int goldAvailable = capitalRegionId.empty() ? 0 : countItemsInContainer(g_world.regions[capitalRegionId].vault_id, g_id);

            if (supply < quantity) {
                feedback = locStr("engine.gm.econ_no_goods", {{"good", goodType}, {"region", reg.name}});
            } else if (goldAvailable < cost) {
                feedback = locStr("engine.gm.econ_no_gold", {{"faction", fac.name}, {"cost", std::to_string(cost)}});
            } else {
                consumeItemsFromContainer(reg.vault_id, goodType, quantity);
                consumeItemsFromContainer(g_world.regions[capitalRegionId].vault_id, g_id, cost);
                createItem(goodType, quantity, g_world.regions[capitalRegionId].vault_id, g_world.current_day, "Закупка ГМ");
                reg.moneySupply += cost;
                if ((double)quantity / (supply + quantity) > 0.2) {
                    reg.markets[goodType] = price * 1.15;
                }
                feedback = locStr("engine.gm.econ_bought", {{"faction", fac.name}, {"qty", std::to_string(quantity)}, {"good", goodType}, {"region", reg.name}, {"cost", std::to_string(cost)}});
                g_world.gmInterventionHistory.push_back(cmd);
            }
        }
    } else if (cmd == "gmSellGoods") {
        std::string factionId = args["factionId"].asString();
        std::string regionId = args["regionId"].asString();
        std::string goodTypeStr = args["goodType"].asString();
        int quantity = args.has("quantity") ? args["quantity"].asInt() : 0;

        if (g_world.factions.count(factionId) && g_world.regions.count(regionId) && quantity > 0) {
            Faction& fac = g_world.factions[factionId];
            Region& reg = g_world.regions[regionId];
            std::string capitalRegionId = fac.regions.empty() ? "" : fac.regions[0];
            int supply = capitalRegionId.empty() ? 0 : countItemsInContainer(g_world.regions[capitalRegionId].vault_id, goodTypeStr);

            if (supply < quantity) {
                feedback = locStr("engine.gm.econ_no_goods_fac", {{"faction", fac.name}, {"good", goodTypeStr}});
            } else {
                double price = reg.markets.count(goodTypeStr) ? reg.markets.at(goodTypeStr) : 1.0;
                if (price <= 0) price = 1.0;
                int revenue = price * quantity;

                consumeItemsFromContainer(g_world.regions[capitalRegionId].vault_id, goodTypeStr, quantity);
                createItem(goodTypeStr, quantity, reg.vault_id, g_world.current_day, "Продажа ГМ");
                reg.moneySupply = std::max(0.0, reg.moneySupply - (double)revenue);
                createItem(getCoreIdByTag("currency"), revenue, g_world.regions[capitalRegionId].vault_id, g_world.current_day, "GM Revenue");

                feedback = locStr("engine.gm.econ_sold", {{"faction", fac.name}, {"qty", std::to_string(quantity)}, {"good", goodTypeStr}, {"region", reg.name}, {"rev", std::to_string(revenue)}});
                g_world.gmInterventionHistory.push_back(cmd);
            }
        }
    } else if (cmd == "gmInvestInFacility") {
        std::string factionId = args["factionId"].asString();
        std::string regionId = args["regionId"].asString();
        std::string facilityType = args["facilityType"].asString();
        std::string action = args["action"].asString();

        if (g_world.factions.count(factionId) && g_world.regions.count(regionId)) {
            Faction& fac = g_world.factions[factionId];
            Region& reg = g_world.regions[regionId];
            std::string capitalRegionId = fac.regions.empty() ? "" : fac.regions[0];
            std::string g_id = getCoreIdByTag("currency");
            int goldAvailable = capitalRegionId.empty() ? 0 : countItemsInContainer(g_world.regions[capitalRegionId].vault_id, g_id);

            if (action == "repair") {
                int cost = 500;
                if (goldAvailable >= cost) {
                    consumeItemsFromContainer(g_world.regions[capitalRegionId].vault_id, g_id, cost);
                    reg.facilities[facilityType].durability = 100;
                    feedback = locStr("engine.gm.invest_repaired", {{"faction", fac.name}, {"facility", facilityType}, {"region", reg.name}});
                    g_world.gmInterventionHistory.push_back(cmd);
                } else {
                    feedback = locStr("engine.gm.invest_no_gold_rep", {{"faction", fac.name}, {"cost", std::to_string(cost)}});
                }
            } else if (action == "upgrade") {
                int cost = 2000;
                if (goldAvailable >= cost) {
                    consumeItemsFromContainer(g_world.regions[capitalRegionId].vault_id, g_id, cost);
                    reg.facilities[facilityType].level += 1;
                    feedback = locStr("engine.gm.invest_upgraded", {{"faction", fac.name}, {"facility", facilityType}, {"region", reg.name}});
                    g_world.gmInterventionHistory.push_back(cmd);
                } else {
                    feedback = locStr("engine.gm.invest_no_gold_upg", {{"faction", fac.name}, {"cost", std::to_string(cost)}});
                }
            }
        }
    } else if (cmd == "gmRaiseMilitia") {
        std::string factionId = args["factionId"].asString();
        std::string regionId = args["regionId"].asString();

        if (g_world.factions.count(factionId) && g_world.regions.count(regionId)) {
            Faction& fac = g_world.factions[factionId];
            Region& reg = g_world.regions[regionId];
            int drafts = reg.population * 0.05;
            reg.population -= drafts;

            std::string w_id = getCoreIdByTag("weapon");
            std::string f_id = getCoreIdByTag("food");
            int weaponsNeeded = drafts * 0.8;
            int foodNeeded = std::max(1, (int)(drafts * 0.02 * 14)); 
            int weaponsTaken = consumeItemsFromContainer(reg.vault_id, w_id, weaponsNeeded);
            int foodTaken = consumeCategory(reg.vault_id, "food", foodNeeded);

            std::string militiaChestId = createContainer("army_supply_chest", fac.id, 999999, 1000, regionId);
            if (foodTaken > 0) createItem(f_id, foodTaken, militiaChestId, g_world.current_day, "Militia");

            feedback = locStr("engine.gm.militia_raised", {{"faction", fac.name}, {"drafts", std::to_string(drafts)}, {"region", reg.name}, {"weapons", std::to_string(weaponsTaken)}});
            g_world.gmInterventionHistory.push_back(cmd);
        }
    } else if (cmd == "gmSpreadRumor") {
        std::string factionId = args["factionId"].asString();
        std::string targetFactionId = args["targetFactionId"].asString();
        int invest = args["investmentGold"].asInt();
        std::string type = args["type"].asString();

        if (g_world.factions.count(factionId) && g_world.factions.count(targetFactionId)) {
            Faction& fac = g_world.factions[factionId];
            Faction& targetFac = g_world.factions[targetFactionId];
            std::string capitalRegionId = fac.regions.empty() ? "" : fac.regions[0];
            std::string g_id = getCoreIdByTag("currency");
            int goldAvailable = capitalRegionId.empty() ? 0 : countItemsInContainer(g_world.regions[capitalRegionId].vault_id, g_id);

            if (goldAvailable >= invest) {
                consumeItemsFromContainer(g_world.regions[capitalRegionId].vault_id, g_id, invest);
                int power = std::max(1, invest / 500);

                if (type == "slander") {
                    std::string targetCapitalId = targetFac.regions.empty() ? "" : targetFac.regions[0];
                    int foodLost = 0;
                    if (!targetCapitalId.empty() && g_world.regions.count(targetCapitalId)) {
                        foodLost = countItemsInContainer(g_world.regions[targetCapitalId].vault_id, getCoreIdByTag("food")) * 0.2;
                        consumeItemsFromContainer(g_world.regions[targetCapitalId].vault_id, getCoreIdByTag("food"), foodLost);
                    }
                    feedback = locStr("engine.gm.rumor_slander", {{"faction", fac.name}, {"target", targetFac.name}, {"food", std::to_string(foodLost)}});
                } else {
                    fac.relations[targetFactionId] = std::min(100, fac.relations[targetFactionId] + power * 2);
                    feedback = locStr("engine.gm.rumor_praise", {{"faction", fac.name}, {"target", targetFac.name}});
                }
                g_world.gmInterventionHistory.push_back(cmd);
            } else {
                feedback = locStr("engine.gm.rumor_no_gold");
            }
        }
    } else if (cmd == "gmFrameForSabotage") {
        std::string factionId = args["factionId"].asString();
        std::string targetFactionId = args["targetFactionId"].asString();
        std::string regionId = args["regionId"].asString();

        if (g_world.factions.count(factionId) && g_world.factions.count(targetFactionId) && g_world.regions.count(regionId)) {
            Faction& fac = g_world.factions[factionId];
            Faction& targetFac = g_world.factions[targetFactionId];
            Region& reg = g_world.regions[regionId];
            std::string capitalRegionId = fac.regions.empty() ? "" : fac.regions[0];
            std::string g_id = getCoreIdByTag("currency");
            int goldAvailable = capitalRegionId.empty() ? 0 : countItemsInContainer(g_world.regions[capitalRegionId].vault_id, g_id);

            if (goldAvailable >= g_gameplay_runtime.gm_sabotage_cost) {
                consumeItemsFromContainer(g_world.regions[capitalRegionId].vault_id, g_id, g_gameplay_runtime.gm_sabotage_cost);
                reg.moneySupply *= 0.8;
                if (g_world.factions.count(reg.factionId)) {
                    g_world.factions[reg.factionId].relations[targetFactionId] -= 40;
                }
                feedback = locStr("engine.gm.sabotage_success", {{"faction", fac.name}, {"region", reg.name}, {"target", targetFac.name}});
                g_world.gmInterventionHistory.push_back(cmd);
            } else {
                feedback = locStr("engine.gm.sabotage_fail");
            }
        }
    } else if (cmd == "gmBuildHighway") {
        std::string from = args["from"].asString();
        std::string to = args["to"].asString();
        bool found = false;
        for (auto& road : g_world.map.roads) {
            if ((road.from == from && road.to == to) || (road.from == to && road.to == from)) {
                road.type = "highway";
                road.condition = "paved";
                road.integrity = 100;
                found = true;
            }
        }
        if (found) {
            feedback = locStr("engine.gm.highway_built", {{"from", from}, {"to", to}});
            addNews(locStr("engine.news.highway_built_news"), from, 4, "logistics");
            g_world.gmInterventionHistory.push_back(cmd);
            g_path_cache_dirty = true;
        } else {
            feedback = locStr("engine.gm.highway_no_road");
        }
    } else if (cmd == "gmDirectResourceInjection") {
        std::string regionId = args["regionId"].asString();
        std::string goodType = args["goodType"].asString();
        int quantity = args["quantity"].asInt();

        if (g_world.current_day - g_world.lastDirectInjectionDay < 7) {
            feedback = locStr("engine.gm.inject_cooldown");
        } else if (g_world.regions.count(regionId)) {
            g_world.lastDirectInjectionDay = g_world.current_day;
            createItem(goodType, quantity, g_world.regions[regionId].vault_id, g_world.current_day, "Божественное вмешательство");
            feedback = locStr("engine.gm.inject_success", {{"qty", std::to_string(quantity)}, {"good", goodType}, {"region", g_world.regions[regionId].name}});
            g_world.gmInterventionHistory.push_back(cmd);
        } else {
            feedback = locStr("engine.gm.inject_no_region");
        }
    } else if (cmd == "spawnMonster") {
        std::string regionId = args["regionId"].asString();
        std::string typeStr = args["type"].asString();
        if (g_world.regions.count(regionId)) {
            EpicMonster m;
            m.id = "epic_" + generateUUID();
            m.type = typeStr;
            m.name = g_db.monsters.count(typeStr) ? g_db.monsters[typeStr].name : "Призванный " + typeStr;
            if (g_db.monsters.count(typeStr)) {
                m.health = g_db.monsters[typeStr].base_hp;
                m.maxHealth = g_db.monsters[typeStr].base_hp;
                m.attack = g_db.monsters[typeStr].base_attack;
                m.defense = g_db.monsters[typeStr].base_defense;
            }
            m.region_id = regionId;
            if (g_world.map.locations.count(regionId)) {
                m.lair_x = g_world.map.locations[regionId].x;
                m.lair_y = g_world.map.locations[regionId].y;
            }
            m.treasure_chest_id = createContainer("monster_lair", "monster", 999999, 100, regionId);
            g_world.monsters.push_back(m);
            feedback = locStr("engine.gm.spawn_monster", {{"region", g_world.regions[regionId].name}});
            addNews(locStr("engine.news.monster_spawned_news", {{"region", g_world.regions[regionId].name}}), regionId, 5, "disaster");
            g_world.gmInterventionHistory.push_back(cmd);
        } else {
            feedback = locStr("engine.gm.inject_no_region");
        }
    } else if (cmd == "killMonster") {
        std::string monsterId = args["monsterId"].asString();
        bool found = false;
        for (auto& m : g_world.monsters) {
            if (m.id == monsterId) {
                m.health = 0;
                found = true;
                feedback = locStr("engine.gm.kill_monster", {{"monster", m.name}});
                g_world.gmInterventionHistory.push_back(cmd);
                break;
            }
        }
        if (!found) feedback = locStr("engine.gm.kill_no_monster");
    } else if (cmd == "triggerDisaster") {
        std::string type = args["type"].asString();
        std::string regionId = args["regionId"].asString();
        int strength = args.has("strength") ? args["strength"].asInt() : 5;

        if (g_world.regions.count(regionId) && g_world.map.locations.count(regionId)) {
            auto loc = g_world.map.locations[regionId];
            Disaster d;
            d.id = "dis_" + generateUUID();
            d.type = type;
            d.epicenter_x = loc.x;
            d.epicenter_y = loc.y;
            d.radius = strength;
            d.strength = strength;
            d.affected_regions.push_back(regionId);
            d.days_active = strength * 2;
            
            if (type == "flood") {
                for (int y = std::max(0, d.epicenter_y - d.radius); y <= std::min(g_world.map.height - 1, d.epicenter_y + d.radius); ++y) {
                    for (int x = std::max(0, d.epicenter_x - d.radius); x <= std::min(g_world.map.width - 1, d.epicenter_x + d.radius); ++x) {
                        if (std::hypot(x - d.epicenter_x, y - d.epicenter_y) <= d.radius) {
                            int idx = y * g_world.map.width + x;
                            uint8_t b_id = g_world.map.grid[idx].biome_id;
                            std::string b_str = getBiomeStringId(b_id);
                            if (b_str == "riverbank" || b_str == "floodplain" || b_str == "plains") {
                                g_world.map.grid[idx].is_flooded = true;
                                d.affected_tiles.push_back({x, y});
                            }
                        }
                    }
                }
                g_world.map.generation_tick = g_world.tick;
            } else if (type == "earthquake") {
                for (auto& road : g_world.map.roads) {
                    if (road.from == regionId || road.to == regionId) {
                        road.condition = "ruined";
                        road.integrity = 0;
                    }
                }
                g_path_cache_dirty = true;
            }
            g_world.map.disasters.push_back(d);
            feedback = locStr("engine.gm.disaster_triggered", {{"type", type}, {"region", g_world.regions[regionId].name}});
            addNews(locStr("engine.news.disaster_triggered_news", {{"type", type}, {"region", g_world.regions[regionId].name}}), regionId, 5, "disaster");
            g_world.gmInterventionHistory.push_back(cmd);
        } else {
            feedback = locStr("engine.gm.inject_no_region");
        }
    } else if (cmd == "gmCreateFaction") {
        std::string factionId = args["factionId"].asString();
        if (factionId.empty() && args.has("id")) factionId = args["id"].asString();
        if (factionId.empty() && args.has("key")) factionId = args["key"].asString();
        
        std::string name = args["name"].asString();
        std::string rulerId = args.has("rulerId") ? args["rulerId"].asString() : "player";

        if (factionId.empty()) {
            feedback = locStr("engine.gm.faction_no_id");
        } else if (g_world.factions.count(factionId)) {
            feedback = locStr("engine.gm.faction_exists", {{"id", factionId}});
        } else {
            Faction f;
            f.id = factionId;
            f.name = name;
            f.rulerId = rulerId;
            f.warType = DiplomaticState::PEACE;
            f.stability = 70;
            f.legitimacy = 100;
            
            for (const auto& [otherFid, otherF] : g_world.factions) {
                f.relations[otherFid] = 0;
                f.diplomacy[otherFid] = "neutral";
                g_world.factions[otherFid].relations[factionId] = 0;
                g_world.factions[otherFid].diplomacy[factionId] = "neutral";
            }
            
            g_world.factions[factionId] = f;
            feedback = locStr("engine.gm.faction_created", {{"name", name}, {"ruler", rulerId}});
            addNews(locStr("engine.news.faction_created_news", {{"name", name}}), "global", 5, "politics");
            g_world.gmInterventionHistory.push_back(cmd);
        }
    } else if (cmd == "gmTransferRegion") {
        std::string regionId = args["regionId"].asString();
        if (regionId.empty() && args.has("id")) regionId = args["id"].asString();
        
        std::string newFactionId = args["newFactionId"].asString();
        if (newFactionId.empty() && args.has("factionId")) newFactionId = args["factionId"].asString();

        if (g_world.regions.count(regionId) && g_world.factions.count(newFactionId)) {
            Region& reg = g_world.regions[regionId];
            std::string oldFactionId = reg.factionId;

            if (oldFactionId != newFactionId) {
                if (!oldFactionId.empty() && g_world.factions.count(oldFactionId)) {
                    auto& oldRegs = g_world.factions[oldFactionId].regions;
                    oldRegs.erase(std::remove(oldRegs.begin(), oldRegs.end(), regionId), oldRegs.end());
                }
                
                reg.factionId = newFactionId;
                reg.isOccupied = false;
                reg.occupierFactionId = "";
                reg.daysUnderOccupation = 0;
                g_world.factions[newFactionId].regions.push_back(regionId);
                
                if (g_world.map.locations.count(regionId)) {
                    g_world.map.locations[regionId].faction = newFactionId;
                }
                
                feedback = locStr("engine.gm.transfer_success", {{"region", reg.name}, {"faction", g_world.factions[newFactionId].name}});
                addNews(locStr("engine.news.region_transferred_news", {{"region", reg.name}, {"faction", g_world.factions[newFactionId].name}}), regionId, 5, "politics");
                g_world.gmInterventionHistory.push_back(cmd);
            } else {
                feedback = locStr("engine.gm.transfer_same");
            }
        } else {
            feedback = locStr("engine.gm.transfer_error", {{"region", regionId}, {"faction", newFactionId}});
        }

    } else if (cmd == "gmRaisePlayerArmy") {
        std::string factionId = args["factionId"].asString();
        std::string regionId = args["regionId"].asString();
        int size = args["size"].asInt();

        if (g_world.factions.count(factionId) && g_world.regions.count(regionId)) {
            Faction& fac = g_world.factions[factionId];
            Region& reg = g_world.regions[regionId];
            
            if (reg.factionId != factionId) {
                feedback = locStr("engine.gm.army_not_yours", {{"region", reg.name}});
            } else if (reg.population < size * 2) {
                feedback = locStr("engine.gm.army_no_pop", {{"need", std::to_string(size * 2)}});
            } else {
                int weaponsNeeded = size;
                int foodNeeded = std::max(1, (int)(size * 0.02 * 14)); 
                int weaponsAvail = countItemsInContainer(reg.vault_id, getCoreIdByTag("weapon"));
                int breadAvail = countItemsInContainer(reg.vault_id, getCoreIdByTag("food"));
                
                if (weaponsAvail < weaponsNeeded) {
                    feedback = locStr("engine.gm.army_no_weap", {{"need", std::to_string(weaponsNeeded)}, {"avail", std::to_string(weaponsAvail)}});
                } else {
                    reg.population -= size;
                    consumeItemsFromContainer(reg.vault_id, getCoreIdByTag("weapon"), weaponsNeeded);
                    int actualFood = consumeItemsFromContainer(reg.vault_id, getCoreIdByTag("food"), std::min(foodNeeded, breadAvail));
                    
                    std::string armyChestId = createContainer("army_supply_chest", fac.id, 999999, 1000, regionId);
                    if (actualFood > 0) createItem(getCoreIdByTag("food"), actualFood, armyChestId, g_world.current_day, "Припасы армии");
                    
                    Army army;
                    army.id = "army_" + generateUUID();
                    army.size = size;
                    army.morale = 100;
                    army.location = regionId;
                    army.destination = regionId;
                    army.daysToMove = 0;
                    army.siegeDays = -1;
                    army.supply_chest_id = armyChestId;
                    army.general_id = "player";
                    
                    if (g_world.map.locations.count(regionId)) {
                        army.x = g_world.map.locations[regionId].x;
                        army.y = g_world.map.locations[regionId].y;
                    }
                    
                    fac.armies.push_back(army);
                    feedback = locStr("engine.gm.army_raised", {{"size", std::to_string(size)}, {"region", reg.name}, {"id", army.id}});
                    addNews(locStr("engine.news.army_raised_news", {{"faction", fac.name}, {"region", reg.name}}), regionId, 4, "war");
                    g_world.gmInterventionHistory.push_back(cmd);
                }
            }
        } else {
            feedback = locStr("engine.gm.transfer_error", {{"region", regionId}, {"faction", factionId}});
        }
    } else if (cmd == "gmCommandArmy") {
        std::string factionId = args["factionId"].asString();
        std::string armyId = args["armyId"].asString();
        std::string action = args["action"].asString(); 
        std::string targetRegionId = args.has("targetRegionId") ? args["targetRegionId"].asString() : "";

        if (g_world.factions.count(factionId)) {
            Faction& fac = g_world.factions[factionId];
            bool found = false;
            for (size_t i = 0; i < fac.armies.size(); ++i) {
                if (fac.armies[i].id == armyId) {
                    found = true;
                    if (action == "disband") {
                        std::string loc = fac.armies[i].location;
                        int size = fac.armies[i].size;
                        if (g_world.regions.count(loc)) {
                            g_world.regions[loc].population += size;
                            createItem(getCoreIdByTag("weapon"), size, g_world.regions[loc].vault_id, g_world.current_day, "Расформирование армии");
                        }
                        fac.armies.erase(fac.armies.begin() + i);
                        feedback = locStr("engine.gm.army_disbanded", {{"id", armyId}, {"loc", loc}});
                        g_world.gmInterventionHistory.push_back(cmd);
                    } else if (action == "move") {
                        if (g_world.regions.count(targetRegionId)) {
                            fac.armies[i].destination = targetRegionId;
                            std::vector<bool> dummy_has_road(g_world.map.width * g_world.map.height, false);
                            std::vector<int> dummy_path_status(g_world.map.width * g_world.map.height, 0);
                            if (g_world.map.locations.count(fac.armies[i].location) && g_world.map.locations.count(targetRegionId)) {
                                auto loc1 = g_world.map.locations[fac.armies[i].location];
                                auto loc2 = g_world.map.locations[targetRegionId];
                                fac.armies[i].path = findPath(g_world.map, loc1.x, loc1.y, loc2.x, loc2.y, dummy_has_road, dummy_path_status, MovementType::ANY, fac.armies[i].size);
                                fac.armies[i].path_index = 0;
                            }
                            feedback = locStr("engine.gm.army_moved", {{"id", armyId}, {"region", g_world.regions[targetRegionId].name}});
                            g_world.gmInterventionHistory.push_back(cmd);
                        } else {
                            feedback = locStr("engine.gm.army_no_target");
                        }
                    }
                    break;
                }
            }
            if (!found) feedback = locStr("engine.gm.army_not_found");
        } else {
            feedback = locStr("engine.gm.army_no_faction");
        }

    } else if (cmd == "gmDeclareWar") {
        std::string f1 = args["fromFactionId"].asString();
        std::string f2 = args["toFactionId"].asString();
        if (g_world.factions.count(f1) && g_world.factions.count(f2)) {
            g_world.factions[f1].diplomacy[f2] = "war";
            g_world.factions[f2].diplomacy[f1] = "war";
            g_world.factions[f1].warType = DiplomaticState::LIMITED_WAR;
            g_world.factions[f2].warType = DiplomaticState::LIMITED_WAR;
            g_world.factions[f1].currentCasusBelli = CasusBelli::IMPERIALISM;
            g_world.factions[f2].currentCasusBelli = CasusBelli::IMPERIALISM;
            if (!g_world.factions[f2].regions.empty()) {
                g_world.factions[f1].activeWarGoal.targetRegionId = g_world.factions[f2].regions[0];
                g_world.factions[f1].activeWarGoal.deadlineDays = 60;
            }
            if (!g_world.factions[f1].regions.empty()) {
                g_world.factions[f2].activeWarGoal.targetRegionId = g_world.factions[f1].regions[0];
                g_world.factions[f2].activeWarGoal.deadlineDays = 60;
            }
            feedback = locStr("engine.gm.war_declared", {{"f1", g_world.factions[f1].name}, {"f2", g_world.factions[f2].name}});
            addNews(locStr("engine.news.war_declared_news", {{"f1", g_world.factions[f1].name}, {"f2", g_world.factions[f2].name}}), "global", 5, "war");
            g_world.gmInterventionHistory.push_back(cmd);
        } else {
            feedback = locStr("engine.gm.war_error");
        }
    } else if (cmd == "gmForcePeace") {
        std::string f1 = args["factionId1"].asString();
        std::string f2 = args["factionId2"].asString();
        if (g_world.factions.count(f1) && g_world.factions.count(f2)) {
            g_world.factions[f1].diplomacy[f2] = "neutral";
            g_world.factions[f2].diplomacy[f1] = "neutral";
            g_world.factions[f1].warType = DiplomaticState::PEACE;
            g_world.factions[f2].warType = DiplomaticState::PEACE;
            g_world.factions[f1].warExhaustion = 0;
            g_world.factions[f2].warExhaustion = 0;
            feedback = locStr("engine.gm.peace_forced", {{"f1", g_world.factions[f1].name}, {"f2", g_world.factions[f2].name}});
            addNews(locStr("engine.news.peace_forced_news", {{"f1", g_world.factions[f1].name}, {"f2", g_world.factions[f2].name}}), "global", 5, "diplomacy");
            g_world.gmInterventionHistory.push_back(cmd);
        } else {
            feedback = locStr("engine.gm.peace_error");
        }
    } else if (cmd == "gmChangeRulerTrait") {
        std::string rId = args["rulerId"].asString();
        std::string trait = args["trait"].asString();
        int val = args["value"].asInt();
        if (g_world.npcs.count(rId) && g_world.npcs[rId].type == "ruler") {
            auto& p = g_world.npcs[rId].rulerPersonality;
            if (trait == "ambition") p.ambition = val;
            else if (trait == "paranoia") p.paranoia = val;
            else if (trait == "wisdom") p.wisdom = val;
            else if (trait == "cruelty") p.cruelty = val;
            else if (trait == "diplomacy") p.diplomacy = val;
            else if (trait == "military") p.military = val;
            else if (trait == "stewardship") p.stewardship = val;
            feedback = locStr("engine.gm.trait_changed", {{"trait", trait}, {"ruler", g_world.npcs[rId].name}, {"val", std::to_string(val)}});
            g_world.gmInterventionHistory.push_back(cmd);
        } else {
            feedback = locStr("engine.gm.trait_error");
        }
    } else if (cmd == "mountTransport") {
        std::string itemId = args["itemId"].asString();
        std::string backpackContainerId = args["backpackContainerId"].asString();

        if (!g_items.count(itemId)) {
            feedback = "Item not found";
        } else {
            PhysicalItem& item = g_items[itemId];

            if (item.container_id != backpackContainerId) {
                feedback = "Item not in player backpack";
            } else {
                std::string transport_type = "none";
                double speed_mult = 1.0;
                int cargo_bonus = 0;
                bool water_only = false;

                if (!resolveTransportFromItemData(item.prototype_id, transport_type, speed_mult, cargo_bonus, water_only)) {
                    feedback = "Item is not a transport";
                }

                if (transport_type != "none") {
                    g_world.player_trek.active_transport_id = itemId;
                    g_world.player_trek.transport_type = transport_type;
                    g_world.player_trek.transport_speed_mult = speed_mult;
                    g_world.player_trek.transport_cargo_bonus = cargo_bonus;
                    g_world.player_trek.transport_water_only = water_only;
                    feedback = "Transport mounted: " + transport_type;
                }
            }
        }
    } else if (cmd == "dismountTransport") {
        g_world.player_trek.active_transport_id = "";
        g_world.player_trek.transport_type = "none";
        g_world.player_trek.transport_speed_mult = 1.0;
        g_world.player_trek.transport_cargo_bonus = 0;
        g_world.player_trek.transport_water_only = false;
        feedback = "Transport dismounted";
    } else if (cmd == "getTransportInfo") {
        JsonValue info = JsonValue::object();
        info.set("active_transport_id", g_world.player_trek.active_transport_id);
        info.set("transport_type", g_world.player_trek.transport_type);
        info.set("speed_multiplier", g_world.player_trek.transport_speed_mult);
        info.set("cargo_bonus", g_world.player_trek.transport_cargo_bonus);
        info.set("water_only", g_world.player_trek.transport_water_only);
        feedback = info.toString();
    }

    return feedback;
}


        void processMerchants() {
        static int last_rebuild_day = -999;
        // Ленивое кэширование: перестраиваем глобальный кэш путей не чаще раза в 14 дней.
        // Если дорога сломалась, караваны и армии сами найдут обход в реальном времени.
        if (g_path_cache_dirty && (g_world.current_day - last_rebuild_day > 14 || g_path_cache.empty())) {
            last_rebuild_day = g_world.current_day;
            g_path_cache.clear();
            std::vector<bool> has_road(g_world.map.width * g_world.map.height, false);
            std::vector<int> path_status(g_world.map.width * g_world.map.height, 0);
            for (const auto& road : g_world.map.roads) {
                if (road.condition == "blocked") {
                    for (const auto& wp : road.waypoints) path_status[wp.second * g_world.map.width + wp.first] = 2;
                } else if (road.condition == "ruined") {
                    for (const auto& wp : road.waypoints) {
                        path_status[wp.second * g_world.map.width + wp.first] = 1;
                        has_road[wp.second * g_world.map.width + wp.first] = true;
                    }
                } else {
                    for (const auto& wp : road.waypoints) has_road[wp.second * g_world.map.width + wp.first] = true;
                }
            }
            for (const auto& [r1, reg1] : g_world.regions) {
                for (const auto& [r2, reg2] : g_world.regions) {
                    if (r1 != r2 && g_world.map.locations.count(r1) && g_world.map.locations.count(r2)) {
                        auto loc1 = g_world.map.locations[r1];
                        auto loc2 = g_world.map.locations[r2];
                        g_path_cache[{r1, r2}] = findPath(g_world.map, loc1.x, loc1.y, loc2.x, loc2.y, has_road, path_status, MovementType::LAND);
                    }
                }
            }
            g_path_cache_dirty = false;
        }

        // Структура для возврата результата из параллельного потока
    struct MerchantTask {
        std::string merchant_id;
        std::string origin;
        std::string bestDest;
        std::string bestGood;
        int buyPrice;
        bool execute;
    };

    std::vector<std::future<MerchantTask>> futures;

    for (auto& [npcId, merchant] : g_world.npcs) {
        if (!merchant.isAlive || merchant.economy.profession_type != "merchant") continue;
        
        // Если купец уже в пути, пропускаем (синхронное чтение безопасно)
        bool inTransit = false;
        for (const auto& [rid, r] : g_world.regions) {
            for (const auto& c : r.caravans) {
                if (c.merchant_id == npcId) { inTransit = true; break; }
            }
            if (inTransit) break;
        }
        if (inTransit) continue;
        if (!g_world.regions.count(merchant.currentLocation)) continue;

        std::string mId = npcId;
        std::string mLoc = merchant.currentLocation;
        int mSavings = merchant.economy.savings;

        // ЗАПУСК ТЯЖЕЛЫХ РАСЧЕТОВ (A* И АНАЛИЗ РЫНКА) В ПАРАЛЛЕЛЬНЫХ ПОТОКАХ
        futures.push_back(getThreadPool()->enqueue([mId, mLoc, mSavings]() -> MerchantTask {
            MerchantTask task = {mId, mLoc, "", "", 0, false};
            if (!g_world.regions.count(mLoc)) return task;
            
            const Region& localReg = g_world.regions.at(mLoc);
            double maxProfit = 0;

            for (const auto& [gtStr, itemDef] : g_db.items) {
                if (itemDef.category == "document") continue;
                double localP = localReg.markets.count(gtStr) ? localReg.markets.at(gtStr) : itemDef.basePrice;
                if (localP <= 0) localP = itemDef.basePrice;

                                                        for (const auto& [destId, destReg] : g_world.regions) {
                    if (destId == mLoc) continue;
                    double destP = destReg.markets.count(gtStr) ? destReg.markets.at(gtStr) : itemDef.basePrice;
                    
                    if (destReg.moneySupply < destP * 50) continue;
                    
                    double profitMargin = destP - localP;
                    
                    if (profitMargin > maxProfit && profitMargin > localP * 0.3) {
                        task.bestGood = gtStr;
                        // ИСПОЛЬЗУЕМ КЭШИРОВАННЫЕ МАРШРУТЫ (O(1) вместо O(N^2))
                        if (g_path_cache.count({mLoc, destId})) {
                            auto path = g_path_cache.at({mLoc, destId});
                            if (!path.empty()) {
                                maxProfit = profitMargin;
                                task.bestDest = destId;
                                task.bestGood = gtStr;
                                task.buyPrice = localP;
                                task.execute = true;
                            }
                        }
                    }
                }
            }
            return task;
        }));
    }

    // СИНХРОННОЕ ПРИМЕНЕНИЕ РЕЗУЛЬТАТОВ (Избегаем Data Races при изменении инвентарей)
    for (auto& f : futures) {
        MerchantTask task = f.get(); // Дожидаемся завершения потока
        if (task.execute && g_world.npcs.count(task.merchant_id) && g_world.regions.count(task.origin)) {
            NPC& merchant = g_world.npcs[task.merchant_id];
            Region& localReg = g_world.regions[task.origin];
            
            int availableGoods = countItemsInContainer(localReg.vault_id, task.bestGood);
            int safePrice = std::max(1, task.buyPrice);
            int maxAffordable = merchant.economy.savings / safePrice;
            const std::string vehicleId = getCoreIdByTag("vehicle");
            int vehiclesOwned = vehicleId.empty() ? 0 : countItemsInContainer(merchant.inventory_id, vehicleId);
            int maxCarryable = (g_db.items[task.bestGood].category == "vehicle") ? (1 + rand() % 3) : (50 + vehiclesOwned * 500);
            int amountToBuy = std::min({availableGoods, maxAffordable, maxCarryable});

            if (amountToBuy > 0) {
                int cost = amountToBuy * safePrice;
                merchant.economy.savings -= cost;
                localReg.moneySupply += cost;
                consumeItemsFromContainer(localReg.vault_id, task.bestGood, amountToBuy);

                std::string chestId = createContainer("caravan_chest", merchant.id, 999999, 1000, merchant.currentLocation);
                createItem(task.bestGood, amountToBuy, chestId, g_world.current_day, locStr("engine.reason.merchant_goods"));

                int guardsHired = 0;
                int maxGuardsWanted = merchant.economy.savings / 20; // Лимит в 5 охранников снят
                
                for (auto& [mercId, merc] : g_world.npcs) {
                    if (guardsHired >= maxGuardsWanted) break;
                    if (merc.isAlive && merc.economy.profession_type == "mercenary" && merc.currentLocation == merchant.currentLocation && merc.currentActivity != locStr("engine.npc.guarding_caravan")) {
                        merc.currentActivity = locStr("engine.npc.guarding_caravan");
                        merc.travelDestination = task.bestDest;
                        merc.travelHoursLeft = 24 + (rand() % 48);
                        merchant.economy.savings -= 20;
                        merc.economy.savings += 20;
                        guardsHired++;
                    }
                }
                
                int abstractGuards = 0;
                if (guardsHired < maxGuardsWanted) {
                    abstractGuards = maxGuardsWanted - guardsHired;
                    merchant.economy.savings -= abstractGuards * 20;
                }
                int totalGuards = guardsHired + abstractGuards;

                Caravan caravan;
                caravan.id = "caravan_" + generateUUID();
                caravan.merchant_id = merchant.id;
                caravan.origin = merchant.currentLocation;
                caravan.destination = task.bestDest;
                caravan.chest_id = chestId;
                caravan.wagons = (g_db.items[task.bestGood].category == "vehicle") ? amountToBuy : (1 + (amountToBuy / 50));
                caravan.guards = totalGuards;
                caravan.guard_cost = totalGuards * 20;
                caravan.hoursLeft = 24 + (rand() % 48);
                
                if (g_path_cache.count({merchant.currentLocation, task.bestDest})) {
                    caravan.path = g_path_cache[{merchant.currentLocation, task.bestDest}];
                    if (!caravan.path.empty()) {
                        caravan.x = caravan.path[0].first;
                        caravan.y = caravan.path[0].second;
                    }
                }
                
                localReg.caravans.push_back(caravan);
                std::string destName = g_world.regions.count(task.bestDest) ? g_world.regions[task.bestDest].name : task.bestDest;
                merchant.currentActivity = locStr("engine.npc.traveling_to", {{"dest", destName}});

                addNews(locStr("engine.news.merchant_caravan_sent", {{"merchant", merchant.name}, {"origin", localReg.name}, {"dest", destName}}), task.origin, 1, "trade");
            }
        }
    }
}




void processDailyThreat() {
    for (auto& [rid, r] : g_world.regions) {
        int delta = 0;
        
        // 1. Безработица
        int totalJobs = 0;
        for (const auto& [fid, fac] : r.facilities) {
            totalJobs += fac.level * 2000;
        }
        int employed = std::min(r.population, totalJobs);
        double unemploymentRate = r.population > 0 ? (r.population - employed) / (double)r.population : 0.0;
        if (unemploymentRate > 0.3) delta += 1 + (int)((unemploymentRate - 0.3) * 5);

        // 2. Голод
        int food = getFoodAmount(r.vault_id);
        double foodPerCapita = food / (double)std::max(1, r.population);
        if (foodPerCapita < 0.8) delta += 5;
        if (foodPerCapita < 0.3) delta += 10;

        // 3. Война / налеты
        if (g_world.factions.count(r.factionId)) {
            const auto& f = g_world.factions[r.factionId];
            for (const auto& [otherFid, relation] : f.diplomacy) {
                if (relation == "war" && g_world.factions.count(otherFid)) {
                    delta += 3;
                }
            }
        }

        r.threat_level = std::max(0, std::min(100, r.threat_level + delta));

        // 3.5 Спавн Эпических Монстров и Блокировка Дорог
        bool global_dragon_exists = g_world.nexusData.count("global_dragon_active") && g_world.nexusData["global_dragon_active"].asBool();
        if (r.threat_level >= 100 && !g_world.nexusData.count(rid + "_dragon_spawned") && !global_dragon_exists) {
            g_world.nexusData[rid + "_dragon_spawned"] = JsonValue(true);
            g_world.nexusData["global_dragon_active"] = JsonValue(true);
            
            int blockX = -1, blockY = -1;
            for (const auto& road : g_world.map.roads) {
                if (road.from == rid || road.to == rid) {
                    if (road.waypoints.size() > 15) {
                        int wpIdx = (road.from == rid) ? 10 : road.waypoints.size() - 11;
                        blockX = road.waypoints[wpIdx].first;
                        blockY = road.waypoints[wpIdx].second;
                        break;
                    }
                }
            }
            if (blockX == -1 && g_world.map.locations.count(rid)) {
                blockX = g_world.map.locations[rid].x;
                blockY = g_world.map.locations[rid].y;
            }
            
            if (blockX != -1) {
                g_world.nexusData[rid + "_dragon_x"] = JsonValue(blockX);
                g_world.nexusData[rid + "_dragon_y"] = JsonValue(blockY);
                int radius = 6;
                
                std::vector<MapRoad> new_roads;
                for (auto& road : g_world.map.roads) {
                    if (road.condition == "ruined" || road.condition == "blocked") {
                        new_roads.push_back(road);
                        continue;
                    }
                    MapRoad current_segment;
                    current_segment.from = road.from;
                    current_segment.to = road.to;
                    current_segment.condition = road.condition;
                    bool in_ruin = false;
                    for (size_t i = 0; i < road.waypoints.size(); ++i) {
                        auto wp = road.waypoints[i];
                        bool inside = std::hypot(wp.first - blockX, wp.second - blockY) <= radius;
                        if (inside && !in_ruin) {
                            if (!current_segment.waypoints.empty()) {
                                current_segment.waypoints.push_back(wp);
                                new_roads.push_back(current_segment);
                            }
                            current_segment.waypoints.clear();
                            current_segment.condition = "ruined";
                            current_segment.waypoints.push_back(wp);
                            in_ruin = true;
                        } else if (!inside && in_ruin) {
                            if (!current_segment.waypoints.empty()) {
                                current_segment.waypoints.push_back(wp);
                                new_roads.push_back(current_segment);
                            }
                            current_segment.waypoints.clear();
                            current_segment.condition = road.condition;
                            current_segment.waypoints.push_back(wp);
                            in_ruin = false;
                        } else {
                            current_segment.waypoints.push_back(wp);
                        }
                    }
                    if (!current_segment.waypoints.empty()) new_roads.push_back(current_segment);
                }
                g_world.map.roads = new_roads;
                
                for (int y = std::max(0, blockY - radius); y <= std::min(g_world.map.height - 1, blockY + radius); ++y) {
                    for (int x = std::max(0, blockX - radius); x <= std::min(g_world.map.width - 1, blockX + radius); ++x) {
                        if (std::hypot(x - blockX, y - blockY) <= radius) {
                            g_world.map.grid[y * g_world.map.width + x].biome_id = g_db.biome_string_to_id.count("volcano") ? g_db.biome_string_to_id["volcano"] : 0;
                        }
                    }
                }
                g_world.map.generation_tick = g_world.tick;
                g_path_cache_dirty = true;
            }
            addNews(locStr("engine.news.dragon_settled", {{"region", r.name}}), rid, 5, "disaster");
        }
        
        // Разблокировка дорог, если угроза спала (например, игрок убил дракона и снизил threat_level)
        if (r.threat_level < 50 && g_world.nexusData.count(rid + "_dragon_spawned")) {
            int blockX = g_world.nexusData.count(rid + "_dragon_x") ? g_world.nexusData[rid + "_dragon_x"].asInt() : -1;
            int blockY = g_world.nexusData.count(rid + "_dragon_y") ? g_world.nexusData[rid + "_dragon_y"].asInt() : -1;
            int radius = 6;

            g_world.nexusData.erase(rid + "_dragon_spawned");
            g_world.nexusData.erase(rid + "_dragon_x");
            g_world.nexusData.erase(rid + "_dragon_y");
            g_world.nexusData.erase("global_dragon_active");
            
            addNews(locStr("engine.news.dragon_liberated", {{"region", r.name}}), rid, 4, "trade");
            
            if (blockX != -1) {
                for (auto& road : g_world.map.roads) {
                    if (road.condition == "ruined" || road.condition == "blocked") {
                        bool inside = true;
                        for (auto wp : road.waypoints) {
                            if (std::hypot(wp.first - blockX, wp.second - blockY) > radius + 2) {
                                inside = false;
                                break;
                            }
                        }
                        if (inside) {
                            road.condition = "paved"; // Восстанавливаем дорогу
                            g_path_cache_dirty = true;
                        }
                    }
                }
                for (int y = std::max(0, blockY - radius); y <= std::min(g_world.map.height - 1, blockY + radius); ++y) {
                    for (int x = std::max(0, blockX - radius); x <= std::min(g_world.map.width - 1, blockX + radius); ++x) {
                        if (std::hypot(x - blockX, y - blockY) <= radius) {
                            uint8_t b_id = g_world.map.grid[y * g_world.map.width + x].biome_id;
                            std::string b_str = getBiomeStringId(b_id);
                            if (b_str == "volcano") {
                                g_world.map.grid[y * g_world.map.width + x].biome_id = g_db.biome_string_to_id.count("plains") ? g_db.biome_string_to_id["plains"] : 0;
                            }
                        }
                    }
                }
                g_world.map.generation_tick = g_world.tick;
            }
        }

        // 4. Автоматическое снижение угрозы при благополучии
        if (unemploymentRate < 0.3 && foodPerCapita > 0.8) {
            r.threat_level = std::max(0, r.threat_level - (1 + rand() % 2));
        }
        
        // Уникальная логика типов локаций
        if (r.base_type == "fort") {
            r.threat_level = std::max(0, r.threat_level - 2); // Форты подавляют угрозу
        } else if (r.base_type == "anomaly") {
            r.dread = std::min(100, r.dread + 2); // Аномалии генерируют ужас
        } else if (r.base_type == "ruins" || r.population == 0) {
            r.threat_level = std::max(80, r.threat_level); // Руины всегда опасны
        }
        
        // Влияние на население: гибель/миграция при высокой угрозе
        if (r.threat_level > 70) {
            int deaths = (r.threat_level / 10) * 0.005 * r.population;
            r.population = std::max(0, r.population - deaths);
        }

        // 5. Зачистка бандитов (возврат награбленного), если угроза упала
        if (r.threat_level < 50 && !r.bandit_stash_id.empty()) {
            if (g_containers.count(r.bandit_stash_id)) {
                Storage& stash = g_containers[r.bandit_stash_id];
                std::vector<std::string> items_to_move = stash.item_ids;
                for (const auto& itemId : items_to_move) {
                    moveItem(itemId, r.vault_id);
                }
                g_deleted_containers.push_back(r.bandit_stash_id);
                g_containers.erase(r.bandit_stash_id);
            }
            r.bandit_stash_id.clear();
        }

        // 6. Фракции тратят золото на патрули для снижения угрозы
        if (!r.factionId.empty() && g_world.factions.count(r.factionId)) {
            std::string capitalId = g_world.factions[r.factionId].regions.empty() ? "" 
                                    : g_world.factions[r.factionId].regions[0];
            if (!capitalId.empty() && g_world.regions.count(capitalId)) {
                int gold = countItemsInContainer(g_world.regions[capitalId].vault_id, getCoreIdByTag("currency"));
                int cost = 200 + rand() % 300;
                if (gold >= cost && r.threat_level > 20) {
                    consumeItemsFromContainer(g_world.regions[capitalId].vault_id, getCoreIdByTag("currency"), cost);
                    r.threat_level = std::max(0, r.threat_level - (5 + rand() % 10));
                }
            }
        }
    }
}


void processDailyNPCs() {
    std::vector<NPC*> active_npcs;
    std::vector<std::string> already_dead;
    for (auto& [id, npc] : g_world.npcs) {
        if (npc.isAlive) active_npcs.push_back(&npc);
        else already_dead.push_back(id);
    }

    int num_threads = std::thread::hardware_concurrency();
    if (num_threads == 0) num_threads = 4;
    int chunk_size = active_npcs.size() / num_threads + 1;
    std::vector<std::future<std::vector<std::string>>> futures;

    for (int t = 0; t < num_threads; ++t) {
        int start_idx = t * chunk_size;
        int end_idx = std::min((int)active_npcs.size(), (t + 1) * chunk_size);
        if (start_idx >= active_npcs.size()) break;

        futures.push_back(getThreadPool()->enqueue([start_idx, end_idx, &active_npcs]() {
            std::vector<std::string> local_to_delete;
            for (int i = start_idx; i < end_idx; ++i) {
                NPC& npc = *active_npcs[i];
                
                npc.age_days++;
                npc.currentWealthLevel = npc.economy.savings + npc.gold;
                
                bool needsJob = (npc.age_days == 18 * 360 && npc.economy.profession_type == "none");
                bool wantsJobChange = false;
                
                if (!needsJob && !npc.economy.isEmployed && npc.type != "ruler") {
                    int desperation = (npc.currentWealthLevel < 50) ? 5 : 1;
                    if (g_world.current_day - npc.professionChangeTimestamp > 30 && (thread_safe_rand() % 100) < desperation) {
                        wantsJobChange = true;
                    }
                }

                if (needsJob || wantsJobChange) {
                    if (g_world.regions.count(npc.currentLocation)) {
                        Region& r = g_world.regions[npc.currentLocation];
                        
                        std::map<std::string, int> current_workers;
                        for (const auto& [oid, onpc] : g_world.npcs) {
                            if (onpc.isAlive && onpc.currentLocation == npc.currentLocation) {
                                current_workers[onpc.economy.profession_type]++;
                            }
                        }
                        
                        std::map<std::string, int> job_demand;
                        job_demand["farmer"] = ((r.facilities.count("farms") ? r.facilities["farms"].level * 100 : 0) + 50) - current_workers["farmer"];
                        job_demand["artisan"] = ((r.facilities.count("forges") ? r.facilities["forges"].level * 50 : 0) + (r.facilities.count("weavers") ? r.facilities["weavers"].level * 50 : 0)) - current_workers["artisan"];
                        job_demand["merchant"] = (r.population / 500) - current_workers["merchant"];
                        job_demand["mercenary"] = (r.threat_level * 2) - current_workers["mercenary"];
                        job_demand["cleric"] = (r.population / 1000) - current_workers["cleric"];
                        job_demand["gatherer"] = 20 - current_workers["gatherer"];

                        std::string best_prof = "farmer";
                        int max_demand = -1;
                        for (const auto& [prof, demand] : job_demand) {
                            if (demand > max_demand) {
                                max_demand = demand;
                                best_prof = prof;
                            }
                        }

                        npc.economy.profession_type = best_prof;
                        // Data-driven: pick a random profession ID that matches the target profession_type
                        {
                            std::vector<std::string> matching_ids;
                            for (const auto& pid : g_db.profession_ids) {
                                auto pit = g_db.professions.find(pid);
                                if (pit != g_db.professions.end() && pit->second.profession_type == best_prof) {
                                    matching_ids.push_back(pid);
                                }
                            }
                            if (!matching_ids.empty()) {
                                npc.profession = matching_ids[thread_safe_rand() % matching_ids.size()];
                            } else {
                                npc.profession = best_prof; // fallback: use type as id
                            }
                        }
                        
                        if (wantsJobChange) {
                            npc.economy.skillLevel = 1; 
                            npc.professionChangeTimestamp = g_world.current_day;
                        }
                    }
                }

                npc.needs.hunger = std::max(0, npc.needs.hunger - 1);
                if (g_world.current_day % 2 == 0) npc.needs.rest = std::max(0, npc.needs.rest - 1);
                if (g_world.current_day % 5 == 0) npc.needs.social = std::max(0, npc.needs.social - 1);

                if (npc.diseases.empty()) {
                    double sick_chance = 0.001 * (200.0 / std::max(1, npc.immunity));
                    if (npc.age_days > 23400) sick_chance *= 2.0;
                    if ((thread_safe_rand() % 10000) < (sick_chance * 10000)) {
                        npc.diseases.push_back("common_cold");
                    }
                } else {
                    npc.hp -= 1;
                    if ((thread_safe_rand() % 100) < (npc.immunity / 2)) {
                        npc.diseases.clear();
                    }
                }

                if (!npc.diseases.empty() || !npc.wounds.empty()) {
                    std::lock_guard<std::mutex> lock(g_npc_state_mutex);
                    for (auto& [docId, doctor] : g_world.npcs) {
                        if (doctor.isAlive && doctor.currentLocation == npc.currentLocation && doctor.economy.profession_type == "mage") {
                            if (npc.gold >= 15) {
                                npc.gold -= 15;
                                doctor.gold += 15;
                                npc.diseases.clear();
                                npc.wounds.clear();
                                npc.relationships[docId] += 10;
                                doctor.relationships[npc.id] += 5;
                                break;
                            }
                        }
                    }
                }

                if (npc.needs.social < 50) {
                    std::lock_guard<std::mutex> lock(g_npc_state_mutex);
                    for (auto& [otherId, otherNpc] : g_world.npcs) {
                        if (otherId != npc.id && otherNpc.isAlive && otherNpc.currentLocation == npc.currentLocation) {
                            npc.relationships[otherId] += 1;
                            otherNpc.relationships[npc.id] += 1;
                            npc.needs.social += 30;
                            otherNpc.needs.social += 10;
                            break;
                        }
                    }
                }

                if (npc.age_days > 23400) {
                    double death_chance = 0.0001 + ((npc.age_days - 23400) / 360.0) * 0.00005;
                    if ((thread_safe_rand() % 100000) < (death_chance * 100000)) {
                        npc.hp = 0;
                        npc.death_cause = locStr("engine.reason.old_age");
                    }
                }

                if (g_bootstrap && npc.hp <= 1) npc.hp = 1;
                if (npc.hp <= 0) {
                    if (g_bootstrap) {
                        npc.hp = 1;
                    } else {
                        npc.isAlive = false;
                        npc.death_day = g_world.current_day;
                        if (npc.death_cause.empty()) npc.death_cause = locStr("engine.reason.health_failure");
                        addNews(locStr("engine.news.npc_died", {{"name", npc.name}, {"cause", npc.death_cause}}), npc.currentLocation, 1, "misc");
                        local_to_delete.push_back(npc.id);
                    }
                }
            }
            return local_to_delete;
        }));
    }

    std::vector<std::string> to_delete = already_dead;
    for (auto& f : futures) {
        auto res = f.get();
        to_delete.insert(to_delete.end(), res.begin(), res.end());
    }

    // --- SYNCHRONOUS INHERITANCE LOGIC ---
    for (const auto& id : to_delete) {
        if (!g_world.npcs.count(id)) continue;
        NPC& dead_npc = g_world.npcs[id];
        
        std::string heir_id = "";
        if (!dead_npc.spouse_id.empty() && g_world.npcs.count(dead_npc.spouse_id) && g_world.npcs[dead_npc.spouse_id].isAlive) {
            heir_id = dead_npc.spouse_id;
        } else {
            for (const auto& child_id : dead_npc.children_ids) {
                if (g_world.npcs.count(child_id) && g_world.npcs[child_id].isAlive) {
                    heir_id = child_id;
                    break;
                }
            }
        }
        if (heir_id.empty() && !dead_npc.father_id.empty() && g_world.npcs.count(dead_npc.father_id) && g_world.npcs[dead_npc.father_id].isAlive) {
            heir_id = dead_npc.father_id;
        }
        if (heir_id.empty() && !dead_npc.mother_id.empty() && g_world.npcs.count(dead_npc.mother_id) && g_world.npcs[dead_npc.mother_id].isAlive) {
            heir_id = dead_npc.mother_id;
        }

        for (const auto& bId : dead_npc.owned_businesses) {
            if (g_world.businesses.count(bId)) {
                Business& bus = g_world.businesses[bId];
                bus.owner_ids.erase(std::remove(bus.owner_ids.begin(), bus.owner_ids.end(), id), bus.owner_ids.end());
                
                if (!heir_id.empty()) {
                    if (std::find(bus.owner_ids.begin(), bus.owner_ids.end(), heir_id) == bus.owner_ids.end()) {
                        bus.owner_ids.push_back(heir_id);
                    }
                    if (std::find(g_world.npcs[heir_id].owned_businesses.begin(), g_world.npcs[heir_id].owned_businesses.end(), bId) == g_world.npcs[heir_id].owned_businesses.end()) {
                        g_world.npcs[heir_id].owned_businesses.push_back(bId);
                    }
                    addNews(locStr("engine.news.business_inherited", {{"facility", getFacilityName(bus.facility_type)}, {"heir", g_world.npcs[heir_id].name}}), bus.region_id, 1, "trade");
                } else if (bus.owner_ids.empty()) {
                    if (g_world.regions.count(bus.region_id)) {
                        g_world.regions[bus.region_id].moneySupply += (bus.cash_balance * 0.5) + (bus.level * 250);
                    }
                    addNews(locStr("engine.news.business_liquidated", {{"facility", getFacilityName(bus.facility_type)}}), bus.region_id, 1, "trade");
                    g_world.businesses.erase(bId);
                }
            }
        }

        int total_wealth = dead_npc.economy.savings + dead_npc.gold;
        if (total_wealth > 0) {
            if (!heir_id.empty()) {
                g_world.npcs[heir_id].economy.savings += total_wealth;
            } else if (g_world.regions.count(dead_npc.currentLocation)) {
                g_world.regions[dead_npc.currentLocation].moneySupply += total_wealth;
            }
        }

        if (g_world.regions.count(dead_npc.currentLocation)) {
            Region& r = g_world.regions[dead_npc.currentLocation];
            int age_years = dead_npc.age_days / 360;
            if (age_years > 120) age_years = 120;
            r.age_pyramid[age_years] = std::max(0.0, r.age_pyramid[age_years] - 1.0);
            r.population = std::max(0, r.population - 1);
        }

        g_world.npcs.erase(id);
    }
}


void processDiplomacy() {
    for (auto& [fid, f] : g_world.factions) {
        // T3: 5.1 Casus Belli & 3.1 War Exhaustion
        if (f.warType >= DiplomaticState::BORDER_CONFLICT) {
            f.daysInCurrentWar++;
            double weGain = 1.0;
            
            if (f.currentCasusBelli == CasusBelli::NONE) {
                weGain += 2.0;
                if (f.daysInCurrentWar == 1) {
                    for (auto& [nid, nfac] : g_world.factions) {
                        if (nid != fid && f.diplomacy[nid] != "war") {
                            f.relations[nid] = std::max(-100, f.relations[nid] - 20);
                            nfac.relations[fid] = std::max(-100, nfac.relations[fid] - 20);
                        }
                    }
                    addNews(locStr("engine.news.war.unprovoked_aggression", {{"faction", f.name}}), "global", 5, "diplomacy");
                }
            }

            bool targetedByCoalition = false;
            for (const auto& [cid, cfac] : g_world.factions) {
                for (const auto& coal : cfac.coalitions) {
                    if (coal.targetFactionId == fid) targetedByCoalition = true;
                }
            }
            if (targetedByCoalition) weGain *= 1.5; // T3: 5.3 Coalition forces peace faster

            if (g_world.current_day % 7 == 0) f.warExhaustion = std::min(100, f.warExhaustion + (int)weGain); // Усталость растет раз в неделю, а не каждый день
        } else {
            f.daysInCurrentWar = 0;
        }

        // T3: 3.3 De-escalation (Forced Peace)
        if (f.warType != DiplomaticState::PEACE && f.warType != DiplomaticState::COLD_WAR) {
            if (f.warExhaustion >= 100) {
                f.warType = DiplomaticState::PEACE;
                f.legitimacy -= 30;
                f.warExhaustion = 0;
                addNews(locStr("engine.news.diplomacy.forced_peace", {{"faction", f.name}}), "global", 5, "diplomacy");
                for (auto& [otherId, state] : f.diplomacy) {
                    if (state == "war") {
                        f.diplomacy[otherId] = "neutral";
                        f.truceUntil[otherId] = g_world.current_day + 180; // Перемирие на полгода после истощения
                        if (g_world.factions.count(otherId)) {
                            g_world.factions[otherId].diplomacy[fid] = "neutral";
                            g_world.factions[otherId].warType = DiplomaticState::PEACE;
                            g_world.factions[otherId].truceUntil[fid] = g_world.current_day + 180;
                        }
                    }
                }
            } else if (f.warExhaustion >= 80 && (thread_safe_rand() % 100) < 10) {
                addNews(locStr("engine.news.diplomacy.exhaustion_peace", {{"faction", f.name}}), "global", 4, "diplomacy");
            }
        }

        // T3: 3.2 Escalation
        if (f.warType == DiplomaticState::LIMITED_WAR) {
            if (f.activeWarGoal.deadlineDays > 0) {
                f.activeWarGoal.deadlineDays--;
                if (f.activeWarGoal.deadlineDays == 0 && !f.activeWarGoal.achieved && f.legitimacy > 50) {
                    f.warType = DiplomaticState::TOTAL_WAR;
                    addNews(locStr("engine.news.war.total_war", {{"faction", f.name}}), "global", 5, "war");
                }
            }
        }

        // T3: 5.2 Ultimatums Processing
        for (auto it = f.ultimatums.begin(); it != f.ultimatums.end(); ) {
            it->expiresDay--;
            if (it->expiresDay <= 0) {
                                if (!it->accepted) {
                    if (g_world.factions.count(it->fromFactionId)) {
                        Faction& issuer = g_world.factions[it->fromFactionId];
                        if (g_world.current_day > 180) { // Война по ультиматуму только после полугода
                            issuer.warType = DiplomaticState::LIMITED_WAR;
                            issuer.diplomacy[fid] = "war";
                            f.diplomacy[issuer.id] = "war";
                            addNews(locStr("engine.news.diplomacy.ultimatum_rejected_war", {{"issuer", issuer.name}, {"faction", f.name}}), "global", 5, "diplomacy");
                            
                            bool hasCoalition = false;
                            for (auto& c : issuer.coalitions) {
                                if (c.targetFactionId == fid) { hasCoalition = true; break; }
                            }
                            if (!hasCoalition) {
                                Coalition c;
                                c.leaderFactionId = issuer.id;
                                c.targetFactionId = fid;
                                c.formedOnDay = g_world.current_day;
                                c.members.push_back(issuer.id);
                                issuer.coalitions.push_back(c);
                                addNews(locStr("engine.news.diplomacy.coalition_formed", {{"faction", f.name}, {"leader", issuer.name}}), "global", 5, "diplomacy");
                            }
                        } else {
                            addNews(locStr("engine.news.diplomacy.ultimatum_rejected_threat", {{"issuer", issuer.name}}), "global", 4, "diplomacy");
                        }
                    }
                }
                it = f.ultimatums.erase(it);
            } else {
                ++it;
            }
        }

        // T3: 5.2 AI issuing ultimatums
        if (f.warType >= DiplomaticState::BORDER_CONFLICT && f.warExhaustion > 50) {
            std::string victimId = "";
            for (const auto& [otherId, state] : f.diplomacy) {
                if (state == "war") { victimId = otherId; break; }
            }
            if (!victimId.empty()) {
                for (auto& [nId, nFac] : g_world.factions) {
                    if (nId != fid && nId != victimId && nFac.warType == DiplomaticState::PEACE) {
                        if (nFac.relations[victimId] > 60) {
                            bool alreadyIssued = false;
                            for (const auto& u : f.ultimatums) if (u.fromFactionId == nId) alreadyIssued = true;
                            if (!alreadyIssued && (thread_safe_rand() % 100) < 5) {
                                Ultimatum u;
                                u.fromFactionId = nId;
                                u.toFactionId = fid;
                                u.demand = "stop_war";
                                u.expiresDay = 7;
                                f.ultimatums.push_back(u);
                                addNews(locStr("engine.news.diplomacy.ultimatum_issued", {{"issuer", nFac.name}, {"faction", f.name}}), "global", 5, "diplomacy");
                            }
                        }
                    }
                }
            }
        }
        
        // T3: 5.4 Mediation
        if (f.warType >= DiplomaticState::BORDER_CONFLICT) {
            std::string enemyId = "";
            for (const auto& [otherId, state] : f.diplomacy) {
                if (state == "war") { enemyId = otherId; break; }
            }
            if (!enemyId.empty() && g_world.factions.count(enemyId)) {
                for (auto& [nId, nFac] : g_world.factions) {
                    if (nId != fid && nId != enemyId && nFac.warType == DiplomaticState::PEACE) {
                        if (nFac.relations[fid] > 40 && nFac.relations[enemyId] > 40 && (thread_safe_rand() % 100) < 2) {
                            f.warExhaustion = std::max(0, f.warExhaustion - 10);
                            g_world.factions[enemyId].warExhaustion = std::max(0, g_world.factions[enemyId].warExhaustion - 10);
                            addNews(locStr("engine.news.diplomacy.mediation", {{"mediator", nFac.name}, {"faction1", f.name}, {"faction2", g_world.factions[enemyId].name}}), "global", 4, "diplomacy");
                        }
                    }
                }
            }
        }
    }
}


void processInternalPolitics() {
    std::vector<std::string> regionsToRebel;

    for (auto& [rid, r] : g_world.regions) {
        if (r.factionId.empty() || !g_world.factions.count(r.factionId)) continue;
        Faction& f = g_world.factions[r.factionId];
        
        if (r.productionBlockedDays > 0) r.productionBlockedDays--;
        if (r.daysUnderOccupation > 0) r.daysUnderOccupation++;

        if (r.isOccupied) {
            r.unrest = std::min(100, r.unrest + 5);
            if (r.daysUnderOccupation >= 30 && r.unrest < 50) {
                r.isOccupied = false;
                std::string oldFac = r.factionId;
                r.factionId = r.occupierFactionId;
                r.occupierFactionId = "";
                if (g_world.factions.count(oldFac)) {
                    auto& regs = g_world.factions[oldFac].regions;
                    regs.erase(std::remove(regs.begin(), regs.end(), rid), regs.end());
                }
                if (g_world.factions.count(r.factionId)) {
                    g_world.factions[r.factionId].regions.push_back(rid);
                }
                addNews(locStr("engine.news.assimilation", {{"region", r.name}, {"faction", g_world.factions[r.factionId].name}}), rid, 4, "politics");
            }
        }

        int targetStability = 70;
        if (f.warType == DiplomaticState::LIMITED_WAR) targetStability -= 10;
        else if (f.warType == DiplomaticState::TOTAL_WAR) targetStability -= 20;
        
        if (r.starvation_days > 0) targetStability -= 20;
        if (f.warType >= DiplomaticState::LIMITED_WAR) targetStability -= 10;
        
        targetStability += (f.legitimacy - 50) / 2;

        bool hasGarrison = false;
        for (const auto& a : f.armies) {
            if (a.location == rid || a.destination == rid) { hasGarrison = true; break; }
        }
        if (hasGarrison) targetStability += 10;

        if (r.stability > targetStability) r.stability--;
        else if (r.stability < targetStability) r.stability++;

        r.stability = std::clamp(r.stability, 0, 100);

        if (r.stability < 30 && r.unrest < 50 && (thread_safe_rand() % 100) < 3) {
            r.unrest = 100;
            r.productionBlockedDays = 5;
            r.population = std::max(0, (int)(r.population * 0.95));
            
            std::string w_id = getCoreIdByTag("weapon");
            int foodLost = getFoodAmount(r.vault_id) * 0.1;
            int weaponsLost = countItemsInContainer(r.vault_id, w_id) * 0.1;
            if (foodLost > 0) consumeFood(r.vault_id, foodLost);
            if (weaponsLost > 0) consumeItemsFromContainer(r.vault_id, w_id, weaponsLost);

            addNews(locStr("engine.news.riot", {{"region", r.name}}), rid, 4, "disaster");

            std::string capitalId = f.regions.empty() ? "" : f.regions[0];
            if (rid == capitalId) {
                f.legitimacy = std::max(0, f.legitimacy - 10);
                addNews(locStr("engine.news.capital_riot", {{"faction", f.name}}), rid, 5, "politics");
            }
        } else {
            r.unrest = std::max(0, r.unrest - 10);
        }

        std::string riskKey = rid + "_disaster_count";
        int capRisk = g_world.nexusData.count(riskKey) ? g_world.nexusData[riskKey].asInt() : 0;
        
        if (capRisk > 3) {
            int gold = countItemsInContainer(r.vault_id, getCoreIdByTag("currency"));
            int defLevel = r.custom_props.has("disaster_defense") ? r.custom_props["disaster_defense"].asInt() : 0;
            int cost = (defLevel + 1) * 5000;
            
            if (gold >= cost) {
                consumeItemsFromContainer(r.vault_id, getCoreIdByTag("currency"), cost);
                r.custom_props.set("disaster_defense", defLevel + 1);
                addNews(locStr("engine.news.disaster_defense", {{"faction", f.name}, {"level", std::to_string(defLevel+1)}, {"region", r.name}}), rid, 3, "politics");
                g_world.nexusData[riskKey] = JsonValue(std::max(0, capRisk - 2));
            } else if (f.regions.size() > 1 && capRisk > 5 && rid == f.regions[0]) {
                std::string newCap = "";
                int minRisk = 999;
                for (const auto& rId : f.regions) {
                    int rRisk = g_world.nexusData.count(rId + "_disaster_count") ? g_world.nexusData[rId + "_disaster_count"].asInt() : 0;
                    if (rRisk < minRisk) { minRisk = rRisk; newCap = rId; }
                }
                if (!newCap.empty() && newCap != rid) {
                    auto it = std::find(f.regions.begin(), f.regions.end(), newCap);
                    if (it != f.regions.end()) {
                        f.regions.erase(it);
                        f.regions.insert(f.regions.begin(), newCap);
                        addNews(locStr("engine.news.capital_moved", {{"faction", f.name}, {"region", g_world.regions[newCap].name}}), newCap, 5, "politics");
                    }
                }
            }
        }

        if (r.stability < 10 && !hasGarrison) {
            regionsToRebel.push_back(rid);
        }
    }

    for (const auto& rid : regionsToRebel) {
        Region& r = g_world.regions[rid];
        std::string oldFaction = r.factionId;
        r.factionId = "";
        if (g_world.factions.count(oldFaction)) {
            auto& regs = g_world.factions[oldFaction].regions;
            regs.erase(std::remove(regs.begin(), regs.end(), rid), regs.end());
            g_world.factions[oldFaction].legitimacy -= 10;
        }
        r.stability = 50;
        addNews(locStr("engine.news.independence", {{"region", r.name}}), rid, 5, "politics");
    }

    for (auto& [fid, f] : g_world.factions) {
        if (f.legitimacy < 20 && (thread_safe_rand() % 100) < 10) {
            if (g_world.npcs.count(f.rulerId)) {
                NPC& ruler = g_world.npcs[f.rulerId];
                ruler.isAlive = false;
                ruler.alive = false;
                ruler.death_cause = locStr("engine.reason.coup_death");
                
                f.warType = DiplomaticState::PEACE;
                f.warExhaustion = 0;
                f.legitimacy = 50;

                addNews(locStr("engine.news.coup", {{"ruler", ruler.name}, {"faction", f.name}}), "global", 5, "politics");
            }
        }
        
        int totalStab = 0;
        int count = 0;
        for (const auto& rid : f.regions) {
            if (g_world.regions.count(rid)) {
                totalStab += g_world.regions[rid].stability;
                count++;
            }
        }
        if (count > 0) f.stability = totalStab / count;
    }
}


void processShipyards() {
    for (auto& [rid, port] : g_world.port_facilities) {
        if (!port.has_shipyard) continue;
        for (auto it = port.build_queue.begin(); it != port.build_queue.end(); ) {
            it->days_left--;
            if (it->days_left <= 0) {
                Ship s;
                s.id = "ship_" + generateUUID();
                s.owner_id = it->owner_id;
                s.type = it->type;
                s.hull = (it->type == ShipType::WAR_GALLEY || it->type == ShipType::WAR_FRIGATE) ? 200 : 100;
                s.sailors = (it->type == ShipType::WAR_GALLEY) ? 40 : 15;
                s.cargo_capacity = (it->type == ShipType::WAR_GALLEY) ? 100 : 500;
                s.chest_id = createContainer("ship_hold", it->owner_id, 999999, 100, rid);
                s.speed = (it->type == ShipType::WAR_GALLEY) ? 1.2 : 1.5;
                if (it->type == ShipType::WAR_GALLEY || it->type == ShipType::WAR_FRIGATE) {
                    s.cannons = 10; s.marines = 20;
                }
                applyShipTypeRuntimeDescriptor(s);
                if (g_world.map.locations.count(rid)) {
                    s.x = g_world.map.locations[rid].x;
                    s.y = g_world.map.locations[rid].y;
                }
                g_world.ships.push_back(s);
                addNews(locStr("engine.news.ship_built", {{"region", g_world.regions[rid].name}}), rid, 2, "trade");
                it = port.build_queue.erase(it);
            } else {
                ++it;
            }
        }
    }
}


void processMonsterHunts() {
    for (auto& m : g_world.monsters) {
        if (m.health <= 0 || m.state != "ACTIVE") continue;
        if (!g_world.regions.count(m.region_id)) continue;
        Region& r = g_world.regions[m.region_id];
        if (r.factionId.empty() || !g_world.factions.count(r.factionId)) continue;
        Faction& f = g_world.factions[r.factionId];

        bool alreadyHunting = false;
        for (const auto& a : f.armies) {
            if (a.target_monster_id == m.id) { alreadyHunting = true; break; }
        }

        if (!alreadyHunting && (thread_safe_rand() % 100) < 10) {
            std::string capId = f.regions.empty() ? "" : f.regions[0];
            if (!capId.empty() && g_world.regions.count(capId)) {
                int huntSize = std::max(500, g_world.regions[capId].population / 10); // Лимит снят, масштабируется от населения
                if (g_world.regions[capId].population > huntSize * 2) {
                    g_world.regions[capId].population -= huntSize;
                    Army hunter;
                    hunter.id = "army_" + generateUUID();
                    hunter.size = huntSize;
                    hunter.morale = 100;
                    hunter.location = capId;
                    hunter.destination = m.region_id;
                    hunter.target_monster_id = m.id;
                    hunter.current_phase = "march";
                    
                    std::vector<bool> dummy_has_road(g_world.map.width * g_world.map.height, false);
                    std::vector<int> dummy_path_status(g_world.map.width * g_world.map.height, 0);
                    if (g_world.map.locations.count(capId) && g_world.map.locations.count(m.region_id)) {
                        auto loc1 = g_world.map.locations[capId];
                        auto loc2 = g_world.map.locations[m.region_id];
                        hunter.path = findPath(g_world.map, loc1.x, loc1.y, loc2.x, loc2.y, dummy_has_road, dummy_path_status, MovementType::ANY, huntSize);
                        if (!hunter.path.empty()) {
                            hunter.x = hunter.path[0].first;
                            hunter.y = hunter.path[0].second;
                        }
                    }
                    
                    f.armies.push_back(hunter);
                    addNews(locStr("engine.news.great_hunt", {{"faction", f.name}, {"monster", m.name}}), capId, 5, "war");
                }
            }
        }
    }

    for (auto& [fid, f] : g_world.factions) {
        for (auto& a : f.armies) {
            if (!a.target_monster_id.empty()) {
                EpicMonster* target = nullptr;
                for (auto& m : g_world.monsters) {
                    if (m.id == a.target_monster_id && m.health > 0) {
                        target = &m; break;
                    }
                }

                if (target) {
                    if (a.location == target->region_id) {
                        if (target->level >= 5) {
                            for (auto& [ofid, of] : g_world.factions) {
                                if (f.diplomacy[ofid] == "war") {
                                    f.diplomacy[ofid] = "neutral";
                                    of.diplomacy[f.id] = "neutral";
                                    f.truceUntil[ofid] = 999999;
                                    of.truceUntil[f.id] = 999999;
                                    addNews(locStr("engine.news.great_threat_truce", {{"faction1", f.name}, {"faction2", of.name}, {"monster", target->name}}), a.location, 5, "diplomacy");
                                }
                            }
                        }

                        double armyPower = a.size * (a.morale / 100.0);
                        double monsterPower = target->attack * (target->health / (double)target->maxHealth) * target->level * 10;

                        int armyDmg = (int)(monsterPower * ((thread_safe_rand() % 50 + 50) / 100.0));
                        int monsterDmg = (int)(armyPower * ((thread_safe_rand() % 50 + 50) / 100.0));

                        a.size -= armyDmg;
                        target->health -= monsterDmg;

                        if (target->health <= 0) {
                            target->health = 0;
                            std::string locName1 = g_world.regions.count(a.location) ? g_world.regions[a.location].name : a.location;
                            addNews(locStr("engine.news.epic_victory", {{"faction", f.name}, {"monster", target->name}, {"region", locName1}}), a.location, 5, "war");
                            for (auto& [ofid, of] : g_world.factions) {
                                if (of.diplomacy[f.id] == "neutral" && of.truceUntil[f.id] == 999999) {
                                    of.truceUntil[f.id] = g_world.current_day + 30;
                                    f.truceUntil[ofid] = g_world.current_day + 30;
                                }
                            }
                            f.legitimacy = std::min(100, f.legitimacy + 20);
                            a.target_monster_id = "";
                            a.destination = a.location;
                            a.path.clear();
                            createItem(getCoreIdByTag("magic_raw"), target->level * 2, g_world.regions[a.location].vault_id, g_world.current_day, "Трофеи с монстра");
                            createItem(getCoreIdByTag("currency"), target->level * 1000, g_world.regions[a.location].vault_id, g_world.current_day, "Трофеи с монстра");
                        } else if (a.size <= 0) {
                            std::string locName2 = g_world.regions.count(a.location) ? g_world.regions[a.location].name : a.location;
                            addNews(locStr("engine.news.army_destroyed_by_monster", {{"faction", f.name}, {"monster", target->name}, {"region", locName2}}), a.location, 5, "disaster");
                            f.legitimacy = std::max(0, f.legitimacy - 15);
                            if (!a.general_id.empty() && g_world.npcs.count(a.general_id)) {
                                NPC& gen = g_world.npcs[a.general_id];
                                if (gen.type == "ruler") {
                                    gen.health = 0;
                                    gen.isAlive = false;
                                    addNews(locStr("engine.news.king_fallen_monster", {{"ruler", gen.name}}), a.location, 5, "disaster");
                                }
                            }
                        } else {
                            addNews(locStr("engine.news.battle_with_monster", {{"faction", f.name}, {"monster", target->name}}), a.location, 4, "war");
                        }
                    } else {
                        if (a.destination != target->region_id) {
                            a.destination = target->region_id;
                            std::vector<bool> dummy_has_road(g_world.map.width * g_world.map.height, false);
                            std::vector<int> dummy_path_status(g_world.map.width * g_world.map.height, 0);
                            if (g_world.map.locations.count(a.location) && g_world.map.locations.count(target->region_id)) {
                                auto loc1 = g_world.map.locations[a.location];
                                auto loc2 = g_world.map.locations[target->region_id];
                                a.path = findPath(g_world.map, loc1.x, loc1.y, loc2.x, loc2.y, dummy_has_road, dummy_path_status, MovementType::ANY, a.size);
                                a.path_index = 0;
                            }
                        }
                    }
                } else {
                    a.target_monster_id = "";
                    a.destination = a.location;
                    a.path.clear();
                }
            }
        }
        f.armies.erase(std::remove_if(f.armies.begin(), f.armies.end(), [](const Army& a) { return a.size <= 0; }), f.armies.end());
    }
}



void processDreadAndMonsters() {
    for (auto& [rid, r] : g_world.regions) {
        if (r.threat_level > 50) r.dread += 1;
        if (r.unrest > 50) r.dread += 1;
        
        if (g_world.map.locations.count(rid)) {
            std::string locType = g_world.map.locations[rid].type;
            if (locType == "ruins" || locType == "anomaly") r.dread += 1;
            if (locType == "ruins" && (thread_safe_rand() % 1000) < 5) {
                r.dread += 50;
                addNews(locStr("engine.news.ruins_awakened", {{"region", r.name}}), rid, 3, "misc");
            }
        }
        for (const auto& intr : g_world.intrigues) {
            if (intr.targetFactionId == r.factionId && !intr.isDiscovered) r.dread += 1;
        }

        if (r.threat_level < 20) r.dread = std::max(0, r.dread - 2);
        r.dread = std::clamp(r.dread, 0, 100);

        if (r.dread > 80 && (thread_safe_rand() % 100) < (r.dread - 80)) {
            int nextSpawnDay = 0;
            if (g_world.nexusData.count("next_epic_monster_spawn_day")) {
                nextSpawnDay = g_world.nexusData["next_epic_monster_spawn_day"].asInt();
            }

            if (g_world.current_day >= nextSpawnDay) {
                bool hasMonster = false;
                for (const auto& m : g_world.monsters) if (m.region_id == rid && m.health > 0) hasMonster = true;
                
                if (!hasMonster) {
                    EpicMonster m;
                    m.id = "epic_" + generateUUID();
                    
                    std::vector<std::string> possible_monsters;
                    for (const auto& [m_id, m_def] : g_db.monsters) {
                        if (m_def.spawn_biome_tag == r.placement_type || m_def.spawn_biome_tag == "any" || m_def.spawn_biome_tag.empty()) {
                            possible_monsters.push_back(m_id);
                        }
                    }
                    if (possible_monsters.empty()) {
                        for (const auto& [m_id, m_def] : g_db.monsters) possible_monsters.push_back(m_id);
                    }
                    
                    if (!possible_monsters.empty()) {
                        std::string chosen_m_id = possible_monsters[thread_safe_rand() % possible_monsters.size()];
                        const MonsterDef& m_def = g_db.monsters[chosen_m_id];
                        m.type = m_def.string_id;
                        m.name = m_def.name;
                        m.health = m_def.base_hp;
                        m.maxHealth = m_def.base_hp;
                        m.attack = m_def.base_attack;
                        m.defense = m_def.base_defense;
                    } else if (!g_db.monsters.empty()) {
                        const MonsterDef& m_def = g_db.monsters.begin()->second;
                        m.type = m_def.string_id;
                        m.name = m_def.name;
                        m.health = m_def.base_hp;
                        m.maxHealth = m_def.base_hp;
                        m.attack = m_def.base_attack;
                        m.defense = m_def.base_defense;
                    } else {
                        continue; // No monsters defined in DB, skip spawn
                    }
                    
                    m.region_id = rid;
                    m.is_visible_on_map = false;
                    if (g_world.map.locations.count(rid)) {
                        m.lair_x = g_world.map.locations[rid].x;
                        m.lair_y = g_world.map.locations[rid].y;
                        
                        int radius = 2;
                        std::string corruptTypeStr = g_db.monsters.count(m.type) ? g_db.monsters[m.type].corrupt_biome_to : "ash";
                        uint8_t corruptType = g_db.biome_string_to_id.count(corruptTypeStr) ? g_db.biome_string_to_id[corruptTypeStr] : 0;
                        
                        for (int dy = -radius; dy <= radius; dy++) {
                            for (int dx = -radius; dx <= radius; dx++) {
                                if (std::hypot(dx, dy) <= radius) {
                                    int nx = m.lair_x + dx;
                                    int ny = m.lair_y + dy;
                                    if (nx >= 0 && nx < g_world.map.width && ny >= 0 && ny < g_world.map.height) {
                                        g_world.map.grid[ny * g_world.map.width + nx].biome_id = corruptType;
                                    }
                                }
                            }
                        }
                        g_world.map.generation_tick = g_world.tick;
                    }
                    m.treasure_chest_id = createContainer("monster_lair", "monster", 999999, 100, rid);
                    createItem(getCoreIdByTag("currency"), 5000 + (thread_safe_rand() % 5000), m.treasure_chest_id, g_world.current_day, "Сокровища логова");
                    g_world.monsters.push_back(m);
                    
                    g_world.nexusData["next_epic_monster_spawn_day"] = JsonValue(g_world.current_day + 30); // Кулдаун снижен с 900 до 30 дней
                    
                    addNews(locStr("engine.news.evil_awakened", {{"region", r.name}, {"monster", m.name}}), rid, 5, "disaster");
                    r.dread = 0;
                }
            }
        }
    }

    for (auto it = g_world.monsters.begin(); it != g_world.monsters.end(); ) {
        if (it->health <= 0) {
            addNews(locStr("engine.news.monster_defeated", {{"monster", it->name}}), it->region_id, 5, "misc");
            it = g_world.monsters.erase(it);
            continue;
        }
        
        it->days_active++;
        if (it->days_active % 30 == 0) { // Лимит на 10 уровень снят
            it->level++;
            it->maxHealth += 500;
            it->health += 500;
            it->attack += 10;
            it->defense += 5;
            addNews(locStr("engine.news.threat_grows", {{"monster", it->name}, {"level", std::to_string(it->level)}}), it->region_id, 4, "disaster");
        }

        if (it->state == "ACTIVE" && g_world.regions.count(it->region_id)) {
            Region& r = g_world.regions[it->region_id];
            
            if (!it->is_visible_on_map) {
                if (r.dread >= 100) it->is_visible_on_map = true;
                if (!r.factionId.empty() && g_world.factions.count(r.factionId)) {
                    for (const auto& a : g_world.factions[r.factionId].armies) {
                        if (a.location == it->region_id) it->is_visible_on_map = true;
                    }
                }
            }

            if ((thread_safe_rand() % 100) < 20) r.stability = std::max(0, r.stability - 1);
            r.threat_level = std::min(100, r.threat_level + 5);
            int deaths = r.population * 0.01;
            r.population = std::max(0, r.population - deaths);
            
            r.fertility = std::max(0.0, r.fertility - 0.05);
            for (auto& [good, price] : r.markets) {
                price *= 1.05;
            }
            
            if (!r.facilities.empty() && (thread_safe_rand() % 100) < 20) {
                auto fac_it = r.facilities.begin();
                std::advance(fac_it, thread_safe_rand() % r.facilities.size());
                fac_it->second.durability -= 20;
                if (fac_it->second.durability < 0) fac_it->second.durability = 0;
            }
            if ((thread_safe_rand() % 100) < 20) {
                for (auto& road : g_world.map.roads) {
                    if (road.from == it->region_id || road.to == it->region_id) {
                        road.condition = "ruined";
                        road.integrity = 0;
                        g_path_cache_dirty = true;
                    }
                }
                if (g_world.port_facilities.count(it->region_id)) {
                    g_world.port_facilities[it->region_id].durability -= 20;
                }
            }

            if (!r.factionId.empty() && g_world.factions.count(r.factionId)) {
                std::string capId = g_world.factions[r.factionId].regions.empty() ? "" : g_world.factions[r.factionId].regions[0];
                if (!capId.empty() && g_world.regions.count(capId)) {
                    int gold = countItemsInContainer(g_world.regions[capId].vault_id, getCoreIdByTag("currency"));
                    if (gold >= g_gameplay_runtime.monster_bounty_gold_cost && (thread_safe_rand() % 100) < 10) {
                        consumeItemsFromContainer(g_world.regions[capId].vault_id, getCoreIdByTag("currency"), g_gameplay_runtime.monster_bounty_gold_cost);
                        int mercDmg = 500 + (thread_safe_rand() % 500);
                        it->health -= mercDmg;
                        addNews(locStr("engine.news.monster_bounty", {{"faction", g_world.factions[r.factionId].name}, {"monster", it->name}}), it->region_id, 4, "war");
                    }
                }
            }

            if (it->days_active % 7 == 0 && (thread_safe_rand() % 100) < 30) {
                std::vector<std::string> neighbors;
                for (const auto& road : g_world.map.roads) {
                    if (road.from == it->region_id) neighbors.push_back(road.to);
                    if (road.to == it->region_id) neighbors.push_back(road.from);
                }
                if (!neighbors.empty()) {
                    std::string best_reg = neighbors[0];
                    double best_score = -1;
                    for (const auto& n : neighbors) {
                        if (g_world.regions.count(n)) {
                            double score = g_world.regions[n].population + g_world.regions[n].moneySupply;
                            if (score > best_score) { best_score = score; best_reg = n; }
                        }
                    }
                    addNews(locStr("engine.news.monster_migration", {{"monster", it->name}, {"from", r.name}, {"to", g_world.regions[best_reg].name}}), best_reg, 5, "disaster");
                    it->region_id = best_reg;
                    if (g_world.map.locations.count(best_reg)) {
                        it->lair_x = g_world.map.locations[best_reg].x;
                        it->lair_y = g_world.map.locations[best_reg].y;
                        
                        int radius = 2;
                        std::string corruptTypeStr = g_db.monsters.count(it->type) ? g_db.monsters[it->type].corrupt_biome_to : "ash";
                        uint8_t corruptType = g_db.biome_string_to_id.count(corruptTypeStr) ? g_db.biome_string_to_id[corruptTypeStr] : 0;
                        
                        for (int dy = -radius; dy <= radius; dy++) {
                            for (int dx = -radius; dx <= radius; dx++) {
                                if (std::hypot(dx, dy) <= radius) {
                                    int nx = it->lair_x + dx;
                                    int ny = it->lair_y + dy;
                                    if (nx >= 0 && nx < g_world.map.width && ny >= 0 && ny < g_world.map.height) {
                                        g_world.map.grid[ny * g_world.map.width + nx].biome_id = corruptType;
                                    }
                                }
                            }
                        }
                        g_world.map.generation_tick = g_world.tick;
                    }
                }
            }
        }
        ++it;
    }
}



void dailyTick() {
    triggerJsHook("onBeforeDailyTick");
    g_world.current_day++;

    g_pluginManager.runDailyHooks();
    
    // Очистка фантомных регионов (багфикс)
    for (auto it = g_world.regions.begin(); it != g_world.regions.end(); ) {
        if (it->second.name.empty() && it->second.population == 0 && it->second.vault_id.empty()) {
            it = g_world.regions.erase(it);
        } else {
            ++it;
        }
    }

    processDailyBusinesses();

    if (!g_bootstrap) {
        int activeWars = 0;

        for (auto& [fid, faction] : g_world.factions) {
            for (auto& [tid, status] : faction.diplomacy) {
                if (status == "war") activeWars++;
            }
        }
        activeWars /= 2;
        if (activeWars >= 1) { // Усталость копится даже при 1 войне
            g_world.homeostasis.warWeariness = std::min(100, g_world.homeostasis.warWeariness + 4);
            g_world.homeostasis.peaceBoredom = 0;
        } else if (activeWars == 0) {
            g_world.homeostasis.warWeariness = std::max(0, g_world.homeostasis.warWeariness - 2);
            g_world.homeostasis.peaceBoredom++;
        } else {
            g_world.homeostasis.peaceBoredom = 0;
        }
    }
    
    processSpoilage();
    processLogistics();
    processPrivateProduction();
    processDailyEconomy();
    processMarkets();
    processFarmers();
    processGatherers();
    processArtisans();
    processMages();
    processServices();
    
    if (!g_bootstrap) {
        processDailyMilitary();

        processNavalCombat();
        processRulerDiplomacy();
        processIntrigues();
        processDiplomacy();
        processInternalPolitics();
    }

    processMerchants();

    if (!g_bootstrap) {
        processDailyThreat();
        processDreadAndMonsters();
        processMonsterHunts();
        checkRulerDeaths();
    }
    processDailyNPCs();

    processShipyards();

    if (!g_bootstrap) {
        processDisasters();
    }

    triggerJsHook("onAfterDailyTick");
}

void processNavalCombat() {
    for (const auto& [rid, port] : g_world.port_facilities) {
        if (g_world.regions.count(rid)) {
            Region& r = g_world.regions[rid];
            int pirate_base_chance = (r.weather == "Туман") ? 10 : 2;
            if (r.threat_level > 80 && (thread_safe_rand() % 100) < pirate_base_chance) {
                auto loc = g_world.map.locations[rid];
                int bx = loc.x + (rand()%15 - 7);
                int by = loc.y + (rand()%15 - 7);
                bx = std::clamp(bx, 1, g_world.map.width - 2);
                by = std::clamp(by, 1, g_world.map.height - 2);
                uint8_t b_id = g_world.map.grid[by * g_world.map.width + bx].biome_id;
                std::string b_str = getBiomeStringId(b_id);
                if (b_str == "ocean") {
                    std::string baseId = "pirate_base_" + generateUUID();
                    MapLocation pBase;
                    pBase.id = baseId;
                    pBase.name = "Пиратская бухта";
                    pBase.x = bx; pBase.y = by;
                    pBase.type = "pirate_base";
                    pBase.faction = "pirates";
                    g_world.map.locations[baseId] = pBase;
                    addNews(locStr("engine.news.pirate_base_found", {{"region", r.name}}), rid, 4, "war");
                }
            }
            if (r.threat_level > 60 && (thread_safe_rand() % 100) < 5) {
                Ship p;
                p.id = "ship_" + generateUUID();
                p.owner_id = "pirates";
                p.type = ShipType::PIRATE;
                p.hull = 100;
                p.sailors = 20;
                p.cargo_capacity = 200;
                p.chest_id = createContainer("ship_hold", "pirates", 999999, 100, rid);
                p.speed = 1.8;
                p.cannons = 5;
                p.marines = 15;
                applyShipTypeRuntimeDescriptor(p);
                if (g_world.map.locations.count(rid)) {
                    p.x = g_world.map.locations[rid].x;
                    p.y = g_world.map.locations[rid].y;
                }
                for (const auto& target : g_world.ships) {
                    if (target.type == ShipType::MERCHANT && target.owner_id != "pirates") {
                        p.destination = target.destination;
                        p.path = target.path;
                        p.path_index = target.path_index;
                        break;
                    }
                }
                g_world.ships.push_back(p);
                addNews(locStr("engine.news.pirates_spotted", {{"region", r.name}}), rid, 3, "war");
            }
        }
    }

    for (size_t i = 0; i < g_world.fleets.size(); i++) {
        for (size_t j = i + 1; j < g_world.fleets.size(); j++) {
            Fleet& f1 = g_world.fleets[i];
            Fleet& f2 = g_world.fleets[j];
            double dist = std::hypot(f1.x - f2.x, f1.y - f2.y);
            if (dist <= 4.0) {
                bool hostile = false;
                if (g_world.factions.count(f1.owner_id) && g_world.factions.count(f2.owner_id)) {
                    if (g_world.factions[f1.owner_id].diplomacy[f2.owner_id] == "war") hostile = true;
                }
                if (hostile) {
                    int f1_cannons = 0, f2_cannons = 0;
                    int f1_marines = 0, f2_marines = 0;
                    for (auto& s : g_world.ships) {
                        if (s.fleet_id == f1.id && s.hull > 0) { f1_cannons += s.cannons; f1_marines += s.marines; }
                        if (s.fleet_id == f2.id && s.hull > 0) { f2_cannons += s.cannons; f2_marines += s.marines; }
                    }
                    if ((f1_cannons > 0 || f1_marines > 0) && (f2_cannons > 0 || f2_marines > 0)) {
                        std::string n1 = g_world.factions.count(f1.owner_id) ? g_world.factions[f1.owner_id].name : f1.owner_id;
                        std::string n2 = g_world.factions.count(f2.owner_id) ? g_world.factions[f2.owner_id].name : f2.owner_id;
                        if (dist > 1.0) {
                            for (auto& s : g_world.ships) {
                                if (s.fleet_id == f1.id && s.hull > 0) s.hull -= (f2_cannons * 2) / std::max(1, (int)f1.ship_ids.size());
                                if (s.fleet_id == f2.id && s.hull > 0) s.hull -= (f1_cannons * 2) / std::max(1, (int)f2.ship_ids.size());
                            }
                            addNews(locStr("engine.news.naval_battle_artillery", {{"f1", n1}, {"f2", n2}}), "global", 4, "war");
                            double dx = f2.x - f1.x; double dy = f2.y - f1.y;
                            f1.x += (dx / dist) * 0.5; f1.y += (dy / dist) * 0.5;
                        } else {
                            if (f1_marines > f2_marines) {
                                for (auto& s : g_world.ships) if (s.fleet_id == f2.id && s.hull > 0) { s.owner_id = f1.owner_id; s.fleet_id = f1.id; s.marines = 0; }
                                addNews(locStr("engine.news.naval_battle_boarding", {{"winner", n1}, {"loser", n2}}), "global", 5, "war");
                            } else {
                                for (auto& s : g_world.ships) if (s.fleet_id == f1.id && s.hull > 0) { s.owner_id = f2.owner_id; s.fleet_id = f2.id; s.marines = 0; }
                                addNews(locStr("engine.news.naval_battle_boarding", {{"winner", n2}, {"loser", n1}}), "global", 5, "war");
                            }
                        }
                    }
                }
            }
        }
    }

    for (size_t i = 0; i < g_world.ships.size(); i++) {
        for (size_t j = i + 1; j < g_world.ships.size(); j++) {
            Ship& s1 = g_world.ships[i];
            Ship& s2 = g_world.ships[j];
            if (s1.hull <= 0 || s2.hull <= 0) continue;
            
            bool hostile = false;
            if (s1.owner_id == "pirates" || s2.owner_id == "pirates") hostile = true;
            else if (g_world.factions.count(s1.owner_id) && g_world.factions.count(s2.owner_id)) {
                if (g_world.factions[s1.owner_id].diplomacy[s2.owner_id] == "war") hostile = true;
            }
            
            if (hostile) {
                double dist = std::hypot(s1.x - s2.x, s1.y - s2.y);
                if (dist <= 2.0) {
                    // --- УЛУЧШЕННЫЙ МОРСКОЙ БОЙ ---
                    double hitChanceS1 = std::clamp(0.5 + (s1.speed - s2.speed) * 0.1, 0.1, 0.9);
                    double hitChanceS2 = std::clamp(0.5 + (s2.speed - s1.speed) * 0.1, 0.1, 0.9);
                    
                    int s1_dmg = 0;
                    for(int c=0; c<s1.cannons; ++c) if((thread_safe_rand()%100) < hitChanceS1*100) s1_dmg += 10 + thread_safe_rand()%10;
                    
                    int s2_dmg = 0;
                    for(int c=0; c<s2.cannons; ++c) if((thread_safe_rand()%100) < hitChanceS2*100) s2_dmg += 10 + thread_safe_rand()%10;

                    s2.hull -= s1_dmg;
                    s1.hull -= s2_dmg;
                    // -------------------------------
                    
                    if (s1.hull > 0 && s2.hull > 0 && dist <= 1.0) {
                        int s1_power = s1.marines + s1.sailors / 2;
                        int s2_power = s2.marines + s2.sailors / 2;
                        if (s1_power > s2_power) {
                            s2.marines = 0; s2.sailors /= 2; s2.hull -= 20;
                        } else {
                            s1.marines = 0; s1.sailors /= 2; s1.hull -= 20;
                        }
                    }
                    addNews(locStr("engine.news.naval_skirmish", {{"f1", s1.owner_id}, {"f2", s2.owner_id}}), "global", 3, "war");
                }
            }
        }
    }
    
    for (const auto& [lid, loc] : g_world.map.locations) {
        int spawn_chance = 10;
        if (g_world.regions.count(lid) && g_world.regions[lid].weather == "Туман") spawn_chance = 30;
        if (loc.type == "pirate_base" && (thread_safe_rand() % 100) < spawn_chance) {
            Ship p;
            p.id = "ship_" + generateUUID();
            p.owner_id = "pirates";
            p.type = ShipType::PIRATE;
            p.hull = 100; p.sailors = 20; p.cargo_capacity = 200;
            p.chest_id = createContainer("ship_hold", "pirates", 999999, 100, lid);
            p.speed = 1.8;
            p.cannons = 5; p.marines = 15;
            applyShipTypeRuntimeDescriptor(p);
            p.x = loc.x; p.y = loc.y;
            for (const auto& target : g_world.ships) {
                if (target.type == ShipType::MERCHANT && target.owner_id != "pirates") {
                    p.destination = target.destination;
                    p.path = target.path;
                    p.path_index = target.path_index;
                    break;
                }
            }
            g_world.ships.push_back(p);
        }
    }
    
    for (auto& ship : g_world.ships) {
        if (ship.type == ShipType::SEA_MONSTER) {
            double min_dist = 9999;
            Ship* target = nullptr;
            for (auto& s : g_world.ships) {
                if (s.id != ship.id && s.type != ShipType::SEA_MONSTER && s.hull > 0) {
                    double d = std::hypot(s.x - ship.x, s.y - ship.y);
                    if (d < min_dist) { min_dist = d; target = &s; }
                }
            }
            if (target) {
                if (min_dist <= 1.5) {
                    if (target->cannons > 0 || target->marines > 0) {
                        ship.hull -= (target->cannons * 10 + target->marines * 5);
                        target->hull -= 30;
                        addNews(locStr("engine.news.sea_monster_battle"), "global", 4, "war");
                        if (ship.hull <= 0) addNews(locStr("engine.news.sea_monster_killed"), "global", 5, "war");
                    } else {
                        target->hull -= 50;
                        addNews(locStr("engine.news.sea_monster_attack"), "global", 4, "disaster");
                    }
                } else {
                    double dx = target->x - ship.x;
                    double dy = target->y - ship.y;
                    ship.x += (dx / min_dist) * ship.speed;
                    ship.y += (dy / min_dist) * ship.speed;
                }
            }
            continue;
        }
        if (ship.type == ShipType::WAR_GALLEY || ship.type == ShipType::WAR_FRIGATE) {
            for (auto it = g_world.map.locations.begin(); it != g_world.map.locations.end(); ) {
                if (it->second.type == "pirate_base") {
                    if (std::hypot(ship.x - it->second.x, ship.y - it->second.y) <= 2.0) {
                        std::string nearest_region = "";
                        double min_d = 9999;
                        for (const auto& [rid, rloc] : g_world.map.locations) {
                            if (rloc.type != "pirate_base" && g_world.regions.count(rid)) {
                                double d = std::hypot(it->second.x - rloc.x, it->second.y - rloc.y);
                                if (d < min_d) { min_d = d; nearest_region = rid; }
                            }
                        }
                        if (!nearest_region.empty()) {
                            g_world.regions[nearest_region].threat_level = std::max(0, g_world.regions[nearest_region].threat_level - 20);
                        }
                        
                        if (g_world.factions.count(ship.owner_id)) {
                            std::string capId = g_world.factions[ship.owner_id].regions.empty() ? "" : g_world.factions[ship.owner_id].regions[0];
                            if (!capId.empty() && g_world.regions.count(capId)) {
                                createItem(getCoreIdByTag("currency"), 2000, g_world.regions[capId].vault_id, g_world.current_day, "Награда за пиратов");
                            }
                        }
                        
                        addNews(locStr("engine.news.pirate_base_destroyed", {{"faction", g_world.factions[ship.owner_id].name}}), "global", 4, "war");
                        it = g_world.map.locations.erase(it);
                        continue;
                    }
                }
                ++it;
            }
        }
    }

    for (auto it = g_world.ships.begin(); it != g_world.ships.end(); ) {
        if (it->hull <= 0) {
            addNews(locStr("engine.news.ship_sunk", {{"faction", it->owner_id}}), "global", 3, "disaster");
            if (g_containers.count(it->chest_id)) {
                g_deleted_containers.push_back(it->chest_id);
                g_containers.erase(it->chest_id);
            }
            it = g_world.ships.erase(it);
        } else {
            ++it;
        }
    }
}


void processDisasters() {
    std::vector<Disaster> new_disasters;
    for (auto it = g_world.map.disasters.begin(); it != g_world.map.disasters.end(); ) {
        it->days_active--;
        const DisasterDef& d_def = g_db.disasters.count(it->type) ? g_db.disasters.at(it->type) : DisasterDef{"", "", 5, 1, 5, 10, {}};
        if (it->days_active <= 0) {
            if (d_def.floods_tiles) {
                for (auto pt : it->affected_tiles) {
                    int idx = pt.second * g_world.map.width + pt.first; g_world.map.grid[idx].is_flooded = false;
                }
                g_world.map.generation_tick = g_world.tick; g_path_cache_dirty = true;
            }
            it = g_world.map.disasters.erase(it);
        } else {
            for (const auto& rid : it->affected_regions) {
                if (g_world.regions.count(rid)) {
                    Region& r = g_world.regions[rid];
                    int defense = r.custom_props.has("disaster_defense") ? r.custom_props["disaster_defense"].asInt() : 0;
                    int eff_str = std::max(1, it->strength - defense);
                    r.population = std::max(0, r.population - (int)(r.population * (d_def.population_damage_percent * 0.01 * eff_str / it->strength)));
                    for (auto& [fid, fac] : r.facilities) { fac.durability -= (d_def.facility_damage * eff_str / it->strength); if (fac.durability < 0) fac.durability = 0; }
                    if (d_def.ruins_roads) {
                        for (auto& road : g_world.map.roads) if (road.from == rid || road.to == rid) { road.condition = "ruined"; road.integrity = 0; g_path_cache_dirty = true; }
                    }
                    if (d_def.stability_penalty > 0) r.stability = std::max(0, r.stability - d_def.stability_penalty);
                    if (d_def.threat_set > 0) r.threat_level = std::max(r.threat_level, d_def.threat_set);
                    r.fertility *= d_def.fertility_mult;
                    if (!d_def.transform_biome_to.empty() && g_db.biome_string_to_id.count(d_def.transform_biome_to)) {
                        uint8_t new_b = g_db.biome_string_to_id.at(d_def.transform_biome_to);
                        for (auto pt : it->affected_tiles) g_world.map.grid[pt.second * g_world.map.width + pt.first].biome_id = new_b;
                        g_world.map.generation_tick = g_world.tick;
                    }
                    if (!d_def.spawn_item.empty() && d_def.spawn_item_qty > 0) createItem(d_def.spawn_item, d_def.spawn_item_qty * eff_str, r.vault_id, g_world.current_day, "Disaster Spawn");
                }
            }
            ++it;
        }
    }

    for (const auto& d : new_disasters) {
        g_world.map.disasters.push_back(d);
    }

    for (auto& [rid, r] : g_world.regions) {
        if ((thread_safe_rand() % 10000) < 50) {
            if (!g_world.map.locations.count(rid)) continue;
            auto loc = g_world.map.locations[rid];

        std::string riskKey = rid + "_disaster_count";
        int risk = g_world.nexusData.count(riskKey) ? g_world.nexusData[riskKey].asInt() : 0;
        g_world.nexusData[riskKey] = JsonValue(risk + 1);

        Disaster d;
        d.id = "dis_" + generateUUID();
        d.epicenter_x = loc.x;
        d.epicenter_y = loc.y;
        d.affected_regions.push_back(rid);

        std::vector<std::string> types;
        for (const auto& [d_id, d_def] : g_db.disasters) {
            bool climate_match = d_def.allowed_climates.empty();
            for (const auto& c : d_def.allowed_climates) {
                if (c == r.climate || c == r.weather || c == r.placement_type || c == "any") climate_match = true;
            }
            // Hardcoded specific conditions mapped to JSON tags
            if (d_id == "plague" && !(r.population > r.storage_capacity * 1.2 && (!r.custom_props.has("has_well") || !r.custom_props["has_well"].asBool()))) climate_match = false;
            uint8_t b_id = g_world.map.grid[loc.y * g_world.map.width + loc.x].biome_id;
            std::string b_str = getBiomeStringId(b_id);
            if (d_id == "volcano" && b_str != "volcano") climate_match = false;
            if ((d_id == "storm" || d_id == "tsunami" || d_id == "sea_monster") && !r.available_raw_resources.count("fish")) climate_match = false;
            
            if (climate_match) types.push_back(d_id);
        }
        
        if (types.empty()) types.push_back("earthquake");
        d.type = types[thread_safe_rand() % types.size()];
        
        const DisasterDef& d_def = g_db.disasters.count(d.type) ? g_db.disasters.at(d.type) : DisasterDef{"", "", 5, 1, 10, 25, {}};
        d.radius = d_def.base_radius + (thread_safe_rand() % 3);
        d.strength = 3 + (thread_safe_rand() % 7);
        d.days_active = d_def.base_duration_days + (thread_safe_rand() % 3);

        if (d_def.floods_tiles) {
            if (r.custom_props.has("has_dam") && r.custom_props["has_dam"].asBool()) {
                addNews(locStr("engine.news.dam_held", {{"region", r.name}}), rid, 3, "politics");
                return;
            }
            for (int y = std::max(0, d.epicenter_y - d.radius); y <= std::min(g_world.map.height - 1, d.epicenter_y + d.radius); ++y) {
                for (int x = std::max(0, d.epicenter_x - d.radius); x <= std::min(g_world.map.width - 1, d.epicenter_x + d.radius); ++x) {
                    if (std::hypot(x - d.epicenter_x, y - d.epicenter_y) <= d.radius) {
                        int idx = y * g_world.map.width + x;
                        uint8_t b_id = g_world.map.grid[idx].biome_id;
                        std::string b_str = getBiomeStringId(b_id);
                        bool is_affected = d_def.affected_biomes.empty();
                        for (const auto& ab : d_def.affected_biomes) if (b_str == ab) is_affected = true;
                        if (is_affected) {
                            g_world.map.grid[idx].is_flooded = true;
                            d.affected_tiles.push_back({x, y});
                            if (g_world.map.grid[idx].bridge_flag && (thread_safe_rand() % 100) < 30) {
                                for (auto& road : g_world.map.roads) {
                                    if (road.type == "bridge") {
                                        for (auto wp : road.waypoints) {
                                            if (wp.first == x && wp.second == y) {
                                                road.condition = "ruined";
                                                road.integrity = 0;
                                                g_path_cache_dirty = true;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            g_world.map.generation_tick = g_world.tick;
        }

        if (d_def.ruins_roads) {
            for (auto& road : g_world.map.roads) {
                if (road.type == "tunnel") continue;
                if (road.from == rid || road.to == rid) {
                    if ((thread_safe_rand() % 100) < 40) {
                        road.condition = "ruined";
                        road.integrity = 0;
                        g_path_cache_dirty = true;
                    }
                }
            }
        }

        if (!d_def.transform_biome_to.empty() && g_db.biome_string_to_id.count(d_def.transform_biome_to)) {
            uint8_t target_b_id = g_db.biome_string_to_id[d_def.transform_biome_to];
            for (int y = std::max(0, d.epicenter_y - d.radius); y <= std::min(g_world.map.height - 1, d.epicenter_y + d.radius); ++y) {
                for (int x = std::max(0, d.epicenter_x - d.radius); x <= std::min(g_world.map.width - 1, d.epicenter_x + d.radius); ++x) {
                    if (std::hypot(x - d.epicenter_x, y - d.epicenter_y) <= d.radius) {
                        int idx = y * g_world.map.width + x;
                        uint8_t b_id = g_world.map.grid[idx].biome_id;
                        std::string b_str = getBiomeStringId(b_id);
                        bool is_affected = d_def.affected_biomes.empty();
                        for (const auto& ab : d_def.affected_biomes) if (b_str == ab) is_affected = true;
                        if (is_affected) {
                            g_world.map.grid[idx].biome_id = target_b_id;
                            d.affected_tiles.push_back({x, y});
                        }
                    }
                }
            }
            g_world.map.generation_tick = g_world.tick;
        }

        addNews(locStr("engine.news." + d.type, {{"region", r.name}}), rid, 5, "disaster");

        g_world.map.disasters.push_back(d);
        }
    }
}

void processRoadDegradation() {
    for (auto& road : g_world.map.roads) {
        if (road.condition == "ruined") continue;
        if (road.type == "tunnel") continue;
        
        int deg = 1;
        if (road.type == "dirt") deg = 2;
        if (road.type == "bridge") deg = 3;
        
        road.integrity -= deg;
        if (road.integrity <= 0) {
            road.integrity = 0;
            road.condition = "ruined";
            g_path_cache_dirty = true;
            addNews(locStr("engine.news.road_ruined", {{"from", road.from}, {"to", road.to}}), road.from, 2, "logistics");
        }
    }

    for (auto& [fid, f] : g_world.factions) {
        std::string capId = f.regions.empty() ? "" : f.regions[0];
        if (capId.empty() || !g_world.regions.count(capId)) continue;
        int gold = countItemsInContainer(g_world.regions[capId].vault_id, getCoreIdByTag("currency"));
        
        for (auto& road : g_world.map.roads) {
            bool from_match = g_world.regions.count(road.from) && g_world.regions[road.from].factionId == fid;
            bool to_match = g_world.regions.count(road.to) && g_world.regions[road.to].factionId == fid;
            if (road.integrity < 50 && (from_match || to_match)) {
                int cost = (100 - road.integrity) * 10;
                if (road.type == "sea_route") cost = (100 - road.integrity) * 5;
                if (gold >= cost) {
                    consumeItemsFromContainer(g_world.regions[capId].vault_id, getCoreIdByTag("currency"), cost);
                    gold -= cost;
                    road.integrity = 100;
                    if (road.condition == "ruined") {
                        road.condition = road.type == "paved" ? "paved" : (road.type == "sea_route" ? "water" : "dirt");
                        g_path_cache_dirty = true;
                        std::string msg = (road.type == "sea_route") ? locStr("engine.news.sea_route_restored") : locStr("engine.news.road_restored");
                        addNews(locStr("engine.news.infrastructure_restored", {{"faction", f.name}, {"msg", msg}, {"from", road.from}, {"to", road.to}}), road.from, 2, "logistics");
                    }
                }
            }
        }
    }
}

void processFactionTrade() {
    std::unordered_map<std::string, std::unordered_map<std::string, int>> vaultStocks;
    {
        std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
        for (const auto& [rid, r] : g_world.regions) {
            if (!r.vault_id.empty() && g_containers.count(r.vault_id)) {
                vaultStocks[rid] = g_containers[r.vault_id].cached_stocks;
            } else {
                vaultStocks[rid] = {};
            }
        }
    }

    for (auto& [fid, f] : g_world.factions) {
        if (f.regions.empty()) continue;
        std::string capitalId = f.regions[0];
        if (!g_world.regions.count(capitalId)) continue;
        
        int totalFood = 0;
        int totalPop = 0;
        std::string g_id = getCoreIdByTag("currency");
        std::string f_id = getCoreIdByTag("food");
        int capitalGold = vaultStocks[capitalId][g_id];
        
        for (const auto& rid : f.regions) {
            if (g_world.regions.count(rid)) {
                totalPop += g_world.regions[rid].population;
                totalFood += getFoodAmount(g_world.regions[rid].vault_id);
            }
        }
        
        double foodRatio = totalPop > 0 ? (double)totalFood / totalPop : 1.0;
        
        // 1. Internal redistribution
        if (foodRatio > 0.3) {
            int capFood = vaultStocks[capitalId][f_id];
            if (capFood > g_world.regions[capitalId].population * 0.5) {
                for (const auto& rid : f.regions) {
                    if (rid == capitalId) continue;
                    if (g_world.regions.count(rid) && g_world.regions[rid].starvation_days > 3) {
                        int sendAmount = std::min(capFood / 2, g_world.regions[rid].population / 2);
                        if (sendAmount > 100) {
                            std::vector<std::pair<int,int>> caravan_path;
                            if (g_path_cache.count({capitalId, rid})) caravan_path = g_path_cache[{capitalId, rid}];
                            if (caravan_path.empty()) continue;

                            std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
                            consumeItemsFromContainer(g_world.regions[capitalId].vault_id, f_id, sendAmount);
                            vaultStocks[capitalId][f_id] -= sendAmount;
                            
                            std::string chestId = createContainer("caravan_chest", fid, 999999, 1000, capitalId);
                            createItem(f_id, sendAmount, chestId, g_world.current_day, "Internal supplies");
                            
                            Caravan caravan;
                            caravan.id = "caravan_" + generateUUID();
                            caravan.origin = capitalId;
                            caravan.destination = rid;
                            caravan.chest_id = chestId;
                            caravan.wagons = 1 + (sendAmount / 50);
                            caravan.guards = 5;
                            caravan.hoursLeft = 24 + (rand() % 48);
                            
                            if (g_path_cache.count({capitalId, rid})) {
                                caravan.path = g_path_cache[{capitalId, rid}];
                                if (!caravan.path.empty()) { caravan.x = caravan.path[0].first; caravan.y = caravan.path[0].second; }
                            }
                            g_world.regions[capitalId].caravans.push_back(caravan);
                            addNews(locStr("engine.news.logistics.supply_convoy", {{"faction", f.name}, {"region", g_world.regions[rid].name}}), rid, 2, "logistics");
                        }
                    }
                }
            }
        }
        
        // 2. Внешние закупки (Импорт), если фракция голодает, но есть деньги
        if (foodRatio < 0.2 && capitalGold > 5000) {
            std::string bestSellerId = "";
            int bestSellerFood = 0;
            
            for (const auto& [ofid, of] : g_world.factions) {
                if (ofid == fid || f.diplomacy[ofid] == "war") continue; // Не торгуем с врагами
                if (of.regions.empty()) continue;
                std::string oCapId = of.regions[0];
                if (g_world.regions.count(oCapId)) {
                    int oFood = vaultStocks[oCapId][f_id];
                    if (oFood > g_world.regions[oCapId].population * 1.0 && oFood > bestSellerFood) {
                        bestSellerFood = oFood;
                        bestSellerId = ofid;
                    }
                }
            }
            
            if (!bestSellerId.empty()) {
                std::string sellerCapId = g_world.factions[bestSellerId].regions[0];
                int buyAmount = std::min(bestSellerFood / 3, capitalGold / 10);
                if (buyAmount > 100) {
                    std::vector<std::pair<int,int>> caravan_path;
                    if (g_path_cache.count({sellerCapId, capitalId})) caravan_path = g_path_cache[{sellerCapId, capitalId}];
                    if (caravan_path.empty()) continue;

                    int cost = buyAmount * 10;
                    std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
                    consumeItemsFromContainer(g_world.regions[capitalId].vault_id, g_id, cost);
                    vaultStocks[capitalId][g_id] -= cost;
                    
                    consumeItemsFromContainer(g_world.regions[sellerCapId].vault_id, f_id, buyAmount);
                    vaultStocks[sellerCapId][f_id] -= buyAmount;
                    createItem(g_id, cost, g_world.regions[sellerCapId].vault_id, g_world.current_day, "Food export");
                    
                    std::string chestId = createContainer("caravan_chest", fid, 999999, 1000, sellerCapId);
                    createItem(f_id, buyAmount, chestId, g_world.current_day, "Food import");
                    
                    Caravan caravan;
                    caravan.id = "caravan_" + generateUUID();
                    caravan.origin = sellerCapId;
                    caravan.destination = capitalId;
                    caravan.chest_id = chestId;
                    caravan.wagons = 1 + (buyAmount / 50);
                    caravan.guards = 10;
                    caravan.hoursLeft = 48 + (rand() % 48);
                    
                    if (g_path_cache.count({sellerCapId, capitalId})) {
                        caravan.path = g_path_cache[{sellerCapId, capitalId}];
                        if (!caravan.path.empty()) { caravan.x = caravan.path[0].first; caravan.y = caravan.path[0].second; }
                    }
                    g_world.regions[sellerCapId].caravans.push_back(caravan);
                    addNews(locStr("engine.news.trade.state_purchase", {{"faction", f.name}, {"amount", std::to_string(buyAmount)}, {"seller", g_world.factions[bestSellerId].name}, {"cost", std::to_string(cost)}}), capitalId, 4, "trade");
                }
            }
        }
        
        // 3. Гуманитарная помощь (Экспорт), если фракция процветает
        if (foodRatio > 1.5) {
            for (const auto& [ofid, of] : g_world.factions) {
                if (ofid == fid || f.diplomacy[ofid] == "war") continue; // Врагам не помогаем
                if (of.regions.empty()) continue;
                std::string oCapId = of.regions[0];
                if (g_world.regions.count(oCapId) && g_world.regions[oCapId].starvation_days > 5) {
                    int aidAmount = std::min(vaultStocks[capitalId][f_id] / 4, g_world.regions[oCapId].population / 2);
                    if (aidAmount > 100) {
                        std::vector<std::pair<int,int>> caravan_path;
                        if (g_path_cache.count({capitalId, oCapId})) caravan_path = g_path_cache[{capitalId, oCapId}];
                        if (caravan_path.empty()) continue;

                        std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
                        consumeItemsFromContainer(g_world.regions[capitalId].vault_id, f_id, aidAmount);
                        vaultStocks[capitalId][f_id] -= aidAmount;
                        
                        std::string chestId = createContainer("caravan_chest", fid, 999999, 1000, capitalId);
                        createItem(f_id, aidAmount, chestId, g_world.current_day, "Humanitarian aid");
                        
                        Caravan caravan;
                        caravan.id = "caravan_" + generateUUID();
                        caravan.origin = capitalId;
                        caravan.destination = oCapId;
                        caravan.chest_id = chestId;
                        caravan.wagons = 1 + (aidAmount / 50);
                        caravan.guards = 5;
                        caravan.hoursLeft = 48 + (rand() % 48);
                        
                        if (g_path_cache.count({capitalId, oCapId})) {
                            caravan.path = g_path_cache[{capitalId, oCapId}];
                            if (!caravan.path.empty()) { caravan.x = caravan.path[0].first; caravan.y = caravan.path[0].second; }
                        }
                        g_world.regions[capitalId].caravans.push_back(caravan);
                        
                        f.relations[ofid] = std::min(100, f.relations[ofid] + 30);
                        g_world.factions[ofid].relations[fid] = std::min(100, g_world.factions[ofid].relations[fid] + 30);
                        
                        addNews(locStr("engine.news.diplomacy.humanitarian_aid", {{"faction", f.name}, {"target", g_world.factions[ofid].name}}), oCapId, 4, "diplomacy");
                        // Лимит на одну фракцию снят, но чтобы не спамить караванами, помогаем максимум 2 фракциям за день
                        static int aid_count = 0;
                        aid_count++;
                        if (aid_count >= 2) { aid_count = 0; break; }
                    }
                }
            }
        }
    }
}

void weeklyTick() {
    checkGlobalEvents();
    processFactionTrade();

    if (!g_bootstrap) {
        processRoadDegradation();
    }
}

class PerlinNoise {
    std::vector<int> p;
    double fade(double t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    double lerp(double t, double a, double b) { return a + t * (b - a); }
    double grad(int hash, double x, double y, double z) {
        int h = hash & 15;
        double u = h < 8 ? x : y;
        double v = h < 4 ? y : h == 12 || h == 14 ? x : z;
        return ((h & 1) == 0 ? u : -u) + ((h & 2) == 0 ? v : -v);
    }
public:
    PerlinNoise(unsigned int seed) {
        p.resize(256);
        std::iota(p.begin(), p.end(), 0);
        std::default_random_engine engine(seed);
        std::shuffle(p.begin(), p.end(), engine);
        p.insert(p.end(), p.begin(), p.end());
    }
    double noise(double x, double y, double z) {
        int X = (int)floor(x) & 255;
        int Y = (int)floor(y) & 255;
        int Z = (int)floor(z) & 255;
        x -= floor(x); y -= floor(y); z -= floor(z);
        double u = fade(x), v = fade(y), w = fade(z);
        int A = p[X]+Y, AA = p[A]+Z, AB = p[A+1]+Z;
        int B = p[X+1]+Y, BA = p[B]+Z, BB = p[B+1]+Z;
        return lerp(w, lerp(v, lerp(u, grad(p[AA], x, y, z),
                                       grad(p[BA], x-1, y, z)),
                               lerp(u, grad(p[AB], x, y-1, z),
                                       grad(p[BB], x-1, y-1, z))),
                       lerp(v, lerp(u, grad(p[AA+1], x, y, z-1),
                                       grad(p[BA+1], x-1, y, z-1)),
                               lerp(u, grad(p[AB+1], x, y-1, z-1),
                                       grad(p[BB+1], x-1, y-1, z-1))));
    }
    double fbm(double x, double y, int octaves, double persistence, double lacunarity) {
        double total = 0;
        double frequency = 1;
        double amplitude = 1;
        double maxValue = 0;
        for(int i=0; i<octaves; i++) {
            total += noise(x * frequency, y * frequency, 0) * amplitude;
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= lacunarity;
        }
        return total / maxValue;
    }
};

void generateWorldMapTerrain(WorldMap& map, int seed) {
    auto& cfg = g_db.world_config;
    map.grid.resize(map.width * map.height);
    std::vector<double> elevation(map.width * map.height);

    // ====================================================================
    // PASS 1: Elevation + Biome assignment (data-driven continent generation)
    // ====================================================================
    int num_threads = std::thread::hardware_concurrency();
    if (num_threads == 0) num_threads = 4;
    std::vector<std::future<void>> futures;
    int chunk_size = map.height / num_threads;

    for (int t = 0; t < num_threads; ++t) {
        int start_y = t * chunk_size;
        int end_y = (t == num_threads - 1) ? map.height : (t + 1) * chunk_size;

        futures.push_back(getThreadPool()->enqueue([start_y, end_y, &map, &elevation, seed, &cfg]() {
            PerlinNoise perlin(seed);
            PerlinNoise detail_noise(seed + 10);  // Higher-freq detail layer
            PerlinNoise temp_noise(seed + 1);
            PerlinNoise moist_noise(seed + 2);

            for (int y = start_y; y < end_y; ++y) {
                for (int x = 0; x < map.width; ++x) {
                    double nx = (double)x / map.width;
                    double ny = (double)y / map.height;

                    // Low frequency = large landforms (continent, not islands)
                    double e = perlin.fbm(nx * cfg.continent.noise_frequency,
                                          ny * cfg.continent.noise_frequency,
                                          cfg.continent.noise_octaves, 0.5, 2.0);

                    // Shift elevation up for more land area
                    e = e + cfg.continent.elevation_shift;

                    // Edge falloff: push map edges below sea level to create continent shape
                    double dx = nx - 0.5;
                    double dy = ny - 0.5;
                    double dist = std::sqrt(dx * dx + dy * dy) * 2.0;
                    double falloff = 1.0 - std::pow(std::min(dist * cfg.continent.edge_falloff_range, 1.0),
                                                     cfg.continent.edge_falloff_power);
                    e = e * falloff + (1.0 - falloff) * cfg.continent.edge_ocean_elevation;

                    // Add terrain detail (mountains, hills) within the continent
                    // Only apply where there's land — don't raise ocean tiles
                    if (e > -0.05) {
                        double detail = detail_noise.fbm(nx * 3.0, ny * 3.0, 5, 0.55, 2.0);
                        // Scale detail by distance from coast (more variation inland)
                        double land_factor = std::clamp((e + 0.05) / 0.3, 0.0, 1.0);
                        e += detail * 0.35 * land_factor;
                    }

                    // Clamp elevation to valid range for biome matching
                    e = std::clamp(e, -1.0, 1.0);

                    elevation[y * map.width + x] = e;

                    double dist_to_equator = std::abs(y - map.height / 2.0) / (map.height / 2.0);
                    double base_t = 0.7 - dist_to_equator * 0.5;
                    double t_noise = temp_noise.fbm(nx * 3.0, ny * 3.0, 3, 0.5, 2.0) * 0.15;
                    double temperature = std::clamp(base_t + t_noise, 0.0, 1.0);

                    double m = moist_noise.fbm(nx * 5.0, ny * 5.0, 4, 0.5, 2.0) + 0.5;

                    uint8_t selected_biome = 0;
                    double best_score = 999.0;
                    for (const auto& b : g_db.biomes) {
                        if (e >= b.min_elevation && e <= b.max_elevation &&
                            temperature >= b.min_temp && temperature <= b.max_temp &&
                            m >= b.min_moisture && m <= b.max_moisture) {
                            selected_biome = b.numeric_id;
                            break;
                        }
                        // Fallback: match by elevation only (closest land biome)
                        // Skip special biomes (ruins, river, etc.) with min_elev >= 2.0
                        if (!b.is_water && b.min_elevation < 2.0) {
                            double b_min = b.min_elevation;
                            double b_max = b.max_elevation;
                            // Extend mountain range upward to catch clamped high elevations
                            if (b_max >= 0.9) b_max = 2.0;
                            if (e >= b_min && e <= b_max) {
                                double score = std::abs(e - (b.min_elevation + b.max_elevation) / 2.0);
                                if (score < best_score) {
                                    best_score = score;
                                    selected_biome = b.numeric_id;
                                }
                            }
                        }
                    }
                    // Ultimate fallback: high elevation → mountains, low → ocean
                    if (selected_biome == 0 && e > 0.05) {
                        uint8_t mtn_id = getBiomeIdByTag("mountain", 4);
                        selected_biome = mtn_id;
                    }
                    map.grid[y * map.width + x].biome_id = selected_biome;
                }
            }
        }));
    }
    for (auto& f : futures) f.get();

    // ====================================================================
    // PASS 2: Connectivity — ensure one connected continent, no small islands
    // ====================================================================
    if (cfg.continent.connectivity_pass && cfg.landform == "continent") {
        int w = map.width, h = map.height;
        uint8_t ocean_id = getBiomeIdByTag("ocean");
        uint8_t shallow_id = getBiomeIdByTag("shallow_water");
        uint8_t beach_id = getBiomeIdByTag("beach");
        uint8_t plains_id = getBiomeIdByTag("plains");

        auto isLand = [&](int idx) -> bool {
            uint8_t b = map.grid[idx].biome_id;
            return (b != ocean_id && b != shallow_id);
        };

        // Flood-fill to find all connected land components
        std::vector<int> component(w * h, -1);
        int num_components = 0;
        std::vector<int> component_size;
        int largest_component = 0;
        int largest_size = 0;

        int flood_dx[] = {0, 1, 0, -1};
        int flood_dy[] = {-1, 0, 1, 0};

        for (int y = 0; y < h; ++y) {
            for (int x = 0; x < w; ++x) {
                int idx = y * w + x;
                if (!isLand(idx) || component[idx] >= 0) continue;

                int cid = num_components++;
                component_size.push_back(0);
                std::queue<std::pair<int,int>> q;
                q.push({x, y});
                component[idx] = cid;

                while (!q.empty()) {
                    auto [cx, cy] = q.front(); q.pop();
                    component_size[cid]++;

                    for (int d = 0; d < 4; ++d) {
                        int nx = cx + flood_dx[d];
                        int ny = cy + flood_dy[d];
                        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                        int nIdx = ny * w + nx;
                        if (isLand(nIdx) && component[nIdx] < 0) {
                            component[nIdx] = cid;
                            q.push({nx, ny});
                        }
                    }
                }

                if (component_size[cid] > largest_size) {
                    largest_size = component_size[cid];
                    largest_component = cid;
                }
            }
        }

        // Remove small islands: convert land tiles of small components to ocean
        int remove_threshold = cfg.continent.remove_islands_under;
        for (int i = 0; i < w * h; ++i) {
            if (isLand(i) && component[i] >= 0 && component[i] != largest_component) {
                if (component_size[component[i]] < remove_threshold) {
                    // Small island → convert to ocean
                    map.grid[i].biome_id = ocean_id;
                    elevation[i] = -0.4;
                    component[i] = -1;
                }
            }
        }

        // Land bridge pass: find narrow ocean gaps between land components and fill them
        // For each water tile that separates two land areas within max_gap distance, fill with land
        int max_gap = cfg.continent.land_bridge_max_gap;
        if (max_gap > 0) {
            // Multiple dilation passes to connect nearby landmasses
            for (int pass = 0; pass < max_gap; ++pass) {
                std::vector<uint8_t> bridged(w * h);
                for (int i = 0; i < w * h; ++i) bridged[i] = map.grid[i].biome_id;

                for (int y = 1; y < h - 1; ++y) {
                    for (int x = 1; x < w - 1; ++x) {
                        int idx = y * w + x;
                        if (isLand(idx)) continue;
                        // Check if this water tile is between two land tiles (horizontally or vertically)
                        bool left_land = isLand(y * w + (x - 1));
                        bool right_land = isLand(y * w + (x + 1));
                        bool up_land = isLand((y - 1) * w + x);
                        bool down_land = isLand((y + 1) * w + x);

                        if ((left_land && right_land) || (up_land && down_land)) {
                            // This is a narrow gap — fill with land (beach/plains)
                            bridged[idx] = (elevation[idx] >= -0.1) ? plains_id : beach_id;
                            elevation[idx] = 0.08; // Just above beach threshold
                        }
                    }
                }
                for (int i = 0; i < w * h; ++i) map.grid[i].biome_id = bridged[i];
            }
        }

        // Ensure minimum land ratio: if too little land, raise elevation near center
        double land_ratio = 0;
        for (int i = 0; i < w * h; ++i) {
            if (isLand(i)) land_ratio++;
        }
        land_ratio /= (w * h);

        if (land_ratio < cfg.continent.min_land_ratio) {
            // Raise a band around the continent core
            double deficit = cfg.continent.min_land_ratio - land_ratio;
            double expand_range = 0.65 + deficit * 2.0; // Expand the continent further

            for (int y = 0; y < h; ++y) {
                for (int x = 0; x < w; ++x) {
                    double nx = (double)x / w;
                    double ny = (double)y / h;
                    double ddx = nx - 0.5;
                    double ddy = ny - 0.5;
                    double d = std::sqrt(ddx * ddx + ddy * ddy) * 2.0;

                    if (d < expand_range && !isLand(y * w + x)) {
                        // Raise to land level
                        double t = 1.0 - (d / expand_range);
                        elevation[y * w + x] = 0.08 * t;
                        map.grid[y * w + x].biome_id = (t > 0.3) ? plains_id : beach_id;
                    }
                }
            }
        }
    }

    // ====================================================================
    // PASS 3: Biome smoothing (multiple passes from config)
    // ====================================================================
    for (int smooth_pass = 0; smooth_pass < cfg.continent.smoothing_passes; ++smooth_pass) {
        std::vector<uint8_t> smoothed(map.width * map.height);
        for (int y = 0; y < map.height; ++y) {
            for (int x = 0; x < map.width; ++x) {
                int idx = y * map.width + x;
                uint8_t current = map.grid[idx].biome_id;
                if (hasBiomeTag(current, "ocean") || hasBiomeTag(current, "shallow_water")) {
                    smoothed[idx] = current; continue;
                }
                std::map<uint8_t, int> counts;
                for(int dy=-1; dy<=1; dy++) {
                    for(int dx=-1; dx<=1; dx++) {
                        if(dx==0 && dy==0) continue;
                        int nnx = x+dx, nny = y+dy;
                        if(nnx>=0 && nnx<map.width && nny>=0 && nny<map.height) {
                            counts[map.grid[nny*map.width+nnx].biome_id]++;
                        }
                    }
                }
                uint8_t dominant = current;
                int max_c = 0;
                for (auto& [t, c] : counts) {
                    if (c > max_c) { max_c = c; dominant = t; }
                }
                if (max_c >= 5) smoothed[idx] = dominant;
                else smoothed[idx] = current;
            }
        }
        for (int i = 0; i < map.width * map.height; ++i) map.grid[i].biome_id = smoothed[i];
    }

    // ====================================================================
    // PASS 4: Continental shelf (shallow water around land)
    // ====================================================================
    std::vector<uint8_t> shelf_types(map.width * map.height);
    for (int i = 0; i < map.width * map.height; ++i) shelf_types[i] = map.grid[i].biome_id;

    uint8_t ocean_id = getBiomeIdByTag("ocean");
    uint8_t shallow_id = getBiomeIdByTag("shallow_water");

    for (int y = 0; y < map.height; ++y) {
        for (int x = 0; x < map.width; ++x) {
            if (map.grid[y * map.width + x].biome_id == ocean_id) {
                bool near_land = false;
                int radius = 3;
                for (int dy = -radius; dy <= radius; ++dy) {
                    for (int ddx = -radius; ddx <= radius; ++ddx) {
                        if (ddx*ddx + dy*dy <= radius*radius) {
                            int nnx = x + ddx;
                            int nny = y + dy;
                            if (nnx >= 0 && nnx < map.width && nny >= 0 && nny < map.height) {
                                uint8_t nt = map.grid[nny * map.width + nnx].biome_id;
                                if (nt != ocean_id && nt != shallow_id) {
                                    near_land = true;
                                    break;
                                }
                            }
                        }
                    }
                    if (near_land) break;
                }
                if (near_land) {
                    shelf_types[y * map.width + x] = shallow_id;
                }
            }
        }
    }
    for (int i = 0; i < map.width * map.height; ++i) map.grid[i].biome_id = shelf_types[i];


    int dx[] = {0, 1, 0, -1, 1, 1, -1, -1};
    int dy[] = {-1, 0, 1, 0, -1, 1, 1, -1};

    // ====================================================================
    // PASS 5: Rivers (data-driven from config)
    // ====================================================================
    int w = map.width, h = map.height;
    PerlinNoise river_noise(seed + 123);

    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            int idx = y * w + x;
            uint8_t b_id = map.grid[idx].biome_id;
            if (hasBiomeTag(b_id, "ocean") || hasBiomeTag(b_id, "shallow_water")) continue;

            double nnx = (double)x / w;
            double nny = (double)y / h;

            double r_val = river_noise.fbm(nnx * cfg.rivers.noise_frequency,
                                            nny * cfg.rivers.noise_frequency,
                                            cfg.rivers.noise_octaves, 0.5, 2.0);

            double e = elevation[idx];
            double threshold = cfg.rivers.threshold_default;
            if (e < 0.2) threshold = cfg.rivers.threshold_plains;
            if (e > 0.6) threshold = cfg.rivers.threshold_mountains;

            if (std::abs(r_val) < threshold) {
                map.grid[idx].biome_id = getBiomeIdByTag("river");
                map.grid[idx].water_depth = (e < 0.2) ? 3 : 1;
            }
        }
    }

    // ====================================================================
    // PASS 6: River banks, floodplains, lakes
    // ====================================================================
    std::vector<uint8_t> new_types(w * h);
    for (int i = 0; i < w * h; ++i) new_types[i] = map.grid[i].biome_id;

    uint8_t river_id = getBiomeIdByTag("river");
    uint8_t lake_id = getBiomeIdByTag("lake");
    uint8_t riverbank_id = getBiomeIdByTag("riverbank");
    uint8_t floodplain_id = getBiomeIdByTag("floodplain");

    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            if (map.grid[y * w + x].biome_id == river_id) {
                int depth = map.grid[y * w + x].water_depth;
                int radius = (depth >= 3) ? 2 : 1;

                for (int ddy = -radius; ddy <= radius; ++ddy) {
                    for (int ddx = -radius; ddx <= radius; ++ddx) {
                        int nnx = x + ddx, nny = y + ddy;
                        if (nnx >= 0 && nnx < w && nny >= 0 && nny < h) {
                            uint8_t orig_t = map.grid[nny * w + nnx].biome_id;
                            if (!hasBiomeTag(orig_t, "water")) {
                                double dist = std::hypot(ddx, ddy);

                                if (hasBiomeTag(orig_t, "tundra")) {
                                    continue;
                                } else if (hasBiomeTag(orig_t, "desert")) {
                                    if (dist <= 1.5) new_types[nny * w + nnx] = riverbank_id;
                                } else if (hasBiomeTag(orig_t, "swamp")) {
                                    continue;
                                } else {
                                    if (dist <= 1.5) {
                                        new_types[nny * w + nnx] = riverbank_id;
                                    } else if (dist <= 2.5 && new_types[nny * w + nnx] != riverbank_id) {
                                        new_types[nny * w + nnx] = floodplain_id;
                                    }
                                }
                            }
                        }
                    }
                }

                int river_neighbors = 0;
                for (int ddy = -1; ddy <= 1; ++ddy) {
                    for (int ddx = -1; ddx <= 1; ++ddx) {
                        int nnx = x + ddx, nny = y + ddy;
                        if (nnx >= 0 && nnx < w && nny >= 0 && nny < h && map.grid[nny * w + nnx].biome_id == river_id) {
                            river_neighbors++;
                        }
                    }
                }
                if (river_neighbors >= 8) {
                    new_types[y * w + x] = lake_id;
                }
            }
        }
    }
    for (int i = 0; i < w * h; ++i) map.grid[i].biome_id = new_types[i];

    // ====================================================================
    // PASS 7: Volcanoes (data-driven from config)
    // ====================================================================
    int num_volcanoes = cfg.volcanoes.count;
    PerlinNoise vol_noise(seed + 999);
    uint8_t mountains_id = getBiomeIdByTag("mountain");
    uint8_t volcano_id = getBiomeIdByTag("volcano");
    uint8_t lava_id = getBiomeIdByTag("lava");
    uint8_t ash_id = getBiomeIdByTag("ash");

    for (int i = 0; i < num_volcanoes; ++i) {
        int vx = rand() % map.width;
        int vy = rand() % map.height;
        int attempts = 0;
        while (map.grid[vy * map.width + vx].biome_id != mountains_id && attempts < 100) {
            vx = rand() % map.width;
            vy = rand() % map.height;
            attempts++;
        }
        if (attempts < 100) {
            int radius = cfg.volcanoes.min_radius + rand() % (cfg.volcanoes.max_radius - cfg.volcanoes.min_radius + 1);
            for (int ddy = -radius; ddy <= radius; ++ddy) {
                for (int ddx = -radius; ddx <= radius; ++ddx) {
                    int nnx = vx + ddx;
                    int nny = vy + ddy;
                    if (nnx >= 0 && nnx < map.width && nny >= 0 && nny < map.height) {
                        double dist = std::hypot(ddx, ddy);
                        double n_val = vol_noise.fbm(nnx * 8.0, nny * 8.0, 2, 0.5, 2.0);
                        if (dist + n_val * 2.5 < radius) {
                            if (dist < 1.5) map.grid[nny * map.width + nnx].biome_id = volcano_id;
                            else if (dist < 2.5) map.grid[nny * map.width + nnx].biome_id = lava_id;
                            else {
                                uint8_t cur_b = map.grid[nny * map.width + nnx].biome_id;
                                if (!hasBiomeTag(cur_b, "water")) {
                                    map.grid[nny * map.width + nnx].biome_id = ash_id;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    int x, y, g, f;

};

std::vector<std::pair<int,int>> findPath(const WorldMap& map, int startX, int startY, int goalX, int goalY, const std::vector<bool>& has_road, const std::vector<int>& path_status, MovementType moveType, int entity_size) {
    int w = map.width;
    int h = map.height;
    
    // Bounds check: ensure map grid is properly sized
    if (w <= 0 || h <= 0 || static_cast<size_t>(w * h) > map.grid.size()) return {};
    
    startX = std::clamp(startX, 0, w - 1);
    startY = std::clamp(startY, 0, h - 1);
    goalX = std::clamp(goalX, 0, w - 1);
    goalY = std::clamp(goalY, 0, h - 1);
    
    // Оптимизация выделения памяти: используем thread_local для предотвращения постоянных аллокаций
    thread_local std::vector<int> g_cost;
    thread_local std::vector<int> parent;
    if (g_cost.size() != static_cast<size_t>(w * h)) {
        g_cost.resize(w * h);
        parent.resize(w * h);
    }
    std::fill(g_cost.begin(), g_cost.end(), 1e9);
    std::fill(parent.begin(), parent.end(), -1);
    
    std::priority_queue<AStarNode, std::vector<AStarNode>, AStarCompare> pq;

    int startIdx = startY * w + startX;
    g_cost[startIdx] = 0;
    pq.push({startX, startY, 0, 0});

    int dx[] = {0, 1, 0, -1, 1, 1, -1, -1};
    int dy[] = {-1, 0, 1, 0, -1, 1, 1, -1};

    while (!pq.empty()) {
        auto curr = pq.top();
        pq.pop();

        if (curr.x == goalX && curr.y == goalY) break;
        if (curr.g > g_cost[curr.y * w + curr.x]) continue;

        for (int i = 0; i < 8; ++i) {
            int nx = curr.x + dx[i];
            int ny = curr.y + dy[i];
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;

            int nIdx = ny * w + nx;
            int cost = 1;
            
            if (path_status[nIdx] == 2) {
                cost = 9999; // Заблокировано
            } else if (moveType == MovementType::LAND) {
                uint8_t b_id = map.grid[nIdx].biome_id;
                bool is_water = false;
                bool is_impassable = false;
                int base_cost = 9999;
                std::string b_str = "";
                const BiomeDef* biome = getBiomeById(b_id);
                if (biome) {
                    is_water = biome->is_water;
                    is_impassable = biome->is_impassable;
                    base_cost = biome->movement_cost;
                }
                
                if (has_road[nIdx]) {
                    if (is_water && path_status[nIdx] == 1) {
                        if (hasBiomeTag(b_id, "river") && map.grid[nIdx].water_depth <= 1) {
                            cost = 10; // Брод
                        } else {
                            cost = 9999; // Разрушенный мост/паром непроходим
                        }
                    } else if (is_water && map.grid[nIdx].water_depth >= 3 && entity_size > 50) {
                        cost = 9999; // Паром не выдержит крупную армию или караван
                    } else {
                        cost = 1;
                        if (path_status[nIdx] == 1) cost *= 3;
                    }
                } else {
                    if (is_water) {
                        if (hasBiomeTag(b_id, "river") && map.grid[nIdx].water_depth <= 1) {
                            cost = 10; // Брод
                        } else {
                            cost = 9999; // Строгий запрет на пересечение глубокой воды без моста
                        }
                    } else if (is_impassable) {
                        cost = 9999; // Горы/Вулканы непроходимы без дорог (тоннелей)
                    } else {
                        cost = base_cost * 2; // По бездорожью медленнее
                    }
                }
            } else if (moveType == MovementType::WATER) {
                uint8_t b_id = map.grid[nIdx].biome_id;
                bool is_water = false;
                const BiomeDef* biome_w = getBiomeById(b_id);
                if (biome_w) {
                    is_water = biome_w->is_water;
                }
                
                if (!is_water) {
                    cost = 9999;
                } else {
                    if (hasBiomeTag(b_id, "ocean")) cost = 1;
                    else if (hasBiomeTag(b_id, "shallow_water") || hasBiomeTag(b_id, "lake")) cost = 2;
                    else if (hasBiomeTag(b_id, "river")) {
                        if (map.grid[nIdx].water_depth < 2 && entity_size > 50) cost = 9999;
                        else cost = 3;
                    } else {
                        cost = 2; // Default water cost
                    }
                }
            } else if (moveType == MovementType::ANY) {
                uint8_t b_id = map.grid[nIdx].biome_id;
                const BiomeDef* biome_a = getBiomeById(b_id);
                bool is_water_a = biome_a ? biome_a->is_water : false;
                bool is_impassable_a = biome_a ? biome_a->is_impassable : false;
                int base_cost_a = biome_a ? biome_a->movement_cost : 9999;

                if (has_road[nIdx]) {
                    cost = 1;
                } else if (is_water_a) {
                    // ANY может пересекать воду, но с высоким штрафом (для генерации мостов/паромов)
                    if (hasBiomeTag(b_id, "river")) {
                        cost = (map.grid[nIdx].water_depth <= 1) ? 15 : 25; // Брод или паром
                    } else if (hasBiomeTag(b_id, "lake")) {
                        cost = 30; // Паром через озеро
                    } else {
                        cost = 50; // Морской маршрут
                    }
                } else if (is_impassable_a) {
                    // ANY может проходить через горы/вулканы с огромным штрафом (для генерации тоннелей)
                    cost = base_cost_a; // 9999 * 1 = тоннель крайне дорог, но возможен
                } else {
                    cost = base_cost_a * 2; // Обычное бездорожье
                }
                if (path_status[nIdx] == 1) cost *= 3;
            }

            // Блокировка только для заблокированных дорог (status==2) и импассабл без ANY
            if (path_status[nIdx] == 2 && !(nx == goalX && ny == goalY)) {
                // Заблокированные дороги непроходимы, кроме самой цели
                if (moveType != MovementType::ANY) continue;
                // Для ANY - заблокированные дороги очень дороги, но не непроходимы
                cost = std::max(cost, 200);
            }

            if (cost >= g_gameplay_runtime.path_impassable_cost_threshold) {
                if (nx == goalX && ny == goalY) cost = 5;
                else continue;
            }

            int new_g = curr.g + cost * (i >= 4 ? 14 : 10);
            if (new_g < g_cost[nIdx]) {
                g_cost[nIdx] = new_g;
                parent[nIdx] = curr.y * w + curr.x;
                int h_cost = (std::abs(nx - goalX) + std::abs(ny - goalY)) * 10;
                pq.push({nx, ny, new_g, new_g + h_cost});
            }
        }
    }

    std::vector<std::pair<int,int>> path;
    int currIdx = goalY * w + goalX;
    if (parent[currIdx] == -1) return path;

    while (currIdx != startIdx) {
        path.push_back({currIdx % w, currIdx / w});
        currIdx = parent[currIdx];
    }
    path.push_back({startX, startY});
    std::reverse(path.begin(), path.end());
    return path;
}

void placeRegionsOnMap(WorldMap& map, const World& w) {
    std::vector<bool> occupied(map.width * map.height, false);
    int cx = map.width / 2;
    int cy = map.height / 2;

    for (const auto& [rid, r] : w.regions) {
        std::string pref = "plains";
        bool require_water = false;
        bool require_coast = false;
        bool require_center = false;

        if (r.placement_type == "water") require_water = true;
        else if (r.placement_type == "coast") require_coast = true;
        else if (r.placement_type == "center") require_center = true;
        else if (r.placement_type == "mountain") pref = "mountains";
        else if (r.placement_type == "forest") pref = "forest";
        else if (r.placement_type == "desert") pref = "desert";
        else {
            // Data-driven: faction biome preference from g_db.faction_relations
            {
                auto fbpIt = g_db.faction_relations.faction_biome_preference.find(r.factionId);
                if (fbpIt != g_db.faction_relations.faction_biome_preference.end()) {
                    if (fbpIt->second == "coast") require_coast = true;
                    else pref = fbpIt->second;
                }
            }
        }

        std::vector<std::pair<int, int>> candidates_strict;
        std::vector<std::pair<int, int>> candidates_fallback_1; // Любой биом, дистанция >= 15
        std::vector<std::pair<int, int>> candidates_fallback_2; // Любой биом, дистанция >= 5
        std::vector<std::pair<int, int>> candidates_fallback_3; // Любая суша

        for (int y = 5; y < map.height - 5; ++y) {
            for (int x = 5; x < map.width - 5; ++x) {
                if (occupied[y * map.width + x]) continue;
                uint8_t t = map.grid[y * map.width + x].biome_id;
                bool is_ocean = hasBiomeTag(t, "ocean") || hasBiomeTag(t, "shallow_water");
                
                // Проверяем дистанцию до других городов
                int min_dist = 9999;
                for (const auto& [oid, oloc] : map.locations) {
                    int d = std::abs(oloc.x - x) + std::abs(oloc.y - y);
                    if (d < min_dist) min_dist = d;
                }

                // Fallback 3: Любая подходящая поверхность (суша или вода, если требуется)
                if ((require_water && is_ocean) || (!require_water && !is_ocean)) {
                    candidates_fallback_3.push_back({x, y});
                    
                    // Fallback 2: Дистанция >= 5
                    if (min_dist >= 5) {
                        candidates_fallback_2.push_back({x, y});
                        
                        // Fallback 1: Дистанция >= 15
                        if (min_dist >= 15) {
                            candidates_fallback_1.push_back({x, y});
                            
                            // Strict: Совпадение биома
                            bool match = false;
                            if (require_water) {
                                match = is_ocean;
                            } else if (require_coast) {
                                if (!is_ocean && !hasBiomeTag(t, "mountain")) {
                                    for(int dy=-1; dy<=1; dy++) {
                                        for(int dx=-1; dx<=1; dx++) {
                                            uint8_t nt = map.grid[(y+dy)*map.width + (x+dx)].biome_id;
                                            if (hasBiomeTag(nt, "shallow_water") || hasBiomeTag(nt, "ocean") || hasBiomeTag(nt, "lake")) match = true;
                                        }
                                    }
                                }
                            } else if (pref == "mountains") {
                                match = hasBiomeTag(t, "mountain") || hasBiomeTag(t, "hills");
                            } else {
                                match = hasBiomeTag(t, pref);
                            }
                            
                            if (match) {
                                candidates_strict.push_back({x, y});
                            }
                        }
                    }
                }
            }
        }

        // Выбираем лучший доступный пул кандидатов
        std::vector<std::pair<int, int>>* final_candidates = &candidates_strict;
        if (final_candidates->empty()) final_candidates = &candidates_fallback_1;
        if (final_candidates->empty()) final_candidates = &candidates_fallback_2;
        if (final_candidates->empty()) final_candidates = &candidates_fallback_3;

        int bestX = -1, bestY = -1;

        if (!final_candidates->empty()) {
            if (require_center) {
                // Ищем точку, ближайшую к центру карты
                int best_dist = 999999;
                for (auto& pt : *final_candidates) {
                    int d = std::abs(pt.first - cx) + std::abs(pt.second - cy);
                    if (d < best_dist) {
                        best_dist = d;
                        bestX = pt.first;
                        bestY = pt.second;
                    }
                }
            } else {
                // Выбираем СЛУЧАЙНУЮ точку из всех подходящих (исправляет скучивание)
                auto spot = (*final_candidates)[rand() % final_candidates->size()];
                bestX = spot.first;
                bestY = spot.second;
            }
        }

        if (bestX != -1) {
            occupied[bestY * map.width + bestX] = true;
            MapLocation loc;
            loc.id = rid;
            loc.name = r.name;
            loc.x = bestX;
            loc.y = bestY;
            
            if (!r.base_type.empty()) {
                loc.type = r.base_type;
            } else {
                loc.type = (r.population > 5000) ? "city" : (r.population > 0 ? "village" : "ruins");
            }
            
            if (require_water && r.population > 0 && loc.type == "village") loc.type = "ruins"; // Legacy override
            
            loc.faction = r.factionId;
            loc.no_road = r.no_road;
            map.locations[rid] = loc;

            // Органическое искажение ландшафта вокруг аномалий и руин
            if (loc.type == "anomaly" || loc.type == "ruins") {
                int radius = 4 + rand() % 5;
                std::string corruptTypeStr = (loc.type == "anomaly") ? "ash" : "desert";
                // Data-driven: faction corrupt biome from g_db.faction_relations
                {
                    auto fcbIt = g_db.faction_relations.faction_corrupt_biome.find(r.factionId);
                    if (fcbIt != g_db.faction_relations.faction_corrupt_biome.end()) corruptTypeStr = fcbIt->second;
                }
                uint8_t corruptType = g_db.biome_string_to_id.count(corruptTypeStr) ? g_db.biome_string_to_id[corruptTypeStr] : 0;
                
                PerlinNoise local_noise(rand());
                for (int dy = -radius; dy <= radius; ++dy) {
                    for (int dx = -radius; dx <= radius; ++dx) {
                        int nx = bestX + dx;
                        int ny = bestY + dy;
                        if (nx >= 0 && nx < map.width && ny >= 0 && ny < map.height) {
                            double dist = std::hypot(dx, dy);
                            double n_val = local_noise.fbm(nx * 6.0, ny * 6.0, 3, 0.5, 2.0);
                            if (dist + n_val * 3.0 < radius) {
                                uint8_t current = map.grid[ny * map.width + nx].biome_id;
                                if (!hasBiomeTag(current, "water")) {
                                    map.grid[ny * map.width + nx].biome_id = corruptType;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

void generateRoads(WorldMap& map, const World& w) {
    std::vector<bool> pathfinding_helper(map.width * map.height, false);
    std::vector<int> path_status_helper(map.width * map.height, 0);

    auto processRoadSegment = [&](MapRoad& road, int8_t quality) {
        std::vector<MapRoad> new_segments;
        MapRoad current_segment;
        current_segment.from = road.from;
        current_segment.to = road.to;
        current_segment.condition = road.condition;
        
        if (road.waypoints.empty()) return new_segments;

        int initial_idx = road.waypoints[0].second * map.width + road.waypoints[0].first;
        uint8_t initial_t = map.grid[initial_idx].biome_id;
        bool is_water_init = hasBiomeTag(initial_t, "water");
        bool is_impassable_init = hasBiomeTag(initial_t, "impassable");
        
        if (is_water_init) {
            current_segment.type = (map.grid[initial_idx].water_depth >= 3) ? "ferry" : "bridge";
        } else if (is_impassable_init) {
            current_segment.type = "tunnel";
        } else {
            current_segment.type = (quality == 2) ? "paved" : "dirt";
        }

        for (size_t i = 0; i < road.waypoints.size(); ++i) {
            auto wp = road.waypoints[i];
            int idx = wp.second * map.width + wp.first;
            if (quality > map.grid[idx].road_level) map.grid[idx].road_level = quality;
            pathfinding_helper[idx] = true;

            uint8_t t = map.grid[idx].biome_id;
            bool is_water = hasBiomeTag(t, "water");
            bool is_impassable = hasBiomeTag(t, "impassable");
            
            std::string target_type;
            if (is_water) {
                map.grid[idx].bridge_flag = 1;
                map.grid[idx].road_level = quality;
                target_type = (map.grid[idx].water_depth >= 3) ? "ferry" : "bridge";
            } else if (is_impassable) {
                target_type = "tunnel";
            } else {
                target_type = (quality == 2) ? "paved" : "dirt";
            }

            if (current_segment.type != target_type && !current_segment.waypoints.empty()) {
                current_segment.waypoints.push_back(wp);
                new_segments.push_back(current_segment);
                
                current_segment.waypoints.clear();
                current_segment.type = target_type;
                if (i > 0) {
                    current_segment.waypoints.push_back(road.waypoints[i-1]);
                }
            }
            
            if (current_segment.waypoints.empty() || current_segment.waypoints.back() != wp) {
                current_segment.waypoints.push_back(wp);
            }
        }
        if (!current_segment.waypoints.empty()) new_segments.push_back(current_segment);
        return new_segments;
    };

    // 1. Сначала прокладываем внутренние (грунтовые) дороги
    // Собираем регионы, которые не получили дороги (для fallback-пасса)
    std::vector<std::pair<std::string, std::string>> isolated_regions; // {regionId, capitalId}

    for (const auto& [fid, f] : w.factions) {
        if (f.regions.empty()) continue;
        std::string capital = f.regions[0];
        if (!map.locations.count(capital)) continue;
        auto capLoc = map.locations.at(capital);

        for (size_t i = 1; i < f.regions.size(); ++i) {
            std::string rid = f.regions[i];
            if (!map.locations.count(rid)) continue;
            auto rLoc = map.locations.at(rid);

            // Пропускаем только если no_road=true И нет населения (действительно изолированные)
            bool is_truly_isolated = rLoc.no_road;
            auto regIt = w.regions.find(rid);
            if (regIt != w.regions.end() && regIt->second.population > 0) {
                is_truly_isolated = false; // Жилые города ВСЕГДА получают дороги
            }
            if (is_truly_isolated) continue;

            auto path = findPath(map, rLoc.x, rLoc.y, capLoc.x, capLoc.y, pathfinding_helper, path_status_helper, MovementType::ANY);
            if (!path.empty()) {
                MapRoad road; road.from = rid; road.to = capital; road.condition = "dirt"; road.waypoints = path;
                auto segments = processRoadSegment(road, 1);
                map.roads.insert(map.roads.end(), segments.begin(), segments.end());
            } else {
                // Запоминаем изолированный регион для fallback-пасса
                isolated_regions.push_back({rid, capital});
            }
        }
    }

    // 1.5 Fallback-пасс: пытаемся соединить изолированные жилые города
    // с ближайшим ЛЮБЫМ городом, у которого есть дорога
    for (const auto& [isolatedId, origCapital] : isolated_regions) {
        if (!map.locations.count(isolatedId)) continue;
        auto isoLoc = map.locations.at(isolatedId);
        auto regIt = w.regions.find(isolatedId);
        if (regIt != w.regions.end() && regIt->second.population <= 0) continue; // Только жилые

        // Ищем ближайший город с дорогой
        std::string bestTarget = "";
        int bestDist = 999999;
        for (const auto& [lid, lloc] : map.locations) {
            if (lid == isolatedId) continue;
            // Проверяем, есть ли у этого города дорога
            bool hasRoadConnection = false;
            for (const auto& road : map.roads) {
                if (road.from == lid || road.to == lid) { hasRoadConnection = true; break; }
            }
            if (!hasRoadConnection) continue;

            int d = std::abs(lloc.x - isoLoc.x) + std::abs(lloc.y - isoLoc.y);
            if (d < bestDist) {
                bestDist = d;
                bestTarget = lid;
            }
        }

        if (!bestTarget.empty()) {
            auto targetLoc = map.locations.at(bestTarget);
            auto path = findPath(map, isoLoc.x, isoLoc.y, targetLoc.x, targetLoc.y, pathfinding_helper, path_status_helper, MovementType::ANY);
            if (!path.empty()) {
                MapRoad road; road.from = isolatedId; road.to = bestTarget; road.condition = "dirt"; road.waypoints = path;
                auto segments = processRoadSegment(road, 1);
                map.roads.insert(map.roads.end(), segments.begin(), segments.end());
                // Снимаем флаг no_road на карте
                // (w.regions — const, менять нельзя, но map.locations достаточно)
                map.locations[isolatedId].no_road = false;
            }
        }
    }

    // 2. Затем международные (мощеные) - они будут поглощать грунтовые
    std::vector<std::string> capitals;
    for (const auto& [fid, f] : w.factions) {
        if (!f.regions.empty() && map.locations.count(f.regions[0])) capitals.push_back(f.regions[0]);
    }

    for (size_t i = 0; i < capitals.size(); ++i) {
        for (size_t j = i + 1; j < capitals.size(); ++j) {
            std::string cap1 = capitals[i]; std::string cap2 = capitals[j];
            // Пропускаем только если оба города нежилые и имеют no_road
            bool skip1 = map.locations.at(cap1).no_road;
            bool skip2 = map.locations.at(cap2).no_road;
            auto r1It = w.regions.find(cap1);
            auto r2It = w.regions.find(cap2);
            if (r1It != w.regions.end() && r1It->second.population > 0) skip1 = false;
            if (r2It != w.regions.end() && r2It->second.population > 0) skip2 = false;
            if (skip1 || skip2) continue;
            if (w.factions.at(map.locations.at(cap1).faction).diplomacy.count(map.locations.at(cap2).faction)) {
                if (w.factions.at(map.locations.at(cap1).faction).diplomacy.at(map.locations.at(cap2).faction) == "war") continue;
            }

            auto loc1 = map.locations.at(cap1); auto loc2 = map.locations.at(cap2);
            auto path = findPath(map, loc1.x, loc1.y, loc2.x, loc2.y, pathfinding_helper, path_status_helper, MovementType::ANY);
            if (!path.empty()) {
                MapRoad road; road.from = cap1; road.to = cap2; road.condition = "paved"; road.waypoints = path;
                auto segments = processRoadSegment(road, 2);
                map.roads.insert(map.roads.end(), segments.begin(), segments.end());
            }
        }
    }
}



void generateSeaRoutes(WorldMap& map, World& w) {
    std::vector<bool> dummy_has_road(map.width * map.height, false);
    std::vector<int> dummy_path_status(map.width * map.height, 0);
    
    std::vector<std::string> port_regions;
    for (const auto& [rid, port] : w.port_facilities) {
        if (map.locations.count(rid)) port_regions.push_back(rid);
    }
    
    for (size_t i = 0; i < port_regions.size(); ++i) {
        for (size_t j = i + 1; j < port_regions.size(); ++j) {
            std::string r1 = port_regions[i];
            std::string r2 = port_regions[j];
            
            auto loc1 = map.locations.at(r1);
            auto loc2 = map.locations.at(r2);
            
            auto path = findPath(map, loc1.x, loc1.y, loc2.x, loc2.y, dummy_has_road, dummy_path_status, MovementType::WATER, 10);
            if (!path.empty()) {
                MapRoad sea_route;
                sea_route.from = r1;
                sea_route.to = r2;
                sea_route.condition = "water";
                sea_route.type = "sea_route";
                sea_route.integrity = 100;
                sea_route.waypoints = path;
                map.roads.push_back(sea_route);
            }
        }
    }
}


void generateCityLayout(Region& r, World& w) {
    // 1. Динамический размер города в зависимости от населения
    if (r.population < 2000) { r.layoutWidth = 10; r.layoutHeight = 10; }
    else if (r.population <= 10000) { r.layoutWidth = 16; r.layoutHeight = 16; }
    else { r.layoutWidth = 24; r.layoutHeight = 24; }

    r.cityLayout.clear();
    r.cityLayout.resize(r.layoutWidth * r.layoutHeight);
    for(int y=0; y<r.layoutHeight; ++y) {
        for(int x=0; x<r.layoutWidth; ++x) {
            CityBlock& b = r.cityLayout[y * r.layoutWidth + x];
            b.x = x; b.y = y; b.type = "empty"; b.name = "Empty Lot";
        }
    }

    auto getBlock = [&](int x, int y) -> CityBlock& { return r.cityLayout[y * r.layoutWidth + x]; };

    // 2. Генерация дорожной сети (Квартальная система)
    int midX = r.layoutWidth / 2;
    int midY = r.layoutHeight / 2;
    
    for(int y=0; y<r.layoutHeight; ++y) {
        for(int x=0; x<r.layoutWidth; ++x) {
            bool isRoad = false;
            std::string roadName = "Road";

            auto getRoadName = [&](const std::string& defaultName) {
                if (!g_db.city_gen_rules.road_names.empty()) return g_db.city_gen_rules.road_names[thread_safe_rand() % g_db.city_gen_rules.road_names.size()];
                return defaultName;
            };
            auto getSquareName = [&](const std::string& defaultName) {
                if (!g_db.city_gen_rules.square_names.empty()) return g_db.city_gen_rules.square_names[thread_safe_rand() % g_db.city_gen_rules.square_names.size()];
                return defaultName;
            };

            // Главные тракты (Крест)
            if (x == midX || y == midY) { isRoad = true; roadName = getRoadName("Main Street"); }
            // Кольцевая дорога (Стены/Граница)
            else if (x == 1 || x == r.layoutWidth - 2 || y == 1 || y == r.layoutHeight - 2) { isRoad = true; roadName = getRoadName("Ring Road"); }
            // Второстепенные улицы (сетка кварталов)
            else if (x % 4 == 0 || y % 4 == 0) { isRoad = true; roadName = getRoadName("Alley"); }

            // Центральная площадь
            if (std::abs(x - midX) <= 1 && std::abs(y - midY) <= 1) {
                isRoad = true; roadName = getSquareName("Central Square");
            }

            if (isRoad) {
                getBlock(x, y).type = "road";
                getBlock(x, y).name = roadName;
            }
        }
    }

    // 3. Зонирование (Центр, Жилые кварталы, Окраины)
    std::vector<std::pair<int,int>> centerSpots;
    std::vector<std::pair<int,int>> edgeSpots;
    std::vector<std::pair<int,int>> midSpots;

    for(int y=0; y<r.layoutHeight; ++y) {
        for(int x=0; x<r.layoutWidth; ++x) {
            if (getBlock(x, y).type != "empty") continue;
            
            int distToCenter = std::abs(x - midX) + std::abs(y - midY);
            if (distToCenter <= 4) centerSpots.push_back({x, y});
            else if (x <= 2 || x >= r.layoutWidth - 3 || y <= 2 || y >= r.layoutHeight - 3) edgeSpots.push_back({x, y});
            else midSpots.push_back({x, y});
        }
    }

    thread_local std::mt19937 gen_local(static_cast<unsigned int>(std::chrono::system_clock::now().time_since_epoch().count()) + static_cast<unsigned int>(std::hash<std::thread::id>{}(std::this_thread::get_id())) + 2);
    std::shuffle(centerSpots.begin(), centerSpots.end(), gen_local);
    std::shuffle(edgeSpots.begin(), edgeSpots.end(), gen_local);
    std::shuffle(midSpots.begin(), midSpots.end(), gen_local);

    int counter = 1;
    auto placeBuilding = [&](const std::string& type, const std::string& name, const std::string& linked_id, std::vector<std::pair<int,int>>& prefZone, std::vector<std::pair<int,int>>& altZone) {
        std::pair<int,int> spot = {-1, -1};
        if (!prefZone.empty()) { spot = prefZone.back(); prefZone.pop_back(); }
        else if (!altZone.empty()) { spot = altZone.back(); altZone.pop_back(); }
        
        if (spot.first != -1) {
            auto& b = getBlock(spot.first, spot.second);
            b.type = type;
            b.name = name;
            b.linked_id = linked_id;
            b.sublocation_id = "sub_" + r.id + "_" + type + "_" + std::to_string(counter++);

            JsonValue subLoc = JsonValue::object();
            subLoc.set("id", b.sublocation_id);
            subLoc.set("name", b.name);
            subLoc.set("parentId", r.id);
            subLoc.set("type", b.type);
            
            std::lock_guard<std::mutex> lock(g_sublocations_mutex);
            w.subLocations[b.sublocation_id] = subLoc;
        }
    };

    auto getFacName = [&](const std::string& type, const std::string& defaultName) -> std::string {
        if (g_db.city_gen_rules.facility_names.count(type) && !g_db.city_gen_rules.facility_names[type].empty()) {
            const auto& names = g_db.city_gen_rules.facility_names[type];
            return names[thread_safe_rand() % names.size()];
        }
        return defaultName;
    };

    // 4. Экономический ребаланс и расстановка (Data-Driven)
    int merchantCount = 0;
    for (const auto& [nId, npc] : w.npcs) {
        if (npc.homeLocation == r.id && npc.economy.profession_type == "merchant" && !npc.economy.workplaceId.empty()) {
            merchantCount++;
            placeBuilding("office", getFacName("office", "Shop") + " '" + npc.name + "'", npc.economy.workplaceId, centerSpots, midSpots);
        }
    }
    
    if (merchantCount >= 2) placeBuilding("market", getFacName("market", "Market"), "", centerSpots, midSpots);
    if (r.population > 5000 && g_facilityRegistry.getTemplate("temple")) placeBuilding("temple", getFacName("temple", "Temple"), "", centerSpots, midSpots);
    
    for (const auto& [fId, fac] : r.facilities) {
        if (fac.level > 0) {
            const FacilityTemplate* tpl = g_facilityRegistry.getTemplate(fId);
            if (!tpl) continue;
            
            if (tpl->hasTag("service") && fId != "market" && fId != "temple" && fId != "office" && fId != "tavern") {
                int count = std::min(2, fac.level);
                for(int i=0; i<count; ++i) placeBuilding(fId, getFacName(fId, getFacilityName(fId)), fId, centerSpots, midSpots);
            } else if (tpl->hasTag("processor") || tpl->hasTag("extractor")) {
                int tileCount = std::max(1, fac.level / 3);
                tileCount = std::min(tileCount, 4); 
                for(int i=0; i<tileCount; ++i) placeBuilding(fId, getFacName(fId, getFacilityName(fId)), fId, edgeSpots, midSpots);
            }
        }
    }

    int maxHouses = std::min(r.population / 50, (int)(midSpots.size() + edgeSpots.size() + centerSpots.size()) - 5);
    if (maxHouses < 0) maxHouses = 0;
    
    int taverns = std::max(1, maxHouses / 15);
    taverns = std::min(taverns, 5);
    for(int i=0; i<taverns; ++i) placeBuilding("tavern", getFacName("tavern", "Tavern"), "", midSpots, centerSpots);
    
    for(int i=0; i<maxHouses; ++i) {
        placeBuilding("house", getFacName("house", "Residential"), "", midSpots, edgeSpots);
    }
}

double scoreItemCandidate(const std::string& itemId,
                          const std::string& requiredTag,
                          const std::vector<std::string>& preferredIds = {},
                          const std::vector<std::string>& preferredTags = {},
                          const std::string& priorityProperty = "") {
    if (!requiredTag.empty() && !itemHasTag(itemId, requiredTag)) return -1e9;

    double score = 0.0;
    for (size_t i = 0; i < preferredIds.size(); ++i) {
        if (preferredIds[i] == itemId) {
            score += 500.0 - static_cast<double>(i * 20);
            break;
        }
    }
    for (size_t i = 0; i < preferredTags.size(); ++i) {
        if (itemHasTag(itemId, preferredTags[i])) {
            score += 120.0 - static_cast<double>(i * 10);
        }
    }
    if (!priorityProperty.empty()) {
        score += getItemNumericProperty(itemId, priorityProperty, 0.0) * 10.0;
    }
    if (requiredTag == "food") {
        score += getFoodPriority(itemId, priorityProperty.empty() ? "reserve_priority" : priorityProperty);
    }

    const auto itemIt = g_db.items.find(itemId);
    if (itemIt != g_db.items.end()) {
        score -= static_cast<double>(itemIt->second.basePrice) * 0.05;
    }

    return score;
}

std::string chooseBestItemCandidate(const std::vector<std::string>& candidates,
                                    const std::string& requiredTag,
                                    const std::vector<std::string>& preferredIds = {},
                                    const std::vector<std::string>& preferredTags = {},
                                    const std::string& priorityProperty = "") {
    std::string bestId;
    double bestScore = -1e9;

    for (const auto& itemId : candidates) {
        double score = scoreItemCandidate(itemId, requiredTag, preferredIds, preferredTags, priorityProperty);
        if (score > bestScore || (std::abs(score - bestScore) < 0.001 && itemId < bestId)) {
            bestScore = score;
            bestId = itemId;
        }
    }

    return bestScore <= -1e8 ? "" : bestId;
}

std::string getPreferredGlobalItemByTag(const std::string& requiredTag,
                                        const std::vector<std::string>& preferredIds = {},
                                        const std::vector<std::string>& preferredTags = {},
                                        const std::string& priorityProperty = "") {
    std::vector<std::string> candidates;
    candidates.reserve(g_db.all_item_ids.size());
    for (const auto& itemId : g_db.all_item_ids) {
        if (itemHasTag(itemId, requiredTag)) candidates.push_back(itemId);
    }
    return chooseBestItemCandidate(candidates, requiredTag, preferredIds, preferredTags, priorityProperty);
}

std::string getPreferredRegionalItemByTag(const std::set<std::string>& availableResources,
                                          const std::string& requiredTag,
                                          const std::vector<std::string>& preferredIds = {},
                                          const std::vector<std::string>& preferredTags = {},
                                          const std::string& priorityProperty = "") {
    std::vector<std::string> candidates;
    for (const auto& itemId : availableResources) {
        if (itemHasTag(itemId, requiredTag)) candidates.push_back(itemId);
    }
    return chooseBestItemCandidate(candidates, requiredTag, preferredIds, preferredTags, priorityProperty);
}

bool itemIdLooksLikeOre(const std::string& itemId) {
    return itemId.find("ore") != std::string::npos;
}

std::string getPreferredRegionalOreId(const std::set<std::string>& availableResources) {
    std::vector<std::string> candidates;
    for (const auto& itemId : availableResources) {
        if (itemIdLooksLikeOre(itemId) || itemHasTag(itemId, "metal_ingot")) candidates.push_back(itemId);
    }
    if (!candidates.empty()) {
        std::sort(candidates.begin(), candidates.end());
        return candidates.front();
    }
    return "";
}

std::vector<std::string> getFacilityOutputIds(const FacilityTemplate& tpl) {
    std::vector<std::string> outputs;
    outputs.reserve(tpl.extraction_rates.size());
    for (const auto& [itemId, rate] : tpl.extraction_rates) {
        if (g_db.items.count(itemId)) outputs.push_back(itemId);
    }
    std::sort(outputs.begin(), outputs.end());
    return outputs;
}

void addFacilityOutputsToResourceSet(std::set<std::string>& resources,
                                     const std::string& facilityId,
                                     int minOutputs,
                                     int maxOutputs,
                                     const std::vector<std::string>& preferredIds = {}) {
    const FacilityTemplate* tpl = g_facilityRegistry.getTemplate(facilityId);
    if (!tpl) return;

    std::vector<std::string> outputs = getFacilityOutputIds(*tpl);
    if (outputs.empty()) return;

    std::stable_sort(outputs.begin(), outputs.end(), [&](const std::string& left, const std::string& right) {
        auto leftIt = std::find(preferredIds.begin(), preferredIds.end(), left);
        auto rightIt = std::find(preferredIds.begin(), preferredIds.end(), right);
        const bool leftPreferred = leftIt != preferredIds.end();
        const bool rightPreferred = rightIt != preferredIds.end();
        if (leftPreferred != rightPreferred) return leftPreferred;
        if (leftPreferred && rightPreferred) return leftIt < rightIt;
        return left < right;
    });

    int desiredCount = minOutputs;
    if (maxOutputs > minOutputs) desiredCount += thread_safe_rand() % (maxOutputs - minOutputs + 1);
    desiredCount = std::min(desiredCount, static_cast<int>(outputs.size()));

    for (int i = 0; i < desiredCount; ++i) {
        resources.insert(outputs[i]);
    }
}

std::set<std::string> inferRegionRawResourcesLegacy(const Region& region) {
    std::set<std::string> resources;

    // Legacy migration path: placement profiles remain implicit until world data
    // provides explicit resource descriptors per location/biome.
    if (region.placement_type == "mountain") {
        addFacilityOutputsToResourceSet(resources, "mines", 2, 3, {"iron_ore", "gold_ore", "stone"});
        addFacilityOutputsToResourceSet(resources, "observatories", 1, 1, {"ether_dust"});
        if ((thread_safe_rand() % 100) < 20) addFacilityOutputsToResourceSet(resources, "hunting_lodges", 1, 1, {"monster_parts"});
    } else if (region.placement_type == "forest") {
        addFacilityOutputsToResourceSet(resources, "lumbermills", 1, 1, {"wood"});
        addFacilityOutputsToResourceSet(resources, "apiaries", 1, 2, {"honey", "wax"});
        addFacilityOutputsToResourceSet(resources, "hunting_lodges", 1, 2, {"fur", "meat", "monster_parts"});
        if ((thread_safe_rand() % 100) < 50) addFacilityOutputsToResourceSet(resources, "farms", 1, 1, {"herbs"});
    } else if (region.placement_type == "desert") {
        addFacilityOutputsToResourceSet(resources, "mines", 1, 2, {"iron_ore"});
        addFacilityOutputsToResourceSet(resources, "observatories", 1, 1, {"ether_dust"});
        if ((thread_safe_rand() % 100) < 20) addFacilityOutputsToResourceSet(resources, "hunting_lodges", 1, 1, {"monster_parts"});
    } else if (region.placement_type == "coast" || region.placement_type == "water") {
        addFacilityOutputsToResourceSet(resources, "fisheries", 1, 1, {"fish"});
        addFacilityOutputsToResourceSet(resources, "hunting_lodges", 1, 1, {"fur", "monster_parts"});
    } else {
        addFacilityOutputsToResourceSet(resources, "farms", 1, 3, {"wheat", "cotton"});
        addFacilityOutputsToResourceSet(resources, "apiaries", 1, 2, {"honey", "wax"});
    }

    return resources;
}

void seedRegionInitialSupplies(Region& region) {
    const std::string stapleFoodId = getCoreIdByTag("food");
    const std::string currencyId = getCoreIdByTag("currency");

    for (const auto& itemId : g_db.all_item_ids) {
        int baseAmount = 0;

        if (region.available_raw_resources.count(itemId)) {
            baseAmount = (region.population * 0.3) + (thread_safe_rand() % 200);
        } else if (!stapleFoodId.empty() && itemId == stapleFoodId) {
            baseAmount = region.population * 0.2;
        } else if (!currencyId.empty() && itemId == currencyId) {
            baseAmount = 5000 + (thread_safe_rand() % 5000);
        }

        if (baseAmount > 0) {
            createItem(itemId, baseAmount, region.vault_id, 0, "Initial supplies");
        }
        region.markets[itemId] = g_db.items[itemId].basePrice;
    }
}

bool recipeUsesRegionResources(const RecipeDef& recipe, const Region& region) {
    for (const auto& [inputId, qty] : recipe.inputs) {
        if (region.available_raw_resources.count(inputId)) return true;
    }
    return false;
}

bool facilityHasMatchingRegionalOutput(const FacilityTemplate& tpl, const Region& region) {
    for (const auto& [itemId, rate] : tpl.extraction_rates) {
        if (region.available_raw_resources.count(itemId)) return true;
    }
    return false;
}

int calculateInitialFacilityLevel(const Region& region, const std::string& ownerRace, const FacilityTemplate& tpl) {
    int level = 0;

    if (tpl.hasTag("extractor")) {
        int matchedOutputs = 0;
        for (const auto& [itemId, rate] : tpl.extraction_rates) {
            if (region.available_raw_resources.count(itemId)) matchedOutputs++;
        }
        if (matchedOutputs <= 0) return 0;

        level = 1 + (thread_safe_rand() % (matchedOutputs + 2));
        if (tpl.hasTag("food")) level += 1;
    } else if (tpl.hasTag("processor")) {
        int matchedRecipes = 0;
        for (const auto& recipe : g_db.recipes) {
            if (recipe.facility == tpl.id && recipeUsesRegionResources(recipe, region)) matchedRecipes++;
        }
        if (matchedRecipes <= 0) return 0;
        level = 1 + (thread_safe_rand() % std::min(4, matchedRecipes + 1));
    } else if (tpl.hasTag("service")) {
        level = (region.population >= 1000) ? (thread_safe_rand() % 3) : (thread_safe_rand() % 2);
    } else if (tpl.hasTag("storage")) {
        level = 1;
    }

    if (level <= 0) return 0;

    double regionalMultiplier = 1.0;
    if (tpl.resource_multiplier_type == "fertility") regionalMultiplier += std::max(0.0, region.fertility - 1.0);
    if (tpl.resource_multiplier_type == "mineral") regionalMultiplier += std::max(0.0, region.mineral_wealth - 1.0);

    double raceMultiplier = 1.0;
    auto raceIt = tpl.race_modifiers.find(ownerRace);
    if (raceIt != tpl.race_modifiers.end()) raceMultiplier = std::max(0.0, raceIt->second);

    level = std::max(0, static_cast<int>(std::round(level * regionalMultiplier * raceMultiplier)));
    return std::min(level, 20);
}

void seedRegionFacilities(Region& region, const std::string& ownerRace) {
    std::vector<std::string> facilityIds;
    facilityIds.reserve(g_facilityRegistry.getAll().size());
    for (const auto& [facilityId, tpl] : g_facilityRegistry.getAll()) {
        facilityIds.push_back(facilityId);
    }
    std::sort(facilityIds.begin(), facilityIds.end());

    for (const auto& facilityId : facilityIds) {
        const FacilityTemplate* tpl = g_facilityRegistry.getTemplate(facilityId);
        if (!tpl) continue;

        int level = calculateInitialFacilityLevel(region, ownerRace, *tpl);
        if (level <= 0) continue;

        Facility facility;
        facility.level = level;
        facility.durability = 100;
        region.facilities[facilityId] = facility;
    }
}

void applyNearWaterRegionBootstrap(Region& region, const std::string& regionId) {
    const std::string seafoodId = getPreferredGlobalItemByTag("food", {"fish"}, {"seafood", "raw_food"});
    const std::string cropId = getPreferredGlobalItemByTag("food", {"wheat"}, {"crop", "grain"});

    if (!seafoodId.empty()) region.available_raw_resources.insert(seafoodId);
    if (!cropId.empty()) region.available_raw_resources.insert(cropId);
    region.fertility += 0.5;

    if (!region.factionId.empty()) {
        PortFacility port;
        port.type = PortType::TRADE;
        port.dock_container_id = createContainer("port_dock", region.factionId, 999999, 1000, regionId);
        port.has_shipyard = (thread_safe_rand() % 100 < 40);
        g_world.port_facilities[regionId] = port;
    }
}

std::vector<std::string> getMonopolyFacilityCandidates(const Region& region) {
    std::vector<std::string> candidates;
    for (const auto& [facilityId, facility] : region.facilities) {
        if (facility.level <= 0) continue;
        const FacilityTemplate* tpl = g_facilityRegistry.getTemplate(facilityId);
        if (!tpl || !tpl->hasTag("extractor")) continue;
        if (!facilityHasMatchingRegionalOutput(*tpl, region)) continue;
        candidates.push_back(facilityId);
    }
    std::sort(candidates.begin(), candidates.end());
    return candidates;
}

std::string chooseMonopolyProductionFocus(const std::string& facilityId, const Region& region) {
    const FacilityTemplate* tpl = g_facilityRegistry.getTemplate(facilityId);
    if (!tpl) return "";

    std::vector<std::string> outputs;
    for (const auto& [itemId, rate] : tpl->extraction_rates) {
        if (region.available_raw_resources.count(itemId)) outputs.push_back(itemId);
    }
    return chooseBestItemCandidate(outputs, "", {}, {"food", "raw_material"});
}

void addBootstrapStarterResources(Region& region) {
    if (region.vault_id.empty()) return;

    // Data-driven: priority hint lists loaded from tag_defaults (reserve_priority_hints / army_supply_priority_hints)
    const std::vector<std::string>& staplePriority = g_db.tag_default_lists.count("reserve_priority_hints")
        ? g_db.tag_default_lists.at("reserve_priority_hints")
        : std::vector<std::string>{"bread", "smoked_meat", "meat"};
    const std::vector<std::string>& preservedPriority = g_db.tag_default_lists.count("army_supply_priority_hints")
        ? g_db.tag_default_lists.at("army_supply_priority_hints")
        : std::vector<std::string>{"smoked_meat", "bread", "fish"};
    const std::string stapleFoodId = getPreferredGlobalItemByTag("food", staplePriority, {"processed_food", "bakery_product", "raw_food"}, "reserve_priority");
    const std::string preservedFoodId = getPreferredGlobalItemByTag("food", preservedPriority, {"preserved_food", "processed_food", "raw_food"}, "army_supply_priority");
    const std::string constructionId = getPreferredRegionalItemByTag(region.available_raw_resources, "raw_material", {"wood", "stone"}, {"construction_material", "raw_material"});
    const std::string oreId = getPreferredRegionalOreId(region.available_raw_resources);
    const std::string currencyId = getCoreIdByTag("currency");
    const std::string weaponId = getCoreIdByTag("weapon");

    if (!stapleFoodId.empty()) createItem(stapleFoodId, region.population * 0.15, region.vault_id, 0, "Bootstrap");
    if (!preservedFoodId.empty() && preservedFoodId != stapleFoodId) createItem(preservedFoodId, region.population * 0.05, region.vault_id, 0, "Bootstrap");
    if (!constructionId.empty()) createItem(constructionId, 200 + thread_safe_rand() % 200, region.vault_id, 0, "Bootstrap");
    if (!oreId.empty()) createItem(oreId, 100 + thread_safe_rand() % 200, region.vault_id, 0, "Bootstrap");
    if (!currencyId.empty()) createItem(currencyId, 500 + thread_safe_rand() % 500, region.vault_id, 0, "Bootstrap");
    if (!weaponId.empty()) createItem(weaponId, 50 + thread_safe_rand() % 50, region.vault_id, 0, "Bootstrap");
}

std::string inferLegacyPlacementTypeFromRegionName(const std::string& regionName) {
    std::string lowerName = regionName;
    std::transform(lowerName.begin(), lowerName.end(), lowerName.begin(), [](unsigned char c){ return std::tolower(c); });

    if (lowerName.find("РіРѕСЂ") != std::string::npos || lowerName.find("РїРёРє") != std::string::npos ||
        lowerName.find("С€Р°С…С‚") != std::string::npos || lowerName.find("mountain") != std::string::npos ||
        lowerName.find("citadel") != std::string::npos || lowerName.find("С†РёС‚Р°РґРµР»СЊ") != std::string::npos) {
        return "mountain";
    }
    if (lowerName.find("Р»РµСЃ") != std::string::npos || lowerName.find("СЂРѕС‰") != std::string::npos ||
        lowerName.find("forest") != std::string::npos || lowerName.find("wood") != std::string::npos) {
        return "forest";
    }
    if (lowerName.find("РїСѓСЃС‚С‹РЅ") != std::string::npos || lowerName.find("РїРµСЃРє") != std::string::npos ||
        lowerName.find("desert") != std::string::npos || lowerName.find("sand") != std::string::npos ||
        lowerName.find("РїРµРїРµР»") != std::string::npos || lowerName.find("ash") != std::string::npos) {
        return "desert";
    }
    if (lowerName.find("РјРѕСЂРµ") != std::string::npos || lowerName.find("РѕР·РµСЂ") != std::string::npos ||
        lowerName.find("РіР°РІР°РЅСЊ") != std::string::npos || lowerName.find("РїРѕСЂС‚") != std::string::npos ||
        lowerName.find("sea") != std::string::npos || lowerName.find("haven") != std::string::npos) {
        return "coast";
    }
    return "plains";
}

bool facilityIsExtractor(const std::string& facilityId) {
    const FacilityTemplate* tpl = g_facilityRegistry.getTemplate(facilityId);
    return tpl && tpl->hasTag("extractor");
}

std::vector<std::string> getFacilityCandidateProducts(const std::string& facilityId) {
    std::vector<std::string> outputs;

    const FacilityTemplate* tpl = g_facilityRegistry.getTemplate(facilityId);
    if (tpl && tpl->hasTag("extractor")) {
        outputs = getFacilityOutputIds(*tpl);
    } else {
        for (const auto& rec : g_db.recipes) {
            if (rec.facility != facilityId) continue;
            for (const auto& [outId, qty] : rec.outputs) {
                outputs.push_back(outId);
            }
        }
        std::sort(outputs.begin(), outputs.end());
        outputs.erase(std::unique(outputs.begin(), outputs.end()), outputs.end());
    }

    return outputs;
}

const ProfessionDef* getProfessionData(const NPC& npc) {
    auto it = g_db.professions.find(npc.profession);
    if (it != g_db.professions.end()) return &it->second;

    for (const auto& [id, prof] : g_db.professions) {
        if (prof.name == npc.profession) return &prof;
    }
    return nullptr;
}

std::string getNpcProfessionType(const NPC& npc) {
    const ProfessionDef* prof = getProfessionData(npc);
    if (prof && !prof->profession_type.empty()) return prof->profession_type;
    return npc.economy.profession_type;
}

bool npcHasProfessionType(const NPC& npc, const std::vector<std::string>& types) {
    const std::string professionType = getNpcProfessionType(npc);
    return std::find(types.begin(), types.end(), professionType) != types.end();
}


bool npcHasProfessionType(const NPC& npc, std::initializer_list<const char*> types) {
    const std::string professionType = getNpcProfessionType(npc);
    for (const char* type : types) {
        if (type && professionType == type) return true;
    }
    return false;
}

bool npcHasProfessionAbility(const NPC& npc, const std::string& ability) {
    const ProfessionDef* prof = getProfessionData(npc);
    if (!prof) return false;
    return std::find(prof->special_abilities.begin(), prof->special_abilities.end(), ability) != prof->special_abilities.end();
}

std::string getNpcToolItemId(const NPC& npc) {
    const ProfessionDef* prof = getProfessionData(npc);
    if (prof && !prof->tool_tag.empty()) return prof->tool_tag;
    return "";
}

bool regionHasFacility(const Region& region, const std::string& facilityId) {
    return region.facilities.count(facilityId) && region.facilities.at(facilityId).level > 0;
}

double getNpcFacilityRaceModifier(const NPC& npc, const std::string& facilityId) {
    const FacilityTemplate* tpl = g_facilityRegistry.getTemplate(facilityId);
    if (tpl) {
        auto it = tpl->race_modifiers.find(npc.race);
        if (it != tpl->race_modifiers.end()) return it->second;
    }

    // Legacy migration path until race affinities are fully data-driven.
    if (npc.race == "orc" && facilityId == "hunting_lodges") return 1.5;
    if (npc.race == "dwarf" && (facilityId == "forges" || facilityId == "smelters")) return 1.3;
    if (npc.race == "elf" && (facilityId == "alchemists" || facilityId == "jewelers")) return 1.2;
    return 1.0;
}

std::string getPreferredFacilityOutputForRegion(const Region& region,
                                                const std::string& facilityId,
                                                const std::string& requiredTag = "",
                                                const std::vector<std::string>& preferredIds = {},
                                                const std::vector<std::string>& preferredTags = {}) {
    std::vector<std::string> outputs = getFacilityCandidateProducts(facilityId);
    if (facilityIsExtractor(facilityId)) {
        outputs.erase(std::remove_if(outputs.begin(), outputs.end(), [&](const std::string& itemId) {
            return !region.available_raw_resources.count(itemId);
        }), outputs.end());
    }
    return chooseBestItemCandidate(outputs, requiredTag, preferredIds, preferredTags);
}

void upsertNpcMarketOffer(Region& region, const std::string& sellerId, const std::string& itemId, int quantity, double priceMult = 1.0) {
    if (quantity <= 0) return;

    for (auto& ex_offer : region.market_square) {
        if (ex_offer.seller_id == sellerId && ex_offer.good == itemId) {
            ex_offer.quantity = quantity;
            return;
        }
    }

    MarketOffer offer;
    offer.id = "offer_" + generateUUID();
    offer.seller_id = sellerId;
    offer.good = itemId;
    offer.quantity = quantity;
    auto it = g_db.items.find(itemId);
    offer.price = ((it != g_db.items.end()) ? it->second.basePrice : 1) * priceMult;
    region.market_square.push_back(offer);
}

std::string getLegacyCraftFacilityForProfession(const NPC& npc) {
    // Data-driven: look up preferred_facility from professions.json
    // Fall back to a hardcoded map only if not defined in data
    std::string profId = npc.profession;
    // Normalize: lowercase for lookup
    std::string profLower = profId;
    std::transform(profLower.begin(), profLower.end(), profLower.begin(), [](unsigned char c){ return std::tolower(c); });

    // Try data-driven lookup first
    auto profIt = g_db.professions.find(profLower);
    if (profIt == g_db.professions.end()) profIt = g_db.professions.find(profId);
    if (profIt != g_db.professions.end() && !profIt->second.preferred_facility.empty()) {
        return profIt->second.preferred_facility;
    }

    // All professions now define preferred_facility in professions.json.
    // Legacy shim removed — fallback to empty string.
    return "";
}

const RecipeDef* getPreferredRecipeForFacilityOutput(const std::string& facilityId,
                                                     const std::string& preferredOutputId = "",
                                                     const std::string& requiredOutputTag = "") {
    const RecipeDef* fallback = nullptr;
    for (const auto& rec : g_db.recipes) {
        if (rec.facility != facilityId || rec.outputs.empty()) continue;
        if (!preferredOutputId.empty() && rec.outputs.count(preferredOutputId)) return &rec;
        if (!requiredOutputTag.empty()) {
            for (const auto& [outId, qty] : rec.outputs) {
                if (itemHasTag(outId, requiredOutputTag)) return &rec;
            }
        }
        if (!fallback) fallback = &rec;
    }
    return fallback;
}

bool isInnkeeperFoodItem(const std::string& itemId) {
    if (itemHasTag(itemId, "food")) return true;
    auto it = g_db.items.find(itemId);
    return it != g_db.items.end() && it->second.category == "consumable";
}

bool isClericSupplyItem(const std::string& itemId) {
    // Data-driven: use tag_defaults "cleric_supply_goods" list if present,
    // otherwise fall back to tag check for "religious" or "medical" category
    const auto& tagLists = g_db.tag_default_lists;
    auto it = tagLists.find("cleric_supply_goods");
    if (it != tagLists.end() && !it->second.empty()) {
        return std::find(it->second.begin(), it->second.end(), itemId) != it->second.end();
    }
    // Fallback: item has religious or medical tag
    return itemHasTag(itemId, "religious") || itemHasTag(itemId, "medical");
}


// Build initial world
void buildWorld(const std::string& playerId, const std::string& era, int initialAgents, const JsonValue& globalLocs, int startDay) {
    g_playerId = playerId;
    g_world = World();
    g_world.era = era.empty() ? g_gameplay_runtime.default_era_id : era;
    g_world.current_day = startDay;
    
    // Очистка реестров от предыдущих сессий (Fix Memory Leak)
    g_items.clear();
    g_containers.clear();
    g_deleted_items.clear();
    g_deleted_containers.clear();
    g_path_cache.clear();
    g_path_cache_dirty = true;
    
    std::map<std::string, std::string> locMap;
    std::set<std::string> discovered_factions;
    
    if (globalLocs.type == JsonValue::OBJECT && globalLocs.size() > 0) {
        for (const auto& kv : globalLocs.obj_val) {
            if (kv.first != "startLocation") {
                if (kv.second.has("faction")) {
                    std::string fac = kv.second["faction"].asString();
                    if (!fac.empty()) {
                        discovered_factions.insert(fac);
                        locMap[kv.first] = fac;
                    }
                }
            }
        }
    }
    
    if (discovered_factions.empty()) {
        discovered_factions = {"faction_alpha", "faction_beta"};
    }
    
    std::vector<std::string> fKeys;
    for (const auto& fid : discovered_factions) {
        Faction f;
        f.id = fid;
        f.name = fid; // Name will be localized by JS client
        g_world.factions[fid] = f;
        fKeys.push_back(fid);
    }

    for (auto& f1 : fKeys) {
        for (auto& f2 : fKeys) {
            if (f1 != f2) {
                // Базовые отношения от -10 до +40 (избегаем мгновенной ненависти на старте)
                int baseRel = (rand() % 50) - 10;
                
                // Data-driven: era-specific relation modifiers from g_db.faction_relations
                auto eraIt = g_db.faction_relations.era_relations.find(g_world.era);
                if (eraIt != g_db.faction_relations.era_relations.end()) {
                    for (const auto& rule : eraIt->second) {
                        if ((f1 == rule.f1 && f2 == rule.f2) || (f1 == rule.f2 && f2 == rule.f1)) {
                            baseRel += rule.modifier;
                        }
                    }
                }
                
                g_world.factions[f1].relations[f2] = std::clamp(baseRel, -100, 100);
                g_world.factions[f1].diplomacy[f2] = "neutral";
                
                // ГЛОБАЛЬНЫЙ СТАРТОВЫЙ ПАКТ: СНЯТ
                g_world.factions[f1].truceUntil[f2] = 0; // Лимит на мирный старт снят
            }
        }
    }
    
    std::vector<std::string> locKeys;
    if (globalLocs.type == JsonValue::OBJECT && globalLocs.size() > 0) {
        for (const auto& kv : globalLocs.obj_val) {
            if (kv.first != "startLocation") locKeys.push_back(kv.first);
        }
    } else {
        for (const auto& kv : locMap) locKeys.push_back(kv.first);
    }

    for (const auto& key : locKeys) {
        Region r;
        r.id = key;
        r.name = globalLocs.has(key) && globalLocs[key].has("name") ? globalLocs[key]["name"].asString() : key;
        if (globalLocs.has(key) && globalLocs[key].has("placement")) {
            r.placement_type = globalLocs[key]["placement"].asString();
        }

        if (globalLocs.has(key) && globalLocs[key].has("type")) {
            r.base_type = globalLocs[key]["type"].asString();
        }

        // Эвристика определения руин/аномалий (Фолбэк, если типа нет)
        if (r.base_type.empty()) {
            std::string lowerName = r.name;
            std::transform(lowerName.begin(), lowerName.end(), lowerName.begin(), [](unsigned char c){ return std::tolower(c); });
            std::string lowerId = key;
            std::transform(lowerId.begin(), lowerId.end(), lowerId.begin(), [](unsigned char c){ return std::tolower(c); });

            if (lowerName.find("руин") != std::string::npos || lowerId.find("ruin") != std::string::npos) r.base_type = "ruins";
            else if (lowerName.find("аномал") != std::string::npos || lowerId.find("anomaly") != std::string::npos || lowerId.find("scar") != std::string::npos || lowerId.find("void") != std::string::npos) r.base_type = "anomaly";
            else if (lowerName.find("форт") != std::string::npos || lowerId.find("fort") != std::string::npos) r.base_type = "fort";
            else if (lowerName.find("лагерь") != std::string::npos || lowerId.find("camp") != std::string::npos) r.base_type = "camp";
            else if (lowerName.find("обсерват") != std::string::npos || lowerId.find("obs") != std::string::npos) r.base_type = "observatory";
        }

        bool is_ruin = (r.base_type == "ruins" || r.base_type == "anomaly");

        std::string ownerId = "";
        std::string ownerRace = g_gameplay_runtime.default_race_id;

        if (is_ruin) {
            r.factionId = "";
            r.population = 0;
            r.moneySupply = 0;
            r.fertility = 0.0;
            r.mineral_wealth = 0.0;
        } else {
            ownerId = locMap.count(key) ? locMap[key] : fKeys[rand() % fKeys.size()];
            // Data-driven: resolve race from faction via g_db.faction_to_race
            auto ftrIt = g_db.faction_to_race.find(ownerId);
            if (ftrIt != g_db.faction_to_race.end()) ownerRace = ftrIt->second;
            r.factionId = ownerId;
            r.population = 250 + (rand() % 2250);
            r.moneySupply = 5000 + (rand() % 10000);
            r.fertility = 0.5 + (rand() % 100) / 100.0;
            r.mineral_wealth = 0.5 + (rand() % 100) / 100.0;
        }

        if (globalLocs.has(key) && globalLocs[key].has("no_road")) {
            r.no_road = globalLocs[key]["no_road"].asBool();
        }

        // Инициализация возрастной пирамиды (0-120 лет)
        r.age_pyramid.assign(121, 0.0);
        if (!is_ruin) {
            double children = r.population * 0.20;
            double workers = r.population * 0.60;
            double elders = r.population * 0.20;
            for(int i=0; i<=17; i++) r.age_pyramid[i] = children / 18.0;
            for(int i=18; i<=65; i++) r.age_pyramid[i] = workers / 48.0;
            for(int i=66; i<=120; i++) r.age_pyramid[i] = elders / 55.0;
            r.labor_force = (int)workers;
        } else {
            r.labor_force = 0;
        }
        r.climate = "temperate";
        r.weather = "Ясно";

        r.vault_id = createContainer(
            is_ruin ? g_gameplay_runtime.ruins_stash_container_type : g_gameplay_runtime.faction_vault_container_type,
            is_ruin ? "none" : ownerId,
            999999,
            1000,
            key
        );
        r.storage_capacity = is_ruin ? 50000 : 100000 + (r.population * 10);
        r.threat_level = is_ruin ? 80 + (rand() % 21) : 10 + (rand() % 20);

        if (!is_ruin) {
            r.available_raw_resources = inferRegionRawResourcesLegacy(r);
            seedRegionFacilities(r, ownerRace);
            seedRegionInitialSupplies(r);
        }

        r.animals.herbivores = (ownerRace == "elf") ? 10000 : 500 + (rand() % 2000);
        r.animals.carnivores = (ownerRace == "elf") ? 1000 : 50 + (rand() % 200);

        g_world.regions[key] = r;
        if (!is_ruin && !ownerId.empty()) {
            g_world.factions[ownerId].regions.push_back(key);
        }
    }

    // --- Балансировка начальных условий (Асимметрия) ---
    // Случайные войны удалены, так как теперь работает адаптивный политический гомеостаз.
    if (locKeys.size() >= 2) {
        g_world.regions[locKeys[0]].fertility = 1.5;
        g_world.regions[locKeys[0]].mineral_wealth = 1.5;
        g_world.regions[locKeys[0]].population *= 2;
        g_world.regions[locKeys[0]].moneySupply *= 2;
        
        g_world.regions[locKeys[1]].fertility = 0.5;
        g_world.regions[locKeys[1]].mineral_wealth = 0.5;
        g_world.regions[locKeys[1]].population /= 2;
        g_world.regions[locKeys[1]].moneySupply /= 2;
    }

    // Create NPCs
    // NOTE: names and professions now loaded from g_db (data/npc_names.json, data/professions.json)
    std::vector<std::string> regionIds;
    for (auto& [rid, r] : g_world.regions) regionIds.push_back(rid);
    
    if (!regionIds.empty()) {
        for (int i = 0; i < initialAgents; i++) {
        NPC npc;
        npc.id = "npc_" + generateUUID();
        // Data-driven: select profession from g_db.profession_ids
        std::string profId = g_db.profession_ids.empty() ? "farmer" : g_db.profession_ids[rand() % g_db.profession_ids.size()];
        std::string homeReg = regionIds[rand() % regionIds.size()];

        // Data-driven: resolve race from faction or pick random
        std::string homeFaction = g_world.regions.count(homeReg) ? g_world.regions[homeReg].factionId : "";
        npc.race = g_gameplay_runtime.default_race_id; // default
        auto ftrIt = g_db.faction_to_race.find(homeFaction);
        if (ftrIt != g_db.faction_to_race.end()) npc.race = ftrIt->second;
        else if (!g_db.race_ids.empty()) npc.race = g_db.race_ids[rand() % g_db.race_ids.size()];

        // Data-driven: name from g_db.name_groups (via faction→race resolution)
        std::mt19937 nameGen(rand());
        npc.name = NpcGen::generateName(homeFaction, nameGen) + " " + profId;
        npc.type = "npc";

        npc.profession = profId;
        // Data-driven: resolve profession_type from g_db.professions
        auto profIt = g_db.professions.find(profId);
        npc.economy.profession_type = (profIt != g_db.professions.end()) ? profIt->second.profession_type : "farmer";
        
        npc.homeLocation = regionIds[rand() % regionIds.size()];
        npc.currentLocation = npc.homeLocation;
        npc.currentActivity = "Resting";
        
        // Demographics
        npc.age_days = (18 + rand() % 40) * 360 + (rand() % 360);
        npc.is_male = (rand() % 2 == 0);
        npc.immunity = 50 + rand() % 50;
        npc.hp = 20;
        npc.maxHp = 20;
        npc.str = 8 + rand() % 6;
        npc.dex = 8 + rand() % 6;
        npc.con = 8 + rand() % 6;
        npc.int_ = 8 + rand() % 6;
        npc.cha = 8 + rand() % 6;
        npc.res = 8 + rand() % 6;
        npc.min_damage = 1;
        npc.max_damage = 4;
        npc.armor_class = 10 + (npc.dex - 10) / 2;
        
        // Schedule
        npc.schedule = {
            {0, 6, "Sleeping", npc.homeLocation},
            {7, 8, "Eating", npc.homeLocation},
            {9, 18, "Working", npc.homeLocation},
            {19, 21, "Resting", npc.homeLocation},
            {22, 23, "Sleeping", npc.homeLocation}
        };
        
        // Personality
        npc.personality.aggression = rand() % 100;
        npc.personality.sociability = rand() % 100;
        npc.personality.greed = rand() % 100;
        npc.personality.loyalty = rand() % 100;
        npc.personality.lust = rand() % 100;
        
        // Traits (Data-driven: loaded from g_db.traits)
        if (rand() % 100 < 40 && !g_db.trait_ids.empty()) {
            std::string traitId = g_db.trait_ids[rand() % g_db.trait_ids.size()];
            npc.traits.push_back(traitId);
        }
        
        // Economy
        npc.economy.skillLevel = 1 + (rand() % 10);
        npc.economy.savings = rand() % 500;
        
        // Inventory
        int initialGoldMax = std::max(1, g_gameplay_runtime.npc_initial_gold_max);
        npc.gold = rand() % initialGoldMax;
        npc.inventory_id = createContainer("npc_inventory", npc.id, 100, 20, npc.homeLocation, npc.id);
        
        if (npc.economy.profession_type == "merchant") {
            std::string officeId = createContainer("merchant_office", npc.id, 999999, 1000, npc.homeLocation);
            createContainer("inbox", npc.id, 999999, 1000, npc.homeLocation, "", officeId);
            createContainer("outbox", npc.id, 999999, 1000, npc.homeLocation, "", officeId);
            createContainer("archive", npc.id, 999999, 1000, npc.homeLocation, "", officeId);
            createContainer("safe", npc.id, 999999, 1000, npc.homeLocation, "", officeId);
            npc.economy.workplaceId = officeId;
            npc.economy.isEmployed = true;
        }
        
            g_world.npcs[npc.id] = npc;
        }
    }
    
    // Create rulers
    for (auto& [fid, faction] : g_world.factions) {
        NPC ruler;
        ruler.id = "ruler_" + fid;
        ruler.type = "ruler";
        ruler.factionId = fid;
        ruler.name = "Ruler of " + faction.name;
        ruler.race = g_gameplay_runtime.default_race_id;
        
        ruler.homeLocation = g_world.factions[fid].regions.empty() ? "" : g_world.factions[fid].regions[0];
        ruler.currentLocation = ruler.homeLocation;
        ruler.isAlive = true;
        ruler.alive = true;
        ruler.health = 100;
        
        ruler.rulerPersonality.ambition = 40 + (rand() % 40); // Нормальные амбиции
        ruler.rulerPersonality.wisdom = 40 + (rand() % 40);
        ruler.rulerPersonality.military = 40 + (rand() % 40); // Нормальный милитаризм
        ruler.rulerPersonality.cruelty = 30 + (rand() % 40);
        ruler.rulerPersonality.diplomacy = 40 + (rand() % 40);
        ruler.rulerPersonality.paranoia = 30 + (rand() % 40); // Нормальная паранойя
        ruler.rulerPersonality.stewardship = 60 + (rand() % 40); // Фокус на экономике
        
        g_world.npcs[ruler.id] = ruler;
        g_world.factions[fid].rulerId = ruler.id;
    }

    // Create Lord Monopolies (Монополии феодалов)
    for (auto& [fid, faction] : g_world.factions) {
        if (faction.regions.empty() || faction.rulerId.empty()) continue;
        std::string capital = faction.regions[0];
        
        if (!g_world.regions.count(capital)) continue;
        std::vector<std::string> monopolyTypes = getMonopolyFacilityCandidates(g_world.regions[capital]);
        if (monopolyTypes.empty()) continue;
        int numMonopolies = 2 + (rand() % 5); // Лимит монополий лордов увеличен
        
        for (int i = 0; i < numMonopolies; i++) {
            std::string facType = monopolyTypes[rand() % monopolyTypes.size()];
            
            Business b;
            b.id = "bus_" + generateUUID();
            b.owner_ids.push_back(faction.rulerId);
            b.region_id = capital;
            b.facility_type = facType;
            b.level = 3; // Монополии лордов сразу крупные
            b.employee_count = b.level * 100; // ФИКС: Назначаем рабочих сразу, чтобы производство началось в 1-й день
            b.target_employee_count = b.level * 100;
            b.cash_balance = 5000;
            b.is_active = true;
            b.local_storage_id = createContainer("business_storage", faction.rulerId, 999999, 1000, capital);
            
            // Определяем фокус производства и гарантируем наличие ресурса в регионе
            b.production_focus = chooseMonopolyProductionFocus(facType, g_world.regions[capital]);
            if (b.production_focus.empty()) continue;
            g_world.regions[capital].available_raw_resources.insert(b.production_focus);
            
            LogisticRule autoSell;
            autoSell.id = "log_" + generateUUID();
            autoSell.type = "transfer";
                        autoSell.resource = b.production_focus;
            autoSell.target_id = capital;
                                autoSell.amount = 9999;
                    autoSell.frequency_days = 7;
                    b.logistics.push_back(autoSell);
            
            g_world.businesses[b.id] = b;
            g_world.npcs[faction.rulerId].owned_businesses.push_back(b.id);
            
            if (g_world.regions.count(capital)) {
                placePrivateBusinessOnMap(g_world.regions[capital], b, g_world);
            }
        }
    }


    // Assign Clerks to Merchant Offices
    std::map<std::string, std::vector<std::string>> regionOffices;
    for (const auto& [nid, n] : g_world.npcs) {
        if (n.profession == "Торговец" && !n.economy.workplaceId.empty()) {
            regionOffices[n.homeLocation].push_back(n.economy.workplaceId);
        }
    }
    for (auto& [nid, n] : g_world.npcs) {
        if (n.profession == "Клерк" && regionOffices.count(n.homeLocation) && !regionOffices[n.homeLocation].empty()) {
            n.economy.workplaceId = regionOffices[n.homeLocation][rand() % regionOffices[n.homeLocation].size()];
            n.economy.isEmployed = true;
        }
    }

    
    // Generate City Layouts for all regions (Multi-threaded)
    std::vector<std::future<void>> city_futures;
    for (auto& [rid, r] : g_world.regions) {
        city_futures.push_back(getThreadPool()->enqueue([&r]() {
            generateCityLayout(r, g_world);
        }));
    }
    for (auto& f : city_futures) f.get();


    // Generate Global World Map
    g_world.map.width = g_db.world_config.map_width;
    g_world.map.height = g_db.world_config.map_height;
    generateWorldMapTerrain(g_world.map, rand());
    placeRegionsOnMap(g_world.map, g_world);
    generateRoads(g_world.map, g_world);

    generateSeaRoutes(g_world.map, g_world);

    for (auto& [rid, region] : g_world.regions) {
        if (g_world.map.locations.count(rid) == 0) continue;

        auto loc = g_world.map.locations[rid];
        bool near_water = false;
        for (int dy = -1; dy <= 1 && !near_water; dy++) {
            for (int dx = -1; dx <= 1; dx++) {
                int nx = loc.x + dx;
                int ny = loc.y + dy;
                if (nx < 0 || nx >= g_world.map.width || ny < 0 || ny >= g_world.map.height) continue;

                uint8_t biomeId = g_world.map.grid[ny * g_world.map.width + nx].biome_id;
                const BiomeDef* biome = getBiomeById(biomeId);
                if (biome && biome->is_water) {
                    near_water = true;
                    break;
                }
            }
        }

        if (near_water) {
            applyNearWaterRegionBootstrap(region, rid);
        }
    }

    for (const auto& [rid, port] : g_world.port_facilities) {
        if (g_world.regions.count(rid)) {
            std::string factionId = g_world.regions[rid].factionId;
            
            Ship s;
            s.id = "ship_" + generateUUID();
            s.owner_id = factionId;
            s.type = ShipType::MERCHANT;
            s.hull = 100;
            s.sailors = 15;
            s.cargo_capacity = 500;
            s.chest_id = createContainer("ship_hold", factionId, 999999, 100, rid);
            s.speed = 1.5;
            applyShipTypeRuntimeDescriptor(s);
            if (g_world.map.locations.count(rid)) {
                s.x = g_world.map.locations[rid].x;
                s.y = g_world.map.locations[rid].y;
            }
            g_world.ships.push_back(s);
            
            if (port.has_shipyard) {
                Ship warship;
                warship.id = "ship_" + generateUUID();
                warship.owner_id = factionId;
                warship.type = ShipType::WAR_GALLEY;
                warship.hull = 200;
                warship.sailors = 40;
                warship.cargo_capacity = 100;
                warship.chest_id = createContainer("ship_hold", factionId, 999999, 50, rid);
                warship.speed = 1.2;
                warship.cannons = 10;
                warship.marines = 20;
                applyShipTypeRuntimeDescriptor(warship);
                if (g_world.map.locations.count(rid)) {
                    warship.x = g_world.map.locations[rid].x;
                    warship.y = g_world.map.locations[rid].y;
                }
                g_world.ships.push_back(warship);
            }
        }
    }
    g_world.map.generation_tick = g_world.tick;


    // Initial news
    addNews("World created. Era " + g_world.era + " begins.", "Global", 3, "misc");
}

void bootstrapWorld(int days, int targetStartDay) {
    g_bootstrap = true;
    g_world.current_day = targetStartDay - days;
    if (g_world.current_day < 0) g_world.current_day = 0;
    
    // 1. Initial resources
    for (auto& [rid, r] : g_world.regions) {
        addBootstrapStarterResources(r);
    }

    // 2. Initial caravans
    std::vector<std::string> capitals;
    for (const auto& [fid, f] : g_world.factions) {
        if (!f.regions.empty()) capitals.push_back(f.regions[0]);
    }
    if (capitals.size() >= 2) {
        for (size_t i = 0; i < capitals.size(); ++i) {
            std::string origin = capitals[i];
            std::string dest = capitals[(i + 1) % capitals.size()];
            
            std::vector<std::pair<int,int>> caravan_path;
            if (g_path_cache.count({origin, dest})) caravan_path = g_path_cache[{origin, dest}];
            if (caravan_path.empty()) continue;

            std::string chestId = createContainer("caravan_chest", "bootstrap", 999999, 1000, origin);
            int num_goods = 2 + thread_safe_rand() % 3;
            for (int g = 0; g < num_goods; ++g) {
                if (g_db.all_item_ids.empty()) break;
                std::string gt = g_db.all_item_ids[thread_safe_rand() % g_db.all_item_ids.size()];
                if (g_db.items[gt].category == "document") { g--; continue; }
                createItem(gt, 20 + thread_safe_rand() % 51, chestId, 0, "Bootstrap Caravan");
            }
            
            Caravan c;
            c.id = "caravan_" + generateUUID();
            c.origin = origin;
            c.destination = dest;
            c.chest_id = chestId;
            c.wagons = 2;
            c.guards = 5;
            c.hoursLeft = 24 + thread_safe_rand() % 49;
            if (g_path_cache.count({origin, dest})) {
                c.path = g_path_cache[{origin, dest}];
                if (!c.path.empty()) { c.x = c.path[0].first; c.y = c.path[0].second; }
            }
            g_world.regions[origin].caravans.push_back(c);
        }
    }

    // 3. Simulate
    int ticks = days * 24;
    for (int i = 0; i < ticks; i++) {
        hourlyTick();
        g_world.tick++;
    }

    // 4. Cleanup
    g_world.news.clear();
    g_world.needsGlobalEvent = false;
    g_world.lastDirectInjectionDay = -999;
    g_world.tick = 0;
    g_world.current_day = targetStartDay;
    g_world.time.accumulatedMinutes = 0;
    g_world.time.internalHour = 0;
    updateWeather();
    g_bootstrap = false;
}


// Simulate N ticks
void reportProgress(int currentTick, const std::string& lastNews,
                    const JsonValue& dirtyItems,
                    const JsonValue& dirtyContainers,
                    const JsonValue& deletedItems,
                    const JsonValue& deletedContainers)
{
    JsonValue res = JsonValue::object();
    res.set("status", "progress");

    int totalDays = currentTick / 24;
    int years = totalDays / 360;
    int months = (totalDays % 360) / 30 + 1;

    std::string msg = "Симуляция истории: Год " + std::to_string(years + 1)
                    + ", Месяц " + std::to_string(months);
    if (!lastNews.empty()) {
        msg += " | Последнее событие: " + lastNews;
    }
    res.set("message", msg);

    // Отправляем ТОЛЬКО изменившиеся данные
    if (!dirtyItems.arr_val.empty())
        res.set("items", dirtyItems);
    if (!dirtyContainers.arr_val.empty())
        res.set("containers", dirtyContainers);
    if (!deletedItems.arr_val.empty())
        res.set("deleted_items", deletedItems);
    if (!deletedContainers.arr_val.empty())
        res.set("deleted_containers", deletedContainers);

    std::cout << res.toString() << std::endl;
    std::cout.flush();

    // Очищаем списки удалённых, чтобы не дублировать их в следующих репортах
    g_deleted_items.clear();
    g_deleted_containers.clear();
}

void simulateTicks(int ticks) {
    for (int i = 0; i < ticks; i++) {
        hourlyTick();                 // внутри: dailyTick и weeklyTick вызываются автоматически
        g_world.tick++;

        // Отправляем прогресс каждый день (24 тика), чтобы интерфейс не зависал
        if (g_world.tick > 0 && g_world.tick % 24 == 0) {
            std::string lastNewsText = "";
            if (!g_world.news.empty()) {
                lastNewsText = g_world.news.back().text;
            }

                               // Мы больше не очищаем is_dirty флаги здесь, иначе JS клиент никогда не узнает
                   // о созданных предметах (например, на складах бизнеса) по завершении симуляции.
                   // Флаги накопятся и будут отправлены единым пакетом в конце команды.
                   JsonValue emptyArr = JsonValue::array();
                   reportProgress(g_world.tick, lastNewsText, emptyArr, emptyArr, emptyArr, emptyArr);
        }
    }
}

// ============================================================================
// REAL-TIME SIMULATION & PROTOCOL HANDLER
// ============================================================================

std::atomic<bool> g_realtime_active{false};
std::atomic<int> g_realtime_interval{500};
std::mutex g_main_mutex;
std::thread* g_realtime_thread = nullptr;

void serializeRegistriesGlobal(JsonValue& response, bool full = false) {
    std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
    JsonValue itemsArr = JsonValue::array();
    for (size_t i=0; i<g_items.data.size(); ++i) {
        if (!g_items.active[i]) continue;
        if (full || g_items.data[i].is_dirty) {
            JsonValue pair = JsonValue::array();
            pair.push(JsonValue(g_items.data[i].id));
            pair.push(g_items.data[i].toJson());
            itemsArr.push(pair);
            g_items.data[i].is_dirty = false;
        }
    }
    response.set("items", itemsArr);
    
    JsonValue contArr = JsonValue::array();
    for (size_t i=0; i<g_containers.data.size(); ++i) {
        if (!g_containers.active[i]) continue;
        if (full || g_containers.data[i].is_dirty) {
            JsonValue pair = JsonValue::array();
            pair.push(JsonValue(g_containers.data[i].id));
            pair.push(g_containers.data[i].toJson());
            contArr.push(pair);
            g_containers.data[i].is_dirty = false;
        }
    }
    response.set("containers", contArr);

    if (!full) {
        JsonValue delItems = JsonValue::array();
        for (const auto& id : g_deleted_items) delItems.push(JsonValue(id));
        response.set("deleted_items", delItems);
        
        JsonValue delConts = JsonValue::array();
        for (const auto& id : g_deleted_containers) delConts.push(JsonValue(id));
        response.set("deleted_containers", delConts);
    }
    
    g_deleted_items.clear();
    g_deleted_containers.clear();
}

void realtimeLoop() {
    while (g_realtime_active) {
        {
            std::lock_guard<std::mutex> lock(g_main_mutex);
            if (!g_realtime_active) break;
            
            for (int i = 0; i < 24; i++) {
                hourlyTick();
                g_world.tick++;
            }
            
            JsonValue response = JsonValue::object();
            response.set("status", "realtime_update");
            response.set("tick", g_world.tick);
            response.set("current_day", g_world.current_day);
            
            // Send lightweight status info every tick
            JsonValue t = JsonValue::object();
            t.set("accumulatedMinutes", g_world.time.accumulatedMinutes);
            t.set("internalHour", g_world.time.internalHour);
            response.set("time", t);

            JsonValue h = JsonValue::object();
            h.set("warWeariness", g_world.homeostasis.warWeariness);
            h.set("fertility", g_world.homeostasis.fertility);
            h.set("peaceBoredom", g_world.homeostasis.peaceBoredom);
            response.set("homeostasis", h);
            
            JsonValue eventsArr = JsonValue::array();
            for (const auto& ev : g_world.player_trek.pending_events) {
                eventsArr.push(ev.toJson());
            }
            g_world.player_trek.pending_events.clear();
            response.set("trek_events", eventsArr);

            // FIX: Do NOT serialize entire world every 500ms — that was causing
            // massive CPU spikes and blocking g_main_mutex for seconds.
            // Instead, only send dirty items/containers (delta update).
            // JS client can request full world via getFullState when needed.
            serializeRegistriesGlobal(response, false);
            
            {
                std::lock_guard<std::mutex> outLock(g_output_mutex);
                std::cout << response.toString() << std::endl;
                std::cout.flush();
            }
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(g_realtime_interval.load()));
    }
}

int main() {
#ifdef _WIN32
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCP(CP_UTF8);
#endif
    std::string line;
    
    while (std::getline(std::cin, line)) {
        if (line.empty()) continue;
        
        try {
        JsonValue command = parseJson(line);
        JsonValue response = JsonValue::object();
        
        std::string cmd = command["command"].asString();

        if (cmd == "startRealtime") {
            g_realtime_interval = command.has("interval") ? command["interval"].asInt() : 500;
            if (!g_realtime_active) {
                g_realtime_active = true;
                if (g_realtime_thread) { g_realtime_thread->join(); delete g_realtime_thread; }
                g_realtime_thread = new std::thread(realtimeLoop);
            }
            response.set("status", "ok");
            { std::lock_guard<std::mutex> outLock(g_output_mutex); std::cout << response.toString() << std::endl; std::cout.flush(); }
            continue;
        }
        else if (cmd == "stopRealtime") {
            g_realtime_active = false;
            response.set("status", "ok");
            { std::lock_guard<std::mutex> outLock(g_output_mutex); std::cout << response.toString() << std::endl; std::cout.flush(); }
            continue;
        }

        std::lock_guard<std::mutex> lock(g_main_mutex);
        
        auto serializeRegistries = [&](bool full = false) {
            serializeRegistriesGlobal(response, full);
        };

        if (cmd == "init") {
            g_itemRegistry.loadItemsFromJSON("data/economy_items.json");

            std::string mods_dir = command.has("mods_dir") ? command["mods_dir"].asString() : "mods";
            std::vector<std::string> active_mods;
            if (command.has("active_mods")) {
                for (size_t i = 0; i < command["active_mods"].size(); i++) {
                    active_mods.push_back(command["active_mods"][i].asString());
                }
            }
            g_pluginManager.loadPlugins(mods_dir, active_mods, &g_world, &g_db, &g_itemRegistry, &g_facilityRegistry);
            response.set("status", "ok");
            response.set("message", "Nexus Engine initialized");
            response.set("version", "1.0.0");
        }
        else if (cmd == "registerHooks") {
            g_active_hooks.clear();
            if (command.has("hooks")) {
                JsonValue hooksArr = command["hooks"];
                for (size_t i = 0; i < hooksArr.size(); i++) {
                    g_active_hooks.insert(hooksArr[i].asString());
                }
            }
            response.set("status", "ok");
            response.set("message", "Hooks registered");
        }

        else if (cmd == "loadDatabase") {
            g_db.all_item_ids.clear();
            g_db.items.clear();
            g_db.recipes.clear();
            g_db.facility_names.clear();

            JsonValue items = command["items"];
            for (const auto& [k, v] : items.obj_val) {
                g_db.all_item_ids.push_back(k);
                
                // Populate new Tag-based ItemRegistry
                ItemTemplate tpl;
                tpl.id = k;
                tpl.name = v.has("name") ? v["name"].asString() : k;
                tpl.basePrice = v.has("basePrice") ? v["basePrice"].asDouble() : 1.0;
                if (v.has("tags") && v["tags"].type == JsonValue::ARRAY) {
                    for (size_t i = 0; i < v["tags"].size(); ++i) {
                        tpl.tags.push_back(v["tags"][i].asString());
                    }
                } else if (v.has("category")) {
                    tpl.tags.push_back(v["category"].asString());
                }
                if (v.has("properties") && v["properties"].type == JsonValue::OBJECT) {
                    for (const auto& [prop_key, prop_val] : v["properties"].obj_val) {
                        if (prop_val.type == JsonValue::INT) tpl.properties[prop_key] = (int)prop_val.i_val;
                        else if (prop_val.type == JsonValue::DOUBLE) tpl.properties[prop_key] = prop_val.d_val;
                        else if (prop_val.type == JsonValue::STRING) tpl.properties[prop_key] = prop_val.s_val;
                    }
                }
                g_itemRegistry.addItemTemplate(tpl);

                ItemDef def;
                def.id = k;
                def.basePrice = v.has("basePrice") ? v["basePrice"].asInt() : 1;
                def.category = v.has("category") ? v["category"].asString() : "misc";
                if (v.has("properties")) def.properties = v["properties"];
                
                // Shelf life from JSON data, fallback to 999999 if not specified
                def.shelfLife = v.has("shelfLife") ? v["shelfLife"].asInt() : 999999;

                g_db.items[k] = def;
            }

            // Load data-driven canonical ids and canonical id lists by semantic tag.
            g_db.tag_defaults.clear();
            g_db.tag_default_lists.clear();
            if (command.has("tag_defaults") && command["tag_defaults"].type == JsonValue::OBJECT) {
                for (const auto& [tag, value] : command["tag_defaults"].obj_val) {
                    if (value.type == JsonValue::STRING) {
                        const std::string itemId = value.asString();
                        g_db.tag_defaults[tag] = itemId;

                        if (g_db.items.find(itemId) == g_db.items.end()) {
                            std::cerr << "DATA ERROR: tag_defaults['" << tag << "'] points to missing item id '" << itemId << "'" << std::endl;
                        }
                    } else if (value.type == JsonValue::ARRAY) {
                        std::vector<std::string> ids;
                        for (size_t i = 0; i < value.size(); ++i) {
                            if (value[i].type != JsonValue::STRING) continue;
                            const std::string itemId = value[i].asString();
                            ids.push_back(itemId);

                            if (g_db.items.find(itemId) == g_db.items.end()) {
                                std::cerr << "DATA ERROR: tag_defaults['" << tag << "'] contains missing item id '" << itemId << "'" << std::endl;
                            }
                        }
                        g_db.tag_default_lists[tag] = ids;
                    }
                }
            } else {
                std::cerr << "DATA WARNING: runtime database does not contain required object tag_defaults" << std::endl;
            }

            JsonValue recipes = command["recipes"];
            for (size_t i = 0; i < recipes.size(); i++) {
                RecipeDef r;
                r.facility = recipes[i]["facility"].asString();
                                for (const auto& [k, v] : recipes[i]["inputs"].obj_val) r.inputs[k] = v.asInt();
                for (const auto& [k, v] : recipes[i]["outputs"].obj_val) r.outputs[k] = v.asInt();
                g_db.recipes.push_back(r);
            }

            JsonValue facilities = command["facilities"];
            g_facilityRegistry.clear();
            for (const auto& [k, v] : facilities.obj_val) {
                FacilityTemplate tpl;
                tpl.id = k;
                if (v.has("names")) {
                    for (const auto& [nk, nv] : v["names"].obj_val) tpl.names[nk] = nv.asString();
                } else {
                    const std::string defaultEraId = g_gameplay_runtime.default_era_id.empty() ? std::string("default") : g_gameplay_runtime.default_era_id;
                    tpl.names[defaultEraId] = v.has(defaultEraId) ? v[defaultEraId].asString() : k;
                }
                if (v.has("tags")) {
                    for (size_t i=0; i<v["tags"].size(); ++i) tpl.tags.push_back(v["tags"][i].asString());
                }
                if (v.has("base_maintenance")) tpl.base_maintenance = v["base_maintenance"].asInt();
                if (v.has("max_employees_per_level")) tpl.max_employees_per_level = v["max_employees_per_level"].asInt();
                if (v.has("build_cost")) tpl.build_cost = v["build_cost"].asInt();
                if (v.has("required_tool")) tpl.required_tool = v["required_tool"].asString();
                if (v.has("resource_multiplier_type")) tpl.resource_multiplier_type = v["resource_multiplier_type"].asString();
                if (v.has("extraction_rates")) {
                    for (const auto& [rk, rv] : v["extraction_rates"].obj_val) tpl.extraction_rates[rk] = rv.asDouble();
                }
                if (v.has("race_modifiers")) {
                    for (const auto& [rk, rv] : v["race_modifiers"].obj_val) tpl.race_modifiers[rk] = rv.asDouble();
                }
                if (v.has("weather_modifiers")) {
                    for (const auto& [wk, wv] : v["weather_modifiers"].obj_val) tpl.weather_modifiers[wk] = wv.asDouble();
                }
                g_facilityRegistry.addTemplate(tpl);
            }

            // Parse Biomes
            g_db.biomes.clear();
            g_db.biome_string_to_id.clear();
            g_db.biome_numeric_to_index.clear();
            if (command.has("biomes") && command["biomes"].type == JsonValue::ARRAY) {
                JsonValue biomesArr = command["biomes"];
                for (size_t i = 0; i < biomesArr.size(); i++) {
                    BiomeDef b;
                    b.numeric_id = biomesArr[i].has("numeric_id") ? biomesArr[i]["numeric_id"].asInt() : (uint8_t)i;
                    b.string_id = biomesArr[i].has("id") ? biomesArr[i]["id"].asString() : "";
                    b.name = biomesArr[i].has("name") ? biomesArr[i]["name"].asString() : "";
                    b.movement_cost = biomesArr[i].has("movement_cost") ? biomesArr[i]["movement_cost"].asInt() : 1;
                    b.is_water = biomesArr[i].has("is_water") ? biomesArr[i]["is_water"].asBool() : false;
                    b.is_impassable = biomesArr[i].has("is_impassable") ? biomesArr[i]["is_impassable"].asBool() : false;
                    b.color_hex = biomesArr[i].has("color_hex") ? biomesArr[i]["color_hex"].asString() : "#000000";
                    if (biomesArr[i].has("tags")) {
                        for (size_t j = 0; j < biomesArr[i]["tags"].size(); j++) {
                            b.tags.push_back(biomesArr[i]["tags"][j].asString());
                        }
                    }
                    if (biomesArr[i].has("gen_rules")) {
                        JsonValue rules = biomesArr[i]["gen_rules"];
                        b.min_elevation = rules.has("min_elev") ? rules["min_elev"].asDouble() : -1.0;
                        b.max_elevation = rules.has("max_elev") ? rules["max_elev"].asDouble() : 1.0;
                        b.min_temp = rules.has("min_temp") ? rules["min_temp"].asDouble() : 0.0;
                        b.max_temp = rules.has("max_temp") ? rules["max_temp"].asDouble() : 1.0;
                        b.min_moisture = rules.has("min_moist") ? rules["min_moist"].asDouble() : 0.0;
                        b.max_moisture = rules.has("max_moist") ? rules["max_moist"].asDouble() : 1.0;
                    }
                    g_db.biomes.push_back(b);
                    g_db.biome_string_to_id[b.string_id] = b.numeric_id;
                    g_db.biome_numeric_to_index[b.numeric_id] = g_db.biomes.size() - 1;
                }

            }

            // Parse CityGen
            g_db.city_gen_rules.facility_names.clear();
            g_db.city_gen_rules.road_names.clear();
            g_db.city_gen_rules.square_names.clear();
            if (command.has("city_gen")) {
                JsonValue cg = command["city_gen"];
                if (cg.has("facilities")) {
                    for (const auto& [k, v] : cg["facilities"].obj_val) {
                        std::vector<std::string> names;
                        for (size_t i = 0; i < v.size(); i++) names.push_back(v[i].asString());
                        g_db.city_gen_rules.facility_names[k] = names;
                    }
                }
                if (cg.has("roads")) {
                    for (size_t i = 0; i < cg["roads"].size(); i++) g_db.city_gen_rules.road_names.push_back(cg["roads"][i].asString());
                }
                if (cg.has("squares")) {
                    for (size_t i = 0; i < cg["squares"].size(); i++) g_db.city_gen_rules.square_names.push_back(cg["squares"][i].asString());
                }
            }

            // Parse Monsters
            g_db.monsters.clear();
            if (command.has("monsters") && command["monsters"].type == JsonValue::ARRAY) {
                JsonValue monsArr = command["monsters"];
                for (size_t i = 0; i < monsArr.size(); i++) {
                    MonsterDef m;
                    m.string_id = monsArr[i].has("id") ? monsArr[i]["id"].asString() : "";
                    m.name = monsArr[i].has("name") ? monsArr[i]["name"].asString() : "";
                    m.base_hp = monsArr[i].has("base_hp") ? monsArr[i]["base_hp"].asInt() : 100;
                    m.base_attack = monsArr[i].has("base_attack") ? monsArr[i]["base_attack"].asInt() : 10;
                    m.base_defense = monsArr[i].has("base_defense") ? monsArr[i]["base_defense"].asInt() : 10;
                    m.spawn_biome_tag = monsArr[i].has("spawn_biome_tag") ? monsArr[i]["spawn_biome_tag"].asString() : "";
                    m.corrupt_biome_to = monsArr[i].has("corrupt_biome_to") ? monsArr[i]["corrupt_biome_to"].asString() : "ash";
                    m.loot_table_id = monsArr[i].has("loot_table_id") ? monsArr[i]["loot_table_id"].asString() : "";
                    g_db.monsters[m.string_id] = m;
                }
            }

            // Parse Disasters
            g_db.disasters.clear();
            if (command.has("disasters") && command["disasters"].type == JsonValue::ARRAY) {
                JsonValue disArr = command["disasters"];
                for (size_t i = 0; i < disArr.size(); i++) {
                    DisasterDef d;
                    d.string_id = disArr[i].has("id") ? disArr[i]["id"].asString() : "";
                    d.name = disArr[i].has("name") ? disArr[i]["name"].asString() : "";
                    d.base_radius = disArr[i].has("base_radius") ? disArr[i]["base_radius"].asInt() : 5;
                    d.base_duration_days = disArr[i].has("base_duration_days") ? disArr[i]["base_duration_days"].asInt() : 1;
                    d.population_damage_percent = disArr[i].has("population_damage_percent") ? disArr[i]["population_damage_percent"].asInt() : 10;
                    d.facility_damage = disArr[i].has("facility_damage") ? disArr[i]["facility_damage"].asInt() : 25;
                                if (disArr[i].has("allowed_climates")) {
                for (size_t j = 0; j < disArr[i]["allowed_climates"].size(); j++) {
                    d.allowed_climates.push_back(disArr[i]["allowed_climates"][j].asString());
                }
            }
            if (disArr[i].has("floods_tiles")) d.floods_tiles = disArr[i]["floods_tiles"].asBool();
            if (disArr[i].has("ruins_roads")) d.ruins_roads = disArr[i]["ruins_roads"].asBool();
            if (disArr[i].has("stability_penalty")) d.stability_penalty = disArr[i]["stability_penalty"].asInt();
            if (disArr[i].has("threat_set")) d.threat_set = disArr[i]["threat_set"].asInt();
            if (disArr[i].has("fertility_mult")) d.fertility_mult = disArr[i]["fertility_mult"].asDouble();
            if (disArr[i].has("transform_biome_to")) d.transform_biome_to = disArr[i]["transform_biome_to"].asString();
            if (disArr[i].has("affected_biomes")) {
                for (size_t j = 0; j < disArr[i]["affected_biomes"].size(); j++) {
                    d.affected_biomes.push_back(disArr[i]["affected_biomes"][j].asString());
                }
            }
            if (disArr[i].has("spawn_item")) d.spawn_item = disArr[i]["spawn_item"].asString();
            if (disArr[i].has("spawn_item_qty")) d.spawn_item_qty = disArr[i]["spawn_item_qty"].asInt();
            g_db.disasters[d.string_id] = d;
                }
            }

            // Parse Races
            g_db.races.clear();
            g_db.race_ids.clear();
            if (command.has("races") && command["races"].type == JsonValue::ARRAY) {
                JsonValue racesArr = command["races"];
                for (size_t i = 0; i < racesArr.size(); i++) {
                    RaceDef r;
                    r.string_id = racesArr[i].has("id") ? racesArr[i]["id"].asString() : "";
                    r.name = racesArr[i].has("name") ? racesArr[i]["name"].asString() : r.string_id;
                    r.base_race = racesArr[i].has("base_race") ? racesArr[i]["base_race"].asBool() : false;
                    if (racesArr[i].has("faction_preference") && racesArr[i]["faction_preference"].type == JsonValue::ARRAY) {
                        for (size_t j = 0; j < racesArr[i]["faction_preference"].size(); j++)
                            r.faction_preference.push_back(racesArr[i]["faction_preference"][j].asString());
                    }
                    r.biome_preference = racesArr[i].has("biome_preference") ? racesArr[i]["biome_preference"].asString() : "";
                    if (racesArr[i].has("stat_modifiers") && racesArr[i]["stat_modifiers"].type == JsonValue::OBJECT) {
                        for (const auto& [sk, sv] : racesArr[i]["stat_modifiers"].obj_val)
                            r.stat_modifiers[sk] = sv.asInt();
                    }
                    if (racesArr[i].has("class_stats") && racesArr[i]["class_stats"].type == JsonValue::OBJECT) {
                        for (const auto& [ck, cv] : racesArr[i]["class_stats"].obj_val) {
                            std::unordered_map<std::string, int> classMap;
                            if (cv.type == JsonValue::OBJECT) {
                                for (const auto& [sk, sv] : cv.obj_val) classMap[sk] = sv.asInt();
                            }
                            r.class_stats[ck] = classMap;
                        }
                    }
                    g_db.races[r.string_id] = r;
                    g_db.race_ids.push_back(r.string_id);
                }
            }

            // Parse Professions
            g_db.professions.clear();
            g_db.profession_ids.clear();
            if (command.has("professions") && command["professions"].type == JsonValue::ARRAY) {
                JsonValue profArr = command["professions"];
                for (size_t i = 0; i < profArr.size(); i++) {
                    ProfessionDef p;
                    p.string_id = profArr[i].has("id") ? profArr[i]["id"].asString() : "";
                    p.name = profArr[i].has("name") ? profArr[i]["name"].asString() : p.string_id;
                    p.profession_type = profArr[i].has("profession_type") ? profArr[i]["profession_type"].asString() : "farmer";
                    p.tool_tag = profArr[i].has("tool_tag") ? profArr[i]["tool_tag"].asString() : "";
                    p.tool_chance = profArr[i].has("tool_chance") ? profArr[i]["tool_chance"].asInt() : 0;
                    p.production_type = profArr[i].has("production_type") ? profArr[i]["production_type"].asString() : "";
                    p.job_multiplier = profArr[i].has("job_multiplier") ? (float)profArr[i]["job_multiplier"].asDouble() : 1.0f;
                    p.preferred_facility = profArr[i].has("preferred_facility") ? profArr[i]["preferred_facility"].asString() : "";
                    p.display_name_i18n_key = profArr[i].has("display_name_i18n_key") ? profArr[i]["display_name_i18n_key"].asString() : "";
                    if (profArr[i].has("special_abilities") && profArr[i]["special_abilities"].type == JsonValue::ARRAY) {
                        const JsonValue& sa = profArr[i]["special_abilities"];
                        for (size_t j = 0; j < sa.size(); j++) p.special_abilities.push_back(sa[j].asString());
                    }
                    if (profArr[i].has("demand_pattern") && profArr[i]["demand_pattern"].type == JsonValue::OBJECT) {
                        for (const auto& [dk, dv] : profArr[i]["demand_pattern"].obj_val)
                            p.demand_pattern[dk] = (float)dv.asDouble();
                    }
                    g_db.professions[p.string_id] = p;
                    g_db.profession_ids.push_back(p.string_id);
                }
            }

            // Parse Traits
            g_db.traits.clear();
            g_db.trait_ids.clear();
            if (command.has("traits") && command["traits"].type == JsonValue::ARRAY) {
                JsonValue traitArr = command["traits"];
                for (size_t i = 0; i < traitArr.size(); i++) {
                    TraitDef t;
                    t.string_id = traitArr[i].has("id") ? traitArr[i]["id"].asString() : "";
                    t.name = traitArr[i].has("name") ? traitArr[i]["name"].asString() : t.string_id;
                    if (traitArr[i].has("personality_bias") && traitArr[i]["personality_bias"].type == JsonValue::OBJECT) {
                        for (const auto& [pk, pv] : traitArr[i]["personality_bias"].obj_val)
                            t.personality_bias[pk] = pv.asInt();
                    }
                    g_db.traits[t.string_id] = t;
                    g_db.trait_ids.push_back(t.string_id);
                }
            }

            // Parse NPC Names
            g_db.name_groups.clear();
            g_db.faction_to_race.clear();
            g_db.backgrounds.clear();
            if (command.has("npc_names") && command["npc_names"].type == JsonValue::OBJECT) {
                JsonValue nn = command["npc_names"];
                if (nn.has("races") && nn["races"].type == JsonValue::OBJECT) {
                    for (const auto& [rk, rv] : nn["races"].obj_val) {
                        NameGroupDef ng;
                        if (rv.has("first_names") && rv["first_names"].type == JsonValue::ARRAY) {
                            for (size_t i = 0; i < rv["first_names"].size(); i++)
                                ng.first_names.push_back(rv["first_names"][i].asString());
                        }
                        if (rv.has("last_names") && rv["last_names"].type == JsonValue::ARRAY) {
                            for (size_t i = 0; i < rv["last_names"].size(); i++)
                                ng.last_names.push_back(rv["last_names"][i].asString());
                        }
                        g_db.name_groups[rk] = ng;
                    }
                }
                if (nn.has("faction_to_race") && nn["faction_to_race"].type == JsonValue::OBJECT) {
                    for (const auto& [fk, fv] : nn["faction_to_race"].obj_val)
                        g_db.faction_to_race[fk] = fv.asString();
                }
                if (nn.has("backgrounds") && nn["backgrounds"].type == JsonValue::OBJECT) {
                    for (const auto& [bk, bv] : nn["backgrounds"].obj_val) {
                        std::vector<std::string> bgs;
                        if (bv.type == JsonValue::ARRAY) {
                            for (size_t i = 0; i < bv.size(); i++) bgs.push_back(bv[i].asString());
                        }
                        g_db.backgrounds[bk] = bgs;
                    }
                }
            }

            // Parse Faction Relations
            g_db.faction_relations = FactionRelationsDef();
            if (command.has("faction_relations") && command["faction_relations"].type == JsonValue::OBJECT) {
                JsonValue fr = command["faction_relations"];
                if (fr.has("faction_biome_preference") && fr["faction_biome_preference"].type == JsonValue::OBJECT) {
                    for (const auto& [fk, fv] : fr["faction_biome_preference"].obj_val)
                        g_db.faction_relations.faction_biome_preference[fk] = fv.asString();
                }
                if (fr.has("faction_corrupt_biome") && fr["faction_corrupt_biome"].type == JsonValue::OBJECT) {
                    for (const auto& [fk, fv] : fr["faction_corrupt_biome"].obj_val)
                        g_db.faction_relations.faction_corrupt_biome[fk] = fv.asString();
                }
                if (fr.has("faction_base_relations") && fr["faction_base_relations"].type == JsonValue::OBJECT) {
                    for (const auto& [eraKey, eraVal] : fr["faction_base_relations"].obj_val) {
                        std::vector<FactionRelationRule> rules;
                        if (eraVal.type == JsonValue::ARRAY) {
                            for (size_t i = 0; i < eraVal.size(); i++) {
                                FactionRelationRule rule;
                                rule.f1 = eraVal[i].has("f1") ? eraVal[i]["f1"].asString() : "";
                                rule.f2 = eraVal[i].has("f2") ? eraVal[i]["f2"].asString() : "";
                                rule.modifier = eraVal[i].has("modifier") ? eraVal[i]["modifier"].asInt() : 0;
                                rules.push_back(rule);
                            }
                        }
                        g_db.faction_relations.era_relations[eraKey] = rules;
                    }
                }
            }

            // Parse World Config
            if (command.has("world_config") && command["world_config"].type == JsonValue::OBJECT) {
                JsonValue wc = command["world_config"];
                if (wc.has("map_width")) g_db.world_config.map_width = wc["map_width"].asInt();
                if (wc.has("map_height")) g_db.world_config.map_height = wc["map_height"].asInt();
                if (wc.has("landform")) g_db.world_config.landform = wc["landform"].asString();
                if (wc.has("continent") && wc["continent"].type == JsonValue::OBJECT) {
                    JsonValue cc = wc["continent"];
                    if (cc.has("noise_frequency")) g_db.world_config.continent.noise_frequency = cc["noise_frequency"].asDouble();
                    if (cc.has("noise_octaves")) g_db.world_config.continent.noise_octaves = cc["noise_octaves"].asInt();
                    if (cc.has("elevation_shift")) g_db.world_config.continent.elevation_shift = cc["elevation_shift"].asDouble();
                    if (cc.has("edge_falloff_power")) g_db.world_config.continent.edge_falloff_power = cc["edge_falloff_power"].asDouble();
                    if (cc.has("edge_falloff_range")) g_db.world_config.continent.edge_falloff_range = cc["edge_falloff_range"].asDouble();
                    if (cc.has("edge_ocean_elevation")) g_db.world_config.continent.edge_ocean_elevation = cc["edge_ocean_elevation"].asDouble();
                    if (cc.has("min_land_ratio")) g_db.world_config.continent.min_land_ratio = cc["min_land_ratio"].asDouble();
                    if (cc.has("connectivity_pass")) g_db.world_config.continent.connectivity_pass = cc["connectivity_pass"].asBool();
                    if (cc.has("land_bridge_max_gap")) g_db.world_config.continent.land_bridge_max_gap = cc["land_bridge_max_gap"].asInt();
                    if (cc.has("remove_islands_under")) g_db.world_config.continent.remove_islands_under = cc["remove_islands_under"].asInt();
                    if (cc.has("smoothing_passes")) g_db.world_config.continent.smoothing_passes = cc["smoothing_passes"].asInt();
                }
                // Data-driven: legacy biome numeric ID list for save migration
                if (wc.has("biomes_legacy_numeric_ids") && wc["biomes_legacy_numeric_ids"].type == JsonValue::ARRAY) {
                    g_db.biome_legacy_numeric_ids.clear();
                    const JsonValue& bArr = wc["biomes_legacy_numeric_ids"];
                    for (size_t i = 0; i < bArr.size(); i++) g_db.biome_legacy_numeric_ids.push_back(bArr[i].asString());
                }
                if (wc.has("rivers") && wc["rivers"].type == JsonValue::OBJECT) {
                    JsonValue rc = wc["rivers"];
                    if (rc.has("noise_frequency")) g_db.world_config.rivers.noise_frequency = rc["noise_frequency"].asDouble();
                    if (rc.has("noise_octaves")) g_db.world_config.rivers.noise_octaves = rc["noise_octaves"].asInt();
                    if (rc.has("threshold_default")) g_db.world_config.rivers.threshold_default = rc["threshold_default"].asDouble();
                    if (rc.has("threshold_plains")) g_db.world_config.rivers.threshold_plains = rc["threshold_plains"].asDouble();
                    if (rc.has("threshold_mountains")) g_db.world_config.rivers.threshold_mountains = rc["threshold_mountains"].asDouble();
                }
                if (wc.has("volcanoes") && wc["volcanoes"].type == JsonValue::OBJECT) {
                    JsonValue vc = wc["volcanoes"];
                    if (vc.has("count")) g_db.world_config.volcanoes.count = vc["count"].asInt();
                    if (vc.has("min_radius")) g_db.world_config.volcanoes.min_radius = vc["min_radius"].asInt();
                    if (vc.has("max_radius")) g_db.world_config.volcanoes.max_radius = vc["max_radius"].asInt();
                }
            }

            loadGameplayRuntimeConfig(
                command.has("gameplay_runtime") ? command["gameplay_runtime"] : JsonValue::object()
            );
            loadContainerTypeRuntimeConfig(
                command.has("container_types") ? command["container_types"] : JsonValue::object()
            );
            loadTransportRuntimeConfig(
                command.has("transport_registry") ? command["transport_registry"] : JsonValue::object()
            );
            loadTrekRuntimeConfig(
                command.has("trek_config") ? command["trek_config"] : JsonValue::object()
            );
            loadShipTypeRuntimeConfig(
                command.has("ship_types") ? command["ship_types"] : JsonValue::array()
            );

            response.set("status", "ok");
            response.set("message", "Database loaded");
        }
        else if (cmd == "buildWorld") {
            std::string playerId = command["player_id"].asString();
            std::string era = command.has("era") ? command["era"].asString() : g_gameplay_runtime.default_era_id;
            int initialAgents = command.has("initial_agents") ? command["initial_agents"].asInt() : 100;
            JsonValue globalLocs = command.has("global_locations") ? command["global_locations"] : JsonValue::object();
            int startDay = command.has("start_day") ? command["start_day"].asInt() : 0;
            
            buildWorld(playerId, era, initialAgents, globalLocs, startDay);
            
            response.set("status", "ok");
            response.set("tick", g_world.tick);
                        JsonValue eventsArr = JsonValue::array();
            for (const auto& ev : g_world.player_trek.pending_events) {
                eventsArr.push(ev.toJson());
            }
            g_world.player_trek.pending_events.clear();
            response.set("trek_events", eventsArr);

response.set("world", g_world.toJson());
            response.set("relevant_news", g_world.getRelevantNewsJson(command.has("player_location") ? command["player_location"].asString() : "", 20));
            serializeRegistries(true);
        }
        else if (cmd == "bootstrapWorld") {
            int days = command.has("days") ? command["days"].asInt() : 45;
            int startDay = command.has("start_day") ? command["start_day"].asInt() : 0;
            bootstrapWorld(days, startDay);
            response.set("status", "ok");
            response.set("message", "Bootstrap completed");
            response.set("world", g_world.toJson());
            response.set("relevant_news", g_world.getRelevantNewsJson(command.has("player_location") ? command["player_location"].asString() : "", 20));
            serializeRegistries(true);
        }
        else if (cmd == "syncState") {
            if (command.has("world")) g_world = World::fromJson(command["world"]);
            if (command.has("items")) {
                g_items.clear();
                for (size_t i=0; i<command["items"].size(); i++) {
                    PhysicalItem item = PhysicalItem::fromJson(command["items"][i][1]);
                    item.is_dirty = false;
                    g_items[command["items"][i][0].asString()] = item;
                }
            }
            if (command.has("containers")) {
                g_containers.clear();
                for (size_t i=0; i<command["containers"].size(); i++) {
                    Storage cont = Storage::fromJson(command["containers"][i][1]);
                    cont.is_dirty = false;
                    g_containers[command["containers"][i][0].asString()] = cont;
                }
            }
            rebuildContainerIndices();
            g_deleted_items.clear();
            g_deleted_containers.clear();
            response.set("status", "ok");
        }
        else if (cmd == "loadWorldFile") {
            // Load world state from a file instead of stdin pipe.
            // This avoids the 64KB pipe buffer limit for large world JSON (1.5MB+).
            std::string filePath = command.has("path") ? command["path"].asString() : "";
            if (filePath.empty()) {
                response.set("status", "error");
                response.set("message", "Missing 'path' parameter");
            } else {
                try {
                    std::ifstream f(filePath);
                    if (!f.is_open()) {
                        response.set("status", "error");
                        response.set("message", "Cannot open file: " + filePath);
                    } else {
                        nlohmann::json worldJson;
                        f >> worldJson;

                        // Файл может быть в двух форматах:
                        // 1) Обёрнутый: { "world": {...}, "items": [...], "containers": [...] }
                        //    (от nexusWriteSyncFile)
                        // 2) Плоский: { "tick": ..., "regions": {...}, "map": {...}, ... }
                        //    (от прямого экспорта World.toJson)
                        nlohmann::json worldData;
                        if (worldJson.contains("world") && worldJson["world"].is_object()) {
                            worldData = worldJson["world"];
                        } else {
                            worldData = worldJson;
                        }

                        g_world = World::fromJson(JsonValue(worldData));

                        // Optionally load items and containers from separate keys
                        if (worldJson.contains("items") && worldJson["items"].is_array()) {
                            g_items.clear();
                            for (size_t i = 0; i < worldJson["items"].size(); i++) {
                                PhysicalItem item = PhysicalItem::fromJson(JsonValue(worldJson["items"][i][1]));
                                item.is_dirty = false;
                                g_items[worldJson["items"][i][0].get<std::string>()] = item;
                            }
                        }
                        if (worldJson.contains("containers") && worldJson["containers"].is_array()) {
                            g_containers.clear();
                            for (size_t i = 0; i < worldJson["containers"].size(); i++) {
                                Storage cont = Storage::fromJson(JsonValue(worldJson["containers"][i][1]));
                                cont.is_dirty = false;
                                g_containers[worldJson["containers"][i][0].get<std::string>()] = cont;
                            }
                        }
                        rebuildContainerIndices();
                        g_deleted_items.clear();
                        g_deleted_containers.clear();

                        response.set("status", "ok");
                        response.set("message", "World loaded from file: " + filePath);
                    }
                } catch (const std::exception& e) {
                    response.set("status", "error");
                    response.set("message", std::string("Failed to parse world file: ") + e.what());
                } catch (...) {
                    response.set("status", "error");
                    response.set("message", "Unknown error parsing world file");
                }
            }
        }
        else if (cmd == "getFullState") {
            response.set("status", "ok");
                        JsonValue eventsArr = JsonValue::array();
            for (const auto& ev : g_world.player_trek.pending_events) {
                eventsArr.push(ev.toJson());
            }
            g_world.player_trek.pending_events.clear();
            response.set("trek_events", eventsArr);

response.set("world", g_world.toJson());
            response.set("relevant_news", g_world.getRelevantNewsJson(command.has("player_location") ? command["player_location"].asString() : "", 20));
            serializeRegistries(true);
        }
        else if (cmd == "bootstrapWorld") {
            int days = command.has("days") ? command["days"].asInt() : 45;
            int startDay = command.has("start_day") ? command["start_day"].asInt() : 0;
            bootstrapWorld(days, startDay);
            response.set("status", "ok");
            response.set("message", "Bootstrap completed");
            response.set("world", g_world.toJson());
            response.set("relevant_news", g_world.getRelevantNewsJson(command.has("player_location") ? command["player_location"].asString() : "", 20));
            serializeRegistries(true);
        }
        else if (cmd == "gmIntervention") {
            std::string feedback = processGmIntervention(command["args"]);
            response.set("status", "ok");
            response.set("feedback", feedback);
                        JsonValue eventsArr = JsonValue::array();
            for (const auto& ev : g_world.player_trek.pending_events) {
                eventsArr.push(ev.toJson());
            }
            g_world.player_trek.pending_events.clear();
            response.set("trek_events", eventsArr);

response.set("world", g_world.toJson());
            response.set("relevant_news", g_world.getRelevantNewsJson(command.has("player_location") ? command["player_location"].asString() : "", 20));
            serializeRegistries(false);
        }
                        else if (cmd == "inventoryCommand") {
            std::string action = command["action"].asString();
            JsonValue args = command["args"];
            std::string feedback = "";
            bool success = false;

            if (action == "createContainer") {
                std::string type = args["type"].asString();
                std::string ownerId = args.has("ownerId") ? args["ownerId"].asString() : "";
                int maxWeight = args.has("maxWeight") ? args["maxWeight"].asInt() : 0;
                int maxSlots = args.has("maxSlots") ? args["maxSlots"].asInt() : 0;
                std::string regionId = args.has("location") && args["location"].has("region_id") ? args["location"]["region_id"].asString() : "";
                
                std::string contId = createContainer(type, ownerId, maxWeight, maxSlots, regionId);
                
                std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
                if (args.has("lock_data")) g_containers[contId].lock_data = args["lock_data"];
                if (args.has("physical_props")) g_containers[contId].physical_props = args["physical_props"];
                if (args.has("custom_props")) g_containers[contId].custom_props = args["custom_props"];
                if (args.has("location")) g_containers[contId].location = args["location"];
                
                response.set("containerId", contId);
                success = true;
            }
            else if (action == "createItem") {
                std::string rawProto = args["prototypeId"].asString();
                                std::string proto = rawProto;
                int qty = args["quantity"].asInt();
                std::string contId = args["containerId"].asString();
                
                std::string itemId = createItem(proto, qty, contId, g_world.current_day, locStr("engine.reason.created"));
                
                std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
                g_items[itemId].raw_prototype_id = rawProto;
                if (args.has("customProps")) {
                    PhysicalItem& item = g_items[itemId];
                    for (const auto& kv : args["customProps"].obj_val) {
                        item.custom_props.set(kv.first, kv.second);
                    }
                    if (args["customProps"].has("slot_index")) item.slot_index = args["customProps"]["slot_index"].asString();
                    if (args["customProps"].has("state")) item.state = args["customProps"]["state"].asString();
                    if (args["customProps"].has("flags")) {
                        item.quest_item = args["customProps"]["flags"].has("quest_item") ? args["customProps"]["flags"]["quest_item"].asBool() : false;
                        item.bound = args["customProps"]["flags"].has("bound") ? args["customProps"]["flags"]["bound"].asBool() : false;
                        item.stolen = args["customProps"]["flags"].has("stolen") ? args["customProps"]["flags"]["stolen"].asBool() : false;
                        item.magical = args["customProps"]["flags"].has("magical") ? args["customProps"]["flags"]["magical"].asBool() : false;
                    }
                    item.is_dirty = true;
                }
                response.set("itemId", itemId);
                success = true;
            }
            else if (action == "removeItem") {
                std::string itemId = args["itemId"].asString();
                int qty = args["quantity"].asInt();
                success = removeItem(itemId, qty);
            }
            else if (action == "moveItem") {
                std::string itemId = args["itemId"].asString();
                std::string targetContId = args["targetContainerId"].asString();
                int qty = args.has("quantity") ? args["quantity"].asInt() : -1;
                
                std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
                if (g_items.count(itemId) && g_containers.count(targetContId)) {
                    PhysicalItem& item = g_items[itemId];
                    if (qty != -1 && qty < item.stack_size) {
                        item.stack_size -= qty;
                        item.is_dirty = true;
                        if (!item.container_id.empty() && g_containers.count(item.container_id)) {
                            g_containers[item.container_id].cached_stocks[item.prototype_id] -= qty;
                            g_containers[item.container_id].is_dirty = true;
                        }
                        
                        std::string newItemId = createItem(item.prototype_id, qty, targetContId, g_world.current_day, locStr("engine.reason.stack_split"));
                        PhysicalItem& newItem = g_items[newItemId];
                        newItem.custom_props = item.custom_props;
                        newItem.quest_item = item.quest_item;
                        newItem.bound = item.bound;
                        newItem.stolen = item.stolen;
                        newItem.magical = item.magical;
                        newItem.durability = item.durability;
                        newItem.state = item.state;
                        
                        response.set("movedItemId", newItemId);
                    } else {
                        moveItem(itemId, targetContId);
                        response.set("movedItemId", itemId);
                    }
                    success = true;
                } else {
                    feedback = locStr("engine.gm.item_not_found");
                }
            }
            else if (action == "moveItems") {
                std::string sourceContId = args["sourceContainerId"].asString();
                std::string targetContId = args["targetContainerId"].asString();
                JsonValue itemsArr = args["items"];
                
                std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
                if (g_containers.count(sourceContId) && g_containers.count(targetContId)) {
                    for (size_t i = 0; i < itemsArr.size(); i++) {
                        std::string itemId = itemsArr[i]["id"].asString();
                        int qty = itemsArr[i].has("quantity") ? itemsArr[i]["quantity"].asInt() : -1;
                        
                        if (g_items.count(itemId)) {
                            PhysicalItem& item = g_items[itemId];
                            if (qty != -1 && qty < item.stack_size) {
                                item.stack_size -= qty;
                                item.is_dirty = true;
                                if (!item.container_id.empty() && g_containers.count(item.container_id)) {
                                    g_containers[item.container_id].cached_stocks[item.prototype_id] -= qty;
                                    g_containers[item.container_id].is_dirty = true;
                                }
                                
                                std::string newItemId = createItem(item.prototype_id, qty, targetContId, g_world.current_day, locStr("engine.reason.batch_split"));
                                PhysicalItem& newItem = g_items[newItemId];
                                newItem.custom_props = item.custom_props;
                                newItem.quest_item = item.quest_item;
                                newItem.bound = item.bound;
                                newItem.stolen = item.stolen;
                                newItem.magical = item.magical;
                                newItem.durability = item.durability;
                                newItem.state = item.state;
                            } else {
                                moveItem(itemId, targetContId);
                            }
                        }
                    }
                    success = true;
                }
            }
            else if (action == "equipItem") {
                std::string itemId = args["itemId"].asString();
                std::string targetSlot = args["slot"].asString();
                std::string eqContId = args["equipmentContainerId"].asString();
                std::string bpContId = args["backpackContainerId"].asString();
                
                std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
                if (g_items.count(itemId) && g_containers.count(eqContId)) {
                    Storage& eqCont = g_containers[eqContId];
                    std::string existingItemId = "";
                    for (const auto& id : eqCont.item_ids) {
                        if (g_items.count(id) && g_items[id].slot_index == targetSlot) {
                            existingItemId = id;
                            break;
                        }
                    }
                    
                    if (!existingItemId.empty()) {
                        moveItem(existingItemId, bpContId);
                        g_items[existingItemId].slot_index = "";
                        g_items[existingItemId].state = "idle";
                        g_items[existingItemId].is_dirty = true;
                    }
                    
                    moveItem(itemId, eqContId);
                    g_items[itemId].slot_index = targetSlot;
                    g_items[itemId].state = "equipped";
                    g_items[itemId].is_dirty = true;
                    success = true;
                } else {
                    feedback = locStr("engine.gm.equip_error");
                }
            }
            else if (action == "unequipItem") {
                std::string slot = args["slot"].asString();
                std::string eqContId = args["equipmentContainerId"].asString();
                std::string bpContId = args["backpackContainerId"].asString();
                
                std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
                if (g_containers.count(eqContId) && g_containers.count(bpContId)) {
                    Storage& eqCont = g_containers[eqContId];
                    std::string itemId = "";
                    for (const auto& id : eqCont.item_ids) {
                        if (g_items.count(id) && g_items[id].slot_index == slot) {
                            itemId = id;
                            break;
                        }
                    }
                    
                    if (!itemId.empty()) {
                        moveItem(itemId, bpContId);
                        g_items[itemId].slot_index = "";
                        g_items[itemId].state = "idle";
                        g_items[itemId].is_dirty = true;
                        success = true;
                    } else {
                        feedback = locStr("engine.gm.slot_empty");
                    }
                } else {
                    feedback = locStr("engine.gm.containers_not_found");
                }
            }
            else if (action == "destroyContainer") {
                std::string contId = args["containerId"].asString();
                std::string groundContId = args["groundContainerId"].asString();
                
                std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
                if (g_containers.count(contId)) {
                    Storage& cont = g_containers[contId];
                    std::vector<std::string> itemsToMove = cont.item_ids;
                    for (const auto& itemId : itemsToMove) {
                        moveItem(itemId, groundContId);
                    }
                    g_deleted_containers.push_back(contId);
                    g_containers.erase(contId);
                    success = true;
                }
            }
            else if (action == "updateContainerLocation") {
                std::string contId = args["containerId"].asString();
                std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
                if (g_containers.count(contId)) {
                    g_containers[contId].location = args["location"];
                    g_containers[contId].is_dirty = true;
                    success = true;
                } else {
                    feedback = locStr("engine.gm.container_not_found");
                }
            }

            else if (action == "syncEntity") {
                std::string id = args["id"].asString();
                bool exists = g_world.npcs.count(id);
                NPC& npc = g_world.npcs[id];
                
                if (!exists) {
                    npc.id = id;
                    npc.name = args["name"].asString();
                    npc.type = args["type"].asString();
                    npc.hp = args["hp"].asInt();
                    npc.maxHp = args["maxHp"].asInt();
                    npc.str = args["str"].asInt();
                    npc.dex = args["dex"].asInt();
                    npc.con = args["con"].asInt();
                    npc.int_ = args["int"].asInt();
                    npc.isHostile = args["isHostile"].asBool();
                    npc.xpReward = args["xpReward"].asInt();
                    npc.min_damage = args["min_damage"].asInt();
                    npc.max_damage = args["max_damage"].asInt();
                    npc.armor_class = args["armor_class"].asInt();
                    npc.isAlive = (npc.hp > 0);
                } else {
                    // Защита симуляции: обновляем только враждебность, не трогаем лорные статы и тип
                    npc.isHostile = args["isHostile"].asBool();
                }
                success = true;
            }
            else if (action == "updateEntityStat") {
                std::string id = args["id"].asString();
                std::string stat = args["stat"].asString();
                int val = args["value"].asInt();
                if (g_world.npcs.count(id)) {
                    NPC& npc = g_world.npcs[id];
                    if (stat == "hp") { npc.hp = val; npc.isAlive = (val > 0); }
                    else if (stat == "maxHp") npc.maxHp = val;
                    else if (stat == "str") npc.str = val;
                    else if (stat == "dex") npc.dex = val;
                    else if (stat == "con") npc.con = val;
                    else if (stat == "int") npc.int_ = val;
                    success = true;
                }
            }
            else if (action == "updateItemStat") {
                std::string itemId = args["itemId"].asString();
                std::string stat = args["stat"].asString();
                int change = args["change"].asInt();
                
                std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
                if (g_items.count(itemId)) {
                    PhysicalItem& item = g_items[itemId];
                    if (stat == "durability") {
                        item.durability += change;
                        item.is_dirty = true;
                        success = true;
                    } else if (stat == "stack_size") {
                        item.stack_size += change;
                        item.is_dirty = true;
                        if (!item.container_id.empty() && g_containers.count(item.container_id)) {
                            g_containers[item.container_id].cached_stocks[item.prototype_id] += change;
                            g_containers[item.container_id].is_dirty = true;
                        }
                        success = true;
                    }
                }
            }
            else if (action == "resolveEnemyAttacks") {
                int player_def = args["player_def"].asInt();
                JsonValue enemies = args["enemies"];
                int total_damage = 0;
                JsonValue logArr = JsonValue::array();

                for (size_t i = 0; i < enemies.size(); i++) {
                    std::string eId = enemies[i].asString();
                    if (!g_world.npcs.count(eId)) continue;
                    NPC& npc = g_world.npcs[eId];
                    
                    int attack_mod = std::max((npc.str - 10) / 2, (npc.dex - 10) / 2);
                    int roll = (thread_safe_rand() % 20) + 1;
                    int total_attack = roll + attack_mod;

                    if (roll == 20 || total_attack >= player_def) {
                        int dmg = npc.min_damage;
                        if (npc.max_damage > npc.min_damage) {
                            dmg += (thread_safe_rand() % (npc.max_damage - npc.min_damage + 1));
                        }
                        dmg += attack_mod;
                        dmg = std::max(1, dmg);
                        if (roll == 20) dmg *= 2;
                        
                        total_damage += dmg;
                        std::string msg = npc.name + " атакует: бросок " + std::to_string(roll) + " + " + std::to_string(attack_mod) + " = " + std::to_string(total_attack) + " vs AC " + std::to_string(player_def) + ". ПОПАДАНИЕ! Урон: " + std::to_string(dmg) + " (Базовый: " + std::to_string(npc.min_damage) + "-" + std::to_string(npc.max_damage) + ")";
                        logArr.push(JsonValue(msg));
                    } else {
                        std::string msg = npc.name + " атакует: бросок " + std::to_string(roll) + " + " + std::to_string(attack_mod) + " = " + std::to_string(total_attack) + " vs AC " + std::to_string(player_def) + ". ПРОМАХ.";
                        logArr.push(JsonValue(msg));
                    }
                }
                response.set("total_damage", total_damage);
                response.set("combat_log", logArr);
                success = true;
            }

            response.set("status", "ok");
            response.set("success", success);
            if (!feedback.empty()) response.set("feedback", feedback);
            serializeRegistries(false);
        }

        else if (cmd == "transportCommand") {
            std::string action = command["action"].asString();
            JsonValue args = command["args"];
            std::string feedback = "";
            bool success = false;

            if (action == "mount") {
                std::string itemId = args["itemId"].asString();
                std::string backpackContainerId = args["backpackContainerId"].asString();

                std::lock_guard<std::recursive_mutex> lock(g_registry_mutex);
                if (!g_items.count(itemId)) {
                    feedback = "Item not found";
                } else {
                    PhysicalItem& item = g_items[itemId];

                    if (item.container_id != backpackContainerId) {
                        feedback = "Item not in player backpack";
                    } else {
                        std::string transport_type = "none";
                        double speed_mult = 1.0;
                        int cargo_bonus = 0;
                        bool water_only = false;

                        if (!resolveTransportFromItemData(item.prototype_id, transport_type, speed_mult, cargo_bonus, water_only)) {
                            feedback = "Item is not a transport";
                        }

                        if (transport_type != "none") {
                            g_world.player_trek.active_transport_id = itemId;
                            g_world.player_trek.transport_type = transport_type;
                            g_world.player_trek.transport_speed_mult = speed_mult;
                            g_world.player_trek.transport_cargo_bonus = cargo_bonus;
                            g_world.player_trek.transport_water_only = water_only;
                            feedback = "Transport mounted: " + transport_type;
                            success = true;
                        }
                    }
                }
            }
            else if (action == "dismount") {
                g_world.player_trek.active_transport_id = "";
                g_world.player_trek.transport_type = "none";
                g_world.player_trek.transport_speed_mult = 1.0;
                g_world.player_trek.transport_cargo_bonus = 0;
                g_world.player_trek.transport_water_only = false;
                feedback = "Transport dismounted";
                success = true;
            }
            else if (action == "getInfo") {
                JsonValue info = JsonValue::object();
                info.set("active_transport_id", g_world.player_trek.active_transport_id);
                info.set("transport_type", g_world.player_trek.transport_type);
                info.set("speed_multiplier", g_world.player_trek.transport_speed_mult);
                info.set("cargo_bonus", g_world.player_trek.transport_cargo_bonus);
                info.set("water_only", g_world.player_trek.transport_water_only);
                response.set("info", info);
                success = true;
            }

            response.set("status", "ok");
            response.set("success", success);
            if (!feedback.empty()) response.set("feedback", feedback);
        }

else if (cmd == "playerManageBusiness") {
            std::string action = command["action"].asString();
            const JsonValue& args = command["args"];
            
            if (action == "create") {
                std::string regionId = args["regionId"].asString();
                std::string facilityType = args["facilityType"].asString();
                std::string name = args["name"].asString();
                
                        Business b;
        b.id = "bus_" + generateUUID();
        b.owner_ids.push_back("player");
        b.region_id = regionId;
        b.facility_type = facilityType;
        b.level = 1;
        b.cash_balance = 0;
        b.target_efficiency = 100;
        b.wage_level = 100;
        b.maintenance_budget = 100;
        b.construction_days_left = 14;
        const FacilityTemplate* facTpl = g_facilityRegistry.getTemplate(facilityType);
        b.target_employee_count = facTpl ? facTpl->max_employees_per_level : 100;
        b.is_active = false;
        b.addLog(g_world.current_day, "🏗️ Строительство начато. Плановый срок: 14 дн.");
                b.local_storage_id = createContainer("business_storage", "player", 999999, 1000, regionId);
                
                g_world.businesses[b.id] = b;
                if (g_world.regions.count(regionId)) {
                    placePrivateBusinessOnMap(g_world.regions[regionId], b, g_world);
                }

                // Динамическое добавление поселения на глобальную карту и прокладка дороги
                if (g_world.map.locations.count(regionId)) {
                    auto parentLoc = g_world.map.locations[regionId];
                    // Ищем свободный тайл рядом с родительским регионом для нового бизнеса
                    int bx = parentLoc.x + (rand() % 7) - 3;
                    int by = parentLoc.y + (rand() % 7) - 3;
                    bx = std::clamp(bx, 1, g_world.map.width - 2);
                    by = std::clamp(by, 1, g_world.map.height - 2);
                    
                    MapLocation newLoc;
                    newLoc.id = b.id;
                    newLoc.name = name;
                    newLoc.x = bx;
                    newLoc.y = by;
                    newLoc.type = "village";
                    newLoc.faction = g_world.regions[regionId].factionId;
                    g_world.map.locations[b.id] = newLoc;

                    // Прокладка новой дороги от бизнеса к городу
                    std::vector<bool> has_road(g_world.map.width * g_world.map.height, false);
                    std::vector<int> path_status(g_world.map.width * g_world.map.height, 0);
                    for (const auto& road : g_world.map.roads) {
                        for (const auto& wp : road.waypoints) {
                            has_road[wp.second * g_world.map.width + wp.first] = true;
                        }
                    }
                    
                    auto path = findPath(g_world.map, bx, by, parentLoc.x, parentLoc.y, has_road, path_status, MovementType::ANY);
                    if (!path.empty()) {
                        MapRoad newRoad;
                        newRoad.from = b.id;
                        newRoad.to = regionId;
                        newRoad.condition = "dirt";
                        newRoad.waypoints = path;
                        g_world.map.roads.push_back(newRoad);
                    }
                    g_world.map.generation_tick = g_world.tick;
                }

                response.set("status", "ok");
                response.set("business_id", b.id);
            }
            else if (action == "set_focus") {
                std::string bId = args["businessId"].asString();
                if (g_world.businesses.count(bId)) {
                    g_world.businesses[bId].production_focus = args["focus"].asString();
                    response.set("status", "ok");
                } else response.set("status", "error");
            }

            else if (action == "set_wages") {
                std::string bId = args["businessId"].asString();
                if (g_world.businesses.count(bId)) {
                    g_world.businesses[bId].wage_level = args["value"].asInt();
                    response.set("status", "ok");
                } else response.set("status", "error");
            }
            else if (action == "set_maintenance") {
                std::string bId = args["businessId"].asString();
                if (g_world.businesses.count(bId)) {
                    g_world.businesses[bId].maintenance_budget = args["value"].asInt();
                    response.set("status", "ok");
                } else response.set("status", "error");
            }
            else if (action == "add_rule") {
                std::string bId = args["businessId"].asString();
                if (g_world.businesses.count(bId)) {
                    LogisticRule r = LogisticRule::fromJson(args["rule"]);
                    r.id = "log_" + generateUUID();
                    g_world.businesses[bId].logistics.push_back(r);
                    response.set("status", "ok");
                } else response.set("status", "error");
            }
            else if (action == "remove_rule") {
                std::string bId = args["businessId"].asString();
                std::string ruleId = args["ruleId"].asString();
                if (g_world.businesses.count(bId)) {
                    auto& logs = g_world.businesses[bId].logistics;
                    logs.erase(std::remove_if(logs.begin(), logs.end(), [&](const LogisticRule& r){ return r.id == ruleId; }), logs.end());
                    response.set("status", "ok");
                } else response.set("status", "error");
            }
            else if (action == "toggle_auto_buy") {
                std::string bId = args["businessId"].asString();
                if (g_world.businesses.count(bId)) {
                    g_world.businesses[bId].auto_buy_inputs = args["state"].asBool();
                    response.set("status", "ok");
                } else response.set("status", "error");
            }
            else if (action == "toggle_auto_sell") {
                std::string bId = args["businessId"].asString();
                if (g_world.businesses.count(bId)) {
                    g_world.businesses[bId].auto_sell_outputs = args["state"].asBool();
                    response.set("status", "ok");
                } else response.set("status", "error");
            }
            else if (action == "set_employees") {
                std::string bId = args["businessId"].asString();
                if (g_world.businesses.count(bId)) {
                    const FacilityTemplate* facTpl = g_facilityRegistry.getTemplate(g_world.businesses[bId].facility_type);
                    int max_emp = facTpl ? g_world.businesses[bId].level * facTpl->max_employees_per_level : g_world.businesses[bId].level * 100;
                    g_world.businesses[bId].target_employee_count = args["count"].asInt();
                    g_world.businesses[bId].employee_count = std::min(args["count"].asInt(), max_emp);
                    response.set("status", "ok");
                } else response.set("status", "error");
            }
            else if (action == "set_efficiency") {
                std::string bId = args["businessId"].asString();
                if (g_world.businesses.count(bId)) {
                    g_world.businesses[bId].target_efficiency = std::clamp(args["efficiency"].asInt(), 0, 100);
                    response.set("status", "ok");
                } else response.set("status", "error");
            }
            else if (action == "deposit_cash") {
                std::string bId = args["businessId"].asString();
                int amount = args["amount"].asInt();
                if (g_world.businesses.count(bId)) {
                    g_world.businesses[bId].cash_balance += amount;
                    response.set("status", "ok");
                } else response.set("status", "error");
            }
            else if (action == "withdraw_cash") {
                std::string bId = args["businessId"].asString();
                int amount = args["amount"].asInt();
                if (g_world.businesses.count(bId) && g_world.businesses[bId].cash_balance >= amount) {
                    g_world.businesses[bId].cash_balance -= amount;
                    response.set("status", "ok");
                } else response.set("status", "error");
            }
            serializeRegistries(false);
        }

        else if (cmd == "simulateTicks" || cmd == "preSimulate") {
            int ticks = command["ticks"].asInt();
            
            // Optionally load world state if provided (Legacy support during transition)
            if (command.has("world")) {
                g_world = World::fromJson(command["world"]);
            }
            if (command.has("items")) {
                g_items.clear();
                for (size_t i=0; i<command["items"].size(); i++) {
                    PhysicalItem item = PhysicalItem::fromJson(command["items"][i][1]);
                    item.is_dirty = false;
                    g_items[command["items"][i][0].asString()] = item;
                }
            }
            if (command.has("containers")) {
                g_containers.clear();
                for (size_t i=0; i<command["containers"].size(); i++) {
                    Storage cont = Storage::fromJson(command["containers"][i][1]);
                    cont.is_dirty = false;
                    g_containers[command["containers"][i][0].asString()] = cont;
                }
                rebuildContainerIndices();
            }
            
            simulateTicks(ticks);
            
            response.set("status", "ok");
            response.set("tick", g_world.tick);
            response.set("news_count", (int)g_world.news.size());
                        JsonValue eventsArr = JsonValue::array();
            for (const auto& ev : g_world.player_trek.pending_events) {
                eventsArr.push(ev.toJson());
            }
            g_world.player_trek.pending_events.clear();
            response.set("trek_events", eventsArr);

response.set("world", g_world.toJson());
            response.set("relevant_news", g_world.getRelevantNewsJson(command.has("player_location") ? command["player_location"].asString() : "", 20));
            serializeRegistries(false);
        }
                else if (cmd == "startTrek") {
            std::string start_id = command["start_id"].asString();
            std::string dest_id = command["destination_id"].asString();
            
            g_world.player_trek.active = true;
            g_world.player_trek.paused = false;
            g_world.player_trek.destination_id = dest_id;
            g_world.player_trek.elapsed_hours = 0;
            g_world.player_trek.hours_since_last_bandit = g_gameplay_runtime.trek_bandit_cooldown_hours;
            g_world.player_trek.seen_object_ids.clear();
            g_world.player_trek.pending_events.clear();
            
            if (g_world.map.locations.count(start_id) && g_world.map.locations.count(dest_id)) {
                auto loc1 = g_world.map.locations[start_id];
                auto loc2 = g_world.map.locations[dest_id];
                g_world.player_trek.current_x = loc1.x;
                g_world.player_trek.current_y = loc1.y;
                
                std::vector<bool> has_road(g_world.map.width * g_world.map.height, false);
                std::vector<int> path_status(g_world.map.width * g_world.map.height, 0);
                for (const auto& road : g_world.map.roads) {
                    if (road.condition == "blocked") {
                        for (const auto& wp : road.waypoints) path_status[wp.second * g_world.map.width + wp.first] = 2;
                    } else if (road.condition == "ruined") {
                        for (const auto& wp : road.waypoints) {
                            path_status[wp.second * g_world.map.width + wp.first] = 1;
                            has_road[wp.second * g_world.map.width + wp.first] = true;
                        }
                    } else {
                        for (const auto& wp : road.waypoints) has_road[wp.second * g_world.map.width + wp.first] = true;
                    }
                }
                
                g_world.player_trek.path = findPath(g_world.map, loc1.x, loc1.y, loc2.x, loc2.y, has_road, path_status, MovementType::ANY, 1);
                g_world.player_trek.path_index = 0;
                
                double total_dist = 0;
                for(size_t i=0; i+1<g_world.player_trek.path.size(); ++i) {
                    total_dist += std::hypot(g_world.player_trek.path[i+1].first - g_world.player_trek.path[i].first,
                                             g_world.player_trek.path[i+1].second - g_world.player_trek.path[i].second);
                }

                // Calculate travel time considering water-only transport restriction
                double base_speed = g_gameplay_runtime.trek_base_travel_speed;
                if (base_speed <= 0.0) base_speed = 0.5;
                double base_hours = total_dist / base_speed;
                double speed_mult = (g_world.player_trek.transport_speed_mult > 0.1) ? g_world.player_trek.transport_speed_mult : 1.0;

                // If transport is water-only, calculate average speed based on terrain mix
                if (g_world.player_trek.transport_water_only && speed_mult > 1.0) {
                    double water_distance = 0.0;
                    double land_distance = 0.0;

                    for(size_t i=0; i+1<g_world.player_trek.path.size(); ++i) {
                        int x = g_world.player_trek.path[i].first;
                        int y = g_world.player_trek.path[i].second;
                        int idx = y * g_world.map.width + x;
                        uint8_t tile_type = g_world.map.grid[idx].biome_id;
                        const BiomeDef* biome_p = getBiomeById(tile_type);
                        bool is_water = biome_p ? biome_p->is_water : false;

                        double segment_dist = std::hypot(g_world.player_trek.path[i+1].first - g_world.player_trek.path[i].first,
                                                         g_world.player_trek.path[i+1].second - g_world.player_trek.path[i].second);

                        if (is_water) {
                            water_distance += segment_dist;
                        } else {
                            land_distance += segment_dist;
                        }
                    }

                    // Calculate weighted average: water segments use speed_mult, land segments use 1.0
                    double water_hours = water_distance / (base_speed * speed_mult);
                    double land_hours = land_distance / base_speed;
                    g_world.player_trek.total_hours = std::max(1, (int)(water_hours + land_hours));
                } else {
                    g_world.player_trek.total_hours = std::max(1, (int)(base_hours / speed_mult));
                }
            } else {
                g_world.player_trek.total_hours = 24;
            }
            
            response.set("status", "ok");
            response.set("total_hours", g_world.player_trek.total_hours);
            response.set("message", "Trek started");
        }
        else if (cmd == "pauseTrek") {
            g_world.player_trek.paused = true;
            response.set("status", "ok");
        }
        else if (cmd == "resumeTrek") {
            g_world.player_trek.paused = false;
            response.set("status", "ok");
        }
        else if (cmd == "cancelTrek") {
            g_world.player_trek.active = false;
            response.set("status", "ok");
        }
        else if (cmd == "interactWithObject") {
            g_world.player_trek.paused = true;
            std::string obj_type = command["object_type"].asString();
            std::string sim_id = command["sim_object_id"].asString();
            JsonValue objData = JsonValue::object();
            
            if (obj_type == "caravan") {
                for (const auto& [rid, r] : g_world.regions) {
                    for (const auto& c : r.caravans) {
                        if (c.id == sim_id) { objData = c.toJson(); break; }
                    }
                }
            } else if (obj_type == "army") {
                for (const auto& [fid, f] : g_world.factions) {
                    for (const auto& a : f.armies) {
                        if (a.id == sim_id) { objData = a.toJson(); objData.set("faction_name", f.name); break; }
                    }
                }
            }
            response.set("status", "ok");
            response.set("object_data", objData);
        }

        else if (cmd == "getGraphContext") {
            std::vector<std::string> query_ids;
            if (command.has("query_ids")) {
                for (size_t i = 0; i < command["query_ids"].size(); ++i) {
                    query_ids.push_back(command["query_ids"][i].asString());
                }
            }
            response.set("status", "ok");
            response.set("graph_context", g_world.getGraphContext(query_ids, 15));
        }

        else if (cmd == "getWorldMap") {
            response.set("status", "ok");
            response.set("map", g_world.map.toJson());
        }
        else if (cmd == "gmModifyTerrain") {
            std::string regionId = command["args"]["regionId"].asString();
            int radius = command["args"]["radius"].asInt();
            uint8_t newType = command["args"]["newType"].asInt();
            
            if (g_world.map.locations.count(regionId)) {
                auto loc = g_world.map.locations[regionId];
                for (int y = std::max(0, loc.y - radius); y <= std::min(g_world.map.height - 1, loc.y + radius); ++y) {
                    for (int x = std::max(0, loc.x - radius); x <= std::min(g_world.map.width - 1, loc.x + radius); ++x) {
                        if (std::hypot(x - loc.x, y - loc.y) <= radius) {
                            g_world.map.grid[y * g_world.map.width + x].biome_id = newType;
                        }
                    }
                }
                g_world.map.generation_tick = g_world.tick;
                response.set("status", "ok");
                response.set("message", "Terrain modified");
            } else {
                response.set("status", "error");
                response.set("message", "Region not found on map");
            }
        }

else if (cmd == "ping") {
            response.set("status", "ok");
            response.set("pong", true);
            response.set("tick", g_world.tick);
        }
        else {
            response.set("status", "error");
            response.set("message", "Unknown command: " + cmd);
        }
        
        { std::lock_guard<std::mutex> outLock(g_output_mutex); std::cout << response.toString() << std::endl; std::cout.flush(); }

        } // end try
        catch (const std::exception& e) {
            JsonValue errResp = JsonValue::object();
            errResp.set("status", "error");
            errResp.set("message", std::string("Engine exception: ") + e.what());
            { std::lock_guard<std::mutex> outLock(g_output_mutex); std::cout << errResp.toString() << std::endl; std::cout.flush(); }
        } catch (...) {
            JsonValue errResp = JsonValue::object();
            errResp.set("status", "error");
            errResp.set("message", "Engine crashed with unknown exception");
            { std::lock_guard<std::mutex> outLock(g_output_mutex); std::cout << errResp.toString() << std::endl; std::cout.flush(); }
        }
    }
    
    return 0;
}
