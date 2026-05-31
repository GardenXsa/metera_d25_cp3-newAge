# check_modkit_3.js (legacy)

`tests/check_modkit_3.js` was archived during final data-driven migration closure.

Reason:
- It validates an outdated ModKit 3.0 contract (native plugin layout/API assumptions) that no longer matches active runtime/modding architecture.
- It produced deterministic false negatives for the current repository layout and blocked final verification signal.

Current canonical verification:
- `py -3 engine/test_gameplay_runtime_inventory.py`
- `py -3 engine/test_runtime_bundle.py`
- `node tests/runtime_data.test.js`
- `node tools/validate_modding_contract.js`
- `node tools/runtime_smoke_check.js`
- `node tests/test_stub_game.js`
