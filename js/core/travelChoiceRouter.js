(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.TravelChoiceRouter = factory();
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const VALID_ROUTES = new Set(['safe', 'fast', 'profitable', 'balanced']);
    const VALID_ACTIONS = new Set(['explore', 'bypass', 'attack', 'negotiate', 'continue']);
    const CRITICAL_TYPES = new Set([
        'river_crossing',
        'bandit',
        'disaster',
        'ambush',
        'collapse',
        'storm_wall',
        'blockade'
    ]);

    const ROUTE_PROFILES = Object.freeze({
        balanced: Object.freeze({
            id: 'balanced',
            hoursMultiplier: 1.0,
            eventChanceMultiplier: 1.0,
            lootChanceMultiplier: 1.0,
            riskLabel: 'medium',
            i18nKey: 'travel.route.balanced',
            descriptionKey: 'travel.route.balancedDesc'
        }),
        safe: Object.freeze({
            id: 'safe',
            hoursMultiplier: 1.4,
            eventChanceMultiplier: 0.6,
            lootChanceMultiplier: 0.8,
            riskLabel: 'low',
            i18nKey: 'travel.route.safe',
            descriptionKey: 'travel.route.safeDesc'
        }),
        fast: Object.freeze({
            id: 'fast',
            hoursMultiplier: 0.7,
            eventChanceMultiplier: 1.4,
            lootChanceMultiplier: 1.0,
            riskLabel: 'high',
            i18nKey: 'travel.route.fast',
            descriptionKey: 'travel.route.fastDesc'
        }),
        profitable: Object.freeze({
            id: 'profitable',
            hoursMultiplier: 1.1,
            eventChanceMultiplier: 1.2,
            lootChanceMultiplier: 1.5,
            riskLabel: 'medium',
            i18nKey: 'travel.route.profitable',
            descriptionKey: 'travel.route.profitableDesc'
        })
    });

    function toLowerString(value) {
        return String(value == null ? '' : value).toLowerCase().trim();
    }

    function getRouteOptions() {
        return [ROUTE_PROFILES.safe, ROUTE_PROFILES.fast, ROUTE_PROFILES.profitable];
    }

    function getRouteProfile(routeId) {
        const id = toLowerString(routeId);
        if (!VALID_ROUTES.has(id)) return ROUTE_PROFILES.balanced;
        return ROUTE_PROFILES[id];
    }

    function applyRouteToTrek(trek, routeId) {
        const profile = getRouteProfile(routeId);
        const base = trek && typeof trek === 'object' ? trek : {};
        const baseHours = Number(base.totalHours ?? base.total_hours ?? 0);
        const adjustedHours = baseHours > 0
            ? Math.max(1, Math.round(baseHours * profile.hoursMultiplier))
            : baseHours;
        return {
            ...base,
            routeId: profile.id,
            riskLabel: profile.riskLabel,
            hoursMultiplier: profile.hoursMultiplier,
            eventChanceMultiplier: profile.eventChanceMultiplier,
            lootChanceMultiplier: profile.lootChanceMultiplier,
            totalHours: adjustedHours
        };
    }

    function evaluateEventCriticality(event) {
        if (!event || typeof event !== 'object') return 'noncritical';
        const explicit = toLowerString(event.criticality);
        if (explicit === 'critical') return 'critical';
        if (explicit === 'noncritical' || explicit === 'normal' || explicit === 'minor') return 'noncritical';
        const type = toLowerString(event.object_type || event.type);
        if (CRITICAL_TYPES.has(type)) return 'critical';
        if (event.hostile === true || event.is_hostile === true) return 'critical';
        return 'noncritical';
    }

    function normalizeExplicitActions(rawList) {
        if (!Array.isArray(rawList)) return [];
        const seen = new Set();
        const result = [];
        for (const candidate of rawList) {
            const id = toLowerString(candidate);
            if (!VALID_ACTIONS.has(id) || seen.has(id)) continue;
            seen.add(id);
            result.push(id);
        }
        return result;
    }

    function buildEventActions(event) {
        if (!event || typeof event !== 'object') return ['continue'];

        const criticality = evaluateEventCriticality(event);
        const explicit = normalizeExplicitActions(event.available_actions);
        if (explicit.length > 0) {
            if (criticality === 'critical') {
                const filtered = explicit.filter(action => action !== 'continue' && action !== 'bypass');
                return filtered.length > 0 ? filtered : ['explore'];
            }
            return explicit;
        }

        const actions = [];
        const type = toLowerString(event.object_type || event.type);
        const canInteract = event.can_interact !== false;
        const isHostile = event.hostile === true || event.is_hostile === true || type === 'bandit' || type === 'ambush';
        const isCreature = event.is_creature === true || type === 'creature' || type === 'beast';

        if (canInteract) actions.push('explore');
        if (isHostile) {
            actions.push('attack');
            actions.push('negotiate');
        } else if (isCreature) {
            actions.push('attack');
        }

        if (criticality === 'critical') {
            if (actions.length === 0) actions.push('explore');
            if (!actions.includes('attack') && (isHostile || isCreature)) actions.push('attack');
        } else {
            actions.push('bypass');
            actions.push('continue');
        }

        const seen = new Set();
        const final = [];
        for (const action of actions) {
            if (seen.has(action)) continue;
            seen.add(action);
            final.push(action);
        }
        return final.length > 0 ? final : ['continue'];
    }

    function describeRoute(routeId, language) {
        const profile = getRouteProfile(routeId);
        const isRu = toLowerString(language).startsWith('ru');
        const labels = {
            safe: isRu
                ? { name: 'Безопасный путь', desc: 'Дольше, меньше риск событий и боёв.' }
                : { name: 'Safe route', desc: 'Longer travel, fewer events and ambushes.' },
            fast: isRu
                ? { name: 'Быстрый путь', desc: 'Короче, выше шанс опасных встреч.' }
                : { name: 'Fast route', desc: 'Shorter travel, higher event risk.' },
            profitable: isRu
                ? { name: 'Выгодный путь', desc: 'Шанс лута и торговцев, умеренный риск.' }
                : { name: 'Profitable route', desc: 'Loot and trade chances, moderate risk.' },
            balanced: isRu
                ? { name: 'Обычный путь', desc: 'Стандартный маршрут без изменений.' }
                : { name: 'Standard route', desc: 'Default trek with no modifiers.' }
        };
        return labels[profile.id] || labels.balanced;
    }

    function describeActionVerb(action, language) {
        const isRu = toLowerString(language).startsWith('ru');
        const map = {
            explore: { ru: 'Исследовать', en: 'Explore', icon: 'fa-search' },
            bypass: { ru: 'Обойти', en: 'Bypass', icon: 'fa-route' },
            attack: { ru: 'Атаковать', en: 'Attack', icon: 'fa-gavel' },
            negotiate: { ru: 'Договориться', en: 'Negotiate', icon: 'fa-comments' },
            continue: { ru: 'Продолжить путь', en: 'Continue', icon: 'fa-shoe-prints' }
        };
        const entry = map[toLowerString(action)];
        if (!entry) return { label: String(action || ''), icon: 'fa-question' };
        return { label: isRu ? entry.ru : entry.en, icon: entry.icon };
    }

    return Object.freeze({
        getRouteOptions,
        getRouteProfile,
        applyRouteToTrek,
        evaluateEventCriticality,
        buildEventActions,
        describeRoute,
        describeActionVerb,
        VALID_ROUTES: Object.freeze([...VALID_ROUTES]),
        CRITICAL_TYPES: Object.freeze([...CRITICAL_TYPES]),
        VALID_ACTIONS: Object.freeze([...VALID_ACTIONS])
    });
});
