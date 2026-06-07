"""Offline dummy provider used in tests and for first-time UX.

When invoked it inspects the last user message and either:

* calls ``docs_search`` once if the user asked a documentation question,
* calls ``list_mods`` to enumerate mods if the user asked about mods,
* otherwise replies with a short canned message and finishes.

This makes the agent loop testable end-to-end without any network.
"""

from __future__ import annotations

import uuid
from typing import Any

from modkit.providers.base import (
    AssistantTurn,
    Message,
    Provider,
    ToolCall,
    ToolDef,
)


class DummyProvider(Provider):
    id = "dummy"

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._calls_made = 0

    def chat(
        self,
        messages: list[Message],
        *,
        tools: list[ToolDef] | None = None,
        system: str | None = None,
    ) -> AssistantTurn:
        last_user = next(
            (m.content for m in reversed(messages) if m.role == "user"),
            "",
        ).lower()

        # If we already ran a tool round, just finish.
        already_used_tool = any(m.role == "tool" for m in messages)
        if already_used_tool:
            return AssistantTurn(
                text=(
                    "dummy provider: tool result received, task summary follows. "
                    "Switch to a real provider (--provider openai/anthropic/gemini) "
                    "for actual work."
                ),
                tool_calls=[],
            )

        tool_names = {t.name for t in (tools or [])}

        if "docs_search" in tool_names and any(
            keyword in last_user
            for keyword in ("биом", "biome", "мод", "mod.json", "рецепт", "recipe", "класс")
        ):
            return AssistantTurn(
                text="dummy provider: looking up docs as a demo.",
                tool_calls=[
                    ToolCall(
                        id=f"call_{uuid.uuid4().hex[:8]}",
                        name="docs_search",
                        arguments={"query": last_user or "mod.json"},
                    )
                ],
            )

        if "list_mods" in tool_names and "мод" in last_user:
            return AssistantTurn(
                text="dummy provider: listing mods as a demo.",
                tool_calls=[
                    ToolCall(
                        id=f"call_{uuid.uuid4().hex[:8]}",
                        name="list_mods",
                        arguments={},
                    )
                ],
            )

        # Heuristic for write_file: the user said "создай файл"/"сделай файл"
        # and named a path. This keeps the dummy demo useful without
        # actually running an LLM.
        if "write_file" in tool_names and any(
            kw in last_user for kw in ("создай файл", "сделай файл", "create file", "write file")
        ):
            import re

            match = re.search(r"([\w./-]+\.[a-zA-Z]{1,5})", last_user)
            path = match.group(1) if match else "data/notes.json"
            content = "[]" if path.endswith(".json") and "массив" in last_user else ""
            return AssistantTurn(
                text=f"dummy provider: writing {path} as a demo.",
                tool_calls=[
                    ToolCall(
                        id=f"call_{uuid.uuid4().hex[:8]}",
                        name="write_file",
                        arguments={"path": path, "content": content},
                    )
                ],
            )

        return AssistantTurn(
            text=(
                "dummy provider: this is a stub that returns canned answers without "
                "calling any network API. Configure a real provider via `modkit init` "
                "or `modkit --provider <name> --api-key <key> ...`."
            ),
            tool_calls=[],
        )
