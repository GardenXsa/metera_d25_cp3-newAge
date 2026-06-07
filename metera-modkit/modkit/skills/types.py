"""Skill dataclass and shared types."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Skill:
    """A single loaded skill.

    Attributes
    ----------
    name
        Identifier the agent uses in ``read_skill(name=...)`` calls.
    description
        Short prose that goes into the system prompt so the model
        knows when to load the skill. One or two sentences.
    body
        Full markdown body. The agent reads this via ``read_skill``
        when it decides the skill is relevant.
    source
        Filesystem path of the SKILL.md the skill was loaded from.
    metadata
        All other frontmatter fields (version, when_to_use, etc.).
    """

    name: str
    description: str
    body: str
    source: Path
    metadata: dict[str, str] = field(default_factory=dict)


__all__ = ["Skill"]
