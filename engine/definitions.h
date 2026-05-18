#pragma once

#include <string>
#include <vector>
#include <cstdint>
#include <unordered_map>

// 2.1. Реестр Биомов (Biome Registry)
struct BiomeDef {
    uint8_t numeric_id;
    std::string string_id;
    std::string name;
    int movement_cost;
    bool is_water;
    bool is_impassable;
    std::string color_hex;
    std::vector<std::string> tags;
    
    // Generation rules (Perlin Noise)
    double min_elevation;
    double max_elevation;
    double min_temp;
    double max_temp;
    double min_moisture;
    double max_moisture;
};

// 2.2. Реестр Генерации Городов (CityGen Registry)
struct CityGenDef {
    std::unordered_map<std::string, std::vector<std::string>> facility_names;
    std::vector<std::string> road_names;
    std::vector<std::string> square_names;
};

// 2.3. Реестр Эпических Монстров (Monster Registry)
struct MonsterDef {
    std::string string_id;
    std::string name;
    int base_hp;
    int base_attack;
    int base_defense;
    std::string spawn_biome_tag;
    std::string corrupt_biome_to;
    std::string loot_table_id;
};

// 2.4. Реестр Бедствий (Disaster Registry)
struct DisasterDef {
    std::string string_id;
    std::string name;
    int base_radius;
    int base_duration_days;
    int population_damage_percent;
    int facility_damage;
    std::vector<std::string> allowed_climates;
    bool floods_tiles = false;
    bool ruins_roads = false;
    int stability_penalty = 0;
    int threat_set = 0;
    double fertility_mult = 1.0;
    std::string transform_biome_to = "";
    std::vector<std::string> affected_biomes;
    std::string spawn_item = "";
    int spawn_item_qty = 0;
};
