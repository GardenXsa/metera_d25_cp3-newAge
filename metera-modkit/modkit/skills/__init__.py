"""User-defined skills: pure markdown instructions for the agent.

A skill is a folder containing a ``SKILL.md`` file. The file has a
small YAML frontmatter (just ``name`` + ``description``) and a
markdown body that the agent reads when the skill is relevant.

Drop a skill in ``~/.metera-modkit/skills/<name>/SKILL.md`` and the
agent will see its description in the system prompt. The agent can
then call the ``read_skill`` tool to load the full body on demand.

No Python, no JSON, no executables — just text.
"""

from __future__ import annotations

from modkit.skills.discovery import (
    discover_user_skills,
    load_skill_file,
)
from modkit.skills.parser import (
    SKILL_NAME_RE,
    SkillParseError,
    parse_skill_md,
)
from modkit.skills.prompt import format_skills_for_prompt
from modkit.skills.tool import build_read_skill_tool
from modkit.skills.types import Skill

__all__ = [
    "Skill",
    "SKILL_NAME_RE",
    "SkillParseError",
    "discover_user_skills",
    "format_skills_for_prompt",
    "load_skill_file",
    "parse_skill_md",
    "build_read_skill_tool",
]
