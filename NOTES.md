# METERA D25 CP3 — Хроники Метерии
## Долгосрочные заметки и чек-лист тестирования

> Этот файл — постоянная память проекта. Обновляется при каждом изменении.
> Расположение: `C:\Users\user\Desktop\projects\MET_test\metera_d25_cp3-01-21\NOTES.md`
> **Последнее обновление: 2026-05-25**

---

## АРХИТЕКТУРА ПРОЕКТА

- **Electron** (main.js) → загружает index.html
- **Рендерер**: script.js (основная логика ~5000+ строк), js/ (модули)
- **Движок**: C++ (engine/meterea_engine.cpp, ~15 800 строк) → компилируется в engine/meterea_engine.exe (Windows) / engine/meterea_engine (Linux)
- **Python-мост**: engine/engine_client.py — общается с C++ через stdin/stdout JSON
- **IPC**: preload.js ↔ main.js → electronAPI
- **Моды**: js/mods/ (ModLoader, ModManagerUI, ModLoaderIntegration, runtimeData)
- **Сохранения**: js/saves/ (SaveManager, SaveUI, StorageProvider)
- **Карта**: js/cartographer/globalMap.js (Canvas 2D, OffscreenCanvas кэши)
- **Data layer**: data/*.json (~40 файлов) подключены через data/runtime_manifest.json

### Data-driven архитектура (актуально)

Проект полностью переведён на data-driven подход (Phase 0–12 закрыты):
- Все item ID, профессии, стоимости строительства, военные пороги → в `data/*.json`
- Движок загружает настройки через `loadDatabase` + `loadGameplayRuntimeConfig`
- Моддинг: total conversion, manifest/merge policies, base-data-off сценарий — всё работает
- Runtime configs: `ui_runtime.json`, `electron_runtime.json`, `prompt_runtime.json`, `gameplay_runtime.json`

---

## ЗАПУСК ТЕСТИРОВАНИЯ (Windows)

```bat
cd C:\Users\user\Desktop\projects\MET_test\metera_d25_cp3-01-21

:: Smoke-check (основной, быстрый)
node tools\runtime_smoke_check.js

:: Тесты движка (Python)
py -3 engine\test_profession_cluster_refactor.py
py -3 engine\test_food_cluster_refactor.py
py -3 engine\test_bootstrap_cluster_refactor.py
py -3 engine\test_legacy_resource_and_business_refactor.py
py -3 engine\test_runtime_bundle.py
py -3 engine\test_gameplay_runtime_inventory.py

:: Интеграционный тест JS (stub provider)
node tests\test_stub_game.js

:: Валидаторы
node tools\validate_runtime_configs.js
node tools\validate_data_integrity.js
node tools\validate_modding_contract.js
```

### Текущая зелёная база (2026-05-25):
```
node tools/runtime_smoke_check.js  →  80 checks, 0 failed, 0 warnings
node tests/test_stub_game.js       →  80 PASSED, 0 FAILED, 0 WARNINGS
все py -3 engine/test_*.py         →  PASS
```

### Единая проверка перед push / крупным патчем:
```bat
npm run verify
```

Или напрямую:
```bat
tools\\full_verify.bat
```

`full_verify` запускает smoke-check, runtime-data test, stub-game integration test и ключевые Python engine regression tests.

### Интеграционные тесты (stub provider):
- `tests/test_stub_game.js` — 80 ассертов:
  - Создание контейнеров (рюкзак, экипировка, сундуки)
  - Создание предметов (оружие, зелья, золото)
  - Система золота (добавление, удаление, синхронизация)
  - Перемещение предметов (включая разделение стаков)
  - Вес контейнеров, ensurePlayerContainers(), флаг кражи, вместимость

---

## ИЗВЕСТНЫЕ БАГИ И ПРОБЛЕМЫ

### КРИТИЧЕСКИЕ (блокируют игру)

На 2026-05-25 известных критических блокеров в документации не осталось.

### ВАЖНЫЕ, НО НЕ БЛОКИРУЮЩИЕ

- [ ] **Electron E2E нужно проверять вручную после крупных правок** — автоматические тесты
  закрывают smoke/runtime/stub/engine контур, но не доказывают, что реальное окно Electron,
  DevTools console, новая игра, загрузка сохранения и полный IPC pipeline работают глазами.

- [ ] **Документацию нужно держать синхронной с GitHub/master** — ранее `NOTES.md` и
  `DATA_DRIVEN_MIGRATION_PLAN.md` расходились по статусам перекомпиляции, UI overhaul и push.
  После этого патча источником быстрой проверки становится `npm run verify` / `tools\\full_verify.bat`.

### ИСПРАВЛЕНО (архив)

- [x] **Инвентарь не работает без движка** — fallback на OldCoreInventorySystem.
- [x] **Inventory async/sync mismatch** — все вызовы проверены, Тест 12 WARN — ложноположительный.
- [x] **Карта лагала** — throttle ~30fps, _processHover, requestAnimationFrame + _needsRender.
- [x] **CSP inline handler violations** — 14 inline обработчиков заменены на addEventListener.
- [x] **loadWorldFile** — движок перекомпилирован, команда работает (до рефакторинга Phase 9).
- [x] **Карта не загружается из сохранения** — stdin 64KB limit → файловая синхронизация.
- [x] **ThreadPool фейковый** → реальный (hardware_concurrency воркеры).
- [x] **Все хардкоды item ID в движке** — полностью вынесены в data/*.json (Phase 9).

### НИЗКИЕ (косметика)

- [ ] Дублирующиеся JSDoc комментарии в globalMap.js
- [ ] Непоследовательные отступы в некоторых местах globalMap.js

---

## ЧЕК-ЛИСТ ПЕРЕД КАЖДЫМ ИЗМЕНЕНИЕМ КОДА

1. `node tools\runtime_smoke_check.js` — должно быть 0 failed
2. `node -e "JSON.parse(require('fs').readFileSync('<файл>','utf8'))"` — если меняешь JSON
3. `node --check <файл>` — если меняешь JS
4. Проверить async/await соответствие (async методы → await вызовы)
5. Если меняешь `engine/meterea_engine.cpp` — перекомпилировать бинарник
6. Если меняешь `data/*.json` — обновить `data/runtime_manifest.json` если нужен новый ключ
7. **ПРАВИЛО: Перед каждым git push запускать `npm run verify`**
   Если есть FAIL — пуш запрещён. `npm run verify` включает smoke-check, runtime-data test, stub-game integration test и ключевые Python engine regression tests.

---

## ФАЙЛЫ КОТОРЫЕ НУЖНО ТЕСТИРОВАТЬ В ПЕРВУЮ ОЧЕРЕДЬ

| Файл | Причина | Приоритет |
|------|---------|-----------| 
| engine/meterea_engine.cpp | C++ движок, 15 800 строк | ВЫСОКИЙ |
| js/cartographer/globalMap.js | Сложная структура, Canvas | ВЫСОКИЙ |
| script.js | Основная логика, 5000+ строк | ВЫСОКИЙ |
| main.js | Electron main, CSP, IPC | ВЫСОКИЙ |
| data/gameplay_runtime.json | Runtime config движка | СРЕДНИЙ |
| data/tag_defaults.json | Item ID маппинги | СРЕДНИЙ |
| engine/engine_client.py | Python-C++ мост | СРЕДНИЙ |
| index.html | Точка входа, скрипты | СРЕДНИЙ |

---

## PUSH ИНФРАСТРУКТУРА

- Push скрипт: `push.sh` (автоматически запускает тесты перед пушем)
- Deploy key: `deploy_key` / `deploy_key.pub`
- Репозиторий: `https://github.com/GardenXsa/metera_d25_cp3-newAge`
- **ПРАВИЛО**: перед push обязательно запускать `npm run verify`.
  Если нужно пушить руками: сначала `npm run verify`, потом `git push`.

---

## ЗАМЕТКИ ДЛЯ БУДУЩИХ СЕССИЙ

1. **Перед продолжением сначала запустить `npm run verify`** — это единая быстрая проверка
   smoke/runtime/stub/engine контура. Если она красная, сначала чинить её.

2. **Electron E2E остаётся ручным финальным шагом** — после крупных патчей нужно открыть приложение,
   проверить старт новой игры, загрузку сохранения, DevTools console и IPC цепочку JS→Python→C++.

3. **Data-driven рефакторинг завершён** (Phase 0–12 + Phase 9 engine cleanup).
   Все item ID, профессии, стоимости — в data/*.json. Движок читает через loadDatabase.

4. **Smoke-check зелёный: 80/0** — базовая точка после mod runtime E2E flow test на 2026-05-26. Полная быстрая проверка: `npm run verify`.

5. **_processHover** — метод Cartographer, НЕ вложенная функция. this контекст важен.

6. **ContainerRegistry / ItemRegistry** — глобальные Map объекты.
   CoreInventorySystemAsync — async, OldCoreInventorySystem — sync fallback.
   Не вызывать async методы без await.

7. **Профессии** — теперь хранятся как ID (строчные: "farmer", "blacksmith" и т.д.),
   не как English display names. Display name берётся из professions.json через i18n_key.
