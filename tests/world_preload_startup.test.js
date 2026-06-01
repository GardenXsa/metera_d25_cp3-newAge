#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

const branchStart = source.indexOf('if (preloadedWorldData) {');
assert(branchStart !== -1, 'finalizeWorldSetupAndStart must have a preloadedWorldData branch');

const branchEnd = source.indexOf('} else {', branchStart);
assert(branchEnd !== -1, 'preloadedWorldData branch boundary must be detectable');

const preloadedBranch = source.slice(branchStart, branchEnd);

assert(
  /initWorldSimulator\s*\(\s*initialAgents\s*,\s*absoluteStartDay\s*,\s*true\s*\)/.test(preloadedBranch),
  'preloaded world startup must load runtime database into Nexus Engine before syncing the world'
);

assert(
  !/nexusInit\s*\(\s*true\s*\)/.test(preloadedBranch),
  'preloaded world startup must not only init Nexus Engine without loading runtime database'
);

console.log('world preload startup tests OK');
