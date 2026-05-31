# Issue #004: Confluence Protocol — нет health-check для подсистем

**Severity:** MEDIUM
**Status:** OPEN
**Date:** 2026-06-01

## Описание

Confluence Protocol v2 состоит из 4 подсистем:
- `DualWriteGateway`
- `PredictiveFeed`
- `CommandFeedback`
- `ReconciliationBuffer`

Каждая может не инициализироваться (typeof check), и тогда фича молча отключается.
Нет единой проверки «все ли подсистемы живы» и нет логирования, когда подсистема
отключается.

## Предлагаемое решение

1. Создать `ConfluenceHealthCheck.check()` — возвращает статус каждой подсистемы
2. Логировать при отключении подсистемы (уровень WARN)
3. Показывать в UI индикатор здоровья Confluence (для отладки)
4. Добавить periodic health-check (каждые N ходов)
