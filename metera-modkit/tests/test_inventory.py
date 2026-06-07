"""Tests for ``modkit.mod_inventory.build_inventory``.

The whole point of this module is to give the LLM a tool whose
output is impossible to fake: deterministic, file-by-file, with
ground-truth counts. These tests pin that behaviour.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from modkit.mod_inventory import build_inventory


def _make_mod(tmp: Path, *, with_script: bool = True, with_orphan: bool = False) -> Path:
    mod = tmp / "demo_mod"
    mod.mkdir()
    (mod / "data").mkdir()
    (mod / "mod.json").write_text(
        json.dumps(
            {
                "id": "demo_mod",
                "name": "Demo",
                "version": "1.0.0",
                "author": "Tester",
                "description": "x",
                "data": {
                    "items": ["data/items.json"],
                    "recipes": ["data/recipes.json"],
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (mod / "data" / "items.json").write_text(
        json.dumps(
            {
                "sword": {"basePrice": 100, "category": "weapon", "tags": ["melee"]},
                "axe": {"basePrice": 80, "category": "weapon", "tags": ["melee"]},
                "potion": {"basePrice": 25, "category": "consumable", "tags": []},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (mod / "data" / "recipes.json").write_text(
        json.dumps(
            [
                {"facility": "forge", "inputs": ["ore"], "outputs": ["sword"]},
                {"facility": "forge", "inputs": ["ore"], "outputs": ["axe"]},
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    if with_script:
        (mod / "main.js").write_text(
            "ModAPI.on('onModsInitialized', () => { /* ... */ });\n"
            "ModAPI.on('onNpcDied', () => { /* ... */ });\n"
            "ModAPI.registerSaveData('demo', () => ({}), (s) => {});\n"
            "function helper() { return 1; }\n",
            encoding="utf-8",
        )
    if with_orphan:
        # exists on disk but not declared in mod.json
        (mod / "data" / "rogue.json").write_text('{"x": 1}', encoding="utf-8")
    return mod


class InventoryBasicTests(unittest.TestCase):
    def test_descriptor_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            inv = build_inventory(mod)
            self.assertEqual(inv.descriptor["id"], "demo_mod")
            self.assertEqual(inv.descriptor["name"], "Demo")

    def test_totals_aggregate(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            inv = build_inventory(mod)
            self.assertEqual(inv.totals["data_files"], 2)
            self.assertEqual(inv.totals["script_files"], 1)
            self.assertGreater(inv.totals["total_bytes"], 0)
            self.assertGreater(inv.totals["total_lines"], 0)

    def test_per_key_items_count(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            inv = build_inventory(mod)
            by_key = {d["database_key"]: d for d in inv.data_summary}
            self.assertEqual(by_key["items"]["total_items"], 3)
            self.assertEqual(by_key["recipes"]["total_items"], 2)
            self.assertEqual(by_key["items"]["merge_policy"], "deepMerge")
            self.assertEqual(by_key["recipes"]["merge_policy"], "append")

    def test_per_key_files_present(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            inv = build_inventory(mod)
            by_key = {d["database_key"]: d for d in inv.data_summary}
            self.assertEqual(by_key["items"]["files_present"], 1)

    def test_script_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            inv = build_inventory(mod)
            self.assertEqual(len(inv.script_summary), 1)
            s = inv.script_summary[0]
            self.assertEqual(s["path"], "main.js")
            self.assertIn("onModsInitialized", s["modapi_listeners"])
            self.assertIn("onNpcDied", s["modapi_listeners"])
            self.assertTrue(s["registers_save_data"])
            self.assertEqual(s["functions"], 1)

    def test_module_exports_warns(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp), with_script=False)
            (mod / "main.js").write_text("module.exports = { x: 1 };\n", encoding="utf-8")
            inv = build_inventory(mod)
            self.assertTrue(any("module.exports" in w for w in inv.warnings))

    def test_orphaned_data_file_flagged(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp), with_orphan=True)
            inv = build_inventory(mod)
            self.assertTrue(
                any("rogue.json" in d and "registered" in d for d in inv.discrepancies)
            )

    def test_missing_declared_file_flagged(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            (mod / "data" / "items.json").unlink()
            inv = build_inventory(mod)
            self.assertTrue(
                any("items.json" in d and "missing" in d for d in inv.discrepancies)
            )

    def test_sample_keys_returned(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            inv = build_inventory(mod)
            items_file = next(f for f in inv.files if f["path"] == "data/items.json")
            self.assertIn("sword", items_file["sample_keys"])
            self.assertEqual(items_file["shape"], "object")
            self.assertEqual(items_file["items"], 3)

    def test_validation_propagates(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            (mod / "mod.json").write_text('{"id": "WRONG"}', encoding="utf-8")
            inv = build_inventory(mod)
            self.assertFalse(inv.ok)
            self.assertGreater(len(inv.validation_errors), 0)

    def test_invalid_mod_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            inv = build_inventory(Path(tmp) / "does_not_exist")
            self.assertFalse(inv.ok)
            self.assertIn("not found", inv.validation_errors[0])

    def test_to_dict_is_json_serialisable(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            inv = build_inventory(mod)
            # Should not raise.
            json.dumps(inv.to_dict())


class InventoryNoScriptTests(unittest.TestCase):
    def test_no_script_file_means_zero_scripts(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp), with_script=False)
            inv = build_inventory(mod)
            self.assertEqual(inv.totals["script_files"], 0)
            self.assertEqual(inv.script_summary, [])


if __name__ == "__main__":
    unittest.main()
