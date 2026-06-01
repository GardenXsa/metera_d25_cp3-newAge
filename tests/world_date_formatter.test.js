#!/usr/bin/env node
const assert = require('assert');
const path = require('path');

const { formatWorldDay } = require(path.resolve(__dirname, '../js/core/worldDateFormatter.js'));

assert.strictEqual(formatWorldDay(0), 'Год 1, месяц 1, день 1');
assert.strictEqual(formatWorldDay(29), 'Год 1, месяц 1, день 30');
assert.strictEqual(formatWorldDay(30), 'Год 1, месяц 2, день 1');
assert.strictEqual(formatWorldDay(359), 'Год 1, месяц 12, день 30');
assert.strictEqual(formatWorldDay(360), 'Год 2, месяц 1, день 1');
assert.strictEqual(formatWorldDay(357573), 'Год 994, месяц 4, день 4');
assert.strictEqual(formatWorldDay(null), 'Дата неизвестна');
assert.strictEqual(formatWorldDay('bad'), 'Дата неизвестна');

console.log('world date formatter tests OK');
