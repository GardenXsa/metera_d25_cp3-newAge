/**
 * ============================================================================
 * PREDICTIVE NARRATIVE FEED — Confluence Protocol v2, Innovation 2
 * ============================================================================
 * Алгоритмический прогноз симуляции на N тиков вперёд.
 * Даёт GM три опции: FORESHADOW (описать предвестия), INTERVENE
 * (использовать команду), IGNORE (ничего не делать).
 *
 * ПРИНЦИПЫ:
 * 1. Прогноз детерминирован — алгоритмический, не LLM
 * 2. Прогноз основан на трендах (кэш предыдущих значений)
 * 3. Только пороговые переходы (БУНТ, ВЫНУЖДЕННЫЙ МИР и т.д.)
 * 4. Горизонт: 3 тика (configurable)
 *
 * GitHub Issue: #191
 * Confluence Master: #189
 * ============================================================================
 */

window.PredictiveFeed = (() => {
    'use strict';

    // ========================================================================
    // Пороги для прогнозов (соответствуют WorldManifest.THRESHOLD_LABELS)
    // ========================================================================

    const THRESHOLDS = {
        stability: {
            bunt: { value: 15, label: 'БУНТ', direction: 'down' },
            preBunt: { value: 30, label: 'ПРЕДБУНТ', direction: 'down' },
            unstable: { value: 50, label: 'НЕСТАБИЛЬНО', direction: 'down' }
        },
        threat: {
            crisis: { value: 56, label: 'КРИЗИС', direction: 'up' },
            anarchy: { value: 76, label: 'АНАРХИЯ', direction: 'up' },
            war: { value: 91, label: 'ВОЙНА', direction: 'up' }
        },
        warExhaustion: {
            exhausted: { value: 51, label: 'ИСТОЩЕНА', direction: 'up' },
            forcedPeace: { value: 71, label: 'ВЫНУЖДЕННЫЙ МИР', direction: 'up' },
            collapse: { value: 86, label: 'КОЛЛАПС', direction: 'up' }
        }
    };

    // ========================================================================
    // Внутреннее состояние
    // ========================================================================

    let _previousState = null;   // Кэш предыдущего состояния
    let _config = {
        maxPredictionTicks: 2,   // Горизонт прогноза (спецификация: 2 тика)
        maxPredictions: 5,       // Максимум прогнозов в отчёте
        enabled: true
    };

    // ========================================================================
    // Основной API
    // ========================================================================

    /**
     * Построить Predictive Narrative Feed.
     * @param {Object} world - Глобальный объект World
     * @param {string} playerLocation - Локация игрока
     * @returns {string} Текстовый прогноз для AI контекста
     */
    function build(world, playerLocation) {
        if (!_config.enabled || !world || !world.regions) return '';

        const predictions = [];

        // 1. Прогноз по регионам (stability + threat)
        for (const rId in world.regions) {
            const r = world.regions[rId];
            const isPlayerRegion = _isPlayerRegion(r, playerLocation);

            // Прогноз stability
            const stabPreds = _predictMetric(
                'stability', r.stability || 50, rId, r.name, isPlayerRegion
            );
            predictions.push(...stabPreds);

            // Прогноз threat
            const threatPreds = _predictMetric(
                'threat', r.threat_level || 0, rId, r.name, isPlayerRegion
            );
            predictions.push(...threatPreds);
        }

        // 2. Прогноз по фракциям (warExhaustion)
        if (world.factions) {
            for (const fId in world.factions) {
                const f = world.factions[fId];
                const wexPreds = _predictMetric(
                    'warExhaustion', f.warExhaustion || 0, fId, f.name || fId, false
                );
                predictions.push(...wexPreds);
            }
        }

        // 3. Фильтр: только прогнозы на <= maxPredictionTicks
        const filtered = predictions
            .filter(p => p.ticksToCross <= _config.maxPredictionTicks)
            .sort((a, b) => a.ticksToCross - b.ticksToCross)
            .slice(0, _config.maxPredictions);

        if (filtered.length === 0) return '';

        return _formatPredictions(filtered);
    }

    /**
     * Обновить кэш предыдущего состояния.
     * Вызывать ПОСЛЕ каждого тика симуляции.
     * @param {Object} world
     */
    function updateCache(world) {
        if (!world) return;
        _previousState = _captureState(world);
    }

    /**
     * Получить конфиг
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
    // Прогнозирование
    // ========================================================================

    function _predictMetric(metric, currentValue, entityId, entityName, isPlayerRegion) {
        const predictions = [];
        const thresholds = THRESHOLDS[metric];
        if (!thresholds) return predictions;

        // Рассчитать тренд
        const trend = _getTrend(metric, entityId, currentValue);

        for (const [key, threshold] of Object.entries(thresholds)) {
            const ticksToCross = _estimateTicksToThreshold(
                currentValue, threshold.value, trend, threshold.direction
            );

            if (ticksToCross > 0 && ticksToCross <= _config.maxPredictionTicks) {
                // Определить варианты действий для GM
                const options = _generateOptions(metric, threshold.label, entityId);

                predictions.push({
                    metric,
                    entityId,
                    entityName: entityName || entityId,
                    currentLabel: _getCurrentLabel(metric, currentValue),
                    thresholdLabel: threshold.label,
                    currentValue,
                    thresholdValue: threshold.value,
                    trend,
                    ticksToCross,
                    isPlayerRegion,
                    options
                });
            }
        }

        return predictions;
    }

    function _estimateTicksToThreshold(currentValue, thresholdValue, trendPerTick, direction) {
        if (trendPerTick === 0) return Infinity;

        let ticks;
        if (direction === 'up') {
            // Значение растёт → пересечёт порог снизу
            if (currentValue >= thresholdValue) return Infinity; // уже пересечён
            ticks = Math.ceil((thresholdValue - currentValue) / Math.abs(trendPerTick));
        } else {
            // Значение падает → пересечёт порог сверху
            if (currentValue <= thresholdValue) return Infinity; // уже пересечён
            ticks = Math.ceil((currentValue - thresholdValue) / Math.abs(trendPerTick));
        }

        return ticks > 0 ? ticks : Infinity;
    }

    function _getTrend(metric, entityId, currentValue) {
        if (!_previousState || !_previousState[metric]) return 0;

        const prev = _previousState[metric][entityId];
        if (prev === undefined || prev === null) return 0;

        // Тренд = текущее - предыдущее (за один тик)
        const trend = currentValue - prev;

        // Если тренд нулевой, используем минимальный предполагаемый тренд
        // (для стабильности -1 за тик если уже ниже 50, и т.д.)
        if (trend === 0) {
            if (metric === 'stability' && currentValue < 50) return -1;
            if (metric === 'threat' && currentValue > 50) return 1;
            if (metric === 'warExhaustion' && currentValue > 30) return 1;
            return 0;
        }

        return trend;
    }

    function _getCurrentLabel(metric, value) {
        if (!window.WorldManifest) return '';
        if (metric === 'stability') return WorldManifest.translateStability(value).label;
        if (metric === 'threat') return WorldManifest.translateThreat(value).label;
        if (metric === 'warExhaustion') return WorldManifest.translateWarExhaustion(value).label;
        return '';
    }

    function _generateOptions(metric, thresholdLabel, entityId) {
        const options = [];

        // FORESHADOW — всегда доступно
        const foreshadowDescriptions = {
            'БУНТ': 'Опиши брожение в народе, крики, камни в руках',
            'ПРЕДБУНТ': 'Опиши нервозность, шёпот о недовольстве',
            'НЕСТАБИЛЬНО': 'Опиши протесты, закрытые лавки',
            'КРИЗИС': 'Опиши тревогу, запертые двери, вооружённые патрули',
            'АНАРХИЯ': 'Опиши хаос, горящие баррикады, мародёрство',
            'ВОЙНА': 'Опиши марширующие колонны, барабаны войны',
            'ИСТОЩЕНА': 'Опиши усталость солдат, пустые котелки, дезертирство',
            'ВЫНУЖДЕННЫЙ МИР': 'Опиши переговоры о мире, усталость от войны',
            'КОЛЛАПС': 'Опиши развал армии, бегство командиров'
        };

        options.push({
            type: 'FORESHADOW',
            description: foreshadowDescriptions[thresholdLabel] || 'Опиши предвестия'
        });

        // INTERVENE — зависит от метрики
        if (metric === 'stability') {
            options.push({
                type: 'INTERVENE',
                command: 'gmDirectResourceInjection',
                description: `Ввести ресурсы в ${entityId} для стабилизации`
            });
        } else if (metric === 'warExhaustion') {
            options.push({
                type: 'INTERVENE',
                command: 'gmForcePeace',
                description: `Принудить к миру через gmForcePeace`
            });
        }
        // threat — нет прямой интервенции через GM команды

        // IGNORE — всегда доступно
        options.push({
            type: 'IGNORE',
            description: 'Событие произойдёт без вмешательства'
        });

        return options;
    }

    // ========================================================================
    // Форматирование
    // ========================================================================

    function _formatPredictions(predictions) {
        let out = "\n=== PREDICTIVE NARRATIVE FEED ===\n";
        out += "🔮 ПРОГНОЗ НА " + _config.maxPredictionTicks + " ТИКА ВПЕРЁД:\n\n";

        predictions.forEach((p, idx) => {
            const prefix = p.isPlayerRegion ? '📍' : '🌐';
            out += `${idx + 1}. ${prefix} [${p.entityName}] ${p.thresholdLabel} через ~${p.ticksToCross} тик(ов)\n`;
            out += `   → ${p.metric}: ${p.currentValue} → порог ${p.thresholdValue} (${p.currentLabel} → ${p.thresholdLabel})\n`;
            out += `   → Тренд: ${p.trend > 0 ? '+' : ''}${p.trend} за тик\n`;

            // Варианты действий
            const optionStrs = p.options.map(o => {
                if (o.type === 'FORESHADOW') return `FORESHADOW (${o.description})`;
                if (o.type === 'INTERVENE') return `INTERVENE (${o.command})`;
                return `IGNORE`;
            });
            out += `   → ВАРИАНТЫ: ${optionStrs.join(' | ')}\n\n`;
        });

        out += "=== КОНЕЦ ПРОГНОЗА ===\n";
        return out;
    }

    // ========================================================================
    // Кэширование состояния
    // ========================================================================

    function _captureState(world) {
        const state = {
            stability: {},
            threat: {},
            warExhaustion: {}
        };

        if (world.regions) {
            for (const rId in world.regions) {
                const r = world.regions[rId];
                state.stability[rId] = r.stability || 50;
                state.threat[rId] = r.threat_level || 0;
            }
        }

        if (world.factions) {
            for (const fId in world.factions) {
                state.warExhaustion[fId] = world.factions[fId].warExhaustion || 0;
            }
        }

        return state;
    }

    function _isPlayerRegion(r, playerLocation) {
        if (!playerLocation) return false;
        return playerLocation.toLowerCase().includes((r.name || '').toLowerCase());
    }

    // ========================================================================
    // Публичный интерфейс
    // ========================================================================

    return {
        build,
        updateCache,
        getConfig,
        setConfig,
        THRESHOLDS
    };
})();
