@echo off
setlocal

REM ====== НАСТРОЙКИ OMNIROUTE ======

REM 1. Вставь сюда свой ключ OmniRoute
REM (Официальный SDK Anthropic использует ANTHROPIC_API_KEY)
set "ANTHROPIC_API_KEY=sk-69c3c436e2c9f412-9cc808-fbf4d128"

REM 2. Вставь сюда Anthropic-compatible endpoint OmniRoute
REM Пример: https://api.omniroute.ai/v1 или http://localhost:20128/v1
set "ANTHROPIC_BASE_URL=http://localhost:20128/v1"

REM 3. Опционально: если gateway не любит experimental betas (например, prompt caching)
set "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1"

REM 4. ПОДМЕНА МОДЕЛИ: укажи имя модели, которое ждет твой gateway
set "MY_CUSTOM_MODEL=gemini-cli/gemini-3.1-pro-preview"

REM 5. Автоматическое разрешение всех команд (без подтверждений)
set "DANGEROUSLY_SKIP_PERMISSIONS=--dangerously-skip-permissions"

REM ====== НАСТРОЙКА СИСТЕМНОГО ПРОМПТА ======

REM 6. Путь к файлу с системным промптом (контракт качества)
REM    Оставь пустым, чтобы не использовать
REM    Пример: set "SYSTEM_PROMPT_FILE=C:\prompts\contract.txt"
set "SYSTEM_PROMPT_FILE=system_prompt.txt"

REM =====================================================
echo =====================================================
echo Starting Claude Code via OmniRoute...
echo Endpoint: %ANTHROPIC_BASE_URL%
echo Model:    %MY_CUSTOM_MODEL%
echo Permissions: AUTO-APPROVE (--dangerously-skip-permissions)

REM Проверка и добавление системного промпта
set "SYSTEM_PROMPT_FLAG="
if not "%SYSTEM_PROMPT_FILE%"=="" (
    if exist "%SYSTEM_PROMPT_FILE%" (
        set "SYSTEM_PROMPT_FLAG=--system-prompt-file "%SYSTEM_PROMPT_FILE%""
        echo System Prompt: %SYSTEM_PROMPT_FILE%
    ) else (
        echo [WARNING] System prompt file not found: %SYSTEM_PROMPT_FILE%
        echo [WARNING] Starting WITHOUT custom system prompt.
    )
)
echo =====================================================
echo.

REM Запускаем Claude Code с принудительной моделью, авторазрешением и системным промптом
call claude --model %MY_CUSTOM_MODEL% %DANGEROUSLY_SKIP_PERMISSIONS% %SYSTEM_PROMPT_FLAG%

endlocal
pause