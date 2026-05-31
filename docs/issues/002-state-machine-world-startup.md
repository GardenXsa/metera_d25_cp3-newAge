# Issue #002: State machine для запуска мира

**Severity:** HIGH
**Status:** OPEN
**Date:** 2026-06-01

## Описание

Запуск мира реализован как каскад `if/else` внутри `finalizeWorldSetupAndStart()`.
Это создаёт множество непроверенных путей выполнения:

```
if (preloadedWorldData) {
    // путь A: предзагруженный мир
    if (nexusWriteSyncFile) { ... }  // путь A1: с файловой синхронизацией
} else {
    // путь B: генерация нового мира
    if (nexusBootstrap) { ... }      // путь B1: с bootstrap
    if (enableWorldSim) { ... }      // путь B2: с пре-симуляцией
    if (isElectron) { ... }          // путь B3: с сохранением мира
}

if (enableDeepSetup) {
    // путь C: глубокая генерация (5-этапный pipeline)
} else {
    // путь D: обычный запуск
    // ... ещё 100+ строк сборки промпта
    sendApiRequest(startPrompt, true);
}
```

Каждое ветвление — потенциальный баг. Мы уже ловили баг, когда путь A1 блокировал
отправку AI-запроса (fire-and-forget фикс).

## Предлагаемое решение

Реализовать явную state machine:

```
INIT → LORE_LOADED → ENGINE_READY → WORLD_LOADED → CONTAINERS_READY →
SYNC_STARTED → PROMPT_LOADED → AI_REQUESTED
```

Каждое состояние:
- Имеет чёткий входной контракт (что должно быть готово)
- Имеет таймаут
- Имеет error recovery (откат к предыдущему состоянию или fallback)
- Логирует переход

## Преимущества

1. Каждый путь тестируется отдельно
2. При зависании понятно, на каком шаге
3. Можно показать прогресс пользователю
4. Watchdog знает, на каком шаге произошла проблема
