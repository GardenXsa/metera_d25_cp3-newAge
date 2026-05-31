# Issue #003: Неуправляемый preloadedWorldData — глобальный mutable state

**Severity:** MEDIUM
**Status:** FIXED
**Date:** 2026-06-01

## Описание

`preloadedWorldData` — глобальная переменная, используемая для передачи данных мира
между экраном выбора мира и запуском игры. Проблемы:

1. **Неявное состояние**: Устанавливается в `openLoadWorldModal()` (строка 19575),
   обнуляется в `startNewGameSetup()` (8135) и `exitToMainMenu()` (17408).
   Любой путь, забывший обнулить — потенциальный «фантомный мир».

2. **Нет валидации**: Данные мира не проверяются при установке.
   Повреждённый мир может пройти через всю цепочку инициализации
   и упасть только при AI-запросе.

3. **Нет владения**: Ни один объект не «владеет» `preloadedWorldData`.
   Любая часть кода может его прочитать или перезаписать.

## Исправление (commit d014dce)

Создан `WorldStartupContext` (js/core/globals.js) — объект с методами:

- `set(data, source)` — установка с source tracking и логированием
- `get()` — получение данных
- `clear(source)` — очистка с source tracking
- `isActive()` — проверка
- `validate()` — структурная валидация (regions, factions)
- `getDebugInfo()` — диагностика (ageMs, source, validation)

Все точки использования `preloadedWorldData` обновлены:
- `openLoadWorldModal()` → `WorldStartupContext.set(wData, 'openLoadWorldModal')`
- `startNewGameSetup()` → `WorldStartupContext.clear('startNewGameSetup')`
- `exitToMainMenu()` → `WorldStartupContext.clear('exitToMainMenu')`
- `finalizeWorldSetupAndStart()` → валидация через `WorldStartupContext.validate()`
