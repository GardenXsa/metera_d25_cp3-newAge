#!/usr/bin/env node
const assert = require('assert');

const QuestDeadline = require('../js/core/questDeadline.js');

{
  const normalized = QuestDeadline.normalizeQuestDeadlineArgs({
    deadlineDay: '12',
    urgency: 'HIGH',
    failureConsequence: 'The convoy leaves without the player.'
  });

  assert.equal(normalized.deadlineDay, 12);
  assert.equal(normalized.urgency, 'high');
  assert.equal(normalized.failureConsequence, 'The convoy leaves without the player.');
}

{
  const normalized = QuestDeadline.normalizeQuestDeadlineArgs({
    deadlineDay: 'soon',
    urgency: 'panic',
    failureConsequence: '   '
  });

  assert.equal(normalized.deadlineDay, null);
  assert.equal(normalized.urgency, null);
  assert.equal(normalized.failureConsequence, '');
}

{
  assert.deepEqual(
    QuestDeadline.describeQuestDeadline({ deadlineDay: 8 }, 6),
    { state: 'future', daysLeft: 2 }
  );
  assert.deepEqual(
    QuestDeadline.describeQuestDeadline({ deadlineDay: 6 }, 6),
    { state: 'due', daysLeft: 0 }
  );
  assert.deepEqual(
    QuestDeadline.describeQuestDeadline({ deadlineDay: 5 }, 6),
    { state: 'overdue', daysLeft: -1 }
  );
  assert.deepEqual(
    QuestDeadline.describeQuestDeadline({ deadlineDay: null }, 6),
    { state: 'none', daysLeft: null }
  );
}

{
  const patch = QuestDeadline.buildDeadlinePromptPatch({
    1: {
      title: 'Deliver the medicine',
      status: 'active',
      deadlineDay: 10,
      urgency: 'high',
      failureConsequence: 'The fever spreads through the camp.'
    },
    2: {
      title: 'Completed errand',
      status: 'completed',
      deadlineDay: 10,
      urgency: 'high'
    },
    3: {
      title: 'Far away',
      status: 'active',
      deadlineDay: 30,
      urgency: 'low'
    }
  }, 10, 'en');

  assert.match(patch, /QUEST DEADLINES/);
  assert.match(patch, /Deliver the medicine/);
  assert.match(patch, /due today/);
  assert.match(patch, /The fever spreads/);
  assert.doesNotMatch(patch, /Completed errand/);
  assert.doesNotMatch(patch, /Far away/);
}

console.log('quest deadline tests OK');
