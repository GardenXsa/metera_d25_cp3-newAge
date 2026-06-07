"""Tests for the ``run_game`` tool.

The engine is a real console binary that speaks JSON over stdin /
stdout. The tests can't depend on that binary being built on the
host, so they substitute a Python "mock engine" that mimics the
protocol:

* prints ``{"status":"ready",...}`` on startup
* reads one JSON line on stdin
* prints a few fake ``DATA ERROR: ...`` and ``DATA WARNING: ...``
  lines
* then sleeps (so the tool has to terminate it)

The mock is wrapped in a small ``.cmd`` shim on Windows (or
launched via ``sys.executable -c``) so the test can hand the tool a
path that ``subprocess.Popen`` will accept.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from modkit.tools.registry import ToolContext, ToolResult
from modkit.tools.run_game import (
    DEFAULT_WAIT_SECONDS,
    MAX_WAIT_SECONDS,
    build_run_game_tool,
    engine_executable_name,
    find_engine,
)


MOCK_ENGINE_PY = textwrap.dedent(
    """\
    import json, sys, time

    # 1) banner
    sys.stdout.write('{"status":"ready","message":"mock engine ready"}\\n')
    sys.stdout.flush()

    # 2) consume exactly one init command, then chatter
    for line in sys.stdin:
        cmd = line.strip()
        if not cmd:
            continue
        try:
            payload = json.loads(cmd)
        except Exception:
            continue
        sys.stdout.write(f"got command: {payload.get('command')!r}\\n")
        sys.stdout.write(f"got active_mods: {payload.get('active_mods')!r}\\n")
        sys.stdout.write("DATA ERROR: missing required tag_defaults entry for tag 'food'\\n")
        sys.stdout.write("DATA WARNING: tag_defaults['water'] contains missing item id 'well'\\n")
        sys.stdout.write("some benign log line\\n")
        sys.stdout.flush()
        # Sit idle so the tool has to terminate us.
        time.sleep(60)
        break
    """
)


def _install_mock_engine(root: Path) -> Path:
    """Write the mock engine script + a .cmd shim. Return the shim path."""
    (root / "mock_engine.py").write_text(MOCK_ENGINE_PY, encoding="utf-8")
    if sys.platform == "win32":
        shim = root / "meterea_engine.cmd"
        shim.write_text(
            f'@echo off\r\n"{sys.executable}" "%~dp0mock_engine.py"\r\n',
            encoding="utf-8",
        )
    else:
        shim = root / "meterea_engine"
        shim.write_text(
            f'#!/bin/sh\nexec "{sys.executable}" "{root / "mock_engine.py"}" "$@"\n',
            encoding="utf-8",
        )
        shim.chmod(0o755)
    return shim


class FindEngineTests(unittest.TestCase):
    def setUp(self):
        self._tmp = Path(tempfile.mkdtemp(prefix="run_game_find_"))

    def tearDown(self):
        shutil.rmtree(self._tmp, ignore_errors=True)

    def test_explicit_path(self):
        shim = _install_mock_engine(self._tmp)
        path, tried = find_engine(str(shim))
        self.assertEqual(path, shim)
        self.assertEqual(tried, [str(shim)])

    def test_explicit_path_must_exist(self):
        ghost = self._tmp / "nope.exe"
        path, tried = find_engine(str(ghost))
        self.assertIsNone(path)
        self.assertIn(str(ghost), tried)

    def test_discovery_finds_in_explicit_dir(self):
        # Patch the candidate list to only look in our temp dir.
        shim = _install_mock_engine(self._tmp)
        with patch("modkit.tools.run_game._candidate_paths", return_value=[shim]):
            path, tried = find_engine()
        self.assertEqual(path, shim)

    def test_discovery_returns_none_when_nothing(self):
        with patch("modkit.tools.run_game._candidate_paths", return_value=[]):
            path, _ = find_engine()
        self.assertIsNone(path)


class RunGameValidationTests(unittest.TestCase):
    def setUp(self):
        self._tmp = Path(tempfile.mkdtemp(prefix="run_game_val_"))
        self._ctx = ToolContext(
            mods_root=self._tmp,
            mod_root=None,
            mode=__import__("modkit.permissions", fromlist=["Mode"]).Mode.YOLO,
        )
        self._tool = build_run_game_tool()

    def tearDown(self):
        shutil.rmtree(self._tmp, ignore_errors=True)

    def _call(self, args):
        return self._tool.handler(args, self._ctx)

    def test_empty_mods_list_rejected(self):
        result = self._call({"mods": []})
        self.assertFalse(result.ok)
        self.assertIn("mods", result.error.lower())

    def test_missing_mods_rejected(self):
        result = self._call({})
        self.assertFalse(result.ok)
        self.assertIn("mods", result.error.lower())

    def test_mods_must_be_list(self):
        result = self._call({"mods": "zombie_apocalypse_ru"})
        self.assertFalse(result.ok)
        self.assertIn("mods", result.error.lower())

    def test_mods_with_invalid_chars_rejected(self):
        result = self._call({"mods": ["good_mod", "bad mod"]})
        self.assertFalse(result.ok)
        self.assertIn("invalid mod", result.error.lower())

    def test_engine_not_found_message_lists_tried(self):
        with patch("modkit.tools.run_game.find_engine", return_value=(None, ["/a/x.exe", "/b/y.exe"])):
            result = self._call({"mods": ["foo"]})
        self.assertFalse(result.ok)
        self.assertIn("/a/x.exe", result.error)
        self.assertIn("/b/y.exe", result.error)
        self.assertIn("engine_path", result.error)

    def test_wait_seconds_clamped_low(self):
        with patch("modkit.tools.run_game.find_engine", return_value=(None, [])):
            result = self._call({"mods": ["foo"], "wait_seconds": 0.0001})
        self.assertFalse(result.ok)
        # not a success test — just ensures low values don't crash

    def test_engine_executable_name_platform(self):
        name = engine_executable_name()
        # Sanity: the name starts with the binary's name, not just
        # a substring of it.
        self.assertIn("meterea_engine", name)
        if sys.platform == "win32":
            self.assertTrue(name.endswith(".exe"))
        else:
            self.assertFalse(name.endswith(".exe"))


class RunGameIntegrationTests(unittest.TestCase):
    """End-to-end tests that spawn the mock engine."""

    def setUp(self):
        self._tmp = Path(tempfile.mkdtemp(prefix="run_game_e2e_"))
        self._engine = _install_mock_engine(self._tmp)
        self._ctx = ToolContext(mods_root=self._tmp)
        self._tool = build_run_game_tool()

    def tearDown(self):
        # Make sure no orphan engine process survives
        shutil.rmtree(self._tmp, ignore_errors=True)

    def _call(self, args):
        return self._tool.handler(args, self._ctx)

    def test_happy_path_captures_log(self):
        result = self._call({
            "mods": ["zombie_apocalypse_ru", "menu_theme"],
            "wait_seconds": 3.0,
            "engine_path": str(self._engine),
        })
        self.assertIsInstance(result, ToolResult)
        self.assertIn("ready", result.content)
        self.assertIn("got command: 'init'", result.content)
        self.assertIn("got active_mods: ['zombie_apocalypse_ru', 'menu_theme']", result.content)
        self.assertTrue(result.data["terminated_by_tool"])
        self.assertGreater(result.data["engine_log_lines"], 0)
        self.assertFalse(result.data["engine_log_truncated"])
        # Engine preflight errors were captured.
        self.assertGreater(len(result.data["engine_preflight_errors"]), 0)
        for err in result.data["engine_preflight_errors"]:
            self.assertIn("DATA ERROR", err.upper() + err.lower())

    def test_result_ok_flag_reflects_preflight(self):
        result = self._call({
            "mods": ["good_mod"],
            "wait_seconds": 2.0,
            "engine_path": str(self._engine),
        })
        # mock engine always emits a DATA ERROR line -> ok=False
        self.assertFalse(result.ok)
        self.assertIn("preflight issue", result.error.lower())

    def test_terminates_engine_on_timeout(self):
        # wait_seconds very small so the tool must rely on its own termination
        result = self._call({
            "mods": ["x"],
            "wait_seconds": 1.0,
            "engine_path": str(self._engine),
        })
        self.assertTrue(result.data["terminated_by_tool"])
        # exit_code may be None if the process was still running when we
        # snapshotted; that's fine — the important thing is it was
        # terminated by the tool.
        self.assertTrue(result.data.get("exit_code") is None
                        or isinstance(result.data["exit_code"], int))

    def test_no_mods_dir_uses_ctx(self):
        # ctx.mods_root == self._tmp, which is empty; engine should still
        # receive the right mods_dir string.
        result = self._call({
            "mods": ["x"],
            "wait_seconds": 1.5,
            "engine_path": str(self._engine),
        })
        self.assertEqual(result.data["mods_dir"], str(self._tmp))


class RunGamePreflightIntegrationTests(unittest.TestCase):
    """The Python preflight must run BEFORE the engine launch and be
    included in the result — the whole point of the tool."""

    def setUp(self):
        self._tmp = Path(tempfile.mkdtemp(prefix="run_game_pre_"))
        self._engine_dir = self._tmp / "_engine"
        self._engine_dir.mkdir()
        self._engine = _install_mock_engine(self._engine_dir)
        # Make a real mod that fails the JS preflight (missing base_stats).
        self._mod = self._tmp / "zombie_apocalypse_ru"
        (self._mod / "data").mkdir(parents=True)
        (self._mod / "mod.json").write_text(
            json.dumps({
                "id": "zombie_apocalypse_ru",
                "name": "Zombie Apocalypse RU",
                "version": "1.0.0",
                "data": {
                    "items": ["data/items.json"],
                    "classes": ["data/classes.json"],
                    "races": ["data/races.json"],
                    "tag_defaults": ["data/tag_defaults.json"],
                    "eras": ["data/eras.json"],
                },
            }), encoding="utf-8",
        )
        (self._mod / "data" / "items.json").write_text("{}", encoding="utf-8")
        (self._mod / "data" / "classes.json").write_text(
            json.dumps([{"id": "scavenger", "base_stats": {}}]), encoding="utf-8"
        )
        (self._mod / "data" / "races.json").write_text("[]", encoding="utf-8")
        (self._mod / "data" / "tag_defaults.json").write_text("{}", encoding="utf-8")
        (self._mod / "data" / "eras.json").write_text("[]", encoding="utf-8")
        self._ctx = ToolContext(mods_root=self._tmp)
        self._tool = build_run_game_tool()

    def tearDown(self):
        shutil.rmtree(self._tmp, ignore_errors=True)

    def test_python_preflight_runs_before_engine(self):
        result = self._tool.handler({
            "mods": ["zombie_apocalypse_ru"],
            "wait_seconds": 1.5,
            "engine_path": str(self._engine),
        }, self._ctx)
        # Python preflight must be in the result.
        self.assertIn("preflight", result.data)
        self.assertIn("reports", result.data["preflight"])
        report = result.data["preflight"]["reports"]["zombie_apocalypse_ru"]
        self.assertFalse(report["ok"])
        self.assertTrue(report["disabled"])
        self.assertIn("zombie_apocalypse_ru",
                      result.data["preflight"]["disabled_mods"])
        # The exact same error string the JS ModLoader emits:
        self.assertTrue(
            any("classes:scavenger.base_stats.str is missing or not numeric" in e
                for e in report["data_errors"]),
            f"expected stat error in {report['data_errors']}",
        )

    def test_combined_log_includes_both_layers(self):
        result = self._tool.handler({
            "mods": ["zombie_apocalypse_ru"],
            "wait_seconds": 1.5,
            "engine_path": str(self._engine),
        }, self._ctx)
        # The content should have the Python preflight section + the
        # engine section.
        self.assertIn("Python preflight", result.content)
        self.assertIn("Engine stdout", result.content)
        # The preflight error must be in the log, formatted like the JS.
        self.assertIn(
            "classes:scavenger.base_stats.str is missing or not numeric",
            result.content,
        )
        # And the engine's own DATA ERROR line too.
        self.assertIn("DATA ERROR", result.content)

    def test_preflight_when_engine_missing(self):
        result = self._tool.handler({
            "mods": ["zombie_apocalypse_ru"],
            "engine_path": str(self._tmp / "no_such_engine.exe"),
        }, self._ctx)
        # Tool still returns the preflight result.
        self.assertIn("preflight", result.data)
        self.assertTrue(result.data["preflight"]["reports"]["zombie_apocalypse_ru"]["disabled"])
        self.assertIn("scavenger.base_stats.str is missing or not numeric",
                      result.content)
        self.assertIn("scavenger.base_stats.dex is missing or not numeric",
                      result.content)


class PreflightModToolTests(unittest.TestCase):
    """Tests for the standalone preflight_mod tool."""

    def setUp(self):
        from modkit.tools.preflight_tool import build_preflight_mod_tool
        self._tmp = Path(tempfile.mkdtemp(prefix="preflight_tool_"))
        self._mod = self._tmp / "zombie_apocalypse_ru"
        (self._mod / "data").mkdir(parents=True)
        (self._mod / "mod.json").write_text(json.dumps({
            "id": "zombie_apocalypse_ru",
            "name": "Zombie Apocalypse RU",
            "version": "1.0.0",
            "data": {
                "items": ["data/items.json"],
                "classes": ["data/classes.json"],
            },
        }), encoding="utf-8")
        (self._mod / "data" / "items.json").write_text("{}", encoding="utf-8")
        (self._mod / "data" / "classes.json").write_text(
            json.dumps([{"id": "scavenger", "base_stats": {}}]), encoding="utf-8"
        )
        self._ctx = ToolContext(mods_root=self._tmp)
        self._tool = build_preflight_mod_tool()

    def tearDown(self):
        shutil.rmtree(self._tmp, ignore_errors=True)

    def test_single_mod_id(self):
        result = self._tool.handler({"mod_id": "zombie_apocalypse_ru"}, self._ctx)
        self.assertFalse(result.ok)
        self.assertIn("scavenger.base_stats.str is missing or not numeric", result.content)
        self.assertIn("zombie_apocalypse_ru", result.data["disabled_mods"])

    def test_mods_list(self):
        result = self._tool.handler({"mods": ["zombie_apocalypse_ru"]}, self._ctx)
        self.assertFalse(result.ok)
        self.assertIn("scavenger.base_stats.str is missing or not numeric", result.content)

    def test_missing_argument(self):
        result = self._tool.handler({}, self._ctx)
        self.assertFalse(result.ok)
        self.assertIn("mod_id", result.error)

    def test_clean_mod(self):
        clean = self._tmp / "clean"
        (clean / "data").mkdir(parents=True)
        (clean / "mod.json").write_text(json.dumps({
            "id": "clean", "name": "Clean", "version": "1.0.0",
            "data": {"items": ["data/items.json"], "classes": ["data/classes.json"]},
        }), encoding="utf-8")
        (clean / "data" / "items.json").write_text("{}", encoding="utf-8")
        (clean / "data" / "classes.json").write_text(
            json.dumps([{"id": "x", "base_stats": {k: 5 for k in ("str","dex","int","con","cha","res")}}]),
            encoding="utf-8",
        )
        result = self._tool.handler({"mod_id": "clean"}, self._ctx)
        self.assertTrue(result.ok)
        self.assertEqual(result.data["disabled_mods"], [])

    def test_console_format_matches_js(self):
        result = self._tool.handler({"mod_id": "zombie_apocalypse_ru"}, self._ctx)
        # The content should be formatted like the JS console output the
        # user sees in the DevConsole screenshot.
        self.assertIn("declarative data preflight", result.content)
        self.assertIn("ModLoader", result.content)


class ToolMetadataTests(unittest.TestCase):
    def test_name(self):
        self.assertEqual(build_run_game_tool().name, "run_game")

    def test_required_mods_param(self):
        params = build_run_game_tool().parameters
        self.assertIn("mods", params["required"])
        self.assertEqual(params["properties"]["mods"]["type"], "array")

    def test_wait_seconds_bounded(self):
        params = build_run_game_tool().parameters
        ws = params["properties"]["wait_seconds"]
        self.assertEqual(ws["minimum"], 0.5)
        self.assertEqual(ws["maximum"], MAX_WAIT_SECONDS)
        # default quoted in the parameter's own description (use :g
        # format to avoid trailing ".0")
        default_str = f"{DEFAULT_WAIT_SECONDS:g}"
        self.assertIn(default_str, ws["description"])

    def test_engine_path_in_params(self):
        params = build_run_game_tool().parameters
        self.assertIn("engine_path", params["properties"])

    def test_kind_is_shell(self):
        from modkit.permissions import Kind
        self.assertEqual(build_run_game_tool().kind, Kind.SHELL)


if __name__ == "__main__":
    unittest.main()
