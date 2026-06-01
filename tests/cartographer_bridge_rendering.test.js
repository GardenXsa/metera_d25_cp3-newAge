#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'js/cartographer/globalMap.js'), 'utf8');

const sandbox = {
  window: {
    gamedata: {
      map_markers: {
        road_types: [
          { id: 'bridge', color: '#8b4513', width: 4, dash: [], ruined_color: '#e74c3c', ruined_dash: [5, 5] }
        ]
      }
    }
  },
  document: { getElementById() { return null; } },
  console,
  requestAnimationFrame() { return 1; },
  cancelAnimationFrame() {}
};
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'globalMap.js' });

const cartographer = sandbox.window.Cartographer;
assert(cartographer, 'Cartographer must be exported on window');

const style = cartographer.getRoadTypeStyle({ type: 'bridge', condition: 'good', integrity: 100 });
assert.strictEqual(style.lineWidth, 4, 'bridge style must use map_markers width');
assert.strictEqual(style.strokeStyle, '#8b4513', 'bridge style must use configured color');
assert.deepStrictEqual(style.lineDash, [], 'intact bridge must not be dashed');

const ruinedStyle = cartographer.getRoadTypeStyle({ type: 'bridge', condition: 'ruined', integrity: 20 });
assert.strictEqual(ruinedStyle.strokeStyle, '#e74c3c', 'ruined bridge must use configured ruined color');
assert.deepStrictEqual(ruinedStyle.lineDash, [5, 5], 'ruined bridge must use configured ruined dash');

const map = {
  width: 2,
  height: 2,
  grid: [
    [12, 0, 1],
    [2, 0, 0],
    [12, 0, 1],
    [2, 0, 0]
  ]
};
const segments = cartographer.getBridgeFlagOverlaySegments(map);
assert.strictEqual(JSON.stringify(segments), JSON.stringify([
  { x: 5, y: 5 },
  { x: 5, y: 15 }
]), 'bridge flag overlay must expose bridge tile centers');

console.log('cartographer bridge rendering tests OK');
