(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.SuggestedActionPresenter = factory();
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const VALID_RISKS = new Set(['none', 'low', 'medium', 'high']);
    const INTENT_ICONS = {
        combat_attack: 'fa-burst',
        combat_defend: 'fa-shield-halved',
        dialogue: 'fa-comments',
        trade: 'fa-coins',
        travel_continue: 'fa-route',
        inspect: 'fa-magnifying-glass',
        rest: 'fa-bed'
    };

    function normalizeToken(value, fallback) {
        return String(value || fallback || '').trim().toLowerCase();
    }

    function classToken(value) {
        return normalizeToken(value, 'unknown').replace(/[^a-z0-9_-]+/g, '-');
    }

    function normalizeRisk(value, hasRoll) {
        const risk = normalizeToken(value, '');
        if (VALID_RISKS.has(risk)) return risk;
        return hasRoll ? 'medium' : 'low';
    }

    function inferIntent(action) {
        const explicit = normalizeToken(action?.intent, '');
        if (explicit) return explicit;
        const roll = normalizeToken(action?.roll_stat, '');
        if (roll === 'atk' || roll === 'str') return 'combat_attack';
        if (roll === 'def' || roll === 'con') return 'combat_defend';
        if (roll === 'cha') return 'dialogue';
        return 'freeform';
    }

    function getRiskLabel(risk, language) {
        const isRu = normalizeToken(language, '').startsWith('ru');
        const labels = isRu
            ? { none: 'Без риска', low: 'Низкий риск', medium: 'Риск', high: 'Высокий риск' }
            : { none: 'No risk', low: 'Low risk', medium: 'Risk', high: 'High risk' };
        return labels[risk] || labels.low;
    }

    function getActionPresentation(action, language = 'en') {
        const source = action && typeof action === 'object' ? action : {};
        const roll = source.roll_stat == null ? '' : String(source.roll_stat).trim().toUpperCase();
        const intent = inferIntent(source);
        const risk = normalizeRisk(source.risk, Boolean(roll));
        const icon = INTENT_ICONS[intent] || (roll ? 'fa-dice-d20' : 'fa-location-arrow');

        return {
            icon,
            intent,
            risk,
            rollLabel: roll ? roll : '',
            riskLabel: getRiskLabel(risk, language),
            className: [
                'suggested-action-btn',
                `suggested-action-risk-${classToken(risk)}`,
                `suggested-action-intent-${classToken(intent)}`
            ].join(' ')
        };
    }

    return Object.freeze({
        getActionPresentation
    });
});
