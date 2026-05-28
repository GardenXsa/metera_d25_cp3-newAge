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

// Test known mojibake pattern replacements
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

// Test double-encoded Cyrillic (В → Р')
const voyneMojibake = String.fromCharCode(0x0420) + "'" + String.fromCharCode(0x043E) + String.fromCharCode(0x0439) + String.fromCharCode(0x043D) + String.fromCharCode(0x0430);
assert.strictEqual(guard.repairText(voyneMojibake), 'Война');

// Test that normal Russian text is NOT corrupted
assert.strictEqual(guard.repairText('Привет мир'), 'Привет мир');
assert.strictEqual(guard.repairText('Летопись Мира'), 'Летопись Мира');

// Test combined: mojibake + normal text
const combined = guard.repairText(makeMojibake('⚔️') + ' Война началась');
assert(combined.includes('⚔️'), 'Combined text must contain ⚔️');
assert(combined.includes('Война'), 'Combined text must preserve Война');

// Verify MIME types declare UTF-8
const main = read('main.js');
assert(main.includes("'.html': 'text/html; charset=utf-8'"), 'HTML MIME type must declare UTF-8');
assert(main.includes("'.js': 'text/javascript; charset=utf-8'"), 'JS MIME type must declare UTF-8');
assert(main.includes("'.json': 'application/json; charset=utf-8'"), 'JSON MIME type must declare UTF-8');

// Verify the guard script is loaded in the HTML
const html = read('index.html');
assert(html.includes('js/core/textEncodingGuard.js'), 'index.html must load textEncodingGuard.js');

// Verify the guard watches chronicle selectors
const guardSrc = read('js/core/textEncodingGuard.js');
assert(guardSrc.includes('#world-chronicles-list'), 'Guard must watch #world-chronicles-list');
assert(guardSrc.includes('.chronicle-item'), 'Guard must watch .chronicle-item');
assert(guardSrc.includes('.message-bubble'), 'Guard must watch .message-bubble');

console.log('text encoding guard tests OK');
