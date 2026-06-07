"""Mod validation against the Chronicles of Meterea modding contract.

This is the pure-logic version of what the GUI ModKit did inside
``_collect_mod_validation``. We use it both as a CLI subcommand and as
an agent tool.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from modkit.docs import runtime_manifest


MOD_ID_RE = re.compile(r"^[a-z0-9_]+$")
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?$")


@dataclass
class ValidationReport:
    mod_id: str
    mod_path: str
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    info: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors

    def to_dict(self) -> dict[str, Any]:
        return {
            "mod_id": self.mod_id,
            "mod_path": self.mod_path,
            "ok": self.ok,
            "errors": list(self.errors),
            "warnings": list(self.warnings),
            "info": list(self.info),
        }


def validate_mod(mod_path: Path) -> ValidationReport:
    """Run the full set of static checks on a mod folder."""
    mod_path = Path(mod_path).resolve()
    report = ValidationReport(mod_id=mod_path.name, mod_path=str(mod_path))

    if not mod_path.exists() or not mod_path.is_dir():
        report.errors.append(f"Mod folder not found: {mod_path}")
        return report

    mod_json_path = mod_path / "mod.json"
    if not mod_json_path.exists():
        report.errors.append("mod.json not found")
        return report

    try:
        meta_raw = mod_json_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        try:
            meta_raw = mod_json_path.read_text(encoding="utf-8-sig")
            report.warnings.append(
                "mod.json saved with a UTF-8 BOM — strip it before shipping the mod"
            )
        except OSError as exc:
            report.errors.append(f"Cannot read mod.json: {exc}")
            return report
    except OSError as exc:
        report.errors.append(f"Cannot read mod.json: {exc}")
        return report
    # Some editors (and PowerShell's Set-Content -Encoding utf8) prepend a BOM
    # even when the file decodes as UTF-8. Strip it once before json.loads.
    if meta_raw.startswith("\ufeff"):
        meta_raw = meta_raw.lstrip("\ufeff")
        report.warnings.append(
            "mod.json saved with a UTF-8 BOM — strip it before shipping the mod"
        )
    try:
        meta: dict[str, Any] = json.loads(meta_raw)
    except json.JSONDecodeError as exc:
        report.errors.append(f"mod.json is not valid JSON: {exc}")
        return report

    _validate_descriptor(meta, mod_path.name, report)
    _validate_files(meta, mod_path, report)
    _validate_data_section(meta, mod_path, report)
    _validate_total_conversion(meta, report)

    return report


def _validate_descriptor(meta: dict[str, Any], folder_name: str, report: ValidationReport) -> None:
    required = ["id", "name", "version"]
    recommended = ["author", "description"]

    for field_name in required:
        value = meta.get(field_name)
        if not isinstance(value, str) or not value.strip():
            report.errors.append(f"mod.json missing required string field '{field_name}'")

    for field_name in recommended:
        value = meta.get(field_name)
        if not isinstance(value, str) or not value.strip():
            report.warnings.append(f"mod.json missing recommended field '{field_name}'")

    mod_id = meta.get("id")
    if isinstance(mod_id, str):
        if not MOD_ID_RE.match(mod_id):
            report.errors.append(
                "mod.json 'id' must match [a-z0-9_]+ (lowercase ASCII letters, digits, underscores)"
            )
        if mod_id != folder_name:
            report.warnings.append(
                f"mod.json id '{mod_id}' does not match folder name '{folder_name}'"
            )

    version = meta.get("version")
    if isinstance(version, str) and version and not SEMVER_RE.match(version):
        report.warnings.append(
            f"mod.json 'version' = '{version}' is not semver (expected like 1.0.0)"
        )

    deps = meta.get("dependencies")
    if deps is not None and not isinstance(deps, list):
        report.errors.append("mod.json 'dependencies' must be an array of strings")
    elif isinstance(deps, list):
        for dep in deps:
            if not isinstance(dep, str):
                report.errors.append(
                    f"mod.json 'dependencies' contains non-string value: {dep!r}"
                )

    tc = meta.get("total_conversion")
    if tc is not None and not isinstance(tc, bool):
        report.errors.append("mod.json 'total_conversion' must be boolean")


def _validate_files(meta: dict[str, Any], mod_path: Path, report: ValidationReport) -> None:
    scripts = meta.get("scripts")
    if scripts is None:
        return
    if not isinstance(scripts, list):
        report.errors.append("mod.json 'scripts' must be an array of strings")
        return
    for script in scripts:
        if not isinstance(script, str):
            report.errors.append(f"mod.json 'scripts' contains non-string: {script!r}")
            continue
        script_path = mod_path / script
        if not script_path.exists():
            report.errors.append(f"script not found: {script}")


def _validate_data_section(meta: dict[str, Any], mod_path: Path, report: ValidationReport) -> None:
    data = meta.get("data")
    if data is None:
        return
    if not isinstance(data, dict):
        report.errors.append("mod.json 'data' must be an object")
        return

    manifest = runtime_manifest()
    known_keys = set(manifest.get("database_files", {}).keys())

    for key, entries in data.items():
        if known_keys and key not in known_keys:
            report.warnings.append(
                f"data key '{key}' is not in runtime_manifest.json — typo?"
            )
        if isinstance(entries, str):
            entries_iter = [entries]
        elif isinstance(entries, list):
            entries_iter = entries
        else:
            report.errors.append(
                f"data['{key}'] must be a string or array of strings"
            )
            continue
        for rel in entries_iter:
            if not isinstance(rel, str):
                report.errors.append(
                    f"data['{key}'] entry is not a string: {rel!r}"
                )
                continue
            path = mod_path / rel
            if not path.exists():
                report.errors.append(f"data file referenced by '{key}' not found: {rel}")
            else:
                if path.suffix.lower() == ".json":
                    try:
                        json.loads(path.read_text(encoding="utf-8"))
                    except json.JSONDecodeError as exc:
                        report.errors.append(f"{rel} is not valid JSON: {exc}")


def _validate_total_conversion(meta: dict[str, Any], report: ValidationReport) -> None:
    if not meta.get("total_conversion"):
        return
    manifest = runtime_manifest()
    required: list[str] = (
        manifest.get("modding_contract", {})
        .get("total_conversion", {})
        .get("required_database_keys", [])
    )
    data = meta.get("data") or {}
    for key in required:
        entries = data.get(key)
        if not entries:
            report.errors.append(
                f"total_conversion=true but data['{key}'] is missing (required for TC mods)"
            )


def validate_json_file(path: Path) -> tuple[bool, str]:
    """Return (ok, message) for a single JSON file."""
    path = Path(path)
    if not path.exists():
        return False, f"file not found: {path}"
    try:
        json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return False, f"invalid JSON: {exc}"
    except OSError as exc:
        return False, f"cannot read: {exc}"
    return True, "JSON is valid"
