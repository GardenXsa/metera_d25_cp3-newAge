(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.CombatStartGuard = factory();
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const EXPLICIT_REASONS = new Set([
        'player_attack',
        'npc_attack',
        'ambush_event',
        'travel_ambush',
        'scripted_combat',
        'failed_negotiation',
        'hostile_contact'
    ]);

    function wantsActiveCombat(command, args) {
        if (command !== 'setCombatState' || !args) return false;
        if (args.isActive === undefined) return Array.isArray(args.participants) && args.participants.length > 0;
        if (typeof args.isActive === 'string') return args.isActive.toLowerCase() === 'true';
        return args.isActive === true;
    }

    function getEntity(player, id) {
        if (!player || !id) return null;
        return player.visibleEntities?.[id] || player.allKnownEntities?.[id] || player.environment?.[id] || null;
    }

    function entityHp(entity) {
        return Number(entity?.stats?.hp ?? entity?.hp ?? 0);
    }

    function hasLivingHostileParticipant(player, participants) {
        return (Array.isArray(participants) ? participants : []).some((id) => {
            const entity = getEntity(player, id);
            return entity && entity.isHostile === true && entityHp(entity) > 0;
        });
    }

    function getReason(args) {
        return String(args?.reason || args?.startReason || args?.source || '').trim().toLowerCase();
    }

    function evaluateCombatStartCommand(command, args, options) {
        const player = options?.player || null;
        if (!wantsActiveCombat(command, args)) {
            return { allowed: true, reason: 'not_starting_combat' };
        }
        if (player?.currentCombat?.isActive === true) {
            return { allowed: true, reason: 'combat_already_active' };
        }
        if (hasLivingHostileParticipant(player, args.participants)) {
            return { allowed: true, reason: 'living_hostile_participant' };
        }
        if (EXPLICIT_REASONS.has(getReason(args))) {
            return { allowed: true, reason: 'explicit_combat_reason' };
        }

        return {
            allowed: false,
            reason: 'no_living_hostile_or_explicit_reason',
            message: "[COMBAT GUARD] setCombatState blocked: no living hostile participant or explicit combat reason."
        };
    }

    return Object.freeze({
        wantsActiveCombat,
        evaluateCombatStartCommand
    });
});
