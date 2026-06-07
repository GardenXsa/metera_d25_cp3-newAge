#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'js/core/characterStatsResolver.js'), 'utf8');

const logs = [];
const sandbox = {
  console,
  window: {
    RuntimeLog: {
      warn(scope, message, detail) {
        logs.push({ level: 'warn', scope, message, detail });
      },
      error(scope, message, detail) {
        logs.push({ level: 'error', scope, message, detail });
      },
      info(scope, message, detail) {
        logs.push({ level: 'info', scope, message, detail });
      }
    }
  }
};
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'characterStatsResolver.js' });

const resolver = sandbox.window.CharacterStatsResolver;
if (!resolver) throw new Error('CharacterStatsResolver was not exported to window.');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

sandbox.window.RUNTIME_DATABASE = {
  classes: [
    {
      id: 'warrior',
      base_stats: { str: 13, dex: 9, int: 8, con: 13, cha: 8, res: 12 },
      starting_items: { sword: 1 }
    },
    {
      id: 'mage',
      base_stats: { str: 7, dex: 10, int: 14, con: 8, cha: 12, res: 9 },
      starting_items: { wand: 1 }
    }
  ],
  races: [
    {
      id: 'human',
      stat_modifiers: { str: 0, dex: 1, int: 0, con: 1, cha: -1, res: 1 }
    },
    {
      id: 'lumen',
      stat_modifiers: { str: -1, int: 2, con: -1, cha: 1 }
    }
  ],
  eras: [{ id: 'rebirth' }]
};

let result = resolver.resolveCharacterCreationStats({
  classId: 'warrior',
  raceId: 'human',
  allocation: { str: 2, cha: 1 }
});

assert(result.valid, 'warrior/human should resolve');
assertEqual(result.baseStatsForDistribution.str, 13, 'warrior/human base str');
assertEqual(result.baseStatsForDistribution.dex, 10, 'warrior/human dex includes race modifier');
assertEqual(result.baseStatsForDistribution.con, 14, 'warrior/human con includes race modifier');
assertEqual(result.baseStatsForDistribution.cha, 7, 'warrior/human cha includes race modifier');
assertEqual(result.baseStatsForDistribution.res, 13, 'warrior/human res includes race modifier');
assertEqual(result.finalStats.str, 15, 'allocation applies to str');
assertEqual(result.finalStats.cha, 8, 'allocation applies to cha');

result = resolver.resolveCharacterCreationStats({
  classId: 'mage',
  raceId: 'lumen'
});
assert(result.valid, 'mage/lumen should resolve');
assertEqual(result.baseStatsForDistribution.str, 6, 'mage/lumen str');
assertEqual(result.baseStatsForDistribution.int, 16, 'mage/lumen int');
assertEqual(result.baseStatsForDistribution.res, 9, 'missing race res modifier falls back to 0');

const contractErrors = resolver.validateCharacterStatsContract(sandbox.window.RUNTIME_DATABASE);
assertEqual(contractErrors.length, 0, 'valid runtime database contract');

const brokenErrors = resolver.validateCharacterStatsContract({
  classes: [{ id: 'broken', base_stats: { str: 10 } }],
  races: [{ id: 'bad', stat_modifiers: { luck: 1 } }]
});
assert(brokenErrors.some(e => e.includes('class broken.base_stats.dex')), 'contract catches missing class dex');
assert(brokenErrors.some(e => e.includes('race bad.stat_modifiers.luck')), 'contract catches unknown race stat');

console.log('character stats resolver tests OK');
