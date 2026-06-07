"""Agent tools for managing custom validation checks.

The custom check framework (see :mod:`modkit.tools.custom_checks`)
lets the user / agent define arbitrary Python checks that run as part
of ``validate_e2e``. This file exposes that framework as agent tools:

* ``register_check``   — write a new check file
* ``list_checks``      — show what is on disk
* ``unregister_check`` — remove a check
* ``show_check``       — dump a check's source for editing

The check source is just a Python function with a ``check(ctx)`` entry
point. The agent writes the body inline (no need to escape triple
quotes etc. — the file uses a single-quoted body string).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from modkit.permissions import Kind
from modkit.tools.custom_checks import (
    check_path as _check_path,
    checks_root,
    list_checks as _list_checks,
    register_check as _register_check,
    unregister_check as _unregister_check,
)
from modkit.tools.registry import Tool, ToolContext, ToolResult


def _register(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    name = (args.get("name") or "").strip()
    body = args.get("body") or ""
    overwrite = bool(args.get("overwrite", False))
    if not name:
        return ToolResult(ok=False, error="`name` is required")
    if not body.strip():
        return ToolResult(ok=False, error="`body` is required and must be non-empty")
    try:
        path = _register_check(name, body, overwrite=overwrite)
    except (ValueError, FileExistsError, SyntaxError) as exc:
        return ToolResult(ok=False, error=str(exc))
    return ToolResult(
        ok=True,
        content=f"Check {name!r} registered at {path}",
        data={"name": name, "path": str(path)},
    )


def _list(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    items = _list_checks()
    return ToolResult(
        ok=True,
        content="\n".join(
            f"  {c['name']:30s} has_check={c.get('has_check')!s:5s}  {c.get('doc', '').splitlines()[0] if c.get('doc') else '(no doc)'}"
            for c in items
        ) or f"No checks registered yet. Folder: {checks_root()}",
        data={"checks": items, "root": str(checks_root())},
    )


def _unregister(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    name = (args.get("name") or "").strip()
    if not name:
        return ToolResult(ok=False, error="`name` is required")
    try:
        removed = _unregister_check(name)
    except ValueError as exc:
        return ToolResult(ok=False, error=str(exc))
    if not removed:
        return ToolResult(ok=False, error=f"no check named {name!r}")
    return ToolResult(ok=True, content=f"Check {name!r} removed.")


def _show(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    name = (args.get("name") or "").strip()
    if not name:
        return ToolResult(ok=False, error="`name` is required")
    try:
        path = _check_path(name)
    except ValueError as exc:
        return ToolResult(ok=False, error=str(exc))
    if not path.exists():
        return ToolResult(ok=False, error=f"no check named {name!r}")
    try:
        body = path.read_text(encoding="utf-8")
    except OSError as exc:
        return ToolResult(ok=False, error=f"cannot read {path}: {exc}")
    return ToolResult(
        ok=True,
        content=body,
        data={"name": name, "path": str(path), "body": body},
    )


def build_check_tools() -> list[Tool]:
    return [
        Tool(
            name="register_check",
            description=(
                "Save a new custom validation check that runs inside `validate_e2e`. "
                "The `body` must define a top-level function `check(ctx)`. The "
                "return value can be a single dict ({\"ok\": bool, \"level\": \"error|warn|info\", "
                "\"message\": str, \"fix_hint\": str}) or a list of such dicts. "
                "Use the helpers `fail(msg)`, `warn(msg)`, `pass_(msg)` from "
                "`modkit.tools.custom_checks` to build the dicts. The check has "
                "read-only access to `ctx` (mods_root, mod_root, mod_id, "
                "preflight_reports, runtime_log_report, project_root, config)."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Check name. Letters, digits, underscore, dash."},
                    "body": {"type": "string", "description": "Python source for the check. Must define a top-level `check(ctx)` function."},
                    "overwrite": {"type": "boolean", "default": False, "description": "Overwrite an existing check of the same name."},
                },
                "required": ["name", "body"],
            },
            kind=Kind.EDIT,
            handler=_register,
        ),
        Tool(
            name="list_checks",
            description=(
                "Show every custom check currently registered. Returns name, path, "
                "size, has_check (bool) and a one-line docstring for each."
            ),
            parameters={"type": "object", "properties": {}},
            kind=Kind.READ,
            handler=_list,
        ),
        Tool(
            name="unregister_check",
            description="Delete a custom check file. Idempotent — returns ok=True even if the file did not exist (after warning).",
            parameters={
                "type": "object",
                "properties": {"name": {"type": "string"}},
                "required": ["name"],
            },
            kind=Kind.EDIT,
            handler=_unregister,
        ),
        Tool(
            name="show_check",
            description="Print the source of a registered check so the agent can edit / copy / re-register it.",
            parameters={
                "type": "object",
                "properties": {"name": {"type": "string"}},
                "required": ["name"],
            },
            kind=Kind.READ,
            handler=_show,
        ),
    ]


__all__ = ["build_check_tools"]
