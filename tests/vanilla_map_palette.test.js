#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function readJson(projectPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, projectPath), 'utf8'));
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  assert.strictEqual(value.length, 6, `${hex} must be a six-digit hex color`);
  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255
  };
}

function saturation(hex) {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
}

const expectedBiomeColors = {
  ocean: '#14263a',
  shallow_water: '#1f3f4f',
  beach: '#b8a67a',
  plains: '#6f7650',
  forest: '#3f5a3b',
  mountains: '#6c6a5f',
  hills: '#8a7650',
  desert: '#9b8058',
  swamp: '#4c4f35',
  tundra: '#a8a99a',
  ruins: '#3f4640',
  anomaly: '#5d4b68',
  river: '#263f4c',
  volcano: '#7a352b',
  riverbank: '#5f6f48',
  lake: '#193244',
  floodplain: '#667452',
  lava: '#7b4938',
  ash: '#4b4942'
};

const expectedRoadColors = {
  bridge: '#6a5846',
  tunnel: '#4a4640',
  ferry: '#345468',
  highway: '#7f7665',
  sea_route: '#345468',
  paved: '#7f7665',
  dirt: '#6f604e'
};

const expectedLocationColors = {
  road: '#75644f',
  city: '#b99a5a',
  village: '#a8a08b',
  ruins: '#6f7067',
  fort: '#8a897e',
  camp: '#9a6a43',
  anomaly: '#7a5f83',
  observatory: '#5f7582',
  mountain: '#817f73'
};

const biomes = readJson('data/biomes.json');
for (const biome of biomes) {
  assert.strictEqual(
    biome.color_hex,
    expectedBiomeColors[biome.id],
    `${biome.id} should use the muted vanilla map palette`
  );
  assert(
    saturation(biome.color_hex) <= 0.55 || luminance(biome.color_hex) <= 0.28,
    `${biome.id} color ${biome.color_hex} is too saturated for the vanilla map`
  );
  assert(
    luminance(biome.color_hex) <= 0.72,
    `${biome.id} color ${biome.color_hex} is too bright for the vanilla map`
  );
}

const markers = readJson('data/map_markers.json');
for (const marker of markers.location_types) {
  assert.strictEqual(
    marker.color,
    expectedLocationColors[marker.id],
    `${marker.id} marker should use the muted vanilla map palette`
  );
}

for (const road of markers.road_types) {
  assert.strictEqual(
    road.color,
    expectedRoadColors[road.id],
    `${road.id} road should use the muted vanilla map palette`
  );
  assert(
    saturation(road.color) <= 0.55 || luminance(road.color) <= 0.28,
    `${road.id} road color ${road.color} is too saturated for the vanilla map`
  );
}

console.log('vanilla map palette tests OK');
