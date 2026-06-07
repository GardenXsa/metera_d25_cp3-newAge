#!/usr/bin/env node
const assert = require('assert');

const Contract = require('../js/core/gmResponseContract.js');

{
  const result = Contract.normalizeResponseObject({
    narrative: 'Smoke over the camp.',
    actions: [],
    suggested_actions: [
      { text: 'Attack the scout', roll_stat: 'atk' },
      'Look around'
    ]
  }, {
    player: { currentCombat: { isActive: true }, travel: { active: false } }
  });

  assert.equal(result.scene_state.mode, 'combat');
  assert.equal(result.scene_state.pressure, 'high');
  assert.equal(result.suggested_actions[0].intent, 'combat_attack');
  assert.equal(result.suggested_actions[0].risk, 'medium');
  assert.equal(result.suggested_actions[1].text, 'Look around');
  assert.equal(result.suggested_actions[1].roll_stat, null);
}

{
  const result = Contract.normalizeResponseObject({
    scene_state: { mode: 'dance_party', pressure: 'panic', reason: '' },
    suggested_actions: [{ text: 'Ask for rumors', roll_stat: null, intent: 'dialogue', risk: 'low' }]
  }, {
    player: { currentCombat: { isActive: false }, travel: { active: false } }
  });

  assert.equal(result.scene_state.mode, 'exploration');
  assert.equal(result.scene_state.pressure, 'none');
  assert.equal(result.scene_state.reason, 'inferred_from_runtime');
  assert.equal(result.suggested_actions[0].intent, 'dialogue');
  assert.equal(result.suggested_actions[0].risk, 'low');
}

{
  const result = Contract.normalizeResponseObject({
    scene_state: { mode: 'travel', pressure: 'medium', reason: 'road_event' },
    suggested_actions: [{ text: 'Continue', roll_stat: undefined, intent: undefined, risk: undefined }]
  }, {
    player: { travel: { active: true }, currentCombat: { isActive: false } }
  });

  assert.equal(result.scene_state.mode, 'travel');
  assert.equal(result.scene_state.pressure, 'medium');
  assert.equal(result.suggested_actions[0].intent, 'travel_continue');
  assert.equal(result.suggested_actions[0].risk, 'low');
}

console.log('gm response contract tests OK');
