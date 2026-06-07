(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.QuestDeadline = factory();
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const VALID_URGENCY = new Set(['low', 'medium', 'high']);
    const PROMPT_WINDOW_DAYS = 2;

    function parseDeadlineDay(value) {
        if (value === null || value === undefined || value === '') return null;
        const day = Number(value);
        return Number.isFinite(day) ? Math.trunc(day) : null;
    }

    function normalizeUrgency(value) {
        const urgency = String(value || '').trim().toLowerCase();
        return VALID_URGENCY.has(urgency) ? urgency : null;
    }

    function normalizeQuestDeadlineArgs(args) {
        const source = args && typeof args === 'object' ? args : {};
        return {
            deadlineDay: parseDeadlineDay(source.deadlineDay),
            urgency: normalizeUrgency(source.urgency),
            failureConsequence: String(source.failureConsequence || '').trim()
        };
    }

    function describeQuestDeadline(quest, worldDay) {
        const deadlineDay = parseDeadlineDay(quest?.deadlineDay);
        const currentDay = parseDeadlineDay(worldDay);
        if (deadlineDay === null || currentDay === null) {
            return { state: 'none', daysLeft: null };
        }

        const daysLeft = deadlineDay - currentDay;
        if (daysLeft < 0) return { state: 'overdue', daysLeft };
        if (daysLeft === 0) return { state: 'due', daysLeft };
        return { state: 'future', daysLeft };
    }

    function shouldMentionQuest(quest, worldDay) {
        if (!quest || quest.status !== 'active') return false;
        const info = describeQuestDeadline(quest, worldDay);
        if (info.state === 'none') return false;
        if (info.state === 'due' || info.state === 'overdue') return true;
        return info.daysLeft <= PROMPT_WINDOW_DAYS || quest.urgency === 'high';
    }

    function getDeadlineText(info, isRu) {
        if (info.state === 'overdue') {
            const days = Math.abs(info.daysLeft);
            return isRu ? `просрочено на ${days} дн.` : `overdue by ${days} day(s)`;
        }
        if (info.state === 'due') return isRu ? 'срок сегодня' : 'due today';
        return isRu ? `осталось ${info.daysLeft} дн.` : `${info.daysLeft} day(s) left`;
    }

    function buildDeadlinePromptPatch(quests, worldDay, language = 'en') {
        const list = Object.values(quests || {}).filter(quest => shouldMentionQuest(quest, worldDay));
        if (!list.length) return '';

        const isRu = String(language || '').toLowerCase().startsWith('ru');
        const lines = list.map((quest) => {
            const info = describeQuestDeadline(quest, worldDay);
            const parts = [
                `- ${quest.title || quest.aiIdentifier || 'Untitled quest'}`,
                getDeadlineText(info, isRu)
            ];
            if (quest.urgency) parts.push(`urgency: ${quest.urgency}`);
            if (quest.failureConsequence) parts.push(`consequence: ${quest.failureConsequence}`);
            return parts.join(' | ');
        });

        if (isRu) {
            return `\n\n=== QUEST DEADLINES ===\nАктивные квесты с близким или сорванным сроком:\n${lines.join('\n')}\nПокажи это давление в сцене через последствия, цены, реакцию NPC или выбор. Не проваливай квест автоматически без понятного игроку события и шанса среагировать.\n=== END QUEST DEADLINES ===`;
        }

        return `\n\n=== QUEST DEADLINES ===\nActive quests with near or missed deadlines:\n${lines.join('\n')}\nReflect this pressure in the scene through consequences, costs, NPC reactions, or a concrete choice. Do not fail a quest automatically without a visible event and a chance for the player to react.\n=== END QUEST DEADLINES ===`;
    }

    return Object.freeze({
        normalizeQuestDeadlineArgs,
        describeQuestDeadline,
        buildDeadlinePromptPatch
    });
});
