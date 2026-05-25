(function() {
    const STORAGE_KEY = 'meterea_runtime_log_tail';
    const MAX_TAIL = 200;

    function serializeDetail(detail) {
        if (detail instanceof Error) {
            return {
                name: detail.name,
                message: detail.message,
                stack: detail.stack || ''
            };
        }
        if (detail && typeof detail === 'object') {
            try {
                return JSON.parse(JSON.stringify(detail, Object.getOwnPropertyNames(detail)));
            } catch (_) {
                return String(detail);
            }
        }
        return detail === undefined ? null : detail;
    }

    function readTail() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (_) {
            return [];
        }
    }

    function writeTail(entry) {
        try {
            const tail = readTail();
            tail.push(entry);
            while (tail.length > MAX_TAIL) tail.shift();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(tail));
        } catch (_) {}
    }

    function consoleMethod(level) {
        if (level === 'error') return console.error.bind(console);
        if (level === 'warn') return console.warn.bind(console);
        if (level === 'debug') return console.debug ? console.debug.bind(console) : console.log.bind(console);
        return console.log.bind(console);
    }

    const RuntimeLog = {
        log(level, scope, message, detail = null) {
            const normalizedLevel = ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info';
            const entry = {
                ts: new Date().toISOString(),
                level: normalizedLevel,
                scope: scope || 'runtime',
                message: String(message || ''),
                detail: serializeDetail(detail)
            };

            writeTail(entry);
            consoleMethod(normalizedLevel)(`[${entry.scope}] ${entry.message}`, entry.detail || '');

            if (window.electronAPI && typeof window.electronAPI.runtimeLogAppend === 'function') {
                window.electronAPI.runtimeLogAppend(entry).catch(() => {});
            }

            window.dispatchEvent(new CustomEvent('runtime-log-entry', { detail: entry }));
            return entry;
        },
        debug(scope, message, detail = null) { return this.log('debug', scope, message, detail); },
        info(scope, message, detail = null) { return this.log('info', scope, message, detail); },
        warn(scope, message, detail = null) { return this.log('warn', scope, message, detail); },
        error(scope, message, detail = null) { return this.log('error', scope, message, detail); },
        getTail() { return readTail(); },
        clearTail() {
            try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
        }
    };

    const ModRuntimeGuard = {
        async disableBrokenMod(modId, reason, detail = null) {
            if (!modId || modId === 'base_game') return false;
            const detailObj = serializeDetail(detail);
            RuntimeLog.error('ModGuard', `Мод ${modId} отключён: ${reason}`, detailObj);

            if (!window.electronAPI || typeof window.electronAPI.loadSettings !== 'function' || typeof window.electronAPI.saveSettings !== 'function') {
                RuntimeLog.warn('ModGuard', 'Не удалось сохранить отключение мода: electron settings API недоступен.', { modId, reason });
                return false;
            }

            const settings = await window.electronAPI.loadSettings() || {};
            if (!settings.mods || typeof settings.mods !== 'object') settings.mods = {};
            const active = Array.isArray(settings.mods.active) ? settings.mods.active : ['base_game'];
            settings.mods.active = active.filter(id => id !== modId);
            if (!settings.mods.active.includes('base_game')) settings.mods.active.unshift('base_game');
            if (!settings.mods.disabled || typeof settings.mods.disabled !== 'object') settings.mods.disabled = {};
            settings.mods.disabled[modId] = {
                reason,
                detail: detailObj,
                disabled_at: new Date().toISOString()
            };
            await window.electronAPI.saveSettings(settings);

            RuntimeLog.warn('ModGuard', `Мод ${modId} удалён из active list. Перезапуск загрузит игру без него.`, settings.mods.disabled[modId]);
            window.dispatchEvent(new CustomEvent('mod-auto-disabled', { detail: { modId, reason, detail: detailObj } }));
            return true;
        }
    };

    window.RuntimeLog = RuntimeLog;
    window.ModRuntimeGuard = ModRuntimeGuard;

    window.addEventListener('error', (event) => {
        RuntimeLog.error('RendererError', event.message || 'Unhandled renderer error', {
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            error: serializeDetail(event.error)
        });
    });

    window.addEventListener('unhandledrejection', (event) => {
        RuntimeLog.error('UnhandledPromise', 'Unhandled promise rejection', serializeDetail(event.reason));
    });
})();
