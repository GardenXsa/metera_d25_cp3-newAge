/**
 * ============================================================================
 * DUAL-WRITE GATEWAY — Confluence Protocol v2, Innovation 5
 * ============================================================================
 * Единая точка входа для всех изменений мира.
 * Гарантирует атомарность: C++ (числа) + Manifest (смысл) обновляются вместе.
 *
 * ПРИНЦИПЫ:
 * 1. Каждое изменение мира идёт через Gateway
 * 2. C++ отклонил → Manifest не обновляется (откат)
 * 3. C++ принял → Manifest delta применяется автоматически
 * 4. JS-only команды тоже через Gateway с Manifest delta
 * 5. Fallback на прямой nexusGmIntervention если Gateway не загружен
 *
 * GitHub Issue: #194
 * Confluence Master: #189
 * ============================================================================
 */

window.DualWriteGateway = (() => {
    'use strict';

    // ========================================================================
    // JS-only команды (не идут через C++ движок)
    // ========================================================================

    const JS_ONLY_COMMANDS = new Set([
        'assassinateRuler', 'overthrowRuler', 'setFactionGoal',
        'startIntrigue', 'cancelIntrigue', 'revealIntrigue',
        'startTravel', 'pauseTravel', 'resumeTravel', 'cancelTravel',
        'fastForwardTravel', 'startJourney', 'endJourney', 'setJourneyLocation',
        'setCombatState', 'endCombat',
        'addEnvironment', 'removeEnvironment', 'updateEntityStat',
        'setLocation', 'addSubLocation', 'renderLocation',
        'addMapMarker', 'removeMapMarker',
        'addItem', 'removeItem', 'moveItem', 'equipItem', 'unequipItem',
        'updateStat', 'addSkill', 'addQuest', 'updateQuest', 'removeQuest',
        'setMemory', 'removeMemory', 'echoMemory', 'removeEchoMemoryItem',
        'archiveMemory', 'searchArchive',
        'applyPredefinedEffect', 'removeStatusEffect',
        'nexusDefine', 'nexusUpdate', 'nexusRemove', 'nexusLink', 'nexusUnlink',
        'setPlayerDescription', 'calculationLog'
    ]);

    // ========================================================================
    // C++ команды (идут через nexusGmIntervention)
    // ========================================================================

    const CPP_COMMANDS = new Set([
        'gmDeclareWar', 'gmForcePeace', 'gmChangeRulerTrait',
        'gmCreateFaction', 'gmTransferRegion', 'gmRaisePlayerArmy',
        'gmCommandArmy', 'gmPurchaseGoods', 'gmSellGoods',
        'gmInvestInFacility', 'gmModifyTradeSecurity', 'gmRaiseMilitia',
        'gmSpreadRumor', 'gmFrameForSabotage', 'gmDirectResourceInjection',
        'buildShip', 'buildPort', 'upgradePort', 'navalBlockade',
        'gmBuildHighway', 'gmModifyTerrain',
        'spawnMonster', 'killMonster', 'triggerDisaster'
    ]);

    // ========================================================================
    // Внутреннее состояние
    // ========================================================================

    let _writeLog = [];       // Лог всех записей за текущий ход
    let _enabled = true;      // Можно ли использовать Gateway

    // ========================================================================
    // Основной API
    // ========================================================================

    /**
     * Единая точка записи для всех GM команд, меняющих мир.
     * @param {string} command - Имя команды
     * @param {Object} args - Аргументы команды
     * @param {string} playerLocation - Локация игрока
     * @returns {Object} { status, simResult?, manifestDelta?, error? }
     */
    async function write(command, args, playerLocation) {
        if (!_enabled) {
            return { status: 'disabled', error: 'DualWriteGateway is disabled' };
        }

        const startTime = Date.now();
        const logEntry = {
            command,
            args: { ...args },
            timestamp: startTime,
            status: 'pending'
        };

        try {
            if (CPP_COMMANDS.has(command)) {
                // === C++ КОМАНДА: записать в симуляцию + Manifest ===
                const result = await _writeCppCommand(command, args, playerLocation);
                logEntry.status = result.status;
                logEntry.manifestDelta = result.manifestDelta || null;
                logEntry.duration = Date.now() - startTime;
                _writeLog.push(logEntry);
                return result;

            } else if (JS_ONLY_COMMANDS.has(command)) {
                // === JS-ONLY КОМАНДА: только Manifest delta ===
                const delta = _computeManifestDelta(command, args, { status: 'ok' });
                if (window.WorldManifest) {
                    WorldManifest.applyDelta(delta);
                }
                logEntry.status = 'ok';
                logEntry.manifestDelta = delta;
                logEntry.duration = Date.now() - startTime;
                _writeLog.push(logEntry);
                return { status: 'ok', manifestDelta: delta };

            } else {
                // === НЕИЗВЕСТНАЯ КОМАНДА: пропустить без Manifest ===
                logEntry.status = 'unknown_command';
                logEntry.duration = Date.now() - startTime;
                _writeLog.push(logEntry);
                return { status: 'unknown_command' };
            }
        } catch (error) {
            logEntry.status = 'error';
            logEntry.error = error.message;
            logEntry.duration = Date.now() - startTime;
            _writeLog.push(logEntry);
            return { status: 'error', error: error.message };
        }
    }

    /**
     * Проверить, должна ли команда идти через Gateway.
     * @param {string} command
     * @returns {boolean}
     */
    function isGatewayCommand(command) {
        return CPP_COMMANDS.has(command);
    }

    /**
     * Получить лог записей за текущий ход.
     * @returns {Array}
     */
    function getWriteLog() {
        return [..._writeLog];
    }

    /**
     * Очистить лог (вызывать в конце хода).
     * @returns {Array} Лог перед очисткой
     */
    function flush() {
        const log = _writeLog;
        _writeLog = [];
        return log;
    }

    /**
     * Включить/выключить Gateway.
     */
    function setEnabled(value) {
        _enabled = !!value;
    }

    /**
     * Получить Manifest Delta для конкретной команды (для CommandFeedback).
     */
    function getLastDelta() {
        if (_writeLog.length === 0) return null;
        const last = _writeLog[_writeLog.length - 1];
        return last.manifestDelta || null;
    }

    // ========================================================================
    // C++ запись
    // ========================================================================

    async function _writeCppCommand(command, args, playerLocation) {
        // Шаг 1: Запись в C++ симуляцию
        let simResult;
        try {
            if (window.electronAPI && window.electronAPI.nexusGmIntervention) {
                simResult = await window.electronAPI.nexusGmIntervention(
                    { command, args }, playerLocation || ''
                );
            } else {
                return { status: 'error', error: 'C++ engine not available' };
            }
        } catch (e) {
            return { status: 'error', error: e.message };
        }

        // Шаг 2: Проверить результат
        if (!simResult || simResult.status !== 'ok') {
            // Откат: не обновляем Manifest
            return {
                status: 'error',
                error: simResult?.error || 'C++ engine returned non-ok status',
                simResult
            };
        }

        // Шаг 3: Применить C++ результат к JS World
        _applySimResult(simResult);

        // Шаг 4: Вычислить и применить Manifest delta
        const delta = _computeManifestDelta(command, args, simResult);
        if (window.WorldManifest) {
            WorldManifest.applyDelta(delta);
        }

        // Шаг 5: Вернуть результат
        return {
            status: 'ok',
            simResult,
            manifestDelta: delta,
            consequenceSummary: _summarizeConsequences(delta, command)
        };
    }

    /**
     * Применить результат C++ к JS World (извлечено из script.js).
     */
    function _applySimResult(res) {
        if (res.world && typeof setWorld === 'function') setWorld(res.world);
        if (res.relevant_news && typeof World !== 'undefined') World.relevant_news = res.relevant_news;
        if (res.items && typeof ItemRegistry !== 'undefined') {
            res.items.forEach(([k, v]) => ItemRegistry.set(k, v));
        }
        if (res.containers && typeof ContainerRegistry !== 'undefined') {
            res.containers.forEach(([k, v]) => {
                if (typeof setContainer === 'function') setContainer(k, v);
            });
        }
        if (res.deleted_items && typeof ItemRegistry !== 'undefined') {
            res.deleted_items.forEach(id => ItemRegistry.delete(id));
        }
        if (res.deleted_containers && typeof ContainerRegistry !== 'undefined') {
            res.deleted_containers.forEach(id => ContainerRegistry.delete(id));
        }
    }

    // ========================================================================
    // Manifest Delta — что изменилось в смысле
    // ========================================================================

    function _computeManifestDelta(command, args, simResult) {
        const delta = {
            command,
            regions: {},
            factions: {},
            events: [],
            timestamp: Date.now()
        };

        switch (command) {
            case 'gmDeclareWar': {
                const fromId = args.fromFactionId || args.factionId1;
                const toId = args.toFactionId || args.factionId2;
                delta.events.push({
                    type: 'war_declared',
                    factions: [fromId, toId],
                    manifestImpact: 'threat↑ stability↓ warExhaustion начался'
                });
                delta.factions[fromId] = { warStarted: true, against: toId };
                delta.factions[toId] = { warStarted: true, against: fromId };
                break;
            }

            case 'gmForcePeace': {
                const f1 = args.factionId1 || args.fromFactionId;
                const f2 = args.factionId2 || args.toFactionId;
                delta.events.push({
                    type: 'peace_forced',
                    factions: [f1, f2],
                    manifestImpact: 'threat↓ stability↑ warExhaustion прекращён'
                });
                delta.factions[f1] = { peaceForced: true, with: f2 };
                delta.factions[f2] = { peaceForced: true, with: f1 };
                break;
            }

            case 'gmChangeRulerTrait': {
                const rulerId = args.rulerId;
                const trait = args.trait;
                delta.events.push({
                    type: 'ruler_trait_changed',
                    ruler: rulerId,
                    trait,
                    manifestImpact: 'Политика фракции может измениться'
                });
                break;
            }

            case 'gmDirectResourceInjection': {
                const regionId = args.regionId;
                const goodType = args.goodType;
                delta.events.push({
                    type: 'resource_injection',
                    region: regionId,
                    good: goodType,
                    manifestImpact: 'price↓ для этого товара'
                });
                delta.regions[regionId] = { resourceInjected: goodType };
                break;
            }

            case 'gmTransferRegion': {
                const regionId = args.regionId;
                const newFactionId = args.newFactionId;
                delta.events.push({
                    type: 'region_transferred',
                    region: regionId,
                    newFaction: newFactionId,
                    manifestImpact: 'stability↓ threat↑ (смена власти)'
                });
                delta.regions[regionId] = { transferred: newFactionId };
                break;
            }

            case 'gmCreateFaction': {
                delta.events.push({
                    type: 'faction_created',
                    faction: args.factionId,
                    manifestImpact: 'Новая политическая сила'
                });
                break;
            }

            case 'gmRaiseMilitia':
            case 'gmPurchaseGoods':
            case 'gmSellGoods':
            case 'gmInvestInFacility': {
                const regionId = args.regionId;
                if (regionId) {
                    delta.regions[regionId] = { economicChange: command };
                }
                break;
            }

            case 'gmSpreadRumor':
            case 'gmFrameForSabotage': {
                delta.events.push({
                    type: 'intrigue',
                    faction: args.factionId,
                    target: args.targetFactionId,
                    manifestImpact: 'stability↓ для цели'
                });
                break;
            }

            case 'assassinateRuler': {
                delta.events.push({
                    type: 'ruler_assassinated',
                    ruler: args.rulerId || args.id,
                    manifestImpact: 'stability↓ для фракции, возможна гражданская война'
                });
                break;
            }

            case 'overthrowRuler': {
                delta.events.push({
                    type: 'ruler_overthrown',
                    ruler: args.rulerId || args.id,
                    manifestImpact: 'stability↓↓ для фракции, хаос'
                });
                break;
            }

            case 'setCombatState': {
                if (args.isActive) {
                    delta.events.push({
                        type: 'combat_started',
                        manifestImpact: 'threat↑ в регионе'
                    });
                }
                break;
            }

            case 'startTravel': {
                delta.events.push({
                    type: 'travel_started',
                    destination: args.destinationId,
                    manifestImpact: 'Смена региона → новый Manifest'
                });
                break;
            }

            // === C++ commands: военные / флот ===

            case 'gmRaisePlayerArmy': {
                delta.events.push({
                    type: 'army_raised',
                    region: args.regionId,
                    manifestImpact: 'threat↑ stability↓ (набор армии)'
                });
                if (args.regionId) delta.regions[args.regionId] = { armyRaised: true };
                break;
            }

            case 'gmCommandArmy': {
                delta.events.push({
                    type: 'army_commanded',
                    army: args.armyId,
                    action: args.action,
                    manifestImpact: 'Военное действие → threat↑ warExhaustion↑'
                });
                break;
            }

            case 'buildShip': {
                delta.events.push({
                    type: 'ship_built',
                    region: args.regionId,
                    manifestImpact: 'Военная мощь на море ↑'
                });
                if (args.regionId) delta.regions[args.regionId] = { navalExpansion: true };
                break;
            }

            case 'buildPort':
            case 'upgradePort': {
                delta.events.push({
                    type: 'port_action',
                    region: args.regionId,
                    action: command,
                    manifestImpact: 'Торговля ↑ economy↑'
                });
                if (args.regionId) delta.regions[args.regionId] = { portAction: command };
                break;
            }

            case 'navalBlockade': {
                const blockerId = args.blockerFactionId || args.factionId;
                const targetId = args.targetFactionId;
                delta.events.push({
                    type: 'naval_blockade',
                    factions: [blockerId, targetId],
                    manifestImpact: 'trade↓ threat↑ warExhaustion↑ (блокада)'
                });
                delta.factions[targetId] = { blockaded: true, by: blockerId };
                break;
            }

            // === C++ commands: инфраструктура / среда ===

            case 'gmBuildHighway': {
                delta.events.push({
                    type: 'highway_built',
                    from: args.fromRegionId,
                    to: args.toRegionId,
                    manifestImpact: 'trade↑ stability↑ (дорога)'
                });
                if (args.fromRegionId) delta.regions[args.fromRegionId] = { highwayBuilt: true };
                if (args.toRegionId) delta.regions[args.toRegionId] = { highwayBuilt: true };
                break;
            }

            case 'gmModifyTerrain': {
                delta.events.push({
                    type: 'terrain_modified',
                    region: args.regionId,
                    terrain: args.terrainType,
                    manifestImpact: 'Ландшафт изменён → экономика и движение'
                });
                if (args.regionId) delta.regions[args.regionId] = { terrainModified: args.terrainType };
                break;
            }

            case 'gmModifyTradeSecurity': {
                delta.events.push({
                    type: 'trade_security_modified',
                    region: args.regionId,
                    manifestImpact: args.increase ? 'trade↑ (безопасность караванов)' : 'trade↓ (опасные дороги)'
                });
                if (args.regionId) delta.regions[args.regionId] = { tradeSecurityChange: args.increase ? 'up' : 'down' };
                break;
            }

            // === C++ commands: существа / катастрофы ===

            case 'spawnMonster': {
                delta.events.push({
                    type: 'monster_spawned',
                    monster: args.monsterId || args.monsterType,
                    region: args.regionId,
                    manifestImpact: 'threat↑ в регионе, опасность для путников'
                });
                if (args.regionId) delta.regions[args.regionId] = { monsterSpawned: true };
                break;
            }

            case 'killMonster': {
                delta.events.push({
                    type: 'monster_killed',
                    monster: args.monsterId,
                    manifestImpact: 'threat↓ в регионе, безопасность ↑'
                });
                break;
            }

            case 'triggerDisaster': {
                delta.events.push({
                    type: 'disaster_triggered',
                    disaster: args.disasterType,
                    region: args.regionId,
                    manifestImpact: 'stability↓↓ threat↑ economy↓ (катастрофа)'
                });
                if (args.regionId) delta.regions[args.regionId] = { disaster: args.disasterType };
                break;
            }

            default:
                // Для неизвестных команд — минимальный delta
                delta.events.push({
                    type: 'generic_command',
                    command,
                    manifestImpact: `Команда ${command} выполнена`
                });
                break;
        }

        return delta;
    }

    // ========================================================================
    // Суммаризация последствий
    // ========================================================================

    function _summarizeConsequences(delta, command) {
        if (!delta || delta.events.length === 0) return '';

        const summaries = delta.events.map(e => {
            switch (e.type) {
                case 'war_declared':
                    return `Война: ${e.factions.join(' vs ')} → ${e.manifestImpact}`;
                case 'peace_forced':
                    return `Мир: ${e.factions.join(' и ')} → ${e.manifestImpact}`;
                case 'ruler_trait_changed':
                    return `Правитель ${e.ruler}: черта ${e.trait} изменена → ${e.manifestImpact}`;
                case 'resource_injection':
                    return `Регион ${e.region}: +${e.good} → ${e.manifestImpact}`;
                case 'region_transferred':
                    return `Регион ${e.region}: → ${e.newFaction} → ${e.manifestImpact}`;
                case 'ruler_assassinated':
                    return `Правитель ${e.ruler} убит → ${e.manifestImpact}`;
                case 'ruler_overthrown':
                    return `Правитель ${e.ruler} свергнут → ${e.manifestImpact}`;
                case 'combat_started':
                    return `Бой начался → ${e.manifestImpact}`;
                case 'travel_started':
                    return `Путешествие в ${e.destination} → ${e.manifestImpact}`;
                case 'army_raised':
                    return `Армия набрана в ${e.region} → ${e.manifestImpact}`;
                case 'army_commanded':
                    return `Армия ${e.army}: ${e.action} → ${e.manifestImpact}`;
                case 'ship_built':
                    return `Корабль построен в ${e.region} → ${e.manifestImpact}`;
                case 'port_action':
                    return `Порт в ${e.region}: ${e.action} → ${e.manifestImpact}`;
                case 'naval_blockade':
                    return `Морская блокада: ${e.factions.join(' → ')} → ${e.manifestImpact}`;
                case 'highway_built':
                    return `Дорога: ${e.from}↔${e.to} → ${e.manifestImpact}`;
                case 'terrain_modified':
                    return `Ландшафт в ${e.region}: ${e.terrain} → ${e.manifestImpact}`;
                case 'trade_security_modified':
                    return `Безопасность торговли в ${e.region} → ${e.manifestImpact}`;
                case 'monster_spawned':
                    return `Монстр ${e.monster} в ${e.region} → ${e.manifestImpact}`;
                case 'monster_killed':
                    return `Монстр ${e.monster} убит → ${e.manifestImpact}`;
                case 'disaster_triggered':
                    return `Катастрофа ${e.disaster} в ${e.region} → ${e.manifestImpact}`;
                default:
                    return `${e.type}: ${e.manifestImpact}`;
            }
        });

        return summaries.join(' | ');
    }

    // ========================================================================
    // Публичный интерфейс
    // ========================================================================

    return {
        write,
        isGatewayCommand,
        getWriteLog,
        getLastDelta,
        flush,
        setEnabled,
        // Для отладки
        CPP_COMMANDS,
        JS_ONLY_COMMANDS
    };
})();
