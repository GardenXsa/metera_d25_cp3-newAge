# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller build spec for metera-modkit.

Build a single-file .exe::

    pip install pyinstaller
    pyinstaller --noconfirm build.spec

The result lands in ``dist/modkit.exe``. The ``resources/`` directory is
bundled inside the executable and unpacked to ``sys._MEIPASS`` at run
time. ``modkit.paths.resources_dir()`` already knows about that layout.
"""

from pathlib import Path

ROOT = Path(SPECPATH).resolve()  # noqa: F821 - injected by PyInstaller
RESOURCES = ROOT / "resources"

resource_datas = []
if RESOURCES.exists():
    for file in RESOURCES.iterdir():
        if file.is_file():
            resource_datas.append((str(file), "resources"))


a = Analysis(  # noqa: F821 - injected by PyInstaller
    [str(ROOT / "modkit" / "__main__.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=resource_datas,
    hiddenimports=[
        "modkit.cli",
        "modkit.agent",
        "modkit.config",
        "modkit.docs",
        "modkit.paths",
        "modkit.permissions",
        "modkit.templates",
        "modkit.ui",
        "modkit.validate",
        "modkit.providers",
        "modkit.providers.base",
        "modkit.providers.http",
        "modkit.providers.registry",
        "modkit.providers.openai",
        "modkit.providers.anthropic",
        "modkit.providers.gemini",
        "modkit.providers.dummy",
        "modkit.tools",
        "modkit.tools.registry",
        "modkit.tools.fs",
        "modkit.tools.docs_tools",
        "modkit.tools.mod_tools",
        "modkit.tools.shell_tool",
        "modkit.tools.run_game",
        "modkit.tools.preflight_tool",
        "modkit.preflight",
        "modkit.tools.runtime_log",
        "modkit.tools.custom_checks",
        "modkit.tools.validate_e2e",
        "modkit.tools.check_tools",
        "modkit.code_repo",
        "modkit.tools.code_tools",
        "modkit.source_manager",
        "modkit.ssl_helpers",
        "modkit.mod_data",
        "modkit.tools.data_tools",
        "modkit.mod_inventory",
        "modkit.todo",
        "modkit.tools.todo_tool",
        "modkit.prompts",
        "modkit.prompts.base",
        "modkit.prompts.autonomous",
        "modkit.prompts.system",
        "modkit.prompts.user_instr",
        "modkit.user_tools",
        "modkit.user_tools.decorator",
        "modkit.user_tools.discovery",
        "modkit.skills",
        "modkit.skills.types",
        "modkit.skills.parser",
        "modkit.skills.discovery",
        "modkit.skills.prompt",
        "modkit.skills.tool",
        "modkit.tui",
        "modkit.tui.app",
        "modkit.gui",
        "modkit.gui.main_window",
        "modkit.gui.dialogs",
        "modkit.gui.json_highlighter",
        "textual",
        "textual.widgets",
        "textual.widgets._text_area",
        "textual.widgets._directory_tree",
        "textual.widgets._tabbed_content",
        "textual.widgets._tab_pane",
        "textual.widgets._tabs",
        "textual.widgets._tab",
        "textual.widgets._content_switcher",
        "textual.widgets._button",
        "textual.widgets._input",
        "textual.widgets._label",
        "textual.widgets._data_table",
        "textual.widgets._select",
        "textual.widgets._static",
        "textual.widgets._rich_log",
        "textual.widgets._tree",
        "textual.widgets._footer",
        "textual.widgets._header",
        "textual.widgets._markdown",
        "textual.widgets._option_list",
        "textual.widgets._list_view",
        "textual.widgets._list_item",
        "textual.widgets._radio_set",
        "textual.widgets._radio_button",
        "textual.widgets._checkbox",
        "textual.widgets._switch",
        "textual.widgets._progress_bar",
        "textual.widgets._rule",
        "textual.widgets._log",
        "textual.containers",
        "textual.screen",
        "textual.binding",
        "textual.reactive",
        "textual.worker",
        "PySide6",
        "PySide6.QtCore",
        "PySide6.QtGui",
        "PySide6.QtWidgets",
        "shiboken6",
        "rich",
        "rich.console",
        "rich.markdown",
        "rich.syntax",
        "rich.text",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter",
        "customtkinter",
        "PIL.ImageQt",
        "numpy",
        "pytest",
        "django",
        "flask",
        "unittest",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)  # noqa: F821 - injected by PyInstaller

exe = EXE(  # noqa: F821 - injected by PyInstaller
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="modkit",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)
