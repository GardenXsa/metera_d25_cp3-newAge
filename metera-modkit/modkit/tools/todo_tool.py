"""TODO management tools.

Exposes a single ``todo`` tool with an ``action`` argument instead
of five separate tools. The LLM only needs to learn one verb:
``todo(action="list"|"add"|"update"|"done"|"remove"|"clear_done", ...)``.

The state lives on the ToolContext (``ctx.todos``) so it survives
across iterations of the agent loop and is visible in the GUI's
chat panel (the GUI subscribes to ``ToolResult`` events to refresh
its TODO widget).
"""

from __future__ import annotations

from typing import Any

from modkit.permissions import Kind
from modkit.todo import VALID_STATUSES, TodoState, get_state
from modkit.tools.registry import Tool, ToolContext, ToolResult


_VALID_ACTIONS = ("list", "add", "update", "set_status", "done", "remove", "clear_done", "clear")


def _todo(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    action = str(args.get("action") or "list").strip().lower()
    if action not in _VALID_ACTIONS:
        return ToolResult(
            ok=False,
            error=f"unknown action '{action}'. Valid: {', '.join(_VALID_ACTIONS)}",
        )

    state = get_state(ctx)

    if action == "list":
        return ToolResult(ok=True, data=state.summary())

    if action == "add":
        title = str(args.get("title") or "").strip()
        if not title:
            return ToolResult(ok=False, error="'title' is required for action=add")
        notes = str(args.get("notes") or "")
        item = state.add(title=title, notes=notes)
        return ToolResult(ok=True, data={"added": item.to_dict(), "summary": state.summary()})

    if action == "set_status":
        item_id = _coerce_id(args.get("id"))
        if item_id is None:
            return ToolResult(ok=False, error="'id' is required for action=set_status")
        status = str(args.get("status") or "").strip().lower()
        if status not in VALID_STATUSES:
            return ToolResult(
                ok=False,
                error=f"unknown status '{status}'. Valid: {', '.join(VALID_STATUSES)}",
            )
        item = state.update(item_id, status=status)
        if item is None:
            return ToolResult(ok=False, error=f"no TODO with id={item_id}")
        return ToolResult(ok=True, data={"updated": item.to_dict(), "summary": state.summary()})

    if action == "done":
        item_id = _coerce_id(args.get("id"))
        if item_id is None:
            return ToolResult(ok=False, error="'id' is required for action=done")
        item = state.update(item_id, status="done")
        if item is None:
            return ToolResult(ok=False, error=f"no TODO with id={item_id}")
        return ToolResult(ok=True, data={"updated": item.to_dict(), "summary": state.summary()})

    if action == "update":
        item_id = _coerce_id(args.get("id"))
        if item_id is None:
            return ToolResult(ok=False, error="'id' is required for action=update")
        changes: dict[str, Any] = {}
        if "title" in args and args["title"] is not None:
            changes["title"] = str(args["title"]).strip()
        if "notes" in args and args["notes"] is not None:
            changes["notes"] = str(args["notes"])
        if "status" in args and args["status"] is not None:
            new_status = str(args["status"]).strip().lower()
            if new_status not in VALID_STATUSES:
                return ToolResult(
                    ok=False,
                    error=f"unknown status '{new_status}'. Valid: {', '.join(VALID_STATUSES)}",
                )
            changes["status"] = new_status
        if not changes:
            return ToolResult(ok=False, error="nothing to update (pass title/notes/status)")
        item = state.update(item_id, **changes)
        if item is None:
            return ToolResult(ok=False, error=f"no TODO with id={item_id}")
        return ToolResult(ok=True, data={"updated": item.to_dict(), "summary": state.summary()})

    if action == "remove":
        item_id = _coerce_id(args.get("id"))
        if item_id is None:
            return ToolResult(ok=False, error="'id' is required for action=remove")
        ok = state.remove(item_id)
        if not ok:
            return ToolResult(ok=False, error=f"no TODO with id={item_id}")
        return ToolResult(ok=True, data={"removed_id": item_id, "summary": state.summary()})

    if action == "clear_done":
        removed = state.clear_done()
        return ToolResult(ok=True, data={"removed_done": removed, "summary": state.summary()})

    if action == "clear":
        removed = state.clear()
        return ToolResult(ok=True, data={"removed_total": removed, "summary": state.summary()})

    # Should be unreachable because of the action guard above.
    return ToolResult(ok=False, error=f"unhandled action '{action}'")


def _coerce_id(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def build_todo_tools() -> list[Tool]:
    return [
        Tool(
            name="todo",
            description=(
                "Manage the agent's TODO list (visible to the user in the "
                "GUI / TUI). Use it to plan a task, mark progress, and "
                "signal completion. Action 'list' returns the current "
                "state. 'add' creates a new item. 'set_status' / 'done' "
                "move an item along the lifecycle. 'update' edits title "
                "or notes. 'remove' drops one item. 'clear_done' / "
                "'clear' clean up. Always start a non-trivial task with "
                "a TODO plan; in autonomous mode the agent must keep the "
                "list accurate until everything is 'done'."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": list(_VALID_ACTIONS),
                    },
                    "id": {
                        "type": "integer",
                        "description": "TODO id (required for set_status/done/update/remove)",
                    },
                    "title": {"type": "string", "description": "TODO title (for add/update)"},
                    "notes": {"type": "string", "description": "Optional longer description"},
                    "status": {
                        "type": "string",
                        "enum": list(VALID_STATUSES),
                        "description": "New status (for set_status / update)",
                    },
                },
                "required": ["action"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_todo,
        ),
    ]
