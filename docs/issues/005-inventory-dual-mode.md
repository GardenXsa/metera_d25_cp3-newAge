# Issue #005: Инвентарь в двух режимах — server-authoritative vs local-only

**Severity:** MEDIUM
**Status:** FIXED
**Date:** 2026-06-01

## Описание

`sendInventoryCommand` пытается IPC → retry → fallback на `executeLocalInventoryCommand`.
Это означает, что инвентарь может работать в двух режимах:

1. **Server-authoritative** (C++ движок) — все операции через IPC
2. **Local-only** (OldCoreInventorySystem) — всё в JS-памяти

Проблемы:
- Поведение может расходиться (race conditions, рассинхронизация)
- Нет явного режима — игра может переключиться mid-session
- Нет логирования при переключении режима
- Рассинхронизация ItemRegistry/ContainerRegistry между движком и JS

## Исправление

Создан `InventoryModeManager` (script.js) — объект с методами:

- `detectInitialMode()` — определение режима при запуске (вызывается в init приложения)
- `getMode()` / `isServer()` / `isLocal()` — проверка текущего режима
- `switchToLocal(source)` — переключение с логированием причины
- `tryRecoverToServer()` — попытка вернуться на серверный режим (каждые 10 команд)
- `reconcile()` — сверка локальных реестров с C++ движком
- `getDebugInfo()` — диагностика (mode, switchCount, lastReconciliation)

Интеграция:
- `sendInventoryCommand` использует `InventoryModeManager` для маршрутизации
- При IPC error/exception — `switchToLocal()` с причиной
- Periodic reconciliation каждые 20 ходов (в `sendApiRequest`)
- Auto-recovery: каждые 10 команд в local-режиме пробуем вернуться на server
