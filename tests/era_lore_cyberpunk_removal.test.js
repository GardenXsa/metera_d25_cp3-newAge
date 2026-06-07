#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

// === Контракт 1: все 4 era_lore файла существуют и не пусты ===
const eraFiles = [
    'assets/prompts/epo_DC/architects.txt',
    'assets/prompts/epo_DC/rebirth.txt',
    'assets/prompts/epo_DC/silence.txt',
    'assets/prompts/epo_DC/sundering.txt',
];
for (const rel of eraFiles) {
    const abs = path.join(root, rel);
    const content = fs.readFileSync(abs, 'utf8');
    assert.ok(content.length > 500, `${rel} must be > 500 chars (got ${content.length})`);
}

// === Контракт 2: era_lore файлы НЕ содержат старых cyberpunk-терминов ===
// Эти термины пришли из dark-cyberpunk era_lore preset (epo_DC) и теперь
// конфликтуют с fantasy-лором в assets/lor/world_metera/ru/lor.txt.
// Должны быть полностью удалены, иначе GM генерирует "магические винтовки",
// "вокодер", "прожекторы", "Синдикат" в чисто фэнтезийном мире.
const forbiddenCyberpunkTerms = [
    'имплант',
    'Имплант',
    'ИМПЛАНТ',
    'био-чип',
    'Био-чип',
    'БИО-ЧИП',
    'вокодер',
    'Вокодер',
    'ВОКОДЕР',
    'прожектор',
    'Прожектор',
    'ПРОЖЕКТОР',
    'Синдикат',
    'СИНДИКАТ',
    'винтовк',
    'Винтовк',
    'ВИТОВК',
    'дробовик',
    'Дробовик',
    'ДРОБОВИК',
    'пистолет',
    'Пистолет',
    'ПИСТОЛЕТ',
    'магическ.*винтовк',
    'Магическ.*винтовк',
    'МАГИЧЕСК.*ВИНОВК',
    'магическ.*прожектор',
    'Магическ.*прожектор',
    'МАГИЧЕСК.*ПРОЖЕКТОР',
    'Стальной Отблеск',
    'СТАЛЬНОЙ ОТБЛЕСК',
    'Коллегия Некро-инженеров',
    'КОЛЛЕГИЯ НЕКРО-ИНЖЕНЕРОВ',
    'Коллегия некро-инженеров',
    'Некро-инженер',
    'НЕКРО-ИНЖЕНЕР',
    'некро-инженер',
    'Аэрокет',
    'АЭРОКЕТ',
    'аэрокет',
    'Эфирный Двигатель',
    'ЭФИРНЫЙ ДВИГАТЕЛЬ',
    'Трон Синхронизации',
    'ТРОН СИНХРОНИЗАЦИИ',
    'Кодекс Стабильности',
    'КОДЕКС СТАБИЛЬНОСТИ',
    'Глубинный Логос',
    'ГЛУБИННЫЙ ЛОГОС',
    'Deep Logos',
    'DEEP LOGOS',
    'Рунный Синхронизатор',
    'РУННЫЙ СИНХРОНИЗАТОР',
    'Runic Synchronizer',
    'RUNIC SYNCHRONIZER',
    'Ткач Хаоса',
    'ТКАЧ ХАОСА',
    'Пожиратель Стали',
    'ПОЖИРАТЕЛЬ СТАЛИ',
    'Оглушенный',
    'ОГЛУШЕННЫЙ',
    'The Muted',
    'THE MUTED',
    'Био-Лампа',
    'БИО-ЛАМПА',
    'Силиконовый Паук',
    'СИЛИКОНОВЫЙ ПАУК',
    'Эфирный Верблюд',
    'ЭФИРНЫЙ ВЕРБЛЮД',
    'Акустический Попугай',
    'АКУСТИЧЕСКИЙ ПОПУГАЙ',
    'Гравитационный Осел',
    'ГРАВИТАЦИОННЫЙ ОСЕЛ',
    'Плазменный Петух',
    'ПЛАЗМЕННЫЙ ПЕТУХ',
    'Рунный Сокол',
    'РУННЫЙ СОКОЛ',
    'Био-Зонт',
    'БИО-ЗОНТ',
    'Рунный Сверчок',
    'РУННЫЙ СВЕРЧОК',
    'Теневой Паразит',
    'ТЕНЕВОЙ ПАРАЗИТ',
    'Теневой Сталкер',
    'ТЕНЕВОЙ СТАЛКЕР',
    'Теневой Богомол',
    'ТЕНЕВОЙ БОГОМОЛ',
    'Теневой Скат',
    'ТЕНЕВОЙ СКАТ',
    'Рунный Кулак',
    'РУННЫЙ КУЛАК',
    'Импринт-мастер',
    'ИМПРИНТ-МАСТЕР',
    'Голем-Библиотекарь',
    'ГОЛЕМ-БИБЛИОТЕКАРЬ',
    'Ментальный Голем',
    'МЕНТАЛЬНЫЙ ГОЛЕМ',
    'Карцер',
    'КАРЦЕР',
    'карцер',
];

let violations = [];
for (const rel of eraFiles) {
    const abs = path.join(root, rel);
    const content = fs.readFileSync(abs, 'utf8');
    for (const term of forbiddenCyberpunkTerms) {
        // Use a substring check (no regex specials to worry about for most terms,
        // but for "магическ.*винтовк" etc. we need regex matching)
        let match;
        if (term.includes('.*')) {
            const re = new RegExp(term, 'i');
            match = re.test(content);
        } else {
            match = content.includes(term);
        }
        if (match) {
            // Find line number for diagnostics
            const idx = content.indexOf(term);
            const before = content.lastIndexOf('\n', idx);
            const lineNum = content.substring(0, idx).split('\n').length;
            violations.push(`${rel}:${lineNum} contains forbidden term "${term}"`);
        }
    }
}
assert.strictEqual(violations.length, 0, `Found ${violations.length} cyberpunk term(s) in era_lore files:\n  ${violations.slice(0, 10).join('\n  ')}${violations.length > 10 ? '\n  ...' : ''}`);

// === Контракт 3: era_lore файлы СОДЕРЖАТ ключевые fantasy-термины из lore.txt ===
// Это подтверждает, что новый контент действительно относится к fantasy,
// а не просто очищен от cyberpunk-мусора.
const expectedFantasyAnchors = {
    'assets/prompts/epo_DC/architects.txt': ['Архитектор', 'Эфир', 'ИЛИФИЯ', 'КСОАН', 'ТРАНСЦЕНДЕНТ'],
    'assets/prompts/epo_DC/rebirth.txt': ['Аквилон', 'Эфир', 'дворф', 'эльф', 'Магистериум'],
    'assets/prompts/epo_DC/silence.txt': ['Шрамы', 'Эфир', 'руины', 'Архитектор', 'Пепельный'],
    'assets/prompts/epo_DC/sundering.txt': ['Разлом', 'Эфир', 'Шрамы', 'Падший', 'Бездна'],
};
for (const [rel, terms] of Object.entries(expectedFantasyAnchors)) {
    const abs = path.join(root, rel);
    const content = fs.readFileSync(abs, 'utf8');
    const missing = terms.filter(t => !content.includes(t));
    assert.strictEqual(missing.length, 0,
        `${rel} missing fantasy anchors: ${missing.join(', ')} (file may have been wiped to stub)`);
}

// === Контракт 4: prompt_pack.json всё ещё указывает на epo_DC/ файлы ===
const promptPack = JSON.parse(fs.readFileSync(path.join(root, 'data/prompt_pack.json'), 'utf8'));
const entries = promptPack.entries || {};
assert.match(entries['era_lore.architects']?.path || '', /epo_DC[\\\/]architects\.txt$/,
    'era_lore.architects must still resolve to epo_DC/architects.txt');
assert.match(entries['era_lore.rebirth']?.path || '', /epo_DC[\\\/]rebirth\.txt$/,
    'era_lore.rebirth must still resolve to epo_DC/rebirth.txt');
assert.match(entries['era_lore.silence']?.path || '', /epo_DC[\\\/]silence\.txt$/,
    'era_lore.silence must still resolve to epo_DC/silence.txt');
assert.match(entries['era_lore.sundering']?.path || '', /epo_DC[\\\/]sundering\.txt$/,
    'era_lore.sundering must still resolve to epo_DC/sundering.txt');

// === Контракт 5: prepareUnifiedPrompt использует era_lore.${eraId} runtime key ===
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
assert.match(script, /loadPromptFromFile\([`']era_lore\.\$\{eraId\}[`']\)/,
    'script.js must still call loadPromptFromFile("era_lore.${eraId}") — the runtime key the epo_DC/ files are registered under');

// === Контракт 6: total-conversion mod hook всё ещё пропускает vanilla era_lore ===
// (если бы нет, то epo_DC/ файлы ВСЕ РАВНО подменялись бы модом neon_siltlands_core,
// и баг вернулся бы. Проверяем, что mod-перехват есть в loadActiveEraLore.)
assert.match(script, /onEraLoreLoad/,
    'loadActiveEraLore must emit onEraLoreLoad mod hook (so modders can override if they want)');
assert.match(script, /isTotalConversion[\s\S]{0,200}?Пропуск загрузки ванильного лора эпохи/,
    'isTotalConversion short-circuit must skip vanilla era lore load');

// === Контракт 7: era_lore файлы достаточно велики для серьёзной палитры ===
// 350+ строк минимум, чтобы у GM была богатая бестиария и фракций база
// (а не пара строчек, после которых LLM начинает галлюцинировать).
for (const rel of eraFiles) {
    const abs = path.join(root, rel);
    const content = fs.readFileSync(abs, 'utf8');
    const lines = content.split('\n').length;
    assert.ok(lines >= 300,
        `${rel} should be at least 300 lines of era-lore content (got ${lines}). ` +
        `Bigger is better — provides GM with enough palette to avoid hallucinating terms.`);
}

// === Контракт 8: каждая эпоха имеет УНИКАЛЬНЫЙ бестиарий (минимум 80% уникальных имён) ===
// Это защита от регрессии к "единому лору" (когда все 4 файла имеют одинаковые звери/растения).
// Допускается до 20% пересечений (например, общие слова типа "Мох" или section headers).
function extractCreatureNames(content) {
    const lines = content.split('\n');
    const names = new Set();
    for (const line of lines) {
        const m = line.match(/^[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)*(?:\s+[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)*)*:/);
        if (!m) continue;
        const name = m[0].replace(':', '').trim();
        if (/^[IVX]+\./.test(name)) continue; // section headers like "I. ФАУНА"
        if (name.length < 3 || name.length > 50) continue;
        // Filter generic section names
        const sectionHeaders = ['Доспехи', 'Инструменты', 'Особое', 'Ближний бой', 'Дальний бой', 'Одежда', 'Еда', 'Язык', 'Игры', 'Ремёсла', 'Праздники'];
        if (sectionHeaders.includes(name)) continue;
        names.add(name);
    }
    return names;
}

const eraCorpus = {};
for (const rel of eraFiles) {
    const abs = path.join(root, rel);
    eraCorpus[rel] = extractCreatureNames(fs.readFileSync(abs, 'utf8'));
}

const eraKeys = Object.keys(eraCorpus);
for (let i = 0; i < eraKeys.length; i++) {
    for (let j = i + 1; j < eraKeys.length; j++) {
        const a = eraCorpus[eraKeys[i]];
        const b = eraCorpus[eraKeys[j]];
        const overlap = [...a].filter(x => b.has(x));
        const overlapPct = (overlap.length / Math.min(a.size, b.size)) * 100;
        assert.ok(overlapPct <= 20,
            `Cross-era overlap between ${eraKeys[i]} (${a.size} names) and ${eraKeys[j]} (${b.size} names) is ${overlapPct.toFixed(1)}% (max 20% allowed). ` +
            `Overlapping names: ${overlap.slice(0, 5).join(', ')}${overlap.length > 5 ? '...' : ''}. ` +
            `Each era must have its OWN unique bestiary — no shared creatures.`);
    }
}

// === Контракт 9: каждая эпоха имеет уникальные "фирменные" термины ===
// (защита от регрессии к единому лексикону)
const uniqueTermsByEra = {
    'assets/prompts/epo_DC/architects.txt': ['Рунный', 'Кристаллический', 'САМОСБОРКА', 'ПРЕОБРАЗОВАНИЕ', 'ТРАНСЦЕНДЕНЦИЯ'],
    'assets/prompts/epo_DC/rebirth.txt': ['Аквилон', 'Магистериум', 'КХАЗАДРИМ', 'СИЛЬВАНЕСТИЙСКИЙ', 'ГРОННАРСКАЯ'],
    'assets/prompts/epo_DC/silence.txt': ['Пепельный', 'Молчаливый', 'Безымянный', 'КУЛЬТ МОЛЧАНИЯ', 'Шрамовый'],
    'assets/prompts/epo_DC/sundering.txt': ['Падший', 'Костяной', 'Проклятый', 'БЕЗДНА-', 'КУЛЬТ РАСКОЛОТОГО'],
};
for (const [rel, terms] of Object.entries(uniqueTermsByEra)) {
    const abs = path.join(root, rel);
    const content = fs.readFileSync(abs, 'utf8');
    const missing = terms.filter(t => !content.includes(t));
    assert.strictEqual(missing.length, 0,
        `${rel} must contain era-unique signature terms: ${missing.join(', ')} missing. ` +
        `Each era must have its OWN distinct vocabulary (Architects = рунный/кристалл, Rebirth = Аквилон/Магистериум, Silence = пепельный/молчаливый, Sundering = падший/бездна).`);
}

console.log('OK | era_lore cyberpunk-removal contracts: all 9 checks passed');
