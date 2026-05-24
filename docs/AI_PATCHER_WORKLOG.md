# AI Patcher Worklog — Хроники Метерии

Этот файл — реестр того, что мы делаем с проектом. Его цель: не терять контекст, фиксировать применённые патчи, результаты проверок, риски и следующий шаг.

## Главная цель

Перевести проект на более data-driven архитектуру:

- убрать захардкоженные ID, числа, пути, лимиты и системные правила из JS/Electron/C++ кода;
- переносить их в `data/*.json`;
- подключать новые data-файлы через существующий `data/runtime_manifest.json`;
- оставлять fallback-значения в коде, чтобы проект не падал при повреждённом/отсутствующем конфиге;
- работать только JSON-патчами для AI Patcher Pro, без дополнительных py-скриптов.

---

## Принятый рабочий процесс

После каждого патча фиксируем:

1. имя патча;
2. какие файлы добавлены/изменены;
3. что именно вынесено в data;
4. какие команды проверки были запущены;
5. результат проверок;
6. известные риски;
7. следующий логичный шаг.

---

## Уже применённые патчи

### 1. `phase1_data_driven_ui_runtime_constants`

**Статус:** применён успешно.

**Добавлено:**

- `data/ui_runtime.json`

**Изменено:**

- `data/runtime_manifest.json`
- `js/mods/ModLoaderIntegration.js`
- `js/core/constants.js`

**Что сделали:**

Вынесли UI/runtime-константы из `js/core/constants.js` в `data/ui_runtime.json`:

- debug mode;
- save file prefix/extension;
- ключи localStorage;
- лимиты manual/auto saves;
- autosave interval;
- лимиты памяти/истории;
- initial stat points;
- points per level;
- default world id;
- language defaults;
- audio defaults;
- список музыки;
- список background-файлов;
- interval смены background.

**Проверки:**

```bash
node -e "const fs=require('fs'); JSON.parse(fs.readFileSync('data/runtime_manifest.json','utf8')); JSON.parse(fs.readFileSync('data/ui_runtime.json','utf8')); console.log('JSON OK')"
node --check js/core/constants.js && node --check js/mods/ModLoaderIntegration.js
```

**Результат:** обе проверки успешны.

**Риск:** низкий. Код сохранил fallback-значения.

---

### 2. `phase2_data_driven_electron_runtime`

**Статус:** применён успешно.

**Добавлено:**

- `data/electron_runtime.json`

**Изменено:**

- `main.js`

**Что сделали:**

Вынесли Electron/runtime/server/engine/Gemini-константы из `main.js` в `data/electron_runtime.json`:

- пути `saves`, `mods`, `settings.json`, `worlds`;
- host/port локального сервера;
- session token settings;
- localhost whitelist;
- rate limit настройки;
- safe json filename pattern;
- sensitive files/path substrings;
- лимиты размера файлов и чанков;
- preview byte limits;
- MIME types;
- CSP external sources;
- размеры окна Electron;
- preload file;
- external link protocols;
- engine binary names;
- engine timeout settings;
- command-specific timeouts;
- realtime default interval;
- allowed raw engine commands;
- Gemini generation config;
- Gemini default safety threshold.

**Проверки:**

```bash
node -e "const fs=require('fs'); JSON.parse(fs.readFileSync('data/electron_runtime.json','utf8')); console.log('electron_runtime JSON OK')"
node --check main.js
```

**Результат:** обе проверки успешны.

**Риск:** средний. `main.js` чувствителен к runtime-поведению, но синтаксис жив. Нужен ручной запуск приложения позже.

---

### 3. `phase3_data_driven_prompt_runtime`

**Статус:** применён частично, затем исправлен hotfix-патчем.

**Добавлено:**

- `data/prompt_runtime.json`

**Изменено:**

- `data/runtime_manifest.json`
- `js/mods/ModLoaderIntegration.js`
- `script.js`

**Что сделали:**

Вынесли часть prompt/runtime-настроек из `script.js`:

- пути к prompt-файлам `assets/promts/*`;
- шаблон `image_prompt`;
- языки ответа;
- default `time_passed`;
- шаблон suggested action;
- fallback-тексты;
- заголовки mod prompt injections;
- настройки command parser: `[COMMAND:`, `]`, `|:|`.

**Проверки:**

```bash
node -e "const fs=require('fs'); JSON.parse(fs.readFileSync('data/runtime_manifest.json','utf8')); JSON.parse(fs.readFileSync('data/prompt_runtime.json','utf8')); console.log('prompt runtime JSON OK')"
node --check script.js && node --check js/mods/ModLoaderIntegration.js
```

**Результат:**

- JSON OK;
- JS сначала упал на `script.js` около `ensurePlayerContainers`.

**Причина:** один replace попал рядом с уже существующим блоком system containers и сломал закрытие функции.

---

### 4. `hotfix_restore_system_container_function_closure`

**Статус:** применён успешно.

**Изменено:**

- `script.js`

**Что сделали:**

Восстановили закрытие блока создания system container перед `ensurePlayerContainers`.

**Проверки:**

```bash
node --check script.js && node --check js/mods/ModLoaderIntegration.js
```

**Результат:** успешно.

**Риск:** низкий. Это был точечный синтаксический hotfix.

---

### 5. `phase4_data_driven_gameplay_runtime_constants`

**Статус:** применён успешно.

**Добавлено:**

- `data/gameplay_runtime.json`

**Изменено:**

- `data/runtime_manifest.json`
- `js/mods/ModLoaderIntegration.js`
- `script.js`

**Что сделали:**

Вынесли gameplay/runtime-числа и ID из `script.js`:

- формулу mana;
- формулу HP;
- default item weight;
- default item durability;
- container access distance;
- default lock difficulty;
- default container health;
- non-flammable container types;
- region id для magical pocket;
- currency prototype ids;
- AI identifiers валюты;
- physical weight валюты;
- economy price multipliers;
- charisma baseline/step;
- min price;
- manpower weapon goods;
- manpower food goods;
- population-to-soldier ratio;
- food per soldier.

**Проверки:**

```bash
node -e "const fs=require('fs'); JSON.parse(fs.readFileSync('data/runtime_manifest.json','utf8')); JSON.parse(fs.readFileSync('data/gameplay_runtime.json','utf8')); console.log('gameplay runtime JSON OK')"
node --check script.js && node --check js/mods/ModLoaderIntegration.js
```

**Результат:** обе проверки успешны.

**Риск:** средний. Синтаксис жив, но нужна runtime-проверка экономики, контейнеров, валюты, HP/MP и faction manpower.

---

## Текущие data-файлы, добавленные нами

- `data/ui_runtime.json`
- `data/electron_runtime.json`
- `data/prompt_runtime.json`
- `data/gameplay_runtime.json`

Все они подключаются через `data/runtime_manifest.json` и прокидываются в runtime через `js/mods/ModLoaderIntegration.js`.

---

## Что НЕ проверено до конца

Сейчас у нас в основном пройдены проверки уровня:

- JSON parse;
- JS syntax check.

Ещё нужно отдельно проверить реальный запуск:

- старт Electron-приложения;
- загрузку runtime manifest;
- старт новой игры;
- загрузку сохранения;
- работу prompt сборки;
- работу inventory containers;
- создание/перенос предметов;
- gold/gold_ingot подсчёт;
- торговлю/economy price calculation;
- HP/MP пересчёт;
- faction manpower расчёты;
- запуск engine-команд из `main.js`.

---

## Следующие разумные шаги

### Шаг A — короткая runtime-проверка

Перед новыми большими патчами желательно запустить приложение и проверить хотя бы:

1. открывается ли главное окно;
2. грузится ли новая игра;
3. нет ли ошибок в DevTools console;
4. работает ли загрузка `runtime_manifest.json`;
5. создаются ли player containers;
6. не сломалась ли prompt-сборка.

### Шаг B — продолжение data-driven чистки

После runtime-проверки можно двигаться дальше маленькими патчами:

1. `script.js` — оставшийся хардкод inventory/actions/commands;
2. `script.js` — command/action handlers;
3. `engine/meterea_engine.cpp` — C++ hardcoded constants/data;
4. `engine/item_system.cpp` — item/container hardcoded rules;
5. `ProtoSystem/sityGen.html` — city generation constants;
6. старые временные утилиты/мусорные файлы, если они уже не нужны.

---

## Правило на будущее

Каждый следующий патч должен либо:

1. обновлять этот файл отдельной операцией `append`, либо
2. иметь отдельный маленький follow-up patch `update_project_worklog_registry`.

Без обновления реестра работу дальше не продолжаем.



---

### 6. `create_worklog_viewer_tool`

**Статус:** применён успешно.

**Добавлено:**

- `tools/worklog_viewer.html`
- `tools/worklog_viewer_server.js`
- `tools/open_worklog_viewer.bat`

**Что делаем:**

Добавляем удобный локальный просмотрщик реестра:

- авто-загрузка `docs/AI_PATCHER_WORKLOG.md` через локальный Node-сервер;
- ручное открытие `.md` через file picker;
- drag-and-drop Markdown-файла;
- поиск по реестру;
- список патчей в боковой панели;
- фильтры: все, успешные, с рисками, следующие шаги;
- счётчики патчей/успешных/рисков/следующих шагов;
- копирование Markdown;
- печать / сохранение в PDF.

**Как запускать:**

```bat
tools\open_worklog_viewer.bat
```

Либо напрямую:

```bash
node tools/worklog_viewer_server.js
```

**Риск:** низкий. Инструмент не меняет игровой runtime и только читает Markdown-файл.


**Проверки:**

```bash
node --check tools/worklog_viewer_server.js
node -e "const fs=require('fs'); ['tools/worklog_viewer.html','tools/worklog_viewer_server.js','tools/open_worklog_viewer.bat','docs/AI_PATCHER_WORKLOG.md'].forEach(f=>{if(!fs.existsSync(f)) throw new Error('missing '+f)}); console.log('worklog viewer files OK')"
```

**Результат:** обе проверки успешны.

**Следующий шаг:** перед новыми большими data-driven патчами желательно сделать короткий runtime smoke-test: запуск приложения, загрузка новой игры, проверка DevTools console, создание player containers, prompt-сборка, inventory/economy/HP/MP.



---

### 7. `create_runtime_smoke_check_tool`

**Статус:** применён успешно.

**Добавлено:**

- `tools/runtime_smoke_check.js`
- `tools/run_runtime_smoke_check.bat`

**Что делаем:**

Добавляем быстрый smoke-check инструмент перед продолжением крупных data-driven патчей.

Он проверяет:

- наличие ключевых файлов реестра и просмотрщика;
- наличие новых runtime data-файлов;
- валидность `package.json`;
- валидность `data/runtime_manifest.json`;
- существование всех файлов, указанных через `path` в runtime manifest;
- JSON-валидность manifest entries, если файл имеет расширение `.json`;
- синтаксис ключевых JS-файлов через `node --check`.

**Как запускать:**

```bat
tools\run_runtime_smoke_check.bat
```

Либо напрямую:

```bash
node tools/runtime_smoke_check.js
```

**Риск:** низкий. Инструмент ничего не изменяет в проекте, только читает файлы и запускает синтаксические проверки.


**Проверки:**

```bash
node --check tools/runtime_smoke_check.js
node tools/runtime_smoke_check.js
```

**Результат:** успешно. Smoke-check прошёл: `50 checks, 0 failed, 0 warnings`.

**Дополнительная правка:** вывод статусов в `tools/runtime_smoke_check.js` переведён с Unicode-иконок на ASCII-метки `[OK]`, `[WARN]`, `[SKIP]`, `[FAIL]`, чтобы в Windows console не появлялось `вњ“` вместо галочек.

**Следующий шаг:** продолжить data-driven чистку маленькими патчами. Ближайшая безопасная зона — оставшиеся runtime/action/inventory константы в `script.js`, затем отдельный проход по `ProtoSystem/sityGen.html` и C++ engine файлам.

**Следующий шаг:** после успешного smoke-check продолжить чистку `script.js` маленькими патчами, обновляя этот реестр после каждого этапа.



---

### 8. `cleanup_smoke_check_status_format`

**Статус:** применён успешно.

**Изменено:**

- `tools/runtime_smoke_check.js`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Убираем дублирование статуса в выводе smoke-check.

Было:

```text
[OK] OK   file docs/AI_PATCHER_WORKLOG.md
```

Должно стать:

```text
[OK]    file docs/AI_PATCHER_WORKLOG.md
```

**Зачем:**

Чтобы лог проверок был читаемым и не создавал визуальный шум.

**Риск:** низкий. Меняется только формат вывода диагностического инструмента.


**Проверки:**

```bash
node --check tools/runtime_smoke_check.js
node tools/runtime_smoke_check.js
```

**Результат:** успешно. Smoke-check снова зелёный: `50 checks, 0 failed, 0 warnings`.

**Итог:** вывод стал читаемым: `[OK] file ...` вместо `[OK] OK file ...`.



---

### 9. `create_ai_assistant_project_rules`

**Статус:** применён успешно.

**Добавлено:**

- `docs/AI_ASSISTANT_PROJECT_RULES.md`

**Изменено:**

- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Фиксируем набор правил для ассистента, чтобы в других чатах не терять контекст проекта.

Правила включают:

- вести worklog;
- информировать пользователя о ходе работы;
- работать JSON-патчами для AI Patcher Pro;
- не использовать лишние Python-скрипты;
- сверяться с актуальным GitHub/Git состоянием;
- после зелёных этапов напоминать пользователю сделать commit и push;
- перед продолжением читать `AI_PATCHER_WORKLOG.md` и `AI_ASSISTANT_PROJECT_RULES.md`;
- использовать smoke-check перед крупными правками.

**Риск:** низкий. Добавляется документация и обновляется реестр.


**Проверки:**

```bash
node -e "const fs=require('fs'); const rules='docs/AI_ASSISTANT_PROJECT_RULES.md'; if(!fs.existsSync(rules)) throw new Error('rules file missing'); const s=fs.readFileSync(rules,'utf8'); if(!s.includes('Git-правило')) throw new Error('git rule missing'); if(!s.includes('AI_PATCHER_WORKLOG.md')) throw new Error('worklog rule missing'); console.log('assistant project rules OK')"
node tools/runtime_smoke_check.js
```

**Результат:** успешно. Файл правил создан, Git-правило и worklog-правило найдены. Smoke-check зелёный: `50 checks, 0 failed, 0 warnings`.

**Итог:** теперь в проекте есть постоянные правила для следующих чатов: `docs/AI_ASSISTANT_PROJECT_RULES.md`.

**Git checkpoint:** после этого этапа рекомендуется сделать commit и push, чтобы GitHub стал актуальной точкой восстановления контекста.

**Следующий шаг:** после применения этого патча стоит сделать commit/push, потому что это важная точка синхронизации правил и инструментов проекта.
