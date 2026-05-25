# Runtime Configs for Modders

This project now uses a data-driven runtime contract through `data/runtime_manifest.json`.

## Source of truth

- Runtime sections are declared in `runtime_manifest.database_files`.
- Each descriptor defines `path`, default shape (`default_type`) and merge behavior.
- Runtime database is assembled in `js/mods/ModLoaderIntegration.js` (`buildRuntimeDatabase`).

## Override model

- Mods can override runtime sections through normal database merge hooks (`onDatabaseLoad`).
- For total conversion mode (`window.ModAPI.isTotalConversion = true`):
- Base database files are skipped by default.
- Required sections are validated by runtime contract checks.
- Contract validation is enforced by:
- `validateRuntimeDatabaseContract()` in runtime loader.
- `tools/validate_modding_contract.js` in tooling.

## Runtime sections already wired end-to-end

- `ui_runtime`
- `electron_runtime`
- `prompt_runtime`
- `gameplay_runtime`
- `container_types`
- `transport_registry`
- `trek_config`
- `ship_types`

## Validation commands

```bash
node tests/runtime_data.test.js
node tools/validate_modding_contract.js
node tools/runtime_smoke_check.js
```

Expected smoke-check status: `60 checks, 0 failed, 0 warnings`.
