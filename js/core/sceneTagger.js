(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.SceneTagger = factory();
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const DEFAULT_HINTS = {
        combat: ['бой', 'битва', 'атака', 'атак', 'удар', 'клинок', 'меч', 'алебарда', 'combat', 'battle', 'attack', 'blade'],
        rain: ['дожд', 'ливень', 'rain', 'storm'],
        fire: ['огонь', 'плам', 'горящ', 'горят', 'горит', 'гарь', 'fire', 'flame', 'burn'],
        camp: ['лагерь', 'палат', 'camp', 'tent'],
        blood: ['кров', 'рана', 'blood', 'wound'],
        travel: ['дорог', 'тракт', 'путь', 'travel', 'road'],
        tavern: ['таверн', 'трактир', 'tavern', 'inn'],
        city: ['город', 'столиц', 'рынок', 'city', 'market'],
        forest: ['лес', 'чащ', 'forest', 'woods'],
        horror: ['ужас', 'кошмар', 'тень', 'horror', 'nightmare', 'shadow'],
        dice_fail: ['провал', 'промах', 'неудач', 'fail', 'miss'],
        combat_miss: ['промах', 'уходит в пустоту', 'miss'],
        critical_success: ['критический успех', 'натуральная 20', 'critical success', 'natural 20'],
        death: ['смерть', 'труп', 'погиб', 'dead', 'death'],
        sex: ['секс', 'похоть', 'бордель', 'brothel', 'sex'],
        romance: ['роман', 'поцел', 'нежн', 'romance', 'kiss'],
        consensual: ['соглас', 'consensual']
    };

    function normalizeText(value) {
        let text = String(value || '').toLowerCase();
        if (typeof text.normalize === 'function') text = text.normalize('NFKC');
        return text.replace(/\s+/g, ' ').trim();
    }

    function unique(values) {
        return Array.from(new Set(values.filter(Boolean)));
    }

    function getHintMap(rules) {
        return rules && rules.tagHints ? rules.tagHints : DEFAULT_HINTS;
    }

    function collectEntityTags(playerObj) {
        const tags = [];
        const player = playerObj || {};
        if (player.currentCombat && player.currentCombat.isActive === true) tags.push('combat');
        const entities = player.visibleEntities || player.environment || {};
        for (const entity of Object.values(entities)) {
            if (!entity) continue;
            const hp = Number(entity.hp ?? entity.stats?.hp ?? 0);
            if (entity.isHostile === true && hp > 0) tags.push('combat');
            const name = normalizeText(entity.name || entity.aiIdentifier || '');
            if (name.includes('импер') || name.includes('imperial')) tags.push('imperial');
            if (name.includes('монстр') || name.includes('monster')) tags.push('monster');
        }
        return tags;
    }

    function inferTone(tags) {
        const tone = [];
        if (tags.includes('horror')) tone.push('horror', 'tense');
        if (tags.includes('combat') || tags.includes('blood')) tone.push('grim', 'dramatic');
        if (tags.includes('dice_fail') || tags.includes('combat_miss')) tone.push('comedy');
        if (tags.includes('sex') || tags.includes('romance')) tone.push('erotic');
        if (tags.includes('tavern') || tags.includes('city')) tone.push('social');
        if (tone.length === 0) tone.push('neutral');
        return unique(tone);
    }

    function inferIntensity(tags, playerObj) {
        let intensity = 1;
        if (tags.includes('rain') || tags.includes('travel')) intensity = Math.max(intensity, 2);
        if (tags.includes('fire') || tags.includes('horror')) intensity = Math.max(intensity, 3);
        if (tags.includes('combat') || tags.includes('blood')) intensity = Math.max(intensity, 4);
        if (tags.includes('death')) intensity = Math.max(intensity, 5);
        if (playerObj && playerObj.currentCombat && playerObj.currentCombat.isActive === true) intensity = Math.max(intensity, 4);
        return intensity;
    }

    function analyzeScene(text, playerObj = {}, rules = null) {
        const normalized = normalizeText(text);
        const tags = [];
        const hints = getHintMap(rules);

        for (const [tag, markers] of Object.entries(hints)) {
            if (!Array.isArray(markers)) continue;
            if (markers.some(marker => normalized.includes(normalizeText(marker)))) tags.push(tag);
        }

        tags.push(...collectEntityTags(playerObj));
        const uniqueTags = unique(tags);

        return {
            tags: uniqueTags,
            tone: inferTone(uniqueTags),
            intensity: inferIntensity(uniqueTags, playerObj),
            combatActive: playerObj && playerObj.currentCombat && playerObj.currentCombat.isActive === true
        };
    }

    function getSceneKind(scene) {
        const tags = scene && scene.tags || [];
        if (scene && scene.combatActive || tags.includes('combat')) return 'combat';
        if (tags.includes('horror')) return 'horror';
        if (tags.includes('sex') || tags.includes('romance')) return 'intimate';
        if (tags.includes('travel')) return 'travel';
        if (tags.includes('tavern') || tags.includes('city')) return 'social';
        return 'scene';
    }

    function getThreatLabel(intensity) {
        if (intensity >= 5) return 'Критическая угроза';
        if (intensity >= 4) return 'Высокая угроза';
        if (intensity >= 3) return 'Напряжение';
        if (intensity >= 2) return 'Фоновая опасность';
        return 'Спокойная сцена';
    }

    function getKindLabel(kind) {
        const labels = {
            combat: 'Боевой эпизод',
            horror: 'Тревожная сцена',
            intimate: 'Интимная сцена',
            travel: 'Путь',
            social: 'Социальная сцена',
            scene: 'Сцена'
        };
        return labels[kind] || labels.scene;
    }

    function buildScenePresentation(scene, playerObj = {}) {
        const safeScene = scene || { tags: [], tone: [], intensity: 1, combatActive: false };
        const kind = getSceneKind(safeScene);
        const primaryTags = unique([
            ...(safeScene.combatActive ? ['combat'] : []),
            ...((safeScene.tags || []).filter(tag => !['consensual'].includes(tag)))
        ]).slice(0, 6);
        return {
            kind,
            kindLabel: getKindLabel(kind),
            location: playerObj.location || '',
            threatLabel: getThreatLabel(Number(safeScene.intensity) || 1),
            intensity: Number(safeScene.intensity) || 1,
            primaryTags,
            tone: safeScene.tone || [],
            combatActive: safeScene.combatActive === true
        };
    }

    return Object.freeze({
        analyzeScene,
        buildScenePresentation,
        normalizeText
    });
});
