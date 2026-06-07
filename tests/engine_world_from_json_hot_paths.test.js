#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'engine/meterea_engine.cpp'), 'utf8');

assert(
  source.includes('const JsonValue& grid = j.obj_val.at("grid");'),
  'WorldMap::fromJson must iterate map.grid by const reference'
);

assert(
  source.includes('for (const auto& tileJson : grid.arr_val)'),
  'WorldMap::fromJson must not copy each map tile through JsonValue::operator[]'
);

assert(
  source.includes('const JsonValue& newsJson = j.obj_val.at("news");'),
  'World::fromJson must iterate news by const reference'
);

assert(
  !/j\\["news"\\]\\[i\\]/.test(source),
  'World::fromJson must not repeatedly copy news entries through j["news"][i]'
);

console.log('engine world fromJson hot-path tests OK');
