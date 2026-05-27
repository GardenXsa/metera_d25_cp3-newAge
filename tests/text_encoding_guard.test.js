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

assert.strictEqual(guard.repairText('рџЋІ D20'), '🎲 D20');
assert.strictEqual(guard.repairText('рџ’Є STR'), '💪 STR');
assert.strictEqual(guard.repairText('рџ›ЎпёЏ Defend'), '🛡️ Defend');
assert.strictEqual(guard.repairText('вљ”пёЏ Attack'), '⚔️ Attack');
assert.strictEqual(guard.repairText('normal text'), 'normal text');

const main = read('main.js');
assert(main.includes("'.html': 'text/html; charset=utf-8'"), 'HTML MIME type must declare UTF-8');
assert(main.includes("'.js': 'text/javascript; charset=utf-8'"), 'JS MIME type must declare UTF-8');
assert(main.includes("'.json': 'application/json; charset=utf-8'"), 'JSON MIME type must declare UTF-8');

const html = read('index.html');
assert(html.includes('js/core/textEncodingGuard.js'), 'index.html must load textEncodingGuard.js');

console.log('text encoding guard tests OK');
