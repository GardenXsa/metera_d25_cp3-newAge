(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.SkillCostResolver = factory();
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    function isMage(player) {
        return Boolean(player && typeof player.class === 'string' && player.class.toLowerCase() === 'mage');
    }

    /**
     * Parse a costType string into a normalized token.
     * Recognized tokens: 'mp' (mana), 'hp' (health), 'stamina', 'none' (or empty/null).
     * Anything containing the Cyrillic/Latin substring for mana or mp is mapped to 'mp';
     * anything containing the substring for hp/health/health-points is mapped to 'hp';
     * anything containing 'stamina'/'выносливост' is mapped to 'stamina';
     * everything else is 'unknown' (caller decides what to do).
     */
    function normalizeCostType(raw) {
        if (raw === null || raw === undefined) return 'none';
        const s = String(raw).toLowerCase().trim();
        if (!s || s === 'нет' || s === 'no' || s === 'none' || s === '-') return 'none';
        if (s.includes('mp') || s.includes('ман') || s.includes('mana')) return 'mp';
        if (s.includes('stamina') || s.includes('выносливост') || s.includes('stam')) return 'stamina';
        if (s.includes('hp') || s.includes('здоровь') || s.includes('health')) return 'hp';
        return 'unknown';
    }

    /**
     * Resolve the actual amount to deduct for a skill use, given the player.
     * For non-mage classes, MP costs are always 0 (they have no mana pool).
     * For everyone else, the requested cost is returned as-is.
     *
     * Returns { cost: number, currency: 'mp'|'hp'|'stamina'|'none', reason: string }
     */
    function resolveSkillCost(skill, player) {
        const currency = normalizeCostType(skill && skill.costType);
        const requested = Math.max(0, parseInt(skill && skill.cost, 10) || 0);
        if (currency === 'none') return { cost: 0, currency, reason: 'no_cost' };
        if (currency === 'mp' && !isMage(player)) {
            return { cost: 0, currency: 'none', reason: 'non_mage_mp_ignored' };
        }
        return { cost: requested, currency, reason: 'normal' };
    }

    /**
     * Decide whether a player can afford to use a skill.
     * For non-mage MP costs, this is always true (they are free).
     */
    function canAffordSkill(skill, player) {
        const { cost, currency, reason } = resolveSkillCost(skill, player);
        if (cost === 0) return { ok: true, reason: reason === 'no_cost' ? 'free_skill' : reason };
        if (currency === 'mp') {
            const current = Number(player && player.stats && player.stats.mana) || 0;
            return { ok: current >= cost, reason: current >= cost ? 'ok' : 'insufficient_mana', current, cost };
        }
        if (currency === 'hp') {
            const current = Number(player && player.stats && player.stats.hp) || 0;
            return { ok: current > cost, reason: current > cost ? 'ok' : 'insufficient_hp', current, cost };
        }
        if (currency === 'stamina') {
            // Stamina не реализована как стат; разрешаем, списываем из HP как proxy.
            return { ok: true, reason: 'stamina_proxy' };
        }
        return { ok: true, reason: 'unknown_currency' };
    }

    /**
     * Compute the actual stat mutation to apply when a skill is used.
     * Returns { stat, change } or null if the skill has no cost.
     */
    function computeCostDeduction(skill, player) {
        const { cost, currency } = resolveSkillCost(skill, player);
        if (cost === 0) return null;
        if (currency === 'mp') return { stat: 'mana', change: -cost };
        if (currency === 'hp') return { stat: 'hp', change: -cost };
        if (currency === 'stamina') return { stat: 'hp', change: -Math.floor(cost / 2) };
        return null;
    }

    return Object.freeze({
        isMage,
        normalizeCostType,
        resolveSkillCost,
        canAffordSkill,
        computeCostDeduction
    });
});
