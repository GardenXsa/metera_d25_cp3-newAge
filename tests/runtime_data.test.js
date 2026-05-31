const assert = require('assert');
const path = require('path');
const fs = require('fs');

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
            'assets/prompts/summarize_memory_prompt.txt': 'summarize_memory'
        }
    };

    assert.strictEqual(
        runtimeData.resolvePromptEntry(promptPack, 'summarize_memory').content,
        'SUMMARIZE'
    );
    assert.strictEqual(
        runtimeData.resolvePromptEntry(promptPack, 'assets/prompts/summarize_memory_prompt.txt').content,
        'SUMMARIZE'
    );
});

test('normalizeRuntimeManifest applies descriptor defaults and alias mapping', () => {
    const normalized = runtimeData.normalizeRuntimeManifest({
        modding_contract: {
            descriptor_defaults: {
                owner: 'base_game',
                source: 'base_data',
                required: true
            }
        },
        database_files: {
            items: {
                path: './data/economy_items.json',
                default_type: 'object',
                merge_policy: 'deepMerge',
                key_aliases: ['economy_items'],
                replace_on_total_conversion: true
            },
            recipes: {
                path: './data/economy_recipes.json',
                default_type: 'array',
                merge_policy: 'append',
                owner: 'custom_owner',
                source: 'mod_layer',
                required: false
            }
        }
    });

    assert.strictEqual(normalized.databaseFiles.items.owner, 'base_game');
    assert.strictEqual(normalized.databaseFiles.items.source, 'base_data');
    assert.strictEqual(normalized.databaseFiles.items.required, true);
    assert.deepStrictEqual(normalized.databaseFiles.items.key_aliases, ['economy_items']);
    assert.strictEqual(normalized.databaseFiles.items.replace_on_total_conversion, true);

    assert.strictEqual(normalized.databaseFiles.recipes.owner, 'custom_owner');
    assert.strictEqual(normalized.databaseFiles.recipes.source, 'mod_layer');
    assert.strictEqual(normalized.databaseFiles.recipes.required, false);
    assert.strictEqual(normalized.aliasToRuntimeKey.economy_items, 'items');
    assert.strictEqual(normalized.aliasToRuntimeKey.items, 'items');
});

test('resolveRuntimeDatabaseKey and getRuntimeDatabaseDescriptor support aliases', () => {
    const manifest = {
        modding_contract: {
            descriptor_defaults: {
                owner: 'base_game',
                source: 'base_data',
                required: true
            }
        },
        database_files: {
            facilities: {
                path: './data/facility_names.json',
                default_type: 'object',
                merge_policy: 'deepMerge',
                key_aliases: ['facility_names']
            }
        }
    };

    assert.strictEqual(runtimeData.resolveRuntimeDatabaseKey('facility_names', manifest), 'facilities');
    assert.strictEqual(runtimeData.resolveRuntimeDatabaseKey('facilities', manifest), 'facilities');
    assert.strictEqual(runtimeData.resolveRuntimeDatabaseKey('unknown_key', manifest), 'unknown_key');

    const descriptor = runtimeData.getRuntimeDatabaseDescriptor('facility_names', manifest);
    assert.strictEqual(descriptor.runtime_key, 'facilities');
    assert.strictEqual(descriptor.path, './data/facility_names.json');
    assert.strictEqual(descriptor.owner, 'base_game');
});

test('script gameplay commands do not rely on legacy hardcoded defaults', () => {
    const scriptSource = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
    const forbiddenPatterns = [
        /args\.maxWeight\s*\|\|\s*100/,
        /args\.maxSlots\s*\|\|\s*30/,
        /player\.bankAccount\.loanDays\s*=\s*args\.days\s*\|\|\s*14/,
        /requiredProgress:\s*args\.requiredProgress\s*\|\|\s*60/,
        /progressPerDay:\s*args\.progressPerDay\s*\|\|\s*5/,
        /discoveryChance:\s*args\.discoveryChance\s*\|\|\s*3/,
        /const resilience = player\.stats\.res\s*\|\|\s*10/,
        /item\.durability\s*=\s*\(item\.durability\s*\|\|\s*100\)\s*\+\s*change/,
        /player\.stats\.con\s*\|\|\s*10/,
        /player\.stats\.dex\s*\|\|\s*10/,
        /player\.stats\.cha\s*\|\|\s*10/,
        /hp:\s*en\.hp\s*\|\|\s*20/,
        /maxHp:\s*en\.hp\s*\|\|\s*20/,
        /xpReward:\s*30/,
        /args\.minDamage\s*\|\|\s*args\.min_damage\s*\|\|\s*1\s*\+/,
        /args\.armorClass\s*\|\|\s*args\.armor_class\s*\|\|\s*10\s*\+/,
        /stats:\s*\{\s*hp:\s*args\.hp\s*\?\?\s*10,\s*maxHp:\s*args\.maxHp\s*\?\?\s*10,\s*str:\s*args\.str\s*\?\?\s*10,\s*dex:\s*args\.dex\s*\?\?\s*10,\s*con:\s*args\.con\s*\?\?\s*10,\s*int:\s*args\.int\s*\?\?\s*10\s*\}/,
        /stats:\s*\{\s*hp:\s*80,\s*maxHp:\s*80,\s*str:\s*10,\s*dex:\s*10,\s*int:\s*14,\s*con:\s*12,\s*cha:\s*16,\s*res:\s*10\s*\}/,
        /xpReward:\s*1000/,
        /bus\.wage_level\s*\|\|\s*100/,
        /bus\.maintenance_budget\s*\|\|\s*100/,
        /Math\.floor\(Math\.random\(\)\s*\*\s*40\)\s*\+\s*40/,
        /Math\.floor\(Math\.random\(\)\s*\*\s*40\)\s*\+\s*30/,
        /50\s*\+\s*Math\.floor\(Math\.random\(\)\s*\*\s*40\)/,
        /health:\s*100/,
        /needs:\s*\{\s*hunger:\s*100,\s*rest:\s*100,\s*social:\s*100,\s*safety:\s*100\s*\}/,
        /inventory:\s*\{\s*gold:\s*10000,\s*items:\s*\{\}\s*\}/,
        /dailyWage:\s*500/,
        /savings:\s*50000/,
        /plotArmor:\s*true/,
        /Math\.floor\(Math\.random\(\)\s*\*\s*900\)\s*\+\s*100/,
        /Math\.floor\(Math\.random\(\)\s*\*\s*20\)\s*\+\s*1/,
        /markets\.bread\s*\|\|\s*5/,
        /markets\.wood\s*\|\|\s*2/,
        /markets\.iron_ore\s*\|\|\s*3/,
        /markets\.weapons\s*\|\|\s*40/,
        /gold:\s*0,/,
        /population_soldier_ratio,\s*0\.1/,
        /food_per_soldier,\s*0\.5/,
        /weight_per_unit\s*\|\|\s*1/,
        /quality:\s*args\.quality\s*\|\|\s*1/,
        /quantity:\s*args\.quantity\s*\|\|\s*1/,
        /parseInt\(item\.max,\s*10\)\s*\|\|\s*5/,
        /basePrice\s*\|\|\s*1/,
        /selectedEvent\.amount\s*\|\|\s*1/,
        /50\s*\*\s*\(player\.stats\.level\s*\|\|\s*1\)/,
        /applyDisease\(args\.severity\s*\|\|\s*2\)/
    ];

    forbiddenPatterns.forEach((pattern) => {
        assert.ok(!pattern.test(scriptSource), `Forbidden gameplay hardcode remains: ${pattern}`);
    });
});

if (process.exitCode) {
    process.exit(process.exitCode);
}
