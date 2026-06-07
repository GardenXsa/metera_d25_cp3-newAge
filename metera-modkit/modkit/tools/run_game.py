"""``run_game`` tool: spawn the Meterea engine and capture the startup log.

The C++ engine (a console app that lives at
``engine/meterea_engine.exe`` next to the project root) speaks a JSON
line protocol on stdin/stdout. When the agent needs to validate that a
set of mods will actually start the simulation core, it sends::

    {"command": "init", "mods_dir": "...", "active_mods": ["a", "b"]}

The engine then loads its native plugin shims and runs a "data
preflight" check against the merged runtime database — it prints
``DATA ERROR: ...`` lines for every missing/typed-wrong field and
``DATA WARNING: ...`` for softer issues. The agent can read those
lines to figure out exactly what's wrong with a mod.

This tool runs that handshake, captures the first ``wait_seconds`` of
output, and terminates the engine before returning. It is **not** a
long-running game session — for a real session the user just launches
``meterea_engine.exe`` from the OS. This is the preflight-check
variant the agent can call unattended.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

from modkit.permissions import Kind
from modkit.preflight import run_preflight
from modkit.tools.registry import Tool, ToolContext, ToolResult


# Tunables — exposed as constants so tests can poke them and the
# cheatsheet can quote the default.
DEFAULT_WAIT_SECONDS = 8.0
MAX_WAIT_SECONDS = 60.0
DEFAULT_TERMINATE_GRACE = 2.0
MAX_LOG_LINES = 5000
MAX_LOG_BYTES = 512_000  # 500 KB cap on the captured log we keep
PREFLIGHT_ERROR_PATTERNS = (
    "data error:",
    "preflight",
    "fatal:",
    "exception:",
)


def _exe_name() -> str:
    return "meterea_engine.exe" if sys.platform == "win32" else "meterea_engine"


def engine_executable_name() -> str:
    """Return the platform-specific name of the engine executable."""
    return _exe_name()


def _read_engine_path_override() -> str | None:
    """Read an optional ``%APPDATA%/metera-modkit/engine_path.txt``.

    The user can drop a single-line file there that points to the
    engine executable when it isn't next to the project root.
    """
    try:
        from modkit.paths import user_config_dir
        cfg = user_config_dir() / "engine_path.txt"
        if cfg.is_file():
            line = cfg.read_text(encoding="utf-8").strip()
            return line or None
    except OSError:
        return None
    return None


def _candidate_paths() -> list[Path]:
    """All well-known locations of ``meterea_engine``."""
    candidates: list[Path] = []
    override = _read_engine_path_override()
    if override:
        candidates.append(Path(override).expanduser())
    name = _exe_name()
    cwd = Path.cwd()
    candidates.append(cwd / "engine" / name)
    candidates.append(cwd / name)
    if cwd.parent:
        candidates.append(cwd.parent / "engine" / name)
    if getattr(sys, "frozen", False):
        candidates.append(Path(sys.executable).parent / "engine" / name)
        candidates.append(Path(sys.executable).parent / name)
    try:
        from modkit.paths import user_config_dir
        candidates.append(user_config_dir() / "engine" / name)
    except OSError:
        pass
    return candidates


def find_engine(explicit: str | None = None) -> tuple[Path | None, list[str]]:
    """Locate the engine binary. Returns ``(path, candidates_tried)``.

    When *explicit* is given, ONLY that path is consulted — the caller
    asked for a specific binary, so we either find it there or report
    failure. Auto-discovery is reserved for the no-argument case so the
    agent can ask the user to place the engine somewhere predictable.
    """
    tried: list[str] = []
    if explicit:
        p = Path(explicit).expanduser()
        tried.append(str(p))
        if p.is_file():
            return p, tried
        return None, tried
    for c in _candidate_paths():
        tried.append(str(c))
        if c.is_file():
            return c, tried
    return None, tried


def _classify(line: str) -> str | None:
    """Return a short label for ``line`` if it looks like a preflight error."""
    lowered = line.lower()
    for needle in PREFLIGHT_ERROR_PATTERNS:
        if needle in lowered:
            return line.rstrip()
    return None


def _spawn(engine_path: Path) -> subprocess.Popen[str]:
    """Start the engine with stdin/stdout pipes and merged stderr."""
    return subprocess.Popen(
        [str(engine_path)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,  # merge — easier to scan a single log
        cwd=str(engine_path.parent),
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,  # line-buffered
    )


def _drain(
    proc: subprocess.Popen[str],
    log_lines: list[str],
    preflight_errors: list[str],
    deadline: float,
    total_bytes: list[int],
) -> None:
    """Read lines from ``proc.stdout`` until the deadline or EOF."""
    for line in proc.stdout:
        stripped = line.rstrip("\n")
        log_lines.append(stripped)
        flagged = _classify(stripped)
        if flagged:
            preflight_errors.append(flagged)
        total_bytes[0] += len(stripped) + 1
        if len(log_lines) >= MAX_LOG_LINES or total_bytes[0] >= MAX_LOG_BYTES:
            break
        if time.monotonic() >= deadline:
            break


def _run(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    # ── 1. validate arguments ────────────────────────────────────────
    mods = args.get("mods")
    if not isinstance(mods, list) or not mods:
        return ToolResult(
            ok=False,
            error="'mods' must be a non-empty list of mod IDs (folder names under the mods root).",
        )
    mods = [str(m).strip() for m in mods]
    mods = [m for m in mods if m]
    if not mods:
        return ToolResult(ok=False, error="'mods' list is empty after trimming")
    invalid = [m for m in mods if not all(c.isalnum() or c in "_-" for c in m)]
    if invalid:
        return ToolResult(
            ok=False,
            error=(
                f"invalid mod IDs: {invalid!r}. "
                "Use folder-name characters only (letters, digits, underscore, dash)."
            ),
        )

    wait_seconds = float(args.get("wait_seconds", DEFAULT_WAIT_SECONDS))
    wait_seconds = max(0.5, min(MAX_WAIT_SECONDS, wait_seconds))

    engine_path_str = args.get("engine_path")
    mods_dir_override = args.get("mods_dir")
    mods_root = Path(mods_dir_override).expanduser() if mods_dir_override else ctx.mods_root
    mods_dir = str(mods_root)

    # ── 2. Python preflight (mirrors the JS ModLoader logic) ────────
    preflight_reports = run_preflight(mods_root, mods)
    js_disabled = [r["mod_id"] for r in preflight_reports.values() if r["disabled"]]
    js_total_errors = sum(
        len(r["meta_errors"]) + len(r["data_errors"])
        for r in preflight_reports.values()
    )
    js_error_lines: list[str] = []
    for mod_id, report in preflight_reports.items():
        if report["ok"]:
            continue
        for err in report["meta_errors"]:
            js_error_lines.append(f"[ModLoader] {mod_id} meta: {err}")
        for err in report["data_errors"]:
            js_error_lines.append(f"[ModLoader] {mod_id} data: {err}")

    # ── 3. locate the engine ─────────────────────────────────────────
    engine_path, tried = find_engine(engine_path_str)
    if engine_path is None:
        # No engine — return the Python preflight only. The agent
        # still gets the JS-style errors the user sees in the
        # DevConsole.
        log_body = "\n".join(js_error_lines) or "All mods passed preflight."
        return ToolResult(
            ok=False,
            content=log_body,
            data={
                "engine_path": None,
                "engine_searched": tried,
                "mods": mods,
                "mods_dir": mods_dir,
                "wait_seconds": wait_seconds,
                "engine_skipped": True,
                "preflight": {
                    "reports": preflight_reports,
                    "disabled_mods": js_disabled,
                    "total_errors": js_total_errors,
                },
            },
            error=(
                "Engine not found — only Python preflight was run. "
                "Pass engine_path=... or place "
                + _exe_name()
                + " at one of: " + ", ".join(tried[:3])
                if not engine_path else ""
            ),
        )

    # ── 4. spawn engine ──────────────────────────────────────────────
    try:
        proc = _spawn(engine_path)
    except OSError as exc:
        return ToolResult(
            ok=False,
            content="\n".join(js_error_lines),
            error=f"failed to launch engine at {engine_path}: {exc}",
            data={
                "engine_path": str(engine_path),
                "mods": mods,
                "preflight": {
                    "reports": preflight_reports,
                    "disabled_mods": js_disabled,
                    "total_errors": js_total_errors,
                },
            },
        )

    log_lines: list[str] = []
    preflight_errors: list[str] = []
    total_bytes = [0]
    started = time.monotonic()
    deadline = started + wait_seconds
    init_sent_at: float | None = None

    reader = threading.Thread(
        target=_drain,
        args=(proc, log_lines, preflight_errors, deadline, total_bytes),
        daemon=True,
    )
    reader.start()

    # Let the engine print its "ready" banner before we send init.
    time.sleep(0.25)
    init_payload = {
        "command": "init",
        "mods_dir": mods_dir,
        "active_mods": mods,
    }
    try:
        assert proc.stdin is not None
        proc.stdin.write(json.dumps(init_payload, ensure_ascii=False) + "\n")
        proc.stdin.flush()
        init_sent_at = time.monotonic()
    except (OSError, ValueError) as exc:
        reader.join(timeout=1.0)
        engine_log = "\n".join(log_lines)
        body = _combine_logs(js_error_lines, engine_log)
        return ToolResult(
            ok=js_total_errors == 0 and not preflight_errors,
            content=body,
            error=f"engine accepted the pipe but stdin write failed: {exc}",
            data={
                "engine_path": str(engine_path),
                "mods": mods,
                "exit_code": proc.returncode,
                "preflight": {
                    "reports": preflight_reports,
                    "disabled_mods": js_disabled,
                    "total_errors": js_total_errors,
                },
            },
        )

    # ── 5. wait for the capture window ───────────────────────────────
    remaining = max(0.0, deadline - time.monotonic())
    try:
        proc.wait(timeout=remaining if remaining > 0 else 0.5)
    except subprocess.TimeoutExpired:
        pass

    # ── 6. terminate cleanly if still running ────────────────────────
    terminated = False
    if proc.poll() is None:
        try:
            proc.terminate()
        except OSError:
            pass
        try:
            proc.wait(timeout=DEFAULT_TERMINATE_GRACE)
            terminated = True
        except subprocess.TimeoutExpired:
            try:
                proc.kill()
                proc.wait(timeout=DEFAULT_TERMINATE_GRACE)
                terminated = True
            except OSError:
                pass

    reader.join(timeout=1.0)
    elapsed = time.monotonic() - started
    engine_log = "\n".join(log_lines)
    truncated = (
        len(log_lines) >= MAX_LOG_LINES or total_bytes[0] >= MAX_LOG_BYTES
    )
    body = _combine_logs(js_error_lines, engine_log)

    return ToolResult(
        ok=js_total_errors == 0 and not preflight_errors,
        content=body,
        data={
            "engine_path": str(engine_path),
            "mods": mods,
            "mods_dir": mods_dir,
            "wait_seconds": wait_seconds,
            "elapsed_seconds": round(elapsed, 3),
            "init_sent_at_seconds": (
                round(init_sent_at - started, 3) if init_sent_at is not None else None
            ),
            "exit_code": proc.returncode,
            "terminated_by_tool": terminated,
            "engine_log_lines": len(log_lines),
            "engine_log_truncated": truncated,
            "engine_preflight_errors": preflight_errors,
            "preflight": {
                "reports": preflight_reports,
                "disabled_mods": js_disabled,
                "total_errors": js_total_errors,
            },
        },
        error=_combined_error(js_disabled, js_total_errors, preflight_errors),
    )


def _combine_logs(js_lines: list[str], engine_log: str) -> str:
    parts: list[str] = []
    if js_lines:
        parts.append("──── Python preflight (mirrors JS ModLoader) ────")
        parts.extend(js_lines)
    if engine_log:
        if parts:
            parts.append("")
        parts.append("──── Engine stdout/stderr ────")
        parts.append(engine_log)
    return "\n".join(parts) if parts else "All mods passed preflight."


def _combined_error(
    js_disabled: list[str],
    js_total_errors: int,
    engine_preflight_errors: list[str],
) -> str:
    bits: list[str] = []
    if js_total_errors:
        bits.append(
            f"{len(js_disabled)} mod(s) disabled by Python preflight: {js_disabled}"
        )
    if engine_preflight_errors:
        bits.append(
            f"{len(engine_preflight_errors)} engine preflight issue(s) — "
            "see 'engine_preflight_errors' in the result"
        )
    return "; ".join(bits)


def build_run_game_tool() -> Tool:
    return Tool(
        name="run_game",
        description=(
            "Run the same preflight the JS ModLoader runs, then launch the "
            "Meterea C++ simulation engine with the given mod IDs. The Python "
            "preflight catches the JS-layer errors (missing stats, broken "
            "tag_defaults, eras without default_location_file, etc.) — the "
            "exact same errors you see in the Electron DevConsole. The C++ "
            "engine then runs its own DATA ERROR preflight. Both reports are "
            "returned. The engine is terminated before this tool returns; "
            "this is a preflight check, not a long-running game session. For "
            "static analysis without spawning the engine, use preflight_mod."
        ),
        parameters={
            "type": "object",
            "properties": {
                "mods": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Mod IDs to enable (folder names under the mods root). "
                        "Required, non-empty."
                    ),
                },
                "wait_seconds": {
                    "type": "number",
                    "minimum": 0.5,
                    "maximum": MAX_WAIT_SECONDS,
                    "description": (
                        "How long to capture engine output. Default "
                        f"{DEFAULT_WAIT_SECONDS:g} seconds, max "
                        f"{MAX_WAIT_SECONDS:g} seconds. Long enough for "
                        "the engine to print all preflight errors, short "
                        "enough to keep the tool snappy."
                    ),
                },
                "engine_path": {
                    "type": "string",
                    "description": (
                        "Override path to the engine executable. Default: "
                        "auto-discover from engine/ next to the project, "
                        "alongside modkit.exe, or the path stored in "
                        "%APPDATA%\\metera-modkit\\engine_path.txt. If the "
                        "engine can't be found the tool still returns the "
                        "Python preflight result."
                    ),
                },
                "mods_dir": {
                    "type": "string",
                    "description": (
                        "Override the mods directory. Default: the configured "
                        "mods root."
                    ),
                },
            },
            "required": ["mods"],
        },
        kind=Kind.SHELL,
        handler=_run,
    )


__all__ = [
    "build_run_game_tool",
    "engine_executable_name",
    "find_engine",
    "DEFAULT_WAIT_SECONDS",
    "MAX_WAIT_SECONDS",
]
