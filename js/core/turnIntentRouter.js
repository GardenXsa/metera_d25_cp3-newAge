(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.TurnIntentRouter = factory();
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    function normalizeText(value) {
        let text = String(value || '').toLowerCase();
        if (typeof text.normalize === 'function') text = text.normalize('NFKC');
        try {
            text = text.replace(/[\p{P}\p{S}]+/gu, ' ');
        } catch (_) {
            text = text.replace(/[^\w\s\u0400-\u04ff\u00c0-\u024f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]+/g, ' ');
        }
        return text.replace(/\s+/g, ' ').trim();
    }

    function unique(values) {
        return Array.from(new Set(values.filter(Boolean)));
    }

    function getEntityEntries(entities) {
        if (!entities) return [];
        if (Array.isArray(entities)) {
            return entities.map((entity, index) => [entity && (entity.id || entity.aiIdentifier) || String(index), entity]);
        }
        return Object.entries(entities);
    }

    function buildTurnState(playerObj) {
        const player = playerObj || {};
        const entityEntries = getEntityEntries(player.visibleEntities || player.environment || {});
        const livingHostileIds = [];

        for (const [id, entity] of entityEntries) {
            if (!entity) continue;
            const hp = Number(entity.hp ?? entity.stats?.hp ?? 0);
            if (entity.isHostile === true && hp > 0) livingHostileIds.push(id);
        }

        return {
            combatActive: player.currentCombat?.isActive === true,
            hostilesAlive: livingHostileIds.length > 0,
            livingHostileIds,
            location: player.location || '',
            traveling: player.travel?.active === true || player.currentJourney?.active === true,
            combatParticipants: Array.isArray(player.currentCombat?.participants)
                ? [...player.currentCombat.participants]
                : []
        };
    }

    function getLanguageCandidates(language, registry) {
        const config = registry?.languages || {};
        const primary = language || config.default || 'en';
        const fallback = Array.isArray(config.fallbackOrder) ? config.fallbackOrder : [];
        return unique([primary, config.default || 'en', ...fallback]);
    }

    function markerHitsForIntent(normalizedInput, intentConfig, languages) {
        const hits = [];
        const markersByLanguage = intentConfig?.markers || {};
        for (const lang of languages) {
            const markers = Array.isArray(markersByLanguage[lang]) ? markersByLanguage[lang] : [];
            for (const marker of markers) {
                const normalizedMarker = normalizeText(marker);
                if (normalizedMarker && normalizedInput.includes(normalizedMarker)) {
                    hits.push({ marker, language: lang });
                }
            }
        }
        return hits;
    }

    function classifyPlayerIntent(text, state, registry, language) {
        const normalizedInput = normalizeText(text);
        if (!normalizedInput || !registry?.intents) {
            return { type: 'unknown', confidence: 0, rawText: text || '', markers: [] };
        }

        const languages = getLanguageCandidates(language, registry);
        let best = null;

        for (const [intentType, intentConfig] of Object.entries(registry.intents)) {
            const hits = markerHitsForIntent(normalizedInput, intentConfig, languages);
            if (hits.length === 0) continue;
            const priority = Number(intentConfig.priority || 0);
            const score = hits.length * 100 + priority;
            if (!best || score > best.score) {
                best = { type: intentType, score, priority, hits };
            }
        }

        if (!best) {
            return { type: 'unknown', confidence: 0, rawText: text || '', markers: [] };
        }

        return {
            type: best.type,
            confidence: Math.min(1, best.hits.length / 2 + 0.5),
            rawText: text || '',
            markers: best.hits
        };
    }

    function matchesWhen(state, when) {
        if (!when || typeof when !== 'object') return true;
        return Object.entries(when).every(([key, expected]) => state[key] === expected);
    }

    function getMessage(registry, key, language) {
        if (!key) return '';
        const languages = getLanguageCandidates(language, registry);
        for (const lang of languages) {
            const value = registry?.messages?.[lang]?.[key];
            if (typeof value === 'string' && value.trim()) return value;
        }
        return key;
    }

    function findConflictingGuard(intent, state, registry) {
        const guards = Array.isArray(registry?.guards) ? registry.guards : [];
        return guards.find((guard) => {
            const conflicting = Array.isArray(guard.conflictingIntents) ? guard.conflictingIntents : [];
            return conflicting.includes(intent.type) && matchesWhen(state, guard.when);
        }) || null;
    }

    function resolveIntentForState(intent, state, registry, language) {
        if (!intent || intent.type === 'unknown') {
            return { allowed: true, reason: null };
        }

        const guard = findConflictingGuard(intent, state, registry);
        if (!guard) {
            return { allowed: true, reason: null };
        }

        return {
            allowed: false,
            reason: guard.id,
            guard,
            reinterpretAs: guard.reinterpretAs || null,
            promptPatch: getMessage(registry, guard.promptPatchKey, language),
            notice: getMessage(registry, guard.noticeKey, language)
        };
    }

    function routePlayerInput(text, options) {
        const opts = options || {};
        const registry = opts.registry;
        const language = opts.language;
        const state = opts.state || buildTurnState(opts.player);
        const intent = classifyPlayerIntent(text, state, registry, language);
        const resolution = resolveIntentForState(intent, state, registry, language);
        const promptPatch = resolution.allowed ? '' : resolution.promptPatch || '';
        const notice = resolution.allowed ? '' : resolution.notice || '';

        return {
            state,
            intent,
            resolution,
            promptPatch,
            notice
        };
    }

    function guardActions(actions, options) {
        const opts = options || {};
        const registry = opts.registry;
        const language = opts.language;
        const state = opts.state || buildTurnState(opts.player);
        const guards = Array.isArray(registry?.guards) ? registry.guards : [];
        const safeActions = [];
        const blockedActions = [];

        for (const action of Array.isArray(actions) ? actions : []) {
            const command = action?.command;
            const guard = guards.find((candidate) => {
                const blockedCommands = Array.isArray(candidate.blockCommands) ? candidate.blockCommands : [];
                return blockedCommands.includes(command) && matchesWhen(state, candidate.when);
            });

            if (guard) {
                blockedActions.push({
                    action,
                    guardId: guard.id,
                    message: getMessage(registry, guard.noticeKey, language)
                });
            } else {
                safeActions.push(action);
            }
        }

        return { safeActions, blockedActions };
    }

    async function loadRegistry(url) {
        if (typeof fetch !== 'function') return null;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Intent registry load failed: ${response.status}`);
        return response.json();
    }

    return Object.freeze({
        normalizeText,
        buildTurnState,
        classifyPlayerIntent,
        resolveIntentForState,
        routePlayerInput,
        guardActions,
        loadRegistry
    });
});
