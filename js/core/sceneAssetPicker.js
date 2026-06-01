(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.SceneAssetPicker = factory();
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const DEFAULT_SETTINGS = Object.freeze({
        enabled: true,
        allowRemote: false,
        memeMode: false,
        explicitMode: false,
        enabledRatings: ['sfw']
    });

    function asArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function normalizeSettings(settings, rules) {
        const defaults = Object.assign({}, DEFAULT_SETTINGS, rules?.defaultSettings || {});
        const merged = Object.assign({}, defaults, settings || {});
        merged.enabledRatings = asArray(merged.enabledRatings).length > 0
            ? asArray(merged.enabledRatings)
            : ['sfw'];
        if (merged.memeMode && !merged.enabledRatings.includes('meme')) merged.enabledRatings.push('meme');
        if (merged.explicitMode) {
            if (!merged.enabledRatings.includes('adult')) merged.enabledRatings.push('adult');
            if (!merged.enabledRatings.includes('explicit')) merged.enabledRatings.push('explicit');
        }
        return merged;
    }

    function assetAllowedByMode(asset, settings) {
        if (!asset || settings.enabled === false) return false;
        if (Array.isArray(settings.activePackIds) && settings.activePackIds.length > 0 && asset.pack && !settings.activePackIds.includes(asset.pack)) return false;
        if (!settings.enabledRatings.includes(asset.rating || 'sfw')) return false;
        if (asset.source === 'remote' && settings.allowRemote !== true) return false;
        if (asset.rating === 'meme' && settings.memeMode !== true) return false;
        if ((asset.rating === 'adult' || asset.rating === 'explicit' || asset.requiresOptIn === true) && settings.explicitMode !== true) return false;
        return true;
    }

    function violatesBlockedPairs(asset, scene, rules) {
        const blockedPairs = asArray(rules?.blockedPairs);
        const sceneTags = asArray(scene?.tags);
        const sceneTone = asArray(scene?.tone);
        for (const pair of blockedPairs) {
            if (!pair || pair.rating !== asset.rating) continue;
            if (!sceneTags.includes(pair.tag)) continue;
            if (pair.unlessTone && sceneTone.includes(pair.unlessTone)) continue;
            return true;
        }
        if (asset.blockedInCombat && scene?.combatActive) return true;
        return false;
    }

    function scoreAsset(asset, scene, rules) {
        const scoring = Object.assign({
            tagMatch: 12,
            toneMatch: 5,
            combatMatch: 8,
            intensityDistancePenalty: 3,
            localSourceBonus: 4,
            weightDivisor: 20
        }, rules?.scoring || {});

        const assetTags = asArray(asset.tags);
        const sceneTags = asArray(scene.tags);
        const assetTone = asArray(asset.tone);
        const sceneTone = asArray(scene.tone);
        let score = 0;

        for (const tag of sceneTags) {
            if (assetTags.includes(tag)) score += scoring.tagMatch;
        }
        for (const tone of sceneTone) {
            if (assetTone.includes(tone)) score += scoring.toneMatch;
        }
        if (scene.combatActive && assetTags.includes('combat')) score += scoring.combatMatch;
        if (asset.source === 'local') score += scoring.localSourceBonus;
        score += (Number(asset.weight) || 0) / scoring.weightDivisor;
        score -= Math.abs((Number(asset.intensity) || 1) - (Number(scene.intensity) || 1)) * scoring.intensityDistancePenalty;
        return score;
    }

    function pickAsset({ scene, registry, rules, settings } = {}) {
        const normalizedSettings = normalizeSettings(settings, rules);
        const assets = asArray(registry?.assets);
        if (!scene || assets.length === 0 || normalizedSettings.enabled === false) return null;

        const candidates = assets
            .filter(asset => assetAllowedByMode(asset, normalizedSettings))
            .filter(asset => !asArray(normalizedSettings.excludeAssetIds).includes(asset.id))
            .filter(asset => !violatesBlockedPairs(asset, scene, rules))
            .map(asset => ({ asset, score: scoreAsset(asset, scene, rules) }))
            .filter(entry => entry.score > 0)
            .sort((left, right) => {
                if (right.score !== left.score) return right.score - left.score;
                return String(left.asset.id).localeCompare(String(right.asset.id));
            });

        return candidates.length > 0 ? Object.assign({}, candidates[0].asset, { score: candidates[0].score }) : null;
    }

    return Object.freeze({
        DEFAULT_SETTINGS,
        normalizeSettings,
        pickAsset
    });
});
