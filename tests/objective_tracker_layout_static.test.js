#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const trackerMatches = html.match(/id="objective-tracker"/g) || [];

assert.equal(trackerMatches.length, 1, 'objective tracker should have exactly one DOM node');

const rightSidebarStart = html.indexOf('<aside class="sidebar right-sidebar">');
assert.notEqual(rightSidebarStart, -1, 'right sidebar should exist');

const trackerIndex = html.indexOf('id="objective-tracker"', rightSidebarStart);
const questsIndex = html.indexOf('class="panel quests collapsible-panel"', rightSidebarStart);

assert.notEqual(trackerIndex, -1, 'objective tracker should be inside the right sidebar');
assert.notEqual(questsIndex, -1, 'quests panel should be inside the right sidebar');
assert.ok(trackerIndex < questsIndex, 'objective tracker should render above the quests panel');

console.log('objective tracker layout static test OK');
