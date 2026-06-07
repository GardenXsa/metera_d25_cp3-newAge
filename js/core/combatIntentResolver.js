(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.CombatIntentResolver = factory();
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const ACTIONS = {
        attack: {
            rollStat: 'atk',
            effect: 'Resolve an attack against the target. On hit, update target HP with updateEntityStat or explain why no damage lands.'
        },
        defend: {
            rollStat: 'def',
            effect: 'Take a defensive stance. Reduce incoming damage, improve position, or create an opening for the next turn.'
        },
        escape: {
            rollStat: 'dex',
            effect: 'Attempt to disengage. On success, pause pursuit or end combat with setCombatState false when appropriate.'
        },
        talk: {
            rollStat: 'cha',
            effect: 'Attempt combat dialogue. On success, create surrender, hesitation, parley, intimidation, or de-escalation.'
        }
    };

    function normalizeAction(action) {
        const key = String(action || '').trim().toLowerCase();
        return ACTIONS[key] ? key : 'attack';
    }

    function createIntent({ action, targetId = '', targetName = '', language = 'en' } = {}) {
        const normalized = normalizeAction(action);
        const config = ACTIONS[normalized];
        return {
            action: normalized,
            targetId: String(targetId || ''),
            targetName: String(targetName || targetId || ''),
            rollStat: config.rollStat,
            effect: config.effect,
            language,
            rollTotal: null,
            outcomeHint: 'pending'
        };
    }

    function parseRollTotal(text, stat) {
        const source = String(text || '');
        const statMatch = source.match(/STAT:\s*([a-z0-9_]+)/i);
        if (stat && statMatch && statMatch[1].toLowerCase() !== String(stat).toLowerCase()) return null;
        const totalMatch = source.match(/TOTAL:\s*(-?\d+)/i);
        if (!totalMatch) return null;
        const total = Number(totalMatch[1]);
        return Number.isFinite(total) ? total : null;
    }

    function getOutcomeHint(total) {
        if (total === null || total === undefined) return 'pending';
        if (total >= 15) return 'success';
        if (total <= 9) return 'failure';
        return 'mixed';
    }

    function enrichIntentWithRolls(intent, rollResults) {
        if (!intent) return null;
        const total = (Array.isArray(rollResults) ? rollResults : [])
            .map(item => parseRollTotal(item, intent.rollStat))
            .find(value => value !== null);
        return {
            ...intent,
            rollTotal: total ?? null,
            outcomeHint: getOutcomeHint(total)
        };
    }

    function shouldSuppressEnemyCounterattack(intent) {
        if (!intent) return false;
        return ['escape', 'talk'].includes(intent.action) && intent.outcomeHint === 'success';
    }

    function applyEnemyAttackModifiers(intent, context = {}) {
        const playerDef = Number(context.playerDef) || 0;
        if (intent?.action === 'defend') {
            return {
                ...context,
                playerDef: playerDef + 4,
                note: 'Defensive stance: player_def +4 for automated enemy attacks this turn.'
            };
        }
        return { ...context, playerDef, note: '' };
    }

    function buildPromptBlock(intent, language = 'en') {
        if (!intent) return '';
        const isRu = String(language || '').toLowerCase().startsWith('ru');
        const target = intent.targetName || intent.targetId || 'target';
        const roll = intent.rollTotal === null ? 'none' : String(intent.rollTotal);
        const base = [
            '=== COMBAT INTENT ===',
            `action: ${intent.action}`,
            `target: ${target}`,
            `roll_stat: ${intent.rollStat}`,
            `roll_total: ${roll}`,
            `outcome_hint: ${intent.outcomeHint}`,
            `expected_effect: ${intent.effect}`
        ];
        if (isRu) {
            base.push('Правила: атака должна обновить HP цели через updateEntityStat или явно объяснить промах/блок. Защита обязана снизить входящий урон, дать позиционное преимущество или открыть контратаку. Успешный побег/переговоры должны дать паузу, дистанцию, сдачу, деэскалацию или завершение боя через setCombatState false, если это логично.');
        } else {
            base.push('Rules: attack must update target HP through updateEntityStat or clearly explain miss/block. Defend must reduce incoming damage, grant position, or open a counter. Successful escape/talk must create distance, pause, surrender, de-escalation, or end combat with setCombatState false when appropriate.');
        }
        base.push('=== END COMBAT INTENT ===');
        return `\n\n${base.join('\n')}`;
    }

    return Object.freeze({
        createIntent,
        enrichIntentWithRolls,
        shouldSuppressEnemyCounterattack,
        applyEnemyAttackModifiers,
        buildPromptBlock
    });
});
