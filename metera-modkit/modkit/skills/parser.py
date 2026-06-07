"""SKILL.md parser: YAML frontmatter (no PyYAML dep) + markdown body.

The format is intentionally minimal:

    ---
    name: strict_lore
    description: Lock the agent to canonical Meterea lore.
    ---

    # Strict Lore — Directives
    ...

Supported frontmatter shapes:

- ``key: value``         — single line, optional surrounding quotes.
- ``key: |``             — literal block scalar (next indented lines).
- ``key: >``             — folded block scalar (lines joined by space).
- ``# comment``          — ignored.
- blank lines            — ignored.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


SKILL_NAME_RE = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")


class SkillParseError(ValueError):
    """Raised when a SKILL.md file is malformed."""


@dataclass
class ParsedSkillMd:
    """The output of :func:`parse_skill_md`."""

    name: str
    description: str
    body: str
    metadata: dict[str, str]
    source: Path | None = None


def parse_skill_md(text: str, source: Path | None = None) -> ParsedSkillMd:
    """Parse a SKILL.md string and return a structured result.

    Raises :class:`SkillParseError` when the file is missing the
    frontmatter delimiters, when required keys are absent, or when the
    name doesn't match :data:`SKILL_NAME_RE`.
    """
    frontmatter, body = _split_frontmatter(text, source=source)
    name = frontmatter.get("name", "").strip()
    description = frontmatter.get("description", "").strip()
    if not name:
        raise SkillParseError("frontmatter is missing required key 'name'")
    if not description:
        raise SkillParseError("frontmatter is missing required key 'description'")
    if not SKILL_NAME_RE.match(name):
        raise SkillParseError(
            f"skill name '{name}' is invalid: must match {SKILL_NAME_RE.pattern}"
        )
    return ParsedSkillMd(
        name=name,
        description=description,
        body=body.strip("\n"),
        metadata=frontmatter,
        source=source,
    )


def _split_frontmatter(text: str, source: Path | None) -> tuple[dict[str, str], str]:
    if not text.startswith("---"):
        raise SkillParseError("file does not start with '---' frontmatter delimiter")
    lines = text.splitlines()
    if not lines or lines[0].rstrip() != "---":
        raise SkillParseError("file does not start with '---' frontmatter delimiter")
    end_idx = None
    for i in range(1, len(lines)):
        if lines[i].rstrip() == "---":
            end_idx = i
            break
    if end_idx is None:
        raise SkillParseError("unterminated frontmatter (no closing '---')")
    frontmatter_text = "\n".join(lines[1:end_idx])
    body = "\n".join(lines[end_idx + 1 :])
    return _parse_simple_yaml(frontmatter_text, source=source), body


def _parse_simple_yaml(text: str, source: Path | None) -> dict[str, str]:
    out: dict[str, str] = {}
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            i += 1
            continue
        if ":" not in line:
            raise SkillParseError(
                _loc(source, i + 1, f"line '{line}' is not a 'key: value' pair")
            )
        key, _, value = line.partition(":")
        key = key.strip()
        if not key:
            raise SkillParseError(_loc(source, i + 1, "empty key"))
        value = value.strip()
        if value == "|" or value == ">" or value.startswith("|") or value.startswith(">"):
            # |  or |- or |+ etc, with optional chomping indicator
            style = value[0]
            block_lines: list[str] = []
            j = i + 1
            while j < len(lines):
                next_line = lines[j]
                if not next_line.strip():
                    block_lines.append("")
                    j += 1
                    continue
                indent = len(next_line) - len(next_line.lstrip())
                if indent == 0:
                    break
                # strip common leading indent (assume 2)
                block_lines.append(next_line[2:] if next_line.startswith("  ") else next_line.lstrip())
                j += 1
            if style == "|":
                joined = "\n".join(block_lines).rstrip()
            else:
                joined = " ".join(s for s in block_lines if s).strip()
            out[key] = joined
            i = j
            continue
        # plain scalar
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        out[key] = value
        i += 1
    return out


def _loc(source: Path | None, lineno: int, message: str) -> str:
    if source is not None:
        return f"{source}:{lineno}: {message}"
    return f"line {lineno}: {message}"
