"""Root-aware transfer/edit tools for the agent.

These tools let the model read from the active mod, all mods, the local
engine source checkout, or an explicitly supplied project root, while
keeping writes inside controlled targets.
"""

from __future__ import annotations

import ast
import difflib
import fnmatch
import hashlib
import json
import re
import shutil
import time
import uuid
import zipfile
from pathlib import Path
from typing import Any

from modkit import code_repo
from modkit.ast_utils import find_unused_imports as find_unused_imports_in_source
from modkit.ast_utils import iter_symbols, materialise_text, replace_name_in_tree
from modkit.paths import safe_join
from modkit.permissions import Kind
from modkit.tools.registry import Tool, ToolContext, ToolResult


STRING = {"type": "string"}
BOOL = {"type": "boolean"}
POS_INT = {"type": "integer", "minimum": 1}
NON_NEG_INT = {"type": "integer", "minimum": 0}

READ_SOURCES = {"active_mod", "mods_root", "engine_source", "project"}
WRITE_TARGETS = {"active_mod", "mods_root", "scratch"}
TEXT_MODES = {"append", "prepend", "at_line", "before_marker", "after_marker", "replace_file"}
INTERNAL_DIRS = {".backups", ".agent_scratch", ".chats"}
JSON_CONFLICT_POLICIES = {"error", "replace", "merge"}
TREE_SKIP_DIRS = INTERNAL_DIRS | {".git", "__pycache__"}
HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _is_binary(data: bytes) -> bool:
    if b"\x00" in data:
        return True
    if not data:
        return False
    sample = data[:4096]
    text_like = sum(1 for b in sample if b in b"\n\r\t" or 32 <= b <= 126 or b >= 128)
    return text_like / len(sample) < 0.75


def _lang(path: str) -> str:
    ext = Path(path).suffix.lower().lstrip(".")
    return {
        "js": "javascript",
        "mjs": "javascript",
        "cjs": "javascript",
        "ts": "typescript",
        "py": "python",
        "json": "json",
        "md": "markdown",
        "txt": "text",
        "cpp": "cpp",
        "cc": "cpp",
        "cxx": "cpp",
        "h": "cpp",
        "hpp": "cpp",
    }.get(ext, ext or "unknown")


def _require_mod(ctx: ToolContext) -> Path:
    if ctx.mod_root is None:
        raise ValueError("no mod is selected")
    return ctx.mod_root


def _project_root(ctx: ToolContext) -> Path:
    raw = ctx.extra.get("project_root")
    if not raw:
        raise ValueError("project source root is not configured in ctx.extra['project_root']")
    return Path(raw)


def _read_disk(root: Path, rel_path: str) -> tuple[bytes, dict[str, Any]]:
    path = safe_join(root, rel_path)
    if not path.exists():
        raise FileNotFoundError(f"file not found: {rel_path}")
    if not path.is_file():
        raise ValueError(f"not a regular file: {rel_path}")
    data = path.read_bytes()
    return data, {"path": rel_path, "absolute_path": str(path), "bytes": len(data)}


def _read_source_bytes(ctx: ToolContext, source: str, rel_path: str) -> tuple[bytes, dict[str, Any]]:
    source = source or "active_mod"
    if source not in READ_SOURCES:
        raise ValueError(f"unknown source '{source}'. Allowed: {', '.join(sorted(READ_SOURCES))}")
    if source == "active_mod":
        data, meta = _read_disk(_require_mod(ctx), rel_path)
    elif source == "mods_root":
        data, meta = _read_disk(ctx.mods_root, rel_path)
    elif source == "project":
        data, meta = _read_disk(_project_root(ctx), rel_path)
    else:
        repo = code_repo.default()
        if not repo.loaded:
            repo.ensure_loaded()
        data = repo.get_file(rel_path)
        if data is None:
            raise FileNotFoundError(f"file not found in engine source: {rel_path}")
        meta = {"path": rel_path, "absolute_path": str(repo.source_dir / rel_path), "bytes": len(data)}
    meta.update({"source": source, "hash": _sha(data), "language": _lang(rel_path)})
    return data, meta


def _source_root(ctx: ToolContext, source: str) -> Path:
    source = source or "active_mod"
    if source not in READ_SOURCES:
        raise ValueError(f"unknown source '{source}'. Allowed: {', '.join(sorted(READ_SOURCES))}")
    if source == "active_mod":
        return _require_mod(ctx)
    if source == "mods_root":
        return ctx.mods_root
    if source == "project":
        return _project_root(ctx)
    repo = code_repo.default()
    if not repo.loaded:
        repo.ensure_loaded()
    return repo.source_dir


def _read_source_text(ctx: ToolContext, source: str, rel_path: str) -> tuple[str, dict[str, Any]]:
    data, meta = _read_source_bytes(ctx, source, rel_path)
    if _is_binary(data):
        raise ValueError(f"binary file cannot be used as text: {source}:{rel_path}")
    text = data.decode("utf-8", errors="replace")
    meta["lines"] = len(text.splitlines())
    return text, meta


def _target_path(ctx: ToolContext, target: str, rel_path: str) -> tuple[Path, str]:
    target = target or "active_mod"
    if target not in WRITE_TARGETS:
        raise ValueError(f"unknown target '{target}'. Allowed: {', '.join(sorted(WRITE_TARGETS))}")
    if target == "active_mod":
        root = _require_mod(ctx)
    elif target == "mods_root":
        root = ctx.mods_root
    else:
        root = ctx.mods_root / ".agent_scratch"
        root.mkdir(parents=True, exist_ok=True)
    return safe_join(root, rel_path), target


def _diff(old: str, new: str, path: str) -> str:
    return "".join(
        difflib.unified_diff(
            old.splitlines(keepends=True),
            new.splitlines(keepends=True),
            fromfile=f"a/{path}",
            tofile=f"b/{path}",
        )
    )


def _write_text_result(
    path: Path,
    rel_path: str,
    target: str,
    old_text: str,
    new_text: str,
    *,
    dry_run: bool,
) -> ToolResult:
    before = path.read_bytes() if path.exists() else b""
    after = new_text.encode("utf-8")
    diff = _diff(old_text, new_text, rel_path)
    if not dry_run:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(new_text, encoding="utf-8")
    return ToolResult(
        ok=True,
        data={
            "path": rel_path,
            "target": target,
            "dry_run": dry_run,
            "before_hash": _sha(before),
            "after_hash": _sha(after),
            "bytes": len(after),
            "changed_lines": sum(1 for line in diff.splitlines() if line.startswith(("+", "-")) and not line.startswith(("+++", "---"))),
            "diff": diff,
        },
    )


def _read_json_text(text: str, *, label: str) -> Any:
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid json in {label}: line {exc.lineno} column {exc.colno}: {exc.msg}") from exc


def _json_pointer_parts(pointer: str) -> list[str]:
    if pointer == "":
        return []
    if not pointer.startswith("/"):
        raise ValueError("JSON pointer must be empty or start with '/'")
    parts: list[str] = []
    for raw in pointer.split("/")[1:]:
        parts.append(raw.replace("~1", "/").replace("~0", "~"))
    return parts


def _json_pointer_get(doc: Any, pointer: str) -> Any:
    current = doc
    for part in _json_pointer_parts(pointer):
        if isinstance(current, dict):
            if part not in current:
                raise ValueError(f"source pointer not found: {pointer}")
            current = current[part]
            continue
        if isinstance(current, list):
            try:
                index = int(part)
            except ValueError as exc:
                raise ValueError(f"array pointer segment must be an integer: {part}") from exc
            if index < 0 or index >= len(current):
                raise ValueError(f"source pointer not found: {pointer}")
            current = current[index]
            continue
        raise ValueError(f"source pointer enters scalar value at segment '{part}'")
    return current


def _json_pointer_parent(doc: Any, pointer: str) -> tuple[Any, str | None]:
    parts = _json_pointer_parts(pointer)
    if not parts:
        return None, None
    current = doc
    for part in parts[:-1]:
        if isinstance(current, dict):
            child = current.get(part)
            if child is None:
                child = {}
                current[part] = child
            if not isinstance(child, (dict, list)):
                raise ValueError(f"target pointer enters scalar value at segment '{part}'")
            current = child
            continue
        if isinstance(current, list):
            try:
                index = int(part)
            except ValueError as exc:
                raise ValueError(f"array pointer segment must be an integer: {part}") from exc
            if index < 0 or index >= len(current):
                raise ValueError(f"target pointer index out of bounds: {part}")
            current = current[index]
            continue
        raise ValueError(f"target pointer enters scalar value at segment '{part}'")
    return current, parts[-1]


def _json_target_exists(parent: Any, key: str | None) -> bool:
    if key is None:
        return True
    if isinstance(parent, dict):
        return key in parent
    if isinstance(parent, list):
        if key == "-":
            return False
        try:
            index = int(key)
        except ValueError:
            return False
        return 0 <= index < len(parent)
    return False


def _deep_merge_json(old: Any, new: Any) -> Any:
    if not isinstance(old, dict) or not isinstance(new, dict):
        raise ValueError("on_conflict=merge requires both existing and copied values to be JSON objects")
    merged = dict(old)
    for key, value in new.items():
        if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key] = _deep_merge_json(merged[key], value)
        else:
            merged[key] = value
    return merged


def _json_pointer_set(doc: Any, pointer: str, value: Any, *, on_conflict: str) -> tuple[Any, bool]:
    if on_conflict not in JSON_CONFLICT_POLICIES:
        raise ValueError(f"unknown on_conflict '{on_conflict}'. Allowed: {', '.join(sorted(JSON_CONFLICT_POLICIES))}")
    if pointer == "":
        if on_conflict == "error":
            raise ValueError("target pointer already exists: ")
        if on_conflict == "merge":
            return _deep_merge_json(doc, value), True
        return value, True

    parent, key = _json_pointer_parent(doc, pointer)
    exists = _json_target_exists(parent, key)
    if exists and on_conflict == "error":
        raise ValueError(f"target pointer already exists: {pointer}")

    if isinstance(parent, dict):
        assert key is not None
        if exists and on_conflict == "merge":
            parent[key] = _deep_merge_json(parent[key], value)
        else:
            parent[key] = value
        return doc, exists

    if isinstance(parent, list):
        assert key is not None
        if key == "-":
            parent.append(value)
            return doc, False
        try:
            index = int(key)
        except ValueError as exc:
            raise ValueError(f"array pointer segment must be an integer or '-': {key}") from exc
        if index < 0 or index > len(parent):
            raise ValueError(f"target pointer index out of bounds: {key}")
        if index == len(parent):
            parent.append(value)
            return doc, False
        if exists and on_conflict == "merge":
            parent[index] = _deep_merge_json(parent[index], value)
        else:
            parent[index] = value
        return doc, exists

    raise ValueError("target pointer parent is not a JSON object or array")


def _json_dump(payload: Any) -> str:
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"


def _string_list(value: Any, *, name: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"'{name}' must be an array of strings")
    return [str(item).replace("\\", "/") for item in value if str(item).strip()]


def _matches_any(rel: str, patterns: list[str]) -> bool:
    name = Path(rel).name
    return any(fnmatch.fnmatch(rel, pattern) or fnmatch.fnmatch(name, pattern) for pattern in patterns)


def _tree_entries(root: Path, include_globs: list[str], exclude_globs: list[str]) -> list[Path]:
    entries: list[Path] = []
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root).as_posix()
        parts = set(path.relative_to(root).parts)
        if parts & TREE_SKIP_DIRS:
            continue
        if path.is_dir():
            continue
        if include_globs and not _matches_any(rel, include_globs):
            continue
        if exclude_globs and _matches_any(rel, exclude_globs):
            continue
        entries.append(path)
    return entries


def _patch_path(raw: str) -> str:
    token = raw.strip().split("\t", 1)[0].split(" ", 1)[0]
    if token == "/dev/null":
        return token
    if token.startswith("a/") or token.startswith("b/"):
        token = token[2:]
    if not token:
        raise ValueError("patch contains an empty file path")
    return token


def _parse_unified_patch(patch: str) -> list[dict[str, Any]]:
    lines = patch.splitlines(keepends=True)
    files: list[dict[str, Any]] = []
    i = 0
    while i < len(lines):
        if not lines[i].startswith("--- "):
            i += 1
            continue
        old_path = _patch_path(lines[i][4:])
        i += 1
        if i >= len(lines) or not lines[i].startswith("+++ "):
            raise ValueError("invalid unified diff: expected +++ after ---")
        new_path = _patch_path(lines[i][4:])
        i += 1
        hunks: list[dict[str, Any]] = []
        while i < len(lines) and not lines[i].startswith("--- "):
            header = lines[i]
            match = HUNK_RE.match(header)
            if not match:
                if header.strip():
                    raise ValueError(f"invalid unified diff hunk header: {header.strip()}")
                i += 1
                continue
            old_start = int(match.group(1))
            old_count = int(match.group(2) or "1")
            i += 1
            body: list[str] = []
            while i < len(lines) and not lines[i].startswith("@@ ") and not lines[i].startswith("--- "):
                body.append(lines[i])
                i += 1
            hunks.append({"old_start": old_start, "old_count": old_count, "body": body})
        files.append({"old_path": old_path, "new_path": new_path, "hunks": hunks})
    if not files:
        raise ValueError("patch does not contain any file diffs")
    return files


def _apply_hunks(old_text: str, hunks: list[dict[str, Any]], rel_path: str) -> str:
    old_lines = old_text.splitlines(keepends=True)
    out: list[str] = []
    cursor = 0
    for hunk in hunks:
        old_start = int(hunk["old_start"])
        start_index = 0 if old_start == 0 else old_start - 1
        if start_index < cursor or start_index > len(old_lines):
            raise ValueError(f"hunk for {rel_path} is outside file bounds")
        out.extend(old_lines[cursor:start_index])
        cursor = start_index
        for raw in hunk["body"]:
            if raw.startswith("\\"):
                continue
            if not raw:
                continue
            prefix = raw[0]
            text = raw[1:]
            if prefix == " ":
                if cursor >= len(old_lines) or old_lines[cursor] != text:
                    raise ValueError(f"patch context mismatch in {rel_path}")
                out.append(text)
                cursor += 1
            elif prefix == "-":
                if cursor >= len(old_lines) or old_lines[cursor] != text:
                    raise ValueError(f"patch removal mismatch in {rel_path}")
                cursor += 1
            elif prefix == "+":
                out.append(text)
            else:
                raise ValueError(f"invalid patch line prefix '{prefix}' in {rel_path}")
    out.extend(old_lines[cursor:])
    return "".join(out)


def _insert(old: str, addition: str, mode: str, *, marker: str | None = None, line: int | None = None) -> str:
    if mode not in TEXT_MODES:
        raise ValueError(f"unknown insert mode '{mode}'. Allowed: {', '.join(sorted(TEXT_MODES))}")
    if mode == "append":
        return old + addition
    if mode == "prepend":
        return addition + old
    if mode == "replace_file":
        return addition
    if mode == "at_line":
        if line is None or line < 1:
            raise ValueError("'line' must be >= 1 for mode=at_line")
        lines = old.splitlines(keepends=True)
        if line > len(lines) + 1:
            raise ValueError(f"line {line} is outside file bounds 1..{len(lines) + 1}")
        lines.insert(line - 1, addition)
        return "".join(lines)
    if not marker:
        raise ValueError("'marker' is required for marker-based insert modes")
    count = old.count(marker)
    if count == 0:
        raise ValueError("'marker' not found")
    if count > 1:
        raise ValueError(f"'marker' matches {count} places; provide a unique marker")
    idx = old.index(marker)
    if mode == "before_marker":
        insert_at = old.rfind("\n", 0, idx) + 1
    else:
        end = old.find("\n", idx)
        insert_at = len(old) if end == -1 else end + 1
    return old[:insert_at] + addition + old[insert_at:]


def _source_read_file(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    source = str(args.get("source") or "active_mod")
    path = str(args.get("path") or "")
    if not path:
        return ToolResult(ok=False, error="'path' is required")
    data, meta = _read_source_bytes(ctx, source, path)
    if _is_binary(data):
        return ToolResult(ok=True, data={**meta, "binary": True})
    max_bytes = args.get("max_bytes")
    text = data.decode("utf-8", errors="replace")
    if max_bytes is not None:
        text = data[: int(max_bytes)].decode("utf-8", errors="replace")
        meta["truncated"] = len(data) > int(max_bytes)
    return ToolResult(ok=True, content=text, data={**meta, "binary": False})


def _source_read_range(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    source = str(args.get("source") or "active_mod")
    path = str(args.get("path") or "")
    start = int(args.get("start_line") or 0)
    end = int(args.get("end_line") or 0)
    context = int(args.get("context_lines") or 0)
    if not path:
        return ToolResult(ok=False, error="'path' is required")
    if start < 1 or end < start:
        return ToolResult(ok=False, error="'start_line' must be >= 1 and 'end_line' must be >= start_line")
    text, meta = _read_source_text(ctx, source, path)
    lines = text.splitlines()
    if end > len(lines):
        return ToolResult(ok=False, error=f"line range {start}-{end} exceeds file length {len(lines)}")
    returned_start = max(1, start - context)
    returned_end = min(len(lines), end + context)
    selected = "\n".join(lines[returned_start - 1 : returned_end])
    return ToolResult(
        ok=True,
        content=selected,
        data={
            **meta,
            "selected_start_line": start,
            "selected_end_line": end,
            "returned_start_line": returned_start,
            "returned_end_line": returned_end,
        },
    )


def _copy_file(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    source = str(args.get("source") or "active_mod")
    source_path = str(args.get("source_path") or "")
    target_path_arg = str(args.get("target_path") or "")
    target = str(args.get("target") or "active_mod")
    overwrite = bool(args.get("overwrite", False))
    dry_run = bool(args.get("dry_run", False))
    if not source_path or not target_path_arg:
        return ToolResult(ok=False, error="'source_path' and 'target_path' are required")
    data, source_meta = _read_source_bytes(ctx, source, source_path)
    target_path, target_name = _target_path(ctx, target, target_path_arg)
    if target_path.exists() and not overwrite:
        return ToolResult(ok=False, error=f"target already exists: {target_path_arg}")
    before = target_path.read_bytes() if target_path.exists() else b""
    if not dry_run:
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_bytes(data)
    return ToolResult(
        ok=True,
        data={
            "source": source_meta,
            "target": target_name,
            "target_path": target_path_arg,
            "dry_run": dry_run,
            "overwrite": overwrite,
            "binary": _is_binary(data),
            "bytes": len(data),
            "before_hash": _sha(before),
            "after_hash": _sha(data),
        },
    )


def _copy_tree(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    source = str(args.get("source") or "active_mod")
    source_path_arg = str(args.get("source_path") or "")
    target = str(args.get("target") or "active_mod")
    target_path_arg = str(args.get("target_path") or "")
    overwrite = bool(args.get("overwrite", False))
    dry_run = bool(args.get("dry_run", False))
    include_globs = _string_list(args.get("include_globs"), name="include_globs")
    exclude_globs = _string_list(args.get("exclude_globs"), name="exclude_globs")
    if not source_path_arg or not target_path_arg:
        return ToolResult(ok=False, error="'source_path' and 'target_path' are required")

    source_root = _source_root(ctx, source)
    source_dir = safe_join(source_root, source_path_arg)
    if not source_dir.exists():
        return ToolResult(ok=False, error=f"source directory not found: {source_path_arg}")
    if not source_dir.is_dir():
        return ToolResult(ok=False, error=f"source path is not a directory: {source_path_arg}")

    target_dir, target_name = _target_path(ctx, target, target_path_arg)
    entries = _tree_entries(source_dir, include_globs, exclude_globs)
    planned: list[str] = []
    collisions: list[str] = []
    total_bytes = 0
    for source_file in entries:
        rel = source_file.relative_to(source_dir).as_posix()
        planned.append(rel)
        total_bytes += source_file.stat().st_size
        target_file = safe_join(target_dir, rel)
        if target_file.exists() and not overwrite:
            collisions.append(rel)

    if collisions:
        return ToolResult(
            ok=False,
            error=f"target already exists for {len(collisions)} file(s); set overwrite=true",
            data={"collisions": collisions, "target_path": target_path_arg},
        )

    if not dry_run:
        for source_file in entries:
            rel = source_file.relative_to(source_dir).as_posix()
            target_file = safe_join(target_dir, rel)
            target_file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_file, target_file)

    return ToolResult(
        ok=True,
        data={
            "source": {"source": source, "path": source_path_arg, "absolute_path": str(source_dir)},
            "target": target_name,
            "target_path": target_path_arg,
            "dry_run": dry_run,
            "overwrite": overwrite,
            "files_copied": len(entries),
            "bytes": total_bytes,
            "files": planned,
            "include_globs": include_globs,
            "exclude_globs": exclude_globs,
        },
    )


def _copy_range(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    source = str(args.get("source") or "active_mod")
    source_path = str(args.get("source_path") or "")
    start = int(args.get("start_line") or 0)
    end = int(args.get("end_line") or 0)
    target_path_arg = str(args.get("target_path") or "")
    mode = str(args.get("insert_mode") or "append")
    target = str(args.get("target") or "active_mod")
    dry_run = bool(args.get("dry_run", False))
    if not source_path or not target_path_arg:
        return ToolResult(ok=False, error="'source_path' and 'target_path' are required")
    if start < 1 or end < start:
        return ToolResult(ok=False, error="'start_line' must be >= 1 and 'end_line' must be >= start_line")
    text, source_meta = _read_source_text(ctx, source, source_path)
    lines = text.splitlines()
    if end > len(lines):
        return ToolResult(ok=False, error=f"line range {start}-{end} exceeds file length {len(lines)}")
    addition = "\n".join(lines[start - 1 : end]) + "\n"
    target_path, target_name = _target_path(ctx, target, target_path_arg)
    old = target_path.read_text(encoding="utf-8") if target_path.exists() else ""
    new = _insert(old, addition, mode, marker=args.get("marker"), line=args.get("line"))
    result = _write_text_result(target_path, target_path_arg, target_name, old, new, dry_run=dry_run)
    result.data["source"] = source_meta
    result.data["copied_start_line"] = start
    result.data["copied_end_line"] = end
    return result


def _copy_json_value(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    source = str(args.get("source") or "active_mod")
    source_path = str(args.get("source_path") or "")
    source_pointer = str(args.get("source_pointer") or "")
    target = str(args.get("target") or "active_mod")
    target_path_arg = str(args.get("target_path") or "")
    target_pointer = str(args.get("target_pointer") or "")
    on_conflict = str(args.get("on_conflict") or "error")
    dry_run = bool(args.get("dry_run", False))

    if not source_path or not target_path_arg:
        return ToolResult(ok=False, error="'source_path' and 'target_path' are required")

    source_text, source_meta = _read_source_text(ctx, source, source_path)
    source_doc = _read_json_text(source_text, label=f"{source}:{source_path}")
    copied_value = _json_pointer_get(source_doc, source_pointer)

    target_path, target_name = _target_path(ctx, target, target_path_arg)
    if target_path.exists():
        old_text = target_path.read_text(encoding="utf-8")
        target_doc = _read_json_text(old_text, label=f"{target}:{target_path_arg}")
    else:
        old_text = ""
        target_doc = {}

    target_doc, existed = _json_pointer_set(
        target_doc,
        target_pointer,
        copied_value,
        on_conflict=on_conflict,
    )
    new_text = _json_dump(target_doc)
    result = _write_text_result(
        target_path,
        target_path_arg,
        target_name,
        old_text,
        new_text,
        dry_run=dry_run,
    )
    result.data.update(
        {
            "source": source_meta,
            "source_pointer": source_pointer,
            "target_pointer": target_pointer,
            "operation": "set",
            "on_conflict": on_conflict,
            "existed": existed,
        }
    )
    return result


def _insert_text(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    rel = str(args.get("target_path") or "")
    text = args.get("text")
    mode = str(args.get("mode") or "append")
    target = str(args.get("target") or "active_mod")
    dry_run = bool(args.get("dry_run", False))
    if not rel or text is None:
        return ToolResult(ok=False, error="'target_path' and 'text' are required")
    if not isinstance(text, str):
        text = str(text)
    path, target_name = _target_path(ctx, target, rel)
    old = path.read_text(encoding="utf-8") if path.exists() else ""
    new = _insert(old, text, mode, marker=args.get("marker"), line=args.get("line"))
    return _write_text_result(path, rel, target_name, old, new, dry_run=dry_run)


def _replace_exact(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    rel = str(args.get("target_path") or "")
    old_fragment = args.get("old")
    new_fragment = args.get("new")
    target = str(args.get("target") or "active_mod")
    replace_all = bool(args.get("replace_all", False))
    dry_run = bool(args.get("dry_run", False))
    if not rel or not isinstance(old_fragment, str) or old_fragment == "":
        return ToolResult(ok=False, error="'target_path' and non-empty 'old' are required")
    if not isinstance(new_fragment, str):
        return ToolResult(ok=False, error="'new' must be a string")
    path, target_name = _target_path(ctx, target, rel)
    if not path.exists():
        return ToolResult(ok=False, error=f"file not found: {rel}")
    old_text = path.read_text(encoding="utf-8")
    count = old_text.count(old_fragment)
    if count == 0:
        return ToolResult(ok=False, error="'old' substring not found")
    if count > 1 and not replace_all:
        return ToolResult(ok=False, error=f"'old' substring matches {count} places; set replace_all=true or provide more context")
    new_text = old_text.replace(old_fragment, new_fragment) if replace_all else old_text.replace(old_fragment, new_fragment, 1)
    result = _write_text_result(path, rel, target_name, old_text, new_text, dry_run=dry_run)
    result.data["replaced"] = count if replace_all else 1
    return result


def _apply_unified_patch(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    patch = args.get("patch")
    target = str(args.get("target") or "active_mod")
    dry_run = bool(args.get("dry_run", False))
    if not isinstance(patch, str) or not patch.strip():
        return ToolResult(ok=False, error="'patch' is required")

    file_patches = _parse_unified_patch(patch)
    prepared: list[tuple[Path, str, str, str, str]] = []
    combined_diff: list[str] = []
    for entry in file_patches:
        old_path = str(entry["old_path"])
        new_path = str(entry["new_path"])
        rel_path = new_path if new_path != "/dev/null" else old_path
        if rel_path == "/dev/null":
            return ToolResult(ok=False, error="patch cannot have both paths as /dev/null")
        target_path, target_name = _target_path(ctx, target, rel_path)
        old_text = target_path.read_text(encoding="utf-8") if target_path.exists() else ""
        if old_path != "/dev/null" and not target_path.exists():
            return ToolResult(ok=False, error=f"file not found: {rel_path}")
        new_text = "" if new_path == "/dev/null" else _apply_hunks(old_text, entry["hunks"], rel_path)
        prepared.append((target_path, rel_path, target_name, old_text, new_text))
        combined_diff.append(_diff(old_text, new_text, rel_path))

    if not dry_run:
        for path, _rel_path, _target_name, _old_text, new_text in prepared:
            if new_text == "":
                if path.exists():
                    path.unlink()
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(new_text, encoding="utf-8")

    changed = [
        {
            "path": rel_path,
            "target": target_name,
            "before_hash": _sha(old_text.encode("utf-8")),
            "after_hash": _sha(new_text.encode("utf-8")),
            "bytes": len(new_text.encode("utf-8")),
        }
        for _path, rel_path, target_name, old_text, new_text in prepared
    ]
    return ToolResult(
        ok=True,
        data={
            "target": target,
            "dry_run": dry_run,
            "files_changed": len(prepared),
            "files": changed,
            "diff": "".join(combined_diff),
        },
    )


def _move_path(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    source_path_arg = str(args.get("source_path") or "")
    target_path_arg = str(args.get("target_path") or "")
    target = str(args.get("target") or "active_mod")
    overwrite = bool(args.get("overwrite", False))
    dry_run = bool(args.get("dry_run", False))
    if not source_path_arg or not target_path_arg:
        return ToolResult(ok=False, error="'source_path' and 'target_path' are required")
    source_path, target_name = _target_path(ctx, target, source_path_arg)
    target_path, _ = _target_path(ctx, target, target_path_arg)
    if not source_path.exists():
        return ToolResult(ok=False, error=f"source path not found: {source_path_arg}")
    if target_path.exists() and not overwrite:
        return ToolResult(ok=False, error=f"target already exists: {target_path_arg}")
    if not dry_run:
        target_path.parent.mkdir(parents=True, exist_ok=True)
        if target_path.exists():
            if target_path.is_dir():
                shutil.rmtree(target_path)
            else:
                target_path.unlink()
        shutil.move(str(source_path), str(target_path))
    return ToolResult(ok=True, data={"source_path": source_path_arg, "target_path": target_path_arg, "target": target_name, "dry_run": dry_run})


def _delete_path(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    rel = str(args.get("target_path") or "")
    target = str(args.get("target") or "active_mod")
    recursive = bool(args.get("recursive", False))
    dry_run = bool(args.get("dry_run", False))
    if not rel:
        return ToolResult(ok=False, error="'target_path' is required")
    path, target_name = _target_path(ctx, target, rel)
    if not path.exists():
        return ToolResult(ok=False, error=f"path not found: {rel}")
    if path.is_dir() and not recursive:
        return ToolResult(ok=False, error=f"refusing to delete directory without recursive=true: {rel}")
    if not dry_run:
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()
    return ToolResult(ok=True, data={"target_path": rel, "target": target_name, "recursive": recursive, "dry_run": dry_run})


def _preview_diff(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    rel = str(args.get("target_path") or "")
    proposed = args.get("proposed_text")
    target = str(args.get("target") or "active_mod")
    if not rel or not isinstance(proposed, str):
        return ToolResult(ok=False, error="'target_path' and 'proposed_text' are required")
    path, target_name = _target_path(ctx, target, rel)
    old = path.read_text(encoding="utf-8") if path.exists() else ""
    return ToolResult(ok=True, data={"target_path": rel, "target": target_name, "diff": _diff(old, proposed, rel)})


def _agent_clipboard(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    action = str(args.get("action") or "list")
    slot = str(args.get("slot") or "default")
    store = ctx.extra.setdefault("agent_clipboard", {})
    if action == "put":
        content = args.get("content")
        if not isinstance(content, str):
            return ToolResult(ok=False, error="'content' must be a string for action=put")
        store[slot] = content
        return ToolResult(ok=True, data={"slot": slot, "bytes": len(content.encode("utf-8"))})
    if action == "get":
        if slot not in store:
            return ToolResult(ok=False, error=f"clipboard slot not found: {slot}")
        return ToolResult(ok=True, content=store[slot], data={"slot": slot})
    if action == "list":
        return ToolResult(ok=True, data={"slots": sorted(store), "count": len(store)})
    if action == "clear":
        if args.get("slot"):
            store.pop(slot, None)
        else:
            store.clear()
        return ToolResult(ok=True, data={"cleared": slot if args.get("slot") else "all"})
    return ToolResult(ok=False, error=f"unknown clipboard action: {action}")


def _source_outline(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    source = str(args.get("source") or "active_mod")
    path = str(args.get("path") or "")
    if not path:
        return ToolResult(ok=False, error="'path' is required")
    if source == "engine_source":
        repo = code_repo.default()
        if not repo.loaded:
            repo.ensure_loaded()
        entries = repo.outline(path)
    else:
        text, _meta = _read_source_text(ctx, source, path)
        entries = code_repo._outline_file(path, text)
    return ToolResult(ok=True, data={"source": source, "path": path, "entries": entries, "count": len(entries)})


def _copy_symbol(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    source = str(args.get("source") or "active_mod")
    path = str(args.get("path") or "")
    symbol = str(args.get("symbol") or "")
    target_path_arg = str(args.get("target_path") or "")
    mode = str(args.get("insert_mode") or "append")
    target = str(args.get("target") or "active_mod")
    dry_run = bool(args.get("dry_run", False))
    kind = args.get("kind")
    if not path or not symbol or not target_path_arg:
        return ToolResult(ok=False, error="'path', 'symbol', and 'target_path' are required")
    text, source_meta = _read_source_text(ctx, source, path)
    try:
        copied, candidates = _extract_symbol_text(path, text, symbol, kind=str(kind) if kind else None)
    except SyntaxError as exc:
        return ToolResult(ok=False, error=f"syntax error while parsing {path}: {exc.msg}")
    if candidates is not None:
        return ToolResult(ok=False, error=f"symbol '{symbol}' is ambiguous", data={"candidates": candidates})
    if copied is None:
        return ToolResult(ok=False, error=f"symbol '{symbol}' not found")
    if args.get("rename_to"):
        copied = _rename_symbol_header(copied, symbol, str(args["rename_to"]))
    addition = copied.rstrip("\n") + "\n"
    target_path, target_name = _target_path(ctx, target, target_path_arg)
    old = target_path.read_text(encoding="utf-8") if target_path.exists() else ""
    new = _insert(old, addition, mode, marker=args.get("marker"), line=args.get("line"))
    result = _write_text_result(target_path, target_path_arg, target_name, old, new, dry_run=dry_run)
    result.data["source"] = source_meta
    result.data["symbol"] = symbol
    return result


def _extract_symbol_text(path: str, text: str, symbol: str, *, kind: str | None) -> tuple[str | None, list[dict[str, Any]] | None]:
    ext = Path(path).suffix.lower()
    if ext == ".py":
        tree = ast.parse(text)
        spans = []
        for span in iter_symbols(tree, name=symbol):
            exposed_kind = "method" if span.nested_in and span.kind in {"function", "asyncfunction"} else span.kind
            if kind and kind != exposed_kind and kind != span.kind:
                continue
            spans.append(materialise_text(span, text.splitlines()))
        if not spans:
            return None, None
        if len(spans) > 1:
            return None, [
                {
                    **span.to_dict(),
                    "qualified_name": ".".join((*span.nested_in, span.name)),
                    "kind": "method" if span.nested_in and span.kind in {"function", "asyncfunction"} else span.kind,
                }
                for span in spans
            ]
        return spans[0].text, None

    entries = [
        entry
        for entry in code_repo._outline_file(path, text)
        if entry.get("name") == symbol and (not kind or entry.get("kind") == kind)
    ]
    if not entries:
        return None, None
    if len(entries) > 1:
        return None, entries
    lines = text.splitlines()
    start = int(entries[0]["line"])
    end = _brace_aware_end(lines, start)
    return "\n".join(lines[start - 1 : end]), None


def _brace_aware_end(lines: list[str], start_line: int) -> int:
    depth = 0
    seen_open = False
    for idx in range(start_line - 1, len(lines)):
        line = lines[idx]
        depth += line.count("{") - line.count("}")
        seen_open = seen_open or "{" in line
        if seen_open and depth <= 0:
            return idx + 1
        if not seen_open and idx > start_line - 1 and line and not line.startswith((" ", "\t")):
            return idx
    return len(lines)


def _rename_symbol_header(text: str, old: str, new: str) -> str:
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if old in line:
            lines[i] = line.replace(old, new, 1)
            break
    return "\n".join(lines)


def _checkpoint_dir(ctx: ToolContext) -> Path:
    path = ctx.mods_root / ".backups" / "agent_checkpoints"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _clean_id(raw: str) -> str:
    cleaned = "".join(ch for ch in raw if ch.isalnum() or ch in {"-", "_"})
    if not cleaned:
        raise ValueError("checkpoint id is empty")
    return cleaned


def _iter_checkpoint_files(mod_root: Path) -> list[Path]:
    files: list[Path] = []
    for path in mod_root.rglob("*"):
        rel = path.relative_to(mod_root)
        if any(part in INTERNAL_DIRS for part in rel.parts):
            continue
        if path.is_file():
            files.append(path)
    return sorted(files, key=lambda p: p.relative_to(mod_root).as_posix())


def _snapshot_manifest(mod_root: Path) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for file in _iter_checkpoint_files(mod_root):
        data = file.read_bytes()
        rel = file.relative_to(mod_root).as_posix()
        out[rel] = {"hash": _sha(data), "bytes": len(data)}
    return out


def _checkpoint_paths(ctx: ToolContext, checkpoint_id: str) -> tuple[Path, Path]:
    checkpoint_id = _clean_id(checkpoint_id)
    base = _checkpoint_dir(ctx)
    return base / f"{checkpoint_id}.zip", base / f"{checkpoint_id}.json"


def _read_checkpoint(ctx: ToolContext, checkpoint_id: str) -> tuple[dict[str, Any], Path]:
    zip_path, manifest_path = _checkpoint_paths(ctx, checkpoint_id)
    if not zip_path.exists() or not manifest_path.exists():
        raise FileNotFoundError(f"checkpoint not found: {checkpoint_id}")
    return json.loads(manifest_path.read_text(encoding="utf-8")), zip_path


def _checkpoint_create(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    mod_root = _require_mod(ctx)
    label = str(args.get("label") or "checkpoint").strip() or "checkpoint"
    checkpoint_id = f"{int(time.time())}_{uuid.uuid4().hex[:8]}"
    zip_path, manifest_path = _checkpoint_paths(ctx, checkpoint_id)
    files = _iter_checkpoint_files(mod_root)
    manifest = {
        "id": checkpoint_id,
        "label": label,
        "mod_id": mod_root.name,
        "created_at": int(time.time()),
        "files": {},
    }
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file in files:
            data = file.read_bytes()
            rel = file.relative_to(mod_root).as_posix()
            zf.writestr(rel, data)
            manifest["files"][rel] = {"hash": _sha(data), "bytes": len(data)}
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return ToolResult(
        ok=True,
        data={
            "id": checkpoint_id,
            "label": label,
            "zip_path": str(zip_path),
            "manifest_path": str(manifest_path),
            "files": sorted(manifest["files"]),
            "count": len(manifest["files"]),
        },
    )


def _checkpoint_list(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    entries: list[dict[str, Any]] = []
    for manifest_path in sorted(_checkpoint_dir(ctx).glob("*.json")):
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        entries.append(
            {
                "id": manifest.get("id"),
                "label": manifest.get("label"),
                "mod_id": manifest.get("mod_id"),
                "created_at": manifest.get("created_at"),
                "count": len(manifest.get("files", {})),
            }
        )
    return ToolResult(ok=True, data={"checkpoints": entries, "count": len(entries)})


def _checkpoint_diff(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    checkpoint_id = str(args.get("id") or "")
    if not checkpoint_id:
        return ToolResult(ok=False, error="'id' is required")
    manifest, _zip_path = _read_checkpoint(ctx, checkpoint_id)
    mod_root = _require_mod(ctx)
    before = manifest.get("files", {})
    after = _snapshot_manifest(mod_root)
    before_keys = set(before)
    after_keys = set(after)
    modified = sorted(
        rel for rel in before_keys & after_keys if before[rel].get("hash") != after[rel].get("hash")
    )
    return ToolResult(
        ok=True,
        data={
            "id": checkpoint_id,
            "added": sorted(after_keys - before_keys),
            "removed": sorted(before_keys - after_keys),
            "modified": modified,
        },
    )


def _clear_mod_for_restore(mod_root: Path) -> None:
    for file in _iter_checkpoint_files(mod_root):
        file.unlink()
    for path in sorted(mod_root.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        rel = path.relative_to(mod_root)
        if any(part in INTERNAL_DIRS for part in rel.parts):
            continue
        if path.is_dir():
            try:
                path.rmdir()
            except OSError:
                pass


def _checkpoint_restore(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    checkpoint_id = str(args.get("id") or "")
    dry_run = bool(args.get("dry_run", False))
    if not checkpoint_id:
        return ToolResult(ok=False, error="'id' is required")
    manifest, zip_path = _read_checkpoint(ctx, checkpoint_id)
    diff = _checkpoint_diff({"id": checkpoint_id}, ctx)
    if not diff.ok:
        return diff
    if not dry_run:
        mod_root = _require_mod(ctx)
        _clear_mod_for_restore(mod_root)
        with zipfile.ZipFile(zip_path, "r") as zf:
            for member in zf.infolist():
                if member.is_dir() or member.filename.startswith(("/", "../")) or "/../" in ("/" + member.filename):
                    continue
                target = safe_join(mod_root, member.filename)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(zf.read(member))
    return ToolResult(
        ok=True,
        data={
            "id": checkpoint_id,
            "label": manifest.get("label"),
            "dry_run": dry_run,
            "diff": diff.data,
            "restored_files": sorted(manifest.get("files", {})),
        },
    )


# ── find_symbol ───────────────────────────────────────────────────────


def _find_symbol(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    """Search for symbols by name/glob pattern across source files."""
    source = str(args.get("source") or "active_mod")
    pattern = str(args.get("pattern") or "")
    kind = args.get("kind")
    path_glob = str(args.get("path_glob") or "**/*")
    max_results = int(args.get("max_results") or 50)

    if not pattern:
        return ToolResult(ok=False, error="'pattern' is required")
    if max_results < 1:
        max_results = 50

    root = _source_root(ctx, source)
    if not root.exists():
        return ToolResult(ok=False, error=f"source root not found: {source}")

    # Normalise path_glob so fnmatch handles it correctly.
    # '**/*' should match everything; fnmatch doesn't grok '**',
    # so we treat it as a simple '*' fallback.
    effective_path_glob = path_glob
    if effective_path_glob in {"**/*", "**", "**/*.*"}:
        effective_path_glob = "*"

    results: list[dict[str, Any]] = []
    for file_path in sorted(root.rglob("*")):
        if not file_path.is_file():
            continue
        rel = file_path.relative_to(root).as_posix()
        if not fnmatch.fnmatch(rel, effective_path_glob) and not fnmatch.fnmatch(Path(rel).name, effective_path_glob):
            continue
        parts = set(file_path.relative_to(root).parts)
        if parts & TREE_SKIP_DIRS:
            continue

        ext = file_path.suffix.lower()
        if ext not in {".py", ".js", ".mjs", ".cjs", ".ts", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".json", ".md"}:
            continue

        try:
            text = file_path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue

        entries = code_repo._outline_file(rel, text)
        for entry in entries:
            name = entry.get("name", "")
            entry_kind = entry.get("kind", "")
            if not name:
                continue
            # glob-style matching on symbol name
            if not fnmatch.fnmatch(name, pattern):
                continue
            if kind and entry_kind != str(kind):
                continue
            results.append({
                "source": source,
                "path": rel,
                "name": name,
                "kind": entry_kind,
                "line": entry.get("line"),
            })
            if len(results) >= max_results:
                break
        if len(results) >= max_results:
            break

    return ToolResult(
        ok=True,
        data={
            "source": source,
            "pattern": pattern,
            "kind": str(kind) if kind else None,
            "results": results,
            "count": len(results),
            "truncated": len(results) >= max_results,
        },
    )


# ── adapt_imports ─────────────────────────────────────────────────────


def _adapt_imports(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    """Analyse code snippet and suggest minimal import additions for the target file.

    Given a *source_path* + *start_line* / *end_line* (or a *symbol*) that the
    agent is about to copy into a *target_path*, this tool:

    1. Extracts the names used in the snippet that come from imports in the source file.
    2. Checks which of those imports already exist in the target file.
    3. Returns the missing import lines that should be added to the target.

    For Python it uses AST analysis. For JS/C++ it falls back to heuristic
    extraction of import/require/include statements.
    """
    source = str(args.get("source") or "active_mod")
    source_path = str(args.get("source_path") or "")
    target_path_arg = str(args.get("target_path") or "")
    start = int(args.get("start_line") or 0)
    end = int(args.get("end_line") or 0)
    symbol = str(args.get("symbol") or "")
    target = str(args.get("target") or "active_mod")

    if not source_path or not target_path_arg:
        return ToolResult(ok=False, error="'source_path' and 'target_path' are required")
    if not symbol and (start < 1 or end < start):
        return ToolResult(ok=False, error="either 'symbol' or 'start_line'+'end_line' must be provided")

    # Read source file
    source_text, source_meta = _read_source_text(ctx, source, source_path)
    ext = Path(source_path).suffix.lower()

    # Determine snippet range
    if symbol:
        try:
            extracted, candidates = _extract_symbol_text(source_path, source_text, symbol, kind=None)
        except SyntaxError as exc:
            return ToolResult(ok=False, error=f"syntax error while parsing {source_path}: {exc.msg}")
        if candidates is not None:
            return ToolResult(ok=False, error=f"symbol '{symbol}' is ambiguous", data={"candidates": candidates})
        if extracted is None:
            return ToolResult(ok=False, error=f"symbol '{symbol}' not found")
        # Find the line range of the symbol in the source
        source_lines = source_text.splitlines()
        # Use AST for Python to find exact line range
        if ext == ".py":
            tree = ast.parse(source_text)
            for span in iter_symbols(tree, name=symbol):
                start = span.start_line
                end = span.end_line
                break
            else:
                # Fallback: search in outline
                for entry in code_repo._outline_file(source_path, source_text):
                    if entry.get("name") == symbol:
                        start = int(entry["line"])
                        end = _brace_aware_end(source_lines, start)
                        break
        else:
            for entry in code_repo._outline_file(source_path, source_text):
                if entry.get("name") == symbol:
                    start = int(entry["line"])
                    end = _brace_aware_end(source_lines, start)
                    break
    else:
        source_lines = source_text.splitlines()
        if end > len(source_lines):
            return ToolResult(ok=False, error=f"line range {start}-{end} exceeds file length {len(source_lines)}")

    # Read target file
    target_path, _target_name = _target_path(ctx, target, target_path_arg)
    if not target_path.exists():
        return ToolResult(
            ok=True,
            data={
                "source_path": source_path,
                "target_path": target_path_arg,
                "missing_imports": [],
                "suggested_additions": [],
                "note": "target file does not exist yet; all source imports may need to be added",
            },
        )
    target_text = target_path.read_text(encoding="utf-8")

    if ext == ".py":
        missing, suggested = _adapt_python_imports(source_text, start, end, target_text)
    elif ext in {".js", ".mjs", ".cjs", ".ts"}:
        missing, suggested = _adapt_js_imports(source_text, start, end, target_text)
    elif ext in {".cpp", ".cc", ".cxx", ".h", ".hpp"}:
        missing, suggested = _adapt_cpp_includes(source_text, start, end, target_text)
    else:
        return ToolResult(
            ok=True,
            data={
                "source_path": source_path,
                "target_path": target_path_arg,
                "missing_imports": [],
                "suggested_additions": [],
                "note": f"adapt_imports does not support .{ext.lstrip('.')} files",
            },
        )

    return ToolResult(
        ok=True,
        data={
            "source_path": source_path,
            "target_path": target_path_arg,
            "snippet_start_line": start,
            "snippet_end_line": end,
            "missing_imports": missing,
            "suggested_additions": suggested,
        },
    )


def _adapt_python_imports(
    source_text: str, start: int, end: int, target_text: str
) -> tuple[list[dict[str, Any]], list[str]]:
    """Analyse Python source/target and return missing imports for the snippet."""
    try:
        source_tree = ast.parse(source_text)
    except SyntaxError:
        return [], []
    try:
        target_tree = ast.parse(target_text)
    except SyntaxError:
        target_tree = None

    # Collect names used in the snippet (lines start..end)
    snippet_text = "\n".join(source_text.splitlines()[start - 1 : end])
    try:
        snippet_tree = ast.parse(snippet_text)
    except SyntaxError:
        return [], []

    # Names referenced in the snippet
    snippet_names: set[str] = set()
    for node in ast.walk(snippet_tree):
        if isinstance(node, ast.Name):
            snippet_names.add(node.id)
        elif isinstance(node, ast.Attribute):
            root = node
            while isinstance(root, ast.Attribute):
                root = root.value
            if isinstance(root, ast.Name):
                snippet_names.add(root.id)

    # Imports in the source file that provide those names
    source_imports: dict[str, dict[str, Any]] = {}
    for node in ast.walk(source_tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                local_name = alias.asname or alias.name.split(".")[0]
                if local_name in snippet_names:
                    line_text = source_text.splitlines()[node.lineno - 1]
                    source_imports[local_name] = {
                        "name": local_name,
                        "import_line": line_text.strip(),
                        "line_number": node.lineno,
                    }
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                local_name = alias.asname or alias.name
                if local_name in snippet_names:
                    line_text = source_text.splitlines()[node.lineno - 1]
                    source_imports[local_name] = {
                        "name": local_name,
                        "import_line": line_text.strip(),
                        "line_number": node.lineno,
                    }

    # Names already available in target via its imports
    target_imported_names: set[str] = set()
    if target_tree is not None:
        for node in ast.walk(target_tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    target_imported_names.add(alias.asname or alias.name.split(".")[0])
            elif isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    target_imported_names.add(alias.asname or alias.name)

    # Also add names defined in the target (functions, classes, variables)
    if target_tree is not None:
        for node in ast.walk(target_tree):
            if isinstance(node, ast.FunctionDef):
                target_imported_names.add(node.name)
            elif isinstance(node, ast.AsyncFunctionDef):
                target_imported_names.add(node.name)
            elif isinstance(node, ast.ClassDef):
                target_imported_names.add(node.name)
            elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
                target_imported_names.add(node.id)

    # Missing = in source imports but not in target's available names
    missing = [
        info
        for name, info in source_imports.items()
        if name not in target_imported_names
    ]
    suggested = [info["import_line"] for info in missing]
    return missing, suggested


def _adapt_js_imports(
    source_text: str, start: int, end: int, target_text: str
) -> tuple[list[dict[str, Any]], list[str]]:
    """Heuristic JS import analysis: extract import/require lines that the snippet needs."""
    _JS_IMPORT_RE = re.compile(
        r"^(?:import\s+.+\s+from\s+['\"].+['\"]|import\s+['\"].+['\"]"
        r"|const\s+\{[^}]+\}\s*=\s*require\s*\(['\"].+['\"]\))"
        r"\s*;?\s*$",
        re.MULTILINE,
    )
    _JS_REQUIRE_RE = re.compile(
        r"const\s+(\w+)\s*=\s*require\s*\(['\"].+['\"]\)\s*;?\s*$",
        re.MULTILINE,
    )

    source_lines = source_text.splitlines()
    snippet_lines = source_lines[start - 1 : end]
    snippet_text = "\n".join(snippet_lines)

    # Collect all import/require lines from source
    source_import_lines: dict[str, dict[str, Any]] = {}
    for match in _JS_IMPORT_RE.finditer(source_text):
        line = match.group(0).strip()
        line_num = source_text[: match.start()].count("\n") + 1
        source_import_lines[line] = {"import_line": line, "line_number": line_num}

    for match in _JS_REQUIRE_RE.finditer(source_text):
        name = match.group(1)
        line = match.group(0).strip()
        line_num = source_text[: match.start()].count("\n") + 1
        source_import_lines[line] = {"import_line": line, "line_number": line_num, "name": name}

    # Check which names from imports are used in the snippet
    used_imports: list[dict[str, Any]] = []
    for line, info in source_import_lines.items():
        # Check if any identifier from the import line appears in the snippet
        # Simple heuristic: extract identifiers from the import line
        identifiers = re.findall(r"\b([A-Za-z_]\w*)\b", line)
        # Filter out JS keywords
        keywords = {"import", "from", "const", "let", "var", "require", "default", "as", "export"}
        identifiers = [i for i in identifiers if i not in keywords]
        if any(ident in snippet_text for ident in identifiers):
            used_imports.append(info)

    # Check which of these already exist in target
    target_import_lines = set()
    for match in _JS_IMPORT_RE.finditer(target_text):
        target_import_lines.add(match.group(0).strip())
    for match in _JS_REQUIRE_RE.finditer(target_text):
        target_import_lines.add(match.group(0).strip())

    missing = [info for info in used_imports if info["import_line"] not in target_import_lines]
    suggested = [info["import_line"] for info in missing]
    return missing, suggested


def _adapt_cpp_includes(
    source_text: str, start: int, end: int, target_text: str
) -> tuple[list[dict[str, Any]], list[str]]:
    """Heuristic C/C++ include analysis: extract #include lines the snippet needs."""
    _INCLUDE_RE = re.compile(r'^\s*#\s*include\s+[<"][^>"]+[>"]\s*$', re.MULTILINE)
    _TYPE_RE = re.compile(r'\b([A-Z]\w*)\b')  # Simple CamelCase heuristic for type names

    snippet_lines = source_text.splitlines()[start - 1 : end]
    snippet_text = "\n".join(snippet_lines)

    # Collect all includes from source
    source_includes: dict[str, dict[str, Any]] = {}
    for match in _INCLUDE_RE.finditer(source_text):
        line = match.group(0).strip()
        line_num = source_text[: match.start()].count("\n") + 1
        source_includes[line] = {"import_line": line, "line_number": line_num}

    # Target includes
    target_includes = set()
    for match in _INCLUDE_RE.finditer(target_text):
        target_includes.add(match.group(0).strip())

    # All source includes that are not in target are candidates
    missing = [info for line, info in source_includes.items() if line not in target_includes]
    # For a more targeted list, we'd need a compile-db; heuristic: return all missing
    suggested = [info["import_line"] for info in missing]
    return missing, suggested


# ── extract_function ──────────────────────────────────────────────────


def _extract_function(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    """Extract a line range from a source file into a new function.

    For Python: uses AST to identify the enclosing scope and correctly
    handle indentation, parameters (free variables → args), and return
    values.  The extracted range is replaced with a call to the new
    function, and the function definition is inserted before the
    enclosing function/class or at the top of the file.

    For JS/C++: uses text-level extraction — cuts the lines, wraps
    them in a function stub, and replaces with a call.
    """
    target_path_arg = str(args.get("target_path") or "")
    target = str(args.get("target") or "active_mod")
    new_name = str(args.get("new_name") or "")
    start = int(args.get("start_line") or 0)
    end = int(args.get("end_line") or 0)
    dry_run = bool(args.get("dry_run", False))
    params = args.get("params")  # optional explicit param list

    if not target_path_arg or not new_name:
        return ToolResult(ok=False, error="'target_path' and 'new_name' are required")
    if start < 1 or end < start:
        return ToolResult(ok=False, error="'start_line' must be >= 1 and 'end_line' must be >= start_line")

    path, target_name = _target_path(ctx, target, target_path_arg)
    if not path.exists():
        return ToolResult(ok=False, error=f"file not found: {target_path_arg}")

    old_text = path.read_text(encoding="utf-8")
    lines = old_text.splitlines()
    if end > len(lines):
        return ToolResult(ok=False, error=f"line range {start}-{end} exceeds file length {len(lines)}")

    ext = path.suffix.lower()
    if ext == ".py":
        new_text, info = _extract_python_function(old_text, start, end, new_name, params)
    elif ext in {".js", ".mjs", ".cjs", ".ts"}:
        new_text, info = _extract_js_function(old_text, start, end, new_name, params)
    elif ext in {".cpp", ".cc", ".cxx", ".h", ".hpp"}:
        new_text, info = _extract_cpp_function(old_text, start, end, new_name, params)
    else:
        return ToolResult(ok=False, error=f"extract_function does not support .{ext.lstrip('.')} files")

    result = _write_text_result(path, target_path_arg, target_name, old_text, new_text, dry_run=dry_run)
    result.data.update(info)
    return result


def _extract_python_function(
    text: str, start: int, end: int, new_name: str, explicit_params: Any
) -> tuple[str, dict[str, Any]]:
    """Extract lines start..end into a new Python function using AST-aware analysis."""
    lines = text.splitlines()
    snippet_lines = lines[start - 1 : end]

    # Detect indentation of the extracted block
    base_indent = ""
    for line in snippet_lines:
        stripped = line.lstrip()
        if stripped:
            base_indent = line[: len(line) - len(stripped)]
            break

    indent_unit = "    "  # default 4 spaces
    if base_indent:
        # Try to detect indent unit from the first indented line
        for line in snippet_lines:
            stripped = line.lstrip()
            if stripped and len(line) - len(stripped) > len(base_indent):
                indent_unit = " " * (len(line) - len(stripped) - len(base_indent))
                break

    # Dedent the snippet by base_indent
    dedented = []
    for line in snippet_lines:
        if line.strip() == "":
            dedented.append("")
        elif line.startswith(base_indent):
            dedented.append(line[len(base_indent) :])
        else:
            dedented.append(line)

    # Determine params: if explicit, use them; otherwise try AST analysis
    param_list: list[str]
    if explicit_params and isinstance(explicit_params, list):
        param_list = [str(p) for p in explicit_params]
    else:
        try:
            tree = ast.parse(text)
            param_list = _infer_python_params(tree, start, end)
        except SyntaxError:
            param_list = []

    # Build the new function
    params_str = ", ".join(param_list)
    func_lines = [f"def {new_name}({params_str}):"]
    for line in dedented:
        func_lines.append(indent_unit + line)

    # Build the replacement call
    args_str = ", ".join(param_list)
    call_line = f"{base_indent}{new_name}({args_str})"

    # Find the enclosing function/class to insert the new function before it
    insert_line = _find_insert_point_python(text, start)

    # Assemble the new file
    result_lines = []
    for i, line in enumerate(lines, 1):
        if i == start:
            result_lines.append(call_line)
            continue
        if start < i <= end:
            continue
        result_lines.append(line)

    # Insert the new function at the insert point
    insert_idx = insert_line - 1
    result_lines.insert(insert_idx, "")
    for i, fl in enumerate(func_lines):
        result_lines.insert(insert_idx + 1 + i, fl)
    result_lines.insert(insert_idx + 1 + len(func_lines), "")

    new_text = "\n".join(result_lines)
    info = {
        "new_function": new_name,
        "params": param_list,
        "extracted_start_line": start,
        "extracted_end_line": end,
        "inserted_at_line": insert_line,
    }
    return new_text, info


def _infer_python_params(tree: ast.Module, start: int, end: int) -> list[str]:
    """Try to infer free variables in the snippet range that should become parameters."""
    try:
        source_lines = ast.unparse(tree).splitlines()
    except Exception:
        return []

    # Walk the AST to find the enclosing function
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.lineno <= start and (node.end_lineno or node.lineno) >= end:
                # Found the enclosing function — get its local names
                local_names: set[str] = set()
                for child in ast.walk(node):
                    if isinstance(child, ast.Name) and isinstance(child.ctx, ast.Store):
                        local_names.add(child.id)
                    elif isinstance(child, ast.arg):
                        local_names.add(child.arg)

                # Parse just the snippet
                snippet_text = "\n".join(source_lines[start - 1 : end])
                try:
                    snippet_tree = ast.parse(snippet_text)
                except SyntaxError:
                    return []

                # Names loaded in the snippet
                load_names: set[str] = set()
                for child in ast.walk(snippet_tree):
                    if isinstance(child, ast.Name) and isinstance(child.ctx, ast.Load):
                        load_names.add(child.id)

                # Builtins to exclude
                import builtins
                builtin_names = set(dir(builtins))

                # Free vars = names loaded but not defined in snippet, not builtins, not locals defined before snippet
                store_names: set[str] = set()
                for child in ast.walk(snippet_tree):
                    if isinstance(child, ast.Name) and isinstance(child.ctx, ast.Store):
                        store_names.add(child.id)

                free_vars = sorted(
                    load_names - store_names - builtin_names - {"self", "cls", "True", "False", "None"}
                )
                return free_vars

    return []


def _find_insert_point_python(text: str, start: int) -> int:
    """Find the line before which the new function definition should be inserted.

    This tries to find the start of the enclosing function/class so the new
    function goes right before it. Falls back to line 1 (top of file).
    """
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return 1

    best_line = 1
    for node in ast.iter_child_nodes(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            def_line = node.decorator_list[0].lineno if node.decorator_list else node.lineno
            if def_line <= start:
                best_line = max(best_line, def_line)
    return best_line


def _extract_js_function(
    text: str, start: int, end: int, new_name: str, explicit_params: Any
) -> tuple[str, dict[str, Any]]:
    """Extract lines start..end into a new JS function using text-level analysis."""
    lines = text.splitlines()
    snippet_lines = lines[start - 1 : end]

    # Detect indentation
    base_indent = ""
    for line in snippet_lines:
        stripped = line.lstrip()
        if stripped:
            base_indent = line[: len(line) - len(stripped)]
            break

    # Dedent
    dedented = []
    for line in snippet_lines:
        if line.strip() == "":
            dedented.append("")
        elif line.startswith(base_indent):
            dedented.append(line[len(base_indent) :])
        else:
            dedented.append(line)

    param_list: list[str]
    if explicit_params and isinstance(explicit_params, list):
        param_list = [str(p) for p in explicit_params]
    else:
        param_list = []

    params_str = ", ".join(param_list)

    # Build new function
    func_lines = [
        f"function {new_name}({params_str}) {{",
    ]
    for line in dedented:
        func_lines.append("    " + line if line.strip() else "")
    func_lines.append("}")

    # Build call
    args_str = ", ".join(param_list)
    call_line = f"{base_indent}{new_name}({args_str});"

    # Insert function at top of file (after any leading comments/empty lines)
    insert_line = 1
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped and not stripped.startswith("//") and not stripped.startswith("/*") and not stripped.startswith("*"):
            insert_line = i
            break

    # Assemble
    result_lines = []
    for i, line in enumerate(lines, 1):
        if i == start:
            result_lines.append(call_line)
            continue
        if start < i <= end:
            continue
        result_lines.append(line)

    insert_idx = insert_line - 1
    result_lines.insert(insert_idx, "")
    for i, fl in enumerate(func_lines):
        result_lines.insert(insert_idx + 1 + i, fl)
    result_lines.insert(insert_idx + 1 + len(func_lines), "")

    new_text = "\n".join(result_lines)
    info = {
        "new_function": new_name,
        "params": param_list,
        "extracted_start_line": start,
        "extracted_end_line": end,
        "inserted_at_line": insert_line,
    }
    return new_text, info


def _extract_cpp_function(
    text: str, start: int, end: int, new_name: str, explicit_params: Any
) -> tuple[str, dict[str, Any]]:
    """Extract lines start..end into a new C/C++ function using text-level analysis."""
    lines = text.splitlines()
    snippet_lines = lines[start - 1 : end]

    # Detect indentation
    base_indent = ""
    for line in snippet_lines:
        stripped = line.lstrip()
        if stripped:
            base_indent = line[: len(line) - len(stripped)]
            break

    # Dedent
    dedented = []
    for line in snippet_lines:
        if line.strip() == "":
            dedented.append("")
        elif line.startswith(base_indent):
            dedented.append(line[len(base_indent) :])
        else:
            dedented.append(line)

    param_list: list[str]
    if explicit_params and isinstance(explicit_params, list):
        param_list = [str(p) for p in explicit_params]
    else:
        param_list = []

    params_str = ", ".join(param_list)

    # Build new function (return type void as default)
    func_lines = [
        f"void {new_name}({params_str}) {{",
    ]
    for line in dedented:
        func_lines.append("    " + line if line.strip() else "")
    func_lines.append("}")

    # Build call
    args_str = ", ".join(param_list)
    call_line = f"{base_indent}{new_name}({args_str});"

    # Insert before the first non-comment, non-include, non-blank line in the body
    insert_line = 1
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped and not stripped.startswith("//") and not stripped.startswith("#") and not stripped.startswith("/*") and not stripped.startswith("*"):
            insert_line = i
            break

    # Assemble
    result_lines = []
    for i, line in enumerate(lines, 1):
        if i == start:
            result_lines.append(call_line)
            continue
        if start < i <= end:
            continue
        result_lines.append(line)

    insert_idx = insert_line - 1
    result_lines.insert(insert_idx, "")
    for i, fl in enumerate(func_lines):
        result_lines.insert(insert_idx + 1 + i, fl)
    result_lines.insert(insert_idx + 1 + len(func_lines), "")

    new_text = "\n".join(result_lines)
    info = {
        "new_function": new_name,
        "params": param_list,
        "extracted_start_line": start,
        "extracted_end_line": end,
        "inserted_at_line": insert_line,
    }
    return new_text, info


def _rename_symbol(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    rel = str(args.get("target_path") or "")
    old = str(args.get("old") or "")
    new = str(args.get("new") or "")
    target = str(args.get("target") or "active_mod")
    dry_run = bool(args.get("dry_run", False))
    if not rel or not old or not new:
        return ToolResult(ok=False, error="'target_path', 'old', and 'new' are required")
    path, target_name = _target_path(ctx, target, rel)
    if not path.exists():
        return ToolResult(ok=False, error=f"file not found: {rel}")
    old_text = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".py":
        try:
            tree = ast.parse(old_text, filename=str(path))
        except SyntaxError as exc:
            return ToolResult(ok=False, error=f"syntax error: {exc.msg}")
        new_tree = replace_name_in_tree(tree, old, new, scope="all")
        new_text = ast.unparse(new_tree) + "\n"
    else:
        pattern = re.compile(rf"\b{re.escape(old)}\b")
        new_text, count = pattern.subn(new, old_text)
        if count == 0:
            return ToolResult(ok=False, error=f"symbol '{old}' not found")
    result = _write_text_result(path, rel, target_name, old_text, new_text, dry_run=dry_run)
    result.data["old"] = old
    result.data["new"] = new
    return result


def _find_unused_imports_tool(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    rel = str(args.get("target_path") or "")
    target = str(args.get("target") or "active_mod")
    if not rel:
        return ToolResult(ok=False, error="'target_path' is required")
    path, _target_name = _target_path(ctx, target, rel)
    if not path.exists():
        return ToolResult(ok=False, error=f"file not found: {rel}")
    source = path.read_text(encoding="utf-8")
    unused = [
        {
            "start_line": entry.start_line,
            "end_line": entry.end_line,
            "text": entry.text,
            "unused": list(entry.unused),
        }
        for entry in find_unused_imports_in_source(source)
    ]
    return ToolResult(ok=True, data={"target_path": rel, "unused": unused, "count": len(unused)})


def _remove_unused_imports(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    rel = str(args.get("target_path") or "")
    target = str(args.get("target") or "active_mod")
    dry_run = bool(args.get("dry_run", False))
    if not rel:
        return ToolResult(ok=False, error="'target_path' is required")
    path, target_name = _target_path(ctx, target, rel)
    if not path.exists():
        return ToolResult(ok=False, error=f"file not found: {rel}")
    old_text = path.read_text(encoding="utf-8")
    entries = find_unused_imports_in_source(old_text)
    if not entries:
        return ToolResult(ok=True, data={"target_path": rel, "removed": 0, "diff": ""})
    remove_lines: set[int] = set()
    for entry in entries:
        remove_lines.update(range(entry.start_line, entry.end_line + 1))
    lines = old_text.splitlines(keepends=True)
    new_text = "".join(line for i, line in enumerate(lines, 1) if i not in remove_lines)
    result = _write_text_result(path, rel, target_name, old_text, new_text, dry_run=dry_run)
    result.data["removed"] = len(entries)
    return result


def _format_json(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    rel = str(args.get("target_path") or "")
    target = str(args.get("target") or "active_mod")
    dry_run = bool(args.get("dry_run", False))
    if not rel:
        return ToolResult(ok=False, error="'target_path' is required")
    path, target_name = _target_path(ctx, target, rel)
    if not path.exists():
        return ToolResult(ok=False, error=f"file not found: {rel}")
    old_text = path.read_text(encoding="utf-8")
    try:
        payload = json.loads(old_text)
    except json.JSONDecodeError as exc:
        return ToolResult(ok=False, error=f"invalid json: line {exc.lineno} column {exc.colno}: {exc.msg}")
    new_text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    return _write_text_result(path, rel, target_name, old_text, new_text, dry_run=dry_run)


_JS_SANDBOX_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\brequire\s*\("), "require() is not available in the mod sandbox"),
    (re.compile(r"\bprocess\b"), "process is not available in the mod sandbox"),
    (re.compile(r"\bfs\b|\bfs\."), "filesystem access is not available in the mod sandbox"),
    (re.compile(r"\bchild_process\b"), "child_process is forbidden in the mod sandbox"),
    (re.compile(r"\bmodule\.exports\b"), "main.js should use ModAPI hooks, not module.exports"),
    (re.compile(r"\bwindow\.require\b"), "window.require is forbidden in the mod sandbox"),
)


def _validate_js_sandbox(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    rel = str(args.get("target_path") or "")
    target = str(args.get("target") or "active_mod")
    if not rel:
        return ToolResult(ok=False, error="'target_path' is required")
    path, _target_name = _target_path(ctx, target, rel)
    if not path.exists():
        return ToolResult(ok=False, error=f"file not found: {rel}")
    text = path.read_text(encoding="utf-8")
    violations: list[dict[str, Any]] = []
    for line_no, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith("//"):
            continue
        for pattern, message in _JS_SANDBOX_PATTERNS:
            if pattern.search(line):
                violations.append({"line": line_no, "text": line, "message": message})
    return ToolResult(
        ok=not violations,
        error="" if not violations else f"found {len(violations)} sandbox violation(s)",
        data={"target_path": rel, "violations": violations, "count": len(violations)},
    )


def build_transfer_tools() -> list[Tool]:
    return [
        Tool(
            name="source_read_file",
            description="Read a whole file from active_mod, mods_root, engine_source, or project.",
            parameters={
                "type": "object",
                "properties": {"source": STRING, "path": STRING, "max_bytes": POS_INT},
                "required": ["path"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_source_read_file,
        ),
        Tool(
            name="source_read_range",
            description="Read an inclusive 1-based line range from active_mod, mods_root, engine_source, or project, with optional context lines.",
            parameters={
                "type": "object",
                "properties": {"source": STRING, "path": STRING, "start_line": POS_INT, "end_line": POS_INT, "context_lines": NON_NEG_INT},
                "required": ["path", "start_line", "end_line"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_source_read_range,
        ),
        Tool(
            name="source_outline",
            description="Return structured symbols/keys/headings from a source file in active_mod, mods_root, engine_source, or project.",
            parameters={
                "type": "object",
                "properties": {"source": STRING, "path": STRING},
                "required": ["path"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_source_outline,
        ),
        Tool(
            name="copy_file",
            description="Copy one file from a read source into active_mod, mods_root, or scratch. Supports binary files.",
            parameters={
                "type": "object",
                "properties": {"source": STRING, "source_path": STRING, "target": STRING, "target_path": STRING, "overwrite": BOOL, "dry_run": BOOL},
                "required": ["source_path", "target_path"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_copy_file,
        ),
        Tool(
            name="copy_tree",
            description=(
                "Copy a directory tree from a read source into active_mod, mods_root, or scratch. "
                "Supports binary files, dry_run, overwrite protection, include_globs and exclude_globs."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "source": STRING,
                    "source_path": STRING,
                    "target": STRING,
                    "target_path": STRING,
                    "overwrite": BOOL,
                    "dry_run": BOOL,
                    "include_globs": {"type": "array", "items": {"type": "string"}},
                    "exclude_globs": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["source_path", "target_path"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_copy_tree,
        ),
        Tool(
            name="copy_range",
            description="Copy an inclusive line range from any read source and insert it into a writable target file.",
            parameters={
                "type": "object",
                "properties": {"source": STRING, "source_path": STRING, "start_line": POS_INT, "end_line": POS_INT, "target": STRING, "target_path": STRING, "insert_mode": STRING, "marker": STRING, "line": POS_INT, "dry_run": BOOL},
                "required": ["source_path", "start_line", "end_line", "target_path", "insert_mode"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_copy_range,
        ),
        Tool(
            name="copy_json_value",
            description=(
                "Copy a structured JSON value selected by JSON Pointer from active_mod, mods_root, "
                "engine_source, or project into a writable JSON file. Refuses accidental overwrite "
                "unless on_conflict is replace or merge."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "source": STRING,
                    "source_path": STRING,
                    "source_pointer": STRING,
                    "target": STRING,
                    "target_path": STRING,
                    "target_pointer": STRING,
                    "on_conflict": {
                        "type": "string",
                        "enum": sorted(JSON_CONFLICT_POLICIES),
                    },
                    "dry_run": BOOL,
                },
                "required": ["source_path", "source_pointer", "target_path", "target_pointer"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_copy_json_value,
        ),
        Tool(
            name="copy_symbol",
            description="Copy a function/class/method-like symbol from a source file into a writable target. Python uses AST spans; JS/C++ use outline plus brace-aware extraction.",
            parameters={
                "type": "object",
                "properties": {"source": STRING, "path": STRING, "symbol": STRING, "kind": STRING, "target": STRING, "target_path": STRING, "insert_mode": STRING, "marker": STRING, "line": POS_INT, "rename_to": STRING, "dry_run": BOOL},
                "required": ["path", "symbol", "target_path", "insert_mode"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_copy_symbol,
        ),
        Tool(
            name="insert_text",
            description="Insert raw text into a writable target file by append/prepend/line/marker/replace_file mode.",
            parameters={
                "type": "object",
                "properties": {"target": STRING, "target_path": STRING, "text": STRING, "mode": STRING, "marker": STRING, "line": POS_INT, "dry_run": BOOL},
                "required": ["target_path", "text", "mode"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_insert_text,
        ),
        Tool(
            name="replace_exact",
            description="Replace an exact substring in a writable target file; refuses ambiguous matches unless replace_all=true.",
            parameters={
                "type": "object",
                "properties": {"target": STRING, "target_path": STRING, "old": STRING, "new": STRING, "replace_all": BOOL, "dry_run": BOOL},
                "required": ["target_path", "old", "new"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_replace_exact,
        ),
        Tool(
            name="apply_unified_patch",
            description=(
                "Apply a unified diff patch inside a writable target root. Checks file paths "
                "and hunk context before writing; supports dry_run."
            ),
            parameters={
                "type": "object",
                "properties": {"target": STRING, "patch": STRING, "dry_run": BOOL},
                "required": ["patch"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_apply_unified_patch,
        ),
        Tool(
            name="move_path",
            description="Move a file or directory inside one writable target root.",
            parameters={
                "type": "object",
                "properties": {"target": STRING, "source_path": STRING, "target_path": STRING, "overwrite": BOOL, "dry_run": BOOL},
                "required": ["source_path", "target_path"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_move_path,
        ),
        Tool(
            name="delete_path",
            description="Delete a file, or a directory only when recursive=true, inside one writable target root.",
            parameters={
                "type": "object",
                "properties": {"target": STRING, "target_path": STRING, "recursive": BOOL, "dry_run": BOOL},
                "required": ["target_path"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_delete_path,
        ),
        Tool(
            name="preview_diff",
            description="Return a unified diff between a writable target file and proposed replacement text.",
            parameters={
                "type": "object",
                "properties": {"target": STRING, "target_path": STRING, "proposed_text": STRING},
                "required": ["target_path", "proposed_text"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_preview_diff,
        ),
        Tool(
            name="agent_clipboard",
            description="Store, retrieve, list, or clear text snippets in the current agent ToolContext.",
            parameters={
                "type": "object",
                "properties": {"action": STRING, "slot": STRING, "content": STRING},
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_agent_clipboard,
        ),
        Tool(
            name="checkpoint_create",
            description="Create a ZIP checkpoint of the active mod, excluding agent internal folders.",
            parameters={
                "type": "object",
                "properties": {"label": STRING},
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_checkpoint_create,
        ),
        Tool(
            name="checkpoint_list",
            description="List available active-mod checkpoints stored under mods_root/.backups/agent_checkpoints.",
            parameters={"type": "object", "properties": {}, "additionalProperties": False},
            kind=Kind.READ,
            handler=_checkpoint_list,
        ),
        Tool(
            name="checkpoint_diff",
            description="Compare the active mod against a checkpoint and return added/removed/modified files.",
            parameters={
                "type": "object",
                "properties": {"id": STRING},
                "required": ["id"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_checkpoint_diff,
        ),
        Tool(
            name="checkpoint_restore",
            description="Restore the active mod from a checkpoint. Supports dry_run.",
            parameters={
                "type": "object",
                "properties": {"id": STRING, "dry_run": BOOL},
                "required": ["id"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_checkpoint_restore,
        ),
        Tool(
            name="rename_symbol",
            description="Rename a symbol inside a writable target file. Python uses AST rewriting; other files use word-boundary replacement.",
            parameters={
                "type": "object",
                "properties": {"target": STRING, "target_path": STRING, "old": STRING, "new": STRING, "dry_run": BOOL},
                "required": ["target_path", "old", "new"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_rename_symbol,
        ),
        Tool(
            name="find_unused_imports",
            description="Find unused Python import statements in a writable target file.",
            parameters={
                "type": "object",
                "properties": {"target": STRING, "target_path": STRING},
                "required": ["target_path"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_find_unused_imports_tool,
        ),
        Tool(
            name="remove_unused_imports",
            description="Remove fully unused Python import statements from a writable target file. Supports dry_run.",
            parameters={
                "type": "object",
                "properties": {"target": STRING, "target_path": STRING, "dry_run": BOOL},
                "required": ["target_path"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_remove_unused_imports,
        ),
        Tool(
            name="format_json",
            description="Parse and rewrite JSON with stable two-space indentation while preserving key order.",
            parameters={
                "type": "object",
                "properties": {"target": STRING, "target_path": STRING, "dry_run": BOOL},
                "required": ["target_path"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_format_json,
        ),
        Tool(
            name="validate_js_sandbox",
            description="Scan a JS mod file for APIs forbidden by the sandbox, such as require/process/fs/module.exports.",
            parameters={
                "type": "object",
                "properties": {"target": STRING, "target_path": STRING},
                "required": ["target_path"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_validate_js_sandbox,
        ),
        Tool(
            name="find_symbol",
            description=(
                "Search for symbols by name or glob pattern across source files. "
                "Scans Python, JS, C++, JSON, and Markdown files. Returns matching "
                "symbol names, kinds, file paths, and line numbers. Use this before "
                "copy_symbol to locate the right symbol."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "source": STRING,
                    "pattern": STRING,
                    "kind": STRING,
                    "path_glob": STRING,
                    "max_results": POS_INT,
                },
                "required": ["pattern"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_find_symbol,
        ),
        Tool(
            name="adapt_imports",
            description=(
                "Analyse a code snippet (by line range or symbol) in a source file and "
                "suggest which import/include statements are missing in the target file. "
                "Python uses AST analysis; JS uses heuristic require/import matching; "
                "C++ uses #include comparison. Call before or after copy_symbol/copy_range "
                "to ensure the target file has the needed imports."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "source": STRING,
                    "source_path": STRING,
                    "start_line": POS_INT,
                    "end_line": POS_INT,
                    "symbol": STRING,
                    "target": STRING,
                    "target_path": STRING,
                },
                "required": ["source_path", "target_path"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_adapt_imports,
        ),
        Tool(
            name="extract_function",
            description=(
                "Extract a range of lines into a new function. The original lines are "
                "replaced by a call to the new function, and the function definition is "
                "inserted before the enclosing scope (Python) or at the top of the file "
                "(JS/C++). Python uses AST to infer free variables as parameters; other "
                "languages require explicit 'params' or default to no parameters."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "target": STRING,
                    "target_path": STRING,
                    "new_name": STRING,
                    "start_line": POS_INT,
                    "end_line": POS_INT,
                    "params": {"type": "array", "items": {"type": "string"}},
                    "dry_run": BOOL,
                },
                "required": ["target_path", "new_name", "start_line", "end_line"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_extract_function,
        ),
    ]
