(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.EntityStatValidator = factory();
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    function isFiniteNumber(value) {
        return typeof value === 'number' && Number.isFinite(value);
    }

    /**
     * Validate a stat value for updateEntityStat.
     * updateEntityStat is an ABSOLUTE setter, not a delta. The C++ engine is
     * the source of truth for combat HP, so we only enforce:
     *   1) numeric & finite (fall back to currentHp on garbage input)
     *   2) clamp to [0, maxHp] when maxHp is known
     *
     * @param {object} args
     * @param {string} args.stat — stat name (case-insensitive)
     * @param {*} args.value — proposed absolute value
     * @param {object} [args.entity] — entity with stats.hp / stats.maxHp
     * @returns {{ value: number, capReason: string|null }}
     */
    function validateEntityStatValue({ stat, value, entity } = {}) {
        const statName = String(stat || '').toLowerCase();
        const statKey = statName === 'maxhp' ? 'maxHp' : statName;
        const stats = entity && entity.stats ? entity.stats : {};
        const currentHp = isFiniteNumber(stats.hp) ? stats.hp : 0;
        const maxHp = isFiniteNumber(stats.maxHp) ? stats.maxHp : null;

        if (statKey !== 'hp') {
            if (!isFiniteNumber(value)) {
                return { value: 0, capReason: 'non_numeric' };
            }
            return { value: value, capReason: null };
        }

        if (!isFiniteNumber(value)) {
            return { value: currentHp, capReason: 'non_numeric' };
        }

        let result = value;
        let capReason = null;

        if (result < 0) {
            result = 0;
            capReason = 'negative_clamped';
        }
        if (maxHp !== null && result > maxHp) {
            result = maxHp;
            capReason = 'max_hp_cap';
        }

        return { value: result, capReason };
    }

    return Object.freeze({
        validateEntityStatValue
    });
});
