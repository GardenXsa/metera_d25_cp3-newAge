(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.EconomicDeficitVector = factory();
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    function getTags(itemDef) {
        return Array.isArray(itemDef && itemDef.tags) ? itemDef.tags : [];
    }

    function hasTag(itemDef, tag) {
        return getTags(itemDef).includes(tag);
    }

    function getPopulationDemandWeight(itemId, itemDef) {
        if (!itemId || !itemDef) return 0;
        const category = itemDef.category || '';

        if (hasTag(itemDef, 'food')) return 1.0;
        if (hasTag(itemDef, 'tool') || hasTag(itemDef, 'weapon') || hasTag(itemDef, 'armor') || hasTag(itemDef, 'medical')) return 0.1;
        if (hasTag(itemDef, 'luxury') || hasTag(itemDef, 'potion')) return 0.05;
        if (category === 'consumable') return 0.2;

        return 0;
    }

    function computeGlobalEconomicDeficits(options) {
        const regions = options && options.regions || {};
        const economyItems = options && options.economyItems || {};
        const countItems = options && options.countItems;
        const maxResults = Math.max(0, Number(options && options.maxResults) || 3);
        const baseDemandRatio = Number(options && options.baseDemandRatio) || 0.01;

        if (typeof countItems !== 'function') return [];

        const goodsStats = {};
        for (const [good, itemDef] of Object.entries(economyItems)) {
            const weight = getPopulationDemandWeight(good, itemDef);
            if (weight <= 0) continue;
            goodsStats[good] = { stock: 0, demand: 0, weight };
        }

        for (const region of Object.values(regions)) {
            if (!region || !region.vault_id) continue;
            const population = Math.max(0, Number(region.population) || 0);
            for (const [good, stats] of Object.entries(goodsStats)) {
                stats.stock += Math.max(0, Number(countItems(region.vault_id, good)) || 0);
                stats.demand += population * baseDemandRatio * stats.weight;
            }
        }

        return Object.entries(goodsStats)
            .filter(([, stats]) => stats.demand > 0)
            .map(([good, stats]) => ({
                good,
                ratio: stats.demand / (stats.stock + 1),
                stock: stats.stock,
                demand: stats.demand
            }))
            .sort((left, right) => right.ratio - left.ratio)
            .slice(0, maxResults);
    }

    return Object.freeze({
        getPopulationDemandWeight,
        computeGlobalEconomicDeficits
    });
});
