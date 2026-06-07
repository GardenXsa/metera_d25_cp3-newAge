"""Shell command tool — always gated behind permission checks."""

from __future__ import annotations

import platform
import subprocess
from typing import Any

from modkit.permissions import Kind
from modkit.tools.registry import Tool, ToolContext, ToolResult


def _shell(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    command = str(args.get("command") or "").strip()
    if not command:
        return ToolResult(ok=False, error="'command' is required")
    timeout = int(args.get("timeout") or 60)
    timeout = max(1, min(timeout, 600))

    cwd = ctx.shell_cwd or ctx.mod_root or ctx.mods_root
    try:
        if platform.system() == "Windows":
            cmd = ["powershell", "-NoProfile", "-NonInteractive", "-Command", command]
            completed = subprocess.run(
                cmd,
                cwd=str(cwd),
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        else:
            completed = subprocess.run(
                command,
                shell=True,
                cwd=str(cwd),
                capture_output=True,
                text=True,
                timeout=timeout,
            )
    except subprocess.TimeoutExpired as exc:
        return ToolResult(
            ok=False,
            error=f"shell command timed out after {timeout}s",
            data={"command": command, "timeout": timeout, "stderr": str(exc)},
        )

    stdout = (completed.stdout or "")[-20000:]
    stderr = (completed.stderr or "")[-20000:]
    return ToolResult(
        ok=completed.returncode == 0,
        data={
            "command": command,
            "returncode": completed.returncode,
            "stdout": stdout,
            "stderr": stderr,
            "cwd": str(cwd),
        },
    )


def build_shell_tool() -> Tool:
    return Tool(
        name="shell",
        description=(
            "Run a shell command in the selected mod directory (or mods root if no mod "
            "is selected). On Windows the command is executed via PowerShell. Always "
            "asks for user approval in modes ask/auto-edit; yolo mode runs it unattended."
        ),
        parameters={
            "type": "object",
            "properties": {
                "command": {"type": "string"},
                "timeout": {"type": "integer", "minimum": 1, "maximum": 600},
            },
            "required": ["command"],
            "additionalProperties": False,
        },
        kind=Kind.SHELL,
        handler=_shell,
    )
