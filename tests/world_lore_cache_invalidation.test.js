#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');

// === Контракт 1: loadLore существует и доступен ===
const loadLoreIdx = script.indexOf('async function loadLore(');
assert.notStrictEqual(loadLoreIdx, -1, 'loadLore function must be defined');

// Извлекаем тело функции через подсчёт фигурных скобок (loadLore — обычная функция,
// тело ограничено первой парой сбалансированных {} после сигнатуры).
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
    throw new Error('Unbalanced braces');
}

const fnBody = extractBalanced(script, loadLoreIdx);

// === Контракт 2: loadLore объявляет helper invalidateSystemPromptCache ===
assert.match(
    fnBody,
    /invalidateSystemPromptCache\s*=/,
    'loadLore must declare a local invalidateSystemPromptCache helper'
);

// === Контракт 3: helper вызывает clearPromptCache ===
assert.match(
    fnBody,
    /invalidateSystemPromptCache[\s\S]{0,200}?clearPromptCache\s*\(/,
    'invalidateSystemPromptCache must call clearPromptCache()'
);

// === Контракт 4: helper вызывается на ВСЕХ путях, где worldLore меняется ===
//
// Проверяем что в теле loadLore есть >= 3 вызовов invalidateSystemPromptCache():
//   1) worldId-missing path (line ~7957)
//   2) total-conversion path (line ~7968)
//   3) success path (line ~7990)
//   4) catch path (line ~7999)
const callMatches = fnBody.match(/invalidateSystemPromptCache\s*\(\s*\)/g) || [];
assert.ok(
    callMatches.length >= 3,
    `loadLore must call invalidateSystemPromptCache() on every code path that mutates worldLore; got ${callMatches.length} calls (expected >= 3)`
);

// === Контракт 5: prepareUnifiedPrompt кэширует результат ===
// Гарантия что наш fix вообще релевантен: если кэша нет, инвалидация бесполезна.
assert.match(
    script,
    /GLOBAL_CACHED_SYSTEM_PROMPT\s*=/,
    'GLOBAL_CACHED_SYSTEM_PROMPT cache must exist (precondition for the fix to matter)'
);

// === Контракт 6: prepareUnifiedPrompt использует ${worldLore} в шаблоне ===
// Чтобы быть уверенными что в кэш действительно попадает lore, а не какой-то
// прокси-строки.
assert.match(
    script,
    /\$\{\s*worldLore\s*\}/,
    'prepareUnifiedPrompt template must interpolate ${worldLore} into the system prompt'
);

// === Контракт 7: clearPromptCache существует и это function declaration (hoisted) ===
// typeof-guard внутри loadLore зависит от того, что clearPromptCache — это
// hoisted function declaration, а не let/const (иначе typeof вернёт 'undefined'
// из-за TDZ и helper будет no-op).
const clearCacheDecl = script.match(/(?:function|const|let|var)\s+clearPromptCache\s*[=(]/);
assert.notStrictEqual(clearCacheDecl, null, 'clearPromptCache must be declared in script');
assert.match(
    clearCacheDecl[0],
    /^function\s/,
    'clearPromptCache must be a function declaration (hoisted) so typeof guard inside loadLore resolves to "function" at runtime'
);

// === Контракт 8: loadLore НЕ должен вызывать clearPromptCache напрямую ===
// Проверяем, что весь код идёт через helper, а не дублирует прямые вызовы.
// Допускаем, что helper сам по себе — это обёртка, и мы НЕ хотим прямые
// вызовы clearPromptCache() внутри loadLore (иначе helper бесполезен).
const directClearCallsInLoadLore = (fnBody.match(/clearPromptCache\s*\(/g) || []).length;
assert.ok(
    directClearCallsInLoadLore <= 1,
    `loadLore should route cache invalidation through invalidateSystemPromptCache helper; found ${directClearCallsInLoadLore} direct clearPromptCache() calls inside loadLore`
);

console.log('OK | worldLore cache invalidation contracts: all 8 checks passed');
