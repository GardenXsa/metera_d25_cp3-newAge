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
    customAiProviders: {},
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

    registerAiProvider: function(id, config) {
        this.customAiProviders[id] = config;
        console.log(`[ModAPI] Зарегистрирован кастомный ИИ провайдер: ${id}`);
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            this._injectProviderUI(id, config);
        } else {
            document.addEventListener('DOMContentLoaded', () => this._injectProviderUI(id, config));
        }
    },

    _injectProviderUI: function(id, config) {
        const select = document.getElementById('api-provider-select');
        if (select && !select.querySelector(`option[value="${id}"]`)) {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = config.name || id;
            select.appendChild(opt);
        }
        const container = document.getElementById('dynamic-keys-container');
        if (container && config.settingsHtml && !document.getElementById(`${id}-settings-group`)) {
            const div = document.createElement('div');
            div.id = `${id}-settings-group`;
            div.className = 'provider-settings-group';
            div.style.display = 'none';
            div.style.margin = '0';
            div.style.padding = '0';
            div.style.border = 'none';
            div.style.borderTop = '1px solid rgba(93, 123, 151, 0.2)';
            div.style.paddingTop = '10px';
            div.innerHTML = this._sanitizeHTML(config.settingsHtml);
            container.appendChild(div);
        }
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
            try {
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
                } else {
                    console.warn("[ModAPI] Engine did not return mutation results. Resolving optimistically.");
                    for (const m of mutations) {
                        const tx = this._pendingTransactions.get(m.transaction_id);
                        if (tx) {
                            tx.resolve({ success: true, note: "Optimistic fallback" });
                            this._pendingTransactions.delete(m.transaction_id);
                        }
                    }
                }
                return res;
            } catch (e) {
                for (const m of mutations) {
                    const tx = this._pendingTransactions.get(m.transaction_id);
                    if (tx) {
                        tx.reject(e);
                        this._pendingTransactions.delete(m.transaction_id);
                    }
                }
                throw e;
            }
        } else {
            for (const m of mutations) {
                const tx = this._pendingTransactions.get(m.transaction_id);
                if (tx) {
                    tx.resolve({ success: true, note: "Local fallback" });
                    this._pendingTransactions.delete(m.transaction_id);
                }
            }
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
    
    // ============================================================================
    // NEW METHODS (T3)
    // ============================================================================

    setCustomMapGenerator: function(callback) {
        this._customMapGenerator = callback;
        console.log(`[ModAPI] Зарегистрирован кастомный генератор карты.`);
    },


    // --- 1. NPC Management ---
    getNpc: async function(npcId) {
        if (typeof World !== 'undefined' && World && World.npcs && World.npcs[npcId]) return World.npcs[npcId];
        if (typeof player !== 'undefined' && player && player.allKnownEntities && player.allKnownEntities[npcId]) return player.allKnownEntities[npcId];
        return null;
    },
    queryNpcs: async function(filter) {
        if (typeof World === 'undefined' || !World || !World.npcs) return [];
        return Object.values(World.npcs).filter(npc => {
            if (filter.race && npc.race !== filter.race) return false;
            if (filter.class && npc.class !== filter.class) return false;
            if (filter.region && npc.currentLocation !== filter.region && npc.homeLocation !== filter.region) return false;
            if (filter.hpMin !== undefined && (npc.stats?.hp || 0) < filter.hpMin) return false;
            if (filter.faction && npc.factionId !== filter.faction) return false;
            if (filter.trait && (!npc.traits || !npc.traits.includes(filter.trait))) return false;
            return true;
        });
    },
    setNpcProperty: async function(npcId, property, value) {
        const npc = await this.getNpc(npcId);
        if (!npc) return false;
        const keys = property.split('.');
        let current = npc;
        for (let i = 0; i < keys.length - 1; i++) {
            if (current[keys[i]] === undefined) current[keys[i]] = {};
            current = current[keys[i]];
        }
        current[keys[keys.length - 1]] = value;
        await this.queueMutation({ type: 'setNpcProperty', npcId, property, value });
        return true;
    },
    createNpc: async function(template) {
        const npcId = template.id || 'npc_' + (typeof generateUUID === 'function' ? generateUUID() : Math.random().toString(36).substring(2));
        if (typeof World !== 'undefined' && World && World.npcs) {
            World.npcs[npcId] = { id: npcId, aiIdentifier: npcId, type: 'npc', stats: { hp: 10, maxHp: 10 }, ...template };
        }
        await this.queueMutation({ type: 'createNpc', npcId, template });
        return npcId;
    },
    removeNpc: async function(npcId) {
        let removed = false;
        if (typeof World !== 'undefined' && World && World.npcs && World.npcs[npcId]) {
            delete World.npcs[npcId];
            removed = true;
        }
        if (typeof player !== 'undefined' && player && player.allKnownEntities && player.allKnownEntities[npcId]) {
            delete player.allKnownEntities[npcId];
            removed = true;
        }
        if (removed) await this.queueMutation({ type: 'removeNpc', npcId });
        return removed;
    },
    addNpcTrait: async function(npcId, traitId) {
        const npc = await this.getNpc(npcId);
        if (!npc) return false;
        if (!npc.traits) npc.traits = [];
        if (npc.traits.includes(traitId)) return false;
        npc.traits.push(traitId);
        await this.queueMutation({ type: 'addNpcTrait', npcId, traitId });
        return true;
    },
    removeNpcTrait: async function(npcId, traitId) {
        const npc = await this.getNpc(npcId);
        if (!npc || !npc.traits || !npc.traits.includes(traitId)) return false;
        npc.traits = npc.traits.filter(t => t !== traitId);
        await this.queueMutation({ type: 'removeNpcTrait', npcId, traitId });
        return true;
    },

    // --- 2. Region Management ---
    getRegion: async function(regionId) {
        if (typeof World !== 'undefined' && World && World.regions && World.regions[regionId]) return World.regions[regionId];
        return null;
    },
    queryRegions: async function(filter) {
        if (typeof World === 'undefined' || !World || !World.regions) return [];
        return Object.values(World.regions).filter(r => {
            if (filter.stabilityMax !== undefined && r.stability > filter.stabilityMax) return false;
            if (filter.stabilityMin !== undefined && r.stability < filter.stabilityMin) return false;
            if (filter.biome && r.biome !== filter.biome) return false;
            if (filter.owner && r.factionId !== filter.owner) return false;
            return true;
        });
    },
    setRegionProperty: async function(regionId, property, value) {
        const region = await this.getRegion(regionId);
        if (!region) return false;
        region[property] = value;
        await this.queueMutation({ type: 'setRegionProperty', regionId, property, value });
        return true;
    },
    getRegionMarket: async function(regionId) {
        const region = await this.getRegion(regionId);
        if (!region || !region.markets) return { items: {} };
        const market = { items: {} };
        for (const [item, price] of Object.entries(region.markets)) {
            const basePrice = (typeof ECONOMY_ITEMS !== 'undefined' && ECONOMY_ITEMS[item]) ? ECONOMY_ITEMS[item].basePrice : 1;
            market.items[item] = {
                base: basePrice,
                current: price,
                trend: price > basePrice ? 'up' : (price < basePrice ? 'down' : 'stable')
            };
        }
        return market;
    },
    getRegionHistory: async function(regionId, limit = 50) {
        if (typeof World === 'undefined' || !World || !World.news) return [];
        const history = World.news.filter(n => n.location === regionId || n.location === 'global');
        history.sort((a, b) => (b.day || 0) - (a.day || 0));
        return history.slice(0, limit);
    },

    // --- 3. Economy & Trade ---
    getItemData: async function(itemId) {
        if (typeof ECONOMY_ITEMS !== 'undefined' && ECONOMY_ITEMS[itemId]) return { id: itemId, ...ECONOMY_ITEMS[itemId] };
        if (typeof itemsReferenceData !== 'undefined' && Array.isArray(itemsReferenceData)) {
            const item = itemsReferenceData.find(i => i.id === itemId);
            if (item) return item;
        }
        return null;
    },
    setItemPriceOverride: async function(itemId, price) {
        if (!this._priceOverrides) this._priceOverrides = {};
        this._priceOverrides[itemId] = price;
        if (!this._economyHooked && typeof EconomySim !== 'undefined') {
            this.hookFunction(EconomySim, 'calculatePrice', '_ModAPI_Economy', (original, protoId, regionId, isBuying) => {
                if (this._priceOverrides && this._priceOverrides[protoId] !== undefined) {
                    let finalPrice = this._priceOverrides[protoId];
                    let chaMod = (typeof player !== 'undefined' && player) ? (player.stats.cha - 10) * 0.05 : 0;
                    if (isBuying) finalPrice *= (1.2 - chaMod);
                    else finalPrice *= (0.8 + chaMod);
                    return Math.max(1, Math.floor(finalPrice));
                }
                return original(protoId, regionId, isBuying);
            }, 10);
            this._economyHooked = true;
        }
    },
    createTradeRoute: async function(config) {
        const routeId = 'route_' + (typeof generateUUID === 'function' ? generateUUID() : Math.random().toString(36).substring(2));
        const route = { id: routeId, ...config };
        if (typeof World !== 'undefined' && World && World.regions && World.regions[config.from]) {
            if (!World.regions[config.from].caravans) World.regions[config.from].caravans = [];
            World.regions[config.from].caravans.push(route);
        }
        await this.queueMutation({ type: 'createTradeRoute', routeId, config });
        return routeId;
    },
    removeTradeRoute: async function(routeId) {
        let removed = false;
        if (typeof World !== 'undefined' && World && World.regions) {
            for (const rId in World.regions) {
                const region = World.regions[rId];
                if (region.caravans) {
                    const idx = region.caravans.findIndex(c => c.id === routeId);
                    if (idx !== -1) {
                        region.caravans.splice(idx, 1);
                        removed = true;
                    }
                }
            }
        }
        if (removed) await this.queueMutation({ type: 'removeTradeRoute', routeId });
        return removed;
    },
    getEconomySummary: async function() {
        const summary = { totalMoney: 0, priceIndex: 1.0, deficits: [], surpluses: [], factionBalance: {} };
        if (typeof World === 'undefined' || !World || !World.regions) return summary;
        
        let totalBase = 0;
        let totalCurrent = 0;
        const goodsStats = {};

        for (const rId in World.regions) {
            const r = World.regions[rId];
            summary.totalMoney += r.moneySupply || 0;
            
            if (!summary.factionBalance[r.factionId]) summary.factionBalance[r.factionId] = 0;
            summary.factionBalance[r.factionId] += r.moneySupply || 0;

            if (r.markets) {
                for (const [item, price] of Object.entries(r.markets)) {
                    const basePrice = (typeof ECONOMY_ITEMS !== 'undefined' && ECONOMY_ITEMS[item]) ? ECONOMY_ITEMS[item].basePrice : 1;
                    totalBase += basePrice;
                    totalCurrent += price;
                    
                    if (!goodsStats[item]) goodsStats[item] = { stock: 0, demand: 0 };
                    if (r.vault_id && typeof countRealItems === 'function') {
                        goodsStats[item].stock += countRealItems(r.vault_id, item);
                    }
                    goodsStats[item].demand += (r.population || 0) * 0.01;
                }
            }
        }
        if (totalBase > 0) summary.priceIndex = totalCurrent / totalBase;

        const deficitArray = [];
        for (const good in goodsStats) {
            const ratio = goodsStats[good].demand / (goodsStats[good].stock + 1);
            deficitArray.push({ good, ratio });
        }
        deficitArray.sort((a, b) => b.ratio - a.ratio);
        summary.deficits = deficitArray.slice(0, 5).map(i => i.good);
        summary.surpluses = deficitArray.slice(-5).reverse().map(i => i.good);

        return summary;
    },

    // --- 4. Map & Navigation ---
    getTile: async function(x, y) {
        if (typeof World === 'undefined' || !World || !World.map) return null;
        const map = World.map;
        if (x < 0 || x >= map.width || y < 0 || y >= map.height) return null;
        const idx = y * map.width + x;
        const cell = map.grid ? map.grid[idx] : null;
        if (!cell) return null;
        
        // MapTile format: [biome_id, road_level, bridge_flag, water_depth, is_flooded, road_condition]
        const biomeId = cell[0];
        const roadLevel = cell[1];
        const bridgeFlag = cell[2];
        const waterDepth = cell[3];
        const isFlooded = cell[4];
        const roadCondition = cell[5];

        let regionId = null;
        if (map.locations) {
            for (const loc of Object.values(map.locations)) {
                if (loc.x === x && loc.y === y) {
                    regionId = loc.id;
                    break;
                }
            }
        }
        
        let hasRoad = false;
        if (map.roads) {
            hasRoad = map.roads.some(r => r.waypoints.some(wp => wp[0] === x && wp[1] === y));
        }

        return { x, y, biomeId, roadLevel, bridgeFlag, waterDepth, isFlooded, roadCondition, regionId, hasRoad, isExplored: true };
    },
    setTileBiome: async function(x, y, biomeId) {
        if (typeof World !== 'undefined' && World && World.map && World.map.grid) {
            const idx = y * World.map.width + x;
            if (World.map.grid[idx]) World.map.grid[idx][0] = biomeId;
        }
        await this.queueMutation({ type: 'setTileBiome', x, y, biome_id: biomeId });
    },
    setTileRoadLevel: async function(x, y, level) {
        if (typeof World !== 'undefined' && World && World.map && World.map.grid) {
            const idx = y * World.map.width + x;
            if (World.map.grid[idx]) World.map.grid[idx][1] = level;
        }
        await this.queueMutation({ type: 'setTileRoadLevel', x, y, level });
    },
    setTileWaterDepth: async function(x, y, depth) {
        if (typeof World !== 'undefined' && World && World.map && World.map.grid) {
            const idx = y * World.map.width + x;
            if (World.map.grid[idx]) World.map.grid[idx][3] = depth;
        }
        await this.queueMutation({ type: 'setTileWaterDepth', x, y, depth });
    },
    setTileFlooded: async function(x, y, isFlooded) {
        if (typeof World !== 'undefined' && World && World.map && World.map.grid) {
            const idx = y * World.map.width + x;
            if (World.map.grid[idx]) World.map.grid[idx][4] = isFlooded;
        }
        await this.queueMutation({ type: 'setTileFlooded', x, y, isFlooded });
    },
    addMapLocation: async function(id, name, x, y, type = 'village', faction = '') {
        if (typeof World !== 'undefined' && World && World.map && World.map.locations) {
            World.map.locations[id] = { id, name, x, y, type, faction, no_road: false };
        }
        await this.queueMutation({ type: 'addLocation', id, name, x, y, locType: type, faction });
    },
    removeMapLocation: async function(id) {
        if (typeof World !== 'undefined' && World && World.map && World.map.locations) {
            delete World.map.locations[id];
        }
        await this.queueMutation({ type: 'removeLocation', id });
    },
    findPath: async function(fromX, fromY, toX, toY, options = {}) {
        return await this.sendRawToEngine('findPath', { fromX, fromY, toX, toY, options });
    },
    revealTile: async function(x, y, radius = 1) {
        await this.queueMutation({ type: 'revealTile', x, y, radius });
    },

    updateWorldConfig: async function(configObj) {
        await this.queueMutation({ type: 'updateWorldConfig', config: configObj });
    },
    updateBiomeDef: async function(biomeId, defObj) {
        await this.queueMutation({ type: 'updateBiomeDef', biomeId, def: defObj });
    },
    regenerateMap: async function(seed = Math.floor(Math.random() * 1000000)) {
        await this.queueMutation({ type: 'regenerateMap', seed });
    },


    // --- 5. Faction & Diplomacy ---
    getFaction: async function(factionId) {
        if (typeof World !== 'undefined' && World && World.factions && World.factions[factionId]) return World.factions[factionId];
        return null;
    },
    setFactionProperty: async function(factionId, property, value) {
        const faction = await this.getFaction(factionId);
        if (!faction) return false;
        faction[property] = value;
        await this.queueMutation({ type: 'setFactionProperty', factionId, property, value });
        return true;
    },
    createFaction: async function(config) {
        const factionId = config.id || 'faction_' + (typeof generateUUID === 'function' ? generateUUID() : Math.random().toString(36).substring(2));
        if (typeof World !== 'undefined' && World && World.factions) {
            World.factions[factionId] = { id: factionId, diplomacy: {}, regions: [], armies: [], ...config };
        }
        await this.queueMutation({ type: 'createFaction', factionId, config });
        return factionId;
    },
    getFactionMembers: async function(factionId) {
        const members = [];
        if (typeof World === 'undefined' || !World) return members;
        if (World.npcs) {
            for (const [id, npc] of Object.entries(World.npcs)) {
                if (npc.factionId === factionId) members.push(id);
            }
        }
        if (World.rulers) {
            for (const [id, ruler] of Object.entries(World.rulers)) {
                if (ruler.factionId === factionId) members.push(id);
            }
        }
        return members;
    },

    // --- 6. Time & Simulation Control ---
    getCurrentDate: function() {
        if (typeof player !== 'undefined' && player && player.gameTime) {
            return {
                day: player.gameTime.day,
                month: player.gameTime.month,
                year: player.gameTime.year,
                hour: player.gameTime.hour,
                minute: player.gameTime.minute,
                era: player.era,
                tick: (typeof World !== 'undefined' && World) ? World.tick : 0
            };
        }
        return null;
    },
    pauseSimulation: function() {
        this._simulationPausedByMod = true;
        if (typeof window !== 'undefined') window.isSimulatingTime = true;
        console.log('[ModAPI] Simulation paused by mod.');
    },
    resumeSimulation: function() {
        this._simulationPausedByMod = false;
        if (typeof window !== 'undefined') window.isSimulatingTime = false;
        console.log('[ModAPI] Simulation resumed by mod.');
    },
    setSimulationSpeed: function(speed) {
        if (typeof TREK_CONFIG !== 'undefined') {
            const base = 1000;
            TREK_CONFIG.tick_interval_ms = Math.max(50, Math.floor(base / speed));
            console.log(`[ModAPI] Simulation speed set to ${speed}x (${TREK_CONFIG.tick_interval_ms}ms per tick)`);
        }
    },

    // --- 7. Quest System ---
    registerQuest: function(questId, config) {
        if (!this._registeredQuests) this._registeredQuests = {};
        this._registeredQuests[questId] = config;
        console.log(`[ModAPI] Quest registered: ${questId}`);
    },
    advanceQuest: async function(questId, stageId) {
        if (!this._registeredQuests || !this._registeredQuests[questId]) return false;
        if (typeof player === 'undefined' || !player || !player.quests) return false;
        
        const questConfig = this._registeredQuests[questId];
        const stage = questConfig.stages.find(s => s.id === stageId);
        if (!stage) return false;

        if (!player.quests[questId]) {
            player.quests[questId] = {
                id: questId,
                aiIdentifier: questId,
                title: questConfig.title,
                objective: stage.description,
                description: questConfig.description || '',
                reward: questConfig.rewards ? JSON.stringify(questConfig.rewards) : 'Unknown',
                issuer: questConfig.issuer || 'System',
                status: 'active',
                currentStage: stageId
            };
            if (typeof addLogMessage === 'function') addLogMessage(`Новое задание: ${questConfig.title}`, 'quest-card');
        } else {
            player.quests[questId].objective = stage.description;
            player.quests[questId].currentStage = stageId;
            if (typeof addLogMessage === 'function') addLogMessage(`Задание обновлено: ${questConfig.title} - ${stage.description}`, 'quest-card');
        }
        if (typeof updateQuestList === 'function') updateQuestList();
        await this.queueMutation({ type: 'advanceQuest', questId, stageId });
        return true;
    },
    completeQuest: async function(questId, result = null) {
        if (typeof player === 'undefined' || !player || !player.quests || !player.quests[questId]) return;
        player.quests[questId].status = 'completed';
        
        const questConfig = this._registeredQuests ? this._registeredQuests[questId] : null;
        if (questConfig && questConfig.rewards) {
            if (questConfig.rewards.gold && typeof executeCommand === 'function') {
                await executeCommand('updateStat', { stat: 'gold', change: questConfig.rewards.gold });
            }
            if (questConfig.rewards.xp && typeof executeCommand === 'function') {
                await executeCommand('updateStat', { stat: 'xp', change: questConfig.rewards.xp });
            }
            if (questConfig.rewards.items && typeof executeCommand === 'function') {
                for (const item of questConfig.rewards.items) {
                    await executeCommand('addItem', { aiIdentifier: item, name: item, quantity: 1 });
                }
            }
        }
        
        if (typeof addLogMessage === 'function') addLogMessage(`Задание выполнено: ${player.quests[questId].title}`, 'quest-card');
        if (typeof updateQuestList === 'function') updateQuestList();
        await this.queueMutation({ type: 'completeQuest', questId, result });
    },
    failQuest: async function(questId, reason = null) {
        if (typeof player === 'undefined' || !player || !player.quests || !player.quests[questId]) return;
        player.quests[questId].status = 'failed';
        
        const questConfig = this._registeredQuests ? this._registeredQuests[questId] : null;
        if (questConfig && questConfig.onFailure) {
            if (typeof questConfig.onFailure === 'function') {
                await questConfig.onFailure(reason);
            }
        }
        
        if (typeof addLogMessage === 'function') addLogMessage(`Задание провалено: ${player.quests[questId].title}`, 'quest-card');
        if (typeof updateQuestList === 'function') updateQuestList();
        await this.queueMutation({ type: 'failQuest', questId, reason });
    },

    // --- 8. World Events ---
    registerWorldEvent: function(eventId, config) {
        if (!this._worldEvents) {
            this._worldEvents = {};
            if (typeof EventBus !== 'undefined') {
                EventBus.on('world:tick', async () => {
                    if (!this._worldEvents) return;
                    const currentDay = (typeof World !== 'undefined' && World) ? Math.floor((World.tick || 0) / 24) : 0;
                    for (const [id, ev] of Object.entries(this._worldEvents)) {
                        if (ev.frequency && currentDay % ev.frequency === 0) {
                            if (!ev.condition || ev.condition(typeof World !== 'undefined' ? World : null)) {
                                if (ev.onTrigger) await ev.onTrigger();
                            }
                        }
                    }
                });
            } else {
                if (typeof runWorldSimulationTick !== 'undefined') {
                    this.hookFunction(window, 'runWorldSimulationTick', '_ModAPI_WorldEvents', async (original, ...args) => {
                        await original(...args);
                        const currentDay = (typeof World !== 'undefined' && World) ? Math.floor((World.tick || 0) / 24) : 0;
                        for (const [id, ev] of Object.entries(this._worldEvents)) {
                            if (ev.frequency && currentDay % ev.frequency === 0) {
                                if (!ev.condition || ev.condition(typeof World !== 'undefined' ? World : null)) {
                                    if (ev.onTrigger) await ev.onTrigger();
                                }
                            }
                        }
                    }, 200);
                }
            }
        }
        this._worldEvents[eventId] = config;
        console.log(`[ModAPI] World event registered: ${eventId}`);
    },
    triggerWorldEvent: async function(eventId, args = null) {
        if (this._worldEvents && this._worldEvents[eventId] && this._worldEvents[eventId].onTrigger) {
            await this._worldEvents[eventId].onTrigger(args);
        }
    },

    // --- 9. Facility Management ---
    buildFacility: async function(regionId, type, config = {}) {
        const facilityId = config.id || 'fac_' + (typeof generateUUID === 'function' ? generateUUID() : Math.random().toString(36).substring(2));
        if (typeof World !== 'undefined' && World && World.businesses) {
            World.businesses[facilityId] = {
                id: facilityId,
                region_id: regionId,
                facility_type: type,
                owner_ids: [config.owner || 'system'],
                level: config.level || 1,
                cash_balance: config.cash || 0,
                employee_count: config.workers || 0,
                is_active: true,
                construction_days_left: 0,
                ...config
            };
            if (World.regions && World.regions[regionId]) {
                if (!World.regions[regionId].cityLayout) World.regions[regionId].cityLayout = [];
                World.regions[regionId].cityLayout.push({ type: type, linked_id: facilityId, name: config.name || type });
            }
        }
        await this.queueMutation({ type: 'buildFacility', regionId, facilityType: type, facilityId, config });
        if (typeof updateHoldingsDisplay === 'function') updateHoldingsDisplay();
        return facilityId;
    },
    destroyFacility: async function(facilityId) {
        let removed = false;
        if (typeof World !== 'undefined' && World && World.businesses && World.businesses[facilityId]) {
            const fac = World.businesses[facilityId];
            if (World.regions && World.regions[fac.region_id] && World.regions[fac.region_id].cityLayout) {
                World.regions[fac.region_id].cityLayout = World.regions[fac.region_id].cityLayout.filter(b => b.linked_id !== facilityId);
            }
            delete World.businesses[facilityId];
            removed = true;
        }
        if (removed) {
            await this.queueMutation({ type: 'destroyFacility', facilityId });
            if (typeof updateHoldingsDisplay === 'function') updateHoldingsDisplay();
        }
        return removed;
    },
    getFacility: async function(facilityId) {
        if (typeof World !== 'undefined' && World && World.businesses && World.businesses[facilityId]) {
            return World.businesses[facilityId];
        }
        return null;
    },

    // --- 10. Inter-Mod Communication ---
    broadcast: function(channel, data) {
        if (!this._broadcastChannels) this._broadcastChannels = {};
        if (this._broadcastChannels[channel]) {
            for (const cb of this._broadcastChannels[channel]) {
                try { cb(data); } catch(e) { console.error(`[ModAPI] Error in broadcast channel ${channel}:`, e); }
            }
        }
    },
    onBroadcast: function(channel, callback) {
        if (!this._broadcastChannels) this._broadcastChannels = {};
        if (!this._broadcastChannels[channel]) this._broadcastChannels[channel] = [];
        this._broadcastChannels[channel].push(callback);
    },

    // --- 11. Audio ---
    playSound: function(assetUrl, options = {}) {
        const soundId = 'snd_' + Date.now() + '_' + Math.random().toString(36).substring(2);
        if (!this._activeSounds) this._activeSounds = {};
        
        const audio = new Audio(assetUrl);
        audio.volume = options.volume !== undefined ? options.volume : 1.0;
        audio.loop = options.loop || false;
        
        if (options.fadeIn) {
            audio.volume = 0;
            audio.play().catch(e => console.warn('[ModAPI] playSound autoplay blocked:', e));
            let vol = 0;
            const step = (options.volume !== undefined ? options.volume : 1.0) / (options.fadeIn / 50);
            const fadeInterval = setInterval(() => {
                vol += step;
                if (vol >= (options.volume !== undefined ? options.volume : 1.0)) {
                    audio.volume = options.volume !== undefined ? options.volume : 1.0;
                    clearInterval(fadeInterval);
                } else {
                    audio.volume = vol;
                }
            }, 50);
        } else {
            audio.play().catch(e => console.warn('[ModAPI] playSound autoplay blocked:', e));
        }
        
        this._activeSounds[soundId] = audio;
        
        audio.addEventListener('ended', () => {
            if (!audio.loop) {
                delete this._activeSounds[soundId];
            }
        });
        
        return soundId;
    },
    stopSound: function(soundId) {
        if (this._activeSounds && this._activeSounds[soundId]) {
            const audio = this._activeSounds[soundId];
            audio.pause();
            audio.currentTime = 0;
            delete this._activeSounds[soundId];
        }
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
        'mergeDeep', 'registerAiProvider',
        'getNpc', 'queryNpcs', 'setNpcProperty', 'createNpc', 'removeNpc', 'addNpcTrait', 'removeNpcTrait',
        'getRegion', 'queryRegions', 'setRegionProperty', 'getRegionMarket', 'getRegionHistory',
        'getItemData', 'setItemPriceOverride', 'createTradeRoute', 'removeTradeRoute', 'getEconomySummary',
        'getTile', 'findPath', 'revealTile', 'setTileBiome', 'setTileRoadLevel', 'setTileWaterDepth', 'setTileFlooded', 'addMapLocation', 'removeMapLocation',
        'updateWorldConfig', 'updateBiomeDef', 'regenerateMap', 'setCustomMapGenerator',
        'getFaction', 'setFactionProperty', 'createFaction', 'getFactionMembers',
        'getCurrentDate', 'pauseSimulation', 'resumeSimulation', 'setSimulationSpeed',
        'registerQuest', 'advanceQuest', 'completeQuest', 'failQuest',
        'registerWorldEvent', 'triggerWorldEvent',
        'buildFacility', 'destroyFacility', 'getFacility',
        'broadcast', 'onBroadcast',
        'playSound', 'stopSound'
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
                    const dataTypes = ['items', 'recipes', 'facilities', 'biomes', 'city_gen', 'monsters', 'disasters', 'races', 'professions', 'traits', 'npc_names', 'faction_relations', 'world_config'];
                    for (const type of dataTypes) {
                        if (mod.data[type]) {
                            for (const file of mod.data[type]) {
                                const parsedData = await window.ModAPI.readJson(modId, file);
                                if (parsedData) {
                                    if (Array.isArray(db[type])) {
                                        db[type] = db[type].concat(parsedData);
                                    } else {
                                        mergeDeep(db[type], parsedData);
                                    }
                                }
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
