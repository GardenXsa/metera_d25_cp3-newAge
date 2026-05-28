#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

const sandbox = {
  window: {},
  document: {
    readyState: 'loading',
    addEventListener() {},
    querySelectorAll() { return []; },
    body: null
  },
  NodeFilter: { SHOW_TEXT: 4 },
  MutationObserver: function MutationObserver() {
    this.observe = function observe() {};
  },
  console
};
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(read('js/core/textEncodingGuard.js'), sandbox, { filename: 'textEncodingGuard.js' });

const guard = sandbox.window.TextEncodingGuard;
assert(guard, 'TextEncodingGuard must be exported');

// Build mojibake strings by encoding emojis as cp1251 then decoding as UTF-8
// This avoids literal mojibake characters in the source code that could break syntax
function makeMojibake(emoji) {
  const bytes = Buffer.from(emoji, 'utf8');
  let cp1251Str = '';
  for (const b of bytes) {
    // Map byte value to the corresponding cp1251 character
    if (b >= 0x20 && b <= 0x7E) {
      cp1251Str += String.fromCharCode(b); // ASCII range
    } else if (b >= 0xC0 && b <= 0xFF) {
      // Cyrillic range in cp1251: C0=А...DF=п, E0=р...FF=я
      cp1251Str += String.fromCharCode(0x0410 + (b - 0xC0)); // А-я
    } else if (b >= 0x80 && b <= 0xBF) {
      // Special cp1251 characters - need to map them
      const cp1251Map = {
        0x80: 0x0402, 0x81: 0x0403, 0x82: 0x201A, 0x83: 0x0453, 0x84: 0x201E,
        0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x20AC, 0x89: 0x2030,
        0x8A: 0x0409, 0x8B: 0x2039, 0x8C: 0x040A, 0x8D: 0x040C, 0x8E: 0x040B,
        0x8F: 0x040F, 0x90: 0x0452, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C,
        0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x0098,
        0x99: 0x2122, 0x9A: 0x0459, 0x9B: 0x203A, 0x9C: 0x045A, 0x9D: 0x045C,
        0x9E: 0x045B, 0x9F: 0x045F, 0xA0: 0x00A0, 0xA1: 0x040E, 0xA2: 0x045E,
        0xA3: 0x0408, 0xA4: 0x00A4, 0xA5: 0x0490, 0xA6: 0x00A6, 0xA7: 0x0401,
        0xA8: 0x00A8, 0xA9: 0x0404, 0xAA: 0x00AA, 0xAB: 0x0407, 0xAC: 0x00AC,
        0xAD: 0x00AD, 0xAE: 0x0405, 0xAF: 0x0491,
        0xB0: 0x00B0, 0xB1: 0x00B1, 0xB2: 0x0406, 0xB3: 0x0456, 0xB4: 0x0491,
        0xB5: 0x00B5, 0xB6: 0x00B6, 0xB7: 0x0451, 0xB8: 0x00B8, 0xB9: 0x0455,
        0xBA: 0x00BA, 0xBB: 0x0457, 0xBC: 0x0458, 0xBD: 0x0454, 0xBE: 0x00BE,
        0xBF: 0x0457
      };
      const uni = cp1251Map[b];
      if (uni) cp1251Str += String.fromCharCode(uni);
      else cp1251Str += String.fromCharCode(b); // fallback
    } else {
      cp1251Str += String.fromCharCode(b); // fallback for other bytes
    }
  }
  return cp1251Str;
}

// ========== Test 1: Basic mojibake repair ==========
assert.strictEqual(guard.repairText(makeMojibake('🎲') + ' D20'), '🎲 D20');
assert.strictEqual(guard.repairText(makeMojibake('💪') + ' STR'), '💪 STR');
assert.strictEqual(guard.repairText(makeMojibake('🛡️') + ' Defend'), '🛡️ Defend');
assert.strictEqual(guard.repairText(makeMojibake('⚔️') + ' Attack'), '⚔️ Attack');
assert.strictEqual(guard.repairText(makeMojibake('❤️') + ' Love'), '❤️ Love');
assert.strictEqual(guard.repairText(makeMojibake('⚖️') + ' Market'), '⚖️ Market');
assert.strictEqual(guard.repairText(makeMojibake('🌪️') + ' Storm'), '🌪️ Storm');
assert.strictEqual(guard.repairText(makeMojibake('💧') + ' Mana'), '💧 Mana');
assert.strictEqual(guard.repairText(makeMojibake('💰') + ' Gold'), '💰 Gold');
assert.strictEqual(guard.repairText(makeMojibake('📍') + ' Location'), '📍 Location');
assert.strictEqual(guard.repairText('normal text'), 'normal text');

// ========== Test 2: ⚡️ variation selector fix (was broken before) ==========
// The old code had [/вљЎ/g, '⚡'] BEFORE [/вљЎпёЏ/g, '⚡️']
// which meant the longer pattern never matched. Now the order is correct.
const lightningVS = guard.repairText(makeMojibake('⚡️'));
assert(lightningVS.includes('⚡️'), '⚡️ (with variation selector) must be repaired correctly, got: ' + lightningVS);

const lightningNoVS = guard.repairText(makeMojibake('⚡'));
assert(lightningNoVS.includes('⚡'), '⚡ (without variation selector) must be repaired correctly');

// ========== Test 3: Double-encoded Cyrillic (В → Р') ==========
const voyneMojibake = String.fromCharCode(0x0420) + "'" + String.fromCharCode(0x043E) + String.fromCharCode(0x0439) + String.fromCharCode(0x043D) + String.fromCharCode(0x0430);
assert.strictEqual(guard.repairText(voyneMojibake), 'Война');

// General Р' + lowercase pattern
const velikiyMojibake = String.fromCharCode(0x0420) + "'" + String.fromCharCode(0x0435) + String.fromCharCode(0x043B) + String.fromCharCode(0x0438) + String.fromCharCode(0x043A) + String.fromCharCode(0x0438) + String.fromCharCode(0x0439);
assert.strictEqual(guard.repairText(velikiyMojibake), 'Великий');

// Lowercase в → р' pattern
const lowercaseVMojibake = String.fromCharCode(0x0440) + "'" + String.fromCharCode(0x043E) + String.fromCharCode(0x0439) + String.fromCharCode(0x043D) + String.fromCharCode(0x0435);
assert.strictEqual(guard.repairText(lowercaseVMojibake), 'войне');

// ========== Test 4: Normal Russian text is NOT corrupted ==========
assert.strictEqual(guard.repairText('Привет мир'), 'Привет мир');
assert.strictEqual(guard.repairText('Летопись Мира'), 'Летопись Мира');
assert.strictEqual(guard.repairText('Война и мир'), 'Война и мир');

// ========== Test 5: Combined mojibake + normal text ==========
const combined = guard.repairText(makeMojibake('⚔️') + ' Война началась');
assert(combined.includes('⚔️'), 'Combined text must contain ⚔️');
assert(combined.includes('Война'), 'Combined text must preserve Война');

// ========== Test 6: Programmatic emoji set (RPG/fantasy) ==========
// These emojis are NOT hardcoded but should be repaired via programmatic generation
const rpgEmojis = ['👑', '🏹', '🐉', '🏰', '🔮', '🍷', '🌙', '👑', '💀'];
for (const emoji of rpgEmojis) {
  const mojibake = makeMojibake(emoji);
  const repaired = guard.repairText(mojibake);
  assert.strictEqual(repaired, emoji, `Programmatic emoji ${emoji} must be repaired correctly (got: ${repaired})`);
}

// ========== Test 7: repairObject() function ==========
assert(guard.repairObject, 'repairObject must be exported');

// Test repairObject with World-like data
const testWorld = {
  news: [
    { text: makeMojibake('⚔️') + ' ' + String.fromCharCode(0x0420) + "'ойна началась!", category: 'war' },
    { text: makeMojibake('💰') + ' Торговый путь открыт', category: 'trade' }
  ],
  regions: { r1: { name: makeMojibake('🏰') + ' Крепость' } },
  tick: 100
};

const repairedWorld = guard.repairObject(testWorld);
assert(repairedWorld.news[0].text.includes('⚔️'), 'repairObject must fix emoji in news[0].text');
assert(repairedWorld.news[0].text.includes('Война'), 'repairObject must fix double-encoded Cyrillic in news[0].text');
assert(repairedWorld.news[1].text.includes('💰'), 'repairObject must fix emoji in news[1].text');
assert(repairedWorld.regions.r1.name.includes('🏰'), 'repairObject must fix emoji in region names');
assert.strictEqual(repairedWorld.tick, 100, 'repairObject must not modify non-string values');

// Test repairObject with null/undefined/primitives
assert.strictEqual(guard.repairObject(null), null);
assert.strictEqual(guard.repairObject(undefined), undefined);
assert.strictEqual(guard.repairObject(42), 42);
assert.strictEqual(guard.repairObject('hello'), 'hello');
assert.strictEqual(guard.repairObject(makeMojibake('🔥')), '🔥');

// Test repairObject with arrays
const testArr = [makeMojibake('🎲'), 'normal', makeMojibake('⚔️') + ' fight'];
const repairedArr = guard.repairObject(testArr);
assert.strictEqual(repairedArr[0], '🎲', 'repairObject must fix array string elements');
assert.strictEqual(repairedArr[1], 'normal', 'repairObject must preserve normal strings');
assert(repairedArr[2].includes('⚔️'), 'repairObject must fix combined text in arrays');

// ========== Test 8: MIME types declare UTF-8 ==========
const main = read('main.js');
assert(main.includes("'.html': 'text/html; charset=utf-8'"), 'HTML MIME type must declare UTF-8');
assert(main.includes("'.js': 'text/javascript; charset=utf-8'"), 'JS MIME type must declare UTF-8');
assert(main.includes("'.json': 'application/json; charset=utf-8'"), 'JSON MIME type must declare UTF-8');

// ========== Test 9: Guard script is loaded in HTML ==========
const html = read('index.html');
assert(html.includes('js/core/textEncodingGuard.js'), 'index.html must load textEncodingGuard.js');

// ========== Test 10: Guard watches chronicle and dice selectors ==========
const guardSrc = read('js/core/textEncodingGuard.js');
assert(guardSrc.includes('#world-chronicles-list'), 'Guard must watch #world-chronicles-list');
assert(guardSrc.includes('.chronicle-item'), 'Guard must watch .chronicle-item');
assert(guardSrc.includes('.message-bubble'), 'Guard must watch .message-bubble');
assert(guardSrc.includes('.chat-roll-badge'), 'Guard must watch .chat-roll-badge');
assert(guardSrc.includes('.roll-badge'), 'Guard must watch .roll-badge');

// ========== Test 11: setWorld calls repairObject ==========
const scriptSrc = read('script.js');
assert(scriptSrc.includes('TextEncodingGuard.repairObject'), 'script.js must call TextEncodingGuard.repairObject in setWorld');

// ========== Test 12: addLogMessage calls repairText ==========
assert(scriptSrc.includes('TextEncodingGuard.repairText'), 'script.js must call TextEncodingGuard.repairText for log messages');

console.log('text encoding guard tests OK (' + rpgEmojis.length + ' programmatic emojis verified)');
