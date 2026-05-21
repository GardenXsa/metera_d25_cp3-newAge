# METERA D25 CP3 — NEW AGE
## Долгосрочные заметки и чек-лист тестирования

> Этот файл — постоянная память проекта. Обновляется при каждом изменении.
> Расположение: `/home/z/my-project/metera_d25_cp3-newAge/NOTES.md`

---

## АРХИТЕКТУРА ПРОЕКТА

- **Electron** (main.js) → загружает index.html
- **Рендерер**: script.js (основная логика), js/ (модули)
- **Движок**: C++ (engine/meterea_engine.cpp) → компилируется в engine/meterea_engine
- **Python-мост**: engine/engine_client.py — общается с C++ через stdin/stdout JSON
- **IPC**: preload.js ↔ main.js → electronAPI
- **Моды**: js/mods/ (ModLoader, ModManagerUI, ModLoaderIntegration)
- **Сохранения**: js/saves/ (SaveManager, SaveUI, StorageProvider)
- **Карта**: js/cartographer/globalMap.js (Canvas 2D, OffscreenCanvas кэши)

---

## ЗАПУСК ТЕСТИРОВАНИЯ

```bash
cd /home/z/my-project/metera_d25_cp3-newAge

# Быстрая проверка (только синтаксис/структура) — по умолчанию
bash test_runner.sh
bash test_runner.sh --quick

# Полная проверка (синтаксис + интеграция через stub provider)
bash test_runner.sh --full

# Полная симуляция игры через stub provider
bash test_runner.sh --game

# Подробный вывод
bash test_runner.sh --game --verbose
```

### Режимы:
| Флаг | Описание | Тесты |
|------|----------|-------|
| `--quick` | Синтаксис + структура (по умолчанию) | 1-10 |
| `--full` | + Интеграция через stub provider | 1-13 |
| `--game` | + Полная симуляция игры | 1-16 |
| `--verbose` | Подробный вывод | — |

### Интеграционные тесты (stub provider):
- `tests/test_stub_game.js` — 80 ассертов, проверяет:
  - Создание контейнеров (рюкзак, экипировка, сундуки)
  - Создание предметов (оружие, зелья, золото)
  - Система золота (добавление, удаление, синхронизация)
  - Перемещение предметов (включая разделение стаков)
  - Вес контейнеров
  - `ensurePlayerContainers()` (создание, пересоздание при потере)
  - Полный цикл игры (создание → контейнеры → предметы → золото → экипировка → перемещение)
  - Флаг кражи (stolen items)
  - Ограничения вместимости
  - Обновление локации контейнеров

---

## ИЗВЕСТНЫЕ БАГИ И ПРОБЛЕМЫ

### КРИТИЧЕСКИЕ (блокируют игру)

- [x] **Движок/симуляция** — JS→Python→C++ pipeline. Сейчас работает FALLBACK
  на локальную реализацию (OldCoreInventorySystem), если IPC недоступен.
  Нужно трассировать: script.js → electronAPI → main.js IPC → engine_client.py → meterea_engine
  Проверить: запускается ли C++ процесс, приходит ли ответ, парсится ли JSON.
  (ИСПРАВЛЕНО: Добавлен сигнал ready в C++ ядро для устранения 10-секундной задержки в main.js, устранен краш select.select на Windows в engine_client.py)

- [x] **Инвентарь не работает без движка** — ИСПРАВЛЕНО: sendInventoryCommand() теперь
  fallback на OldCoreInventorySystem когда IPC недоступен. ensurePlayerContainers()
  гарантирует создание рюкзака и экипировки перед операциями.

- [x] **Inventory async/sync mismatch** — ПРОВЕРЕНО: все вызовы async методов
  (createContainer, createItem, moveItem, removeItem, destroyContainer и т.д.)
  используют await. Вызовы без await — это синхронные методы getContainerWeight
  и findItemByPrototype (они не async, читают напрямую из ContainerRegistry/ItemRegistry).
  Тест 12 WARN — ложноположительный (регекс не отличает sync от async методы).

### СРЕДНИЕ (ухудшают опыт)

- [ ] **UI примитивный** — основное окно выглядит скучно, не как игра.
  Нужен визуальный оверхол: тёмная тема с градиентами, анимации, иконки.

- [x] **Карта лагала** — ИСПРАВЛЕНО: добавлен throttle (~30fps) через setTimeout в handleMouseMove,
  hover-обработка вынесена в _processHover, render через requestAnimationFrame с флагом _needsRender.

- [x] **CSP inline handler violations** — ИСПРАВЛЕНО: все 14 inline обработчиков
  (onclick, onmouseover, onmouseout) в index.html заменены на CSP-совместимые:
  data-атрибуты + addEventListener. Убраны ошибки "Refused to execute inline event handler".

- [x] **loadWorldFile** — ИСПРАВЛЕНО (корневая причина): meterea_engine.exe был устаревшим
  бинарником, скомпилированным до добавления обработчика loadWorldFile в C++ исходник (строка 13647).
  Оба бинарника (Linux + Windows) перекомпилированы из актуального исходного кода.
  Команда loadWorldFile теперь работает. Костыльный fallback через syncState удалён.

- [x] **Карта не загружается из сохранения** — ИСПРАВЛЕНО: nexusSyncState отправлял 2-5MB World JSON
  через stdin pipe (64KB buffer limit на Windows) → карта тихо терялась. Заменено на файловую
  синхронизацию (nexusWriteSyncFile + loadWorldFile). Также fetchMapData() теперь не затирает
  World.map пустыми данными движка если JS имеет данные из сохранения.

### НИЗКИЕ (косметика)

- [ ] Дублирующиеся JSDoc комментарии в globalMap.js (были до нас)
- [ ] Непоследовательные отступы в некоторых местах globalMap.js

---

## ИСТОТИЯ ИЗМЕНЕНИЙ (последние)

### 2026-05-20: Карта не загружается при загрузке сохранения
- **Проблема**: При загрузке сохранённого мира глобальная карта не отображается.
  Пользователь заметил: «При загрузке сохраненного мира карта не загружается. Как я понимаю она и не сохраняется».
- **Корневая причина**: ДВЕ проблемы в цепочке загрузки:
  1. **nexusSyncState через stdin**: При загрузке сохранения `loadGame()` вызывает
     `nexusSyncState(World, items, containers)`, который отправляет весь World JSON
     (2-5MB с картой 256x256 тайлов) через stdin pipe. Pipe buffer на Windows = 64KB.
     Данные карты тихо обрезаются/теряются — C++ движок не получает карту.
  2. **fetchMapData() затирает карту**: `Cartographer.fetchMapData()` вызывает
     `nexusGetWorldMap()`, который возвращает пустую карту из C++ движка (т.к. sync
     не удался), и перезаписывает `World.map` — уничтожая данные загруженные из сохранения.
- **Решение 1** (SaveManager.js): Заменён `nexusSyncState` на файловую синхронизацию
  `nexusWriteSyncFile` + `loadWorldFile` при загрузке сохранения. Движок читает мир
  из файла напрямую, минуя stdin pipe buffer limit. Fallback на syncState если файловые
  IPC недоступны.
- **Решение 2** (globalMap.js): `fetchMapData()` теперь проверяет, есть ли в ответе
  движка реальные данные карты (grid/tiles). Если движок вернул пустую карту, а в JS
  есть данные из сохранения — JS данные сохраняются, пустой ответ движка игнорируется.
- **Сохранение карты**: Карта СОХРАНЯЕТСЯ корректно — `nexusGetFullState()` забирает
  мир из C++ (включая map.toJson()), и `addBlock("world_map", World.map)` записывает
  его в файл сохранения. Проблема была только в обратном направлении (загрузка).

### 2026-05-20: ThreadPool фейковый → реальный (производительность)
- **Проблема**: Симуляция мира работает очень медленно.
- **Корневая причина**: `ThreadPool` в `core_types.h` был ФЕЙКОВЫМ — создавал новый
  `std::thread` с `detach()` для КАЖДОЙ задачи. При генерации мира: 256 рядов terrain
  + города + NPC = 300+ одновременно созданных и отсоединённых потоков. Каждый поток
  на Windows = 1MB стека + overhead создания. OS scheduler перегружен.
- **Решение**: Реальный ThreadPool — фиксированное число воркеров (hardware_concurrency()),
  task queue (std::queue + condition_variable), потоки создаются один раз и переиспользуются.

### 2026-05-20: CSP + loadWorldFile фикс
- **Проблема 1**: CSP ошибки "Refused to execute inline event handler" — 14 inline обработчиков
  в index.html (onclick, onmouseover, onmouseout) блокировались Content Security Policy.
- **Решение 1**: Заменены на CSP-совместимые:
  - Help tab кнопки: `onclick` → `data-help-tab` атрибуты + `addEventListener`
  - Help sub-tab кнопки: `onclick` → `data-help-subtab` атрибуты + `addEventListener`
  - Close map modal: `onmouseover/onmouseout` → `mouseenter/mouseleave` через `addEventListener`
  - Close examine modal: `onclick` → `id="close-examine-modal-btn"` + `addEventListener`
- **Проблема 2**: `[Nexus] loadWorldFile не удался: Unknown command: loadWorldFile`
  при синхронизации мира с C++ движком.
- **Решение 2**: КОРНЕВАЯ ПРИЧИНА — meterea_engine.exe был устаревшим бинарником,
  скомпилированным до добавления обработчика loadWorldFile в meterea_engine.cpp.
  Оба бинарника (Linux + Windows .exe) перекомпилированы из актуального исходного кода.
  Костыльный fallback через syncState удалён — он не нужен, движок теперь поддерживает команду.
- **Проверено**: Inventory async/sync mismatch — ложноположительный. Все async методы
  используют await; без await вызываются только sync методы (getContainerWeight, findItemByPrototype).

### 2026-05-20: Фикс globalMap.js SyntaxError
- **Проблема**: Строка 385 — `Uncaught SyntaxError: Unexpected token 'this'`
- **Причина**: Предыдущий субагент добавил throttling (setTimeout ~33ms), но не вынес
  hover-код в метод `_processHover`. Код hover-обработки (строки 181-384) «вывалился»
  из handleMouseMove и оказался «висящим» внутри setupMapControls с нарушенной
  структурой скобок.
- **Решение**:
  1. handleMouseMove теперь содержит только drag-логику и throttle-вызов
  2. Весь hover-код вынесен в метод `Cartographer._processHover(e)`
  3. Throttle: setTimeout ~33ms (~30fps) для hover-детекции
  4. Render: requestAnimationFrame с _needsRender флагом — нет бесконечного цикла

### 2026-05-19: Карта — оптимизация рендера
- Добавлен requestAnimationFrame вместо прямого render()
- Добавлен флаг _needsRender — render() не вызывается, если ничего не изменилось
- Добавлен stopRenderLoop() — останавливает RAF при скрытии карты
- Кэширование allPoints для hover-детекции
- Кэширование political map (Вороного) — пересчёт только при изменении локаций

### 2026-05-18: CSP + marked.js фикс
- CSP обновлён: добавлены cdn.jsdelivr.net, cdnjs.cloudflare.com
- Добавлен fallback marked.js парсер (inline) если CDN заблокирован
- Engine CWD фикс: добавлен `cwd: path.join(__dirname)` в spawn

### 2026-05-17: Security Audit (97 находок)
- Полный аудит архитектуры и безопасности
- Множественные фиксы: path traversal, XSS, injection, race conditions
- Push-инфраструктура: paramiko SSH wrapper

---

## ЧЕК-ЛИСТ ПЕРЕД КАЖДЫМ ИЗМЕНЕНИЕМ КОДА

1. `bash test_runner.sh` — все тесты должны пройти
2. `node -c <файл>` — если меняешь JS
3. Проверить, что _processHover существует если используется в throttle
4. Проверить async/await соответствие (async методы → await вызовы)
5. Проверить, что render() не вызывается в бесконечном цикле
6. Если меняешь HTML — проверить ссылки на скрипты
7. **ПРАВИЛО: Перед каждым git push ОБЯЗАТЕЛЬНО запускать `bash test_runner.sh`**
   Если хоть один тест FAIL — пуш ЗАПРЕЩЁН. Сначала исправить, потом пушить.
   push.sh автоматически запускает тесты — если не хочешь думать об этом, просто
   используй `./push.sh master origin "commit msg"`.

---

## ФАЙЛЫ КОТОРЫЕ НУЖНО ТЕСТИРОВАТЬ В ПЕРВУЮ ОЧЕРЕДЬ

| Файл | Причина | Приоритет |
|------|---------|-----------|
| js/cartographer/globalMap.js | Сложная структура, часто ломается | ВЫСОКИЙ |
| script.js | Основная логика, 5000+ строк | ВЫСОКИЙ |
| main.js | Electron main, CSP, IPC | ВЫСОКИЙ |
| engine/engine_client.py | Python-C++ мост | СРЕДНИЙ |
| engine/meterea_engine.cpp | C++ движок | СРЕДНИЙ |
| index.html | Точка входа, скрипты | СРЕДНИЙ |

---

## PUSH ИНФРАСТРУКТУРА

- Push скрипт: `push.sh` (автоматически запускает test_runner.sh перед пушем)
- SSH wrapper: `.ssh/git_ssh_wrapper.py` (paramiko SSH)
- SSH ключ: `.ssh/deploy_key`
- Репозиторий: `https://github.com/GardenXsa/metera_d25_cp3-newAge`
- **ПРАВИЛО**: Никогда не пушить минуя push.sh! Он гарантирует тестирование.
  Если нужно пушить руками — сначала `bash test_runner.sh`, и только если 0 FAIL — `git push`.

---

## ЗАМЕТКИ ДЛЯ БУДУЩИХ СЕССИЙ

1. **Движок — главный нерешённый вопрос**. Пользователь говорит, что симуляция не работает.
   Нужно трассировать всю цепочку JS→Python→C++ и найти, где обрывается.

2. **UI оверхол** — пользователь хочет «игровой» интерфейс вместо примитивного.
   Нужно полностью переработать CSS и, возможно, HTML структуру.

3. **ОБЯЗАТЕЛЬНО: test_runner.sh перед каждым пушем!** push.sh делает это автоматически.
   Если тесты падают — пуш отменяется. Без исключений.

4. **_processHover** — это метод Cartographer, НЕ вложенная функция.
   Если его перемещать — убедиться, что this контекст правильный.

5. **ContainerRegistry / ItemRegistry** — глобальные Map объекты.
   CoreInventorySystemAsync — async версия, OldCoreInventorySystem — sync.
   ВНИМАНИЕ: не путать, не вызывать async методы без await.
