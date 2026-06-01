#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const stage3 = fs.readFileSync(path.join(root, 'assets/prompts/deep_setup/stage3_environment.txt'), 'utf8');
const stage4 = fs.readFileSync(path.join(root, 'assets/prompts/deep_setup/stage4_quests.txt'), 'utf8');
const stage5 = fs.readFileSync(path.join(root, 'assets/prompts/deep_setup/stage5_prologue.txt'), 'utf8');
const deepSetupStart = script.indexOf('async function runDeepSetupPipeline');
const deepSetupEnd = script.indexOf('// --- ЭКСПЕРИМЕНТАЛЬНЫЙ ДВИЖОК СИМУЛЯЦИИ', deepSetupStart);
const deepSetup = script.slice(deepSetupStart, deepSetupEnd);

assert.match(
  script,
  /function isAtmosphericDeepSetupStartGuardActive\(\)/,
  'script.js should expose a runtime guard for atmospheric deep setup'
);

assert.match(
  script,
  /function shouldBlockAtmosphericStartupCombat\(command, args\)/,
  'script.js should decide when startup combat commands must be blocked'
);

assert.match(
  script,
  /shouldBlockAtmosphericStartupCombat\(command, args\)/,
  'executeCommand should apply the atmospheric startup combat guard before command execution'
);

assert.match(
  script,
  /player\._deepSetupActive = true/,
  'deep setup should mark itself active while stage commands are being applied'
);

assert.match(
  script,
  /delete player\._deepSetupActive/,
  'deep setup should clear its active flag on completion and failure'
);

assert.match(
  deepSetup,
  /GRAIL\.onTurnStart\(player\)/,
  'deep setup should start a GRAIL turn before applying startup commands'
);

assert.match(
  deepSetup,
  /GRAIL\.onTurnEnd\(res5\.narrative \|\| '', player\)/,
  'deep setup should finish the GRAIL turn after the prologue is generated'
);

assert.match(
  stage3,
  /КОНТРАКТ РЕЖИМА СТАРТА/,
  'stage 3 prompt should explicitly describe start mode constraints'
);

assert.match(
  stage3,
  /атмосферн[\s\S]*isHostile`?: false/i,
  'stage 3 prompt should forbid hostile enemies for atmospheric start'
);

assert.match(
  stage4,
  /АТМОСФЕРНЫЙ СТАРТ[\s\S]*ЗАПРЕЩЕНО вызывать `setCombatState`/,
  'stage 4 prompt should forbid starting combat for atmospheric start'
);

assert.doesNotMatch(
  stage5,
  /или к началу боя/,
  'stage 5 prologue should not steer atmospheric starts into immediate combat'
);

assert.match(
  stage5,
  /первому осознанному выбору/,
  'stage 5 prologue should steer the player toward a choice instead of forced combat'
);

assert.match(
  pkg.scripts['test:unit'],
  /tests\/deep_setup_start_mode_guard\.test\.js/,
  'npm run test:unit should include the deep setup start mode guard test'
);

console.log('deep setup start mode guard tests OK');
