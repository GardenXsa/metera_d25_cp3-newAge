"""Read and categorise the Chronicles of Meterea runtime log.

The Electron renderer (``js/core/runtimeLog.js``) already funnels every
``console.error``, ``console.warn`` and the global ``error`` /
``unhandledrejection`` events into ``runtime.log`` via the
``runtime-log-append`` IPC handler in ``main.js``. Every line is a
JSON object::

    {"ts": "...", "level": "error", "scope": "UnhandledPromise",
     "message": "...", "detail": {...}}

This module gives the agent three things:

* :func:`runtime_log_path`  — where the file lives on this OS
* :func:`parse_runtime_log` — line-by-line parser that tolerates
  half-flushed files and non-JSON lines
* :func:`categorise`        — bucket each entry by which layer
  produced it (preflight / engine / renderer)

The categorisation is rule-based on the ``scope`` field which the
renderer sets explicitly when it funnels a message through
``RuntimeLog``:

* ``ModLoader`` / ``ModGuard`` / ``ModKit`` — preflight (mod data)
* ``Nexus`` (anything starting with it)    — C++ engine
* ``UnhandledPromise`` / ``RendererError`` — runtime JS in the
  Electron renderer
* everything else is treated as renderer (catch-all)

The agent can call :func:`read_errors_since` to fetch only the lines
added after a given byte offset — useful for running a fresh
validation cycle without seeing yesterday's noise.
"""

from __future__ import annotations

import json
import os
import platform
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable


# productName in package.json is "Chronicles of Meterea", but
# Electron's app.getPath('userData') falls back to ``name`` which is
# "chronicles-of-meterea" — the same folder the modkit already targets
# via :func:`modkit.paths.game_mods_dir`. Keep them in sync if the
# productName ever changes.
_USER_DATA_CANDIDATES: tuple[str, ...] = (
    "Chronicles of Meterea",
    "chronicles-of-meterea",
    "com.mrkins.meterea",
)


# ── locations ─────────────────────────────────────────────────────────


def _user_data_root() -> Path:
    """Return the platform-specific parent of the user data folder."""
    system = platform.system()
    if system == "Windows":
        base = os.environ.get("APPDATA", os.path.expanduser("~\\AppData\\Roaming"))
    elif system == "Darwin":
        base = os.path.expanduser("~/Library/Application Support")
    else:
        base = os.environ.get(
            "XDG_DATA_HOME", os.path.expanduser("~/.local/share")
        )
    return Path(base)


def runtime_log_path(override: str | None = None) -> Path:
    """Return the path to ``runtime.log``.

    When *override* is given, return it as-is (expanded). Otherwise look
    in each well-known user data folder, in order, and return the first
    one that actually has a ``runtime.log`` file. Falls back to the
    first candidate so the caller can still write to a known location.
    """
    if override:
        return Path(override).expanduser()

    root = _user_data_root()
    for name in _USER_DATA_CANDIDATES:
        candidate = root / name / "runtime.log"
        if candidate.is_file():
            return candidate
    return root / _USER_DATA_CANDIDATES[0] / "runtime.log"


# ── data types ────────────────────────────────────────────────────────


@dataclass
class LogEntry:
    ts: str
    level: str
    scope: str
    message: str
    detail: Any = None
    # which layer produced the error — one of
    # "preflight" | "engine" | "renderer" | "unknown"
    category: str = "unknown"
    # original line number in the file (1-indexed, for humans)
    line_no: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class RuntimeLogReport:
    path: Path
    total_lines: int = 0
    parsed: int = 0
    skipped_malformed: int = 0
    entries: list[LogEntry] = field(default_factory=list)

    @property
    def errors(self) -> list[LogEntry]:
        return [e for e in self.entries if e.level == "error"]

    @property
    def warnings(self) -> list[LogEntry]:
        return [e for e in self.entries if e.level == "warn"]

    def by_category(self, category: str) -> list[LogEntry]:
        return [e for e in self.entries if e.category == category]

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": str(self.path),
            "total_lines": self.total_lines,
            "parsed": self.parsed,
            "skipped_malformed": self.skipped_malformed,
            "entries": [e.to_dict() for e in self.entries],
            "summary": {
                "errors": len(self.errors),
                "warnings": len(self.warnings),
                "preflight_errors": len(self.by_category("preflight")),
                "engine_errors": len(self.by_category("engine")),
                "renderer_errors": len(self.by_category("renderer")),
            },
        }


# ── categorisation ────────────────────────────────────────────────────


_PREFLIGHT_SCOPES = frozenset(
    {
        "ModLoader",
        "ModGuard",
        "ModKit",
        "ModAPI",
        "RuntimeData",
    }
)
_ENGINE_SCOPES = frozenset(
    {
        "Nexus",
        "NexusParseError",
        "NexusCritical",
        "NexusCartographer",
    }
)
_RENDERER_SCOPES = frozenset(
    {
        "UnhandledPromise",
        "RendererError",
        "EventBus",
    }
)


def categorise(entry: LogEntry) -> str:
    """Tag a log entry with the layer that produced it.

    Best-effort rule-based: the scope names are set explicitly by the
    renderer / engine / ModLoader, so this is reliable in practice.
    Anything we don't recognise falls into ``"renderer"`` because that
    is the catch-all layer that produces free-form console output.
    """
    scope = (entry.scope or "").strip()
    message = (entry.message or "").lower()
    if not scope:
        # No scope — usually a free-form log line. Try to sniff.
        if "modloader" in message or "preflight" in message or "modguard" in message:
            return "preflight"
        if message.startswith("nexus") or "[nexus" in message:
            return "engine"
        return "renderer"

    if scope in _PREFLIGHT_SCOPES or scope.startswith("ModLoader"):
        return "preflight"
    if scope in _ENGINE_SCOPES or scope.startswith("Nexus"):
        return "engine"
    if scope in _RENDERER_SCOPES:
        return "renderer"
    # Default: renderer. The renderer is the most common source of
    # arbitrary log lines (mods, custom scripts, event handlers).
    return "renderer"


# ── parsing ───────────────────────────────────────────────────────────


def _coerce_entry(d: dict[str, Any], line_no: int) -> LogEntry:
    entry = LogEntry(
        ts=str(d.get("ts", "")),
        level=str(d.get("level", "info")),
        scope=str(d.get("scope", "")),
        message=str(d.get("message", "")),
        detail=d.get("detail"),
        line_no=line_no,
    )
    entry.category = categorise(entry)
    return entry


def parse_runtime_log(
    path: str | Path,
    *,
    min_level: str = "info",
    from_byte: int = 0,
) -> RuntimeLogReport:
    """Parse a runtime log file into structured entries.

    * ``min_level`` filters out chatter (``debug``/``info`` if you only
      care about warnings and errors).
    * ``from_byte`` lets the caller read only what was appended after a
      previous read (e.g. between two validation cycles).

    The file is treated as line-delimited JSON. Lines that don't parse
    are skipped silently and counted under ``skipped_malformed`` so a
    half-flushed tail doesn't kill the whole report.
    """
    p = Path(path)
    report = RuntimeLogReport(path=p)
    if not p.is_file():
        return report

    levels = {"debug": 0, "info": 1, "warn": 2, "error": 3}
    threshold = levels.get(min_level.lower(), 1)

    with p.open("r", encoding="utf-8", errors="replace") as fh:
        if from_byte:
            fh.seek(from_byte)
        for line_no, raw in enumerate(fh, start=1):
            line = raw.strip()
            if not line:
                continue
            report.total_lines += 1
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                report.skipped_malformed += 1
                continue
            if not isinstance(obj, dict):
                report.skipped_malformed += 1
                continue
            entry = _coerce_entry(obj, line_no)
            if levels.get(entry.level, 1) < threshold:
                continue
            report.entries.append(entry)
            report.parsed += 1
    return report


def file_size(path: str | Path) -> int:
    """Return the current size of the log file (or 0 if missing)."""
    p = Path(path)
    try:
        return p.stat().st_size
    except OSError:
        return 0


def read_errors_since(
    path: str | Path,
    byte_offset: int,
) -> tuple[RuntimeLogReport, int]:
    """Read entries appended after ``byte_offset`` and return the new offset.

    Convenience wrapper around :func:`parse_runtime_log` for the common
    "give me only what was logged since I last looked" pattern.
    Returns ``(report, new_offset)`` — the new offset is the file size
    after the read so the caller can persist it for the next call.
    """
    report = parse_runtime_log(path, from_byte=byte_offset)
    return report, file_size(path)


__all__ = [
    "LogEntry",
    "RuntimeLogReport",
    "categorise",
    "file_size",
    "parse_runtime_log",
    "read_errors_since",
    "runtime_log_path",
]
