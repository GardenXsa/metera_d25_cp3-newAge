"""Agent tool-loop. Provider-agnostic.

The agent receives a user task, calls the LLM with the available tools,
executes any requested tool calls, feeds the results back, and loops
until the model returns a turn without tool calls (or we hit the
iteration cap).

Also implements a *text-fallback* parser: when a provider doesn't
emit native tool calls but the model embeds them as JSON in text
(the format the original ModKit used), we extract and run them too.

The system prompt is composed by :mod:`modkit.prompts`; this module
just wires it into the loop and handles iteration / event emission.
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable

from modkit.prompts.system import build_system_prompt
from modkit.providers.base import (
    AssistantTurn,
    Message,
    Provider,
    ProviderError,
    ToolCall,
)
from modkit.permissions import Kind
from modkit.todo import all_done as todos_all_done
from modkit.tools.registry import ToolContext, ToolRegistry, ToolResult


JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*([\s\S]+?)```", re.IGNORECASE)

VALIDATION_TOOL = "validate_e2e"
VALIDATION_EXEMPT_EDIT_TOOLS = {
    "todo",
    "agent_clipboard",
    "checkpoint_create",
    "register_check",
    "delete_check",
}

# Maximum consecutive failed tool calls before the autonomous loop stops.
MAX_CONSECUTIVE_FAILS = 3


@dataclass
class AgentEvent:
    kind: str  # "assistant_text" | "tool_call" | "tool_result" | "done" | "error"
    text: str = ""
    tool_call: ToolCall | None = None
    tool_result: ToolResult | None = None
    meta: dict[str, object] = field(default_factory=dict)


# Backwards-compat re-export. The old import site did
# `from modkit.agent import default_system_prompt`. We keep the name
# so older callers and tests don't break.
def default_system_prompt() -> str:
    return build_system_prompt()


def run_agent(
    *,
    provider: Provider,
    registry: ToolRegistry,
    ctx: ToolContext,
    user_task: str,
    history: list[Message] | None = None,
    system: str | None = None,
    max_iterations: int = 20,
    autonomous: bool = False,
    mods_root: Path | None = None,
    mod_root: Path | None = None,
    on_event: Callable[[AgentEvent], None] | None = None,
) -> list[Message]:
    """Run the agent loop until completion or *max_iterations*.

    Returns the full message list (without the system prompt) so the
    caller can persist or continue the conversation.

    When ``autonomous`` is True the agent also gets the AUTONOMOUS
    addendum appended to its system prompt and the loop keeps going
    past the first "no more tool calls" turn as long as the TODO
    list still has open items (up to ``max_iterations``). When the
    TODO list is empty *and* the model emits no tool calls, the
    loop exits cleanly with a final summary.
    """
    if system is None:
        system_prompt = build_system_prompt(
            autonomous=autonomous,
            mods_root=mods_root,
            mod_root=mod_root,
        )
    else:
        system_prompt = system
    notify = on_event or (lambda event: None)
    messages: list[Message] = list(history or [])
    messages.append(Message(role="user", content=user_task))

    tools = registry.definitions()
    needs_validation = False
    consecutive_fails = 0
    operation_log: list[dict[str, Any]] = []  # history of tool operations

    for iteration in range(max_iterations):
        try:
            turn = provider.chat(messages, tools=tools, system=system_prompt)
        except (ProviderError, ConnectionError) as exc:
            notify(AgentEvent(kind="error", text=str(exc)))
            messages.append(Message(role="assistant", content=f"[error] {exc}"))
            return messages

        # Capture native tool calls plus any text-embedded JSON tool calls.
        native_calls = list(turn.tool_calls)
        embedded_calls = _extract_text_tool_calls(turn.text) if not native_calls else []
        all_calls = native_calls + embedded_calls

        if turn.text:
            notify(AgentEvent(kind="assistant_text", text=turn.text))

        # Persist the assistant turn — without embedded-only calls we still
        # need the text in history for context.
        messages.append(
            Message(role="assistant", content=turn.text, tool_calls=native_calls)
        )

        if not all_calls:
            # In autonomous mode we keep iterating as long as the TODO
            # list has open items; the model can use that chance to
            # emit the next batch of tool calls.
            if autonomous and not todos_all_done(ctx):
                # Nudge it back into action.
                nudge = (
                    "TODO list still has open items. Continue working — "
                    "call the next tool, mark TODOs done, or write a final "
                    "summary if everything is actually complete."
                )
                messages.append(Message(role="user", content=nudge))
                notify(AgentEvent(kind="assistant_text", text=f"[autonomous nudge] {nudge}"))
                continue
            if autonomous and needs_validation:
                nudge = (
                    "validate_e2e has not passed after file-changing tools. "
                    "Continue working: call validate_e2e, fix any errors it "
                    "reports, and only finish after validate_e2e returns ok."
                )
                messages.append(Message(role="user", content=nudge))
                notify(AgentEvent(kind="assistant_text", text=f"[autonomous nudge] {nudge}"))
                continue
            notify(AgentEvent(kind="done", text=turn.text))
            notify(AgentEvent(kind="operation_log", text=json.dumps(operation_log, ensure_ascii=False)))
            return messages

        for call in all_calls:
            notify(AgentEvent(kind="tool_call", tool_call=call))
            result = registry.run(call.name, call.arguments, ctx)

            # Track operation history
            operation_log.append({
                "iteration": iteration + 1,
                "tool": call.name,
                "ok": result.ok,
                "error": result.error if not result.ok else None,
                "target_path": result.data.get("target_path") or result.data.get("path") if result.data else None,
            })

            # Consecutive-fail tracking (autonomous mode)
            if autonomous:
                if not result.ok:
                    consecutive_fails += 1
                else:
                    consecutive_fails = 0

                if consecutive_fails >= MAX_CONSECUTIVE_FAILS:
                    diag = (
                        f"Агент сделал {MAX_CONSECUTIVE_FAILS} неудачных вызова инструментов подряд. "
                        f"Последний инструмент: {call.name} — ошибка: {result.error}. "
                        f"Автономная работа остановлена. Проверьте план и исправьте проблему."
                    )
                    notify(AgentEvent(kind="error", text=diag))
                    messages.append(Message(role="assistant", content=f"[stopped] {diag}"))
                    return messages

                if call.name == VALIDATION_TOOL:
                    needs_validation = not result.ok
                elif _tool_requires_validation(registry, call, result):
                    needs_validation = True

            notify(
                AgentEvent(
                    kind="tool_result",
                    tool_call=call,
                    tool_result=result,
                )
            )
            messages.append(
                Message(
                    role="tool",
                    content=result.to_json(),
                    tool_call_id=call.id,
                    name=call.name,
                )
            )

    notify(
        AgentEvent(
            kind="error",
            text=f"agent stopped after {max_iterations} iterations without finishing",
        )
    )
    messages.append(
        Message(
            role="assistant",
            content=(
                f"[stopped] reached max iterations ({max_iterations}). "
                "Re-run with --max-iterations <N> or finish manually."
            ),
        )
    )
    return messages


def _tool_requires_validation(
    registry: ToolRegistry,
    call: ToolCall,
    result: ToolResult,
) -> bool:
    if not result.ok:
        return False
    if bool(call.arguments.get("dry_run")) or bool(result.data.get("dry_run")):
        return False
    if call.name in VALIDATION_EXEMPT_EDIT_TOOLS:
        return False
    tool = registry.get(call.name)
    return bool(tool is not None and tool.kind == Kind.EDIT)


def _extract_text_tool_calls(text: str) -> list[ToolCall]:
    if not text:
        return []
    raw_candidates: list[str] = []
    for match in JSON_BLOCK_RE.findall(text):
        raw_candidates.append(match.strip())
    stripped = text.strip()
    if stripped.startswith("{") or stripped.startswith("["):
        raw_candidates.append(stripped)

    calls: list[ToolCall] = []
    for raw in raw_candidates:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            continue
        for normalised in _normalise_calls_payload(payload):
            calls.append(normalised)
    return calls


def _normalise_calls_payload(payload: object) -> Iterable[ToolCall]:
    if isinstance(payload, dict) and isinstance(payload.get("tool_calls"), list):
        for entry in payload["tool_calls"]:
            converted = _entry_to_call(entry)
            if converted is not None:
                yield converted
        return
    if isinstance(payload, list):
        for entry in payload:
            converted = _entry_to_call(entry)
            if converted is not None:
                yield converted
        return
    if isinstance(payload, dict):
        converted = _entry_to_call(payload)
        if converted is not None:
            yield converted


def _entry_to_call(entry: object) -> ToolCall | None:
    if not isinstance(entry, dict):
        return None
    name = entry.get("tool") or entry.get("name")
    if not name:
        return None
    args = entry.get("args") or entry.get("arguments") or {}
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except json.JSONDecodeError:
            args = {"_raw": args}
    if not isinstance(args, dict):
        args = {"value": args}
    return ToolCall(
        id=str(entry.get("id") or f"call_{uuid.uuid4().hex[:8]}"),
        name=str(name),
        arguments=args,
    )
