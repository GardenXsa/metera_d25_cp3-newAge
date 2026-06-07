"""Loader for the user's custom instructions.

The user (or their team) can drop a Markdown file at any of these
locations and the agent will treat its body as part of its system
prompt:

* ``<mods_root>/instructions.md``       — applies to the whole project
* ``<mods_root>/<mod_id>/instructions.md`` — applies to one mod
* ``~/.metera_modkit/instructions.md``  — applies globally (user-level)

The files are merged in user → mod → project order, with later
files overriding / appending to earlier ones. A header at the top
of each fragment shows where it came from so the agent knows which
directive came from whom.

This is how teams enforce coding standards, house style, banned
keywords, lore rules etc. without forking the agent.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterable


_USER_LEVEL_FILENAME = "instructions.md"
_PROJECT_LEVEL_FILENAME = "instructions.md"


def user_level_path() -> Path:
    """``~/.metera_modkit/instructions.md`` (always per-user)."""
    return Path.home() / ".metera_modkit" / _USER_LEVEL_FILENAME


def project_level_path(mods_root: Path) -> Path:
    """``<mods_root>/instructions.md``."""
    return Path(mods_root) / _PROJECT_LEVEL_FILENAME


def mod_level_path(mod_root: Path) -> Path:
    """``<mod_root>/instructions.md``."""
    return Path(mod_root) / _USER_LEVEL_FILENAME


def load_user_instructions(
    *,
    mods_root: Path | None = None,
    mod_root: Path | None = None,
) -> str:
    """Compose all available instruction fragments into one block.

    Returns an empty string if nothing is configured. Fragments are
    concatenated in priority order (lowest first) and wrapped in
    fenced sections so the model can tell them apart.
    """
    fragments: list[tuple[str, str]] = []
    user_path = user_level_path()
    if user_path.is_file():
        fragments.append((_label("user-level", user_path), _safe_read(user_path)))

    if mods_root is not None:
        proj_path = project_level_path(mods_root)
        if proj_path.is_file():
            fragments.append((_label("project-level", proj_path), _safe_read(proj_path)))

    if mod_root is not None:
        mod_path = mod_level_path(mod_root)
        if mod_path.is_file():
            fragments.append((_label("mod-level", mod_path), _safe_read(mod_path)))

    if not fragments:
        return ""

    parts: list[str] = ["\n---\n", "\n## ⓑ USER-PROVIDED INSTRUCTIONS\n"]
    parts.append(
        "The following directives were added by the user (or their team). "
        "They are NOT defaults — honour them. If a user directive conflicts "
        "with a built-in rule, the user directive wins for the scope it "
        "applies to (user-level < project-level < mod-level, mod being the "
        "most specific).\n"
    )
    for label, body in fragments:
        parts.append(f"\n### {label}\n")
        parts.append(body.rstrip() + "\n")
    return "".join(parts)


def iter_instruction_paths(
    *,
    mods_root: Path | None = None,
    mod_root: Path | None = None,
) -> Iterable[Path]:
    """Yield all instruction paths in load order, even if missing."""
    yield user_level_path()
    if mods_root is not None:
        yield project_level_path(mods_root)
    if mod_root is not None:
        yield mod_level_path(mod_root)


def _label(scope: str, path: Path) -> str:
    return f"Instructions — {scope} ({path})"


def _safe_read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig")
    except OSError:
        return ""
