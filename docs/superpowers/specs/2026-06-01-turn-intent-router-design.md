# Turn Intent Router Design

## Goal

Add a deterministic layer between free-form player text and AI-issued simulation commands. The layer must keep the freedom of text input while preventing hidden state conflicts such as "travel during active combat" from becoming confusing punishment or invalid world updates.

## Requirements

- The router must not call another AI model.
- Intent detection must be data-driven through JSON, not hardcoded language lists in JavaScript.
- The router must support multiple languages through registry entries and must degrade safely when text is not recognized.
- The router must not enumerate every possible player action. It only detects broad intent classes such as travel, escape, combat, dialogue, inspect, inventory, and command.
- The router must validate AI action commands independently of player language.
- Active combat with living hostiles must block normal travel/location commands and reinterpret player travel intent as combat escape or withdrawal.

## Architecture

Create `data/intent_registry.json` as the declarative registry. It defines supported intent markers per language, state guards, and player-facing/prompt messages.

Create `js/core/turnIntentRouter.js` as the deterministic engine. It exposes pure functions for state extraction, intent classification, intent resolution, prompt patch generation, and AI action guarding. The module works in both browser and Node tests.

Integrate the router in `script.js` at two points:

1. Before normal AI turns, analyze player input and append a compact system patch to the final AI input when state conflicts exist.
2. After AI returns actions and before validation/execution, guard unsafe commands such as `startTravel` and `setLocation` during active combat.

## Data Flow

Player text enters `sendApiRequest`. For non-initial turns, `TurnIntentRouter.routePlayerInput` receives the raw text, current `player`, `currentLanguage`, and the JSON registry. If the input conflicts with state, the router returns a prompt patch and optional player notice. The prompt patch is appended to the AI input, while the original player message remains in conversation history.

After parsing the AI response, `TurnIntentRouter.guardActions` checks command actions against state guards. Blocked actions are removed from execution and recorded as system feedback. Safe actions continue through existing validation and execution.

## Error Handling

If the registry is missing or malformed, the router falls back to pass-through input and still allows command guarding only when a valid built-in guard definition exists. If classification confidence is low, it does not block player intent. If action guarding blocks a command, the game shows a concise system message instead of executing an impossible state transition.

## Testing

Add Node tests for:

- Russian travel input during active combat becomes `combat_escape` and does not allow normal travel.
- English travel input outside combat is allowed.
- Unknown text is passed through without forced classification.
- AI `startTravel` and `setLocation` commands are blocked while combat is active and hostiles are alive.
- Non-travel combat commands remain allowed.

