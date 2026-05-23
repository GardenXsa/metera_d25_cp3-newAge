# Remaining `meterea_engine.cpp` Backlog

Date: `2026-05-22`

This file is intended as a handoff note for the next agent/session.

## What was completed before this handoff

- Food cluster moved off inline `bread/meat/fish/wheat` logic into tag/property helpers.
- Bootstrap/raw-resource/facility-seed cluster moved into helper layer.
- Legacy save raw-resource fallback now reuses shared resource inference helper.
- `processMonthlyBusinesses()` no longer hardcodes extractor output lists inline.
- `processFarmers/Gatherers/Artisans/Mages/Services` no longer keep their main profession/facility/race branches inline; most of that logic now goes through helper functions.

## Verification status

- `py -3 engine/test_food_cluster_refactor.py` — pass
- `py -3 engine/test_bootstrap_cluster_refactor.py` — pass
- `py -3 engine/test_legacy_resource_and_business_refactor.py` — pass
- `py -3 engine/test_profession_cluster_refactor.py` — pass
- `g++ -std=c++17 -O0 -g0 -fsyntax-only engine/meterea_engine.cpp` — blocked by `cc1plus.exe` OOM in this environment

## Remaining work

### 1. NPC consumption still has legacy food fallback

- Around `meterea_engine.cpp:3688`
- Still checks literal `bread` in the NPC food-selection path.
- Needs to use the same tag-driven food resolver used in the newer food helpers.

### 2. Currency/weight/item bootstrap remnants

- Around `4169`, `5409`
- Still has special-case handling for `gold_ingot` weight/value behavior in business and production code.
- Should move to currency/item-property accessors instead of literal ID checks.

### 3. Region economy / repair / reserve logic still contains item literals

- Around `5208`, `5350-5459`
- Literal branches still reference:
  - `weapons`
  - `boards`
  - `gold_ingot`
- This block covers repairs, taxation output, reserve/maintenance logic, and should be converted to tags/properties/rule descriptors.

### 4. State / military / siege supply logic still uses literal goods

- Around:
  - `5944`
  - `6372-6395`
  - `8038`, `8173`, `8237-8238`
  - `8716-8724`
  - `8841-8842`
  - `9088-9096`
- Still directly references combinations of:
  - `bread`
  - `weapons`
  - `gold_ingot`
- This should be moved to semantic supply/currency/item tags.

### 5. Naval / shipbuilding / port upgrade logic is still partially literal-driven

- Around:
  - `6165-6169`
  - `8575-8691`
- Still has explicit material bundles using:
  - `boards`
  - `cloth`
  - `stone`
  - `gold_ingot`
- Needs world/bootstrap/build rules or facility tags/material descriptors.

### 6. Trade / diplomacy / external payments still use direct `gold_ingot`

- Around:
  - `7369`
  - `7478-7481`
  - `7632`
  - `9679-9682`
  - `10157-10162`
  - `10563-10565`
  - `11120-11129`
- Replace with tag-based currency resolution and possibly treasury helpers.

### 7. Legacy profession assignment still writes English display names into NPCs

- Around `9782-9799`
- Still assigns:
  - `Farmer`
  - `Hunter`
  - `Beekeeper`
  - `Fisherman`
  - `Blacksmith`
  - `Weaver`
  - `Baker`
  - `Jeweler`
  - `Alchemist`
  - `Tailor`
  - `Astronomer`
  - `Merchant`
  - `Mercenary`
  - `Cleric`
- This should be rewritten to store profession IDs only, with any legacy display-name recovery kept in a tiny migration adapter.

### 8. Leadership / naval role checks still rely on profession name literals

- Around:
  - `6013`
  - `6284`
- Still checks `Адмирал`, `Моряк`, `Генерал`.
- Should move to profession IDs, profession types, or `special_abilities`.

### 9. Service-business luxury logic is still hardcoded

- Around `6855-6869`
- `brothels` / `bathhouses` still map directly to:
  - `aphrodisiac`
  - `lingerie`
  - `perfume`
- Needs service tags or business consumption descriptors in data.

### 10. Helper-layer legacy mappings still remain and should eventually be externalized

- `inferRegionRawResourcesLegacy(...)`
- `inferLegacyPlacementTypeFromRegionName(...)`
- `getLegacyCraftFacilityForProfession(...)`
- `getNpcFacilityRaceModifier(...)` legacy fallback section
- These are acceptable migration shims for now, but they are still temporary hardcoded policy.

### 11. Profession-driven production is cleaner, but not fully data-native yet

- `processArtisans()` still depends on `getLegacyCraftFacilityForProfession(...)`
- `processMages()` still prefers the `alchemists -> potions` recipe path
- `processServices()` still uses `isClericSupplyItem(...)` preferred IDs
- Next step is to move these helpers onto explicit data fields:
  - allowed facilities
  - profession output preferences
  - profession shopping/service input preferences

## Recommended next implementation order

1. Replace legacy English profession assignment at `9782-9799` with profession IDs only.
2. Refactor the remaining `bread/weapons/gold_ingot` military/state supply cluster.
3. Refactor naval/port/shipbuilding material bundles.
4. Externalize helper-layer migration fallbacks into runtime data where schema support exists.
