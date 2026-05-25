(function() {
    const STAT_KEYS = ['str', 'dex', 'int', 'con', 'cha', 'res'];
    const DEFAULT_STATS = Object.freeze({ str: 10, dex: 10, int: 10, con: 10, cha: 10, res: 10 });

    function cloneStats(stats) {
        const out = {};
        for (const key of STAT_KEYS) out[key] = Number(stats && Number.isFinite(Number(stats[key])) ? stats[key] : DEFAULT_STATS[key]);
        return out;
    }

    function normalizeStats(stats) {
        const out = {};
        if (!stats || typeof stats !== 'object') return out;
        for (const key of STAT_KEYS) {
            const value = Number(stats[key]);
            if (Number.isFinite(value)) out[key] = Math.round(value);
        }
        return out;
    }

    function normalizeModifiers(modifiers) {
        const out = {};
        if (!modifiers || typeof modifiers !== 'object') return out;
        for (const key of STAT_KEYS) {
            const value = Number(modifiers[key]);
            out[key] = Number.isFinite(value) ? Math.round(value) : 0;
        }
        return out;
    }

    function getRuntimeCharacterCreationData() {
        const db = window.RUNTIME_DATABASE || {};
        return {
            classes: Array.isArray(window.CLASSES_DATA) ? window.CLASSES_DATA : (Array.isArray(db.classes) ? db.classes : []),
            races: Array.isArray(window.RACES_DATA) ? window.RACES_DATA : (Array.isArray(db.races) ? db.races : []),
            eras: Array.isArray(window.ERAS_DATA) ? window.ERAS_DATA : (Array.isArray(db.eras) ? db.eras : [])
        };
    }

    function findById(list, id) {
        return Array.isArray(list) ? list.find(entry => entry && entry.id === id) || null : null;
    }

    function logWarning(message, detail) {
        if (window.RuntimeLog) window.RuntimeLog.warn('CharacterStatsResolver', message, detail || null);
        else console.warn('[CharacterStatsResolver]', message, detail || '');
    }

    function resolveCharacterCreationStats(options = {}) {
        const data = getRuntimeCharacterCreationData();
        const classId = options.classId;
        const raceId = options.raceId;
        const cls = findById(data.classes, classId);
        const race = findById(data.races, raceId);
        const warnings = [];

        if (!cls) warnings.push(`class not found: ${classId}`);
        if (!race) warnings.push(`race not found: ${raceId}`);

        let classBase = normalizeStats(cls && cls.base_stats);
        if (Object.keys(classBase).length === 0) {
            classBase = normalizeStats(cls && cls.stats);
            if (Object.keys(classBase).length > 0) warnings.push(`class ${classId} uses legacy stats field; prefer base_stats`);
        }
        if (Object.keys(classBase).length === 0) {
            classBase = cloneStats(DEFAULT_STATS);
            const classModifiers = normalizeModifiers(cls && cls.stat_modifiers);
            for (const key of STAT_KEYS) classBase[key] += classModifiers[key] || 0;
            warnings.push(`class ${classId} has no base_stats; used DEFAULT_STATS + stat_modifiers fallback`);
        } else {
            classBase = { ...cloneStats(DEFAULT_STATS), ...classBase };
        }

        const raceModifiers = normalizeModifiers(race && race.stat_modifiers);
        const baseStatsForDistribution = {};
        for (const key of STAT_KEYS) {
            baseStatsForDistribution[key] = Math.max(1, Math.round((classBase[key] || DEFAULT_STATS[key]) + (raceModifiers[key] || 0)));
        }

        const allocation = normalizeModifiers(options.allocation || {});
        const finalStats = {};
        for (const key of STAT_KEYS) {
            finalStats[key] = Math.max(1, Math.round(baseStatsForDistribution[key] + (allocation[key] || 0)));
        }

        if (warnings.length > 0) logWarning('Character creation stats resolved with warnings.', { classId, raceId, warnings });

        return {
            valid: !!(cls && race),
            classDef: cls,
            raceDef: race,
            statKeys: [...STAT_KEYS],
            classBaseStats: classBase,
            raceModifiers,
            baseStatsForDistribution,
            allocation,
            finalStats,
            warnings
        };
    }

    function validateCharacterStatsContract(database = window.RUNTIME_DATABASE || {}) {
        const errors = [];
        const classes = Array.isArray(database.classes) ? database.classes : [];
        const races = Array.isArray(database.races) ? database.races : [];
        const classIds = new Set();

        if (classes.length === 0) errors.push('classes section is empty');
        if (races.length === 0) errors.push('races section is empty');

        function validateRequiredStats(stats, label) {
            if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
                errors.push(`${label} is missing or not an object`);
                return;
            }
            for (const key of STAT_KEYS) {
                if (!Number.isFinite(Number(stats[key]))) {
                    errors.push(`${label}.${key} is missing or not numeric`);
                }
            }
        }

        function validateOptionalStatObject(stats, label) {
            if (stats === undefined || stats === null) return;
            if (typeof stats !== 'object' || Array.isArray(stats)) {
                errors.push(`${label} must be an object when present`);
                return;
            }
            for (const [key, value] of Object.entries(stats)) {
                if (!STAT_KEYS.includes(key)) {
                    errors.push(`${label}.${key} is not a known character stat`);
                    continue;
                }
                if (!Number.isFinite(Number(value))) {
                    errors.push(`${label}.${key} is not numeric`);
                }
            }
        }

        for (const cls of classes) {
            if (!cls || typeof cls !== 'object') {
                errors.push('class entry is not an object');
                continue;
            }
            if (!cls.id || typeof cls.id !== 'string') {
                errors.push('class entry without string id');
                continue;
            }
            classIds.add(cls.id);
            validateRequiredStats(cls.base_stats, `class ${cls.id}.base_stats`);
            validateOptionalStatObject(cls.stat_modifiers, `class ${cls.id}.stat_modifiers`);
            if (cls.starting_items !== undefined && (!cls.starting_items || typeof cls.starting_items !== 'object' || Array.isArray(cls.starting_items))) {
                errors.push(`class ${cls.id}.starting_items must be an object { itemId: quantity } when present`);
            }
        }

        for (const race of races) {
            if (!race || typeof race !== 'object') {
                errors.push('race entry is not an object');
                continue;
            }
            if (!race.id || typeof race.id !== 'string') {
                errors.push('race entry without string id');
                continue;
            }
            validateOptionalStatObject(race.stat_modifiers || {}, `race ${race.id}.stat_modifiers`);

            if (race.class_stats !== undefined) {
                if (!race.class_stats || typeof race.class_stats !== 'object' || Array.isArray(race.class_stats)) {
                    errors.push(`race ${race.id}.class_stats must be an object when present`);
                    continue;
                }
                for (const [classId, stats] of Object.entries(race.class_stats)) {
                    if (classId !== 'default' && !classIds.has(classId)) {
                        errors.push(`race ${race.id}.class_stats references unknown class ${classId}`);
                    }
                    validateOptionalStatObject(stats, `race ${race.id}.class_stats.${classId}`);
                }
            }
        }

        return errors;
    }

    window.CharacterStatsResolver = {
        STAT_KEYS,
        DEFAULT_STATS,
        getRuntimeCharacterCreationData,
        resolveCharacterCreationStats,
        validateCharacterStatsContract
    };
})();
