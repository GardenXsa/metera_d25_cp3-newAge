"""Tests for the in-memory engine source snapshot.

No network is required: every test uses :func:`code_repo._for_test` to
build a one-off repo pointed at a ``tmp_path`` populated with
synthetic file contents. The on-disk shape mirrors the upstream repo
so :meth:`CodeRepo.ensure_loaded` walks the real ``os.walk`` codepath.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from modkit import code_repo


CPP_SRC = b"""\
class Player {
public:
    void move(int x, int y);
    int hp() const;
};

namespace metera {
    int computeEconomy(int year);
}

int main(int argc, char** argv) {
    return 0;
}
"""

JS_SRC = b"""\
export function addCommand(name, callback, opts) {
    return callback();
}

class ModAPI {
    on(event, handler) {
        this._h[event] = handler;
    }
}

const util = (a, b) => a + b;
"""

PY_SRC = b"""\
class Foo:
    def bar(self, x):
        return x

def baz(a, b):
    return a + b
"""

JSON_SRC = b"""\
{
    "items": {
        "sword": {"basePrice": 100}
    },
    "recipes": []
}
"""

README_SRC = b"""\
# Chronicles of Meterea

## Installation

## Modding

### Data mods

### Script mods
"""


def _fake_repo(tmp: Path) -> code_repo.CodeRepo:
    """Populate *tmp* with the standard synthetic tree and return a CodeRepo."""
    (tmp / "engine").mkdir(parents=True, exist_ok=True)
    (tmp / "js").mkdir(parents=True, exist_ok=True)
    (tmp / "scripts").mkdir(parents=True, exist_ok=True)
    (tmp / "data").mkdir(parents=True, exist_ok=True)
    (tmp / "engine" / "player.h").write_bytes(CPP_SRC)
    (tmp / "js" / "api.js").write_bytes(JS_SRC)
    (tmp / "scripts" / "main.py").write_bytes(PY_SRC)
    (tmp / "data" / "items.json").write_bytes(JSON_SRC)
    (tmp / "README.md").write_bytes(README_SRC)
    return code_repo.CodeRepo(
        source_dir=tmp,
        owner="test", repo="repo", branch="main",
        source_url="https://github.com/test/repo",
    )


class PathNormalisationTests(unittest.TestCase):
    def test_strips_leading_slash(self):
        self.assertEqual(code_repo._norm_path("/foo/bar"), "foo/bar")

    def test_rejects_traversal(self):
        self.assertEqual(code_repo._norm_path("../etc/passwd"), "")

    def test_normalises_backslashes(self):
        self.assertEqual(code_repo._norm_path("foo\\bar"), "foo/bar")


class OutlineTests(unittest.TestCase):
    def setUp(self) -> None:
        import tempfile
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = _fake_repo(Path(self._tmp.name))
        self.repo.ensure_loaded()

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_outline_cpp_finds_class_and_methods(self):
        entries = self.repo.outline("engine/player.h")
        names = {e["name"] for e in entries}
        self.assertIn("Player", names)
        self.assertIn("move", names)
        self.assertIn("hp", names)
        self.assertIn("computeEconomy", names)
        player_entry = next(e for e in entries if e["name"] == "Player")
        self.assertEqual(player_entry["kind"], "class")
        move_entry = next(e for e in entries if e["name"] == "move")
        self.assertEqual(move_entry["kind"], "method")

    def test_outline_js_finds_class_method(self):
        entries = self.repo.outline("js/api.js")
        names = {e["name"] for e in entries}
        self.assertIn("addCommand", names)
        self.assertIn("ModAPI", names)
        self.assertIn("on", names)
        method_entry = next(e for e in entries if e["name"] == "on")
        self.assertEqual(method_entry["kind"], "method")

    def test_outline_python_uses_ast(self):
        entries = self.repo.outline("scripts/main.py")
        names = {e["name"] for e in entries}
        self.assertIn("Foo", names)
        self.assertIn("bar", names)
        self.assertIn("baz", names)
        bar = next(e for e in entries if e["name"] == "bar")
        self.assertEqual(bar["kind"], "method")

    def test_outline_json_lists_top_level_keys(self):
        entries = self.repo.outline("data/items.json")
        names = [e["name"] for e in entries]
        self.assertIn("items", names)
        self.assertIn("recipes", names)

    def test_outline_markdown_lists_headings(self):
        entries = self.repo.outline("README.md")
        names = [e["name"] for e in entries]
        self.assertIn("Chronicles of Meterea", names)
        self.assertIn("Modding", names)


class SearchTests(unittest.TestCase):
    def setUp(self) -> None:
        import tempfile
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = _fake_repo(Path(self._tmp.name))
        self.repo.ensure_loaded()

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_find_files_glob(self):
        matches = self.repo.find_files("*.h")
        self.assertIn("engine/player.h", matches)

    def test_find_files_substring(self):
        matches = self.repo.find_files("*items*")
        self.assertIn("data/items.json", matches)

    def test_grep_returns_matches(self):
        out = self.repo.grep(r"function\b")
        paths = {m["path"] for m in out}
        self.assertIn("js/api.js", paths)

    def test_grep_with_path_glob(self):
        out = self.repo.grep(r"class\b", path_glob="*.py")
        self.assertTrue(all(m["path"].endswith(".py") for m in out))
        self.assertTrue(any("scripts/main.py" in m["path"] for m in out))

    def test_grep_invalid_regex(self):
        out = self.repo.grep(r"(unclosed")
        self.assertEqual(out[0]["_error"][:13], "invalid regex")

    def test_where_defined_finds_class(self):
        out = self.repo.where_defined("Player")
        names = {(e["path"], e["name"]) for e in out}
        self.assertIn(("engine/player.h", "Player"), names)

    def test_where_defined_finds_js_function(self):
        out = self.repo.where_defined("addCommand")
        self.assertTrue(any(e["path"] == "js/api.js" for e in out))

    def test_references_finds_uses(self):
        out = self.repo.references("ModAPI")
        self.assertTrue(out)
        self.assertTrue(any("js/api.js" in e["path"] for e in out))

    def test_references_marks_definitions(self):
        out = self.repo.references("addCommand")
        defs = [e for e in out if e["is_definition"]]
        self.assertTrue(defs)


class DepsTests(unittest.TestCase):
    def setUp(self) -> None:
        import tempfile
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = _fake_repo(Path(self._tmp.name))
        # Add a small includes/imports sample
        (Path(self._tmp.name) / "engine" / "sdk.h").write_bytes(
            b"#pragma once\n"
            b"#include <string>\n"
            b'#include "engine/types.h"\n'
        )
        (Path(self._tmp.name) / "engine" / "types.h").write_bytes(
            b"#pragma once\n"
            b"struct Vec2 { int x; int y; };\n"
        )
        (Path(self._tmp.name) / "js" / "main.js").write_bytes(
            b"import { addCommand } from './api.js';\n"
            b"const util = require('lodash');\n"
        )
        (Path(self._tmp.name) / "scripts" / "util.py").write_bytes(
            b"from .models import Foo\n"
            b"import os\n"
        )
        self.repo.ensure_loaded()

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_dependencies_cpp_includes(self):
        deps = self.repo.dependencies("engine/sdk.h")
        targets = {d["target"] for d in deps}
        # angle-bracket includes are returned without the brackets
        self.assertIn("string", targets)
        # quote includes preserve the path
        self.assertIn("engine/types.h", targets)

    def test_dependencies_js_imports(self):
        deps = self.repo.dependencies("js/main.js")
        targets = {d["target"] for d in deps}
        self.assertIn("./api.js", targets)
        self.assertIn("lodash", targets)

    def test_dependencies_python(self):
        deps = self.repo.dependencies("scripts/util.py")
        targets = {d["target"] for d in deps}
        self.assertIn("os", targets)

    def test_dependents_finds_includers(self):
        deps = self.repo.dependents("engine/types.h")
        paths = {d["path"] for d in deps}
        self.assertIn("engine/sdk.h", paths)


class NavigationTests(unittest.TestCase):
    def setUp(self) -> None:
        import tempfile
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = _fake_repo(Path(self._tmp.name))
        self.repo.ensure_loaded()

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_info_aggregates(self):
        info = self.repo.info()
        self.assertEqual(info["total_files"], 5)
        self.assertIn("engine", info["top_level_dirs"])
        self.assertIn("js", info["top_level_dirs"])
        self.assertIn(".h", info["by_extension"])

    def test_list_dir_returns_files_and_dirs(self):
        entries = self.repo.list_dir("")
        names = {e["name"] for e in entries}
        self.assertIn("engine", names)
        self.assertIn("README.md", names)

    def test_list_dir_subdirectory(self):
        entries = self.repo.list_dir("engine")
        names = {e["name"] for e in entries}
        self.assertIn("player.h", names)

    def test_tree_includes_depth(self):
        out = self.repo.tree("")
        # engine/player.h is depth 1
        player_entry = next(e for e in out if e["path"] == "engine/player.h")
        self.assertEqual(player_entry["depth"], 1)
        self.assertEqual(player_entry["type"], "file")

    def test_count_lines(self):
        stat = self.repo.count_lines("README.md")
        self.assertIsNotNone(stat)
        self.assertEqual(stat["language"], "markdown")
        self.assertGreater(stat["total_lines"], 0)


class SafetyTests(unittest.TestCase):
    def test_get_file_rejects_traversal(self):
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            repo = _fake_repo(Path(td))
            self.assertIsNone(repo.get_file("../etc/passwd"))

    def test_norm_path_empty(self):
        self.assertEqual(code_repo._norm_path(""), "")
        self.assertEqual(code_repo._norm_path(None), "")


class LocalSourceTests(unittest.TestCase):
    """The new (no-network) CodeRepo contract."""

    def test_missing_dir_is_empty(self):
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            empty = Path(td) / "empty"
            empty.mkdir()
            repo = code_repo.CodeRepo(source_dir=empty)
            repo.ensure_loaded()
            self.assertTrue(repo.loaded)
            self.assertEqual(repo.file_paths, [])
            self.assertEqual(repo.list_dir(""), [])
            self.assertIsNone(repo.get_file("anything"))

    def test_walk_skips_git_dir(self):
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / ".git").mkdir()
            (root / ".git" / "config").write_bytes(b"git config")
            (root / "real.py").write_bytes(b"print(1)")
            repo = code_repo.CodeRepo(source_dir=root)
            repo.ensure_loaded()
            self.assertEqual(repo.file_paths, ["real.py"])

    def test_get_file_reads_from_disk(self):
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "hello.txt").write_bytes(b"hi")
            repo = code_repo.CodeRepo(source_dir=root)
            self.assertEqual(repo.get_file("hello.txt"), b"hi")
            # second call should hit the in-memory cache
            self.assertIn("hello.txt", repo.files)

    def test_info_reports_source_dir_and_availability(self):
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "a").write_bytes(b"x")
            repo = code_repo.CodeRepo(
                source_dir=root,
                owner="o", repo="r", branch="b",
                source_url="https://github.com/o/r",
            )
            info = repo.info()
            self.assertEqual(info["owner"], "o")
            self.assertEqual(info["repo"], "r")
            self.assertEqual(info["branch"], "b")
            self.assertEqual(info["source"], "https://github.com/o/r")
            self.assertEqual(info["source_dir"], str(root))
            self.assertTrue(info["available"])

    def test_unavailable_dir_reports_error(self):
        repo = code_repo.CodeRepo(source_dir=Path("/nonexistent/path/xyz"))
        repo.ensure_loaded()
        self.assertFalse(repo.loaded)
        self.assertIn("not found", repo.load_error)


if __name__ == "__main__":
    unittest.main()
