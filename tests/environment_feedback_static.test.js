#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const script = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

assert.doesNotMatch(
  script,
  /entityAddedToEnv[\s\S]{0,220}Привязка/,
  'addEnvironment feedback should not expose internal binding text to the player log'
);

console.log('environment feedback static tests OK');
