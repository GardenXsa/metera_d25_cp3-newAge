#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.match(
  indexHtml,
  /<script src="js\/core\/sceneTagger\.js"><\/script>[\s\S]*<script src="js\/core\/sceneAssetPicker\.js"><\/script>[\s\S]*<script src="script\.js"><\/script>/,
  'index.html should load scene visual modules before script.js'
);

assert.match(
  indexHtml,
  /<script src="js\/core\/ttsTextFilter\.js"><\/script>[\s\S]*<script src="script\.js"><\/script>/,
  'index.html should load TTS text filter before script.js'
);

assert.match(
  script,
  /async function ensureSceneVisualRegistry\(\)/,
  'script.js should load the scene visual registry lazily'
);

assert.match(
  script,
  /function attachSceneVisualToBubble\(/,
  'script.js should attach a selected scene visual to GM bubbles'
);

assert.match(
  script,
  /TtsTextFilter\.prepareSpeechTextFromHtml/,
  'script.js should derive TTS text from filtered narrative HTML'
);

assert.match(
  script,
  /let toRead = speechText;/,
  'TTS click handler should read the pre-filtered speech text, not the whole bubble DOM'
);

assert.match(
  script,
  /function createSceneEpisodeHeader\(/,
  'script.js should render an episode header for GM scene messages'
);

assert.match(
  script,
  /scene-episode-frame/,
  'script.js should group scene header, visual, and narrative in one episode frame'
);

assert.match(
  script,
  /SceneTagger\.buildScenePresentation\(/,
  'script.js should use scene presentation metadata for the episode header'
);

assert.match(
  script,
  /async function ensureSceneVisualPacks\(\)/,
  'script.js should load scene visual pack metadata'
);

assert.match(
  script,
  /function initSceneVisualSettingsUI\(\)/,
  'script.js should initialize scene visual settings controls'
);

assert.match(
  script,
  /function saveSceneVisualSettingsFromUI\(\)/,
  'script.js should persist scene visual settings controls'
);

assert.match(
  script,
  /SceneTagger\.analyzeScene\(/,
  'script.js should analyze GM text and player state for scene tags'
);

assert.match(
  script,
  /SceneAssetPicker\.pickAsset\(/,
  'script.js should select a visual asset through the picker'
);

assert.match(
  style,
  /\.scene-visual-card/,
  'style.css should define scene visual card styles'
);

assert.match(
  style,
  /\.scene-episode-frame/,
  'style.css should style the full scene episode frame'
);

assert.match(
  style,
  /\.scene-episode-header/,
  'style.css should style the scene episode header'
);

for (const id of [
  'scene-visuals-enabled-checkbox',
  'scene-visual-meme-checkbox',
  'scene-visual-explicit-checkbox',
  'scene-visual-remote-checkbox',
  'scene-visual-display-mode-select',
  'scene-visual-pack-status'
]) {
  assert.match(indexHtml, new RegExp(`id="${id}"`), `index.html should expose ${id}`);
}

assert.match(
  script,
  /function rerollSceneVisualCard\(/,
  'script.js should let the player reroll one scene visual'
);

assert.match(
  script,
  /scene-visual-reroll-btn/,
  'script.js should render a reroll button on scene visual cards'
);

assert.match(
  script,
  /scene-visual-hide-btn/,
  'script.js should render a hide button on scene visual cards'
);

assert.match(
  script,
  /function createSceneVisualRestoreCard\(/,
  'script.js should render a restore affordance after a scene visual is hidden'
);

assert.match(
  script,
  /scene-visual-restore-btn/,
  'script.js should expose a restore button for hidden scene visuals'
);

assert.match(
  script,
  /sceneVisualHidden\s*=\s*false[\s\S]*attachSceneVisualToBubble/,
  'restore button should clear the hidden flag and reattach the visual'
);

assert.match(
  style,
  /\.scene-visual-card\.scene-visual-mode-wide/,
  'style.css should support a wide cinematic visual mode'
);

assert.match(
  style,
  /\.scene-visual-actions/,
  'style.css should style scene visual card controls'
);

assert.match(
  style,
  /\.scene-visual-restore/,
  'style.css should style the hidden visual restore placeholder'
);

assert.match(
  style,
  /\.game-log\.panel:hover\s*\{[\s\S]*?transform:\s*none\s*!important;[\s\S]*?\}/,
  'game log hover should not inherit panel movement that blurs chat text'
);

assert.match(
  style,
  /\.game-log\.panel::before\s*\{[\s\S]*?display:\s*none\s*!important;[\s\S]*?\}/,
  'game log should not inherit decorative panel hover chrome'
);

assert.match(
  style,
  /\.scene-visual-card\s*\{[\s\S]*?position:\s*relative;[\s\S]*?\}/,
  'scene visual card should contain absolute title/actions inside itself'
);

assert.match(
  style,
  /\.scene-visual-card\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?\}/,
  'scene visual card should not force chat bubbles wider than their container'
);

assert.match(
  pkg.scripts['test:unit'],
  /tests\/scene_visual_assets\.test\.js/,
  'npm run test:unit should include scene visual asset tests'
);

assert.match(
  pkg.scripts['test:unit'],
  /tests\/scene_visual_integration\.test\.js/,
  'npm run test:unit should include scene visual integration tests'
);

console.log('scene visual integration tests OK');
