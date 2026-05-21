// Инициализация мода Neon Abyss
ModAPI.on('onModsInitialized', async () => {
    console.log('[Neon Abyss] Мод загружен! Добро пожаловать в Бездну.');

    // 1. ИНЪЕКЦИЯ В МОЗГ ИИ (Меняем сеттинг на киберпанк)
    ModAPI.addPromptInjection(
        "[ВНИМАНИЕ: АКТИВИРОВАН ГЛОБАЛЬНЫЙ МОД 'NEON ABYSS']\n" +
        "Мир полностью изменился. Забудь про классическое фэнтези. Теперь это мрачный подземный КИБЕРПАНК / ТЕХНО-ФЭНТЕЗИ.\n" +
        "Вместо магии — неоновый эфир, нейросети и кибер-импланты.\n" +
        "Описывай грязь, голограммы, мерцающий неон, ржавые провода, кислотные дожди и корпоративную жестокость.\n" +
        "Эльфы теперь — корпоративные генно-модифицированные аристократы. Дварфы — киборги-механики с аугментациями. Орки — уличные банды на стероидах.\n" +
        "Оружие — это термо-клинки, плазменные пистолеты и шокеры. Броня — кевлар и экзоскелеты.\n" +
        "ТЫ ОБЯЗАН поддерживать атмосферу киберпанка в каждом ответе!"
    );

    // 2. ПОЛНАЯ ПЕРЕЗАПИСЬ ЛОРА ИГРЫ
    ModAPI.on('onLoreLoad', async (hookData) => {
        hookData.lore = "ЗАБУДЬТЕ СТАРЫЙ МИР. МЕТЕРА МЕРТВА.\nДобро пожаловать в Неоновую Бездну. Это гигантский подземный мегаполис, построенный на руинах древней цивилизации. Солнца здесь нет, есть только гудящие неоновые лампы, токсичный смог и бесконечные уровни стальных конструкций. Миром правят Корпорации Эфира, выкачивающие энергию из ядра планеты. Выживают здесь только хакеры, наемники с аугментациями и те, кому нечего терять.";
    });

    // 3. КАСТОМНАЯ ГМ-КОМАНДА (Хакерство)
    ModAPI.addCommand(
        'hackTerminal',
        async (args) => {
            if (!player) return "[ERROR] Игрок не найден.";
            const roll = Math.floor(Math.random() * 20) + 1 + Math.floor(((player.stats.intelligence || player.stats.int || 10) - 10) / 2);
            
            if (roll >= 15) {
                const credits = 100 + Math.floor(Math.random() * 400);
                player.stats.gold += credits;
                ModAPI.notify(`Взлом успешен! Украдено ${credits} кредитов.`, "level-up");
                if (typeof updateCharacterSheet === 'function') updateCharacterSheet();
                return `[СИСТЕМА ВЗЛОМА] Игрок успешно обошел лед корпорации (Бросок: ${roll}). Получено ${credits} кредитов. Опиши, как он скачал данные и деньги.`;
            } else {
                const dmg = 10 + Math.floor(Math.random() * 20);
                if (typeof damagePlayerHP === 'function') damagePlayerHP(dmg); else player.stats.hp -= dmg;
                ModAPI.notify(`Провал взлома! Нейро-шок нанес ${dmg} урона.`, "system-message");
                if (typeof updateCharacterSheet === 'function') updateCharacterSheet();
                return `[СИСТЕМА ВЗЛОМА] Игрок провалил взлом (Бросок: ${roll}). Защитный лед нанес ${dmg} нейронного урона. Опиши искры из деки и боль в голове.`;
            }
        },
        `{ "command": "hackTerminal", "args": {} }\n// КАК ИСПОЛЬЗОВАТЬ (NEON ABYSS): Вызывай эту команду, когда игрок пытается взломать терминал, дверь, робота или сеть корпорации.`
    );

    // 4. CSS ИНЪЕКЦИЯ (Меняем визуал игры на Киберпанк)
    ModAPI.addStyle(`
        /* Киберпанк тема */
        body { 
            background: linear-gradient(135deg, #0f0c29, #302b63, #050505) !important; 
            background-size: 400% 400% !important;
        }
        .game-header { 
            border-bottom: 2px solid #00ffff !important; 
            box-shadow: 0 0 15px rgba(0, 255, 255, 0.4) !important; 
            background: rgba(10, 10, 20, 0.9) !important;
        }
        .game-header h1 { color: #ff00ff !important; text-shadow: 0 0 10px #ff00ff !important; font-family: 'Courier New', monospace !important; }
        .panel { 
            border: 1px solid #ff00ff !important; 
            box-shadow: inset 0 0 10px rgba(255, 0, 255, 0.1) !important; 
            background: rgba(5, 5, 15, 0.8) !important;
        }
        .panel h2 { color: #00ffff !important; border-bottom-color: #00ffff !important; }
        .bubble-gm { border-left: 3px solid #ff00ff !important; background: rgba(20, 10, 30, 0.9) !important; }
        .bubble-user { border-right: 3px solid #00ffff !important; background: rgba(10, 20, 30, 0.9) !important; }
        #stat-gold::after { content: ' 💳'; font-size: 0.8em; }
        .stat-line span[data-i18n="gameInterface.characterPanel.gold"] { color: #00ffff !important; }
    `);

    // 5. ДОБАВЛЕНИЕ КАСТОМНОГО UI (Шкала Токсичности) - Использование новой системы виджетов
    ModAPI.registerWidget('character-bottom', 'neon_toxicity_widget', `
        <div id="neon-toxicity-panel" style="margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.5); border: 1px solid #00ffff; border-radius: 5px;">
            <div style="color: #00ffff; font-size: 0.9em; font-weight: bold; margin-bottom: 5px;">☢️ Неоновая Токсичность</div>
            <div style="width: 100%; height: 10px; background: #111; border-radius: 5px; overflow: hidden;">
                <div id="neon-toxicity-bar" style="width: 0%; height: 100%; background: #ff00ff; transition: width 0.3s ease; box-shadow: 0 0 10px #ff00ff;"></div>
            </div>
        </div>
    `, (element) => {
        updateToxicityUI(); // Вызываем обновление полоски сразу после рендера
    });

    // 6. СИСТЕМА СОХРАНЕНИЙ И МЕХАНИКА ТОКСИЧНОСТИ
    let neonToxicity = 0;
    
    const updateToxicityUI = () => {
        const bar = document.getElementById('neon-toxicity-bar');
        if (bar) bar.style.width = `${Math.min(100, neonToxicity)}%`;
    };

    ModAPI.registerSaveData(
        'neon_abyss',
        () => { return { toxicity: neonToxicity }; },
        (data) => { 
            if (data) neonToxicity = data.toxicity || 0; 
            updateToxicityUI();
        }
    );

    // 7. ХУК НА КАЖДЫЙ ХОД (Monkey-patching функции advanceTime)
    // Мы не можем напрямую влезть в C++ ядро для этого, но можем пропатчить JS-обертку
    ModAPI.patchFunction(window, 'advanceTime', (originalFunc, pulses) => {
        originalFunc(pulses);
        
        // Наша кастомная логика после оригинальной
        if (pulses > 0) {
            neonToxicity += (pulses * 0.1);
            updateToxicityUI();
            
            if (neonToxicity > 80 && Math.random() < 0.1) {
                ModAPI.notify("КРИТИЧЕСКАЯ ТОКСИЧНОСТЬ! Ваши импланты сбоят.", "system-message");
                if (player) damagePlayerHP(5);
                if (typeof updateCharacterSheet === 'function') updateCharacterSheet();
            }
        }
    });

    // 8. ПЕРЕХВАТЧИК ОТВЕТОВ ИИ (Заменяем слова на лету)
    ModAPI.addResponseFilter((text) => {
        // Если ИИ по привычке пишет "золото" или "монеты", меняем на "кредиты"
        return text.replace(/золот(о|а|ые|ых)/gi, 'кредитов').replace(/монет(ы|ам|ами)/gi, 'чипов');
    });
});
