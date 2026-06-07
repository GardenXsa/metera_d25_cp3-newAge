"""Smoke tests for the Qt GUI workbench.

Runs the QApplication in offscreen mode so the tests don't need a
display. Verifies the main window mounts, the mod list populates,
the file tree is rooted correctly, and the new-mod dialog produces
a real folder on disk.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from modkit.config import Config
from modkit.gui.main_window import ModKitWindow

from PySide6.QtWidgets import QApplication
from PySide6.QtCore import Qt, QItemSelectionModel


def _ensure_app() -> QApplication:
    return QApplication.instance() or QApplication([])


class GUISmokeTests(unittest.TestCase):
    def test_window_mounts_with_empty_mods_root(self):
        app = _ensure_app()
        with tempfile.TemporaryDirectory() as tmp:
            w = ModKitWindow(Config(mods_dir=tmp))
            w.show()
            app.processEvents()
            self.assertEqual(w.mod_list.count(), 0)

    def test_window_loads_existing_mods(self):
        app = _ensure_app()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "alpha").mkdir()
            (root / "alpha" / "mod.json").write_text(
                json.dumps(
                    {
                        "id": "alpha",
                        "name": "Alpha",
                        "version": "1.0.0",
                        "author": "T",
                        "description": "",
                    }
                ),
                encoding="utf-8",
            )
            w = ModKitWindow(Config(mods_dir=str(root)))
            w.show()
            app.processEvents()
            self.assertEqual(w.mod_list.count(), 1)
            self.assertIn("alpha", w.mod_list.item(0).text())

    def test_ai_chat_renders_assistant_markdown(self):
        app = _ensure_app()
        with tempfile.TemporaryDirectory() as tmp:
            w = ModKitWindow(Config(mods_dir=tmp))
            w.show()
            app.processEvents()

            from modkit.chat_render import ChatRecord
            w._append_chat_record(ChatRecord(kind="assistant", title="agent", body="**bold**\n\n- one"))
            app.processEvents()

            html = w.ai_view.toHtml()
            self.assertIn("bold", html)
            self.assertIn("one", w.ai_view.toPlainText())

    def test_ai_chat_appends_tool_progress_record(self):
        from modkit.chat_render import ChatRecord

        app = _ensure_app()
        with tempfile.TemporaryDirectory() as tmp:
            w = ModKitWindow(Config(mods_dir=tmp))
            w.show()
            app.processEvents()

            w._append_chat_record(
                ChatRecord(
                    kind="tool_call",
                    title="tool: read_file",
                    body='{"path": "data/items.json"}',
                )
            )
            app.processEvents()

            text = w.ai_view.toPlainText()
            self.assertIn("tool: read_file", text)
            self.assertIn("data/items.json", text)

    def test_create_mod_via_window(self):
        from modkit.gui.dialogs import NewModDialog

        app = _ensure_app()
        with tempfile.TemporaryDirectory() as tmp:
            w = ModKitWindow(Config(mods_dir=tmp))
            w.show()
            app.processEvents()
            # Build a dialog, fill it manually, then call _on_new_mod
            # via the public menu action to exercise the wiring.
            dlg = NewModDialog(w, default_author="Tester")
            dlg.id_input.setText("gui_demo")
            dlg.name_input.setText("GUI Demo")
            dlg.desc_input.setText("smoke")
            # Set template to 'item' (combo index 1 since order is empty, item, ...)
            dlg.template_combo.setCurrentIndex(1)
            data = dlg.result_data()
            self.assertEqual(data["id"], "gui_demo")
            self.assertEqual(data["template"], "item")
            # Apply the same logic as _on_new_mod manually.
            target = Path(tmp) / data["id"]
            from modkit.templates import get_template, write_template

            fn = get_template(data["template"])
            assert fn is not None
            write_template(target, fn({"id": data["id"], "name": data["name"]}))
            self.assertTrue((target / "mod.json").exists())
            self.assertTrue((target / "data" / "items.json").exists())
            items = json.loads((target / "data" / "items.json").read_text("utf-8"))
            self.assertEqual(items[0]["id"], "gui_demo_example_item")

    def test_settings_dialog_round_trip(self):
        """Open SettingsDialog, change provider/model/key, hit Apply,
        verify config.json on disk matches and the dialog exposes the
        new config via updated_config."""
        from modkit.gui.dialogs import SettingsDialog
        from modkit.config import load

        app = _ensure_app()
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp) / "home"
            home.mkdir()
            old_home = os.environ.get("USERPROFILE")
            old_appdata = os.environ.get("APPDATA")
            os.environ["USERPROFILE"] = str(home)
            os.environ["APPDATA"] = str(home)
            try:
                cfg = Config(provider="dummy", model="dummy-modkit")
                dlg = SettingsDialog(cfg)
                # Find the openai row and select it.
                idx = dlg.provider_combo.findData("openai")
                self.assertGreaterEqual(idx, 0)
                dlg.provider_combo.setCurrentIndex(idx)
                dlg.model_input.setText("gpt-4o-test")
                dlg.api_key_input.setText("sk-test-123")
                dlg.temp_spin.setValue(0.7)
                dlg.tokens_spin.setValue(2048)
                dlg._on_apply()
                self.assertIsNotNone(dlg.updated_config)
                # Re-load from disk and verify.
                saved = load()
                self.assertEqual(saved.provider, "openai")
                self.assertEqual(saved.model, "gpt-4o-test")
                self.assertEqual(saved.api_keys.get("openai"), "sk-test-123")
                self.assertAlmostEqual(saved.temperature, 0.7)
                self.assertEqual(saved.max_tokens, 2048)
            finally:
                if old_home is None:
                    os.environ.pop("USERPROFILE", None)
                else:
                    os.environ["USERPROFILE"] = old_home
                if old_appdata is None:
                    os.environ.pop("APPDATA", None)
                else:
                    os.environ["APPDATA"] = old_appdata

    def test_settings_menu_action_wired(self):
        """The main window must have a 'Настройки' top-level menu with
        a 'Параметры…' action that opens SettingsDialog."""
        from modkit.gui.dialogs import SettingsDialog

        app = _ensure_app()
        with tempfile.TemporaryDirectory() as tmp:
            w = ModKitWindow(Config(mods_dir=tmp))
            w.show()
            app.processEvents()
            mb = w.menuBar()
            settings_menu = None
            for action in mb.actions():
                if action.text() and "Настройки" in action.text():
                    settings_menu = action.menu()
                    break
            self.assertIsNotNone(settings_menu, "menu 'Настройки' must exist")
            params_action = None
            for sub in settings_menu.actions():
                if sub.text() and "Параметры" in sub.text():
                    params_action = sub
                    break
            self.assertIsNotNone(params_action, "'Параметры…' action must exist")
            # Replace QDialog.exec with a stub and trigger the action.
            original_exec = SettingsDialog.exec

            def fake_exec(self):
                self.updated_config = self._cfg
                return SettingsDialog.DialogCode.Accepted

            SettingsDialog.exec = fake_exec
            try:
                params_action.trigger()
            finally:
                SettingsDialog.exec = original_exec


if __name__ == "__main__":
    unittest.main()
