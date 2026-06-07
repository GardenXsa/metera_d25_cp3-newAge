#!/usr/bin/env node
const assert = require('assert');

const CombatIntentResolver = require('../js/core/combatIntentResolver.js');

{
  const intent = CombatIntentResolver.createIntent({
    action: 'defend',
    targetId: 'bandit',
    targetName: 'Road Bandit',
    language: 'en'
  });

  assert.equal(intent.action, 'defend');
  assert.equal(intent.rollStat, 'def');
  assert.equal(intent.targetId, 'bandit');
  assert.match(intent.effect, /incoming damage/i);
}

{
  const intent = CombatIntentResolver.enrichIntentWithRolls(
    CombatIntentResolver.createIntent({ action: 'escape', targetId: 'shade', targetName: 'Shade' }),
    ['[ROLL_RESULT: 16 | STAT: dex | MOD: 2 | TOTAL: 18]']
  );

  assert.equal(intent.rollTotal, 18);
  assert.equal(intent.outcomeHint, 'success');
  assert.equal(CombatIntentResolver.shouldSuppressEnemyCounterattack(intent), true);
}

{
  const intent = CombatIntentResolver.enrichIntentWithRolls(
    CombatIntentResolver.createIntent({ action: 'talk', targetId: 'guard', targetName: 'Guard' }),
    ['[ROLL_RESULT: 5 | STAT: cha | MOD: 1 | TOTAL: 6]']
  );

  assert.equal(intent.rollTotal, 6);
  assert.equal(intent.outcomeHint, 'failure');
  assert.equal(CombatIntentResolver.shouldSuppressEnemyCounterattack(intent), false);
}

{
  const modified = CombatIntentResolver.applyEnemyAttackModifiers(
    CombatIntentResolver.createIntent({ action: 'defend' }),
    { playerDef: 12 }
  );

  assert.equal(modified.playerDef, 16);
  assert.equal(modified.note.includes('+4'), true);
}

{
  const block = CombatIntentResolver.buildPromptBlock(
    CombatIntentResolver.enrichIntentWithRolls(
      CombatIntentResolver.createIntent({ action: 'attack', targetId: 'bandit', targetName: 'Bandit' }),
      ['[ROLL_RESULT: 12 | STAT: atk | MOD: 3 | TOTAL: 15]']
    ),
    'en'
  );

  assert.match(block, /COMBAT INTENT/);
  assert.match(block, /attack/);
  assert.match(block, /Bandit/);
  assert.match(block, /updateEntityStat/);
}

console.log('combat intent resolver tests OK');
