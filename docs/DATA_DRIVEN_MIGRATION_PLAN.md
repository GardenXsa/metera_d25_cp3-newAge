# Data-driven Migration Plan — Хроники Метерии

Этот план нужен не для красоты, а чтобы было видно: сколько уже перенесено, что осталось, и где мы сейчас.

Прогресс считается просто: каждый пункт чеклиста равен одной условной единице. Это не идеальная оценка сложности, но даёт понятную полоску движения.

## Текущий статус

**Текущая фаза:** Full data-driven migration — обязательный полный перенос engine/runtime/data слоёв

**Последняя зелёная точка:** smoke-check `57 checks, 0 failed, 0 warnings` после `fix_current_phase_progress_for_full_migration_mandate`.

**Git checkpoint:** `76b2df5` — `chore: advance phase6 inventory runtime migration`.


## Full migration mandate

Это обязательная граница проекта: перенос не считается завершённым, пока engine/runtime/data слои не переведены на data-driven архитектуру полностью.

### Что уже закрыто как фундамент

- [x] Runtime manifest подключает основные data/runtime файлы.
- [x] UI runtime вынесен в `data/ui_runtime.json`.
- [x] Electron runtime вынесен в `data/electron_runtime.json`.
- [x] Prompt runtime вынесен в `data/prompt_runtime.json`.
- [x] Gameplay runtime вынесен в `data/gameplay_runtime.json`.
- [x] Inventory actor routes, movement settings, buildContainer defaults и transfer/loot/command settings вынесены из `script.js`.
- [x] Runtime config validator добавлен.
- [x] Data integrity validator добавлен.
- [x] Smoke-check зелёный: `57 checks, 0 failed, 0 warnings`.
- [x] Worklog Viewer показывает общий прогресс и прогресс текущей фазы.
- [x] Git checkpoint `76b2df5` запушен.

### Что обязательно осталось для полного переноса

- [ ] Закрыть Phase 6: fallback messages + inventory/action handler errors.
- [ ] Закрыть Phase 8: `ProtoSystem/sityGen.html` / city generation data-driven слой.
- [ ] Закрыть Phase 9: C++ engine data-driven слой.
- [ ] Закрыть Phase 10: modding/data API слой.
- [ ] Закрыть Phase 11: cleanup старых костылей.
- [ ] Закрыть Phase 12: финальная runtime-проверка.

### Честное правило

Нельзя предлагать остановить миграцию как `достаточно хорошую`, если core engine/runtime/data слой ещё не полностью data-driven. Пользователю нужен полный перенос, потому что без него дальнейшая разработка физически блокируется.

### Новый режим скорости

Дальше работаем не микрошагами, а крупными subsystem-патчами:

1. один patch должен закрывать полноценный слой или связанный набор правил;
2. каждый patch обязан обновлять `AI_PATCHER_WORKLOG.md` и `DATA_DRIVEN_MIGRATION_PLAN.md`;
3. после зелёного subsystem-патча — Git checkpoint;
4. если patch частично зелёный, исправляем только проблемные блоки, не пересылаем весь patch заново.

## Ближайшие следующие шаги

Этот блок должен обновляться после каждого зелёного этапа, чтобы было ясно, что делать дальше.

### Сейчас

Phase 7 diagnostic layer фактически закрыт: runtime config contracts и data integrity links подключены к smoke-check и дают зелёный результат.

### Следующий рабочий блок

Вернуться к Phase 6 и продолжить перенос `script.js` маленькими безопасными кусками.

1. Выполнить крупный Phase 6 audit: fallback messages + inventory/action handler errors в `script.js`.
2. На основе audit сделать один средний/крупный subsystem patch, а не микрошаги.
3. После зелёного результата сделать Git checkpoint.
4. Затем перейти к обязательным крупным блокам: `ProtoSystem/sityGen.html`, C++ engine файлы, modding/data API слой. только в самых шумных местах.
2. После зелёного результата сделать Git checkpoint.
3. Остановить обязательную data-driven миграцию V1 и перейти к разработке/проверке игрового прогресса.
4. Phase 8/9/10/12 считать backlog, а не блокером текущей работы.
4. После каждого куска запускать `node tools/runtime_smoke_check.js`.
5. Обновлять `docs/AI_PATCHER_WORKLOG.md` и чекбоксы этого плана.

### Следующий checkpoint

После 2-3 зелёных патчей или перед переходом к Phase 8 сделать Git commit/push, чтобы GitHub снова стал актуальной точкой восстановления.

---

## Phase 0 — Контроль, память проекта и безопасная база

- [x] Создать постоянный worklog: `docs/AI_PATCHER_WORKLOG.md`.
- [x] Создать правила для следующих чатов: `docs/AI_ASSISTANT_PROJECT_RULES.md`.
- [x] Создать viewer для worklog: `tools/worklog_viewer.html`.
- [x] Создать локальный сервер viewer: `tools/worklog_viewer_server.js`.
- [x] Создать smoke-check: `tools/runtime_smoke_check.js`.
- [x] Привести smoke-check к читаемому ASCII-выводу.
- [x] Сделать Git checkpoint и push после первой зелёной пачки.
- [x] Добавить прогресс-бар и большой план миграции в Worklog Viewer.

## Phase 1 — Runtime manifest и UI/runtime слой

- [x] Подключить `data/ui_runtime.json` через `data/runtime_manifest.json`.
- [x] Перенести save/localStorage/audio/background/language/debug константы из `js/core/constants.js`.
- [x] Прокинуть UI runtime config через `js/mods/ModLoaderIntegration.js`.
- [ ] Проверить UI runtime в реальном запуске Electron-приложения.
- [ ] Проверить автосохранения и ручные сохранения после выноса лимитов.
- [ ] Проверить переключение языка и background rotation после выноса констант.

## Phase 2 — Electron/main runtime слой

- [x] Создать `data/electron_runtime.json`.
- [x] Вынести server host/port/rate limits/static limits из `main.js`.
- [x] Вынести Electron window/preload/external protocols из `main.js`.
- [x] Вынести engine binary names/timeouts/raw command whitelist из `main.js`.
- [x] Вынести Gemini generation defaults/safety threshold из `main.js`.
- [ ] Проверить реальный запуск Electron окна после `electron_runtime`.
- [ ] Проверить static server/CSP на загрузке ассетов.
- [ ] Проверить engine command timeouts на реальном engine flow.

## Phase 3 — Prompt/runtime слой

- [x] Создать `data/prompt_runtime.json`.
- [x] Вынести пути `assets/promts/*` из `script.js`.
- [x] Вынести image prompt template.
- [x] Вынести response language mapping.
- [x] Вынести default `time_passed` и suggested action template.
- [x] Вынести command parser tags/delimiter.
- [x] Исправить синтаксический регресс hotfix-патчем.
- [ ] Проверить реальную prompt-сборку в новой игре.
- [ ] Проверить image prompt при включённой генерации изображений.
- [ ] Проверить command parser на реальном ответе модели.

## Phase 4 — Gameplay runtime слой: базовые формулы и экономика

- [x] Создать `data/gameplay_runtime.json`.
- [x] Вынести формулу mana.
- [x] Вынести формулу HP.
- [x] Вынести default item weight/durability.
- [x] Вынести container access distance.
- [x] Вынести lock difficulty/container health/flammable container types.
- [x] Вынести currency ids/AI identifiers/physical weights.
- [x] Вынести economy multipliers/min price/charisma effect.
- [x] Вынести faction manpower food/weapons/population ratio.
- [ ] Проверить HP/MP пересчёт в интерфейсе персонажа.
- [ ] Проверить торговлю buy/sell после переноса economy формулы.
- [ ] Проверить подсчёт gold/gold_ingot в контейнерах.
- [ ] Проверить faction manpower на реальном world state.

## Phase 5 — Gameplay runtime слой: старт игры и bootstrap

- [x] Вынести fallback start year/month/day/hour/minute.
- [x] Вынести calendar days per year/month.
- [x] Вынести формулу starting inventory capacity.
- [x] Вынести формулу world bootstrap days.
- [ ] Проверить старт новой игры после выноса календаря.
- [ ] Проверить корректность `absoluteStartDay`.
- [ ] Проверить bootstrap мира на разных population values.

## Phase 6 — `script.js`: actions, inventory commands, handlers

- [ ] Разобрать оставшиеся hardcoded action names и command names.

- [x] Вынести inventory id prefixes `cont_` / `item_` в `data/gameplay_runtime.json`.
- [x] Вынести default/system actor ids для inventory операций.
- [x] Вынести IPC retry settings для `sendInventoryCommand`.

- [x] Заменить оставшиеся hardcoded inventory actor ids в movement/trade/death flows на `getInventoryActorId()`.

- [x] Вынести `buildContainer` recipe/capacity defaults: resource prototype, resource cost, max weight, max slots, default coords.

- [x] Вынести inventory movement settings: full-stack sentinel, default/trade-locked item states, faction-vault resource debit container type.

- [x] Вынести transfer option presets, inventory command aliases, loot defaults, stack stat field и currency physical weight helpers.
- [ ] Вынести настройки inventory action handlers.
- [ ] Вынести настройки container/system container aliases.
- [ ] Вынести правила перемещения/stacking/loot.
- [ ] Вынести combat/action fallback messages.
- [ ] Вынести UI-visible gameplay labels, если они ещё захардкожены.
- [ ] Добавить smoke-check/validator для новых action data-файлов.

## Phase 7 — Data contracts и валидация

- [x] Добавить проверку структуры `ui_runtime.json`.
- [x] Добавить проверку структуры `electron_runtime.json`.
- [x] Добавить проверку структуры `prompt_runtime.json`.
- [x] Добавить проверку структуры `gameplay_runtime.json`.
- [x] Добавить проверку ссылок между data-файлами.
- [x] Добавить проверку дублей ID.
- [x] Добавить проверку отсутствующих prototype ids.
- [x] Расширить `tools/runtime_smoke_check.js` до data-contract smoke-check.

## Phase 8 — City generation / ProtoSystem

- [ ] Просканировать `ProtoSystem/sityGen.html` на hardcoded constants.
- [ ] Вынести параметры city generation в `data/city_gen.json` или отдельный runtime config.
- [ ] Проверить, что city generator использует данные из manifest/data.
- [ ] Убрать дубли city-gen данных между `ProtoSystem` и runtime.
- [ ] Проверить генерацию города вручную.

## Phase 9 — C++ engine data-driven слой

- [ ] Просканировать `engine/meterea_engine.cpp` на hardcoded IDs/constants.
- [ ] Просканировать `engine/item_system.cpp` на hardcoded item/container rules.
- [ ] Вынести engine constants в data/config, если engine уже умеет читать JSON.
- [ ] Если engine не умеет читать нужный JSON — добавить минимальный безопасный loader.
- [ ] Проверить сборку engine.
- [ ] Проверить engine commands после переноса.

## Phase 10 — Modding/data API слой

- [ ] Проверить `js/mods/ModLoaderIntegration.js` на оставшийся hardcode.
- [ ] Проверить mod template/runtime defaults.
- [ ] Убедиться, что моды могут переопределять новые runtime data секции.
- [ ] Добавить документацию для modders по новым runtime configs.
- [ ] Проверить merge policy для новых data-файлов.

## Phase 11 — Cleanup и удаление старых костылей

- [ ] Найти устаревшие временные файлы и скрипты.
- [ ] Решить, что удалить, а что оставить как tooling.
- [ ] Удалить или архивировать явно мёртвые утилиты.
- [ ] Обновить README/документацию запуска.
- [ ] Обновить worklog финальным состоянием миграции.

## Phase 12 — Финальная runtime-проверка

- [ ] Запустить Electron-приложение.
- [ ] Создать новую игру.
- [ ] Проверить загрузку сохранения.
- [ ] Проверить inventory/container flow.
- [ ] Проверить торговлю/economy.
- [ ] Проверить prompt flow.
- [ ] Проверить city generation.
- [ ] Проверить engine simulation flow.
- [ ] Сделать финальный Git checkpoint.

---

## Что считается завершением переноса

Перенос можно считать завершённым, когда:

1. новые runtime/data значения меняются без правки JS/Electron/C++ кода;
2. smoke-check и data-contract checks зелёные;
3. новая игра стартует;
4. сохранение/загрузка работают;
5. inventory/economy/combat/prompt/city/engine flows не ломаются;
6. worklog и план закрыты;
7. финальный commit/push сделан.
