"""Tool registry and dispatch.

The agent never calls tool handlers directly; everything goes through
:py:class:`ToolRegistry.run`. That method enforces the permission mode
(ask / auto-edit / yolo) and serialises results so the model gets
predictable JSON back.

Each tool implementation registers itself by returning a :class:`Tool`
from a builder function. See ``modkit.tools.fs`` etc. for concrete
examples.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Optional

from modkit.permissions import Decision, Kind, Mode, evaluate
from modkit.providers.base import ToolDef


# A handler receives the parsed arguments and a context, and returns a ToolResult.
ToolHandler = Callable[[dict[str, Any], "ToolContext"], "ToolResult"]


@dataclass
class ToolResult:
    ok: bool
    content: str = ""
    data: dict[str, Any] = field(default_factory=dict)
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"ok": self.ok}
        if self.content:
            payload["content"] = self.content
        if self.data:
            payload["data"] = self.data
        if self.error:
            payload["error"] = self.error
        return payload

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]
    kind: Kind
    handler: ToolHandler

    def to_def(self) -> ToolDef:
        return ToolDef(
            name=self.name, description=self.description, parameters=self.parameters
        )


@dataclass
class ToolContext:
    """State the tools share across calls (mostly per-task)."""

    mods_root: Path
    mod_root: Optional[Path] = None
    mode: Mode = Mode.ASK
    confirm: Callable[[str, dict[str, Any]], bool] = lambda name, args: False
    log: Callable[[str], None] = lambda msg: None
    shell_cwd: Optional[Path] = None
    extra: dict[str, Any] = field(default_factory=dict)


class ToolRegistry:
    def __init__(self, tools: Iterable[Tool] = ()) -> None:
        self._tools: dict[str, Tool] = {}
        for t in tools:
            self.register(t)

    def register(self, tool: Tool) -> None:
        if tool.name in self._tools:
            raise ValueError(f"tool '{tool.name}' already registered")
        self._tools[tool.name] = tool

    def get(self, name: str) -> Optional[Tool]:
        return self._tools.get(name)

    def names(self) -> list[str]:
        return sorted(self._tools)

    def definitions(self) -> list[ToolDef]:
        return [t.to_def() for t in self._tools.values()]

    # ── execution path ────────────────────────────────────────────────

    def run(
        self,
        name: str,
        arguments: dict[str, Any] | None,
        ctx: ToolContext,
    ) -> ToolResult:
        tool = self._tools.get(name)
        if tool is None:
            return ToolResult(ok=False, error=f"unknown tool '{name}'")
        args = arguments or {}
        permission = evaluate(ctx.mode, tool.kind)

        if permission.decision == Decision.DENY:
            mode_hint = _denied_hint(ctx.mode, tool.kind)
            return ToolResult(
                ok=False,
                error=f"[denied] Инструмент '{name}' заблокирован текущим режимом '{ctx.mode.value}'. {mode_hint}",
                data={"denied": True, "mode": ctx.mode.value, "tool_kind": tool.kind.value},
            )
        if permission.decision == Decision.ASK:
            allowed = ctx.confirm(name, args)
            if not allowed:
                mode_hint = _denied_hint(ctx.mode, tool.kind)
                return ToolResult(
                    ok=False,
                    error=f"[denied] Пользователь отклонил выполнение инструмента '{name}'. {mode_hint}",
                    data={"denied": True, "mode": ctx.mode.value, "tool_kind": tool.kind.value},
                )

        try:
            return tool.handler(args, ctx)
        except FileNotFoundError as exc:
            return ToolResult(ok=False, error=f"{exc}")
        except PermissionError as exc:
            return ToolResult(ok=False, error=f"permission error: {exc}")
        except ValueError as exc:
            return ToolResult(ok=False, error=str(exc))
        except Exception as exc:  # pragma: no cover - safety net
            return ToolResult(ok=False, error=f"{type(exc).__name__}: {exc}")


def _denied_hint(mode: "Mode", kind: "Kind") -> str:
    """Return a helpful Russian hint about how to change the permission mode."""
    from modkit.permissions import Kind as K, Mode as M
    if mode == M.ASK:
        if kind == K.EDIT:
            return "Чтобы разрешить редактирование без подтверждения, переключите режим на 'auto-edit' или 'yolo'."
        if kind == K.SHELL:
            return "Чтобы разрешить shell-команды, переключите режим на 'yolo'."
    if mode == M.AUTO_EDIT and kind == K.SHELL:
        return "Чтобы разрешить shell-команды без подтверждения, переключите режим на 'yolo'."
    return "Измените режим разрешений для доступа к этому инструменту."


def build_default_registry(
    *,
    include_shell: bool = True,
    include_code: bool = True,
    include_data: bool = True,
    include_todo: bool = True,
    load_user_tools: bool = True,
) -> ToolRegistry:
    """Construct the default tool set used by the agent.

    When ``load_user_tools`` is True (the default) the registry also
    auto-discovers any ``@tool``-decorated functions the user has
    dropped into ``~/.metera-modkit/user_tools/`` and registers them
    alongside the built-ins. User tools are registered AFTER the
    built-ins so that name collisions raise loudly instead of
    silently overriding a built-in.

    Set ``load_user_tools=False`` in tests or in contexts where the
    user-tools folder should be ignored.
    """
    # Imports are local to avoid an import cycle at module load time.
    from modkit.tools.fs import build_fs_tools
    from modkit.tools.docs_tools import build_docs_tools
    from modkit.tools.mod_tools import build_mod_tools
    from modkit.tools.shell_tool import build_shell_tool
    from modkit.tools.code_tools import build_code_tools
    from modkit.tools.data_tools import build_data_tools
    from modkit.tools.todo_tool import build_todo_tools
    from modkit.tools.interaction_tools import build_interaction_tools
    from modkit.tools.run_game import build_run_game_tool
    from modkit.tools.preflight_tool import build_preflight_mod_tool
    from modkit.tools.validate_e2e import build_validate_e2e_tool
    from modkit.tools.check_tools import build_check_tools
    from modkit.tools.transfer_tools import build_transfer_tools
    from modkit.tools.intelligence_tools import build_intelligence_tools
    from modkit.user_tools import discover_user_tools

    registry = ToolRegistry()
    for t in build_fs_tools():
        registry.register(t)
    for t in build_transfer_tools():
        registry.register(t)
    for t in build_intelligence_tools():
        registry.register(t)
    for t in build_docs_tools():
        registry.register(t)
    for t in build_mod_tools():
        registry.register(t)
    if include_code:
        for t in build_code_tools():
            registry.register(t)
    if include_data:
        for t in build_data_tools():
            registry.register(t)
    if include_todo:
        for t in build_todo_tools():
            registry.register(t)
    for t in build_interaction_tools():
        registry.register(t)
    if include_shell:
        registry.register(build_shell_tool())
        registry.register(build_run_game_tool())
        registry.register(build_validate_e2e_tool())
    registry.register(build_preflight_mod_tool())
    for t in build_check_tools():
        registry.register(t)
    if load_user_tools:
        for t in discover_user_tools():
            registry.register(t)

    # Skills: discover on disk, then expose the read_skill tool so the
    # agent can pull a skill's body on demand. Built-ins stay untouched.
    from modkit.skills import build_read_skill_tool, discover_user_skills

    registry.register(build_read_skill_tool(discover_user_skills()))

    return registry
