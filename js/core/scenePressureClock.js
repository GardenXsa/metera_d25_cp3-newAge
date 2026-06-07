(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.ScenePressureClock = factory();
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const DEFAULT_THRESHOLD = 3;
    const STIMULUS_MODES = new Set(['combat', 'travel', 'trade']);
    const STIMULUS_PRESSURE = new Set(['medium', 'high']);
    const STIMULUS_COMMANDS = new Set([
        'addQuest',
        'updateQuest',
        'setCombatState',
        'addEnvironment',
        'startTravel',
        'startJourney',
        'nexusDefine',
        'nexusUpdate',
        'addStatusEffect',
        'updateRelationship'
    ]);

    function normalizeSceneState(sceneState) {
        const raw = sceneState && typeof sceneState === 'object' ? sceneState : {};
        return {
            mode: String(raw.mode || 'exploration').toLowerCase(),
            pressure: String(raw.pressure || 'none').toLowerCase(),
            reason: String(raw.reason || 'unspecified').trim() || 'unspecified'
        };
    }

    function getStimulusReason(turnResult) {
        const scene = normalizeSceneState(turnResult?.scene_state);
        if (STIMULUS_MODES.has(scene.mode)) return `${scene.mode}:${scene.reason}`;
        if (STIMULUS_PRESSURE.has(scene.pressure)) return `pressure:${scene.pressure}:${scene.reason}`;

        const action = (Array.isArray(turnResult?.actions) ? turnResult.actions : [])
            .find(item => STIMULUS_COMMANDS.has(item?.command));
        if (action) return `command:${action.command}`;

        return '';
    }

    function update(previousClock, turnResult) {
        const prev = previousClock && typeof previousClock === 'object' ? previousClock : {};
        const scene = normalizeSceneState(turnResult?.scene_state);
        const stimulusReason = getStimulusReason(turnResult);
        const quietTurns = stimulusReason ? 0 : (Number(prev.quietTurns) || 0) + 1;

        return {
            quietTurns,
            lastMode: scene.mode,
            lastPressure: scene.pressure,
            lastReason: scene.reason,
            lastTurn: Number(turnResult?.turn ?? prev.lastTurn ?? 0) || 0,
            lastStimulusReason: stimulusReason || prev.lastStimulusReason || ''
        };
    }

    function shouldNudge(clock, threshold = DEFAULT_THRESHOLD) {
        return (Number(clock?.quietTurns) || 0) >= threshold;
    }

    function buildPromptPatch(clock, language = 'en', threshold = DEFAULT_THRESHOLD) {
        if (!shouldNudge(clock, threshold)) return '';
        const quietTurns = Number(clock?.quietTurns) || 0;
        const isRu = String(language || '').toLowerCase().startsWith('ru');
        if (isRu) {
            return `\n\n=== SCENE PRESSURE CLOCK ===\n${quietTurns} ход(а/ов) подряд прошли без сильного события, явного прогресса или новой угрозы. В следующем ответе добавь конкретный игровой крючок: слух, просьбу NPC, след, осложнение, выбор, дедлайн или изменение обстановки. Не начинай бой насильно; если создаешь угрозу, дай игроку выбор и поставь scene_state.pressure low или medium.\n=== END SCENE PRESSURE CLOCK ===`;
        }
        return `\n\n=== SCENE PRESSURE CLOCK ===\n${quietTurns} consecutive turns passed without a strong event, clear progress, or new pressure. In the next response, add one concrete gameplay hook: rumor, NPC request, clue, complication, choice, deadline, or environmental change. Do not begin combat automatically; if you add danger, give the player a choice and set scene_state.pressure to low or medium.\n=== END SCENE PRESSURE CLOCK ===`;
    }

    return Object.freeze({
        update,
        shouldNudge,
        buildPromptPatch
    });
});
