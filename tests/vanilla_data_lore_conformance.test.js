#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

const checkedLoreDataFiles = [
  'data/economy_items.json',
  'data/facility_names.json',
  'data/locations_architects.json',
  'data/locations_rebirth.json',
  'data/locations_silence.json',
  'data/locations_sundering.json',
];

const forbiddenVanillaTerms = [
  'Редкая электроника',
  'микрочип',
  'чип',
  'провода',
  'Батареи',
  'Нано',
  'Голо',
  'Инфо',
  'Перфокарта',
  'Синтет',
  'Радио',
  'Гидропони',
  'полимер',
  'Бетон',
  'Протеин',
  'Керамит',
  'пластик',
  'Генн',
  'Синтез',
  'Термо-ткань',
  'Химическ',
  'Хим-',
  'Энергоядро',
  'Энерго-хранилища',
  'Логистические хабы',
  'Аэро-доки',
  'Огнестрел',
  'Грави',
  'Титановый',
  'Углепластик',
  'Оптоволоконный',
  'Кевлар',
  'Лазерный',
  'Ховербайк',
  'байк',
  'дрон',
  'Квантовый',
  'Реакторный',
  'Плазмен',
  'Торговый терминал',
  'Aether Network',
  'computing center',
  'Synchronizers',
  'junkyard',
  'bunker',
  'techno-fascists',
  'remaining technology',
  'technologies',
  'sent a signal',
  'toxic waste',
  'reactors',
  'plasma fire',
  'orbital strikes',
  'defense systems',
  'transport ships',
];

const violations = [];
for (const rel of checkedLoreDataFiles) {
  const content = fs.readFileSync(path.join(root, rel), 'utf8');
  for (const term of forbiddenVanillaTerms) {
    if (!content.toLowerCase().includes(term.toLowerCase())) continue;
    const idx = content.toLowerCase().indexOf(term.toLowerCase());
    const line = content.slice(0, idx).split(/\r?\n/).length;
    violations.push(`${rel}:${line} contains vanilla lore mismatch "${term}"`);
  }
}

assert.strictEqual(
  violations.length,
  0,
  `Found ${violations.length} vanilla data lore mismatch(es):\n  ${violations.join('\n  ')}`
);

const races = readJson('data/races.json');
assert.ok(
  races.some((race) => race.id === 'kharash' && /Кхараш|Зверолюд/.test(race.name)),
  'data/races.json must include Kharash / Beastfolk from world_metera lore'
);

const factionRelations = readJson('data/faction_relations.json');
const factionIds = new Set(Object.keys(factionRelations.faction_biome_preference || {}));
for (const expectedFaction of ['magisterium', 'seekers', 'shattered_sky']) {
  assert.ok(
    factionIds.has(expectedFaction),
    `data/faction_relations.json must include lore faction "${expectedFaction}"`
  );
}

console.log('OK | vanilla data lore conformance checks passed');
