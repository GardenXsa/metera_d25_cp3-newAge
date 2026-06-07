"""Smoke tests for the textual TUI workbench.

These run the app in headless mode via ``App.run_test()`` and exercise
the main flows (mount, mod creation, file open, validate, schema
panel) without needing a real terminal.
"""

from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from modkit.config import Config
from modkit.tui.app import ModKitApp


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro) if False else asyncio.run(coro)


class TUISmokeTests(unittest.TestCase):
    def test_app_mounts_with_empty_mods_root(self):
        async def go():
            with tempfile.TemporaryDirectory() as tmp:
                cfg = Config(mods_dir=tmp)
                app = ModKitApp(cfg)
                async with app.run_test(size=(140, 40)) as pilot:
                    await pilot.pause()
                    from textual.widgets import DataTable, DirectoryTree

                    table = app.query_one("#mods-table", DataTable)
                    tree = app.query_one("#files-tree", DirectoryTree)
                    self.assertEqual(table.row_count, 0)
                    self.assertTrue(Path(str(tree.path)).exists())

        _run(go())

    def test_app_loads_existing_mods(self):
        async def go():
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                mod = root / "alpha_mod"
                mod.mkdir()
                (mod / "mod.json").write_text(
                    json.dumps(
                        {
                            "id": "alpha_mod",
                            "name": "Alpha",
                            "version": "1.2.3",
                            "author": "T",
                            "description": "",
                        }
                    ),
                    encoding="utf-8",
                )
                cfg = Config(mods_dir=str(root))
                app = ModKitApp(cfg)
                async with app.run_test(size=(140, 40)) as pilot:
                    await pilot.pause()
                    from textual.widgets import DataTable

                    table = app.query_one("#mods-table", DataTable)
                    self.assertEqual(table.row_count, 1)

        _run(go())

    def test_create_mod_via_template(self):
        async def go():
            with tempfile.TemporaryDirectory() as tmp:
                cfg = Config(mods_dir=tmp)
                app = ModKitApp(cfg)
                async with app.run_test(size=(140, 40)) as pilot:
                    await pilot.pause()
                    # Open new-mod modal and fill the fields.
                    await pilot.press("ctrl+n")
                    await pilot.pause()
                    # The modal is pushed as its own screen; look up
                    # the inputs there.
                    screen = app.screen
                    screen.query_one("#new-mod-id").value = "tui_demo"
                    screen.query_one("#new-mod-name").value = "TUI Demo"
                    screen.query_one("#new-mod-template").value = "item"
                    await pilot.click("#new-mod-ok")
                    await pilot.pause()
                    # Mod should now exist on disk.
                    mod_path = Path(tmp) / "tui_demo"
                    self.assertTrue((mod_path / "mod.json").exists())
                    self.assertTrue((mod_path / "data" / "items.json").exists())
                    data = json.loads((mod_path / "data" / "items.json").read_text("utf-8"))
                    self.assertEqual(data[0]["id"], "tui_demo_example_item")

        _run(go())

    def test_validate_mod_action(self):
        async def go():
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                mod = root / "broken"
                mod.mkdir()
                (mod / "mod.json").write_text("{}", encoding="utf-8")
                cfg = Config(mods_dir=str(root))
                app = ModKitApp(cfg)
                async with app.run_test(size=(140, 40)) as pilot:
                    await pilot.pause()
                    # Pick the only mod in the table.
                    from textual.widgets import DataTable

                    table = app.query_one("#mods-table", DataTable)
                    table.focus()
                    await pilot.press("down")
                    await pilot.pause()
                    await pilot.press("f5")
                    await pilot.pause()
                    self.assertIn("невалиден", app.last_validation)

        _run(go())


if __name__ == "__main__":
    unittest.main()
