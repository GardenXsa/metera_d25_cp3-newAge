(function() {
    const MOJIBAKE_REPLACEMENTS = [
        [/рџЋІ/g, '🎲'],
        [/рџ’Є/g, '💪'],
        [/рџЏѓ/g, '🤸'],
        [/рџ’Ў/g, '💡'],
        [/рџ›ЎпёЏ/g, '🛡️'],
        [/рџ›Ў/g, '🛡️'],
        [/рџ™‚/g, '🙂'],
        [/рџ§™вЂЌв™‚пёЏ/g, '🧙'],
        [/рџ§™/g, '🧙'],
        [/вљ”пёЏ/g, '⚔️'],
        [/вљ”/g, '⚔️'],
        [/вќ¤пёЏ/g, '❤️'],
        [/вќ¤/g, '❤️'],
        [/рџ’§/g, '💧'],
        [/рџ’°/g, '💰'],
        [/рџ“Ќ/g, '📍'],
        [/вљ–пёЏ/g, '⚖️'],
        [/вљ–/g, '⚖️'],
        [/рџЊЄпёЏ/g, '🌪️'],
        [/рџЊЄ/g, '🌪️']
    ];

    const WATCH_SELECTORS = [
        '#game-log',
        '#quick-tags-bar',
        '#active-rolls-container',
        '#suggested-actions-container',
        '#dice-roll-list',
        '.dice-roll-area',
        '.quick-tags-bar',
        '.suggested-actions-bar'
    ];

    function repairText(value) {
        if (typeof value !== 'string' || value.length === 0) return value;
        let repaired = value;
        for (const [pattern, replacement] of MOJIBAKE_REPLACEMENTS) {
            repaired = repaired.replace(pattern, replacement);
        }

        // If an unknown emoji mojibake prefix remains before a readable label,
        // drop only that leading broken prefix instead of touching normal text.
        repaired = repaired.replace(/^([рР]џ\S{1,18}|в[^\sA-Za-zА-Яа-я0-9]{1,18})\s+([A-Za-zА-Яа-я0-9])/u, '$2');
        return repaired;
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
            document.querySelectorAll(selector).forEach(repairContainer);
        });
    }

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
                    if (WATCH_SELECTORS.some((selector) => node.matches && node.matches(selector))) {
                        repairContainer(node);
                    }
                    if (node.querySelectorAll) {
                        WATCH_SELECTORS.forEach((selector) => {
                            node.querySelectorAll(selector).forEach(repairContainer);
                        });
                    }
                });
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
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
