# Issue #002: State machine для запуска мира

**Severity:** HIGH
**Status:** FIXED
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

## Исправление (commit d014dce)

Реализован `WorldStartupPipeline` — state machine с явными переходами:

```
INIT → LORE_LOADED → ENGINE_READY → WORLD_LOADED →
CONTAINERS_READY → PROMPT_LOADED → AI_REQUESTED
```

- Каждый переход логируется с elapsed time
- Watchdog получает `pipelineState` + `pipelineHistory` при timeout
- `WorldStartupPipeline.updateLoadingText()` — централизованное обновление текста загрузки
