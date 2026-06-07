# Chronicles of Meterea — Документация по моддингу

> **Версия игры:** 0.4.0 | **Версия ModKit:** 2.0 (JS) / 3.0 (C++) | **Лицензия:** All Rights Reserved — репозиторий только для чтения  
> **Автор:** MrKins_XP (GardenXsa)

---

## Содержание

1. [Введение](#1-введение)
2. [Архитектура моддинга](#2-архитектура-моддинга)
3. [Быстрый старт: создание первого мода](#3-быстрый-старт-создание-первого-мода)
4. [Дескриптор мода (mod.json)](#4-дескриптор-мода-modjson)
5. [Data-моды: JSON-базы данных](#5-data-моды-json-базы-данных)
   - 5.1 [Runtime Manifest](#51-runtime-manifest)
   - 5.2 [Merge-политики](#52-merge-политики)
   - 5.3 [Total Conversion](#53-total-conversion)
   - 5.4 [Справочник всех database-ключей](#54-справочник-всех-database-ключей)
6. [Справочник форматов данных](#6-справочник-форматов-данных)
   - 6.1 [Предметы (items)](#61-предметы-items)
   - 6.2 [Рецепты (recipes)](#62-рецепты-recipes)
   - 6.3 [Расы (races)](#63-расы-races)
   - 6.4 [Классы (classes)](#64-классы-classes)
   - 6.5 [Эпохи (eras)](#65-эпохи-eras)
   - 6.6 [Биомы (biomes)](#66-биомы-biomes)
   - 6.7 [Монстры (monsters)](#67-монстры-monsters)
   - 6.8 [Профессии (professions)](#68-профессии-professions)
   - 6.9 [Черты характера (traits)](#69-черты-характера-traits)
   - 6.10 [Имена NPC (npc_names)](#610-имена-npc-npc_names)
   - 6.11 [Фракции и отношения (faction_relations)](#611-фракции-и-отношения-faction_relations)
   - 6.12 [Дипломатия (diplomacy)](#612-дипломатия-diplomacy)
   - 6.13 [Касусы белли (casus_belli)](#613-касусы-белли-casus_belli)
   - 6.14 [Типы зданий (building_types)](#614-типы-зданий-building_types)
   - 6.15 [Конфигурация мира (world_config)](#615-конфигурация-мира-world_config)
   - 6.16 [Локации (locations)](#616-локации-locations)
   - 6.17 [Слоты экипировки (equipment_slots)](#617-слоты-экипировки-equipment_slots)
   - 6.18 [Теги по умолчанию (tag_defaults)](#618-теги-по-умолчанию-tag_defaults)
   - 6.19 [Рассказчики (narrators)](#619-рассказчики-narrators)
   - 6.20 [Промпты AI (prompt_pack)](#620-промпты-ai-prompt_pack)
   - 6.21 [Маркеры карты (map_markers)](#621-маркеры-карты-map_markers)
   - 6.22 [Словарь тайлов (tile_dictionary)](#622-словарь-тайлов-tile_dictionary)
   - 6.23 [Типы кораблей (ship_types)](#623-типы-кораблей-ship_types)
   - 6.24 [Транспортный реестр (transport_registry)](#624-транспортный-реестр-transport_registry)
   - 6.25 [Конфиг путешествий (trek_config)](#625-конфиг-путешествий-trek_config)
   - 6.26 [Контейнеры (container_types / system_containers)](#626-контейнеры-container_types--system_containers)
   - 6.27 [Каталог мебели (furniture_catalog)](#627-каталог-мебели-furniture_catalog)
   - 6.28 [Описания предметов (item_descriptions)](#628-описания-предметов-item_descriptions)
   - 6.29 [Категории новостей (news_categories)](#629-категории-новостей-news_categories)
   - 6.30 [Интенты (intent_registry)](#630-интенты-intent_registry)
   - 6.31 [Визуальные ассеты (visual_assets / visual_asset_packs / scene_visual_rules)](#631-визуальные-ассеты)
   - 6.32 [Runtime-конфиги (ui_runtime / prompt_runtime / gameplay_runtime / electron_runtime)](#632-runtime-конфиги)
7. [JS ModAPI — скриптовые моды](#7-js-modapi--скриптовые-моды)
   - 7.1 [Жизненный цикл мода](#71-жизненный-цикл-мода)
   - 7.2 [Система хуков (событий)](#72-система-хуков-событий)
   - 7.3 [Справочник ModAPI](#73-справочник-modapi)
   - 7.4 [Песочница (Sandbox)](#74-песочница-sandbox)
   - 7.5 [Безопасность и ограничения](#75-безопасность-и-ограничения)
   - 7.6 [Примеры скриптовых модов](#76-примеры-скриптовых-модов)
8. [ModKit 3.0 — нативные C++ плагины](#8-modkit-30--нативные-c-плагины)
   - 8.1 [Жизненный цикл плагина](#81-жизненный-цикл-плагина)
   - 8.2 [Обязательные экспортируемые функции](#82-обязательные-экспортируемые-функции)
   - 8.3 [Типы хуков](#83-типы-хуков)
   - 8.4 [Запросы мира (World Queries)](#84-запросы-мира-world-queries)
   - 8.5 [Мутации мира (World Mutations)](#85-мутации-мира-world-mutations)
   - 8.6 [API-таблица MeteraAPI](#86-api-таблица-meteraapi)
   - 8.7 [Пример плагина](#87-пример-плагина)
   - 8.8 [Предупреждение безопасности](#88-предупреждение-безопасности)
9. [Система локализации](#9-система-локализации)
10. [Сохранения и моды](#10-сохранения-и-моды)
11. [Инструменты валидации](#11-инструменты-валидации)
12. [Стиль кода и контрибуция](#12-стиль-кода-и-контрибуция)
13. [Устранение неполадок](#13-устранение-неполадок)
14. [Приложение: глобальные переменные игры](#14-приложение-глобальные-переменные-игры)

---

## 1. Введение

**Chronicles of Meterea** — это AI-текстовая RPG с глубокой симуляцией мира, построенная на **Electron + C++ движке симуляции**. Игрок создаёт персонажа (раса, класс, эпоха) и управляет им через текстовые команды. Внешний LLM (Gemini, Claude, GPT-4o и др.) выступает как Гейм-Мастер, генерируя сюжет и рассчитывая механику. В фоне работает C++ движок, который симулирует экономику, NPC, войны, фракции, катастрофы и дипломатию.

Игра предоставляет **трёхуровневую систему моддинга**:

| Уровень | Технология | Сложность | Возможности |
|---------|-----------|-----------|-------------|
| **Data-моды** | JSON-файлы | Низкая | Добавление предметов, рас, классов, рецептов, локаций и других данных |
| **JS-моды (ModAPI)** | JavaScript (песочница) | Средняя | Хуки событий, кастомные команды, модификация AI-промптов, UI, горячие клавиши |
| **C++ плагины (ModKit)** | C++ DLL/SO | Высокая | Полный доступ к симуляции: мутации мира, NPC, фракции, карта, экономика |

---

## 2. Архитектура моддинга

### Поток загрузки модов

```
1. Electron main process запускается
2. ModLoader сканирует папку модов в пользовательских данных (`app.getPath('userData')/mods/`)
3. Читает mod.json каждого мода
4. Проверяет зависимости и валидирует метаданные
5. Собирает Runtime Database:
   a. Загружает базовые JSON из data/ (если не Total Conversion)
   b. Применяет данные модов по merge-политикам
   c. Вызывает хук onDatabaseLoad
   d. Валидирует контракт (обязательные секции)
6. Выполняет JS-скрипты модов в песочнице
7. Инициализирует C++ движок и передаёт базу данных
8. Загружает нативные плагины (DLL/SO)
9. Вызывает хук onModsInitialized
10. Регистрирует engine hooks в C++ ядре
```

### Структура файлов мода

```
<userData>/mods/
└── my_mod_id/            # Имя папки = id мода
    ├── mod.json           # Обязательный дескриптор
    ├── data/
    │   ├── main.js        # Скрипт мода (если есть скрипты)
    │   ├── items.json     # Кастомные предметы
    │   ├── recipes.json   # Кастомные рецепты
    │   ├── races.json     # Кастомные расы
    │   └── ...            # Другие data-файлы
    ├── assets/
    │   └── narrator.jpg   # Кастомные ресурсы
    └── lore.txt           # Лор (опционально)

> **⚠️ Важно:** Моды создаются НЕ в директории проекта! Они расположены в папке пользовательских данных Electron (`app.getPath('userData')`).
> Конкретные пути:
> - **Windows:** `%APPDATA%\chronicles-of-meterea\mods\`
> - **Linux:** `~/.config/chronicles-of-meterea/mods/`
> - **macOS:** `~/Library/Application Support/chronicles-of-meterea/mods/`
>
> В игре есть кнопка «Открыть папку модов» (IPC: `mods-open-folder`), которая открывает эту директорию в проводнике.
```

---

## 3. Быстрый старт: создание первого мода

### Шаг 1: Создайте папку мода

```
<userData>/mods/my_first_mod/
```

> **Подсказка:** В репозитории есть файл `data/mod_template.json` — готовый шаблон с плейсхолдерами `__MOD_ID__` и `__MOD_NAME__`, который можно использовать как отправную точку.

### Шаг 2: Создайте mod.json

```json
{
  "id": "my_first_mod",
  "name": "Мой первый мод",
  "version": "1.0.0",
  "author": "Ваше имя",
  "description": "Добавляет новые предметы и рецепты",
  "dependencies": ["base_game"],
  "scripts": [],
  "data": {
    "items": ["data/items.json"],
    "recipes": ["data/recipes.json"]
  }
}
```

### Шаг 3: Создайте data/items.json

```json
{
  "mithril_ingot": {
    "names": {
      "rebirth": "Мифриловый слиток",
      "architects": "Эфирный сплав",
      "sundering": "Призрачный металл",
      "silence": "Мертвый мифрил"
    },
    "basePrice": 200,
    "category": "metal_ingot",
    "tags": ["metal_ingot", "mithril", "processed_material", "rare_material"],
    "shelfLife": 3600
  }
}
```

### Шаг 4: Создайте data/recipes.json

```json
[
  {
    "facility": "forges",
    "inputs": { "iron_ingot": 2, "ether_dust": 3 },
    "outputs": { "mithril_ingot": 1 }
  }
]
```

### Шаг 5: Запустите игру

Мод будет автоматически обнаружен при следующем запуске. Готово!

---

## 4. Дескриптор мода (mod.json)

`mod.json` — обязательный файл в корне папки мода. Он описывает метаданные, зависимости, скрипты и data-файлы.

### Полная структура

```json
{
  "id": "my_mod",
  "name": "Название мода",
  "version": "1.0.0",
  "author": "Автор",
  "description": "Описание мода",
  "apiVersion": "2.0",
  "total_conversion": false,
  "dependencies": ["base_game"],
  "scripts": ["data/main.js"],
  "data": {
    "items": ["data/items.json"],
    "recipes": ["data/recipes.json"],
    "races": ["data/races.json"],
    "classes": ["data/classes.json"],
    "eras": ["data/eras.json"],
    "biomes": ["data/biomes.json"],
    "monsters": ["data/monsters.json"],
    "professions": ["data/professions.json"],
    "traits": ["data/traits.json"],
    "npc_names": ["data/npc_names.json"],
    "npc_backgrounds": ["data/npc_backgrounds.json"],
    "faction_relations": ["data/faction_relations.json"],
    "world_config": ["data/world_config.json"],
    "diplomacy": ["data/diplomacy.json"],
    "casus_belli": ["data/casus_belli.json"],
    "tag_defaults": ["data/tag_defaults.json"],
    "facilities": ["data/facilities.json"],
    "narrators": ["data/narrators.json"],
    "prompt_pack": ["data/prompt_pack.json"],
    "world_assets": ["data/world_assets.json"],
    "tile_dictionary": ["data/tile_dictionary.json"],
    "map_markers": ["data/map_markers.json"],
    "building_types": ["data/building_types.json"],
    "transport_registry": ["data/transport_registry.json"],
    "trek_config": ["data/trek_config.json"],
    "container_types": ["data/container_types.json"],
    "ship_types": ["data/ship_types.json"],
    "equipment_slots": ["data/equipment_slots.json"],
    "furniture_catalog": ["data/furniture_catalog.json"],
    "item_descriptions": ["data/item_descriptions.json"],
    "news_categories": ["data/news_categories.json"],
    "system_containers": ["data/system_containers.json"],
    "predefined_effects": ["data/predefined_effects.json"],
    "ui_runtime": ["data/ui_runtime.json"],
    "prompt_runtime": ["data/prompt_runtime.json"],
    "gameplay_runtime": ["data/gameplay_runtime.json"]
  }
}
```

### Описание полей

| Поле | Тип | Обязательное | Описание |
|------|-----|:------------:|----------|
| `id` | string | ✅ | Уникальный идентификатор. Только строчные латинские буквы, цифры и подчёркивания: `[a-z0-9_]+` |
| `name` | string | ✅ | Человекочитаемое название мода |
| `version` | string | ✅ | Версия мода (семантическое версионирование) |
| `author` | string | ❌ | Имя автора |
| `description` | string | ❌ | Описание мода |
| `apiVersion` | string | ❌ | Версия ModAPI, под которую разработан мод (по умолчанию `"2.0"`) |
| `total_conversion` | boolean | ❌ | Если `true`, мод является тотальной конверсией — базовые данные не загружаются |
| `dependencies` | string[] | ❌ | Список ID модов, от которых зависит данный мод |
| `scripts` | string[] | ❌ | Пути к JS-скриптам мода (относительно папки мода) |
| `data` | object | ❌ | Маппинг database-ключей на массивы путей к JSON-файлам |

### Правила валидации

- `id` должен соответствовать регулярному выражению `^[a-z0-9_]+$`
- `dependencies` должен быть массивом строк
- `scripts` должен быть массивом строк
- `total_conversion` должен быть логическим значением
- Все пути в `data` указываются относительно папки мода

---

## 5. Data-моды: JSON-базы данных

Data-моды — это самый простой способ добавить контент в игру. Вы создаёте JSON-файлы, и движок автоматически загружает и объединяет их с базовыми данными.

### 5.1 Runtime Manifest

Ядро системы data-моддинга — файл `data/runtime_manifest.json`. Он определяет:

- **Реестр всех database-файлов** (путь, тип, merge-политика)
- **Контракт моддинга** (обязательные секции, правила total conversion)
- **Merge-политики** (как данные модов сливаются с базой)

Структура manifest:

```json
{
  "schemaVersion": 1,
  "contracts": {
    "items": {
      "required_fields": ["basePrice", "category", "tags"],
      "canonical_tag_source": "tag_defaults.json"
    }
  },
  "modding_contract": { ... },
  "database_files": { ... }
}
```

#### Контракт предметов (items contract)

Предметы обязаны иметь три поля:
- `basePrice` — базовая цена (число)
- `category` — категория предмета (строка)
- `tags` — массив тегов (массив строк)

Канонический источник тегов — `tag_defaults.json`.

### 5.2 Merge-политики

Данные модов сливаются с базовыми данными согласно политикам, определённым в `runtime_manifest.json`:

| Политика | Описание | Когда использовать |
|----------|----------|--------------------|
| `deepMerge` | Рекурсивное слияние объектов. Поля мода перезаписывают базовые поля. Вложенные объекты сливаются рекурсивно. | Для объектов с ключами (items, world_config, npc_names) |
| `append` | Элементы массива мода добавляются в конец базового массива. Дубликаты допустимы. | Для массивов рецептов, категорий новостей |
| `appendUnique` | Элементы добавляются только если их нет в базовом массиве (сравнение по значению). | Для слотов экипировки |
| `upsertById` | Элементы с совпадающим `id` перезаписывают базовые, новые — добавляются. | Для массивов сущностей (races, classes, biomes, monsters, eras) |
| `replace` | Полная замена базовых данных данными мода. | Для total conversion модов |

#### Порядок слияния

1. Загружаются базовые данные из `data/` (если не Total Conversion)
2. Для каждого мода, в порядке загрузки, его data-файлы сливаются с текущей базой
3. После слияния всех модов вызывается хук `onDatabaseLoad`
4. Производится валидация контракта

#### Примеры merge-поведения

**deepMerge (items):**
```json
// База: data/economy_items.json
{ "bread": { "basePrice": 5, "category": "consumable", "tags": ["food"] } }

// Мод добавляет: <userData>/mods/my_mod/data/items.json
{ "bread": { "basePrice": 8 }, "new_item": { "basePrice": 10, "category": "luxury", "tags": ["rare"] } }

// Результат:
{ "bread": { "basePrice": 8, "category": "consumable", "tags": ["food"] }, "new_item": { "basePrice": 10, "category": "luxury", "tags": ["rare"] } }
```

**upsertById (races):**
```json
// База: data/races.json
[{ "id": "human", "name": "Человек", "stat_modifiers": { "str": 1 } }]

// Мод: <userData>/mods/my_mod/data/races.json
[{ "id": "human", "stat_modifiers": { "str": 2, "dex": 1 } }, { "id": "demon", "name": "Демон" }]

// Результат: "human" обновлён, "demon" добавлен
[{ "id": "human", "name": "Человек", "stat_modifiers": { "str": 2, "dex": 1 } }, { "id": "demon", "name": "Демон" }]
```

**append (recipes):**
```json
// База: 22 рецепта
// Мод добавляет: [{ "facility": "forges", "inputs": { "iron_ingot": 5 }, "outputs": { "mithril_ingot": 1 } }]
// Результат: 23 рецепта
```

### 5.3 Total Conversion

Total Conversion — это режим, при котором мод полностью заменяет базовые данные игры. Это полезно для создания совершенно новых миров с другой тематикой.

#### Как включить

Установите `"total_conversion": true` в `mod.json`.

#### Поведение

При включённом Total Conversion:

1. Базовые database-файлы **не загружаются** (кроме явно разрешённых)
2. Мод должен предоставить **все обязательные секции** данных
3. После сборки базы данных производится **валидация контракта**

#### Разрешённые базовые секции (passthrough)

Даже в Total Conversion следующие секции загружаются из базы (флаг `load_in_total_conversion: true` в манифесте):

- `building_types`
- `tag_defaults`
- `map_markers`
- `news_categories`
- `equipment_slots`, `container_types`, `ship_types`, `transport_registry`, `trek_config`
- `system_containers`, `item_descriptions`, `predefined_effects`
- `ui_runtime`, `prompt_runtime`, `gameplay_runtime`

> **Внимание:** Секции `narrators`, `prompt_pack`, `world_assets`, `tile_dictionary`, `classes` имеют `Load при TC: ❌` — они **НЕ** загружаются из базы автоматически. Если Total Conversion моду нужны эти секции, он обязан предоставить их сам.

#### Обязательные секции (required)

Total Conversion мод **обязан** предоставить непустые данные для следующих ключей:

- `items` — предметы
- `eras` — эпохи
- `classes` — классы
- `races` — расы
- `biomes` — биомы
- `world_config` — конфигурация мира
- `tag_defaults` — теги по умолчанию

Если хотя бы одна обязательная секция пуста или отсутствует, выбрасывается ошибка:

```
[RuntimeData] total_conversion/base-data-off database is missing required sections: items, races
```

#### Секции с load_in_total_conversion

Некоторые секции из базы всегда загружаются даже в Total Conversion (флаг `load_in_total_conversion: true` в манифесте):

- `equipment_slots`, `container_types`, `ship_types`, `transport_registry`, `trek_config`
- `tag_defaults`, `building_types`, `map_markers`, `news_categories`
- `system_containers`, `item_descriptions`, `predefined_effects`
- `ui_runtime`, `prompt_runtime`, `gameplay_runtime`

### 5.4 Справочник всех database-ключей

| Ключ | Путь к базе | Тип | Merge-политика | Replace при TC | Load при TC |
|------|------------|-----|-----------------|:-:|:-:|
| `items` | `data/economy_items.json` | object | `deepMerge` | ✅ | ❌ |
| `recipes` | `data/economy_recipes.json` | array | `append` | ✅ | ❌ |
| `facilities` | `data/facility_names.json` | object | `deepMerge` | ✅ | ❌ |
| `eras` | `data/eras.json` | array | `upsertById` | ✅ | ❌ |
| `classes` | `data/classes.json` | array | `upsertById` | ✅ | ❌ |
| `biomes` | `data/biomes.json` | array | `upsertById` | ❌ | ❌ |
| `monsters` | `data/monsters.json` | array | `upsertById` | ❌ | ❌ |
| `disasters` | `data/disasters.json` | array | `upsertById` | ❌ | ❌ |
| `races` | `data/races.json` | array | `upsertById` | ❌ | ❌ |
| `professions` | `data/professions.json` | array | `upsertById` | ❌ | ❌ |
| `traits` | `data/traits.json` | array | `upsertById` | ❌ | ❌ |
| `npc_names` | `data/npc_names.json` | object | `deepMerge` | ❌ | ❌ |
| `npc_backgrounds` | `data/npc_backgrounds.json` | object | `deepMerge` | ❌ | ❌ |
| `faction_relations` | `data/faction_relations.json` | object | `deepMerge` | ❌ | ❌ |
| `world_config` | `data/world_config.json` | object | `deepMerge` | ❌ | ❌ |
| `equipment_slots` | `data/equipment_slots.json` | array | `appendUnique` | ❌ | ✅ |
| `container_types` | `data/container_types.json` | object | `deepMerge` | ❌ | ✅ |
| `ship_types` | `data/ship_types.json` | object | `deepMerge` | ❌ | ✅ |
| `diplomacy` | `data/diplomacy.json` | object | `deepMerge` | ❌ | ❌ |
| `casus_belli` | `data/casus_belli.json` | object | `deepMerge` | ❌ | ❌ |
| `furniture_catalog` | `data/furniture_catalog.json` | object | `deepMerge` | ❌ | ❌ |
| `tag_defaults` | `data/tag_defaults.json` | object | `deepMerge` | ❌ | ✅ |
| `transport_registry` | `data/transport_registry.json` | object | `deepMerge` | ✅ | ✅ |
| `trek_config` | `data/trek_config.json` | object | `deepMerge` | ✅ | ✅ |
| `narrators` | `data/narrators.json` | array | `upsertById` | ✅ | ❌ |
| `prompt_pack` | `data/prompt_pack.json` | object | `deepMerge` | ✅ | ❌ |
| `world_assets` | `data/world_assets.json` | object | `deepMerge` | ✅ | ❌ |
| `tile_dictionary` | `data/tile_dictionary.json` | object | `deepMerge` | ✅ | ❌ |
| `predefined_effects` | `assets/res/predefined_effects.json` | object | `upsertById` | ❌ | ✅ |
| `ui_runtime` | `data/ui_runtime.json` | object | `deepMerge` | ❌ | ✅ |
| `prompt_runtime` | `data/prompt_runtime.json` | object | `deepMerge` | ❌ | ✅ |
| `gameplay_runtime` | `data/gameplay_runtime.json` | object | `deepMerge` | ❌ | ✅ |
| `building_types` | `data/building_types.json` | object | `deepMerge` | ❌ | ✅ |
| `map_markers` | `data/map_markers.json` | object | `deepMerge` | ❌ | ✅ |
| `news_categories` | `data/news_categories.json` | array | `append` | ❌ | ✅ |
| `system_containers` | `data/system_containers.json` | object | `deepMerge` | ❌ | ✅ |
| `item_descriptions` | `data/item_descriptions.json` | object | `deepMerge` | ❌ | ✅ |
| `electron_runtime` | `data/electron_runtime.json` | object | `deepMerge` | ✅ | ❌ |
| `visual_assets` | `data/visual_assets.json` | object | `deepMerge` | ✅ | ❌ |
| `visual_asset_packs` | `data/visual_asset_packs.json` | object | `deepMerge` | ✅ | ❌ |
| `scene_visual_rules` | `data/scene_visual_rules.json` | object | `deepMerge` | ✅ | ❌ |
| `intent_registry` | `data/intent_registry.json` | object | `deepMerge` | ✅ | ❌ |

---

## 6. Справочник форматов данных

### 6.1 Предметы (items)

**Файл базы:** `data/economy_items.json`  
**Тип:** `object` (ключ = ID предмета)  
**Merge-политика:** `deepMerge`

> **Примечание:** Файл `data/items.json` является **устаревшим** и содержит только редирект на `economy_items.json`. Database-ключ для модов — `items`, который ссылается на `economy_items.json`.

Предметы — это фундамент экономической системы. Каждый предмет имеет ID (ключ объекта), мультиязычные названия, цену, категорию и набор тегов.

```json
{
  "item_id": {
    "names": {
      "rebirth": "Название в эпохе Возрождения",
      "architects": "Название в эпохе Архитекторов",
      "sundering": "Название в эпохе Раскола",
      "silence": "Название в эпохе Тишины"
    },
    "basePrice": 10,
    "category": "consumable",
    "tags": ["food", "consumable", "processed_food"],
    "shelfLife": 30,
    "properties": {
      "nutrition": 25.0,
      "spoil_rate": 0.1,
      "weight": 0.5,
      "isTransport": false,
      "transport_type": null,
      "speed_mult": 1.0,
      "cargo_bonus": 0
    }
  }
}
```

#### Обязательные поля

| Поле | Тип | Описание |
|------|-----|----------|
| `basePrice` | number | Базовая цена предмета в золоте |
| `category` | string | Категория предмета |
| `tags` | string[] | Массив тегов для классификации |

#### Опциональные поля

| Поле | Тип | Описание |
|------|-----|----------|
| `names` | object | Мультиязычные названия по эпохам. Ключи: `rebirth`, `architects`, `sundering`, `silence` |
| `shelfLife` | number | Срок годности в игровых днях. Отсутствие поля = не портится |
| `properties` | object | Дополнительные свойства предмета |

#### Категории предметов

| Категория | Описание | Примеры |
|-----------|----------|---------|
| `raw_food` | Сырая еда | wheat, meat, fish, honey |
| `consumable` | Потребляемые предметы | bread, smoked_meat, potions |
| `ingredient` | Ингредиенты | flour |
| `raw_material` | Сырьё | wood, stone, iron_ore, cotton, herbs |
| `magic_raw` | Магическое сырьё | ether_dust, monster_parts, dragon_bone |
| `metal_ingot` | Металлические слитки | iron_ingot, gold_ingot |
| `building` | Стройматериалы | boards |
| `cloth` | Ткань | cloth |
| `weapon` | Оружие | weapons |
| `armor` | Броня | armor |
| `tool` | Инструменты | sickle, pickaxe, axe, hammer |
| `luxury` | Предметы роскоши | jewelry, clothes, perfume, lingerie |
| `vehicle` | Транспорт | horse, warhorse, cart, wagon |
| `document` | Документы | document_order, ship_deed |

#### Транспортные предметы

Предметы с `properties.isTransport: true` являются транспортными средствами и предоставляют бонусы к перемещению:

```json
{
  "horse": {
    "names": { "rebirth": "Лошадь", "architects": "Эфирный скакун" },
    "basePrice": 500,
    "category": "vehicle",
    "tags": ["vehicle", "mount", "transport"],
    "properties": {
      "isTransport": true,
      "transport_type": "horse",
      "speed_mult": 2.0,
      "cargo_bonus": 5
    }
  }
}
```

- `speed_mult` — множитель скорости перемещения
- `cargo_bonus` — бонус к грузоподъёмности

---

### 6.2 Рецепты (recipes)

**Файл базы:** `data/economy_recipes.json`  
**Тип:** `array`  
**Merge-политика:** `append`

Рецепты определяют, какие предметы производятся на различных типах зданий. Каждый рецепт привязан к типу предприятия (facility).

```json
[
  {
    "facility": "forges",
    "inputs": { "iron_ingot": 2, "wood": 1 },
    "outputs": { "weapons": 1 }
  },
  {
    "facility": "bakeries",
    "inputs": { "flour": 1 },
    "outputs": { "bread": 2 }
  }
]
```

| Поле | Тип | Описание |
|------|-----|----------|
| `facility` | string | ID типа здания, где производится предмет (соответствует ключам из `building_types`) |
| `inputs` | object | Входящие предметы: ключ = ID предмета, значение = количество |
| `outputs` | object | Результат: ключ = ID предмета, значение = количество |

Один и тот же `facility` может иметь несколько рецептов (например, `forges` производит и оружие, и броню, и инструменты).

---

### 6.3 Расы (races)

**Файл базы:** `data/races.json`  
**Тип:** `array`  
**Merge-политика:** `upsertById`

```json
[
  {
    "id": "human",
    "name": "Человек",
    "base_race": true,
    "faction_preference": ["aquilon", "crimson", "consortium"],
    "biome_preference": "plains",
    "stat_modifiers": { "str": 1, "dex": 1, "int": 1, "con": 1, "cha": 1 },
    "class_stats": {
      "warrior": { "str": 13, "dex": 10, "int": 8, "con": 12, "cha": 9, "res": 12 },
      "mage": { "str": 8, "dex": 11, "int": 13, "con": 9, "cha": 11, "res": 8 },
      "default": { "str": 10, "dex": 10, "int": 10, "con": 10, "cha": 10, "res": 10 }
    }
  }
]
```

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | string | Уникальный идентификатор расы |
| `name` | string | Отображаемое название |
| `base_race` | boolean | Является ли расой по умолчанию (только `human`) |
| `faction_preference` | string[] | Фракции, к которым раса тяготеет |
| `biome_preference` | string | Предпочитаемый биом (ID из biomes.json) |
| `stat_modifiers` | object | Модификаторы характеристик расы |
| `class_stats` | object | Базовые статы для каждого класса. Ключ `default` обязателен |

#### Характеристики (stats)

| Ключ | Описание |
|------|----------|
| `str` | Сила |
| `dex` | Ловкость |
| `int` | Интеллект |
| `con` | Выносливость |
| `cha` | Харизма |
| `res` | Сопротивление |

Класс `default` в `class_stats` используется, когда класс персонажа не имеет специальной записи.

---

### 6.4 Классы (classes)

**Файл базы:** `data/classes.json`  
**Тип:** `array`  
**Merge-политика:** `upsertById`

```json
[
  {
    "id": "warrior",
    "name": "Воин",
    "stat_modifiers": { "str": 3, "con": 2 },
    "base_stats": { "str": 13, "dex": 10, "int": 8, "con": 12, "cha": 9, "res": 12 },
    "starting_items": { "weapons": 1, "armor": 1, "potions": 1 },
    "special_abilities": ["melee_combat", "shield_block"],
    "display_name_i18n_key": "characterCreation.classes.warrior"
  }
]
```

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | string | Уникальный идентификатор класса |
| `name` | string | Отображаемое название |
| `stat_modifiers` | object | Бонусы к характеристикам от класса |
| `base_stats` | object | Базовые характеристики класса |
| `starting_items` | object | Стартовые предметы: ключ = ID предмета, значение = количество |
| `special_abilities` | string[] | Специальные способности класса |
| `display_name_i18n_key` | string | Ключ локализации для отображаемого названия |

---

### 6.5 Эпохи (eras)

**Файл базы:** `data/eras.json`  
**Тип:** `array`  
**Merge-политика:** `upsertById`

```json
[
  {
    "id": "rebirth",
    "name": "Возрождение",
    "start_year": 1042,
    "default_location_file": "locations_rebirth.json",
    "display_name_i18n_key": "characterCreation.eraRebirth",
    "description_i18n_key": "characterCreation.eraRebirthDesc"
  }
]
```

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | string | Уникальный идентификатор эпохи |
| `name` | string | Отображаемое название |
| `start_year` | number | Стартовый год эпохи |
| `default_location_file` | string | Файл с локациями по умолчанию для эпохи |
| `display_name_i18n_key` | string | Ключ локализации названия |
| `description_i18n_key` | string | Ключ локализации описания |

Базовые эпохи: `rebirth` (Возрождение), `architects` (Архитекторы), `sundering` (Раскол), `silence` (Тишина).

---

### 6.6 Биомы (biomes)

**Файл базы:** `data/biomes.json`  
**Тип:** `array`  
**Merge-политика:** `upsertById`

```json
[
  {
    "id": "plains",
    "name": "Равнины",
    "numeric_id": 3,
    "color_hex": "#2ecc71",
    "movement_cost": 1,
    "is_water": false,
    "is_impassable": false,
    "tags": ["land", "plains"],
    "resources": ["wheat", "cotton", "wood", "meat"],
    "gen_rules": {
      "min_elev": 0.05,
      "max_elev": 0.45,
      "min_temp": 0.35,
      "max_temp": 0.65,
      "min_moist": 0.0,
      "max_moist": 0.55
    }
  }
]
```

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | string | Уникальный строковый идентификатор |
| `name` | string | Отображаемое название |
| `numeric_id` | number | Числовой ID для генерации карты |
| `color_hex` | string | Цвет на карте (HEX) |
| `movement_cost` | number | Стоимость перемещения (9999 = непроходимо) |
| `is_water` | boolean | Является ли водным биомом |
| `is_impassable` | boolean | Непроходимый ли биом |
| `tags` | string[] | Теги биома |
| `resources` | string[] | ID предметов, которые можно добыть в этом биоме |
| `gen_rules` | object | Правила процедурной генерации (диапазоны elevation, temperature, moisture) |

**Правила генерации (`gen_rules`):** Определяют, при каких значениях Perlin noise биом появляется. Значения `min_elev: 2.0, max_elev: 2.0` означают, что биом не генерируется процедурно (ручное размещение: руины, аномалии, реки, вулканы).

---

### 6.7 Монстры (monsters)

**Файл базы:** `data/monsters.json`  
**Тип:** `array`  
**Merge-политика:** `upsertById`

```json
[
  {
    "id": "dragon",
    "name": "Древний Дракон",
    "base_hp": 1000,
    "base_attack": 50,
    "base_defense": 30,
    "spawn_biome_tag": "mountain",
    "corrupt_biome_to": "ash",
    "loot_table_id": "dragon_hoard",
    "loot_drops": [
      { "item_id": "dragon_scale", "min": 2, "max": 5, "chance": 1.0 },
      { "item_id": "dragon_bone", "min": 1, "max": 3, "chance": 0.8 },
      { "item_id": "gold_ingot", "min": 200, "max": 500, "chance": 1.0 }
    ]
  }
]
```

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | string | Уникальный идентификатор монстра |
| `name` | string | Отображаемое название |
| `base_hp` | number | Базовое здоровье |
| `base_attack` | number | Базовая атака |
| `base_defense` | number | Базовая защита |
| `spawn_biome_tag` | string | Тег биома, в котором спавнится монстр |
| `corrupt_biome_to` | string | В какой биом превращается область вокруг монстра |
| `loot_table_id` | string | ID таблицы лута |
| `loot_drops` | array | Массив дропа с предметами, количеством и шансом |

**Loot drop:**

| Поле | Тип | Описание |
|------|-----|----------|
| `item_id` | string | ID предмета из `economy_items.json` |
| `min` | number | Минимальное количество |
| `max` | number | Максимальное количество |
| `chance` | number | Шанс выпадения (0.0–1.0) |

---

### 6.8 Профессии (professions)

**Файл базы:** `data/professions.json`  
**Тип:** `array`  
**Merge-политика:** `upsertById`

```json
[
  {
    "id": "blacksmith",
    "name": "Кузнец",
    "profession_type": "artisan",
    "preferred_facility": "forges",
    "tool_tag": "hammer",
    "tool_chance": 5,
    "production_type": "crafts",
    "demand_pattern": { "base_demand": 8 },
    "job_multiplier": 1.0,
    "special_abilities": ["crafting", "metalwork"],
    "display_name_i18n_key": "professions.blacksmith"
  }
]
```

| Поле | Тип | Обяз. | Описание |
|------|-----|:-----:|----------|
| `id` | string | ✅ | Уникальный идентификатор |
| `name` | string | ✅ | Отображаемое название |
| `profession_type` | string | ✅ | Тип профессии (artisan, farmer, mercenary, merchant, mage, innkeeper, cleric, courier, clerk, gatherer, fisherman, sailor, pirate, shipwright, admiral, general, commander) |
| `preferred_facility` | string | ✅ | Предпочитаемое здание (ID из building_types) |
| `tool_tag` | string | ❌ | Тег необходимого инструмента |
| `tool_chance` | number | ❌ | Шанс (%) наличия инструмента |
| `production_type` | string | ✅ | Тип продукции (food, crafts, military, trade, services, logistics, raw, transport) |
| `demand_pattern` | object | ✅ | Паттерн спроса: `base_demand` (фиксированный) или `per_population` (на единицу населения) или `base_race` (базовый для расы) |
| `job_multiplier` | number | ✅ | Множитель количества рабочих мест |
| `special_abilities` | string[] | ✅ | Способности профессии |
| `display_name_i18n_key` | string | ✅ | Ключ локализации |

---

### 6.9 Черты характера (traits)

**Файл базы:** `data/traits.json`  
**Тип:** `array`  
**Merge-политика:** `upsertById`

```json
[
  { "id": "greedy", "name": "Жадный", "personality_bias": { "greed": 20 }, "tags": [] },
  { "id": "brave", "name": "Храбрый", "personality_bias": { "aggression": 15, "loyalty": 10 }, "tags": [] },
  { "id": "mercantile", "name": "Торговый", "personality_bias": { "greed": 10, "sociability": 10 }, "tags": ["merchant"] }
]
```

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | string | Уникальный идентификатор черты |
| `name` | string | Отображаемое название |
| `personality_bias` | object | Смещения параметров личности NPC |
| `tags` | string[] | Теги для привязки к профессиям |

**Параметры личности (personality_bias):**

| Ключ | Описание |
|------|----------|
| `greed` | Жадность |
| `aggression` | Агрессия |
| `loyalty` | Верность |
| `lust` | Похоть |
| `sociability` | Общительность |

---

### 6.10 Имена NPC (npc_names)

**Файл базы:** `data/npc_names.json`  
**Тип:** `object`  
**Merge-политика:** `deepMerge`

```json
{
  "races": {
    "human": {
      "first_names": ["Аларик", "Борн", "Валтер", "Элиза", "Лиара"],
      "last_names": ["Блэкуотер", "Свифт", "Айронсайд"]
    },
    "elf": {
      "first_names": ["Эларион", "Фаэлан", "Аравель"],
      "last_names": ["Сребролист", "Шепот Ветра"]
    }
  },
  "faction_to_race": {
    "khazadrim": "dwarf",
    "sylvanesti": "elf",
    "aquilon": "human"
  },
  "backgrounds": {
    "poor": ["Родился в трущобах...", "Сын разорившегося фермера..."],
    "middle": ["Подмастерье кузнеца...", "Бывший стражник..."],
    "rich": ["Наследник торгового дома...", "Получил блестящее образование..."],
    "insane": ["Слышит голоса из Разлома...", "Пережил Эфирную бурю..."]
  }
}
```

| Секция | Описание |
|--------|----------|
| `races` | Имена по расам: `first_names` и `last_names` |
| `faction_to_race` | Маппинг фракция → раса для генерации NPC |
| `backgrounds` | Предыстории NPC по социальному классу |

---

### 6.11 Фракции и отношения (faction_relations)

**Файл базы:** `data/faction_relations.json`  
**Тип:** `object`  
**Merge-политика:** `deepMerge`

```json
{
  "faction_biome_preference": {
    "khazadrim": "mountains",
    "sylvanesti": "forest",
    "aquilon": "plains"
  },
  "faction_corrupt_biome": {
    "sylvanesti": "swamp",
    "shattered_sky": "anomaly"
  },
  "faction_base_relations": {
    "rebirth": [
      { "f1": "aquilon", "f2": "sylvanesti", "modifier": -30 },
      { "f1": "crimson", "f2": "gronnar", "modifier": -60 }
    ]
  }
}
```

| Секция | Описание |
|--------|----------|
| `faction_biome_preference` | Предпочитаемый биом для каждой фракции |
| `faction_corrupt_biome` | В какой биом деградирует территория фракции |
| `faction_base_relations` | Базовые отношения между фракциями по эпохам |

**Отношения:** Модификатор от -100 (вражда) до +100 (союз). Значения ниже -50 обычно ведут к войне.

---

### 6.12 Дипломатия (diplomacy)

**Файл базы:** `data/diplomacy.json`  
**Тип:** `object`  
**Merge-политика:** `deepMerge`

```json
{
  "states": [
    { "id": "peace", "name": "Мир", "name_i18n_key": "diplomacy.states.peace", "level": 0, "allow_trade": true, "allow_passage": true },
    { "id": "total_war", "name": "Тотальная война", "name_i18n_key": "diplomacy.states.total_war", "level": 7, "allow_trade": false, "allow_passage": false }
  ]
}
```

| Поле состояния | Описание |
|----------------|------------|
| `id` | Уникальный идентификатор |
| `name` | Отображаемое название |
| `name_i18n_key` | Ключ локализации (опционально) |
| `level` | Уровень напряжённости (0 = мир, 7 = тотальная война) |
| `allow_trade` | Разрешена ли торговля |
| `allow_passage` | Разрешено ли прохождение войск |

**Базовые состояния:** peace, non_aggression_pact, defensive_alliance, full_alliance, cold_war, border_conflict, limited_war, total_war

---

### 6.13 Касусы белли (casus_belli)

**Файл базы:** `data/casus_belli.json`  
**Тип:** `object`  
**Merge-политика:** `deepMerge`

```json
{
  "types": [
    { "id": "none", "name": "Нет", "name_i18n_key": "diplomacy.casusBelli.none", "effects": {} },
    { "id": "border_incident", "name": "Пограничный инцидент", "name_i18n_key": "diplomacy.casusBelli.borderIncident", "effects": { "aggression_cost_modifier": 0.5 } },
    { "id": "imperialism", "name": "Империализм", "name_i18n_key": "diplomacy.casusBelli.imperialism", "effects": { "aggression_cost_modifier": 1.0 } }
  ]
}
```

| Поле типа | Описание |
|-----------|----------|
| `id` | Уникальный идентификатор (включая `"none"` — отсутствие касуса) |
| `name` | Отображаемое название |
| `name_i18n_key` | Ключ локализации |
| `effects` | Эффекты при объявлении войны |
| `effects.aggression_cost_modifier` | Множитель стоимости агрессии (0.25 = 75% скидка, 1.0 = без скидки) |

---

### 6.14 Типы зданий (building_types)

**Файл базы:** `data/building_types.json`  
**Тип:** `object`  
**Merge-политика:** `deepMerge`

```json
{
  "forge": { "mini_char": "F", "color": "#95a5a6", "name_i18n_key": "facilities.forge" },
  "forges": { "mini_char": "F", "color": "#95a5a6", "name_i18n_key": "facilities.forge" },
  "market": { "mini_char": "M", "color": "#f1c40f", "name_i18n_key": "facilities.market" }
}
```

| Поле | Описание |
|------|----------|
| `mini_char` | Символ для мини-карты |
| `color` | Цвет на карте (HEX) |
| `name_i18n_key` | Ключ локализации названия |

---

### 6.15 Конфигурация мира (world_config)

**Файл базы:** `data/world_config.json`  
**Тип:** `object`  
**Merge-политика:** `deepMerge`

```json
{
  "map_width": 256,
  "map_height": 256,
  "landform": "continent",
  "continent": {
    "noise_frequency": 2.5,
    "noise_octaves": 6,
    "elevation_shift": 0.3,
    "edge_falloff_power": 2.0,
    "edge_falloff_range": 0.6,
    "edge_ocean_elevation": -0.5,
    "min_land_ratio": 0.5,
    "connectivity_pass": true,
    "land_bridge_max_gap": 4,
    "remove_islands_under": 80,
    "smoothing_passes": 2
  },
  "rivers": {
    "noise_frequency": 3.0,
    "noise_octaves": 3,
    "threshold_default": 0.02
  },
  "volcanoes": { "count": 5, "min_radius": 3, "max_radius": 6 },
  "default_era": "rebirth",
  "months": [ { "id": "morning_star", "name_i18n_key": "months.morningStar" } ],
  "time_periods": [ { "id": "night", "start_hour": 22, "end_hour": 6 } ]
}
```

| Секция | Описание |
|--------|----------|
| `continent` | Параметры генерации континента (Perlin noise) |
| `rivers` | Параметры генерации рек |
| `volcanoes` | Количество и размер вулканов |
| `months` | Игровые месяцы (12 штук) |
| `time_periods` | Временные периоды суток (night, morning, day, evening) |
| `biomes_legacy_numeric_ids` | Порядок биомов для совместимости |

---

### 6.16 Локации (locations)

**Файлы базы:** `data/locations_rebirth.json`, `data/locations_architects.json`, `data/locations_sundering.json`, `data/locations_silence.json`  
**Тип:** `object` (ключ = ID локации)  
**Определяется эпохой:** каждая эпоха указывает свой `default_location_file`

```json
{
  "capital_aquilon": {
    "name": "Capital Aquilon",
    "type": "city",
    "description": "Огромный город, сердце Империи...",
    "placement": "center",
    "x": 0,
    "y": 0,
    "no_road": false,
    "points_of_interest": ["Imperial Palace", "College of Imperial Mages"],
    "current_issues": ["Political intrigues"],
    "legends": ["Legend of the Sleeping Guardian"]
  }
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `name` | string | Название локации |
| `type` | string | Тип: `city`, `village`, `ruins`, `anomaly`, `camp`, `observatory` |
| `description` | string | Описание локации |
| `placement` | string | Тип размещения на карте (center, forest, mountain, desert, coast, water) |
| `x` | number | Координата X |
| `y` | number | Координата Y |
| `no_road` | boolean | Если true, к локации не ведут дороги |
| `points_of_interest` | string[] | Точки интереса |
| `current_issues` | string[] | Текущие проблемы |
| `legends` | string[] | Легенды и слухи |

---

### 6.17 Слоты экипировки (equipment_slots)

**Файл базы:** `data/equipment_slots.json`  
**Тип:** `array`  
**Merge-политика:** `appendUnique`

```json
["head", "face", "neck", "shoulders", "torso", "right_hand", "left_hand", "legs", "feet"]
```

Мод может добавить новые слоты экипировки, но существующие слоты не будут дублироваться.

---

### 6.18 Теги по умолчанию (tag_defaults)

**Файл базы:** `data/tag_defaults.json`  
**Тип:** `object`  
**Merge-политика:** `deepMerge`

Маппинг тегов к предметам по умолчанию. Используется движком для поиска «типичного» предмета категории:

```json
{
  "food": "bread",
  "raw_food": "meat",
  "currency": "gold_ingot",
  "weapon": "weapons",
  "tax_goods_list": ["wheat", "meat"],
  "brothel_luxury_goods": ["aphrodisiac", "lingerie"],
  "reserve_priority": "bread",
  "army_supply_priority": "smoked_meat"
}
```

---

### 6.19 Рассказчики (narrators)

**Файл базы:** `data/narrators.json`  
**Тип:** `array`  
**Merge-политика:** `upsertById`

```json
[
  {
    "id": "elara",
    "name": "Элара, Летописец",
    "description": "Мудрая и беспристрастная хранительница историй...",
    "image": "assets/narrators/elara.jpg",
    "promptFile": "assets/narrators/style_elara.txt"
  }
]
```

| Поле | Описание |
|------|----------|
| `id` | Уникальный идентификатор |
| `name` | Название рассказчика |
| `description` | Описание стиля повествования |
| `image` | Путь к изображению-аватару |
| `promptFile` | Путь к файлу с промптом стиля для AI |

---

### 6.20 Промпты AI (prompt_pack)

**Файл базы:** `data/prompt_pack.json`  
**Тип:** `object`  
**Merge-политика:** `deepMerge`

Определяет банк промптов, отправляемых AI. Каждый промпт может ссылаться на внешний файл:

```json
{
  "entries": {
    "master_instructions": { "path": "assets/prompts/1.txt" },
    "combat_system_rules": { "path": "assets/prompts/combat_system_rules.txt" },
    "era_lore.rebirth": { "path": "assets/prompts/epo_DC/rebirth.txt" },
    "initial_prompt.rebirth": { "path": "assets/prompts/initial_prompt_rebirth.txt" }
  },
  "aliases": {
    "assets/prompts/1.txt": "master_instructions"
  }
}
```

**Секции промптов:**
- `master_instructions` — мастер-инструкции
- `game_loop` — промпт игрового цикла
- `combat_system_rules` — правила боевой системы
- `era_lore.*` — лор по эпохам (rebirth, architects, sundering, silence)
- `initial_prompt.*` — начальные промпты по эпохам
- `deep_setup.*` — промпты глубокой настройки мира (5 стадий)
- `narrative_rules`, `style_rules`, `logic_rules` — правила повествования
- `nsfw_rules_advanced` — правила 18+ контента
- `summarize_memory` — промпт суммаризации памяти
- `supreme_gm_style` — стиль Гейм-Мастера
- `command_reference`, `skills_reference` — справочники команд и навыков

Моды могут добавлять новые промпты или перезаписывать существующие через deepMerge.

---

### 6.21 Маркеры карты (map_markers)

**Файл базы:** `data/map_markers.json`  
**Тип:** `object`  
**Merge-политика:** `deepMerge`

Определяет маркеры, отображаемые на глобальной карте.

---

### 6.22 Словарь тайлов (tile_dictionary)

**Файл базы:** `data/tile_dictionary.json`  
**Тип:** `object`  
**Merge-политика:** `deepMerge`

Маппинг типов тайлов для рендеринга карты.

---

### 6.23 Типы кораблей (ship_types)

**Файл базы:** `data/ship_types.json`  
**Тип:** `object`  
**Merge-политика:** `deepMerge`

Определяет доступные типы кораблей для морских путешествий и сражений, а также типы портов.

```json
{
  "ship_types": [
    { "id": "caravel", "name": "Каравелла", "name_i18n_key": "ships.caravel", "speed": 3, "capacity": 50, "combat_power": 10, "is_monster": false }
  ],
  "port_types": [
    { "id": "harbor", "name": "Гавань", "name_i18n_key": "ports.harbor" }
  ]
}
```

| Поле корабля | Тип | Описание |
|--------------|-----|----------|
| `id` | string | Уникальный идентификатор |
| `name` | string | Отображаемое название |
| `name_i18n_key` | string | Ключ локализации |
| `speed` | number | Скорость корабля |
| `capacity` | number | Грузоподъёмность |
| `combat_power` | number | Боевая мощь |
| `is_monster` | boolean | Является ли морским чудовищем |

| Поле порта | Тип | Описание |
|------------|-----|----------|
| `id` | string | Уникальный идентификатор |
| `name` | string | Отображаемое название |
| `name_i18n_key` | string | Ключ локализации |

---

### 6.24 Транспортный реестр (transport_registry)

**Файл базы:** `data/transport_registry.json`  
**Тип:** `object`  
**Merge-политика:** `deepMerge`  
**Replace при TC:** ✅  
**Load при TC:** ✅

Реестр всех типов транспорта с их характеристиками.

---

### 6.25 Конфиг путешествий (trek_config)

**Файл базы:** `data/trek_config.json`  
**Тип:** `object`  
**Merge-политика:** `deepMerge`  
**Replace при TC:** ✅  
**Load при TC:** ✅

Настройки путешествий: скорость, расход ресурсов, случайные встречи.

---

### 6.26 Контейнеры (container_types / system_containers)

**Файлы базы:** `data/container_types.json`, `data/system_containers.json`  
**Тип:** `object`  
**Merge-политика:** `deepMerge`

Определяют типы контейнеров (инвентарь, сундук, склад) и системные контейнеры.

---

### 6.27 Каталог мебели (furniture_catalog)

**Файл базы:** `data/furniture_catalog.json`  
**Тип:** `object`  
**Merge-политика:** `deepMerge`

Мебель и объекты интерьера для зданий и локаций.

---

### 6.28 Описания предметов (item_descriptions)

**Файл базы:** `data/item_descriptions.json`  
**Тип:** `object`  
**Merge-политика:** `deepMerge`

Расширенные текстовые описания предметов для AI и UI.

---

### 6.29 Категории новостей (news_categories)

**Файл базы:** `data/news_categories.json`  
**Тип:** `array`  
**Merge-политика:** `append`

Категории мировых новостей (война, торговля, катастрофы и т.д.).

---

### 6.30 Интенты (intent_registry)

**Файл базы:** `data/intent_registry.json`  
**Тип:** `object`  
**Merge-политика:** `deepMerge`

Реестр намерений (интентов) — действий, которые игрок может совершить в игре. Определяет, как AI обрабатывает команды игрока.

---

### 6.31 Визуальные ассеты

**Файлы:**
- `data/visual_assets.json` — визуальные ассеты мира
- `data/visual_asset_packs.json` — паки визуальных ассетов
- `data/scene_visual_rules.json` — правила визуализации сцен

Определяют, какие изображения и визуальные элементы отображаются в различных игровых ситуациях.

---

### 6.32 Runtime-конфиги

**Файлы:**
- `data/ui_runtime.json` — конфигурация UI (таймауты, анимации, пороги)
- `data/prompt_runtime.json` — конфигурация промптов AI (лимиты, температуры)
- `data/gameplay_runtime.json` — конфигурация геймплея (баланс, множители)
- `data/electron_runtime.json` — конфигурация Electron (размер окна, CSP, таймауты)

Все являются `object` с merge-политикой `deepMerge` и загружаются при Total Conversion.

---

## 7. JS ModAPI — скриптовые моды

JS-моды выполняются в изолированной песочнице и имеют доступ к `ModAPI` — объекту с методами для взаимодействия с игрой.

### 7.1 Жизненный цикл мода

```
1. ModLoader обнаруживает мод и читает mod.json
2. Валидируются метаданные (id, name, version)
3. Код скрипта сканируется на опасные паттерны
4. Создаётся песочница (with + Proxy)
5. Код выполняется в песочнице
6. Мод регистрирует хуки и команды через ModAPI
7. После загрузки всех модов вызывается хук onModsInitialized
```

### 7.2 Система хуков (событий)

Хуки — это события, на которые мод может подписаться. Подписка осуществляется через `ModAPI.on(eventName, callback)`.

#### Хуки загрузки

| Событие | Описание |
|---------|----------|
| `onDatabaseLoad` | Вызывается после сборки Runtime Database, но до валидации. Мод может модифицировать `database` |
| `onModsInitialized` | Вызывается после загрузки и инициализации всех модов. Основное место для логики мода |

#### Хуки движка (C++ → JS)

Эти хуки вызываются C++ движком симуляции через IPC:

| Событие | Данные | Описание |
|---------|--------|----------|
| `onNpcDied` | npc_id, cause | NPC умер |
| `onNpcBorn` | npc_id | NPC родился |
| `onNpcJobChanged` | npc_id, old_job, new_job | NPC сменил профессию |
| `onRulerDied` | faction_id, ruler_id | Правитель фракции умер |
| `onArmyCreated` | faction_id, region_id, size | Армия создана |
| `onArmyMoved` | faction_id, from, to | Армия переместилась |
| `onArmyDestroyed` | faction_id, region_id | Армия уничтожена |
| `onSiegeStarted` | faction_id, region_id | Началась осада |
| `onRegionCaptured` | region_id, old_faction, new_faction | Регион захвачен |
| `onWarDeclared` | f1, f2 | Объявлена война |
| `onPeaceMade` | f1, f2 | Заключён мир |
| `onRelationsChanged` | f1, f2, new_value | Изменились отношения |
| `onFacilityUpgraded` | region_id, facility_type | Здание улучшено |
| `onFacilityDestroyed` | region_id, facility_type | Здание уничтожено |
| `onFleetCreated` | faction_id, region_id | Флот создан |
| `onShipDestroyed` | faction_id, ship_id | Корабль уничтожен |
| `onPortBuilt` | region_id | Построен порт |
| `onRevoltStarted` | region_id | Начался бунт |
| `onFamineStarted` | region_id | Начался голод |
| `onMonsterSpawned` | monster_id, region_id | Заспавнен монстр |
| `onDisasterTriggered` | disaster_id, region_id | Сработала катастрофа |
| `onGlobalEvent` | event_type, data | Глобальное событие |
| `onIntrigueDiscovered` | faction_id, intrigue_id | Раскрыта интрига |
| `onTradeCompleted` | from, to, item, quantity | Завершена торговля |
| `onBanditEncounter` | region_id | Встреча с бандитами |
| `onSeasonChanged` | new_season | Сменился сезон |
| `onWeatherChanged` | region_id, new_weather | Изменилась погода |
| `onBeforeDailyTick` | day | Перед дневным тиком |
| `onAfterDailyTick` | day | После дневного тика |
| `onBeforeHourlyTick` | day, hour | Перед часовым тиком |
| `onAfterHourlyTick` | day, hour | После часового тика |

#### Поздняя подписка

Если мод подписывается на `onModsInitialized` после того, как событие уже произошло, callback вызывается немедленно. Это гарантирует, что моды, загруженные с задержкой, корректно инициализируются.

### 7.3 Справочник ModAPI

#### Подписка на события

##### `ModAPI.on(eventName, callback)`

Подписывает callback на событие. Если callback регистрируется в контексте мода, к нему привязывается `__modId` для отслеживания ошибок.

```javascript
ModAPI.on('onModsInitialized', async () => {
    console.log('Все моды загружены!');
});

ModAPI.on('onNpcDied', async (data) => {
    console.log('NPC умер:', data);
});

ModAPI.on('onDatabaseLoad', async (database) => {
    // Модифицируем базу данных перед валидацией
    if (database.items) {
        database.items.custom_item = { basePrice: 1, category: "misc", tags: ["custom"] };
    }
});
```

##### `ModAPI.unregisterHook(eventName, callback)`

Отписывает callback от события.

```javascript
const handler = async (data) => { /* ... */ };
ModAPI.on('onAfterDailyTick', handler);
// Позже:
ModAPI.unregisterHook('onAfterDailyTick', handler);
```

#### Кастомные команды

##### `ModAPI.addCommand(commandName, handler, docs)`

Регистрирует кастомную ГМ-команду, которую игрок может использовать в чате.

```javascript
ModAPI.addCommand('my_command', (args) => {
    // Обработка команды
    return { success: true, message: 'Команда выполнена!' };
}, {
    name: 'my_command',
    description: 'Описание кастомной команды',
    usage: '/my_command <аргумент>'
});
```

##### `ModAPI.removeCommand(commandName)`

Удаляет кастомную команду.

#### AI-промпты

##### `ModAPI.addPromptInjection(text)`

Добавляет текст в системный промпт, отправляемый AI. Лимит — 2000 символов; длинный текст обрезается с предупреждением.

```javascript
ModAPI.addPromptInjection('В этом мире магия огня запрещена. Все огненные заклинания наказуемы.');
```

##### `ModAPI.addPromptFilter(callback)`

Фильтр, вызываемый перед отправкой промпта AI. Может модифицировать текст.

```javascript
ModAPI.addPromptFilter((promptText) => {
    return promptText.replace(/золото/g, 'серебро');
});
```

##### `ModAPI.addResponseFilter(callback)`

Фильтр, вызываемый после получения ответа от AI. Может модифицировать ответ.

```javascript
ModAPI.addResponseFilter((responseText) => {
    // Цензура или модификация ответа AI
    return responseText;
});
```

##### `ModAPI.addTextFilter(callback)`

Глобальный текстовый фильтр, применяемый ко всему отображаемому тексту.

```javascript
ModAPI.addTextFilter((text) => {
    return text.toUpperCase(); // пример: все заглавными
});
```

##### `ModAPI.applyTextFilters(text)`

Применяет все зарегистрированные текстовые фильтры. Вызывается автоматически игрой.

#### Monkey-patching

##### `ModAPI.patchFunction(obj, funcName, patchCallback)`

Заменяет функцию на патченную. Оригинальная функция доступна через первый аргумент.

```javascript
ModAPI.patchFunction(window, 'updateCharacterSheet', (original, ...args) => {
    // Вызываем оригинал
    original(...args);
    // Добавляем свою логику
    console.log('Характеристики обновлены!');
});
```

##### `ModAPI.unpatchFunction(obj, funcName)`

Восстанавливает оригинальную функцию из сохранённой копии.

> **Ограничение:** Оригиналы хранятся по ключу `funcName` (без привязки к объекту). Если пропатчить методы с одинаковыми именами на разных объектах, `unpatchFunction` восстановит только последний.

#### UI

##### `ModAPI.addUI(htmlString, targetSelector = 'body')`

Добавляет HTML-элемент в указанный контейнер. По умолчанию `targetSelector = 'body'`. HTML проходит санитизацию (удаляются script, iframe, on*-обработчики и т.д., полный список см. в разделе 7.5).

```javascript
ModAPI.addUI(
    '<div data-mod-owner="my_mod" class="my-panel"><h3>Моя панель</h3><p>Контент</p></div>',
    '#game-sidebar'
);
```

##### `ModAPI.addStyle(idOrCss, cssString?)`

Добавляет CSS-стиль. Первый параметр `idOrCss` имеет двойное назначение:
- Если передан **один аргумент** — он воспринимается как CSS-строка, ID генерируется автоматически
- Если передано **два аргумента** — первый это ID стиля, второй — CSS-строка

Если стиль с таким ID уже существует, он заменяется.

```javascript
// С явным ID (рекомендуется — позволяет удалить через removeStyle):
ModAPI.addStyle('my_mod_styles', `
    .my-panel { background: #1a1a2e; border: 1px solid #e94560; padding: 10px; }
    .my-panel h3 { color: #e94560; }
`);

// Без ID (автогенерация):
ModAPI.addStyle('.my-panel { color: red; }');
```

##### `ModAPI.removeStyle(id)`

Удаляет CSS-стиль по ID.

##### `ModAPI.addSettingsTab(tabId, tabTitle, htmlContent)`

Добавляет вкладку в настройки игры. HTML проходит санитизацию.

```javascript
ModAPI.addSettingsTab('my_mod_settings', 'Мой мод', `
    <div class="setting-group">
        <label>Включить фичу</label>
        <input type="checkbox" id="my_mod_feature">
    </div>
`);
```

#### Горячие клавиши

##### `ModAPI.registerHotkey(keyCombo, callback)`

Регистрирует горячую клавишу. `keyCombo` — строка вида `"ctrl+shift+k"`.

```javascript
ModAPI.registerHotkey('ctrl+m', () => {
    console.log('Ctrl+M нажата!');
});
```

##### `ModAPI.unregisterHotkey(keyCombo)`

Удаляет горячую клавишу.

#### Локализация

##### `ModAPI.addTranslations(lang, translationsObj)`

Добавляет переводы для указанного языка. Сливаются глубоко с существующими.

```javascript
ModAPI.addTranslations('ru', {
    my_mod: {
        title: 'Мой мод',
        description: 'Описание моего мода'
    }
});
```

##### `ModAPI.setString(lang, path, value)`

Устанавливает конкретную строку локализации по пути (через точку).

```javascript
ModAPI.setString('ru', 'my_mod.title', 'Новое название');
```

#### Сохранения

##### `ModAPI.registerSaveData(modId, onSaveCallback, onLoadCallback)`

Регистрирует обработчики сохранения/загрузки данных мода.

```javascript
let modState = { counter: 0, unlockedItems: [] };

ModAPI.registerSaveData('my_mod',
    () => JSON.parse(JSON.stringify(modState)),  // onSave: вернуть сериализуемые данные
    (data) => { modState = data || { counter: 0, unlockedItems: [] }; }  // onLoad: восстановить
);
```

##### `ModAPI.removeSaveHandler(modId)`

Удаляет обработчик сохранения для мода.

#### Связь с C++ движком

##### `async ModAPI.sendToEngine(command, args)`

Отправляет команду ГМ-вмешательства в C++ движок через IPC. Возвращает `Promise`.

```javascript
const result = await ModAPI.sendToEngine('spawn_monster', {
    monster_type: 'dragon',
    region_id: 'mountains_01'
});
```

##### `async ModAPI.sendRawToEngine(command, args)`

Отправляет сырую команду в C++ движок (более низкоуровневый доступ). Возвращает `Promise`.

```javascript
const result = await ModAPI.sendRawToEngine('query_region', { region_id: 'capital_aquilon' });
```

#### Чтение файлов мода

##### `async ModAPI.readFile(modId, fileName)`

Читает файл из папки мода через безопасный IPC-канал. Возвращает `Promise<string|null>` — содержимое файла или `null` при ошибке.

```javascript
const content = await ModAPI.readFile('my_mod', 'data/config.json');
```

##### `async ModAPI.readJson(modId, fileName)`

Читает и парсит JSON-файл из папки мода. Возвращает `Promise<object|null>` — распарсенный объект или `null` при ошибке (невалидный JSON, файл не найден).

```javascript
const config = await ModAPI.readJson('my_mod', 'data/config.json');
if (config) {
    console.log('Конфиг загружен:', config);
}
```

#### Уведомления

##### `ModAPI.notify(message, type = 'system-message')`

Выводит уведомление в игровой лог. Параметр `type` по умолчанию `'system-message'`.

```javascript
ModAPI.notify('Мод загружен!', 'system-message');
ModAPI.notify('Ошибка!', 'error');
```

#### Управление модами

##### `ModAPI.unloadMod(modId)`

Полностью выгружает мод: удаляет стили, UI-элементы, обработчики сохранений, команды, горячие клавиши.

##### `async ModAPI.emit(eventName, ...args)`

Асинхронно вызывает все зарегистрированные хуки для события. Используется внутренне игрой, но доступна и для кастомных событий между модами.

**Важно:** Если callback хука выбрасывает ошибку, она логируется через `RuntimeLog`, и мод с известным `__modId` может быть **автоматически отключён** через `ModRuntimeGuard.disableBrokenMod()`. Поэтому обрабатывайте ошибки внутри хуков.

#### Свойства ModAPI (только чтение)

| Свойство | Тип | Описание |
|----------|------|------------|
| `ModAPI.initialized` | boolean | `true`, если ModAPI прошёл инициализацию |
| `ModAPI.isTotalConversion` | boolean | `true`, если загружен мод-тотальная конверсия |
| `ModAPI.apiVersion` | string | Версия API (`'2.0'`) |
| `ModAPI.mods` | object | Реестр загруженных модов (ключ = modId) |
| `ModAPI.hooks` | object | Все зарегистрированные хуки (ключ = eventName) |
| `ModAPI.customCommands` | object | Зарегистрированные кастомные команды |
| `ModAPI.commandDocs` | array | Документация кастомных команд |
| `ModAPI.hotkeys` | object | Зарегистрированные горячие клавиши |

#### Утилиты

##### `ModAPI.mergeDeep(target, ...sources)`

Рекурсивное глубокое слияние объектов. Полезно для слияния конфигураций.

```javascript
const merged = ModAPI.mergeDeep({}, defaultConfig, userConfig);
```

### 7.4 Песочница (Sandbox)

Код модов выполняется в песочнице на основе `with(Proxy)`. Это обеспечивает изоляцию модов от опасных API браузера и Electron.

#### Архитектура

```
+---------------------------------------------------+
|  Код мода выполняется внутри:                      |
|    with(sandboxProxy) { <код мода> }               |
|                                                    |
|  Каждый поиск идентификатора идёт через:           |
|    sandboxProxy.has() → всегда true                |
|    sandboxProxy.get() → 3-уровневое разрешение:    |
|      1. Безопасные глобалы → безопасное значение   |
|      2. Заблокированные глобалы → undefined + warn |
|      3. Игровые глобалы (window.X) → pass-through  |
|                                                    |
|  window = safeWindowProxy:                         |
|    window.player     → ✅ pass-through             |
|    window.fetch      → ❌ blocked + warning        |
|    window.electronAPI → ❌ blocked + warning        |
|                                                    |
|  document = hardenedDocProxy:                      |
|    document.createElement('div')    → ✅ allowed   |
|    document.createElement('script') → ❌ blocked   |
+---------------------------------------------------+
```

#### Заблокированные глобалы

Моды **НЕ** имеют доступа к следующим идентификаторам:

**Сеть и I/O:**
- `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`
- `importScripts` (Web Worker import)

**Выполнение кода:**
- `eval`, `Function`, `AsyncFunction`, `GeneratorFunction`

**Node.js / Electron:**
- `require`, `module`, `exports`, `__dirname`, `__filename`, `process`, `Buffer`, `electronAPI`

**Хранилище:**
- `localStorage`, `sessionStorage`, `indexedDB`, `caches`

**Навигация и браузерное API:**
- `top`, `parent`, `frames`, `contentWindow` (window traversal)
- `Navigator`, `Location`, `History` (конструкторы браузерного API)
- `alert`, `confirm`, `prompt`, `open`, `close`, `stop`, `print`, `postMessage`, `onmessage`

**Метапрограммирование (защита от побега):**
- `Proxy`, `Reflect`, `Symbol`, `constructor`, `__proto__`, `prototype`

**Глобальные конструкторы (заблокированы как bare identifiers, безопасные версии предоставлены в песочнице):**
- `Object`, `Array`, `String`, `Number`, `Boolean`, `RegExp`, `Date`, `Map`, `Set`, `WeakMap`, `WeakSet`, `Promise`, `Error`, `TypeError`, `RangeError`, `SyntaxError`, `ReferenceError`, типизированные массивы, `ArrayBuffer`, `DataView`
- `SharedArrayBuffer`, `Atomics` (shared memory)

**Заблокировано на window:**
- `crypto` — используйте `ModAPI.readFile` для I/O
- `navigator`, `location`, `history`

#### Доступные глобалы

Моды **ИМЕЮТ** доступа к:

**Безопасные встроенные:**
- `Array`, `Object`, `String`, `Number`, `Boolean`, `Map`, `Set`, `Error`, `RegExp`, `Date`, `JSON`, `Math`, `Promise`, `Intl`
- `TextEncoder`, `TextDecoder` — утилиты кодирования
- `parseInt`, `parseFloat`, `isNaN`, `isFinite`, `encodeURI`, `decodeURI`, `encodeURIComponent`, `decodeURIComponent`, `btoa`, `atob`
- `undefined`, `NaN`, `Infinity`, `true`, `false`, `null`
- `performance`, `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `requestAnimationFrame`, `cancelAnimationFrame`

**Игровые (через window — только чтение, если не указано иное):**
- `player`, `t`, `World`, `currentLocation`, `selectedItemId` — **чтение + запись**
- `updateCharacterSheet`, `updateInventoryUI`, `updateMapDisplay`, `updateDialogueUI`, `updateQuestLog`, `updateCraftingUI` — **чтение + запись**
- `ModState` — **чтение + запись** (кастомное пространство имён для модов)
- `GameRNG`, `ItemRegistry`, `EventBus`, `damagePlayerHP` — **только чтение**

> **Различие `WINDOW_ALLOWED_PASSTHROUGH` vs `MOD_WRITABLE_WINDOW_PROPS`:**
> Не все свойства, которые можно читать через `window.X`, можно записывать. Запись разрешена только для: `player`, `t`, `World`, `currentLocation`, `selectedItemId`, `updateCharacterSheet`, `updateInventoryUI`, `updateMapDisplay`, `updateDialogueUI`, `updateQuestLog`, `updateCraftingUI`, `ModState`. Попытка записи в `GameRNG`, `ItemRegistry`, `EventBus` и другие «только для чтения» свойства будет заблокирована с предупреждением.

**Идентификаторы мода:**
- `modId` — ID текущего мода (только чтение)
- `modMeta` — метаданные текущего мода (только чтение)

**Консоль:**
- `console.log`, `console.warn`, `console.error`, `console.info` — с автоматическим префиксом `[Mod:modId]`

#### Ограничения document

- `document.createElement('script')` → заменяется на `document.createElement('div')` (инертный элемент)
- `document.createElement('iframe')`, `'object'`, `'embed'`, `'applet'`, `'link'`, `'base'`, `'meta'`, `'form'` → аналогично блокируются
- `document.createElementNS(...)` — перехватывается аналогично `createElement`, те же блокировки по тегу
- `document.defaultView` → возвращает безопасный window proxy
- Присвоение `document.innerHTML/outerHTML` со `<script>` — блокируется
- Присвоение `document.on*` обработчиков — блокируется

#### Ограничения window

- Чтение: только `WINDOW_ALLOWED_PASSTHROUGH` свойства доступны
- Запись: только `MOD_WRITABLE_WINDOW_PROPS` свойства доступны для записи
- `window.window`, `window.self`, `window.globalThis` → возвращают безопасный proxy (не настоящий window)
- Удаление свойств `window` — полностью заблокировано

#### Защита от таймер-флуда

Моды ограничены 50 одновременными таймерами (setTimeout + setInterval). При превышении лимита новые таймеры не создаются, в консоль выводится предупреждение.

> **Важно:** `setInterval` **не освобождает** слот таймера автоматически при каждом тике — слот освобождается только при вызове `clearInterval`. Это означает, что 50 вызовов `setInterval` без `clearInterval` навсегда исчерпают бюджет таймеров. `setTimeout` освобождает слот после выполнения callback.

Во время выполнения кода мода прототипные конструкторы (`Object.prototype.constructor`, `Array.prototype.constructor`, `Function.prototype.constructor`) временно переопределяются на `undefined`, чтобы предотвратить побег из песочницы через цепочку `({}).constructor.constructor('return fetch')()`. После выполнения кода мода оригиналы восстанавливаются.

### 7.5 Безопасность и ограничения

#### Сканирование кода

Перед выполнением код мода сканируется на опасные паттерны. Если обнаружены, мод не загружается.

**Запрещённые паттерны (10 правил):**
- `eval(` — выполнение произвольного кода
- `Function(` — конструктор функций
- `AsyncFunction(` — асинхронный конструктор
- `GeneratorFunction(` — генераторный конструктор
- `import(` — динамический импорт
- `require(` — CommonJS require
- `process.` — доступ к Node.js process
- `child_process` — доступ к дочерним процессам
- `fs.` — прямой доступ к файловой системе
- `__proto__` — доступ к прототипной цепочке
- Прямой доступ к `electronAPI`

#### Санитизация HTML

Все HTML-строки, добавляемые через `ModAPI.addUI()` и `ModAPI.addSettingsTab()`, проходят строгую санитизацию:

1. Удаляются опасные теги: `script`, `iframe`, `object`, `embed`, `applet`, `base`, `form`, `meta`, `link`, `body`, `input`, `textarea`, `select`, `button`, `svg`, `math`, `details`, `summary`, `template`, `slot`, `noscript`
2. Удаляются on*-обработчики событий (onclick, onload и т.д.)
3. Блокируются `javascript:`, `vbscript:`, `data:` URL-схемы
4. HTML-сущности, кодирующие опасные паттерны (`&#106;` = `j`), также перехватываются

#### Защита от побега из песочницы

Даже если мод попытается получить доступ к реальным глобалам через цепочку прототипов или конструкторы, это будет заблокировано:

```javascript
// Все эти попытки провалятся:
({}).constructor.constructor('return fetch')()  // constructor заблокирован
window.fetch                                    // fetch заблокирован на window
document.defaultView.fetch                      // defaultView возвращает безопасный proxy
```

### 7.6 Примеры скриптовых модов

#### Пример 1: Мод, добавляющий кастомную команду

```javascript
// <userData>/mods/my_command_mod/data/main.js

ModAPI.on('onModsInitialized', async () => {
    ModAPI.addCommand('heal', (args) => {
        const amount = parseInt(args[0]) || 50;
        if (typeof player !== 'undefined' && player.hp !== undefined) {
            player.hp = Math.min(player.maxHp || 100, player.hp + amount);
            if (typeof updateCharacterSheet === 'function') updateCharacterSheet();
            ModAPI.notify(`Вы исцелены на ${amount} HP!`);
        }
        return { success: true };
    }, {
        name: 'heal',
        description: 'Исцеляет персонажа',
        usage: '/heal <количество>'
    });
});
```

#### Пример 2: Мод, модифицирующий AI-промпты

```javascript
// <userData>/mods/dark_fantasy_mod/data/main.js

ModAPI.on('onModsInitialized', async () => {
    // Добавляем правило в промпт AI
    ModAPI.addPromptInjection(
        'ВАЖНО: Мир является тёмным фэнтези. Все описания должны быть мрачными и гнетущими. ' +
        'Н надежда редка, а каждое решение имеет тяжёлые последствия.'
    );
    
    // Фильтруем ответы AI
    ModAPI.addResponseFilter((response) => {
        // Заменяем过于 оптимистичные фразы
        return response.replace(/счастлив/gi, 'обречён');
    });
});
```

#### Пример 3: Мод, реагирующий на события мира

```javascript
// <userData>/mods/war_tracker_mod/data/main.js

let warLog = [];

ModAPI.on('onModsInitialized', async () => {
    ModAPI.addStyle('war_tracker', `
        .war-log { position: fixed; top: 10px; right: 10px; background: rgba(0,0,0,0.8); 
                   color: #e74c3c; padding: 10px; border-radius: 5px; max-height: 200px; 
                   overflow-y: auto; font-size: 12px; z-index: 9999; }
    `);
    
    ModAPI.addUI('<div class="war-log" id="war-log"></div>');
    
    ModAPI.registerSaveData('war_tracker',
        () => ({ log: warLog }),
        (data) => { warLog = data.log || []; }
    );
});

ModAPI.on('onWarDeclared', async (data) => {
    warLog.push(`Война: ${data.f1} vs ${data.f2}`);
    const el = document.getElementById('war-log');
    if (el) {
        el.innerHTML = warLog.map(e => `<div>${e}</div>`).join('');
    }
});
```

#### Пример 4: Мод с горячей клавишей и вкладкой настроек

```javascript
// <userData>/mods/quick_actions_mod/data/main.js

let autoSave = true;

ModAPI.on('onModsInitialized', async () => {
    // Горячая клавиша
    ModAPI.registerHotkey('ctrl+shift+s', () => {
        if (typeof SaveManager !== 'undefined') {
            SaveManager.quickSave();
            ModAPI.notify('Быстрое сохранение!');
        }
    });
    
    // Вкладка настроек
    ModAPI.addSettingsTab('quick_actions', 'Быстрые действия', `
        <div class="setting-group">
            <label>
                <input type="checkbox" id="qa_autosave" ${autoSave ? 'checked' : ''}>
                Автосохранение
            </label>
        </div>
    `);
    
    // Обработчик изменения чекбокса
    setTimeout(() => {
        const cb = document.getElementById('qa_autosave');
        if (cb) cb.addEventListener('change', (e) => { autoSave = e.target.checked; });
    }, 1000);
});
```

#### Пример 5: Мод, модифицирующий базу данных

```javascript
// <userData>/mods/economy_overhaul_mod/data/main.js

ModAPI.on('onDatabaseLoad', async (database) => {
    // Удваиваем цены всех предметов
    if (database.items) {
        for (const itemId in database.items) {
            database.items[itemId].basePrice = Math.ceil(database.items[itemId].basePrice * 2);
        }
    }
    
    // Добавляем новый рецепт
    if (database.recipes && Array.isArray(database.recipes)) {
        database.recipes.push({
            facility: 'alchemists',
            inputs: { 'dragon_bone': 1, 'fire_essence': 2 },
            outputs: { 'phoenix_feather': 1 }
        });
    }
});
```

---

## 8. ModKit 3.0 — нативные C++ плагины

ModKit 3.0 — это C-API для создания нативных плагинов (DLL/SO), работающих непосредственно с C++ движком симуляции. Плагины имеют полный доступ к симуляции мира и могут как читать, так и изменять состояние.

**SDK:** `engine/meterea_mod_sdk.h`

### 8.1 Жизненный цикл плагина

```
1. Движок загружает DLL/SO через dlopen/LoadLibrary
2. Движок вызывает MeteraPlugin_GetAPI() → плагин получает таблицу функций
3. Движок вызывает MeteraPlugin_Init(plugin_id) → плагин получает уникальный ID
4. Движок вызывает MeteraPlugin_OnLoad() → плагин выполняет одноразовую настройку
5. Во время симуляции движок вызывает зарегистрированные callback-и
6. При завершении движок вызывает MeteraPlugin_Shutdown()
```

> **Важно:** Текущая версия SDK (3.3.0) не предоставляет явной функции регистрации callback-ов (например `registerCallback`). Callback-и должны быть зарегистрированы через механизм, реализованный в самом движке. Следите за обновлениями SDK.

### 8.2 Обязательные экспортируемые функции

Каждый DLL/SO плагин **обязан** реализовать следующие функции:

```c
// Обязательные:
METERA_EXPORT const char* MeteraPlugin_GetName(void);
METERA_EXPORT const char* MeteraPlugin_GetVersion(void);
METERA_EXPORT void MeteraPlugin_GetAPI(const MeteraAPI* api);
METERA_EXPORT MeteraResult MeteraPlugin_Init(int32_t plugin_id);

// Опциональные:
METERA_EXPORT void MeteraPlugin_OnLoad(void);
METERA_EXPORT void MeteraPlugin_Shutdown(void);
```

| Функция | Обязательна | Описание |
|---------|:----------:|----------|
| `MeteraPlugin_GetName` | ✅ | Возвращает статическую строку с именем плагина |
| `MeteraPlugin_GetVersion` | ✅ | Возвращает статическую строку с версией |
| `MeteraPlugin_GetAPI` | ✅ | Движок передаёт таблицу API-функций. Плагин должен сохранить указатель |
| `MeteraPlugin_Init` | ✅ | Инициализация. Плагин получает уникальный ID |
| `MeteraPlugin_OnLoad` | ❌ | Вызывается после Init. Место для одноразовой настройки |
| `MeteraPlugin_Shutdown` | ❌ | Вызывается при завершении. Плагин должен освободить ресурсы |

### 8.3 Типы хуков

| Хук | Callback-тип | Данные | Режим |
|-----|-------------|--------|-------|
| `METERA_HOOK_ON_DAILY_TICK` | `MeteraOnDailyTickFunc` | `day` (int32_t) | Deferred |
| `METERA_HOOK_ON_HOURLY_TICK` | `MeteraOnHourlyTickFunc` | `day` (int32_t), `hour` (int32_t) | Deferred |
| `METERA_HOOK_ON_REGION_CHANGED` | `MeteraOnRegionChangedFunc` | `region_id` (const char*), `change_type` (const char*) | Deferred |
| `METERA_HOOK_ON_NPC_DEATH` | `MeteraOnNpcDeathFunc` | `npc_id` (const char*), `cause` (const char*) | Deferred |
| `METERA_HOOK_ON_BATTLE` | `MeteraOnBattleFunc` | `region_id` (const char*), `attacker_count` (int32_t), `defender_count` (int32_t) | Deferred |
| `METERA_HOOK_ON_TRADE` | `MeteraOnTradeFunc` | `from_region` (const char*), `to_region` (const char*), `item_id` (const char*), `quantity` (int32_t) | Deferred |
| `METERA_HOOK_ON_DISASTER` | `MeteraOnDisasterFunc` | `disaster_id` (const char*), `region_id` (const char*), `severity` (int32_t) | Deferred |
| `METERA_HOOK_ON_BUILDING_BUILT` | `MeteraOnBuildingBuiltFunc` | `region_id` (const char*), `facility_type` (const char*) | Deferred |

**Callback-режимы (`MeteraCallbackMode`):**
- `METERA_CALLBACK_DEFERRED` (0) — изменения откладываются на следующий тик (по умолчанию для всех хуков)
- `METERA_CALLBACK_FIRE_AND_FORGET` (1) — вызов без ожидания результата (зарезервировано для визуальных/аудио callback-ов)

**Deferred Response:** Изменения, сделанные в callback-е, применяются на следующем тике, а не немедленно. Это предотвращает блокировку цикла симуляции.

### 8.4 Запросы мира (World Queries)

Функции только для чтения, предоставляемые движком:

| Функция | Возвращаемый тип | Описание |
|---------|-----------------|----------|
| `getRegionPopulation(region_id)` | int32_t | Население региона (-1 при ошибке) |
| `getRegionStability(region_id)` | int32_t | Стабильность 0–100 (-1 при ошибке) |
| `getRegionFaction(region_id)` | const char* | ID фракции региона |
| `getRegionBiome(region_id)` | const char* | ID биома региона |
| `getWorldPopulation()` | int64_t | Общее население мира |
| `getCurrentDay()` | int32_t | Текущий игровой день |
| `getCurrentHour()` | int32_t | Текущий игровой час (0–23) |
| `getRegionNpcCount(region_id)` | int32_t | Количество NPC в регионе |
| `getItemPrice(item_id)` | double | Цена предмета (-1.0 при ошибке) |
| `getGlobalString(key)` | const char* | Глобальная строка (для обмена данных между плагинами) |
| `getNpcHp(npc_id)` | int32_t | HP NPC |
| `getContainerItemCount(container_id, item_prototype)` | int32_t | Количество предмета в контейнере |
| `getMapWidth()` | int32_t | Ширина карты |
| `getMapHeight()` | int32_t | Высота карты |
| `getTileBiome(x, y)` | int32_t | ID биома тайла (-1 при выходе за границы) |
| `getTileRoadLevel(x, y)` | int32_t | Уровень дороги (0=нет, 1=грунтовая, 2=мощёная, 3=шоссе) |
| `getTileWaterDepth(x, y)` | int32_t | Глубина воды на тайле |
| `isTileFlooded(x, y)` | bool | Затоплен ли тайл |
| `getLocationAt(x, y)` | const char* | ID локации на координатах |
| `getFactionRelation(f1, f2)` | int32_t | Отношения между фракциями |
| `getFactionState(faction_id)` | const char* | Дипломатическое состояние фракции |
| `getRegionMoneySupply(region_id)` | double | Денежная масса региона |
| `getBusinessCash(business_id)` | int32_t | Касса бизнеса |
| `getNpcLocation(npc_id)` | const char* | Локация NPC |
| `getNpcGold(npc_id)` | int32_t | Золото NPC |
| `getRegionThreat(region_id)` | int32_t | Уровень угрозы региона |

### 8.5 Мутации мира (World Mutations)

Функции изменения состояния. Все мутации **отложены** — применяются на следующем тике (кроме `setNpcHp`).

| Функция | Возвращает | Описание |
|---------|-----------|----------|
| `setRegionStability(region_id, value)` | MeteraResult | Установить стабильность (0–100) |
| `modifyRegionPopulation(region_id, delta)` | MeteraResult | Изменить население на delta |
| `multiplyAllPrices(factor)` | MeteraResult | Умножить все цены на коэффициент (для total conversion) |
| `multiplyItemPrice(item_id, factor)` | MeteraResult | Умножить цену конкретного предмета |
| `setGlobalString(key, value)` | MeteraResult | Установить глобальную строку (обмен данными) |
| `spawnItem(item_id, quantity, container_id)` | MeteraResult | Спавнить предмет в контейнер |
| `triggerDisaster(disaster_type, region_id, severity)` | MeteraResult | Вызвать катастрофу |
| `spawnMonster(monster_type, region_id)` | MeteraResult | Спавнить эпического монстра |
| `addNews(text, location, importance, category)` | MeteraResult | Добавить новость в хронику |
| `setNpcHp(npc_id, hp)` | MeteraResult | Установить HP NPC (**применяется немедленно** для боевой логики) |
| `removeItem(container_id, item_prototype, quantity)` | int32_t | Удалить предмет из контейнера |
| `setFactionRelation(f1, f2, value)` | MeteraResult | Установить отношения фракций |
| `forceWar(f1, f2)` | MeteraResult | Принудительно объявить войну |
| `forcePeace(f1, f2)` | MeteraResult | Принудительно заключить мир |
| `modifyRegionMoney(region_id, delta)` | MeteraResult | Изменить денежную массу региона |
| `modifyBusinessCash(business_id, delta)` | MeteraResult | Изменить кассу бизнеса |
| `teleportNpc(npc_id, region_id)` | MeteraResult | Телепортировать NPC |
| `modifyNpcGold(npc_id, delta)` | MeteraResult | Изменить золото NPC |
| `spawnArmy(faction_id, region_id, size)` | MeteraResult | Спавнить армию |
| `setRegionThreat(region_id, value)` | MeteraResult | Установить уровень угрозы |
| `setRoadState(from_region, to_region, state)` | MeteraResult | Изменить состояние дороги |
| `setTileBiome(x, y, biome_id)` | MeteraResult | Изменить биом тайла |
| `setTileRoadLevel(x, y, level)` | MeteraResult | Изменить уровень дороги на тайле |
| `setTileWaterDepth(x, y, depth)` | MeteraResult | Изменить глубину воды на тайле |
| `setTileFlooded(x, y, is_flooded)` | MeteraResult | Установить затопление тайла |
| `addLocation(id, name, x, y, type, faction)` | MeteraResult | Добавить локацию на карту |
| `removeLocation(id)` | MeteraResult | Удалить локацию с карты |
| `updateWorldConfig(json_config)` | MeteraResult | Обновить конфиг генерации мира (JSON-строка) |
| `updateBiomeDef(biome_id, json_def)` | MeteraResult | Обновить определение биома (JSON-строка) |
| `regenerateMap(seed)` | MeteraResult | Перегенерировать карту мира с новым seed |

#### Коды возврата MeteraResult

| Значение | Описание |
|----------|----------|
| `METERA_OK` (0) | Успех |
| `METERA_ERR_INVALID_HANDLE` (-1) | Неверный дескриптор |
| `METERA_ERR_NOT_FOUND` (-2) | Не найдено |
| `METERA_ERR_INVALID_ARG` (-3) | Неверный аргумент |
| `METERA_ERR_PERMISSION` (-4) | Недостаточно прав |
| `METERA_ERR_OVERFLOW` (-5) | Переполнение |

### 8.6 API-таблица MeteraAPI

Движок передаёт плагину указатель на структуру `MeteraAPI`, содержащую все функции:

```c
typedef struct MeteraAPI {
    uint32_t version_major;  // 3
    uint32_t version_minor;  // 3
    uint32_t version_patch;  // 0

    // World queries (read-only)
    MeteraGetRegionPopulationFunc  getRegionPopulation;
    MeteraGetRegionStabilityFunc   getRegionStability;
    MeteraGetRegionFactionFunc     getRegionFaction;
    MeteraGetRegionBiomeFunc       getRegionBiome;
    MeteraGetWorldPopulationFunc   getWorldPopulation;
    MeteraGetCurrentDayFunc        getCurrentDay;
    MeteraGetCurrentHourFunc       getCurrentHour;
    MeteraGetRegionNpcCountFunc    getRegionNpcCount;
    MeteraGetItemPriceFunc         getItemPrice;
    MeteraGetGlobalStringFunc      getGlobalString;
    MeteraGetNpcHpFunc             getNpcHp;
    MeteraGetContainerItemCountFunc getContainerItemCount;
    MeteraGetMapWidthFunc          getMapWidth;
    MeteraGetMapHeightFunc         getMapHeight;
    MeteraGetTileBiomeFunc         getTileBiome;
    MeteraGetFactionRelationFunc   getFactionRelation;
    MeteraGetFactionStateFunc      getFactionState;
    MeteraGetRegionMoneySupplyFunc getRegionMoneySupply;
    MeteraGetBusinessCashFunc      getBusinessCash;
    MeteraGetNpcLocationFunc       getNpcLocation;
    MeteraGetNpcGoldFunc           getNpcGold;
    MeteraGetRegionThreatFunc      getRegionThreat;

    // World mutations (deferred)
    MeteraSetRegionStabilityFunc      setRegionStability;
    MeteraModifyRegionPopulationFunc  modifyRegionPopulation;
    MeteraMultiplyAllPricesFunc       multiplyAllPrices;
    MeteraMultiplyItemPriceFunc       multiplyItemPrice;
    MeteraSetGlobalStringFunc         setGlobalString;
    MeteraSpawnItemFunc               spawnItem;
    MeteraTriggerDisasterFunc         triggerDisaster;
    MeteraSpawnMonsterFunc            spawnMonster;
    MeteraAddNewsFunc                 addNews;
    MeteraSetNpcHpFunc                setNpcHp;
    MeteraRemoveItemFunc              removeItem;
    MeteraSetTileBiomeFunc            setTileBiome;
    MeteraSetFactionRelationFunc      setFactionRelation;
    MeteraForceWarFunc                forceWar;
    MeteraForcePeaceFunc              forcePeace;
    MeteraModifyRegionMoneyFunc       modifyRegionMoney;
    MeteraModifyBusinessCashFunc      modifyBusinessCash;
    MeteraTeleportNpcFunc             teleportNpc;
    MeteraModifyNpcGoldFunc           modifyNpcGold;
    MeteraSpawnArmyFunc               spawnArmy;
    MeteraSetRegionThreatFunc         setRegionThreat;
    MeteraSetRoadStateFunc            setRoadState;

    // Utility
    MeteraLogFunc log;

    // Map Terrain & Locations (v3.2)
    MeteraGetTileRoadLevelFunc     getTileRoadLevel;
    MeteraGetTileWaterDepthFunc    getTileWaterDepth;
    MeteraIsTileFloodedFunc        isTileFlooded;
    MeteraGetLocationAtFunc        getLocationAt;
    MeteraSetTileRoadLevelFunc     setTileRoadLevel;
    MeteraSetTileWaterDepthFunc    setTileWaterDepth;
    MeteraSetTileFloodedFunc       setTileFlooded;
    MeteraAddLocationFunc          addLocation;
    MeteraRemoveLocationFunc       removeLocation;

    // Map Generation & Config (v3.3)
    MeteraUpdateWorldConfigFunc    updateWorldConfig;
    MeteraUpdateBiomeDefFunc       updateBiomeDef;
    MeteraRegenerateMapFunc        regenerateMap;
} MeteraAPI;
```

> **Неиспользуемые типы SDK:** В заголовке определены `MeteraHandle`, `MeteraStringHandle` и `MeteraGenericCallback`, которые в текущей версии SDK (3.3.0) не используются ни одной функцией. Они зарезервированы для будущих расширений.

### 8.7 Пример плагина

```cpp
// my_plugin.cpp
#include "meterea_mod_sdk.h"
#include <stdio.h>

static const MeteraAPI* g_api = nullptr;
static int32_t g_plugin_id = -1;

METERA_EXPORT const char* MeteraPlugin_GetName(void) {
    return "My Plugin";
}

METERA_EXPORT const char* MeteraPlugin_GetVersion(void) {
    return "1.0.0";
}

METERA_EXPORT void MeteraPlugin_GetAPI(const MeteraAPI* api) {
    g_api = api;
}

METERA_EXPORT MeteraResult MeteraPlugin_Init(int32_t plugin_id) {
    g_plugin_id = plugin_id;
    g_api->log("My Plugin initialized!");
    return METERA_OK;
}

METERA_EXPORT void MeteraPlugin_OnLoad(void) {
    g_api->log("My Plugin loaded successfully");
    
    // Пример: проверить население мира
    int64_t pop = g_api->getWorldPopulation();
    char msg[128];
    snprintf(msg, sizeof(msg), "World population: %ld", (long)pop);
    g_api->log(msg);
}

// Daily tick callback
static void on_daily_tick(int32_t day) {
    // Каждые 30 дней — проверяем стабильность и корректируем
    if (day % 30 == 0) {
        // Это пример — в реальном плагине вы бы перебирали регионы
        const char* region = "capital_aquilon";
        int32_t stability = g_api->getRegionStability(region);
        if (stability < 30 && stability >= 0) {
            g_api->setRegionStability(region, stability + 5);
            g_api->log("Emergency stability boost applied!");
        }
    }
}

METERA_EXPORT void MeteraPlugin_Shutdown(void) {
    g_api->log("My Plugin shutting down");
}
```

**Компиляция:**

```bash
# Linux
g++ -shared -fPIC -o my_plugin.so my_plugin.cpp -I./engine

# Windows
cl /LD /I./engine my_plugin.cpp /Fe:my_plugin.dll
```

### 8.8 Предупреждение безопасности

> ⚠️ **Нативные плагины (DLL/SO) выполняются с ПОЛНЫМИ привилегиями процесса. Песочницы НЕ существует.**
> 
> Вредоносный плагин может:
> - Читать и изменять всю память процесса
> - Выполнять произвольные системные команды
> - Получать неограниченный доступ к файловой системе
> - Напрямую модифицировать внутреннее состояние движка
> 
> **Митигация:** Загружайте плагины только из доверенных источников. Рекомендуется реализовать allowlist (белый список) подписанных/верифицированных DLL.

---

## 9. Система локализации

### Поддерживаемые языки

- 🇷🇺 Русский (`ru`) — основной
- 🇬🇧 Английский (`en`)

### Структура файлов

```
assets/localizations/
├── languages.json     # Реестр языков
├── ru.json            # Русская локализация (~540+ строк)
└── en.json            # Английская локализация
```

### Добавление переводов через мод

#### Способ 1: Массовое добавление

```javascript
ModAPI.addTranslations('ru', {
    my_mod: {
        title: 'Мой мод',
        items: {
            mithril_ingot: 'Мифриловый слиток',
            phoenix_feather: 'Перо феникса'
        }
    }
});
```

#### Способ 2: Точечная установка

```javascript
ModAPI.setString('ru', 'my_mod.items.mithril_ingot', 'Мифриловый слиток');
ModAPI.setString('en', 'my_mod.items.mithril_ingot', 'Mithril Ingot');
```

### Ключи локализации

Многие data-файлы используют ключи вида `display_name_i18n_key` или `name_i18n_key`. Эти ключи ссылаются на путь в файле локализации:

```json
// В data/classes.json:
{ "id": "warrior", "display_name_i18n_key": "characterCreation.classes.warrior" }

// В assets/localizations/ru.json:
{ "characterCreation": { "classes": { "warrior": "Воин" } } }
```

### Добавление нового языка

1. Добавьте язык в `assets/localizations/languages.json`
2. Создайте файл `assets/localizations/<lang>.json`
3. Заполните все ключи перевода
4. В моде используйте `ModAPI.addTranslations('<lang>', {...})`

---

## 10. Сохранения и моды

### Регистрация данных сохранения

Моды, которым нужно сохранять состояние между сессиями, должны зарегистрировать обработчики:

```javascript
let modState = { someData: 0 };

ModAPI.registerSaveData('my_mod',
    () => JSON.parse(JSON.stringify(modState)),  // onSave: вернуть данные
    (data) => { modState = data || { someData: 0 }; }  // onLoad: восстановить
);
```

### Важные правила

1. **Всегда возвращайте сериализуемые данные** (JSON-совместимые: строки, числа, массивы, объекты)
2. **Глубоко копируйте объекты** в `onSave`, чтобы избежать мутаций
3. **Обрабатывайте `null`/`undefined`** в `onLoad` — при первом запуске данных не будет
4. **Регистрируйте обработчики до** `onModsInitialized`, чтобы они были доступны при загрузке сохранения

---

## 11. Инструменты валидации

### Smoke-check

Основной инструмент проверки целостности:

```bash
node tools/runtime_smoke_check.js
```

Ожидаемый результат: `84 checks, 0 failed, 0 warnings`

### Валидация контракта моддинга

Проверяет, что runtime-база данных соответствует контракту:

```bash
node tools/validate_modding_contract.js
```

### Валидация целостности данных

```bash
node tools/validate_data_integrity.js
```

### Валидация runtime-конфигов

```bash
node tools/validate_runtime_configs.js
```

### Полная верификация

```bash
node tools/full_verify.js
```

### Интеграционные тесты

```bash
node tests/test_stub_game.js      # 80 ассертов интеграции
node tests/modloader.test.js       # Тест загрузчика модов
node tests/mod_runtime_e2e.test.js # E2E тест модов
node tests/save_manager.test.js    # Тест сохранений
```

---

## 12. Стиль кода и контрибуция

### Commit-сообщения

Формат: `type(scope): description`

**Типы:** `fix`, `feat`, `refactor`, `docs`, `test`, `chore`, `perf`, `security`

**Области:** `engine`, `ui`, `mods`, `save`, `ipc`, `data`, `config`, `test`

Примеры:
- ✅ `fix(save): resolve chunk parsing race condition on Windows`
- ✅ `feat(mods): add sandbox code scanner for dangerous patterns`
- ❌ `ххз`, `fix stuff`, `update`

**Язык:** Commit-сообщения на английском. Комментарии в коде могут быть на русском.

### Стиль кода

| Язык | Отступы | Кавычки | Именование |
|------|---------|---------|------------|
| JavaScript | 4 пробела | Одиночные `'` | camelCase |
| C++ | 4 пробела | — | snake_case |
| JSON | 2 пробела | Двойные `"` | snake_case |

### Правила для модов

- Все моды должны проходить сканер кода (без `eval()`, `Function()`, `import()`)
- Используйте `ModAPI.*` вместо прямого доступа к DOM и глобалам
- Помечайте устаревшие API через `@deprecated` JSDoc

---

## 13. Устранение неполадок

### Мод не загружается

1. Проверьте, что `mod.json` валидный JSON
2. Убедитесь, что `id` соответствует `[a-z0-9_]+`
3. Проверьте консоль на ошибки валидации
4. Убедитесь, что мод не отключён в настройках

### Ошибка "missing required sections"

Если мод является Total Conversion, он обязан предоставить все обязательные секции данных. Проверьте, что в `data` указаны файлы для: `items`, `eras`, `classes`, `races`, `biomes`, `world_config`, `tag_defaults`.

### Хук не вызывается

1. Убедитесь, что хук зарегистрирован **до** `onModsInitialized`
2. Проверьте, что движок зарегистрировал этот хук через `nexusRegisterHooks`
3. Убедитесь, что C++ ядро активно (не браузерный режим)

### Песочница блокирует доступ

Проверьте, что вы не пытаетесь использовать заблокированные глобалы (список см. в разделе 7.4). Используйте `ModAPI.*` для безопасного доступа.

### Данные мода не сливаются

1. Проверьте merge-политику в `runtime_manifest.json`
2. Убедитесь, что формат данных мода соответствует ожидаемому типу (object vs array)
3. Для `upsertById` убедитесь, что элементы имеют поле `id`

### Нативный плагин не загружается

1. Убедитесь, что DLL/SO скомпилирован для правильной архитектуры (x64)
2. Проверьте, что все обязательные функции экспортируются
3. Убедитесь, что версия API совпадает (3.x.x)

---

## 14. Приложение: глобальные переменные игры

Эти переменные доступны модам через `window.*` (только для чтения, если не указано иное):

### Состояние игры

| Переменная | Тип | Доступ | Описание |
|-----------|------|--------|----------|
| `player` | object | Чтение/Запись | Объект игрока (hp, gold, location и т.д.) |
| `t` | object | Чтение/Запись | Текущий объект перевода |
| `World` | object | Чтение | Объект мира (регионы, фракции, NPC) |
| `currentLocation` | string | Чтение/Запись | ID текущей локации |
| `selectedItemId` | string | Чтение/Запись | ID выбранного предмета |

### UI-функции

| Функция | Описание |
|---------|----------|
| `updateCharacterSheet()` | Обновить лист персонажа |
| `updateInventoryUI()` | Обновить интерфейс инвентаря |
| `updateMapDisplay()` | Обновить отображение карты |
| `updateDialogueUI()` | Обновить интерфейс диалога |
| `updateQuestLog()` | Обновить журнал квестов |
| `updateCraftingUI()` | Обновить интерфейс крафта |
| `damagePlayerHP(amount)` | Нанести урон игроку |

### Данные Runtime Database

| Переменная | Описание |
|-----------|----------|
| `RUNTIME_DATABASE` | Полная Runtime Database |
| `RUNTIME_MANIFEST` | Runtime Manifest |
| `ERAS_DATA` | Данные эпох |
| `RACES_DATA` | Данные рас |
| `CLASSES_DATA` | Данные классов |
| `EQUIPMENT_SLOTS` | Слоты экипировки |
| `WORLD_CONFIG` | Конфигурация мира |
| `CONTAINER_TYPES` | Типы контейнеров |
| `SHIP_TYPES` | Типы кораблей |
| `DIPLOMACY` | Данные дипломатии |
| `CASUS_BELLI` | Касусы белли |
| `FURNITURE_CATALOG` | Каталог мебели |
| `TAG_DEFAULTS` | Теги по умолчанию |
| `ECONOMY_ITEMS` | Предметы экономики |
| `CRAFTING_RECIPES` | Рецепты крафта |
| `FACILITY_NAMES` | Названия заведений |
| `TREK_CONFIG` | Конфигурация путешествий |
| `TILE_TYPE_DICTIONARY` | Словарь тайлов |
| `TRANSPORT_REGISTRY` | Реестр транспорта |
| `NARRATORS_DATA` | Данные рассказчиков |
| `PREDEFINED_EFFECTS_DATA` | Предопределённые эффекты |
| `BIOME_COLORS` | Цвета биомов (массив HEX) |

### Утилиты

| Переменная | Описание |
|-----------|----------|
| `ModState` | Пространство для кастомного состояния модов (чтение/запись) |
| `GameRNG` | Генератор случайных чисел |
| `ItemRegistry` | Реестр предметов |
| `EventBus` | Шина событий |

### Системные функции

| Функция | Описание |
|---------|----------|
| `addLogMessage(text, type)` | Добавить сообщение в лог |
| `showLoadingScreen(i18nKey, fallbackText)` | Показать экран загрузки |
| `showAiErrorModal(error, critical, world, title)` | Показать модальное окно ошибки AI |

---

*Документация по моддингу Chronicles of Meterea v0.4.0 | ModKit v2.0 (JS) / v3.0 (C++)*
