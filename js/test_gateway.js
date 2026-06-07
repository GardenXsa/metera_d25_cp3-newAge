/**
 * ============================================================================
 * TEST GATEWAY — Dynamic AI Testing Interface for Chronicles of Meterea
 * ============================================================================
 *
 * Auto-discovers ALL interactive elements (buttons, inputs, selects, tabs,
 * clickable panels) after page initialization and on every DOM mutation.
 *
 * Provides a simple command protocol:
 *   TestGateway.exec('tap new-game-button')
 *   TestGateway.exec('fill api-key-input "sk-..."')
 *   TestGateway.exec('list buttons')
 *   TestGateway.exec('screen settings')
 *   TestGateway.exec('screenshot')
 *
 * Works with mods — new elements added by mods are auto-discovered via
 * MutationObserver. No hardcoded element lists.
 *
 * Load order: must be the LAST <script> in index.html (after script.js).
 * ============================================================================
 */
(function () {
    'use strict';

    // ── Internal State ──────────────────────────────────────────────────
    const _registry = new Map();   // Element → ElementDescriptor
    const _log = [];               // action log for debugging
    const _listeners = {};         // event listeners: 'screenshot' etc.
    let _observer = null;          // MutationObserver
    let _initialized = false;
    let _commandQueue = [];        // queued commands for deferred execution

    // ── Element Descriptor ──────────────────────────────────────────────
    function describeElement(el) {
        const rect = el.getBoundingClientRect();
        const computed = window.getComputedStyle(el);
        const parent = el.closest('[id]');
        const screen = _findScreen(el);

        return {
            id: el.id || '',
            tag: el.tagName.toLowerCase(),
            type: el.type || '',                          // for <input>
            label: _extractLabel(el),
            i18n: el.getAttribute('data-i18n') || '',
            role: el.getAttribute('role') || '',
            category: _categorize(el),
            screen: screen,
            visible: _isVisible(el, rect, computed),
            enabled: !el.disabled,
            rect: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                w: Math.round(rect.width),
                h: Math.round(rect.height)
            },
            classes: el.className && typeof el.className === 'string'
                ? el.className.split(' ').filter(c => c).slice(0, 10).join(' ') : '',
            parentId: parent ? parent.id : ''
        };
    }

    function _extractLabel(el) {
        if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim().slice(0, 120);
        if (el.title) return el.title.trim().slice(0, 120);
        const i18n = el.getAttribute('data-i18n');
        if (i18n) return '[' + i18n + ']';
        if (el.placeholder) return el.placeholder.trim().slice(0, 120);
        if (el.innerText) return el.innerText.trim().replace(/\s+/g, ' ').slice(0, 120);
        if (el.value && typeof el.value === 'string') return el.value.trim().slice(0, 120);
        if (el.name) return el.name;
        return '';
    }

    function _categorize(el) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'button' || el.getAttribute('role') === 'button') return 'button';
        if (tag === 'select') return 'select';
        if (tag === 'textarea') return 'input';
        if (tag === 'input') {
            if (el.type === 'checkbox' || el.type === 'radio') return 'toggle';
            return 'input';
        }
        if (tag === 'a' && el.href) return 'link';
        const computed = window.getComputedStyle(el);
        if (computed.cursor === 'pointer' || el.onclick || el.getAttribute('onclick')) return 'clickable';
        if (el.getAttribute('tabindex') !== null) return 'focusable';
        return 'other';
    }

    function _isVisible(el, rect, computed) {
        if (!rect) rect = el.getBoundingClientRect();
        if (!computed) computed = window.getComputedStyle(el);
        if (computed.display === 'none') return false;
        if (computed.visibility === 'hidden') return false;
        if (computed.opacity === '0') return false;
        if (rect.width === 0 && rect.height === 0) return false;
        let parent = el.parentElement;
        let depth = 0;
        while (parent && depth < 20) {
            try {
                const pc = window.getComputedStyle(parent);
                if (pc.display === 'none') return false;
            } catch (e) { break; }
            parent = parent.parentElement;
            depth++;
        }
        return true;
    }

    function _findScreen(el) {
        const screenSelectors = [
            '.main-menu-screen', '.menu-screen', '.game-screen',
            '.settings-tab-content.active', '.sub-tab-content.active',
            '.bus-card', '.modal', '.panel',
            '[class*="screen"]', '[class*="panel"]',
            '[class*="menu"]', '[class*="tab-content"]'
        ];
        for (const sel of screenSelectors) {
            const container = el.closest(sel);
            if (container) {
                return container.id || container.className.split(' ')[0] || sel.replace(/[.]/g, '');
            }
        }
        return '';
    }

    // ── Registry Management ─────────────────────────────────────────────

    function _addToRegistry(el) {
        if (!el || _registry.has(el)) return;
        const desc = describeElement(el);
        if (desc.category === 'other') return;
        if (desc.rect.w === 0 && desc.rect.h === 0) return;
        const key = desc.id || _generateKey(desc);
        _registry.set(el, { ...desc, _key: key, _el: el });
    }

    function _generateKey(desc) {
        const parts = [desc.tag];
        if (desc.id) parts.push(desc.id);
        else if (desc.label) parts.push(desc.label.slice(0, 30));
        if (desc.screen) parts.push(desc.screen);
        return parts.join('_').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 80);
    }

    function scan() {
        const before = _registry.size;
        const selectors = [
            'button', 'input', 'select', 'textarea', 'a[href]',
            '[role="button"]', '[onclick]', '[tabindex]',
            '[class*="btn"]', '[class*="button"]', '[class*="clickable"]',
            '.mm-nav-btn', '.bus-btn', '.back-button',
            '.settings-tab-btn', '.sub-tab-btn', '.toggle-key-btn'
        ];
        const elements = document.querySelectorAll(selectors.join(','));
        elements.forEach(el => _addToRegistry(el));
        const added = _registry.size - before;
        _logAction('scan', '+' + added + ' elements (total: ' + _registry.size + ')');
        return added;
    }

    function _refreshRegistry() {
        for (const [el, desc] of _registry) {
            if (!document.contains(el)) {
                _registry.delete(el);
                continue;
            }
            const rect = el.getBoundingClientRect();
            const computed = window.getComputedStyle(el);
            desc.visible = _isVisible(el, rect, computed);
            desc.enabled = !el.disabled;
            desc.rect = {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                w: Math.round(rect.width),
                h: Math.round(rect.height)
            };
            desc.label = _extractLabel(el);
        }
    }

    // ── Element Finder ──────────────────────────────────────────────────

    function find(selector) {
        _refreshRegistry();

        // 1. By element ID (exact match)
        for (const [el, desc] of _registry) {
            if (desc.id === selector) return { el, desc };
        }

        // 2. By generated key
        for (const [el, desc] of _registry) {
            if (desc._key === selector) return { el, desc };
        }

        // 3. By label text (case-insensitive)
        const lower = selector.toLowerCase();
        let bestMatch = null;
        let bestScore = 0;

        for (const [el, desc] of _registry) {
            if (!desc.visible) continue;
            const labelLower = desc.label.toLowerCase();
            if (labelLower === lower) return { el, desc };

            if (labelLower.includes(lower)) {
                const score = lower.length / labelLower.length;
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = { el, desc };
                }
            }

            if (desc.i18n && desc.i18n.toLowerCase().includes(lower)) {
                const score = 0.5;
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = { el, desc };
                }
            }
        }

        return bestMatch;
    }

    function findAll(selector, options) {
        options = options || {};
        _refreshRegistry();
        const results = [];
        const lower = selector ? selector.toLowerCase() : '';
        const category = options.category || '';
        const visibleOnly = options.visible !== false;

        for (const [el, desc] of _registry) {
            if (visibleOnly && !desc.visible) continue;
            if (category && desc.category !== category) continue;
            if (lower) {
                const match =
                    desc.id.toLowerCase().includes(lower) ||
                    desc.label.toLowerCase().includes(lower) ||
                    desc.i18n.toLowerCase().includes(lower) ||
                    desc._key.toLowerCase().includes(lower);
                if (!match) continue;
            }
            results.push({ el, desc });
        }
        return results;
    }

    // ── Actions ─────────────────────────────────────────────────────────

    function tap(selector) {
        const found = find(selector);
        if (!found) return _error('Element not found: "' + selector + '". Use list to see available elements.');
        var el = found.el, desc = found.desc;
        if (!desc.visible) return _error('Element "' + selector + '" is not visible (screen: ' + desc.screen + ').');
        if (!desc.enabled) _warn('Element "' + selector + '" is disabled. Tapping anyway...');

        if (desc.rect.y < 0 || desc.rect.y > window.innerHeight) {
            el.scrollIntoView({ behavior: 'instant', block: 'center' });
        }

        el.focus();
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        el.click();

        setTimeout(function () { scan(); }, 300);
        return _ok('Tapped "' + (desc.label || desc.id) + '" (' + desc.category + ')');
    }

    function fill(selector, value) {
        const found = find(selector);
        if (!found) return _error('Element not found: "' + selector + '".');
        var el = found.el, desc = found.desc;
        if (desc.category !== 'input') return _error('Element "' + selector + '" is not an input (type: ' + desc.category + ').');

        el.focus();
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));

        return _ok('Filled "' + (desc.id || desc.label) + '" with "' + value.slice(0, 50) + '"');
    }

    function toggle(selector) {
        const found = find(selector);
        if (!found) return _error('Element not found: "' + selector + '".');
        var el = found.el, desc = found.desc;
        if (desc.category !== 'toggle') return _error('Element "' + selector + '" is not a toggle (type: ' + desc.category + ').');

        el.focus();
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        el.click();

        setTimeout(function () { scan(); }, 300);
        return _ok('Toggled "' + (desc.id || desc.label) + '" -> checked: ' + !el.checked);
    }

    function selectOption(selector, value) {
        const found = find(selector);
        if (!found) return _error('Element not found: "' + selector + '".');
        var el = found.el, desc = found.desc;
        if (desc.category !== 'select') return _error('Element "' + selector + '" is not a select (type: ' + desc.category + ').');

        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));

        setTimeout(function () { scan(); }, 300);
        return _ok('Selected "' + value + '" in "' + (desc.id || desc.label) + '"');
    }

    function pressKey(key) {
        var active = document.activeElement;
        if (active) {
            active.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true }));
            active.dispatchEvent(new KeyboardEvent('keyup', { key: key, bubbles: true }));
            active.dispatchEvent(new KeyboardEvent('keypress', { key: key, bubbles: true }));
        }
        return _ok('Pressed key "' + key + '" on ' + (active ? active.tagName + (active.id ? '#' + active.id : '') : 'nothing'));
    }

    function gotoScreen(screenName) {
        var screenMap = {
            'main': 'main-menu',
            'menu': 'main-menu',
            'new': 'new-game-screen',
            'game': 'game-screen',
            'load': 'load-game-screen',
            'settings': 'settings-menu',
            'mods': 'mods-menu',
            'help': 'help-screen'
        };

        var targetId = screenMap[screenName.toLowerCase()] || screenName;
        var el = document.getElementById(targetId);

        if (!el) {
            var btn = find(screenName);
            if (btn) return tap(screenName);
            return _error('Screen "' + screenName + '" not found. Use screens to see available screens.');
        }

        document.querySelectorAll('.menu-screen, .main-menu-screen, .game-screen').forEach(function (s) {
            s.style.display = 'none';
            s.classList.remove('active-screen');
        });
        el.style.display = '';
        el.classList.add('active-screen');

        setTimeout(function () { scan(); }, 300);
        return _ok('Navigated to screen "' + targetId + '"');
    }

    // ── Query Commands ──────────────────────────────────────────────────

    function listElements(filterOrOptions) {
        _refreshRegistry();

        var options = {};
        if (typeof filterOrOptions === 'string') {
            var f = filterOrOptions.toLowerCase();
            if (f === 'buttons') options = { category: 'button' };
            else if (f === 'inputs') options = { category: 'input' };
            else if (f === 'toggles') options = { category: 'toggle' };
            else if (f === 'selects') options = { category: 'select' };
            else if (f === 'links') options = { category: 'link' };
            else if (f === 'clickable') options = { category: 'clickable' };
            else if (f === 'all') options = { visible: false };
            else if (f === 'visible') options = { visible: true };
            else options = { search: f };
        } else if (typeof filterOrOptions === 'object') {
            options = filterOrOptions;
        }

        var results = [];
        var search = options.search || '';
        var category = options.category || '';
        var visibleOnly = options.visible !== false;

        for (var entry of _registry) {
            var desc = entry[1];
            if (visibleOnly && !desc.visible) continue;
            if (category && desc.category !== category) continue;
            if (search) {
                var lower = search.toLowerCase();
                var match = desc.id.toLowerCase().includes(lower) ||
                    desc.label.toLowerCase().includes(lower) ||
                    desc.i18n.toLowerCase().includes(lower);
                if (!match) continue;
            }
            results.push({
                id: desc.id || desc._key,
                type: desc.category,
                label: desc.label.slice(0, 60),
                enabled: desc.enabled ? '\u2713' : '\u2717',
                screen: desc.screen || '-'
            });
        }

        results.sort(function (a, b) {
            if (a.screen && b.screen && a.screen !== b.screen) return a.screen.localeCompare(b.screen);
            return a.id.localeCompare(b.id);
        });

        return results;
    }

    function listScreens() {
        var screens = new Set();
        document.querySelectorAll('[class*="screen"], [class*="menu"], [class*="panel"]').forEach(function (el) {
            if (el.id) screens.add(el.id);
        });
        return Array.from(screens).sort();
    }

    function info(selector) {
        var found = find(selector);
        if (!found) return _error('Element not found: "' + selector + '".');
        return found.desc;
    }

    function getActiveScreen() {
        var active = document.querySelector('.active-screen') ||
            document.querySelector('[style*="display"]:not([style*="none"])');
        return active ? active.id || active.className : 'unknown';
    }

    // ── Screenshot & Events ─────────────────────────────────────────────

    function screenshot(filename) {
        var detail = { filename: filename || 'screenshot_' + Date.now(), timestamp: Date.now() };
        document.dispatchEvent(new CustomEvent('test-gateway-screenshot', { detail: detail }));
        return _ok('Screenshot requested: ' + detail.filename);
    }

    function on(event, callback) {
        if (!_listeners[event]) _listeners[event] = [];
        _listeners[event].push(callback);
    }

    function emit(event, data) {
        if (_listeners[event]) {
            _listeners[event].forEach(function (cb) {
                try { cb(data); } catch (e) { console.error('[TestGateway] Listener error:', e); }
            });
        }
    }

    // ── Command Parser ──────────────────────────────────────────────────

    function exec(command) {
        if (typeof command !== 'string' || !command.trim()) {
            return _error('Usage: TestGateway.exec("command arg1 arg2")');
        }

        var parts = _parseCommand(command);
        var cmd = parts.cmd.toLowerCase();
        var args = parts.args;

        _logAction('exec', command);

        switch (cmd) {
            case 'tap': case 'click': case 'clickbutton':
                return tap(args[0]);
            case 'fill': case 'type': case 'input':
                if (args.length < 2) return _error('Usage: fill <selector> <value>');
                return fill(args[0], args.slice(1).join(' '));
            case 'toggle': case 'check':
                return toggle(args[0]);
            case 'select':
                if (args.length < 2) return _error('Usage: select <selector> <value>');
                return selectOption(args[0], args.slice(1).join(' '));
            case 'key': case 'press':
                return pressKey(args[0]);
            case 'list': case 'ls':
                return listElements(args[0] || '');
            case 'screens':
                return listScreens();
            case 'info': case 'get':
                return info(args[0]);
            case 'goto': case 'screen': case 'navigate':
                return gotoScreen(args[0]);
            case 'screenshot': case 'snap':
                return screenshot(args[0]);
            case 'scan': case 'refresh':
                scan();
                return _ok('Registry refreshed: ' + _registry.size + ' elements');
            case 'active': case 'current':
                return getActiveScreen();
            case 'wait':
                return _ok('Waiting ' + (args[0] || 1000) + 'ms...');
            case 'eval': case 'run':
                try {
                    var result = eval(args.join(' '));
                    return _ok('Eval result: ' + (JSON.stringify(result, null, 2) || String(result)));
                } catch (e) {
                    return _error('Eval error: ' + e.message);
                }
            case 'log':
                return _log.slice(-20);
            case 'help':
                return _helpText();
            case 'count':
                _refreshRegistry();
                var counts = {};
                for (var entry of _registry) {
                    var cat = entry[1].category;
                    counts[cat] = (counts[cat] || 0) + 1;
                }
                counts.total = _registry.size;
                return counts;
            default:
                return _error('Unknown command: "' + cmd + '". Type help for available commands.');
        }
    }

    function _parseCommand(input) {
        var tokens = [];
        var current = '';
        var inQuotes = false;
        var quoteChar = '';

        for (var i = 0; i < input.length; i++) {
            var ch = input[i];
            if (inQuotes) {
                if (ch === quoteChar) {
                    inQuotes = false;
                } else {
                    current += ch;
                }
            } else if (ch === '"' || ch === "'") {
                inQuotes = true;
                quoteChar = ch;
            } else if (ch === ' ' || ch === '\t') {
                if (current) {
                    tokens.push(current);
                    current = '';
                }
            } else {
                current += ch;
            }
        }
        if (current) tokens.push(current);

        return { cmd: tokens[0] || '', args: tokens.slice(1) };
    }

    function _helpText() {
        return {
            commands: {
                'tap <selector>': 'Click a button/element by id, label, or i18n key',
                'fill <selector> <value>': 'Type text into an input field',
                'toggle <selector>': 'Toggle a checkbox/radio',
                'select <selector> <value>': 'Select a dropdown option',
                'key <key>': 'Press a keyboard key on focused element',
                'list [filter]': 'List interactive elements. Filters: buttons, inputs, toggles, selects, all, visible, <search>',
                'screens': 'List all screen/panel IDs',
                'info <selector>': 'Get detailed info about an element',
                'goto <screen>': 'Navigate to a screen by name or ID',
                'screenshot [name]': 'Request a screenshot',
                'scan': 'Re-scan DOM for new elements',
                'count': 'Count elements by category',
                'active': 'Get current active screen',
                'eval <code>': 'Execute JavaScript',
                'log': 'Show last 20 action log entries',
                'help': 'Show this help'
            },
            selectors: {
                'by id': 'new-game-button',
                'by label': 'Новая Игра',
                'by partial label': 'Новая',
                'by i18n key': 'mainMenu.newGame'
            }
        };
    }

    // ── Utility ─────────────────────────────────────────────────────────

    function _ok(msg) { return { status: 'ok', message: msg }; }
    function _warn(msg) { return { status: 'warn', message: msg }; }
    function _error(msg) { return { status: 'error', message: msg }; }

    function _logAction(action, detail) {
        var entry = { ts: new Date().toISOString(), action: action, detail: detail };
        _log.push(entry);
        if (_log.length > 500) _log.shift();
        console.log('[TestGateway] ' + action + ': ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)));
    }

    // ── MutationObserver ────────────────────────────────────────────────

    function _startObserver() {
        if (_observer) _observer.disconnect();

        _observer = new MutationObserver(function (mutations) {
            var shouldScan = false;
            for (var i = 0; i < mutations.length; i++) {
                var mutation = mutations[i];
                if (mutation.addedNodes.length > 0) {
                    for (var j = 0; j < mutation.addedNodes.length; j++) {
                        if (mutation.addedNodes[j].nodeType === Node.ELEMENT_NODE) {
                            shouldScan = true;
                            break;
                        }
                    }
                }
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    shouldScan = true;
                }
                if (shouldScan) break;
            }
            if (shouldScan) {
                clearTimeout(_observer._debounce);
                _observer._debounce = setTimeout(function () { scan(); }, 200);
            }
        });

        _observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class', 'disabled', 'hidden']
        });
    }

    // ── Initialization ──────────────────────────────────────────────────

    function init() {
        if (_initialized) return;
        _initialized = true;

        console.log('[TestGateway] Initializing...');

        scan();
        _startObserver();

        window.TestGateway = TG;

        console.log('[TestGateway] Ready! ' + _registry.size + ' interactive elements discovered.');
        console.log('[TestGateway] Usage: TestGateway.exec("list buttons") or TestGateway.tap("new-game-button")');

        while (_commandQueue.length > 0) {
            var cmd = _commandQueue.shift();
            exec(cmd);
        }
    }

    // ── Public API ──────────────────────────────────────────────────────

    var TG = {
        init: init,
        scan: scan,
        exec: exec,
        find: find,
        findAll: findAll,
        tap: tap,
        fill: fill,
        toggle: toggle,
        selectOption: selectOption,
        pressKey: pressKey,
        gotoScreen: gotoScreen,
        screenshot: screenshot,
        listElements: listElements,
        listScreens: listScreens,
        info: info,
        getActiveScreen: getActiveScreen,
        on: on,
        emit: emit,
        queue: function (command) { _commandQueue.push(command); }
    };

    // Expose registry & log via getters
    Object.defineProperty(TG, 'log', { get: function () { return _log; } });
    Object.defineProperty(TG, 'registry', { get: function () { return _registry; } });
    Object.defineProperty(TG, 'size', { get: function () { return _registry.size; } });

    // ── Auto-init ───────────────────────────────────────────────────────

    function _waitForApp() {
        var menu = document.getElementById('main-menu');
        if (menu && window.getComputedStyle(menu).display !== 'none') {
            setTimeout(function () { init(); }, 1500);
            return;
        }
        if (document.querySelector('.active-screen')) {
            setTimeout(function () { init(); }, 1500);
            return;
        }
        setTimeout(_waitForApp, 500);
    }

    // Expose immediately for command queuing
    window.TestGateway = TG;

    if (document.readyState === 'complete') {
        _waitForApp();
    } else {
        window.addEventListener('load', _waitForApp);
    }

})();
