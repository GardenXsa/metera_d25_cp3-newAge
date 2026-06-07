"""Textual TUI for metera-modkit.

The TUI is a full-screen interactive interface intended for
modders who prefer not to type ``modkit <subcommand>`` all the
time. It provides:

* a mod browser with create / duplicate / delete / export actions,
* a file tree of the selected mod,
* a tabbed editor with JSON syntax highlighting + live validation,
* a schema panel that shows the relevant ``runtime_manifest``
  entry for the current file,
* an AI agent chat panel (only enabled when a provider is
  configured),
* quick-create templates for the most common mod types.

Launch with ``modkit tui`` or just ``modkit`` (no args).
"""

from __future__ import annotations

from modkit.tui.app import ModKitApp, launch
# Re-export the templates under the old path for backwards-compat.
from modkit.templates import (  # noqa: F401
    TEMPLATES,
    get_template,
    write_template,
)

__all__ = ["ModKitApp", "launch", "TEMPLATES"]
