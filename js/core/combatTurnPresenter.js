(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.CombatTurnPresenter = factory();
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    function toNumber(value, fallback = 0) {
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
    }

    function getEntityHp(entity) {
        const hp = toNumber(entity?.stats?.hp ?? entity?.hp, 0);
        const maxHp = Math.max(1, toNumber(entity?.stats?.maxHp ?? entity?.maxHp, hp || 1));
        return { hp, maxHp };
    }

    function getStatusLabel(isActive, language) {
        const isRu = String(language || '').toLowerCase().startsWith('ru');
        if (!isActive) return isRu ? 'Бой завершён' : 'Combat ended';
        return isRu ? 'Ваш ход' : 'Your move';
    }

    function buildCombatSummary({ combat, entities, language = 'en' } = {}) {
        const isActive = combat?.isActive === true;
        if (!isActive) {
            return {
                isActive: false,
                statusLabel: getStatusLabel(false, language),
                totalCount: 0,
                visibleCount: 0,
                aliveCount: 0,
                defeatedCount: 0,
                primaryTargetId: '',
                participants: []
            };
        }

        const participantIds = Array.isArray(combat?.participants) ? combat.participants : [];
        const participants = participantIds.map((id) => {
            const entity = entities?.[id] || null;
            const { hp, maxHp } = getEntityHp(entity);
            const state = !entity ? 'unknown' : (hp > 0 ? 'alive' : 'defeated');
            return {
                id,
                visible: Boolean(entity),
                name: entity?.name || id,
                type: entity?.type || 'unknown',
                disposition: entity?.disposition || entity?.attitude || '',
                hp,
                maxHp,
                hpPct: Math.max(0, Math.min(100, (hp / maxHp) * 100)),
                hpLabel: `${hp}/${maxHp}`,
                state
            };
        });

        const visibleParticipants = participants.filter(item => item.visible);
        const aliveParticipants = participants.filter(item => item.state === 'alive');
        const defeatedParticipants = participants.filter(item => item.state === 'defeated');
        const primary = aliveParticipants.find(item => item.visible) || aliveParticipants[0] || participants[0] || null;

        return {
            isActive: true,
            statusLabel: getStatusLabel(true, language),
            totalCount: participantIds.length,
            visibleCount: visibleParticipants.length,
            aliveCount: aliveParticipants.length,
            defeatedCount: defeatedParticipants.length,
            primaryTargetId: primary?.id || '',
            participants
        };
    }

    function describeEnemyTurn(enemyTurn, language = 'en') {
        if (!enemyTurn || typeof enemyTurn !== 'object') return null;
        const isRu = String(language || '').toLowerCase().startsWith('ru');
        const lines = Array.isArray(enemyTurn.lines) ? enemyTurn.lines.filter(l => typeof l === 'string' && l.trim()) : [];
        const totalDamage = toNumber(enemyTurn.totalDamage, 0);
        const dodgedAll = Boolean(enemyTurn.dodgedAll) || (lines.length > 0 && totalDamage === 0);
        let title, summary;
        if (dodgedAll) {
            title = isRu ? 'Ход врагов — уклонение' : 'Enemy turn — dodged';
            summary = isRu ? 'Все атаки уклонены/заблокированы' : 'All attacks dodged or blocked';
        } else if (totalDamage > 0) {
            title = isRu ? 'Ход врагов' : 'Enemy turn';
            summary = isRu
                ? `Получено урона: ${totalDamage}`
                : `Damage taken: ${totalDamage}`;
        } else if (lines.length === 0) {
            return null;
        } else {
            title = isRu ? 'Ход врагов' : 'Enemy turn';
            summary = isRu ? 'Контратака врагов' : 'Enemy counterattack';
        }
        return { title, summary, lines, totalDamage, dodgedAll };
    }

    return Object.freeze({
        buildCombatSummary,
        describeEnemyTurn
    });
});
