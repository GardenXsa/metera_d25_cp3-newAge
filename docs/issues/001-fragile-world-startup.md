# Issue #001: Хрупкий запуск мира — finalizeWorldSetupAndStart без таймаутов

**Severity:** CRITICAL
**Status:** OPEN
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

## План исправления

1. Обернуть КАЖДЫЙ критический `await` в `Promise.race` с таймаутом
2. Реализовать state machine для запуска мира (см. Issue #002)
3. Каждый шаг state machine имеет свой таймаут и error recovery

## Связанные issues

- #002 State machine для запуска мира
- #003 Управляемый контекст для preloadedWorldData
