#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.match(
  indexHtml,
  /<script src="js\/core\/turnIntentRouter\.js"><\/script>[\s\S]*<script src="script\.js"><\/script>/,
  'index.html should load turnIntentRouter.js before script.js'
);

assert.match(
  script,
  /async function ensureTurnIntentRegistry\(\)/,
  'script.js should expose async registry initialization'
);

assert.match(
  script,
  /TurnIntentRouter\.routePlayerInput\(/,
  'script.js should route player input before the AI request'
);

assert.match(
  script,
  /TurnIntentRouter\.guardActions\(/,
  'script.js should guard AI actions before validation and execution'
);

assert.match(
  script,
  /TURN INTENT ROUTER/,
  'script.js should append a named prompt patch block for the AI'
);

assert.match(
  pkg.scripts['test:unit'],
  /tests\/turn_intent_router\.test\.js/,
  'npm run test:unit should include the router unit test'
);

console.log('turn intent integration tests OK');
