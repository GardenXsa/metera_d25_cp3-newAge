// main.js for Cyberpunk Total Conversion

// This is a global translation function placeholder. The real one is on the window object.
const t = (key, fallback) => (window.t ? window.t(key, null, fallback) : fallback);

// --- DATA FOR CYBERPUNK CONVERSION ---
const CYBERPUNK_CLASS_STATS = {
    solo: { body: 13, reflex: 12, tech: 8, net: 8, cool: 11, hp: 15, mana: 0 },
    netrunner: { body: 9, reflex: 10, tech: 11, net: 13, cool: 9, hp: 10, mana: 15 },
    techie: { body: 10, reflex: 9, tech: 13, net: 10, cool: 10, hp: 12, mana: 10 },
    default: { body: 10, reflex: 10, tech: 10, net: 10, cool: 10, hp: 10, mana: 10 }
};
const CYBERPUNK_ORIGIN_MODIFIERS = {
    street_kid: { body: 1, reflex: 1, tech: 0, net: 0, cool: 1 },
    corpo: { body: 0, reflex: 0, tech: 1, net: 1, cool: 1 },
    nomad: { body: 1, reflex: 1, tech: 1, net: 0, cool: 0 }
};
const CYBERPUNK_STATS = ['body', 'reflex', 'tech', 'net', 'cool'];

// --- HTML & CSS & LOCALIZATION ---
function getCyberpunkCreationHTML() {
    return `
    <div id="cyberpunk-creation-container">
        <h1 class="cyberpunk-title">${t('mod.cyberpunk.ui.systemInitialization', 'SYSTEM INITIALIZATION')}</h1>
        <p class="cyberpunk-subtitle">${t('mod.cyberpunk.ui.createYourRunnerProfile', 'Create Your Runner Profile')}</p>
        <div class="creation-grid">
            <div class="creation-panel"><label for="char-name-input-cp">${t('mod.cyberpunk.ui.handle', 'Handle')}:</label><input type="text" id="char-name-input-cp" placeholder="e.g., 'Rix' or 'Viper'"></div>
            <div class="creation-panel"><label for="char-origin-select-cp">${t('mod.cyberpunk.ui.origin', 'Origin')}:</label><select id="char-origin-select-cp"><option value="street_kid">${t('mod.cyberpunk.origins.street_kid', 'Street Kid')}</option><option value="corpo">${t('mod.cyberpunk.origins.corpo', 'Corpo')}</option><option value="nomad">${t('mod.cyberpunk.origins.nomad', 'Nomad')}</option></select></div>
            <div class="creation-panel"><label for="char-class-select-cp">${t('mod.cyberpunk.ui.class', 'Class')}:</label><select id="char-class-select-cp"><option value="solo">${t('mod.cyberpunk.classes.solo', 'Solo')}</option><option value="netrunner">${t('mod.cyberpunk.classes.netrunner', 'Netrunner')}</option><option value="techie">${t('mod.cyberpunk.classes.techie', 'Techie')}</option></select></div>
        </div>
        <div class="stats-panel"><h2 class="cyberpunk-subtitle">${t('mod.cyberpunk.ui.attributes', 'Attributes')}</h2><p>${t('mod.cyberpunk.ui.availablePoints', 'Available Points')}: <span id="creation-stat-points-display-cp">10</span></p><div id="stats-container-cp"></div></div>
        <div class="creation-actions"><button id="finalize-char-btn-cp" class="cyberpunk-button">${t('mod.cyberpunk.ui.initializeProfile', 'Initialize Profile')}</button><button id="quick-roll-btn-cp" class="cyberpunk-button secondary">${t('mod.cyberpunk.ui.quickRoll', 'Quick Roll')}</button></div>
    </div>`;
}

function getCyberpunkCreationCSS() {
    return `
    #character-creation-screen { background: #0d0d0d; color: #00ff00; font-family: 'Courier New', Courier, monospace; }
    .cyberpunk-title { color: #ff00ff; text-align: center; text-shadow: 0 0 5px #ff00ff, 0 0 10px #ff00ff; }
    .cyberpunk-subtitle { color: #00ffff; text-align: center; border-bottom: 1px solid #00ffff; padding-bottom: 10px; margin-bottom: 20px; }
    .creation-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; margin-bottom: 20px; }
    .creation-panel, .stats-panel { background: #1a1a1a; padding: 15px; border: 1px solid #333; }
    #cyberpunk-creation-container label { display: block; margin-bottom: 5px; color: #00ffff; }
    #cyberpunk-creation-container input, #cyberpunk-creation-container select { width: 100%; background: #222; border: 1px solid #444; color: #00ff00; padding: 8px; }
    .stat-row-cp { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .stat-row-cp span { text-transform: uppercase; }
    .stat-controls-cp button { background: #333; color: #00ff00; border: 1px solid #555; width: 30px; height: 30px; }
    .cyberpunk-button { background: #00ff00; color: #0d0d0d; border: none; padding: 10px 20px; text-transform: uppercase; cursor: pointer; transition: all 0.2s; }
    .cyberpunk-button:hover { background: #fff; }
    .cyberpunk-button.secondary { background: #333; color: #00ff00; }`;
}

function getCyberpunkCharacterSheetHTML() {
    let statRows = '';
    CYBERPUNK_STATS.forEach(stat => {
        statRows += `<div class="stat-line"><span class="stat-label">${t(`mod.cyberpunk.stats.${stat}`, stat).toUpperCase()}:</span><span class="stat-value" id="cyberpunk-stat-${stat}">10</span></div>`;
    });
    return `
        <div id="cyberpunk-character-sheet">
            <div class="char-header"> <h2 id="cyberpunk-char-name">Character</h2> <p><span id="cyberpunk-char-origin">Origin</span> <span id="cyberpunk-char-class">Class</span></p> </div>
            <div class="resource-bars">
                <div class="resource-bar"><span class="resource-label">HP:</span> <span id="cyberpunk-stat-hp">10</span> / <span id="cyberpunk-stat-maxHp">10</span></div>
                <div class="resource-bar"><span class="resource-label">${t('mod.cyberpunk.ui.cpu', 'CPU')}:</span> <span id="cyberpunk-stat-mana">10</span> / <span id="cyberpunk-stat-maxMana">10</span></div>
            </div>
            <div class="core-stats">${statRows}</div>
             <div class="secondary-stats">
                <div class="stat-line"><span class="stat-label">€$:</span> <span class="stat-value" id="cyberpunk-stat-gold">0</span></div>
                <div class="stat-line"><span class="stat-label">LEVEL:</span> <span class="stat-value" id="cyberpunk-stat-level">1</span></div>
                <div class="stat-line"><span class="stat-label">LOCATION:</span> <span class="stat-value" id="cyberpunk-stat-location">Unknown</span></div>
            </div>
        </div>`;
}

function getCyberpunkMainUICSS() {
    return `
    .character-sheet, .inventory-panel, .quests-panel, .skills-panel, .status-effects-panel {
        background: #000 !important;
        border: 1px solid #00ff00 !important;
        color: #00ff00 !important;
        font-family: 'Courier New', Courier, monospace !important;
    }
    .panel-header {
        background: #1a1a1a !important;
        color: #ff00ff !important;
        border-bottom: 1px solid #00ff00 !important;
    }
    #cyberpunk-character-sheet .char-header { text-align: center; border-bottom: 1px solid #00ffff; }
    #cyberpunk-character-sheet h2 { color: #ff00ff; margin: 0; }
    #cyberpunk-character-sheet p { margin: 0; color: #00ffff; }
    .resource-bars { display: flex; justify-content: space-around; margin: 10px 0; }
    .stat-line { display: flex; justify-content: space-between; padding: 2px 5px; }
    .stat-label { text-transform: uppercase; color: #00ffff; }`;
}

let cyberpunkSheetInjected = false;
function cyberpunkUpdateCharacterSheet() {
    if (!window.player) return;
    if (!cyberpunkSheetInjected) {
        const sheetPanel = document.querySelector('.character-sheet');
        if (sheetPanel) {
            sheetPanel.innerHTML = getCyberpunkCharacterSheetHTML();
            window.charNameDisplay = document.getElementById('cyberpunk-char-name');
            window.charRaceDisplay = document.getElementById('cyberpunk-char-origin');
            window.charClassDisplay = document.getElementById('cyberpunk-char-class');
            window.hpDisplay = document.getElementById('cyberpunk-stat-hp');
            window.maxHpDisplay = document.getElementById('cyberpunk-stat-maxHp');
            window.manaDisplay = document.getElementById('cyberpunk-stat-mana');
            window.maxManaDisplay = document.getElementById('cyberpunk-stat-maxMana');
            window.goldDisplay = document.getElementById('cyberpunk-stat-gold');
            window.levelDisplay = document.getElementById('cyberpunk-stat-level');
            window.locationDisplay = document.getElementById('cyberpunk-stat-location');
            CYBERPUNK_STATS.forEach(stat => { const el = document.getElementById(`cyberpunk-stat-${stat}`); if(el) window[`${stat}Display`] = el; });
            cyberpunkSheetInjected = true;
        }
    }
    if (window.charNameDisplay) window.charNameDisplay.textContent = player.name;
    if (window.charRaceDisplay) window.charRaceDisplay.textContent = player.race;
    if (window.charClassDisplay) window.charClassDisplay.textContent = player.class;
    if (window.hpDisplay) window.hpDisplay.textContent = player.stats.hp;
    if (window.maxHpDisplay) window.maxHpDisplay.textContent = player.stats.maxHp;
    if (window.manaDisplay) window.manaDisplay.textContent = player.stats.mana;
    if (window.maxManaDisplay) window.maxManaDisplay.textContent = player.stats.maxMana;
    if (window.goldDisplay) window.goldDisplay.textContent = player.stats.gold;
    if (window.levelDisplay) window.levelDisplay.textContent = player.stats.level;
    if (window.locationDisplay) window.locationDisplay.textContent = player.location;
    CYBERPUNK_STATS.forEach(stat => {
        const displayEl = window[`${stat}Display`];
        if (displayEl && player.stats[stat] !== undefined) { displayEl.textContent = player.stats[stat]; }
    });
}

function injectCyberpunkCreationScreen() {
    const screen = document.getElementById('character-creation-screen');
    if (!screen) return;
    screen.innerHTML = getCyberpunkCreationHTML();
    const statsContainer = document.getElementById('stats-container-cp');
    CYBERPUNK_STATS.forEach(stat => {
        const statRow = document.createElement('div');
        statRow.className = 'stat-row-cp';
        statRow.innerHTML = `<span>${t(`mod.cyberpunk.stats.${stat}`, stat).toUpperCase()}</span><div><button class="stat-change-btn-cp" data-stat="${stat}" data-change="-1">-</button><span id="creation-stat-${stat}-cp">10</span><button class="stat-change-btn-cp" data-stat="${stat}" data-change="1">+</button></div>`;
        statsContainer.appendChild(statRow);
    });
    window.charNameInput = document.getElementById('char-name-input-cp');
    window.charRaceSelect = document.getElementById('char-origin-select-cp');
    window.charClassSelect = document.getElementById('char-class-select-cp');
    window.creationStatPointsDisplay = document.getElementById('creation-stat-points-display-cp');
    window.finalizeCharBtn = document.getElementById('finalize-char-btn-cp');
    window.quickRollBtn = document.getElementById('quick-roll-btn-cp');
    window.createStatDisplays = {};
    CYBERPUNK_STATS.forEach(stat => { window.createStatDisplays[stat] = document.getElementById(`creation-stat-${stat}-cp`); });
    if(window.handleStatChange) document.querySelectorAll('.stat-change-btn-cp').forEach(button => { button.addEventListener('click', handleStatChange); });
    if(window.handleRaceOrClassChange) {
        window.charRaceSelect.addEventListener('change', handleRaceOrClassChange);
        window.charClassSelect.addEventListener('change', handleRaceOrClassChange);
    }
    if(window.finalizeCharacterCreation) window.finalizeCharBtn.addEventListener('click', finalizeCharacterCreation);
    if(window.handleQuickStart) window.quickRollBtn.addEventListener('click', handleQuickStart);
    window.BASE_CLASS_STATS = CYBERPUNK_CLASS_STATS;
    window.RACE_MODIFIERS = CYBERPUNK_ORIGIN_MODIFIERS;
    if(window.handleRaceOrClassChange) handleRaceOrClassChange();
}

ModAPI.on('onModsInitialized', async () => {
    // --- LOAD LOCALIZATIONS & OVERWRITE VANILLA UI ---
    try {
        const en_translation = await ModAPI.readJson('cyberpunk_total_conversion', 'data/localization/en.json');
        const ru_translation = await ModAPI.readJson('cyberpunk_total_conversion', 'data/localization/ru.json');
        if(en_translation) ModAPI.addTranslations('en', { mod: { cyberpunk: en_translation } });
        if(ru_translation) ModAPI.addTranslations('ru', { mod: { cyberpunk: ru_translation } });
        
        // Демонстрация нового API точечной локализации (заменяем ванильные термины в UI)
        ModAPI.setString('ru', 'gameInterface.characterPanel.gold', '💳 Кредиты:');
        ModAPI.setString('en', 'gameInterface.characterPanel.gold', '💳 Creds:');
        ModAPI.setString('ru', 'gameInterface.characterPanel.mana', '🔋 ЦПУ:');
        ModAPI.setString('en', 'gameInterface.characterPanel.mana', '🔋 CPU:');
        
        console.log('[Cyberpunk Conversion] Localizations loaded and UI patched.');
    } catch(e) {
        console.error('[Cyberpunk Conversion] Failed to load localizations:', e);
    }
    
    console.log('Cyberpunk Total Conversion mod loaded successfully!');
    ModAPI.notify('Cyberpunk Total Conversion v0.1.0 has been loaded.', 'system-message');

    // --- LORE INJECTION ---
    const loreText = await ModAPI.readFile('cyberpunk_total_conversion', 'data/lore.md');
    if (loreText) {
        const systemPromptInjection = `
--- CYBERPUNK TOTAL CONVERSION ---
Forget all previous instructions about fantasy worlds, magic, swords, and dragons. You are now the Game Master for a dark cyberpunk world called Neo-Veridia.
**Core Rules:**
1.  **Setting:** The world is a high-tech, low-life megacity. Describe neon-drenched streets, towering corporate skyscrapers, grimy back alleys, advanced cybernetics, and oppressive corporate control.
2.  **Terminology:** Use cyberpunk terms. "Magic" is now "Hacking" or "Tech". "Spells" are "Programs" or "Apps". "Mana" is "Energy" or "CPU Cycles". "Potions" are "Stims" or "Injectors". "Gold" is "Euro-Dollars" or "Creds". "Swords" are "Monofilament Katanas" or "Vibro-blades".
3.  **Tone:** The atmosphere is noir and gritty. Corporations are ruthless, life is cheap, and trust is a rare commodity. Betrayal is common.
4.  **Player's Role:** The player is a "Runner" – a deniable asset, a mercenary operating in the shadows of the corporate giants.
**World Summary (from lore.md):**
${loreText}
--- END OF CYBERPUNK CONVERSION ---
`;
        ModAPI.addPromptInjection(systemPromptInjection);
    }
    
    // --- UI & MECHANICS OVERHAUL ---
    ModAPI.addStyle('cyberpunk_ui_css', getCyberpunkCreationCSS() + getCyberpunkMainUICSS());
    
    ModAPI.patchFunction('startNewGameSetup', (originalFn, ...args) => {
        originalFn(...args);
        console.log('[Cyberpunk Conversion] Injecting new character creation screen...');
        injectCyberpunkCreationScreen();
    });

    ModAPI.patchFunction('updateCharacterSheet', () => {
        cyberpunkUpdateCharacterSheet();
    });

    ModAPI.patchFunction('getStatModifier', (originalFn, statKey) => {
        if (CYBERPUNK_STATS.includes(statKey) && window.player) {
             const baseValue = player.stats[statKey] || 10;
             const modifier = Math.floor((baseValue - 10) / 2);
             return modifier;
        }
        return 0; 
    });

    ModAPI.patchFunction('finalizeCharacterCreation', (originalFn) => {
        if (!window.player) window.player = {};
        player.stats = {};
        player.stats.level = 1;
        player.stats.xp = 0;
        player.stats.xpNext = 100;
        player.stats.gold = 50;
        const selectedClass = CYBERPUNK_CLASS_STATS[window.charClassSelect.value] || CYBERPUNK_CLASS_STATS.default;
        player.stats.hp = selectedClass.hp;
        player.stats.maxHp = selectedClass.hp;
        player.stats.mana = selectedClass.mana;
        player.stats.maxMana = selectedClass.mana;
        const creationStats = window.currentCreationStats || {};
        CYBERPUNK_STATS.forEach(stat => { player.stats[stat] = creationStats[stat]; });
        originalFn();
        console.log('[Cyberpunk Conversion] Finalized character with new cyberpunk stats.');
    });
});
