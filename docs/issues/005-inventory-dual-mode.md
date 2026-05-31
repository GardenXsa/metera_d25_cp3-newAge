# Issue #005: Инвентарь в двух режимах — server-authoritative vs local-only

**Severity:** MEDIUM
**Status:** OPEN
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

## Предлагаемое решение

1. Явный флаг `inventoryMode: 'server' | 'local'`
2. Логировать переключение режима
3. При потере сервера — полный переход в local mode с предупреждением
4. Periodic reconciliation между server и local state
