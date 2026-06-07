#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

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

// === Контракт 1: updateEnvironmentVisibility существует и использует fuzzy-match ===
const startIdx = script.indexOf('function updateEnvironmentVisibility(');
assert.notStrictEqual(startIdx, -1, 'updateEnvironmentVisibility must be defined');
const fnBody = extractBalanced(script, startIdx);

assert.match(
    fnBody,
    /_isEntityHere\s*\(/,
    'updateEnvironmentVisibility must delegate to _isEntityHere() helper for fuzzy match'
);

assert.match(
    fnBody,
    /_resolveLocationToRegionId\s*\(/,
    'updateEnvironmentVisibility must use _resolveLocationToRegionId for region lookups'
);

assert.match(
    fnBody,
    /_resolveLocationToSubId\s*\(/,
    'updateEnvironmentVisibility must use _resolveLocationToSubId for sub-location lookups'
);

// Sanity: жёсткое равенство ent.boundTo === player.location НЕ должно быть единственной проверкой.
// (Конкретные проверки находятся в _isEntityHere — см. контракт 4 ниже.)
assert.match(
    script,
    /pLocLower\.includes\(eLoc\)|eLoc\.includes\(pLocLower\)/,
    'script.js must include substring (fuzzy) match for region vs sub-location names'
);

// === Контракт 2: companions (boundTo === 'player') остаются в visibleEntities ===
assert.match(
    fnBody,
    /ent\.boundTo\s*===\s*['"]player['"]/,
    'must keep the companion branch (boundTo === "player")'
);

// === Контракт 3: HP-фильтр сохранён (мёртвые сущности НЕ видны) ===
assert.match(
    fnBody,
    /ent\.stats\.hp\s*<=\s*0|hp\s*<=\s*0/,
    'must skip entities with hp <= 0'
);

// === Контракт 4: _isEntityHere реализует 4 уровня сравнения ===
const isHereStartIdx = script.indexOf('function _isEntityHere(');
assert.notStrictEqual(isHereStartIdx, -1, '_isEntityHere helper must exist');
const isHereBody = extractBalanced(script, isHereStartIdx);

assert.match(isHereBody, /eRaw\s*===\s*pLocRaw/, '_isEntityHere must keep raw strict equality');
assert.match(isHereBody, /eLoc\s*===\s*pLocLower/, '_isEntityHere must keep normalized (trim+lowercase) equality');
assert.match(
    isHereBody,
    /pLocLower\.includes\(eLoc\)|eLoc\.includes\(pLocLower\)/,
    '_isEntityHere must implement substring (fuzzy) match'
);
assert.match(
    isHereBody,
    /World\.regions\[eRaw\]/,
    '_isEntityHere must look up World.regions[eRaw] for id-based boundTo'
);

// === Контракт 5: _resolveLocationToRegionId ===
const regionStartIdx = script.indexOf('function _resolveLocationToRegionId(');
assert.notStrictEqual(regionStartIdx, -1, '_resolveLocationToRegionId helper must exist');
const regionBody = extractBalanced(script, regionStartIdx);

assert.match(
    regionBody,
    /World\.regions\[locRaw\]/,
    '_resolveLocationToRegionId must check direct id match first'
);
assert.match(
    regionBody,
    /rName\s*===\s*loc/,
    '_resolveLocationToRegionId must check normalized name match'
);
assert.match(
    regionBody,
    /loc\.includes\(rName\)|rName\.includes\(loc\)/,
    '_resolveLocationToRegionId must fall back to substring fuzzy match'
);

// === Контракт 6: _resolveLocationToSubId ===
const subStartIdx = script.indexOf('function _resolveLocationToSubId(');
assert.notStrictEqual(subStartIdx, -1, '_resolveLocationToSubId helper must exist');
const subBody = extractBalanced(script, subStartIdx);

assert.match(
    subBody,
    /World\.subLocations/,
    '_resolveLocationToSubId must look at World.subLocations'
);
assert.match(
    subBody,
    /player\.subLocations/,
    '_resolveLocationToSubId must also look at player.subLocations'
);

// === Контракт 7: пакет + smoke-check ===
assert.match(
    pkg.scripts['test:unit'] || '',
    /tests\/environment_visibility_fuzzy\.test\.js/,
    'npm run test:unit should include the environment visibility fuzzy test'
);

console.log('environment visibility fuzzy tests OK');
