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
  checkString(config, 'inventory_unlock.lockpick_prototype_id');
  checkString(config, 'inventory_unlock.ability_stat');
  checkNumber(config, 'inventory_unlock.ability_baseline');
  checkNumber(config, 'inventory_unlock.ability_divisor', { min: 1 });
  checkObject(config, 'inventory_feedback.inventory_errors');
  checkObject(config, 'inventory_feedback.trade_errors');
  ['item_not_found', 'source_container_not_found', 'target_container_not_found', 'invalid_quantity', 'unknown_command', 'not_locked_or_not_found', 'unlock_success', 'lockpick_broke'].forEach((key) => checkString(config, `inventory_feedback.inventory_errors.${key}`));
  ['merchant_container_not_found', 'trade_not_found', 'trade_empty', 'trade_too_far', 'failed_lock_trade_item'].forEach((key) => checkString(config, `inventory_feedback.trade_errors.${key}`));
  checkString(config, 'inventory_engine.id_prefixes.container');
  checkString(config, 'inventory_engine.id_prefixes.item');
  checkString(config, 'inventory_engine.actors.default');
  checkString(config, 'inventory_engine.actors.system');
  checkNumber(config, 'inventory_engine.ipc_retry.max_retries', { min: 0 });
  checkNumber(config, 'inventory_engine.ipc_retry.delay_ms', { min: 0 });
  checkNumber(config, 'inventory_engine.ipc_retry.backoff_multiplier', { min: 0 });
  checkNumber(config, 'inventory.default_item_weight', { min: 0 });
  checkNumber(config, 'inventory.default_item_durability', { min: 0 });
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
