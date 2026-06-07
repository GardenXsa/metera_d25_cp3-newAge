#pragma once

#include <string>
#include <vector>
#include <cstdint>
#include <unordered_map>
#include <map>

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
    std::vector<std::string> resources;  // Data-driven: resources available in this biome
    
    // Generation rules (Perlin Noise)
    double min_elevation;
    double max_elevation;
    double min_temp;
    double max_temp;
    double min_moisture;
    double max_moisture;
};

// 2.2. Реестр Эпических Монстров (Monster Registry)
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

// 2.5. Реестр Рас (Race Registry)
struct RaceDef {
    std::string string_id;
    std::string name;
    bool base_race = false;
    std::vector<std::string> faction_preference;
    std::string biome_preference;
    std::unordered_map<std::string, int> stat_modifiers;  // str, dex, int, con, cha
    std::unordered_map<std::string, std::unordered_map<std::string, int>> class_stats;  // class -> stat -> value
};

// 2.6. Реестр Профессий (Profession Registry)
struct ProfessionDef {
    std::string string_id;
    std::string name;
    std::string profession_type;  // farmer, artisan, merchant, innkeeper, etc.
    std::string tool_tag;
    int tool_chance = 0;
    // Data-driven fields (Stage 2)
    std::string production_type;  // "food", "crafts", "military", "services", etc.
    std::map<std::string, float> demand_pattern;  // "base", "per_population", "base_demand", "base_race"
    float job_multiplier = 1.0f;
    std::vector<std::string> special_abilities;  // "farming", "gathering", "crafting", "spellcasting", etc.
    std::string display_name_i18n_key;
    std::string preferred_facility;  // Data-driven: facility type this profession prefers for production
};

// 2.7. Реестр Черт Характера (Trait Registry)
struct TraitDef {
    std::string string_id;
    std::string name;
    std::unordered_map<std::string, int> personality_bias;  // aggression, greed, etc.
};

// 2.8. Реестр Имён по Расам (Name Group Registry)
struct NameGroupDef {
    std::vector<std::string> first_names;
    std::vector<std::string> last_names;
};

// 2.9. Реестр Отношений Фракций (Faction Relations Registry)
struct FactionRelationRule {
    std::string f1;
    std::string f2;
    int modifier = 0;
};

struct FactionRelationsDef {
    std::unordered_map<std::string, std::string> faction_biome_preference;
    std::unordered_map<std::string, std::string> faction_corrupt_biome;
    std::unordered_map<std::string, std::vector<FactionRelationRule>> era_relations;
};

// 2.10. Фрагменты Предысторий NPC (Background Fragment Registry)
struct BackgroundFragment {
    std::string id;                                         // Уникальный ID фрагмента
    std::string text;                                       // Текст предложения
    std::vector<std::string> requires;                      // Зависимости: ID фрагментов, которые должны быть выбраны ранее
    std::vector<std::string> excludes;                      // Исключения: ID фрагментов, с которыми несовместим
    std::unordered_map<std::string, int> personality_bias;  // Влияние на характер: aggression, greed, sociability, loyalty, lust
    std::vector<std::string> tags;                          // Семантические теги
};

struct BackgroundCategory {
    std::string name;                           // Ключ категории (origin, family, childhood_event, etc.)
    double weight;                              // Вес/вероятность выбора (0.0-1.0)
    bool required;                              // Обязательная категория
    std::vector<BackgroundFragment> fragments;  // Фрагменты в этой категории
};

struct BackgroundCompositionRules {
    int min_categories = 3;
    int max_categories = 6;
    std::vector<std::string> always_include;    // Категории, которые всегда включаются
    std::vector<std::string> optional_categories;
    std::string joiner = ". ";                  // Разделитель между предложениями
    std::string suffix = ".";                   // Конец предыстории
    int max_personality_delta = 25;             // Макс. суммарное изменение одной черты
    int min_personality_value = 0;
    int max_personality_value = 100;
};

// Container Type Definition (Stage 8)
struct ContainerTypeDef {
    bool is_locked = false;
    bool decay_on_empty = false;
    std::string category;  // "faction", "personal", "ship_hold", etc.
    std::string special_logic;
    int health = 200;
    int lock_difficulty = 10;
    bool flammable = true;
    int capacity = 100;
    int max_weight = 999999;
    std::string spell_required;
};
