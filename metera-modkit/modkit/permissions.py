"""Permission model: ask / auto-edit / yolo.

Each tool gets a *kind* (``read`` | ``edit`` | ``shell``). The current
mode + the tool kind decide whether the agent can run the tool
unattended, must ask the user, or has to refuse.

This module is deliberately small and pure — it contains no I/O, so
both the CLI and tests can use it.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Mode(str, Enum):
    ASK = "ask"
    AUTO_EDIT = "auto-edit"
    YOLO = "yolo"

    @classmethod
    def parse(cls, raw: str | "Mode") -> "Mode":
        if isinstance(raw, cls):
            return raw
        value = str(raw or "ask").strip().lower()
        for m in cls:
            if m.value == value:
                return m
        raise ValueError(
            f"Unknown permission mode: {raw}. Allowed: {', '.join(m.value for m in cls)}"
        )


class Kind(str, Enum):
    READ = "read"
    EDIT = "edit"
    SHELL = "shell"


class Decision(str, Enum):
    ALLOW = "allow"
    ASK = "ask"
    DENY = "deny"


@dataclass(frozen=True)
class Permission:
    decision: Decision
    reason: str = ""


_RULES: dict[Mode, dict[Kind, Decision]] = {
    Mode.ASK: {
        Kind.READ: Decision.ALLOW,
        Kind.EDIT: Decision.ASK,
        Kind.SHELL: Decision.ASK,
    },
    Mode.AUTO_EDIT: {
        Kind.READ: Decision.ALLOW,
        Kind.EDIT: Decision.ALLOW,
        Kind.SHELL: Decision.ASK,
    },
    Mode.YOLO: {
        Kind.READ: Decision.ALLOW,
        Kind.EDIT: Decision.ALLOW,
        Kind.SHELL: Decision.ALLOW,
    },
}


def evaluate(mode: Mode, kind: Kind) -> Permission:
    """Return the policy *for the mode/kind pair*, without prompting."""
    decision = _RULES.get(mode, {}).get(kind, Decision.ASK)
    return Permission(decision=decision)


def describe(mode: Mode) -> str:
    return {
        Mode.ASK: "ask — спрашивать перед каждой записью и shell-командой",
        Mode.AUTO_EDIT: "auto-edit — авто-разрешать чтение и запись файлов мода; shell спрашивать",
        Mode.YOLO: "yolo — разрешать всё без вопросов (используй с осторожностью)",
    }[mode]
