/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  GRAIL — Game Runtime Architecture for Immersive Living
 *  Unified Narrative-Simulation Bridge (UNSB)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Принцип: Симуляция — ЕДИНСТВЕННЫЙ источник правды.
 *  ГМ — переводчик, который НЕ МОЖЕТ противоречить симуляции.
 *
 *  5 слоёв архитектуры:
 *  ┌─────────────────────────────────────────────────────┐
 *  │  Layer 5: Semantic Bridge    (нарратив ↔ команды)   │
 *  │  Layer 4: State Reconciler   (сверка состояний)     │
 *  │  Layer 3: Narrative Verifier (проверка нарратива)   │
 *  │  Layer 2: Command Gateway    (обогащение команд)    │
 *  │  Layer 1: Event Bus          (подписки на события)  │
 *  └─────────────────────────────────────────────────────┘
 *
 *  Жизненный цикл каждого хода:
 *  1. Симуляция пушит события → Event Bus → ГМ получает контекст
 *  2. ГМ генерирует ответ → Narrative Verifier → сверка с состоянием
 *  3. Команды ГМ → Command Gateway → обогащение + валидация → C++ движок
 *  4. Результаты команд → State Reconciler → коррекция расхождений
 *  5. Semantic Bridge → маппинг нарративных намерений на команды
 */

// ═══════════════════════════════════════════════════════════════════════════
//  LAYER 1: EVENT BUS — Подписки на события симуляции
// ═══════════════════════════════════════════════════════════════════════════

const GRAIL = (() => {

    // --- Внутреннее состояние ---
    const _eventSubscriptions = {};      // { eventType: Set<callback> }
    const _commandHistory = [];           // История выполненных команд (последние N)
    const _pendingReconciliations = [];   // Ожидающие сверки расхождения
    const _narrativeAssertions = [];      // Утверждения ГМ в текущем ходу (для верификации)
    const _turnState = {
        preSnapshot: null,                // Состояние ДО хода
        postSnapshot: null,               // Состояние ПОСЛЕ хода
        gmCommands: [],                   // Команды ГМ в этом ходу
        gmNarrative: '',                  // Нарратив ГМ в этом ходу
        reconciled: false                 // Сверка проведена?
    };

    const MAX_COMMAND_HISTORY = 200;
    const MAX_NARRATIVE_ASSERTIONS = 50;

    // ═══════════════════════════════════════════════════════════════════════
    //  LAYER 1: EVENT BUS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Типы событий симуляции, на которые можно подписаться.
     * Каждый тип соответствует определённому изменению в мире.
     */
    const EventTypes = Object.freeze({
        // Фракции
        WAR_DECLARED: 'war_declared',
        PEACE_FORCED: 'peace_forced',
        RULER_CHANGED: 'ruler_changed',
        RULER_TRAIT_CHANGED: 'ruler_trait_changed',
        FACTION_CREATED: 'faction_created',
        REGION_TRANSFERRED: 'region_transferred',
        ARMY_RAISED: 'army_raised',
        ARMY_COMMAND: 'army_command',

        // Экономика
        PRICES_CHANGED: 'prices_changed',
        GOODS_INJECTED: 'goods_injected',
        FACILITY_INVESTED: 'facility_invested',
        TRADE_SECURITY_CHANGED: 'trade_security_changed',
        MILITIA_RAISED: 'militia_raised',
        RUMOR_SPREAD: 'rumor_spread',
        SABOTAGE_FRAMED: 'sabotage_framed',

        // Мир
        MONSTER_SPAWNED: 'monster_spawned',
        MONSTER_KILLED: 'monster_killed',
        DISASTER_TRIGGERED: 'disaster_triggered',
        DISASTER_ENDED: 'disaster_ended',
        WEATHER_CHANGED: 'weather_changed',
        SEASON_CHANGED: 'season_changed',

        // Перемещения
        TRAVEL_STARTED: 'travel_started',
        TRAVEL_PAUSED: 'travel_paused',
        TRAVEL_RESUMED: 'travel_resumed',
        TRAVEL_COMPLETED: 'travel_completed',
        TREK_EVENT: 'trek_event',
        LOCATION_CHANGED: 'location_changed',

        // Бой
        COMBAT_STARTED: 'combat_started',
        COMBAT_ENDED: 'combat_ended',
        ENTITY_DAMAGED: 'entity_damaged',
        ENTITY_KILLED: 'entity_killed',
        ENTITY_SPAWNED: 'entity_spawned',
        ENTITY_REMOVED: 'entity_removed',

        // Инвентарь
        ITEM_ADDED: 'item_added',
        ITEM_REMOVED: 'item_removed',
        ITEM_EQUIPPED: 'item_equipped',
        ITEM_UNEQUIPPED: 'item_unequipped',
        ITEM_MOVED: 'item_moved',

        // Квесты
        QUEST_ADDED: 'quest_added',
        QUEST_UPDATED: 'quest_updated',
        QUEST_REMOVED: 'quest_removed',

        // Игрок
        STAT_CHANGED: 'stat_changed',
        STATUS_EFFECT_APPLIED: 'status_effect_applied',
        STATUS_EFFECT_REMOVED: 'status_effect_removed',
        SKILL_ADDED: 'skill_added',
        PLAYER_DESCRIPTION_CHANGED: 'player_description_changed',

        // Память
        MEMORY_SET: 'memory_set',
        MEMORY_DELETED: 'memory_deleted',
        MEMORY_ARCHIVED: 'memory_archived',
        ECHO_MEMORY_ADDED: 'echo_memory_added',
        ECHO_MEMORY_REMOVED: 'echo_memory_removed',

        // Nexus
        NEXUS_DEFINED: 'nexus_defined',
        NEXUS_UPDATED: 'nexus_updated',
        NEXUS_REMOVED: 'nexus_removed',
        NEXUS_LINKED: 'nexus_linked',

        // Время
        TIME_PASSED: 'time_passed',
        DAY_CHANGED: 'day_changed',
        TURN_COMPLETED: 'turn_completed',

        // Intrigue
        INTRIGUE_STARTED: 'intrigue_started',
        INTRIGUE_CANCELLED: 'intrigue_cancelled',
        INTRIGUE_REVEALED: 'intrigue_revealed',

        // Транспорт
        TRANSPORT_MOUNTED: 'transport_mounted',
        TRANSPORT_DISMOUNTED: 'transport_dismounted',

        // Business
        BUSINESS_BUILT: 'business_built',
        HOLDING_BOUGHT: 'holding_bought',
        HOLDING_SOLD: 'holding_sold',
        BANK_TRANSACTION: 'bank_transaction',

        // Trade
        TRADE_INITIATED: 'trade_initiated',
        TRADE_CONFIRMED: 'trade_confirmed',
        TRADE_NEGOTIATED: 'trade_negotiated',
    });

    /**
     * Подписка на событие симуляции.
     * @param {string} eventType - Тип события из EventTypes
     * @param {Function} callback - Функция-обработчик(eventData)
     * @returns {Function} Функция отписки
     */
    function subscribe(eventType, callback) {
        if (!_eventSubscriptions[eventType]) {
            _eventSubscriptions[eventType] = new Set();
        }
        _eventSubscriptions[eventType].add(callback);
        // Возвращаем функцию отписки
        return () => {
            if (_eventSubscriptions[eventType]) {
                _eventSubscriptions[eventType].delete(callback);
            }
        };
    }

    /**
     * Подписка на несколько событий сразу.
     * @param {string[]} eventTypes - Массив типов событий
     * @param {Function} callback - Функция-обработчик(eventType, eventData)
     * @returns {Function} Функция отписки от всех
     */
    function subscribeMany(eventTypes, callback) {
        const unsubscribers = eventTypes.map(et => subscribe(et, (data) => callback(et, data)));
        return () => unsubscribers.forEach(unsub => unsub());
    }

    /**
     * Публикация события. Вызывает всех подписчиков.
     * @param {string} eventType - Тип события
     * @param {Object} eventData - Данные события
     */
    function publish(eventType, eventData) {
        eventData = eventData || {};
        eventData._timestamp = Date.now();
        eventData._type = eventType;

        if (_eventSubscriptions[eventType]) {
            for (const cb of _eventSubscriptions[eventType]) {
                try {
                    cb(eventData);
                } catch (e) {
                    console.error(`[GRAIL EventBus] Ошибка в подписчике ${eventType}:`, e);
                }
            }
        }

        // Логируем все события для отладки
        if (typeof DEBUG_MODE !== 'undefined' && DEBUG_MODE) {
            console.log(`[GRAIL Event] ${eventType}`, eventData);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  LAYER 2: COMMAND GATEWAY — Обогащение результатов команд
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Маппинг команд ГМ на типы событий.
     * Каждая выполненная команда автоматически пушит событие в Event Bus.
     */
    const CommandEventMap = Object.freeze({
        'gmDeclareWar':         EventTypes.WAR_DECLARED,
        'gmForcePeace':         EventTypes.PEACE_FORCED,
        'gmChangeRulerTrait':   EventTypes.RULER_TRAIT_CHANGED,
        'gmCreateFaction':      EventTypes.FACTION_CREATED,
        'gmTransferRegion':     EventTypes.REGION_TRANSFERRED,
        'gmRaisePlayerArmy':    EventTypes.ARMY_RAISED,
        'gmCommandArmy':        EventTypes.ARMY_COMMAND,
        'gmPurchaseGoods':      EventTypes.GOODS_INJECTED,
        'gmSellGoods':          EventTypes.GOODS_INJECTED,
        'gmInvestInFacility':   EventTypes.FACILITY_INVESTED,
        'gmModifyTradeSecurity': EventTypes.TRADE_SECURITY_CHANGED,
        'gmRaiseMilitia':       EventTypes.MILITIA_RAISED,
        'gmSpreadRumor':        EventTypes.RUMOR_SPREAD,
        'gmFrameForSabotage':   EventTypes.SABOTAGE_FRAMED,
        'gmDirectResourceInjection': EventTypes.GOODS_INJECTED,
        'addItem':              EventTypes.ITEM_ADDED,
        'removeItem':           EventTypes.ITEM_REMOVED,
        'equipItem':            EventTypes.ITEM_EQUIPPED,
        'unequipItem':          EventTypes.ITEM_UNEQUIPPED,
        'moveItem':             EventTypes.ITEM_MOVED,
        'moveItems':            EventTypes.ITEM_MOVED,
        'giveItem':             EventTypes.ITEM_MOVED,
        'addQuest':             EventTypes.QUEST_ADDED,
        'updateQuest':          EventTypes.QUEST_UPDATED,
        'removeQuest':          EventTypes.QUEST_REMOVED,
        'updateStat':           EventTypes.STAT_CHANGED,
        'setStat':              EventTypes.STAT_CHANGED,
        'addStatusEffect':      EventTypes.STATUS_EFFECT_APPLIED,
        'removeStatusEffect':   EventTypes.STATUS_EFFECT_REMOVED,
        'addSkill':             EventTypes.SKILL_ADDED,
        'addEnvironment':       EventTypes.ENTITY_SPAWNED,
        'removeEnvironment':    EventTypes.ENTITY_REMOVED,
        'updateEntityStat':     EventTypes.ENTITY_DAMAGED,
        'setEntityState':       EventTypes.ENTITY_DAMAGED,
        'setCombatState':       EventTypes.COMBAT_STARTED,
        'setLocation':          EventTypes.LOCATION_CHANGED,
        'startTravel':          EventTypes.TRAVEL_STARTED,
        'pauseTravel':          EventTypes.TRAVEL_PAUSED,
        'resumeTravel':         EventTypes.TRAVEL_RESUMED,
        'cancelTravel':         EventTypes.TRAVEL_COMPLETED,
        'setMemory':            EventTypes.MEMORY_SET,
        'deleteMemory':         EventTypes.MEMORY_DELETED,
        'archiveMemory':        EventTypes.MEMORY_ARCHIVED,
        'echoMemory':           EventTypes.ECHO_MEMORY_ADDED,
        'removeEchoMemoryItem': EventTypes.ECHO_MEMORY_REMOVED,
        'clearEchoMemory':      EventTypes.ECHO_MEMORY_REMOVED,
        'nexusDefine':          EventTypes.NEXUS_DEFINED,
        'nexusUpdate':          EventTypes.NEXUS_UPDATED,
        'nexusRemove':          EventTypes.NEXUS_REMOVED,
        'nexusLink':            EventTypes.NEXUS_LINKED,
        'addMapMarker':         EventTypes.LOCATION_CHANGED,
        'addSubLocation':       EventTypes.LOCATION_CHANGED,
        'removeSubLocation':    EventTypes.LOCATION_CHANGED,
        'removeMapMarker':      EventTypes.LOCATION_CHANGED,
        'setPlayerDescription': EventTypes.PLAYER_DESCRIPTION_CHANGED,
        'startIntrigue':        EventTypes.INTRIGUE_STARTED,
        'cancelIntrigue':       EventTypes.INTRIGUE_CANCELLED,
        'revealIntrigue':       EventTypes.INTRIGUE_REVEALED,
        'mountTransport':       EventTypes.TRANSPORT_MOUNTED,
        'dismountTransport':    EventTypes.TRANSPORT_DISMOUNTED,
        'buildBusiness':        EventTypes.BUSINESS_BUILT,
        'buyHolding':           EventTypes.HOLDING_BOUGHT,
        'sellHolding':          EventTypes.HOLDING_SOLD,
        'bankTransaction':      EventTypes.BANK_TRANSACTION,
        'initiateTrade':        EventTypes.TRADE_INITIATED,
        'confirmTrade':         EventTypes.TRADE_CONFIRMED,
        'negotiateTrade':       EventTypes.TRADE_NEGOTIATED,
        'applyPredefinedEffect': EventTypes.STATUS_EFFECT_APPLIED,
    });

    /**
     * Обогащает результат команды перед отправкой ГМ.
     * Добавляет нарративные подсказки и пушит событие в Event Bus.
     *
     * @param {string} command - Имя выполненной команды
     * @param {Object} args - Аргументы команды
     * @param {string|null} feedback - Результат выполнения
     * @returns {Object} Обогащённый результат { feedback, narrativeHint, eventType }
     */
    function enrichCommandResult(command, args, feedback) {
        const eventType = CommandEventMap[command];

        // Генерируем нарративную подсказку для ГМ
        const narrativeHint = generateNarrativeHint(command, args, feedback, eventType);

        // Пушим событие в Event Bus
        if (eventType) {
            publish(eventType, { command, args, feedback, narrativeHint });
        }

        // Записываем в историю команд
        _commandHistory.push({
            command,
            args: { ...args },
            feedback,
            eventType,
            narrativeHint,
            timestamp: Date.now()
        });
        if (_commandHistory.length > MAX_COMMAND_HISTORY) {
            _commandHistory.shift();
        }

        return { feedback, narrativeHint, eventType };
    }

    /**
     * Генерирует нарративную подсказку на основе выполненной команды.
     * ГМ получает эту подсказку как дополнительный контекст для следующего хода.
     */
    function generateNarrativeHint(command, args, feedback, eventType) {
        const hints = {
            // Фракции
            [EventTypes.WAR_DECLARED]: `ВОЙНА! ${args.fromFactionId || '?'} объявляет войну ${args.toFactionId || '?'}. Это ЗНАЧИТЕЛЬНОЕ событие — опиши мобилизацию, страх, патриотизм или панику.`,
            [EventTypes.PEACE_FORCED]: `МИР! ${args.factionId1 || '?'} и ${args.factionId2 || '?'} заключают мир. Опиши облегчение, циничные переговоры или недовольство.`,
            [EventTypes.FACTION_CREATED]: `НОВАЯ ФРАКЦИЯ: ${args.name || args.factionId || '?'}. Опиши рождение новой силы в мире.`,
            [EventTypes.REGION_TRANSFERRED]: `ПЕРЕХОД РЕГИОНА: ${args.regionId || '?'} теперь принадлежит ${args.newFactionId || '?'}. Опиши смену флагов, реакцию населения.`,
            [EventTypes.RULER_TRAIT_CHANGED]: `ПРАВИТЕЛЬ ИЗМЕНЁН: ${args.rulerId || '?'}, черта "${args.trait || '?'}" → ${args.value}. Это влияет на политику фракции.`,

            // Бой
            [EventTypes.COMBAT_STARTED]: `БОЙ НАЧАЛСЯ! Участники: ${args.participants?.join(', ') || '?'}. Опиши лязг стали, крики, адреналин.`,
            [EventTypes.ENTITY_KILLED]: `СУЩЕСТВО УБИТО: ${args.aiIdentifier || '?'}. Опиши смерть — кровь, хруст, последние слова или тишину.`,
            [EventTypes.ENTITY_SPAWNED]: `НОВОЕ СУЩЕСТВО: ${args.name || args.aiIdentifier || '?'}. Опиши его появление — запах, звук, тень, взгляд.`,

            // Перемещения
            [EventTypes.TRAVEL_STARTED]: `ПУТЕШЕСТВИЕ НАЧАЛОСЬ: направление ${args.destinationId || '?'}. Опиши дорогу, горизонт, решимость.`,
            [EventTypes.LOCATION_CHANGED]: `ТЕЛЕПОРТАЦИЯ: игрок перемещён в ${args.locationName || '?'}. Опиши смену обстановки.`,

            // Инвентарь
            [EventTypes.ITEM_ADDED]: `ПРЕДМЕТ ПОЛУЧЕН: ${args.name || args.aiIdentifier || '?'}. Опиши вес в руке, текстуру, блеск или запах.`,
            [EventTypes.ITEM_EQUIPPED]: `ПРЕДМЕТ ЭКИПИРОВАН: ${args.aiIdentifier || '?'}. Опиши, как он сел на тело — тяжесть доспеха, баланс меча.`,

            // Статы
            [EventTypes.STAT_CHANGED]: `СТАТ ИЗМЕНЁН: ${args.stat || '?'} → ${args.change || args.value || '?'}. Опиши физическое или ментальное последствие.`,
            [EventTypes.STATUS_EFFECT_APPLIED]: `ЭФФЕКТ НАЛОЖЕН: ${args.id || args.name || '?'}. Опиши, как он ощущается — жар, холод, слабость, сила.`,
            [EventTypes.STATUS_EFFECT_REMOVED]: `ЭФФЕКТ СНЯТ: ${args.id || args.name || '?'}. Опиши облегчение — или остаточные симптомы.`,

            // Квесты
            [EventTypes.QUEST_ADDED]: `НОВЫЙ КВЕСТ: "${args.title || '?'}". Опиши, как игрок узнаёт о задании.`,
            [EventTypes.QUEST_UPDATED]: `КВЕСТ ОБНОВЛЁН: ${args.aiIdentifier || '?'}, статус: ${args.status || '?'}. Опиши прогресс.`,

            // Память
            [EventTypes.MEMORY_SET]: `ПАМЯТЬ ЗАПИСАНА: "${args.id || '?'}". Это важно для будущего повествования.`,
            [EventTypes.ECHO_MEMORY_ADDED]: `ЭХО-ПАМЯТЬ: "${(args.text || '').substring(0, 50)}...". Этот факт будет всегда в контексте ГМ.`,

            // Nexus
            [EventTypes.NEXUS_DEFINED]: `NEXUS КОНСТАНТА: "${args.name || args.id || '?'}" = ${args.value || '?'}. Это часть мира теперь.`,
            [EventTypes.NEXUS_UPDATED]: `NEXUS ОБНОВЛЁН: "${args.id || '?'}" → ${args.value || args.state || '?'}. Мир меняется.`,
        };

        return hints[eventType] || null;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  LAYER 3: NARRATIVE VERIFIER — Сверка нарратива с состоянием
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Утверждения, которые ГМ делает в нарративе и которые нужно проверить.
     * Каждый тип утверждения имеет верификатор.
     */
    const AssertionTypes = Object.freeze({
        ENTITY_ALIVE: 'entity_alive',         // "Гоблин атакует" — гоблин жив?
        ENTITY_DEAD: 'entity_dead',           // "Враг повержен" — HP = 0?
        ENTITY_PRESENT: 'entity_present',     // "Торговец стоит тут" — в visibleEntities?
        ENTITY_HOSTILE: 'entity_hostile',     // "Монстр нападает" — isHostile=true?
        PLAYER_HAS_ITEM: 'player_has_item',   // "Ты достаёшь меч" — меч в инвентаре?
        PLAYER_AT_LOCATION: 'player_at_location', // "Ты в таверне" — setLocation был вызван?
        IN_COMBAT: 'in_combat',               // "Бой продолжается" — combatState.isActive?
        NOT_IN_COMBAT: 'not_in_combat',        // "Ты отдыхаешь" — combatState.isActive=false?
        WEATHER_IS: 'weather_is',             // "Идёт дождь" — weather в регионе?
        SEASON_IS: 'season_is',               // "Зима" — season в регионе?
        FACTION_OWNS: 'faction_owns',         // "Город принадлежит Аквилону" — factionId региона?
        WAR_ACTIVE: 'war_active',             // "Война в самом разгаре" — дипломатика?
        QUEST_ACTIVE: 'quest_active',         // "Квест продолжается" — статус квеста?
    });

    /**
     * Извлекает утверждения ГМ из нарративного текста.
     * Использует эвристики для определения заявлений о состоянии мира.
     *
     * @param {string} narrative - Текст нарратива от ГМ
     * @param {Object} player - Объект игрока
     * @param {Object} worldState - Текущее состояние мира
     * @returns {Array} Массив утверждений { type, subject, claimed, actual }
     */
    function extractNarrativeAssertions(narrative, playerObj, worldState) {
        const assertions = [];
        if (!narrative || !playerObj) return assertions;

        const text = narrative.toLowerCase();

        // Проверка: упоминаются ли убитые сущности как живые?
        if (playerObj.visibleEntities) {
            for (const [id, entity] of Object.entries(playerObj.visibleEntities)) {
                if (entity.hp <= 0) {
                    // Существо мертво, но ГМ может описать его как живое
                    const nameLower = (entity.name || id).toLowerCase();
                    if (text.includes(nameLower) && !text.includes('труп') && !text.includes('мёртв') && !text.includes('убит')) {
                        assertions.push({
                            type: AssertionTypes.ENTITY_DEAD,
                            subject: id,
                            entityName: entity.name,
                            claimed: 'упоминается как действующее лицо',
                            actual: `HP=${entity.hp} (МЁРТВ)`,
                            severity: 'CRITICAL'
                        });
                    }
                }
            }
        }

        // Проверка: бой isActive?
        const combatActive = playerObj.currentCombat?.isActive === true;
        if (combatActive && (text.includes('спокойн') || text.includes('отдыхаешь') || text.includes('расслабл'))) {
            assertions.push({
                type: AssertionTypes.IN_COMBAT,
                subject: 'player',
                claimed: 'сцена мирная',
                actual: 'БОЙ АКТИВЕН',
                severity: 'CRITICAL'
            });
        }
        if (!combatActive && (text.includes('меч свистит') || text.includes('стрела вонзает') || text.includes('удар врага'))) {
            // Может быть описанием атаки игрока, не обязательно бой
            // Только предупреждаем если нет setCombatState в командах хода
        }

        return assertions;
    }

    /**
     * Проверяет утверждения ГМ против реального состояния мира.
     *
     * @param {Array} assertions - Массив утверждений
     * @param {Object} playerObj - Объект игрока
     * @param {Object} worldState - Состояние мира
     * @returns {Object} { violations: [], warnings: [], correctionMessages: [] }
     */
    function verifyAssertions(assertions, playerObj, worldState) {
        const violations = [];
        const warnings = [];
        const correctionMessages = [];

        for (const assertion of assertions) {
            if (assertion.severity === 'CRITICAL') {
                violations.push(assertion);
                correctionMessages.push(
                    `[GRAIL КОРРЕКЦИЯ] НАРУШЕНИЕ: ГМ утверждает "${assertion.claimed}", ` +
                    `но реальность: ${assertion.actual}. Субъект: ${assertion.entityName || assertion.subject}. ` +
                    `КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО описывать это иначе!`
                );
            } else {
                warnings.push(assertion);
            }
        }

        return { violations, warnings, correctionMessages };
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  LAYER 4: STATE RECONCILER — Авто-коррекция расхождений
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Снимок ключевых метрик для сравнения ДО и ПОСЛЕ хода.
     * @param {Object} playerObj - Объект игрока
     * @returns {Object} Лёгкий снимок состояния
     */
    function captureLightweightSnapshot(playerObj) {
        if (!playerObj) return null;

        const entityStates = {};
        if (playerObj.visibleEntities) {
            for (const [id, e] of Object.entries(playerObj.visibleEntities)) {
                entityStates[id] = { hp: e.hp, maxHp: e.maxHp, isHostile: e.isHostile, name: e.name };
            }
        }

        return {
            hp: playerObj.stats?.hp,
            gold: playerObj.stats?.gold,
            location: playerObj.location,
            combatActive: playerObj.currentCombat?.isActive || false,
            combatParticipants: playerObj.currentCombat?.participants || [],
            entityStates,
            questCount: Object.keys(playerObj.quests || {}).length,
            timestamp: Date.now()
        };
    }

    /**
     * Сравнивает снимки ДО и ПОСЛЕ, выявляя расхождения.
     *
     * @param {Object} pre - Снимок до хода
     * @param {Object} post - Снимок после хода
     * @param {Array} commandsExecuted - Выполненные команды
     * @returns {Object} { reconciled: boolean, discrepancies: [], autoCorrections: [] }
     */
    function reconcileState(pre, post, commandsExecuted) {
        if (!pre || !post) return { reconciled: true, discrepancies: [], autoCorrections: [] };

        const discrepancies = [];
        const autoCorrections = [];

        // 1. HP изменился без команды?
        const hpCommands = commandsExecuted.filter(c =>
            c.command === 'updateStat' && c.args?.stat === 'hp'
        );
        if (post.hp !== pre.hp && hpCommands.length === 0) {
            // HP изменился, но не через updateStat — возможно, автоматический урон
            discrepancies.push({
                type: 'hp_mismatch',
                description: `HP изменился с ${pre.hp} до ${post.hp} без команды updateStat`,
                autoFix: false
            });
        }

        // 2. Бой начался без команды setCombatState?
        if (post.combatActive && !pre.combatActive) {
            const combatCommand = commandsExecuted.find(c => c.command === 'setCombatState');
            if (!combatCommand) {
                discrepancies.push({
                    type: 'combat_started_without_command',
                    description: 'Бой начался без команды setCombatState',
                    autoFix: false
                });
            }
        }

        // 3. Сущности появились без команды addEnvironment?
        const newEntities = Object.keys(post.entityStates).filter(id => !pre.entityStates[id]);
        const addEnvCommands = commandsExecuted.filter(c => c.command === 'addEnvironment');
        for (const newId of newEntities) {
            const wasAdded = addEnvCommands.some(c => c.args?.aiIdentifier === newId);
            if (!wasAdded) {
                discrepancies.push({
                    type: 'entity_appeared_without_command',
                    description: `Сущность ${newId} (${post.entityStates[newId]?.name}) появилась без команды addEnvironment`,
                    autoFix: false
                });
            }
        }

        // 4. Сущности исчезли без причины?
        const removedEntities = Object.keys(pre.entityStates).filter(id => !post.entityStates[id]);
        for (const removedId of removedEntities) {
            const wasRemoved = commandsExecuted.some(c =>
                c.command === 'removeEnvironment' && c.args?.aiIdentifier === removedId
            );
            const wasKilled = commandsExecuted.some(c =>
                c.command === 'updateEntityStat' && c.args?.aiIdentifier === removedId && c.args?.stat === 'hp' && c.args?.value <= 0
            );
            if (!wasRemoved && !wasKilled) {
                // Сущность исчезла без явной команды — возможно, движение
                // Не ошибка, но стоит логировать
            }
        }

        return {
            reconciled: discrepancies.filter(d => d.autoFix).length === 0,
            discrepancies,
            autoCorrections
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  LAYER 5: SEMANTIC BRIDGE — Маппинг нарративных намерений на команды
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Нарративные намерения ГМ и соответствующие обязательные команды.
     * Если ГМ описывает что-то из левой колонки, он ОБЯЗАН использовать команду из правой.
     */
    const NarrativeCommandMap = Object.freeze({
        // Бой
        'начинает бой':              'setCombatState',
        'нападает':                  'setCombatState',
        'атакует':                   'setCombatState',
        'вступает в бой':            'setCombatState',
        'бой начинается':            'setCombatState',
        'бой окончен':               'setCombatState {isActive:false}',
        'бой завершён':              'setCombatState {isActive:false}',
        'враг убит':                 'updateEntityStat {stat:"hp",value:0}',
        'враг повержен':             'updateEntityStat {stat:"hp",value:0}',
        'существо умирает':          'updateEntityStat {stat:"hp",value:0}',

        // Перемещение
        'ты идёшь':                  'startTravel',
        'ты отправляешься':          'startTravel',
        'ты покидаешь':              'startTravel',
        'ты прибываешь':             'setLocation',
        'ты входишь в':              'setLocation',
        'ты оказываешься в':         'setLocation',

        // Предметы
        'ты получаешь':              'addItem',
        'ты находишь':               'addItem',
        'ты берёшь':                 'addItem или moveItem',
        'предмет исчезает':          'removeItem',
        'ты выпиваешь':              'removeItem',
        'ты съедаешь':               'removeItem',
        'ты надеваешь':              'equipItem',

        // NPC
        'появляется':                'addEnvironment',
        'к тебе подходит':           'addEnvironment',
        'ты видишь':                 'addEnvironment (для новых)',
        'уходит':                    'removeEnvironment (если жив)',
        'исчезает':                  'removeEnvironment',
    });

    /**
     * Строит блок GRAIL-контекста для промпта ГМ.
     * Этот блок добавляется в каждый ход как обязательное напоминание.
     *
     * @param {Object} playerObj - Объект игрока
     * @returns {string} GRAIL-блок для контекста
     */
    function buildGrailContextBlock(playerObj) {
        if (!playerObj) return '';

        let block = '\n=== GRAIL: СИНХРОНИЗАЦИЯ ГМ ↔ СИМУЛЯЦИЯ ===\n';
        block += '// ПРАВИЛО АБСОЛЮТНОЙ ПРАВДЫ: Симуляция — ЕДИНСТВЕННЫЙ источник правды.\n';
        block += '// Каждый твоё нарративное утверждение ОБЯЗАНО соответствовать механическому состоянию.\n\n';

        // 1. Текущее боевое состояние
        const combatActive = playerObj.currentCombat?.isActive;
        block += `БОЕВОЕ СОСТОЯНИЕ: ${combatActive ? 'БОЙ АКТИВЕН (участники: ' + (playerObj.currentCombat?.participants || []).join(', ') + ')' : 'МИРНО (боёв нет)'}\n`;
        if (combatActive) {
            block += '// Ты КАТЕГОРИЧЕСКИ ЗАПРЕЩЁН описывать спокойную сцену — БОЙ ИДЁТ!\n';
        }

        // 2. Видимые сущности и их статус
        const entities = playerObj.visibleEntities || {};
        const entityEntries = Object.entries(entities);
        if (entityEntries.length > 0) {
            block += '\nСУЩНОСТИ В ЗОНЕ ВИДИМОСТИ (ФАКТЫ, НЕ ПРИДУМЫВАЙ!):\n';
            for (const [id, e] of entityEntries) {
                const status = e.hp <= 0 ? 'МЁРТВ' : (e.isHostile ? `ВРАЖДЕБЕН (HP:${e.hp}/${e.maxHp})` : `НЕЙТРАЛЕН (HP:${e.hp}/${e.maxHp})`);
                block += `  • ${e.name || id}: ${status}\n`;
                if (e.hp <= 0) {
                    block += `    ⚠ ЗАПРЕЩЕНО описывать как действующее лицо — ОН МЁРТВ!\n`;
                }
            }
        }

        // 3. Последние события (из истории команд)
        const recentEvents = _commandHistory.slice(-10);
        if (recentEvents.length > 0) {
            block += '\nПОСЛЕДНИЕ ИЗМЕНЕНИЯ (ты ОБЯЗАН учитывать их в нарративе):\n';
            for (const evt of recentEvents) {
                if (evt.eventType && evt.feedback) {
                    block += `  • [${evt.eventType}] ${evt.command} → ${String(evt.feedback).substring(0, 80)}\n`;
                }
            }
        }

        block += '\n// НАПОМИНАНИЕ: Если ты описал событие, но НЕ использовал соответствующую команду — его НЕ СУЩЕСТВУЕТ в мире.\n';
        block += '// Если команда вернула ошибку — СОБЛЮДАЙ результат. Симуляция — закон.\n';
        block += '=== КОНЕЦ GRAIL ===\n';

        return block;
    }

    /**
     * Генерирует сообщения-коррекции для ГМ на основе нарушений.
     * Эти сообщения добавляются в следующий контекст ГМ.
     *
     * @param {Object} verificationResult - Результат verifyAssertions()
     * @returns {string} Блок коррекций
     */
    function buildCorrectionBlock(verificationResult) {
        if (!verificationResult || !verificationResult.correctionMessages?.length) return '';

        let block = '\n=== GRAIL: КОРРЕКЦИЯ НАРРАТИВА ===\n';
        block += '// ТЫ НАРУШИЛ ПРАВИЛА СИНХРОНИЗАЦИИ. ИСПРАВЬСЯ В СЛЕДУЮЩЕМ ОТВЕТЕ:\n\n';
        for (const msg of verificationResult.correctionMessages) {
            block += `${msg}\n\n`;
        }
        block += '=== КОНЕЦ КОРРЕКЦИЙ ===\n';

        return block;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  TURN LIFECYCLE — Управление жизненным циклом хода
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Вызывается ДО обработки хода ГМ.
     * Снимает "фотографию" текущего состояния для последующей сверки.
     */
    function onTurnStart(playerObj) {
        _turnState.preSnapshot = captureLightweightSnapshot(playerObj);
        _turnState.gmCommands = [];
        _turnState.gmNarrative = '';
        _turnState.reconciled = false;
        _narrativeAssertions.length = 0;
    }

    /**
     * Вызывается ДЛЯ КАЖДОЙ команды ГМ во время обработки.
     * Регистрирует команду и пушит событие.
     */
    function onCommandExecuted(command, args, feedback) {
        _turnState.gmCommands.push({ command, args, feedback });
        return enrichCommandResult(command, args, feedback);
    }

    /**
     * Вызывается ПОСЛЕ обработки хода ГМ.
     * Сверяет нарратив с состоянием, генерирует коррекции.
     *
     * @param {string} narrative - Нарратив ГМ
     * @param {Object} playerObj - Объект игрока
     * @returns {Object} { corrections, reconciliationResult }
     */
    function onTurnEnd(narrative, playerObj) {
        _turnState.gmNarrative = narrative;
        _turnState.postSnapshot = captureLightweightSnapshot(playerObj);

        // Извлекаем утверждения из нарратива
        const assertions = extractNarrativeAssertions(narrative, playerObj, null);

        // Проверяем их
        const verification = verifyAssertions(assertions, playerObj, null);

        // Сверяем состояние ДО/ПОСЛЕ
        const reconciliation = reconcileState(
            _turnState.preSnapshot,
            _turnState.postSnapshot,
            _turnState.gmCommands
        );
        _turnState.reconciled = reconciliation.reconciled;

        // Публикуем событие завершения хода
        publish(EventTypes.TURN_COMPLETED, {
            commandsExecuted: _turnState.gmCommands.length,
            violations: verification.violations.length,
            warnings: verification.warnings.length,
            discrepancies: reconciliation.discrepancies.length,
            reconciled: reconciliation.reconciled
        });

        // Генерируем блок коррекций
        const corrections = buildCorrectionBlock(verification);

        return { corrections, reconciliationResult: reconciliation, verificationResult: verification };
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ПУБЛИЧНЫЙ API
    // ═══════════════════════════════════════════════════════════════════════

    return Object.freeze({
        // Константы
        EventTypes,
        AssertionTypes,
        CommandEventMap,
        NarrativeCommandMap,

        // Layer 1: Event Bus
        subscribe,
        subscribeMany,
        publish,

        // Layer 2: Command Gateway
        enrichCommandResult,
        generateNarrativeHint,

        // Layer 3: Narrative Verifier
        extractNarrativeAssertions,
        verifyAssertions,

        // Layer 4: State Reconciler
        captureLightweightSnapshot,
        reconcileState,

        // Layer 5: Semantic Bridge
        buildGrailContextBlock,
        buildCorrectionBlock,

        // Turn Lifecycle
        onTurnStart,
        onCommandExecuted,
        onTurnEnd,

        // Debug
        getCommandHistory: () => [..._commandHistory],
        getTurnState: () => ({ ..._turnState }),
    });
})();

// Экспорт для Node.js (тестирование) и браузера
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GRAIL;
} else if (typeof window !== 'undefined') {
    window.GRAIL = GRAIL;
}
