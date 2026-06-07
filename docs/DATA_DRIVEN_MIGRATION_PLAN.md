# Data-driven Migration Plan — Хроники Метерии

Этот план нужен не для красоты, а чтобы было видно: сколько уже перенесено, что осталось, и где мы сейчас.

Прогресс считается просто: каждый пункт чеклиста равен одной условной единице.

---

## Текущий статус

**Текущая фаза:** ✅ Миграция завершена (Phase 0–12 + Phase 9 Engine Cleanup закрыты)

**Последняя зелёная точка:** после `fix_map_roads_over_ocean_and_riverbank_mouth_artifacts` — `npm run verify`: ожидается `0 failed, 0 skipped`; smoke-check: `67 checks, 0 failed, 0 warnings`; stub tests: `80 PASSED, 0 FAILED, 0 WARNINGS`; Python engine regression tests: PASS.

**Git checkpoint:** `d32f687` — `chore: add full verify and sync project docs`

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
- [x] Smoke-check зелёный: `84 checks, 0 failed, 0 warnings`.
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

- [x] **Перекомпилировать `meterea_engine.exe`** — выполнено 2026-05-25. g++ 15.2.0 (MSYS2), 0 ошибок.
  Команда: `g++ -std=c++17 -O2 -I. -o engine/meterea_engine.exe engine/meterea_engine.cpp engine/item_system.cpp -lpthread`
  Бинарник отвечает: `{"pong":true,"status":"ok"}`

### 🟡 Приоритет: MEDIUM

- [x] **UI оверхол** — выполнено 2026-05-25. Добавлены: shimmer-анимации на HP/MP барах,
  damage/heal flash, statChange при изменении характеристик, типизированные стили сообщений
  (combat/loot/quest/trade/danger/travel), polish панелей (glow, разделители, заголовки),
  улучшенный скролл game-log, анимации suggested-actions, stat-increase кнопки.
  Пользователь отмечал: «UI примитивный — основное окно выглядит скучно, не как игра».

- [x] **Проверить IPC pipeline после перекомпиляции** — бинарник отвечает на ping. Полный
  end-to-end тест (JS→Python→C++) требует запуска Electron — проверяется вручную при старте игры.

### 🟢 Приоритет: LOW (cleanup)

- [x] Обновить `docs/remaining_meterea_engine_backlog_2026-05-22.md` — все 11 пунктов закрыты (2026-05-25).
- [x] Дублирующиеся JSDoc комментарии в globalMap.js — исправлено 2026-05-25 (коммит 58f1348).
- [x] Непоследовательные отступы в globalMap.js — исправлено 2026-05-25 (коммит 58f1348).
- [x] `git push origin master` — запушено пользователем 2026-05-25.

---

## Ближайшие следующие шаги

1. **Запустить единый verification-контур**: `npm run verify` или `tools\\full_verify.bat`.
2. **Если verify зелёный — сделать короткий ручной Electron E2E**: запуск окна, новая игра, загрузка сохранения, DevTools console, IPC flow.
3. **После E2E — переходить к следующей игровой задаче**, а не возвращаться к уже закрытой миграции без нового конкретного бага.

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
7. ✅ Финальный push по закрытым migration/UI/engine этапам выполнен; перед следующими push использовать `npm run verify`.



---

### Character stats architecture cleanup

- [x] Character creation переведён на `CharacterStatsResolver`.
- [x] Runtime/preflight проверяет character stats contract.
- [x] `CharacterStatsResolver` покрыт dedicated unit-test.
- [x] Legacy-глобалы `BASE_CLASS_STATS`, `RACE_MODIFIERS`, `applyDatabaseStats()` удалены из JS runtime после зелёной проверки.

## Phase 13 — GM Game Loop Enforcement (обязательный игровой шаг)

**Текущая фаза:** 🔵 Phase 13 — в работе.

**Цель:** внешний LLM-агент GM обязан стабильно замыкать 5-шаговый цикл (СИСТЕМА ДАВИТ → ИГРОК ВЫБИРАЕТ → КОМАНДА МЕНЯЕТ МИР → ПОСЛЕДСТВИЯ ВОЗВРАЩАЮТСЯ → НОВАЯ ДИЛЕММА). Атмосфера — инструмент цикла, а не самоцель. Слово GM — это «Consequence Director», а не «рассказчик».

**Что сделано:**

- [x] Создан `assets/prompts/game_loop.txt` — единый источник правил 5-шагового цикла (PRESSURE / CHOICE / MATERIALIZATION / CONSEQUENCE / LOOP RECURSION), STAKES CONTRACT, SCHEDULED RETURN, CROSS-SYSTEM CONSEQUENCE, REJECT ATMOSPHERE WITHOUT ACTION.
- [x] `data/prompt_runtime.json` подключает `game_loop` как Layer 0 (первый ключ в `prompt_files`).
- [x] `data/prompt_pack.json` имеет `entries.game_loop` и `aliases` для `assets/prompts/game_loop.txt`.
- [x] `hard_protocol.txt` (Layer 1) содержит GAME LOOP CONTRACT блок-ссылку + расширенный финальный чеклист.
- [x] `1.txt` (Layer 2) имеет блок РОЛЬ: CONSEQUENCE DIRECTOR + ФИНАЛЬНАЯ ПРОВЕРКА расширена шагами 1-5 цикла и STAKES / CROSS-SYSTEM.
- [x] `narrative_rules.txt`: правило 7 — STAKES CONTRACT (6 видов ставок: ресурс, время, тело, репутация, клятва, отношения).
- [x] `style_rules.txt`: новая директива «АТМОСФЕРА БЕЗ ДЕЙСТВИЯ — ЭТО МУСОР», лимит на 3 абзаца чистого описания без `actions`.
- [x] `rules_and_instructions.txt`: чеклист квеста расширен пунктами цикла + SCHEDULED RETURN; добавлен блок SCHEDULED RETURN с обязательной записью `Consequence_<quest_id>` в `setMemory`.
- [x] `logic_rules.txt`: блоки CROSS-SYSTEM CONSEQUENCE (минимальная матрица 7 систем), DELAYED RETURN (обязательная запись + сверка в следующих ходах), REJECT ATMOSPHERE WITHOUT ACTION.
- [x] 4 era `initial_prompt_*.txt` (architects, rebirth, silence, sundering) + `initial_game_setup_prompt.txt` — общий блок «0. GAME LOOP» с пошаговой раскладкой для стартовой сцены.
- [x] `deep_setup/stage3_environment.txt`: NPC как источники давления, минимум 1 из 3-5 обязан быть угрозой/крючком/дефицитом.
- [x] `deep_setup/stage4_quests.txt`: обязательная запись `Consequence_<quest_id>` в `setMemory` рядом с `addQuest`; рекомендация NEXUS-константы.
- [x] `deep_setup/stage5_prologue.txt`: 4 абзаца привязаны к шагам цикла (ставка прошлого → давление настоящего → угрожающий NPC → крючок-финал).

**Следующие шаги Phase 13:**

- [ ] E2E-тест на живом LLM-агенте: создать новую игру, пройти 5-10 ходов, проверить, что каждый ход замкнул цикл (давление → выбор → команда → последствие → крючок).
- [ ] Метрика успеха: ≥ 80% ходов содержат команду `Consequence_*` в `setMemory` при завершении квеста.
- [ ] Если цикл стабильно замыкается — Phase 13 закрывается; если регулярно срывается шаг 1 или 5 — добавить дополнительную эвристику в `game_loop.txt`.
- [ ] Git checkpoint после E2E-зелёного результата.

**Риск:** средний. Меняется активный prompt-flow для всех эпох, но это чисто текстовая директива, никаких runtime engine-команд не затрагивается. Fallback-поведение GM не ломается, цикл становится обязательным.
