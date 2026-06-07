"""The :func:`tool` decorator.

Usage::

    from modkit.user_tools import tool

    @tool
    def greet(who: str) -> dict:
        \"\"\"Return a friendly greeting.\"\"\"
        return {"text": f"Hello, {who}!"}

The decorator captures the function's name, its first docstring
line as the description, and infers a JSON-Schema for the
parameters from the function signature. The spec is stashed on
the function as ``__user_tool_spec__``; the discovery module pulls
it back out at agent-startup time.
"""

from __future__ import annotations

import inspect
import re
from dataclasses import dataclass, field
from typing import Any, Callable, get_type_hints


_KIND_READ = "read"
_KIND_EDIT = "edit"
VALID_KINDS = (_KIND_READ, _KIND_EDIT)


@dataclass
class UserToolSpec:
    """Spec captured by the :func:`tool` decorator.

    Mirrors the shape of the built-in :class:`Tool` dataclass, minus
    the actual handler wrapper (the discovery module does that).
    """

    name: str
    description: str
    parameters: dict[str, Any] = field(default_factory=dict)
    kind: str = _KIND_READ
    handler: Callable[..., Any] | None = None


# Maps Python type annotations to JSON-Schema fragments. Conservative
# on purpose — anything we don't recognise falls back to "string".
_TYPE_MAP: dict[Any, dict[str, str]] = {
    str: {"type": "string"},
    int: {"type": "integer"},
    float: {"type": "number"},
    bool: {"type": "boolean"},
    list: {"type": "array"},
    dict: {"type": "object"},
}


def _annotation_to_schema(annotation: Any) -> dict[str, Any]:
    if annotation is inspect.Parameter.empty or annotation is None:
        return {"type": "string"}
    if annotation in _TYPE_MAP:
        return dict(_TYPE_MAP[annotation])
    origin = getattr(annotation, "__origin__", None)
    if origin in (list, tuple, set, frozenset):
        return {"type": "array"}
    if origin is dict:
        return {"type": "object"}
    return {"type": "string"}


def _params_from_signature(func: Callable[..., Any]) -> dict[str, Any]:
    """Best-effort JSON-Schema for a function's keyword arguments.

    Skips ``self`` / ``cls`` and any positional-only or var-args.
    Required-ness comes from whether the parameter has a default.
    """
    try:
        sig = inspect.signature(func)
    except (TypeError, ValueError):
        return {"type": "object", "properties": {}, "additionalProperties": False}
    try:
        hints = get_type_hints(func)
    except Exception:  # noqa: BLE001
        hints = {}

    properties: dict[str, Any] = {}
    required: list[str] = []
    for name, param in sig.parameters.items():
        if name in ("self", "cls"):
            continue
        if param.kind in (
            inspect.Parameter.VAR_POSITIONAL,
            inspect.Parameter.VAR_KEYWORD,
            inspect.Parameter.POSITIONAL_ONLY,
        ):
            continue
        annotation = hints.get(name, param.annotation)
        schema = _annotation_to_schema(annotation)
        properties[name] = schema
        if param.default is inspect.Parameter.empty:
            required.append(name)
    out: dict[str, Any] = {
        "type": "object",
        "properties": properties,
        "additionalProperties": False,
    }
    if required:
        out["required"] = required
    return out


def _first_docstring_line(func: Callable[..., Any]) -> str:
    raw = inspect.getdoc(func)
    if not raw:
        return ""
    lines = [line.strip() for line in raw.splitlines() if line.strip()]
    return lines[0] if lines else ""


def tool(
    func: Callable[..., Any] | None = None,
    *,
    name: str | None = None,
    description: str | None = None,
    parameters: dict[str, Any] | None = None,
    kind: str = _KIND_READ,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Mark a function as a user-installable agent tool.

    Two call styles::

        @tool
        def my_tool(x: int) -> dict: ...

        @tool(name="custom_name", description="...", kind="edit")
        def some_func(x: int) -> dict: ...

    The decorated function gets a ``__user_tool_spec__`` attribute
    holding the captured :class:`UserToolSpec`. The discovery
    module iterates a folder full of such decorated functions and
    converts them into real :class:`Tool` objects.
    """
    if kind not in VALID_KINDS:
        raise ValueError(
            f"invalid kind '{kind}'; expected one of {VALID_KINDS}"
        )

    def decorate(func: Callable[..., Any]) -> Callable[..., Any]:
        spec = UserToolSpec(
            name=name or func.__name__,
            description=(description or _first_docstring_line(func) or func.__name__).strip(),
            parameters=parameters or _params_from_signature(func),
            kind=kind,
            handler=func,
        )
        func.__user_tool_spec__ = spec  # type: ignore[attr-defined]
        return func

    # Support both @tool and @tool(...) call styles.
    if func is not None and callable(func) and not (
        isinstance(func, str) or func is _KIND_READ
    ):
        # Bare @tool (no parens) — func is the decorated function.
        return decorate(func)
    return decorate
