(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.GMResponseContract = factory();
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const VALID_MODES = new Set(['exploration', 'dialogue', 'combat', 'travel', 'rest', 'trade']);
    const VALID_PRESSURE = new Set(['none', 'low', 'medium', 'high']);
    const COMBAT_ROLLS = new Set(['atk', 'def', 'str', 'dex', 'con', 'd20']);

    function normalizeString(value, fallback) {
        const text = String(value ?? '').trim();
        return text || fallback;
    }

    function inferSceneMode(player) {
        if (player?.currentCombat?.isActive === true) return 'combat';
        if (player?.travel?.active === true || player?.currentJourney) return 'travel';
        if (player?.active_trade_id) return 'trade';
        return 'exploration';
    }

    function inferPressure(mode) {
        if (mode === 'combat') return 'high';
        if (mode === 'travel') return 'medium';
        return 'none';
    }

    function normalizeSceneState(sceneState, options) {
        const player = options?.player || null;
        const inferredMode = inferSceneMode(player);
        const raw = sceneState && typeof sceneState === 'object' ? sceneState : {};
        const modeCandidate = normalizeString(raw.mode, inferredMode).toLowerCase();
        const mode = VALID_MODES.has(modeCandidate) ? modeCandidate : inferredMode;
        const pressureCandidate = normalizeString(raw.pressure, inferPressure(mode)).toLowerCase();
        const pressure = VALID_PRESSURE.has(pressureCandidate) ? pressureCandidate : inferPressure(mode);
        const reason = normalizeString(raw.reason, 'inferred_from_runtime');

        return { mode, pressure, reason };
    }

    function inferSuggestedActionIntent(action, mode) {
        const explicit = normalizeString(action.intent, '');
        if (explicit) return explicit;

        const roll = normalizeString(action.roll_stat, '').toLowerCase();
        if (mode === 'combat' && COMBAT_ROLLS.has(roll)) return roll === 'def' ? 'combat_defend' : 'combat_attack';
        if (mode === 'travel') return 'travel_continue';
        if (roll === 'cha') return 'dialogue';
        return 'freeform';
    }

    function inferSuggestedActionRisk(action, mode) {
        const explicit = normalizeString(action.risk, '').toLowerCase();
        if (['none', 'low', 'medium', 'high'].includes(explicit)) return explicit;
        if (mode === 'combat') return 'medium';
        if (action.roll_stat) return 'medium';
        return 'low';
    }

    function normalizeSuggestedActions(actions, options) {
        const sceneState = options?.scene_state || normalizeSceneState(null, options);
        if (!Array.isArray(actions)) return [];

        return actions
            .map((action) => {
                if (typeof action === 'string') return { text: action, roll_stat: null };
                if (!action || typeof action !== 'object') return null;
                return {
                    text: normalizeString(action.text, ''),
                    roll_stat: action.roll_stat == null ? null : normalizeString(action.roll_stat, null),
                    intent: inferSuggestedActionIntent(action, sceneState.mode),
                    risk: inferSuggestedActionRisk(action, sceneState.mode)
                };
            })
            .filter((action) => action && action.text);
    }

    function normalizeResponseObject(parsed, options) {
        const source = parsed && typeof parsed === 'object' ? parsed : {};
        const scene_state = normalizeSceneState(source.scene_state, options);
        return {
            ...source,
            scene_state,
            suggested_actions: normalizeSuggestedActions(source.suggested_actions, { ...(options || {}), scene_state })
        };
    }

    return Object.freeze({
        inferSceneMode,
        normalizeSceneState,
        normalizeSuggestedActions,
        normalizeResponseObject
    });
});
