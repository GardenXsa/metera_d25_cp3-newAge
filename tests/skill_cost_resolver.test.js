#!/usr/bin/env node
const assert = require('assert');

const SkillCostResolver = require('../js/core/skillCostResolver.js');

// Non-mage + MP skill: must be free
{
  const skill = { cost: 5, costType: 'MP' };
  const player = { class: 'warrior', stats: { mana: 0, hp: 100 } };
  const cost = SkillCostResolver.resolveSkillCost(skill, player);
  assert.equal(cost.cost, 0, 'non-mage MP skill is free');
  assert.equal(cost.currency, 'none');
  assert.equal(cost.reason, 'non_mage_mp_ignored');

  const afford = SkillCostResolver.canAffordSkill(skill, player);
  assert.equal(afford.ok, true, 'non-mage can always afford MP skill');
}

// Non-mage + HP skill: deducts HP normally
{
  const skill = { cost: 8, costType: 'HP' };
  const player = { class: 'warrior', stats: { hp: 50 } };
  const cost = SkillCostResolver.resolveSkillCost(skill, player);
  assert.equal(cost.cost, 8);
  assert.equal(cost.currency, 'hp');

  const deduction = SkillCostResolver.computeCostDeduction(skill, player);
  assert.deepEqual(deduction, { stat: 'hp', change: -8 });

  const afford = SkillCostResolver.canAffordSkill(skill, player);
  assert.equal(afford.ok, true, 'hp 50 > 8');
}

// Non-mage + HP cost > current HP: cannot afford
{
  const skill = { cost: 50, costType: 'HP' };
  const player = { class: 'warrior', stats: { hp: 20 } };
  const afford = SkillCostResolver.canAffordSkill(skill, player);
  assert.equal(afford.ok, false);
  assert.equal(afford.reason, 'insufficient_hp');
}

// Mage + MP skill: deducts mana normally
{
  const skill = { cost: 10, costType: 'MP' };
  const player = { class: 'mage', stats: { mana: 30, hp: 50 } };
  const cost = SkillCostResolver.resolveSkillCost(skill, player);
  assert.equal(cost.cost, 10);
  assert.equal(cost.currency, 'mp');

  const afford = SkillCostResolver.canAffordSkill(skill, player);
  assert.equal(afford.ok, true);

  const deduction = SkillCostResolver.computeCostDeduction(skill, player);
  assert.deepEqual(deduction, { stat: 'mana', change: -10 });
}

// Mage + MP cost > current mana: cannot afford
{
  const skill = { cost: 50, costType: 'MP' };
  const player = { class: 'mage', stats: { mana: 20, hp: 50 } };
  const afford = SkillCostResolver.canAffordSkill(skill, player);
  assert.equal(afford.ok, false);
  assert.equal(afford.reason, 'insufficient_mana');
}

// No cost: free for everyone
{
  const skill = { cost: 0, costType: null };
  const player = { class: 'warrior', stats: { hp: 100 } };
  const cost = SkillCostResolver.resolveSkillCost(skill, player);
  assert.equal(cost.cost, 0);
  assert.equal(cost.currency, 'none');
}

// Cyrillic costType variants
{
  const variants = [
    { costType: 'Мана', expected: 'mp' },
    { costType: 'MP', expected: 'mp' },
    { costType: 'mana', expected: 'mp' },
    { costType: 'Очки маны', expected: 'mp' },
    { costType: 'HP', expected: 'hp' },
    { costType: 'Здоровье', expected: 'hp' },
    { costType: 'Stamina', expected: 'stamina' },
    { costType: 'Выносливость', expected: 'stamina' },
    { costType: 'нет', expected: 'none' },
    { costType: 'нет', expected: 'none' },
    { costType: 'none', expected: 'none' },
    { costType: '', expected: 'none' },
    { costType: null, expected: 'none' },
    { costType: 'странно', expected: 'unknown' }
  ];
  for (const v of variants) {
    const got = SkillCostResolver.normalizeCostType(v.costType);
    assert.equal(got, v.expected, `normalizeCostType(${JSON.stringify(v.costType)}) → ${got}, expected ${v.expected}`);
  }
}

// Class variants
{
  assert.equal(SkillCostResolver.isMage({ class: 'mage' }), true);
  assert.equal(SkillCostResolver.isMage({ class: 'Mage' }), true);
  assert.equal(SkillCostResolver.isMage({ class: 'MAGE' }), true);
  assert.equal(SkillCostResolver.isMage({ class: 'warrior' }), false);
  assert.equal(SkillCostResolver.isMage({ class: 'thief' }), false);
  assert.equal(SkillCostResolver.isMage(null), false);
  assert.equal(SkillCostResolver.isMage({}), false);
}

// Non-mage + Mana spell: must be free, regardless of cost value
{
  const skill = { cost: 999, costType: 'MP' };
  const player = { class: 'paladin', stats: { hp: 100 } };
  const cost = SkillCostResolver.resolveSkillCost(skill, player);
  assert.equal(cost.cost, 0, 'paladin with MP skill must not be charged 999');
  assert.equal(cost.currency, 'none');

  const deduction = SkillCostResolver.computeCostDeduction(skill, player);
  assert.equal(deduction, null, 'no deduction for non-mage MP skill');
}

// Stamina cost falls back to HP proxy (stamina not implemented as a stat)
{
  const skill = { cost: 10, costType: 'Выносливость' };
  const player = { class: 'warrior', stats: { hp: 100 } };
  const deduction = SkillCostResolver.computeCostDeduction(skill, player);
  assert.ok(deduction, 'stamina must yield a deduction');
  assert.equal(deduction.stat, 'hp');
  assert.ok(deduction.change < 0);
}

console.log('skill cost resolver tests OK');
