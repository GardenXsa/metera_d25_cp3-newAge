"""Discovers SKILL.md files on disk."""

from __future__ import annotations

import logging
from pathlib import Path

from modkit.skills.parser import (
    SKILL_NAME_RE,
    SkillParseError,
    parse_skill_md,
)
from modkit.skills.types import Skill


log = logging.getLogger("modkit.skills")


def load_skill_file(path: Path) -> Skill:
    """Load a single ``SKILL.md`` file from disk and return a :class:`Skill`."""
    text = path.read_text(encoding="utf-8")
    parsed = parse_skill_md(text, source=path)
    return Skill(
        name=parsed.name,
        description=parsed.description,
        body=parsed.body,
        source=path,
        metadata=parsed.metadata,
    )


def discover_user_skills(root: Path | None = None) -> list[Skill]:
    """Walk *root* for ``SKILL.md`` files and return all valid ones.

    Each file must live in its own folder (``<root>/<skill_name>/SKILL.md``).
    Files that fail to parse are logged and skipped — they never poison
    the rest of the discovery.

    The result is sorted by name for deterministic prompt output.
    """
    if root is None:
        from modkit.paths import user_skills_root

        root = user_skills_root()
    if not root.exists():
        return []
    skills: list[Skill] = []
    seen: set[str] = set()
    for skill_md in sorted(root.rglob("SKILL.md")):
        try:
            skill = load_skill_file(skill_md)
        except (SkillParseError, OSError) as exc:
            log.warning("skipping bad skill file %s: %s", skill_md, exc)
            continue
        if not SKILL_NAME_RE.match(skill.name):
            log.warning(
                "skipping skill %s: name '%s' doesn't match %s",
                skill_md, skill.name, SKILL_NAME_RE.pattern,
            )
            continue
        if skill.name in seen:
            log.warning(
                "duplicate skill name '%s' (also in %s); keeping first",
                skill.name, skill_md,
            )
            continue
        seen.add(skill.name)
        # Sanity-check the folder name matches the frontmatter name.
        folder_name = skill_md.parent.name
        if folder_name != skill.name:
            log.info(
                "skill folder '%s' doesn't match frontmatter name '%s' (using frontmatter)",
                folder_name, skill.name,
            )
        skills.append(skill)
    skills.sort(key=lambda s: s.name)
    return skills


# Re-export so callers can `from modkit.skills import Skill` etc.
__all__ = ["Skill", "discover_user_skills", "load_skill_file"]
