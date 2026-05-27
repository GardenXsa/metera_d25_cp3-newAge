// --- DOM Elements ---
// IMPORTANT: All getElementById / querySelectorAll calls are deferred until the DOM is ready.
// Previously these ran at parse time, which caused null references when the script loaded
// before the DOM. Now they are wrapped in initDomElements() which auto-runs on
// DOMContentLoaded (or immediately if the DOM is already ready).
//
// FIX (Issue #41/#86): DOM elements are NO LONGER assigned to window.* globals.
// Access them through the `domElements` object: domElements.gameLog, domElements.userInput, etc.
// A deprecated backward-compatibility shim still assigns to window, but new code
// should use domElements directly.

let domElements = {};

function initDomElements() {
    domElements = {

        // НОВЫЕ ЭЛЕМЕНТЫ ДЛЯ СИСТЕМЫ НЕКСУС
        traitsList: document.getElementById('traits-list'),
        holdingsList: document.getElementById('holdings-list'),

        fsaSelectDirectoryButton: document.getElementById('fsa-select-directory-button'),
        fsaStatusElement: document.getElementById('fsa-status'),

        // Экран Выбора Рассказчика
        narratorSelectionScreen: document.getElementById('narrator-selection-screen'),
        narratorCard: document.getElementById('narrator-card'),
        narratorName: document.getElementById('narrator-name'),
        narratorDesc: document.getElementById('narrator-desc'),
        narratorPrevButton: document.getElementById('narrator-prev'),
        narratorNextButton: document.getElementById('narrator-next'),
        confirmNarratorButton: document.getElementById('confirm-narrator-button'),
        worldSetupScreen: document.getElementById('world-setup-screen'),
        worldYearsSlider: document.getElementById('world-years-slider'),
        worldYearsValue: document.getElementById('world-years-value'),
        worldAgentsSlider: document.getElementById('world-agents-slider'),
        worldAgentsValue: document.getElementById('world-agents-value'),
        confirmWorldSetupButton: document.getElementById('confirm-world-setup-button'),
        openLoadWorldModalBtn: document.getElementById('open-load-world-modal-btn'),
        closeLoadWorldModalBtn: document.getElementById('close-load-world-modal-btn'),
        worldSlotsContainer: document.getElementById('world-slots-container'),
        saveWorldModal: document.getElementById('save-world-modal'),
        saveWorldNameInput: document.getElementById('save-world-name-input'),
        saveWorldConfirmBtn: document.getElementById('save-world-confirm-btn'),
        saveWorldSkipBtn: document.getElementById('save-world-skip-btn'),
        loadWorldModal: document.getElementById('load-world-modal'),
        selectedWorldInfo: document.getElementById('selected-world-info'),

        // Элементы Загрузки (НОВОЕ)
        loadingOverlay: document.getElementById('loading-overlay'),
        loadingText: document.getElementById('loading-text'),

        // Меню и Экраны
        ttsVoiceSelectorGroup: document.getElementById('tts-voice-selector-group'),
        ttsVoiceSelect: document.getElementById('tts-voice-select'),
        calculationLog: document.getElementById('calculation-log'),
        gmNotesPanel: document.getElementById('gm-notes-panel'),
        gmNotesContent: document.getElementById('gm-notes-content'),
        screens: document.querySelectorAll('.menu-screen'),
        mainMenu: document.getElementById('main-menu'),
        settingsMenu: document.getElementById('settings-menu'),
        characterCreationScreen: document.getElementById('character-creation-screen'),
        loadGameScreen: document.getElementById('load-game-screen'),
        helpScreen: document.getElementById('help-screen'),
        gameInterface: document.getElementById('game-interface'),
        apiKeyStatus: document.getElementById('api-key-status'),
        backgroundContainer: document.getElementById('background-container'),
        languageSelect: document.getElementById('language-select'),

        // Кнопки Главного Меню
        newGameButton: document.getElementById('new-game-button'),
        loadGameButton: document.getElementById('load-game-button'),
        mainSettingsButton: document.getElementById('main-settings-button'),
        helpButton: document.getElementById('help-button'),
        communityButton: document.getElementById('community-button'),
        useUserKeyButton: document.getElementById('use-user-key-button'),
        useBuiltInKeyButton: document.getElementById('use-builtin-key-button'),

        // Настройки
        apiKeyInput: document.getElementById('api-key-input'),
        saveSettingsButton: document.getElementById('save-settings-button'),

        // Создание Персонажа
        charNameInput: document.getElementById('char-name-input'),
        charRaceSelect: document.getElementById('char-race-select'),
        charClassSelect: document.getElementById('char-class-select'),
        charEraSelect: document.getElementById('char-era-select'),
        charStartModeSelect: document.getElementById('char-start-mode-select'),
        eraDescriptionBox: document.getElementById('era-description-box'),
        charDescInput: document.getElementById('char-desc-input'),
        statDistributionSection: document.getElementById('stat-distribution'),
        creationStatPointsDisplay: document.getElementById('stat-points-available'),
        statButtons: document.querySelectorAll('.stat-button'),
        createStatDisplays: {
            str: document.getElementById('create-stat-str'),
            dex: document.getElementById('create-stat-dex'),
            int: document.getElementById('create-stat-int'),
            con: document.getElementById('create-stat-con'),
            cha: document.getElementById('create-stat-cha'),
            res: document.getElementById('create-stat-res'),
        },
        startGameButton: document.getElementById('start-game-button'),
        creationError: document.getElementById('creation-error'),

        // Загрузка Игры
        manualSaveSlotsList: document.getElementById('manual-save-slots'),
        autoSaveSlotsList: document.getElementById('auto-save-slots'),
        maxManualSavesDisplay: document.getElementById('max-manual-saves'),
        maxAutoSavesDisplay: document.getElementById('max-auto-saves'),

        // Кнопки Назад
        backButtons: document.querySelectorAll('.back-button'),

        // Игровой Интерфейс
        gameLog: document.getElementById('game-log'),
        userInput: document.getElementById('user-input'),
        sendButton: document.getElementById('send-button'),

        gameTitle: document.getElementById('game-title'),
        inGameMenuButton: document.getElementById('in-game-menu-button'),
        collapsiblePanels: document.querySelectorAll('.collapsible-panel'),

        // Элементы для отображения состояния игрока
        levelInfoDiv: document.getElementById('level-info'),
        characterSheetPanel: document.querySelector('.character-sheet'),
        charNameDisplay: document.getElementById('character-name'),
        charRaceDisplay: document.getElementById('character-race'),
        charClassDisplay: document.getElementById('character-class'),
        levelDisplay: document.getElementById('stat-level'),
        xpDisplay: document.getElementById('stat-xp'),
        xpNextDisplay: document.getElementById('stat-xp-next'),
        inGameStatPointsDisplay: document.getElementById('stat-points-available-display'),
        turnDisplay: document.getElementById('stat-turn'),
        hpDisplay: document.getElementById('stat-hp'),
        maxHpDisplay: document.getElementById('stat-max-hp'),
        manaDisplay: document.getElementById('stat-mana'),
        maxManaDisplay: document.getElementById('stat-max-mana'),
        strDisplay: document.getElementById('stat-str'),
        dexDisplay: document.getElementById('stat-dex'),
        intDisplay: document.getElementById('stat-int'),
        conDisplay: document.getElementById('stat-con'),
        chaDisplay: document.getElementById('stat-cha'),
        goldDisplay: document.getElementById('stat-gold'),
        reputationMarker: document.getElementById('reputation-marker'),
        reputationValueTextDisplay: document.getElementById('stat-reputation-value-text'),
        locationDisplay: document.getElementById('stat-location'),
        locationStatLine: document.getElementById('location-stat-line'),
        journeyContainer: document.getElementById('journey-container'),
        journeyDest: document.getElementById('journey-dest'),
        journeyProgressText: document.getElementById('journey-progress-text'),
        journeyProgressBar: document.getElementById('journey-progress-bar'),
        journeyLoading: document.getElementById('journey-loading'),
        journeyEventArea: document.getElementById('journey-event-area'),
        journeyEventText: document.getElementById('journey-event-text'),
        journeyEventActions: document.getElementById('journey-event-actions'),
        travelControls: document.getElementById('travel-controls'),
        travelFastForwardBtn: document.getElementById('travel-fast-forward-btn'),
        travelPauseBtn: document.getElementById('travel-pause-btn'),
        travelCancelBtn: document.getElementById('travel-cancel-btn'),
        journeyContinueBtn: document.getElementById('journey-continue-btn'),
        inventoryList: document.getElementById('inventory-list'),
        inventoryCount: document.getElementById('inventory-count'),
        inventoryCapacity: document.getElementById('inventory-capacity'),
        questList: document.getElementById('quest-list'),
        skillsList: document.getElementById('skills-list'),
        statusEffectsList: document.getElementById('status-effects-list'),
        statIncreaseButtons: document.querySelectorAll('.stat-increase-button'),
        reputationDisplayWrapper: document.querySelector('.reputation-display-wrapper'),
        reputationModal: document.getElementById('reputation-modal'),

        // Элементы Карты
        globalLocationsList: document.getElementById('global-locations-list'),
        customLocationsList: document.getElementById('custom-locations-list'),

        // Элементы окна ошибки ИИ
        aiErrorModal: document.getElementById('ai-error-modal'),
        aiErrorMessage: document.getElementById('ai-error-message'),
        aiErrorRetryBtn: document.getElementById('ai-error-retry-btn'),
        aiErrorCancelBtn: document.getElementById('ai-error-cancel-btn'),
        aiErrorDetailsToggle: document.getElementById('ai-error-details-toggle'),
        aiErrorDetailsContent: document.getElementById('ai-error-details-content'),

        // Элементы Панели Окружения (НОВОЕ)
        environmentList: document.getElementById('environment-list'),

        // Элементы Игрового Меню
        menuOverlay: document.getElementById('menu-overlay'),
        inGameMenu: document.getElementById('in-game-menu'),
        inGameSaveButton: document.getElementById('in-game-save-button'),
        inGameSettingsButton: document.getElementById('in-game-settings-button'),
        inGameExitButton: document.getElementById('in-game-exit-button'),
        closeInGameMenuButton: document.getElementById('close-in-game-menu-button'),
        settingsBackButton: document.getElementById('settings-back-button'),

        // Музыка
        audioPlayer: document.getElementById('background-music-player'),
        toggleMusicButton: document.getElementById('toggle-music-button'),

        // TTS (Text-to-Speech)
        toggleTTSButton: document.getElementById('toggle-tts-button'),
    };

    // Derived elements (depend on the primary elements above)
    domElements.toggleMusicIcon = domElements.toggleMusicButton?.querySelector('i');
    domElements.toggleTTSIcon = domElements.toggleTTSButton?.querySelector('i');

    // --- DEPRECATED: Backward compatibility shim ---
    // FIX (Issue #41/#86): Assigning DOM elements to window scope is deprecated.
    // New code should access elements via `domElements.<name>` instead of bare global variables.
    // This shim will be removed in a future version.
    console.warn('[Deprecated] window.<domElement> access is deprecated. Use domElements.<name> instead.');
    for (const [key, value] of Object.entries(domElements)) {
        window[key] = value;
    }

    // Special non-DOM globals that were previously in this file
    window.lastUserMessageForRetry = null;
    window.entityTooltip = null; // Будет создан динамически
}

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDomElements);
} else {
    initDomElements();
}

// Constant keys that don't reference DOM elements (kept at module scope)
const TTS_VOICE_STORAGE_KEY = 'textRpgTTSVoice_v1';
