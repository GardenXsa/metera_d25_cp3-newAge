"""Higher-level source/mod intelligence tools for autonomous mod building."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from modkit import code_repo, docs as docs_index
from modkit.mod_inventory import build_inventory
from modkit.permissions import Kind
from modkit.tools.registry import Tool, ToolContext, ToolResult


STRING = {"type": "string"}
POS_INT = {"type": "integer", "minimum": 1}

_MODAPI_CALL_RE = re.compile(r"\bModAPI\.([A-Za-z_$][\w$]*)\s*\(")


def _require_loaded() -> tuple[code_repo.CodeRepo | None, ToolResult | None]:
    repo = code_repo.default()
    if not repo.loaded:
        repo.ensure_loaded()
    if not repo.loaded:
        return None, ToolResult(
            ok=False,
            error=f"engine source is not loaded: {repo.load_error or repo.source_dir}",
        )
    return repo, None


def _analyze_source_pattern(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    query = str(args.get("query") or "").strip()
    if not query:
        return ToolResult(ok=False, error="'query' is required")
    path_glob = str(args.get("path_glob") or "").strip() or None
    max_results = int(args.get("max_results") or 20)
    repo, err = _require_loaded()
    if err is not None:
        return err
    assert repo is not None
    matches = repo.grep(re.escape(query), path_glob=path_glob)
    if matches and matches[0].get("_error"):
        return ToolResult(ok=False, error=matches[0]["_error"])
    ranked = matches[:max_results]
    files = sorted({m["path"] for m in ranked})
    return ToolResult(
        ok=True,
        data={
            "query": query,
            "path_glob": path_glob,
            "matches": ranked,
            "files": files,
            "count": len(ranked),
            "recommended_tools": [
                "code_read",
                "source_read_range",
                "copy_range",
                "copy_symbol",
                "validate_js_sandbox",
            ],
        },
    )


def _list_modapi_endpoints(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    repo, err = _require_loaded()
    if err is not None:
        return err
    assert repo is not None
    endpoints: dict[str, dict[str, Any]] = {}
    for path in repo.file_paths:
        if not path.endswith((".js", ".ts", ".mjs", ".cjs", ".md", ".txt")):
            continue
        data = repo.get_file(path)
        if data is None:
            continue
        text = data.decode("utf-8", errors="replace")
        for line_no, line in enumerate(text.splitlines(), 1):
            for match in _MODAPI_CALL_RE.finditer(line):
                name = match.group(1)
                entry = endpoints.setdefault(
                    name,
                    {"name": name, "count": 0, "examples": []},
                )
                entry["count"] += 1
                if len(entry["examples"]) < 5:
                    entry["examples"].append({"path": path, "line": line_no, "text": line.strip()})
    ordered = sorted(endpoints.values(), key=lambda e: (-int(e["count"]), str(e["name"])))
    return ToolResult(ok=True, data={"endpoints": ordered, "count": len(ordered)})


def _list_runtime_data_keys(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    manifest = docs_index.runtime_manifest()
    db_files = manifest.get("database_files") or {}
    keys = []
    for key, info in sorted(db_files.items()):
        keys.append(
            {
                "key": key,
                "default_type": info.get("default_type"),
                "merge_policy": info.get("merge_policy"),
                "required": info.get("required", []),
            }
        )
    return ToolResult(ok=True, data={"keys": keys, "count": len(keys)})


def _compare_mod_to_engine_contract(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    mod_root = ctx.mod_root
    if mod_root is None:
        return ToolResult(ok=False, error="no mod is selected")
    report = build_inventory(mod_root)
    issues = list(report.discrepancies)
    descriptor = _read_mod_json(mod_root)
    declared_scripts = {str(p).replace("\\", "/") for p in descriptor.get("scripts", []) if isinstance(p, str)}
    for script in report.script_summary:
        rel = str(script.get("path") or "")
        if rel and declared_scripts and rel not in declared_scripts:
            issues.append(f"script file '{rel}' exists but is not registered in mod.json scripts")
    sandbox_hints = []
    for script in report.script_summary:
        if script.get("uses_module_exports"):
            sandbox_hints.append(f"{script.get('path')}: module.exports is not the ModAPI script pattern")
    return ToolResult(
        ok=True,
        data={
            "mod_id": report.mod_id,
            "summary": report.totals,
            "issues": issues,
            "sandbox_hints": sandbox_hints,
            "validation": {
                "errors": report.validation_errors,
                "warnings": report.validation_warnings,
            },
        },
    )


def _read_mod_json(mod_root: Path) -> dict[str, Any]:
    path = mod_root / "mod.json"
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def build_intelligence_tools() -> list[Tool]:
    return [
        Tool(
            name="analyze_source_pattern",
            description="Search the local engine source for a concrete pattern and return ranked examples plus recommended follow-up tools.",
            parameters={
                "type": "object",
                "properties": {"query": STRING, "path_glob": STRING, "max_results": POS_INT},
                "required": ["query"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_analyze_source_pattern,
        ),
        Tool(
            name="list_modapi_endpoints",
            description="Scan engine source for ModAPI.<name>(...) calls and return endpoint names with examples.",
            parameters={"type": "object", "properties": {}, "additionalProperties": False},
            kind=Kind.READ,
            handler=_list_modapi_endpoints,
        ),
        Tool(
            name="list_runtime_data_keys",
            description="List runtime_manifest database keys with default type, merge policy, and required fields.",
            parameters={"type": "object", "properties": {}, "additionalProperties": False},
            kind=Kind.READ,
            handler=_list_runtime_data_keys,
        ),
        Tool(
            name="compare_mod_to_engine_contract",
            description="Compare the active mod inventory against manifest/script expectations and report issues useful before validation.",
            parameters={"type": "object", "properties": {}, "additionalProperties": False},
            kind=Kind.READ,
            handler=_compare_mod_to_engine_contract,
        ),
    ]
