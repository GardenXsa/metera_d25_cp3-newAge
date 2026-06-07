(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.LevelProgressionPresenter = factory();
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const STAT_LABELS = {
        en: { str: 'Strength', dex: 'Dexterity', int: 'Intelligence', con: 'Constitution', cha: 'Charisma', res: 'Resilience' },
        ru: { str: 'Сила', dex: 'Ловкость', int: 'Интеллект', con: 'Выносливость', cha: 'Харизма', res: 'Стойкость' }
    };

    const CLASS_RECOMMENDATIONS = {
        warrior: ['str', 'con', 'res'],
        fighter: ['str', 'con', 'res'],
        mage: ['int', 'con', 'dex'],
        wizard: ['int', 'con', 'dex'],
        rogue: ['dex', 'cha', 'str'],
        thief: ['dex', 'cha', 'int'],
        ranger: ['dex', 'str', 'con'],
        cleric: ['con', 'cha', 'int']
    };

    function toNumber(value, fallback = 0) {
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
    }

    function getLanguageKey(language) {
        return String(language || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';
    }

    function getStatLabel(stat, languageKey) {
        return STAT_LABELS[languageKey]?.[stat] || STAT_LABELS.en[stat] || stat.toUpperCase();
    }

    function getRecommendedStats(playerClass) {
        const key = String(playerClass || '').toLowerCase();
        return CLASS_RECOMMENDATIONS[key] || ['con', 'str', 'dex'];
    }

    function buildProgressionSummary(player, language = 'en') {
        const stats = player?.stats || {};
        const languageKey = getLanguageKey(language);
        const points = Math.max(0, toNumber(stats.statPoints, 0));
        const xp = Math.max(0, toNumber(stats.xp, 0));
        const xpNext = Math.max(1, toNumber(stats.xpNext, 1));
        const xpPct = Math.max(0, Math.min(100, Math.round((xp / xpNext) * 100)));
        const hasUnspentPoints = points > 0;

        const title = languageKey === 'ru'
            ? `Доступно очков характеристик: ${points}`
            : `Available stat points: ${points}`;
        const hint = languageKey === 'ru'
            ? 'Потрать их сейчас: рост должен ощущаться сразу, а не теряться в журнале.'
            : 'Spend them now: growth should be felt immediately, not buried in the log.';

        const recommendations = hasUnspentPoints
            ? getRecommendedStats(player?.class).map((stat) => ({
                stat,
                label: getStatLabel(stat, languageKey),
                value: toNumber(stats[stat], 0)
            }))
            : [];

        return {
            hasUnspentPoints,
            points,
            level: toNumber(stats.level, 1),
            xp,
            xpNext,
            xpPct,
            title,
            hint,
            recommendations
        };
    }

    return Object.freeze({
        buildProgressionSummary
    });
});
