#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SceneTagger = require('../js/core/sceneTagger.js');
const SceneAssetPicker = require('../js/core/sceneAssetPicker.js');
const registry = require('../data/visual_assets.json');
const rules = require('../data/scene_visual_rules.json');
const packs = require('../data/visual_asset_packs.json');
const root = path.resolve(__dirname, '..');
const optimizerPath = path.join(root, 'tools', 'optimize_visual_gifs.py');

{
  const scene = SceneTagger.analyzeScene(
    'Дождь льет как из ведра. Имперский каратель заносит алебарду, вокруг горят палатки и кровь смешивается с грязью.',
    {
      currentCombat: { isActive: true, participants: ['imperial_punisher'] },
      visibleEntities: {
        imperial_punisher: { name: 'Имперский каратель', isHostile: true, hp: 30 }
      }
    }
  );

  assert(scene.tags.includes('combat'), 'active combat should tag the scene as combat');
  assert(scene.tags.includes('rain'), 'weather words should tag rain');
  assert(scene.tags.includes('fire'), 'fire words should tag fire');
  assert(scene.tags.includes('blood'), 'blood words should tag blood');
  assert.equal(scene.combatActive, true);

  const presentation = SceneTagger.buildScenePresentation(scene, { location: 'ash_camp' });
  assert.equal(presentation.kind, 'combat', 'combat scene should get combat presentation kind');
  assert.equal(presentation.location, 'ash_camp');
  assert.match(presentation.threatLabel, /Высокая|Критическая/);
  assert(presentation.primaryTags.includes('combat'), 'presentation should expose primary tags');
}

{
  const asset = SceneAssetPicker.pickAsset({
    scene: { tags: ['combat', 'rain', 'fire', 'camp'], tone: ['grim'], intensity: 4, combatActive: true },
    registry,
    rules,
    settings: { enabledRatings: ['sfw'], allowRemote: false, memeMode: false, explicitMode: false }
  });

  assert(asset, 'SFW combat scene should select a local asset');
  assert.equal(asset.rating, 'sfw');
  assert(asset.tags.includes('combat'));
}

{
  const asset = SceneAssetPicker.pickAsset({
    scene: { tags: ['dice_fail', 'combat_miss', 'fail'], tone: ['comedy'], intensity: 2, combatActive: true },
    registry,
    rules,
    settings: { enabledRatings: ['sfw', 'meme'], allowRemote: false, memeMode: true, explicitMode: false, activePackIds: ['base_atmosphere'] }
  });

  assert.notEqual(asset && asset.rating, 'meme', 'inactive meme pack should not select meme assets');
}

{
  const asset = SceneAssetPicker.pickAsset({
    scene: { tags: ['dice_fail', 'combat_miss', 'fail'], tone: ['comedy'], intensity: 2, combatActive: true },
    registry,
    rules,
    settings: { enabledRatings: ['sfw', 'meme'], allowRemote: false, memeMode: true, explicitMode: false, activePackIds: ['base_atmosphere', 'meme_reactions'] }
  });

  assert(asset, 'meme-enabled failed roll should select a meme reaction when the pack is active');
  assert.equal(asset.rating, 'meme');
}

{
  const firstAsset = SceneAssetPicker.pickAsset({
    scene: { tags: ['combat', 'rain', 'fire', 'camp'], tone: ['grim'], intensity: 4, combatActive: true },
    registry,
    rules,
    settings: { enabledRatings: ['sfw'], allowRemote: false, memeMode: false, explicitMode: false, activePackIds: ['base_atmosphere'] }
  });
  const nextAsset = SceneAssetPicker.pickAsset({
    scene: { tags: ['combat', 'rain', 'fire', 'camp'], tone: ['grim'], intensity: 4, combatActive: true },
    registry,
    rules,
    settings: {
      enabledRatings: ['sfw'],
      allowRemote: false,
      memeMode: false,
      explicitMode: false,
      activePackIds: ['base_atmosphere'],
      excludeAssetIds: [firstAsset.id]
    }
  });

  assert(firstAsset, 'first combat asset should exist');
  assert(nextAsset, 'reroll should find another eligible combat asset');
  assert.notEqual(nextAsset.id, firstAsset.id, 'excludeAssetIds should prevent picking the same asset');
}

{
  const asset = SceneAssetPicker.pickAsset({
    scene: { tags: ['sex', 'brothel', 'romance', 'consensual'], tone: ['erotic'], intensity: 3, combatActive: false },
    registry,
    rules,
    settings: { enabledRatings: ['sfw', 'meme'], allowRemote: false, memeMode: true, explicitMode: false }
  });

assert.notEqual(asset && asset.rating, 'explicit', 'explicit assets must not be selected without explicit opt-in');
}

{
  const asset = SceneAssetPicker.pickAsset({
    scene: { tags: ['sex', 'brothel', 'romance', 'consensual'], tone: ['erotic'], intensity: 3, combatActive: false },
    registry,
    rules,
    settings: { enabledRatings: ['sfw', 'meme', 'adult', 'explicit'], allowRemote: false, memeMode: true, explicitMode: true }
  });

  assert(asset, 'explicit opt-in should allow an adult-pack slot');
  assert(['adult', 'explicit'].includes(asset.rating));
assert.equal(asset.source, 'local');
}

{
  const packIds = packs.packs.map(pack => pack.id);
  assert(packIds.includes('base_atmosphere'), 'base atmosphere pack should be registered');
  assert(packIds.includes('meme_reactions'), 'meme reaction pack should be registered');
  assert(packIds.includes('adult_local_pack'), 'adult local pack should be registered but optional');
  const adultPack = packs.packs.find(pack => pack.id === 'adult_local_pack');
  assert.equal(adultPack.enabledByDefault, false, 'adult pack must be disabled by default');
  assert.equal(adultPack.requiresExplicitMode, true, 'adult pack should require explicit mode');
}

{
  const playableAssets = registry.assets.filter(asset => ['base_atmosphere', 'meme_reactions'].includes(asset.pack));
  assert(playableAssets.length >= 8, 'base and meme packs should have playable assets');
  for (const asset of playableAssets) {
    assert.equal(asset.placeholder, undefined, `${asset.id} should no longer be marked as a placeholder`);
    assert(asset.source, `${asset.id} should declare its source`);
    assert(asset.license, `${asset.id} should declare its license`);
    const filePath = path.join(root, asset.path);
    assert(fs.existsSync(filePath), `${asset.path} should exist`);
    const signature = fs.readFileSync(filePath).subarray(0, 6).toString('ascii');
    assert(['GIF87a', 'GIF89a'].includes(signature), `${asset.path} should be a valid GIF`);
  }
}

{
  assert(fs.existsSync(optimizerPath), 'visual GIF optimizer tool should exist');
  const optimizer = fs.readFileSync(optimizerPath, 'utf8');
  assert.match(optimizer, /--dry-run/, 'optimizer should support a dry-run mode before touching user GIFs');
  assert.match(optimizer, /--in-place/, 'optimizer should require an explicit in-place flag for destructive compression');
}

console.log('scene visual asset tests OK');
