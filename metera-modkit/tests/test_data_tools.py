"""Tests for the ``*_data`` family of structured mod-data tools.

Each test scaffolds a temporary mod folder, picks an active mod via
``ToolContext.mod_root`` and runs the tool handlers directly. No LLM,
no network — these are pure unit tests.
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

from modkit.permissions import Mode
from modkit.tools.data_tools import build_data_tools
from modkit.tools.registry import ToolContext, ToolRegistry


def _make_mod(tmp: Path) -> Path:
    mod = tmp / "test_mod"
    mod.mkdir()
    (mod / "data").mkdir()
    (mod / "mod.json").write_text(
        json.dumps(
            {
                "id": "test_mod",
                "name": "Test",
                "version": "1.0.0",
                "author": "Tester",
                "description": "x",
                "data": {},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return mod


def _ctx(mod_root: Path, tmp: Path) -> ToolContext:
    return ToolContext(
        mods_root=tmp,
        mod_root=mod_root,
        mode=Mode.YOLO,
        confirm=lambda name, args: True,
    )


def _build_registry() -> ToolRegistry:
    reg = ToolRegistry()
    for tool in build_data_tools():
        reg.register(tool)
    return reg


class ReadDataTests(unittest.TestCase):
    def test_read_unknown_key_returns_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            reg = _build_registry()
            res = reg.run("read_data", {"database_key": "not_a_key"}, _ctx(mod, Path(tmp)))
            self.assertFalse(res.ok)
            self.assertIn("unknown", res.error)

    def test_read_no_mod_returns_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            reg = _build_registry()
            ctx = ToolContext(mods_root=Path(tmp), mode=Mode.YOLO, confirm=lambda *_: True)
            res = reg.run("read_data", {"database_key": "items"}, ctx)
            self.assertFalse(res.ok)
            self.assertIn("no mod is selected", res.error)

    def test_read_returns_structured_data_with_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            (mod / "data" / "items.json").write_text(
                json.dumps({"sword": {"basePrice": 100, "category": "weapon", "tags": []}}),
                encoding="utf-8",
            )
            reg = _build_registry()
            res = reg.run("read_data", {"database_key": "items"}, _ctx(mod, Path(tmp)))
            self.assertTrue(res.ok, msg=res.error)
            self.assertIn("data", res.data)
            self.assertEqual(res.data["merge_policy"], "deepMerge")
            self.assertEqual(res.data["default_type"], "object")
            self.assertIn("sword", res.data["data"])


class AddDataItemsTests(unittest.TestCase):
    def test_add_creates_file_and_writes_item(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            reg = _build_registry()
            res = reg.run(
                "add_data_items",
                {
                    "database_key": "items",
                    "items": [
                        {
                            "id": "sword",
                            "name": "Sword",
                            "basePrice": 100,
                            "category": "weapon",
                            "tags": ["melee"],
                        }
                    ],
                },
                _ctx(mod, Path(tmp)),
            )
            self.assertTrue(res.ok, msg=res.error)
            payload = json.loads((mod / "data" / "items.json").read_text(encoding="utf-8"))
            self.assertIn("sword", payload)

    def test_add_warns_on_missing_required_field(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            reg = _build_registry()
            res = reg.run(
                "add_data_items",
                {
                    "database_key": "items",
                    "items": [{"id": "bad", "name": "X", "category": "weapon", "tags": []}],
                },
                _ctx(mod, Path(tmp)),
            )
            # ok=True, but warnings should mention basePrice
            self.assertTrue(res.ok)
            self.assertTrue(any("basePrice" in w for w in res.data.get("warnings", [])))

    def test_add_appends_to_array_policy(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            (mod / "data" / "recipes.json").write_text(
                json.dumps([{"facility": "forge", "inputs": [], "outputs": ["iron"]}]),
                encoding="utf-8",
            )
            reg = _build_registry()
            res = reg.run(
                "add_data_items",
                {
                    "database_key": "recipes",
                    "items": [{"facility": "mill", "inputs": ["grain"], "outputs": ["flour"]}],
                },
                _ctx(mod, Path(tmp)),
            )
            self.assertTrue(res.ok)
            payload = json.loads((mod / "data" / "recipes.json").read_text(encoding="utf-8"))
            self.assertEqual(len(payload), 2)

    def test_add_upserts_existing_object(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            (mod / "data" / "items.json").write_text(
                json.dumps({"sword": {"basePrice": 100, "category": "weapon", "tags": []}}),
                encoding="utf-8",
            )
            reg = _build_registry()
            res = reg.run(
                "add_data_items",
                {
                    "database_key": "items",
                    "items": [{"id": "sword", "basePrice": 200}],
                },
                _ctx(mod, Path(tmp)),
            )
            self.assertTrue(res.ok)
            payload = json.loads((mod / "data" / "items.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["sword"]["basePrice"], 200)
            self.assertEqual(payload["sword"]["category"], "weapon")  # preserved

    def test_add_creates_backup_of_existing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            target = mod / "data" / "items.json"
            target.write_text('{"sword": {}}', encoding="utf-8")
            reg = _build_registry()
            reg.run(
                "add_data_items",
                {
                    "database_key": "items",
                    "items": [{"id": "axe", "basePrice": 50, "category": "weapon", "tags": []}],
                },
                _ctx(mod, Path(tmp)),
            )
            self.assertTrue(target.with_suffix(target.suffix + ".bak").exists())


class SetDataItemTests(unittest.TestCase):
    def test_set_creates_when_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            reg = _build_registry()
            res = reg.run(
                "set_data_item",
                {
                    "database_key": "items",
                    "id": "fire_sword",
                    "value": {
                        "name": "Огненный меч",
                        "basePrice": 500,
                        "category": "weapon",
                        "tags": ["fire"],
                    },
                },
                _ctx(mod, Path(tmp)),
            )
            self.assertTrue(res.ok, msg=res.error)
            payload = json.loads((mod / "data" / "items.json").read_text(encoding="utf-8"))
            self.assertIn("fire_sword", payload)

    def test_set_updates_existing(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            (mod / "data" / "items.json").write_text(
                json.dumps({"sword": {"basePrice": 100, "category": "weapon", "tags": []}}),
                encoding="utf-8",
            )
            reg = _build_registry()
            res = reg.run(
                "set_data_item",
                {
                    "database_key": "items",
                    "id": "sword",
                    "value": {"basePrice": 200, "category": "weapon", "tags": ["rare"]},
                },
                _ctx(mod, Path(tmp)),
            )
            self.assertTrue(res.ok)
            payload = json.loads((mod / "data" / "items.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["sword"]["basePrice"], 200)


class UpdateDataFieldTests(unittest.TestCase):
    def test_update_simple_field(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            (mod / "data" / "items.json").write_text(
                json.dumps(
                    {
                        "sword": {
                            "id": "sword",
                            "basePrice": 100,
                            "category": "weapon",
                            "tags": ["melee"],
                        }
                    }
                ),
                encoding="utf-8",
            )
            reg = _build_registry()
            res = reg.run(
                "update_data_field",
                {
                    "database_key": "items",
                    "id": "sword",
                    "field_path": "basePrice",
                    "value": 150,
                },
                _ctx(mod, Path(tmp)),
            )
            self.assertTrue(res.ok, msg=res.error)
            payload = json.loads((mod / "data" / "items.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["sword"]["basePrice"], 150)

    def test_update_dotted_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            (mod / "data" / "items.json").write_text(
                json.dumps(
                    {
                        "sword": {
                            "id": "sword",
                            "names_by_era": {
                                "rebirth": "Sword",
                                "architects": "Sword",
                                "sundering": "Sword",
                                "silence": "Sword",
                            },
                        }
                    }
                ),
                encoding="utf-8",
            )
            reg = _build_registry()
            res = reg.run(
                "update_data_field",
                {
                    "database_key": "items",
                    "id": "sword",
                    "field_path": "names_by_era.rebirth",
                    "value": "Меч",
                },
                _ctx(mod, Path(tmp)),
            )
            self.assertTrue(res.ok, msg=res.error)
            payload = json.loads((mod / "data" / "items.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["sword"]["names_by_era"]["rebirth"], "Меч")

    def test_update_array_index(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            (mod / "data" / "items.json").write_text(
                json.dumps({"sword": {"id": "sword", "tags": ["a", "b", "c"]}}),
                encoding="utf-8",
            )
            reg = _build_registry()
            res = reg.run(
                "update_data_field",
                {
                    "database_key": "items",
                    "id": "sword",
                    "field_path": "tags[1]",
                    "value": "B",
                },
                _ctx(mod, Path(tmp)),
            )
            self.assertTrue(res.ok, msg=res.error)
            payload = json.loads((mod / "data" / "items.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["sword"]["tags"], ["a", "B", "c"])

    def test_update_unknown_item_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            (mod / "data" / "items.json").write_text(
                json.dumps({"sword": {"id": "sword", "basePrice": 100}}),
                encoding="utf-8",
            )
            reg = _build_registry()
            res = reg.run(
                "update_data_field",
                {
                    "database_key": "items",
                    "id": "missing",
                    "field_path": "basePrice",
                    "value": 999,
                },
                _ctx(mod, Path(tmp)),
            )
            self.assertFalse(res.ok)
            self.assertIn("not found", res.error)


class RemoveDataItemTests(unittest.TestCase):
    def test_remove_from_array(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            (mod / "data" / "recipes.json").write_text(
                json.dumps(
                    [
                        {"id": "r1", "facility": "forge"},
                        {"id": "r2", "facility": "mill"},
                    ]
                ),
                encoding="utf-8",
            )
            reg = _build_registry()
            res = reg.run(
                "remove_data_item",
                {"database_key": "recipes", "id": "r1"},
                _ctx(mod, Path(tmp)),
            )
            self.assertTrue(res.ok, msg=res.error)
            payload = json.loads((mod / "data" / "recipes.json").read_text(encoding="utf-8"))
            self.assertEqual(len(payload), 1)
            self.assertEqual(payload[0]["id"], "r2")

    def test_remove_unknown_id_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            (mod / "data" / "items.json").write_text('{"sword": {}}', encoding="utf-8")
            reg = _build_registry()
            res = reg.run(
                "remove_data_item",
                {"database_key": "items", "id": "absent"},
                _ctx(mod, Path(tmp)),
            )
            self.assertFalse(res.ok)


class ValidateDataTests(unittest.TestCase):
    def test_validate_existing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            (mod / "data" / "items.json").write_text(
                json.dumps({"sword": {"basePrice": 100, "category": "weapon", "tags": []}}),
                encoding="utf-8",
            )
            reg = _build_registry()
            res = reg.run("validate_data", {"database_key": "items"}, _ctx(mod, Path(tmp)))
            self.assertTrue(res.ok, msg=res.error)
            self.assertEqual(res.data["action"], "validated")

    def test_validate_all_known_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            (mod / "data" / "items.json").write_text("{}", encoding="utf-8")
            reg = _build_registry()
            res = reg.run("validate_data", {}, _ctx(mod, Path(tmp)))
            self.assertTrue(res.ok)
            self.assertTrue(any(r["database_key"] == "items" for r in res.data["results"]))


class DataDatabaseKeysTests(unittest.TestCase):
    def test_lists_all_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            reg = _build_registry()
            res = reg.run("data_database_keys", {}, _ctx(mod, Path(tmp)))
            self.assertTrue(res.ok)
            self.assertGreater(res.data["count"], 10)
            items = next(k for k in res.data["keys"] if k["database_key"] == "items")
            self.assertEqual(items["merge_policy"], "deepMerge")
            recipes = next(k for k in res.data["keys"] if k["database_key"] == "recipes")
            self.assertEqual(recipes["merge_policy"], "append")


class ModJsonTests(unittest.TestCase):
    def test_read_mod_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            reg = _build_registry()
            res = reg.run("read_mod_json", {}, _ctx(mod, Path(tmp)))
            self.assertTrue(res.ok)
            self.assertEqual(res.data["data"]["id"], "test_mod")

    def test_update_mod_json_registers_data_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = _make_mod(Path(tmp))
            reg = _build_registry()
            res = reg.run(
                "update_mod_json",
                {"patch": {"data": {"items": ["data/items.json"]}}},
                _ctx(mod, Path(tmp)),
            )
            self.assertTrue(res.ok, msg=res.error)
            payload = json.loads((mod / "mod.json").read_text(encoding="utf-8"))
            self.assertIn("items", payload["data"])
            self.assertEqual(payload["data"]["items"], ["data/items.json"])
            # backup should be created
            self.assertTrue((mod / "mod.json.bak").exists())


if __name__ == "__main__":
    unittest.main()
