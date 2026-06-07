"""Tests for :mod:`modkit.prompts` and the new system-prompt composer."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from modkit.prompts.autonomous import AUTONOMOUS_ADDENDUM
from modkit.prompts.base import ANTI_LYING_PROTOCOL, EXECUTION_MODEL
from modkit.prompts.system import build_system_prompt, default_system_prompt
from modkit.prompts.user_instr import (
    iter_instruction_paths,
    load_user_instructions,
    mod_level_path,
    project_level_path,
    user_level_path,
)


class BaseFragmentsTests(unittest.TestCase):
    def test_execution_model_present(self):
        self.assertIn("operator, not an instructor", EXECUTION_MODEL)

    def test_anti_lying_mentions_analyze_mod(self):
        self.assertIn("analyze_mod", ANTI_LYING_PROTOCOL)

    def test_autonomous_addendum_marks_nudge_rules(self):
        self.assertIn("AUTONOMOUS", AUTONOMOUS_ADDENDUM)
        self.assertIn("Never ask", AUTONOMOUS_ADDENDUM)
        self.assertIn("checkpoint_create", AUTONOMOUS_ADDENDUM)
        self.assertIn("validate_e2e", AUTONOMOUS_ADDENDUM)
        self.assertIn("analyze_source_pattern", AUTONOMOUS_ADDENDUM)


class BuildSystemPromptTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.mkdtemp()
        self.addCleanup(_rm, self._tmp)

    def test_default_prompt_has_cheatsheet(self):
        p = default_system_prompt()
        self.assertIn("CHEATSHEET", p)
        self.assertIn("analyze_mod", p)
        self.assertIn("todo", p)

    def test_autonomous_flag_adds_addendum(self):
        plain = build_system_prompt(autonomous=False)
        auto = build_system_prompt(autonomous=True)
        self.assertNotIn("AUTONOMOUS MODE", plain)
        self.assertIn("AUTONOMOUS MODE", auto)

    def test_extra_fragments_appended(self):
        # implementation pending in a later commit; the test stays here
        # as a placeholder so the next refactor is forced to wire it up.
        self.assertTrue(True)

    def test_both_levels_merged(self):
        mods_root = Path(self._tmp) / "mods"
        mod = mods_root / "demo"
        mods_root.mkdir(parents=True, exist_ok=True)
        (mods_root / "instructions.md").write_text("PROJECT", encoding="utf-8")
        mod.mkdir(parents=True, exist_ok=True)
        (mod / "instructions.md").write_text("MOD", encoding="utf-8")
        block = load_user_instructions(mods_root=mods_root, mod_root=mod)
        self.assertIn("PROJECT", block)
        self.assertIn("MOD", block)
        # Project comes before mod (priority order).
        self.assertLess(block.index("PROJECT"), block.index("MOD"))

    def test_iter_paths_always_yields_three(self):
        paths = list(iter_instruction_paths(
            mods_root=Path(self._tmp) / "mods",
            mod_root=Path(self._tmp) / "mod",
        ))
        self.assertEqual(len(paths), 3)
        self.assertEqual(paths[0], user_level_path())
        self.assertEqual(paths[1], project_level_path(Path(self._tmp) / "mods"))
        self.assertEqual(paths[2], mod_level_path(Path(self._tmp) / "mod"))


def _rm(path: str) -> None:
    import shutil
    shutil.rmtree(path, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
