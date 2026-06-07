#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'engine/meterea_engine.cpp'), 'utf8');

const signature = 'std::string addNews(';
const start = source.indexOf(signature);
assert(start !== -1, 'addNews function must be present in meterea_engine.cpp');

const endMarker = 'std::string getGoodName';
const end = source.indexOf(endMarker, start);
assert(end !== -1, 'addNews function boundary must be detectable');

const addNewsBody = source.slice(start, end);

assert(
  !/g_world\.news\.erase\s*\(/.test(addNewsBody),
  'addNews must preserve the full world chronicle instead of pruning old World.news entries'
);

assert(
  !/MAX_NEWS_ITEMS/.test(addNewsBody),
  'addNews must not apply a fixed item cap to World.news'
);

console.log('world news retention tests OK');
