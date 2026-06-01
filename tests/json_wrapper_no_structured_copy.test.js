#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'engine/json_wrapper.h'), 'utf8');

assert(
  !/JsonValue\s*\(\s*const\s+nlohmann::json&\s+j\s*\)\s*:\s*_data\s*\(\s*j\s*\)/.test(source),
  'JsonValue(nlohmann::json) must not copy structured JSON into _data before recursive conversion'
);

assert(
  /j\.is_object\(\)[^]*?_data\s*=\s*nlohmann::json::object\(\)/.test(source),
  'object inputs should initialize _data as an empty object placeholder'
);

assert(
  /j\.is_array\(\)[^]*?_data\s*=\s*nlohmann::json::array\(\)/.test(source),
  'array inputs should initialize _data as an empty array placeholder'
);

console.log('json wrapper structured-copy tests OK');
