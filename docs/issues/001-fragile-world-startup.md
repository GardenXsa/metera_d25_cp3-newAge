# Issue #001: Хрупкий запуск мира — finalizeWorldSetupAndStart без таймаутов

**Severity:** CRITICAL
**Status:** FIXED
**Date:** 2026-06-01

## Описание

`finalizeWorldSetupAndStart()` — монолитная функция (~300 строк), содержащая каскад
`await`-вызовов без индивидуальных таймаутов. Если любой из вызовов зависает, весь
процесс запуска мира блокируется навсегда, и игра висит на экране "Генерация мира...".

Единственная защита — `WorldStartupWatchdog` с 3-минутным таймаутом, который не знает,
на каком шаге произошла блокировка, и может только автоотключить моды.

## Последствия

- Файловая синхронизация `nexusWriteSyncFile` + `nexusLoadWorldFile` блокировала AI-запрос
  (исправлено частично — fire-and-forget, но остальные await'ы не защищены)
- `initWorldSimulator()` может зависнуть при инициализации C++ движка
- `loadPromptFromFile()` может зависнуть при загрузке промпта
- `ensurePlayerContainers()` может зависнуть при IPC к движку
- `TransportSystem.init()` может зависнуть

## Исправление (commit d014dce)

1. ✅ Каждый критический `await` обёрнут в `withTimeout(promise, ms, label)`
2. ✅ Все таймауты non-fatal — код продолжает с предупреждением
3. ✅ State machine `WorldStartupPipeline` отслеживает переходы
4. ✅ Watchdog теперь знает `pipelineState` + `pipelineHistory` при timeout

Таймауты:
- loadActiveEraLore + loadGlobalLocations: 15s
- initializeGameInterface: 10s
- initWorldSimulator (preloaded): 60s
- initWorldSimulator (new): 120s
- nexusBootstrap: 120s
- preSimulateWorldHistory: 180s
- promptSaveWorldModal: 300s
- ensurePlayerContainers: 15s
- loadPromptFromFile: 10s
- TransportSystem.init: 5s

## Связанные issues

- #002 State machine для запуска мира
- #003 Управляемый контекст для preloadedWorldData
