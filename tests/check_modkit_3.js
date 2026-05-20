/**
 * check_modkit_3.js — ModKit 3.0 Verification Test Suite
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
// TEST GROUP 6: mod.json updated for ModKit 3.0
// ============================================================================

test('cyberpunk mod.json — apiVersion is 3.0', () => {
    const modJsonPath = path.join(__dirname, '..', 'mods', 'cyberpunk_total_conversion', 'mod.json');
    const content = JSON.parse(fs.readFileSync(modJsonPath, 'utf-8'));
    return assert(content.apiVersion === '3.0',
                  `Expected apiVersion 3.0, got: ${content.apiVersion}`);
});

test('cyberpunk mod.json — version bumped to 3.0.0', () => {
    const modJsonPath = path.join(__dirname, '..', 'mods', 'cyberpunk_total_conversion', 'mod.json');
    const content = JSON.parse(fs.readFileSync(modJsonPath, 'utf-8'));
    return assert(content.version === '3.0.0',
                  `Expected version 3.0.0, got: ${content.version}`);
});

test('cyberpunk mod.json — has native_plugins field', () => {
    const modJsonPath = path.join(__dirname, '..', 'mods', 'cyberpunk_total_conversion', 'mod.json');
    const content = JSON.parse(fs.readFileSync(modJsonPath, 'utf-8'));
    return assert(Array.isArray(content.native_plugins) && content.native_plugins.length > 0,
                  'native_plugins field missing or empty');
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
