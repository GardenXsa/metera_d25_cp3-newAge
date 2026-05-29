/**
 * ============================================================================
 * RECONCILIATION BUFFER — Confluence Protocol v2, Innovation 4
 * ============================================================================
 * Два буфера для синхронизации нарратива и симуляции:
 * 1. UNACKNOWLEDGED_SIM_EVENTS — симуляция изменила мир, GM не описал
 * 2. ORPHANED_NARRATIVE — GM описал событие, но не использовал команду
 *
 * ПРИНЦИПЫ:
 * 1. UNACKNOWLEDGED: Manifest-метка изменилась, GM не описал в нарративе
 * 2. ORPHANED: нарратив содержит паттерн NarrativeCommandMap, но нет команды
 * 3. Автокоррекция для безопасных ORPHANED (addItem gold, setCombatState)
 * 4. UNACKNOWLEDGED после 2 ходов → CRITICAL gmErrors
 *
 * GitHub Issue: #193
 * Confluence Master: #189
 * ============================================================================
 */

window.ReconciliationBuffer = (() => {
    'use strict';

    // ========================================================================
    // Паттерны подтверждения (keyword matching в нарративе)
    // ========================================================================

    const ACKNOWLEDGEMENT_PATTERNS = {
        'БУНТ': ['бунт', 'восстание', 'мятеж', 'бунтует', 'баррикад', 'протест'],
        'ПРЕДБУНТ': ['недовольство', 'брожение', 'протест', 'шёпот', 'ропот'],
        'НЕСТАБИЛЬНО': ['нестабил', 'саботаж', 'неурядиц', 'смут'],
        'КРИЗИС': ['кризис', 'тревог', 'паник', 'запертые двер'],
        'АНАРХИЯ': ['хаос', 'анархи', 'безвласт', 'мародёр', 'грабёж'],
        'ВОЙНА': ['война', 'боев', 'сражен', 'битв', 'наступлен'],
        'ВЫНУЖДЕННЫЙ МИР': ['мир', 'перемирие', 'замирен', 'договор'],
        'ИСТОЩЕНА': ['устал', 'истощ', 'голод', 'дезертир'],
        'КОЛЛАПС': ['коллапс', 'развале', 'бегств'],
        'ДЕФИЦИТ': ['голода', 'дефицит', 'нехватка', 'пустые прилавк', 'пустые полк']
    };

    // ========================================================================
    // Паттерны NarrativeCommandMap (из GRAIL)
    // ========================================================================

    const NARRATIVE_COMMAND_PATTERNS = [
        {
            pattern: /(?:получил|получаешь|тебе.*даю|вручает?).*?(\d+)\s*(золот|золотых|монет|голот)/i,
            command: 'addItem',
            safeAutoCorrect: true,
            maxAutoValue: 500,
            generateArgs: (match) => ({ itemType: 'gold', quantity: Math.min(parseInt(match[1]) || 0, 500) })
        },
        {
            pattern: /(?:начинает?ся?\s+бой|нападает?|вступаешь?\s+в\s+бой|бой\s+начинается)/i,
            command: 'setCombatState',
            safeAutoCorrect: true,
            generateArgs: () => ({ isActive: true })
        },
        {
            pattern: /(?:ты\s+идёшь|ты\s+направляешься|путешествуешь)\s+в\s+(.+?)[.,!\n]/i,
            command: 'startTravel',
            safeAutoCorrect: false, // Нужна валидация локации
            generateArgs: (match) => ({ destinationId: match[1].trim() })
        },
        {
            pattern: /(?:появляется?|возникает?|возникает?\s+из)\s+(.+?)[.,!\n]/i,
            command: 'addEnvironment',
            safeAutoCorrect: true,
            generateArgs: (match) => ({ entityKey: match[1].trim() })
        }
    ];

    // ========================================================================
    // Внутреннее состояние
    // ========================================================================

    let _previousManifest = null;        // Предыдущий Manifest (строка)
    let _previousManifestLabels = null;  // Предыдущие Manifest-метки (структура)
    let _unacknowledgedEvents = [];      // Буфер UNACKNOWLEDGED
    let _orphanedNarratives = [];        // Буфер ORPHANED
    let _persistenceCounter = {};        // Сколько ходов UNACKNOWLEDGED не описан
    let _config = {
        enabled: true,
        autoCorrectSafe: true,           // Автокоррекция безопасных ORPHANED
        maxAutoCorrectGold: 500,         // Макс. золото для автокоррекции
        persistenceThreshold: 2          // Ходов до CRITICAL
    };

    // ========================================================================
    // Основной API
    // ========================================================================

    /**
     * Детектировать UNACKNOWLEDGED sim events.
     * Сравнивает текущие Manifest-метки с предыдущими и проверяет
     * описал ли GM изменения в предыдущем нарративе.
     * @param {string} currentManifest - Текущий Manifest (строка)
     * @param {string} previousNarrative - Нарратив прошлого хода
     * @returns {Array} Список UNACKNOWLEDGED событий
     */
    function detectUnacknowledged(currentManifest, previousNarrative) {
        if (!_config.enabled || !_previousManifestLabels) return [];

        const currentLabels = _extractManifestLabels(currentManifest);
        const events = [];

        // Сравнить метки
        for (const [entityId, metrics] of Object.entries(currentLabels)) {
            const prevMetrics = _previousManifestLabels[entityId];
            if (!prevMetrics) continue;

            for (const [metric, currentLabel] of Object.entries(metrics)) {
                const prevLabel = prevMetrics[metric];
                if (prevLabel !== currentLabel && currentLabel) {
                    // Метка изменилась — проверить, описал ли GM
                    const acknowledged = _isAcknowledged(currentLabel, previousNarrative);

                    if (!acknowledged) {
                        const key = `${entityId}:${metric}:${currentLabel}`;
                        const persistence = (_persistenceCounter[key] || 0) + 1;
                        _persistenceCounter[key] = persistence;

                        events.push({
                            type: 'UNACKNOWLEDGED',
                            entityId,
                            metric,
                            previousLabel: prevLabel,
                            currentLabel,
                            persistence,
                            isCritical: persistence >= _config.persistenceThreshold,
                            action: _getUnackAction(currentLabel, persistence)
                        });
                    } else {
                        // GM описал — сбросить счётчик
                        const key = `${entityId}:${metric}:${currentLabel}`;
                        delete _persistenceCounter[key];
                    }
                }
            }
        }

        _unacknowledgedEvents = events;
        return events;
    }

    /**
     * Детектировать ORPHANED narrative — GM описал, но не использовал команду.
     * @param {string} narrative - Нарратив текущего хода
     * @param {Array} executedCommands - Список выполненных команд [{command, args}]
     * @returns {Array} Список ORPHANED событий
     */
    function detectOrphaned(narrative, executedCommands) {
        if (!_config.enabled || !narrative) return [];

        const orphaned = [];
        const executedCommandTypes = new Set(
            (executedCommands || []).map(c => c.command)
        );

        for (const ncp of NARRATIVE_COMMAND_PATTERNS) {
            const match = narrative.match(ncp.pattern);
            if (match) {
                // Проверить, была ли соответствующая команда
                if (!executedCommandTypes.has(ncp.command)) {
                    orphaned.push({
                        type: 'ORPHANED',
                        pattern: ncp.command,
                        matchedText: match[0],
                        command: ncp.command,
                        args: ncp.generateArgs ? ncp.generateArgs(match) : {},
                        safeAutoCorrect: ncp.safeAutoCorrect,
                        maxAutoValue: ncp.maxAutoValue
                    });
                }
            }
        }

        _orphanedNarratives = orphaned;
        return orphaned;
    }

    /**
     * Автокоррекция безопасных ORPHANED элементов.
     * @param {Array} orphanedItems - Список ORPHANED (из detectOrphaned)
     * @returns {Array} Список выполненных автокоманд
     */
    function autoCorrect(orphanedItems) {
        if (!_config.enabled || !_config.autoCorrectSafe) return [];

        const autoCorrected = [];

        for (const item of (orphanedItems || _orphanedNarratives)) {
            if (!item.safeAutoCorrect) continue;

            // Проверить лимиты
            if (item.maxAutoValue && item.args.quantity && item.args.quantity > item.maxAutoValue) {
                continue; // Слишком много для автокоррекции
            }

            // Выполнить команду программно
            if (typeof executeCommand === 'function') {
                try {
                    executeCommand(item.command, item.args);
                    autoCorrected.push({
                        command: item.command,
                        args: item.args,
                        reason: `Автокоррекция: нарратив содержит "${item.matchedText}" без команды ${item.command}`
                    });
                } catch (e) {
                    console.warn('[ReconciliationBuffer] Auto-correct failed:', e);
                }
            }
        }

        return autoCorrected;
    }

    /**
     * Обновить кэш предыдущего Manifest.
     * @param {string} manifest - Текущий Manifest (строка)
     */
    function updatePreviousManifest(manifest) {
        _previousManifestLabels = _extractManifestLabels(manifest || '');
        _previousManifest = manifest;
    }

    /**
     * Собрать буфер для AI контекста.
     * @returns {string|null} Строка с буфером или null
     */
    function buildContextBlock() {
        if (!_config.enabled) return null;
        if (_unacknowledgedEvents.length === 0 && _orphanedNarratives.length === 0) return null;

        let out = "\n=== RECONCILIATION BUFFER ===\n";

        if (_unacknowledgedEvents.length > 0) {
            out += "\n🔴 UNACKNOWLEDGED SIM EVENTS:\n";
            _unacknowledgedEvents.forEach((e, idx) => {
                const priority = e.isCritical ? '⚠️ CRITICAL' : '🟡';
                out += `  ${idx + 1}. ${priority} [${e.entityId}] ${e.metric}: ${e.previousLabel}→${e.currentLabel}`;
                out += ` — НЕ описан в нарративе (${e.persistence} ходов)\n`;
                out += `     → ДЕЙСТВИЕ: ${e.action}\n`;
            });
        }

        if (_orphanedNarratives.length > 0) {
            out += "\n🟡 ORPHANED NARRATIVE:\n";
            _orphanedNarratives.forEach((e, idx) => {
                out += `  ${idx + 1}. "${e.matchedText}" — НЕТ команды ${e.command}`;
                if (e.safeAutoCorrect) {
                    out += ' → АВТОКОРРЕКЦИЯ';
                }
                out += '\n';
            });
        }

        out += "\n=== КОНЕЦ RECONCILIATION ===\n";
        return out;
    }

    /**
     * Очистить буферы (вызывать после инъекции в контекст).
     */
    function flush() {
        _unacknowledgedEvents = [];
        _orphanedNarratives = [];
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
    // Приватные методы
    // ========================================================================

    function _isAcknowledged(label, narrative) {
        if (!narrative) return false;
        const lowerNarrative = narrative.toLowerCase();
        const patterns = ACKNOWLEDGEMENT_PATTERNS[label] || [];

        for (const p of patterns) {
            if (lowerNarrative.includes(p.toLowerCase())) {
                return true;
            }
        }
        return false;
    }

    function _getUnackAction(label, persistence) {
        if (persistence >= _config.persistenceThreshold) {
            return `КРИТИЧЕСКИ: ОБЯЗАН описать ${label} в этом ходу!`;
        }
        return `Включи в нарратив признаки: ${label}`;
    }

    function _extractManifestLabels(manifestStr) {
        const labels = {};

        if (!manifestStr || !window.WorldManifest) return labels;

        // Извлечь метки из текущего World (более надёжно чем парсинг строки)
        if (typeof World !== 'undefined' && World) {
            if (World.regions) {
                for (const rId in World.regions) {
                    const r = World.regions[rId];
                    labels[rId] = labels[rId] || {};
                    labels[rId].stability = WorldManifest.translateStability(r.stability || 50).label;
                    labels[rId].threat = WorldManifest.translateThreat(r.threat_level || 0).label;
                }
            }
            if (World.factions) {
                for (const fId in World.factions) {
                    const f = World.factions[fId];
                    labels[fId] = labels[fId] || {};
                    labels[fId].warExhaustion = WorldManifest.translateWarExhaustion(f.warExhaustion || 0).label;
                }
            }
        }

        return labels;
    }

    // ========================================================================
    // Публичный интерфейс
    // ========================================================================

    return {
        detectUnacknowledged,
        detectOrphaned,
        autoCorrect,
        updatePreviousManifest,
        buildContextBlock,
        flush,
        getConfig,
        setConfig
    };
})();
