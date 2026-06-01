# Turn Intent Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a JSON-driven deterministic intent router that keeps free-form input while blocking impossible AI simulation commands.

**Architecture:** `data/intent_registry.json` stores language markers, conflict messages, and state guards. `js/core/turnIntentRouter.js` provides pure routing and guard functions. `script.js` loads the registry, appends prompt patches for state conflicts, and blocks unsafe AI commands before execution.

**Tech Stack:** Browser JavaScript, Node-based unit tests, existing Electron script loading.

---

### Task 1: Router Unit Tests

**Files:**
- Create: `tests/turn_intent_router.test.js`

- [ ] Write tests that load `js/core/turnIntentRouter.js`.
- [ ] Assert combat-state extraction from a minimal `player` object.
- [ ] Assert Russian travel text during active combat resolves as `combat_escape`.
- [ ] Assert English travel outside combat resolves as allowed travel.
- [ ] Assert unknown text is pass-through.
- [ ] Assert `startTravel` and `setLocation` are blocked during active combat with living hostiles.

### Task 2: Intent Registry

**Files:**
- Create: `data/intent_registry.json`

- [ ] Add `version`.
- [ ] Add language fallback order.
- [ ] Add broad intent markers for `travel`, `escape`, `combat_attack`, `dialogue`, `inspect`, `inventory`, and `party_command`.
- [ ] Add guard `no_travel_during_active_combat`.
- [ ] Add localized messages for Russian and English.

### Task 3: Router Module

**Files:**
- Create: `js/core/turnIntentRouter.js`

- [ ] Export `buildTurnState`.
- [ ] Export `classifyPlayerIntent`.
- [ ] Export `resolveIntentForState`.
- [ ] Export `routePlayerInput`.
- [ ] Export `guardActions`.
- [ ] Export `loadRegistry`.
- [ ] Support browser global `window.TurnIntentRouter` and Node `module.exports`.

### Task 4: Browser Integration

**Files:**
- Modify: `index.html`
- Modify: `script.js`

- [ ] Load `js/core/turnIntentRouter.js` before `script.js`.
- [ ] Initialize the registry from `data/intent_registry.json`.
- [ ] Route normal player input before the unified AI request.
- [ ] Append router prompt patch to `finalInput`, preserving original user text in conversation history.
- [ ] Guard AI actions before `validateActionsArray` and before execution.
- [ ] Log blocked commands as command feedback.

### Task 5: Verification

**Files:**
- Modify: `package.json` if needed to include the new unit test in `test:unit`.

- [ ] Run `node tests/turn_intent_router.test.js`.
- [ ] Run `node -c js/core/turnIntentRouter.js`.
- [ ] Run `node -c script.js`.
- [ ] Run `npm run test:unit`.

