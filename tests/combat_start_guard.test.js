#!/usr/bin/env node
const assert = require('assert');

const CombatStartGuard = require('../js/core/combatStartGuard.js');

{
  const decision = CombatStartGuard.evaluateCombatStartCommand('setCombatState', {
    isActive: true,
    participants: ['shadow']
  }, {
    player: {
      currentCombat: { isActive: false },
      visibleEntities: {}
    }
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'no_living_hostile_or_explicit_reason');
}

{
  const decision = CombatStartGuard.evaluateCombatStartCommand('setCombatState', {
    isActive: true,
    participants: ['bandit']
  }, {
    player: {
      currentCombat: { isActive: false },
      visibleEntities: {
        bandit: { isHostile: true, stats: { hp: 12 } }
      }
    }
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, 'living_hostile_participant');
}

{
  const decision = CombatStartGuard.evaluateCombatStartCommand('setCombatState', {
    isActive: true,
    participants: ['road_bandit'],
    reason: 'ambush_event'
  }, {
    player: {
      currentCombat: { isActive: false },
      visibleEntities: {}
    }
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, 'explicit_combat_reason');
}

{
  const decision = CombatStartGuard.evaluateCombatStartCommand('setCombatState', {
    isActive: false,
    participants: []
  }, {
    player: { currentCombat: { isActive: true } }
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, 'not_starting_combat');
}

console.log('combat start guard tests OK');
