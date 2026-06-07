"""Authoritative on-disk inventory of a mod folder.

The point of this module is to give the LLM one tool call that
**guarantees** it has seen every byte of the mod. Without this, an
LLM asked to "analyze the mod" can read two files, claim it saw the
whole thing, and the user has no way to know. With ``build_inventory``
the report itself shows the file count, item count and line totals
that the LLM must describe — anything it omits in its reply is
visible by comparing the report to the prose.

The inventory is purely a function of what's on disk right now:
deterministic, no LLM in the loop, no shortcuts.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from modkit import docs as docs_index
from modkit.validate import validate_mod


_JS_FUNCTION_RE = re.compile(r"\bfunction\s+([A-Za-z_$][\w$]*)\b")
_JS_ARROW_RE = re.compile(r"=>(?:\s*[A-Za-z_(])")
_JS_LISTENER_RE = re.compile(r"ModAPI\.on\(\s*['\"]([A-Za-z0-9_]+)['\"]")
_JS_COMMAND_RE = re.compile(r"ModAPI\.addCommand\(")
_JS_SAVE_RE = re.compile(r"ModAPI\.registerSaveData\(")


@dataclass
class InventoryReport:
    mod_id: str
    mod_path: str
    descriptor: dict[str, Any] = field(default_factory=dict)
    files: list[dict[str, Any]] = field(default_factory=list)
    totals: dict[str, Any] = field(default_factory=dict)
    declared_data_keys: dict[str, list[str]] = field(default_factory=dict)
    discrepancies: list[str] = field(default_factory=list)
    data_summary: list[dict[str, Any]] = field(default_factory=list)
    script_summary: list[dict[str, Any]] = field(default_factory=list)
    asset_summary: list[dict[str, Any]] = field(default_factory=list)
    validation_errors: list[str] = field(default_factory=list)
    validation_warnings: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.validation_errors

    def to_dict(self) -> dict[str, Any]:
        return {
            "mod_id": self.mod_id,
            "mod_path": self.mod_path,
            "ok": self.ok,
            "descriptor": self.descriptor,
            "totals": self.totals,
            "files": self.files,
            "declared_data_keys": self.declared_data_keys,
            "data_summary": self.data_summary,
            "script_summary": self.script_summary,
            "asset_summary": self.asset_summary,
            "discrepancies": self.discrepancies,
            "validation": {
                "errors": self.validation_errors,
                "warnings": self.validation_warnings,
            },
            "warnings": self.warnings,
        }


def build_inventory(mod_path: Path) -> InventoryReport:
    """Walk ``mod_path`` and assemble a full inventory.

    Reads every file the mod declares or contains. The result is the
    single source of truth for "what does this mod look like right
    now". Never trust an LLM's prose summary over this report.
    """
    mod_path = Path(mod_path).resolve()
    report = InventoryReport(
        mod_id=mod_path.name,
        mod_path=str(mod_path),
    )

    if not mod_path.exists() or not mod_path.is_dir():
        report.validation_errors.append(f"mod folder not found: {mod_path}")
        return report

    # mod.json: parse and pull out declared data keys.
    mod_json = mod_path / "mod.json"
    if not mod_json.exists():
        report.validation_errors.append("mod.json not found")
    else:
        try:
            text = mod_json.read_text(encoding="utf-8-sig")
            meta = json.loads(text)
        except json.JSONDecodeError as exc:
            report.validation_errors.append(f"mod.json is not valid JSON: {exc}")
            meta = {}
        except OSError as exc:
            report.validation_errors.append(f"cannot read mod.json: {exc}")
            meta = {}
        report.descriptor = meta if isinstance(meta, dict) else {}

    # declared data keys (the strings mod.json says will be loaded)
    declared = (report.descriptor.get("data") or {}) if report.descriptor else {}
    if isinstance(declared, dict):
        for key, entries in declared.items():
            if isinstance(entries, str):
                report.declared_data_keys[key] = [entries]
            elif isinstance(entries, list):
                report.declared_data_keys[key] = [
                    e for e in entries if isinstance(e, str)
                ]

    # declared scripts
    declared_scripts: list[str] = []
    scripts = report.descriptor.get("scripts") if report.descriptor else None
    if isinstance(scripts, list):
        declared_scripts = [s for s in scripts if isinstance(s, str)]

    # full file walk
    file_index: dict[str, dict[str, Any]] = {}
    total_bytes = 0
    total_lines = 0
    data_files_count = 0
    script_files_count = 0
    asset_files_count = 0

    for path in sorted(mod_path.rglob("*")):
        if not path.is_file():
            continue
        # skip the inventory report itself
        if path.name in ("mod_inventory.json",):
            continue
        rel = path.relative_to(mod_path).as_posix()
        try:
            size = path.stat().st_size
        except OSError as exc:
            report.warnings.append(f"cannot stat {rel}: {exc}")
            continue
        total_bytes += size
        entry: dict[str, Any] = {
            "path": rel,
            "bytes": size,
        }

        if path.suffix.lower() == ".json":
            # The descriptor (mod.json) is the manifest, not data.
            kind = "descriptor" if path.name == "mod.json" else "data"
            try:
                raw = path.read_text(encoding="utf-8-sig")
            except (OSError, UnicodeDecodeError) as exc:
                entry["error"] = f"cannot read: {exc}"
                entry["lines"] = 0
                entry["items"] = 0
                report.warnings.append(f"{rel}: cannot read: {exc}")
                file_index[rel] = entry
                continue
            lines = raw.count("\n") + (0 if raw.endswith("\n") or not raw else 1)
            total_lines += lines
            entry["lines"] = lines
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError as exc:
                entry["error"] = f"invalid JSON: {exc}"
                entry["items"] = 0
                report.warnings.append(f"{rel}: invalid JSON: {exc}")
                file_index[rel] = entry
                continue
            entry["shape"] = "array" if isinstance(payload, list) else (
                "object" if isinstance(payload, dict) else type(payload).__name__
            )
            entry["items"] = _count_items(payload)
            # Sample of first key for orientation (truncated to avoid
            # huge responses on dense objects).
            entry["sample_keys"] = _sample_keys(payload)
            if kind == "data":
                data_files_count += 1
        elif path.suffix.lower() == ".js":
            kind = "script"
            try:
                raw = path.read_text(encoding="utf-8-sig")
            except (OSError, UnicodeDecodeError) as exc:
                entry["error"] = f"cannot read: {exc}"
                entry["lines"] = 0
                report.warnings.append(f"{rel}: cannot read: {exc}")
                file_index[rel] = entry
                continue
            lines = raw.count("\n") + (0 if raw.endswith("\n") or not raw else 1)
            total_lines += lines
            entry["lines"] = lines
            entry["functions"] = len(_JS_FUNCTION_RE.findall(raw))
            entry["arrow_fns"] = len(_JS_ARROW_RE.findall(raw))
            entry["modapi_listeners"] = _JS_LISTENER_RE.findall(raw)
            entry["registers_command"] = bool(_JS_COMMAND_RE.search(raw))
            entry["registers_save_data"] = bool(_JS_SAVE_RE.search(raw))
            entry["uses_module_exports"] = "module.exports" in raw
            if entry["uses_module_exports"]:
                report.warnings.append(
                    f"{rel}: uses module.exports — sandboxed runtime can't load it"
                )
            script_files_count += 1
        elif path.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"):
            kind = "asset"
            asset_files_count += 1
        elif path.suffix.lower() in (".md", ".txt"):
            kind = "doc"
            try:
                raw = path.read_text(encoding="utf-8-sig")
            except (OSError, UnicodeDecodeError):
                raw = ""
            lines = raw.count("\n") + (0 if raw.endswith("\n") or not raw else 1)
            total_lines += lines
            entry["lines"] = lines
        else:
            kind = "other"
        entry["kind"] = kind
        file_index[rel] = entry

    # Validate files referenced by mod.json actually exist; mark missing.
    seen: set[str] = set(file_index.keys())
    for key, paths in report.declared_data_keys.items():
        for rel in paths:
            if rel not in seen:
                entry = {"path": rel, "missing": True, "kind": "data",
                         "referenced_by": key}
                file_index[rel] = entry
                report.discrepancies.append(
                    f"mod.json data['{key}'] references '{rel}' but the file is missing"
                )
    for rel in declared_scripts:
        if rel not in seen:
            entry = {"path": rel, "missing": True, "kind": "script"}
            file_index[rel] = entry
            report.discrepancies.append(
                f"mod.json scripts[] references '{rel}' but the file is missing"
            )

    # Conversely: are there data/ JSON files that aren't in mod.json?
    declared_data_set: set[str] = set()
    for paths in report.declared_data_keys.values():
        declared_data_set.update(paths)
    for rel, entry in file_index.items():
        if (
            entry.get("kind") == "data"
            and not entry.get("missing")
            and rel not in declared_data_set
        ):
            entry["orphaned"] = True
            report.discrepancies.append(
                f"data file '{rel}' exists on disk but is not registered in mod.json"
            )

    report.files = [file_index[k] for k in sorted(file_index.keys())]
    report.totals = {
        "files_total": len(report.files),
        "data_files": data_files_count,
        "script_files": script_files_count,
        "asset_files": asset_files_count,
        "other_files": len(report.files) - data_files_count - script_files_count - asset_files_count,
        "total_bytes": total_bytes,
        "total_lines": total_lines,
    }

    # Per-key data summary: aggregate items across the data files
    # declared for each key, so the LLM gets totals per logical
    # database key, not just per file.
    manifest_db = docs_index.runtime_manifest().get("database_files", {})
    for key, paths in sorted(report.declared_data_keys.items()):
        policy = manifest_db.get(key, {}).get("merge_policy", "?")
        dtype = manifest_db.get(key, {}).get("default_type", "?")
        per_key = {
            "database_key": key,
            "merge_policy": policy,
            "default_type": dtype,
            "files": paths,
            "files_present": sum(1 for p in paths if p in seen and not file_index[p].get("missing")),
            "total_items": 0,
            "total_lines": 0,
            "total_bytes": 0,
        }
        for rel in paths:
            entry = file_index.get(rel)
            if not entry or entry.get("missing"):
                continue
            per_key["total_items"] += int(entry.get("items", 0))
            per_key["total_lines"] += int(entry.get("lines", 0))
            per_key["total_bytes"] += int(entry.get("bytes", 0))
        report.data_summary.append(per_key)

    # Script summary (compact)
    for rel, entry in file_index.items():
        if entry.get("kind") != "script" or entry.get("missing"):
            continue
        report.script_summary.append(
            {
                "path": rel,
                "lines": entry.get("lines", 0),
                "bytes": entry.get("bytes", 0),
                "functions": entry.get("functions", 0),
                "arrow_fns": entry.get("arrow_fns", 0),
                "modapi_listeners": entry.get("modapi_listeners", []),
                "registers_command": entry.get("registers_command", False),
                "registers_save_data": entry.get("registers_save_data", False),
            }
        )
    # Asset summary
    for rel, entry in file_index.items():
        if entry.get("kind") == "asset":
            report.asset_summary.append({"path": rel, "bytes": entry.get("bytes", 0)})

    # Re-run the contract validator so the report also includes the
    # same errors / warnings ``validate_mod`` surfaces. This makes
    # ``analyze_mod`` a strict superset of ``validate_mod`` from the
    # LLM's perspective.
    vreport = validate_mod(mod_path)
    report.validation_errors = list(vreport.errors)
    report.validation_warnings = list(vreport.warnings)
    return report


def _count_items(payload: Any) -> int:
    """How many 'items' is this payload? Objects counted by their
    own keys, arrays by length, scalars as 1."""
    if isinstance(payload, list):
        return len(payload)
    if isinstance(payload, dict):
        return len(payload)
    if payload is None:
        return 0
    return 1


def _sample_keys(payload: Any, max_keys: int = 5) -> list[str]:
    """First few keys/indices of the payload, for orientation only."""
    if isinstance(payload, dict):
        return list(payload.keys())[:max_keys]
    if isinstance(payload, list):
        return [f"[{i}]" for i in range(min(max_keys, len(payload)))]
    return []
