(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.TtsTextFilter = factory();
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const UI_SELECTOR = [
        '.tts-controls-wrapper',
        '.scene-episode-header',
        '.scene-visual-card',
        '.scene-visual-restore',
        '.chat-illustration-container',
        '.system-toggle-hint',
        '.ooc-marker',
        'button',
        'script',
        'style'
    ].join(',');

    function normalizeWhitespace(text) {
        return String(text || '')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t\r\n]+/g, ' ')
            .replace(/\s+([,.!?;:])/g, '$1')
            .trim();
    }

    function stripServiceText(text) {
        return normalizeWhitespace(String(text || '')
            .replace(/\[COMMAND:[\s\S]*?\]/g, ' ')
            .replace(/\(\([\s\S]*?\)\)/g, ' ')
            .replace(/\bOOC\b/g, ' '));
    }

    function getTextFromHtml(html) {
        if (typeof document === 'undefined') {
            const rawHtml = String(html || '');
            const narrativeMatch = rawHtml.match(/<[^>]*class=["'][^"']*scene-narrative-body[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
            const sourceHtml = narrativeMatch ? narrativeMatch[1] : rawHtml
                .replace(/<[^>]*class=["'][^"']*(?:tts-controls-wrapper|scene-episode-header|scene-visual-card|scene-visual-restore|chat-illustration-container|system-toggle-hint|ooc-marker)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, ' ')
                .replace(/<button[\s\S]*?<\/button>/gi, ' ');
            return stripServiceText(sourceHtml.replace(/<[^>]*>/g, ' '));
        }

        const container = document.createElement('div');
        container.innerHTML = String(html || '');

        const narrativeBody = container.querySelector('.scene-narrative-body');
        const source = narrativeBody || container;
        source.querySelectorAll(UI_SELECTOR).forEach(node => node.remove());
        return stripServiceText(source.textContent || source.innerText || '');
    }

    function prepareSpeechText(message) {
        return stripServiceText(String(message || '').replace(/<[^>]*>/g, ' '));
    }

    function prepareSpeechTextFromHtml(html) {
        return getTextFromHtml(html);
    }

    return Object.freeze({
        prepareSpeechText,
        prepareSpeechTextFromHtml,
        stripServiceText,
        normalizeWhitespace
    });
});
