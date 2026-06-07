"""Discover user-installed tools and wrap them as :class:`Tool` objects.

A user tool is a ``.py`` file in ``~/.metera-modkit/user_tools/``
that contains one or more functions decorated with
:func:`modkit.user_tools.tool`. The discovery walks that folder,
imports each file, harvests the decorated functions, and wraps
them in the same :class:`modkit.tools.registry.Tool` shape the
agent uses for everything else.

Errors in a user file are caught and reported via the returned
list of error records; one bad file never poisons the rest of
the discovery. That way a typo in your helper script doesn't
make the whole agent refuse to start.
"""

from __future__ import annotations

import importlib.util
import logging
import sys
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from modkit.paths import user_tools_root as _default_user_tools_root
from modkit.permissions import Kind


log = logging.getLogger("modkit.user_tools")


@dataclass
class UserToolError:
    """A single file that failed to load; surfaced in doctor / logs."""

    path: Path
    error: str


@dataclass
class DiscoveryResult:
    """Result of one :func:`discover_user_tools` call."""

    tools: list[Any]
    errors: list[UserToolError]

    def ok(self) -> bool:
        return not self.errors


def _wrap_as_tool(spec) -> Any:
    """Convert a :class:`UserToolSpec` to a :class:`Tool`."""
    from modkit.tools.registry import Tool, ToolResult

    kind = Kind.EDIT if spec.kind == "edit" else Kind.READ

    def _handler(args: dict[str, Any], _ctx: Any) -> Any:
        try:
            kwargs = dict(args or {})
            result = spec.handler(**kwargs) if kwargs else spec.handler()
        except TypeError as exc:
            return ToolResult(ok=False, error=f"bad arguments: {exc}")
        except Exception as exc:  # noqa: BLE001
            return ToolResult(
                ok=False, error=f"user tool '{spec.name}' raised: {exc}"
            )
        if isinstance(result, ToolResult):
            return result
        if isinstance(result, dict):
            return ToolResult(ok=True, data=result)
        return ToolResult(ok=True, data={"value": result})

    return Tool(
        name=spec.name,
        description=spec.description,
        parameters=spec.parameters or {"type": "object", "properties": {}},
        kind=kind,
        handler=_handler,
    )


def _harvest_module(module: Any) -> list:
    out: list = []
    for attr in vars(module).values():
        spec = getattr(attr, "__user_tool_spec__", None)
        if spec is not None and getattr(spec, "handler", None) is not None:
            out.append(spec)
    return out


def _load_file(path: Path) -> list:
    spec = importlib.util.spec_from_file_location(
        f"modkit_user_tool_{path.stem}", path
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("importlib could not create a module spec")
    module = importlib.util.module_from_spec(spec)
    # Keep the user module's namespace separate from modkit's main
    # namespace — register it in sys.modules under a private name so
    # `from modkit.user_tools import tool` inside the file works.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return _harvest_module(module)


def discover_user_tools(
    root: Path | None = None,
    *,
    raise_on_error: bool = False,
) -> list[Any]:
    """Find every user-installed tool and return a list of :class:`Tool`.

    Returns *only* the successfully wrapped :class:`Tool` objects;
    per-file errors are logged and skipped so a single bad file
    never takes the agent down. Set ``raise_on_error=True`` to
    surface the first error as an exception (used by tests).
    """
    if root is None:
        root = _default_user_tools_root()
    root = Path(root)
    result = _load_from(root, raise_on_error=raise_on_error)
    if result.errors:
        for err in result.errors:
            log.warning("user tool load failed: %s — %s", err.path, err.error)
    return result.tools


def _load_from(root: Path, *, raise_on_error: bool) -> DiscoveryResult:
    out_tools: list[Any] = []
    errors: list[UserToolError] = []
    if not root.is_dir():
        return DiscoveryResult(tools=[], errors=[])
    for child in sorted(root.iterdir()):
        if not child.is_file():
            continue
        if child.suffix.lower() != ".py":
            continue
        if child.name.startswith(("_", ".")):
            continue
        try:
            specs = _load_file(child)
        except Exception as exc:  # noqa: BLE001
            msg = f"{type(exc).__name__}: {exc}"
            log.debug("user tool load traceback:\n%s", traceback.format_exc())
            errors.append(UserToolError(path=child, error=msg))
            if raise_on_error:
                raise
            continue
        for spec in specs:
            out_tools.append(_wrap_as_tool(spec))
    return DiscoveryResult(tools=out_tools, errors=errors)


def user_tools_root() -> Path:
    """Public re-export of :func:`modkit.paths.user_tools_root`."""
    return _default_user_tools_root()
