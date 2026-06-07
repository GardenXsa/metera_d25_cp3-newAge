#!/usr/bin/env node
'use strict';

// ---------------------------------------------------------------------------
// Minimal test framework
// ---------------------------------------------------------------------------
let PASS = 0;
let FAIL = 0;

function assert(condition, message) {
    if (condition) { PASS++; } else { FAIL++; console.log(`  FAIL: ${message}`); }
}

function assertEqual(actual, expected, message) {
    if (actual === expected) { PASS++; }
    else { FAIL++; console.log(`  FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

function assertDeepEqual(actual, expected, message) {
    if (JSON.stringify(actual) === JSON.stringify(expected)) { PASS++; }
    else { FAIL++; console.log(`  FAIL: ${message}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`); }
}

// ===================================================================
//  Replicate pure-logic functions from ModLoader.js
//  (ModLoader.js depends on `window`, `document`, Proxy, etc.
//   so we extract the testable logic here.)
// ===================================================================

// --- isObject (from ModLoader.js line 26) ---
function isObject(item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
}

// --- mergeDeep (from ModLoader.js line 9) ---
function mergeDeep(target, ...sources) {
    if (!sources.length) return target;
    const source = sources.shift();

    if (isObject(target) && isObject(source)) {
        for (const key in source) {
            if (isObject(source[key])) {
                if (!target[key]) Object.assign(target, { [key]: {} });
                mergeDeep(target[key], source[key]);
            } else {
                Object.assign(target, { [key]: source[key] });
            }
        }
    }
    return mergeDeep(target, ...sources);
}

// --- topologicalSort (from ModLoader.js ModLoader class line 1007) ---
function topologicalSort(adj) {
    const inDegree = new Map();
    const sorted = [];
    const queue = [];
    const nodes = Array.from(adj.keys());
    const reverseAdj = new Map(nodes.map(n => [n, []]));

    for (const node of nodes) inDegree.set(node, 0);

    for (const [node, dependencies] of adj.entries()) {
        for (const dep of dependencies) {
            if (inDegree.has(dep)) {
                inDegree.set(node, inDegree.get(node) + 1);
                if (reverseAdj.has(dep)) reverseAdj.get(dep).push(node);
            }
        }
    }

    for (const [node, degree] of inDegree.entries()) {
        if (degree === 0) queue.push(node);
    }

    while (queue.length > 0) {
        const node = queue.shift();
        sorted.push(node);
        const neighbors = reverseAdj.get(node) || [];
        for (const neighbor of neighbors) {
            inDegree.set(neighbor, inDegree.get(neighbor) - 1);
            if (inDegree.get(neighbor) === 0) queue.push(neighbor);
        }
    }

    if (sorted.length !== nodes.length) {
        const circular = nodes.filter(n => !sorted.includes(n));
        return { sorted: [], error: `Circular dependency detected! Check mods: ${circular.join(', ')}` };
    }

    return { sorted, error: null };
}

// --- DANGEROUS_PATTERNS (from ModLoader.js line 931) ---
const DANGEROUS_PATTERNS = [
    { pattern: /\beval\s*\(/, desc: 'eval() call' },
    { pattern: /\bFunction\s*\(/, desc: 'Function() constructor call' },
    { pattern: /\bAsyncFunction\s*\(/, desc: 'AsyncFunction() constructor call' },
    { pattern: /\bGeneratorFunction\s*\(/, desc: 'GeneratorFunction() constructor call' },
    { pattern: /\bimport\s*\(/, desc: 'dynamic import() — use ModAPI.require instead' },
    { pattern: /\brequire\s*\(/, desc: 'require() — use ModAPI.require instead' },
    { pattern: /\bprocess\s*\./, desc: 'process global access' },
    { pattern: /\bchild_process\b/, desc: 'child_process module reference' },
    { pattern: /\bfs\s*\.\s*(read|write|append|open|unlink|rmdir|mkdir|rename)/, desc: 'fs direct file access' },
    { pattern: /\b__proto__\b/, desc: '__proto__ access — prototype pollution risk' },
];

function scanCodeForDangerousPatterns(code) {
    for (const check of DANGEROUS_PATTERNS) {
        if (check.pattern.test(code)) {
            return { safe: false, desc: check.desc };
        }
    }
    return { safe: true, desc: null };
}

// --- hookFunction (modeled after ModAPI.patchFunction + hook chain pattern) ---
// This implements a hook-chain system where:
// - Registering a hook wraps the original function
// - Multiple hooks with different priorities execute in order (lower = first)
// - Unhook removes a specific mod's hooks
function createHookableFunction(originalFn) {
    const hooks = []; // { modId, priority, fn }

    function dispatch(...args) {
        let result = originalFn(...args);
        // Sort hooks by priority ascending (lower number = runs first)
        const sorted = [...hooks].sort((a, b) => a.priority - b.priority);
        for (const hook of sorted) {
            result = hook.fn(result, ...args);
        }
        return result;
    }

    dispatch.hookFunction = function(modId, priority, hookFn) {
        hooks.push({ modId, priority, fn: hookFn });
    };

    dispatch.unhook = function(modId) {
        const before = hooks.length;
        for (let i = hooks.length - 1; i >= 0; i--) {
            if (hooks[i].modId === modId) hooks.splice(i, 1);
        }
        return before - hooks.length; // number of hooks removed
    };

    dispatch.getHookCount = function() {
        return hooks.length;
    };

    return dispatch;
}

// ===================================================================
//  1. isObject utility
// ===================================================================
console.log('\n=== 1. isObject utility ===');

(function testIsObject() {
    assert(isObject({}) === true, 'isObject returns true for plain object');
    assert(isObject({ a: 1, b: 'hi' }) === true, 'isObject returns true for non-empty plain object');
    assert(isObject(Object.create(null)) === true, 'isObject returns true for null-prototype object');
    assert(!isObject(null), 'isObject returns falsy for null');
    assert(isObject([]) === false, 'isObject returns false for array');
    assert(isObject([1, 2, 3]) === false, 'isObject returns false for non-empty array');
    assert(isObject('string') === false, 'isObject returns false for string');
    assert(!isObject(''), 'isObject returns falsy for empty string');
    assert(isObject(42) === false, 'isObject returns false for number');
    assert(!isObject(0), 'isObject returns falsy for zero');
    assert(!isObject(undefined), 'isObject returns falsy for undefined');
    assert(isObject(true) === false, 'isObject returns false for boolean true');
    assert(isObject(function(){}) === false, 'isObject returns false for function');
})();

// ===================================================================
//  2. mergeDeep utility
// ===================================================================
console.log('\n=== 2. mergeDeep utility ===');

(function testMergeDeep() {
    // -- Merges nested objects --
    (function testNestedMerge() {
        const target = { a: { x: 1 }, b: 2 };
        const source = { a: { y: 3 } };
        const result = mergeDeep(target, source);
        assert(result.a.x === 1, 'mergeDeep preserves existing nested key');
        assert(result.a.y === 3, 'mergeDeep adds new nested key');
        assert(result.b === 2, 'mergeDeep preserves sibling keys');
    })();

    // -- Overwrites primitive values --
    (function testPrimitiveOverwrite() {
        const target = { a: 1, b: 'hello', c: true };
        const source = { a: 42, b: 'world', c: false };
        const result = mergeDeep(target, source);
        assertEqual(result.a, 42, 'mergeDeep overwrites number');
        assertEqual(result.b, 'world', 'mergeDeep overwrites string');
        assertEqual(result.c, false, 'mergeDeep overwrites boolean');
    })();

    // -- Handles arrays (replaces, not concatenates) --
    (function testArrayReplace() {
        const target = { items: [1, 2, 3] };
        const source = { items: [4, 5] };
        const result = mergeDeep(target, source);
        assert(Array.isArray(result.items), 'mergeDeep result items is an array');
        assertEqual(result.items.length, 2, 'mergeDeep replaces array (does not concatenate)');
        assertEqual(result.items[0], 4, 'mergeDeep replaced array first element');
        assertEqual(result.items[1], 5, 'mergeDeep replaced array second element');
    })();

    // -- Returns target when no sources --
    (function testNoSources() {
        const target = { a: 1 };
        const result = mergeDeep(target);
        assert(result === target, 'mergeDeep returns target when no sources');
        assertEqual(result.a, 1, 'mergeDeep target unchanged when no sources');
    })();

    // -- Deep merge with multiple levels --
    (function testDeepNested() {
        const target = { level1: { level2: { level3: 'original', kept: true } } };
        const source = { level1: { level2: { level3: 'updated' } } };
        const result = mergeDeep(target, source);
        assertEqual(result.level1.level2.level3, 'updated', 'mergeDeep updates deeply nested value');
        assert(result.level1.level2.kept === true, 'mergeDeep preserves deeply nested sibling');
    })();

    // -- Multiple sources --
    (function testMultipleSources() {
        const target = { a: 1 };
        const s1 = { b: 2 };
        const s2 = { c: 3 };
        const result = mergeDeep(target, s1, s2);
        assertEqual(result.a, 1, 'mergeDeep with multiple sources: target key preserved');
        assertEqual(result.b, 2, 'mergeDeep with multiple sources: first source key');
        assertEqual(result.c, 3, 'mergeDeep with multiple sources: second source key');
    })();

    // -- Merging object into primitive key: mergeDeep does NOT replace --
    //    When target[key] is a truthy primitive and source[key] is an object,
    //    the !target[key] check fails (truthy), so mergeDeep tries to recurse
    //    into the primitive, which is a no-op (isObject('string') === false).
    //    The primitive value is left unchanged.
    (function testObjectOverPrimitiveIsNoOp() {
        const target = { config: 'simple' };
        const source = { config: { detailed: true } };
        const result = mergeDeep(target, source);
        assertEqual(result.config, 'simple', 'mergeDeep leaves truthy primitive unchanged when source is object');
    })();

    // -- Merging object into falsy key creates nested structure --
    (function testObjectOverFalsy() {
        const target = { config: 0 };
        const source = { config: { detailed: true } };
        const result = mergeDeep(target, source);
        assert(isObject(result.config), 'mergeDeep creates object over falsy value');
        assertEqual(result.config.detailed, true, 'mergeDeep new object has source key');
    })();
})();

// ===================================================================
//  3. topologicalSort
// ===================================================================
console.log('\n=== 3. topologicalSort ===');

(function testTopologicalSort() {
    // -- Linear chain: A→B→C means C loads first --
    (function testLinearChain() {
        const adj = new Map([
            ['A', ['B']],
            ['B', ['C']],
            ['C', []],
        ]);
        const { sorted, error } = topologicalSort(adj);
        assert(error === null, 'linear chain: no error');
        assertEqual(sorted.length, 3, 'linear chain: all 3 mods sorted');
        // C must come before B, B must come before A
        assert(sorted.indexOf('C') < sorted.indexOf('B'), 'linear chain: C before B');
        assert(sorted.indexOf('B') < sorted.indexOf('A'), 'linear chain: B before A');
    })();

    // -- Circular dependency detected --
    (function testCircular() {
        const adj = new Map([
            ['A', ['B']],
            ['B', ['C']],
            ['C', ['A']],
        ]);
        const { sorted, error } = topologicalSort(adj);
        assert(error !== null, 'circular: error is returned');
        assertEqual(sorted.length, 0, 'circular: sorted array is empty');
    })();

    // -- Independent mods (no dependencies) --
    (function testIndependent() {
        const adj = new Map([
            ['X', []],
            ['Y', []],
            ['Z', []],
        ]);
        const { sorted, error } = topologicalSort(adj);
        assert(error === null, 'independent: no error');
        assertEqual(sorted.length, 3, 'independent: all 3 mods sorted');
        // All present
        assert(sorted.includes('X'), 'independent: X in result');
        assert(sorted.includes('Y'), 'independent: Y in result');
        assert(sorted.includes('Z'), 'independent: Z in result');
    })();

    // -- Diamond dependency: A depends on B,C; B and C depend on D --
    (function testDiamond() {
        const adj = new Map([
            ['A', ['B', 'C']],
            ['B', ['D']],
            ['C', ['D']],
            ['D', []],
        ]);
        const { sorted, error } = topologicalSort(adj);
        assert(error === null, 'diamond: no error');
        assertEqual(sorted.length, 4, 'diamond: all 4 mods sorted');
        // D must come before B and C; B and C must come before A
        assert(sorted.indexOf('D') < sorted.indexOf('B'), 'diamond: D before B');
        assert(sorted.indexOf('D') < sorted.indexOf('C'), 'diamond: D before C');
        assert(sorted.indexOf('B') < sorted.indexOf('A'), 'diamond: B before A');
        assert(sorted.indexOf('C') < sorted.indexOf('A'), 'diamond: C before A');
    })();

    // -- Single mod with no dependencies --
    (function testSingleMod() {
        const adj = new Map([
            ['solo', []],
        ]);
        const { sorted, error } = topologicalSort(adj);
        assert(error === null, 'single mod: no error');
        assertDeepEqual(sorted, ['solo'], 'single mod: sorted is [solo]');
    })();

    // -- Missing dependency (dep not in graph) is ignored --
    (function testMissingDep() {
        const adj = new Map([
            ['A', ['nonexistent']],
            ['B', []],
        ]);
        const { sorted, error } = topologicalSort(adj);
        assert(error === null, 'missing dep: no error');
        assertEqual(sorted.length, 2, 'missing dep: all present mods sorted');
        assert(sorted.includes('A'), 'missing dep: A in result');
        assert(sorted.includes('B'), 'missing dep: B in result');
    })();

    // -- Self-dependency (circular) --
    (function testSelfDependency() {
        const adj = new Map([
            ['A', ['A']],
        ]);
        const { sorted, error } = topologicalSort(adj);
        assert(error !== null, 'self-dep: error is returned');
        assertEqual(sorted.length, 0, 'self-dep: sorted is empty');
    })();
})();

// ===================================================================
//  4. DANGEROUS_PATTERNS code scanner
// ===================================================================
console.log('\n=== 4. DANGEROUS_PATTERNS code scanner ===');

(function testDangerousPatterns() {
    // -- Rejects eval() --
    (function testEval() {
        const result = scanCodeForDangerousPatterns('const x = eval("2+2");');
        assert(result.safe === false, 'rejects eval()');
        assert(result.desc.includes('eval'), 'eval pattern description mentions eval');
    })();

    // -- Rejects Function() --
    (function testFunction() {
        const result = scanCodeForDangerousPatterns('const f = new Function("return 1");');
        assert(result.safe === false, 'rejects Function()');
        assert(result.desc.includes('Function'), 'Function pattern description mentions Function');
    })();

    // -- Rejects import() --
    (function testImport() {
        const result = scanCodeForDangerousPatterns('const mod = import("fs");');
        assert(result.safe === false, 'rejects import()');
        assert(result.desc.includes('import'), 'import pattern description mentions import');
    })();

    // -- Rejects require() --
    (function testRequire() {
        const result = scanCodeForDangerousPatterns('const fs = require("fs");');
        assert(result.safe === false, 'rejects require()');
        assert(result.desc.includes('require'), 'require pattern description mentions require');
    })();

    // -- Rejects process. --
    (function testProcess() {
        const result = scanCodeForDangerousPatterns('const env = process.env;');
        assert(result.safe === false, 'rejects process.');
        assert(result.desc.includes('process'), 'process pattern description mentions process');
    })();

    // -- Rejects __proto__ --
    (function testProto() {
        const result = scanCodeForDangerousPatterns('obj.__proto__ = malicious;');
        assert(result.safe === false, 'rejects __proto__');
        assert(result.desc.includes('__proto__'), '__proto__ pattern description mentions __proto__');
    })();

    // -- Rejects AsyncFunction() --
    (function testAsyncFunction() {
        const result = scanCodeForDangerousPatterns('const af = new AsyncFunction("return 1");');
        assert(result.safe === false, 'rejects AsyncFunction()');
    })();

    // -- Rejects child_process --
    (function testChildProcess() {
        const result = scanCodeForDangerousPatterns('const cp = child_process;');
        assert(result.safe === false, 'rejects child_process');
    })();

    // -- Rejects fs direct file access --
    (function testFsAccess() {
        const result = scanCodeForDangerousPatterns('fs.readFile("secret.txt");');
        assert(result.safe === false, 'rejects fs.readFile');
    })();

    // -- Allows safe code --
    (function testSafeCode() {
        const safeCodes = [
            'ModAPI.on("tick", () => { console.log("hello"); });',
            'const x = { a: 1, b: 2 }; ModAPI.addCommand("test", () => x);',
            'player.hp = 100;',
            'function greet(name) { return "Hello " + name; }',
            'const arr = [1, 2, 3].map(n => n * 2);',
            'window.updateCharacterSheet();',
        ];
        for (const code of safeCodes) {
            const result = scanCodeForDangerousPatterns(code);
            assert(result.safe === true, `safe code passes: ${code.substring(0, 40)}...`);
        }
    })();

    // -- Does not false-positive on "eval" in variable name --
    //    Note: \beval\s*\(/ requires eval followed by (, so "evaluate("
    //    should NOT match because \b before eval matches, but "evaluate"
    //    has no word boundary between "eval" and "uate"
    (function testNoFalsePositive() {
        const result = scanCodeForDangerousPatterns('function evaluate(x) { return x + 1; }');
        // "evaluate(" — the \b is before "evaluate", and "eval" is followed by "uate",
        // so \beval\s*\( should NOT match "evaluate("
        // Actually let's check: /\beval\s*\(/.test("evaluate(") 
        // \b matches at start of word, "eval" matches "eval" in "evaluate",
        // but then \s* needs whitespace or nothing, then \(, but after "eval"
        // comes "uate(" — so the regex won't match "eval" + "(" since "uate" is in between.
        // However, \beval matches the first 4 chars of "evaluate", then \s*\( fails.
        // So this should be safe.
        assert(result.safe === true, 'no false positive on evaluate()');
    })();

    // -- Does not false-positive on "process" as substring --
    (function testProcessFalsePositive() {
        // "process" without a dot after it should be fine
        // But /\bprocess\s*\./ only triggers if followed by .
        const result = scanCodeForDangerousPatterns('const processing = true;');
        assert(result.safe === true, 'no false positive on "processing"');
    })();
})();

// ===================================================================
//  5. hookFunction — hook chain system
// ===================================================================
console.log('\n=== 5. hookFunction — hook chain system ===');

(function testHookFunction() {
    // -- Registering a hook wraps the original function --
    (function testBasicHook() {
        let called = 0;
        const original = (x) => { called++; return x * 2; };
        const hooked = createHookableFunction(original);

        // Without hooks, behaves like original
        const result = hooked(5);
        assertEqual(result, 10, 'hook without modifiers returns original result');
        assertEqual(called, 1, 'original function was called');

        // With a hook that modifies the result
        hooked.hookFunction('mod_a', 10, (result, ...args) => result + 1);
        const result2 = hooked(5);
        assertEqual(result2, 11, 'hook adds 1 to original result (10+1)');
    })();

    // -- Multiple hooks with different priorities execute in order --
    (function testPriorityOrder() {
        const original = (x) => x;
        const hooked = createHookableFunction(original);

        // Hook with priority 20 runs second
        hooked.hookFunction('mod_second', 20, (result) => result + ' second');
        // Hook with priority 5 runs first
        hooked.hookFunction('mod_first', 5, (result) => result + ' first');
        // Hook with priority 10 runs middle
        hooked.hookFunction('mod_mid', 10, (result) => result + ' mid');

        const result = hooked('start');
        assertEqual(result, 'start first mid second', 'hooks execute in priority order');
    })();

    // -- Unhook removes specific mod's hooks --
    (function testUnhook() {
        const original = (x) => x;
        const hooked = createHookableFunction(original);

        hooked.hookFunction('mod_a', 10, (result) => result + '_a');
        hooked.hookFunction('mod_b', 20, (result) => result + '_b');
        hooked.hookFunction('mod_a', 30, (result) => result + '_a2');

        assertEqual(hooked.getHookCount(), 3, '3 hooks registered');

        const removed = hooked.unhook('mod_a');
        assertEqual(removed, 2, 'unhook removed 2 hooks for mod_a');
        assertEqual(hooked.getHookCount(), 1, '1 hook remaining after unhook');

        const result = hooked('base');
        assertEqual(result, 'base_b', 'only mod_b hook runs after unhooking mod_a');
    })();

    // -- Unhook non-existent mod is a no-op --
    (function testUnhookNonExistent() {
        const original = (x) => x;
        const hooked = createHookableFunction(original);
        hooked.hookFunction('mod_a', 10, (result) => result + '_a');

        const removed = hooked.unhook('nonexistent');
        assertEqual(removed, 0, 'unhook returns 0 for non-existent mod');
        assertEqual(hooked.getHookCount(), 1, 'hook count unchanged for non-existent unhook');
    })();

    // -- Hook receives original arguments --
    (function testHookReceivesArgs() {
        const original = (a, b) => a + b;
        const hooked = createHookableFunction(original);

        let capturedArgs = null;
        hooked.hookFunction('spy', 10, (result, ...args) => {
            capturedArgs = args;
            return result;
        });

        const result = hooked(3, 7);
        assertEqual(result, 10, 'hook receives correct result');
        assert(capturedArgs !== null, 'hook callback was called');
        assertEqual(capturedArgs[0], 3, 'hook received first arg');
        assertEqual(capturedArgs[1], 7, 'hook received second arg');
    })();

    // -- Hook can transform result completely --
    (function testHookTransformsResult() {
        const original = () => 'original';
        const hooked = createHookableFunction(original);

        hooked.hookFunction('transformer', 10, () => 'transformed');
        const result = hooked();
        assertEqual(result, 'transformed', 'hook can completely transform the result');
    })();

    // -- Empty hook list acts as passthrough --
    (function testNoHooks() {
        const original = (x) => x * 3;
        const hooked = createHookableFunction(original);
        assertEqual(hooked.getHookCount(), 0, 'no hooks registered');

        const result = hooked(4);
        assertEqual(result, 12, 'no hooks: original function result returned');
    })();
})();

// ===================================================================
//  Results
// ===================================================================
console.log(`\nResults: ${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) process.exit(1);
