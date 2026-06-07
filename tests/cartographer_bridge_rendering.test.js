#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'js/cartographer/globalMap.js'), 'utf8');

function createRecordingContext() {
  return {
    lineWidth: 1,
    strokeStyle: '#000000',
    fillStyle: '#000000',
    globalAlpha: 1,
    currentDash: [],
    strokes: [],
    fills: [],
    paths: [],
    fillRect(x, y, width, height) {
      this.fills.push({ x, y, width, height, fillStyle: this.fillStyle, globalAlpha: this.globalAlpha });
    },
    beginPath() {
      this.paths.push([]);
    },
    moveTo(x, y) {
      if (this.paths.length === 0) this.beginPath();
      this.paths[this.paths.length - 1].push({ command: 'moveTo', x, y });
    },
    lineTo(x, y) {
      if (this.paths.length === 0) this.beginPath();
      this.paths[this.paths.length - 1].push({ command: 'lineTo', x, y });
    },
    stroke() {
      this.strokes.push({
        lineWidth: this.lineWidth,
        strokeStyle: this.strokeStyle,
        lineDash: [...this.currentDash],
        path: this.paths[this.paths.length - 1] || []
      });
    },
    setLineDash(dash) {
      this.currentDash = Array.isArray(dash) ? [...dash] : [];
    }
  };
}

const recordingContext = createRecordingContext();

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
  document: {
    getElementById() { return null; },
    createElement(tag) {
      assert.strictEqual(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext(type) {
          assert.strictEqual(type, '2d');
          return recordingContext;
        }
      };
    }
  },
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

cartographer.bgCacheCanvas = null;
cartographer.updateBackgroundCache({
  width: 2,
  height: 1,
  grid: [
    [12, 0, 1],
    [12, 0, 1]
  ],
  roads: [
    { type: 'bridge', condition: 'good', integrity: 100, waypoints: [[0, 0], [1, 0]] }
  ],
  generation_tick: 42
});

const bridgeStroke = recordingContext.strokes.find(stroke =>
  stroke.lineWidth === 4 &&
  stroke.strokeStyle === '#8b4513' &&
  JSON.stringify(stroke.lineDash) === '[]'
);
assert(bridgeStroke, 'updateBackgroundCache must render bridges with configured map_markers width and color');

const flagOnlyContext = createRecordingContext();
cartographer.bgCacheCanvas = {
  width: 0,
  height: 0,
  getContext(type) {
    assert.strictEqual(type, '2d');
    return flagOnlyContext;
  }
};
cartographer.updateBackgroundCache({
  width: 1,
  height: 1,
  grid: [
    [12, 0, 1]
  ],
  roads: [],
  generation_tick: 43
});

const bridgeFlagOverlayStroke = flagOnlyContext.strokes.find(stroke =>
  stroke.strokeStyle === '#b28a58' &&
  stroke.lineWidth === 2
);
assert(bridgeFlagOverlayStroke, 'updateBackgroundCache must render visible bridge overlays from grid bridge_flag cells');

console.log('cartographer bridge rendering tests OK');
