"""Format a list of skills for inclusion in the agent's system prompt."""

from __future__ import annotations

from modkit.skills.types import Skill


def format_skills_for_prompt(skills: list[Skill]) -> str:
    """Return a prompt fragment listing *skills* by name + description.

    Returns an empty string when there are no skills so the caller
    can splice the result unconditionally.
    """
    if not skills:
        return ""
    lines: list[str] = [
        "",
        "---",
        "",
        "## ⓐ AVAILABLE SKILLS",
        "",
        "The following user-defined skills are available. When a task",
        "matches a skill's description, call `read_skill(name=\"<name>\")`",
        "to load the full instructions before continuing.",
        "",
    ]
    for s in skills:
        lines.append(f"- **{s.name}** — {s.description}")
    lines.append("")
    return "\n".join(lines)


__all__ = ["format_skills_for_prompt"]
