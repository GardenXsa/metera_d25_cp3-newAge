from __future__ import annotations

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
from modkit.tools.registry import ToolContext, ToolRegistry
from modkit.tools.transfer_tools import build_transfer_tools


def _registry() -> ToolRegistry:
    reg = ToolRegistry()
    for tool in build_transfer_tools():
        reg.register(tool)
    return reg


class TransferToolsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.mods_root = self.root / "mods"
        self.mod = self.mods_root / "demo"
        self.project = self.root / "project"
        self.engine = self.root / "engine_source"
        self.mod.mkdir(parents=True)
        self.project.mkdir()
        self.engine.mkdir()
        (self.mod / "mod.json").write_text('{"id":"demo"}\n', encoding="utf-8")
        (self.project / "src.js").write_text(
            "const a = 1;\nfunction copied() {\n  return a;\n}\n",
            encoding="utf-8",
        )
        (self.project / "assets").mkdir()
        (self.project / "assets" / "icons").mkdir()
        (self.project / "assets" / "readme.txt").write_text("asset notes\n", encoding="utf-8")
        (self.project / "assets" / "icons" / "sword.txt").write_text("sword icon\n", encoding="utf-8")
        (self.project / "assets" / "icons" / "skip.tmp").write_text("skip me\n", encoding="utf-8")
        (self.project / "assets" / "blob.bin").write_bytes(b"png\x00bytes")
        (self.project / "helpers.py").write_text(
            "@decorator\n"
            "def build_item(name):\n"
            "    return {'name': name}\n\n"
            "class A:\n"
            "    def render(self):\n"
            "        return 'a'\n\n"
            "class B:\n"
            "    def render(self):\n"
            "        return 'b'\n",
            encoding="utf-8",
        )
        (self.engine / "engine.txt").write_text(
            "line 1\nline 2\nline 3\nline 4\n",
            encoding="utf-8",
        )
        (self.project / "objects.json").write_text(
            '{\n'
            '  "items": {\n'
            '    "iron_sword": {\n'
            '      "name": "Iron Sword",\n'
            '      "basePrice": 15,\n'
            '      "tags": ["weapon", "metal"]\n'
            '    }\n'
            '  },\n'
            '  "recipes": [\n'
            '    {"facility": "forges", "outputs": {"iron_sword": 1}}\n'
            '  ]\n'
            '}\n',
            encoding="utf-8",
        )
        self.repo = code_repo.CodeRepo(source_dir=self.engine)
        self.repo.ensure_loaded()
        self.registry = _registry()
        self.ctx = ToolContext(
            mods_root=self.mods_root,
            mod_root=self.mod,
            mode=Mode.YOLO,
            confirm=lambda *_: True,
            extra={"project_root": self.project},
        )

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_source_read_range_reads_engine_source_with_context(self) -> None:
        with mock.patch("modkit.tools.transfer_tools.code_repo.default", return_value=self.repo):
            res = self.registry.run(
                "source_read_range",
                {
                    "source": "engine_source",
                    "path": "engine.txt",
                    "start_line": 2,
                    "end_line": 3,
                    "context_lines": 1,
                },
                self.ctx,
            )
        self.assertTrue(res.ok, msg=res.error)
        self.assertEqual(res.content, "line 1\nline 2\nline 3\nline 4")
        self.assertEqual(res.data["selected_start_line"], 2)
        self.assertEqual(res.data["selected_end_line"], 3)
        self.assertEqual(res.data["returned_start_line"], 1)
        self.assertEqual(res.data["returned_end_line"], 4)

    def test_copy_file_from_project_to_active_mod(self) -> None:
        res = self.registry.run(
            "copy_file",
            {
                "source": "project",
                "source_path": "src.js",
                "target_path": "scripts/copied.js",
            },
            self.ctx,
        )
        self.assertTrue(res.ok, msg=res.error)
        self.assertEqual(
            (self.mod / "scripts" / "copied.js").read_text(encoding="utf-8"),
            (self.project / "src.js").read_text(encoding="utf-8"),
        )
        self.assertIn("before_hash", res.data)
        self.assertIn("after_hash", res.data)
        self.assertEqual(res.data["target"], "active_mod")

    def test_copy_range_after_unique_marker(self) -> None:
        (self.mod / "main.js").write_text("// hooks\n// end\n", encoding="utf-8")
        res = self.registry.run(
            "copy_range",
            {
                "source": "project",
                "source_path": "src.js",
                "start_line": 2,
                "end_line": 4,
                "target_path": "main.js",
                "insert_mode": "after_marker",
                "marker": "// hooks",
            },
            self.ctx,
        )
        self.assertTrue(res.ok, msg=res.error)
        self.assertEqual(
            (self.mod / "main.js").read_text(encoding="utf-8"),
            "// hooks\nfunction copied() {\n  return a;\n}\n// end\n",
        )

    def test_insert_text_rejects_ambiguous_marker(self) -> None:
        (self.mod / "main.js").write_text("// hook\n// hook\n", encoding="utf-8")
        res = self.registry.run(
            "insert_text",
            {
                "target_path": "main.js",
                "text": "x\n",
                "mode": "after_marker",
                "marker": "// hook",
            },
            self.ctx,
        )
        self.assertFalse(res.ok)
        self.assertIn("matches 2 places", res.error)

    def test_replace_exact_dry_run_returns_diff_without_writing(self) -> None:
        (self.mod / "main.js").write_text("const value = 1;\n", encoding="utf-8")
        res = self.registry.run(
            "replace_exact",
            {
                "target_path": "main.js",
                "old": "value = 1",
                "new": "value = 2",
                "dry_run": True,
            },
            self.ctx,
        )
        self.assertTrue(res.ok, msg=res.error)
        self.assertIn("-const value = 1;", res.data["diff"])
        self.assertIn("+const value = 2;", res.data["diff"])
        self.assertEqual((self.mod / "main.js").read_text(encoding="utf-8"), "const value = 1;\n")

    def test_apply_unified_patch_updates_existing_file(self) -> None:
        (self.mod / "main.js").write_text("const value = 1;\nconsole.log(value);\n", encoding="utf-8")
        patch = (
            "--- a/main.js\n"
            "+++ b/main.js\n"
            "@@ -1,2 +1,2 @@\n"
            "-const value = 1;\n"
            "+const value = 2;\n"
            " console.log(value);\n"
        )
        res = self.registry.run(
            "apply_unified_patch",
            {"patch": patch},
            self.ctx,
        )

        self.assertTrue(res.ok, msg=res.error)
        self.assertEqual(res.data["files_changed"], 1)
        self.assertEqual((self.mod / "main.js").read_text(encoding="utf-8"), "const value = 2;\nconsole.log(value);\n")

    def test_apply_unified_patch_dry_run_returns_diff_without_writing(self) -> None:
        (self.mod / "main.js").write_text("const value = 1;\n", encoding="utf-8")
        patch = (
            "--- a/main.js\n"
            "+++ b/main.js\n"
            "@@ -1 +1 @@\n"
            "-const value = 1;\n"
            "+const value = 2;\n"
        )
        res = self.registry.run(
            "apply_unified_patch",
            {"patch": patch, "dry_run": True},
            self.ctx,
        )

        self.assertTrue(res.ok, msg=res.error)
        self.assertTrue(res.data["dry_run"])
        self.assertIn("+const value = 2;", res.data["diff"])
        self.assertEqual((self.mod / "main.js").read_text(encoding="utf-8"), "const value = 1;\n")

    def test_apply_unified_patch_rejects_path_traversal(self) -> None:
        patch = (
            "--- a/main.js\n"
            "+++ b/../escape.js\n"
            "@@ -0,0 +1 @@\n"
            "+owned\n"
        )
        res = self.registry.run(
            "apply_unified_patch",
            {"patch": patch},
            self.ctx,
        )

        self.assertFalse(res.ok)
        self.assertIn("escapes", res.error)

    def test_text_operation_rejects_binary_source(self) -> None:
        (self.project / "blob.bin").write_bytes(b"abc\x00def")
        res = self.registry.run(
            "source_read_range",
            {
                "source": "project",
                "path": "blob.bin",
                "start_line": 1,
                "end_line": 1,
            },
            self.ctx,
        )
        self.assertFalse(res.ok)
        self.assertIn("binary", res.error)

    def test_copy_file_rejects_target_traversal(self) -> None:
        res = self.registry.run(
            "copy_file",
            {
                "source": "project",
                "source_path": "src.js",
                "target_path": "../escape.js",
            },
            self.ctx,
        )
        self.assertFalse(res.ok)
        self.assertIn("escapes", res.error)

    def test_copy_tree_copies_nested_files_and_binary_with_excludes(self) -> None:
        res = self.registry.run(
            "copy_tree",
            {
                "source": "project",
                "source_path": "assets",
                "target_path": "assets/copied",
                "exclude_globs": ["*.tmp"],
            },
            self.ctx,
        )

        self.assertTrue(res.ok, msg=res.error)
        self.assertEqual(res.data["files_copied"], 3)
        self.assertEqual((self.mod / "assets" / "copied" / "readme.txt").read_text(encoding="utf-8"), "asset notes\n")
        self.assertEqual((self.mod / "assets" / "copied" / "icons" / "sword.txt").read_text(encoding="utf-8"), "sword icon\n")
        self.assertEqual((self.mod / "assets" / "copied" / "blob.bin").read_bytes(), b"png\x00bytes")
        self.assertFalse((self.mod / "assets" / "copied" / "icons" / "skip.tmp").exists())

    def test_copy_tree_dry_run_returns_plan_without_writing(self) -> None:
        res = self.registry.run(
            "copy_tree",
            {
                "source": "project",
                "source_path": "assets",
                "target_path": "assets/copied",
                "include_globs": ["icons/*"],
                "dry_run": True,
            },
            self.ctx,
        )

        self.assertTrue(res.ok, msg=res.error)
        self.assertTrue(res.data["dry_run"])
        self.assertEqual(res.data["files_copied"], 2)
        self.assertIn("icons/sword.txt", res.data["files"])
        self.assertFalse((self.mod / "assets" / "copied").exists())

    def test_copy_tree_refuses_file_collisions_without_overwrite(self) -> None:
        target = self.mod / "assets" / "copied" / "readme.txt"
        target.parent.mkdir(parents=True)
        target.write_text("existing\n", encoding="utf-8")

        blocked = self.registry.run(
            "copy_tree",
            {
                "source": "project",
                "source_path": "assets",
                "target_path": "assets/copied",
            },
            self.ctx,
        )
        self.assertFalse(blocked.ok)
        self.assertIn("target already exists", blocked.error)
        self.assertEqual(target.read_text(encoding="utf-8"), "existing\n")

        replaced = self.registry.run(
            "copy_tree",
            {
                "source": "project",
                "source_path": "assets",
                "target_path": "assets/copied",
                "overwrite": True,
            },
            self.ctx,
        )
        self.assertTrue(replaced.ok, msg=replaced.error)
        self.assertEqual(target.read_text(encoding="utf-8"), "asset notes\n")

    def test_edit_tools_use_existing_permission_model(self) -> None:
        asked: list[tuple[str, dict]] = []
        ctx = ToolContext(
            mods_root=self.mods_root,
            mod_root=self.mod,
            mode=Mode.ASK,
            confirm=lambda name, args: asked.append((name, args)) or False,
            extra={"project_root": self.project},
        )
        res = self.registry.run(
            "copy_file",
            {
                "source": "project",
                "source_path": "src.js",
                "target_path": "scripts/copied.js",
            },
            ctx,
        )
        self.assertFalse(res.ok)
        self.assertEqual(asked[0][0], "copy_file")

    def test_source_outline_returns_structured_symbols(self) -> None:
        res = self.registry.run(
            "source_outline",
            {"source": "project", "path": "helpers.py"},
            self.ctx,
        )
        self.assertTrue(res.ok, msg=res.error)
        names = {(entry["name"], entry["kind"]) for entry in res.data["entries"]}
        self.assertIn(("build_item", "function"), names)
        self.assertIn(("A", "class"), names)

    def test_copy_symbol_copies_python_function_with_decorator(self) -> None:
        (self.mod / "main.py").write_text("# copied symbols\n", encoding="utf-8")
        res = self.registry.run(
            "copy_symbol",
            {
                "source": "project",
                "path": "helpers.py",
                "symbol": "build_item",
                "target_path": "main.py",
                "insert_mode": "after_marker",
                "marker": "# copied symbols",
            },
            self.ctx,
        )
        self.assertTrue(res.ok, msg=res.error)
        self.assertEqual(
            (self.mod / "main.py").read_text(encoding="utf-8"),
            "# copied symbols\n@decorator\ndef build_item(name):\n    return {'name': name}\n",
        )

    def test_copy_symbol_refuses_ambiguous_python_symbol(self) -> None:
        (self.mod / "main.py").write_text("", encoding="utf-8")
        res = self.registry.run(
            "copy_symbol",
            {
                "source": "project",
                "path": "helpers.py",
                "symbol": "render",
                "target_path": "main.py",
                "insert_mode": "append",
            },
            self.ctx,
        )
        self.assertFalse(res.ok)
        self.assertIn("ambiguous", res.error)
        self.assertEqual(len(res.data["candidates"]), 2)

    def test_copy_json_value_copies_object_by_pointer(self) -> None:
        (self.mod / "data").mkdir()
        (self.mod / "data" / "items.json").write_text(
            '{\n  "existing": {"name": "Existing"}\n}\n',
            encoding="utf-8",
        )
        res = self.registry.run(
            "copy_json_value",
            {
                "source": "project",
                "source_path": "objects.json",
                "source_pointer": "/items/iron_sword",
                "target_path": "data/items.json",
                "target_pointer": "/iron_sword",
            },
            self.ctx,
        )

        self.assertTrue(res.ok, msg=res.error)
        self.assertEqual(res.data["operation"], "set")
        self.assertEqual(res.data["source_pointer"], "/items/iron_sword")
        text = (self.mod / "data" / "items.json").read_text(encoding="utf-8")
        self.assertIn('"iron_sword"', text)
        self.assertIn('"basePrice": 15', text)
        self.assertIn('"existing"', text)

    def test_copy_json_value_dry_run_returns_diff_without_writing(self) -> None:
        (self.mod / "data").mkdir()
        (self.mod / "data" / "items.json").write_text("{}\n", encoding="utf-8")
        res = self.registry.run(
            "copy_json_value",
            {
                "source": "project",
                "source_path": "objects.json",
                "source_pointer": "/items/iron_sword",
                "target_path": "data/items.json",
                "target_pointer": "/iron_sword",
                "dry_run": True,
            },
            self.ctx,
        )

        self.assertTrue(res.ok, msg=res.error)
        self.assertIn('+  "iron_sword"', res.data["diff"])
        self.assertEqual((self.mod / "data" / "items.json").read_text(encoding="utf-8"), "{}\n")

    def test_copy_json_value_conflict_requires_policy_and_can_merge(self) -> None:
        (self.mod / "data").mkdir()
        (self.mod / "data" / "items.json").write_text(
            '{\n'
            '  "iron_sword": {\n'
            '    "name": "Old Sword",\n'
            '    "properties": {"damage": 3}\n'
            '  }\n'
            '}\n',
            encoding="utf-8",
        )
        blocked = self.registry.run(
            "copy_json_value",
            {
                "source": "project",
                "source_path": "objects.json",
                "source_pointer": "/items/iron_sword",
                "target_path": "data/items.json",
                "target_pointer": "/iron_sword",
            },
            self.ctx,
        )
        self.assertFalse(blocked.ok)
        self.assertIn("already exists", blocked.error)

        merged = self.registry.run(
            "copy_json_value",
            {
                "source": "project",
                "source_path": "objects.json",
                "source_pointer": "/items/iron_sword",
                "target_path": "data/items.json",
                "target_pointer": "/iron_sword",
                "on_conflict": "merge",
            },
            self.ctx,
        )
        self.assertTrue(merged.ok, msg=merged.error)
        text = (self.mod / "data" / "items.json").read_text(encoding="utf-8")
        self.assertIn('"properties":', text)
        self.assertIn('"damage": 3', text)
        self.assertIn('"basePrice": 15', text)

    def test_checkpoint_create_diff_and_restore_active_mod(self) -> None:
        (self.mod / "main.js").write_text("before\n", encoding="utf-8")
        created = self.registry.run(
            "checkpoint_create",
            {"label": "before edit"},
            self.ctx,
        )
        self.assertTrue(created.ok, msg=created.error)
        checkpoint_id = created.data["id"]
        (self.mod / "main.js").write_text("after\n", encoding="utf-8")
        (self.mod / "new.txt").write_text("new\n", encoding="utf-8")

        diffed = self.registry.run(
            "checkpoint_diff",
            {"id": checkpoint_id},
            self.ctx,
        )
        self.assertTrue(diffed.ok, msg=diffed.error)
        self.assertIn("main.js", diffed.data["modified"])
        self.assertIn("new.txt", diffed.data["added"])

        restored = self.registry.run(
            "checkpoint_restore",
            {"id": checkpoint_id},
            self.ctx,
        )
        self.assertTrue(restored.ok, msg=restored.error)
        self.assertEqual((self.mod / "main.js").read_text(encoding="utf-8"), "before\n")
        self.assertFalse((self.mod / "new.txt").exists())

    def test_checkpoint_excludes_agent_internal_dirs(self) -> None:
        (self.mod / ".backups").mkdir()
        (self.mod / ".backups" / "ignored.txt").write_text("x", encoding="utf-8")
        (self.mod / ".agent_scratch").mkdir()
        (self.mod / ".agent_scratch" / "ignored.txt").write_text("x", encoding="utf-8")
        created = self.registry.run(
            "checkpoint_create",
            {"label": "clean"},
            self.ctx,
        )
        self.assertTrue(created.ok, msg=created.error)
        self.assertNotIn(".backups/ignored.txt", created.data["files"])
        self.assertNotIn(".agent_scratch/ignored.txt", created.data["files"])

    def test_rename_symbol_python_updates_definition_and_calls(self) -> None:
        (self.mod / "util.py").write_text(
            "def old_name():\n"
            "    return 1\n\n"
            "value = old_name()\n",
            encoding="utf-8",
        )
        res = self.registry.run(
            "rename_symbol",
            {"target_path": "util.py", "old": "old_name", "new": "new_name"},
            self.ctx,
        )
        self.assertTrue(res.ok, msg=res.error)
        text = (self.mod / "util.py").read_text(encoding="utf-8")
        self.assertIn("def new_name", text)
        self.assertIn("value = new_name()", text)

    def test_find_and_remove_unused_imports(self) -> None:
        (self.mod / "util.py").write_text(
            "import json\n"
            "from pathlib import Path\n\n"
            "def make(path):\n"
            "    return Path(path)\n",
            encoding="utf-8",
        )
        found = self.registry.run("find_unused_imports", {"target_path": "util.py"}, self.ctx)
        self.assertTrue(found.ok, msg=found.error)
        self.assertEqual(found.data["unused"][0]["unused"], ["json"])

        removed = self.registry.run("remove_unused_imports", {"target_path": "util.py"}, self.ctx)
        self.assertTrue(removed.ok, msg=removed.error)
        text = (self.mod / "util.py").read_text(encoding="utf-8")
        self.assertNotIn("import json", text)
        self.assertIn("from pathlib import Path", text)

    def test_format_json_stabilizes_indent(self) -> None:
        (self.mod / "data.json").write_text('{"b":2,"a":1}', encoding="utf-8")
        res = self.registry.run("format_json", {"target_path": "data.json"}, self.ctx)
        self.assertTrue(res.ok, msg=res.error)
        self.assertEqual(
            (self.mod / "data.json").read_text(encoding="utf-8"),
            '{\n  "b": 2,\n  "a": 1\n}\n',
        )

    def test_validate_js_sandbox_flags_forbidden_patterns(self) -> None:
        (self.mod / "main.js").write_text(
            "const fs = require('fs');\nprocess.exit(1);\n",
            encoding="utf-8",
        )
        res = self.registry.run("validate_js_sandbox", {"target_path": "main.js"}, self.ctx)
        self.assertFalse(res.ok)
        self.assertGreaterEqual(len(res.data["violations"]), 2)

    # ── find_symbol ────────────────────────────────────────────────────

    def test_find_symbol_locates_python_function(self) -> None:
        res = self.registry.run(
            "find_symbol",
            {"source": "project", "pattern": "build_item"},
            self.ctx,
        )
        self.assertTrue(res.ok, msg=res.error)
        self.assertGreater(res.data["count"], 0)
        self.assertEqual(res.data["results"][0]["name"], "build_item")
        self.assertEqual(res.data["results"][0]["kind"], "function")
        self.assertEqual(res.data["results"][0]["path"], "helpers.py")

    def test_find_symbol_glob_pattern_matches_multiple(self) -> None:
        res = self.registry.run(
            "find_symbol",
            {"source": "project", "pattern": "render"},
            self.ctx,
        )
        self.assertTrue(res.ok, msg=res.error)
        self.assertGreaterEqual(res.data["count"], 2)
        names = [r["name"] for r in res.data["results"]]
        self.assertIn("render", names)

    def test_find_symbol_requires_pattern(self) -> None:
        res = self.registry.run(
            "find_symbol",
            {"source": "project"},
            self.ctx,
        )
        self.assertFalse(res.ok)
        self.assertIn("pattern", res.error)

    def test_find_symbol_kind_filter(self) -> None:
        res = self.registry.run(
            "find_symbol",
            {"source": "project", "pattern": "*", "kind": "class"},
            self.ctx,
        )
        self.assertTrue(res.ok, msg=res.error)
        for r in res.data["results"]:
            self.assertEqual(r["kind"], "class")

    # ── adapt_imports ─────────────────────────────────────────────────

    def test_adapt_imports_detects_missing_python_imports(self) -> None:
        (self.project / "source_with_imports.py").write_text(
            "import json\n"
            "from pathlib import Path\n\n"
            "def process(data):\n"
            "    p = Path(data)\n"
            "    return json.dumps({'path': str(p)})\n",
            encoding="utf-8",
        )
        (self.mod / "target_no_imports.py").write_text(
            "def existing():\n"
            "    pass\n",
            encoding="utf-8",
        )
        res = self.registry.run(
            "adapt_imports",
            {
                "source": "project",
                "source_path": "source_with_imports.py",
                "target_path": "target_no_imports.py",
                "symbol": "process",
            },
            self.ctx,
        )
        self.assertTrue(res.ok, msg=res.error)
        self.assertGreater(len(res.data["suggested_additions"]), 0)
        suggested = res.data["suggested_additions"]
        self.assertTrue(
            any("json" in line for line in suggested),
            f"Expected 'json' in suggested additions, got {suggested}",
        )

    def test_adapt_imports_returns_empty_when_target_already_has_imports(self) -> None:
        (self.project / "source_with_imports.py").write_text(
            "import json\n\n"
            "def process(data):\n"
            "    return json.dumps(data)\n",
            encoding="utf-8",
        )
        (self.mod / "target_has_imports.py").write_text(
            "import json\n\n"
            "def existing():\n"
            "    pass\n",
            encoding="utf-8",
        )
        res = self.registry.run(
            "adapt_imports",
            {
                "source": "project",
                "source_path": "source_with_imports.py",
                "target_path": "target_has_imports.py",
                "symbol": "process",
            },
            self.ctx,
        )
        self.assertTrue(res.ok, msg=res.error)
        self.assertEqual(len(res.data["suggested_additions"]), 0)

    def test_adapt_imports_requires_source_and_target(self) -> None:
        res = self.registry.run(
            "adapt_imports",
            {"source_path": "helpers.py"},
            self.ctx,
        )
        self.assertFalse(res.ok)

    # ── extract_function ──────────────────────────────────────────────

    def test_extract_function_python_basic(self) -> None:
        (self.mod / "mod.py").write_text(
            "def process():\n"
            "    x = 1\n"
            "    y = x + 2\n"
            "    print(y)\n"
            "    return y\n",
            encoding="utf-8",
        )
        res = self.registry.run(
            "extract_function",
            {
                "target_path": "mod.py",
                "new_name": "compute",
                "start_line": 3,
                "end_line": 4,
                "params": ["x"],
            },
            self.ctx,
        )
        self.assertTrue(res.ok, msg=res.error)
        text = (self.mod / "mod.py").read_text(encoding="utf-8")
        self.assertIn("def compute(x):", text)
        self.assertIn("compute(x)", text)
        self.assertNotIn("y = x + 2", text.split("def compute")[0])

    def test_extract_function_python_with_explicit_params(self) -> None:
        (self.mod / "calc.py").write_text(
            "def main():\n"
            "    a = 10\n"
            "    b = 20\n"
            "    result = a + b\n"
            "    return result\n",
            encoding="utf-8",
        )
        res = self.registry.run(
            "extract_function",
            {
                "target_path": "calc.py",
                "new_name": "add_numbers",
                "start_line": 4,
                "end_line": 4,
                "params": ["a", "b"],
            },
            self.ctx,
        )
        self.assertTrue(res.ok, msg=res.error)
        text = (self.mod / "calc.py").read_text(encoding="utf-8")
        self.assertIn("def add_numbers(a, b):", text)
        self.assertIn("add_numbers(a, b)", text)

    def test_extract_function_js_text_level(self) -> None:
        (self.mod / "app.js").write_text(
            "function main() {\n"
            "    var x = 1;\n"
            "    var y = x + 2;\n"
            "    console.log(y);\n"
            "}\n",
            encoding="utf-8",
        )
        res = self.registry.run(
            "extract_function",
            {
                "target_path": "app.js",
                "new_name": "compute",
                "start_line": 3,
                "end_line": 3,
            },
            self.ctx,
        )
        self.assertTrue(res.ok, msg=res.error)
        text = (self.mod / "app.js").read_text(encoding="utf-8")
        self.assertIn("function compute()", text)
        self.assertIn("compute();", text)

    def test_extract_function_dry_run(self) -> None:
        (self.mod / "mod.py").write_text(
            "def main():\n"
            "    x = 1\n"
            "    y = x + 2\n"
            "    return y\n",
            encoding="utf-8",
        )
        res = self.registry.run(
            "extract_function",
            {
                "target_path": "mod.py",
                "new_name": "compute",
                "start_line": 3,
                "end_line": 3,
                "params": ["x"],
                "dry_run": True,
            },
            self.ctx,
        )
        self.assertTrue(res.ok, msg=res.error)
        self.assertTrue(res.data["dry_run"])
        # File should not be modified
        self.assertIn("y = x + 2", (self.mod / "mod.py").read_text(encoding="utf-8"))

    def test_extract_function_requires_name_and_range(self) -> None:
        res = self.registry.run(
            "extract_function",
            {"target_path": "mod.py", "start_line": 1, "end_line": 3},
            self.ctx,
        )
        self.assertFalse(res.ok)

    def test_extract_function_refuses_bad_range(self) -> None:
        (self.mod / "mod.py").write_text("pass\n", encoding="utf-8")
        res = self.registry.run(
            "extract_function",
            {"target_path": "mod.py", "new_name": "foo", "start_line": 0, "end_line": 1},
            self.ctx,
        )
        self.assertFalse(res.ok)

    def test_extract_function_refuses_unsupported_extension(self) -> None:
        (self.mod / "data.txt").write_text("hello\nworld\n", encoding="utf-8")
        res = self.registry.run(
            "extract_function",
            {"target_path": "data.txt", "new_name": "foo", "start_line": 1, "end_line": 2},
            self.ctx,
        )
        self.assertFalse(res.ok)
        self.assertIn("does not support", res.error)


if __name__ == "__main__":
    unittest.main()
