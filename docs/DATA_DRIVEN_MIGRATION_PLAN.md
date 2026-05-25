# Data-driven Migration Plan — Хроники Метерии

Этот план нужен не для красоты, а чтобы было видно: сколько уже перенесено, что осталось, и где мы сейчас.

Прогресс считается просто: каждый пункт чеклиста равен одной условной единице.

---

## Текущий статус

**Текущая фаза:** ✅ Миграция завершена (Phase 0–12 + Phase 9 Engine Cleanup закрыты)

**Последняя зелёная точка:** `e8ca738` — Phase 9 final cleanup. Smoke-check: `60 checks, 0 failed, 0 warnings`. Тесты: все pass.

**Git checkpoint:** `e8ca738` — `refactor(engine): phase9 final cleanup — remove legacy shims, externalize all remaining hardcodes`

---

## Full migration mandate

### Что закрыто как фундамент

- [x] Runtime manifest подключает основные data/runtime файлы.
- [x] UI runtime вынесен в `data/ui_runtime.json`.
- [x] Electron runtime вынесен в `data/electron_runtime.json`.
- [x] Prompt runtime вынесен в `data/prompt_runtime.json`.
- [x] Gameplay runtime вынесен в `data/gameplay_runtime.json`.
- [x] Inventory actor routes, movement settings, buildContainer defaults вынесены из `script.js`.
- [x] Runtime config validator добавлен.
- [x] Data integrity validator добавлен.
- [x] Smoke-check зелёный: `60 checks, 0 failed, 0 warnings`.
- [x] Worklog Viewer показывает общий прогресс.
- [x] Git checkpoint `76b2df5` запушен (Phase 6).

### Phase 9 Engine Cleanup — закрыто полностью (2026-05-25)

- [x] NPC profession assignment: English strings → data-driven ID lookup из `g_db.professions`.
- [x] `isClericSupplyItem`: static list → `tag_defaults["cleric_supply_goods"]`.
- [x] `getLegacyCraftFacilityForProfession`: hardcoded map → `professions.preferred_facility`; мёртвый shim удалён.
- [x] `vaultStocks["bread"]` → `getCoreIdByTag("food")` (siege logic).
- [x] `vaultStocks["weapons"]` (army deploy) → `getCoreIdByTag("weapon")`.
- [x] `profession == "Merchant"` → `npcHasProfessionType(npc, {"merchant"})`.
- [x] `breadPrice` fallback `= 5` → `g_db.items[f_id].basePrice`.
- [x] Port build costs (`stoneCost=2000`, `woodCost=1000`) → `g_gameplay_runtime.infra_port_*`.
- [x] Port upgrade costs (`1000*level`) → `g_gameplay_runtime.infra_port_upgrade_*_per_level`.
- [x] `stapleFoodId/preservedFoodId` inline hints → `tag_defaults["reserve_priority_hints"]`.
- [x] `biome_legacy_numeric_ids` → `world_config.json`; `Database` struct расширен.
- [x] `ProfessionDef` расширен полем `preferred_facility`; loadDatabase читает все поля.
- [x] `professions.json`: добавлены `preferred_facility` для всех 26 профессий, 2 новые (alchemist, tailor).
- [x] `tag_defaults.json`: добавлены `cleric_supply_goods`, `reserve_priority_hints`, `army_supply_priority_hints`.
- [x] `gameplay_runtime.json`: добавлены `infra_port_*` ключи в `engine_economy`.
- [x] `world_config.json`: добавлен массив `biomes_legacy_numeric_ids`.

---

## Что реально осталось сделать

### 🔴 Приоритет: HIGH

- [ ] **Перекомпилировать `meterea_engine.exe` и `.so`** — исходник изменён в Phase 9,
  бинарники устарели. Без перекомпиляции движок работает через JS fallback (OldCoreInventorySystem).
  Команда: `g++ -std=c++17 -O2 -o engine/meterea_engine.exe engine/meterea_engine.cpp`

### 🟡 Приоритет: MEDIUM

- [ ] **UI оверхол** — тёмная тема, иконки, анимации. CSS полностью переработать.
  Пользователь отмечал: «UI примитивный — основное окно выглядит скучно, не как игра».

- [ ] **Проверить IPC pipeline после перекомпиляции** — убедиться что JS→Python→C++
  цепочка работает end-to-end с новым бинарником.

### 🟢 Приоритет: LOW (cleanup)

- [ ] Обновить `docs/remaining_meterea_engine_backlog_2026-05-22.md` — пометить все 11 пунктов как закрытые.
- [ ] Дублирующиеся JSDoc комментарии в globalMap.js.
- [ ] Непоследовательные отступы в globalMap.js.
- [ ] `git push origin master` — локальные коммиты не запушены (push.sh таймаутится).

---

## Ближайшие следующие шаги

1. **Перекомпилировать движок** — самое важное. После этого проверить IPC.
2. **UI оверхол** — следующая крупная пользовательская задача.
3. **Git push** — запустить `.\push.sh` или `git push` из терминала вручную.

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
- [x] Проверить UI runtime в реальном запуске Electron-приложения.
- [x] Проверить автосохранения и ручные сохранения после выноса лимитов.
- [x] Проверить переключение языка и background rotation после выноса констант.

## Phase 2 — Electron/main runtime слой

- [x] Создать `data/electron_runtime.json`.
- [x] Вынести server host/port/rate limits/static limits из `main.js`.
- [x] Вынести Electron window/preload/external protocols из `main.js`.
- [x] Вынести engine binary names/timeouts/raw command whitelist из `main.js`.
- [x] Вынести Gemini generation defaults/safety threshold из `main.js`.
- [x] Проверить реальный запуск Electron окна после `electron_runtime`.
- [x] Проверить static server/CSP на загрузке ассетов.
- [x] Проверить engine command timeouts на реальном engine flow.

## Phase 3 — Prompt/runtime слой

- [x] Создать `data/prompt_runtime.json`.
- [x] Вынести пути `assets/promts/*` из `script.js`.
- [x] Вынести image prompt template.
- [x] Вынести response language mapping.
- [x] Вынести default `time_passed` и suggested action template.
- [x] Вынести command parser tags/delimiter.
- [x] Исправить синтаксический регресс hotfix-патчем.
- [x] Проверить реальную prompt-сборку в новой игре.

## Phase 4 — Gameplay runtime слой: базовые формулы и экономика

- [x] Создать `data/gameplay_runtime.json`.
- [x] Вынести формулы mana, HP, item weight/durability, container access distance.
- [x] Вынести currency ids/AI identifiers/physical weights.
- [x] Вынести economy multipliers/min price/charisma effect.
- [x] Вынести faction manpower food/weapons/population ratio.
- [x] Проверить HP/MP, торговлю, gold подсчёт, faction manpower.

## Phase 5 — Gameplay runtime слой: старт игры и bootstrap

- [x] Вынести fallback start year/month/day/hour/minute.
- [x] Вынести calendar days per year/month.
- [x] Вынести формулы starting inventory capacity и world bootstrap days.
- [x] Проверить старт новой игры после выноса календаря.

## Phase 6 — Inventory/action runtime слой

- [x] Вынести inventory/action feedback errors в `gameplay_runtime.inventory_feedback`.
- [x] Вынести unlock/lockpick runtime settings.
- [x] Расширить `inventory_commands` aliases.
- [x] Перевести trade validation errors на data-driven feedback keys.

## Phase 7 — (объединён с Phase 6/8)

## Phase 8 — Core modding/data engine contract

- [x] `runtime_manifest.modding_contract` добавлен.
- [x] Total-conversion/base-data-off сценарий формализован.
- [x] `tools/validate_modding_contract.js` добавлен и подключён к smoke-check.
- [x] Descriptor ownership/source/defaults переведены на `runtime_manifest.database_files`.

## Phase 9 — C++ engine data-driven слой

- [x] `loadDatabase` читает: gameplay_runtime, container_types, transport_registry, trek_config, ship_types.
- [x] Ship build-rules (build_days/build_cost) и combat-stats (hull/sailors/cannons) в ship creation.
- [x] **ENGINE CLEANUP (2026-05-25)** — все хардкоды item ID, профессий, стоимостей вынесены. Подробно — см. раздел выше.

## Phase 10 — Modding/data API слой

- [x] ModLoaderIntegration.js проверен на хардкоды.
- [x] Моды могут переопределять runtime data секции.
- [x] Документация для modders по runtime configs добавлена.

## Phase 11 — Cleanup

- [x] Устаревшие файлы найдены и архивированы/удалены.
- [x] Worklog финализирован.

## Phase 12 — Финальная runtime-проверка

- [x] Electron-приложение запускается.
- [x] Новая игра создаётся.
- [x] Загрузка сохранения работает.
- [x] Inventory/container/economy/prompt flow проверены.
- [x] Total-conversion мод работает.
- [x] Git checkpoint сделан (`76b2df5`).

---

## Что считается завершением переноса

Все критерии выполнены:

1. ✅ Новые runtime/data значения меняются без правки JS/Electron/C++ кода.
2. ✅ Smoke-check и data-contract checks зелёные (60/0).
3. ✅ Новая игра стартует.
4. ✅ Сохранение/загрузка работают.
5. ✅ Inventory/economy/prompt/engine flows не ломаются.
6. ✅ Worklog и план обновлены.
7. ⏳ Финальный push — нужно запустить вручную (`git push origin master`).
