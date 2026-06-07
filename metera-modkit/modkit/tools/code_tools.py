"""Engine-source tools for the modkit agent.

These tools give the LLM structured access to the public Chronicles
of Meterea source repository *without ever writing the source code to
the player's disk*. The implementation is a thin layer on top of
:mod:`modkit.code_repo`; the snapshot itself is held in RAM for the
lifetime of the process.

All twelve tools are ``Kind.READ``. They never modify anything.
"""

from __future__ import annotations

from typing import Any

from modkit import code_repo
from modkit.permissions import Kind
from modkit.tools.registry import Tool, ToolContext, ToolResult


def _ok(data: dict[str, Any], content: str = "") -> ToolResult:
    return ToolResult(ok=True, content=content, data=data)


def _err(msg: str) -> ToolResult:
    return ToolResult(ok=False, error=msg)


def _require_loaded() -> ToolResult | None:
    """Make sure the snapshot is in RAM; return an error result on failure."""
    repo = code_repo.default()
    if not repo.loaded and not repo.load_error:
        repo.ensure_loaded()
    if not repo.loaded:
        return _err(
            f"failed to load engine source from {repo.source_url}: "
            f"{repo.load_error or 'no network?'}"
        )
    return None


# ── 1. code_info ─────────────────────────────────────────────────────


def _code_info(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    repo = code_repo.default()
    info = repo.info()
    if not info["loaded"] and info["load_error"]:
        return _err(
            f"failed to load engine source from {info['source']}: {info['load_error']}"
        )
    return _ok(info)


# ── 2. code_ls ───────────────────────────────────────────────────────


def _code_ls(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    path = str(args.get("path") or "")
    err = _require_loaded()
    if err is not None:
        return err
    return _ok({"path": path, "entries": code_repo.default().list_dir(path)})


# ── 3. code_tree ─────────────────────────────────────────────────────


def _code_tree(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    path = str(args.get("path") or "")
    err = _require_loaded()
    if err is not None:
        return err
    entries = code_repo.default().tree(path)
    return _ok({"path": path, "entries": entries, "count": len(entries)})


# ── 4. code_find_files ──────────────────────────────────────────────


def _code_find_files(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    pattern = str(args.get("glob") or args.get("pattern") or "").strip()
    if not pattern:
        return _err("'glob' is required (fnmatch syntax, e.g. '*.h' or 'engine/*sdk*')")
    err = _require_loaded()
    if err is not None:
        return err
    matches = code_repo.default().find_files(pattern)
    return _ok({"glob": pattern, "matches": matches, "count": len(matches)})


# ── 5. code_outline ─────────────────────────────────────────────────


def _code_outline(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    file = args.get("file")
    file = str(file).strip() if file else None
    err = _require_loaded()
    if err is not None:
        return err
    entries = code_repo.default().outline(file if file else None)
    return _ok(
        {
            "file": file or "(repo-wide)",
            "entries": entries,
            "count": len(entries),
        }
    )


# ── 6. code_grep ─────────────────────────────────────────────────────


def _code_grep(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    pattern = str(args.get("pattern") or "").strip()
    if not pattern:
        return _err("'pattern' is required (Python regular expression)")
    path_glob = args.get("path_glob")
    path_glob = str(path_glob).strip() if path_glob else None
    err = _require_loaded()
    if err is not None:
        return err
    matches = code_repo.default().grep(pattern, path_glob=path_glob)
    if matches and matches[0].get("_error"):
        return _err(matches[0]["_error"])
    return _ok(
        {
            "pattern": pattern,
            "path_glob": path_glob,
            "matches": matches,
            "count": len(matches),
        }
    )


# ── 7. code_where_defined ───────────────────────────────────────────


def _code_where_defined(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    symbol = str(args.get("symbol") or "").strip()
    if not symbol:
        return _err("'symbol' is required")
    err = _require_loaded()
    if err is not None:
        return err
    entries = code_repo.default().where_defined(symbol)
    return _ok({"symbol": symbol, "entries": entries, "count": len(entries)})


# ── 8. code_references ──────────────────────────────────────────────


def _code_references(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    symbol = str(args.get("symbol") or "").strip()
    if not symbol:
        return _err("'symbol' is required")
    path_glob = args.get("path_glob")
    path_glob = str(path_glob).strip() if path_glob else None
    err = _require_loaded()
    if err is not None:
        return err
    entries = code_repo.default().references(symbol, path_glob=path_glob)
    return _ok(
        {
            "symbol": symbol,
            "path_glob": path_glob,
            "entries": entries,
            "count": len(entries),
        }
    )


# ── 9. code_dependencies ────────────────────────────────────────────


def _code_dependencies(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    file = str(args.get("file") or args.get("path") or "").strip()
    if not file:
        return _err("'file' is required (path inside the engine repo)")
    err = _require_loaded()
    if err is not None:
        return err
    entries = code_repo.default().dependencies(file)
    if not entries and not code_repo.default().has_file(file):
        return _err(f"file not found in repo: {file}")
    return _ok({"file": file, "entries": entries, "count": len(entries)})


# ── 10. code_dependents ─────────────────────────────────────────────


def _code_dependents(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    file = str(args.get("file") or args.get("path") or "").strip()
    if not file:
        return _err("'file' is required (path inside the engine repo)")
    err = _require_loaded()
    if err is not None:
        return err
    entries = code_repo.default().dependents(file)
    return _ok({"file": file, "entries": entries, "count": len(entries)})


# ── 11. code_read ───────────────────────────────────────────────────


def _code_read(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    file = str(args.get("file") or args.get("path") or "").strip()
    if not file:
        return _err("'file' is required (path inside the engine repo)")
    err = _require_loaded()
    if err is not None:
        return err
    from_line = args.get("from_line")
    max_lines = args.get("max_lines")
    result = code_repo.default().read_text(file)
    if result is None:
        return _err(f"file not found in repo: {file}")
    text, meta = result
    lines = text.splitlines()
    total_lines = len(lines)
    slice_applied = False
    if from_line is not None or max_lines is not None:
        start = int(from_line) if from_line is not None else 0
        if start < 0:
            start = 0
        if max_lines is not None:
            stop = start + int(max_lines)
        else:
            stop = total_lines
        selected = lines[start:stop]
        text = "\n".join(selected)
        slice_applied = True
    meta["slice_applied"] = slice_applied
    meta["from_line"] = int(from_line) if from_line is not None else 0
    meta["max_lines"] = int(max_lines) if max_lines is not None else total_lines
    meta["total_lines"] = total_lines
    return _ok(meta, content=text)


# ── 12. code_count_lines ────────────────────────────────────────────


def _code_count_lines(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    file = str(args.get("file") or args.get("path") or "").strip()
    if not file:
        return _err("'file' is required (path inside the engine repo)")
    err = _require_loaded()
    if err is not None:
        return err
    stat = code_repo.default().count_lines(file)
    if stat is None:
        return _err(f"file not found in repo: {file}")
    return _ok(stat)


# ── registry ────────────────────────────────────────────────────────


def build_code_tools() -> list[Tool]:
    return [
        Tool(
            name="code_info",
            description=(
                "Overview of the Chronicles of Meterea engine source repository "
                "fetched from GitHub: total files, total size, top-level directories, "
                "file-count breakdown by extension, source URL. The source is held in "
                "RAM only — nothing is written to the player's disk."
            ),
            parameters={"type": "object", "properties": {}, "additionalProperties": False},
            kind=Kind.READ,
            handler=_code_info,
        ),
        Tool(
            name="code_ls",
            description=(
                "List the immediate children of a directory inside the engine source "
                "repo. Each entry has 'name', 'type' (file|dir) and 'size'. Empty path "
                "lists the repo root."
            ),
            parameters={
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_code_ls,
        ),
        Tool(
            name="code_tree",
            description=(
                "Recursive directory listing of a path in the engine source repo. "
                "Returns a flat list with each entry's depth, useful for LLM scanning "
                "without the cost of nested JSON. Empty path lists the whole repo."
            ),
            parameters={
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_code_tree,
        ),
        Tool(
            name="code_find_files",
            description=(
                "Find files in the engine source repo by name pattern. fnmatch syntax, "
                "e.g. 'README*', '*.h', 'engine/*sdk*', 'mod_*.py'."
            ),
            parameters={
                "type": "object",
                "properties": {"glob": {"type": "string"}},
                "required": ["glob"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_code_find_files,
        ),
        Tool(
            name="code_outline",
            description=(
                "Return a structured outline (function / class / method / enum / key / "
                "heading signatures) of one file in the engine source repo, or of the "
                "whole repo if 'file' is omitted. Per-language extraction: Python uses "
                "ast, the rest use regex. Output is structured — the LLM doesn't need "
                "to parse signatures from raw text."
            ),
            parameters={
                "type": "object",
                "properties": {"file": {"type": "string"}},
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_code_outline,
        ),
        Tool(
            name="code_grep",
            description=(
                "Search the engine source repo with a Python regular expression. "
                "Returns every matching line with its file path, line number, and "
                "text. Optional 'path_glob' (fnmatch) to scope to a subset of files. "
                "Use this for free-form queries where code_where_defined and "
                "code_references are not enough."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "pattern": {"type": "string"},
                    "path_glob": {"type": "string"},
                },
                "required": ["pattern"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_code_grep,
        ),
        Tool(
            name="code_where_defined",
            description=(
                "Find every definition site of a symbol in the engine source repo. "
                "Detects C++ functions / classes / structs / enums, JS functions / "
                "classes / arrow exports, Python defs / classes, and MeteraAPI C "
                "exports. Returns structured entries with 'kind' and 'signature'."
            ),
            parameters={
                "type": "object",
                "properties": {"symbol": {"type": "string"}},
                "required": ["symbol"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_code_where_defined,
        ),
        Tool(
            name="code_references",
            description=(
                "Find every reference to a symbol in the engine source repo. Like "
                "code_grep('\\\\bSYMBOL\\\\b') but flags whether each match is a "
                "definition vs. a use site. Optional 'path_glob' to scope."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "path_glob": {"type": "string"},
                },
                "required": ["symbol"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_code_references,
        ),
        Tool(
            name="code_dependencies",
            description=(
                "List the include / import statements of one file in the engine source "
                "repo. C/C++ uses #include, JS/TS uses import/require, Python uses "
                "import/from."
            ),
            parameters={
                "type": "object",
                "properties": {"file": {"type": "string"}},
                "required": ["file"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_code_dependencies,
        ),
        Tool(
            name="code_dependents",
            description=(
                "List every file in the engine source repo that includes / imports the "
                "given file. Reverse of code_dependencies. Useful for ripple-effect "
                "analysis when changing a header."
            ),
            parameters={
                "type": "object",
                "properties": {"file": {"type": "string"}},
                "required": ["file"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_code_dependents,
        ),
        Tool(
            name="code_read",
            description=(
                "Read a file from the engine source repo. Default returns the entire "
                "file. Optional 'from_line' and 'max_lines' slice the file by line "
                "range. There is intentionally NO max-size cap — large files come "
                "back whole so the LLM can see full context."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "file": {"type": "string"},
                    "from_line": {"type": "integer", "minimum": 0},
                    "max_lines": {"type": "integer", "minimum": 1},
                },
                "required": ["file"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_code_read,
        ),
        Tool(
            name="code_count_lines",
            description=(
                "Return the line count, byte size and detected language of one file "
                "in the engine source repo, without reading the body. Use this BEFORE "
                "code_read on large files to know what you're getting into."
            ),
            parameters={
                "type": "object",
                "properties": {"file": {"type": "string"}},
                "required": ["file"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_code_count_lines,
        ),
    ]
