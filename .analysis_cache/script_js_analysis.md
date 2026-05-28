# Анализ script.js (18,871 строка)

## Структура файла

### 1. Базовые системы (строки 1-160)
- **marked.js fallback** - простой Markdown рендерер
- **GameRNG** - детерминированный PRNG (Mulberry32) для бросков кубиков
- **MetereaState** - централизованный реестр состояния игры
- **SecureKeyStorage** - XOR-шифрование API ключей

### 2. Инвентарь и контейнеры (строки 160-1190)
- **normalizeContainerLocation()** - нормализация локации контейнера
- **resolveActorLocation()** - разрешение локации актора
- **resolveContainerLocation()** - разрешение локации контейнера
- **syncPlayerContainerBindings()** - синхронизация привязок игрока
- **loadSystemContainerRegistry()** - загрузка реестра системных контейнеров
- **ensurePlayerContainers()** - гарантия наличия рюкзака и экипировки
- **OwnershipService** - сервис владения предметами
- **EconomySim** - симуляция экономики
- **CoreInventorySystemAsync** - асинхронная система инвентаря
- **CoreInventorySystem** - прокси для совместимости

### 3. Транспортная система (строки 1190-1405)
- **TransportSystem** - централизованная система транспорта
- **mountTransport()** - посадка на транспорт
- **dismountTransport()** - спуск с транспорта
- **updateTransportUI()** - обновление UI транспорта

### 4. Торговая система (строки 1405-2182)
- **TradeSystemAsync** - асинхронная торговая система
- **executeCommand()** - выполнение торговых команд
- **TradeSystem** - прокси для совместимости

### 5. Система путешествий Trek (строки 2604-2948)
- **LivingRoads** - система живых дорог
- **getCaravanContents()** - содержимое каравана
- **formatTrekObjectData()** - форматирование данных путешествия

### 6. Локализация и рантайм (строки 2948-3113)
- **syncRuntimeRegistries()** - синхронизация рантайм реестров
- **parseLocString()** - парсинг локализованных строк
- **getItemName()**, **getFacilityName()** - получение имен
- **generateWorldNews()** - генерация новостей мира
- **mutateWorld()** - мутация состояния мира

### 7. Автосохранение и загрузка (строки 3114-3380)
- **autoSaveGame()** - автосохранение
- **startAutoSaveTimer()** - таймер автосохранения
- **showLoadGameScreen()** - экран загрузки
- **initWorldSimulator()** - инициализация симулятора мира
- **preSimulateWorldHistory()** - предварительная симуляция истории

### 8. Симуляция мира (строки 3380-3530)
- **processMonsterQuests()** - обработка квестов монстров
- **updateWorldSimulation()** - обновление симуляции мира
- **stopRealtimeSimulation()** - остановка симуляции

### 9. AI и Gemini интеграция (строки 12770-13752)
- **sendApiRequest()** - отправка запросов к API
- **runBackgroundSummarization()** - фоновая суммаризация
- **parseAIResponse()** - парсинг ответа AI
- **buildDynamicContext()** - построение динамического контекста
- **prepareUnifiedPrompt()** - подготовка единого промпта
- **processCommands()** - обработка команд от AI
- **applyTimePassed()** - применение прошедшего времени
- **validateGMCommand()** - валидация GM команд
- **executeNonInventoryCommand()** - выполнение не-инвентарных команд

### 10. Последствия эротических сцен (строки 16095-16237)
- **applyPregnancy()** - применение беременности
- **applyDisease()** - применение болезни
- **applyReputationConsequence()** - применение последствий репутации

### 11. Экипировка (строки 16237-16579)
- **equipItem()**, **unequipItem()** - экипировка предметов
- **populateEquipmentUI()** - заполнение UI экипировки
- **updateEquipmentDisplay()** - обновление отображения
- **getEffectiveStats()** - получение эффективных статов
- **updateTraitsDisplay()** - обновление черт
- **updateHoldingsDisplay()** - обновление владений

### 12. Сохранения и UI (строки 16579-16848)
- **setupMapControls()** - настройка управления картой
- **exitToMainMenu()** - выход в главное меню
- **changeBackground()** - смена фона
- **shakeScreen()** - тряска экрана
- **Sound System** - звуковые эффекты UI

### 13. Генерация изображений (строки 16879-16994)
- **generateVisionImage()** - генерация изображений через AI

### 14. Админ меню и тесты (строки 16995-17387)
- **openAdminMenu()** - открытие админ меню
- **Unit Tests Framework** - встроенный фреймворк тестов

### 15. Deep Setup Pipeline (строки 17388-17590)
- **runDeepSetupPipeline()** - 5-этапная настройка игры

### 16. Симуляция и дипломатия (строки 17590-17929)
- **updateWorldSimDebugDisplay()** - отладочный дисплей симуляции
- **Ruler System** - система правителей
- **checkRulerDeaths()** - проверка смертей правителей
- **toggleLowSpecMode()** - режим низкой спецификации

### 17. Бизнес и логистика (строки 17930-18489)
- **Business & Logistics UI** - UI бизнеса и логистики
- **updatePortPanel()** - обновление панели порта

### 18. AI-игрок (строки 18490-18634)
- **performAiPlayerFetch()** - выполнение ходов AI-игрока
- **runAIPlayerTurn()** - запуск хода AI

### 19. UI Overhaul (строки 18635-18871)
- **initSidebarTabs()** - инициализация вкладок sidebar
- **restructureUI()** - реструктуризация UI
- **openLoadWorldModal()** - модальное окно загрузки мира
- **promptSaveWorldModal()** - модальное окно сохранения

## Ключевые архитектурные паттерны

1. **Прокси для обратной совместимости** - CoreInventorySystem, TradeSystem
2. **Асинхронные версии систем** - *Async суффикс для новых API
3. **Централизованное состояние** - MetereaState вместо window.*
4. **Безопасность** - XOR-шифрование ключей, валидация команд
5. **Модульность через секции** - четкое разделение по функциональности

## Зависимости от других модулей

- ContainerRegistry - глобальный реестр контейнеров
- World - состояние мира
- player - объект игрока
- RuntimeData - рантайм данные
- Cartographer - картографический модуль
- SaveManager - менеджер сохранений

## Проблемные места

1. Глобальные переменные (player, World)
2. Смешение синхронных и асинхронных API
3. Дублирование функций (equipItem Async/Sync)
4. Монолитная структура - сложно тестировать
