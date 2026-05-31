#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const warnings = [];

function readJson(projectPath) {
  const absolute = path.join(ROOT, projectPath);
  try {
    return JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch (error) {
    errors.push(`${projectPath}: ${error.message}`);
    return null;
  }
}

function hasObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function getPath(root, pathName) {
  return pathName.split('.').reduce((cursor, key) => cursor && cursor[key], root);
}

function checkObject(root, pathName) {
  const value = getPath(root, pathName);
  if (!hasObject(value)) errors.push(`${pathName} must be an object`);
  return value;
}

function checkArray(root, pathName) {
  const value = getPath(root, pathName);
  if (!Array.isArray(value)) errors.push(`${pathName} must be an array`);
  return value;
}

function checkString(root, pathName) {
  const value = getPath(root, pathName);
  if (typeof value !== 'string' || value.length === 0) errors.push(`${pathName} must be a non-empty string`);
  return value;
}

function checkNumber(root, pathName, options = {}) {
  const value = getPath(root, pathName);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${pathName} must be a finite number`);
    return value;
  }
  if (options.min !== undefined && value < options.min) errors.push(`${pathName} must be >= ${options.min}`);
  if (options.max !== undefined && value > options.max) errors.push(`${pathName} must be <= ${options.max}`);
  return value;
}

function checkBoolean(root, pathName) {
  const value = getPath(root, pathName);
  if (typeof value !== 'boolean') errors.push(`${pathName} must be boolean`);
  return value;
}

function checkStringArray(root, pathName) {
  const value = checkArray(root, pathName);
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (typeof item !== 'string' || item.length === 0) errors.push(`${pathName}[${index}] must be a non-empty string`);
    });
  }
  return value;
}

function checkUiRuntime(config) {
  if (!config) return;
  checkNumber(config, 'version', { min: 1 });
  checkObject(config, 'debug');
  checkString(config, 'debug.enabled_in_node_env');
  checkBoolean(config, 'debug.fallback');
  checkObject(config, 'save');
  checkString(config, 'save.file_prefix');
  checkString(config, 'save.file_extension');
  checkString(config, 'save.storage_key');
  checkNumber(config, 'save.max_manual_saves', { min: 0 });
  checkNumber(config, 'save.max_auto_saves', { min: 0 });
  checkNumber(config, 'save.autosave_interval_ms', { min: 0 });
  checkObject(config, 'memory');
  checkNumber(config, 'memory.max_history_pairs', { min: 0 });
  checkNumber(config, 'memory.summary_turn', { min: 0 });
  checkNumber(config, 'memory.prune_turn', { min: 0 });
  checkNumber(config, 'memory.echo_memory_max_items', { min: 0 });
  checkNumber(config, 'memory.echo_memory_max_length', { min: 0 });
  checkObject(config, 'progression');
  checkNumber(config, 'progression.initial_stat_points', { min: 0 });
  checkNumber(config, 'progression.points_per_level', { min: 0 });
  checkString(config, 'world.default_world_id');
  checkString(config, 'language.storage_key');
  checkString(config, 'language.default');
  checkString(config, 'audio.sound_folder_path');
  checkStringArray(config, 'audio.music_files');
  checkNumber(config, 'audio.default_music_volume', { min: 0, max: 1 });
  checkNumber(config, 'audio.default_sfx_volume', { min: 0, max: 1 });
  checkStringArray(config, 'backgrounds.files');
  checkNumber(config, 'backgrounds.change_interval_ms', { min: 0 });
}

function checkElectronRuntime(config) {
  if (!config) return;
  checkNumber(config, 'version', { min: 1 });
  ['paths.saves_dir', 'paths.mods_dir', 'paths.settings_file', 'paths.worlds_dir'].forEach(key => checkString(config, key));
  checkString(config, 'server.host');
  checkNumber(config, 'server.port', { min: 1 });
  checkNumber(config, 'server.session_token_bytes', { min: 1 });
  checkString(config, 'server.session_token_encoding');
  checkStringArray(config, 'server.localhost_ips');
  checkNumber(config, 'server.local_rate_limit.window_ms', { min: 1 });
  checkNumber(config, 'server.local_rate_limit.max_requests', { min: 1 });
  checkNumber(config, 'server.remote_rate_limit.window_ms', { min: 1 });
  checkNumber(config, 'server.remote_rate_limit.max_requests', { min: 1 });
  checkNumber(config, 'server.rate_limit_entry_ttl_ms', { min: 1 });
  checkNumber(config, 'server.rate_limit_cleanup_interval_ms', { min: 1 });
  checkString(config, 'server.safe_json_filename_pattern');
  checkStringArray(config, 'server.sensitive_files');
  checkStringArray(config, 'server.sensitive_path_substrings');
  checkNumber(config, 'server.max_static_file_size_bytes', { min: 1 });
  checkNumber(config, 'server.max_append_save_line_bytes', { min: 1 });
  checkNumber(config, 'server.max_read_save_chunk_bytes', { min: 1 });
  checkNumber(config, 'server.world_preview_bytes', { min: 1 });
  checkNumber(config, 'server.save_preview_bytes', { min: 1 });
  checkObject(config, 'server.mime_types');
  checkObject(config, 'server.csp_external_sources');
  checkNumber(config, 'window.width', { min: 1 });
  checkNumber(config, 'window.height', { min: 1 });
  checkBoolean(config, 'window.node_integration');
  checkBoolean(config, 'window.context_isolation');
  checkBoolean(config, 'window.disable_web_security_in_development');
  checkString(config, 'window.preload_file');
  checkStringArray(config, 'window.external_link_protocols');
  checkObject(config, 'engine.binary_names');
  checkObject(config, 'engine.timeouts_ms');
  checkObject(config, 'engine.command_timeouts_ms');
  checkString(config, 'engine.sync_temp_file_name');
  checkNumber(config, 'engine.realtime_default_interval_ms', { min: 0 });
  checkStringArray(config, 'engine.allowed_raw_commands');
  checkObject(config, 'gemini.generation_config');
  checkNumber(config, 'gemini.generation_config.maxOutputTokens', { min: 1 });
  checkNumber(config, 'gemini.generation_config.temperature', { min: 0 });
  checkNumber(config, 'gemini.generation_config.topP', { min: 0, max: 1 });
  checkString(config, 'gemini.default_safety_threshold');
}

function checkPromptRuntime(config) {
  if (!config) return;
  checkNumber(config, 'version', { min: 1 });
  checkObject(config, 'prompt_files');
  [
    'logic_rules',
    'narrative_rules',
    'master_instructions',
    'rules_and_instructions',
    'combat_rules',
    'environment_commands_guide',
    'skills_reference',
    'supreme_gm_style',
    'nsfw_rules_advanced'
  ].forEach(key => checkString(config, `prompt_files.${key}`));
  checkString(config, 'image_generation.prompt_field_template');
  checkString(config, 'image_generation.format_field_template');
  checkObject(config, 'response_languages');
  checkString(config, 'response_languages.default');
  checkNumber(config, 'unified_response.default_time_passed.days', { min: 0 });
  checkNumber(config, 'unified_response.default_time_passed.hours', { min: 0 });
  checkNumber(config, 'unified_response.default_time_passed.minutes', { min: 0 });
  checkObject(config, 'unified_response.suggested_action_template');
  checkObject(config, 'fallback_texts');
  checkObject(config, 'injection_headers');
  checkString(config, 'command_parser.start_tag');
  checkString(config, 'command_parser.end_tag');
  checkString(config, 'command_parser.delimiter');
}

function checkGameplayRuntime(config) {
  if (!config) return;
  checkNumber(config, 'version', { min: 1 });
  checkObject(config, 'progression');
  checkNumber(config, 'progression.mana.base', { min: 0 });
  checkNumber(config, 'progression.mana.int_baseline');
  checkNumber(config, 'progression.mana.level_bonus', { min: 0 });
  checkNumber(config, 'progression.mana.minimum', { min: 0 });
  checkNumber(config, 'progression.hp.base', { min: 0 });
  checkNumber(config, 'progression.hp.constitution_baseline');
  checkNumber(config, 'progression.hp.constitution_divisor', { min: 1 });
  checkNumber(config, 'progression.hp.level_bonus', { min: 0 });
  checkNumber(config, 'progression.hp.minimum', { min: 0 });
  checkNumber(config, 'character_creation.inventory_capacity.base', { min: 0 });
  checkNumber(config, 'character_creation.inventory_capacity.strength_baseline');
  checkNumber(config, 'character_creation.inventory_capacity.strength_divisor', { min: 1 });
  checkNumber(config, 'calendar.fallback_start_year');
  checkNumber(config, 'calendar.months_per_year', { min: 1 });
  checkNumber(config, 'calendar.max_initial_day', { min: 1 });
  checkNumber(config, 'calendar.days_per_year', { min: 1 });
  checkNumber(config, 'calendar.days_per_month', { min: 1 });
  checkNumber(config, 'calendar.initial_hour', { min: 0 });
  checkNumber(config, 'calendar.initial_minute', { min: 0 });
  checkNumber(config, 'calendar.initial_total_pulses', { min: 0 });
  checkNumber(config, 'world_bootstrap.minimum_days', { min: 0 });
  checkNumber(config, 'world_bootstrap.base_days', { min: 0 });
  checkNumber(config, 'world_bootstrap.population_divisor', { min: 1 });

  checkString(config, 'inventory_building.resource_prototype_id');
  checkNumber(config, 'inventory_building.resource_cost', { min: 1 });
  checkNumber(config, 'inventory_building.default_max_weight_kg', { min: 1 });
  checkNumber(config, 'inventory_building.default_max_slots', { min: 1 });
  const buildCoords = checkArray(config, 'inventory_building.default_world_coords');
  if (Array.isArray(buildCoords)) {
    if (buildCoords.length !== 3) errors.push('inventory_building.default_world_coords must contain exactly 3 numbers');
    buildCoords.forEach((value, index) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`inventory_building.default_world_coords[${index}] must be a finite number`);
    });
  }

  checkNumber(config, 'inventory_movement.full_stack_quantity_sentinel');
  checkString(config, 'inventory_movement.stack_size_field');
  checkString(config, 'inventory_movement.states.default');
  checkString(config, 'inventory_movement.states.trade_locked');
  checkString(config, 'inventory_movement.resource_debit_source_container_type');
  checkObject(config, 'inventory_movement.transfer_options');
  ['system_full_access', 'system_ignore_access', 'system_ignore_access_only', 'player_ui'].forEach((key) => {
    checkObject(config, `inventory_movement.transfer_options.${key}`);
    checkString(config, `inventory_movement.transfer_options.${key}.actor`);
  });
  checkObject(config, 'inventory_commands');
  ['create_container', 'create_item', 'update_container_location', 'add_item', 'remove_item', 'move_item', 'move_items', 'destroy_container', 'equip_item', 'unequip_item', 'update_item_stat'].forEach((key) => checkString(config, `inventory_commands.${key}`));
  checkString(config, 'inventory_loot.event_type');
  checkNumber(config, 'inventory_loot.default_quantity', { min: 1 });
  checkString(config, 'inventory_loot.fallback_item_name');
  checkNumber(config, 'item_display.clock_max_segments', { min: 1 });
  checkString(config, 'inventory_unlock.lockpick_prototype_id');
  checkString(config, 'inventory_unlock.ability_stat');
  checkNumber(config, 'inventory_unlock.ability_baseline');
  checkNumber(config, 'inventory_unlock.ability_divisor', { min: 1 });
  checkObject(config, 'inventory_feedback.inventory_errors');
  checkObject(config, 'inventory_feedback.trade_errors');
  ['item_not_found', 'source_container_not_found', 'target_container_not_found', 'invalid_quantity', 'unknown_command', 'not_locked_or_not_found', 'unlock_success', 'lockpick_broke'].forEach((key) => checkString(config, `inventory_feedback.inventory_errors.${key}`));
  ['merchant_container_not_found', 'trade_not_found', 'trade_empty', 'trade_too_far', 'failed_lock_trade_item'].forEach((key) => checkString(config, `inventory_feedback.trade_errors.${key}`));
  checkNumber(config, 'survival.trauma.resilience_baseline');
  checkNumber(config, 'command_defaults.create_container.max_weight_kg', { min: 1 });
  checkNumber(config, 'command_defaults.create_container.max_slots', { min: 1 });
  checkNumber(config, 'command_defaults.bank_loan.default_days', { min: 1 });
  checkNumber(config, 'command_defaults.intrigue.required_progress', { min: 0 });
  checkNumber(config, 'command_defaults.intrigue.progress_per_day', { min: 0 });
  checkNumber(config, 'command_defaults.intrigue.discovery_chance', { min: 0 });
  checkNumber(config, 'command_defaults.business.default_wage_level_percent', { min: 0 });
  checkNumber(config, 'command_defaults.business.default_maintenance_budget_percent', { min: 0 });
  checkNumber(config, 'command_defaults.ruler_entity.stats.hp', { min: 0 });
  checkNumber(config, 'command_defaults.ruler_entity.stats.strength');
  checkNumber(config, 'command_defaults.ruler_entity.stats.dexterity');
  checkNumber(config, 'command_defaults.ruler_entity.stats.intelligence');
  checkNumber(config, 'command_defaults.ruler_entity.stats.constitution');
  checkNumber(config, 'command_defaults.ruler_entity.stats.charisma');
  checkNumber(config, 'command_defaults.ruler_entity.stats.resilience');
  checkNumber(config, 'command_defaults.ruler_entity.xp_reward', { min: 0 });
  checkNumber(config, 'command_defaults.ruler_entity.health_percent', { min: 0 });
  checkNumber(config, 'command_defaults.ruler_entity.personality.ambition_min');
  checkNumber(config, 'command_defaults.ruler_entity.personality.ambition_range', { min: 0 });
  checkNumber(config, 'command_defaults.ruler_entity.personality.paranoia_min');
  checkNumber(config, 'command_defaults.ruler_entity.personality.paranoia_range', { min: 0 });
  checkNumber(config, 'command_defaults.ruler_entity.personality.wisdom_min');
  checkNumber(config, 'command_defaults.ruler_entity.personality.wisdom_range', { min: 0 });
  checkNumber(config, 'command_defaults.ruler_entity.personality.wisdom_variance', { min: 0 });
  checkNumber(config, 'command_defaults.ruler_entity.personality.cruelty_min');
  checkNumber(config, 'command_defaults.ruler_entity.personality.cruelty_range', { min: 0 });
  checkNumber(config, 'command_defaults.ruler_entity.personality.cruelty_variance', { min: 0 });
  checkNumber(config, 'command_defaults.ruler_entity.personality.diplomacy_min');
  checkNumber(config, 'command_defaults.ruler_entity.personality.diplomacy_range', { min: 0 });
  checkNumber(config, 'command_defaults.ruler_entity.personality.diplomacy_variance', { min: 0 });
  checkNumber(config, 'command_defaults.ruler_entity.personality.military_min');
  checkNumber(config, 'command_defaults.ruler_entity.personality.military_range', { min: 0 });
  checkNumber(config, 'command_defaults.ruler_entity.personality.military_variance', { min: 0 });
  checkNumber(config, 'command_defaults.ruler_entity.personality.stewardship_min');
  checkNumber(config, 'command_defaults.ruler_entity.personality.stewardship_range', { min: 0 });
  checkNumber(config, 'command_defaults.ruler_entity.needs.hunger', { min: 0 });
  checkNumber(config, 'command_defaults.ruler_entity.needs.rest', { min: 0 });
  checkNumber(config, 'command_defaults.ruler_entity.needs.social', { min: 0 });
  checkNumber(config, 'command_defaults.ruler_entity.needs.safety', { min: 0 });
  checkNumber(config, 'command_defaults.ruler_entity.inventory.gold', { min: 0 });
  checkNumber(config, 'command_defaults.ruler_entity.economy.skill_level', { min: 0 });
  checkNumber(config, 'command_defaults.ruler_entity.economy.daily_wage', { min: 0 });
  checkNumber(config, 'command_defaults.ruler_entity.economy.savings', { min: 0 });
  checkNumber(config, 'command_defaults.environment.default_xp_reward', { min: 0 });
  checkNumber(config, 'command_defaults.environment.default_hp', { min: 0 });
  checkNumber(config, 'command_defaults.environment.default_stats.strength');
  checkNumber(config, 'command_defaults.environment.default_stats.dexterity');
  checkNumber(config, 'command_defaults.environment.default_stats.constitution');
  checkNumber(config, 'command_defaults.environment.default_stats.intelligence');
  checkNumber(config, 'command_defaults.environment.min_damage_base', { min: 0 });
  checkNumber(config, 'command_defaults.environment.min_damage_hp_divisor', { min: 1 });
  checkNumber(config, 'command_defaults.environment.creature_damage_dice_sides', { min: 1 });
  checkNumber(config, 'command_defaults.environment.default_damage_dice_sides', { min: 1 });
  checkNumber(config, 'command_defaults.environment.high_stat_damage_dice_sides', { min: 1 });
  checkNumber(config, 'command_defaults.environment.high_stat_threshold');
  checkNumber(config, 'command_defaults.environment.armor_class_base');
  checkNumber(config, 'command_defaults.environment.armor_class_dexterity_baseline');
  checkNumber(config, 'command_defaults.environment.journey_enemy_default_hp', { min: 0 });
  checkNumber(config, 'command_defaults.environment.journey_enemy_default_xp_reward', { min: 0 });
  checkNumber(config, 'command_defaults.environment.journey_bandit_default_hp', { min: 0 });
  checkNumber(config, 'command_defaults.environment.journey_bandit_default_xp_reward', { min: 0 });
  checkNumber(config, 'character_creation.quick_start.name_suffix_min', { min: 0 });
  checkNumber(config, 'character_creation.quick_start.name_suffix_range', { min: 1 });
  checkNumber(config, 'character_creation.quick_start.starting_gold', { min: 0 });
  checkNumber(config, 'progression.quest_rewards.xp_per_level', { min: 0 });
  checkNumber(config, 'survival.disease.default_severity', { min: 0 });
  checkNumber(config, 'character_creation.stat_baselines.strength');
  checkNumber(config, 'character_creation.stat_baselines.dexterity');
  checkNumber(config, 'character_creation.stat_baselines.constitution');
  checkNumber(config, 'character_creation.stat_baselines.charisma');
  checkNumber(config, 'character_creation.stat_baselines.resilience');
  checkString(config, 'inventory_engine.id_prefixes.container');
  checkString(config, 'inventory_engine.id_prefixes.item');
  checkString(config, 'inventory_engine.actors.default');
  checkString(config, 'inventory_engine.actors.system');
  checkNumber(config, 'inventory_engine.ipc_retry.max_retries', { min: 0 });
  checkNumber(config, 'inventory_engine.ipc_retry.delay_ms', { min: 0 });
  checkNumber(config, 'inventory_engine.ipc_retry.backoff_multiplier', { min: 0 });
  checkNumber(config, 'inventory.default_item_weight', { min: 0 });
  checkNumber(config, 'inventory.default_item_durability', { min: 0 });
  checkNumber(config, 'inventory.default_item_quality', { min: 0 });
  checkNumber(config, 'inventory.default_stack_quantity', { min: 1 });
  checkNumber(config, 'inventory.access_distance', { min: 0 });
  checkNumber(config, 'inventory.default_lock_difficulty', { min: 0 });
  checkNumber(config, 'inventory.default_container_health', { min: 0 });
  checkStringArray(config, 'inventory.non_flammable_container_types');
  checkString(config, 'inventory.system_regions.magical_pocket');
  checkStringArray(config, 'currency.prototype_ids');
  checkStringArray(config, 'currency.ai_identifiers');
  checkObject(config, 'currency.physical_weights');
  checkNumber(config, 'economy.default_base_price', { min: 0 });
  checkNumber(config, 'economy.charisma_baseline');
  checkNumber(config, 'economy.charisma_price_step', { min: 0 });
  checkNumber(config, 'economy.buy_multiplier', { min: 0 });
  checkNumber(config, 'economy.sell_multiplier', { min: 0 });
  checkNumber(config, 'economy.min_price', { min: 0 });
  checkNumber(config, 'economy.market_fallback_prices.bread', { min: 0 });
  checkNumber(config, 'economy.market_fallback_prices.wood', { min: 0 });
  checkNumber(config, 'economy.market_fallback_prices.iron_ore', { min: 0 });
  checkNumber(config, 'economy.market_fallback_prices.weapons', { min: 0 });
  checkNumber(config, 'dice.d20.sides', { min: 1 });
  checkNumber(config, 'dice.d20.minimum', { min: 1 });
  checkNumber(config, 'engine_economy.npc_reserve_gold', { min: 0 });
  checkNumber(config, 'engine_economy.npc_initial_gold_max', { min: 1 });
  checkNumber(config, 'engine_economy.build_port_gold_cost', { min: 1 });
  checkNumber(config, 'engine_economy.npc_luxury_spend_threshold', { min: 0 });
  checkNumber(config, 'engine_economy.npc_mercenary_medical_threshold', { min: 0 });
  checkNumber(config, 'engine_economy.npc_mercenary_weapon_threshold', { min: 0 });
  checkNumber(config, 'engine_economy.npc_merchant_vehicle_threshold', { min: 0 });
  checkNumber(config, 'engine_economy.npc_merchant_vehicle_max_owned', { min: 0 });
  checkNumber(config, 'engine_economy.infra_dam_gold_cost', { min: 1 });
  checkNumber(config, 'engine_economy.infra_dam_wood_cost', { min: 1 });
  checkNumber(config, 'engine_economy.infra_aqueduct_gold_cost', { min: 1 });
  checkNumber(config, 'engine_economy.infra_aqueduct_iron_cost', { min: 1 });
  checkNumber(config, 'engine_economy.infra_well_gold_cost', { min: 1 });
  checkNumber(config, 'engine_economy.infra_road_gold_cost', { min: 1 });
  checkNumber(config, 'engine_economy.infra_road_wood_cost', { min: 1 });
  checkNumber(config, 'engine_economy.war_declare_min_desire', { min: 0 });
  checkNumber(config, 'engine_economy.war_declare_min_wealth', { min: 0 });
  checkNumber(config, 'engine_economy.war_imperialism_wealth_ceiling', { min: 0 });
  checkNumber(config, 'engine_economy.war_total_food_threshold', { min: 0 });
  checkNumber(config, 'engine_economy.war_total_weapons_threshold', { min: 0 });
  checkNumber(config, 'engine_economy.war_total_gold_threshold', { min: 0 });
  checkNumber(config, 'engine_economy.war_limited_food_threshold', { min: 0 });
  checkNumber(config, 'engine_economy.war_limited_weapons_threshold', { min: 0 });
  checkNumber(config, 'engine_economy.war_limited_gold_threshold', { min: 0 });
  checkNumber(config, 'engine_economy.war_border_food_threshold', { min: 0 });
  checkNumber(config, 'engine_economy.war_border_weapons_threshold', { min: 0 });
  checkNumber(config, 'engine_economy.war_border_gold_threshold', { min: 0 });
  checkNumber(config, 'engine_economy.gm_sabotage_cost', { min: 1 });
  checkNumber(config, 'engine_economy.monster_bounty_gold_cost', { min: 1 });
  checkNumber(config, 'engine_economy.path_impassable_cost_threshold', { min: 1 });
  checkString(config, 'engine_world.default_race_id');
  checkString(config, 'engine_world.faction_vault_container_type');
  checkString(config, 'engine_world.ruins_stash_container_type');
  checkString(config, 'engine_world.default_era_id');
  checkStringArray(config, 'faction_manpower.weapon_good_ids');
  checkStringArray(config, 'faction_manpower.food_good_ids');
  checkNumber(config, 'faction_manpower.population_soldier_ratio', { min: 0 });
  checkNumber(config, 'faction_manpower.food_per_soldier', { min: 0 });
}

function main() {
  checkUiRuntime(readJson('data/ui_runtime.json'));
  checkElectronRuntime(readJson('data/electron_runtime.json'));
  checkPromptRuntime(readJson('data/prompt_runtime.json'));
  checkGameplayRuntime(readJson('data/gameplay_runtime.json'));

  if (warnings.length > 0) {
    console.log('Runtime config warnings:');
    warnings.forEach(warning => console.log('[WARN]', warning));
  }

  if (errors.length > 0) {
    console.error('Runtime config validation failed:');
    errors.forEach(error => console.error('[FAIL]', error));
    process.exit(1);
  }

  console.log('runtime config contracts OK');
}

main();
