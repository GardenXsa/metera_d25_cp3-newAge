"""User interaction tools for the agent.

The agent can already write assistant text, but a tool gives UI and CLI
frontends a structured hook for questions that must pause work until
the user answers.
"""

from __future__ import annotations

from typing import Any

from modkit.permissions import Kind
from modkit.tools.registry import Tool, ToolContext, ToolResult


def _normalise_options(raw: Any) -> list[str]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("'options' must be an array of strings")
    options: list[str] = []
    for item in raw:
        text = str(item).strip()
        if text:
            options.append(text)
    return options


def _ask_user(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    question = str(args.get("question") or "").strip()
    if not question:
        return ToolResult(ok=False, error="'question' is required")

    options = _normalise_options(args.get("options"))
    payload = {
        "question": question,
        "reason": str(args.get("reason") or "").strip(),
        "options": options,
        "default": str(args.get("default") or "").strip(),
    }

    callback = ctx.extra.get("ask_user")
    if not callable(callback):
        return ToolResult(
            ok=False,
            error="ask_user handler is not configured",
            data={
                "requires_user_input": True,
                **payload,
            },
        )

    answer = callback(payload)
    if isinstance(answer, dict):
        value = str(answer.get("answer") or "").strip()
        data = {**payload, **answer, "answer": value}
    else:
        value = str(answer or "").strip()
        data = {**payload, "answer": value}
    if not value:
        return ToolResult(
            ok=False,
            error="user did not provide an answer",
            data={"requires_user_input": True, **payload},
        )
    return ToolResult(ok=True, content=value, data=data)


def build_interaction_tools() -> list[Tool]:
    return [
        Tool(
            name="ask_user",
            description=(
                "Ask the user a structured question when progress would be unsafe "
                "without a human choice. Frontends provide ctx.extra['ask_user']; "
                "without it, the tool returns a structured blocker."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "question": {"type": "string"},
                    "reason": {"type": "string"},
                    "options": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "default": {"type": "string"},
                },
                "required": ["question"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_ask_user,
        )
    ]


__all__ = ["build_interaction_tools"]
