/**
 * LIVE TEST: Drive actual Electron game via Chrome DevTools Protocol
 * Uses correct selectors from index.html (#game-log, #send-button, etc.)
 */
'use strict';
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ELECTRON_BIN = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const CDP_URL = 'http://127.0.0.1:9222';
const DEBUG_PORT = 9222;

const LLMOST_KEY = 'YOUR_LLMOST_KEY';
const MODEL = 'google/gemini-3.1-flash-lite-preview-20260303';
const MAX_TURNS = 15;
const SHOTS = path.join(ROOT, 'tests', 'live_screenshots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
for (const f of fs.readdirSync(SHOTS)) if (f.endsWith('.png') || f.endsWith('.log') || f.endsWith('.json')) fs.unlinkSync(path.join(SHOTS, f));

const log = [];
function L(s) { const t = new Date().toISOString().split('T')[1].slice(0, 8); const line = `[${t}] ${s}`; console.log(line); log.push(line); }
async function shot(page, name) {
    try { await page.screenshot({ path: path.join(SHOTS, name) }); L(`📸 ${name}`); }
    catch (e) { L(`shot err: ${e.message}`); }
}
async function ev(page, fn, ...args) { return await page.evaluate(fn, ...args); }

async function probeGameLog(page) {
    return await ev(page, () => {
        const log = document.getElementById('game-log');
        return { len: log ? (log.textContent || '').length : 0, html: log ? log.innerHTML.slice(-2000) : '' };
    });
}

async function probeState(page) {
    return await ev(page, () => {
        const p = window.player || {};
        return {
            name: p.name, cls: p.class,
            hp: p.stats?.hp, maxHp: p.stats?.maxHp, mana: p.stats?.mana,
            gold: p.stats?.gold, level: p.stats?.level,
            loc: p.location,
            inCombat: !!p.currentCombat?.isActive,
            lastEnemyTurn: p.currentCombat?.lastEnemyTurn || null,
        };
    });
}

async function waitForResponse(page, baselineLen, maxMs = 180000) {
    const start = Date.now();
    let lastLen = baselineLen;
    let lastHtml = '';
    while (Date.now() - start < maxMs) {
        await new Promise(r => setTimeout(r, 2500));
        const { len, html } = await probeGameLog(page);
        // GM response = length grew by >= 80 chars and input is no longer disabled
        const inputDisabled = await ev(page, () => document.getElementById('user-input')?.disabled);
        if (len > lastLen + 80 && !inputDisabled) {
            // wait for the response to fully stream in
            await new Promise(r => setTimeout(r, 3000));
            const final = await probeGameLog(page);
            L(`  ✓ response: ${lastLen} → ${final.len} (Δ${final.len - lastLen}) after ${Math.round((Date.now() - start) / 1000)}s`);
            return { ok: true, len: final.len, html: final.html, text: (await ev(page, () => document.getElementById('game-log')?.textContent || '')).slice(-3000) };
        }
        lastLen = Math.max(lastLen, len);
        if (html !== lastHtml) lastHtml = html;
        if (Date.now() - start > 30000 && inputDisabled) {
            // still disabled after 30s — print diagnostics
            const probe = await ev(page, () => {
                const err = document.getElementById('ai-error-message');
                const err2 = document.querySelector('.ai-error, .error-banner, [class*="error"]');
                return { aiErr: err?.textContent, anyErr: err2?.textContent, bodyText: document.body.textContent.includes('ошибк') ? 'has_error_keyword' : 'clean' };
            });
            L(`  ⏳ still waiting (${Math.round((Date.now() - start) / 1000)}s) — input locked, diag: ${JSON.stringify(probe)}`);
        }
    }
    return { ok: false, reason: 'timeout' };
}

async function submitAction(page, text) {
    return await ev(page, (t) => {
        const inp = document.getElementById('user-input');
        if (!inp) return { ok: false, reason: 'no_input' };
        inp.focus();
        inp.value = t;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        const btn = document.getElementById('send-button');
        if (btn) { btn.click(); return { ok: true, method: 'send-button' }; }
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        return { ok: true, method: 'enter' };
    }, text);
}

(async () => {
    L('=== LIVE TEST START ===');

    // Launch Electron
    L('Launching Electron...');
    const proc = spawn(ELECTRON_BIN, ['.', `--remote-debugging-port=${DEBUG_PORT}`], {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
        env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
    });
    let procOut = '';
    proc.stdout.on('data', d => procOut += d);
    proc.stderr.on('data', d => procOut += d);

    for (let i = 0; i < 60; i++) {
        try { const r = await fetch(`${CDP_URL}/json/version`); if (r.ok) { L('CDP ready'); break; } } catch {}
        await new Promise(r => setTimeout(r, 1000));
    }

    let browser, page;
    try {
        browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null });
        const pages = await browser.pages();
        page = pages.find(p => p.url().startsWith('http')) || pages[0];
        L(`Page: ${page.url()}`);
    } catch (e) { L(`connect err: ${e.message}`); proc.kill(); process.exit(1); }

    page.on('pageerror', err => L(`[PAGE ERR] ${err.message}`));

    await new Promise(r => setTimeout(r, 4000));
    await shot(page, '00_loaded.png');

    // === Configure LLMost ===
    L('Configuring LLMost...');
    // The settings is a screen; navigate to it
    await ev(page, () => {
        const target = document.querySelector('[data-target="settings-screen"]');
        if (target) target.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    await ev(page, () => {
        const sel = document.getElementById('api-provider-select');
        if (sel) { sel.value = 'llmost'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await new Promise(r => setTimeout(r, 800));

    await ev(page, (k) => {
        const inp = document.getElementById('llmost-api-key-input');
        if (inp) { inp.value = k; inp.dispatchEvent(new Event('input', { bubbles: true })); }
    }, LLMOST_KEY);

    await ev(page, (m) => {
        const inp = document.getElementById('model-id-input');
        if (inp) { inp.value = m; inp.dispatchEvent(new Event('input', { bubbles: true })); }
    }, MODEL);

    await shot(page, '01_configured.png');
    L('Provider/key/model set');

    // Save settings (find the right button)
    await ev(page, () => {
        const btns = Array.from(document.querySelectorAll('button'));
        const save = btns.find(b => /сохран|save/i.test(b.textContent)) || document.getElementById('save-settings-button');
        if (save) save.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    // === Quick start ===
    L('Starting new game (quick start)...');
    await ev(page, () => document.getElementById('new-game-button')?.click());
    await new Promise(r => setTimeout(r, 2000));
    await shot(page, '02_char_creation.png');

    await ev(page, () => document.getElementById('quick-start-button')?.click());
    L('Quick start clicked');

    // Wait for game to fully load + first narrative
    await new Promise(r => setTimeout(r, 6000));
    await shot(page, '03_after_quickstart.png');

    const s0 = await probeState(page);
    L(`Initial state: ${JSON.stringify(s0)}`);

    let baselineLogLen = (await probeGameLog(page)).len;
    L(`Initial game-log length: ${baselineLogLen}`);

    // === Play 15 turns ===
    const actions = [
        'Осмотреться вокруг.',
        'Поприветствовать ближайшего человека.',
        'Спросить, что здесь происходит.',
        'Использовать удар мечом по врагу.',
        'Осмотреть комнату на предмет сундуков и дверей.',
        'Открыть дверь.',
        'Войти в следующую зону и осмотреться.',
        'Атаковать первого враждебного NPC мечом.',
        'Продолжить бой.',
        'Подобрать выпавший лут.',
        'Восстановить здоровье, если нужно.',
        'Поговорить с мирными NPC.',
        'Идти к следующей локации.',
        'Подготовиться к путешествию.',
        'Сохранить игру.'
    ];

    const turnData = [];
    const bugs = [];

    for (let turn = 1; turn <= MAX_TURNS; turn++) {
        L(`\n========== TURN ${turn}/${MAX_TURNS} ==========`);
        const action = actions[turn - 1];
        L(`→ ${action}`);

        const before = await probeState(page);
        const sub = await submitAction(page, action);
        L(`  submit: ${JSON.stringify(sub)}`);

        const resp = await waitForResponse(page, baselineLogLen);
        baselineLogLen = resp.len || baselineLogLen;

        if (!resp.ok) {
            L(`❌ T${turn} timeout`);
            await shot(page, `T${turn}_TIMEOUT.png`);
            break;
        }

        await shot(page, `T${turn}.png`);
        const after = await probeState(page);
        L(`  state: HP=${after.hp}/${after.maxHp}, mana=${after.mana}, combat=${after.inCombat}, lastDmg=${after.lastEnemyTurn?.totalDamage}`);

        // === BUG CHECKS ===
        if (before.hp != null && after.hp != null) {
            const dHp = before.hp - after.hp;
            if (dHp > 0) L(`  HP Δ=${-dHp}`);
            if (dHp > 40) { bugs.push({ turn, kind: 'big_hp_drop', from: before.hp, to: after.hp }); L(`  🚨 big HP drop in one turn`); }
        }
        if (after.hp != null && after.hp < 0) { bugs.push({ turn, kind: 'negative_hp', hp: after.hp }); L(`  🚨 NEGATIVE HP`); }
        if (after.lastEnemyTurn && after.lastEnemyTurn.totalDamage > 30) {
            L(`  ⚠️ single enemy turn dealt ${after.lastEnemyTurn.totalDamage} dmg — check for double-application`);
            bugs.push({ turn, kind: 'big_enemy_dmg', dmg: after.lastEnemyTurn.totalDamage });
        }
        turnData.push({ turn, action, before, after, text: resp.text?.slice(-400) });
    }

    // === Final report ===
    L('\n=========== SUMMARY ===========');
    L(`Turns played: ${turnData.length}`);
    L(`Bug observations: ${bugs.length}`);
    for (const b of bugs) L(`  - T${b.turn}: ${JSON.stringify(b)}`);

    fs.writeFileSync(path.join(SHOTS, 'session.log'), log.join('\n'));
    fs.writeFileSync(path.join(SHOTS, 'turns.json'), JSON.stringify(turnData, null, 2));
    fs.writeFileSync(path.join(SHOTS, 'bugs.json'), JSON.stringify(bugs, null, 2));
    fs.writeFileSync(path.join(SHOTS, 'proc.log'), procOut.slice(-10000));

    L('Keeping app alive 5s...');
    await new Promise(r => setTimeout(r, 5000));
    await browser.disconnect();
    proc.kill();
    L('=== DONE ===');
    process.exit(0);
})().catch(e => {
    console.error('FATAL:', e);
    fs.writeFileSync(path.join(SHOTS, 'fatal.log'), (e.stack || String(e)) + '\n\n' + log.join('\n'));
    process.exit(1);
});

