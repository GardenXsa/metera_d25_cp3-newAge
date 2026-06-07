"""Tests for the ``modkit.cli._ensure_source_ready`` startup hook.

This hook is the bridge between the argparse layer and
``modkit.source_manager``. It must short-circuit for ``--no-update``,
skip source-free commands (``init``/``doctor``/etc.), and respect
``--yes`` for non-interactive use. The actual clone / update logic is
covered exhaustively in :mod:`tests.test_source_manager`; here we
just verify the wiring.
"""
from __future__ import annotations

import argparse
import os
import unittest
from pathlib import Path
from unittest import mock

from modkit import cli
from modkit.source_manager import SourceSpec

# Make sure tests don't accidentally read the user's real APPDATA
# (e.g. if a previous run actually cloned something there).
os.environ["MODKIT_SOURCE_ROOT"] = str(Path(__file__).parent / "_cli_source_root")


def _ns(**overrides) -> argparse.Namespace:
    base = dict(
        no_update=False,
        yes=False,
        command="agent",
        json_output=False,
    )
    base.update(overrides)
    return argparse.Namespace(**base)


def _fake_spec() -> SourceSpec:
    return SourceSpec(owner="o", repo="r", branch="main")


class TestEnsureSourceReady(unittest.TestCase):
    def test_no_update_short_circuits(self) -> None:
        with mock.patch("modkit.source_manager.default_manager") as m:
            self.assertTrue(cli._ensure_source_ready(_ns(no_update=True)))
            m.assert_not_called()

    def test_source_free_commands_skip(self) -> None:
        for cmd in ("init", "doctor", "providers", "version", "list", "new", "validate"):
            with self.subTest(command=cmd):
                with mock.patch("modkit.source_manager.default_manager") as m:
                    self.assertTrue(cli._ensure_source_ready(_ns(command=cmd)))
                    m.assert_not_called()

    def test_cloned_and_up_to_date_returns_true(self) -> None:
        mgr = mock.MagicMock()
        mgr.is_cloned.return_value = True
        mgr.ensure_ready.return_value = True  # nothing to update
        with mock.patch("modkit.source_manager.default_manager", return_value=mgr):
            with mock.patch("modkit.source_manager.default_spec", return_value=_fake_spec()):
                self.assertTrue(cli._ensure_source_ready(_ns()))
                # hook always asks the manager to ensure-readiness when
                # the clone already exists; the manager itself decides
                # whether to actually fetch.
                mgr.ensure_ready.assert_called_once()

    def test_not_cloned_with_yes_auto_clones(self) -> None:
        mgr = mock.MagicMock()
        mgr.is_cloned.return_value = False
        mgr.ensure_ready.return_value = True
        with mock.patch("modkit.source_manager.default_manager", return_value=mgr):
            with mock.patch("modkit.source_manager.default_spec", return_value=_fake_spec()):
                ok = cli._ensure_source_ready(_ns(yes=True))
                self.assertTrue(ok)
                mgr.ensure_ready.assert_called_once()
                # the prompt must NOT have been shown — --yes short-circuits
                # before the manager ever sees the user.
                mgr.ensure_ready.assert_called_once_with(
                    mock.ANY, update=False, prompt=mock.ANY, progress=mock.ANY,
                )

    def test_user_declines_clone(self) -> None:
        mgr = mock.MagicMock()
        mgr.is_cloned.return_value = False
        # manager returns False when the prompt inside ensure_ready
        # is rejected by the user.
        mgr.ensure_ready.return_value = False
        with mock.patch("modkit.source_manager.default_manager", return_value=mgr):
            with mock.patch("modkit.source_manager.default_spec", return_value=_fake_spec()):
                with mock.patch("modkit.ui.confirm", return_value=False):
                    self.assertFalse(cli._ensure_source_ready(_ns()))
                    mgr.ensure_ready.assert_called_once()

    def test_user_accepts_clone(self) -> None:
        mgr = mock.MagicMock()
        mgr.is_cloned.return_value = False
        mgr.ensure_ready.return_value = True
        with mock.patch("modkit.source_manager.default_manager", return_value=mgr):
            with mock.patch("modkit.source_manager.default_spec", return_value=_fake_spec()):
                with mock.patch("modkit.ui.confirm", return_value=True):
                    self.assertTrue(cli._ensure_source_ready(_ns()))
                    mgr.ensure_ready.assert_called_once()

    def test_clone_failure_returns_false(self) -> None:
        from modkit.source_manager import SourceError
        mgr = mock.MagicMock()
        mgr.is_cloned.return_value = False
        mgr.ensure_ready.side_effect = SourceError("net down")
        with mock.patch("modkit.source_manager.default_manager", return_value=mgr):
            with mock.patch("modkit.source_manager.default_spec", return_value=_fake_spec()):
                with mock.patch("modkit.ui.confirm", return_value=True):
                    self.assertFalse(cli._ensure_source_ready(_ns()))

    def test_behind_user_accepts_update(self) -> None:
        mgr = mock.MagicMock()
        mgr.is_cloned.return_value = True
        mgr.has_updates.return_value = True
        mgr.ensure_ready.return_value = True
        with mock.patch("modkit.source_manager.default_manager", return_value=mgr):
            with mock.patch("modkit.source_manager.default_spec", return_value=_fake_spec()):
                with mock.patch("modkit.ui.confirm", return_value=True):
                    self.assertTrue(cli._ensure_source_ready(_ns()))
                    mgr.ensure_ready.assert_called_once()

    def test_behind_user_declines_update(self) -> None:
        mgr = mock.MagicMock()
        mgr.is_cloned.return_value = True
        mgr.has_updates.return_value = True
        # manager returns True even when user declines: the local clone
        # is still usable, so the hook treats "no update" as success.
        mgr.ensure_ready.return_value = True
        with mock.patch("modkit.source_manager.default_manager", return_value=mgr):
            with mock.patch("modkit.source_manager.default_spec", return_value=_fake_spec()):
                with mock.patch("modkit.ui.confirm", return_value=False):
                    self.assertTrue(cli._ensure_source_ready(_ns()))
                    mgr.ensure_ready.assert_called_once()

    def test_has_updates_failure_is_non_fatal(self) -> None:
        from modkit.source_manager import SourceError
        mgr = mock.MagicMock()
        mgr.is_cloned.return_value = True
        mgr.has_updates.side_effect = SourceError("net down")
        with mock.patch("modkit.source_manager.default_manager", return_value=mgr):
            with mock.patch("modkit.source_manager.default_spec", return_value=_fake_spec()):
                # network glitch during update check: keep the GUI/CLI alive
                self.assertTrue(cli._ensure_source_ready(_ns()))


if __name__ == "__main__":
    unittest.main()
