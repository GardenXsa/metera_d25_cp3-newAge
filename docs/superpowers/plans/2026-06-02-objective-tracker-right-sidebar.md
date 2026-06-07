# Objective Tracker Right Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the current objectives tracker to the top of the right sidebar above the quests panel.

**Architecture:** This is a DOM placement change. `renderObjectiveTracker()` keeps using the same `#objective-tracker` ID and presenter data; only the static HTML location and small sidebar-specific CSS are updated.

**Tech Stack:** Static HTML, CSS, Node.js tests.

---

### Task 1: Static Placement Test

**Files:**
- Create: `tests/objective_tracker_layout_static.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/objective_tracker_layout_static.test.js`
Expected: FAIL because the tracker is currently in `.game-content`, not `.right-sidebar`.

### Task 2: Move Markup And Fit Sidebar

**Files:**
- Modify: `index.html`
- Modify: `style.css`

- [ ] **Step 1: Move the tracker DOM node**

Move:

```html
<div id="objective-tracker" class="objective-tracker" style="display: none;"></div>
```

from `.game-content` to the start of `.right-sidebar`, immediately before:

```html
<div class="panel quests collapsible-panel">
```

- [ ] **Step 2: Add sidebar-specific CSS**

Add:

```css
.right-sidebar .objective-tracker {
    box-sizing: border-box;
    margin: 0 0 12px;
}
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
node tests/objective_tracker_layout_static.test.js
node tests/objective_tracker_presenter.test.js
```

Expected: both PASS.
