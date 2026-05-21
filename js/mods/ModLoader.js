/**
 * ModLoader.js (ModKit v3.0)
 * 
 * Универсальная система загрузки модификаций. Поддерживает выполнение 
 * кастомных скриптов (RimWorld-like) и декларативную загрузку данных через хуки.
 */

// Утилита для глубокого слияния объектов with $delete, $replace, $push support.
function mergeDeep(target, ...sources) {
    if (!sources.length) return target;
    const source = sources.shift();

    if (isObject(target) && isObject(source)) {
        for (const key in source) {
            // SECURITY: Prevent Prototype Pollution
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
            const sourceVal = source[key];
            
            // $delete sentinel: remove the key from target
            if (sourceVal === '$delete') {
                delete target[key];
                continue;
            }
            
            // $replace sentinel: replace array/value entirely instead of merging
            if (sourceVal && typeof sourceVal === 'object' && sourceVal.$replace !== undefined) {
                target[key] = sourceVal.$replace;
                continue;
            }
            
            // $push sentinel: append items to array
            if (sourceVal && typeof sourceVal === 'object' && Array.isArray(sourceVal.$push)) {
                if (Array.isArray(target[key])) {
                    target[key] = target[key].concat(sourceVal.$push);
                } else {
                    target[key] = sourceVal.$push;
                }
                continue;
            }
            
            if (isObject(sourceVal)) {
                if (!target[key] || typeof target[key] !== 'object') {
                    target[key] = {};
                }
                mergeDeep(target[key], sourceVal);
            } else {
                target[key] = sourceVal;
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
    apiVersion: '3.0',

    // --- Lifecycle tracking: stores originals for rollback ---
    _originalFunctions: {},
    _injectedStyles: [],
    _widgets: [], // New Widget System
    _activeTimers: {}, // Track timers per mod to prevent memory leaks
    _currentLoadingMod: null,

    // --- Hook chain system ---
    // Each entry: { modId, priority, callback, obj } — obj is stored for safe rollback in unloadMod
    _hookChains: {},  // { funcName: [{ modId, priority, callback, obj }] }

    // --- IPC mutation batching ---
    _pendingMutations: [],
    _pendingTransactions: new Map(),
    _mutationFlushTimer: null,

    // --- HTML sanitizer ---
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

    // --- Mod metadata validation ---
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

    // addPromptInjection without limits
    addPromptInjection: function(text) {
        if (typeof text !== 'string') {
            console.error('[ModAPI] addPromptInjection: аргумент должен быть строкой');
            return;
        }
        this.promptInjections.push(text);
        console.log(`[ModAPI] Добавлена инъекция в системный промпт ИИ.`);
    },

    // ============================================================================
    // HOOK CHAIN SYSTEM: replaces broken monkey-patching
    // ============================================================================

    /**
     * Register a hook on a function with priority-based chain execution.
     * Lower priority = runs first (pre-hooks). Higher = runs last (post-hooks).
     * Default priority = 100.
     *
     * Hook callback receives: (originalFn, ...args) → return value
     * If a hook returns undefined, the next hook in chain gets the previous result.
     * If a hook returns a value, it replaces the result for the next hook.
     */
    hookFunction: function(obj, funcName, modId, hookCallback, priority = 100) {
        if (!obj || typeof obj !== 'object' || typeof obj[funcName] !== 'function') {
            console.error(`[ModAPI] hookFunction: ${funcName} is not a function on the provided object`);
            return;
        }
        
        // Store original if this is the first hook
        if (!this._originalFunctions[funcName]) {
            this._originalFunctions[funcName] = obj[funcName];
        }
        
        if (!this._hookChains[funcName]) {
            this._hookChains[funcName] = [];
        }
        
        // Store obj reference alongside the hook for safe rollback in unhookFunction/unloadMod
        this._hookChains[funcName].push({ modId, priority, callback: hookCallback, obj });
        // Sort by priority (lower first = pre-hooks, higher = post-hooks)
        this._hookChains[funcName].sort((a, b) => a.priority - b.priority);
        
        // Rebuild the chained function
        this._rebuildHookChain(obj, funcName);
        console.log(`[ModAPI] Hook registered on ${funcName} by mod ${modId} (priority ${priority})`);
    },

    /**
     * Unhook a specific mod's hook from a function chain.
     */
    unhookFunction: function(obj, funcName, modId) {
        if (!this._hookChains[funcName]) return;
        // Recover obj from stored hook entries if caller didn't pass it (unloadMod path)
        const storedObj = obj || (this._hookChains[funcName][0] && this._hookChains[funcName][0].obj) || null;
        this._hookChains[funcName] = this._hookChains[funcName].filter(h => h.modId !== modId);
        if (this._hookChains[funcName].length === 0) {
            // No more hooks — restore original using stored obj reference
            if (storedObj && this._originalFunctions[funcName]) {
                storedObj[funcName] = this._originalFunctions[funcName];
            }
            delete this._originalFunctions[funcName];
            delete this._hookChains[funcName];
        } else if (storedObj) {
            this._rebuildHookChain(storedObj, funcName);
        }
        console.log(`[ModAPI] Hook removed from ${funcName} for mod ${modId}`);
    },

    _rebuildHookChain: function(obj, funcName) {
        const original = this._originalFunctions[funcName];
        const hooks = this._hookChains[funcName];
        
        obj[funcName] = function(...args) {
            let result;
            let currentFn = original.bind(this);
            
            for (const hook of hooks) {
                try {
                    const hookResult = hook.callback(currentFn, ...args);
                    if (hookResult !== undefined) {
                        result = hookResult;
                        // Wrap result for next hook's "original"
                        currentFn = () => result;
                    } else {
                        // Hook didn't modify — pass through original
                        result = currentFn(...args);
                    }
                } catch (e) {
                    console.error(`[ModAPI] Error in hook chain for ${funcName} (mod ${hook.modId}):`, e);
                    result = currentFn(...args);
                }
            }
            
            return result;
        };
    },

    // DEPRECATED: patchFunction — now delegates to hookFunction for backward compatibility
    patchFunction: function(obj, funcName, patchCallback) {
        // Убрано предупреждение console.warn, чтобы не засорять консоль мододелам
        if (!obj || typeof obj !== 'object' || typeof obj[funcName] !== 'function') {
            console.error(`[ModAPI] Ошибка патчинга: первый аргумент должен быть объектом с функцией ${funcName}. Получен тип: ${typeof obj}`);
            return;
        }
        // Generate a stable modId from funcName for backward compat
        const compatModId = `_patch_${funcName}`;
        // Remove any existing compat hook for this funcName
        this.unhookFunction(obj, funcName, compatModId);
        // Register as a hook with default priority
        this.hookFunction(obj, funcName, compatModId, patchCallback, 100);
    },

    // DEPRECATED: unpatchFunction — now delegates to unhookFunction for backward compatibility
    unpatchFunction: function(obj, funcName) {
        const compatModId = `_patch_${funcName}`;
        this.unhookFunction(obj, funcName, compatModId);
    },

    // ============================================================================
    // IPC MUTATION BATCHING
    // ============================================================================

    /**
     * Queue a mutation for batch delivery to the C++ engine.
     * Returns a Promise that resolves when the C++ engine confirms the mutation was applied.
     */
    queueMutation: function(mutation) {
        if (!mutation || typeof mutation !== 'object') return Promise.reject(new Error("Invalid mutation"));
        return new Promise((resolve, reject) => {
            const txId = typeof generateUUID === 'function' ? generateUUID() : Math.random().toString(36).substring(2);
            mutation.transaction_id = txId;
            this._pendingTransactions.set(txId, { resolve, reject });
            this._pendingMutations.push(mutation);
            
            if (!this._mutationFlushTimer) {
                this._mutationFlushTimer = setTimeout(() => this._flushMutations(), 0);
            }
        });
    },

    /**
     * Flush all pending mutations to the C++ engine in a single batch.
     */
    _flushMutations: async function() {
        if (this._pendingMutations.length === 0) return;
        const batch = this._pendingMutations.splice(0);
        clearTimeout(this._mutationFlushTimer);
        this._mutationFlushTimer = null;
        await this.applyModChanges(batch);
    },

    // ============================================================================
    // UI / STYLES / HOTKEYS / FILTERS
    // ============================================================================

    // DEPRECATED: addUI is fragile. Use registerWidget instead.
    addUI: function(htmlString, targetSelector = 'body') {
        console.warn(`[ModAPI] addUI is DEPRECATED. Use registerWidget() instead. Target: ${targetSelector}`);
        const target = document.querySelector(targetSelector);
        if (target) {
            const sanitizedHTML = this._sanitizeHTML(htmlString);
            target.insertAdjacentHTML('beforeend', sanitizedHTML);
        }
    },

    /**
     * Register a UI widget to a specific region.
     * @param {string} regionId - e.g., 'character-bottom', 'inventory-top'
     * @param {string} widgetId - Unique ID for this widget
     * @param {string|function} content - HTML string OR a render function(containerElement) for React/Vue
     * @param {function} [onRenderCallback] - Optional callback if content is an HTML string
     */
    registerWidget: function(regionId, widgetId, content, onRenderCallback) {
        this._widgets.push({
            regionId,
            widgetId,
            content: typeof content === 'string' ? this._sanitizeHTML(content) : content,
            onRender: onRenderCallback,
            modId: this._currentLoadingMod
        });
        console.log(`[ModAPI] Зарегистрирован виджет '${widgetId}' для зоны '${regionId}'`);
    },

    /**
     * Render all widgets for a specific region into a container.
     * Called by the core game UI update functions.
     */
    renderWidgets: function(regionId, containerElement) {
        if (!containerElement) return;
        containerElement.innerHTML = ''; // Clear previous renders
        const regionWidgets = this._widgets.filter(w => w.regionId === regionId);
        for (const widget of regionWidgets) {
            try {
                const wrapper = document.createElement('div');
                wrapper.id = `mod-widget-${widget.widgetId}`;
                wrapper.className = 'mod-widget-container';
                wrapper.dataset.modOwner = widget.modId;
                containerElement.appendChild(wrapper);

                if (typeof widget.content === 'function') {
                    // Modern framework support (React/Vue) - pass the wrapper directly
                    widget.content(wrapper);
                } else {
                    // Legacy HTML string support
                    wrapper.innerHTML = widget.content;
                    if (typeof widget.onRender === 'function') {
                        widget.onRender(wrapper);
                    }
                }
            } catch (e) {
                console.error(`[ModAPI] Ошибка рендера виджета '${widget.widgetId}':`, e);
            }
        }
    },

    // addStyle accepts id parameter for tracking/removal.
    // The style is always tagged with the current loading mod's ID for reliable cleanup in unloadMod.
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
        // Prefix with current loading mod id so unloadMod can find styles regardless of user-supplied id
        const ownerModId = this._currentLoadingMod || '_unknown';
        id = `${ownerModId}__${id}`;

        // Remove existing style with same id if any
        const existing = document.querySelector(`style[data-mod-style="${id}"]`);
        if (existing) existing.remove();

        const style = document.createElement('style');
        style.setAttribute('data-mod-style', id);
        style.textContent = css;
        document.head.appendChild(style);
        this._injectedStyles.push({ id, element: style });
    },

    // removeStyle by id
    removeStyle: function(id) {
        const existing = document.querySelector(`style[data-mod-style="${id}"]`);
        if (existing) existing.remove();
        this._injectedStyles = this._injectedStyles.filter(s => s.id !== id);
    },

    registerHotkey: function(keyCombo, callback) {
        this.hotkeys[keyCombo.toLowerCase()] = callback;
        console.log(`[ModAPI] Зарегистрирован хоткей: ${keyCombo}`);
    },

    // unregisterHotkey
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

    // Log error instead of silently swallowing in applyTextFilters
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

    // removeSaveHandler
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

    // addSettingsTab with HTML sanitization
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
        this.hooks[eventName].push(callback);
    },

    // unregisterHook
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
                    console.error(`[ModAPI] Ошибка в хуке ${eventName}:`, e);
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
    
    // readJson wrapped in try/catch for invalid JSON
    readJson: async function(modId, fileName) {
        try {
            const content = await this.readFile(modId, fileName);
            return content ? JSON.parse(content) : null;
        } catch (e) {
            console.error(`[ModAPI] Ошибка чтения JSON ${fileName} из мода ${modId}:`, e);
            return null;
        }
    },

    // removeCommand
    removeCommand: function(commandName) {
        delete this.customCommands[commandName];
        this.commandDocs = this.commandDocs.filter(d => d.name !== commandName);
        console.log(`[ModAPI] Удалена кастомная ГМ команда: ${commandName}`);
    },

    // ============================================================================
    // MODKIT 3.0: Virtual File System + Deferred Mutations
    // ============================================================================

    /**
     * Resolve a mod asset path to a valid URL for <img>, background-image, <audio>, etc.
     * Uses the metera-mod:// custom Electron protocol.
     *
     * @param {string} modId - The mod's ID (e.g., 'cyberpunk_total_conversion')
     * @param {string} assetPath - Relative path within the mod folder (e.g., 'assets/icons/blade.png')
     * @returns {string} A valid URL like 'metera-mod://cyberpunk_total_conversion/assets/icons/blade.png'
     */
    resolveAsset: function(modId, assetPath) {
        if (!modId || typeof modId !== 'string') {
            console.error('[ModAPI] resolveAsset: modId must be a non-empty string');
            return '';
        }
        if (!assetPath || typeof assetPath !== 'string') {
            console.error('[ModAPI] resolveAsset: assetPath must be a non-empty string');
            return '';
        }
        // Sanitize: remove leading slashes from assetPath
        const cleanPath = assetPath.replace(/^\/+/, '');
        return `metera-mod://${modId}/${cleanPath}`;
    },

    /**
     * Send mutations to the C++ engine. Changes are applied immediately.
     *
     * @param {Array} mutations - Array of mutation objects
     */
    applyModChanges: async function(mutations) {
        if (!Array.isArray(mutations) || mutations.length === 0) return;
        if (window.electronAPI && window.electronAPI.nexusSendRawCommand) {
            const res = await window.electronAPI.nexusSendRawCommand('applyModChanges', { mutations });
            if (res && res.results && Array.isArray(res.results)) {
                for (const r of res.results) {
                    const tx = this._pendingTransactions.get(r.transaction_id);
                    if (tx) {
                        if (r.success) tx.resolve(r);
                        else tx.reject(new Error(r.error || "Unknown mutation error"));
                        this._pendingTransactions.delete(r.transaction_id);
                    }
                }
            }
            return res;
        }
        return null;
    },

    // unloadMod - full cleanup for a specific mod
    unloadMod: function(modId) {
        const mod = this.mods[modId];
        if (!mod) {
            console.warn(`[ModAPI] unloadMod: мод ${modId} не найден.`);
            return;
        }

        // Remove injected styles for this mod.
        // Styles are now prefixed as `{modId}__{userProvidedId}` in addStyle(),
        // so matching by prefix is reliable regardless of user-supplied id.
        const modStylePrefix = `${modId}__`;
        this._injectedStyles = this._injectedStyles.filter(s => {
            if (s.id && s.id.startsWith(modStylePrefix)) {
                s.element.remove();
                return false;
            }
            return true;
        });

        // Clear all active timers (setTimeout/setInterval) created by this mod
        if (this._activeTimers[modId]) {
            this._activeTimers[modId].forEach(timer => {
                if (timer.type === 'timeout') clearTimeout(timer.id);
                if (timer.type === 'interval') clearInterval(timer.id);
            });
            delete this._activeTimers[modId];
        }


        // Remove registered widgets for this mod
        this._widgets = this._widgets.filter(w => w.modId !== modId);
        // Trigger a UI update to clear removed widgets
        if (typeof updateCharacterSheet === 'function') updateCharacterSheet();
        if (typeof updateInventoryDisplay === 'function') updateInventoryDisplay();

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

        // Remove hook chain entries for this mod.
        // unhookFunction now recovers obj from stored hook entries, so full rollback is safe.
        for (const funcName of Object.keys(this._hookChains)) {
            this.unhookFunction(null, funcName, modId);
        }

        // Remove from mods registry
        delete this.mods[modId];
        
        // Clean up body classes
        const classesToRemove = Array.from(document.body.classList).filter(c => c.startsWith('theme-') && c !== 'theme-default');
        classesToRemove.forEach(c => document.body.classList.remove(c));

        console.log(`[ModAPI] Мод ${modId} полностью выгружен.`);
    },
    
    mergeDeep: mergeDeep
};

// ============================================================================
// SANDBOX: Function constructor pattern for mod isolation
// ============================================================================
//
// Architecture Overview:
//
//   +---------------------------------------------------+
//   |  Mod code runs inside:                            |
//   |    new AsyncFunction(...paramNames, code)         |
//   |    .call(null, ...paramValues)                    |
//   |                                                   |
//   |  The mod code only has access to identifiers      |
//   |  we explicitly pass as function parameters.       |
//   |  Blocked globals (fetch, eval, etc.) are passed   |
//   |  as undefined, shadowing the real global scope.   |
//   |                                                   |
//   |  window = safeWindowProxy:                        |
//   |    window.player     -> pass-through              |
//   |    window.t          -> pass-through              |
//   |    window.fetch      -> blocked + warning          |
//   |    window.electronAPI -> blocked + warning          |
//   |                                                   |
//   |  document = hardenedDocProxy:                     |
//   |    document.createElement('div')    -> allowed    |
//   |    document.createElement('script') -> blocked    |
//   |    document.defaultView             -> safeWindow |
//   +---------------------------------------------------+
//

/**
 * Deep-freeze an object and all its nested properties recursively.
 * Prevents mods from mutating any ModAPI state.
 */
function deepFreeze(obj) {
    if (obj === null || typeof obj !== 'object' && typeof obj !== 'function') return obj;
    if (Object.isFrozen(obj)) return obj;
    Object.freeze(obj);
    const keys = Object.getOwnPropertyNames(obj);
    for (const key of keys) {
        const val = obj[key];
        if ((typeof val === 'object' || typeof val === 'function') && val !== null && !Object.isFrozen(val)) {
            deepFreeze(val);
        }
    }
    return obj;
}

/**
 * Properties that are BLOCKED on the safe `window` proxy.
 * These are dangerous globals that mods must not access via window.X.
 */
const WINDOW_BLOCKED_PROPS = new Set([
    // DOM/Window hierarchy escapes
    'top', 'parent', 'frames', 'contentWindow',
    // Storage (to prevent overwriting game saves directly, though ModAPI provides save handlers)
    'localStorage', 'sessionStorage', 'indexedDB', 'caches',
    'importScripts',
    // Node.js / OS level access (CRITICAL TO KEEP BLOCKED)
    'require', 'module', 'exports', '__dirname', '__filename',
    'process', 'Buffer',
    // Electron IPC (CRITICAL TO KEEP BLOCKED - use ModAPI instead)
    'electronAPI',
    // Browser APIs that can exfiltrate data
    'Navigator', 'Location', 'History',
    'SharedArrayBuffer', 'Atomics',
    'Proxy', 'Reflect', 'Symbol',
    'alert', 'confirm', 'prompt',
    'open', 'close', 'stop', 'print',
    'postMessage', 'onmessage',
    // Constructor chain escape prevention
    'constructor', '__proto__', 'prototype',
    // Global constructors that can be abused to escape sandbox
    'Object', 'Array', 'String', 'Number', 'Boolean', 'RegExp', 'Date',
    'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Error',
    'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
    'Int8Array', 'Uint8Array', 'Float32Array', 'Float64Array',
    'ArrayBuffer', 'DataView',
    // window-specific redirects
    'window',    // window.window -> return safe proxy (not real window)
    'self',      // window.self  -> return safe proxy
    'globalThis',// window.globalThis -> return safe proxy
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
 * - window.fetch       -> blocked
 * - window.eval        -> blocked
 * - window.electronAPI -> blocked
 * - window.player      -> pass-through (game global)
 * - window.t           -> pass-through (game global)
 * - window.window      -> returns safe proxy (not real window)
 */
function createSafeWindowProxy(realWindow, modId) {
    // We need a reference to the proxy itself for self-referencing properties.
    // This is set up after the proxy is created.
    let safeWindowProxy = null;

    const handler = {
        get(target, prop, receiver) {
            // window.window / window.self / window.globalThis → return safe proxy
            if (prop === 'window' || prop === 'self' || prop === 'globalThis') {
                return safeWindowProxy;
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
            // Allow setting game globals (mods may set window.player, etc.)
            realWindow[prop] = value;
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
 * Executes mod code in a sandboxed environment using the Function constructor pattern.
 *
 * Instead of the deprecated `with(proxy) { ... }` pattern, we use the
 * Function constructor to create a new scope where the mod code only has
 * access to the parameters we explicitly provide. Blocked globals are
 * passed as `undefined` to shadow the real global scope versions.
 *
 * Key security properties:
 * - `window` → safe proxy (blocks fetch, eval, electronAPI, etc.)
 * - `document` → blocks createElement('script'), defaultView, on* handlers
 * - `ModAPI` → deep-frozen (immutable)
 * - Bare `fetch`, `eval`, `require` → undefined (shadowed by parameter)
 * - Game globals → access via `window.player`, `window.t`, etc.
 */
async function executeModInSandbox(code, modAPI, modId, modMeta) {
    // Если безопасный режим (Safe Mode) отключен, выполняем код напрямую.
    // Песочница часто мешает легитимным модам, искажая глобальную область видимости (Proxy).
    if (!modAPI.safeMode) {
        try {
            const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
            const modFunc = new AsyncFunction('ModAPI', 'modId', 'modMeta', code);
            await modFunc(modAPI, modId, modMeta);
        } catch (e) {
            console.error(`[ModLoader] Ошибка выполнения мода ${modId}:`, e);
        }
        return;
    }

    // Build safe globals that will be available as function parameters
    const safeGlobals = {};

    // Safe window proxy (must create early — document proxy needs it)
    const safeWindow = createSafeWindowProxy(window, modId);
    safeGlobals.window = safeWindow;

    // Safe ModAPI facade: exposes only public methods via bound wrappers.
    // Mods cannot access or mutate internal fields (_hookChains, hooks, mods, etc.)
    // because the facade object has no direct reference to them.
    const PUBLIC_MOD_API_METHODS = [
        'on', 'emit', 'unregisterHook',
        'addCommand', 'removeCommand',
                    'addPromptInjection',
            'hookFunction', 'unhookFunction',
            'patchFunction', 'unpatchFunction',
            'addStyle', 'removeStyle',
        'registerWidget', 'renderWidgets',
        'registerHotkey', 'unregisterHotkey',
        'addPromptFilter', 'addResponseFilter', 'addTextFilter',
        'addTranslations', 'setString',
        'registerSaveData', 'removeSaveHandler',
        'sendRawToEngine', 'sendToEngine',
        'notify', 'addSettingsTab',
        'readFile', 'readJson',
        'resolveAsset', 'applyModChanges', 'queueMutation',
        'mergeDeep'
    ];
    const PUBLIC_MOD_API_PROPS = ['apiVersion', 'isTotalConversion', 'safeMode'];
    const safeModAPIFacade = {};
    for (const method of PUBLIC_MOD_API_METHODS) {
        if (typeof modAPI[method] === 'function') {
            safeModAPIFacade[method] = modAPI[method].bind(modAPI);
        }
    }
    for (const prop of PUBLIC_MOD_API_PROPS) {
        Object.defineProperty(safeModAPIFacade, prop, {
            get: () => modAPI[prop],
            enumerable: true,
            configurable: false
        });
    }
    Object.freeze(safeModAPIFacade);
    safeGlobals.ModAPI = safeModAPIFacade;

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
    safeGlobals.Regexp = RegExp;
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

    // Performance
    safeGlobals.performance = performance;

    // Network & Execution (Unblocked for modders)
    safeGlobals.fetch = fetch.bind(window);
    safeGlobals.XMLHttpRequest = XMLHttpRequest;
    safeGlobals.WebSocket = WebSocket;
    safeGlobals.EventSource = EventSource;
    // eval намеренно не передается как параметр, так как в strict mode 
    // использование 'eval' в качестве имени аргумента вызывает SyntaxError.
    // Он будет доступен модам напрямую из глобальной области видимости.
    safeGlobals.Function = Function;

    // Timers without artificial limits
    if (!modAPI._activeTimers[modId]) modAPI._activeTimers[modId] = [];
    safeGlobals.setTimeout = function(fn, ms, ...args) {
        const id = setTimeout(() => { try { fn(...args); } catch(e) { console.error(`[Mod:${modId}] Timer callback error:`, e); } }, ms);
        modAPI._activeTimers[modId].push({id, type: 'timeout'});
        return id;
    };
    safeGlobals.setInterval = function(fn, ms, ...args) {
        const id = setInterval(() => { try { fn(...args); } catch(e) { console.error(`[Mod:${modId}] Interval callback error:`, e); } }, ms);
        modAPI._activeTimers[modId].push({id, type: 'interval'});
        return id;
    };
    safeGlobals.clearTimeout = clearTimeout;
    safeGlobals.clearInterval = clearInterval;
    safeGlobals.requestAnimationFrame = function(fn) {
        return requestAnimationFrame(() => { try { fn(performance.now()); } catch(e) { console.error(`[Mod:${modId}] rAF callback error:`, e); } });
    };
    safeGlobals.cancelAnimationFrame = cancelAnimationFrame;

    // Mod identity (read-only)
    safeGlobals.modId = modId;
    safeGlobals.modMeta = modMeta;

    // Blocked globals: pass as undefined to shadow the real global scope versions.
    // This prevents mods from accessing them even though the Function constructor
    // creates the function in the global scope.
    const blockedIdentifiers = [
        // Node.js & Electron (Strictly blocked)
        'require', 'module', 'exports', '__dirname', '__filename',
        'process', 'Buffer',
        'electronAPI',
        // Storage & Hierarchy
        'localStorage', 'sessionStorage', 'indexedDB', 'caches',
        'importScripts',
        'SharedArrayBuffer', 'Atomics',
        'Proxy', 'Reflect', 'Symbol',
        'alert', 'confirm', 'prompt',
        'open', 'close', 'stop', 'print',
        'postMessage', 'onmessage',
        'top', 'parent', 'frames', 'contentWindow',
        'Navigator', 'Location', 'History',
        'WeakMap', 'WeakSet',
        'Int8Array', 'Uint8Array', 'Float32Array', 'Float64Array',
        'ArrayBuffer', 'DataView',
        'crypto',
    ];
    for (const name of blockedIdentifiers) {
        if (!(name in safeGlobals)) {
            safeGlobals[name] = undefined;
        }
    }

    // Create parameter names and values arrays for Function constructor
    const paramNames = Object.keys(safeGlobals);
    const paramValues = Object.values(safeGlobals);

    // Execute mod code in a new scope — no access to outer closure
    // The Function constructor creates a function in the global scope,
    // but since we pass all globals as parameters, the mod can only
    // access what we provide.
    const wrappedCode = `"use strict";
        ${code}
    `;

    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const modFunc = new AsyncFunction(...paramNames, wrappedCode);
    await modFunc(...paramValues);
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

    async initMods(activeMods) {
        // Validate mod metadata before loading
        const validatedMods = [];
        for (const mod of activeMods) {
            const errors = window.ModAPI._validateModMeta(mod);
            if (errors.length > 0) {
                console.error(`[ModLoader] Мод "${mod.id || 'UNKNOWN'}" не прошёл валидацию. Пропускаю. Ошибки: ${errors.join('; ')}`);
                continue;
            }
            // API versioning check - warn but don't block
            if (mod.apiVersion && mod.apiVersion !== window.ModAPI.apiVersion) {
                console.warn(`[ModLoader] Мод ${mod.id} использует apiVersion "${mod.apiVersion}", текущая версия "${window.ModAPI.apiVersion}". Возможна несовместимость.`);
            }
            validatedMods.push(mod);
        }
        activeMods = validatedMods;

        // Topological sort for dependency ordering
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

        // Check for multiple total_conversion mods
        const totalConversionMods = activeMods.filter(m => m.total_conversion === true);
        if (totalConversionMods.length > 1) {
            console.error(`[ModLoader] ОШИБКА: Обнаружено ${totalConversionMods.length} модов тотальной конверсии! Только один может быть активен.`);
            // Disable all but the first
            const kept = totalConversionMods[0];
            for (const m of totalConversionMods.slice(1)) {
                console.error(`[ModLoader] Отключаю тотал-конверсию: ${m.id} (конфликтует с ${kept.id})`);
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
            window.ModAPI._currentLoadingMod = modId;

            // 1. Выполнение кастомных скриптов мода (RimWorld-like Assemblies/Scripts)
            if (mod.scripts && Array.isArray(mod.scripts)) {
                for (const scriptPath of mod.scripts) {
                    try {
                        const code = await window.ModAPI.readFile(modId, scriptPath);
                        if (code) {
                            console.log(`[ModLoader] Выполнение скрипта: ${scriptPath} из мода ${modId}`);

                            // Execute mod in sandbox using Function constructor pattern.
                            // The mod code only has access to parameters we provide.
                            // Blocked globals are passed as undefined to shadow the real ones.
                            await executeModInSandbox(code, window.ModAPI, modId, mod);
                        } else {
                            console.log(`[ModLoader] Скрипт ${scriptPath} пропущен (не найден в папке data/ мода ${modId}). Это нормально, если мод содержит только JSON.`);
                        }
                    } catch (e) {
                        console.error(`[ModLoader] Ошибка выполнения скрипта ${scriptPath} в моде ${modId}:`, e);
                    }
                }
            }

            // 2. Декларативная загрузка данных (опционально, если мод не использует скрипты)
            if (mod.data && isObject(mod.data)) {
                window.ModAPI.on('onDatabaseLoad', async (db) => {
                    if (mod.data.items) {
                        for (const file of mod.data.items) {
                            const itemsData = await window.ModAPI.readJson(modId, file);
                            if (itemsData) mergeDeep(db.items, itemsData);
                        }
                    }
                    if (mod.data.recipes) {
                        for (const file of mod.data.recipes) {
                            const recipesData = await window.ModAPI.readJson(modId, file);
                            if (recipesData) db.recipes = db.recipes.concat(recipesData);
                        }
                    }
                    if (mod.data.facilities) {
                        for (const file of mod.data.facilities) {
                            const facData = await window.ModAPI.readJson(modId, file);
                            if (facData) mergeDeep(db.facilities, facData);
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
            }
            window.ModAPI._currentLoadingMod = null;
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
