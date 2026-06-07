# Objective Tracker Right Sidebar Design

## Goal

Move the "Current objectives" tracker out of the central game flow and place it at the top of the right sidebar, above the full quest list.

## Chosen Layout

The objective tracker should render in the right sidebar before the existing quests panel. It remains visible as a compact summary of the highest-priority active objectives, while the central column keeps focus on the game log, combat HUD, suggestions, and player input.

## Scope

- Move the existing `#objective-tracker` element from `.game-content` to `.right-sidebar`.
- Place it before the `.quests` panel.
- Keep the current `renderObjectiveTracker()` behavior and `ObjectiveTrackerPresenter.buildObjectiveItems()` data rules unchanged.
- Keep the current limit of 3 displayed objectives.
- Preserve the existing hide/show behavior when no active objective exists.

## Styling

The tracker should keep its compact card styling. CSS may be adjusted only enough to fit the right sidebar cleanly, using normal document flow rather than sticky positioning.

## Testing

Run the focused objective tracker test to confirm presenter behavior is unchanged. Because this is a layout move, also inspect the edited markup/CSS for ID uniqueness and right-sidebar placement.
