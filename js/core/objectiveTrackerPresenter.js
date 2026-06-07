(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.ObjectiveTrackerPresenter = factory();
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    function toNumber(value) {
        const num = Number(value);
        return Number.isFinite(num) ? Math.trunc(num) : null;
    }

    function getDeadlineState(quest, worldDay) {
        const deadline = toNumber(quest?.deadlineDay);
        const day = toNumber(worldDay);
        if (deadline === null || day === null) return { rank: 0, badge: '', daysLeft: null };
        const daysLeft = deadline - day;
        if (daysLeft < 0) return { rank: 4, badge: 'overdue', daysLeft };
        if (daysLeft === 0) return { rank: 3, badge: 'due', daysLeft };
        if (daysLeft <= 2) return { rank: 2, badge: 'soon', daysLeft };
        return { rank: 1, badge: '', daysLeft };
    }

    function urgencyRank(urgency) {
        return { high: 3, medium: 2, low: 1 }[String(urgency || '').toLowerCase()] || 0;
    }

    function localizeBadge(state, language) {
        const isRu = String(language || '').toLowerCase().startsWith('ru');
        if (state.badge === 'overdue') return isRu ? 'просрочено' : 'overdue';
        if (state.badge === 'due') return isRu ? 'срок сегодня' : 'due today';
        if (state.badge === 'soon') return isRu ? `осталось ${state.daysLeft} дн.` : `${state.daysLeft} day(s) left`;
        return '';
    }

    function buildObjectiveItems({ quests, worldDay, limit = 3, language = 'en' } = {}) {
        const isRu = String(language || '').toLowerCase().startsWith('ru');
        return Object.values(quests || {})
            .filter(quest => quest && quest.status === 'active')
            .map((quest) => {
                const deadline = getDeadlineState(quest, worldDay);
                const urgency = String(quest.urgency || '').toLowerCase();
                return {
                    id: quest.id || quest.aiIdentifier || quest.title || '',
                    title: quest.title || quest.aiIdentifier || (isRu ? 'Задание' : 'Quest'),
                    objective: quest.objective || quest.description || '',
                    badge: localizeBadge(deadline, language),
                    urgency,
                    urgencyLabel: urgency ? (isRu ? `срочность: ${urgency}` : `urgency: ${urgency}`) : '',
                    rank: deadline.rank * 10 + urgencyRank(urgency)
                };
            })
            .sort((a, b) => b.rank - a.rank || String(a.title).localeCompare(String(b.title)))
            .slice(0, Math.max(1, Number(limit) || 3));
    }

    return Object.freeze({
        buildObjectiveItems
    });
});
