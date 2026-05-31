# Полный анализ C++ движка Chronicles of Meterea

## Файловая структура

| Файл | Строк | Назначение |
|------|-------|------------|
| json_wrapper.h | 220 | Обертка над nlohmann::json с кэшированием |
| core_types.h | 461 | Базовые типы: PhysicalItem, Storage, ObjectPool, ThreadPool |
| definitions.h | 127 | Определения структур данных: BiomeDef, MonsterDef, RaceDef и т.д. |
| item_system.h | 44 | Заголовок системы предметов |
| item_system.cpp | 77 | Реализация ItemRegistry |
| npc_personality.h | 12 | Декларация функций генерации NPC |
| meterea_mod_sdk.h | 419 | SDK для модов (C-API) |
| meterea_engine.cpp | 16194 | Основной движок симуляции мира |
| **ИТОГО** | **17,709** | |

---

## 1. json_wrapper.h - Умная обертка JSON

### Ключевые особенности:
- **Двойное хранение устранено**: obj_val/arr_val - единственный источник истины
- **Кэширование сериализации**: _dirty флаг + _cached_data
- **Производительность**: 3-5x ускорение для больших объектов

### Структура JsonValue:
```cpp
enum Type { NULL_VAL, OBJECT, ARRAY, STRING, INT, DOUBLE, BOOLEAN };
nlohmann::json _data;  // Только для toString()
std::map<std::string, JsonValue> obj_val;  // Объекты
std::vector<JsonValue> arr_val;            // Массивы
std::string s_val; long long i_val; double d_val; bool b_val;
```

### Критичные исправления:
- **Issue #6**: Добавлен non-const operator[] для мутаций
- **Issue #77**: Кэширование через _dirty флаг
- **Issue #131**: thread_local для null_val в operator[]

---

## 2. core_types.h - Базовые типы

### PhysicalItem (80+ полей):
```cpp
struct PhysicalItem {
    std::string id, prototype_id, raw_prototype_id;
    int stack_size; std::string container_id, slot_index, state;
    PhysicalItemFlags flags;  // quest_item, bound, stolen, magical
    int durability; JsonValue custom_props;
    std::vector<PhysicalItemHistory> history;
    std::optional<OrderData> order_data;
};
```

### Исправление Issue #8:
- **Проблема**: C++ использовал direct fields, JS использовал flags.* → рассинхронизация
- **Решение**: syncFlags() обеспечивает двунаправленную синхронизацию

### Storage (контейнеры):
```cpp
struct Storage {
    std::string id, type, owner_id;
    int max_weight_kg, max_slots;
    JsonValue location, lock_data, physical_props, custom_props;
    std::vector<std::string> item_ids;
    std::unordered_map<std::string, std::vector<std::string>> items_by_type;
};
```

### ObjectPool<T> - Пул объектов:
- Переиспользование слотов через free_slots
- O(1) доступ по ID через id_to_index
- Поддержка contains(), erase(), clear()

### ThreadPool:
- worker_loop с condition_variable
- enqueue() возвращает std::future
- getThreadPool() - singleton

---

## 3. definitions.h - Регистры определений

### BiomeDef (биомы):
```cpp
struct BiomeDef {
    uint8_t numeric_id; std::string string_id, name;
    int movement_cost; bool is_water, is_impassable;
    std::string color_hex; std::vector<std::string> tags, resources;
    double min_elevation, max_elevation, min_temp, max_temp, ...;
};
```

### MonsterDef (монстры):
- base_hp, base_attack, base_defense
- spawn_biome_tag, corrupt_biome_to, loot_table_id

### DisasterDef (бедствия):
- population_damage_percent, facility_damage
- floods_tiles, ruins_roads, transform_biome_to

### RaceDef (расы):
- stat_modifiers: str, dex, int, con, cha
- class_stats: class -> stat -> value

### ProfessionDef (профессии):
- production_type, demand_pattern, special_abilities
- preferred_facility

### ContainerTypeDef:
- is_locked, decay_on_empty, category
- health, lock_difficulty, flammable, capacity

---

## 4. item_system.h/.cpp - Система предметов

### ItemTemplate:
```cpp
struct ItemTemplate {
    std::string id, name;
    double basePrice;
    std::vector<std::string> tags;
    std::unordered_map<std::string, PropertyValue> properties;
};
```

### ItemRegistry:
- loadItemsFromJSON() - загрузка из файла
- getTemplate() - получение шаблона
- findTemplatesWithTag() - поиск по тегам
- g_itemRegistry - глобальный экземпляр

---

## 5. meterea_mod_sdk.h - ModKit 3.0 C-API

### Архитектура:
- **Stable ABI**: extern "C" функции, нет сырых указателей
- **Opaque handles**: MeteraHandle, MeteraStringHandle
- **Deferred callbacks**: изменения применяются на следующий тик

### API Version: 3.3.0

### Hook Types:
```cpp
METERA_HOOK_ON_DAILY_TICK
METERA_HOOK_ON_HOURLY_TICK
METERA_HOOK_ON_REGION_CHANGED
METERA_HOOK_ON_NPC_DEATH
METERA_HOOK_ON_BATTLE
METERA_HOOK_ON_TRADE
METERA_HOOK_ON_DISASTER
METERA_HOOK_ON_BUILDING_BUILT
```

### World Queries (read-only):
- getRegionPopulation(), getRegionStability()
- getRegionFaction(), getRegionBiome()
- getWorldPopulation(), getCurrentDay(), getCurrentHour()
- getItemPrice(), getNpcHp(), getContainerItemCount()
- getMapWidth(), getMapHeight(), getTileBiome()

### World Mutations (deferred):
- setRegionStability(), modifyRegionPopulation()
- multiplyAllPrices(), multiplyItemPrice()
- spawnItem(), triggerDisaster(), spawnMonster()
- addNews(), setNpcHp()
- setTileBiome(), setTileRoadLevel()

### Plugin Lifecycle:
1. MeteraPlugin_GetName()
2. MeteraPlugin_GetVersion()
3. MeteraPlugin_GetAPI(const MeteraAPI* api)
4. MeteraPlugin_Init(int32_t plugin_id)
5. MeteraPlugin_OnLoad()
6. MeteraPlugin_Shutdown()

### Безопасность:
⚠️ **WARNING**: Native плагины имеют ПОЛНЫЙ доступ к процессу
- Нет песочницы для DLL/SO
- Требуется allowlist подписанных плагинов

---

## 6. meterea_engine.cpp - Основной движок (16,194 строк)

### Глобальные регистры:
```cpp
ObjectPool<PhysicalItem> g_items;
ObjectPool<Storage> g_containers;
FacilityRegistry g_facilityRegistry;
Database g_db;
GameplayRuntimeConfig g_gameplay_runtime;
```

### Database структура:
- items: unordered_map<string, ItemDef>
- recipes: vector<RecipeDef>
- biomes: vector<BiomeDef>
- monsters, disasters, races, professions, traits
- name_groups, backgrounds, faction_relations
- world_config: map dimensions, noise params, rivers, volcanoes

### GameplayRuntimeConfig:
- inventory_engine: id_prefixes (container_, item_)
- default_item_weight, default_lock_difficulty
- container_types, transport_registry, ship_types
- simulation: hunger, army morale, region stability/threat
- population: food/weapon reserves, demand ratios
- facility: jobs per level, business income
- race_facility_mods, race_ecology

### Командный протокол (stdin/stdout JSON):

#### Инвентарь:
- createContainer, destroyContainer
- addItemToContainer, removeItemFromContainer
- moveItemBetweenContainers
- equipItem, unequipItem
- lockContainer, unlockContainer, pickLock

#### Торговля:
- tradeItems
- playerManageBusiness: create, set_focus, set_wages, set_maintenance

#### Транспорт:
- mount, dismount, getInfo

#### Путешествия (Trek):
- startTrek, pauseTrek, resumeTrek, cancelTrek
- interactWithObject: caravan, army

#### Бой:
- resolveEnemyAttacks: player_def, enemies[] → total_damage, combat_log[]

#### GM команды:
- gmModifyTerrain: regionId, radius, newType

#### Карта:
- getWorldMap → map.toJson()
- getGraphContext: query_ids[] → context

#### Синхронизация:
- ping → pong, tick

### Симуляция мира:
- daily tick: голод, производство, торговля
- hourly tick: движение караванов, армий
- disaster events, monster spawns
- faction relations, wars, diplomacy

### Многопоточность:
- g_registry_mutex: recursive_mutex для регистров
- g_output_mutex: для stdout
- thread_safe_rand(): потокобезопасный RNG

### Сериализация:
- serializeRegistries(items_only)
- Полная: g_items, g_containers
- Частичная: только dirty items

---

## Архитектурные паттерны

### 1. Data-Driven Design
- Все определения из JSON (biomes, races, items)
- Runtime config загружается динамически

### 2. Command Pattern
- JSON команды через stdin
- Response через stdout

### 3. Object Pooling
- ObjectPool<PhysicalItem>, ObjectPool<Storage>
- Переиспользование слотов для производительности

### 4. Deferred Mutations
- Изменения применяются на следующий тик
- Предотвращает блокировку симуляции

### 5. Serialization Caching
- _dirty флаг в JsonValue
- Кэширование rebuildData()

---

## Проблемные места

1. **Глобальное состояние**: g_items, g_containers, g_db
2. **Смешение ответственности**: meterea_engine.cpp - 16K строк в одном файле
3. **Нет модульности**: все системы в одном месте
4. **Потокобезопасность**: частичная, только mutex для регистров
5. **Обработка ошибок**: try/catch только в main loop

---

## Производительность

### Оптимизации:
- ObjectPool вместо new/delete
- Кэширование JSON сериализации
- Thread pool для фоновых задач
- Dirty flag для ленивой сериализации

### Измерения:
- 50% reduction memory после устранения дублирования JSON
- 3-5x faster toJson() для больших объектов
- O(1) access в ObjectPool через hash map
