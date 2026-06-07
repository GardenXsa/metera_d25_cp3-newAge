#!/usr/bin/env node
const assert = require('assert');

const EntityStatValidator = require('../js/core/entityStatValidator.js');

// Damage case: value < currentHp must NOT be blocked (this was the original bug).
{
  const result = EntityStatValidator.validateEntityStatValue({
    stat: 'hp',
    value: 88,
    entity: { stats: { hp: 100, maxHp: 100 } }
  });
  assert.equal(result.value, 88, 'damage (100 -> 88) should be allowed, not blocked as healing');
  assert.equal(result.capReason, null);
}

// Damage case with stale local HP (entity.stats.hp = 0, but real HP is 100, set to 88).
{
  const result = EntityStatValidator.validateEntityStatValue({
    stat: 'hp',
    value: 88,
    entity: { stats: { hp: 0, maxHp: 100 } }
  });
  assert.equal(result.value, 88, 'damage must be allowed even when local HP is stale');
  assert.equal(result.capReason, null);
}

// Overheal: value > maxHp should be capped.
{
  const result = EntityStatValidator.validateEntityStatValue({
    stat: 'hp',
    value: 999,
    entity: { stats: { hp: 50, maxHp: 100 } }
  });
  assert.equal(result.value, 100);
  assert.equal(result.capReason, 'max_hp_cap');
}

// Negative: clamp to 0.
{
  const result = EntityStatValidator.validateEntityStatValue({
    stat: 'hp',
    value: -10,
    entity: { stats: { hp: 50, maxHp: 100 } }
  });
  assert.equal(result.value, 0);
  assert.equal(result.capReason, 'negative_clamped');
}

// Death: value 0 must pass.
{
  const result = EntityStatValidator.validateEntityStatValue({
    stat: 'hp',
    value: 0,
    entity: { stats: { hp: 5, maxHp: 100 } }
  });
  assert.equal(result.value, 0);
  assert.equal(result.capReason, null);
}

// NaN / undefined / string: fall back to currentHp.
{
  const cases = [NaN, undefined, null, '88', {}, []];
  for (const bad of cases) {
    const result = EntityStatValidator.validateEntityStatValue({
      stat: 'hp',
      value: bad,
      entity: { stats: { hp: 42, maxHp: 100 } }
    });
    assert.equal(result.value, 42, 'non-numeric value ' + String(bad) + ' should fall back to currentHp');
    assert.equal(result.capReason, 'non_numeric');
  }
}

// maxHp missing: only negative clamp, no max cap.
{
  const result = EntityStatValidator.validateEntityStatValue({
    stat: 'hp',
    value: 500,
    entity: { stats: { hp: 0 } }
  });
  assert.equal(result.value, 500, 'no maxHp means no cap');
  assert.equal(result.capReason, null);
}

// Non-HP stat: only numeric check, no cap.
{
  const result = EntityStatValidator.validateEntityStatValue({
    stat: 'str',
    value: 18,
    entity: { stats: { str: 12 } }
  });
  assert.equal(result.value, 18);
  assert.equal(result.capReason, null);
}

// Non-HP stat: non-numeric -> 0.
{
  const result = EntityStatValidator.validateEntityStatValue({
    stat: 'str',
    value: 'eighteen',
    entity: { stats: { str: 12 } }
  });
  assert.equal(result.value, 0);
  assert.equal(result.capReason, 'non_numeric');
}

// No entity at all: pass through with sane defaults.
{
  const result = EntityStatValidator.validateEntityStatValue({
    stat: 'hp',
    value: 50
  });
  assert.equal(result.value, 50, 'no entity means no cap, accept value as-is');
  assert.equal(result.capReason, null);
}

console.log('entity stat validator tests OK');
