// --- Константы и Настройки ---
// DEBUG_MODE: controlled by environment. In Electron, set via NODE_ENV.
// Defaults to false for production safety; set to true only in development.
// --- Runtime constants: defaults are fallback only; real values come from data/ui_runtime.json ---
const RUNTIME_CONSTANT_DEFAULTS = {
  debug: { enabled_in_node_env: 'development', fallback: false },
  save: {
    file_prefix: 'meterea_save_',
    file_extension: '.json',
    storage_key: 'textRpgSaves_v3',
    max_manual_saves: 5,
    max_auto_saves: 20,
    autosave_interval_ms: 300000
  },
  memory: {
    max_history_pairs: 12,
    summary_turn: 29,
    prune_turn: 30,
    echo_memory_max_items: 20,
    echo_memory_max_length: 200
  },
  progression: {
    initial_stat_points: 10,
    points_per_level: 4
  },
  world: {
    default_world_id: 'world_metera'
  },
  language: {
    storage_key: 'textRpgLang_v1',
    default: 'ru'
  },
  audio: {
    sound_folder_path: 'assets/sound/',
    music_files: ['menu_theme.mp3'],
    default_music_volume: 0.2,
    default_sfx_volume: 0.5
  },
  backgrounds: {
    files: ['Backgrounds_pixel.jpg', '13.jpg', '12.jpg', '14.jpg', '15.jpg', 'background-209.webp', 'background-210.webp', 'background-big-slime.webp'],
    change_interval_ms: 210000
  }
};

function getRuntimeSection(config, key) {
  return config && typeof config[key] === 'object' && config[key] !== null ? config[key] : {};
}

function numberOrFallback(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function intOrFallback(value, fallback) {
  const n = numberOrFallback(value, fallback);
  return Math.max(0, Math.floor(n));
}

function readStoredVolume(storageKey, fallback) {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const v = parseFloat(localStorage.getItem(storageKey));
    return (isNaN(v) || v < 0 || v > 1) ? fallback : v;
  } catch (error) {
    return fallback;
  }
}

let DEBUG_MODE = (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === RUNTIME_CONSTANT_DEFAULTS.debug.enabled_in_node_env) || RUNTIME_CONSTANT_DEFAULTS.debug.fallback;
let SAVE_FILE_PREFIX = RUNTIME_CONSTANT_DEFAULTS.save.file_prefix;
let SAVE_FILE_EXTENSION = RUNTIME_CONSTANT_DEFAULTS.save.file_extension;
let GEMINI_API_KEY = '';
let MAX_HISTORY = RUNTIME_CONSTANT_DEFAULTS.memory.max_history_pairs;
let MAX_MANUAL_SAVES = RUNTIME_CONSTANT_DEFAULTS.save.max_manual_saves;
let MAX_AUTO_SAVES = RUNTIME_CONSTANT_DEFAULTS.save.max_auto_saves;
let AUTOSAVE_INTERVAL = RUNTIME_CONSTANT_DEFAULTS.save.autosave_interval_ms;
let MEMORY_SUMMARY_TURN = RUNTIME_CONSTANT_DEFAULTS.memory.summary_turn;
let MEMORY_PRUNE_TURN = RUNTIME_CONSTANT_DEFAULTS.memory.prune_turn;
let INITIAL_STAT_POINTS = RUNTIME_CONSTANT_DEFAULTS.progression.initial_stat_points;
let POINTS_PER_LEVEL = RUNTIME_CONSTANT_DEFAULTS.progression.points_per_level;
let SAVE_STORAGE_KEY = RUNTIME_CONSTANT_DEFAULTS.save.storage_key;
let ECHO_MEMORY_MAX_ITEMS = RUNTIME_CONSTANT_DEFAULTS.memory.echo_memory_max_items;
let ECHO_MEMORY_MAX_LENGTH = RUNTIME_CONSTANT_DEFAULTS.memory.echo_memory_max_length;
let DEFAULT_WORLD_ID = RUNTIME_CONSTANT_DEFAULTS.world.default_world_id;
let LANGUAGE_STORAGE_KEY = RUNTIME_CONSTANT_DEFAULTS.language.storage_key;
let DEFAULT_LANGUAGE = RUNTIME_CONSTANT_DEFAULTS.language.default;
let SOUND_FOLDER_PATH = RUNTIME_CONSTANT_DEFAULTS.audio.sound_folder_path;
let musicFiles = [...RUNTIME_CONSTANT_DEFAULTS.audio.music_files];
let musicVolume = readStoredVolume('musicVolume', RUNTIME_CONSTANT_DEFAULTS.audio.default_music_volume);
let sfxVolume = readStoredVolume('sfxVolume', RUNTIME_CONSTANT_DEFAULTS.audio.default_sfx_volume);
let backgroundFiles = [...RUNTIME_CONSTANT_DEFAULTS.backgrounds.files];
let BACKGROUND_CHANGE_INTERVAL = RUNTIME_CONSTANT_DEFAULTS.backgrounds.change_interval_ms;

function applyRuntimeConstants(config = {}) {
  const debug = { ...RUNTIME_CONSTANT_DEFAULTS.debug, ...getRuntimeSection(config, 'debug') };
  const save = { ...RUNTIME_CONSTANT_DEFAULTS.save, ...getRuntimeSection(config, 'save') };
  const memory = { ...RUNTIME_CONSTANT_DEFAULTS.memory, ...getRuntimeSection(config, 'memory') };
  const progression = { ...RUNTIME_CONSTANT_DEFAULTS.progression, ...getRuntimeSection(config, 'progression') };
  const world = { ...RUNTIME_CONSTANT_DEFAULTS.world, ...getRuntimeSection(config, 'world') };
  const language = { ...RUNTIME_CONSTANT_DEFAULTS.language, ...getRuntimeSection(config, 'language') };
  const audio = { ...RUNTIME_CONSTANT_DEFAULTS.audio, ...getRuntimeSection(config, 'audio') };
  const backgrounds = { ...RUNTIME_CONSTANT_DEFAULTS.backgrounds, ...getRuntimeSection(config, 'backgrounds') };

  DEBUG_MODE = (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === debug.enabled_in_node_env) || Boolean(debug.fallback);
  SAVE_FILE_PREFIX = String(save.file_prefix || RUNTIME_CONSTANT_DEFAULTS.save.file_prefix);
  SAVE_FILE_EXTENSION = String(save.file_extension || RUNTIME_CONSTANT_DEFAULTS.save.file_extension);
  MAX_HISTORY = intOrFallback(memory.max_history_pairs, RUNTIME_CONSTANT_DEFAULTS.memory.max_history_pairs);
  MAX_MANUAL_SAVES = intOrFallback(save.max_manual_saves, RUNTIME_CONSTANT_DEFAULTS.save.max_manual_saves);
  MAX_AUTO_SAVES = intOrFallback(save.max_auto_saves, RUNTIME_CONSTANT_DEFAULTS.save.max_auto_saves);
  AUTOSAVE_INTERVAL = intOrFallback(save.autosave_interval_ms, RUNTIME_CONSTANT_DEFAULTS.save.autosave_interval_ms);
  MEMORY_SUMMARY_TURN = intOrFallback(memory.summary_turn, RUNTIME_CONSTANT_DEFAULTS.memory.summary_turn);
  MEMORY_PRUNE_TURN = intOrFallback(memory.prune_turn, RUNTIME_CONSTANT_DEFAULTS.memory.prune_turn);
  INITIAL_STAT_POINTS = intOrFallback(progression.initial_stat_points, RUNTIME_CONSTANT_DEFAULTS.progression.initial_stat_points);
  POINTS_PER_LEVEL = intOrFallback(progression.points_per_level, RUNTIME_CONSTANT_DEFAULTS.progression.points_per_level);
  SAVE_STORAGE_KEY = String(save.storage_key || RUNTIME_CONSTANT_DEFAULTS.save.storage_key);
  ECHO_MEMORY_MAX_ITEMS = intOrFallback(memory.echo_memory_max_items, RUNTIME_CONSTANT_DEFAULTS.memory.echo_memory_max_items);
  ECHO_MEMORY_MAX_LENGTH = intOrFallback(memory.echo_memory_max_length, RUNTIME_CONSTANT_DEFAULTS.memory.echo_memory_max_length);
  DEFAULT_WORLD_ID = String(world.default_world_id || RUNTIME_CONSTANT_DEFAULTS.world.default_world_id);
  LANGUAGE_STORAGE_KEY = String(language.storage_key || RUNTIME_CONSTANT_DEFAULTS.language.storage_key);
  DEFAULT_LANGUAGE = String(language.default || RUNTIME_CONSTANT_DEFAULTS.language.default);
  SOUND_FOLDER_PATH = String(audio.sound_folder_path || RUNTIME_CONSTANT_DEFAULTS.audio.sound_folder_path);
  musicFiles = Array.isArray(audio.music_files) && audio.music_files.length > 0 ? [...audio.music_files] : [...RUNTIME_CONSTANT_DEFAULTS.audio.music_files];
  musicVolume = readStoredVolume('musicVolume', numberOrFallback(audio.default_music_volume, RUNTIME_CONSTANT_DEFAULTS.audio.default_music_volume));
  sfxVolume = readStoredVolume('sfxVolume', numberOrFallback(audio.default_sfx_volume, RUNTIME_CONSTANT_DEFAULTS.audio.default_sfx_volume));
  backgroundFiles = Array.isArray(backgrounds.files) && backgrounds.files.length > 0 ? [...backgrounds.files] : [...RUNTIME_CONSTANT_DEFAULTS.backgrounds.files];
  BACKGROUND_CHANGE_INTERVAL = intOrFallback(backgrounds.change_interval_ms, RUNTIME_CONSTANT_DEFAULTS.backgrounds.change_interval_ms);
}

if (typeof window !== 'undefined') {
  window.applyRuntimeConstants = applyRuntimeConstants;
}


// --- Data-driven: BASE_CLASS_STATS and RACE_MODIFIERS are now loaded from races.json ---
// Hardcoded defaults remain as fallback; applyDatabaseStats() overwrites them at runtime.
let BASE_CLASS_STATS = {
    warrior: { str: 13, dex: 10, int: 8, con: 12, cha: 9, res: 12 },
    mage:    { str: 8,  dex: 11, int: 13, con: 9, cha: 11, res: 8 },
    rogue:   { str: 10, dex: 13, int: 10, con: 10, cha: 9, res: 10 },
    bard:    { str: 9,  dex: 12, int: 11, con: 9, cha: 12, res: 9 },
    default: { str: 10, dex: 10, int: 10, con: 10, cha: 10, res: 10 }
};

let RACE_MODIFIERS = {
    human: { str: 1, dex: 1, int: 1, con: 1, cha: 1 },
    elf: { str: 0, dex: 2, int: 1, con: 0, cha: 0 },
    dwarf: { str: 1, dex: 0, int: 0, con: 2, cha: 0 }
};

// Called by loadDatabaseWithModsAndInitEngine after database.races is populated.
// Replaces the hardcoded defaults with data from races.json.
// Uses Object.assign on a fresh copy to avoid mutating the const reference.
function applyDatabaseStats(racesArray) {
    if (!Array.isArray(racesArray) || racesArray.length === 0) return;

    // Build RACE_MODIFIERS from races[].stat_modifiers
    const newRaceModifiers = {};
    for (const race of racesArray) {
        if (race.id && race.stat_modifiers) {
            newRaceModifiers[race.id] = { ...race.stat_modifiers };
        }
    }
    // Merge defaults with database entries (database wins)
    Object.assign(RACE_MODIFIERS, newRaceModifiers);

    // Build BASE_CLASS_STATS from races[].class_stats
    const newClassStats = {};
    for (const race of racesArray) {
        if (race.class_stats) {
            for (const [className, stats] of Object.entries(race.class_stats)) {
                if (!newClassStats[className] || race.base_race) {
                    newClassStats[className] = { ...stats };
                }
            }
        }
    }
    Object.assign(BASE_CLASS_STATS, newClassStats);

    // Deep-freeze the stats objects after loading from database to prevent accidental mutation
    // Note: Use Object.seal() instead of Object.freeze() to allow mod modifications
    for (const race of Object.values(RACE_MODIFIERS)) Object.seal(race);
    Object.seal(RACE_MODIFIERS);
    for (const cls of Object.values(BASE_CLASS_STATS)) Object.seal(cls);
    Object.seal(BASE_CLASS_STATS);

    console.log('[Constants] BASE_CLASS_STATS and RACE_MODIFIERS loaded from database (frozen).',
        Object.keys(RACE_MODIFIERS).length, 'races,', Object.keys(BASE_CLASS_STATS).length, 'classes');
}

let predefinedStatusEffects = {
    // --- Негативные эффекты (Дебаффы) ---
    "minor_burn_dot": {
        name: "Слабое горение",
        description: "Вы чувствуете легкий жар. Наносит небольшой урон огнем каждый ход.",
        effects: [{trigger:{type:"on_turn_start",interval:1},action:{type:"modify_stat",stat:"hp",change:-2}}]
    },
    "weak_poison_dot": {
        name: "Слабый яд",
        description: "Яд медленно действует в ваших жилах. Наносит урон и ослабляет.",
        effects: [
            {trigger:{type:"on_turn_start",interval:1},action:{type:"modify_stat",stat:"hp",change:-1}},
            {trigger:{type:"on_apply"},action:{type:"modify_stat",stat:"str",change:-1}},
            {trigger:{type:"on_remove"},action:{type:"modify_stat",stat:"str",change:1}}
        ]
    },
    "curse_of_clumsiness": {
        name: "Проклятие неуклюжести",
        description: "Ваши движения стали неловкими (-2 к Ловкости).",
        effects: [
            {trigger:{type:"on_apply"},action:{type:"modify_stat",stat:"dex",change:-2}},
            {trigger:{type:"on_remove"},action:{type:"modify_stat",stat:"dex",change:2}}
        ]
    },

    // --- Позитивные эффекты (Баффы) ---
    "blessing_of_might": {
        name: "Благословение силы",
        description: "Вы чувствуете прилив сил (+2 к Силе).",
        effects: [
            {trigger:{type:"on_apply"},action:{type:"modify_stat",stat:"str",change:2}},
            {trigger:{type:"on_remove"},action:{type:"modify_stat",stat:"str",change:-2}}
        ]
    },
    "blessing_of_luck": {
        name: "Благословение удачи",
        description: "Вы чувствуете прикосновение удачи (+2 к Ловкости).",
        effects: [
            {trigger:{type:"on_apply"},action:{type:"modify_stat",stat:"dex",change:2}},
            {trigger:{type:"on_remove"},action:{type:"modify_stat",stat:"dex",change:-2}}
        ]
    },
    "minor_regeneration": {
        name: "Слабая регенерация",
        description: "Ваши раны медленно затягиваются (+1 HP каждый ход).",
        effects: [{trigger:{type:"on_turn_start",interval:1},action:{type:"modify_stat",stat:"hp",change:1}}]
    }
};

// Backward-compat accessor: if code still reads effectsJSON, parse from effects
// Backward-compat accessor: if code still reads effectsJSON, return parsed effects
Object.defineProperty(predefinedStatusEffects, 'effectsJSON', {
    get() {
        // Return a new object with each effect's array JSON-stringified for legacy consumers
        const result = {};
        for (const [key, val] of Object.entries(predefinedStatusEffects)) {
            if (key === 'effectsJSON') continue;
            if (val && val.effects) {
                result[key] = { ...val, effectsJSON: JSON.stringify(val.effects) };
            }
        }
        return result;
    },
    configurable: true
});

const standardItemDescriptions = {
    'sword_short': () => t('itemDescriptions.shortSword', null, 'Простой, но надежный короткий меч. Базовое оружие ближнего боя.'),
    'shield_wooden': () => t('itemDescriptions.woodenShield', null, 'Круглый деревянный щит. Обеспечивает минимальную защиту.'),
    'potion_heal_small': () => t('itemDescriptions.smallHealthPotion', null, 'Маленькая склянка с красной жидкостью. Восстанавливает немного здоровья.'),
    'staff_simple': () => t('itemDescriptions.simpleStaff', null, 'Гладкий деревянный посох. Помогает фокусировать магическую энергию.'),
    'robe_novice': () => t('itemDescriptions.noviceRobe', null, 'Простая роба, которую носят начинающие маги. Практически не защищает.'),
    'mana_potion_small': () => t('itemDescriptions.smallManaPotion', null, 'Маленькая склянка с синей жидкостью. Восстанавливает немного маны.'),
    'dagger_basic': () => t('itemDescriptions.basicDagger', null, 'Обычный кинжал. Быстрое, но слабое оружие.'),
    'leather_armor_light': () => t('itemDescriptions.lightLeatherArmor', null, 'Легкий доспех из обработанной кожи. Дает небольшую защиту, не стесняя движений.'),
    'lockpicks': () => t('itemDescriptions.lockpicks', null, 'Набор тонких металлических инструментов для вскрытия замков.'),
    'lute_simple': () => t('itemDescriptions.simpleLute', null, 'Простая лютня. Инструмент для бардовских песен и заклинаний.'),
    'colorful_clothes': () => t('itemDescriptions.colorfulClothes', null, 'Яркая и удобная одежда, подходящая для выступлений.'),
    'gold': () => t('itemDescriptions.gold', null, 'Блестящие золотые монеты. Основная валюта.')
};

