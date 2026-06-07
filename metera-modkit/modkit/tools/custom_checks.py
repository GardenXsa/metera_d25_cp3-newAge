"""Custom check framework — user-defined validation passes.

The agent ships a fixed catalogue of validators (mod preflight, mod
contract, runtime log scan, C++ engine preflight) but those don't
cover every project. A user might want to check that:

* a specific JSON file is present in every mod,
* no mod references an item id from a different mod,
* an integration test that exercises a particular ModAPI hook,
* a custom invariant of their private data model,
* etc.

This module gives the agent a way to author and run arbitrary
Python checks without forking modkit. Each check is a single
``.py`` file in ``~/.metera-modkit/checks/`` that defines a function
with this signature::

    def check(ctx: "CheckContext") -> dict:
        ...

The returned dict should look like::

    {
        "ok": bool,
        "level": "error" | "warn" | "info",   # default: "error"
        "message": "human-readable explanation",
        "fix_hint": "what to do about it"      # optional
    }

The check may also call the convenience helpers
:func:`fail`, :func:`warn`, :func:`pass_` from this module — they
return a pre-shaped result dict.

A check may also yield multiple results by returning a list of dicts.

The check is given a :class:`CheckContext` with:

* ``mods_root``, ``mod_root``, ``mod_id`` — the project under test
* ``runtime_log_report`` — parsed entries from this validation cycle
* ``preflight_reports`` — per-mod Python preflight results
* ``engine_log_lines`` — captured C++ engine stdout
* ``project_root`` — where the Electron app lives (for spawning)
* ``config`` — a free dict the agent can stash shared state in
  between checks (useful for "check A primes data, check B consumes")

Discovery lives in :func:`list_checks`, execution in
:func:`run_checks`, and registration in :func:`register_check`.
"""

from __future__ import annotations

import ast
import importlib.util
import json
import re
import sys
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from modkit.paths import user_config_dir


# ── result helpers ───────────────────────────────────────────────────


def fail(message: str, *, fix_hint: str | None = None) -> dict[str, Any]:
    """Return a ``"failed"`` result dict."""
    out: dict[str, Any] = {"ok": False, "level": "error", "message": message}
    if fix_hint:
        out["fix_hint"] = fix_hint
    return out


def warn(message: str, *, fix_hint: str | None = None) -> dict[str, Any]:
    """Return a ``"warning"`` result dict (does not flip overall ok)."""
    out: dict[str, Any] = {"ok": True, "level": "warn", "message": message}
    if fix_hint:
        out["fix_hint"] = fix_hint
    return out


def pass_(message: str = "") -> dict[str, Any]:
    """Return a ``"passed"`` result dict."""
    return {"ok": True, "level": "info", "message": message or "ok"}


# ── context ──────────────────────────────────────────────────────────


@dataclass
class CheckContext:
    """Shared state passed to every check."""

    mods_root: Path
    mod_root: Path | None = None
    mod_id: str | None = None
    # Filled in by :func:`modkit.tools.validate_e2e._gather_context`
    runtime_log_report: Any = None
    preflight_reports: dict[str, dict[str, Any]] = field(default_factory=dict)
    engine_log_lines: list[str] = field(default_factory=list)
    project_root: Path | None = None
    config: dict[str, Any] = field(default_factory=dict)


# ── discovery ────────────────────────────────────────────────────────


CHECK_FILENAME_RE = re.compile(r"^[a-zA-Z0-9_][a-zA-Z0-9_-]*\.py$")


def checks_root(create: bool = True) -> Path:
    """Folder where user-defined checks live."""
    root = user_config_dir() / "checks"
    if create:
        root.mkdir(parents=True, exist_ok=True)
    return root


def check_path(name: str) -> Path:
    """Resolve a check name to its on-disk path (not guaranteed to exist)."""
    if not name or not CHECK_FILENAME_RE.match(f"{name}.py"):
        raise ValueError(
            f"invalid check name {name!r}. Use letters, digits, underscore, dash."
        )
    return checks_root() / f"{name}.py"


def list_checks() -> list[dict[str, Any]]:
    """Return a list of ``{name, path, has_check, doc}`` for every check on disk.

    ``has_check`` is True when the file defines a top-level ``check``
    callable. ``doc`` is the module-level docstring (first line) so the
    agent can show a description in the GUI.
    """
    out: list[dict[str, Any]] = []
    for p in sorted(checks_root().iterdir()):
        if not CHECK_FILENAME_RE.match(p.name):
            continue
        info: dict[str, Any] = {
            "name": p.stem,
            "path": str(p),
            "size": p.stat().st_size,
            "has_check": False,
            "doc": "",
        }
        try:
            tree = ast.parse(p.read_text(encoding="utf-8"))
        except SyntaxError:
            info["error"] = "syntax error"
            out.append(info)
            continue
        info["doc"] = ast.get_docstring(tree) or ""
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name == "check":
                info["has_check"] = True
                break
        out.append(info)
    return out


# ── registration ─────────────────────────────────────────────────────


_HEADER_TEMPLATE = '''\
"""Custom check registered via the modkit agent.

This file was written by the agent from a Python source body the user
provided. The :func:`check` function is the entry point — see
:mod:`modkit.tools.custom_checks` for the contract.
"""

from __future__ import annotations

from modkit.tools.custom_checks import (
    CheckContext,
    fail,
    warn,
    pass_,
)


{body}
'''


def _validate_check_source(body: str) -> str:
    """Compile the check body and ensure it defines a top-level ``check``."""
    stripped = body.strip()
    if not stripped:
        raise ValueError("check body is empty")
    try:
        tree = ast.parse(stripped)
    except SyntaxError as exc:
        raise ValueError(f"check body has a syntax error: {exc.msg} (line {exc.lineno})")
    if not any(
        isinstance(n, ast.FunctionDef) and n.name == "check" for n in tree.body
    ):
        raise ValueError(
            "check body must define a top-level function named `check` "
            "(got: " + ", ".join(
                n.name for n in tree.body if isinstance(n, ast.FunctionDef)
            ) + ")"
        )
    return stripped


def register_check(
    name: str,
    body: str,
    *,
    overwrite: bool = False,
) -> Path:
    """Persist a new check file and return its path.

    * ``name`` is the file stem; the file is ``<name>.py``.
    * ``body`` is the Python source for the check (without the
      standard imports / header — those are added by this function).
    * ``overwrite`` must be True to replace an existing check.
    """
    path = check_path(name)
    if path.exists() and not overwrite:
        raise FileExistsError(
            f"check {name!r} already exists at {path}. Pass overwrite=True to replace."
        )
    validated = _validate_check_source(body)
    path.write_text(_HEADER_TEMPLATE.format(body=validated), encoding="utf-8")
    return path


def unregister_check(name: str) -> bool:
    """Remove a check file. Returns True if something was deleted."""
    path = check_path(name)
    if not path.exists():
        return False
    path.unlink()
    return True


# ── execution ────────────────────────────────────────────────────────


def _import_check(path: Path) -> Callable[[CheckContext], Any]:
    """Import a check file as a module and return its ``check`` function."""
    spec = importlib.util.spec_from_file_location(f"modkit_check.{path.stem}", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"could not import check at {path}")
    module = importlib.util.module_from_spec(spec)
    # Register the module so relative imports / dataclasses work normally.
    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(spec.name, None)
        raise
    if not hasattr(module, "check") or not callable(module.check):
        raise AttributeError(f"check at {path} does not define a callable `check`")
    return module.check


def _flatten(results: Any) -> list[dict[str, Any]]:
    """Coerce a check return value into a list of result dicts."""
    if results is None:
        return []
    if isinstance(results, dict):
        return [results]
    if isinstance(results, (list, tuple)):
        flat: list[dict[str, Any]] = []
        for r in results:
            flat.extend(_flatten(r))
        return flat
    return [{"ok": False, "level": "error", "message": f"check returned {type(results).__name__}, expected dict or list of dicts"}]


def run_checks(
    ctx: CheckContext,
    *,
    names: list[str] | None = None,
    timeout_seconds: float = 30.0,
) -> list[dict[str, Any]]:
    """Run every registered check (or just the named ones) and collect results.

    Each check is run in isolation — a crash in one check does not
    stop the others. The result list always contains a ``"name"`` key
    per check so the agent can attribute failures to the right script.
    """
    if names is None:
        available = [c["name"] for c in list_checks() if c.get("has_check")]
    else:
        available = list(names)

    results: list[dict[str, Any]] = []
    for name in available:
        try:
            path = check_path(name)
        except ValueError as exc:
            results.append(
                {"name": name, "ok": False, "level": "error", "message": str(exc)}
            )
            continue
        if not path.exists():
            results.append(
                {"name": name, "ok": False, "level": "error", "message": f"check {name!r} not found"}
            )
            continue
        # Best-effort timeout via signal on POSIX; on Windows we just
        # rely on the check to be well-behaved (the agent and tests are
        # trusted code, this is not a hostile sandbox).
        try:
            check_fn = _import_check(path)
            returned = check_fn(ctx)
        except SyntaxError as exc:
            results.append(
                {"name": name, "ok": False, "level": "error", "message": f"syntax error: {exc}"}
            )
            continue
        except Exception as exc:
            tb = traceback.format_exc(limit=6)
            results.append(
                {
                    "name": name,
                    "ok": False,
                    "level": "error",
                    "message": f"check raised {type(exc).__name__}: {exc}",
                    "traceback": tb,
                }
            )
            continue
        # Tag every result with the check name so the agent can group them.
        for r in _flatten(returned):
            r.setdefault("name", name)
            # Coerce "ok" to a real bool (LLMs sometimes return truthy strings).
            r["ok"] = bool(r.get("ok"))
            r.setdefault("level", "error" if not r["ok"] else "info")
            r.setdefault("message", "")
            results.append(r)
    return results


def summarise(results: list[dict[str, Any]]) -> dict[str, int]:
    """Return ``{errors, warnings, infos, passed, total}`` for a result list."""
    out = {"errors": 0, "warnings": 0, "infos": 0, "passed": 0, "total": len(results)}
    for r in results:
        level = (r.get("level") or "error").lower()
        if level == "error" and not r.get("ok", True):
            out["errors"] += 1
        elif level == "warn":
            out["warnings"] += 1
        elif r.get("ok", True):
            out["passed"] += 1
        else:
            out["errors"] += 1
    return out


__all__ = [
    "CHECK_FILENAME_RE",
    "CheckContext",
    "checks_root",
    "fail",
    "list_checks",
    "pass_",
    "register_check",
    "run_checks",
    "summarise",
    "unregister_check",
    "warn",
]
