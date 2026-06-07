"""The ``read_skill`` tool the agent uses to load a skill's body."""

from __future__ import annotations

from typing import Any

from modkit.permissions import Kind
from modkit.skills.types import Skill
from modkit.tools.registry import Tool, ToolContext, ToolResult


def build_read_skill_tool(skills: list[Skill]) -> Tool:
    """Build a tool that returns the body of a skill by name.

    If *skills* is empty, the tool is still registered — it just
    reports that no skills are loaded, which makes mistakes easier
    to diagnose.
    """
    by_name: dict[str, Skill] = {s.name: s for s in skills}

    def handler(args: dict[str, Any], _ctx: ToolContext) -> ToolResult:
        name = (args.get("name") or "").strip()
        if not name:
            return ToolResult(ok=False, error="missing required argument 'name'")
        skill = by_name.get(name)
        if skill is None:
            available = ", ".join(sorted(by_name)) or "(none loaded)"
            return ToolResult(
                ok=False,
                error=f"unknown skill '{name}'. Available: {available}",
            )
        return ToolResult(
            ok=True,
            content=skill.body,
            data={
                "name": skill.name,
                "source": str(skill.source),
                "description": skill.description,
            },
        )

    description = (
        "Read the full body of a user-defined skill (a SKILL.md file). "
        "Use this after checking the 'AVAILABLE SKILLS' section of the "
        "system prompt to load the instructions for a relevant skill."
    )
    if not skills:
        description += " (No skills are currently loaded.)"

    return Tool(
        name="read_skill",
        description=description,
        parameters={
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Skill name to read. Must match the frontmatter 'name' field.",
                }
            },
            "required": ["name"],
        },
        kind=Kind.READ,
        handler=handler,
    )


__all__ = ["build_read_skill_tool"]
