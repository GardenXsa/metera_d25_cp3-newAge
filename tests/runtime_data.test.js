const assert = require('assert');
const path = require('path');

const runtimeData = require(path.join(__dirname, '..', 'js', 'mods', 'runtimeData.js'));

function test(name, fn) {
    try {
        fn();
        console.log(`PASS ${name}`);
    } catch (error) {
        console.error(`FAIL ${name}: ${error.message}`);
        process.exitCode = 1;
    }
}

test('mergeRuntimeValue deep-merges dictionaries', () => {
    const merged = runtimeData.mergeRuntimeValue(
        { horse: { speedMultiplier: 2, cargoBonus: 5 } },
        { horse: { cargoBonus: 7 }, cart: { speedMultiplier: 1.2 } },
        { mergePolicy: 'deepMerge' }
    );

    assert.deepStrictEqual(merged, {
        horse: { speedMultiplier: 2, cargoBonus: 7 },
        cart: { speedMultiplier: 1.2 }
    });
});

test('mergeRuntimeValue upserts entity arrays by id', () => {
    const merged = runtimeData.mergeRuntimeValue(
        [{ id: 'rebirth', start_year: 1042 }, { id: 'silence', start_year: 215 }],
        [{ id: 'silence', default_location_file: 'locations_silence.json' }, { id: 'void_age', start_year: 999 }],
        { mergePolicy: 'upsertById' }
    );

    assert.deepStrictEqual(merged, [
        { id: 'rebirth', start_year: 1042 },
        { id: 'silence', start_year: 215, default_location_file: 'locations_silence.json' },
        { id: 'void_age', start_year: 999 }
    ]);
});

test('resolveEraLocationFile uses era metadata and shared fallback', () => {
    const result = runtimeData.resolveEraLocationFile(
        [
            { id: 'rebirth', default_location_file: 'locations_expanded.json' },
            { id: 'void_age' }
        ],
        'void_age',
        'locations_rebirth.json'
    );

    assert.strictEqual(result.fileName, 'locations_rebirth.json');
    assert.strictEqual(result.usedFallback, true);
    assert.ok(result.warning.includes('void_age'));
});

test('resolvePromptEntry accepts semantic keys and legacy paths', () => {
    const promptPack = {
        entries: {
            summarize_memory: { content: 'SUMMARIZE' }
        },
        aliases: {
            'assets/promts/summarize_memory_prompt.txt': 'summarize_memory'
        }
    };

    assert.strictEqual(
        runtimeData.resolvePromptEntry(promptPack, 'summarize_memory').content,
        'SUMMARIZE'
    );
    assert.strictEqual(
        runtimeData.resolvePromptEntry(promptPack, 'assets/promts/summarize_memory_prompt.txt').content,
        'SUMMARIZE'
    );
});

if (process.exitCode) {
    process.exit(process.exitCode);
}
