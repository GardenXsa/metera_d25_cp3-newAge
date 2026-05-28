(function() {
    // ========================================================================
    // TextEncodingGuard — fixes mojibake (UTF-8 bytes misread as Windows-1251)
    // ========================================================================

    const MOJIBAKE_REPLACEMENTS = [
        [/вљ”п¸Џ/g, '⚔️'],
        [/вљ”/g, '⚔'],
        [/рџ›Ўп¸Џ/g, '🛡️'],
        [/рџ›Ў/g, '🛡'],
        [/рџЋІ/g, '🎲'],
        [/рџ’ª/g, '💪'],
        [/рџ¤¸/g, '🤸'],
        [/рџЁ /g, '🧠'],
        [/вќ¤п¸Џ/g, '❤️'],
        [/вќ¤/g, '❤'],
        [/рџ—Јп¸Џ/g, '🗣️'],
        [/рџ—Ј/g, '🗣'],
        [/рџ’Ё/g, '💧'],
        [/рџ’°/g, '💰'],
        [/вљ–п¸Џ/g, '⚖️'],
        [/вљ–/g, '⚖'],
        [/рџ“Ќ/g, '📍'],
        [/рџЇЂ/g, '🫀'],
        [/рџЉ/g, '😊'],
        [/рџЊªп¸Џ/g, '🌪️'],
        [/рџЊª/g, '🌪'],
        [/рџЏ­/g, '🏭'],
        [/рџ“¦/g, '📦'],
        [/рџЏ›п¸Џ/g, '🏛️'],
        [/рџЏ›/g, '🏛'],
        [/рџ’Ў/g, '💡'],
        [/рџ™‚/g, '🙂'],
        [/рџЁ™/g, '🧙'],
        [/рџ”Ґ/g, '🔥'],
        [/в п¸Џ/g, '☠️'],
        [/в /g, '☠'],
        [/рџ’љ/g, '💚'],
        [/рџ’™/g, '💙'],
        [/рџ’›/g, '💛'],
        [/рџ’њ/g, '💜'],
        [/рџ’”/g, '💔'],
        [/вњ¨/g, '✨'],
        [/рџЏ‹п¸Џ/g, '🏋️'],
        [/рџЏ‹/g, '🏋'],
        [/рџ—Ўп¸Џ/g, '🗡️'],
        [/рџ—Ў/g, '🗡'],
        [/рџ“њ/g, '📜'],
        [/рџ””/g, '🔔'],
        [/рџ—ºп¸Џ/g, '🗺️'],
        [/рџ—º/g, '🗺'],
        [/рџЏ”п¸Џ/g, '🏔️'],
        [/рџЏ”/g, '🏔'],
        [/рџљў/g, '🚢'],
        [/вљ“/g, '⚓'],
        [/вљЎ/g, '⚡'],
        [/вљЎп¸Џ/g, '⚡️'],
        [/вљ™п¸Џ/g, '⚙️'],
        [/вљ™/g, '⚙'],
        [/в™‚п¸Џ/g, '♂️'],
        [/в™‚/g, '♂'],
        [/в™Ђп¸Џ/g, '♀️'],
        [/в™Ђ/g, '♀'],
        [/рџЋ‰/g, '🎉'],
        [/рџЏѓ/g, '🏃'],
        [/рџ”‘/g, '🔑'],
        [/рџ”’/g, '🔒'],
        [/рџ”Ї/g, '🔫'],
        [/рџ’Ј/g, '💣'],
        [/рџ’Ђ/g, '💀'],
        [/рџ„/g, '😄'],
        [/рџѓ/g, '😃'],
        [/рџђ/g, '😐'],
        [/рџЏ/g, '😏'],
        [/рџ€/g, '😈'],
        [/рџ’‹/g, '💋'],
        [/рџ’•/g, '💕'],
        [/вљ п¸Џ/g, '⚠️'],
        [/вљ /g, '⚠'],
        [/рџ“–/g, '📖'],
        [/рџ“™/g, '📙'],
        [/рџ¤¸вЂЌв™‚п¸Џ/g, '🤸‍♂️'],
        [/рџ¤¸вЂЌв™‚/g, '🤸‍♂'],
        [/рџЁ™вЂЌв™‚п¸Џ/g, '🧙‍♂️'],
        [/рџЁ™вЂЌв™‚/g, '🧙‍♂'],
        [/вЂ /g, '†'],
        [/вЂЎ/g, '‡'],
        [/вЂў/g, '•'],
        [/вЂ¦/g, '…'],
        [/в„ў/g, '™'],
        [/в‚¬/g, '€'],
        [/в€ћ/g, '∞'],
        [/в‰ /g, '≠'],
        [/в‰€/g, '≈'],
        [/в‰¤/g, '≤'],
        [/в‰Ґ/g, '≥'],
        [/в€љ/g, '√'],
        [/вЂ”/g, '—'],
        [/вЂ“/g, '–'],
        [/Р'ойна/g, 'Война'],
        [/Р'ойны/g, 'Войны'],
        [/Р'ойну/g, 'Войну'],
        [/Р'ойне/g, 'Войне'],
    ];

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
        '.effects-list'
    ];

    function repairText(value) {
        if (typeof value !== 'string' || value.length === 0) return value;
        let repaired = value;
        for (const [pattern, replacement] of MOJIBAKE_REPLACEMENTS) {
            repaired = repaired.replace(pattern, replacement);
        }
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
            try {
                document.querySelectorAll(selector).forEach(repairContainer);
            } catch (e) {}
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
