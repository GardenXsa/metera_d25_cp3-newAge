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
node tools/runtime_smoke_check.js  →  60 checks, 0 failed, 0 warnings
node tests/test_stub_game.js       →  80 PASSED, 0 FAILED, 0 WARNINGS
все py -3 engine/test_*.py         →  PASS
```

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

- [ ] **meterea_engine.exe устарел** — исходник `meterea_engine.cpp` был значительно
  изменён в ходе рефакторинга (Phase 9), но `.exe` / `.so` не перекомпилированы.
  Движок работает через fallback (OldCoreInventorySystem), пока бинарник не пересобран.
  **Что нужно**: `g++ -std=c++17 -O2 -o engine/meterea_engine.exe engine/meterea_engine.cpp`
  (или через CMake/Makefile если есть). После этого — перезапустить Electron.

- [ ] **UI примитивный** — основное окно выглядит скучно, не как игра.
  Нужен визуальный оверхол: тёмная тема с градиентами, анимации, иконки предметов.

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
7. **ПРАВИЛО: Перед каждым git push запускать smoke-check + test_stub_game.js**
   Если есть FAIL — пуш запрещён. push.sh делает это автоматически.

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
- **ПРАВИЛО**: Никогда не пушить минуя push.sh.
  Если нужно руками: сначала smoke-check, потом `git push`.

---

## ЗАМЕТКИ ДЛЯ БУДУЩИХ СЕССИЙ

1. **Бинарник движка устарел** — первое, что нужно сделать: перекомпилировать
   `engine/meterea_engine.cpp` в `.exe` (Windows) и `.so`/бинарник (Linux).
   После этого проверить IPC цепочку JS→Python→C++.

2. **UI оверхол** — следующая крупная задача после компиляции движка.
   Нужна тёмная тема, иконки, анимации. CSS полностью переработать.

3. **Data-driven рефакторинг завершён** (Phase 0–12 + Phase 9 engine cleanup).
   Все item ID, профессии, стоимости — в data/*.json. Движок читает через loadDatabase.

4. **Smoke-check зелёный: 60/0** — базовая точка на 2026-05-25.

5. **_processHover** — метод Cartographer, НЕ вложенная функция. this контекст важен.

6. **ContainerRegistry / ItemRegistry** — глобальные Map объекты.
   CoreInventorySystemAsync — async, OldCoreInventorySystem — sync fallback.
   Не вызывать async методы без await.

7. **Профессии** — теперь хранятся как ID (строчные: "farmer", "blacksmith" и т.д.),
   не как English display names. Display name берётся из professions.json через i18n_key.
