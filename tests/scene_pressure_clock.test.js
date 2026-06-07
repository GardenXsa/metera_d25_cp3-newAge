#!/usr/bin/env node
const assert = require('assert');

const ScenePressureClock = require('../js/core/scenePressureClock.js');

{
  let clock = ScenePressureClock.update(null, {
    scene_state: { mode: 'exploration', pressure: 'none', reason: 'looked_around' },
    actions: [],
    turn: 1
  });
  clock = ScenePressureClock.update(clock, {
    scene_state: { mode: 'dialogue', pressure: 'low', reason: 'small_talk' },
    actions: [],
    turn: 2
  });
  clock = ScenePressureClock.update(clock, {
    scene_state: { mode: 'exploration', pressure: 'none', reason: 'waited' },
    actions: [],
    turn: 3
  });

  assert.equal(clock.quietTurns, 3);
  assert.equal(ScenePressureClock.shouldNudge(clock), true);
  assert.match(ScenePressureClock.buildPromptPatch(clock, 'en'), /SCENE PRESSURE CLOCK/);
  assert.doesNotMatch(ScenePressureClock.buildPromptPatch(clock, 'en'), /start combat/i);
}

{
  const clock = ScenePressureClock.update({ quietTurns: 3 }, {
    scene_state: { mode: 'combat', pressure: 'high', reason: 'ambush' },
    actions: [{ command: 'setCombatState', args: { isActive: true } }],
    turn: 4
  });

  assert.equal(clock.quietTurns, 0);
  assert.equal(clock.lastStimulusReason, 'combat:ambush');
  assert.equal(ScenePressureClock.shouldNudge(clock), false);
}

{
  const clock = ScenePressureClock.update({ quietTurns: 2 }, {
    scene_state: { mode: 'exploration', pressure: 'none', reason: 'found_clue' },
    actions: [{ command: 'addQuest', args: { title: 'Find the missing scout' } }],
    turn: 5
  });

  assert.equal(clock.quietTurns, 0);
  assert.equal(clock.lastStimulusReason, 'command:addQuest');
}

{
  const clock = { quietTurns: 4, lastMode: 'exploration' };
  assert.match(ScenePressureClock.buildPromptPatch(clock, 'ru'), /PRESSURE CLOCK/);
  assert.match(ScenePressureClock.buildPromptPatch(clock, 'ru'), /РќРµ РЅР°С‡РёРЅР°Р№ Р±РѕР№|Не начинай бой/);
}

console.log('scene pressure clock tests OK');
