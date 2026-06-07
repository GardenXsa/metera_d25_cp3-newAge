#!/usr/bin/env node
const assert = require('assert');

const SuggestedActionPresenter = require('../js/core/suggestedActionPresenter.js');

{
  const combat = SuggestedActionPresenter.getActionPresentation({
    text: 'Strike with sword',
    roll_stat: 'atk',
    intent: 'combat_attack',
    risk: 'high'
  }, 'en');

  assert.equal(combat.icon, 'fa-burst');
  assert.equal(combat.risk, 'high');
  assert.equal(combat.intent, 'combat_attack');
  assert.equal(combat.riskLabel, 'High risk');
  assert.match(combat.className, /suggested-action-risk-high/);
  assert.match(combat.className, /suggested-action-intent-combat_attack/);
}

{
  const dialogue = SuggestedActionPresenter.getActionPresentation({
    text: 'Поговорить с Марой',
    roll_stat: null,
    intent: 'dialogue',
    risk: 'low'
  }, 'ru');

  assert.equal(dialogue.icon, 'fa-comments');
  assert.equal(dialogue.riskLabel, 'Низкий риск');
  assert.equal(dialogue.rollLabel, '');
}

{
  const fallback = SuggestedActionPresenter.getActionPresentation({
    text: 'Look around'
  }, 'en');

  assert.equal(fallback.icon, 'fa-location-arrow');
  assert.equal(fallback.risk, 'low');
  assert.equal(fallback.intent, 'freeform');
  assert.equal(fallback.rollLabel, '');
}

console.log('suggested action presenter tests OK');
