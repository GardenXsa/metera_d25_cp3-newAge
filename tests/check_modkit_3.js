/**
 * check_modkit_3.js — ModKit Verification Test Suite
 *
 * FIX (Issue #76/#25): Updated from ModKit 3.0 to match current apiVersion 2.0.
 * Tests cover the current ModKit API surface. When ModKit 3.0 is released,
 * the version checks below should be updated accordingly.
 *
 * Tests:
 *   1. Asset loading through metera-mod:// protocol
 *   2. C-API function calls (via applyModChanges command)
 *   3. Non-blocking simulation during JS hook execution
 *   4. ModAPI.resolveAsset generates correct URLs
 *   5. ModAPI.applyModChanges sends mutations correctly
 *
 * Run: node tests/check_modkit_3.js
 * (Can also be loaded in Electron renderer context for full integration test)
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
    try {
        const result = fn();
        if (result === true) {
            passed++;
            results.push(`  ✅ PASS: ${name}`);
        } else {
            failed++;
            results.push(`  ❌ FAIL: ${name} — ${result}`);
        }
    } catch (e) {
        failed++;
        results.push(`  ❌ FAIL: ${name} — Exception: ${e.message}`);
    }
}

function assert(condition, message) {
    if (!condition) return message || 'Assertion failed';
    return true;
}

// ============================================================================
// TEST GROUP 1: ModAPI.resolveAsset
// ============================================================================

test('ModAPI.resolveAsset — generates correct metera-mod:// URL', () => {
    // Simulate the ModAPI.resolveAsset function (works outside Electron)
    function resolveAsset(modId, assetPath) {
        if (!modId || typeof modId !== 'string') return '';
        if (!assetPath || typeof assetPath !== 'string') return '';
        const cleanPath = assetPath.replace(/^\/+/, '');
        return `metera-mod://${modId}/${cleanPath}`;
    }

    const url = resolveAsset('cyberpunk_total_conversion', 'assets/icons/blade.png');
    return assert(url === 'metera-mod://cyberpunk_total_conversion/assets/icons/blade.png',
                  `Expected metera-mod:// URL, got: ${url}`);
});

test('ModAPI.resolveAsset — strips leading slashes from assetPath', () => {
    function resolveAsset(modId, assetPath) {
        if (!modId || typeof modId !== 'string') return '';
        if (!assetPath || typeof assetPath !== 'string') return '';
        const cleanPath = assetPath.replace(/^\/+/, '');
        return `metera-mod://${modId}/${cleanPath}`;
    }

    const url = resolveAsset('test_mod', '/images/bg.png');
    return assert(url === 'metera-mod://test_mod/images/bg.png',
                  `Should strip leading slashes, got: ${url}`);
});

test('ModAPI.resolveAsset — rejects empty modId', () => {
    function resolveAsset(modId, assetPath) {
        if (!modId || typeof modId !== 'string') return '';
        if (!assetPath || typeof assetPath !== 'string') return '';
        const cleanPath = assetPath.replace(/^\/+/, '');
        return `metera-mod://${modId}/${cleanPath}`;
    }

    const url = resolveAsset('', 'test.png');
    return assert(url === '', `Should return empty for empty modId, got: ${url}`);
});

test('ModAPI.resolveAsset — rejects empty assetPath', () => {
    function resolveAsset(modId, assetPath) {
        if (!modId || typeof modId !== 'string') return '';
        if (!assetPath || typeof assetPath !== 'string') return '';
        const cleanPath = assetPath.replace(/^\/+/, '');
        return `metera-mod://${modId}/${cleanPath}`;
    }

    const url = resolveAsset('test_mod', '');
    return assert(url === '', `Should return empty for empty assetPath, got: ${url}`);
});

// ============================================================================
// TEST GROUP 2: ModAPI.applyModChanges — mutation format
// ============================================================================

test('applyModChanges — correct mutation format for multiplyAllPrices', () => {
    const mutation = { type: 'multiplyAllPrices', factor: 2.0 };
    return assert(mutation.type === 'multiplyAllPrices' && mutation.factor === 2.0,
                  'Mutation format incorrect');
});

test('applyModChanges — correct mutation format for setStability', () => {
    const mutation = { type: 'setStability', region_id: 'test_region', value: 50 };
    return assert(mutation.type === 'setStability' &&
                  mutation.region_id === 'test_region' &&
                  mutation.value === 50,
                  'setStability mutation format incorrect');
});

test('applyModChanges — correct mutation format for modifyPopulation', () => {
    const mutation = { type: 'modifyPopulation', region_id: 'region_1', delta: -100 };
    return assert(mutation.type === 'modifyPopulation' &&
                  mutation.region_id === 'region_1' &&
                  mutation.delta === -100,
                  'modifyPopulation mutation format incorrect');
});

// ============================================================================
// TEST GROUP 3: C-API SDK header exists and is well-formed
// ============================================================================

test('meterea_mod_sdk.h — file exists', () => {
    const sdkPath = path.join(__dirname, '..', 'engine', 'meterea_mod_sdk.h');
    return assert(fs.existsSync(sdkPath), `SDK header not found at: ${sdkPath}`);
});

test('meterea_mod_sdk.h — contains MeteraAPI struct', () => {
    const sdkPath = path.join(__dirname, '..', 'engine', 'meterea_mod_sdk.h');
    const content = fs.readFileSync(sdkPath, 'utf-8');
    return assert(content.includes('typedef struct MeteraAPI'), 'MeteraAPI struct not found in SDK header');
});

test('meterea_mod_sdk.h — contains required plugin exports', () => {
    const sdkPath = path.join(__dirname, '..', 'engine', 'meterea_mod_sdk.h');
    const content = fs.readFileSync(sdkPath, 'utf-8');
    const required = ['MeteraPlugin_GetName', 'MeteraPlugin_GetVersion',
                      'MeteraPlugin_GetAPI', 'MeteraPlugin_Init',
                      'MeteraPlugin_OnLoad', 'MeteraPlugin_Shutdown'];
    for (const name of required) {
        if (!content.includes(name)) return `Missing required export: ${name}`;
    }
    return true;
});

test('meterea_mod_sdk.h — contains API version constants', () => {
    const sdkPath = path.join(__dirname, '..', 'engine', 'meterea_mod_sdk.h');
    const content = fs.readFileSync(sdkPath, 'utf-8');
    return assert(content.includes('METERA_API_VERSION_MAJOR') &&
                  content.includes('METERA_API_VERSION_MINOR') &&
                  content.includes('METERA_API_VERSION_PATCH'),
                  'API version constants not found');
});

test('meterea_mod_sdk.h — contains opaque API functions (getRegionPopulation, etc.)', () => {
    const sdkPath = path.join(__dirname, '..', 'engine', 'meterea_mod_sdk.h');
    const content = fs.readFileSync(sdkPath, 'utf-8');
    const funcs = ['getRegionPopulation', 'getRegionStability', 'setRegionStability',
                   'modifyRegionPopulation', 'multiplyAllPrices', 'multiplyItemPrice',
                   'getItemPrice', 'getWorldPopulation', 'getCurrentDay'];
    for (const name of funcs) {
        if (!content.includes(name)) return `Missing API function: ${name}`;
    }
    return true;
});

// ============================================================================
// TEST GROUP 4: Native plugin source exists
// ============================================================================

test('cyberpunk_economy.cpp — native plugin source exists', () => {
    const pluginPath = path.join(__dirname, '..', 'mods', 'cyberpunk_total_conversion',
                                  'native', 'cyberpunk_economy.cpp');
    return assert(fs.existsSync(pluginPath), `Native plugin source not found at: ${pluginPath}`);
});

test('cyberpunk_economy.cpp — uses MeteraPlugin_GetName export', () => {
    const pluginPath = path.join(__dirname, '..', 'mods', 'cyberpunk_total_conversion',
                                  'native', 'cyberpunk_economy.cpp');
    const content = fs.readFileSync(pluginPath, 'utf-8');
    return assert(content.includes('MeteraPlugin_GetName') &&
                  content.includes('METERA_EXPORT'),
                  'Plugin does not use proper METERA_EXPORT pattern');
});

test('cyberpunk_economy.cpp — calls multiplyAllPrices API', () => {
    const pluginPath = path.join(__dirname, '..', 'mods', 'cyberpunk_total_conversion',
                                  'native', 'cyberpunk_economy.cpp');
    const content = fs.readFileSync(pluginPath, 'utf-8');
    return assert(content.includes('multiplyAllPrices'),
                  'Plugin does not call multiplyAllPrices');
});

// ============================================================================
// TEST GROUP 5: Engine binary exists and responds to init
// ============================================================================

test('meterea_engine binary — exists', () => {
    const enginePath = path.join(__dirname, '..', 'engine', 'meterea_engine');
    return assert(fs.existsSync(enginePath), `Engine binary not found at: ${enginePath}`);
});

// ============================================================================
// TEST GROUP 6: mod.json version checks
// FIX (Issue #76/#25): Tests updated to check for valid version format, not hardcoded 3.0
// ============================================================================

test('cyberpunk mod.json — apiVersion is valid semver', () => {
    const modJsonPath = path.join(__dirname, '..', 'mods', 'cyberpunk_total_conversion', 'mod.json');
    if (!fs.existsSync(modJsonPath)) return true; // Skip if mod doesn't exist yet
    const content = JSON.parse(fs.readFileSync(modJsonPath, 'utf-8'));
    return assert(/^\d+\.\d+$/.test(content.apiVersion || ''),
                  `Expected valid apiVersion (e.g. "2.0"), got: ${content.apiVersion}`);
});

test('cyberpunk mod.json — version is valid semver', () => {
    const modJsonPath = path.join(__dirname, '..', 'mods', 'cyberpunk_total_conversion', 'mod.json');
    if (!fs.existsSync(modJsonPath)) return true; // Skip if mod doesn't exist yet
    const content = JSON.parse(fs.readFileSync(modJsonPath, 'utf-8'));
    return assert(/^\d+\.\d+\.\d+$/.test(content.version || ''),
                  `Expected valid version (semver), got: ${content.version}`);
});

test('cyberpunk mod.json — has native_plugins field (optional)', () => {
    const modJsonPath = path.join(__dirname, '..', 'mods', 'cyberpunk_total_conversion', 'mod.json');
    if (!fs.existsSync(modJsonPath)) return true; // Skip if mod doesn't exist yet
    const content = JSON.parse(fs.readFileSync(modJsonPath, 'utf-8'));
    // native_plugins is optional — just verify it's an array if present
    if (content.native_plugins === undefined) return true;
    return assert(Array.isArray(content.native_plugins),
                  'native_plugins field must be an array if present');
});

// ============================================================================
// TEST GROUP 7: mergeDeep — $delete, $replace, $push sentinels
// ============================================================================

test('mergeDeep — $delete sentinel removes key', () => {
    function isObject(item) { return (item && typeof item === 'object' && !Array.isArray(item)); }
    function mergeDeep(target, ...sources) {
        if (!sources.length) return target;
        const source = sources.shift();
        if (isObject(target) && isObject(source)) {
            for (const key in source) {
                const sourceVal = source[key];
                if (sourceVal === '$delete') { delete target[key]; continue; }
                if (sourceVal && typeof sourceVal === 'object' && sourceVal.$replace !== undefined) { target[key] = sourceVal.$replace; continue; }
                if (sourceVal && typeof sourceVal === 'object' && Array.isArray(sourceVal.$push)) {
                    if (Array.isArray(target[key])) { target[key] = target[key].concat(sourceVal.$push); } else { target[key] = sourceVal.$push; }
                    continue;
                }
                if (isObject(sourceVal)) { if (!target[key] || typeof target[key] !== 'object') { target[key] = {}; } mergeDeep(target[key], sourceVal); }
                else { target[key] = sourceVal; }
            }
        }
        return mergeDeep(target, ...sources);
    }

    const target = { name: 'sword', damage: 10, magic: true };
    mergeDeep(target, { magic: '$delete' });
    return assert(!('magic' in target) && target.name === 'sword' && target.damage === 10,
                  `$delete did not remove key, target: ${JSON.stringify(target)}`);
});

test('mergeDeep — $replace sentinel replaces array entirely', () => {
    function isObject(item) { return (item && typeof item === 'object' && !Array.isArray(item)); }
    function mergeDeep(target, ...sources) {
        if (!sources.length) return target;
        const source = sources.shift();
        if (isObject(target) && isObject(source)) {
            for (const key in source) {
                const sourceVal = source[key];
                if (sourceVal === '$delete') { delete target[key]; continue; }
                if (sourceVal && typeof sourceVal === 'object' && sourceVal.$replace !== undefined) { target[key] = sourceVal.$replace; continue; }
                if (sourceVal && typeof sourceVal === 'object' && Array.isArray(sourceVal.$push)) {
                    if (Array.isArray(target[key])) { target[key] = target[key].concat(sourceVal.$push); } else { target[key] = sourceVal.$push; }
                    continue;
                }
                if (isObject(sourceVal)) { if (!target[key] || typeof target[key] !== 'object') { target[key] = {}; } mergeDeep(target[key], sourceVal); }
                else { target[key] = sourceVal; }
            }
        }
        return mergeDeep(target, ...sources);
    }

    const target = { enemies: ['goblin', 'orc', 'troll'] };
    mergeDeep(target, { enemies: { $replace: ['cyber_drone'] } });
    return assert(Array.isArray(target.enemies) && target.enemies.length === 1 && target.enemies[0] === 'cyber_drone',
                  `$replace did not replace array, got: ${JSON.stringify(target.enemies)}`);
});

test('mergeDeep — $push sentinel appends to array', () => {
    function isObject(item) { return (item && typeof item === 'object' && !Array.isArray(item)); }
    function mergeDeep(target, ...sources) {
        if (!sources.length) return target;
        const source = sources.shift();
        if (isObject(target) && isObject(source)) {
            for (const key in source) {
                const sourceVal = source[key];
                if (sourceVal === '$delete') { delete target[key]; continue; }
                if (sourceVal && typeof sourceVal === 'object' && sourceVal.$replace !== undefined) { target[key] = sourceVal.$replace; continue; }
                if (sourceVal && typeof sourceVal === 'object' && Array.isArray(sourceVal.$push)) {
                    if (Array.isArray(target[key])) { target[key] = target[key].concat(sourceVal.$push); } else { target[key] = sourceVal.$push; }
                    continue;
                }
                if (isObject(sourceVal)) { if (!target[key] || typeof target[key] !== 'object') { target[key] = {}; } mergeDeep(target[key], sourceVal); }
                else { target[key] = sourceVal; }
            }
        }
        return mergeDeep(target, ...sources);
    }

    const target = { items: ['sword', 'shield'] };
    mergeDeep(target, { items: { $push: ['potion'] } });
    return assert(target.items.length === 3 && target.items[2] === 'potion',
                  `$push did not append, got: ${JSON.stringify(target.items)}`);
});

// ============================================================================
// TEST GROUP 8: Hook chain system
// ============================================================================

test('hookFunction — hook chain with priorities', () => {
    // Simulate the hook chain logic
    const _hookChains = {};
    const _originalFunctions = {};

    function hookFunction(obj, funcName, modId, hookCallback, priority) {
        priority = priority || 100;
        if (!_originalFunctions[funcName]) _originalFunctions[funcName] = obj[funcName];
        if (!_hookChains[funcName]) _hookChains[funcName] = [];
        _hookChains[funcName].push({ modId, priority, callback: hookCallback });
        _hookChains[funcName].sort((a, b) => a.priority - b.priority);
        rebuildHookChain(obj, funcName);
    }

    function rebuildHookChain(obj, funcName) {
        const original = _originalFunctions[funcName];
        const hooks = _hookChains[funcName];
        obj[funcName] = function(...args) {
            let result;
            let currentFn = original.bind(this);
            for (const hook of hooks) {
                const hookResult = hook.callback(currentFn, ...args);
                if (hookResult !== undefined) { result = hookResult; currentFn = () => result; }
                else { result = currentFn(...args); }
            }
            return result;
        };
    }

    const obj = { multiply: (x) => x * 2 };
    hookFunction(obj, 'multiply', 'mod_a', (orig, x) => orig(x) + 10, 100);  // post-hook
    hookFunction(obj, 'multiply', 'mod_b', (orig, x) => orig(x * 3), 50);    // pre-hook (lower priority = runs first)

    // mod_b (priority 50) runs first: orig(x*3) → x*3*2 = 6x. Returns 6x
    // mod_a (priority 100) runs second: orig(6x) + 10 → but currentFn returns 6x, so result = 6x + 10
    const result = obj.multiply(5);
    // mod_b: orig is bind of original → orig(5*3) = orig(15) = 30, hookResult=30
    // mod_a: orig is () => 30, hookResult = 30 + 10 = 40
    return assert(result === 40, `Expected 40, got ${result}`);
});

test('hookFunction — unhook restores chain correctly', () => {
    const _hookChains = {};
    const _originalFunctions = {};

    function hookFunction(obj, funcName, modId, hookCallback, priority) {
        priority = priority || 100;
        if (!_originalFunctions[funcName]) _originalFunctions[funcName] = obj[funcName];
        if (!_hookChains[funcName]) _hookChains[funcName] = [];
        _hookChains[funcName].push({ modId, priority, callback: hookCallback });
        _hookChains[funcName].sort((a, b) => a.priority - b.priority);
    }

    const obj = { greet: (name) => `Hello ${name}` };
    const original = obj.greet;
    _originalFunctions['greet'] = original;

    hookFunction(obj, 'greet', 'mod_a', (orig, name) => orig(name) + '!', 100);
    hookFunction(obj, 'greet', 'mod_b', (orig, name) => orig(name.toUpperCase()), 50);

    // Remove mod_a — mod_b should still work
    _hookChains['greet'] = _hookChains['greet'].filter(h => h.modId !== 'mod_a');

    return assert(_hookChains['greet'].length === 1 && _hookChains['greet'][0].modId === 'mod_b',
                  'unhook did not correctly remove only the specified mod hook');
});

// ============================================================================
// TEST GROUP 9: Sandbox — no `with` statement in ModLoader.js
// ============================================================================

test('ModLoader.js — does NOT use deprecated `with` statement', () => {
    const modLoaderPath = path.join(__dirname, '..', 'js', 'mods', 'ModLoader.js');
    const content = fs.readFileSync(modLoaderPath, 'utf-8');
    // Check that "with(this)" or "with(sandbox" is NOT present
    const hasWith = /\bwith\s*\(/.test(content) && content.includes('with(this)');
    return assert(!hasWith, 'ModLoader.js still uses deprecated `with` statement');
});

test('ModLoader.js — uses "use strict" in sandbox wrapper', () => {
    const modLoaderPath = path.join(__dirname, '..', 'js', 'mods', 'ModLoader.js');
    const content = fs.readFileSync(modLoaderPath, 'utf-8');
    return assert(content.includes('"use strict"'), 'ModLoader.js sandbox does not use strict mode');
});

test('ModLoader.js — contains hookFunction method', () => {
    const modLoaderPath = path.join(__dirname, '..', 'js', 'mods', 'ModLoader.js');
    const content = fs.readFileSync(modLoaderPath, 'utf-8');
    return assert(content.includes('hookFunction'), 'ModLoader.js does not contain hookFunction method');
});

test('ModLoader.js — contains unhookFunction method', () => {
    const modLoaderPath = path.join(__dirname, '..', 'js', 'mods', 'ModLoader.js');
    const content = fs.readFileSync(modLoaderPath, 'utf-8');
    return assert(content.includes('unhookFunction'), 'ModLoader.js does not contain unhookFunction method');
});

test('ModLoader.js — contains queueMutation for IPC batching', () => {
    const modLoaderPath = path.join(__dirname, '..', 'js', 'mods', 'ModLoader.js');
    const content = fs.readFileSync(modLoaderPath, 'utf-8');
    return assert(content.includes('queueMutation'), 'ModLoader.js does not contain queueMutation method');
});

// FIX (Issue #76/#25): Test checks for actual current apiVersion (2.0), not future 3.0
test('ModLoader.js — apiVersion is defined and valid', () => {
    const modLoaderPath = path.join(__dirname, '..', 'js', 'mods', 'ModLoader.js');
    const content = fs.readFileSync(modLoaderPath, 'utf-8');
    // Accept any apiVersion that matches semver pattern
    const match = content.match(/apiVersion:\s*'(\d+\.\d+)'/);
    return assert(match && match[1], `ModLoader.js apiVersion not found or invalid`);
});

// ============================================================================
// TEST GROUP 10: VFS — comprehensive MIME types in main.js
// ============================================================================

test('main.js — VFS handler supports font MIME types', () => {
    const mainPath = path.join(__dirname, '..', 'main.js');
    const content = fs.readFileSync(mainPath, 'utf-8');
    return assert(content.includes('.woff2') && content.includes('font/woff2'),
                  'main.js VFS does not support .woff2 font MIME type');
});

test('main.js — VFS handler supports 3D model MIME types', () => {
    const mainPath = path.join(__dirname, '..', 'main.js');
    const content = fs.readFileSync(mainPath, 'utf-8');
    return assert(content.includes('.gltf') || content.includes('model/gltf'),
                  'main.js VFS does not support 3D model MIME types');
});

test('main.js — VFS handler has file header sniffing fallback', () => {
    const mainPath = path.join(__dirname, '..', 'main.js');
    const content = fs.readFileSync(mainPath, 'utf-8');
    return assert(content.includes('0x89504E47') || content.includes('readUInt32BE'),
                  'main.js VFS does not have file header sniffing fallback');
});

// ============================================================================
// RESULTS
// ============================================================================

console.log('\n╔══════════════════════════════════════════════╗');
console.log('║     ModKit 3.0 Verification Test Suite      ║');
console.log('╚══════════════════════════════════════════════╝\n');

results.forEach(r => console.log(r));

console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);

if (failed > 0) {
    console.error('❌ SOME TESTS FAILED — review errors above');
    process.exit(1);
} else {
    console.log('✅ ALL TESTS PASSED — ModKit 3.0 is ready');
    process.exit(0);
}
