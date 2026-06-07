"""Tests for the custom check framework in
:mod:`modkit.tools.custom_checks`.

The tests register, list, run and unregister checks, exercising the
public API the agent uses.
"""

from __future__ import annotations

import tempfile
import textwrap
import unittest
from pathlib import Path

from modkit.tools.custom_checks import (
    CHECK_FILENAME_RE,
    CheckContext,
    checks_root,
    fail,
    list_checks,
    pass_,
    register_check,
    run_checks,
    summarise,
    unregister_check,
    warn,
)


class ResultHelpersTests(unittest.TestCase):
    def test_fail_shape(self) -> None:
        r = fail("nope")
        self.assertFalse(r["ok"])
        self.assertEqual(r["level"], "error")
        self.assertEqual(r["message"], "nope")
        self.assertNotIn("fix_hint", r)

    def test_fail_with_fix_hint(self) -> None:
        r = fail("nope", fix_hint="try this")
        self.assertEqual(r["fix_hint"], "try this")

    def test_warn_does_not_flip_ok(self) -> None:
        r = warn("careful")
        self.assertTrue(r["ok"])
        self.assertEqual(r["level"], "warn")

    def test_pass(self) -> None:
        r = pass_("ok")
        self.assertTrue(r["ok"])
        self.assertEqual(r["level"], "info")


class RegistrationTests(unittest.TestCase):
    def setUp(self) -> None:
        # Use a fresh checks root so we don't disturb the user's checks.
        self._orig_root = checks_root(create=False)
        self._tmp = tempfile.TemporaryDirectory()
        # Patch the checks root to the temp dir for the duration of the test.
        import modkit.tools.custom_checks as cc
        self._cc = cc
        self._saved = cc.checks_root
        cc.checks_root = lambda create=True: Path(self._tmp.name)  # type: ignore[assignment]
        self.addCleanup(self._restore)

    def _restore(self) -> None:
        self._cc.checks_root = self._saved  # type: ignore[assignment]
        self._tmp.cleanup()

    def _register(self, name: str, body: str, **kwargs) -> Path:
        return register_check(name, body, **kwargs)

    def test_register_and_list(self) -> None:
        self._register("ok_check", "def check(ctx):\n    return pass_('hi')\n")
        self._register("multi_check", "def check(ctx):\n    return [pass_('a'), fail('b')]\n")
        items = {c["name"]: c for c in list_checks()}
        self.assertIn("ok_check", items)
        self.assertIn("multi_check", items)
        self.assertTrue(items["ok_check"]["has_check"])
        self.assertTrue(items["multi_check"]["has_check"])

    def test_register_overwrite_requires_flag(self) -> None:
        self._register("dup", "def check(ctx): return pass_('first')\n")
        with self.assertRaises(FileExistsError):
            self._register("dup", "def check(ctx): return pass_('second')\n")
        # But with overwrite=True it works
        self._register("dup", "def check(ctx): return pass_('second')\n", overwrite=True)
        self.assertIn("dup", {c["name"] for c in list_checks()})

    def test_register_rejects_missing_check_function(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            self._register("bad", "def not_check(ctx): return pass_('x')\n")
        self.assertIn("check", str(ctx.exception))

    def test_register_rejects_empty_body(self) -> None:
        with self.assertRaises(ValueError):
            self._register("empty", "   \n")

    def test_register_rejects_syntax_error(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            self._register("syntax", "def check(ctx:\n    return\n")
        self.assertIn("syntax", str(ctx.exception).lower())

    def test_unregister(self) -> None:
        self._register("transient", "def check(ctx): return pass_('x')\n")
        self.assertTrue(unregister_check("transient"))
        self.assertNotIn("transient", {c["name"] for c in list_checks()})
        # Idempotent
        self.assertFalse(unregister_check("transient"))

    def test_invalid_name(self) -> None:
        with self.assertRaises(ValueError):
            register_check("bad name with space", "def check(ctx): return pass_('x')\n")


class RunChecksTests(unittest.TestCase):
    def setUp(self) -> None:
        import modkit.tools.custom_checks as cc
        self._cc = cc
        self._saved = cc.checks_root
        self._tmp = tempfile.TemporaryDirectory()
        cc.checks_root = lambda create=True: Path(self._tmp.name)  # type: ignore[assignment]
        self.addCleanup(self._restore)

    def _restore(self) -> None:
        self._cc.checks_root = self._saved  # type: ignore[assignment]
        self._tmp.cleanup()

    def test_passing_check(self) -> None:
        register_check("passes", "def check(ctx):\n    return pass_('all good')\n")
        ctx = CheckContext(mods_root=Path("."))
        results = run_checks(ctx, names=["passes"])
        self.assertEqual(len(results), 1)
        self.assertTrue(results[0]["ok"])
        self.assertEqual(results[0]["level"], "info")
        self.assertEqual(results[0]["name"], "passes")

    def test_failing_check(self) -> None:
        register_check("fails", "def check(ctx):\n    return fail('broken', fix_hint='fix it')\n")
        results = run_checks(CheckContext(mods_root=Path(".")), names=["fails"])
        self.assertEqual(len(results), 1)
        self.assertFalse(results[0]["ok"])
        self.assertEqual(results[0]["fix_hint"], "fix it")

    def test_multi_result(self) -> None:
        register_check("multi", textwrap.dedent("""\
            def check(ctx):
                return [pass_("a"), warn("b"), fail("c")]
            """))
        results = run_checks(CheckContext(mods_root=Path(".")), names=["multi"])
        self.assertEqual(len(results), 3)
        # All tagged with the check name
        self.assertTrue({r["name"] for r in results} == {"multi"})

    def test_check_uses_context(self) -> None:
        register_check("ctx_reader", textwrap.dedent("""\
            def check(ctx):
                return fail(f"mod_root={ctx.mod_root}, mods_root={ctx.mods_root}")
            """))
        mods = Path(tempfile.gettempdir()) / "ck_test_mods"
        mod = mods / "foo"
        ctx = CheckContext(mods_root=mods, mod_root=mod, mod_id="foo")
        results = run_checks(ctx, names=["ctx_reader"])
        msg = results[0]["message"]
        self.assertIn("ck_test_mods", msg)
        # The mod path should appear as a suffix of the mods path
        self.assertTrue(msg.endswith(str(mod).replace("\\", "/")) or str(mod) in msg,
                        f"expected {msg!r} to contain {mod!r}")

    def test_check_that_raises_is_caught(self) -> None:
        register_check("raises", textwrap.dedent("""\
            def check(ctx):
                raise RuntimeError("boom")
            """))
        results = run_checks(CheckContext(mods_root=Path(".")), names=["raises"])
        self.assertEqual(len(results), 1)
        self.assertFalse(results[0]["ok"])
        self.assertIn("boom", results[0]["message"])
        self.assertIn("traceback", results[0])

    def test_unknown_check_is_reported(self) -> None:
        results = run_checks(CheckContext(mods_root=Path(".")), names=["does_not_exist"])
        self.assertEqual(len(results), 1)
        self.assertFalse(results[0]["ok"])
        self.assertIn("not found", results[0]["message"])


class SummariseTests(unittest.TestCase):
    def test_counts(self) -> None:
        results = [
            {"name": "a", "ok": False, "level": "error", "message": "x"},
            {"name": "b", "ok": True, "level": "warn", "message": "y"},
            {"name": "c", "ok": True, "level": "info", "message": "z"},
        ]
        s = summarise(results)
        self.assertEqual(s["errors"], 1)
        self.assertEqual(s["warnings"], 1)
        self.assertEqual(s["total"], 3)


if __name__ == "__main__":
    unittest.main()
