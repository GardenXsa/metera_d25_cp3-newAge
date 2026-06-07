"""Native Qt GUI for metera-modkit.

Provides a proper desktop application (QMainWindow) with:

* a mod browser (left pane),
* a file tree of the active mod (middle pane),
* a tabbed work area on the right with: JSON editor with syntax
  highlighting, schema inspector, validation panel and AI chat,
* native menus, toolbars, status bar and modal dialogs.

Launch with ``modkit gui`` or just ``modkit`` (no args, when PySide6
is available — falls back to the TUI otherwise).
"""

from __future__ import annotations

from modkit.gui.main_window import launch_gui

__all__ = ["launch_gui"]
