from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from modkit import code_repo
from modkit.permissions import Mode
from modkit.tools.intelligence_tools import build_intelligence_tools
from modkit.tools.registry import ToolContext, ToolRegistry


def _registry() -> ToolRegistry:
    reg = ToolRegistry()
    for tool in build_intelligence_tools():
        reg.register(tool)
    return reg


class IntelligenceToolsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.mods_root = self.root / "mods"
        self.mod = self.mods_root / "demo"
        self.source = self.root / "source"
        self.mod.mkdir(parents=True)
        self.source.mkdir()
        (self.source / "api.js").write_text(
            "ModAPI.on('world:ready', () => {});\n"
            "ModAPI.registerCommand('demo', () => {});\n"
            "ModAPI.registerSaveData('demo', () => ({}), () => {});\n",
            encoding="utf-8",
        )
        (self.source / "docs.md").write_text(
            "# Hooks\nUse ModAPI.on for lifecycle hooks.\n",
            encoding="utf-8",
        )
        (self.mod / "mod.json").write_text(
            json.dumps(
                {
                    "id": "demo",
                    "name": "Demo",
                    "version": "1.0.0",
                    "author": "T",
                    "description": "x",
                    "scripts": ["main.js"],
                    "data": {"items": ["data/items.json"]},
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        (self.mod / "main.js").write_text("ModAPI.on('world:ready', () => {});\n", encoding="utf-8")
        (self.mod / "data").mkdir()
        (self.mod / "data" / "items.json").write_text("{}", encoding="utf-8")
        (self.mod / "data" / "orphan.json").write_text("{}", encoding="utf-8")
        self.repo = code_repo.CodeRepo(source_dir=self.source)
        self.repo.ensure_loaded()
        self.registry = _registry()
        self.ctx = ToolContext(
            mods_root=self.mods_root,
            mod_root=self.mod,
            mode=Mode.YOLO,
            confirm=lambda *_: True,
        )

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_analyze_source_pattern_finds_ranked_matches(self) -> None:
        with mock.patch("modkit.tools.intelligence_tools.code_repo.default", return_value=self.repo):
            res = self.registry.run(
                "analyze_source_pattern",
                {"query": "registerSaveData"},
                self.ctx,
            )
        self.assertTrue(res.ok, msg=res.error)
        self.assertEqual(res.data["count"], 1)
        self.assertEqual(res.data["matches"][0]["path"], "api.js")
        self.assertIn("copy_range", res.data["recommended_tools"])

    def test_list_modapi_endpoints_extracts_calls(self) -> None:
        with mock.patch("modkit.tools.intelligence_tools.code_repo.default", return_value=self.repo):
            res = self.registry.run("list_modapi_endpoints", {}, self.ctx)
        self.assertTrue(res.ok, msg=res.error)
        names = {entry["name"] for entry in res.data["endpoints"]}
        self.assertIn("on", names)
        self.assertIn("registerCommand", names)
        self.assertIn("registerSaveData", names)

    def test_list_runtime_data_keys_returns_manifest_summary(self) -> None:
        res = self.registry.run("list_runtime_data_keys", {}, self.ctx)
        self.assertTrue(res.ok, msg=res.error)
        keys = {entry["key"] for entry in res.data["keys"]}
        self.assertIn("items", keys)
        items = next(entry for entry in res.data["keys"] if entry["key"] == "items")
        self.assertIn("merge_policy", items)

    def test_compare_mod_to_engine_contract_reports_orphan_data(self) -> None:
        res = self.registry.run("compare_mod_to_engine_contract", {}, self.ctx)
        self.assertTrue(res.ok, msg=res.error)
        self.assertTrue(any("orphan.json" in issue for issue in res.data["issues"]))
        self.assertEqual(res.data["mod_id"], "demo")

    def test_default_registry_includes_intelligence_tools(self) -> None:
        from modkit.tools.registry import build_default_registry

        registry = build_default_registry(include_shell=False, load_user_tools=False)
        self.assertIsNotNone(registry.get("analyze_source_pattern"))
        self.assertIsNotNone(registry.get("list_modapi_endpoints"))


if __name__ == "__main__":
    unittest.main()
