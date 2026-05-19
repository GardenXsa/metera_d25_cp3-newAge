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
bash test_runner.sh
```

Тесты: JS синтаксис, Python синтаксис, HTML структура, JSON валидность,
CSS баланс скобок, зависимости, Electron структура, ссылки в HTML, CSP заголовки, C++ движок.

---

## ИЗВЕСТНЫЕ БАГИ И ПРОБЛЕМЫ

### КРИТИЧЕСКИЕ (блокируют игру)

- [ ] **Движок/симуляция не работает** — JS→Python→C++ pipeline не отдаёт данные.
  Нужно трассировать: script.js → electronAPI → main.js IPC → engine_client.py → meterea_engine
  Проверить: запускается ли C++ процесс, приходит ли ответ, парсится ли JSON.

- [ ] **Inventory async/sync mismatch** — `getContainerWeight()` и `createContainer()`
  вызываются без `await` в некоторых местах. CoreInventorySystemAsync — все методы async,
  но OldCoreInventorySystem — sync. Нужно найти все вызовы async методов без await.

### СРЕДНИЕ (ухудшают опыт)

- [ ] **UI примитивный** — основное окно выглядит скучно, не как игра.
  Нужен визуальный оверхол: тёмная тема с градиентами, анимации, иконки.

- [ ] **Карта лагала** — ИСПРАВЛЕНО: добавлен throttle (~30fps) через setTimeout в handleMouseMove,
  hover-обработка вынесена в _processHover, render через requestAnimationFrame с флагом _needsRender.

### НИЗКИЕ (косметика)

- [ ] Дублирующиеся JSDoc комментарии в globalMap.js (были до нас)
- [ ] Непоследовательные отступы в некоторых местах globalMap.js

---

## ИСТОРИЯ ИЗМЕНЕНИЙ (последние)

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

- Push скрипт: `/home/z/my-project/pssh.py` (paramiko SSH)
- SSH ключ: `/home/z/my-project/ssh/deploy_key`
- Git wrapper: `/home/z/my-project/git_ssh_wrapper.py`
- Репозиторий: `https://github.com/GardenXsa/metera_d25_cp3-newAge`

---

## ЗАМЕТКИ ДЛЯ БУДУЩИХ СЕССИЙ

1. **Движок — главный нерешённый вопрос**. Пользователь говорит, что симуляция не работает.
   Нужно трассировать всю цепочку JS→Python→C++ и найти, где обрывается.

2. **UI оверхол** — пользователь хочет «игровой» интерфейс вместо примитивного.
   Нужно полностью переработать CSS и, возможно, HTML структуру.

3. **Не забывать про test_runner.sh** — запускать перед каждым пушем!

4. **_processHover** — это метод Cartographer, НЕ вложенная функция.
   Если его перемещать — убедиться, что this контекст правильный.

5. **ContainerRegistry / ItemRegistry** — глобальные Map объекты.
   CoreInventorySystemAsync — async версия, OldCoreInventorySystem — sync.
   ВНИМАНИЕ: не путать, не вызывать async методы без await.
