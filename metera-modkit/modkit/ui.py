"""Terminal output helpers: colored printing, prompts, progress, JSON dump."""

from __future__ import annotations

import json
import os
import sys
from typing import Any


def _is_tty(stream) -> bool:
    """Tolerant isatty() that handles GUI-subsystem .exe where streams are None."""
    if stream is None:
        return False
    isatty = getattr(stream, "isatty", None)
    if not callable(isatty):
        return False
    try:
        return bool(isatty())
    except Exception:
        return False


def _safe_stream(name: str):
    """Return sys.<name> or a dummy stream so print()/json.dump() never crash
    when the .exe is built with console=False (Windows GUI subsystem)."""
    stream = getattr(sys, name, None)
    if stream is not None:
        return stream

    class _Dummy:
        def write(self, *_args, **_kwargs):
            return 0

        def flush(self):
            return None

        def isatty(self):
            return False

    return _Dummy()


_USE_COLOR_DEFAULT = (
    _is_tty(sys.stdout)
    and os.environ.get("NO_COLOR") is None
    and os.environ.get("TERM") != "dumb"
)


class _Style:
    reset = "\x1b[0m"
    dim = "\x1b[2m"
    bold = "\x1b[1m"
    red = "\x1b[31m"
    green = "\x1b[32m"
    yellow = "\x1b[33m"
    blue = "\x1b[34m"
    magenta = "\x1b[35m"
    cyan = "\x1b[36m"
    gray = "\x1b[90m"


_color_enabled = _USE_COLOR_DEFAULT


def set_color(enabled: bool) -> None:
    global _color_enabled
    _color_enabled = bool(enabled)


def _wrap(code: str, text: str) -> str:
    if not _color_enabled:
        return text
    return f"{code}{text}{_Style.reset}"


def info(msg: str) -> None:
    print(_wrap(_Style.cyan, "i ") + msg)


def success(msg: str) -> None:
    print(_wrap(_Style.green, "+ ") + msg)


def warn(msg: str) -> None:
    print(_wrap(_Style.yellow, "! ") + msg)


def error(msg: str) -> None:
    print(_wrap(_Style.red, "x ") + msg, file=_safe_stream("stderr"))


def hint(msg: str) -> None:
    print(_wrap(_Style.gray, msg))


def header(msg: str) -> None:
    print(_wrap(_Style.bold, msg))


def dim(text: str) -> str:
    return _wrap(_Style.dim, text)


def bold(text: str) -> str:
    return _wrap(_Style.bold, text)


def color(name: str, text: str) -> str:
    code = getattr(_Style, name, "")
    if not code:
        return text
    return _wrap(code, text)


def confirm(question: str, default: bool = False) -> bool:
    """Ask user a yes/no question. Returns True for yes."""
    suffix = " [Y/n] " if default else " [y/N] "
    while True:
        try:
            raw = input(_wrap(_Style.yellow, "? ") + question + suffix).strip().lower()
        except EOFError:
            return default
        if not raw:
            return default
        if raw in ("y", "yes", "д", "да"):
            return True
        if raw in ("n", "no", "н", "нет"):
            return False


def choose(question: str, options: list[str], default: int = 0) -> int:
    """Numbered menu. Returns the chosen index."""
    print(_wrap(_Style.yellow, "? ") + question)
    for idx, opt in enumerate(options, 1):
        marker = "*" if idx - 1 == default else " "
        print(f"  {marker} {idx}. {opt}")
    while True:
        try:
            raw = input(f"Выбор [1-{len(options)}, по умолчанию {default + 1}]: ").strip()
        except EOFError:
            return default
        if not raw:
            return default
        if raw.isdigit():
            num = int(raw)
            if 1 <= num <= len(options):
                return num - 1
        print(_wrap(_Style.red, "Неверный выбор."))


def ask(prompt: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    try:
        raw = input(_wrap(_Style.yellow, "? ") + prompt + suffix + ": ").strip()
    except EOFError:
        return default
    return raw or default


def write_json(payload: Any, *, indent: int = 2) -> None:
    out = _safe_stream("stdout")
    json.dump(payload, out, ensure_ascii=False, indent=indent)
    out.write("\n")
    out.flush()
