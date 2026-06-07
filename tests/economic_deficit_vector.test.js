#!/usr/bin/env node
const assert = require('assert');

const {
  computeGlobalEconomicDeficits,
  getPopulationDemandWeight
} = require('../js/core/economicDeficitVector.js');

const economyItems = {
  wheat: { category: 'raw_food', tags: ['food', 'raw_food', 'crop'] },
  flour: { category: 'processed_food', tags: ['ingredient', 'processed_food'] },
  iron_ore: { category: 'raw_material', tags: ['ore', 'raw_material'] },
  ether_dust: { category: 'magic_raw', tags: ['magic_raw'] },
  bread: { category: 'consumable', tags: ['food', 'consumable', 'processed_food'] },
  pickaxe: { category: 'tool', tags: ['tool'] },
  perfume: { category: 'luxury', tags: ['luxury'] }
};

assert.equal(getPopulationDemandWeight('iron_ore', economyItems.iron_ore), 0);
assert.equal(getPopulationDemandWeight('flour', economyItems.flour), 0);
assert(getPopulationDemandWeight('bread', economyItems.bread) > getPopulationDemandWeight('perfume', economyItems.perfume));

const regions = {
  capital: { population: 1000, vault_id: 'capital_vault' },
  mine: { population: 800, vault_id: 'mine_vault' }
};

const stocks = {
  capital_vault: { bread: 3, iron_ore: 0, flour: 0, perfume: 0 },
  mine_vault: { bread: 0, iron_ore: 500, flour: 0, perfume: 0 }
};

const deficits = computeGlobalEconomicDeficits({
  regions,
  economyItems,
  countItems: (vaultId, goodId) => stocks[vaultId]?.[goodId] || 0,
  maxResults: 5
});

const goods = deficits.map(item => item.good);
assert(goods.includes('bread'), 'edible goods should appear in population deficit vector');
assert(goods.includes('pickaxe'), 'tools should remain eligible at low demand weight');
assert(!goods.includes('iron_ore'), 'raw ore must not be treated as direct population demand');
assert(!goods.includes('ether_dust'), 'magic raw materials must not be treated as direct population demand');
assert(!goods.includes('flour'), 'non-edible ingredients must not be treated as direct population demand');

console.log('economic deficit vector tests OK');
