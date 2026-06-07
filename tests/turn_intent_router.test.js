#!/usr/bin/env node
const assert = require('assert');

const TurnIntentRouter = require('../js/core/turnIntentRouter.js');
const actualRegistry = require('../data/intent_registry.json');

const registry = {
  version: 1,
  languages: {
    default: 'en',
    fallbackOrder: ['ru', 'en']
  },
  intents: {
    travel: {
      markers: {
        ru: ['отправляемся', 'идем', 'иду', 'путешествуем'],
        en: ['go to', 'travel to', 'head to', 'leave for']
      }
    },
    escape: {
      markers: {
        ru: ['бежим', 'отступаем', 'прорываемся'],
        en: ['run', 'retreat', 'escape', 'break through']
      }
    },
    combat_attack: {
      markers: {
        ru: ['атакую', 'бью'],
        en: ['attack', 'hit']
      }
    }
  },
  guards: [
    {
      id: 'no_travel_during_active_combat',
      when: { combatActive: true, hostilesAlive: true },
      blockCommands: ['startTravel', 'setLocation'],
      conflictingIntents: ['travel'],
      reinterpretAs: 'combat_escape',
      promptPatchKey: 'intent.prompt.travelDuringCombat',
      noticeKey: 'intent.notice.travelDuringCombat'
    }
  ],
  messages: {
    ru: {
      'intent.prompt.travelDuringCombat': 'Игрок хочет переместиться, но бой активен. Не выполняй обычное путешествие; трактуй это как попытку прорыва или отступления в бою.',
      'intent.notice.travelDuringCombat': 'Вы в бою. Обычное путешествие недоступно, но можно попытаться прорваться или отступить.'
    },
    en: {
      'intent.prompt.travelDuringCombat': 'The player wants to travel, but combat is active. Do not perform ordinary travel; treat it as a combat escape or withdrawal attempt.',
      'intent.notice.travelDuringCombat': 'You are in combat. Ordinary travel is unavailable, but you can try to break through or withdraw.'
    }
  }
};

function makeCombatPlayer() {
  return {
    location: 'ash_camp',
    currentCombat: { isActive: true, participants: ['inq_scout'] },
    visibleEntities: {
      inq_scout: { name: 'Inquisitorial Scout', isHostile: true, hp: 12, maxHp: 12 }
    }
  };
}

{
  const state = TurnIntentRouter.buildTurnState(makeCombatPlayer());
  assert.equal(state.combatActive, true);
  assert.equal(state.hostilesAlive, true);
  assert.deepEqual(state.livingHostileIds, ['inq_scout']);
}

{
  const routed = TurnIntentRouter.routePlayerInput('МЫ отправляемся на АКВИЛОН!', {
    player: makeCombatPlayer(),
    registry,
    language: 'ru'
  });
  assert.equal(routed.intent.type, 'travel');
  assert.equal(routed.resolution.allowed, false);
  assert.equal(routed.resolution.reinterpretAs, 'combat_escape');
  assert.match(routed.promptPatch, /попытку прорыва/);
  assert.match(routed.notice, /Вы в бою/);
}

{
  const routed = TurnIntentRouter.routePlayerInput('We travel to Aquilon', {
    player: { location: 'ash_camp', currentCombat: { isActive: false }, visibleEntities: {} },
    registry,
    language: 'en'
  });
  assert.equal(routed.intent.type, 'travel');
  assert.equal(routed.resolution.allowed, true);
  assert.equal(routed.promptPatch, '');
}

{
  const routed = TurnIntentRouter.routePlayerInput('Смотрю на дым над ущельем', {
    player: makeCombatPlayer(),
    registry,
    language: 'ru'
  });
  assert.equal(routed.intent.type, 'unknown');
  assert.equal(routed.resolution.allowed, true);
  assert.equal(routed.promptPatch, '');
}

{
  const guarded = TurnIntentRouter.guardActions([
    { command: 'startTravel', args: { destinationId: 'capital_aquilon' } },
    { command: 'setLocation', args: { locationName: 'capital_aquilon' } },
    { command: 'updateStat', args: { stat: 'hp', change: -1 } }
  ], {
    player: makeCombatPlayer(),
    registry,
    language: 'en'
  });
  assert.deepEqual(guarded.safeActions, [
    { command: 'updateStat', args: { stat: 'hp', change: -1 } }
  ]);
  assert.equal(guarded.blockedActions.length, 2);
  assert.match(guarded.blockedActions[0].message, /combat/);
}

{
  const routed = TurnIntentRouter.routePlayerInput('МЫ отправляемся на АКВИЛОН!', {
    player: makeCombatPlayer(),
    registry: actualRegistry,
    language: 'ru'
  });
  assert.equal(routed.intent.type, 'travel');
  assert.equal(routed.resolution.allowed, false);
  assert.equal(routed.resolution.reinterpretAs, 'combat_escape');
  assert.match(routed.notice, /Вы в бою/);
}

console.log('turn intent router tests OK');
