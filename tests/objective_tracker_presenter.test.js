#!/usr/bin/env node
const assert = require('assert');

const ObjectiveTrackerPresenter = require('../js/core/objectiveTrackerPresenter.js');

{
  const items = ObjectiveTrackerPresenter.buildObjectiveItems({
    quests: {
      a: { title: 'Far errand', objective: 'Walk north', status: 'active', deadlineDay: 30, urgency: 'low' },
      b: { title: 'Burning camp', objective: 'Bring medicine', status: 'active', deadlineDay: 10, urgency: 'high' },
      c: { title: 'Done', objective: 'Return', status: 'completed', urgency: 'high' }
    },
    worldDay: 10,
    limit: 2,
    language: 'en'
  });

  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Burning camp');
  assert.equal(items[0].badge, 'due today');
  assert.equal(items[1].title, 'Far errand');
}

{
  const items = ObjectiveTrackerPresenter.buildObjectiveItems({
    quests: {
      a: { title: 'Срочно', objective: 'Вернуться', status: 'active', deadlineDay: 4, urgency: 'medium' }
    },
    worldDay: 5,
    language: 'ru'
  });

  assert.equal(items[0].badge, 'просрочено');
  assert.equal(items[0].urgencyLabel, 'срочность: medium');
}

{
  const items = ObjectiveTrackerPresenter.buildObjectiveItems({
    quests: { a: { title: 'Done', status: 'completed' } },
    worldDay: 1
  });

  assert.equal(items.length, 0);
}

console.log('objective tracker presenter tests OK');
