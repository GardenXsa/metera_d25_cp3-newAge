"""Path resolution: mods directory, packaged resources, project root.

The CLI is shipped as a standalone .exe via PyInstaller. When frozen,
resources live next to the executable (or inside the PyInstaller bundle,
in `sys._MEIPASS`). When running from source, they live in
`metera-modkit/resources/`.
"""

from __future__ import annotations

import os
import platform
import sys
from pathlib import Path


def is_frozen() -> bool:
    """True when running inside a PyInstaller bundle."""
    return getattr(sys, "frozen", False)


def resources_dir() -> Path:
    """Folder with shipped data files (README.md, runtime_manifest.json...)."""
    if is_frozen():
        # PyInstaller --onefile extracts to _MEIPASS, --onedir uses sys._MEIPASS too
        base = Path(getattr(sys, "_MEIPASS", os.path.dirname(sys.executable)))
        candidate = base / "resources"
        if candidate.exists():
            return candidate
        return base
    return Path(__file__).resolve().parent.parent / "resources"


def user_config_dir() -> Path:
    """Per-user config directory for metera-modkit itself.

    Windows: %APPDATA%\\metera-modkit
    Linux:   ~/.config/metera-modkit
    macOS:   ~/Library/Application Support/metera-modkit
    """
    system = platform.system()
    if system == "Windows":
        base = os.environ.get("APPDATA", os.path.expanduser("~\\AppData\\Roaming"))
    elif system == "Darwin":
        base = os.path.expanduser("~/Library/Application Support")
    else:
        base = os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config"))
    path = Path(base) / "metera-modkit"
    path.mkdir(parents=True, exist_ok=True)
    return path


def game_mods_dir() -> Path:
    """Where Chronicles of Meterea reads installed mods from."""
    system = platform.system()
    if system == "Windows":
        base = os.environ.get("APPDATA", os.path.expanduser("~\\AppData\\Roaming"))
    elif system == "Darwin":
        base = os.path.expanduser("~/Library/Application Support")
    else:
        base = os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config"))
    path = Path(base) / "chronicles-of-meterea" / "mods"
    path.mkdir(parents=True, exist_ok=True)
    return path


def source_root() -> Path:
    """Folder where the modkit stores cloned engine source trees.

    Per-user, under the OS app-data dir. Guaranteed writable (no
    ``Program Files`` permission issues), survives modkit reinstalls,
    and one user on a shared machine doesn't see another's working
    copy. The modkit clones ``<owner>/<repo>`` into
    ``<source>/<owner>__<repo>/`` on first run, then keeps it in sync
    via ``git fetch`` + ``git reset``.

    Locations:

    * Windows: ``%APPDATA%\\metera-modkit\\source``
    * Linux:   ``~/.config/metera-modkit/source``
    * macOS:   ``~/Library/Application Support/metera-modkit/source``

    Override with the ``MODKIT_SOURCE_ROOT`` env var for tests / unusual
    layouts.
    """
    override = os.environ.get("MODKIT_SOURCE_ROOT")
    if override:
        path = Path(override).expanduser()
    else:
        system = platform.system()
        if system == "Windows":
            base = os.environ.get("APPDATA", os.path.expanduser("~\\AppData\\Roaming"))
        elif system == "Darwin":
            base = os.path.expanduser("~/Library/Application Support")
        else:
            base = os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config"))
        path = Path(base) / "metera-modkit" / "source"
    path.mkdir(parents=True, exist_ok=True)
    return path


def user_tools_root() -> Path:
    """Per-user folder for custom agent tools.

    Drop a ``.py`` file here (``~/.metera-modkit/user_tools/``) that
    contains one or more ``@tool``-decorated functions and it will be
    auto-discovered the next time the agent starts.

    The directory is created on demand so first-time users never have
    to mkdir manually.
    """
    root = user_config_dir() / "user_tools"
    root.mkdir(parents=True, exist_ok=True)
    return root


def user_skills_root() -> Path:
    """Per-user folder for user-defined skills.

    Each skill lives in its own subfolder and must contain a
    ``SKILL.md`` file with YAML frontmatter (at minimum
    ``name`` and ``description``) and a markdown body.

    Example layout::

        ~/.metera-modkit/skills/
            strict_lore/
                SKILL.md
            translate_to_ru/
                SKILL.md

    The directory is created on demand so first-time users never
    have to mkdir manually.
    """
    root = user_config_dir() / "skills"
    root.mkdir(parents=True, exist_ok=True)
    return root


def resolve_mods_root(override: str | None) -> Path:
    """Either an explicit override (--mods-dir) or the game's default location."""
    if override:
        path = Path(override).expanduser().resolve()
        path.mkdir(parents=True, exist_ok=True)
        return path
    return game_mods_dir()


def safe_join(root: Path, rel_path: str) -> Path:
    """Join *rel_path* against *root* and guarantee the result stays inside *root*.

    Raises ValueError when the resolved path escapes the root. This is the
    primary defence the agent uses when writing files based on model output.
    """
    if rel_path is None:
        raise ValueError("path is required")
    rel = str(rel_path).replace("\\", "/").lstrip("/")
    if not rel:
        raise ValueError("path is empty")
    target = (root / rel).resolve()
    root_resolved = root.resolve()
    try:
        target.relative_to(root_resolved)
    except ValueError as exc:
        raise ValueError(f"path '{rel_path}' escapes mod root") from exc
    return target
