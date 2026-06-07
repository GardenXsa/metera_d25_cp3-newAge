"""File-system tools confined to the currently selected mod directory."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from modkit.paths import safe_join
from modkit.permissions import Kind
from modkit.tools.registry import Tool, ToolContext, ToolResult


STRING = {"type": "string"}
NON_NEG_INT = {"type": "integer", "minimum": 0}
POS_INT = {"type": "integer", "minimum": 1}


def _require_mod(ctx: ToolContext) -> Path:
    if ctx.mod_root is None:
        raise ValueError(
            "no mod is selected. Create one with `modkit new` or pass --mod <id>"
        )
    return ctx.mod_root


def _list_files(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    root = _require_mod(ctx)
    subdir = args.get("path", "")
    base = safe_join(root, subdir) if subdir else root
    if not base.exists():
        return ToolResult(ok=False, error=f"path not found: {subdir or '.'}")
    files: list[str] = []
    if base.is_file():
        files.append(base.relative_to(root).as_posix())
    else:
        for dirpath, _dirnames, filenames in os.walk(base):
            for name in filenames:
                rel = Path(dirpath, name).relative_to(root).as_posix()
                files.append(rel)
    files.sort()
    return ToolResult(ok=True, data={"files": files, "count": len(files)})


def _read_file(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    root = _require_mod(ctx)
    path = safe_join(root, args.get("path", ""))
    if not path.exists():
        return ToolResult(ok=False, error=f"file not found: {args.get('path')}")
    if not path.is_file():
        return ToolResult(ok=False, error=f"not a regular file: {args.get('path')}")
    raw = path.read_bytes()
    text = raw.decode("utf-8", errors="replace")
    return ToolResult(
        ok=True,
        content=text,
        data={
            "path": args.get("path"),
            "bytes": path.stat().st_size,
        },
    )


def _write_file(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    root = _require_mod(ctx)
    path = safe_join(root, args.get("path", ""))
    path.parent.mkdir(parents=True, exist_ok=True)
    content = args.get("content", "")
    if not isinstance(content, str):
        content = str(content)
    path.write_text(content, encoding="utf-8")
    return ToolResult(
        ok=True,
        data={"path": args.get("path"), "bytes": path.stat().st_size},
    )


def _edit_file(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    root = _require_mod(ctx)
    rel = args.get("path", "")
    old = args.get("old", "")
    new = args.get("new", "")
    replace_all = bool(args.get("replace_all", False))

    if not isinstance(old, str) or old == "":
        return ToolResult(ok=False, error="'old' must be a non-empty string")
    if not isinstance(new, str):
        return ToolResult(ok=False, error="'new' must be a string")

    path = safe_join(root, rel)
    if not path.exists():
        return ToolResult(ok=False, error=f"file not found: {rel}")
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count == 0:
        return ToolResult(ok=False, error="'old' substring not found in file")
    if count > 1 and not replace_all:
        return ToolResult(
            ok=False,
            error=(
                f"'old' substring matches {count} places. Pass replace_all=true "
                "or provide more context to make it unique."
            ),
        )
    if replace_all:
        updated = text.replace(old, new)
    else:
        updated = text.replace(old, new, 1)
    path.write_text(updated, encoding="utf-8")
    return ToolResult(
        ok=True,
        data={
            "path": rel,
            "replaced": count if replace_all else 1,
            "bytes": path.stat().st_size,
        },
    )


def _delete_file(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    root = _require_mod(ctx)
    rel = args.get("path", "")
    path = safe_join(root, rel)
    if not path.exists():
        return ToolResult(ok=False, error=f"file not found: {rel}")
    if path.is_dir():
        return ToolResult(ok=False, error=f"refusing to delete directory: {rel}")
    path.unlink()
    return ToolResult(ok=True, data={"path": rel})


def _append_file(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    """Append text to a UTF-8 file inside the selected mod. Creates the
    file and parents if missing. Useful for building up large generated
    files (data/*.json, scripts/*.js) without rewriting the whole file
    on every chunk."""
    root = _require_mod(ctx)
    rel = args.get("path", "")
    path = safe_join(root, rel)
    content = args.get("content", "")
    if not isinstance(content, str):
        content = str(content)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(content)
    return ToolResult(
        ok=True,
        data={"path": rel, "bytes": path.stat().st_size},
    )


def _grep(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    root = _require_mod(ctx)
    import re

    pattern = args.get("pattern", "")
    if not pattern:
        return ToolResult(ok=False, error="'pattern' is required")
    try:
        regex = re.compile(pattern)
    except re.error as exc:
        return ToolResult(ok=False, error=f"invalid regex: {exc}")
    glob_filter = args.get("path_glob")
    matches: list[dict[str, Any]] = []
    for dirpath, _, filenames in os.walk(root):
        for name in filenames:
            file_path = Path(dirpath, name)
            rel = file_path.relative_to(root).as_posix()
            if glob_filter and not _path_matches(rel, glob_filter):
                continue
            try:
                lines = file_path.read_text(encoding="utf-8").splitlines()
            except (OSError, UnicodeDecodeError):
                continue
            for line_no, line in enumerate(lines, 1):
                if regex.search(line):
                    matches.append(
                        {
                            "path": rel,
                            "line": line_no,
                            "text": line[:300],
                        }
                    )
    return ToolResult(
        ok=True,
        data={"matches": matches, "count": len(matches)},
    )


def _path_matches(rel: str, glob: str) -> bool:
    import fnmatch

    return fnmatch.fnmatch(rel, glob) or fnmatch.fnmatch(os.path.basename(rel), glob)


def build_fs_tools() -> list[Tool]:
    return [
        Tool(
            name="list_files",
            description="List files inside the selected mod directory. "
            "Optional 'path' to scope to a subdirectory.",
            parameters={
                "type": "object",
                "properties": {"path": STRING},
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_list_files,
        ),
        Tool(
            name="read_file",
            description="Read a UTF-8 text file inside the selected mod directory. "
            "Returns the full file with no size cap — it's up to the caller (and "
            "the LLM's max_tokens) to decide how much to actually consume.",
            parameters={
                "type": "object",
                "properties": {"path": STRING},
                "required": ["path"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_read_file,
        ),
        Tool(
            name="write_file",
            description="Create or fully overwrite a UTF-8 file inside the selected mod directory.",
            parameters={
                "type": "object",
                "properties": {"path": STRING, "content": STRING},
                "required": ["path", "content"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_write_file,
        ),
        Tool(
            name="edit_file",
            description=(
                "Replace exact substring 'old' with 'new' inside a file. "
                "Fails if 'old' appears multiple times unless replace_all=true. "
                "Use this for surgical edits — preferred over write_file when "
                "you only want to change part of a file."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": STRING,
                    "old": STRING,
                    "new": STRING,
                    "replace_all": {"type": "boolean"},
                },
                "required": ["path", "old", "new"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_edit_file,
        ),
        Tool(
            name="delete_file",
            description="Delete a file inside the selected mod directory.",
            parameters={
                "type": "object",
                "properties": {"path": STRING},
                "required": ["path"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_delete_file,
        ),
        Tool(
            name="append_file",
            description=(
                "Append UTF-8 text to a file inside the selected mod. Creates "
                "parent directories if missing. Use for building up large files "
                "in chunks — e.g. emitting one JSON object at a time."
            ),
            parameters={
                "type": "object",
                "properties": {"path": STRING, "content": STRING},
                "required": ["path", "content"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_append_file,
        ),
        Tool(
            name="grep",
            description=(
                "Search files inside the selected mod for a regular expression. "
                "Optional path_glob (fnmatch syntax, e.g. '*.json' or 'data/*.json'). "
                "Returns every match with no cap."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "pattern": STRING,
                    "path_glob": STRING,
                },
                "required": ["pattern"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_grep,
        ),
    ]
