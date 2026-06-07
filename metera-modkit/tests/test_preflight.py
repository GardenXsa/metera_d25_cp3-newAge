"""Tests for ``modkit.preflight`` — the Python port of the JS preflight.

These tests pin down the EXACT error strings the JS ModLoader emits
so the agent (and downstream tooling) can match them against the
DevConsole verbatim.
"""

from __future__ import annotations

import json
import shutil
import tempfile
import textwrap
import unittest
from pathlib import Path

from modkit.preflight import (
    STAT_KEYS,
    collect_item_ids,
    is_object,
    load_mod_descriptor,
    read_mod_file_strict,
    run_preflight,
    validate_declarative_mod_data,
    validate_mod_meta,
)


# ── Pure helpers ──────────────────────────────────────────────────────


class IsObjectTests(unittest.TestCase):
    def test_dict_is_object(self):
        self.assertTrue(is_object({}))
        self.assertTrue(is_object({"a": 1}))

    def test_list_is_not_object(self):
        self.assertFalse(is_object([1, 2, 3]))

    def test_none_is_not_object(self):
        self.assertFalse(is_object(None))

    def test_string_is_not_object(self):
        self.assertFalse(is_object("hello"))


class ValidateModMetaTests(unittest.TestCase):
    def test_valid_meta(self):
        self.assertEqual(
            validate_mod_meta({"id": "foo", "name": "Foo", "version": "1.0.0"}),
            [],
        )

    def test_missing_id(self):
        errors = validate_mod_meta({"name": "x", "version": "1.0.0"})
        self.assertIn('Missing or invalid "id"', errors)

    def test_invalid_id_charset(self):
        errors = validate_mod_meta({"id": "Bad-Id", "name": "x", "version": "1.0.0"})
        self.assertIn('"id" must be lowercase alphanumeric + underscore only', errors)

    def test_dependencies_must_be_array(self):
        errors = validate_mod_meta(
            {"id": "x", "name": "x", "version": "1.0.0", "dependencies": "nope"}
        )
        self.assertIn('"dependencies" must be an array', errors)

    def test_total_conversion_must_be_bool(self):
        errors = validate_mod_meta(
            {"id": "x", "name": "x", "version": "1.0.0", "total_conversion": "yes"}
        )
        self.assertIn('"total_conversion" must be a boolean', errors)

    def test_none_returns_error(self):
        self.assertEqual(validate_mod_meta(None), ['Missing or invalid "mod" object'])


class CollectItemIdsTests(unittest.TestCase):
    def test_list_form(self):
        self.assertEqual(
            collect_item_ids([{"id": "a"}, {"id": "b"}, {"name": "no id"}]),
            {"a", "b"},
        )

    def test_object_form(self):
        self.assertEqual(collect_item_ids({"a": {}, "b": {}}), {"a", "b"})

    def test_empty(self):
        self.assertEqual(collect_item_ids(None), set())
        self.assertEqual(collect_item_ids([]), set())
        self.assertEqual(collect_item_ids({}), set())


# ── File loader ──────────────────────────────────────────────────────


class ReadModFileStrictTests(unittest.TestCase):
    def setUp(self):
        self._tmp = Path(tempfile.mkdtemp(prefix="preflight_fs_"))
        self._mod = self._tmp / "my_mod"
        self._mod.mkdir()
        (self._mod / "mod.json").write_text("{}", encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self._tmp, ignore_errors=True)

    def test_reads_from_data_subfolder(self):
        (self._mod / "data").mkdir()
        (self._mod / "data" / "items.json").write_text('{"a": 1}', encoding="utf-8")
        ok, content, err = read_mod_file_strict(
            {"id": "my_mod", "folder": "my_mod"}, "data/items.json", self._tmp
        )
        self.assertTrue(ok)
        self.assertEqual(content, '{"a": 1}')
        self.assertIsNone(err)

    def test_reads_from_root_when_data_missing(self):
        (self._mod / "items.json").write_text('{"a": 1}', encoding="utf-8")
        ok, content, _ = read_mod_file_strict(
            {"id": "my_mod", "folder": "my_mod"}, "items.json", self._tmp
        )
        self.assertTrue(ok)
        self.assertEqual(content, '{"a": 1}')

    def test_missing_file_returns_error(self):
        ok, content, err = read_mod_file_strict(
            {"id": "my_mod", "folder": "my_mod"}, "data/missing.json", self._tmp
        )
        self.assertFalse(ok)
        self.assertIsNone(content)
        self.assertIn("missing mod file", err)
        self.assertIn("ENOENT", err)

    def test_traversal_blocked(self):
        ok, content, err = read_mod_file_strict(
            {"id": "my_mod", "folder": "my_mod"}, "../../../etc/passwd", self._tmp
        )
        self.assertFalse(ok)
        # Should either report "Access denied" or "missing mod file" (the
        # normalisation strips the `..` so it becomes a legitimate-looking
        # but missing path).
        self.assertTrue(err is not None)

    def test_mod_without_folder_fails(self):
        ok, content, err = read_mod_file_strict(
            {"id": ""}, "data/x.json", self._tmp
        )
        self.assertFalse(ok)
        self.assertIn("no folder or id", err)


# ── Declarative data preflight ──────────────────────────────────────


class ValidateDeclarativeModDataTests(unittest.TestCase):
    def setUp(self):
        self._tmp = Path(tempfile.mkdtemp(prefix="preflight_data_"))
        self._mod = self._tmp / "test_mod"
        self._mod.mkdir()
        (self._mod / "data").mkdir()
        (self._mod / "mod.json").write_text(
            json.dumps({"id": "test_mod", "name": "Test", "version": "1.0.0"}),
            encoding="utf-8",
        )
        self._mod_obj = {
            "id": "test_mod",
            "folder": "test_mod",
            "data": {
                "items": ["data/items.json"],
                "classes": ["data/classes.json"],
                "races": ["data/races.json"],
                "tag_defaults": ["data/tag_defaults.json"],
                "eras": ["data/eras.json"],
                "locations": ["data/locations.json"],
                "lore": ["data/lore.txt"],
            },
        }

    def tearDown(self):
        shutil.rmtree(self._tmp, ignore_errors=True)

    def _write(self, rel: str, content: str) -> None:
        path = self._mod / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def test_all_clean(self):
        self._write("data/items.json", json.dumps({"a": {"id": "a", "name": "A"}}))
        self._write("data/classes.json", json.dumps([
            {"id": "warrior", "base_stats": {k: 10 for k in STAT_KEYS}}
        ]))
        self._write("data/races.json", json.dumps([]))
        self._write("data/tag_defaults.json", json.dumps({}))
        self._write("data/eras.json", json.dumps([
            {"id": "ancient", "default_location_file": "locations.json"}
        ]))
        self._write("data/locations.json", json.dumps({}))
        self._write("data/lore.txt", "any free text — not parsed as JSON")
        errors = validate_declarative_mod_data(self._mod_obj, self._tmp)
        self.assertEqual(errors, [])

    def test_class_missing_base_stats(self):
        # Exact match of the error string the JS produces — the agent
        # greps the DevConsole for these.
        self._write("data/items.json", "{}")
        self._write("data/classes.json", json.dumps([
            {"id": "scavenger", "base_stats": {}}  # all 6 stats missing
        ]))
        self._write("data/races.json", json.dumps([]))
        self._write("data/tag_defaults.json", json.dumps({}))
        self._write("data/eras.json", json.dumps([]))
        errors = validate_declarative_mod_data(self._mod_obj, self._tmp)
        for stat in STAT_KEYS:
            self.assertIn(
                f"classes:scavenger.base_stats.{stat} is missing or not numeric",
                errors,
                f"missing stat error for {stat}",
            )

    def test_class_non_numeric_base_stat(self):
        self._write("data/items.json", "{}")
        self._write("data/classes.json", json.dumps([
            {"id": "x", "base_stats": {"str": "ten", "dex": 5, "int": 5,
                                       "con": 5, "cha": 5, "res": 5}}
        ]))
        self._write("data/races.json", json.dumps([]))
        self._write("data/tag_defaults.json", json.dumps({}))
        self._write("data/eras.json", json.dumps([]))
        errors = validate_declarative_mod_data(self._mod_obj, self._tmp)
        self.assertIn("classes:x.base_stats.str is missing or not numeric", errors)

    def test_class_stat_modifier_unknown_key(self):
        self._write("data/items.json", "{}")
        self._write("data/classes.json", json.dumps([
            {"id": "x", "base_stats": {k: 5 for k in STAT_KEYS},
             "stat_modifiers": {"wisdom": 2}}
        ]))
        self._write("data/races.json", json.dumps([]))
        self._write("data/tag_defaults.json", json.dumps({}))
        self._write("data/eras.json", json.dumps([]))
        errors = validate_declarative_mod_data(self._mod_obj, self._tmp)
        self.assertIn("classes:x.stat_modifiers.wisdom is not a known character stat", errors)

    def test_tag_defaults_references_missing_item(self):
        self._write("data/items.json", json.dumps({"a": {"id": "a"}}))
        self._write("data/classes.json", json.dumps([]))
        self._write("data/races.json", json.dumps([]))
        self._write("data/tag_defaults.json", json.dumps({"food": "pumpkin"}))
        self._write("data/eras.json", json.dumps([]))
        errors = validate_declarative_mod_data(self._mod_obj, self._tmp)
        self.assertIn("tag_defaults:food -> missing item id pumpkin", errors)

    def test_era_missing_default_location_file(self):
        self._write("data/items.json", "{}")
        self._write("data/classes.json", json.dumps([]))
        self._write("data/races.json", json.dumps([]))
        self._write("data/tag_defaults.json", json.dumps({}))
        self._write("data/eras.json", json.dumps([{"id": "ancient"}]))
        errors = validate_declarative_mod_data(self._mod_obj, self._tmp)
        self.assertIn("eras:ancient: missing default_location_file", errors)

    def test_era_default_location_not_in_locations(self):
        self._write("data/items.json", "{}")
        self._write("data/classes.json", json.dumps([]))
        self._write("data/races.json", json.dumps([]))
        self._write("data/tag_defaults.json", json.dumps({}))
        self._write("data/eras.json", json.dumps([
            {"id": "ancient", "default_location_file": "wrong.json"}
        ]))
        self._write("data/locations.json", json.dumps({}))
        errors = validate_declarative_mod_data(self._mod_obj, self._tmp)
        self.assertIn(
            "eras:ancient: default_location_file wrong.json is not listed in mod.data.locations",
            errors,
        )

    def test_era_default_location_file_missing(self):
        self._write("data/items.json", "{}")
        self._write("data/classes.json", json.dumps([]))
        self._write("data/races.json", json.dumps([]))
        self._write("data/tag_defaults.json", json.dumps({}))
        self._write("data/eras.json", json.dumps([
            {"id": "ancient", "default_location_file": "locations.json"}
        ]))
        self._write("data/locations.json", "NOT LISTED IN mod.data.locations")  # but era lists it
        # Actually: era.default_location_file must be IN mod.data.locations.
        # If we DON'T list it in mod.data.locations, the previous test
        # catches it. To test the "file exists but invalid JSON" path,
        # list the file but make it invalid.
        self._mod_obj["data"]["locations"] = ["data/locations.json"]
        self._write("data/locations.json", "this is not json")
        errors = validate_declarative_mod_data(self._mod_obj, self._tmp)
        self.assertTrue(
            any("missing/invalid default location file" in e for e in errors),
            f"expected invalid-loc error, got {errors}",
        )

    def test_race_references_unknown_class(self):
        self._write("data/items.json", "{}")
        self._write("data/classes.json", json.dumps([
            {"id": "warrior", "base_stats": {k: 5 for k in STAT_KEYS}}
        ]))
        self._write("data/races.json", json.dumps([
            {"id": "human", "class_stats": {"wizard": {"str": 5}}}
        ]))
        self._write("data/tag_defaults.json", json.dumps({}))
        self._write("data/eras.json", json.dumps([]))
        errors = validate_declarative_mod_data(self._mod_obj, self._tmp)
        self.assertIn(
            "races:human.class_stats references unknown class wizard",
            errors,
        )

    def test_lore_file_is_not_parsed_as_json(self):
        # Lore should be loaded but NOT parsed; bad JSON content is OK.
        self._write("data/items.json", "{}")
        self._write("data/classes.json", json.dumps([]))
        self._write("data/races.json", json.dumps([]))
        self._write("data/tag_defaults.json", json.dumps({}))
        self._write("data/eras.json", json.dumps([]))
        self._write("data/locations.json", json.dumps({}))
        self._write("data/lore.txt", "this is not json at all")
        errors = validate_declarative_mod_data(self._mod_obj, self._tmp)
        self.assertEqual(errors, [])

    def test_missing_data_file_reported(self):
        # Don't create items.json
        self._write("data/classes.json", json.dumps([]))
        self._write("data/races.json", json.dumps([]))
        self._write("data/tag_defaults.json", json.dumps({}))
        self._write("data/eras.json", json.dumps([]))
        errors = validate_declarative_mod_data(self._mod_obj, self._tmp)
        self.assertTrue(
            any("items:data/items.json:" in e for e in errors),
            f"expected missing-file error, got {errors}",
        )

    def test_invalid_json_reported(self):
        self._write("data/items.json", "NOT JSON")
        self._write("data/classes.json", json.dumps([]))
        self._write("data/races.json", json.dumps([]))
        self._write("data/tag_defaults.json", json.dumps({}))
        self._write("data/eras.json", json.dumps([]))
        errors = validate_declarative_mod_data(self._mod_obj, self._tmp)
        self.assertTrue(
            any("items:data/items.json" in e and "Expecting value" in e for e in errors),
            f"expected JSON parse error, got {errors}",
        )

    def test_no_data_field_returns_empty(self):
        mod = {"id": "x", "folder": "x"}
        self.assertEqual(validate_declarative_mod_data(mod, self._tmp), [])

    def test_total_conversion_strict_starting_items(self):
        mod_id = "tc_mod"
        mod_dir = self._tmp / mod_id
        (mod_dir / "data").mkdir(parents=True)
        mod = {
            "id": mod_id,
            "folder": mod_id,
            "total_conversion": True,
            "data": {
                "items": ["data/items.json"],
                "classes": ["data/classes.json"],
            },
        }
        (mod_dir / "data" / "items.json").write_text(
            json.dumps({"a": {"id": "a"}}), encoding="utf-8"
        )
        (mod_dir / "data" / "classes.json").write_text(
            json.dumps([
                {"id": "x", "base_stats": {k: 5 for k in STAT_KEYS},
                 "starting_items": {"b": 1}}  # 'b' not in items
            ]), encoding="utf-8"
        )
        errors = validate_declarative_mod_data(mod, self._tmp)
        self.assertIn("classes:x.starting_items -> missing item id b", errors)

    def test_non_tc_does_not_check_starting_items(self):
        # Use a custom mod id/folder and write files at the matching path
        # (self._mod is for the default test_mod — we need our own here).
        mod_id = "non_tc_mod"
        mod_dir = self._tmp / mod_id
        (mod_dir / "data").mkdir(parents=True)
        mod = {
            "id": mod_id,
            "folder": mod_id,
            "data": {
                "items": ["data/items.json"],
                "classes": ["data/classes.json"],
            },
        }
        (mod_dir / "data" / "items.json").write_text(
            json.dumps({"a": {"id": "a"}}), encoding="utf-8"
        )
        (mod_dir / "data" / "classes.json").write_text(
            json.dumps([
                {"id": "x", "base_stats": {k: 5 for k in STAT_KEYS},
                 "starting_items": {"b": 1}}
            ]), encoding="utf-8"
        )
        errors = validate_declarative_mod_data(mod, self._tmp)
        self.assertEqual(errors, [])


# ── load_mod_descriptor + run_preflight ──────────────────────────────


class LoadModDescriptorTests(unittest.TestCase):
    def setUp(self):
        self._tmp = Path(tempfile.mkdtemp(prefix="preflight_load_"))
        (self._tmp / "x").mkdir()

    def tearDown(self):
        shutil.rmtree(self._tmp, ignore_errors=True)

    def test_loads_mod_json(self):
        (self._tmp / "x" / "mod.json").write_text(
            json.dumps({"id": "x", "name": "X", "version": "1.0.0"}),
            encoding="utf-8",
        )
        meta = load_mod_descriptor(self._tmp, "x")
        self.assertIsNotNone(meta)
        self.assertEqual(meta["id"], "x")
        self.assertEqual(meta["folder"], "x")

    def test_missing_mod_json(self):
        self.assertIsNone(load_mod_descriptor(self._tmp, "x"))

    def test_invalid_json(self):
        (self._tmp / "x" / "mod.json").write_text("not json", encoding="utf-8")
        self.assertIsNone(load_mod_descriptor(self._tmp, "x"))


class RunPreflightTests(unittest.TestCase):
    def setUp(self):
        self._tmp = Path(tempfile.mkdtemp(prefix="preflight_run_"))

    def tearDown(self):
        shutil.rmtree(self._tmp, ignore_errors=True)

    def _write_mod(self, mod_id: str, mod_json: dict, data: dict | None = None) -> None:
        mod = self._tmp / mod_id
        mod.mkdir()
        (mod / "mod.json").write_text(
            json.dumps(mod_json), encoding="utf-8"
        )
        if data:
            (mod / "data").mkdir()
            for _key, files in data.items():
                for filename, content in files.items():
                    (mod / "data" / filename).write_text(content, encoding="utf-8")

    def test_clean_mods_pass(self):
        self._write_mod("a", {"id": "a", "name": "A", "version": "1.0.0"}, {
            "items": {"items.json": "{}"},
            "classes": {"classes.json": "[]"},
            "races": {"races.json": "[]"},
            "tag_defaults": {"tag_defaults.json": "{}"},
            "eras": {"eras.json": "[]"},
        })
        reports = run_preflight(self._tmp, ["a"])
        self.assertTrue(reports["a"]["ok"])
        self.assertFalse(reports["a"]["disabled"])

    def test_missing_mod_id_reports_as_disabled(self):
        reports = run_preflight(self._tmp, ["ghost"])
        self.assertTrue(reports["ghost"]["disabled"])
        self.assertIn("Cannot read mod.json", reports["ghost"]["meta_errors"][0])

    def test_preflight_collects_data_errors(self):
        self._write_mod(
            "bad",
            {
                "id": "bad",
                "name": "B",
                "version": "1.0.0",
                "data": {
                    "items": ["data/items.json"],
                    "classes": ["data/classes.json"],
                    "races": ["data/races.json"],
                    "tag_defaults": ["data/tag_defaults.json"],
                    "eras": ["data/eras.json"],
                },
            },
            {
                "items": {"items.json": "{}"},
                "classes": {"classes.json": json.dumps([
                    {"id": "scavenger", "base_stats": {}}  # all stats missing
                ])},
                "races": {"races.json": "[]"},
                "tag_defaults": {"tag_defaults.json": "{}"},
                "eras": {"eras.json": "[]"},
            },
        )
        reports = run_preflight(self._tmp, ["bad"])
        self.assertFalse(reports["bad"]["ok"])
        self.assertTrue(reports["bad"]["disabled"])
        self.assertGreater(len(reports["bad"]["data_errors"]), 0)
        for err in reports["bad"]["data_errors"]:
            self.assertIn("classes:scavenger.base_stats.", err)


if __name__ == "__main__":
    unittest.main()
