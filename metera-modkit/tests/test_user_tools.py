"""Tests for the user-installed tools feature.

A user tool is a ``.py`` file dropped into a folder with one or
more ``@tool``-decorated functions. We exercise three things:

* the :func:`tool` decorator alone (signature inference + spec capture),
* the :func:`discover_user_tools` folder scanner, including the
  "one bad file does not poison the rest" guarantee,
* the wiring into :func:`build_default_registry` so the agent sees
  the user tools alongside the built-ins.
"""

from __future__ import annotations

import importlib
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


from modkit.permissions import Mode
from modkit.user_tools import discover_user_tools, tool
from modkit.user_tools.discovery import _load_from
from modkit.user_tools.decorator import UserToolSpec


def _ctx():
    from modkit.tools.registry import ToolContext

    return ToolContext(mods_root=Path("."), mode=Mode.YOLO, confirm=lambda *_: True)


class DecoratorTests(unittest.TestCase):
    def test_bare_decorator_captures_signature(self):
        @tool
        def add(a: int, b: int) -> dict:
            """Add two integers."""
            return {"sum": a + b}

        spec = add.__user_tool_spec__
        self.assertIsInstance(spec, UserToolSpec)
        self.assertEqual(spec.name, "add")
        self.assertEqual(spec.description, "Add two integers.")
        self.assertEqual(spec.parameters["type"], "object")
        props = spec.parameters["properties"]
        self.assertEqual(props["a"], {"type": "integer"})
        self.assertEqual(props["b"], {"type": "integer"})
        self.assertEqual(set(spec.parameters["required"]), {"a", "b"})

    def test_optional_argument_not_required(self):
        @tool
        def shout(text: str, times: int = 1) -> dict:
            """Repeat the text N times in upper case."""
            return {"text": (text.upper() + " ") * times}

        spec = shout.__user_tool_spec__
        self.assertEqual(spec.parameters.get("required"), ["text"])
        self.assertIn("times", spec.parameters["properties"])

    def test_overrides(self):
        @tool(name="n", description="custom", kind="edit", parameters={"type": "object"})
        def internal(x):
            return x

        spec = internal.__user_tool_spec__
        self.assertEqual(spec.name, "n")
        self.assertEqual(spec.description, "custom")
        self.assertEqual(spec.kind, "edit")

    def test_invalid_kind_rejected(self):
        with self.assertRaises(ValueError):
            @tool(kind="nuclear")
            def nope():
                return {}

    def test_falls_back_to_function_name_when_no_docstring(self):
        @tool
        def no_docs(x: int):
            return x

        spec = no_docs.__user_tool_spec__
        self.assertEqual(spec.name, "no_docs")
        # No docstring → description defaults to the name.
        self.assertEqual(spec.description, "no_docs")


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(_rm, self.tmp)

    def test_loads_tool_from_temp_folder(self):
        (self.tmp / "greet.py").write_text(
            textwrap.dedent(
                """
                from modkit.user_tools import tool

                @tool
                def greet(who: str) -> dict:
                    \"\"\"Greet someone.\"\"\"
                    return {"text": f"hi {who}"}
                """
            ),
            encoding="utf-8",
        )
        result = _load_from(self.tmp, raise_on_error=True)
        self.assertTrue(result.ok(), msg=result.errors)
        self.assertEqual(len(result.tools), 1)
        self.assertEqual(result.tools[0].name, "greet")

    def test_multiple_files(self):
        (self.tmp / "a.py").write_text(
            "from modkit.user_tools import tool\n"
            "@tool\n"
            "def alpha(x: int) -> dict:\n"
            "    \"\"\"alpha\"\"\"\n"
            "    return {\"x\": x}\n",
            encoding="utf-8",
        )
        (self.tmp / "b.py").write_text(
            "from modkit.user_tools import tool\n"
            "@tool\n"
            "def beta(y: str) -> dict:\n"
            "    \"\"\"beta\"\"\"\n"
            "    return {\"y\": y}\n",
            encoding="utf-8",
        )
        result = _load_from(self.tmp, raise_on_error=True)
        self.assertTrue(result.ok())
        names = sorted(t.name for t in result.tools)
        self.assertEqual(names, ["alpha", "beta"])

    def test_bad_file_does_not_poison_others(self):
        (self.tmp / "good.py").write_text(
            "from modkit.user_tools import tool\n"
            "@tool\n"
            "def ok(x: int) -> dict:\n"
            "    \"\"\"ok\"\"\"\n"
            "    return {\"x\": x}\n",
            encoding="utf-8",
        )
        (self.tmp / "bad.py").write_text("def nope(:\n", encoding="utf-8")
        result = _load_from(self.tmp, raise_on_error=False)
        self.assertFalse(result.ok())
        self.assertEqual(len(result.errors), 1)
        self.assertEqual(result.errors[0].path.name, "bad.py")
        # Good file still loaded.
        self.assertEqual([t.name for t in result.tools], ["ok"])

    def test_ignores_non_py_and_dunder_files(self):
        (self.tmp / "real.py").write_text(
            "from modkit.user_tools import tool\n"
            "@tool\n"
            "def real() -> dict:\n"
            "    \"\"\"real\"\"\"\n"
            "    return {}\n",
            encoding="utf-8",
        )
        (self.tmp / "README.md").write_text("not a tool", encoding="utf-8")
        (self.tmp / "_hidden.py").write_text("# hidden", encoding="utf-8")
        (self.tmp / ".dotfile.py").write_text("# dot", encoding="utf-8")
        result = _load_from(self.tmp, raise_on_error=True)
        self.assertEqual([t.name for t in result.tools], ["real"])

    def test_missing_folder_is_empty(self):
        result = _load_from(self.tmp / "no_such_dir", raise_on_error=True)
        self.assertEqual(result.tools, [])
        self.assertEqual(result.errors, [])

    def test_returns_only_tools_with_handler(self):
        # Functions with a spec but handler=None should be skipped, and
        # attributes that aren't callable (so they can't have a handler
        # in the first place) must not crash discovery.
        (self.tmp / "broken.py").write_text(
            textwrap.dedent(
                """
                from modkit.user_tools import tool

                @tool
                def real() -> dict:
                    \"\"\"real\"\"\"\n
                    return {}\n

                # Bare integers can't carry the spec attribute — discovery
                # must not blow up on this.
                SOME_CONST = 123
                """
            ),
            encoding="utf-8",
        )
        result = _load_from(self.tmp, raise_on_error=True)
        names = sorted(t.name for t in result.tools)
        self.assertEqual(names, ["real"])


class ToolExecutionTests(unittest.TestCase):
    """End-to-end: a discovered tool actually runs through the registry."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(_rm, self.tmp)
        (self.tmp / "echo.py").write_text(
            textwrap.dedent(
                """
                from modkit.user_tools import tool

                @tool
                def echo(text: str) -> dict:
                    \"\"\"Echo input back.\"\"\"
                    return {"echo": text}
                """
            ),
            encoding="utf-8",
        )

    def test_runs_via_registry(self):
        from modkit.tools.registry import ToolRegistry

        reg = ToolRegistry()
        for t in discover_user_tools(self.tmp):
            reg.register(t)
        res = reg.run("echo", {"text": "hello"}, _ctx())
        self.assertTrue(res.ok, msg=res.error)
        self.assertEqual(res.data["echo"], "hello")

    def test_kind_edit(self):
        edit_path = self.tmp / "edit.py"
        edit_path.write_text(
            textwrap.dedent(
                """
                from modkit.user_tools import tool
                from modkit.permissions import Mode

                @tool(kind="edit")
                def mutate(target: str) -> dict:
                    \"\"\"Pretend to mutate target.\"\"\"
                    return {"mutated": target}
                """
            ),
            encoding="utf-8",
        )
        from modkit.permissions import Decision, evaluate, Kind
        from modkit.tools.registry import ToolRegistry

        reg = ToolRegistry()
        for t in discover_user_tools(self.tmp):
            reg.register(t)
        edit_tool = reg.get("mutate")
        self.assertIsNotNone(edit_tool)
        self.assertEqual(edit_tool.kind, Kind.EDIT)
        # ASK mode should ASK for an edit-kind tool.
        self.assertEqual(
            evaluate(Mode.ASK, edit_tool.kind).decision, Decision.ASK
        )

    def test_runtime_error_surfaces_as_tool_error(self):
        bad = self.tmp / "boom.py"
        bad.write_text(
            "from modkit.user_tools import tool\n"
            "@tool\n"
            "def boom() -> dict:\n"
            "    \"\"\"boom\"\"\"\n"
            "    raise RuntimeError('kaboom')\n",
            encoding="utf-8",
        )
        from modkit.tools.registry import ToolRegistry

        reg = ToolRegistry()
        for t in discover_user_tools(self.tmp):
            reg.register(t)
        res = reg.run("boom", {}, _ctx())
        self.assertFalse(res.ok)
        self.assertIn("kaboom", res.error)


class DefaultRegistryTests(unittest.TestCase):
    def test_user_tools_loaded_by_default(self):
        """build_default_registry with load_user_tools=True picks up
        tools from a custom folder."""
        import modkit.tools.registry as reg_module
        from modkit.tools.registry import build_default_registry

        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(_rm, tmp)
        (tmp / "demo.py").write_text(
            "from modkit.user_tools import tool\n"
            "@tool\n"
            "def demo() -> dict:\n"
            "    \"\"\"demo\"\"\"\n"
            "    return {}\n",
            encoding="utf-8",
        )

        # Monkey-patch the user_tools_root inside the discovery module.
        from modkit.user_tools import discovery as ut_disc
        from modkit import paths

        original = ut_disc._default_user_tools_root
        ut_disc._default_user_tools_root = lambda: tmp
        self.addCleanup(setattr, ut_disc, "_default_user_tools_root", original)
        # The registry imports the symbol at function-call time so the
        # rebinding above is enough; no reload needed.
        registry = build_default_registry(include_shell=False, load_user_tools=True)
        self.assertIsNotNone(registry.get("demo"))
        # Built-ins are still there.
        self.assertIsNotNone(registry.get("list_files"))

        registry_no = build_default_registry(include_shell=False, load_user_tools=False)
        self.assertIsNone(registry_no.get("demo"))


class ResourceExampleTests(unittest.TestCase):
    def test_dry_run_example_tool_is_shipped(self):
        path = ROOT / "resources" / "user_tools_example" / "dry_run_report.py"
        self.assertTrue(path.exists())
        text = path.read_text(encoding="utf-8")
        self.assertIn("@tool", text)
        self.assertIn("dry_run", text)
        self.assertIn("ctx", text)


def _rm(p: Path) -> None:
    import shutil

    shutil.rmtree(p, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
