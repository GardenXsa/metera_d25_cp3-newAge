#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STAT_KEYS = ['str', 'dex', 'int', 'con', 'cha', 'res'];
const errors = [];

function projectPath(...parts) {
  return path.join(ROOT, ...parts);
}

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(projectPath(relPath), 'utf8'));
}

function exists(relPath) {
  return fs.existsSync(projectPath(relPath));
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function collectEntries(value) {
  if (Array.isArray(value)) return value;
  if (isPlainObject(value)) {
    return Object.entries(value).map(([id, entry]) => isPlainObject(entry) ? { id: entry.id || id, ...entry } : entry);
  }
  return [];
}

function collectItems(value) {
  if (Array.isArray(value)) {
    return new Set(value.map(item => item && item.id).filter(Boolean));
  }
  if (isPlainObject(value)) return new Set(Object.keys(value));
  return new Set();
}

function loadModDataFiles(modRoot, modJson, key) {
  const files = modJson && modJson.data && Array.isArray(modJson.data[key]) ? modJson.data[key] : [];
  const merged = [];
  for (const file of files) {
    const abs = path.join(modRoot, file);
    if (!fs.existsSync(abs)) {
      errors.push(`${path.basename(modRoot)}:${key}: missing ${file}`);
      continue;
    }
    try {
      merged.push(...collectEntries(JSON.parse(fs.readFileSync(abs, 'utf8'))));
    } catch (error) {
      errors.push(`${path.basename(modRoot)}:${key}: invalid ${file}: ${error.message}`);
    }
  }
  return merged;
}

function loadModItems(modRoot, modJson) {
  const files = modJson && modJson.data && Array.isArray(modJson.data.items) ? modJson.data.items : [];
  const itemIds = new Set();
  for (const file of files) {
    const abs = path.join(modRoot, file);
    if (!fs.existsSync(abs)) continue;
    try {
      for (const id of collectItems(JSON.parse(fs.readFileSync(abs, 'utf8')))) itemIds.add(id);
    } catch (error) {
      errors.push(`${path.basename(modRoot)}:items: invalid ${file}: ${error.message}`);
    }
  }
  return itemIds;
}

function validateRequiredStats(stats, label) {
  if (!isPlainObject(stats)) {
    errors.push(`${label} is missing or not an object`);
    return;
  }
  for (const key of STAT_KEYS) {
    if (!Number.isFinite(Number(stats[key]))) errors.push(`${label}.${key} is missing or not numeric`);
  }
}

function validateOptionalStatObject(stats, label) {
  if (stats === undefined || stats === null) return;
  if (!isPlainObject(stats)) {
    errors.push(`${label} must be an object when present`);
    return;
  }
  for (const [key, value] of Object.entries(stats)) {
    if (!STAT_KEYS.includes(key)) {
      errors.push(`${label}.${key} is not a known character stat`);
      continue;
    }
    if (!Number.isFinite(Number(value))) errors.push(`${label}.${key} is not numeric`);
  }
}

function validateDataset(label, classes, races, itemIds, totalConversion = false) {
  const classIds = new Set();
  if (!Array.isArray(classes) || classes.length === 0) errors.push(`${label}: classes are empty`);
  if (!Array.isArray(races) || races.length === 0) errors.push(`${label}: races are empty`);

  for (const cls of classes || []) {
    if (!isPlainObject(cls)) {
      errors.push(`${label}: class entry is not an object`);
      continue;
    }
    if (!cls.id || typeof cls.id !== 'string') {
      errors.push(`${label}: class entry without string id`);
      continue;
    }
    classIds.add(cls.id);
    validateRequiredStats(cls.base_stats, `${label}: class ${cls.id}.base_stats`);
    validateOptionalStatObject(cls.stat_modifiers, `${label}: class ${cls.id}.stat_modifiers`);

    if (cls.starting_items !== undefined) {
      if (!isPlainObject(cls.starting_items)) {
        errors.push(`${label}: class ${cls.id}.starting_items must be an object { itemId: quantity } when present`);
      } else if (totalConversion) {
        for (const itemId of Object.keys(cls.starting_items)) {
          if (!itemIds.has(itemId)) errors.push(`${label}: class ${cls.id}.starting_items references missing item ${itemId}`);
        }
      }
    }
  }

  for (const race of races || []) {
    if (!isPlainObject(race)) {
      errors.push(`${label}: race entry is not an object`);
      continue;
    }
    if (!race.id || typeof race.id !== 'string') {
      errors.push(`${label}: race entry without string id`);
      continue;
    }
    validateOptionalStatObject(race.stat_modifiers || {}, `${label}: race ${race.id}.stat_modifiers`);
    if (race.class_stats !== undefined) {
      if (!isPlainObject(race.class_stats)) {
        errors.push(`${label}: race ${race.id}.class_stats must be an object when present`);
        continue;
      }
      for (const [classId, stats] of Object.entries(race.class_stats)) {
        if (classId !== 'default' && !classIds.has(classId)) errors.push(`${label}: race ${race.id}.class_stats references unknown class ${classId}`);
        validateOptionalStatObject(stats, `${label}: race ${race.id}.class_stats.${classId}`);
      }
    }
  }
}

function main() {
  const baseClasses = collectEntries(readJson('data/classes.json'));
  const baseRaces = collectEntries(readJson('data/races.json'));
  const baseItems = collectItems(readJson('data/economy_items.json'));
  validateDataset('base data', baseClasses, baseRaces, baseItems, false);

  const modsDir = projectPath('mods');
  if (fs.existsSync(modsDir)) {
    for (const dirent of fs.readdirSync(modsDir, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const modRoot = path.join(modsDir, dirent.name);
      const modJsonPath = path.join(modRoot, 'mod.json');
      if (!fs.existsSync(modJsonPath)) continue;
      const modJson = JSON.parse(fs.readFileSync(modJsonPath, 'utf8'));
      const classes = loadModDataFiles(modRoot, modJson, 'classes');
      const races = loadModDataFiles(modRoot, modJson, 'races');
      if (classes.length === 0 && races.length === 0) continue;
      const itemIds = loadModItems(modRoot, modJson);
      const totalConversion = !!(modJson.total_conversion || modJson.totalConversion || modJson.mod_type === 'total_conversion');
      validateDataset(`mod ${dirent.name}`, classes, races, itemIds, totalConversion);
    }
  }

  if (errors.length > 0) {
    console.error('Character stats contract FAILED:');
    for (const error of errors) console.error('- ' + error);
    process.exit(1);
  }

  console.log('Character stats contract OK');
}

main();
