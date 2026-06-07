"""``validate_e2e`` — the single end-to-end check the agent uses to
find, understand and fix any of its own errors.

What it does (in order):

1. **Static analysis** — runs the Python preflight port
   (:func:`modkit.preflight.run_preflight`) and the legacy
   ``validate_mod`` schema check against the active mods. These catch
   the JS ModLoader and C++ engine contract violations that the static
   validators already know about.

2. **Launch** — optionally spawns the Electron app from
   ``project_root`` with the chosen mods active (the current
   ``settings.json`` is backed up and restored). This is what gives
   the validator access to the runtime JS / unhandled-promise errors
   the static checks can't see.

3. **Wait for init** — polls the runtime log for the renderer's
   init-complete sentinel (``[RuntimeData] All sections initialised``
   style lines; any of the well-known post-init scopes works) and
   then gives the game a few extra seconds to surface async errors.

4. **Tear down** — terminates the Electron process cleanly, restores
   the user's settings, and reads the runtime log entries that were
   appended during the validation window (since the byte offset we
   snapshotted at step 2).

5. **Custom checks** — runs every user-registered check from
   :mod:`modkit.tools.custom_checks` against the gathered context.
   This is the extension point: the agent can register a Python
   check for any project-specific invariant and have it run
   automatically inside the same cycle.

6. **Unified report** — the result dict groups every error by its
   layer (``preflight`` / ``engine`` / ``renderer`` / ``custom``) with
   a short message and a ``fix_hint`` where the validator can
   suggest one. The agent consumes this directly to drive its
   self-fix loop.

The tool is deliberately synchronous: spawn → wait → kill. It is
NOT a long-running session. For an actual playable session the user
launches the game from the OS, then calls ``validate_e2e`` again
with ``launch_electron=False`` to analyse the log that was produced.
"""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from modkit.paths import game_mods_dir, user_config_dir
from modkit.permissions import Kind
from modkit.preflight import run_preflight
from modkit.tools.custom_checks import (
    CheckContext,
    run_checks as run_custom_checks,
    summarise as summarise_custom,
)
from modkit.tools.registry import Tool, ToolContext, ToolResult
from modkit.tools.runtime_log import (
    file_size as log_file_size,
    parse_runtime_log,
    read_errors_since,
    runtime_log_path,
)
from modkit.validate import validate_mod as static_validate_mod


# ── tunables ─────────────────────────────────────────────────────────


DEFAULT_LAUNCH_TIMEOUT_S = 15.0   # how long to wait for init
DEFAULT_EXTRA_SETTLE_S = 3.0      # quiet period after init before we kill
DEFAULT_TOTAL_BUDGET_S = 90.0     # hard cap on the whole tool
INIT_SENTINEL_SCOPES: tuple[str, ...] = (
    "RuntimeData",
    "ModKit",
    "ModLoader",
    "CharacterStatsResolver",
)


# ── finding the project root ─────────────────────────────────────────


def _looks_like_project_root(p: Path) -> bool:
    """Heuristic — does this folder contain the Electron app?"""
    if not p.is_dir():
        return False
    return (p / "package.json").is_file() and (p / "main.js").is_file()


def find_project_root(start: Path | None = None) -> Path | None:
    """Walk up from *start* (default: cwd) until we find ``package.json`` + ``main.js``.

    Falls back to the modkit's parent and the engine_path.txt trick
    (the same fallback the ``run_game`` tool uses) before giving up.
    """
    candidates: list[Path] = []
    cursor = (start or Path.cwd()).resolve()
    for _ in range(8):
        if _looks_like_project_root(cursor):
            return cursor
        candidates.append(cursor)
        if not cursor.parent or cursor.parent == cursor:
            break
        cursor = cursor.parent

    # The modkit is often run from inside ``metera-modkit/`` — try the
    # parent as a fallback. The C++ engine uses the same trick.
    try:
        from modkit.tools.run_game import _read_engine_path_override
        override = _read_engine_path_override()
        if override:
            p = Path(override).expanduser().resolve().parent
            if _looks_like_project_root(p):
                return p
    except (OSError, ImportError):
        pass

    # Last-ditch: look for a ``project_root`` env var so the user /
    # CI can pin it explicitly.
    env_root = os.environ.get("METERA_PROJECT_ROOT")
    if env_root:
        p = Path(env_root).expanduser().resolve()
        if _looks_like_project_root(p):
            return p

    return None


# ── settings.json swap ───────────────────────────────────────────────


@dataclass
class _SettingsBackup:
    path: Path
    original: bytes | None
    restored: bool = False

    def write_overlay(self, *, active_mods: list[str]) -> None:
        if not self.path.exists():
            base: dict[str, Any] = {"mods": {"active": active_mods, "disabled": {}}}
        else:
            try:
                base = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                base = {}
        base.setdefault("mods", {})
        base["mods"]["active"] = list(active_mods)
        base["mods"].setdefault("disabled", {})
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(base, indent=2, ensure_ascii=False), encoding="utf-8")

    def restore(self) -> None:
        if self.restored:
            return
        if self.original is not None:
            self.path.write_bytes(self.original)
        elif self.path.exists():
            # Nothing to restore to — best-effort delete the overlay.
            try:
                self.path.unlink()
            except OSError:
                pass
        self.restored = True


def _settings_path() -> Path:
    """Where the Electron app reads its settings from.

    Mirrors ``main.js``: ``app.getPath('userData') + '/settings.json'``.
    The productName / appId match the candidates in
    :mod:`modkit.tools.runtime_log`.
    """
    base = user_config_dir().parent if sys.platform != "win32" else user_config_dir().parent
    # user_config_dir on Windows is %APPDATA%/metera-modkit; the
    # game's user data is the sibling %APPDATA%/chronicles-of-meterea.
    appdata = os.environ.get("APPDATA", os.path.expanduser("~\\AppData\\Roaming"))
    for name in ("Chronicles of Meterea", "chronicles-of-meterea", "com.mrkins.meterea"):
        candidate = Path(appdata) / name / "settings.json"
        if candidate.parent.is_dir():
            return candidate
    return Path(appdata) / "chronicles-of-meterea" / "settings.json"


# ── launch + tear-down ───────────────────────────────────────────────


def _spawn_electron(project_root: Path) -> subprocess.Popen[Any]:
    """Spawn the Electron app and return the handle. Caller is responsible for killing it."""
    # Prefer the locally-installed electron from node_modules so the
    # test works the same way as ``npm start``.
    local = project_root / "node_modules" / ".bin" / ("electron.cmd" if sys.platform == "win32" else "electron")
    if local.is_file():
        cmd: list[str] = [str(local), "."]
    else:
        # Fall back to a system-wide electron. ``npx electron`` works on
        # every platform and is what CI usually has available.
        cmd = [sys.executable, "-m", "electron_tools"] if False else ["npx", "--no-install", "electron", "."]
        # If npx isn't available we'll just let Popen raise and the
        # caller surfaces the OSError to the user.

    env = os.environ.copy()
    env.setdefault("ELECTRON_DISABLE_SECURITY_WARNINGS", "1")
    return subprocess.Popen(
        cmd,
        cwd=str(project_root),
        stdout=subprocess.DEVNULL,  # we read runtime.log instead
        stderr=subprocess.DEVNULL,
        env=env,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0,
    )


def _terminate(proc: subprocess.Popen[Any], grace: float = 3.0) -> None:
    """Terminate the Electron process politely, then forcibly if needed."""
    if proc.poll() is not None:
        return
    try:
        if sys.platform == "win32":
            proc.terminate()
        else:
            proc.send_signal(signal.SIGTERM)
    except OSError:
        pass
    try:
        proc.wait(timeout=grace)
    except subprocess.TimeoutExpired:
        try:
            proc.kill()
        except OSError:
            pass
        try:
            proc.wait(timeout=grace)
        except subprocess.TimeoutExpired:
            pass


def _wait_for_init(
    log: Path,
    *,
    timeout: float,
    extra_settle: float,
) -> tuple[bool, str]:
    """Poll the runtime log until a post-init sentinel appears, then wait ``extra_settle`` seconds.

    Returns ``(ok, detail)`` — ok is True when we found a sentinel, the
    detail string is the first sentinel line we matched (empty when
    we timed out).
    """
    deadline = time.monotonic() + timeout
    seen: list[str] = []
    sentinel: str = ""
    last_size = 0
    stable_since: float | None = None

    while time.monotonic() < deadline:
        if not log.is_file():
            time.sleep(0.3)
            continue
        current_size = log_file_size(log)
        if current_size != last_size:
            last_size = current_size
            stable_since = None
            report = parse_runtime_log(log, min_level="info", from_byte=last_size - 4096)
            for entry in report.entries[-20:]:
                if entry.scope in INIT_SENTINEL_SCOPES and "[initialise" in (entry.message or "").lower() or entry.scope == "RuntimeData" and "synchron" in (entry.message or "").lower():
                    if not sentinel:
                        sentinel = entry.message
                if entry.level in ("error", "warn"):
                    seen.append(f"[{entry.scope}] {entry.message}")
        else:
            # File is stable — start (or keep) the settle countdown.
            if sentinel and stable_since is None:
                stable_since = time.monotonic()
            if stable_since and time.monotonic() - stable_since >= extra_settle:
                return True, sentinel
        time.sleep(0.4)

    # Timeout — best-effort: we may have missed the sentinel, or the
    # renderer never started at all. Return whatever we saw.
    if not sentinel and not seen:
        return False, "no log entries observed within timeout"
    return bool(sentinel), sentinel or "no sentinel matched; collected what we could"


# ── result types ─────────────────────────────────────────────────────


@dataclass
class E2EReport:
    ok: bool
    project_root: Path | None
    log_path: Path
    mods_under_test: list[str]
    summary: dict[str, int] = field(default_factory=dict)
    preflight: dict[str, Any] = field(default_factory=dict)
    schema: dict[str, Any] = field(default_factory=dict)
    engine: list[dict[str, Any]] = field(default_factory=list)
    renderer: list[dict[str, Any]] = field(default_factory=list)
    custom: list[dict[str, Any]] = field(default_factory=list)
    launch: dict[str, Any] = field(default_factory=dict)
    fix_hints: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "project_root": str(self.project_root) if self.project_root else None,
            "log_path": str(self.log_path),
            "mods_under_test": list(self.mods_under_test),
            "summary": dict(self.summary),
            "preflight": self.preflight,
            "schema": self.schema,
            "engine": self.engine,
            "renderer": self.renderer,
            "custom": self.custom,
            "launch": self.launch,
            "fix_hints": list(self.fix_hints),
            "notes": list(self.notes),
        }


# ── top-level handler ────────────────────────────────────────────────


def _build_fix_hints(report: E2EReport) -> list[str]:
    """Generate generic, actionable hints from the gathered errors."""
    hints: list[str] = []
    for e in report.preflight.get("meta_errors_by_mod", {}).values():
        for err in e:
            if "id" in err and "missing" in err.lower():
                hints.append("Add a unique `id` (lowercase, alphanumeric+underscore) to each mod entry.")
                break
    for e in report.renderer:
        msg = e.get("message", "")
        if "Cannot read properties of undefined" in msg or "split" in msg:
            hints.append(
                "Renderer crashed on a translation key (likely t(...) call). "
                "Add `display_name_i18n_key` / `description_i18n_key` to the affected "
                "race / class / era entry, or fix the JS code that builds the key."
            )
            break
    for e in report.engine:
        msg = e.get("message", "")
        if "DATA ERROR" in msg.upper():
            hints.append(
                "C++ engine reported a DATA ERROR — open the affected data file, "
                "fix the typed-wrong / missing field, re-run validate_e2e."
            )
            break
    if not hints and not report.ok:
        hints.append("No generic hint available — read the categorised errors above.")
    return hints


def _run(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    mods_arg = args.get("mods")
    if mods_arg is None:
        # No override — read the user's current settings.
        sp = _settings_path()
        if sp.is_file():
            try:
                cur = json.loads(sp.read_text(encoding="utf-8"))
                mods_arg = (cur.get("mods") or {}).get("active") or ["base_game"]
            except (OSError, json.JSONDecodeError):
                mods_arg = ["base_game"]
        else:
            mods_arg = ["base_game"]
    if not isinstance(mods_arg, list) or not mods_arg:
        return ToolResult(ok=False, error="`mods` must be a non-empty list of mod IDs")
    mods = [str(m).strip() for m in mods_arg if str(m).strip()]

    simulate_ticks = int(args.get("simulate_ticks", 0) or 0)
    launch_electron = bool(args.get("launch_electron", True))
    include_checks = bool(args.get("include_checks", True))
    restore_settings = bool(args.get("restore_settings", True))
    wait_seconds = float(args.get("wait_seconds", DEFAULT_LAUNCH_TIMEOUT_S))
    extra_settle = float(args.get("extra_settle_seconds", DEFAULT_EXTRA_SETTLE_S))
    total_budget = float(args.get("total_budget_seconds", DEFAULT_TOTAL_BUDGET_S))

    project_root: Path | None = None
    explicit_root = args.get("project_root")
    if explicit_root:
        project_root = Path(explicit_root).expanduser().resolve()
        if not _looks_like_project_root(project_root):
            return ToolResult(ok=False, error=f"project_root {project_root} doesn't look like a Meterea project (no package.json + main.js)")
    else:
        project_root = find_project_root()

    # Where mods come from. The modkit already tracks the user's real
    # mods folder; the agent's "active mods" list is what we want to
    # validate against the project on disk.
    mods_root = ctx.mods_root if ctx.mods_root else game_mods_dir()
    log_path = runtime_log_path()
    started = time.monotonic()
    deadline = started + total_budget

    report = E2EReport(
        ok=True,
        project_root=project_root,
        log_path=log_path,
        mods_under_test=mods,
        launch={"launched": launch_electron, "wait_seconds": wait_seconds},
    )

    # ── 1. Python preflight (mirrors the JS ModLoader) ─────────────
    preflight_reports = run_preflight(mods_root, mods)
    meta_total = sum(len(r["meta_errors"]) for r in preflight_reports.values())
    data_total = sum(len(r["data_errors"]) for r in preflight_reports.values())
    disabled = [r["mod_id"] for r in preflight_reports.values() if r["disabled"]]
    report.preflight = {
        "mods_root": str(mods_root),
        "reports": preflight_reports,
        "meta_errors": meta_total,
        "data_errors": data_total,
        "disabled_mods": disabled,
    }

    # ── 2. Static schema validation (the legacy `validate_mod`) ───
    schema_reports: dict[str, Any] = {}
    for mod_id in mods:
        mod_path = mods_root / mod_id
        if mod_path.is_dir():
            schema_reports[mod_id] = static_validate_mod(mod_path).to_dict()
    report.schema = schema_reports
    schema_errors = sum(
        len(r.get("errors", [])) for r in schema_reports.values()
    )

    # ── 3. (Optionally) launch Electron + read runtime log ────────
    backup: _SettingsBackup | None = None
    log_offset = log_file_size(log_path)
    proc: subprocess.Popen[Any] | None = None
    try:
        if launch_electron and project_root is not None:
            if time.monotonic() >= deadline:
                report.notes.append("Skipped Electron launch — total budget exhausted by preflight.")
            else:
                backup = _SettingsBackup(path=_settings_path(), original=None)
                if backup.path.exists():
                    backup.original = backup.path.read_bytes()
                backup.write_overlay(active_mods=mods)

                report.launch["settings_path"] = str(backup.path)
                try:
                    proc = _spawn_electron(project_root)
                except OSError as exc:
                    report.launch["error"] = f"failed to launch electron: {exc}"
                    report.notes.append("Electron didn't start — runtime log is whatever was there before.")
                else:
                    report.launch["pid"] = proc.pid
                    ok, detail = _wait_for_init(
                        log_path,
                        timeout=min(wait_seconds, max(0.5, deadline - time.monotonic())),
                        extra_settle=min(extra_settle, max(0.0, deadline - time.monotonic())),
                    )
                    report.launch["init_sentinel"] = detail
                    report.launch["init_seen"] = ok
                    if not ok:
                        report.notes.append(
                            "No post-init sentinel found within the wait window. "
                            "The renderer may have failed to start, or the sentinel scope list needs updating."
                        )
                    _terminate(proc)
                    proc = None
        elif launch_electron and project_root is None:
            report.notes.append(
                "Could not locate the project root. Pass `project_root=...` explicitly, "
                "or run from inside the Meterea project folder."
            )

        # Read everything the renderer / engine wrote during this run.
        log_report, new_offset = read_errors_since(log_path, log_offset)
        log_offset = new_offset
        report.engine = [e.to_dict() for e in log_report.by_category("engine") if e.level == "error"]
        report.renderer = [e.to_dict() for e in log_report.by_category("renderer") if e.level == "error"]
        # Preflight events that fired AFTER startup (e.g. ModGuard
        # disabling a mod at runtime) are added to the preflight summary.
        late_preflight = [
            e.to_dict() for e in log_report.by_category("preflight") if e.level == "error"
        ]
        if late_preflight:
            report.preflight["late_runtime_errors"] = late_preflight
        report.launch["log_lines_after_launch"] = log_report.parsed
    finally:
        if proc is not None:
            _terminate(proc)
        if backup is not None and restore_settings:
            backup.restore()

    # ── 4. Custom checks ──────────────────────────────────────────
    if include_checks:
        check_ctx = CheckContext(
            mods_root=mods_root,
            mod_root=ctx.mod_root,
            mod_id=(ctx.mod_root.name if ctx.mod_root else None),
            preflight_reports=preflight_reports,
            project_root=project_root,
            config={},
        )
        # We re-parse the runtime log once so custom checks can use it.
        check_ctx.runtime_log_report = parse_runtime_log(
            log_path, min_level="error", from_byte=log_offset - 0  # all entries
        )
        try:
            custom_results = run_custom_checks(check_ctx)
        except Exception as exc:  # safety net — the framework should never raise
            custom_results = [
                {"name": "<framework>", "ok": False, "level": "error", "message": f"run_checks raised {type(exc).__name__}: {exc}"}
            ]
        report.custom = custom_results

    # ── 5. Roll up the verdict ────────────────────────────────────
    custom_summary = summarise_custom(report.custom) if report.custom else {"errors": 0, "warnings": 0}
    report.summary = {
        "preflight_meta": meta_total,
        "preflight_data": data_total,
        "schema": schema_errors,
        "engine": len(report.engine),
        "renderer": len(report.renderer),
        "custom_errors": custom_summary["errors"],
        "custom_warnings": custom_summary["warnings"],
        "disabled_mods": len(disabled),
    }
    report.ok = (
        meta_total == 0
        and data_total == 0
        and schema_errors == 0
        and not report.engine
        and not report.renderer
        and custom_summary["errors"] == 0
    )

    report.fix_hints = _build_fix_hints(report)

    return ToolResult(
        ok=report.ok,
        content=_format_human_report(report),
        data=report.to_dict(),
        error=(
            ""
            if report.ok
            else f"validation failed: {report.summary}"
        ),
    )


def _format_human_report(report: E2EReport) -> str:
    """Render the report as a compact, scannable block of text."""
    out: list[str] = []
    status = "OK" if report.ok else "FAILED"
    out.append(f"═══ validate_e2e :: {status} ═══")
    out.append(f"mods_under_test: {report.mods_under_test}")
    if report.project_root:
        out.append(f"project_root:     {report.project_root}")
    out.append(f"log_path:         {report.log_path}")
    out.append("")
    out.append(f"summary:          {report.summary}")
    if report.preflight.get("disabled_mods"):
        out.append(f"disabled_mods:    {report.preflight['disabled_mods']}")
    if report.launch.get("init_sentinel"):
        out.append(f"init_sentinel:    {report.launch['init_sentinel']}")
    if report.notes:
        out.append("")
        out.append("notes:")
        for note in report.notes:
            out.append(f"  • {note}")
    if report.fix_hints:
        out.append("")
        out.append("fix_hints:")
        for hint in report.fix_hints:
            out.append(f"  → {hint}")

    def _section(title: str, entries: list[dict[str, Any]]) -> None:
        if not entries:
            return
        out.append("")
        out.append(f"── {title} ({len(entries)}) ──")
        for entry in entries[:20]:
            # Tolerate str entries (e.g. preflight reports ship plain
            # error strings) so the formatter is the same for every layer.
            if isinstance(entry, str):
                out.append(f"  • {entry[:200]}")
                continue
            msg = entry.get("message", "")
            scope = entry.get("scope", "")
            out.append(f"  [{scope}] {msg[:200]}")
            if entry.get("detail", {}).get("stack"):
                stack = entry["detail"]["stack"].splitlines()
                for line in stack[:4]:
                    out.append(f"      {line}")

    for mod_id, mod_report in report.preflight.get("reports", {}).items():
        if mod_report.get("meta_errors"):
            out.append(f"  [preflight:{mod_id}] meta: " + "; ".join(mod_report["meta_errors"][:5]))
        if mod_report.get("data_errors"):
            out.append(f"  [preflight:{mod_id}] data: " + "; ".join(mod_report["data_errors"][:5]))

    for mod_id, sr in report.schema.items():
        for err in sr.get("errors", [])[:5]:
            out.append(f"  [schema:{mod_id}] {err}")

    _section("engine", report.engine)
    _section("renderer", report.renderer)
    _section("custom", report.custom)

    return "\n".join(out)


# ── tool wrapper ─────────────────────────────────────────────────────


def build_validate_e2e_tool() -> Tool:
    return Tool(
        name="validate_e2e",
        description=(
            "End-to-end validation of the active mods against a live Chronicles "
            "of Meterea run. This is the single tool the agent uses to find, "
            "understand and fix its own errors. What it does, in order:\n"
            "  1. Runs the Python preflight (the same checks the JS ModLoader "
            "runs) and the legacy `validate_mod` schema check.\n"
            "  2. Optionally launches the Electron app with the chosen mods, "
            "waits for the renderer's init sentinel, then terminates it.\n"
            "  3. Reads runtime.log entries that were appended during the "
            "validation window and groups them by layer (preflight / engine / "
            "renderer) using the categoriser in `runtime_log.py`.\n"
            "  4. Runs every user-registered custom check from "
            "`custom_checks.py` against the gathered context.\n"
            "  5. Returns a unified report with per-layer errors and fix hints.\n"
            "\n"
            "Arguments: `mods` (list of mod IDs; defaults to the user's current "
            "active list), `project_root` (auto-detect if omitted), "
            "`simulate_ticks` (number of ticks to run after init; 0 = just init), "
            "`launch_electron` (True to spawn the app; False to analyse the "
            "existing log only), `wait_seconds`, `extra_settle_seconds`, "
            "`total_budget_seconds`, `include_checks`, `restore_settings`.\n"
            "\n"
            "The report is also written to `data` so downstream tools can "
            "consume it programmatically. Pass the result back into the "
            "self-fix loop in the system prompt."
        ),
        parameters={
            "type": "object",
            "properties": {
                "mods": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Mod IDs to validate. Defaults to the user's current active list in settings.json.",
                },
                "project_root": {
                    "type": "string",
                    "description": "Path to the Meterea Electron project. Auto-detected from the current working directory if omitted.",
                },
                "simulate_ticks": {
                    "type": "integer",
                    "minimum": 0,
                    "description": "How many simulation ticks to run after init. 0 = just initialise. (Forward-compat: requires the renderer to expose a test IPC; the current implementation waits and tears down without driving ticks.)",
                },
                "launch_electron": {
                    "type": "boolean",
                    "default": True,
                    "description": "Spawn the Electron app to capture runtime errors. Set False to analyse an existing runtime.log only.",
                },
                "wait_seconds": {
                    "type": "number",
                    "description": "How long to wait for the renderer's init sentinel.",
                },
                "extra_settle_seconds": {
                    "type": "number",
                    "description": "Quiet period after the init sentinel before tearing Electron down. Lets async errors flush.",
                },
                "total_budget_seconds": {
                    "type": "number",
                    "description": "Hard cap on the whole tool. The Electron launch is skipped when the preflight already ate the budget.",
                },
                "include_checks": {
                    "type": "boolean",
                    "default": True,
                    "description": "Run user-registered custom checks (see register_check).",
                },
                "restore_settings": {
                    "type": "boolean",
                    "default": True,
                    "description": "Restore the user's settings.json after the validation cycle.",
                },
            },
        },
        kind=Kind.SHELL,
        handler=_run,
    )


__all__ = [
    "DEFAULT_LAUNCH_TIMEOUT_S",
    "build_validate_e2e_tool",
    "find_project_root",
]
