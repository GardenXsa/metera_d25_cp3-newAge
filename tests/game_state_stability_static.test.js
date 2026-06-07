#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const prompt = fs.readFileSync(path.join(root, 'assets/prompts/1.txt'), 'utf8');
const hardProtocol = fs.readFileSync(path.join(root, 'assets/prompts/hard_protocol.txt'), 'utf8');
const styleRules = fs.readFileSync(path.join(root, 'assets/prompts/style_rules.txt'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.match(index, /js\/core\/gmResponseContract\.js/, 'index.html should load gmResponseContract before script.js');
assert.match(index, /js\/core\/combatStartGuard\.js/, 'index.html should load combatStartGuard before script.js');
assert.match(index, /js\/core\/scenePressureClock\.js/, 'index.html should load scenePressureClock before script.js');
assert.match(index, /js\/core\/questDeadline\.js/, 'index.html should load questDeadline before script.js');
assert.match(index, /js\/core\/travelChoiceRouter\.js/, 'index.html should load travelChoiceRouter before script.js');
assert.match(index, /js\/core\/entityStatValidator\.js/, 'index.html should load entityStatValidator before script.js');
assert.match(index, /js\/core\/skillCostResolver\.js/, 'index.html should load skillCostResolver before script.js');
assert.match(index, /js\/core\/suggestedActionPresenter\.js/, 'index.html should load suggestedActionPresenter before script.js');
assert.match(index, /js\/core\/combatTurnPresenter\.js/, 'index.html should load combatTurnPresenter before script.js');
assert.match(index, /js\/core\/levelProgressionPresenter\.js/, 'index.html should load levelProgressionPresenter before script.js');
assert.match(index, /js\/core\/objectiveTrackerPresenter\.js/, 'index.html should load objectiveTrackerPresenter before script.js');
assert.match(index, /js\/core\/combatIntentResolver\.js/, 'index.html should load combatIntentResolver before script.js');
assert.match(index, /id="combat-hud"/, 'index.html should include a combat HUD container');
assert.match(index, /id="level-up-banner"/, 'index.html should include a level-up banner container');
assert.match(index, /id="progression-assistant"/, 'index.html should include a progression assistant container');
assert.match(index, /id="objective-tracker"/, 'index.html should include an objective tracker container');

assert.match(script, /normalizeParsedAIResponse/, 'script.js should normalize parsed GM responses through the contract helper');
assert.match(script, /renderCombatHud/, 'script.js should render a combat HUD from currentCombat');
assert.match(script, /evaluateCombatStartCommand/, 'script.js should apply the combat start guard');
assert.match(script, /showLevelUpBanner/, 'script.js should surface level-up as a visible banner');
assert.match(script, /updateScenePressureClock/, 'script.js should update the scene pressure clock after GM turns');
assert.match(script, /buildScenePressurePromptPatch/, 'script.js should inject scene pressure prompt patches into dynamic context');
assert.match(script, /buildQuestDeadlinePromptPatch/, 'script.js should inject quest deadline prompt patches into dynamic context');
assert.match(script, /deadlineDay/, 'script.js should persist quest deadline metadata on quests');
assert.match(script, /"world_day":/, 'script.js should expose the absolute world day to the GM snapshot');
assert.match(script, /SuggestedActionPresenter/, 'script.js should render suggested actions through the presenter helper');
assert.match(script, /CombatTurnPresenter/, 'script.js should render combat state through the presenter helper');
assert.match(script, /selectedCombatTargetId/, 'combat HUD should remember the selected target');
assert.match(script, /data-combat-selected="\$\{isSelected \? 'true' : 'false'\}"/, 'combat HUD should mark the selected target in markup');
assert.match(script, /hud\.querySelectorAll\('\[data-target-id\]'\)/, 'combat HUD should bind target-card click handlers');
assert.match(script, /submitCombatHudAction\(action, selectedTargetId\)/, 'combat HUD actions should use the selected target');
assert.match(script, /LevelProgressionPresenter/, 'script.js should render progression state through the presenter helper');
assert.match(script, /ObjectiveTrackerPresenter/, 'script.js should render active quest objectives through the presenter helper');
assert.match(script, /CombatIntentResolver/, 'script.js should pass structured combat intents to GM turns');
assert.match(script, /TravelChoiceRouter/, 'script.js should integrate with TravelChoiceRouter for travel events');
assert.match(script, /EntityStatValidator/, 'script.js should validate entity stat updates through EntityStatValidator');
assert.match(script, /SkillCostResolver/, 'script.js should resolve skill costs through SkillCostResolver (no MP for non-mages)');
assert.match(script, /showTravelRoutePicker/, 'script.js should provide a travel route picker');
assert.match(index, /id="travel-route-picker"/, 'index.html should include a travel route picker modal');
assert.match(index, /id="travel-route-options"/, 'index.html should include the travel route options list');
assert.match(index, /id="journey-route-badge"/, 'index.html should include the journey route badge');
assert.match(script, /slot-bonus-line/, 'script.js should render a compact bonus line on equipped slots');
assert.match(script, /lastEnemyTurn/, 'script.js should capture last enemy turn into player.currentCombat for HUD rendering');
assert.match(script, /describeEnemyTurn/, 'script.js should surface enemy turn summary through CombatTurnPresenter');
assert.match(script, /getPromptFilePath\('hard_protocol'/, 'script.js should load the hard_protocol layer first in prepareUnifiedPrompt');
assert.match(script, /getPromptFilePath\('style_rules'/, 'script.js should load the style_rules layer at the end of prepareUnifiedPrompt');

assert.match(prompt, /HARD PROTOCOL moved to assets\/prompts\/hard_protocol\.txt/, 'master prompt should reference the extracted hard_protocol layer');
assert.match(prompt, /scene_state/, 'master prompt should mention scene_state as a routing marker (the JSON contract lives in hard_protocol.txt)');
assert.match(prompt, /setCombatState/, 'master prompt should still expose setCombatState for the GM');

// 3-layer split
assert.match(hardProtocol, /HARD PROTOCOL/i, 'hard_protocol.txt should hold the JSON contract layer');
assert.match(hardProtocol, /scene_state/, 'hard_protocol.txt should document scene_state');
assert.match(hardProtocol, /deadlineDay/, 'hard_protocol.txt should document quest deadline metadata');
assert.match(hardProtocol, /setCombatState/, 'hard_protocol.txt should document the combat-start rule');
assert.match(hardProtocol, /HP\/Stat mutation contract/i, 'hard_protocol.txt should document the HP mutation contract (no double-application)');
assert.match(styleRules, /SPARK/i, 'style_rules.txt should contain the SPARK directive');
assert.match(styleRules, /BORING IS A SIN/i, 'style_rules.txt should contain the BORING IS A SIN directive');
assert.doesNotMatch(prompt, /### ДИРЕКТИВА: THE SPARK/i, 'master prompt should not duplicate the SPARK directive (moved to style_rules)');
assert.doesNotMatch(prompt, /### ДИРЕКТИВА: BORING IS A SIN/i, 'master prompt should not duplicate the BORING IS A SIN directive (moved to style_rules)');

assert.match(pkg.scripts['test:unit'], /tests\/gm_response_contract\.test\.js/, 'unit tests should include GM response contract tests');
assert.match(pkg.scripts['test:unit'], /tests\/combat_start_guard\.test\.js/, 'unit tests should include combat start guard tests');
assert.match(pkg.scripts['test:unit'], /tests\/scene_pressure_clock\.test\.js/, 'unit tests should include scene pressure clock tests');
assert.match(pkg.scripts['test:unit'], /tests\/quest_deadline\.test\.js/, 'unit tests should include quest deadline tests');
assert.match(pkg.scripts['test:unit'], /tests\/suggested_action_presenter\.test\.js/, 'unit tests should include suggested action presenter tests');
assert.match(pkg.scripts['test:unit'], /tests\/combat_turn_presenter\.test\.js/, 'unit tests should include combat turn presenter tests');
assert.match(pkg.scripts['test:unit'], /tests\/level_progression_presenter\.test\.js/, 'unit tests should include level progression presenter tests');
assert.match(pkg.scripts['test:unit'], /tests\/objective_tracker_presenter\.test\.js/, 'unit tests should include objective tracker presenter tests');
assert.match(pkg.scripts['test:unit'], /tests\/combat_intent_resolver\.test\.js/, 'unit tests should include combat intent resolver tests');
assert.match(pkg.scripts['test:unit'], /tests\/travel_choice_router\.test\.js/, 'unit tests should include travel choice router tests');
assert.match(pkg.scripts['test:unit'], /tests\/entity_stat_validator\.test\.js/, 'unit tests should include entity stat validator tests');
assert.match(pkg.scripts['test:unit'], /tests\/skill_cost_resolver\.test\.js/, 'unit tests should include skill cost resolver tests');
assert.match(pkg.scripts['test:unit'], /tests\/game_state_stability_static\.test\.js/, 'unit tests should include stability static tests');

console.log('game state stability static tests OK');
