"""Smoke test for the ``validate_e2e`` tool.

These tests don't spawn Electron — they exercise the static
analysis + custom check parts of the pipeline. The Electron
launch is covered by an end-to-end manual test, not by the
unit suite (CI can't reliably run an Electron app).
"""

from __future__ import annotations

import json
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest.mock import patch

from modkit.tools.custom_checks import (
    CheckContext,
    register_check,
    unregister_check,
    checks_root,
)
from modkit.tools.registry import ToolContext, ToolResult
from modkit.tools.runtime_log import runtime_log_path
from modkit.tools.validate_e2e import (
    DEFAULT_LAUNCH_TIMEOUT_S,
    build_validate_e2e_tool,
    find_project_root,
    _looks_like_project_root,
)


SAMPLE_MOD = textwrap.dedent("""\
    {
        "id": "smoke_mod",
        "name": "Smoke Mod",
        "version": "0.1.0",
        "data": {
            "eras": ["data/eras.json"],
            "locations": ["data/locations_rebirth.json"]
        }
    }
    """)

SAMPLE_ERAS = textwrap.dedent("""\
    [
        {
            "id": "rebirth",
            "name": "Rebirth",
            "start_year": 1042,
            "default_location_file": "locations_rebirth.json",
            "display_name_i18n_key": "characterCreation.eraRebirth",
            "description_i18n_key": "characterCreation.eraRebirthDesc"
        }
    ]
    """)


def _write_mod(root: Path) -> Path:
    """Create a minimal valid mod folder. Returns the mod path."""
    mod = root / "smoke_mod"
    data = mod / "data"
    data.mkdir(parents=True, exist_ok=True)
    (mod / "mod.json").write_text(SAMPLE_MOD, encoding="utf-8")
    (data / "eras.json").write_text(SAMPLE_ERAS, encoding="utf-8")
    (data / "locations_rebirth.json").write_text("[]", encoding="utf-8")
    return mod


def _write_bad_mod(root: Path) -> Path:
    """A mod that fails preflight (no default_location_file)."""
    mod = root / "bad_mod"
    data = mod / "data"
    data.mkdir(parents=True, exist_ok=True)
    (mod / "mod.json").write_text(
        json.dumps({
            "id": "bad_mod",
            "name": "Bad",
            "version": "0.1.0",
            "data": {"eras": ["data/eras.json"]},
        }),
        encoding="utf-8",
    )
    (data / "eras.json").write_text(
        json.dumps([{"id": "rebirth", "name": "Rebirth", "start_year": 0}]),
        encoding="utf-8",
    )
    return mod


class ProjectRootTests(unittest.TestCase):
    def test_heuristic(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_p = Path(tmp)
            (tmp_p / "package.json").write_text("{}")
            (tmp_p / "main.js").write_text("")
            self.assertTrue(_looks_like_project_root(tmp_p))
            (tmp_p / "package.json").unlink()
            self.assertFalse(_looks_like_project_root(tmp_p))

    def test_find_project_root_walks_up(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "package.json").write_text("{}")
            (root / "main.js").write_text("")
            nested = root / "a" / "b" / "c"
            nested.mkdir(parents=True)
            self.assertEqual(find_project_root(nested), root)


class ValidateE2ETests(unittest.TestCase):
    def setUp(self) -> None:
        # Reset the checks root to a fresh temp dir so each test is isolated.
        import modkit.tools.custom_checks as cc
        self._cc = cc
        self._saved_root = cc.checks_root
        self._tmp = tempfile.TemporaryDirectory()
        cc.checks_root = lambda create=True: Path(self._tmp.name)  # type: ignore[assignment]
        self.addCleanup(self._cleanup)

        self._mods_tmp = tempfile.TemporaryDirectory()
        self.mods_root = Path(self._mods_tmp.name)
        _write_mod(self.mods_root)

    def _cleanup(self) -> None:
        self._cc.checks_root = self._saved_root  # type: ignore[assignment]
        self._tmp.cleanup()
        self._mods_tmp.cleanup()

    def _ctx(self) -> ToolContext:
        return ToolContext(mods_root=self.mods_root, mode="yolo")  # type: ignore[arg-type]

    def test_valid_mod_passes_static_layers(self) -> None:
        tool = build_validate_e2e_tool()
        result: ToolResult = tool.handler(
            {"mods": ["smoke_mod"], "launch_electron": False, "include_checks": False},
            self._ctx(),
        )
        # The static layers (preflight, schema) should be clean for
        # the valid mod. We don't assert overall `ok` because the
        # runtime.log on a real machine may contain pre-existing
        # renderer/engine errors from before the test ran.
        data = result.data
        self.assertEqual(data["preflight"]["meta_errors"], 0)
        self.assertEqual(data["preflight"]["data_errors"], 0)
        self.assertEqual(data["summary"]["schema"], 0)

    def test_invalid_mod_fails_preflight(self) -> None:
        _write_bad_mod(self.mods_root)
        tool = build_validate_e2e_tool()
        result = tool.handler(
            {"mods": ["bad_mod"], "launch_electron": False},
            self._ctx(),
        )
        self.assertFalse(result.ok)
        self.assertGreater(result.data["preflight"]["data_errors"], 0)

    def test_custom_checks_are_run(self) -> None:
        register_check("always_fails", textwrap.dedent("""\
            def check(ctx):
                return fail("intentional failure", fix_hint="do not pass go")
            """))
        try:
            tool = build_validate_e2e_tool()
            result = tool.handler(
                {"mods": ["smoke_mod"], "launch_electron": False, "include_checks": True},
                self._ctx(),
            )
            self.assertFalse(result.ok)
            custom = result.data["custom"]
            self.assertEqual(len(custom), 1)
            self.assertIn("intentional failure", custom[0]["message"])
            self.assertEqual(custom[0]["fix_hint"], "do not pass go")
        finally:
            unregister_check("always_fails")

    def test_custom_checks_can_be_skipped(self) -> None:
        register_check("always_fails", "def check(ctx):\n    return fail('boom')\n")
        try:
            tool = build_validate_e2e_tool()
            result = tool.handler(
                {"mods": ["smoke_mod"], "launch_electron": False, "include_checks": False},
                self._ctx(),
            )
            # Custom checks were skipped, so the custom list is empty
            # regardless of pre-existing runtime.log errors.
            self.assertEqual(result.data["custom"], [])
        finally:
            unregister_check("always_fails")

    def test_runtime_log_errors_are_categorised(self) -> None:
        """When a real runtime.log is present, renderer/preflight
        entries are pulled into the report. This test uses the live
        log so it depends on the user actually playing the game at
        least once. It's a smoke test, not a hard assertion."""
        log = runtime_log_path()
        if not log.is_file():
            self.skipTest("no runtime.log on this machine")
        tool = build_validate_e2e_tool()
        result = tool.handler(
            {"mods": ["smoke_mod"], "launch_electron": False, "include_checks": False},
            self._ctx(),
        )
        data = result.data
        # Either we pass (no leftover errors from before this test) or
        # we fail with categorised errors. Both are valid outcomes —
        # the shape of the report is what we're checking.
        self.assertIn("renderer", data)
        self.assertIn("engine", data)
        self.assertIn("custom", data)


class FindProjectRootTests(unittest.TestCase):
    def test_returns_none_when_nothing_matches(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(find_project_root(Path(tmp)))


if __name__ == "__main__":
    unittest.main()
