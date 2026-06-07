"""Shared presentation-neutral formatting for AI chat events."""

from __future__ import annotations

import json
from dataclasses import dataclass

from modkit.agent import AgentEvent


@dataclass(frozen=True)
class ChatRecord:
    kind: str
    title: str
    body: str = ""
    is_markdown: bool = False


def preview_json(value: object, limit: int = 200) -> str:
    text = json.dumps(value, ensure_ascii=False)
    if len(text) <= limit:
        return text
    return text[:limit] + "..."


def preview_text(value: str, limit: int = 300) -> str:
    if len(value) <= limit:
        return value
    return value[:limit] + "..."


def preview_tool_data(name: str, data: dict[str, object]) -> str:
    if not data:
        return ""
    parts: list[str] = []
    path = data.get("target_path") or data.get("path")
    if isinstance(path, str) and path:
        parts.append(path)
    checkpoint_id = data.get("id")
    if isinstance(checkpoint_id, str) and checkpoint_id:
        parts.append(f"id={checkpoint_id}")
    bytes_count = data.get("bytes")
    if isinstance(bytes_count, int):
        parts.append(f"{bytes_count} bytes")
    file_count = data.get("count")
    if isinstance(file_count, int) and name.startswith("checkpoint"):
        parts.append(f"{file_count} file(s)")
    changed = data.get("changed_lines")
    if isinstance(changed, int):
        parts.append(f"{changed} changed line(s)")
    if data.get("dry_run") is True:
        parts.append("dry-run")
    if parts:
        return " · ".join(parts)
    if name in {
        "analyze_source_pattern",
        "list_modapi_endpoints",
        "list_runtime_data_keys",
        "compare_mod_to_engine_contract",
    }:
        return preview_json(data)
    return ""


def event_to_record(event: AgentEvent) -> ChatRecord:
    if event.kind == "assistant_text" and event.text:
        return ChatRecord(
            kind="assistant",
            title="agent",
            body=event.text,
            is_markdown=True,
        )
    if event.kind == "tool_call" and event.tool_call is not None:
        return ChatRecord(
            kind="tool_call",
            title=f"tool: {event.tool_call.name}",
            body=preview_json(event.tool_call.arguments),
        )
    if event.kind == "tool_result" and event.tool_result is not None:
        name = event.tool_call.name if event.tool_call is not None else "tool"
        if event.tool_result.ok:
            return ChatRecord(
                kind="tool_result",
                title=f"ok {name}",
                body=preview_tool_data(name, event.tool_result.data),
            )
        # Show denied-permission hint if present
        error_text = event.tool_result.error or ""
        if event.tool_result.data and event.tool_result.data.get("denied"):
            return ChatRecord(
                kind="tool_result",
                title=f"denied {name}",
                body=preview_text(error_text),
            )
        return ChatRecord(
            kind="tool_result",
            title=f"fail {name}",
            body=preview_text(error_text),
        )
    if event.kind == "error":
        return ChatRecord(kind="error", title="error", body=event.text)
    if event.kind == "done":
        return ChatRecord(kind="done", title="done")
    return ChatRecord(kind=event.kind, title=event.kind, body=event.text)


def format_operation_log(log: list[dict[str, object]]) -> str:
    """Format an operation history log as a human-readable summary string.

    Each entry in *log* is expected to have keys: iteration, tool, ok,
    error (optional), target_path (optional).
    """
    if not log:
        return "(операций пока нет)"
    lines: list[str] = []
    for entry in log:
        iteration = entry.get("iteration", "?")
        tool = entry.get("tool", "?")
        ok = entry.get("ok", False)
        path = entry.get("target_path") or ""
        status = "ok" if ok else "fail"
        error = entry.get("error", "")
        path_part = f" → {path}" if path else ""
        error_part = f" ({error})" if error else ""
        lines.append(f"  [{iteration}] {tool}: {status}{path_part}{error_part}")
    return "\n".join(lines)
