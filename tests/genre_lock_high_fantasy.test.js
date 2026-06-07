#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

// === Контракт 1: hard_protocol.txt содержит GENRE LOCK секцию ===
const hardProtocol = fs.readFileSync(path.join(root, 'assets/prompts/hard_protocol.txt'), 'utf8');
assert.match(hardProtocol, /GENRE LOCK[^\n]*HIGH FANTASY/,
    'hard_protocol.txt must contain "GENRE LOCK — HIGH FANTASY" header');
assert.match(hardProtocol, /КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО/,
    'hard_protocol.txt must contain explicit "CATEGORICALLY FORBIDDEN" list');
assert.match(hardProtocol, /магические винтовки/,
    'hard_protocol.txt must explicitly forbid "магические винтовки" (the #1 GM hallucination)');
assert.match(hardProtocol, /вокодер/,
    'hard_protocol.txt must explicitly forbid "вокодер"');
assert.match(hardProtocol, /прожектор/,
    'hard_protocol.txt must explicitly forbid "прожектор"');
assert.match(hardProtocol, /Синдикат/,
    'hard_protocol.txt must explicitly forbid "Синдикат"');
assert.match(hardProtocol, /Карцер/,
    'hard_protocol.txt must explicitly forbid "Карцер"');

// === Контракт 2: hard_protocol.txt должен перечислять fantasy-альтернативы ===
assert.match(hardProtocol, /меч/,
    'hard_protocol.txt must suggest fantasy weapon "меч" as replacement');
assert.match(hardProtocol, /факел/,
    'hard_protocol.txt must suggest fantasy light source "факел" as replacement');
assert.match(hardProtocol, /темниц/,
    'hard_protocol.txt must suggest fantasy prison "темница" as replacement');

// === Контракт 3: narrative_rules.txt НЕ должен содержать "неонового света" ===
// (это был главный источник sci-fi hallucinations)
const narrativeRules = fs.readFileSync(path.join(root, 'assets/prompts/narrative_rules.txt'), 'utf8');
assert.ok(!narrativeRules.includes('неонового света'),
    'narrative_rules.txt must NOT contain "неонового света" (was the #1 sci-fi seed)');
assert.ok(!narrativeRules.includes('неонов'),
    'narrative_rules.txt must NOT contain any form of "неон" (neon)');
assert.ok(!narrativeRules.includes('прожектор'),
    'narrative_rules.txt must NOT contain "прожектор"');

// === Контракт 4: narrative_rules.txt должен использовать fantasy-свет ===
assert.match(narrativeRules, /магическ(ого|их) огн/,
    'narrative_rules.txt must reference "магический огонь" or similar fantasy light');
assert.match(narrativeRules, /факел/,
    'narrative_rules.txt should mention "факел" as a fantasy light source');

// === Контракт 5: проверяем, что ни в одном prompt-файле нет sci-fi-семян ===
// (исключая docs/, scan-файлы и тесты)
const sciFiSeeds = ['магических винтовок', 'магических прожекторов', 'неонового света', 'неоновой вспышки', 'Коллегия Некро-инженеров'];
const promptFiles = [
    'assets/prompts/narrative_rules.txt',
    'assets/prompts/hard_protocol.txt',
    'assets/prompts/combat_system_rules.txt',
    'assets/prompts/command_reference.txt',
    'assets/prompts/auto_tester_prompt.txt',
    'assets/prompts/environment_commands_guide.txt',
    'assets/prompts/game_loop.txt',
    'assets/prompts/logic_rules.txt',
    'assets/prompts/1.txt',
    'assets/prompts/initial_prompt_architects.txt',
    'assets/prompts/initial_prompt_rebirth.txt',
    'assets/prompts/initial_prompt_silence.txt',
    'assets/prompts/initial_prompt_sundering.txt',
    'assets/prompts/deep_setup/stage1_lore.txt',
    'assets/prompts/deep_setup/stage2_loot.txt',
    'assets/prompts/deep_setup/stage3_environment.txt',
    'assets/prompts/deep_setup/stage4_quests.txt',
    'assets/prompts/deep_setup/stage5_prologue.txt',
];
let sciFiHits = [];
for (const rel of promptFiles) {
    const abs = path.join(root, rel);
    try {
        const c = fs.readFileSync(abs, 'utf8');
        for (const seed of sciFiSeeds) {
            // hard_protocol.txt is allowed to forbid these (the GENRE LOCK section)
            if (rel === 'assets/prompts/hard_protocol.txt') continue;
            if (c.includes(seed)) {
                sciFiHits.push(`${rel}: contains forbidden seed "${seed}"`);
            }
        }
    } catch (e) { /* file might not exist */ }
}
assert.strictEqual(sciFiHits.length, 0,
    `Found ${sciFiHits.length} sci-fi seed(s) in non-lock prompt files:\n  ${sciFiHits.join('\n  ')}`);

// === Контракт 6: GENRE LOCK имеет приоритет над style advice ===
// (отражено в формулировке: "ПРИОРИТЕТ НАД ВСЕМИ СТИЛИСТИЧЕСКИМИ ИНСТРУКЦИЯМИ")
assert.match(hardProtocol, /ПРИОРИТЕТ НАД ВСЕМИ СТИЛИСТИЧЕСКИМИ ИНСТРУКЦИЯМИ/,
    'GENRE LOCK must explicitly claim priority over all stylistic instructions');

// === Контракт 7: GENRE LOCK содержит раздел "ЗАМЕНИ" (recovery) ===
// Если модель всё же сгенерирует sci-fi, у неё должна быть инструкция заменить.
assert.match(hardProtocol, /ЗАМЕНИ.*синоним/,
    'GENRE LOCK must include recovery rule: replace sci-fi with fantasy synonym in same paragraph');

console.log('OK | genre_lock_high_fantasy contracts: all 7 checks passed');
