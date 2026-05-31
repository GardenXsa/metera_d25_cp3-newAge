/**
 * keyMapper.js — Layout-independent keyboard handler
 *
 * Problem: e.key returns layout-dependent characters.
 *   RU layout: ~ key → 'Ё', backquote → 'ё'
 *   EN layout: ~ key → '~', backquote → '`'
 *   e.code is ALWAYS layout-independent: 'Backquote', 'KeyR', etc.
 *
 * Solution:
 *   1. e.code → canonical key name (always works, layout-independent)
 *   2. e.key  → normalised via RU→EN map (fallback for missing codes)
 *   3. All hotkey checks go through getKey(e) instead of e.key directly
 *
 * Usage:
 *   import:  <script src="js/core/keyMapper.js"></script>
 *
 *   // Get canonical key from any event:
 *   const key = KeyMapper.getKey(e);          // '`', 'r', 'enter', 'escape' …
 *   const combo = KeyMapper.getCombo(e);      // 'ctrl+r', 'shift+enter', '`' …
 *   const isToggle = KeyMapper.is(e, '`');    // true on both RU and EN layouts
 *
 *   // Register a hotkey (replaces manual keydown checks):
 *   KeyMapper.register('`',        () => DevConsole.toggle());
 *   KeyMapper.register('ctrl+r',   () => repeatLastAction());
 *   KeyMapper.register('escape',   () => closeModal());
 *   KeyMapper.register('ctrl+z',   () => undo(), { global: false }); // only when not in input
 *
 *   // Unregister:
 *   KeyMapper.unregister('ctrl+r');
 *
 *   // Check in existing listeners (drop-in for e.key):
 *   document.addEventListener('keydown', e => {
 *       if (KeyMapper.is(e, 'r')) doSomething();
 *       if (KeyMapper.is(e, 'escape')) closeModal();
 *   });
 */

window.KeyMapper = (function () {
    'use strict';

    // ── e.code → canonical ASCII key ────────────────────────────────────────
    // Physical key codes that are layout-independent
    const CODE_MAP = {
        Backquote: '`', Backslash: '\\', BracketLeft: '[', BracketRight: ']',
        Comma: ',', Equal: '=', Minus: '-', Period: '.', Quote: "'",
        Semicolon: ';', Slash: '/',
        Space: ' ', Enter: 'enter', Tab: 'tab', Escape: 'escape',
        Backspace: 'backspace', Delete: 'delete', Insert: 'insert',
        Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown',
        ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
        CapsLock: 'capslock', NumLock: 'numlock', ScrollLock: 'scrolllock',
        PrintScreen: 'printscreen', Pause: 'pause',
        F1: 'f1', F2: 'f2', F3: 'f3', F4: 'f4', F5: 'f5', F6: 'f6',
        F7: 'f7', F8: 'f8', F9: 'f9', F10: 'f10', F11: 'f11', F12: 'f12',
        Numpad0: 'num0', Numpad1: 'num1', Numpad2: 'num2', Numpad3: 'num3',
        Numpad4: 'num4', Numpad5: 'num5', Numpad6: 'num6', Numpad7: 'num7',
        Numpad8: 'num8', Numpad9: 'num9', NumpadAdd: 'num+', NumpadSubtract: 'num-',
        NumpadMultiply: 'num*', NumpadDivide: 'num/', NumpadDecimal: 'num.',
        NumpadEnter: 'enter',
    };

    // Letter/digit keys: 'KeyA' → 'a', 'Digit1' → '1'
    function codeToKey(code) {
        if (!code) return null;
        if (CODE_MAP[code] !== undefined) return CODE_MAP[code];
        if (/^Key([A-Z])$/.test(code))   return RegExp.$1.toLowerCase();
        if (/^Digit(\d)$/.test(code))    return RegExp.$1;
        return null;
    }

    // ── e.key → canonical (layout normalisation) ────────────────────────────
    // Russian QWERTY → EN equivalent physical key
    const RU_TO_EN = {
        'й':'q','ц':'w','у':'e','к':'r','е':'t','н':'y','г':'u','ш':'i','щ':'o','з':'p',
        'х':'[','ъ':']','ф':'a','ы':'s','в':'d','а':'f','п':'g','р':'h','о':'j','л':'k',
        'д':'l','ж':';','э':"'",'я':'z','ч':'x','с':'c','м':'v','и':'b','т':'n','ь':'m',
        'б':',','ю':'.','ё':'`',
        // Upper case (shift + RU)
        'Й':'Q','Ц':'W','У':'E','К':'R','Е':'T','Н':'Y','Г':'U','Ш':'I','Щ':'O','З':'P',
        'Х':'{','Ъ':'}','Ф':'A','Ы':'S','В':'D','А':'F','П':'G','Р':'H','О':'J','Л':'K',
        'Д':'L','Ж':':','Э':'"','Я':'Z','Ч':'X','С':'C','М':'V','И':'B','Т':'N','Ь':'M',
        'Б':'<','Ю':'>','Ё':'~',
        // Common symbols on RU layout
        'ё': '`', 'Ё': '~',
        // Digits with shift on RU
        '№': '#',  // Shift+3 on RU
        // Other
        '\u0451': '`',  // ё (U+0451)
        '\u0401': '~',  // Ё (U+0401)
    };

    function normaliseKey(key) {
        if (!key || key.length > 20) return key; // modifiers, 'Enter', 'Escape', etc.
        if (key.length === 1) {
            const mapped = RU_TO_EN[key];
            if (mapped) return mapped;
            return key.toLowerCase();
        }
        // Multi-char keys: 'Enter', 'Escape', 'ArrowUp', etc.
        return key.toLowerCase()
            .replace('arrow', '')
            .replace('page', 'page');
    }

    // ── Main: get canonical key from event ──────────────────────────────────
    function getKey(e) {
        // Priority 1: e.code (always layout-independent)
        const fromCode = codeToKey(e.code);
        if (fromCode !== null) return fromCode;

        // Priority 2: normalise e.key via RU→EN map
        return normaliseKey(e.key);
    }

    // ── Build combo string ───────────────────────────────────────────────────
    function getCombo(e) {
        const parts = [];
        if (e.ctrlKey  || e.metaKey) parts.push('ctrl');
        if (e.altKey)                 parts.push('alt');
        if (e.shiftKey)               parts.push('shift');

        const key = getKey(e);
        // Don't add modifier keys themselves
        if (key && !['control','alt','shift','meta','os'].includes(key)) {
            parts.push(key);
        }
        return parts.join('+');
    }

    // ── Layout-independent key check ─────────────────────────────────────────
    function is(e, keyOrCombo) {
        const target = keyOrCombo.toLowerCase();
        // If target has '+' it's a combo check
        if (target.includes('+')) return getCombo(e) === target;
        return getKey(e) === target;
    }

    // ── Hotkey registry ──────────────────────────────────────────────────────
    const _registry = {}; // combo → { callback, options }

    /**
     * Register a hotkey.
     * @param {string} combo  - e.g. '`', 'ctrl+r', 'escape', 'shift+f5'
     * @param {function} cb   - callback(event)
     * @param {object} opts   - { global: bool (default true), preventDefault: bool (default true) }
     */
    function register(combo, cb, opts = {}) {
        const key = combo.toLowerCase();
        _registry[key] = {
            callback: cb,
            global: opts.global !== false,        // true = fires even when input focused
            preventDefault: opts.preventDefault !== false,
        };
    }

    function unregister(combo) {
        delete _registry[combo.toLowerCase()];
    }

    // ── Global keydown listener ──────────────────────────────────────────────
    function _dispatch(e) {
        const combo = getCombo(e);
        const entry = _registry[combo];
        if (!entry) return;

        const activeTag = document.activeElement ? document.activeElement.tagName : '';
        const inInput = activeTag === 'TEXTAREA' || activeTag === 'INPUT';

        // If not global and user is typing — skip (unless it's a special combo)
        if (!entry.global && inInput) return;

        if (entry.preventDefault) e.preventDefault();
        entry.callback(e);
    }

    // Use capture phase so we get the event before everything else
    document.addEventListener('keydown', _dispatch, true);

    // ── ModAPI integration ───────────────────────────────────────────────────
    // Patches ModAPI.registerHotkey to go through KeyMapper
    function patchModAPI() {
        if (!window.ModAPI) return;

        const _origRegister = window.ModAPI.registerHotkey.bind(window.ModAPI);
        window.ModAPI.registerHotkey = function(combo, callback) {
            register(combo, callback, { global: false });
            _origRegister(combo, callback);  // keep backward compat
        };

        const _origUnregister = window.ModAPI.unregisterHotkey.bind(window.ModAPI);
        window.ModAPI.unregisterHotkey = function(combo) {
            unregister(combo);
            _origUnregister(combo);
        };
    }

    // Wait for ModAPI (with 10s timeout)
    if (window.ModAPI) {
        patchModAPI();
    } else {
        let _elapsed = 0;
        const _t = setInterval(() => {
            _elapsed += 100;
            if (window.ModAPI) { patchModAPI(); clearInterval(_t); }
            else if (_elapsed >= 10000) { clearInterval(_t); }
        }, 100);
    }

    // ── Public API ────────────────────────────────────────────────────────────
    return { getKey, getCombo, is, register, unregister, CODE_MAP, RU_TO_EN };

})();
