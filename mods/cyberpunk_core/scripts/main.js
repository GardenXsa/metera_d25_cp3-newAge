ModAPI.on('onModsInitialized', async () => {
    console.log('[Cyberpunk Mod] Инициализация ядра киберпанка...');

    // 1. Загрузка локализаций
    try {
        const ruLoc = await ModAPI.readJson(modId, 'locales/ru.json');
        const enLoc = await ModAPI.readJson(modId, 'locales/en.json');
        if (ruLoc) ModAPI.addTranslations('ru', ruLoc);
        if (enLoc) ModAPI.addTranslations('en', enLoc);
    } catch (e) {
        console.error('[Cyberpunk Mod] Ошибка загрузки локализаций:', e);
    }

    // 2. Инъекция Cyberpunk CSS (Неон, Сканлайны, Терминальный стиль)
    const cyberpunkCSS = `
        :root {
            --bg-base: #020204 !important;
            --bg-gradient-1: #05050a !important;
            --bg-gradient-2: #0a0510 !important;
            --bg-gradient-3: #02050a !important;
            
            --panel-bg: rgba(5, 10, 15, 0.9) !important;
            --panel-border: rgba(0, 243, 255, 0.4) !important;
            --panel-border-hover: rgba(255, 0, 60, 0.8) !important;
            
            --accent-blue: #00f3ff !important; /* Neon Cyan */
            --accent-gold: #f1c40f !important; /* Neon Yellow */
            --accent-red: #ff003c !important;  /* Cyberpunk Red */
            --accent-green: #00ff9d !important; /* Matrix Green */
            
            --text-main: #e0e0e0 !important;
            --font-main: 'Consolas', monospace !important;
            --font-heading: 'Consolas', monospace !important;
        }
        
        /* CRT Scanlines overlay */
        body::after {
            content: "";
            position: fixed;
            top: 0; left: 0; width: 100vw; height: 100vh;
            background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06));
            background-size: 100% 4px, 3px 100%;
            z-index: 9999;
            pointer-events: none;
        }
        
        /* Glitch effect on titles */
        h1, h2, h3, .mm-title {
            text-transform: uppercase;
            text-shadow: 2px 0 var(--accent-red), -2px 0 var(--accent-blue) !important;
            letter-spacing: 2px;
        }
        
        /* Terminal style for logs */
        .game-log {
            background: rgba(0, 5, 10, 0.9) !important;
            border: 1px solid var(--accent-blue) !important;
            box-shadow: inset 0 0 20px rgba(0, 243, 255, 0.1) !important;
        }
        
        .bubble-gm {
            background: rgba(0, 20, 30, 0.8) !important;
            border-color: var(--accent-blue) !important;
            border-radius: 0 !important;
            border-left: 4px solid var(--accent-blue) !important;
        }
        
        .bubble-user {
            background: rgba(30, 5, 10, 0.8) !important;
            border-color: var(--accent-red) !important;
            border-radius: 0 !important;
            border-right: 4px solid var(--accent-red) !important;
            color: var(--accent-red) !important;
        }
        
        .input-area {
            border-radius: 0 !important;
            border-top: 2px solid var(--accent-red) !important;
        }
        
        #send-button {
            background: transparent !important;
            border: 1px solid var(--accent-red) !important;
            color: var(--accent-red) !important;
            border-radius: 0 !important;
        }
        #send-button:hover {
            background: var(--accent-red) !important;
            color: #000 !important;
            box-shadow: 0 0 15px var(--accent-red) !important;
        }
    `;
    ModAPI.addStyle('cyberpunk_theme', cyberpunkCSS);

    // 3. Добавление кастомной команды для взлома
    ModAPI.addCommand('netrun_hack', async (args) => {
        if (!player) return;
        const target = args.target || 'Неизвестная система';
        const difficulty = args.difficulty || 15;
        
        // Бросок на интеллект (в киберпанке это навык нетраннера)
        const roll = Math.floor(Math.random() * 20) + 1;
        const modifier = Math.floor((player.stats.int - 10) / 2);
        const total = roll + modifier;
        
        let feedback = `[NETWATCH] Попытка взлома ICE узла: ${target}. Бросок: ${roll} + ${modifier} = ${total} (Сложность: ${difficulty}). `;
        
        if (total >= difficulty) {
            feedback += `ВЗЛОМ УСПЕШЕН. Вы получили доступ к данным.`;
            // Выдаем евродоллары за успешный взлом
            const eurodollars = Math.floor(Math.random() * 500) + 100;
            await ModAPI.sendToEngine('updateStat', { stat: 'gold', change: eurodollars });
            feedback += ` Скачано ${eurodollars} 💶.`;
        } else {
            feedback += `ВЗЛОМ ПРОВАЛЕН. Сработало активное противодействие (Black ICE).`;
            // Урон по HP (обратная связь нейроинтерфейса)
            const damage = Math.floor(Math.random() * 10) + 5;
            await ModAPI.sendToEngine('updateStat', { stat: 'hp', change: -damage });
            feedback += ` Получено ${damage} урона нейросистеме!`;
        }
        
        return feedback;
    }, {
        name: 'netrun_hack',
        description: 'Попытка взлома системы (бросок на Интеллект).',
        args: '{ "target": "Имя системы", "difficulty": 15 }'
    });

    // 4. Инъекция в промпт ИИ для поддержания атмосферы
    ModAPI.addPromptInjection(`
        [CYBERPUNK OVERRIDE]
        Ты ведешь игру в сеттинге мрачного киберпанка (2077 год).
        Забудь про магию, эльфов и мечи. 
        Магия = Скрипты (Quickhacks) и Импланты (Cyberware).
        Оружие = Огнестрел, Умное оружие, Термальные клинки, Моно-струны.
        Монстры = Киберпсихи, Боевые дроны, Корпоративные киллеры.
        Города = Мегаполисы, залитые неоном, с огромным расслоением общества.
        Золото = Евродоллары (Eurodollars / Eddies).
        Описывай мир грязно, цинично, с обилием неона, дождя, хрома и корпоративной жестокости.
    `);

    // 5. Глубокая подмена базы данных (Биомы, Монстры, Бедствия, CityGen, Социум)
    ModAPI.on('onDatabaseLoad', async (db) => {
        try {
            const biomes = await ModAPI.readJson('cyberpunk_core', 'data/biomes.json');
            if (biomes) db.biomes = biomes;
            
            const cityGen = await ModAPI.readJson('cyberpunk_core', 'data/city_gen.json');
            if (cityGen) db.city_gen = cityGen;
            
            const monsters = await ModAPI.readJson('cyberpunk_core', 'data/monsters.json');
            if (monsters) db.monsters = monsters;
            
            const disasters = await ModAPI.readJson('cyberpunk_core', 'data/disasters.json');
            if (disasters) db.disasters = disasters;
            
            const races = await ModAPI.readJson('cyberpunk_core', 'data/races.json');
            if (races) db.races = races;
            
            const professions = await ModAPI.readJson('cyberpunk_core', 'data/professions.json');
            if (professions) db.professions = professions;
            
            const traits = await ModAPI.readJson('cyberpunk_core', 'data/traits.json');
            if (traits) db.traits = traits;
            
            const npcNames = await ModAPI.readJson('cyberpunk_core', 'data/npc_names.json');
            if (npcNames) db.npc_names = npcNames;
            
            const factionRelations = await ModAPI.readJson('cyberpunk_core', 'data/faction_relations.json');
            if (factionRelations) db.faction_relations = factionRelations;
            
            console.log('[Cyberpunk Mod] База данных мира (биомы, социум, фракции) успешно заменена на киберпанк-версию.');
        } catch (e) {
            console.error('[Cyberpunk Mod] Ошибка подмены БД:', e);
        }
    });

    // 6. Продвинутые механики: Импланты (Cyberware)
    ModAPI.addCommand('install_cyberware', async (args) => {
        if (!player) return;
        const implant = args.implant || 'Хром неизвестного происхождения';
        const cost = args.cost || 1000;
        if (player.stats.gold < cost) return `[РИППЕРДОК] Недостаточно евродолларов. Нужно ${cost} 💶.`;
        
        await ModAPI.sendToEngine('updateStat', { stat: 'gold', change: -cost });
        await ModAPI.sendToEngine('addStatusEffect', {
            target: 'player', 
            id: 'cyberware_' + Date.now(), 
            name: 'Имплант: ' + implant,
            duration: 9999, 
            description: 'Установлен кибернетический имплант. Повышает риск киберпсихоза.',
            effectsJSON: []
        });
        return `[РИППЕРДОК] Имплант "${implant}" успешно установлен. Списано ${cost} 💶.`;
    }, { 
        name: 'install_cyberware', 
        description: 'Установить имплант у риппердока.', 
        args: '{ "implant": "Sandevistan", "cost": 1000 }' 
    });

    // 7. Продвинутые механики: Огнестрельный бой
    ModAPI.addCommand('firearm_shoot', async (args) => {
        if (!player) return;
        const target = args.target || 'Враг';
        const roll = Math.floor(Math.random() * 20) + 1;
        const modifier = Math.floor((player.stats.dex - 10) / 2);
        const total = roll + modifier;
        
        let feedback = `[СТРЕЛЬБА] Выстрел по ${target}. Бросок: ${roll} + ${modifier} = ${total}. `;
        if (total >= 18) {
            const dmg = Math.floor(Math.random() * 30) + 20;
            feedback += `КРИТИЧЕСКОЕ ПОПАДАНИЕ в уязвимую точку! Нанесено ${dmg} урона.`;
        } else if (total >= 10) {
            const dmg = Math.floor(Math.random() * 15) + 5;
            feedback += `Попадание. Нанесено ${dmg} урона.`;
        } else {
            feedback += `ПРОМАХ. Пуля ушла в молоко.`;
        }
        return feedback;
    }, { 
        name: 'firearm_shoot', 
        description: 'Выстрелить из огнестрельного оружия (бросок на Ловкость).', 
        args: '{ "target": "Дрон Милитех" }' 
    });

    // 8. Механика Киберпсихоза (Ежедневная проверка)
    ModAPI.on('onBeforeDailyTick', async () => {
        if (!player || !player.statusEffects) return;
        let cyberwareCount = 0;
        for (let key in player.statusEffects) {
            if (player.statusEffects[key].name.includes('Имплант')) {
                cyberwareCount++;
            }
        }
        
        // Если установлено больше 2 имплантов, есть риск киберпсихоза
        if (cyberwareCount > 2 && Math.random() < 0.15) {
            ModAPI.notify('ВНИМАНИЕ: Критический уровень хрома в организме. Обнаружены симптомы надвигающегося киберпсихоза. Эмпатия падает.', 'system-message');
            await ModAPI.sendToEngine('updateStat', { stat: 'cha', change: -1 });
        }
    });


    // 9. Очистка UI от ванильных рудиментов (Эпохи)
    const eraSelect = document.getElementById('char-era-select');
    if (eraSelect) {
        Array.from(eraSelect.options).forEach(opt => {
            if (opt.value !== 'rebirth') {
                opt.remove();
            }
        });
        if (typeof updateEraDescription === 'function') updateEraDescription();
    }

    // Патчим Быстрый Старт, чтобы он не выбирал удаленные эпохи и генерировал лорные имена
    if (window.handleQuickStart) {
        ModAPI.patchFunction(window, 'handleQuickStart', () => {
            const races = ['human', 'elf', 'dwarf'];
            const classes = ['warrior', 'mage', 'rogue', 'bard'];
            const eras = ['rebirth'];
            const names = ['V', 'Jackie', 'Johnny', 'Rogue', 'Panam', 'Judy', 'David', 'Lucy', 'Rebecca'];

            charRaceSelect.value = races[Math.floor(Math.random() * races.length)];
            charClassSelect.value = classes[Math.floor(Math.random() * classes.length)];
            charEraSelect.value = eras[Math.floor(Math.random() * eras.length)];
            const genderSelect = document.getElementById('char-gender-select');
            if (genderSelect) genderSelect.value = Math.random() > 0.5 ? 'male' : 'female';

            handleRaceOrClassChange();

            charNameInput.value = names[Math.floor(Math.random() * names.length)] + " " + (Math.floor(Math.random() * 900) + 100);
            charDescInput.value = "Наемник из Найт-Сити. Ищет способ выжить и стать легендой.";

            const statKeys = ['str', 'dex', 'int', 'con', 'cha', 'res'];
            while (availableStatPoints > 0) {
                const randomStat = statKeys[Math.floor(Math.random() * statKeys.length)];
                currentCreationStats[randomStat]++;
                availableStatPoints--;
            }

            updateStatCreationDisplay();
            finalizeCharacterCreation();
        });
    }


    console.log('[Cyberpunk Mod] Инициализация завершена. Добро пожаловать в Найт-Сити.');
});
