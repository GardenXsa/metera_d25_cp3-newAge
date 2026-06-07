#!/usr/bin/env node
const assert = require('assert');

const TravelChoiceRouter = require('../js/core/travelChoiceRouter.js');

{
  const options = TravelChoiceRouter.getRouteOptions();
  assert.equal(options.length, 3, 'getRouteOptions must return exactly 3 routes');
  const ids = options.map(o => o.id).sort();
  assert.deepEqual(ids, ['fast', 'profitable', 'safe'], 'route ids should be safe/fast/profitable');
}

{
  const profile = TravelChoiceRouter.getRouteProfile('safe');
  assert.equal(profile.id, 'safe');
  assert.ok(profile.hoursMultiplier > 1, 'safe route must be slower than balanced');
  assert.ok(profile.eventChanceMultiplier < 1, 'safe route must have lower event chance');
}

{
  const profile = TravelChoiceRouter.getRouteProfile('fast');
  assert.ok(profile.hoursMultiplier < 1, 'fast route must be faster than balanced');
  assert.ok(profile.eventChanceMultiplier > 1, 'fast route must have higher event chance');
}

{
  const profile = TravelChoiceRouter.getRouteProfile('profitable');
  assert.ok(profile.lootChanceMultiplier > 1, 'profitable route must boost loot chance');
}

{
  const profile = TravelChoiceRouter.getRouteProfile('garbage_value');
  assert.equal(profile.id, 'balanced', 'unknown route ids fall back to balanced');
  assert.equal(profile.hoursMultiplier, 1.0);
}

{
  const trek = TravelChoiceRouter.applyRouteToTrek({ totalHours: 10 }, 'safe');
  assert.equal(trek.routeId, 'safe');
  assert.equal(trek.totalHours, 14, 'safe route should stretch 10h to 14h');
  assert.equal(trek.riskLabel, 'low');
}

{
  const trek = TravelChoiceRouter.applyRouteToTrek({ totalHours: 10 }, 'fast');
  assert.equal(trek.routeId, 'fast');
  assert.equal(trek.totalHours, 7, 'fast route should shrink 10h to 7h');
  assert.equal(trek.riskLabel, 'high');
}

{
  const trek = TravelChoiceRouter.applyRouteToTrek({}, 'profitable');
  assert.equal(trek.routeId, 'profitable');
  assert.equal(trek.lootChanceMultiplier, 1.5);
}

{
  assert.equal(
    TravelChoiceRouter.evaluateEventCriticality({ object_type: 'river_crossing' }),
    'critical',
    'river crossings are critical by default'
  );
  assert.equal(
    TravelChoiceRouter.evaluateEventCriticality({ object_type: 'shrine' }),
    'noncritical',
    'shrines are noncritical by default'
  );
  assert.equal(
    TravelChoiceRouter.evaluateEventCriticality({ object_type: 'shrine', criticality: 'critical' }),
    'critical',
    'explicit criticality overrides default'
  );
  assert.equal(
    TravelChoiceRouter.evaluateEventCriticality({ object_type: 'bandit', criticality: 'noncritical' }),
    'noncritical',
    'explicit noncritical overrides default'
  );
  assert.equal(
    TravelChoiceRouter.evaluateEventCriticality({ hostile: true }),
    'critical',
    'hostile events are critical even without type'
  );
}

{
  const actions = TravelChoiceRouter.buildEventActions({ object_type: 'shrine', can_interact: true });
  assert.ok(actions.includes('explore'), 'shrine event must offer explore');
  assert.ok(actions.includes('bypass'), 'noncritical shrine must offer bypass');
  assert.ok(actions.includes('continue'), 'noncritical shrine must offer continue');
  assert.ok(!actions.includes('attack'), 'shrine event should not offer attack');
}

{
  const actions = TravelChoiceRouter.buildEventActions({ object_type: 'bandit', can_interact: true });
  assert.ok(actions.includes('attack'), 'bandit event must offer attack');
  assert.ok(actions.includes('negotiate'), 'bandit event must offer negotiate');
  assert.ok(!actions.includes('bypass'), 'critical bandit must NOT offer bypass');
  assert.ok(!actions.includes('continue'), 'critical bandit must NOT offer continue');
}

{
  const actions = TravelChoiceRouter.buildEventActions({
    object_type: 'shrine',
    available_actions: ['explore', 'bypass', 'continue']
  });
  assert.deepEqual(actions, ['explore', 'bypass', 'continue'], 'explicit actions preserved in order');
}

{
  const actions = TravelChoiceRouter.buildEventActions({
    object_type: 'shrine',
    criticality: 'critical',
    available_actions: ['continue', 'bypass', 'explore']
  });
  assert.deepEqual(actions, ['explore'], 'critical event must drop continue/bypass even if explicit');
}

{
  const desc = TravelChoiceRouter.describeRoute('safe', 'ru');
  assert.match(desc.name, /Безопасный/);
  assert.ok(desc.desc.length > 0);

  const descEn = TravelChoiceRouter.describeRoute('fast', 'en');
  assert.match(descEn.name, /Fast/);
}

{
  const verb = TravelChoiceRouter.describeActionVerb('attack', 'ru');
  assert.equal(verb.label, 'Атаковать');
  assert.match(verb.icon, /fa-/);

  const verbEn = TravelChoiceRouter.describeActionVerb('negotiate', 'en');
  assert.equal(verbEn.label, 'Negotiate');
}

console.log('travel choice router tests OK');
