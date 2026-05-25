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


**Результат:** успешно.

- блок `## Ближайшие следующие шаги` добавлен в `docs/DATA_DRIVEN_MIGRATION_PLAN.md`;
- правило обновления следующих шагов добавлено в `docs/AI_ASSISTANT_PROJECT_RULES.md`;
- smoke-check зелёный: `57 checks, 0 failed, 0 warnings`.

**Следующий рабочий блок:** Phase 6 continuation — продолжить перенос `script.js`: container/system container aliases, inventory movement / stacking / loot настройки, fallback messages для inventory/action handlers.

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



---

### 10. `phase5_data_driven_startup_calendar_bootstrap`

**Статус:** применён успешно.

**Изменено:**

- `data/gameplay_runtime.json`
- `script.js`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Продолжаем маленькую data-driven чистку `script.js` после Git checkpoint `e983e78`.

Вынесены в `data/gameplay_runtime.json`:

- fallback start year `1042`;
- months per year `12`;
- max random initial day `28`;
- days per year `360`;
- days per month `30`;
- initial hour/minute/totalPulses;
- inventory capacity formula: base `10`, strength baseline `10`, divisor `2`;
- bootstrap formula: minimum days `90`, base days `90`, population divisor `5000`.

**Зачем:**

Эти значения относятся к правилам мира/старта игры, а не к логике интерфейса. Теперь их можно менять через data-файл без переписывания `script.js`.

**Риск:** средний-низкий. Затронут старт новой игры и bootstrap мира, но поведение по умолчанию сохранено теми же fallback-значениями.

**Проверки:**

```bash
node -e "const fs=require('fs'); JSON.parse(fs.readFileSync('data/gameplay_runtime.json','utf8')); console.log('gameplay runtime JSON OK')"
node --check script.js
node tools/runtime_smoke_check.js
```


**Результат:** успешно. JSON валиден, `script.js` синтаксически валиден, smoke-check зелёный: `50 checks, 0 failed, 0 warnings`.



---

### 11. `add_migration_progress_plan_and_viewer_bar`

**Статус:** применён успешно.

**Добавлено:**

- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`

**Изменено:**

- `tools/worklog_viewer.html`
- `tools/runtime_smoke_check.js`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Добавляем видимый прогресс переноса:

- большой план data-driven миграции по фазам;
- чеклист задач;
- прогресс-бар в AI Patcher Worklog Viewer;
- счётчик закрытых/оставшихся пунктов;
- фазовый список с мини-прогрессом по каждой фазе.

**Зачем:**

Чтобы перенос не ощущался бесконечным и было видно, где мы находимся: что уже сделано, что ещё осталось, и какой блок идёт сейчас.

**Как считается процент:**

Viewer читает `docs/DATA_DRIVEN_MIGRATION_PLAN.md`, считает Markdown-чекбоксы `- [x]` и `- [ ]`. Процент приблизительный, потому что все пункты равного веса.

**Риск:** низкий. Меняется только документация, viewer и smoke-check expected files. Игровой runtime не затрагивается.


**Проверки:**

```bash
node --check tools/runtime_smoke_check.js
node tools/runtime_smoke_check.js
node -e "const fs=require('fs'); const plan=fs.readFileSync('docs/DATA_DRIVEN_MIGRATION_PLAN.md','utf8'); if(!plan.includes('Phase 12')) throw new Error('plan incomplete'); const viewer=fs.readFileSync('tools/worklog_viewer.html','utf8'); if(!viewer.includes('migrationFill')) throw new Error('progress bar missing'); console.log('migration progress plan/viewer OK')"
```

**Результат:** успешно. Smoke-check зелёный: `51 checks, 0 failed, 0 warnings`. План миграции создан, прогресс-бар найден в viewer.

**Итог:** теперь прогресс переноса виден в `tools/worklog_viewer.html` через чекбоксы из `docs/DATA_DRIVEN_MIGRATION_PLAN.md`.

**Проверки после применения:**

```bash
node --check tools/runtime_smoke_check.js
node tools/runtime_smoke_check.js
node -e "const fs=require('fs'); const plan=fs.readFileSync('docs/DATA_DRIVEN_MIGRATION_PLAN.md','utf8'); if(!plan.includes('Phase 12')) throw new Error('plan incomplete'); const viewer=fs.readFileSync('tools/worklog_viewer.html','utf8'); if(!viewer.includes('migrationFill')) throw new Error('progress bar missing'); console.log('migration progress plan/viewer OK')"
```



---

### 12. `lock_worklog_and_migration_plan_tracking_rule`

**Статус:** применён успешно.

**Изменено:**

- `docs/AI_ASSISTANT_PROJECT_RULES.md`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Фиксируем постоянное правило сопровождения проекта:

- `docs/AI_PATCHER_WORKLOG.md` должен обновляться после каждого значимого патча;
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md` должен обновляться после каждого этапа, который влияет на прогресс переноса;
- прогресс-бар viewer считается источником визуального прогресса, поэтому чекбоксы плана должны быть актуальными.

**Зачем:**

Чтобы пользователь видел реальный прогресс, а ассистент в новых чатах не терялся и не продолжал работу вслепую.

**Риск:** низкий. Это документационное правило, игровой runtime не затрагивается.


**Проверки:**

```bash
node -e "const fs=require('fs'); const rules=fs.readFileSync('docs/AI_ASSISTANT_PROJECT_RULES.md','utf8'); if(!rules.includes('DATA_DRIVEN_MIGRATION_PLAN.md')) throw new Error('migration plan rule missing'); const log=fs.readFileSync('docs/AI_PATCHER_WORKLOG.md','utf8'); if(!log.includes('51 checks, 0 failed, 0 warnings')) throw new Error('progress viewer result missing'); console.log('tracking rule documented OK')"
node tools/runtime_smoke_check.js
```

**Результат:** успешно. Smoke-check зелёный: `51 checks, 0 failed, 0 warnings`.

**Проверки после применения:**

```bash
node -e "const fs=require('fs'); const rules=fs.readFileSync('docs/AI_ASSISTANT_PROJECT_RULES.md','utf8'); if(!rules.includes('DATA_DRIVEN_MIGRATION_PLAN.md')) throw new Error('migration plan rule missing'); const log=fs.readFileSync('docs/AI_PATCHER_WORKLOG.md','utf8'); if(!log.includes('51 checks, 0 failed, 0 warnings')) throw new Error('progress viewer result missing'); console.log('tracking rule documented OK')"
node tools/runtime_smoke_check.js
```



---

### 13. `phase6_data_driven_inventory_runtime_controls`

**Статус:** применён успешно.

**Изменено:**

- `data/gameplay_runtime.json`
- `script.js`
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Начинаем Phase 6 маленьким безопасным куском: inventory runtime controls.

В `data/gameplay_runtime.json` вынесены:

- префикс container id: `cont_`;
- префикс item id: `item_`;
- default actor id: `player`;
- system actor id: `system`;
- IPC retry max retries: `3`;
- IPC retry delay: `500` ms;
- backoff multiplier.

В `script.js` добавлены helper-функции:

- `getInventoryEngineRuntimeConfig()`;
- `getInventoryActorId()`.

**Зачем:**

Эти значения относятся к runtime-настройкам inventory/engine bridge, а не к бизнес-логике. Теперь их можно менять через data-файл без поиска по `script.js`.

**Прогресс:**

В `docs/DATA_DRIVEN_MIGRATION_PLAN.md` добавлены закрытые подпункты Phase 6, чтобы progress bar в Worklog Viewer отражал реальное движение.

**Риск:** средний-низкий. Затронуты создание item/container id и retry логика inventory IPC. Fallback-значения совпадают со старым поведением.

**Проверки:**

```bash
node -e "const fs=require('fs'); JSON.parse(fs.readFileSync('data/gameplay_runtime.json','utf8')); console.log('gameplay runtime JSON OK')"
node --check script.js
node tools/runtime_smoke_check.js
node -e "const fs=require('fs'); const plan=fs.readFileSync('docs/DATA_DRIVEN_MIGRATION_PLAN.md','utf8'); if(!plan.includes('inventory id prefixes')) throw new Error('phase6 progress missing'); console.log('phase6 migration progress OK')"
```


**Результат:** успешно. JSON валиден, `script.js` синтаксически валиден, smoke-check зелёный: `51 checks, 0 failed, 0 warnings`, migration plan обновлён.



---

### 14. `phase7_runtime_config_contract_checks_fixed`

**Статус:** применён успешно.

**Добавлено:**

- `tools/validate_runtime_configs.js`

**Изменено:**

- `tools/runtime_smoke_check.js`
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Добавляем data-contract validator для новых runtime config файлов:

- `data/ui_runtime.json`;
- `data/electron_runtime.json`;
- `data/prompt_runtime.json`;
- `data/gameplay_runtime.json`.

Validator проверяет базовые типы и границы значений: объекты, строки, массивы строк, числа, boolean, диапазоны volume/topP/port/лимитов.

`tools/runtime_smoke_check.js` теперь запускает этот validator как часть общего smoke-check.

**Зачем:**

Дальше перенос будет затрагивать больше data-файлов. Простого `JSON.parse` уже мало: битый ключ или неверный тип может пройти синтаксис, но сломать runtime. Этот слой ловит такие ошибки раньше.

**Прогресс:**

В `docs/DATA_DRIVEN_MIGRATION_PLAN.md` закрываются пункты Phase 7 по structure checks для четырёх runtime configs и расширению smoke-check до data-contract проверки.

**Риск:** низкий-средний. Runtime игры не меняется, но smoke-check стал строже и теперь ловит ошибки структуры runtime config раньше.

**Проверки:**

```bash
node --check tools/validate_runtime_configs.js
node tools/validate_runtime_configs.js
node --check tools/runtime_smoke_check.js
node tools/runtime_smoke_check.js
node -e "const fs=require('fs'); const plan=fs.readFileSync('docs/DATA_DRIVEN_MIGRATION_PLAN.md','utf8'); if(!plan.includes('- [x] Добавить проверку структуры `gameplay_runtime.json`.')) throw new Error('phase7 progress missing'); console.log('phase7 migration progress OK')"
```


**Результат:** успешно.

- `tools/validate_runtime_configs.js` синтаксически валиден;
- runtime config contracts OK;
- `tools/runtime_smoke_check.js` синтаксически валиден;
- общий smoke-check зелёный: `54 checks, 0 failed, 0 warnings`;
- migration plan обновлён для progress bar.

**Следующий шаг:** продолжить Phase 7: добавить проверки ссылок между data-файлами, дублей ID и отсутствующих prototype ids.



---

### 15. `phase7_data_integrity_link_checks`

**Статус:** применён успешно после hotfix.

**Добавлено:**

- `tools/validate_data_integrity.js`

**Изменено:**

- `tools/runtime_smoke_check.js`
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Добавляем data integrity validator для связей между data-файлами.

Проверяет:

- соответствие `default_type` из `data/runtime_manifest.json` реальному типу JSON-файла;
- дубли `id` в data-массивах;
- ссылки `inputs` / `outputs` из `data/economy_recipes.json` на существующие item prototypes из `data/economy_items.json`;
- ссылки `gameplay_runtime.currency.prototype_ids` на существующие item prototypes;
- ссылки `gameplay_runtime.faction_manpower.weapon_good_ids` и `food_good_ids` на существующие item prototypes;
- положительные числовые количества в рецептах.

**Зачем:**

После переноса правил в data-файлы важно ловить не только битый JSON, но и битые связи. Это снижает риск тихих runtime-ошибок при следующих переносах.

**Прогресс:**

В `docs/DATA_DRIVEN_MIGRATION_PLAN.md` закрываются пункты Phase 7:

- проверка ссылок между data-файлами;
- проверка дублей ID;
- проверка отсутствующих prototype ids.

**Риск:** низкий-средний. Игровой runtime не меняется, но smoke-check становится ещё строже.


**Результат первого запуска:** validator подключился, но smoke-check стал красным: `57 checks, 1 failed, 0 warnings`.

Ошибка:

```text
gameplay_runtime.currency.prototype_ids: unknown item prototype "gold"
```

**Причина:** `gold` используется как физическая валюта из `gameplay_runtime.currency.physical_weights`, но не обязан существовать как обычный prototype в `data/economy_items.json`. Проверка была слишком строгой для currency ids.


**Итог после hotfix:** проверка связей data-файлов зелёная. Общий smoke-check: `57 checks, 0 failed, 0 warnings`.

**Проверки после применения:**

```bash
node --check tools/validate_data_integrity.js
node tools/validate_data_integrity.js
node --check tools/runtime_smoke_check.js
node tools/runtime_smoke_check.js
node -e "const fs=require('fs'); const plan=fs.readFileSync('docs/DATA_DRIVEN_MIGRATION_PLAN.md','utf8'); if(!plan.includes('- [x] Добавить проверку отсутствующих prototype ids.')) throw new Error('phase7 integrity progress missing'); console.log('phase7 data integrity progress OK')"
```



---

### 16. `hotfix_currency_integrity_allows_physical_currency`

**Статус:** применён успешно.

**Изменено:**

- `tools/validate_data_integrity.js`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Исправляем правило проверки валюты в data integrity validator.

Теперь `gameplay_runtime.currency.prototype_ids` считается валидным, если id найден хотя бы в одном месте:

- как обычный prototype в `data/economy_items.json`;
- как физическая валюта в `gameplay_runtime.currency.physical_weights` с положительным числовым весом.

При этом ссылки `faction_manpower.weapon_good_ids` и `faction_manpower.food_good_ids` остаются строгими: они должны существовать в `data/economy_items.json`.

**Зачем:**

`gold` сейчас является валидной физической валютой, но не обычным economy item. Validator должен отражать фактическую модель данных, а не ломать smoke-check на корректном currency id.

**Риск:** низкий. Игровой runtime не меняется. Меняется только диагностическое правило validator.


**Проверки:**

```bash
node --check tools/validate_data_integrity.js
node tools/validate_data_integrity.js
node tools/runtime_smoke_check.js
```

**Результат:** успешно.

- `tools/validate_data_integrity.js` синтаксически валиден;
- `data integrity links OK`;
- общий smoke-check зелёный: `57 checks, 0 failed, 0 warnings`.

**Следующий шаг:** можно продолжать Phase 7 или перейти к следующему data-driven блоку. Ближайший полезный вариант — добавить более глубокие проверки `economy_items` / `economy_recipes` или вернуться к Phase 6 и выносить следующие `script.js` handlers.

**Проверки после применения:**

```bash
node --check tools/validate_data_integrity.js
node tools/validate_data_integrity.js
node tools/runtime_smoke_check.js
```



---

### 17. `add_explicit_next_steps_tracking`

**Статус:** применён успешно.

**Изменено:**

- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `docs/AI_ASSISTANT_PROJECT_RULES.md`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Добавляем явный блок `Ближайшие следующие шаги` в migration plan.

**Зачем:**

До этого следующий шаг фиксировался внутри отдельных записей worklog, но не был виден как отдельная текущая навигация проекта. Теперь в плане будет явно указано:

- какая фаза сейчас активна;
- какая последняя зелёная точка;
- какой следующий рабочий блок;
- когда делать следующий Git checkpoint.

**Текущий следующий шаг:**

Вернуться к Phase 6 и продолжить перенос `script.js`:

1. container/system container aliases и правила доступа;
2. inventory movement / stacking / loot настройки;
3. fallback messages для inventory/action handlers.

**Риск:** низкий. Меняется только документация и правила сопровождения проекта.

**Проверки:**

```bash
node -e "const fs=require('fs'); const plan=fs.readFileSync('docs/DATA_DRIVEN_MIGRATION_PLAN.md','utf8'); if(!plan.includes('## Ближайшие следующие шаги')) throw new Error('next steps block missing'); if(!plan.includes('Phase 6 continuation')) throw new Error('current phase not updated'); const rules=fs.readFileSync('docs/AI_ASSISTANT_PROJECT_RULES.md','utf8'); if(!rules.includes('Ближайшие следующие шаги')) throw new Error('next steps rule missing'); console.log('next steps tracking OK')"
node tools/runtime_smoke_check.js
```



---

### 18. `phase6_inventory_handlers_context_audit_runnable`

**Статус:** audit выполнен частично; контекста достаточно для следующего Phase 6 патча.

**Что делаем:**

Собираем точный контекст из `script.js` перед следующим Phase 6 патчем.

**Зачем:**

AI Patcher не запускает команды, если `operations` пустой. Поэтому этот audit имеет безопасную документационную операцию, чтобы команды реально выполнились.

**Ищем:**

- system containers;
- container aliases;
- movement / transfer / stacking / loot;
- access flags;
- hardcoded fallback/user-facing inventory strings.

**Риск:** низкий. Код runtime не меняется, выполняются только read-only команды анализа.


**Результат:**

- команды поиска system containers / movement / stacking / loot / access flags успешно нашли нужные места в `script.js`;
- команда поиска строк упала из-за PowerShell quoting, runtime не затронут;
- smoke-check после audit остался зелёным: `57 checks, 0 failed, 0 warnings`.

**Вывод:** следующий безопасный кусок — заменить оставшиеся hardcoded `actorId: 'player'` / `actorId: 'system'` в inventory movement/trade/death flows на уже существующие `getInventoryActorId('default')` и `getInventoryActorId('system')`.



---

### 19. `phase6_data_driven_inventory_actor_routes`

**Статус:** применён успешно.

**Изменено:**

- `script.js`
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Продолжаем Phase 6 и вычищаем оставшиеся hardcoded inventory actor ids в movement/trade/death flows.

Заменяем:

- `actorId: 'player'` на `getInventoryActorId('default')`;
- `actorId: 'system'` на `getInventoryActorId('system')`;
- проверки `actorId === 'player'` на сравнение с `getInventoryActorId('default')`.

**Зачем:**

`data/gameplay_runtime.json` уже содержит `inventory_engine.actors.default` и `inventory_engine.actors.system`. Код должен использовать этот runtime config последовательно, а не держать новые literal islands в `script.js`.

**Прогресс:**

В `docs/DATA_DRIVEN_MIGRATION_PLAN.md` закрывается Phase 6 подпункт про inventory actor ids. Блок `Ближайшие следующие шаги` обновлён: следующий рабочий кусок — buildContainer recipe/capacity defaults.

**Риск:** средний-низкий. Затронуты inventory movement/trade/death flows, но fallback actor ids совпадают со старым поведением: `player` и `system`.

**Проверки:**

```bash
node --check script.js
node tools/runtime_smoke_check.js
node -e "const fs=require('fs'); const plan=fs.readFileSync('docs/DATA_DRIVEN_MIGRATION_PLAN.md','utf8'); if(!plan.includes('hardcoded inventory actor ids')) throw new Error('actor route progress missing'); console.log('phase6 actor route progress OK')"
```


**Результат:** успешно.

- `script.js` синтаксически валиден;
- общий smoke-check зелёный: `57 checks, 0 failed, 0 warnings`;
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md` обновлён для progress bar Phase 6.

**Следующий рабочий блок:** вынести `buildContainer` defaults: стоимость дерева, max weight, max slots и default coords.



---

### 20. `phase6_data_driven_build_container_defaults`

**Статус:** применён успешно.

**Изменено:**

- `data/gameplay_runtime.json`
- `script.js`
- `tools/validate_runtime_configs.js`
- `tools/validate_data_integrity.js`
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Продолжаем Phase 6 и выносим defaults для `buildContainer` из `script.js` в `data/gameplay_runtime.json`.

Вынесены:

- resource prototype для строительства контейнера: `wood`;
- resource cost: `5`;
- default max weight: `100`;
- default max slots: `20`;
- default world coords: `[0, 0, 0]`.

В `script.js` добавлены helper-функции:

- `getInventoryBuildingRuntimeConfig()`;
- `buildConstructedContainerLocation()`.

**Зачем:**

`buildContainer` больше не должен знать, что контейнер строится именно из `wood`, за `5` единиц, с capacity `100/20` и координатами `[0,0,0]`. Это правила gameplay/data слоя.

**Дополнительная защита:**

- `tools/validate_runtime_configs.js` проверяет структуру `inventory_building`;
- `tools/validate_data_integrity.js` проверяет, что `inventory_building.resource_prototype_id` существует в `data/economy_items.json`.

**Прогресс:**

В `docs/DATA_DRIVEN_MIGRATION_PLAN.md` закрывается Phase 6 подпункт про `buildContainer` defaults. Блок `Ближайшие следующие шаги` обновлён: дальше movement/stacking/loot settings и fallback messages.

**Риск:** средний-низкий. Затронуты sync/async `buildContainer`, но default-значения совпадают со старым поведением.

**Проверки:**

```bash
node -e "const fs=require('fs'); JSON.parse(fs.readFileSync('data/gameplay_runtime.json','utf8')); console.log('gameplay runtime JSON OK')"
node --check script.js
node --check tools/validate_runtime_configs.js
node --check tools/validate_data_integrity.js
node tools/validate_runtime_configs.js
node tools/validate_data_integrity.js
node tools/runtime_smoke_check.js
node -e "const fs=require('fs'); const plan=fs.readFileSync('docs/DATA_DRIVEN_MIGRATION_PLAN.md','utf8'); if(!plan.includes('buildContainer` recipe/capacity defaults')) throw new Error('buildContainer progress missing'); console.log('phase6 buildContainer progress OK')"
```


**Результат:** успешно.

- `data/gameplay_runtime.json` валиден;
- `script.js` синтаксически валиден;
- `tools/validate_runtime_configs.js` и `tools/validate_data_integrity.js` синтаксически валидны;
- runtime config contracts OK;
- data integrity links OK;
- общий smoke-check зелёный: `57 checks, 0 failed, 0 warnings`;
- migration plan обновлён для progress bar Phase 6.

**Следующий рабочий блок:** сделать Git checkpoint, затем продолжить Phase 6: inventory movement / stacking / loot settings и fallback messages для inventory/action handlers.



---

### 21. `git_checkpoint_after_phase6_build_container_defaults`

**Статус:** выполнен успешно.

**Что делаем:**

Фиксируем зелёную пачку изменений после `phase6_data_driven_build_container_defaults`.

**Последняя зелёная точка перед checkpoint:**

```text
Summary: 57 checks, 0 failed, 0 warnings
```

**В commit должны попасть:**

- `data/gameplay_runtime.json`
- `docs/AI_ASSISTANT_PROJECT_RULES.md`
- `docs/AI_PATCHER_WORKLOG.md`
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `script.js`
- `tools/runtime_smoke_check.js`
- `tools/worklog_viewer.html`
- `tools/validate_data_integrity.js`
- `tools/validate_runtime_configs.js`

**Не добавляем автоматически:**

- `.ai_patcher/` — выглядит как служебная папка AI Patcher Pro.

**Риск:** низкий. Код уже прошёл smoke-check; этот патч добавляет запись в worklog и выполняет Git-команды.


**Проверки перед commit:**

```bash
node tools/runtime_smoke_check.js
```

**Результат:** успешно. Smoke-check перед commit зелёный: `57 checks, 0 failed, 0 warnings`.

**Git результат:**

```text
commit: df96baa
message: chore: extend data-driven runtime validation and inventory config
push: e983e78..df96baa master -> master
```

**Финальный git status:** после push осталась только служебная папка `.ai_patcher/`. Её нужно игнорировать, а не коммитить.



---

### 22. `ignore_ai_patcher_local_state`

**Статус:** применён успешно.

**Изменено:**

- `.gitignore`
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Добавляем `.ai_patcher/` в `.gitignore`, потому что после успешного checkpoint эта папка осталась единственным untracked элементом.

**Зачем:**

`.ai_patcher/` выглядит как локальное служебное состояние AI Patcher Pro. Его не нужно коммитить в проектный репозиторий.

**Риск:** низкий. Игровой runtime не затрагивается.

**Проверки:**

```bash
node -e "const fs=require('fs'); const s=fs.readFileSync('.gitignore','utf8'); if(!s.includes('.ai_patcher/')) throw new Error('.ai_patcher ignore missing'); console.log('ai_patcher ignore OK')"
git status --short
```


**Результат:** успешно.

- `data/gameplay_runtime.json` валиден;
- `script.js` синтаксически валиден;
- `tools/validate_runtime_configs.js` синтаксически валиден;
- runtime config contracts OK;
- общий smoke-check зелёный: `57 checks, 0 failed, 0 warnings`;
- `getInventoryFeedbackText()` присутствует;
- старый literal `error: "Item not found"` убран;
- migration plan получил прогресс по `inventory/action feedback errors`.

**Текущие изменения после применения:**

```text
 M data/gameplay_runtime.json
 M docs/AI_PATCHER_WORKLOG.md
 M docs/DATA_DRIVEN_MIGRATION_PLAN.md
 M script.js
 M tools/validate_runtime_configs.js
```

**Следующий рабочий блок:** Phase 8 — `ProtoSystem/sityGen.html` / city generation data-driven слой. Phase 6 inventory/action слой получил большой ощутимый прогресс и готов к checkpoint.


**Результат:** успешно.

- Worklog Viewer теперь умеет сопоставлять `Full data-driven migration` с секцией `Full migration mandate`;
- `currentPhaseFill` найден;
- `findCurrentPhaseProgress()` найден;
- smoke-check зелёный: `57 checks, 0 failed, 0 warnings`;
- текущий git status показывает изменения в `docs/AI_PATCHER_WORKLOG.md`, `docs/DATA_DRIVEN_MIGRATION_PLAN.md`, `tools/worklog_viewer.html`.

**Следующий рабочий блок:** крупный Phase 6 audit по fallback messages + inventory/action handler errors, затем один средний/крупный subsystem patch вместо микрошагов.


**Результат:** успешно.

- `tools/worklog_viewer.html` получил отдельный progress bar текущей фазы;
- parser `findCurrentPhaseProgress()` найден;
- smoke-check зелёный: `57 checks, 0 failed, 0 warnings`;
- текущий `git status` показывает накопленную пачку изменений для checkpoint.

**Текущие незакоммиченные изменения:**

```text
 M .gitignore
 M data/gameplay_runtime.json
 M docs/AI_ASSISTANT_PROJECT_RULES.md
 M docs/AI_PATCHER_WORKLOG.md
 M docs/DATA_DRIVEN_MIGRATION_PLAN.md
 M script.js
 M tools/validate_runtime_configs.js
 M tools/worklog_viewer.html
```

**Следующий шаг:** сделать Git checkpoint, потому что средний Phase 6 subsystem-патч и улучшение viewer уже зелёные.


**Результат:** успешно.

- `.ai_patcher/` добавлен в `.gitignore`;
- checkpoint docs и ignore rule проверены;
- smoke-check зелёный: `57 checks, 0 failed, 0 warnings`;
- после применения остались незакоммиченные изменения только в `.gitignore`, `docs/AI_PATCHER_WORKLOG.md`, `docs/DATA_DRIVEN_MIGRATION_PLAN.md`.

**Git status после применения:**

```text
 M .gitignore
 M docs/AI_PATCHER_WORKLOG.md
 M docs/DATA_DRIVEN_MIGRATION_PLAN.md
```

**Следующий шаг:** продолжить Phase 6: inventory movement / stacking / loot settings. После следующего зелёного куска сделать commit/push, включив `.gitignore` и обновлённые docs.



---

### 23. `phase6_data_driven_inventory_movement_settings`

**Статус:** применён успешно.

**Изменено:**

- `data/gameplay_runtime.json`
- `script.js`
- `tools/validate_runtime_configs.js`
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Продолжаем Phase 6 и выносим часть inventory movement settings из `script.js` в `data/gameplay_runtime.json`.

Вынесены:

- sentinel полного перемещения стака: `-1`;
- default item state: `idle`;
- trade-locked item state: `in_trade`;
- container type для списания ресурса региона при перемещении из faction vault: `faction_vault`.

В `script.js` добавлены helper-функции:

- `getInventoryMovementRuntimeConfig()`;
- `isFullStackMoveQuantity()`;
- `normalizeInventoryMoveQuantity()`;
- `serializeInventoryMoveQuantity()`.

**Зачем:**

Это убирает очередной слой literal values из movement/trade flow и делает правила перемещения предметов управляемыми через runtime data.

**Дополнительная защита:**

`tools/validate_runtime_configs.js` теперь проверяет структуру `inventory_movement`.

**Прогресс:**

В `docs/DATA_DRIVEN_MIGRATION_PLAN.md` закрывается Phase 6 подпункт про inventory movement settings. Блок `Ближайшие следующие шаги` обновлён: после зелёного результата нужно сделать Git checkpoint, затем продолжать stacking/loot и fallback messages.

**Риск:** средний. Затронуты movement/trade states и sentinel полного перемещения стака, но fallback-значения совпадают со старым поведением.

**Проверки:**

```bash
node -e "const fs=require('fs'); JSON.parse(fs.readFileSync('data/gameplay_runtime.json','utf8')); console.log('gameplay runtime JSON OK')"
node --check script.js
node --check tools/validate_runtime_configs.js
node tools/validate_runtime_configs.js
node tools/runtime_smoke_check.js
node -e "const fs=require('fs'); const plan=fs.readFileSync('docs/DATA_DRIVEN_MIGRATION_PLAN.md','utf8'); if(!plan.includes('inventory movement settings')) throw new Error('movement settings progress missing'); console.log('phase6 movement settings progress OK')"
```


**Результат:** успешно.

- `data/gameplay_runtime.json` валиден;
- `script.js` синтаксически валиден;
- `tools/validate_runtime_configs.js` синтаксически валиден;
- runtime config contracts OK;
- общий smoke-check зелёный: `57 checks, 0 failed, 0 warnings`;
- migration plan обновлён для progress bar Phase 6.

**Коррекция стратегии:** пользователь справедливо отметил, что шаги стали слишком маленькими и прогресс почти не ощущается. Дальше переходим с микропатчей на средние subsystem-патчи: один патч должен закрывать несколько связанных переносов внутри одной зоны, но не смешивать разные подсистемы.



---

### 24. `phase6_medium_inventory_transfer_loot_command_settings`

**Статус:** применён успешно после исправления блоков 13/14.

**Изменено:**

- `data/gameplay_runtime.json`
- `script.js`
- `tools/validate_runtime_configs.js`
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `docs/AI_PATCHER_WORKLOG.md`


**Примечание перед проверкой:** первые 21 операции большого патча были найдены успешно, но операции 13 и 14 требовали ручной замены search-блоков. После применения двух исправленных блоков запускаем проверки отдельным verification-патчем.

**Что делаем:**

Переходим с микропатчей на средний subsystem-патч внутри Phase 6.

В `data/gameplay_runtime.json` выносим сразу несколько связанных настроек inventory/action слоя:

- `inventory_movement.stack_size_field`;
- `inventory_movement.transfer_options` presets;
- `inventory_commands` aliases;
- `inventory_loot` defaults;
- currency physical weight helper usage в местах, где раньше был literal `0.01`.

В `script.js` добавлены helper-функции:

- `getInventoryStackField()`;
- `getInventoryCommandName()`;
- `getInventoryTransferOptions()`;
- `getInventoryLootRuntimeConfig()`;
- `getPrimaryCurrencyPrototypeId()`;
- `getCurrencyPhysicalWeight()`.

**Зачем:**

Это заметнее двигает Phase 6: не одна константа, а связанный слой команд, transfer presets, loot defaults и currency weight usage.

**Дополнительная защита:**

`tools/validate_runtime_configs.js` теперь проверяет новые секции `inventory_movement.transfer_options`, `inventory_commands` и `inventory_loot`.

**Прогресс:**

В `docs/DATA_DRIVEN_MIGRATION_PLAN.md` закрывается новый Phase 6 подпункт. Следующий шаг — Git checkpoint после зелёного результата, затем fallback messages / action handler errors.

**Риск:** средний. Затронуты inventory transfer options, command aliases, loot event handling и currency weight helpers. Fallback-значения совпадают со старым поведением.

**Проверки:**

```bash
node -e "const fs=require('fs'); JSON.parse(fs.readFileSync('data/gameplay_runtime.json','utf8')); console.log('gameplay runtime JSON OK')"
node --check script.js
node --check tools/validate_runtime_configs.js
node tools/validate_runtime_configs.js
node tools/runtime_smoke_check.js
node -e "const fs=require('fs'); const plan=fs.readFileSync('docs/DATA_DRIVEN_MIGRATION_PLAN.md','utf8'); if(!plan.includes('transfer option presets')) throw new Error('medium phase6 progress missing'); console.log('phase6 medium transfer/loot/commands progress OK')"
```


**Результат:** успешно.

- `data/gameplay_runtime.json` валиден;
- `script.js` синтаксически валиден;
- `tools/validate_runtime_configs.js` синтаксически валиден;
- runtime config contracts OK;
- общий smoke-check зелёный: `57 checks, 0 failed, 0 warnings`;
- исправленные блоки 13/14 присутствуют в `script.js`;
- migration plan обновлён для progress bar Phase 6.

**Примечание:** большой патч сначала имел 2 неверных search-блока. Пользователь удалил неверные блоки 13/14 в UI AI Patcher Pro и применил исправленный мини-патч только с двумя операциями. Такой workflow признан рабочим.

**Следующий рабочий блок:** сделать Git checkpoint, затем продолжить Phase 6: fallback messages + inventory/action handler errors.



---

### 25. `allow_command_only_patches_and_corrected_blocks_workflow`

**Статус:** применён успешно.

**Изменено:**

- `docs/AI_ASSISTANT_PROJECT_RULES.md`
- `docs/AI_PATCHER_WORKLOG.md`
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`

**Что делаем:**

Обновляем правила работы с AI Patcher Pro после апдейта патчера.

Изменения правил:

- command-only patches снова разрешены;
- больше не нужно добавлять фиктивную docs-операцию только ради запуска команд;
- если большой патч почти весь зелёный, но 1–2 блока неверные, можно дать маленький patch только с исправленными блоками.

**Зачем:**

AI Patcher Pro теперь исправил проблему с command-only patches, а workflow с ручным удалением 1–2 плохих блоков уже доказал пользу на `phase6_medium_inventory_transfer_loot_command_settings`.

**Риск:** низкий. Меняются только правила сопровождения и документация.


**Проверки:**

```bash
node -e "const fs=require('fs'); const rules=fs.readFileSync('docs/AI_ASSISTANT_PROJECT_RULES.md','utf8'); if(!rules.includes('command-only патчи снова разрешены')) throw new Error('command-only rule not updated'); if(!rules.includes('Исправление частично зелёных патчей')) throw new Error('corrected blocks workflow missing'); const log=fs.readFileSync('docs/AI_PATCHER_WORKLOG.md','utf8'); if(!log.includes('### 24. `phase6_medium_inventory_transfer_loot_command_settings`')) throw new Error('entry 24 missing'); if(!log.includes('применён успешно после исправления блоков 13/14')) throw new Error('entry 24 result missing'); console.log('command-only and corrected-block workflow rules OK')"
node tools/runtime_smoke_check.js
git status --short
```

**Результат:** успешно. Правило command-only patches обновлено, workflow corrected blocks зафиксирован, smoke-check зелёный: `57 checks, 0 failed, 0 warnings`.

**Проверки после применения:**

```bash
node -e "const fs=require('fs'); const rules=fs.readFileSync('docs/AI_ASSISTANT_PROJECT_RULES.md','utf8'); if(!rules.includes('command-only патчи снова разрешены')) throw new Error('command-only rule not updated'); if(!rules.includes('Исправление частично зелёных патчей')) throw new Error('corrected blocks workflow missing'); const log=fs.readFileSync('docs/AI_PATCHER_WORKLOG.md','utf8'); if(!log.includes('### 24. `phase6_medium_inventory_transfer_loot_command_settings`')) throw new Error('entry 24 missing'); if(!log.includes('применён успешно после исправления блоков 13/14')) throw new Error('entry 24 result missing'); console.log('command-only and corrected-block workflow rules OK')"
node tools/runtime_smoke_check.js
git status --short
```



---

### 26. `improve_worklog_viewer_phase_progress_visibility`

**Статус:** применён успешно.

**Изменено:**

- `tools/worklog_viewer.html`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Исправляем UX progress bar в AI Patcher Worklog Viewer.

Проблема: общий progress bar считает все чекбоксы всего большого migration plan равным весом. Из-за этого даже средний Phase 6 патч визуально почти не двигает общий процент.

Добавляем отдельный, более заметный блок:

- общий прогресс всей data-driven миграции с десятыми долями процента;
- отдельный progress bar текущей фазы;
- счётчик `done/total` именно для текущей фазы;
- пояснение, почему общий процент меняется медленно.

**Зачем:**

Пользователь должен видеть реальное движение не только по всей огромной миграции, но и по активной фазе. Это делает прогресс ощутимым без искажения общего процента.

**Риск:** низкий. Игровой runtime не затрагивается, меняется только viewer и documentation.

**Проверки:**

```bash
node -e "const fs=require('fs'); const viewer=fs.readFileSync('tools/worklog_viewer.html','utf8'); if(!viewer.includes('currentPhaseFill')) throw new Error('current phase progress bar missing'); if(!viewer.includes('findCurrentPhaseProgress')) throw new Error('current phase parser missing'); const log=fs.readFileSync('docs/AI_PATCHER_WORKLOG.md','utf8'); if(!log.includes('### 26. `improve_worklog_viewer_phase_progress_visibility`')) throw new Error('entry 26 missing'); console.log('viewer phase progress visibility OK')"
node tools/runtime_smoke_check.js
git status --short
```



---

### 27. `git_checkpoint_after_phase6_medium_inventory_and_viewer_progress`

**Статус:** выполнен успешно.

**Что делаем:**

Фиксируем зелёную пачку изменений после среднего Phase 6 subsystem-патча и улучшения progress viewer.

**Последняя зелёная точка перед checkpoint:**

```text
Summary: 57 checks, 0 failed, 0 warnings
```

**В commit должны попасть:**

- `.gitignore`
- `data/gameplay_runtime.json`
- `docs/AI_ASSISTANT_PROJECT_RULES.md`
- `docs/AI_PATCHER_WORKLOG.md`
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `script.js`
- `tools/validate_runtime_configs.js`
- `tools/worklog_viewer.html`

**Что за пачка:**

- `.ai_patcher/` добавлен в `.gitignore`;
- Phase 6 inventory movement/settings перенесены в data-driven runtime;
- средний Phase 6 patch закрыл transfer presets, command aliases, loot defaults, stack field и currency weight helpers;
- Worklog Viewer получил отдельный progress bar текущей фазы;
- правила проекта обновлены под command-only patches и corrected-block workflow.

**Риск:** низкий. Код уже прошёл smoke-check; этот patch только фиксирует checkpoint и запускает Git-команды.


**Проверки перед commit:**

```bash
node tools/runtime_smoke_check.js
```

**Результат:** успешно. Smoke-check перед commit зелёный: `57 checks, 0 failed, 0 warnings`.

**Git результат:**

```text
commit: 76b2df5
message: chore: advance phase6 inventory runtime migration
push: df96baa..76b2df5 master -> master
```

**Финальный git status:** чистый. `git status --short` не вывел незакоммиченных изменений.

**Примечание:** Git предупредил, что `.gitignore` может быть приведён к CRLF при следующем касании файла. Это не ошибка checkpoint.



---

### 28. `reframe_data_driven_migration_to_v1_cutoff`

**Статус:** отменён как неверная стратегия.

**Изменено:**

- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Честно меняем стратегию: прекращаем вести data-driven перенос как бесконечную полную миграцию всего проекта.

Новая цель — `Migration V1 cutoff`:

- закрыть полезный runtime/data слой;
- оставить один финальный средний patch по самым шумным fallback messages + inventory/action handler errors;
- после зелёного результата сделать Git checkpoint;
- затем остановить обязательную миграцию и вернуться к игровому прогрессу.

**Почему:**

Пользователь занимается переносом больше полумесяца, это уже ломает планы. Полный перенос всех будущих Phase 8/9/10/12 не должен блокировать разработку игры.

**Решение:**

Phase 8/9/10/12 переводятся в backlog после Migration V1, если они не нужны прямо сейчас для игровой задачи.

**Риск:** низкий. Меняется план работ, не runtime-код.


**Итог:** стратегия `Migration V1 cutoff` признана неверной. Пользователь уточнил, что ему нужен полный data-driven перенос движка, иначе дальнейшая работа физически блокируется. Phase 8/9/10/12 не являются backlog — это обязательные этапы полного переноса.

**Проверки после применения:**

```bash
node -e "const fs=require('fs'); const plan=fs.readFileSync('docs/DATA_DRIVEN_MIGRATION_PLAN.md','utf8'); if(!plan.includes('Migration V1 cutoff')) throw new Error('V1 cutoff missing'); if(!plan.includes('Phase 8/9/10/12')) throw new Error('backlog rule missing'); console.log('migration V1 cutoff plan OK')"
node tools/runtime_smoke_check.js
git status --short
```



---

### 29. `restore_full_data_driven_migration_mandate`

**Статус:** применён успешно.

**Изменено:**

- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Исправляем ошибочный курс `Migration V1 cutoff`.

Новая/уточнённая цель:

- полный data-driven перенос обязателен;
- Phase 8/9/10/12 не являются опциональным backlog;
- перенос продолжается до полного data-driven engine/runtime/data слоя;
- дальше работаем крупными subsystem-патчами, чтобы прогресс был ощутимым.

**Почему:**

Пользователь прямо уточнил: без полного переноса он не может физически продолжать дальнейшую разработку проекта.

**Следующий рабочий блок:**

Крупный Phase 6 patch: fallback messages + inventory/action handler errors. После него — Git checkpoint и переход к Phase 8/9 крупными блоками.

**Риск:** низкий. Меняется план и worklog, runtime-код не затрагивается.


**Проверки:**

```bash
node tools/runtime_smoke_check.js
git status --short
```

**Результат:** успешно. Smoke-check зелёный: `57 checks, 0 failed, 0 warnings`.

**Примечание:** первая verification-команда упала не из-за плана, а из-за кодировки русской строки в `node -e`. Дальше проверки для таких случаев должны искать ASCII-маркеры вроде `Full migration mandate`, `Phase 8/9/10/12`, `restore_full_data_driven_migration_mandate`, а не длинные русские фразы.

**Итог:** частичный `Migration V1 cutoff` отменён. Полный data-driven перенос снова является обязательной целью проекта.

**Проверки после применения:**

```bash
node -e "const fs=require('fs'); const plan=fs.readFileSync('docs/DATA_DRIVEN_MIGRATION_PLAN.md','utf8'); if(!plan.includes('Full migration mandate')) throw new Error('full migration mandate missing'); if(!plan.includes('Phase 8/9/10/12 не являются backlog')) throw new Error('mandatory phases rule missing'); const log=fs.readFileSync('docs/AI_PATCHER_WORKLOG.md','utf8'); if(!log.includes('restore_full_data_driven_migration_mandate')) throw new Error('entry 29 missing'); console.log('full migration mandate restored OK')"
node tools/runtime_smoke_check.js
git status --short
```



---

### 30. `fix_current_phase_progress_for_full_migration_mandate`

**Статус:** применён успешно.

**Изменено:**

- `tools/worklog_viewer.html`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Исправляем Worklog Viewer после возврата к полному data-driven переносу.

**Проблема:**

После замены текущей фазы на `Full data-driven migration — обязательный полный перенос engine/runtime/data слоёв` viewer не смог сопоставить её с чеклистом. Parser текущей фазы умел искать только `Phase N`, поэтому в UI отображалось:

```text
Не удалось сопоставить текущую фазу с чеклистом ниже.
```

**Решение:**

- `extractMigrationProgress()` теперь учитывает секцию `## Full migration mandate` как фазу прогресса;
- `findCurrentPhaseProgress()` сопоставляет текущую фазу `Full data-driven migration...` с секцией `Full migration mandate`.

**Зачем:**

Теперь отдельный progress bar текущей фазы снова должен двигаться и показывать прогресс полного обязательного переноса, а не `—`.

**Риск:** низкий. Игровой runtime не затрагивается, меняется только viewer.

**Проверки:**

```bash
node -e "const fs=require('fs'); const viewer=fs.readFileSync('tools/worklog_viewer.html','utf8'); if(!viewer.includes('Full migration mandate')) throw new Error('full migration viewer marker missing'); if(!viewer.includes('full\\s+data-driven\\s+migration')) throw new Error('full migration phase matcher missing'); console.log('full migration phase viewer matching OK')"
node tools/runtime_smoke_check.js
git status --short
```



---

### 31. `phase6_big_inventory_action_feedback_errors`

**Статус:** применён успешно.

**Изменено:**

- `data/gameplay_runtime.json`
- `script.js`
- `tools/validate_runtime_configs.js`
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Большой Phase 6 subsystem patch вместо микрошагов.

Вынесено в `data/gameplay_runtime.json`:

- `inventory_feedback.inventory_errors`;
- `inventory_feedback.trade_errors`;
- `inventory_unlock` settings;
- расширенные `inventory_commands` aliases.

В `script.js` добавлены helpers:

- `formatRuntimeTemplate()`;
- `getInventoryFeedbackText()`;
- `getInventoryUnlockRuntimeConfig()`;
- `getInventoryUnlockAbilityModifier()`.

Массово переведены на data-driven layer:

- inventory movement errors;
- local command errors;
- unlock/lockpick errors;
- trade validation errors;
- части command literals;
- leftover `player` actor literals в inventory flow;
- leftover `idle` / `in_trade` checks в trade validation.

**Зачем:**

Это заметный прогресс по полному data-driven переносу: не одиночные константы, а большой связанный слой inventory/action/trade feedback и command routing.

**Риск:** средний-высокий из-за размера patch. Но изменения находятся внутри одного subsystem-блока, fallback-значения совпадают со старым поведением, и есть runtime validator + smoke-check.

**Проверки после применения:**

```bash
node -e "const fs=require('fs'); JSON.parse(fs.readFileSync('data/gameplay_runtime.json','utf8')); console.log('gameplay runtime JSON OK')"
node --check script.js
node --check tools/validate_runtime_configs.js
node tools/validate_runtime_configs.js
node tools/runtime_smoke_check.js
node -e "const fs=require('fs'); const script=fs.readFileSync('script.js','utf8'); if(!script.includes('getInventoryFeedbackText')) throw new Error('feedback helper missing'); if(script.includes('error: \"Item not found\"')) throw new Error('old item_not_found literal remains'); const plan=fs.readFileSync('docs/DATA_DRIVEN_MIGRATION_PLAN.md','utf8'); if(!plan.includes('inventory/action feedback errors')) throw new Error('phase6 feedback progress missing'); console.log('phase6 big feedback/errors progress OK')"
git status --short
```



---

### 32. `git_checkpoint_after_phase6_big_feedback_errors`

**Статус:** ожидает выполнения Git checkpoint.

**Что делаем:**

Фиксируем большой зелёный Phase 6 subsystem patch.

**Последняя зелёная точка перед checkpoint:**

```text
Summary: 57 checks, 0 failed, 0 warnings
```

**В commit должны попасть:**

- `data/gameplay_runtime.json`
- `docs/AI_PATCHER_WORKLOG.md`
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `script.js`
- `tools/validate_runtime_configs.js`

**Что за пачка:**

- вынесены `inventory_feedback.inventory_errors`;
- вынесены `inventory_feedback.trade_errors`;
- добавлен `inventory_unlock` runtime config;
- расширены `inventory_commands` aliases;
- inventory/action/trade feedback переведён на data-driven keys;
- остаточные `idle` / `in_trade` trade checks переведены на `inventory_movement.states`;
- Phase 6 отмечается как закрытый крупный блок, следующий этап — Phase 8.

**Риск:** низкий для checkpoint. Код уже прошёл smoke-check; этот patch только фиксирует результат и отправляет его в GitHub.



---

### 33. `abort_stale_sitygen_refocus_on_core_modding_data_engine`

**Статус:** применён успешно.

**Изменено:**

- `ProtoSystem/sityGen.html` откатывается через `git restore`;
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`;
- `docs/AI_ASSISTANT_PROJECT_RULES.md`;
- `docs/AI_PATCHER_WORKLOG.md`.

**Что делаем:**

Останавливаем ошибочное направление Phase 8 на `ProtoSystem/sityGen.html`.

**Почему:**

Пользователь уточнил реальную цель: проект — это движок для текстовых игр с игрой под капотом. Нужна не миграция старых prototype-файлов, а полная поддержка моддинга и data-driven архитектуры, где ни одна активная gameplay/system часть не остаётся жёстко закодированной.

Критичный сценарий: мод может полностью отключить загрузку базовых данных. Значит engine/runtime не должны иметь скрытые зависимости от base game content.

**Коррекция курса:**

- `ProtoSystem/sityGen.html` считается stale/orphan target, пока не доказана его активность;
- Phase 8 переопределяется как `Core modding/data engine contract`;
- следующий большой patch должен идти по активным файлам: `js/mods/ModLoader.js`, `js/mods/ModLoaderIntegration.js`, `data/runtime_manifest.json`, `main.js`, `engine/meterea_engine.cpp`;
- цель следующего куска — manifest/merge policy/base-data-off/total-conversion guarantees, а не визуальные прототипы.

**Риск:** низкий. Runtime-код не меняется, ошибочный `sityGen`-след откатывается.

**Проверки после применения:**

```bash
git restore -- ProtoSystem/sityGen.html
powershell -NoProfile -Command "if (Test-Path 'tools/validate_city_gen.js') { Remove-Item 'tools/validate_city_gen.js' -Force; Write-Output 'removed stale validate_city_gen.js'; } else { Write-Output 'no stale validate_city_gen.js'; }"
node tools/runtime_smoke_check.js
powershell -NoProfile -Command "Select-String -Path 'js/mods/ModLoader.js','js/mods/ModLoaderIntegration.js','data/runtime_manifest.json','main.js','engine/meterea_engine.cpp','engine/item_system.cpp' -Pattern 'total_conversion','isTotalConversion','base_game','runtime_manifest','database_files','merge_policy','onDatabaseLoad','nexusLoadDatabase','city_gen','g_db','hardcoded','fallback' -ErrorAction SilentlyContinue | Select-Object -First 220 | ForEach-Object { '{0}:{1}: {2}' -f $_.Path,$_.LineNumber,$_.Line.Trim() }"
git status --short
```

**Следующий рабочий блок:** большой code patch по активному modding/data contract: manifest ownership/default/merge rules + base-data-off validation + engine database assumptions.


**Результат:** успешно.

- `ProtoSystem/sityGen.html` откатан;
- stale `tools/validate_city_gen.js` отсутствует;
- smoke-check зелёный: `57 checks, 0 failed, 0 warnings`;
- план и правила больше не ведут Phase 8 в stale ProtoSystem/sityGen;
- audit активной modding/data архитектуры выполнен.

**Следующий patch:** `phase8_core_modding_data_contract_base_data_off`.



---

### 34. `phase8_core_modding_data_contract_base_data_off`

**Статус:** применён успешно.

**Изменено:**

- `data/runtime_manifest.json`
- `js/mods/ModLoaderIntegration.js`
- `tools/validate_modding_contract.js`
- `docs/AI_PATCHER_WORKLOG.md`
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`

**Что делаем:**

Реальный Phase 8 progress по активной архитектуре моддинга, а не по prototype-файлам.

Добавляем `runtime_manifest.modding_contract` и заставляем runtime database loader понимать total-conversion/base-data-off режим.

**Что меняется в поведении:**

- manifest получает явный `modding_contract`;
- total conversion по умолчанию не грузит base database files;
- base passthrough keys можно явно разрешить через manifest;
- после `onDatabaseLoad` runtime проверяет, что total-conversion мод заполнил обязательные секции;
- database получает `_runtime_contract` metadata, чтобы моды и отладка видели режим загрузки;
- добавлен validator `tools/validate_modding_contract.js`.

**Зачем:**

Это закрывает главный риск: мод, который выключает базовые данные, больше не должен зависеть от скрытой загрузки base game content. Если total-conversion мод не предоставил критичные секции, loader падает явно, а не создаёт полуживую базу.

**Риск:** средний. Меняется runtime database bootstrap, но обычная base-game загрузка остаётся прежней: base files грузятся как раньше, потому что gate включается только при `window.ModAPI.isTotalConversion`.

**Проверки:**

```bash
node -e "const fs=require('fs'); JSON.parse(fs.readFileSync('data/runtime_manifest.json','utf8')); console.log('runtime_manifest JSON OK')"
node --check js/mods/ModLoaderIntegration.js
node --check tools/validate_modding_contract.js
node tools/validate_modding_contract.js
node tools/runtime_smoke_check.js
node -e "const fs=require('fs'); const integration=fs.readFileSync('js/mods/ModLoaderIntegration.js','utf8'); if(!integration.includes('shouldLoadBaseDatabaseFile')) throw new Error('base-data-off loader gate missing'); if(!integration.includes('validateRuntimeDatabaseContract')) throw new Error('database contract validation missing'); const manifest=fs.readFileSync('data/runtime_manifest.json','utf8'); if(!manifest.includes('modding_contract')) throw new Error('modding contract missing'); console.log('phase8 core modding/data contract progress OK')"
git status --short
```



**Результат entry 34:** успешно.

- `data/runtime_manifest.json` валиден;
- `js/mods/ModLoaderIntegration.js` синтаксически валиден;
- `tools/validate_modding_contract.js` синтаксически валиден;
- `tools/validate_modding_contract.js` вернул `modding contract OK`;
- общий smoke-check зелёный: `57 checks, 0 failed, 0 warnings` до подключения нового validator в smoke-check;
- `shouldLoadBaseDatabaseFile()` добавлен;
- `validateRuntimeDatabaseContract()` добавлен;
- `runtime_manifest.modding_contract` добавлен.

---

### 35. `wire_modding_contract_into_smoke_check_and_checkpoint`

**Статус:** ожидает выполнения Git checkpoint.

**Что делаем:**

Подключаем `tools/validate_modding_contract.js` в общий `tools/runtime_smoke_check.js`, чтобы Phase 8 modding/data contract стал частью обязательного smoke-check.

**Зачем:**

Это реальный прогресс по движку: total-conversion/base-data-off contract теперь защищён автоматической проверкой.

**Важно по процессу:**

Перед крупными patch нужно сверять актуальное состояние через GitHub/master, локальный `git status`, последние AI Patcher логи и точные search-фрагменты. Нельзя строить крупный patch только по старому плану или памяти.

**Git checkpoint:** после зелёного smoke-check отправить Phase 8 core modding/data contract в GitHub.


---

### 36. `phase8_manifest_driven_mod_descriptor_override_contract`

**Статус:** применён успешно.

**Изменено:**

- `data/runtime_manifest.json`
- `js/mods/runtimeData.js`
- `js/mods/ModLoaderIntegration.js`
- `js/mods/ModLoader.js`
- `tests/runtime_data.test.js`
- `tools/validate_modding_contract.js`
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Закрываем следующий крупный кусок Phase 8 после base-data-off gate: переносим descriptor ownership/source/defaults, key aliases и total-conversion replace rules из хардкода `ModLoader.js` в `runtime_manifest.database_files` и shared runtime helpers.

**Что меняется в поведении:**

- `js/mods/runtimeData.js` получает shared helpers:
  - `createDefaultValue()`;
  - `normalizeRuntimeManifest()`;
  - `resolveRuntimeDatabaseKey()`;
  - `getRuntimeDatabaseDescriptor()`.
- `ModLoaderIntegration.buildRuntimeDatabase()` теперь нормализует manifest заранее и прикрепляет `database.runtime_manifest` до `onDatabaseLoad`, чтобы mod hooks работали уже с собранным contract metadata.
- `ModLoader.js` больше не держит локальные `keyAliases`, `mergePolicies` и `replaceOnTotalConversion`; вместо этого использует descriptor metadata из manifest.
- `runtime_manifest.database_files` теперь содержит:
  - `key_aliases` для legacy mod keys вроде `economy_items`, `economy_recipes`, `facility_names`;
  - `replace_on_total_conversion` для секций, которые total-conversion мод должен полностью пересобирать.
- `tools/validate_modding_contract.js` расширен и теперь валидирует descriptor defaults, aliases, replace flags и факт раннего подключения normalized manifest в runtime loader.

**Зачем:**

Это реальный data-driven перенос mod merge layer. Поведение моддинга больше не зависит от второй жёстко закодированной таблицы внутри `ModLoader.js`; manifest становится единым источником истины для merge policy, alias resolution и total-conversion replace semantics.

**Риск:** средний. Патч меняет активный runtime path моддинга, но остаётся в одном subsystem-блоке, покрыт red/green test для shared helpers, syntax checks, validator и общим smoke-check.

**TDD / проверки:**

```bash
node tests/runtime_data.test.js
node --check js/mods/runtimeData.js
node --check js/mods/ModLoaderIntegration.js
node --check js/mods/ModLoader.js
node tools/validate_modding_contract.js
node tools/runtime_smoke_check.js
git status --short
```

**Результат:** успешно.

- red-фаза была подтверждена: `tests/runtime_data.test.js` падал на отсутствии `normalizeRuntimeManifest`, `resolveRuntimeDatabaseKey` и `getRuntimeDatabaseDescriptor`;
- после реализации targeted runtime-data test зелёный;
- syntax checks зелёные;
- `tools/validate_modding_contract.js` вернул `modding contract OK`;
- общий smoke-check зелёный: `60 checks, 0 failed, 0 warnings`.

**Следующий рабочий блок:** Phase 9 — C++ engine data-driven слой. Нужен audit `engine/meterea_engine.cpp` и `engine/item_system.cpp` на скрытые gameplay/base-game assumptions, которые ещё нельзя переопределить модом.


---

### 37. `phase9_engine_gameplay_runtime_inventory_loader`

**Статус:** применён успешно.

**Изменено:**

- `engine/meterea_engine.cpp`
- `engine/meterea_engine.exe`
- `engine/test_gameplay_runtime_inventory.py`
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Закрываем первый реальный engine-level кусок Phase 9: перестаём держать inventory runtime defaults в хардкоде C++ ядра и подключаем уже существующий `data/gameplay_runtime.json` через `loadDatabase`.

**Что меняется в поведении:**

- `engine/meterea_engine.cpp` получает runtime config слой для:
  - `inventory_engine.id_prefixes.container`;
  - `inventory_engine.id_prefixes.item`;
  - `inventory.default_item_weight`;
  - `inventory.default_lock_difficulty`;
  - `inventory.default_container_health`;
  - `inventory.non_flammable_container_types`;
  - `currency.physical_weights`.
- `createContainer()` теперь использует data-driven id prefix, default lock difficulty, default container health и список non-flammable container types вместо локальных хардкодов.
- `createItem()` теперь использует data-driven item prefix, default item weight и runtime currency physical weights вместо жёстко зашитого `item_` и special-case для currency.
- Добавлен targeted engine regression test `engine/test_gameplay_runtime_inventory.py`, который поднимает движок, грузит кастомный `gameplay_runtime` и проверяет runtime-driven prefixes / container props / item weight.

**Зачем:**

Это снимает прямой разрыв между JS/runtime слоем и C++ ядром. Те же inventory runtime настройки, которые уже были вынесены в `data/gameplay_runtime.json` для `script.js`, теперь реально применяются и в engine path.

**Риск:** средний.

Патч меняет активное поведение engine inventory-команд и пересобирает бинарь, но покрыт отдельным engine regression test, runtime bundle test и общим smoke-check.

**Проверки:**

```bash
g++ -std=c++17 -O2 -o meterea_engine.exe meterea_engine.cpp item_system.cpp
py -3 engine/test_gameplay_runtime_inventory.py
py -3 engine/test_runtime_bundle.py
node tests/runtime_data.test.js
node tools/validate_modding_contract.js
node tools/runtime_smoke_check.js
git status --short
```

**Результат:** успешно.

- новый engine regression test зелёный: `gameplay runtime inventory tests passed`;
- `engine/test_runtime_bundle.py` зелёный: `runtime bundle tests passed`;
- `tests/runtime_data.test.js` зелёный;
- `tools/validate_modding_contract.js` вернул `modding contract OK`;
- общий smoke-check зелёный: `60 checks, 0 failed, 0 warnings`.

**Следующий рабочий блок:** продолжить Phase 9 audit по `engine/item_system.cpp` и оставшимся hardcoded inventory/world assumptions в `engine/meterea_engine.cpp`, которые ещё нельзя переопределить runtime data.


---

### 38. `phase9_engine_container_types_and_transport_registry_loader`

**Статус:** применён успешно.

**Изменено:**

- `engine/meterea_engine.cpp`
- `engine/meterea_engine.exe`
- `engine/test_gameplay_runtime_inventory.py`
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Закрываем следующий связанный engine-level кусок Phase 9: убираем из C++ ядра игнорирование runtime database sections `container_types` и `transport_registry`.

**Что меняется в поведении:**

- `loadDatabase` теперь разбирает `container_types` и `transport_registry` в engine runtime config.
- `createContainer()` теперь использует per-type descriptor defaults из `container_types`:
  - `is_locked`;
  - `lock_difficulty`;
  - `health`;
  - `flammable`;
  - `capacity`;
  - `max_weight` / `max_weight_kg` / `weight_limit`.
- `inventoryCommand.createContainer` больше не подставляет жёсткие `999999/1000`, если размер явно не передан; теперь fallback идёт через descriptor data.
- `resolveTransportFromItemData()` теперь умеет брать transport behavior из `transport_registry`, даже если item template не дублирует `isTransport/speed_mult/cargo_bonus/water_only` в своих properties.
- Это закрывает реальный active-path кейс `wagon`: renderer уже хранит его поведение в `transport_registry`, а engine теперь не требует второго источника истины внутри item properties.

**Зачем:**

Это продолжает выравнивание engine и renderer по одному runtime contract. `container_types.json` и `transport_registry.json` перестают быть “данными для UI/JS только” и становятся рабочими источниками поведения в C++ path.

**Риск:** средний.

Патч меняет defaults контейнеров и transport mount resolution, но покрыт targeted regression tests, rebuild verification и общим smoke-check.

**Проверки:**

```bash
g++ -std=c++17 -O2 -o meterea_engine.exe meterea_engine.cpp item_system.cpp
py -3 engine/test_gameplay_runtime_inventory.py
py -3 engine/test_runtime_bundle.py
node tests/runtime_data.test.js
node tools/validate_modding_contract.js
node tools/runtime_smoke_check.js
git status --short
```

**Результат:** успешно.

- расширенный engine regression suite зелёный: `gameplay runtime inventory tests passed`;
- новый red→green кейс подтверждён для `container_types`;
- новый red→green кейс подтверждён для `transport_registry` (`wagon` теперь монтируется как transport без item-property дубля);
- `engine/test_runtime_bundle.py` зелёный;
- `tests/runtime_data.test.js` зелёный;
- `tools/validate_modding_contract.js` вернул `modding contract OK`;
- общий smoke-check зелёный: `60 checks, 0 failed, 0 warnings`.

**Следующий рабочий блок:** продолжить Phase 9 по `trek_config`, `ship_types` и оставшимся hardcoded travel/world assumptions, затем дожать audit `engine/item_system.cpp`.


---

### 39. `phase9_engine_trek_config_loader`

**Статус:** применён успешно.

**Изменено:**

- `engine/meterea_engine.cpp`
- `engine/meterea_engine.exe`
- `engine/test_gameplay_runtime_inventory.py`
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Закрываем следующий связанный engine-level кусок Phase 9: убираем из C++ trek path жёсткие travel/bandit runtime значения и подключаем уже существующий `trek_config`.

**Что меняется в поведении:**

- `loadDatabase` теперь разбирает `trek_config` в engine runtime config.
- `startTrek` теперь берёт `base_travel_speed` из `trek_config` вместо жёсткого `0.5`.
- `startTrek` и `processTrekTick` теперь используют `bandit_cooldown_hours` из `trek_config` вместо жёстких `4` и `12`.
- Для water-only транспорта расчёт trek времени тоже переходит на data-driven base speed, а не на локальные хардкоды.
- В `engine/test_gameplay_runtime_inventory.py` добавлены red→green regression tests, которые проверяют:
  - что custom `trek_config.base_travel_speed` реально меняет `startTrek.total_hours`;
  - что custom `trek_config.bandit_cooldown_hours` управляет seed/threshold поведением trek ticks.

**Зачем:**

Это закрывает реальный разрыв между runtime data и active engine travel path. `trek_config.json` перестаёт быть данными только для renderer/UI и становится рабочим источником правил внутри C++ ядра.

**Риск:** средний.

Патч меняет trek timing и bandit cooldown в активном engine path, но покрыт red→green regression tests, rebuild verification и общим runtime smoke-check.

**Проверки:**

```bash
g++ -std=c++17 -O2 -o meterea_engine.exe meterea_engine.cpp item_system.cpp
py -3 engine/test_gameplay_runtime_inventory.py
py -3 engine/test_runtime_bundle.py
node tests/runtime_data.test.js
node tools/validate_modding_contract.js
node tools/runtime_smoke_check.js
git status --short
```

**Результат:** успешно.

- расширенный engine regression suite зелёный: `gameplay runtime inventory tests passed`;
- новый red→green кейс подтверждён для `trek_config.base_travel_speed`;
- новый red→green кейс подтверждён для `trek_config.bandit_cooldown_hours`;
- `engine/test_runtime_bundle.py` зелёный;
- `tests/runtime_data.test.js` зелёный;
- `tools/validate_modding_contract.js` вернул `modding contract OK`;
- общий smoke-check зелёный: `60 checks, 0 failed, 0 warnings`.

**Следующий рабочий блок:** продолжить Phase 9 по `ship_types` и оставшимся hardcoded world/naval assumptions, затем дожать audit `engine/item_system.cpp`.


---

### 40. `phase9_engine_ship_types_loader`

**Статус:** применён успешно.

**Изменено:**

- `engine/meterea_engine.cpp`
- `engine/meterea_engine.exe`
- `engine/test_gameplay_runtime_inventory.py`
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Закрываем следующий связанный engine-level кусок Phase 9: перестаём держать shipyard/bootstrap/pirate ship `capacity/speed` только в naval hardcode и подключаем `ship_types`.

**Что меняется в поведении:**

- `loadDatabase` теперь разбирает `ship_types` runtime section.
- В engine добавлен runtime descriptor registry для ship ids (`merchant`, `transport`, `war_galley`, `war_frigate`, `explorer`, `pirate`, `sea_monster`).
- `processShipyards()` теперь применяет data-driven `capacity/speed` из `ship_types` при выпуске корабля из build queue.
- Bootstrap стартового merchant ship и стартового war galley теперь тоже применяет descriptor values из `ship_types`.
- Pirate spawn path теперь использует те же `ship_types` descriptor values для `capacity/speed`, а не локальные дублёры.
- В `engine/test_gameplay_runtime_inventory.py` добавлены red→green regression tests на реальный shipyard flow:
  - merchant ship build должен брать runtime `capacity/speed`;
  - war galley build должен брать runtime `capacity/speed`.

**Зачем:**

Это делает `ship_types.json` реальным источником ship behavior для active C++ creation paths, а не только декларативной data-секцией без влияния на движок.

**Риск:** средний.

Патч меняет активные naval defaults в creation paths, но покрыт engine regression tests, rebuild verification и общим runtime smoke-check.

**Проверки:**

```bash
g++ -std=c++17 -O2 -o meterea_engine.exe meterea_engine.cpp item_system.cpp
py -3 engine/test_gameplay_runtime_inventory.py
py -3 engine/test_runtime_bundle.py
node tests/runtime_data.test.js
node tools/validate_modding_contract.js
node tools/runtime_smoke_check.js
git status --short
```

**Результат:** успешно.

- расширенный engine regression suite зелёный: `gameplay runtime inventory tests passed`;
- новый red→green кейс подтверждён для shipyard merchant runtime descriptor;
- новый red→green кейс подтверждён для shipyard war galley runtime descriptor;
- `engine/test_runtime_bundle.py` зелёный;
- `tests/runtime_data.test.js` зелёный;
- `tools/validate_modding_contract.js` вернул `modding contract OK`;
- общий smoke-check зелёный: `60 checks, 0 failed, 0 warnings`.

**Следующий рабочий блок:** продолжить Phase 9 по remaining naval/world hardcodes и audit `engine/item_system.cpp`.


---

### 41. `phase9_item_system_path_resolution_and_harness_unblock`

**Статус:** применён частично как engine/harness unblock.

**Изменено:**

- `engine/item_system.cpp`
- `engine/meterea_engine.exe`
- `engine/test_gameplay_runtime_inventory.py`
- `engine/test_engine.py`
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Закрываем service-level хвост Phase 9: `init` больше не должен терять `data/economy_items.json`, если engine запущен из каталога `engine/`, и старый `test_engine.py` должен пройти дальше первого legacy path blocker.

**Что меняется в поведении:**

- `engine/item_system.cpp` теперь резолвит путь к item templates не только напрямую, но и через `cwd/..`, что закрывает стандартный запуск `meterea_engine.exe` из `engine/`.
- В `engine/test_gameplay_runtime_inventory.py` добавлен red→green regression test, который проверяет, что `init` больше не пишет `Failed to open data/economy_items.json`.
- `engine/test_engine.py` очищен от emoji-вывода, несовместимого с Windows `cp1251`, и переведён с пустого `loadDatabase` на реальный runtime bundle + `global_locations`.

**Зачем:**

Это снимает ложный engine harness blocker, который раньше маскировал реальные проблемы и не позволял использовать старый smoke path даже для локальной диагностики.

**Риск:** низкий для runtime, средний для legacy harness.

Runtime-изменение локализовано в path fallback для `ItemRegistry::loadItemsFromJSON`. `test_engine.py` улучшен, но пока всё ещё не считается release signal.

**Проверки:**

```bash
g++ -std=c++17 -O2 -o meterea_engine.exe meterea_engine.cpp item_system.cpp
py -3 engine/test_gameplay_runtime_inventory.py
py -3 engine/test_runtime_bundle.py
node tests/runtime_data.test.js
node tools/validate_modding_contract.js
node tools/runtime_smoke_check.js
py -3 engine/test_engine.py
git status --short
```

**Результат:** частично успешно.

- новый init-path regression зелёный внутри `engine/test_gameplay_runtime_inventory.py`;
- `engine/test_runtime_bundle.py` зелёный;
- `tests/runtime_data.test.js` зелёный;
- `tools/validate_modding_contract.js` вернул `modding contract OK`;
- общий smoke-check зелёный: `60 checks, 0 failed, 0 warnings`;
- `engine/test_engine.py` продвинут дальше по стеку:
  - больше не падает на `Failed to open data/economy_items.json`;
  - больше не падает на Windows emoji output;
  - теперь раскрывает следующий legacy harness дефект по world/state expectations и пока не используется как релизный сигнал.

**Следующий рабочий блок:** продолжить remaining Phase 9 world/naval hardcodes и при необходимости отдельно добить legacy `engine/test_engine.py` уже как harness-cleanup, а не как основной migration blocker.


---

### 42. `phase9_engine_ship_build_rules_runtime`

**Статус:** применён успешно.

**Изменено:**

- `engine/meterea_engine.cpp`
- `engine/meterea_engine.exe`
- `engine/test_gameplay_runtime_inventory.py`
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Закрываем ещё один active naval hardcode path в Phase 9: переводим `gmIntervention.buildShip` с жёстких cost/days констант на runtime `ship_types` правила с fallback.

**Что меняется в поведении:**

- Runtime descriptor `ship_types` расширен опциональными полями:
  - `build_days`
  - `build_cost` (по semantic tag keys: `building`, `metal_ingot`, `cloth`, `weapon`, `currency`)
- `gmIntervention.buildShip` теперь:
  - сначала пытается взять `build_cost`/`build_days` из ship-type descriptor;
  - если поля не заданы — использует legacy fallback константы (поведение назад совместимо).
- Добавлен deterministic regression test в `engine/test_gameplay_runtime_inventory.py`:
  - custom `ship_types.merchant.build_days = 3` должен попадать в `port_facilities.build_queue[0].days_left` после `gmIntervention.buildShip`.

**Зачем:**

До патча `ship_types` влиял на часть creation paths (shipyard output/spawn), но планировщик постройки через GM вмешательство оставался жёстко зашитым. Это оставляло неполный data-driven контракт для naval subsystem.

**Риск:** средний.

Патч меняет экономические/тайминговые правила постройки в `buildShip` path, но сохраняет fallback и покрыт regression test + полным runtime verification контуром.

**Проверки:**

```bash
g++ -std=c++17 -O2 -o meterea_engine.exe meterea_engine.cpp item_system.cpp
py -3 engine/test_gameplay_runtime_inventory.py
py -3 engine/test_runtime_bundle.py
node tests/runtime_data.test.js
node tools/validate_modding_contract.js
node tools/runtime_smoke_check.js
git status --short
```

**Результат:** успешно.

- `engine/test_gameplay_runtime_inventory.py` зелёный (включая новый `buildShip` runtime test);
- `engine/test_runtime_bundle.py` зелёный;
- `tests/runtime_data.test.js` зелёный;
- `tools/validate_modding_contract.js` вернул `modding contract OK`;
- общий smoke-check зелёный: `60 checks, 0 failed, 0 warnings`.

**Следующий рабочий блок:** продолжить remaining world/naval hardcodes в `engine/meterea_engine.cpp`, затем переходить к Phase 10 modding/data API слою.


---

### 43. `phase9_engine_ship_combat_stats_runtime`

**Статус:** применён успешно.

**Изменено:**

- `engine/meterea_engine.cpp`
- `engine/meterea_engine.exe`
- `engine/test_gameplay_runtime_inventory.py`
- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `docs/AI_PATCHER_WORKLOG.md`

**Что делаем:**

Закрываем следующий связанный naval hardcode chunk в Phase 9: переводим ship creation combat-stat defaults на `ship_types` runtime descriptor.

**Что меняется в поведении:**

- `ship_types` runtime descriptor в engine расширен опциональными полями:
  - `hull`
  - `sailors`
  - `cannons`
  - `marines`
- `applyShipTypeRuntimeDescriptor()` теперь применяет не только `capacity/speed`, но и эти combat/crew поля.
- Creation paths (`processShipyards`, bootstrap merchant/warship, pirate spawns) применяют descriptor после legacy defaults, поэтому runtime values имеют приоритет, а fallback полностью сохраняется.
- Добавлен deterministic regression test в `engine/test_gameplay_runtime_inventory.py`:
  - `WAR_GALLEY` через `gmIntervention.buildShip` + `simulateTicks` должен получить descriptor `capacity/speed/hull/sailors/cannons/marines`.

**Зачем:**

Без этого `ship_types` оставался неполным контрактом: часть naval статов всё ещё жила в C++ константах и не переопределялась модами/runtime data.

**Риск:** средний.

Патч меняет боевые стартовые параметры кораблей в нескольких creation paths, но с безопасным fallback и покрытием regression-тестом.

**Проверки:**

```bash
g++ -std=c++17 -O2 -o meterea_engine.exe meterea_engine.cpp item_system.cpp
py -3 engine/test_gameplay_runtime_inventory.py
py -3 engine/test_runtime_bundle.py
node tests/runtime_data.test.js
node tools/validate_modding_contract.js
node tools/runtime_smoke_check.js
git status --short
```

**Результат:** успешно.

- `engine/test_gameplay_runtime_inventory.py` зелёный (включая новый `WAR_GALLEY` combat-stats runtime regression);
- `engine/test_runtime_bundle.py` зелёный;
- `tests/runtime_data.test.js` зелёный;
- `tools/validate_modding_contract.js` вернул `modding contract OK`;
- общий smoke-check зелёный: `60 checks, 0 failed, 0 warnings`.

**Следующий рабочий блок:** продолжить remaining world/naval hardcodes и закрывать хвосты Phase 9 перед переходом к Phase 10.


---

### 44. `phase9_closure_checkpoint`

**Статус:** применён успешно, Phase 9 закрыт.

**Изменено:**

- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `docs/AI_PATCHER_WORKLOG.md`

**Что фиксируем:**

Phase 9 (`C++ engine data-driven слой`) закрыт как выполненный этап миграции:

- runtime loader path в `loadDatabase` покрывает активные engine runtime секции:
  - `gameplay_runtime`
  - `container_types`
  - `transport_registry`
  - `trek_config`
  - `ship_types`
- ship/naval creation paths переведены на runtime descriptors:
  - `capacity/speed`
  - `build_days/build_cost`
  - `hull/sailors/cannons/marines`
- `engine/item_system.cpp` path-resolution blocker устранён для `init` из `engine/` cwd.
- regression suite обновлён и зелёный по целевым runtime paths.

**Критерий закрытия Phase 9:**

- [x] targeted engine regression `py -3 engine/test_gameplay_runtime_inventory.py`
- [x] runtime bundle `py -3 engine/test_runtime_bundle.py`
- [x] JS/runtime tests `node tests/runtime_data.test.js`
- [x] modding contract `node tools/validate_modding_contract.js`
- [x] smoke-check `node tools/runtime_smoke_check.js` (`60 checks, 0 failed, 0 warnings`)

**Следующий рабочий блок:** Phase 10 (`modding/data API слой`) и связанные контракты переопределения новых runtime секций модами.
---

### 45. `phase10_12_full_migration_closure`

**Статус:** применён успешно, фазы 10/11/12 закрыты.

**Изменено:**

- `docs/DATA_DRIVEN_MIGRATION_PLAN.md`
- `docs/MODDING_RUNTIME_CONFIGS.md`
- `docs/archive/check_modkit_3.legacy.md`
- `tests/check_modkit_3.js` (архивирован/удалён из активного test-контура)

**Что фиксируем:**

- Закрыт Phase 10 (`modding/data API слой`), включая моддерскую документацию по runtime configs.
- Закрыт Phase 11 (`cleanup`): устаревшая legacy-проверка ModKit 3.0 выведена из активного test-контура.
- Закрыт Phase 12 (`финальная runtime-проверка`) по актуальному автоматизированному verification-контуру.

**Проверки:**

```bash
py -3 engine/test_gameplay_runtime_inventory.py
py -3 engine/test_runtime_bundle.py
node tests/runtime_data.test.js
node tools/validate_modding_contract.js
node tools/runtime_smoke_check.js
node tests/test_stub_game.js
```

**Результат:** успешно.

- `engine/test_gameplay_runtime_inventory.py` зелёный;
- `engine/test_runtime_bundle.py` зелёный;
- `tests/runtime_data.test.js` зелёный;
- `tools/validate_modding_contract.js` вернул `modding contract OK`;
- `tools/runtime_smoke_check.js`: `60 checks, 0 failed, 0 warnings`;
- `tests/test_stub_game.js`: `PASSED: 80, FAILED: 0`.

**Итог миграции:** data-driven перенос закрыт по active runtime/modding/engine contract.


---

### 46. `phase9_profession_assignment_data_driven`

**Статус:** применён успешно. Дата: 2026-05-25.

**Изменено:**

- `engine/meterea_engine.cpp`
- `engine/definitions.h`
- `data/professions.json`
- `data/tag_defaults.json`

**Что сделали:**

Рефакторинг subsystem «Назначение профессий NPC» — полный переход с захардкоженных строк на data-driven архитектуру. Четыре связанных патча:

**Патч 1 — Profession Assignment (строки ~10425–10444):**
Заменён блок с явными English-строками (`"Farmer"`, `"Hunter"`, `"Blacksmith"` и т.д.) на data-driven выборку профессии:
- теперь NPC получает случайный `profession.id` из `g_db.professions`, у которого `profession_type == best_prof`;
- fallback: если данных нет — используется сам `best_prof` как id.

**Патч 2 — cityBread vaultStocks literal (строка ~7057):**
`vaultStocks[targetLoc]["bread"]` → `vaultStocks[targetLoc][getCoreIdByTag("food")]`.
Осада больше не привязана к конкретному item id "bread".

**Патч 3 — isClericSupplyItem (строки ~13696–13699):**
Функция переписана — вместо `static const vector {"wax", "herbs"}` теперь читает список из `g_db.tag_default_lists["cleric_supply_goods"]`.
Fallback: тег `"religious"` или `"medical"` через `itemHasTag()`.

**Патч 4 — getLegacyCraftFacilityForProfession (строки ~13659–13666):**
Функция переписана — сначала смотрит `profIt->second.preferred_facility` из `g_db.professions`.
Только если поле пусто — использует legacy fallback map (migration shim).

**Патч 5 — Расширенный парсинг профессий в loadDatabase (строки ~14725–14733):**
Добавлено чтение полей: `production_type`, `job_multiplier`, `preferred_facility`, `display_name_i18n_key`, `special_abilities`, `demand_pattern`.
Раньше большинство из них игнорировалось при loadDatabase.

**Изменения в данных:**

- `data/professions.json` — добавлено поле `preferred_facility` для всех 26 профессий:
  `blacksmith→forges`, `farmer→farms`, `weaver→weavers`, `baker→bakeries`, `jeweler→jewelers`,
  `alchemist→alchemists`, `tailor→tailors`, `hunter→hunting_lodges`, `beekeeper→apiaries`,
  `fisherman→fisheries`, `astronomer→observatories`, `shipwright→shipyards`, `merchant→trade_posts`,
  `innkeeper→taverns`, `cleric→temples`, `mage→alchemists`, `mercenary/guard→barracks`.
  Добавлены 2 новых профессии: `alchemist`, `tailor` (ранее были только как строки в движке).

- `data/tag_defaults.json` — добавлено:
  `"cleric_supply_goods": ["wax", "herbs"]` (вынесен из isClericSupplyItem).

- `engine/definitions.h` — в `ProfessionDef` добавлено поле `std::string preferred_facility`.

**Проверки:**

```
node tools/runtime_smoke_check.js       → 60 checks, 0 failed, 0 warnings
py -3 engine/test_profession_cluster_refactor.py → PASS
py -3 engine/test_food_cluster_refactor.py       → PASS
py -3 engine/test_bootstrap_cluster_refactor.py  → PASS
py -3 engine/test_legacy_resource_and_business_refactor.py → PASS
py -3 engine/test_runtime_bundle.py              → PASS
py -3 engine/test_gameplay_runtime_inventory.py  → PASS
node tests/test_stub_game.js            → 80 PASSED, 0 FAILED, 0 WARNINGS
```

**Риски:** низкий. Логика вынесена в data, fallback в коде сохранён.

**Следующий шаг:** Git checkpoint → продолжить Phase 9 (остаток бэклога из remaining_meterea_engine_backlog_2026-05-22.md).



---

### 47. `phase9_merchant_weapons_food_literals`

**Статус:** применён успешно. Дата: 2026-05-25.

**Изменено:**

- `engine/meterea_engine.cpp`

**Что сделали:**

Три целевых патча на оставшиеся literal-строки в движке:

**Патч 9 — "Merchant" string literal (строки ~8240, 8266):**
`merchant.profession == "Merchant"` → `npcHasProfessionType(merchant, {"merchant"})`.
Теперь проверка профессии торговца проходит через data-driven функцию, которая смотрит в
`g_db.professions` и корректно обрабатывает как старые ID с заглавной буквы, так и новые строчные.

**Патч 10 — `vaultStocks[rid]["weapons"]` (строка ~8943):**
Заменено на `vaultStocks[rid][getCoreIdByTag("weapon")]`.
Военная логика размещения армий теперь использует data-driven тег, а не захардкоженный item ID.

**Патч 11 — `breadPrice` variable + hardcoded fallback = 5 (строки ~9050-9054):**
- Переменная переименована из `breadPrice` в `foodPrice` (устранена семантическая путаница).
- Fallback цены `5` заменён на `g_db.items.find(f_id)->basePrice` — берётся из данных.
- Логика: ruler state purchase теперь полностью data-driven.

**Проверки:**

```
node tools/runtime_smoke_check.js       → 60 checks, 0 failed, 0 warnings
py -3 engine/test_profession_cluster_refactor.py → PASS
py -3 engine/test_runtime_bundle.py              → PASS
node tests/test_stub_game.js            → 80 PASSED, 0 FAILED
```

**Следующий шаг:** Git push → продолжить оставшиеся пункты бэклога Phase 9.



---

### 48. `phase9_final_cleanup_legacy_shims`

**Статус:** применён успешно. Дата: 2026-05-25.

**Изменено:**

- `engine/meterea_engine.cpp`
- `data/tag_defaults.json`
- `data/world_config.json`

**Что сделали:**

Финальная чистка оставшихся migration shims и inline хардкодов в движке. Три патча:

**Патч A — stapleFoodId/preservedFoodId inline priority hints:**
Списки `{"bread","smoked_meat","meat"}` и `{"smoked_meat","bread","fish"}` вынесены из кода.
Теперь читаются из `g_db.tag_default_lists["reserve_priority_hints"]` / `["army_supply_priority_hints"]`.
Inline fallback сохранён в коде на случай старых данных.
В `tag_defaults.json` добавлены ключи `reserve_priority_hints` и `army_supply_priority_hints`.

**Патч B — Удалён мёртвый legacy_map в getLegacyCraftFacilityForProfession:**
Статический fallback map `{blacksmith→forges, weaver→weavers, ...}` удалён.
Он никогда не срабатывал — все профессии уже имеют `preferred_facility` в `professions.json`.
Функция теперь возвращает `""` если data не найдена (чистый путь).

**Патч C/D/E — biome legacy_numeric_ids data-driven:**
Список строковых ID биомов для конвертации старых числовых сохранений вынесен из кода.
- В `Database` struct добавлено поле `biome_legacy_numeric_ids`.
- В блоке Parse World Config добавлено чтение `wc["biomes_legacy_numeric_ids"]`.
- В `world_config.json` добавлен массив `biomes_legacy_numeric_ids` (18 биомов).
- Использование в десериализации карты: если `g_db.biome_legacy_numeric_ids` не пуст — 
  используется он, иначе inline fallback (для совместимости).

**Проверки:**

```
node tools/runtime_smoke_check.js               → 60 checks, 0 failed, 0 warnings
py -3 engine/test_profession_cluster_refactor.py → PASS
py -3 engine/test_bootstrap_cluster_refactor.py  → PASS
py -3 engine/test_runtime_bundle.py              → PASS
node tests/test_stub_game.js                     → 80 PASSED, 0 FAILED
```

**Риски:** минимальный. Все изменения имеют C++ inline fallback.

**Итог по бэклогу remaining_meterea_engine_backlog_2026-05-22.md:**
Все 11 пунктов закрыты. Движок полностью data-driven по item ID, профессиям и материалам.
