(function() {
    // ========================================================================
    // TextEncodingGuard — fixes mojibake (UTF-8 bytes misread as Windows-1251)
    // ========================================================================
    //
    // The C++ Nexus Engine and AI model responses sometimes emit UTF-8 encoded
    // emoji/symbol bytes that get misinterpreted as Windows-1251 (cp1251) on
    // Windows systems. This guard detects and repairs those garbled sequences.
    //
    // Strategy:
    //   1. MOJIBAKE_EMOJI_LIST — emojis whose mojibake patterns are auto-generated
    //      at init time using the same UTF-8→cp1251 mapping that causes the bug
    //   2. MOJIBAKE_SYMBOL_MAP — typographic symbols with hardcoded mojibake→correct
    //   3. CYRILLIC_DOUBLE_ENCODE — general fix for double-encoded Cyrillic
    //   4. MutationObserver watches DOM for dynamically injected mojibake text
    //   5. repairText() / repairObject() exposed globally for programmatic use

    // ========================================================================
    // 1. cp1251 byte → Unicode code point mapping (for programmatic generation)
    // ========================================================================

    const CP1251_TO_UNICODE = {};
    // ASCII range (0x20-0x7E): identity
    for (let b = 0x20; b <= 0x7E; b++) CP1251_TO_UNICODE[b] = b;
    // Cyrillic uppercase А-Я (0xC0-0xDF) → 0x0410-0x042F
    for (let b = 0xC0; b <= 0xDF; b++) CP1251_TO_UNICODE[b] = 0x0410 + (b - 0xC0);
    // Cyrillic lowercase а-я (0xE0-0xFF) → 0x0430-0x044F
    for (let b = 0xE0; b <= 0xFF; b++) CP1251_TO_UNICODE[b] = 0x0430 + (b - 0xE0);
    // Special cp1251 characters (0x80-0xBF)
    const CP1251_SPECIALS = {
        0x80: 0x0402, 0x81: 0x0403, 0x82: 0x201A, 0x83: 0x0453, 0x84: 0x201E,
        0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x0088, 0x89: 0x2030,
        0x8A: 0x0409, 0x8B: 0x2039, 0x8C: 0x040A, 0x8D: 0x040C, 0x8E: 0x040B,
        0x8F: 0x040F, 0x90: 0x0452, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C,
        0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x0098,
        0x99: 0x2122, 0x9A: 0x0459, 0x9B: 0x203A, 0x9C: 0x045A, 0x9D: 0x045C,
        0x9E: 0x045B, 0x9F: 0x045F, 0xA0: 0x00A0, 0xA1: 0x040E, 0xA2: 0x045E,
        0xA3: 0x0408, 0xA4: 0x00A4, 0xA5: 0x0490, 0xA6: 0x00A6, 0xA7: 0x0401,
        0xA8: 0x00A8, 0xA9: 0x0404, 0xAA: 0x00AA, 0xAB: 0x0407, 0xAC: 0x00AC,
        0xAD: 0x00AD, 0xAE: 0x0405, 0xAF: 0x0491,
        0xB0: 0x00B0, 0xB1: 0x00B1, 0xB2: 0x0406, 0xB3: 0x0456, 0xB4: 0x0491,
        0xB5: 0x00B5, 0xB6: 0x00B6, 0xB7: 0x0451, 0xB8: 0x00B8, 0xB9: 0x0455,
        0xBA: 0x00BA, 0xBB: 0x0457, 0xBC: 0x0458, 0xBD: 0x0454, 0xBE: 0x00BE,
        0xBF: 0x0457
    };
    for (const [b, u] of Object.entries(CP1251_SPECIALS)) CP1251_TO_UNICODE[parseInt(b)] = u;

    /**
     * Encode a Unicode string as UTF-8, then decode each byte as cp1251 → Unicode.
     * This produces the mojibake representation of the original string.
     */
    function encodeAsMojibake(str) {
        const utf8Bytes = [];
        for (let i = 0; i < str.length; i++) {
            let cp = str.codePointAt(i);
            if (cp > 0xFFFF) i++; // skip low surrogate
            if (cp < 0x80) {
                utf8Bytes.push(cp);
            } else if (cp < 0x800) {
                utf8Bytes.push(0xC0 | (cp >> 6));
                utf8Bytes.push(0x80 | (cp & 0x3F));
            } else if (cp < 0x10000) {
                utf8Bytes.push(0xE0 | (cp >> 12));
                utf8Bytes.push(0x80 | ((cp >> 6) & 0x3F));
                utf8Bytes.push(0x80 | (cp & 0x3F));
            } else {
                utf8Bytes.push(0xF0 | (cp >> 18));
                utf8Bytes.push(0x80 | ((cp >> 12) & 0x3F));
                utf8Bytes.push(0x80 | ((cp >> 6) & 0x3F));
                utf8Bytes.push(0x80 | (cp & 0x3F));
            }
        }
        let result = '';
        for (const b of utf8Bytes) {
            const uni = CP1251_TO_UNICODE[b];
            result += uni !== undefined ? String.fromCharCode(uni) : String.fromCharCode(b);
        }
        return result;
    }

    /**
     * Escape a string for use in a RegExp pattern.
     */
    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ========================================================================
    // 2. Emojis to generate mojibake patterns for
    // ========================================================================
    // Each emoji will have its mojibake pattern auto-generated at init time.
    // Variation-selector versions (emoji + U+FE0F) are handled automatically.

    const MOJIBAKE_EMOJI_LIST = [
        // Weapons & Combat
        '⚔️', '⚔', '🛡️', '🛡', '🗡️', '🗡', '🏹', '🔪', '🪃', '🧨',
        // Dice & Stats
        '🎲', '💪', '🤸', '🧠', '❤️', '❤', '🗣️', '🗣', '🫀',
        // Elements & Nature
        '💧', '💰', '⚖️', '⚖', '📍', '😊', '🌪️', '🌪', '🔥', '⚡️', '⚡',
        '❄️', '💨', '🌊', '🌿', '🍄', '🌸', '🌺', '🍀', '🍁',
        // Buildings & Economy
        '🏭', '📦', '🏛️', '🏛', '💡', '🏰', '🏠', '⛺', '🏯', '⛪',
        // People & Creatures
        '🙂', '🧙', '👑', '🧝', '🧟', '🐉', '🦇', '🦅', '🐺', '🐍',
        '🕷️', '🦂', '🐎', '🦄', '🦊', '🐻', '🦁', '🐱', '🐕', '🐑',
        '🐄', '🐓',
        // Hearts & Emotions
        '💚', '💙', '💛', '💜', '💔', '✨', '☠️', '☠', '💋', '💕',
        '😄', '😃', '😐', '😏', '😈', '👿', '😇', '🥳', '😤', '🤬',
        '😱', '😰', '😨', '😧', '😦', '😮', '😯', '😲', '🥺', '😢',
        '😭', '🤩', '😋', '🤤', '🥶', '🥵', '🤯', '😳', '🥱', '🤒',
        '🤕', '🤢', '🤮',
        // Items & Equipment
        '🏋️', '🏋', '📜', '🔔', '🗺️', '🗺', '🏔️', '🏔', '🚢', '⚓',
        '⚙️', '⚙', '♂️', '♂', '♀️', '♀', '🎉', '🏃', '🔑', '🔒',
        '🔫', '💣', '💀', '⚠️', '⚠', '📖', '📙', '🛒', '🧥', '🥾',
        '🎒', '💍', '🪙', '💸', '🧰', '🔮', '🧪', '⚗️', '🧫', '🪨',
        // Food & Drink
        '🦴', '🍖', '🍷', '🧀', '🍞', '🍺', '🫓', '🥩', '🍯', '🍲',
        // Moon & Stars
        '🌙', '☀️', '⭐', '🌟',
        // Composite people emojis
        '🤸‍♂️', '🤸‍♂', '🧙‍♂️', '🧙‍♂',
        // Travel & Navigation
        '🧭', '🚪', '🛤️', '🛣️', '🌉', '🚩', '🏴', '🏳️',
        // Writing & Knowledge
        '🖋️', '📝', '📰', '📑', '📊', '📈', '📉', '🗓️', '📆', '🗑️',
        // Hands & Gestures
        '👋', '🤚', '✋', '🖖', '👌', '🤌', '✌️', '🤞', '🤟', '🤘',
        '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎', '✊', '👊',
        '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏',
        // Additional symbols
        '⚜️', '🔱', '🔰', '♻️', '🔘', '🔴', '🟠', '🟡', '🟢', '🔵',
        '🟣', '⚫', '⚪', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛',
        '⬜', '🔶', '🔷', '🔸', '🔹', '💠', '🌀', '💈', '🕳️', '🃏',
        // Status & Body
        '🩸', '🗣', '👤', '👥', '🫂', '🧔', '👴', '👵', '👶', '🧒',
        '👦', '👧', '🧑', '👨', '👩',
        // Musical & Social
        '🎵', '🎶', '🎼', '🎭', '🎪', '🎯', '🎖️', '🏆', '🥇', '🥈',
    ];

    // ========================================================================
    // 3. Typographic symbols (hardcoded for reliability)
    // ========================================================================

    const MOJIBAKE_SYMBOL_MAP = [
        // These are generated from single Unicode symbols that don't need
        // variation-selector handling. Patterns are auto-generated.
        ['†', '†'], ['‡', '‡'], ['•', '•'], ['…', '…'],
        ['™', '™'], ['€', '€'], ['∞', '∞'], ['≠', '≠'],
        ['≈', '≈'], ['≤', '≤'], ['≥', '≥'], ['√', '√'],
        ['—', '—'], ['–', '–'],
    ];

    // ========================================================================
    // 4. Generate all mojibake replacement patterns
    // ========================================================================
    // For each emoji, we generate the mojibake pattern and create a regex.
    // Variation-selector versions (emoji+FE0F) must come BEFORE the base
    // version to avoid partial matches.

    const ALL_REPLACEMENTS = [];
    const _seenMojibake = new Set();

    function addReplacement(mojibake, replacement) {
        if (!mojibake || mojibake.length === 0) return;
        if (_seenMojibake.has(mojibake)) return;
        _seenMojibake.add(mojibake);
        try {
            ALL_REPLACEMENTS.push([new RegExp(escapeRegex(mojibake), 'g'), replacement]);
        } catch(e) { /* skip invalid regex */ }
    }

    // Process emojis: variation-selector versions first
    for (const emoji of MOJIBAKE_EMOJI_LIST) {
        const mojibake = encodeAsMojibake(emoji);
        // For emojis that already have variation selector (U+FE0F), just add them
        if (emoji.includes('\uFE0F')) {
            addReplacement(mojibake, emoji);
        } else {
            // For base emojis, also check variation-selector version
            // The VS16 (U+FE0F) makes emojis render as colorful emoji rather than text
            const withVS = emoji + '\uFE0F';
            const mojibakeVS = encodeAsMojibake(withVS);
            // Add variation-selector version FIRST (longer pattern)
            addReplacement(mojibakeVS, withVS);
            // Then add base version
            addReplacement(mojibake, emoji);
        }
    }

    // Process typographic symbols
    for (const [symbol] of MOJIBAKE_SYMBOL_MAP) {
        const mojibake = encodeAsMojibake(symbol);
        addReplacement(mojibake, symbol);
    }

    // ========================================================================
    // 5. General Cyrillic double-encoding fix
    // ========================================================================
    // When Russian UTF-8 text is double-encoded (UTF-8 → bytes → cp1251 decode),
    // common prefixes emerge. The most frequent one is:
    //   В (U+0412) → UTF-8 bytes D0 92 → cp1251 reads as Р' (Р + ')
    //   в (U+0432) → UTF-8 bytes D0 B2 → cp1251 reads as р'
    //
    // General pattern: Р' + lowercase Cyrillic → В + rest
    //                   р' + lowercase Cyrillic → в + rest

    ALL_REPLACEMENTS.push(
        [/Р'([а-яё])/g, 'В$1'],
        [/р'([а-яё])/g, 'в$1'],
    );

    // ========================================================================
    // 6. DOM selectors watched by MutationObserver
    // ========================================================================

    const WATCH_SELECTORS = [
        '#game-log',
        '#quick-tags-bar',
        '#active-rolls-container',
        '#suggested-actions-container',
        '#dice-roll-list',
        '.dice-roll-area',
        '.quick-tags-bar',
        '.suggested-actions-bar',
        // World chronicle panel
        '#world-chronicles-list',
        '#world-chronicles-panel',
        '.chronicle-item',
        '.chronicle-desc',
        '.chronicle-title',
        '.chronicle-filters',
        '#chronicle-ui-container',
        // Character panel stats
        '.character-panel',
        '#character-panel',
        '.stat-row',
        // Dice roll badges
        '.chat-roll-badge',
        '.roll-badge',
        // Port panel
        '.port-panel',
        '#port-panel',
        // Game message bubbles (catch-all for AI responses)
        '.message-bubble',
        '.message-wrapper',
        '.gm-message',
        '.world-event-card',
        '.world-event-body',
        // Environment panel
        '.environment-panel',
        '#environment-panel',
        // Any element with dynamic text content from AI or engine
        '.panel-content',
        '.system-content',
        // Status effects
        '.status-effect-item',
        '.effects-list',
        // Additional selectors for comprehensive coverage
        '#chronicle-ui-container .c-filter-btn',
        '.chronicle-status-brewing',
        '.chronicle-status-active',
        '#loading-text',
        '#loading-title',
    ];

    // ========================================================================
    // 7. Core repair functions
    // ========================================================================

    function repairText(value) {
        if (typeof value !== 'string' || value.length === 0) return value;
        let repaired = value;
        for (const [pattern, replacement] of ALL_REPLACEMENTS) {
            repaired = repaired.replace(pattern, replacement);
        }
        return repaired;
    }

    /**
     * Recursively repair all string values in a plain object/array.
     * Used to fix mojibake in World.news and other engine data before
     * it reaches the DOM, eliminating the flash-of-garbled-text issue.
     */
    function repairObject(obj, depth) {
        if (depth === undefined) depth = 0;
        if (depth > 10) return obj; // prevent infinite recursion
        if (obj === null || obj === undefined) return obj;
        if (typeof obj === 'string') return repairText(obj);
        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                if (typeof obj[i] === 'string') obj[i] = repairText(obj[i]);
                else if (typeof obj[i] === 'object') repairObject(obj[i], depth + 1);
            }
            return obj;
        }
        if (typeof obj === 'object') {
            for (const key of Object.keys(obj)) {
                if (typeof obj[key] === 'string') obj[key] = repairText(obj[key]);
                else if (typeof obj[key] === 'object') repairObject(obj[key], depth + 1);
            }
            return obj;
        }
        return obj;
    }

    function repairTextNode(node) {
        const repaired = repairText(node.nodeValue);
        if (repaired !== node.nodeValue) {
            node.nodeValue = repaired;
        }
    }

    function repairContainer(root) {
        if (!root || root.dataset && root.dataset.encodingGuardSkip === '1') return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(repairTextNode);
    }

    function repairKnownContainers() {
        WATCH_SELECTORS.forEach((selector) => {
            try {
                document.querySelectorAll(selector).forEach(repairContainer);
            } catch (e) {}
        });
    }

    // ========================================================================
    // 8. MutationObserver — watches DOM for dynamically injected mojibake
    // ========================================================================

    function installObserver() {
        if (!document.body || window.__textEncodingGuardObserverInstalled) return;
        window.__textEncodingGuardObserverInstalled = true;

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.TEXT_NODE) {
                        repairTextNode(node);
                        return;
                    }
                    if (node.nodeType !== Node.ELEMENT_NODE) return;
                    if (WATCH_SELECTORS.some((selector) => {
                        try { return node.matches && node.matches(selector); } catch(e) { return false; }
                    })) {
                        repairContainer(node);
                    }
                    if (node.querySelectorAll) {
                        WATCH_SELECTORS.forEach((selector) => {
                            try {
                                node.querySelectorAll(selector).forEach(repairContainer);
                            } catch(e) {}
                        });
                    }
                });
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
        repairKnownContainers();
    }

    // ========================================================================
    // 9. Public API
    // ========================================================================

    window.TextEncodingGuard = {
        repairText,
        repairObject,
        repairContainer,
        repairKnownContainers,
        installObserver
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installObserver);
    } else {
        installObserver();
    }
})();
