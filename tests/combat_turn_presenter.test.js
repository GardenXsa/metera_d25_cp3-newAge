#!/usr/bin/env node
const assert = require('assert');

const CombatTurnPresenter = require('../js/core/combatTurnPresenter.js');

{
  const summary = CombatTurnPresenter.buildCombatSummary({
    combat: { isActive: true, participants: ['bandit', 'wounded_guard', 'missing'] },
    entities: {
      bandit: { name: 'Road Bandit', type: 'npc', disposition: 'hostile', stats: { hp: 12, maxHp: 20 } },
      wounded_guard: { name: 'Wounded Guard', type: 'npc', disposition: 'neutral', stats: { hp: 0, maxHp: 10 } }
    },
    language: 'en'
  });

  assert.equal(summary.isActive, true);
  assert.equal(summary.totalCount, 3);
  assert.equal(summary.visibleCount, 2);
  assert.equal(summary.aliveCount, 1);
  assert.equal(summary.defeatedCount, 1);
  assert.equal(summary.primaryTargetId, 'bandit');
  assert.equal(summary.statusLabel, 'Your move');
  assert.equal(summary.participants[0].state, 'alive');
  assert.equal(summary.participants[1].state, 'defeated');
}

{
  const summary = CombatTurnPresenter.buildCombatSummary({
    combat: { isActive: true, participants: ['shade'] },
    entities: {
      shade: { name: 'Тень', hp: 3, maxHp: 6 }
    },
    language: 'ru'
  });

  assert.equal(summary.statusLabel, 'Ваш ход');
  assert.equal(summary.participants[0].hpLabel, '3/6');
}

{
  const summary = CombatTurnPresenter.buildCombatSummary({
    combat: { isActive: false, participants: ['bandit'] },
    entities: {},
    language: 'en'
  });

  assert.equal(summary.isActive, false);
  assert.equal(summary.participants.length, 0);
}

{
  // describeEnemyTurn: hit case
  const result = CombatTurnPresenter.describeEnemyTurn({
    lines: ['Bandit rolled 14 vs AC 13 — hit for 5 dmg', 'Wolf rolled 8 vs AC 13 — miss'],
    totalDamage: 5,
    dodgedAll: false
  }, 'en');
  assert.ok(result, 'should return block on hit');
  assert.equal(result.title, 'Enemy turn');
  assert.equal(result.summary, 'Damage taken: 5');
  assert.equal(result.totalDamage, 5);
  assert.equal(result.lines.length, 2);
}

{
  // describeEnemyTurn: dodged case
  const result = CombatTurnPresenter.describeEnemyTurn({
    lines: ['Bandit rolled 4 — miss', 'Wolf rolled 6 — miss'],
    totalDamage: 0,
    dodgedAll: false
  }, 'en');
  assert.equal(result.title, 'Enemy turn — dodged');
  assert.equal(result.dodgedAll, true);
}

{
  // describeEnemyTurn: ru locale
  const result = CombatTurnPresenter.describeEnemyTurn({
    lines: ['Разбойник попал на 7'],
    totalDamage: 7
  }, 'ru');
  assert.equal(result.title, 'Ход врагов');
  assert.equal(result.summary, 'Получено урона: 7');
}

{
  // describeEnemyTurn: empty -> null
  assert.equal(CombatTurnPresenter.describeEnemyTurn({ lines: [], totalDamage: 0 }), null);
  assert.equal(CombatTurnPresenter.describeEnemyTurn(null), null);
}

console.log('combat turn presenter tests OK');
