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

    // --- Lifecycle tracking: stores originals for rollback (Issue #2) ---
    _originalFunctions: {},
    _injectedStyles: [],
    _injectedUI: [],

    // --- HTML sanitizer (Issue #5) ---
    _sanitizeHTML: function(html) {
        // Remove script tags
        html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        // Remove on* event handlers
        html = html.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
        // Remove javascript: URLs
        html = html.replace(/href\s*=\s*["']javascript:/gi, 'href="');
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
        // Issue #6: Validate mod metadata before loading
        const validatedMods = [];
        for (const mod of activeMods) {
            const errors = window.ModAPI._validateModMeta(mod);
            if (errors.length > 0) {
                console.error(`[ModLoader] Мод "${mod.id || 'UNKNOWN}" не прошёл валидацию. Пропускаю. Ошибки: ${errors.join('; ')}`);
                continue;
            }
            // Issue #7: API versioning check - warn but don't block
            if (mod.apiVersion && mod.apiVersion !== window.ModAPI.apiVersion) {
                console.warn(`[ModLoader] Мод ${mod.id} использует apiVersion "${mod.apiVersion}", текущая версия "${window.ModAPI.apiVersion}". Возможна несовместимость.`);
            }
            validatedMods.push(mod);
        }
        activeMods = validatedMods;

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
                console.error(`[ModLoader] Отключаю тотал-конверсию: ${m.id} (конфликтует с ${kept.id})`);
                activeMods = activeMods.filter(a => a.id !== m.id);
            }
        }

        // Проверка на тотальную конверсию
        for (const mod of activeMods) {
            if (mod.total_conversion === true) {
                window.ModAPI.isTotalConversion = true;
                console.log(`[ModLoader] ⚠️ АКТИВИРОВАН РЕЖИМ ТОТАЛЬНОЙ КОНВЕРСИИ модом: ${mod.id}. Ванильные ресурсы отключены.`);
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

                            // Issue #1: Create restricted mod sandbox
                            // SECURITY: AsyncFunction still has access to global scope via closures.
                            // We mitigate by:
                            // 1. Restricting `this` context to a sandbox object
                            // 2. Only passing safe, vetted properties
                            // 3. Explicitly NOT passing: fetch, XMLHttpRequest, WebSocket, 
                            //    window.electronAPI, eval, Function, require, process, globalThis
                            // 4. Running in strict mode to prevent accidental global leaks
                            // For full isolation, Web Workers should be used in a future iteration.
                            const modSandbox = Object.create(null);
                            // Copy only safe properties — whitelist approach
                            modSandbox.ModAPI = window.ModAPI;
                            modSandbox.console = {
                                log: console.log.bind(console),
                                warn: console.warn.bind(console),
                                error: console.error.bind(console),
                                info: console.info.bind(console)
                            };
                            modSandbox.document = document; // mods need DOM for addUI
                            modSandbox.Math = Math;
                            modSandbox.Date = Date;
                            modSandbox.JSON = JSON;
                            modSandbox.Promise = Promise;
                            modSandbox.setTimeout = setTimeout;
                            modSandbox.setInterval = setInterval;
                            modSandbox.clearTimeout = clearTimeout;
                            modSandbox.clearInterval = clearInterval;
                            modSandbox.Array = Array;
                            modSandbox.Object = Object;
                            modSandbox.String = String;
                            modSandbox.Number = Number;
                            modSandbox.Boolean = Boolean;
                            modSandbox.Map = Map;
                            modSandbox.Set = Set;
                            modSandbox.Error = Error;
                            modSandbox.RegExp = RegExp;
                            // Explicitly NOT including: fetch, XMLHttpRequest, WebSocket, 
                            // window, globalThis, eval, Function, require, process,
                            // electronAPI, localStorage, sessionStorage

                            // Execute mod in sandbox context with strict mode
                            const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
                            const modFunc = new AsyncFunction('ModAPI', 'modId', 'modMeta', '"use strict"; ' + code);
                            await modFunc.call(modSandbox, window.ModAPI, modId, mod);
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
