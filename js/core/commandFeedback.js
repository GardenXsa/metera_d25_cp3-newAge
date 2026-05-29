/**
 * ============================================================================
 * COMMAND CONSEQUENCE FEEDBACK — Confluence Protocol v2, Innovation 3
 * ============================================================================
 * Автоматический отчёт после КАЖДОЙ GM команды.
 * Показывает: что изменилось (числа), что это значит (Manifest), советы для нарратива.
 *
 * ПРИНЦИПЫ:
 * 1. Feedback мгновенный — GM видит результаты в ТЕКУЩЕМ ходу
 * 2. Diff с семантическим переводом — числа + метки Manifest
 * 3. Нарративные советы — что описать в тексте
 *
 * GitHub Issue: #192
 * Confluence Master: #189
 * ============================================================================
 */

window.CommandFeedback = (() => {
    'use strict';

    // ========================================================================
    // GM команды, для которых нужен feedback
    // ========================================================================

    const GM_COMMANDS = new Set([
        'gmDeclareWar', 'gmForcePeace', 'gmChangeRulerTrait',
        'gmCreateFaction', 'gmTransferRegion', 'gmRaisePlayerArmy',
        'gmCommandArmy', 'gmPurchaseGoods', 'gmSellGoods',
        'gmInvestInFacility', 'gmModifyTradeSecurity', 'gmRaiseMilitia',
        'gmSpreadRumor', 'gmFrameForSabotage', 'gmDirectResourceInjection',
        'buildShip', 'buildPort', 'upgradePort', 'navalBlockade',
        'assassinateRuler', 'overthrowRuler', 'setFactionGoal'
    ]);

    // ========================================================================
    // Внутреннее состояние
    // ========================================================================

    let _preSnapshot = null;
    let _feedbackBuffer = [];
    let _config = {
        enabled: true,
        showNarrativeHints: true,
        maxFeedbackPerTurn: 10
    };

    // ========================================================================
    // Основной API
    // ========================================================================

    /**
     * Снять слепок состояния ПЕРЕД выполнением GM команды.
     * @param {string} command
     * @param {Object} args
     */
    function capturePre(command, args) {
        if (!_config.enabled || !GM_COMMANDS.has(command)) return;
        _preSnapshot = _captureSnapshot();
    }

    /**
     * Сгенерировать feedback ПОСЛЕ выполнения GM команды.
     * @param {string} command
     * @param {Object} args
     * @returns {Object|null} Feedback объект
     */
    function generatePost(command, args) {
        if (!_config.enabled || !GM_COMMANDS.has(command)) return null;
        if (!_preSnapshot) return null;

        const postSnapshot = _captureSnapshot();
        const feedback = _diff(_preSnapshot, postSnapshot, command, args);

        _feedbackBuffer.push(feedback);
        _preSnapshot = null;

        return feedback;
    }

    /**
     * Собрать весь feedback за ход в строку для AI контекста.
     * @returns {string|null} Строка с feedback или null
     */
    function flushForContext() {
        if (_feedbackBuffer.length === 0) return null;

        // Ограничить количество
        const buffer = _feedbackBuffer.slice(0, _config.maxFeedbackPerTurn);

        let out = "\n=== COMMAND CONSEQUENCE FEEDBACK ===\n";

        buffer.forEach((fb, idx) => {
            out += `\n⚡ ${fb.command}(${fb.argsSummary})\n`;

            if (fb.simulationChanges.length > 0) {
                out += "  ИЗМЕНЕНИЯ В СИМУЛЯЦИИ:\n";
                fb.simulationChanges.forEach(c => {
                    out += `    ${c}\n`;
                });
            }

            if (fb.economicChanges.length > 0) {
                out += "  ЭКОНОМИЧЕСКИЕ ПОСЛЕДСТВИЯ:\n";
                fb.economicChanges.forEach(c => {
                    out += `    ${c}\n`;
                });
            }

            if (_config.showNarrativeHints && fb.narrativeHints.length > 0) {
                out += "  НАРРАТИВНЫЕ СОВЕТЫ:\n";
                fb.narrativeHints.forEach(h => {
                    out += `    → ${h}\n`;
                });
            }
        });

        out += "\n=== КОНЕЦ FEEDBACK ===\n";

        // Очистить буфер
        _feedbackBuffer = [];

        return out;
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
    // Слепки состояния
    // ========================================================================

    function _captureSnapshot() {
        const snap = { regions: {}, factions: {}, timestamp: Date.now() };

        if (typeof World !== 'undefined' && World && World.regions) {
            for (const rId in World.regions) {
                const r = World.regions[rId];
                snap.regions[rId] = {
                    stability: r.stability,
                    threat_level: r.threat_level,
                    population: r.population,
                    prices: r.markets ? {
                        bread: r.markets.bread,
                        wood: r.markets.wood,
                        iron_ore: r.markets.iron_ore,
                        weapons: r.markets.weapons
                    } : {}
                };
            }
        }

        if (typeof World !== 'undefined' && World && World.factions) {
            for (const fId in World.factions) {
                const f = World.factions[fId];
                snap.factions[fId] = {
                    warExhaustion: f.warExhaustion,
                    diplomacy: f.diplomacy ? { ...f.diplomacy } : {}
                };
            }
        }

        return snap;
    }

    // ========================================================================
    // Diff с семантическим переводом
    // ========================================================================

    function _diff(pre, post, command, args) {
        const result = {
            command,
            argsSummary: _summarizeArgs(command, args),
            simulationChanges: [],
            economicChanges: [],
            narrativeHints: []
        };

        // Diff регионов
        for (const rId in post.regions) {
            const preR = pre.regions[rId];
            const postR = post.regions[rId];
            if (!preR || !postR) continue;

            // Stability
            if (preR.stability !== postR.stability) {
                const preLabel = window.WorldManifest
                    ? WorldManifest.translateStability(preR.stability).label
                    : String(preR.stability);
                const postLabel = window.WorldManifest
                    ? WorldManifest.translateStability(postR.stability).label
                    : String(postR.stability);
                const arrow = postR.stability < preR.stability ? '↓' : '↑';
                result.simulationChanges.push(
                    `${rId}: stability ${preR.stability}→${postR.stability} ${arrow} (${preLabel}→${postLabel})`
                );
            }

            // Threat
            if (preR.threat_level !== postR.threat_level) {
                const preLabel = window.WorldManifest
                    ? WorldManifest.translateThreat(preR.threat_level).label
                    : String(preR.threat_level);
                const postLabel = window.WorldManifest
                    ? WorldManifest.translateThreat(postR.threat_level).label
                    : String(postR.threat_level);
                const arrow = postR.threat_level > preR.threat_level ? '↑' : '↓';
                result.simulationChanges.push(
                    `${rId}: threat ${preR.threat_level}→${postR.threat_level} ${arrow} (${preLabel}→${postLabel})`
                );
            }

            // Цены
            if (preR.prices && postR.prices) {
                for (const good in postR.prices) {
                    if (preR.prices[good] !== postR.prices[good] &&
                        preR.prices[good] && postR.prices[good]) {
                        const goodName = window.WorldManifest
                            ? WorldManifest.getGoodName(good) : good;
                        const arrow = postR.prices[good] > preR.prices[good] ? '↑' : '↓';
                        result.economicChanges.push(
                            `${goodName}: цена в ${rId} ${arrow} ${preR.prices[good]}→${postR.prices[good]}`
                        );
                    }
                }
            }
        }

        // Diff фракций
        for (const fId in post.factions) {
            const preF = pre.factions[fId];
            const postF = post.factions[fId];
            if (!preF || !postF) continue;

            if (preF.warExhaustion !== postF.warExhaustion) {
                const preLabel = window.WorldManifest
                    ? WorldManifest.translateWarExhaustion(preF.warExhaustion).label
                    : String(preF.warExhaustion);
                const postLabel = window.WorldManifest
                    ? WorldManifest.translateWarExhaustion(postF.warExhaustion).label
                    : String(postF.warExhaustion);
                const arrow = postF.warExhaustion > preF.warExhaustion ? '↑' : '↓';
                result.simulationChanges.push(
                    `${fId}: warExhaustion ${preF.warExhaustion}→${postF.warExhaustion} ${arrow} (${preLabel}→${postLabel})`
                );
            }

            // Новые войны
            for (const target in postF.diplomacy) {
                if (postF.diplomacy[target] === 'war' &&
                    (!preF.diplomacy[target] || preF.diplomacy[target] !== 'war')) {
                    result.simulationChanges.push(`${fId}: НОВАЯ ВОЙНА с ${target}`);
                }
            }
        }

        // Нарративные советы
        result.narrativeHints = _generateNarrativeHints(command, args, result);

        return result;
    }

    function _summarizeArgs(command, args) {
        if (!args) return '';
        switch (command) {
            case 'gmDeclareWar':
                return `${args.fromFactionId || args.factionId1} → ${args.toFactionId || args.factionId2}`;
            case 'gmForcePeace':
                return `${args.factionId1 || args.fromFactionId} + ${args.factionId2 || args.toFactionId}`;
            case 'gmChangeRulerTrait':
                return `${args.rulerId}: ${args.trait}`;
            case 'gmTransferRegion':
                return `${args.regionId} → ${args.newFactionId}`;
            case 'gmDirectResourceInjection':
                return `${args.regionId}: +${args.quantity} ${args.goodType}`;
            case 'assassinateRuler':
                return `${args.rulerId || args.id}`;
            default:
                return Object.keys(args).slice(0, 3).join(', ');
        }
    }

    function _generateNarrativeHints(command, args, diffResult) {
        const hints = [];

        // На основе команды
        switch (command) {
            case 'gmDeclareWar':
                hints.push('Опиши мобилизацию войск, тревожные слухи, панику на рынках');
                hints.push('NPC могут обсуждать слухи о войне, торговцы закрывают лавки');
                break;
            case 'gmForcePeace':
                hints.push('Опиши подписание мира, усталость от войны, возвращение солдат');
                break;
            case 'gmTransferRegion':
                hints.push('Опиши смену флага, реакцию жителей, вход новых войск');
                break;
            case 'assassinateRuler':
                hints.push('Опиши хаос при дворе, траур, борьбу за власть');
                break;
        }

        // На основе diff
        for (const change of diffResult.simulationChanges) {
            if (change.includes('БУНТ')) {
                hints.push('Опиши восстание: баррикады, крики, дым над городом');
            }
            if (change.includes('АНАРХИЯ')) {
                hints.push('Опиши хаос: мародёрство, горящие дома, отсутствие власти');
            }
            if (change.includes('ИСТОЩЕНА') || change.includes('ВЫНУЖДЕННЫЙ МИР')) {
                hints.push('Опиши усталость от войны: голодные солдаты, пустые казармы');
            }
        }

        for (const change of diffResult.economicChanges) {
            if (change.includes('↑')) {
                hints.push('Опиши рост цен, недовольство торговцев, дефицит');
            }
        }

        return hints.slice(0, 5); // Максимум 5 подсказок
    }

    // ========================================================================
    // Публичный интерфейс
    // ========================================================================

    return {
        capturePre,
        generatePost,
        flushForContext,
        getConfig,
        setConfig,
        GM_COMMANDS
    };
})();
