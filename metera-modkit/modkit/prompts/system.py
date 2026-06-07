"""The top-level system prompt builder.

:func:`default_system_prompt` is what the rest of the agent code
calls. It composes the operational directive, the cheatsheet, the
autonomous-mode addendum (if applicable), and any user-provided
instructions into one big string.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from modkit import docs as docs_index
from modkit.prompts.autonomous import AUTONOMOUS_ADDENDUM
from modkit.prompts.base import (
    ANTI_LYING_PROTOCOL,
    EXECUTION_MODEL,
    OPERATIONAL_DIRECTIVE,
)
from modkit.prompts.user_instr import load_user_instructions
from modkit.skills import Skill, discover_user_skills, format_skills_for_prompt


def build_system_prompt(
    *,
    autonomous: bool = False,
    mods_root: Path | None = None,
    mod_root: Path | None = None,
    extra_fragments: list[str] | None = None,
    skills: list[Skill] | None = None,
) -> str:
    """Compose the system prompt from named fragments.

    Parameters
    ----------
    autonomous
        If True, append :data:`AUTONOMOUS_ADDENDUM`.
    mods_root, mod_root
        Used to discover ``instructions.md`` files via
        :func:`load_user_instructions`.
    extra_fragments
        Free-form prompt fragments appended verbatim at the end.
    skills
        Skills to advertise in the prompt. When ``None`` the builder
        calls :func:`discover_user_skills` itself.
    """
    cheat = docs_index.cheatsheet()
    parts: list[str] = [
        OPERATIONAL_DIRECTIVE,
        EXECUTION_MODEL,
        ANTI_LYING_PROTOCOL,
        "\n---\n",
        "## ⑮ QUICK REFERENCE CHEATSHEET\n",
        cheat,
    ]
    if autonomous:
        parts.append(AUTONOMOUS_ADDENDUM)

    if extra_fragments:
        parts.extend(extra_fragments)

    user_block = load_user_instructions(mods_root=mods_root, mod_root=mod_root)
    if user_block:
        parts.append(user_block)

    if skills is None:
        skills = discover_user_skills()
    skills_block = format_skills_for_prompt(skills)
    if skills_block:
        parts.append(skills_block)

    return "".join(parts)


def default_system_prompt() -> str:
    """Convenience: build the prompt with no autonomy / no user data.

    Kept for backwards compatibility with code that imported
    ``default_system_prompt`` from ``modkit.agent`` before the
    prompts were extracted.
    """
    return build_system_prompt()
