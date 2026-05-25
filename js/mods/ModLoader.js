/**
 * ModLoader.js (ModKit v2.0)
 * 
 * Универсальная система загрузки модификаций. Поддерживает выполнение 
 * кастомных скриптов (RimWorld-like) и декларативную загрузку данных через хуки.
 */

// Утилита для глубокого слияния объектов.
function mergeDeep(target, ...sources) {
    if (!sources.length) return target;
    const source = sources.shift();

    if (isObject(target) && isObject(source)) {
        for (const key in source) {
            if (isObject(source[key])) {
                if (!target[key]) Object.assign(target, { [key]: {} });
                mergeDeep(target[key], source[key]);
            } else {
                Object.assign(target, { [key]: source[key] });
            }
        }
    }
    return mergeDeep(target, ...sources);
}

function isObject(item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
}

window.ModAPI = {
    mods: {},
    hooks: {},
    customCommands: {},
    commandDocs: [],
    promptInjections: [],
    hotkeys: {},
    promptFilters: [],
    responseFilters: [],
    textFilters: [],
    saveHandlers: {},
    customTranslations: {},
    initialized: false,
    isTotalConversion: false,
    apiVersion: '2.0',

    _currentRegisteringModId: null,

    // --- Lifecycle tracking: stores originals for rollback (Issue #2) ---
    _originalFunctions: {},
    _injectedStyles: [],
    _injectedUI: [],

    // --- HTML sanitizer (Issue #5) ---
    _sanitizeHTML: function(html) {
        // Remove script tags
        html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        // Remove dangerous tags (iframe, object, embed, applet, base, form, meta, link)
        html = html.replace(/<(iframe|object|embed|applet|base|form|meta|link)\b[^>]*>/gi, '');
        // Remove on* event handlers
        html = html.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
        // Remove javascript: URLs
        html = html.replace(/href\s*=\s*["']javascript:/gi, 'href="');
        // Remove data: URLs in src attributes (can embed scripts)
        html = html.replace(/src\s*=\s*["']data:text\/html[^"']*["']/gi, 'src=""');
        return html;
    },

    // --- Mod metadata validation (Issue #6) ---
    _validateModMeta: function(modMeta) {
        const errors = [];
        if (!modMeta.id || typeof modMeta.id !== 'string') errors.push('Missing or invalid "id"');
        if (!modMeta.name || typeof modMeta.name !== 'string') errors.push('Missing or invalid "name"');
        if (!modMeta.version || typeof modMeta.version !== 'string') errors.push('Missing or invalid "version"');
        if (modMeta.id && !/^[a-z0-9_]+$/.test(modMeta.id)) errors.push('"id" must be lowercase alphanumeric + underscore only');
        if (modMeta.dependencies && !Array.isArray(modMeta.dependencies)) errors.push('"dependencies" must be an array');
        if (modMeta.scripts && !Array.isArray(modMeta.scripts)) errors.push('"scripts" must be an array');
        if (modMeta.total_conversion && typeof modMeta.total_conversion !== 'boolean') errors.push('"total_conversion" must be a boolean');
        return errors;
    },

    addCommand: function(commandName, handler, docs) {
        this.customCommands[commandName] = handler;
        if (docs) this.commandDocs.push(docs);
        console.log(`[ModAPI] Зарегистрирована кастомная ГМ команда: ${commandName}`);
    },

    // Issue #4: addPromptInjection with validation and length limit
    addPromptInjection: function(text) {
        if (typeof text !== 'string') {
            console.error('[ModAPI] addPromptInjection: аргумент должен быть строкой');
            return;
        }
        if (text.length > 2000) {
            console.warn('[ModAPI] addPromptInjection: текст обрезан до 2000 символов');
            text = text.substring(0, 2000);
        }
        this.promptInjections.push(text);
        console.log(`[ModAPI] Добавлена инъекция в системный промпт ИИ.`);
    },

    // Issue #10: Improved error message for patchFunction
    // Issue #2: Store original function for rollback
    patchFunction: function(obj, funcName, patchCallback) {
        if (!obj || typeof obj !== 'object' || typeof obj[funcName] !== 'function') {
            console.error(`[ModAPI] Ошибка патчинга: первый аргумент должен быть объектом с функцией ${funcName}. Получен тип: ${typeof obj}`);
            return;
        }
        const original = obj[funcName];
        // Store original for later rollback (Issue #2)
        this._originalFunctions[funcName] = original;
        obj[funcName] = function(...args) {
            return patchCallback(original.bind(this), ...args);
        };
        console.log(`[ModAPI] Функция ${funcName} успешно пропатчена (Monkey-patch).`);
    },

    // Issue #2: unpatchFunction - restore original function
    unpatchFunction: function(obj, funcName) {
        if (this._originalFunctions[funcName]) {
            obj[funcName] = this._originalFunctions[funcName];
            delete this._originalFunctions[funcName];
            console.log(`[ModAPI] Функция ${funcName} восстановлена из оригинала.`);
        } else {
            console.warn(`[ModAPI] unpatchFunction: оригинал для ${funcName} не найден.`);
        }
    },

    // Issue #5: addUI with HTML sanitization
    // Issue #2: Track injected UI elements
    addUI: function(htmlString, targetSelector = 'body') {
        const target = document.querySelector(targetSelector);
        if (target) {
            const sanitizedHTML = this._sanitizeHTML(htmlString);
            target.insertAdjacentHTML('beforeend', sanitizedHTML);
            // Track the last added element (Issue #2)
            const addedElement = target.lastElementChild;
            if (addedElement) {
                this._injectedUI.push({ element: addedElement, targetSelector });
            }
        } else {
            console.error(`[ModAPI] Селектор ${targetSelector} не найден для addUI.`);
        }
    },

    // Issue #12: addStyle accepts id parameter for tracking/removal
    // Issue #2: Track injected style elements
    addStyle: function(idOrCss, cssString) {
        let id, css;
        // Backward compatibility: if only one arg, treat as cssString with auto-generated id
        if (cssString === undefined) {
            id = `_mod_style_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            css = idOrCss;
        } else {
            id = idOrCss;
            css = cssString;
        }

        // Remove existing style with same id if any
        const existing = document.querySelector(`style[data-mod-style="${id}"]`);
        if (existing) existing.remove();

        const style = document.createElement('style');
        style.setAttribute('data-mod-style', id);
        style.textContent = css;
        document.head.appendChild(style);
        this._injectedStyles.push({ id, element: style });
    },

    // Issue #2: removeStyle by id
    removeStyle: function(id) {
        const existing = document.querySelector(`style[data-mod-style="${id}"]`);
        if (existing) existing.remove();
        this._injectedStyles = this._injectedStyles.filter(s => s.id !== id);
    },

    registerHotkey: function(keyCombo, callback) {
        this.hotkeys[keyCombo.toLowerCase()] = callback;
        console.log(`[ModAPI] Зарегистрирован хоткей: ${keyCombo}`);
    },

    // Issue #2: unregisterHotkey
    unregisterHotkey: function(keyCombo) {
        delete this.hotkeys[keyCombo.toLowerCase()];
        console.log(`[ModAPI] Удалён хоткей: ${keyCombo}`);
    },

    addPromptFilter: function(callback) {
        this.promptFilters.push(callback);
        console.log(`[ModAPI] Зарегистрирован фильтр промптов ИИ.`);
    },

    addResponseFilter: function(callback) {
        this.responseFilters.push(callback);
        console.log(`[ModAPI] Зарегистрирован фильтр ответов ИИ.`);
    },

    addTextFilter: function(callback) {
        this.textFilters.push(callback);
        console.log(`[ModAPI] Зарегистрирован глобальный текстовый фильтр.`);
    },

    // Issue #8: Log error instead of silently swallowing in applyTextFilters
    applyTextFilters: function(text) {
        if (!this.textFilters || this.textFilters.length === 0 || typeof text !== 'string') return text;
        let result = text;
        for (const filter of this.textFilters) {
            try { result = filter(result) || result; } catch(e) { console.error('[ModAPI] Ошибка в текстовом фильтре:', e); }
        }
        return result;
    },

    addTranslations: function(lang, translationsObj) {
        if (!this.customTranslations[lang]) this.customTranslations[lang] = {};
        this.mergeDeep(this.customTranslations[lang], translationsObj);
        console.log(`[ModAPI] Загружены кастомные переводы для языка: ${lang}`);
    },

    setString: function(lang, path, value) {
        if (!this.customTranslations[lang]) this.customTranslations[lang] = {};
        let current = this.customTranslations[lang];
        const keys = path.split('.');
        const lastKey = keys.pop();
        for (const key of keys) {
            if (!current[key]) current[key] = {};
            current = current[key];
        }
        current[lastKey] = value;
        console.log(`[ModAPI] Перезаписана строка локализации: ${lang} -> ${path}`);
    },

    registerSaveData: function(modId, onSaveCallback, onLoadCallback) {
        this.saveHandlers[modId] = { onSave: onSaveCallback, onLoad: onLoadCallback };
        console.log(`[ModAPI] Мод ${modId} зарегистрирован в системе сохранений.`);
    },

    // Issue #2: removeSaveHandler
    removeSaveHandler: function(modId) {
        delete this.saveHandlers[modId];
        console.log(`[ModAPI] Удалён обработчик сохранений для мода: ${modId}`);
    },

    sendRawToEngine: async function(command, args) {
        if (window.electronAPI && window.electronAPI.nexusSendRawCommand) {
            return await window.electronAPI.nexusSendRawCommand(command, args);
        }
        console.error("[ModAPI] Ошибка: IPC канал nexusSendRawCommand недоступен.");
        return null;
    },

    sendToEngine: async function(command, args) {
        if (window.electronAPI && window.electronAPI.nexusGmIntervention) {
            return await window.electronAPI.nexusGmIntervention({ command, args }, typeof player !== 'undefined' && player ? player.location : "");
        }
        return null;
    },

    notify: function(message, type = 'system-message') {
        if (typeof addLogMessage === 'function') {
            addLogMessage(`[MOD] ${message}`, type);
        }
    },

    // Issue #5: addSettingsTab with HTML sanitization
    addSettingsTab: function(tabId, tabTitle, htmlContent) {
        const tabsContainer = document.querySelector('.settings-tabs');
        const contentContainer = document.querySelector('.settings-content');
        if (!tabsContainer || !contentContainer) {
            console.error(`[ModAPI] Не удалось найти контейнеры настроек для вкладки ${tabId}`);
            return;
        }

        const btn = document.createElement('button');
        btn.className = 'settings-tab-btn';
        btn.dataset.tab = tabId;
        btn.textContent = tabTitle;

        const content = document.createElement('div');
        content.id = tabId;
        content.className = 'settings-tab-content';
        content.innerHTML = this._sanitizeHTML(htmlContent);

        btn.addEventListener('click', () => {
            document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            content.classList.add('active');
        });

        tabsContainer.appendChild(btn);
        contentContainer.insertBefore(content, contentContainer.lastElementChild);
        console.log(`[ModAPI] Добавлена вкладка настроек: ${tabTitle}`);
    },

    on: function(eventName, callback) {
        if (!this.hooks[eventName]) this.hooks[eventName] = [];
        if (callback && typeof callback === 'function' && this._currentRegisteringModId) {
            callback.__modId = this._currentRegisteringModId;
        }
        this.hooks[eventName].push(callback);
    },

    // Issue #2: unregisterHook
    unregisterHook: function(eventName, callback) {
        if (this.hooks[eventName]) {
            this.hooks[eventName] = this.hooks[eventName].filter(cb => cb !== callback);
        }
    },
    
    emit: async function(eventName, ...args) {
        if (this.hooks[eventName]) {
            for (const callback of this.hooks[eventName]) {
                try {
                    await callback(...args);
                } catch (e) {
                    const modId = callback && callback.__modId ? callback.__modId : 'unknown';
                    console.error(`[ModAPI] Ошибка в хуке ${eventName}${modId !== 'unknown' ? ` мода ${modId}` : ''}:`, e);
                    if (window.RuntimeLog) {
                        window.RuntimeLog.error('ModAPI', `Ошибка в хуке ${eventName}${modId !== 'unknown' ? ` мода ${modId}` : ''}`, e);
                    }
                    if (window.ModRuntimeGuard && modId !== 'unknown') {
                        await window.ModRuntimeGuard.disableBrokenMod(modId, `hook ${eventName} failed`, e);
                    }
                }
            }
        }
    },
    
    readFile: async function(modId, fileName) {
        const mod = this.mods[modId];
        if (!mod || !window.electronAPI) return null;
        // Use explicit channel instead of generic invoke
        const result = await window.electronAPI.modsReadFile({ modFolder: mod.folder, fileName });
        if (result.success) return result.content;
        return null;
    },
    
    // Issue #9: readJson wrapped in try/catch for invalid JSON
    readJson: async function(modId, fileName) {
        try {
            const content = await this.readFile(modId, fileName);
            return content ? JSON.parse(content) : null;
        } catch (e) {
            console.error(`[ModAPI] Ошибка чтения JSON ${fileName} из мода ${modId}:`, e);
            return null;
        }
    },

    // Issue #2: removeCommand
    removeCommand: function(commandName) {
        delete this.customCommands[commandName];
        this.commandDocs = this.commandDocs.filter(d => d.name !== commandName);
        console.log(`[ModAPI] Удалена кастомная ГМ команда: ${commandName}`);
    },

    // Issue #2: unloadMod - full cleanup for a specific mod
    unloadMod: function(modId) {
        const mod = this.mods[modId];
        if (!mod) {
            console.warn(`[ModAPI] unloadMod: мод ${modId} не найден.`);
            return;
        }

        // Remove injected styles for this mod
        // Styles registered with modId prefix pattern
        const modStylePrefix = `${modId}_`;
        this._injectedStyles = this._injectedStyles.filter(s => {
            if (s.id && s.id.startsWith(modStylePrefix)) {
                s.element.remove();
                return false;
            }
            return true;
        });

        // Remove injected UI elements for this mod
        this._injectedUI = this._injectedUI.filter(ui => {
            if (ui.element && ui.element.dataset && ui.element.dataset.modOwner === modId) {
                ui.element.remove();
                return false;
            }
            return true;
        });

        // Remove save handler
        this.removeSaveHandler(modId);

        // Remove custom commands registered by this mod
        if (mod._registeredCommands) {
            for (const cmd of mod._registeredCommands) {
                this.removeCommand(cmd);
            }
        }

        // Remove hotkeys registered by this mod
        if (mod._registeredHotkeys) {
            for (const hk of mod._registeredHotkeys) {
                this.unregisterHotkey(hk);
            }
        }

        // Remove from mods registry
        delete this.mods[modId];

        console.log(`[ModAPI] Мод ${modId} полностью выгружен.`);
    },
    
    mergeDeep: mergeDeep
};

// ============================================================================
// SANDBOX: with + Proxy pattern for true mod isolation (Issue #4 FULL)
// ============================================================================
//
// Architecture Overview:
//
//   +---------------------------------------------------+
//   |  Mod code runs inside:                            |
//   |    with(sandboxProxy) { <mod code> }              |
//   |                                                   |
//   |  Every identifier lookup goes through:            |
//   |    sandboxProxy.has() → always true               |
//   |    sandboxProxy.get() → 3-tier resolution:        |
//   |      1. Whitelisted safe globals → safe value     |
//   |      2. Blocked globals → undefined + warning     |
//   |      3. Game globals (window.X) → pass-through    |
//   |                                                   |
//   |  window = safeWindowProxy:                        |
//   |    window.player     → ✅ pass-through            |
//   |    window.t          → ✅ pass-through            |
//   |    window.fetch      → ❌ blocked + warning       |
//   |    window.electronAPI → ❌ blocked + warning       |
//   |                                                   |
//   |  document = hardenedDocProxy:                     |
//   |    document.createElement('div')    → ✅ allowed  |
//   |    document.createElement('script') → ❌ blocked  |
//   |    document.defaultView             → safeWindow  |
//   +---------------------------------------------------+
//

/**
 * Properties that are BLOCKED as bare identifiers in the sandbox.
 * When a mod writes `fetch` or `eval`, the Proxy intercepts it
 * and returns undefined + logs a warning.
 *
 * NOTE: 'window' is NOT here — we provide a safe window proxy instead.
 */
const SANDBOX_BLOCKED_GLOBALS = new Set([
    'top', 'parent', 'frames', 'contentWindow',
    'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
    'eval', 'Function', 'AsyncFunction', 'GeneratorFunction',
    'require', 'module', 'exports', '__dirname', '__filename',
    'process', 'Buffer',
    'electronAPI',
    'localStorage', 'sessionStorage', 'indexedDB', 'caches',
    'importScripts',
    'Navigator', 'Location', 'History',
    'SharedArrayBuffer', 'Atomics',
    'Proxy', 'Reflect', 'Symbol',
    'alert', 'confirm', 'prompt',
    'open', 'close', 'stop', 'print',
    'postMessage', 'onmessage',
    // Constructor chain escape prevention:
    // Without these, a mod can do: ({}).constructor.constructor('return fetch')()
    'constructor', '__proto__', 'prototype',
    // Global constructors that can be abused to escape sandbox:
    'Object', 'Array', 'String', 'Number', 'Boolean', 'RegExp', 'Date',
    'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Error',
    'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
    'Int8Array', 'Uint8Array', 'Float32Array', 'Float64Array',
    'ArrayBuffer', 'DataView',
]);

/**
 * Properties that are BLOCKED on the safe `window` proxy.
 * This is a superset of SANDBOX_BLOCKED_GLOBALS plus:
 * - `window` / `self` / `globalThis` (return the safe proxy, not the real window)
 * - `crypto` (use ModAPI.readFile for I/O)
 */
const WINDOW_BLOCKED_PROPS = new Set([
    ...SANDBOX_BLOCKED_GLOBALS,
    'window',    // window.window → return safe proxy (not real window)
    'self',      // window.self  → return safe proxy
    'globalThis',// window.globalThis → return safe proxy
    'crypto',
]);

/**
 * DOM element types that mods are NOT allowed to create via document.createElement.
 * These can load external resources or execute arbitrary code.
 */
const BLOCKED_CREATE_ELEMENTS = new Set([
    'script', 'iframe', 'object', 'embed', 'applet',
    'link',   // <link rel="import"> can load external resources
    'base',   // <base> can redirect all relative URLs
    'meta',   // <meta http-equiv> can do redirects
    'form',   // prevent form-based data exfiltration
]);

/**
 * Creates a safe `window` proxy for the mod sandbox.
 *
 * WHY: Existing mods use `window.player`, `window.t`, `window.updateCharacterSheet`, etc.
 * We can't simply block `window` — mods need game globals.
 * Instead, we proxy `window` and block only dangerous properties.
 *
 * SECURITY:
 * - window.fetch       → ❌ blocked
 * - window.eval        → ❌ blocked
 * - window.electronAPI → ❌ blocked
 * - window.player      → ✅ pass-through (game global)
 * - window.t           → ✅ pass-through (game global)
 * - window.window      → returns safe proxy (not real window)
 */
function createSafeWindowProxy(realWindow, modId, safeModAPI) {
    // We need a reference to the proxy itself for self-referencing properties.
    // This is set up after the proxy is created.
    let safeWindowProxy = null;

    const handler = {
        get(target, prop, receiver) {
            // window.window / window.self / window.globalThis → return safe proxy
            if (prop === 'window' || prop === 'self' || prop === 'globalThis') {
                return safeWindowProxy;
            }

            // Intercept ModAPI to return the safe wrapper
            if (prop === 'ModAPI' && safeModAPI) {
                return safeModAPI;
            }

            // Block dangerous properties
            if (WINDOW_BLOCKED_PROPS.has(prop)) {
                console.warn(`[ModLoader SANDBOX] Mod ${modId} tried to access window.${prop} — blocked`);
                return undefined;
            }

            // Allow all other window properties (game globals: player, t, World, etc.)
            return realWindow[prop];
        },

        set(target, prop, value) {
            // Block writing to dangerous properties
            if (WINDOW_BLOCKED_PROPS.has(prop)) {
                console.warn(`[ModLoader SANDBOX] Mod ${modId} tried to set window.${prop} — blocked`);
                return true;
            }
            // Prevent overwriting ModAPI
            if (prop === 'ModAPI') {
                console.warn(`[ModLoader SANDBOX] Mod ${modId} tried to overwrite window.ModAPI — blocked`);
                return true;
            }
            // Allow setting game globals (mods may set window.player, etc.)
            realWindow[prop] = value;
            return true;
        },

        has(target, prop) {
            // Return true for everything so `with()` doesn't fall through
            return true;
        },

        deleteProperty(target, prop) {
            if (WINDOW_BLOCKED_PROPS.has(prop)) {
                console.warn(`[ModLoader SANDBOX] Mod ${modId} tried to delete window.${prop} — blocked`);
                return false;
            }
            delete realWindow[prop];
            return true;
        }
    };

    safeWindowProxy = new Proxy(realWindow, handler);
    return safeWindowProxy;
}

/**
 * Creates a hardened document Proxy that:
 * 1. Blocks createElement for dangerous element types (script, iframe, etc.)
 * 2. Blocks innerHTML/outerHTML with <script> injection
 * 3. Blocks defaultView (prevents window access via document)
 * 4. Allows all other document operations
 */
function createDocumentProxy(doc, safeWindowProxy, modId) {
    return new Proxy(doc, {
        get(target, prop, receiver) {
            // Block document.defaultView (=== window)
            if (prop === 'defaultView') {
                console.warn(`[ModLoader SANDBOX] document.defaultView is redirected to safe window proxy for mod ${modId}`);
                return safeWindowProxy;
            }

            const value = Reflect.get(target, prop, receiver);

            // Intercept document.createElement
            if (prop === 'createElement' && typeof value === 'function') {
                return function(tagName, options) {
                    const tag = String(tagName).toLowerCase();
                    if (BLOCKED_CREATE_ELEMENTS.has(tag)) {
                        console.error(`[ModLoader SANDBOX] Blocked document.createElement('${tag}') — not allowed in mod sandbox`);
                        return target.createElement('div'); // inert element
                    }
                    return value.call(target, tagName, options);
                };
            }

            // Intercept document.createElementNS
            if (prop === 'createElementNS' && typeof value === 'function') {
                return function(namespace, tagName, options) {
                    const tag = String(tagName).toLowerCase();
                    if (BLOCKED_CREATE_ELEMENTS.has(tag)) {
                        console.error(`[ModLoader SANDBOX] Blocked document.createElementNS('${tag}') — not allowed in mod sandbox`);
                        return target.createElement('div');
                    }
                    return value.call(target, namespace, tagName, options);
                };
            }

            return value;
        },

        set(target, prop, value) {
            // Block innerHTML/outerHTML with <script> tags
            if (prop === 'innerHTML' || prop === 'outerHTML') {
                if (typeof value === 'string' && /<\s*script/i.test(value)) {
                    console.error(`[ModLoader SANDBOX] Blocked <script> injection via document.${prop}`);
                    return true;
                }
            }
            // Block setting on* event handler properties on document
            if (typeof prop === 'string' && prop.startsWith('on') && prop.length > 2) {
                console.error(`[ModLoader SANDBOX] Blocked document.${prop} event handler assignment`);
                return true;
            }
            target[prop] = value;
            return true;
        }
    });
}

/**
 * Creates a full sandbox environment for mod execution using the
 * `with(proxy) { ... }` pattern.
 *
 * How it works:
 * - The Proxy's `has` trap returns `true` for ALL property names,
 *   which prevents the JS engine from falling through to the real global
 *   scope via the `with` statement.
 * - The `get` trap implements a 3-tier access policy:
 *   1. Whitelisted safe globals → return the safe value
 *   2. Explicitly blocked globals → return undefined + warn
 *   3. Game globals (on window but not blocked) → pass through
 *      This allows mods to use `player`, `updateCharacterSheet`, etc.
 *      Both bare identifiers and `window.X` forms work.
 */
function createModSandbox(modAPI, modId, modMeta) {
    // --- Build the safe globals whitelist ---
    const safeGlobals = Object.create(null);

    // Safe ModAPI wrapper (immutable object, but methods can mutate the real ModAPI state)
    const safeModAPI = {};
    for (const key in modAPI) {
        if (typeof modAPI[key] === 'function') {
            safeModAPI[key] = modAPI[key].bind(modAPI);
        } else {
            Object.defineProperty(safeModAPI, key, {
                get: () => modAPI[key],
                set: (val) => { modAPI[key] = val; },
                enumerable: true
            });
        }
    }
    safeGlobals.ModAPI = Object.freeze(safeModAPI);

    // Safe window proxy (must create early — document proxy needs it)
    const safeWindow = createSafeWindowProxy(window, modId, safeGlobals.ModAPI);
    safeGlobals.window = safeWindow;

    // Safe console (with mod tag prefix for debugging)
    safeGlobals.console = Object.freeze({
        log: console.log.bind(console, `[Mod:${modId}]`),
        warn: console.warn.bind(console, `[Mod:${modId}]`),
        error: console.error.bind(console, `[Mod:${modId}]`),
        info: console.info.bind(console, `[Mod:${modId}]`)
    });

    // Hardened document proxy (blocks createElement('script'), defaultView, on* handlers)
    safeGlobals.document = createDocumentProxy(document, safeWindow, modId);

    // Safe built-in types
    safeGlobals.Array = Array;
    safeGlobals.Object = Object;
    safeGlobals.String = String;
    safeGlobals.Number = Number;
    safeGlobals.Boolean = Boolean;
    safeGlobals.Map = Map;
    safeGlobals.Set = Set;
    safeGlobals.Error = Error;
    safeGlobals.RegExp = RegExp;
    safeGlobals.Date = Date;
    safeGlobals.JSON = JSON;
    safeGlobals.Math = Math;
    safeGlobals.Promise = Promise;
    safeGlobals.Intl = Intl;
    safeGlobals.TextEncoder = TextEncoder;
    safeGlobals.TextDecoder = TextDecoder;

    // Safe utility functions
    safeGlobals.parseInt = parseInt;
    safeGlobals.parseFloat = parseFloat;
    safeGlobals.isNaN = isNaN;
    safeGlobals.isFinite = isFinite;
    safeGlobals.encodeURI = encodeURI;
    safeGlobals.decodeURI = decodeURI;
    safeGlobals.encodeURIComponent = encodeURIComponent;
    safeGlobals.decodeURIComponent = decodeURIComponent;
    safeGlobals.btoa = btoa;
    safeGlobals.atob = atob;

    // Constants
    safeGlobals.undefined = undefined;
    safeGlobals.NaN = NaN;
    safeGlobals.Infinity = Infinity;
    safeGlobals.true = true;
    safeGlobals.false = false;
    safeGlobals.null = null;

    // Performance
    safeGlobals.performance = performance;

    // Timers with flood protection (max 50 concurrent per mod)
    const _maxTimers = 50;
    let _activeTimers = 0;
    safeGlobals.setTimeout = function(fn, ms, ...args) {
        if (_activeTimers >= _maxTimers) {
            console.warn(`[ModLoader SANDBOX] Timer limit (${_maxTimers}) reached for mod ${modId}.`);
            return -1;
        }
        _activeTimers++;
        const id = setTimeout(() => { _activeTimers--; try { fn(...args); } catch(e) { console.error(`[Mod:${modId}] Timer callback error:`, e); } }, ms);
        return id;
    };
    safeGlobals.setInterval = function(fn, ms, ...args) {
        if (_activeTimers >= _maxTimers) {
            console.warn(`[ModLoader SANDBOX] Timer limit (${_maxTimers}) reached for mod ${modId}.`);
            return -1;
        }
        _activeTimers++;
        const id = setInterval(() => { try { fn(...args); } catch(e) { console.error(`[Mod:${modId}] Interval callback error:`, e); } }, ms);
        return id;
    };
    safeGlobals.clearTimeout = function(id) { if (id > 0) { clearTimeout(id); _activeTimers = Math.max(0, _activeTimers - 1); } };
    safeGlobals.clearInterval = function(id) { if (id > 0) { clearInterval(id); _activeTimers = Math.max(0, _activeTimers - 1); } };
    safeGlobals.requestAnimationFrame = function(fn) {
        return requestAnimationFrame(() => { try { fn(performance.now()); } catch(e) { console.error(`[Mod:${modId}] rAF callback error:`, e); } });
    };
    safeGlobals.cancelAnimationFrame = cancelAnimationFrame;

    // Mod identity (read-only)
    safeGlobals.modId = modId;
    safeGlobals.modMeta = modMeta;

    // --- Create the with-compatible Proxy ---
    const sandboxProxy = new Proxy(safeGlobals, {
        /**
         * The `has` trap is the KEY to the with+Proxy pattern.
         * By returning `true` for ALL property names, we prevent the JS engine
         * from ever falling through to the real global scope.
         * Even for blocked globals like `fetch`, we return `true`
         * so the engine doesn't find them in the outer scope.
         */
        has(target, prop) {
            return true;
        },

        /**
         * The `get` trap implements a 3-tier access policy:
         *
         * 1. Whitelisted safe globals (ModAPI, console, Math, etc.)
         *    → return the safe value
         *
         * 2. Explicitly blocked globals (fetch, eval, electronAPI, etc.)
         *    → return undefined + log warning
         *
         * 3. Game globals (player, t, updateCharacterSheet, etc.)
         *    These are properties on `window` that are NOT in the blocked list.
         *    → pass through from real window
         *    This allows mods to use both bare identifiers (`player`)
         *    and `window.player` forms.
         */
        get(target, prop) {
            // 1. If in our safe globals, return it
            if (prop in target) {
                return target[prop];
            }

            // 2. If explicitly blocked, return undefined + warn
            if (SANDBOX_BLOCKED_GLOBALS.has(prop)) {
                console.warn(`[ModLoader SANDBOX] Mod ${modId} tried to access blocked global "${prop}" — returned undefined`);
                return undefined;
            }

            // 3. Pass-through: check if it's a game global on window.
            //    Dangerous window properties are already filtered by step 2
            //    (fetch, eval, etc. are in both SANDBOX_BLOCKED_GLOBALS
            //     and WINDOW_BLOCKED_PROPS).
            //    This allows `player`, `t`, `World`, `updateCharacterSheet`,
            //    `damagePlayerHP`, etc. to work as bare identifiers.
            if (prop in window) {
                return window[prop];
            }

            // 4. Unknown property — return undefined
            return undefined;
        },

        /**
         * Control writes to the sandbox namespace:
         * - Block overwriting safe globals (ModAPI, console, etc.)
         * - Pass through writes to window for game globals
         * - Allow local variables (var/let/const inside with() block)
         */
        set(target, prop, value) {
            // Block overwriting our safe globals
            if (prop in target) {
                console.warn(`[ModLoader SANDBOX] Mod ${modId} tried to overwrite sandbox property "${prop}" — blocked`);
                return true;
            }
            // For game globals, pass through to window
            if (prop in window) {
                window[prop] = value;
                return true;
            }
            // Allow local variables in the with() scope
            target[prop] = value;
            return true;
        },

        /**
         * Prevent deletion of sandbox properties.
         */
        deleteProperty(target, prop) {
            if (prop in target) {
                console.warn(`[ModLoader SANDBOX] Mod ${modId} tried to delete sandbox property "${prop}" — blocked`);
                return false;
            }
            // Pass through to window for game globals
            if (prop in window) {
                delete window[prop];
                return true;
            }
            return true;
        }
    });

    return sandboxProxy;
}

/**
 * Executes mod code in a sandboxed environment using the with+Proxy pattern.
 *
 * The `with(sandboxProxy) { ... }` block redirects ALL identifier lookups
 * through the Proxy. Combined with the `has` trap returning `true` for
 * everything, this prevents mods from accessing the real global scope
 * through closures — they can only access what the Proxy allows.
 *
 * Key security properties:
 * - `window` → safe proxy (blocks fetch, eval, electronAPI, etc.)
 * - `document` → blocks createElement('script'), defaultView, on* handlers
 * - `ModAPI` → deep-frozen (immutable)
 * - Bare `fetch`, `eval`, `require` → return undefined + warning
 * - Game globals (player, t, updateCharacterSheet) → pass through from window
 *
 * NOTE: Strict mode disables `with`, so we do NOT use "use strict" at the
 * outermost scope. The sandbox Proxy provides equivalent protection.
 */
async function executeModInSandbox(code, modAPI, modId, modMeta) {
    const sandboxProxy = createModSandbox(modAPI, modId, modMeta);

    // Wrap mod code in with(sandboxProxy) to redirect ALL global lookups
    const wrappedCode = `
        with(this) {
            ${code}
        }
    `;

    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const modFunc = new AsyncFunction(wrappedCode);
    await modFunc.call(sandboxProxy);
}

class ModLoader {
    topologicalSort(adj) {
        const inDegree = new Map();
        const sorted = [];
        const queue = [];
        const nodes = Array.from(adj.keys());
        const reverseAdj = new Map(nodes.map(n => [n, []]));

        for (const node of nodes) inDegree.set(node, 0);

        for (const [node, dependencies] of adj.entries()) {
            for (const dep of dependencies) {
                if (inDegree.has(dep)) {
                    inDegree.set(node, inDegree.get(node) + 1);
                    if (reverseAdj.has(dep)) reverseAdj.get(dep).push(node);
                }
            }
        }

        for (const [node, degree] of inDegree.entries()) {
            if (degree === 0) queue.push(node);
        }
        
        while (queue.length > 0) {
            const node = queue.shift();
            sorted.push(node);
            const neighbors = reverseAdj.get(node) || [];
            for (const neighbor of neighbors) {
                inDegree.set(neighbor, inDegree.get(neighbor) - 1);
                if (inDegree.get(neighbor) === 0) queue.push(neighbor);
            }
        }

        if (sorted.length !== nodes.length) {
            const circular = nodes.filter(n => !sorted.includes(n));
            return { sorted: [], error: `Обнаружена циклическая зависимость! Проверьте моды: ${circular.join(', ')}` };
        }

        return { sorted, error: null };
    }

    _formatError(error) {
        if (!error) return '';
        if (error instanceof Error) return `${error.name}: ${error.message}\n${error.stack || ''}`;
        return String(error);
    }

    async _disableBrokenMod(modId, reason, detail = null) {
        if (window.ModRuntimeGuard && typeof window.ModRuntimeGuard.disableBrokenMod === 'function') {
            return await window.ModRuntimeGuard.disableBrokenMod(modId, reason, detail);
        }
        console.error(`[ModLoader] Мод ${modId} сломан и должен быть отключён: ${reason}`, detail || '');
        return false;
    }

    async _readModFileStrict(mod, fileName) {
        const modFolder = mod.folder || mod.id;
        if (!window.electronAPI || typeof window.electronAPI.modsReadFile !== 'function') {
            throw new Error('modsReadFile IPC is unavailable');
        }
        const result = await window.electronAPI.modsReadFile({ modFolder, fileName });
        if (!result || !result.success) {
            throw new Error(`missing mod file ${fileName}: ${result?.error || 'unknown error'}`);
        }
        return result.content;
    }

    _collectItemIds(itemsData) {
        if (!itemsData) return new Set();
        if (Array.isArray(itemsData)) {
            return new Set(itemsData.map(item => item && item.id).filter(Boolean));
        }
        if (typeof itemsData === 'object') {
            return new Set(Object.keys(itemsData));
        }
        return new Set();
    }

    async _validateDeclarativeModData(mod) {
        if (!mod.data || !isObject(mod.data)) return [];
        const errors = [];
        const parsedByFile = new Map();

        for (const [rawKey, fileList] of Object.entries(mod.data)) {
            if (!Array.isArray(fileList)) continue;
            for (const fileName of fileList) {
                try {
                    const content = await this._readModFileStrict(mod, fileName);
                    if (rawKey !== 'lore') {
                        parsedByFile.set(fileName, JSON.parse(content));
                    }
                } catch (error) {
                    errors.push(`${rawKey}:${fileName}: ${error.message}`);
                }
            }
        }

        const eras = [];
        for (const fileName of mod.data.eras || []) {
            const parsed = parsedByFile.get(fileName);
            if (Array.isArray(parsed)) eras.push(...parsed);
        }
        const locationFiles = new Set((mod.data.locations || []).map(fileName => fileName.replace(/^data\//, '')));
        for (const era of eras) {
            if (!era || !era.id) continue;
            if (!era.default_location_file) {
                errors.push(`eras:${era.id}: missing default_location_file`);
                continue;
            }
            if (!locationFiles.has(era.default_location_file)) {
                errors.push(`eras:${era.id}: default_location_file ${era.default_location_file} is not listed in mod.data.locations`);
            }
            try {
                const eraLocationPath = `data/${era.default_location_file}`;
                const content = await this._readModFileStrict(mod, eraLocationPath);
                JSON.parse(content);
            } catch (error) {
                errors.push(`eras:${era.id}: missing/invalid default location file ${era.default_location_file}: ${error.message}`);
            }
        }

        let mergedItems = {};
        for (const fileName of mod.data.items || []) {
            const parsed = parsedByFile.get(fileName);
            if (Array.isArray(parsed)) {
                parsed.forEach(item => { if (item && item.id) mergedItems[item.id] = item; });
            } else if (parsed && typeof parsed === 'object') {
                mergedItems = { ...mergedItems, ...parsed };
            }
        }
        const itemIds = this._collectItemIds(mergedItems);
        for (const fileName of mod.data.tag_defaults || []) {
            const tags = parsedByFile.get(fileName);
            if (!tags || typeof tags !== 'object') continue;
            for (const [key, value] of Object.entries(tags)) {
                const values = Array.isArray(value) ? value : [value];
                for (const itemId of values) {
                    if (typeof itemId === 'string' && itemId && !itemIds.has(itemId)) {
                        errors.push(`tag_defaults:${key} -> missing item id ${itemId}`);
                    }
                }
            }
        }

        
        const statKeys = ['str', 'dex', 'int', 'con', 'cha', 'res'];
        const isTotalConversionMod = !!(mod.total_conversion || mod.totalConversion || mod.mod_type === 'total_conversion');
        const classEntries = [];
        const raceEntries = [];

        const collectArrayData = (fileNames, out, label) => {
            for (const fileName of fileNames || []) {
                const parsed = parsedByFile.get(fileName);
                if (Array.isArray(parsed)) {
                    out.push(...parsed);
                } else if (parsed && typeof parsed === 'object') {
                    for (const [id, value] of Object.entries(parsed)) {
                        if (value && typeof value === 'object') out.push({ id: value.id || id, ...value });
                    }
                } else if (parsed !== undefined) {
                    errors.push(`${label}:${fileName}: expected array or object`);
                }
            }
        };

        const validateRequiredStats = (stats, label) => {
            if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
                errors.push(`${label} is missing or not an object`);
                return;
            }
            for (const key of statKeys) {
                if (!Number.isFinite(Number(stats[key]))) {
                    errors.push(`${label}.${key} is missing or not numeric`);
                }
            }
        };

        const validateOptionalStatObject = (stats, label) => {
            if (stats === undefined || stats === null) return;
            if (typeof stats !== 'object' || Array.isArray(stats)) {
                errors.push(`${label} must be an object when present`);
                return;
            }
            for (const [key, value] of Object.entries(stats)) {
                if (!statKeys.includes(key)) {
                    errors.push(`${label}.${key} is not a known character stat`);
                    continue;
                }
                if (!Number.isFinite(Number(value))) {
                    errors.push(`${label}.${key} is not numeric`);
                }
            }
        };

        collectArrayData(mod.data.classes, classEntries, 'classes');
        collectArrayData(mod.data.races, raceEntries, 'races');

        const classIds = new Set();
        for (const cls of classEntries) {
            if (!cls || typeof cls !== 'object') {
                errors.push('classes: class entry is not an object');
                continue;
            }
            if (!cls.id || typeof cls.id !== 'string') {
                errors.push('classes: class entry without string id');
                continue;
            }
            classIds.add(cls.id);
            validateRequiredStats(cls.base_stats, `classes:${cls.id}.base_stats`);
            validateOptionalStatObject(cls.stat_modifiers, `classes:${cls.id}.stat_modifiers`);

            if (cls.starting_items !== undefined) {
                if (!cls.starting_items || typeof cls.starting_items !== 'object' || Array.isArray(cls.starting_items)) {
                    errors.push(`classes:${cls.id}.starting_items must be an object { itemId: quantity } when present`);
                } else if (isTotalConversionMod) {
                    for (const itemId of Object.keys(cls.starting_items)) {
                        if (!itemIds.has(itemId)) {
                            errors.push(`classes:${cls.id}.starting_items -> missing item id ${itemId}`);
                        }
                    }
                }
            }
        }

        for (const race of raceEntries) {
            if (!race || typeof race !== 'object') {
                errors.push('races: race entry is not an object');
                continue;
            }
            if (!race.id || typeof race.id !== 'string') {
                errors.push('races: race entry without string id');
                continue;
            }
            validateOptionalStatObject(race.stat_modifiers || {}, `races:${race.id}.stat_modifiers`);

            if (race.class_stats !== undefined) {
                if (!race.class_stats || typeof race.class_stats !== 'object' || Array.isArray(race.class_stats)) {
                    errors.push(`races:${race.id}.class_stats must be an object when present`);
                    continue;
                }
                for (const [classId, stats] of Object.entries(race.class_stats)) {
                    if (classId !== 'default' && classIds.size > 0 && !classIds.has(classId)) {
                        errors.push(`races:${race.id}.class_stats references unknown class ${classId}`);
                    }
                    validateOptionalStatObject(stats, `races:${race.id}.class_stats.${classId}`);
                }
            }
        }

return errors;
    }


    async initMods(activeMods) {
        // Issue #6: Validate mod metadata before loading
        const validatedMods = [];
        for (const mod of activeMods) {
            const errors = window.ModAPI._validateModMeta(mod);
            if (errors.length > 0) {
                const message = `[ModLoader] Мод "${mod.id || 'UNKNOWN'}" не прошёл валидацию. Ошибки: ${errors.join('; ')}`;
                console.error(message);
                if (window.RuntimeLog) window.RuntimeLog.error('ModLoader', message, errors);
                await this._disableBrokenMod(mod.id || mod.folder || 'UNKNOWN', 'metadata validation failed', errors);
                continue;
            }
            // Issue #7: API versioning check - warn but don't block
            if (mod.apiVersion && mod.apiVersion !== window.ModAPI.apiVersion) {
                console.warn(`[ModLoader] Мод ${mod.id} использует apiVersion "${mod.apiVersion}", текущая версия "${window.ModAPI.apiVersion}". Возможна несовместимость.`);
            }
            validatedMods.push(mod);
        }
        activeMods = validatedMods;


        const preflightPassedMods = [];
        for (const mod of activeMods) {
            const dataErrors = await this._validateDeclarativeModData(mod);
            if (dataErrors.length > 0) {
                const message = `[ModLoader] Мод ${mod.id} отключён: ошибки declarative data preflight (${dataErrors.length}).`;
                console.error(message, dataErrors);
                if (window.RuntimeLog) window.RuntimeLog.error('ModLoader', message, dataErrors);
                await this._disableBrokenMod(mod.id, 'declarative data preflight failed', dataErrors);
                continue;
            }
            preflightPassedMods.push(mod);
        }
        activeMods = preflightPassedMods;

        // Issue #11: Topological sort for dependency ordering
        if (activeMods.length > 1) {
            const adj = new Map();
            const modIds = new Set(activeMods.map(m => m.id));
            for (const mod of activeMods) {
                const deps = (mod.dependencies || []).filter(d => modIds.has(d));
                adj.set(mod.id, deps);
            }
            const { sorted, error } = this.topologicalSort(adj);
            if (error) {
                console.error(`[ModLoader] ${error}`);
            } else {
                // Reorder activeMods based on topological sort
                const sortedMap = new Map(sorted.map((id, idx) => [id, idx]));
                activeMods.sort((a, b) => (sortedMap.get(a.id) ?? 0) - (sortedMap.get(b.id) ?? 0));
            }
        }

        console.log('[ModLoader] Порядок загрузки модов:', activeMods.map(m => m.id));

        // Issue #3: Check for multiple total_conversion mods
        const totalConversionMods = activeMods.filter(m => m.total_conversion === true);
        if (totalConversionMods.length > 1) {
            console.error(`[ModLoader] ОШИБКА: Обнаружено ${totalConversionMods.length} модов тотальной конверсии! Только один может быть активен.`);
            // Disable all but the first
            const kept = totalConversionMods[0];
            for (const m of totalConversionMods.slice(1)) {
                const message = `[ModLoader] Отключаю тотал-конверсию: ${m.id} (конфликтует с ${kept.id})`;
                console.error(message);
                if (window.RuntimeLog) window.RuntimeLog.error('ModLoader', message, { kept: kept.id, disabled: m.id });
                await this._disableBrokenMod(m.id, `total_conversion conflict with ${kept.id}`, { kept: kept.id, disabled: m.id });
                activeMods = activeMods.filter(a => a.id !== m.id);
            }
        }

        // Проверка на тотальную конверсию
        for (const mod of activeMods) {
            if (mod.total_conversion === true) {
                window.ModAPI.isTotalConversion = true;
                console.log(`[ModLoader] АКТИВИРОВАН РЕЖИМ ТОТАЛЬНОЙ КОНВЕРСИИ модом: ${mod.id}. Ванильные ресурсы отключены.`);
                break;
            }
        }


        for (const mod of activeMods) {
            const modId = mod.id;
            if (modId === 'base_game') continue;
            
            window.ModAPI.mods[modId] = mod;

            // 1. Выполнение кастомных скриптов мода (RimWorld-like Assemblies/Scripts)
            if (mod.scripts && Array.isArray(mod.scripts)) {
                for (const scriptPath of mod.scripts) {
                    try {
                        const code = await window.ModAPI.readFile(modId, scriptPath);
                        if (code) {
                            console.log(`[ModLoader] Выполнение скрипта: ${scriptPath} из мода ${modId}`);

                            // Issue #4 FULL: Execute mod in hardened with+Proxy sandbox.
                            // The with+Proxy pattern intercepts ALL identifier lookups,
                            // preventing mods from accessing window, fetch, eval, etc.
                            // even through closures. The Proxy's `has` trap returns true
                            // for all properties, so the JS engine never falls through
                            // to the real global scope.
                            const previousRegisteringModId = window.ModAPI._currentRegisteringModId;
                            window.ModAPI._currentRegisteringModId = modId;
                            try {
                                await executeModInSandbox(code, window.ModAPI, modId, mod);
                            } finally {
                                window.ModAPI._currentRegisteringModId = previousRegisteringModId;
                            }
                        } else {
                            console.log(`[ModLoader] Скрипт ${scriptPath} пропущен (не найден в папке data/ мода ${modId}). Это нормально, если мод содержит только JSON.`);
                        }
                    } catch (e) {
                        console.error(`[ModLoader] Ошибка выполнения скрипта ${scriptPath} в моде ${modId}:`, e);
                        if (window.RuntimeLog) window.RuntimeLog.error('ModLoader', `Ошибка выполнения скрипта ${scriptPath} в моде ${modId}`, e);
                        await this._disableBrokenMod(modId, `script ${scriptPath} failed`, e);
                        window.ModAPI.unloadMod(modId);
                    }
                }
            }

            // 2. Декларативная загрузка данных (опционально, если мод не использует скрипты)
            if (mod.data && isObject(mod.data)) {

                const previousRegisteringModId = window.ModAPI._currentRegisteringModId;
                window.ModAPI._currentRegisteringModId = modId;
                try {
                window.ModAPI.on('onDatabaseLoad', async (db) => {
                    const runtimeUtils = window.RuntimeDataUtils;
                    const runtimeManifest = db.runtime_manifest || {};

                    for (const [rawKey, fileList] of Object.entries(mod.data)) {
                        if (!Array.isArray(fileList) || rawKey === 'lore' || rawKey === 'locations') {
                            continue;
                        }

                        const targetKey = runtimeUtils && typeof runtimeUtils.resolveRuntimeDatabaseKey === 'function'
                            ? runtimeUtils.resolveRuntimeDatabaseKey(rawKey, runtimeManifest)
                            : rawKey;
                        const descriptor = runtimeUtils && typeof runtimeUtils.getRuntimeDatabaseDescriptor === 'function'
                            ? runtimeUtils.getRuntimeDatabaseDescriptor(rawKey, runtimeManifest)
                            : null;
                        const mergePolicy = descriptor && typeof descriptor.merge_policy === 'string'
                            ? descriptor.merge_policy
                            : 'deepMerge';

                        if (mod.total_conversion && descriptor && descriptor.replace_on_total_conversion === true && !mod._runtimeResetKeys?.includes(targetKey)) {
                            if (!mod._runtimeResetKeys) mod._runtimeResetKeys = [];
                            db[targetKey] = runtimeUtils && typeof runtimeUtils.createDefaultValue === 'function'
                                ? runtimeUtils.createDefaultValue(descriptor.default_type)
                                : (mergePolicy === 'deepMerge' ? {} : []);
                            mod._runtimeResetKeys.push(targetKey);
                        }

                        for (const file of fileList) {
                            const data = await window.ModAPI.readJson(modId, file);
                            if (data === null || data === undefined) continue;

                            if (db[targetKey] === undefined) {
                                const descriptorDefaultType = descriptor && typeof descriptor.default_type === 'string'
                                    ? descriptor.default_type
                                    : (Array.isArray(data) ? 'array' : 'object');
                                db[targetKey] = runtimeUtils && typeof runtimeUtils.createDefaultValue === 'function'
                                    ? runtimeUtils.createDefaultValue(descriptorDefaultType)
                                    : (Array.isArray(data) ? [] : {});
                            }

                            if (runtimeUtils && typeof runtimeUtils.mergeRuntimeValue === 'function') {
                                db[targetKey] = runtimeUtils.mergeRuntimeValue(db[targetKey], data, { mergePolicy });
                            } else if (isObject(data)) {
                                if (!db[targetKey] || typeof db[targetKey] !== 'object') db[targetKey] = {};
                                mergeDeep(db[targetKey], data);
                            } else if (Array.isArray(data)) {
                                db[targetKey] = (db[targetKey] || []).concat(data);
                            } else {
                                db[targetKey] = data;
                            }
                        }
                    }
                });

                window.ModAPI.on('onLoreLoad', async (hookData) => {
                    if (mod.data.lore) {
                        for (const file of mod.data.lore) {
                            const loreText = await window.ModAPI.readFile(modId, file);
                            if (loreText) hookData.lore += `\n\n=== ЛОР: ${mod.name} ===\n` + loreText;
                        }
                    }
                });

                window.ModAPI.on('onLocationsLoad', async (hookData) => {
                    if (mod.data.locations) {
                        for (const file of mod.data.locations) {
                            const locData = await window.ModAPI.readJson(modId, file);
                            if (locData) mergeDeep(hookData.locations, locData);
                        }
                    }
                });
                } finally {
                    window.ModAPI._currentRegisteringModId = previousRegisteringModId;
                }
            }
        }

        // Регистрация активных хуков в C++ ядре
        const activeHooks = Object.keys(window.ModAPI.hooks);
        if (window.electronAPI && window.electronAPI.nexusRegisterHooks) {
            console.log('[ModLoader] Регистрация хуков в ядре:', activeHooks);
            await window.electronAPI.nexusRegisterHooks(activeHooks);
        }

        await window.ModAPI.emit('onModsInitialized');
        return true;
    }

    async readJsonFile(filePath) {
        try {
            const response = await fetch(filePath);
            if (!response.ok) throw new Error(`Network response was not ok for ${filePath}`);
            return await response.json();
        } catch (e) {
            console.error(`Failed to read JSON file: ${filePath}`, e);
            throw e;
        }
    }
}
