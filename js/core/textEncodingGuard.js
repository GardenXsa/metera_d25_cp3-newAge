(function() {
    const CP1251_EXTRA = new Map([
        ['Ђ', 0x80], ['Ѓ', 0x81], ['‚', 0x82], ['ѓ', 0x83], ['„', 0x84], ['…', 0x85], ['†', 0x86], ['‡', 0x87],
        ['€', 0x88], ['‰', 0x89], ['Љ', 0x8A], ['‹', 0x8B], ['Њ', 0x8C], ['Ќ', 0x8D], ['Ћ', 0x8E], ['Џ', 0x8F],
        ['ђ', 0x90], ['‘', 0x91], ['’', 0x92], ['“', 0x93], ['”', 0x94], ['•', 0x95], ['–', 0x96], ['—', 0x97],
        ['™', 0x99], ['љ', 0x9A], ['›', 0x9B], ['њ', 0x9C], ['ќ', 0x9D], ['ћ', 0x9E], ['џ', 0x9F],
        ['\u00A0', 0xA0], ['Ў', 0xA1], ['ў', 0xA2], ['Ј', 0xA3], ['¤', 0xA4], ['Ґ', 0xA5], ['¦', 0xA6], ['§', 0xA7],
        ['Ё', 0xA8], ['©', 0xA9], ['Є', 0xAA], ['«', 0xAB], ['¬', 0xAC], ['\u00AD', 0xAD], ['®', 0xAE], ['Ї', 0xAF],
        ['°', 0xB0], ['±', 0xB1], ['І', 0xB2], ['і', 0xB3], ['ґ', 0xB4], ['µ', 0xB5], ['¶', 0xB6], ['·', 0xB7],
        ['ё', 0xB8], ['№', 0xB9], ['є', 0xBA], ['»', 0xBB], ['ј', 0xBC], ['Ѕ', 0xBD], ['ѕ', 0xBE], ['ї', 0xBF]
    ]);

    const WATCH_SELECTORS = [
        '#quick-tags-bar',
        '#active-rolls-container',
        '#suggested-actions-container',
        '#dice-roll-list',
        '#character-stats',
        '#world-chronicles-panel',
        '#item-examine-modal',
        '#game-log',
        '.dice-roll-area',
        '.quick-tags-bar',
        '.suggested-actions-bar',
        '.entity-tooltip',
        '.item-tooltip',
        '.map-tooltip'
    ];

    function cp1251ByteForChar(ch) {
        const code = ch.charCodeAt(0);
        if (code <= 0x7F) return code;
        if (code >= 0x0410 && code <= 0x044F) return 0xC0 + (code - 0x0410);
        if (CP1251_EXTRA.has(ch)) return CP1251_EXTRA.get(ch);
        return null;
    }

    function mojibakeScore(value) {
        if (!value) return 0;
        const matches = String(value).match(/(?:Р[ђ-џЀ-ӿ]|С[ђ-џЀ-ӿ]|СЂ|РІ|рџ|вљ|вќ|пё|л§|Р—|РЎ|Рґ|Рµ|Р»|Р°|РЅ|Рё|Рѕ|Рї|Рљ|Рњ|Рџ|Р |Рў|РЈ|РҐ|Р§|РЁ|РЇ)/g);
        return matches ? matches.length : 0;
    }

    function decodeCp1251MojibakeOnce(value) {
        if (typeof value !== 'string' || value.length === 0 || typeof TextDecoder === 'undefined') return value;
        const bytes = [];
        for (const ch of value) {
            const byte = cp1251ByteForChar(ch);
            if (byte === null) return value;
            bytes.push(byte);
        }

        const decoded = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
        if (!decoded || decoded.includes('\uFFFD')) return value;
        if (mojibakeScore(decoded) >= mojibakeScore(value)) return value;
        return decoded;
    }

    function repairText(value) {
        if (typeof value !== 'string' || value.length === 0) return value;
        let repaired = value;
        for (let i = 0; i < 3; i++) {
            const next = decodeCp1251MojibakeOnce(repaired);
            if (next === repaired) break;
            repaired = next;
        }
        return repaired;
    }

    function repairTextNode(node) {
        const repaired = repairText(node.nodeValue);
        if (repaired !== node.nodeValue) {
            node.nodeValue = repaired;
        }
    }

    function repairElementAttributes(el) {
        ['title', 'placeholder', 'alt', 'aria-label'].forEach((name) => {
            if (!el.hasAttribute || !el.hasAttribute(name)) return;
            const current = el.getAttribute(name);
            const repaired = repairText(current);
            if (repaired !== current) el.setAttribute(name, repaired);
        });
    }

    function repairContainer(root) {
        if (!root || root.dataset && root.dataset.encodingGuardSkip === '1') return;
        if (root.nodeType === 1) repairElementAttributes(root);
        const walker = document.createTreeWalker(root, 0x1 | 0x4);
        const textNodes = [];
        const elements = [];
        while (walker.nextNode()) {
            if (walker.currentNode.nodeType === 3) textNodes.push(walker.currentNode);
            else if (walker.currentNode.nodeType === 1) elements.push(walker.currentNode);
        }
        textNodes.forEach(repairTextNode);
        elements.forEach(repairElementAttributes);
    }

    function repairKnownContainers() {
        WATCH_SELECTORS.forEach((selector) => {
            document.querySelectorAll(selector).forEach(repairContainer);
        });
    }

    function installObserver() {
        if (!document.body || window.__textEncodingGuardObserverInstalled) return;
        window.__textEncodingGuardObserverInstalled = true;

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 3) {
                        repairTextNode(node);
                        return;
                    }
                    if (node.nodeType !== 1) return;
                    repairElementAttributes(node);
                    if (WATCH_SELECTORS.some((selector) => node.matches && node.matches(selector))) {
                        repairContainer(node);
                    }
                    if (node.querySelectorAll) {
                        WATCH_SELECTORS.forEach((selector) => {
                            node.querySelectorAll(selector).forEach(repairContainer);
                        });
                    }
                });
                if (mutation.type === 'attributes' && mutation.target) {
                    repairElementAttributes(mutation.target);
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['title', 'placeholder', 'alt', 'aria-label']
        });
        repairKnownContainers();
    }

    window.TextEncodingGuard = {
        repairText,
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
