/**
 * DevConsole — Custom developer log panel
 * Opens/closes with ~ (tilde / backquote)
 * Intercepts console.log/warn/error and shows them in a controlled panel
 */
(function() {
    'use strict';

    // ── Config ──────────────────────────────────────────────────────────────
    const MAX_ENTRIES   = 500;   // max log lines kept in memory
    const MAX_SHOWN     = 200;   // max lines rendered in DOM at once
    const STORAGE_KEY   = 'devConsole_open';

    // ── State ────────────────────────────────────────────────────────────────
    const _entries = [];         // { level, module, text, time, count }
    let _visible   = false;
    let _filter    = 'all';      // 'all' | 'info' | 'warn' | 'error'
    let _search    = '';
    let _paused    = false;
    let _originalConsole = {};

    // ── DOM ──────────────────────────────────────────────────────────────────
    let _panel, _body, _searchInput, _badge;

    function _createPanel() {
        // Inject CSS
        const style = document.createElement('style');
        style.textContent = `
#dev-console-overlay {
    position: fixed;
    top: 0; left: 0; right: 0;
    height: 42vh;
    min-height: 200px;
    max-height: 60vh;
    z-index: 99999;
    background: rgba(8, 10, 14, 0.97);
    border-bottom: 2px solid #00f3ff;
    box-shadow: 0 4px 40px rgba(0,243,255,0.15);
    display: flex;
    flex-direction: column;
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 12px;
    color: #c8d0da;
    transform: translateY(-100%);
    transition: transform 0.22s cubic-bezier(0.4,0,0.2,1);
    resize: vertical;
    overflow: hidden;
}
#dev-console-overlay.open { transform: translateY(0); }

#dev-console-topbar {
    flex: 0 0 32px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    background: rgba(0,243,255,0.07);
    border-bottom: 1px solid rgba(0,243,255,0.2);
    user-select: none;
}
#dev-console-topbar .dc-title {
    color: #00f3ff;
    font-weight: bold;
    font-size: 11px;
    letter-spacing: 1px;
    margin-right: 4px;
}
.dc-filter-btn {
    padding: 2px 8px;
    border-radius: 3px;
    border: 1px solid rgba(255,255,255,0.15);
    background: transparent;
    color: #8a9ab0;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
}
.dc-filter-btn:hover { border-color: #00f3ff; color: #00f3ff; }
.dc-filter-btn.active { background: rgba(0,243,255,0.15); border-color: #00f3ff; color: #00f3ff; }
.dc-filter-btn.warn.active  { background: rgba(241,196,15,0.15); border-color: #f1c40f; color: #f1c40f; }
.dc-filter-btn.error.active { background: rgba(231,76,60,0.15);  border-color: #e74c3c; color: #e74c3c; }

#dc-search {
    flex: 1;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 3px;
    color: #c8d0da;
    padding: 2px 6px;
    font-size: 11px;
    font-family: inherit;
    outline: none;
    min-width: 120px;
    max-width: 240px;
}
#dc-search:focus { border-color: #00f3ff; }
#dc-search::placeholder { color: #4a5568; }

.dc-btn {
    padding: 2px 8px;
    border-radius: 3px;
    border: 1px solid rgba(255,255,255,0.12);
    background: transparent;
    color: #8a9ab0;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
    font-family: inherit;
}
.dc-btn:hover { border-color: rgba(255,255,255,0.3); color: #c8d0da; }
.dc-btn.pause { color: #f1c40f; border-color: rgba(241,196,15,0.4); }
.dc-badge {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 10px;
    background: #e74c3c;
    color: #fff;
    display: none;
    margin-left: 2px;
    font-weight: bold;
}
.dc-badge.visible { display: inline-block; }

.dc-close {
    margin-left: auto;
    color: #4a5568;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 2px 4px;
    border-radius: 2px;
    transition: color 0.15s;
}
.dc-close:hover { color: #e74c3c; }

#dev-console-body {
    flex: 1;
    overflow-y: auto;
    padding: 2px 0;
    scroll-behavior: smooth;
}
#dev-console-body::-webkit-scrollbar { width: 5px; }
#dev-console-body::-webkit-scrollbar-track { background: transparent; }
#dev-console-body::-webkit-scrollbar-thumb { background: rgba(0,243,255,0.2); border-radius: 3px; }

.dc-entry {
    display: flex;
    align-items: baseline;
    padding: 1px 8px;
    gap: 6px;
    border-bottom: 1px solid rgba(255,255,255,0.03);
    line-height: 1.5;
    animation: dc-fade-in 0.1s ease;
}
@keyframes dc-fade-in { from { opacity:0; background: rgba(0,243,255,0.05); } }
.dc-entry:hover { background: rgba(255,255,255,0.03); }

.dc-entry.warn  { background: rgba(241,196,15,0.04); border-left: 2px solid rgba(241,196,15,0.4); }
.dc-entry.error { background: rgba(231,76,60,0.06); border-left: 2px solid rgba(231,76,60,0.5); }
.dc-entry.info  { border-left: 2px solid transparent; }

.dc-time   { color: #3d4d60; font-size: 10px; flex: 0 0 52px; }
.dc-level  { font-size: 10px; font-weight: bold; flex: 0 0 36px; text-transform: uppercase; }
.dc-level.info  { color: #4a90d9; }
.dc-level.warn  { color: #f1c40f; }
.dc-level.error { color: #e74c3c; }
.dc-module { color: #5a8a6a; flex: 0 0 auto; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.dc-text   { color: #c8d0da; flex: 1; word-break: break-all; white-space: pre-wrap; }
.dc-text.warn  { color: #f5d76e; }
.dc-text.error { color: #f1948a; }
.dc-count  { color: #3d4d60; font-size: 10px; flex: 0 0 auto; }
.dc-count.gt1 { color: #00f3ff; }

#dev-console-statusbar {
    flex: 0 0 20px;
    display: flex;
    align-items: center;
    padding: 0 8px;
    gap: 10px;
    background: rgba(0,0,0,0.3);
    border-top: 1px solid rgba(0,243,255,0.1);
    font-size: 10px;
    color: #3d4d60;
}
#dc-status-count { color: #4a5568; }
#dc-status-hint  { margin-left: auto; color: #2a3a4a; }

/* Drag handle */
#dev-console-overlay::after {
    content: '';
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 4px;
    cursor: ns-resize;
    background: rgba(0,243,255,0.1);
    transition: background 0.15s;
}
#dev-console-overlay:hover::after { background: rgba(0,243,255,0.25); }
        `;
        document.head.appendChild(style);

        // Create panel HTML
        _panel = document.createElement('div');
        _panel.id = 'dev-console-overlay';
        _panel.innerHTML = `
<div id="dev-console-topbar">
    <span class="dc-title">⌨ DEV LOG</span>
    <button class="dc-filter-btn active" data-filter="all">ALL</button>
    <button class="dc-filter-btn" data-filter="info">INFO</button>
    <button class="dc-filter-btn warn" data-filter="warn">WARN</button>
    <button class="dc-filter-btn error" data-filter="error">ERR</button>
    <span class="dc-badge" id="dc-err-badge">0</span>
    <input id="dc-search" type="text" placeholder="filter..." autocomplete="off" spellcheck="false">
    <button class="dc-btn" id="dc-clear-btn">Clear</button>
    <button class="dc-btn" id="dc-copy-btn">Copy</button>
    <button class="dc-btn" id="dc-pause-btn">⏸ Pause</button>
    <span class="dc-close" id="dc-close-btn" title="Close (~)">✕</span>
</div>
<div id="dev-console-body"></div>
<div id="dev-console-statusbar">
    <span id="dc-status-count">0 entries</span>
    <span id="dc-status-hint">~ to toggle · scroll to bottom on new entries</span>
</div>
        `;
        document.body.appendChild(_panel);
        _body = _panel.querySelector('#dev-console-body');
        _searchInput = _panel.querySelector('#dc-search');
        _badge = _panel.querySelector('#dc-err-badge');

        // Events
        _panel.querySelectorAll('.dc-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                _panel.querySelectorAll('.dc-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                _filter = btn.dataset.filter;
                _render();
            });
        });

        _searchInput.addEventListener('input', () => {
            _search = _searchInput.value.toLowerCase();
            _render();
        });

        _panel.querySelector('#dc-clear-btn').addEventListener('click', () => {
            _entries.length = 0;
            _render();
            _updateBadge();
        });

        _panel.querySelector('#dc-copy-btn').addEventListener('click', () => {
            const text = _getFiltered()
                .map(e => `[${e.time}] [${e.level.toUpperCase()}] [${e.module}] ${e.text}`)
                .join('\n');
            navigator.clipboard?.writeText(text).catch(() => {});
        });

        _panel.querySelector('#dc-pause-btn').addEventListener('click', function() {
            _paused = !_paused;
            this.textContent = _paused ? '▶ Resume' : '⏸ Pause';
            this.classList.toggle('pause', _paused);
        });

        _panel.querySelector('#dc-close-btn').addEventListener('click', toggle);

        // Prevent tilde from going to game input while panel is open
        _searchInput.addEventListener('keydown', e => { if (e.key === '`') e.stopPropagation(); });
    }

    // ── Logging ──────────────────────────────────────────────────────────────
    function _extractModule(args) {
        const first = String(args[0] || '');
        // [ModName] or [Tag] style prefixes
        const m = first.match(/^\[([^\]]{1,30})\]/);
        if (m) return m[1];
        // script.js / ModLoader.js style — extract from call stack
        try {
            const stack = new Error().stack || '';
            const frame = stack.split('\n').find(l =>
                l.includes('.js') && !l.includes('devConsole') && !l.includes('console')
            );
            if (frame) {
                const fname = frame.match(/([^/\\]+\.js)/);
                if (fname) return fname[1].replace('.js','');
            }
        } catch(_) {}
        return 'app';
    }

    function _formatArgs(args) {
        return args.map(a => {
            if (typeof a === 'string') return a;
            try { return JSON.stringify(a, null, 0); } catch(_) { return String(a); }
        }).join(' ');
    }

    function _now() {
        const d = new Date();
        return d.toTimeString().slice(0,8) + '.' + String(d.getMilliseconds()).padStart(3,'0');
    }

    function _push(level, args) {
        if (_paused) return;
        const text   = _formatArgs(args);
        const module = _extractModule(args);
        const time   = _now();

        // Dedup: same level+text as last entry → increment count
        const last = _entries[_entries.length - 1];
        if (last && last.level === level && last.text === text) {
            last.count++;
            last.time = time;
            if (!_paused) _renderLast();
            return;
        }

        if (_entries.length >= MAX_ENTRIES) _entries.shift();
        _entries.push({ level, module, text, time, count: 1 });

        if (level === 'error') _updateBadge();
        if (!_paused && _visible) _appendEntry(_entries[_entries.length - 1]);
        _updateStatus();
    }

    // ── Rendering ────────────────────────────────────────────────────────────
    function _getFiltered() {
        return _entries.filter(e => {
            if (_filter !== 'all' && e.level !== _filter) return false;
            if (_search && !e.text.toLowerCase().includes(_search) &&
                !e.module.toLowerCase().includes(_search)) return false;
            return true;
        });
    }

    function _makeEntryEl(e) {
        const div = document.createElement('div');
        div.className = `dc-entry ${e.level}`;
        div.innerHTML =
            `<span class="dc-time">${e.time.slice(0,8)}</span>` +
            `<span class="dc-level ${e.level}">${e.level}</span>` +
            `<span class="dc-module">${_esc(e.module)}</span>` +
            `<span class="dc-text ${e.level}">${_esc(e.text)}</span>` +
            (e.count > 1 ? `<span class="dc-count gt1">×${e.count}</span>` : '');
        return div;
    }

    function _esc(s) {
        return String(s)
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function _render() {
        if (!_body) return;
        _body.innerHTML = '';
        const filtered = _getFiltered().slice(-MAX_SHOWN);
        const frag = document.createDocumentFragment();
        filtered.forEach(e => frag.appendChild(_makeEntryEl(e)));
        _body.appendChild(frag);
        _body.scrollTop = _body.scrollHeight;
        _updateStatus();
    }

    function _appendEntry(e) {
        if (!_body) return;
        if (_filter !== 'all' && e.level !== _filter) return;
        if (_search && !e.text.toLowerCase().includes(_search) &&
            !e.module.toLowerCase().includes(_search)) return;

        // Trim DOM if too long
        while (_body.children.length >= MAX_SHOWN) _body.removeChild(_body.firstChild);
        _body.appendChild(_makeEntryEl(e));

        // Auto-scroll if near bottom
        const threshold = 80;
        const atBottom = _body.scrollHeight - _body.scrollTop - _body.clientHeight < threshold;
        if (atBottom) _body.scrollTop = _body.scrollHeight;
        _updateStatus();
    }

    function _renderLast() {
        if (!_body || !_body.lastChild) { _render(); return; }
        const last = _entries[_entries.length - 1];
        const lastEl = _body.lastChild;
        const countEl = lastEl.querySelector('.dc-count');
        if (countEl) {
            countEl.textContent = `×${last.count}`;
            countEl.classList.add('gt1');
        } else {
            const span = document.createElement('span');
            span.className = 'dc-count gt1';
            span.textContent = `×${last.count}`;
            lastEl.appendChild(span);
        }
        lastEl.querySelector('.dc-time').textContent = last.time.slice(0,8);
    }

    function _updateStatus() {
        const el = document.getElementById('dc-status-count');
        if (el) el.textContent = `${_entries.length} entries · showing ${_getFiltered().length}`;
    }

    let _errCount = 0;
    function _updateBadge() {
        _errCount = _entries.filter(e => e.level === 'error').length;
        if (_badge) {
            _badge.textContent = _errCount;
            _badge.classList.toggle('visible', _errCount > 0 && !_visible);
        }
    }

    // ── Toggle ───────────────────────────────────────────────────────────────
    function toggle() {
        _visible = !_visible;
        _panel.classList.toggle('open', _visible);
        if (_visible) {
            _render();
            _badge.classList.remove('visible');
            setTimeout(() => _searchInput?.focus(), 220);
        }
        try { sessionStorage.setItem(STORAGE_KEY, _visible ? '1' : '0'); } catch(_) {}
    }

    // ── Console intercept ────────────────────────────────────────────────────
    function _intercept() {
        ['log','warn','error','info','debug'].forEach(method => {
            _originalConsole[method] = console[method].bind(console);
            const level = method === 'log' || method === 'debug' || method === 'info' ? 'info'
                        : method === 'warn' ? 'warn' : 'error';
            console[method] = function(...args) {
                _originalConsole[method](...args);   // still goes to DevTools
                _push(level, args);
            };
        });
    }

    // ── ModAPI integration ────────────────────────────────────────────────────
    function _hookModAPI() {
        if (!window.ModAPI) return;
        // Expose to mods: ModAPI.devLog(level, ...args)
        window.ModAPI.devLog = (level, ...args) => _push(level || 'info', args);
        // Expose raw entry list for tooling
        window.ModAPI._devConsoleEntries = _entries;
    }

    // ── Init ─────────────────────────────────────────────────────────────────
    function init() {
        _createPanel();
        _intercept();

        // Keyboard shortcut: ~ (backquote)
        // Use KeyMapper if available (layout-independent), fallback to manual
        if (window.KeyMapper) {
            window.KeyMapper.register('`', () => toggle(), { global: true });
            window.KeyMapper.register('escape', (e) => { if (_visible) toggle(); }, { global: true });
        } else {
            document.addEventListener('keydown', e => {
                const key = e.key;
                if (key === '`' || key === '~' || key === 'ё' || key === 'Ё' || e.code === 'Backquote') {
                    const tag = document.activeElement?.tagName;
                    if (tag === 'TEXTAREA') return;
                    if (tag === 'INPUT' && document.activeElement.id !== 'dc-search') return;
                    e.preventDefault();
                    toggle();
                }
                if ((key === 'Escape' || e.code === 'Escape') && _visible) toggle();
            }, true);
        }

        // Hook ModAPI when ready
        if (window.ModAPI) {
            _hookModAPI();
        } else {
            // Wait for ModAPI to be available
            const check = setInterval(() => {
                if (window.ModAPI) { _hookModAPI(); clearInterval(check); }
            }, 200);
        }

        // Restore open state from session
        try {
            if (sessionStorage.getItem(STORAGE_KEY) === '1') toggle();
        } catch(_) {}

        // Log startup
        _push('info', ['[DevConsole] Ready. Press ~ to toggle.']);
    }

    // Start after DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose global
    window.DevConsole = { toggle, entries: _entries, push: _push };
})();
