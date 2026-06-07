#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// --- Локализуем тело showAiErrorModal ---
const startIdx = script.indexOf('function showAiErrorModal(');
assert.notStrictEqual(startIdx, -1, 'showAiErrorModal must be defined in script.js');

// Ищем баланс фигурных скобок, чтобы вырезать именно тело функции, а не весь остальной код.
function extractBalanced(source, openIdx) {
    let depth = 0;
    for (let i = openIdx; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return source.slice(openIdx, i + 1);
        }
    }
    throw new Error('Unbalanced braces while extracting showAiErrorModal');
}
const showAiErrorModal = extractBalanced(script, startIdx);

// --- Контракт 1: при isInitial === true кнопка "Повторить запрос" должна
//     сначала попытаться вызвать переданный onRetry. Полный сброс через
//     startNewGameSetup() допустим ТОЛЬКО как фолбэк, если onRetry не передан.
assert.match(
    showAiErrorModal,
    /aiErrorRetryBtn\.textContent\s*=\s*["']Повторить запрос["']/,
    'retry button text must be "Повторить запрос"'
);

assert.match(
    showAiErrorModal,
    /aiErrorRetryBtn\.onclick\s*=\s*\(\)\s*=>\s*\{[\s\S]*?closeAiErrorModal\(\)[\s\S]*?if\s*\(\s*isInitial\s*\)[\s\S]*?if\s*\(\s*typeof\s+onRetry\s*===\s*['"]function['"]\s*\)\s*\{[\s\S]*?onRetry\(\)[\s\S]*?\}\s*else\s*\{[\s\S]*?startNewGameSetup\(\)/,
    'isInitial branch must prefer onRetry() and only fall back to startNewGameSetup() when onRetry is missing'
);

// Контракт 2: cancel-кнопка при isInitial === true по-прежнему уводит в главное меню.
assert.match(
    showAiErrorModal,
    /aiErrorCancelBtn\.onclick\s*=\s*\(\)\s*=>\s*\{[\s\S]*?if\s*\(\s*isInitial\s*\)\s*\{[\s\S]*?exitToMainMenu\(\)/,
    'cancel button must still route isInitial flow to exitToMainMenu'
);

// --- Контракт 3: оба call-site'а с isInitial: true передают корректный onRetry.
// Ищем в sendApiRequest catch: после isInitialPrompt=..., retry шлёт promptTextForAI.
const directRetry = script.match(
    /showAiErrorModal\([\s\S]{0,1500}?,\s*isInitialPrompt,[\s\S]{0,1500}?sendApiRequest\(promptTextForAI/s
);
assert.ok(directRetry, 'sendApiRequest catch must pass onRetry → sendApiRequest(promptTextForAI, ...)');

// В runDeepSetupPipeline catch: after literal `true,`, retry re-runs the pipeline.
const deepSetupRetry = script.match(
    /showAiErrorModal\([\s\S]{0,1500}?,\s*true,[\s\S]{0,1500}?runDeepSetupPipeline\(narratorStyleGuide\)/s
);
assert.ok(deepSetupRetry, 'runDeepSetupPipeline catch must pass onRetry → runDeepSetupPipeline(narratorStyleGuide)');

// --- Контракт 4 (FIX #2): user-retry callback в sendApiRequest catch должен
//     слать promptTextForAI (тот же промпт, что был передан в sendApiRequest),
//     а НЕ lastUserMessageForRetry. Для первичной генерации мира
//     lastUserMessageForRetry равен null/стейл — отправка null в качестве
//     system prompt заставляет GM отвечать дефолтной нарративной заглушкой
//     без actions/time_passed/world setup.
assert.doesNotMatch(
    script,
    /sendApiRequest\(lastUserMessageForRetry,\s*isInitialPrompt/s,
    'user-retry callback must not send lastUserMessageForRetry for isInitial flow (would be null/stale)'
);

assert.match(
    script,
    /sendApiRequest\(promptTextForAI,\s*isInitialPrompt/s,
    'user-retry callback must send promptTextForAI (parameter) for isInitial flow'
);

// --- Контракт 5: внутренние time-retry уже используют promptTextForAI
//     (это правильное поведение, не должно регрессировать).
assert.match(
    script,
    /return sendApiRequest\(timeErrorPrompt,\s*isInitialPrompt/s,
    'time-retry path (INCOMPLETE_RESPONSE) must use timeErrorPrompt'
);

// --- Регистрация в npm test:unit ---
assert.match(
    pkg.scripts['test:unit'] || '',
    /tests\/ai_error_retry_button\.test\.js/,
    'npm run test:unit should include the ai error retry button test'
);

console.log('ai error retry button tests OK');

