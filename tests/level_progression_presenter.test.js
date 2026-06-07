#!/usr/bin/env node
const assert = require('assert');

const LevelProgressionPresenter = require('../js/core/levelProgressionPresenter.js');

{
  const summary = LevelProgressionPresenter.buildProgressionSummary({
    stats: { level: 3, xp: 40, xpNext: 100, statPoints: 2, str: 12, dex: 10, int: 8, con: 11, cha: 9, res: 10 },
    class: 'warrior'
  }, 'en');

  assert.equal(summary.hasUnspentPoints, true);
  assert.equal(summary.points, 2);
  assert.equal(summary.xpPct, 40);
  assert.equal(summary.recommendations[0].stat, 'str');
  assert.equal(summary.recommendations[1].stat, 'con');
  assert.match(summary.title, /2/);
}

{
  const summary = LevelProgressionPresenter.buildProgressionSummary({
    stats: { level: 2, xp: 0, xpNext: 200, statPoints: 1, int: 14, con: 10 },
    class: 'mage'
  }, 'ru');

  assert.equal(summary.recommendations[0].stat, 'int');
  assert.equal(summary.recommendations[0].label, 'Интеллект');
  assert.match(summary.title, /1/);
}

{
  const summary = LevelProgressionPresenter.buildProgressionSummary({
    stats: { level: 1, xp: 0, xpNext: 100, statPoints: 0 },
    class: 'rogue'
  }, 'en');

  assert.equal(summary.hasUnspentPoints, false);
  assert.equal(summary.recommendations.length, 0);
}

console.log('level progression presenter tests OK');
