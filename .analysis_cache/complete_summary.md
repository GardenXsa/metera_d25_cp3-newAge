# ПОЛНЫЙ АНАЛИЗ ПРОЕКТА CHRONICLES OF METEREA

## Статистика кода

| Компонент | Файлов | Строк | Язык |
|-----------|--------|-------|------|
| C++ движок | 11 | 17,709 | C++17 |
| JS монолит | 1 | 18,871 | JavaScript |
| JS модули | 4 | ~350,000 | JavaScript |
| Python | 20+ | ~5,000 | Python 3 |
| Данные JSON | 100+ | ~500,000 | JSON |
| **ИТОГО** | **136+** | **~891,580** | |

---

## АРХИТЕКТУРА

### Гибридная архитектура
```
┌─────────────────────────────────────────────────────────┐
│                    Electron Frontend                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │ script.js   │  │ core/       │  │ mods/           │ │
│  │ (18,871 стр)│  │ saves/      │  │ cartographer/   │ │
│  └─────────────┘  └─────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────┘
                          ↕ stdin/stdout JSON
┌─────────────────────────────────────────────────────────┐
│              C++ Simulation Engine                       │
│  ┌──────────────────────────────────────────────────┐   │
│  │ meterea_engine.cpp (16,194 стр)                  │   │
│  │ • World simulation                               │   │
│  │ • Inventory system                               │   │
│  │ • Economy, factions, diplomacy                   │   │
│  │ • Combat, trek, transport                        │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │ ModKit 3.0 SDK (C-API)                           │   │
│  │ • Plugin system (DLL/SO)                         │   │
│  │ • 50+ API functions                              │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## C++ ДВИЖОК (17,709 строк)

### Ключевые файлы:

1. **json_wrapper.h** (220 стр)
   - Умная обертка над nlohmann::json
   - Кэширование сериализации (_dirty флаг)
   - 3-5x ускорение для больших объектов

2. **core_types.h** (461 стр)
   - PhysicalItem: 80+ полей, flags sync
   - Storage: контейнеры с lock_data
   - ObjectPool<T>: пул объектов с переиспользованием
   - ThreadPool: многопоточность

3. **definitions.h** (127 стр)
   - BiomeDef, MonsterDef, DisasterDef
   - RaceDef, ProfessionDef, TraitDef
   - ContainerTypeDef

4. **meterea_mod_sdk.h** (419 стр)
   - Stable C-API для модов
   - 8 hook типов, 50+ API функций
   - Deferred callbacks

5. **meterea_engine.cpp** (16,194 стр)
   - Полный симулятор мира
   - Command pattern через JSON
   - Все игровые системы

### Системы движка:

#### Инвентарь
- Physical items с историей и флагами
- Контейнеры с замками и весом
- Экипировка со слотами
- Стек предметов

#### Экономика
- Динамические цены
- Производство и торговля
- Бизнесы игрока
- Фракционные хранилища

#### Симуляция мира
- Daily/hourly ticks
- Голод NPC, производство
- Караваны, армии
- Бедствия, монстры

#### Дипломатия
- Отношения фракций
- Войны, мирные договоры
- Правители, наследники

#### Путешествия
- Trek система
- Транспорт (верхом, повозки)
- Случайные встречи

#### Бой
- D20 система
- Комбат лог
- Урон, криты

---

## JAVASCRIPT (18,871 + 350,000 строк)

### script.js (монолит, 18,871 стр)

#### 19 основных секций:

1. **Базовые системы** (1-160)
   - GameRNG: PRNG для бросков
   - MetereaState: централизованное состояние
   - SecureKeyStorage: XOR шифрование API ключей

2. **Инвентарь** (160-1190)
   - CoreInventorySystemAsync
   - ContainerRegistry
   - OwnershipService

3. **Транспорт** (1190-1405)
   - TransportSystem
   - mount/dismount

4. **Торговля** (1405-2182)
   - TradeSystemAsync
   - executeCommand

5. **Путешествия** (2604-2948)
   - LivingRoads
   - Trek система

6. **Локализация** (2948-3113)
   - parseLocString
   - getItemName

7. **Сохранения** (3114-3380)
   - autoSaveGame
   - showLoadGameScreen

8. **Симуляция** (3380-3530)
   - updateWorldSimulation
   - processMonsterQuests

9. **AI/Gemini** (12770-13752)
   - sendApiRequest
   - parseAIResponse
   - prepareUnifiedPrompt
   - processCommands

10. **Эротика** (16095-16237)
    - applyPregnancy
    - applyDisease
    - applyReputationConsequence

11. **Экипировка** (16237-16579)
    - equipItem/unequipItem
    - getEffectiveStats

12. **UI** (16579-16848)
    - exitToMainMenu
    - changeBackground
    - Sound effects

13. **Генерация изображений** (16879-16994)
    - generateVisionImage

14. **Админ меню** (16995-17387)
    - openAdminMenu
    - Unit tests

15. **Deep Setup** (17388-17590)
    - runDeepSetupPipeline

16. **Дипломатия** (17590-17929)
    - Ruler system
    - checkRulerDeaths

17. **Бизнес** (17930-18489)
    - Business UI
    - updatePortPanel

18. **AI-игрок** (18490-18634)
    - runAIPlayerTurn

19. **UI Overhaul** (18635-18871)
    - initSidebarTabs
    - restructureUI

### Модули js/:

- **core/**: ai_config, constants, devConsole, game_rng, globals
- **mods/**: ModLoader, ModManagerUI, runtimeData
- **saves/**: SaveManager, SaveUI, StorageProvider
- **cartographer/**: globalMap.js

---

## МОДДИНГ

### ModKit 3.0
- C++ DLL/SO плагины
- JS скрипты через ModLoader
- 50+ API функций
- Deferred callbacks

### Безопасность
⚠️ Native плагины имеют ПОЛНЫЙ доступ
- Нет песочницы
- Требуется allowlist

---

## ДАННЫЕ

### JSON файлы (data/)
- Биомы, расы, классы
- Предметы, рецепты
- Фракции, дипломатия
- Локации, кампании
- UI конфиги

### Ассеты (assets/)
- Звуки UI
- Фоны, иконки
- Локализации
- AI промпты

---

## ТЕХНОЛОГИИ

### Backend
- C++17 (движок)
- Python 3 (инструменты)
- nlohmann/json

### Frontend
- Electron
- Vanilla JavaScript
- HTML/CSS

### Сборка
- npm
- CMake (C++)

---

## ПРОБЛЕМЫ

### Архитектурные
1. Монолитный script.js (18K строк)
2. meterea_engine.cpp (16K строк в одном файле)
3. Глобальное состояние (g_items, player, World)
4. Смешение синхронных/асинхронных API

### Производительность
1. Частичная потокобезопасность
2. Сериализация больших миров

### Безопасность
1. Нет песочницы для нативных модов
2. XSS защита частичная

---

## ОПТИМИЗАЦИИ

### Реализованные
- Object pooling (C++)
- JSON кэширование (_dirty флаг)
- Thread pool
- Lazy serialization

### Измерения
- 50% меньше памяти (JSON дублирование устранено)
- 3-5x быстрее toJson()
- O(1) доступ в ObjectPool

---

## СОХРАНЕННЫЕ ФАЙЛЫ

Все анализы сохранены в `/workspace/.analysis_cache/`:
- cpp_engine_full_analysis.md (полный C++ анализ)
- script_js_analysis.md (script.js разбор)
- js_engine_analysis.md (JS модули)
- summary.md (общее резюме)

Папка исключена из git через .gitignore
