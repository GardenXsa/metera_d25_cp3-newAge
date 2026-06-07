/**
 * ============================================================================
 * WORLD MANIFEST — Confluence Protocol v2, Innovation 1
 * ============================================================================
 * Детерминированный текстовый отчёт состояния мира.
 * Заменяет MASMP-векторы (числа без смысла) на семантические метки,
 * которые GM читает как прямые инструкции для нарратива.
 *
 * ПРИНЦИПЫ:
 * 1. Всё детерминировано — алгоритмический перевод числа → смысл
 * 2. НЕ LLM — Manifest генерируется кодом, не языковой моделью
 * 3. Симуляция = источник истины — числа из C++ приоритет
 * 4. Каждая метка = нарративная инструкция для GM
 *
 * GitHub Issue: #190
 * ============================================================================
 */

window.WorldManifest = (() => {
    'use strict';

    // ========================================================================
    // ПРАВИЛА ПЕРЕВОДА: Числа → Смысл
    // ========================================================================

    const THRESHOLD_LABELS = {
        threat: [
            { max: 15, label: 'БЕЗОПАСНО',      narrative: 'Тихий край, стража бдит' },
            { max: 35, label: 'НАПРЯЖЁННО',     narrative: 'Слухи о разбоях, настороженность' },
            { max: 55, label: 'РАЗБОЙ НА ДОРОГАХ', narrative: 'Банды открыто грабят тракты' },
            { max: 75, label: 'КРИЗИС',          narrative: 'Зоны вне контроля власти' },
            { max: 90, label: 'АНАРХИЯ',         narrative: 'Хаос, грабежи, безвластие' },
            { max: 100, label: 'ВОЙНА',          narrative: 'Открытые боевые действия на территории' }
        ],
        stability: [
            { max: 15, label: 'БУНТ',            narrative: 'Открытое восстание' },
            { max: 30, label: 'ПРЕДБУНТ',        narrative: 'Народ на грани' },
            { max: 50, label: 'НЕСТАБИЛЬНО',      narrative: 'Протесты, саботаж' },
            { max: 70, label: 'НАПРЯЖЁННО',      narrative: 'Недовольство, но порядок держится' },
            { max: 85, label: 'СТАБИЛЬНО',        narrative: 'Твёрдая власть, порядок' },
            { max: 100, label: 'ПРОЦВЕТАНИЕ',     narrative: 'Золотой век, народ доволен' }
        ],
        warExhaustion: [
            { max: 20, label: 'ВОЙНА НАЧАЛАСЬ',   narrative: 'Фракция полна сил', prediction: null },
            { max: 50, label: 'ВЫНОСИТ',          narrative: 'Фронт держится', prediction: null },
            { max: 70, label: 'ИСТОЩЕНА',         narrative: 'Голод, дезертирство', prediction: 'ВЫНУЖДЕННЫЙ МИР' },
            { max: 85, label: 'ВЫНУЖДЕННЫЙ МИР',  narrative: 'Нужно перемирие', prediction: 'КОЛЛАПС' },
            { max: 100, label: 'КОЛЛАПС',         narrative: 'Армия разваливается', prediction: 'КОЛЛАПС' }
        ],
        priceDeviation: [
            { max: 0.5,  label: 'ДЕФИЦИТ',        narrative: 'Острый голод/нехватка' },
            { max: 0.8,  label: 'ДОРОГО',          narrative: 'Выше нормы' },
            { max: 1.2,  label: 'НОРМА',           narrative: 'Обычная цена' },
            { max: 2.0,  label: 'ДЕШЁВЫЙ',         narrative: 'Избыток' },
            { max: Infinity, label: 'НАВОДНЕНИЕ РЫНКА', narrative: 'Рынок затоварен' }
        ]
    };

    const SEASON_MAP = {
        spring: 'Весна', summer: 'Лето',
        autumn: 'Осень', winter: 'Зима'
    };

    const WEATHER_MAP = {
        clear: 'Ясно', rain: 'Дождь', storm: 'Шторм',
        snow: 'Снег', fog: 'Туман', cloudy: 'Облачно',
        heatwave: 'Жара', drought: 'Засуха'
    };

    const GOOD_NAMES = {
        bread: 'Хлеб', food: 'Хлеб',
        wood: 'Дерево', iron_ore: 'Руда',
        weapons: 'Оружие', ore: 'Руда',
        weap: 'Оружие'
    };

    // Расстояние от порога для прогноза (в тиках)
    const PREDICTION_HORIZON = 3;

    // ========================================================================
    // Внутреннее состояние
    // ========================================================================

    let _cachedDeltas = [];
    let _config = {
        useManifest: true,   // false → fallback на MASMP
        showNumericValues: true,  // показывать числа рядом с метками
        maxFactionEntries: 10,    // лимит фракций в отчёте
        maxPredictionTicks: 3     // горизонт прогноза
    };

    // ========================================================================
    // Основной API
    // ========================================================================

    /**
     * Построить полный World Manifest.
     * @param {Object} world - Глобальный объект World
     * @param {string} playerLocation - Текущая локация игрока
     * @param {Object} player - Объект игрока
     * @returns {string} Текстовый Manifest для AI контекста
     */
    function build(world, playerLocation, player) {
        if (!world || !world.regions) {
            return "\n=== WORLD MANIFEST ===\n[Данные симуляции недоступны]\n";
        }

        let manifest = "\n=== WORLD MANIFEST ===\n";

        // 1. Определить регион игрока
        const playerRegion = _findPlayerRegion(world, playerLocation);

        // 2. Детальный отчёт по региону игрока
        if (playerRegion) {
            manifest += _formatRegion(playerRegion, world, true);
        } else {
            manifest += "[Регион игрока не определён]\n";
        }

        // 3. Фракции (все, с семантикой)
        manifest += _formatAllFactions(world);

        // 4. Глобальная экономика (дефициты)
        manifest += _formatGlobalEconomy(world);

        // 5. Монстры
        manifest += _formatMonsters(world);

        // 6. Бедствия
        manifest += _formatDisasters(world);

        // 7. Новости
        manifest += _formatNews(world);

        manifest += "==================================================\n";

        return manifest;
    }

    /**
     * Построить упрощённый Manifest для начального промпта.
     * @param {Object} world - Глобальный объект World
     * @param {string} startRegionId - ID стартового региона
     * @returns {string} Упрощённый Manifest
     */
    function buildInitial(world, startRegionId) {
        if (!world || !world.regions || !startRegionId || !world.regions[startRegionId]) {
            return "";
        }

        let manifest = "\n=== WORLD MANIFEST ===\n";

        const r = world.regions[startRegionId];
        manifest += _formatRegion({ id: startRegionId, ...r }, world, true);

        // Монстры в стартовом регионе
        const monsters = (world.monsters || []).filter(m => m.health > 0 && m.region_id === startRegionId);
        if (monsters.length > 0) {
            manifest += `\n[КРИТИЧЕСКАЯ УГРОЗА В РЕГИОНЕ]: `;
            manifest += monsters.map(m =>
                `${m.name || m.type} (Ур.${m.level}) — ${translateThreat(80).label}!`
            ).join('; ');
            manifest += '\nТЫ КАТЕГОРИЧЕСКИ ОБЯЗАН сделать чудовище главной темой стартового описания!\n';
        }

        // Бедствия в стартовом регионе
        const disasters = (world.map && world.map.disasters)
            ? world.map.disasters.filter(d => d.days_active > 0 && d.affected_regions.includes(startRegionId))
            : [];
        if (disasters.length > 0) {
            manifest += `\n[АКТИВНОЕ БЕДСТВИЕ В РЕГИОНЕ]: `;
            manifest += disasters.map(d => `${d.type} — ${translateStability(15).label}!`).join('; ');
            manifest += '\nТЫ ОБЯЗАН описать бедствие в стартовом тексте!\n';
        }

        // Новости
        manifest += _formatNews(world);

        manifest += "==================================================\n";

        return manifest;
    }

    /**
     * Применить Manifest delta (для Dual-Write Gateway).
     * @param {Object} delta - Структура delta от DualWriteGateway
     */
    function applyDelta(delta) {
        if (delta && delta.events) {
            for (const event of delta.events) {
                _cachedDeltas.push(event);
            }
        }
    }

    /**
     * Получить текущий конфиг
     */
    function getConfig() {
        return { ..._config };
    }

    /**
     * Обновить конфиг
     */
    function setConfig(updates) {
        Object.assign(_config, updates);
    }

    // ========================================================================
    // Семантические переводчики (публичные — используются CommandFeedback)
    // ========================================================================

    function translateThreat(value) {
        return _findLabel(THRESHOLD_LABELS.threat, value);
    }

    function translateStability(value) {
        return _findLabel(THRESHOLD_LABELS.stability, value);
    }

    function translateWarExhaustion(value) {
        return _findLabel(THRESHOLD_LABELS.warExhaustion, value);
    }

    function translatePrice(current, baseline) {
        if (!baseline || baseline === 0) return { label: 'НОРМА', narrative: 'Цена неизвестна' };
        const ratio = baseline / current;
        return _findLabel(THRESHOLD_LABELS.priceDeviation, ratio);
    }

    function translateSeason(season) {
        return SEASON_MAP[season] || season;
    }

    function translateWeather(weather) {
        return WEATHER_MAP[weather] || weather || 'Ясно';
    }

    function getGoodName(goodKey) {
        return GOOD_NAMES[goodKey] || goodKey;
    }

    // ========================================================================
    // Приватные методы форматирования
    // ========================================================================

    function _findPlayerRegion(world, playerLocation) {
        if (!playerLocation || !world.regions) return null;
        const loc = playerLocation.toLowerCase();
        for (const rId in world.regions) {
            const r = world.regions[rId];
            if (loc.includes(r.name.toLowerCase())) {
                return { id: rId, ...r };
            }
        }
        return null;
    }

    function _findLabel(labelArray, value) {
        for (const entry of labelArray) {
            if (value <= entry.max) {
                return { label: entry.label, narrative: entry.narrative, prediction: entry.prediction || null };
            }
        }
        return labelArray[labelArray.length - 1];
    }

    function _formatRegion(region, world, isDetailed) {
        let out = "";
        const rId = region.id;
        const r = region;

        // Заголовок региона
        const ownerFaction = world.factions ? world.factions[r.factionId] : null;
        const ownerId = ownerFaction ? (ownerFaction.id || r.factionId) : 'none';
        const ownerName = ownerFaction ? (ownerFaction.name || ownerId) : ownerId;

        out += `\n📍 ${r.name || rId} (${ownerName})\n`;

        // Сезон и погода
        const season = translateSeason(r.current_season);
        const weather = translateWeather(r.weather);
        out += `  Сезон: ${season} | Погода: ${weather}\n`;

        // Угроза
        const threatInfo = translateThreat(r.threat_level || 0);
        out += `  Угроза: ${threatInfo.label}`;
        if (_config.showNumericValues) out += ` (${r.threat_level || 0}/100)`;
        out += ` — ${threatInfo.narrative}\n`;

        // Стабильность
        const stabInfo = translateStability(r.stability || 50);
        out += `  Стабильность: ${stabInfo.label}`;
        if (_config.showNumericValues) out += ` (${r.stability || 50}/100)`;
        out += ` — ${stabInfo.narrative}\n`;

        // Оккупация
        if (r.isOccupied) {
            const occName = (world.factions && world.factions[r.occupierFactionId])
                ? world.factions[r.occupierFactionId].name : r.occupierFactionId || 'неизвестно';
            out += `  Оккупация: ДА (${occName})\n`;
        }

        // Экономика (цены)
        if (isDetailed && r.markets) {
            out += _formatRegionEconomy(r, world);
        }

        // Здания
        if (isDetailed && r.cityLayout && r.cityLayout.length > 0) {
            const bldgs = r.cityLayout
                .filter(b => b.type !== 'empty' && b.type !== 'road')
                .map(b => `${b.type}:${b.sublocation_id}`);
            if (bldgs.length > 0) {
                out += `  Здания: ${bldgs.join(', ')}\n`;
            }
        }

        return out;
    }

    function _formatRegionEconomy(r, world) {
        let out = "  Рынок: ";

        const marketFallbackPrices = (typeof getGameplayRuntimeConfig === 'function')
            ? (getGameplayRuntimeConfig().economy?.market_fallback_prices || {})
            : {};

        const priceEntries = [];
        const goodKeys = [
            { key: 'bread', name: 'Хлеб', fallback: marketFallbackPrices.bread || 5 },
            { key: 'wood', name: 'Дерево', fallback: marketFallbackPrices.wood || 3 },
            { key: 'iron_ore', name: 'Руда', fallback: marketFallbackPrices.iron_ore || 8 },
            { key: 'weapons', name: 'Оружие', fallback: marketFallbackPrices.weapons || 15 }
        ];

        for (const g of goodKeys) {
            const price = r.markets[g.key] ?? g.fallback;
            const priceInfo = translatePrice(price, g.fallback);
            const arrow = priceInfo.label === 'ДЕФИЦИТ' ? '↑' :
                         priceInfo.label === 'ДОРОГО' ? '↑' :
                         priceInfo.label === 'ДЕШЁВЫЙ' ? '↓' :
                         priceInfo.label === 'НАВОДНЕНИЕ РЫНКА' ? '↓↓' : '';
            priceEntries.push(`${g.name}${arrow} ${priceInfo.label}`);
        }

        out += priceEntries.join(' | ') + '\n';
        return out;
    }

    function _formatAllFactions(world) {
        if (!world.factions) return "";

        let out = "\n⚔️ Фракции:\n";
        let count = 0;

        for (const fId in world.factions) {
            if (count >= _config.maxFactionEntries) break;
            const f = world.factions[fId];
            out += _formatFaction(fId, f, world);
            count++;
        }

        return out;
    }

    function _formatFaction(fId, f, world) {
        let out = `  ${fId}: `;

        // Истощение войны
        const wexInfo = translateWarExhaustion(f.warExhaustion || 0);
        out += `Истощение ${f.warExhaustion || 0}/100 (${wexInfo.label})`;

        // Войны
        const enemies = (f.diplomacy)
            ? Object.keys(f.diplomacy).filter(t => f.diplomacy[t] === 'war')
            : [];
        if (enemies.length > 0) {
            out += ` | Война: ${enemies.join(', ')}`;
        }

        // Прогноз
        if (wexInfo.prediction) {
            const ticksToThreshold = _estimateTicksToThreshold(
                f.warExhaustion || 0,
                _findNextThreshold('warExhaustion', f.warExhaustion || 0),
                2 // примерный темп роста за тик
            );
            if (ticksToThreshold <= _config.maxPredictionTicks) {
                out += ` | ⚠️ ${wexInfo.prediction} через ~${ticksToThreshold} тик(ов)`;
            }
        }

        out += '\n';
        return out;
    }

    function _formatGlobalEconomy(world) {
        if (!world.regions) return "";

        let out = "\n🌐 Глобальный дефицит: ";

        const goodsStats = {};
        for (const rId in world.regions) {
            const r = world.regions[rId];
            if (!r.vault_id) continue;
            const pop = r.population || 0;
            for (const good in (typeof ECONOMY_ITEMS !== 'undefined' ? ECONOMY_ITEMS : {})) {
                if (!goodsStats[good]) goodsStats[good] = { stock: 0, demand: 0 };
                goodsStats[good].stock += (typeof countRealItems === 'function')
                    ? countRealItems(r.vault_id, good) : 0;
                goodsStats[good].demand += pop * 0.01;
            }
        }

        const deficitArray = [];
        for (const good in goodsStats) {
            const ratio = goodsStats[good].demand / (goodsStats[good].stock + 1);
            if (ratio > 1.0) { // Только дефицит
                const priceInfo = translatePrice(1, ratio);
                deficitArray.push({
                    good: getGoodName(good),
                    ratio: ratio.toFixed(1),
                    label: priceInfo.label
                });
            }
        }

        deficitArray.sort((a, b) => parseFloat(b.ratio) - parseFloat(a.ratio));

        if (deficitArray.length === 0) {
            out += "Нет критических дефицитов\n";
        } else {
            out += deficitArray.slice(0, 3).map(d =>
                `${d.good} (${d.ratio}x нормы — ${d.label})`
            ).join(', ') + '\n';
        }

        return out;
    }

    function _formatMonsters(world) {
        if (!world.monsters) return "";

        const active = world.monsters.filter(m => m.health > 0);
        if (active.length === 0) return "";

        let out = "\n🐉 Монстры: ";
        out += active.map(m => `${m.name || m.type} (Ур.${m.level}) в ${m.region_id}`).join(' | ');
        out += '\n';

        return out;
    }

    function _formatDisasters(world) {
        if (!world.map || !world.map.disasters) return "";

        const active = world.map.disasters.filter(d => d.days_active > 0);
        if (active.length === 0) return "";

        let out = "\n🌪️ Бедствия: ";
        out += active.map(d => `${d.type} (${d.affected_regions.join(', ')})`).join(' | ');
        out += '\n';

        return out;
    }

    function _formatNews(world) {
        if (!world.relevant_news || world.relevant_news.length === 0) {
            return "\n=== СВЕЖИЕ СОБЫТИЯ ===\nНет свежих новостей.\n";
        }

        let out = "\n=== СВЕЖИЕ СОБЫТИЯ ===\n";
        out += world.relevant_news.map(n => {
            const daysOld = Math.max(0, (world.current_day || 0) - (n.day || 0));
            const text = (typeof parseLocString === 'function') ? parseLocString(n.text) : n.text;
            return `[${daysOld}d назад, ${n.location}] ${text}`;
        }).join('\n');
        out += '\n';

        return out;
    }

    // ========================================================================
    // Прогнозные утилиты
    // ========================================================================

    function _findNextThreshold(metric, currentValue) {
        const labels = THRESHOLD_LABELS[metric];
        if (!labels) return null;
        for (const entry of labels) {
            if (currentValue < entry.max) {
                return entry.max;
            }
        }
        return null;
    }

    function _estimateTicksToThreshold(currentValue, threshold, trendPerTick) {
        if (!threshold || trendPerTick <= 0) return Infinity;
        const ticks = Math.ceil((threshold - currentValue) / trendPerTick);
        return ticks > 0 ? ticks : Infinity;
    }

    // ========================================================================
    // Публичный интерфейс
    // ========================================================================

    return {
        build,
        buildInitial,
        applyDelta,
        getConfig,
        setConfig,

        // Семантические переводчики (публичные)
        translateThreat,
        translateStability,
        translateWarExhaustion,
        translatePrice,
        translateSeason,
        translateWeather,
        getGoodName,

        // Пороговые таблицы (для CommandFeedback и PredictiveFeed)
        THRESHOLD_LABELS
    };
})();
