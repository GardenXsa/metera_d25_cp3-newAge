"""Prompt fragments and builders for the agent.

Prompts live as plain Python string constants here so they are easy
to compose, easy to override from tests, and easy to version-control
without any tooling. The pieces are:

* :mod:`.base`       — operational directive (identity, identity
                       rules, anti-lying protocol, workflows).
* :mod:`.autonomous` — the AUTONOMOUS addendum appended when the
                       user picked full-auto mode.
* :mod:`.user_instr` — loader for the user's custom
                       ``instructions.md`` directives.
* :mod:`.system`     — the top-level ``default_system_prompt()``
                       that composes all of the above plus the
                       cheatsheet.

Keeping prompts in a dedicated module means the rest of the agent
code doesn't have to know how the system prompt is shaped.
"""

from __future__ import annotations

from modkit.prompts.autonomous import AUTONOMOUS_ADDENDUM
from modkit.prompts.base import (
    ANTI_LYING_PROTOCOL,
    EXECUTION_MODEL,
    OPERATIONAL_DIRECTIVE,
)
from modkit.prompts.system import (
    build_system_prompt,
    default_system_prompt,
)

__all__ = [
    "AUTONOMOUS_ADDENDUM",
    "ANTI_LYING_PROTOCOL",
    "EXECUTION_MODEL",
    "OPERATIONAL_DIRECTIVE",
    "build_system_prompt",
    "default_system_prompt",
]
