#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const warnings = [];

function projectPath(input) {
  return String(input || '').replace(/^\.\//, '').replace(/\\/g, '/');
}

function absolutePath(input) {
  return path.resolve(ROOT, projectPath(input));
}

function readJson(input) {
  const rel = projectPath(input);
  try {
    return JSON.parse(fs.readFileSync(absolutePath(rel), 'utf8'));
  } catch (error) {
    errors.push(`${rel}: ${error.message}`);
    return null;
  }
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function typeName(value) {
  if (Array.isArray(value)) return 'array';
  if (isObject(value)) return 'object';
  if (value === null) return 'null';
  return typeof value;
}

function checkManifestDefaultTypes(manifest) {
  const files = manifest && manifest.database_files;
  if (!isObject(files)) {
    errors.push('runtime_manifest.database_files must be an object');
    return;
  }

  for (const [key, entry] of Object.entries(files)) {
    if (!entry || typeof entry.path !== 'string') continue;
    const data = readJson(entry.path);
    if (data === null) continue;
    const expected = entry.default_type;
    if (!expected) continue;
    const actual = typeName(data);
    if (expected !== actual) {
      errors.push(`runtime_manifest.database_files.${key}: default_type=${expected}, actual=${actual} (${entry.path})`);
    }
  }
}

function checkDuplicateIdsInArray(items, label) {
  if (!Array.isArray(items)) return;
  const seen = new Map();
  items.forEach((item, index) => {
    if (!isObject(item) || typeof item.id !== 'string' || item.id.length === 0) return;
    if (seen.has(item.id)) {
      errors.push(`${label}: duplicate id "${item.id}" at indexes ${seen.get(item.id)} and ${index}`);
    } else {
      seen.set(item.id, index);
    }
  });
}

function checkDuplicateIds(manifest) {
  const files = manifest && manifest.database_files;
  if (!isObject(files)) return;

  for (const [key, entry] of Object.entries(files)) {
    if (!entry || typeof entry.path !== 'string') continue;
    const data = readJson(entry.path);
    if (Array.isArray(data)) {
      checkDuplicateIdsInArray(data, `${key} (${projectPath(entry.path)})`);
    }
  }
}

function collectEconomyItemIds(items) {
  if (!isObject(items)) {
    errors.push('data/economy_items.json must be an object keyed by item prototype id');
    return new Set();
  }
  return new Set(Object.keys(items));
}

function checkRecipeItemRefs(recipes, itemIds) {
  if (!Array.isArray(recipes)) {
    errors.push('data/economy_recipes.json must be an array');
    return;
  }

  recipes.forEach((recipe, index) => {
    if (!isObject(recipe)) {
      errors.push(`data/economy_recipes.json[${index}] must be an object`);
      return;
    }
    ['inputs', 'outputs'].forEach((field) => {
      const bucket = recipe[field];
      if (!isObject(bucket)) {
        errors.push(`data/economy_recipes.json[${index}].${field} must be an object`);
        return;
      }
      for (const [itemId, amount] of Object.entries(bucket)) {
        if (!itemIds.has(itemId)) {
          errors.push(`recipe[${index}].${field}.${itemId}: unknown economy item prototype`);
        }
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
          errors.push(`recipe[${index}].${field}.${itemId}: amount must be a positive number`);
        }
      }
    });
  });
}

function checkGameplayItemRefs(gameplay, itemIds) {
  if (!isObject(gameplay)) return;

  const currency = isObject(gameplay.currency) ? gameplay.currency : {};
  const currencyIds = Array.isArray(currency.prototype_ids) ? currency.prototype_ids : [];
  const physicalWeights = isObject(currency.physical_weights) ? currency.physical_weights : {};

  for (const [id, weight] of Object.entries(physicalWeights)) {
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) {
      errors.push(`gameplay_runtime.currency.physical_weights.${id}: weight must be a positive number`);
    }
  }

  currencyIds.forEach((id) => {
    const hasEconomyPrototype = itemIds.has(id);
    const hasPhysicalCurrencyDefinition = Object.prototype.hasOwnProperty.call(physicalWeights, id)
      && typeof physicalWeights[id] === 'number'
      && Number.isFinite(physicalWeights[id])
      && physicalWeights[id] > 0;

    if (!hasEconomyPrototype && !hasPhysicalCurrencyDefinition) {
      errors.push(`gameplay_runtime.currency.prototype_ids: unknown item prototype or physical currency "${id}"`);
    }
  });

  const manpower = gameplay.faction_manpower || {};
  const manpowerRefs = [
    ['weapon_good_ids', manpower.weapon_good_ids],
    ['food_good_ids', manpower.food_good_ids]
  ];
  manpowerRefs.forEach(([field, ids]) => {
    if (!Array.isArray(ids)) return;
    ids.forEach((id) => {
      if (!itemIds.has(id)) errors.push(`gameplay_runtime.faction_manpower.${field}: unknown item prototype "${id}"`);
    });
  });
}

function checkKnownDataLinks() {
  const items = readJson('data/economy_items.json');
  const recipes = readJson('data/economy_recipes.json');
  const gameplay = readJson('data/gameplay_runtime.json');
  const itemIds = collectEconomyItemIds(items);
  checkRecipeItemRefs(recipes, itemIds);
  checkGameplayItemRefs(gameplay, itemIds);

  if (isObject(gameplay?.inventory_building)) {
    const buildResourceId = gameplay.inventory_building.resource_prototype_id;
    if (typeof buildResourceId === 'string' && buildResourceId.length > 0 && !itemIds.has(buildResourceId)) {
      errors.push(`gameplay_runtime.inventory_building.resource_prototype_id: unknown item prototype "${buildResourceId}"`);
    }
  }
}

function printAndExit() {
  if (warnings.length > 0) {
    console.log('Data integrity warnings:');
    warnings.forEach(warning => console.log('[WARN]', warning));
  }

  if (errors.length > 0) {
    console.error('Data integrity validation failed:');
    errors.forEach(error => console.error('[FAIL]', error));
    process.exit(1);
  }

  console.log('data integrity links OK');
}

function main() {
  const manifest = readJson('data/runtime_manifest.json');
  if (manifest) {
    checkManifestDefaultTypes(manifest);
    checkDuplicateIds(manifest);
  }
  checkKnownDataLinks();
  printAndExit();
}

main();
