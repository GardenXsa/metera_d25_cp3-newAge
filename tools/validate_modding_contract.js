#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const manifestPath = path.join(ROOT, 'data', 'runtime_manifest.json');
const integrationPath = path.join(ROOT, 'js', 'mods', 'ModLoaderIntegration.js');
const errors = [];

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function check(condition, message) {
  if (!condition) errors.push(message);
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const integration = fs.readFileSync(integrationPath, 'utf8');
  const contract = manifest.modding_contract;

  check(isObject(contract), 'runtime_manifest.modding_contract must be an object');
  check(contract && contract.schema_version >= 1, 'modding_contract.schema_version must be >= 1');
  check(contract && contract.base_game_mod_id === 'base_game', 'modding_contract.base_game_mod_id must be base_game');
  check(isObject(contract && contract.descriptor_defaults), 'modding_contract.descriptor_defaults must be an object');
  check(isObject(contract && contract.total_conversion), 'modding_contract.total_conversion must be an object');
  check(Array.isArray(contract && contract.merge_policies), 'modding_contract.merge_policies must be an array');

  const totalConversion = contract && contract.total_conversion ? contract.total_conversion : {};
  check(totalConversion.skip_base_database_files_by_default === true, 'total_conversion must skip base database files by default');
  check(Array.isArray(totalConversion.allowed_base_passthrough_keys), 'total_conversion.allowed_base_passthrough_keys must be an array');
  check(Array.isArray(totalConversion.required_database_keys), 'total_conversion.required_database_keys must be an array');

  const databaseFiles = manifest.database_files || {};
  (totalConversion.required_database_keys || []).forEach((key) => {
    check(Object.prototype.hasOwnProperty.call(databaseFiles, key), `required total-conversion key is not in database_files: ${key}`);
  });

  Object.entries(databaseFiles).forEach(([key, descriptor]) => {
    check(isObject(descriptor), `database_files.${key} must be an object descriptor`);
    check(typeof descriptor.path === 'string' && descriptor.path.length > 0, `database_files.${key}.path must be a non-empty string`);
    check(typeof descriptor.default_type === 'string' && descriptor.default_type.length > 0, `database_files.${key}.default_type must be a non-empty string`);
    check(typeof descriptor.merge_policy === 'string' && descriptor.merge_policy.length > 0, `database_files.${key}.merge_policy must be a non-empty string`);
    if (contract && Array.isArray(contract.merge_policies)) {
      check(contract.merge_policies.includes(descriptor.merge_policy), `database_files.${key}.merge_policy is not declared in modding_contract.merge_policies`);
    }
  });

  check(integration.includes('shouldLoadBaseDatabaseFile'), 'ModLoaderIntegration must gate base database loading');
  check(integration.includes('validateRuntimeDatabaseContract'), 'ModLoaderIntegration must validate total-conversion database contract');
  check(integration.includes('attachRuntimeDatabaseContractMetadata'), 'ModLoaderIntegration must attach runtime contract metadata');
  check(integration.includes('base-data-off database is missing required sections'), 'ModLoaderIntegration must fail loudly for incomplete base-data-off database');

  if (errors.length > 0) {
    console.error('modding contract errors:');
    errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }

  console.log('modding contract OK');
}

main();
