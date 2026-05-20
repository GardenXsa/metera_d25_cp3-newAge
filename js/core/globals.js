// --- Глобальные переменные ---
let settingsReturnScreen = 'main-menu'; // Экран для возврата из настроек



let narrators = [];
let currentNarratorIndex = 0;
let tempPlayer = null; // Для временного хранения персонажа
let preloadedWorldData = null;
let directoryHandle = null;
let lastFSAErrorTime = 0; // Для предотвращения спама alert'ами
const FSA_ERROR_COOLDOWN = 10000; // 10 секунд



let itemsReferenceData = null; // Will store the array of item objects
let gmFeedbackMessages = [];
let playerActionQueue = []; // <-- [НОВАЯ ПЕРЕМЕННАЯ] Будет хранить действия игрока
let currentApiAbortController = null;

window.cancelCurrentApiRequest = function() {
    if (currentApiAbortController) {
        currentApiAbortController.abort();
        currentApiAbortController = null;
        console.log("[Network] Запрос к ИИ принудительно прерван пользователем.");
    }
};
let turnRollMemory = {}; // Античит: запоминает броски в текущем ходу
let nextInternalItemId = 1;
let itemTooltipElement = null; // Для кастомных DnD тултипов
let nextInternalEntityId = 1;
let nextInternalSkillId = 1;
let nextInternalMapMarkerId = 1;
let draggedItemData = null;
let combatSystemRulesData = "Загрузка правил...";
let autoTesterPromptTemplate = "";
const BUILT_IN_KEY_STORAGE_FLAG = 'useBuiltInApiKey_v1';



// Проверяем, запущены ли мы в Electron
const hasElectronAPI = window.electronAPI && window.electronAPI.isElectron;

// Определяем доступность файловой системы (Electron ИЛИ Браузер)
let fsaApiAvailable = hasElectronAPI || (typeof window.showDirectoryPicker === 'function');

if (hasElectronAPI) {
    console.log("Режим Electron обнаружен. Используем нативные сохранения.");
}

// --- Утилиты для асинхронных сохранений (Streaming) ---
let autoSaveIntervalMs = (() => { const v = parseInt(localStorage.getItem('autoSaveInterval')); return (isNaN(v) || v < 60000) ? 300000 : v; })();
const yieldThread = () => new Promise(resolve => setTimeout(resolve, 0));

function updateLoadingText(text) {
    const loadingTextEl = document.getElementById('loading-text');
    if (loadingTextEl) loadingTextEl.textContent = text;
}

// --- T3: CORE REGISTRIES ---
const ItemRegistry = new Map();
const ContainerRegistry = new Map();

// Normalize container data from engine (engine sends 'item_ids', JS expects 'items')
// Does NOT mutate the original object — returns a new normalized copy.
function normalizeContainer(cont) {
    if (!cont) return cont;
    // Deep-clone to avoid mutating the source — including nested objects
    const c = { ...cont };
    // Ensure items array always exists (clone if present)
    if (!c.items && c.item_ids) c.items = [...c.item_ids];
    if (c.items) c.items = [...c.items]; // always clone to avoid shared reference
    if (!Array.isArray(c.items)) c.items = [];
    if (!c.item_ids) c.item_ids = [...c.items];
    else c.item_ids = [...c.item_ids]; // clone
    // Deep-clone nested objects to prevent cross-container mutation
    c.lock_data = c.lock_data ? JSON.parse(JSON.stringify(c.lock_data)) : { is_locked: false, difficulty: 10, trap: null };
    c.physical_props = c.physical_props ? JSON.parse(JSON.stringify(c.physical_props)) : {};
    c.custom_props = c.custom_props ? JSON.parse(JSON.stringify(c.custom_props)) : {};
    c.location = c.location ? JSON.parse(JSON.stringify(c.location)) : {};
    return c;
}

// Safe helper: get items array from container (never undefined)
function getContainerItems(container) {
    if (!container || !container.items) return [];
    return Array.isArray(container.items) ? container.items : [];
}

// Safe setter that normalizes container data
function setContainer(key, cont) {
    return ContainerRegistry.set(key, normalizeContainer(cont));
}

function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// --- Minimal EventBus (pub/sub) for centralized state mutations ---
// Replaces scattered direct mutations of global state (player, World, etc.)
// Usage:
//   EventBus.on('player:hpChanged', (data) => { ... });
//   EventBus.emit('player:hpChanged', { oldHp: 100, newHp: 80 });
//   const unsub = EventBus.on('world:tick', handler);
//   unsub(); // remove listener
const EventBus = {
    _listeners: {},
    on(event, callback) {
        if (!this._listeners[event]) this._listeners[event] = [];
        const entry = { callback, once: false };
        this._listeners[event].push(entry);
        return () => {
            const list = this._listeners[event];
            if (list) {
                const idx = list.indexOf(entry);
                if (idx !== -1) list.splice(idx, 1);
            }
        };
    },
    once(event, callback) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push({ callback, once: true });
    },
    emit(event, data) {
        const list = this._listeners[event];
        if (!list) return;
        for (let i = list.length - 1; i >= 0; i--) {
            try {
                list[i].callback(data);
            } catch (e) {
                console.error(`[EventBus] Error in handler for '${event}':`, e);
            }
            if (list[i] && list[i].once) {
                list.splice(i, 1);
            }
        }
    },
    off(event, callback) {
        const list = this._listeners[event];
        if (!list) return;
        this._listeners[event] = list.filter(entry => entry.callback !== callback);
    }
};
window.EventBus = EventBus;

// Флаг инициализации C++ ядра симуляции
window.isSimulatorInitialized = false;
