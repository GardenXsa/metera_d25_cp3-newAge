"""Mod-management tools: list, create, validate, select, analyze."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from modkit import docs as docs_index
from modkit import mod_inventory
from modkit.permissions import Kind
from modkit.tools.registry import Tool, ToolContext, ToolResult
from modkit.validate import validate_mod as run_validation


MOD_ID_RE = re.compile(r"^[a-z0-9_]+$")


def _list_mods(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    if not ctx.mods_root.exists():
        return ToolResult(ok=True, data={"mods": [], "mods_root": str(ctx.mods_root)})
    mods: list[dict[str, Any]] = []
    for child in sorted(ctx.mods_root.iterdir()):
        if not child.is_dir():
            continue
        meta = {}
        mod_json = child / "mod.json"
        if mod_json.exists():
            try:
                meta = json.loads(mod_json.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                meta = {"_error": "invalid mod.json"}
        mods.append(
            {
                "id": meta.get("id") or child.name,
                "folder": child.name,
                "name": meta.get("name", ""),
                "version": meta.get("version", ""),
                "has_mod_json": mod_json.exists(),
                "is_current": ctx.mod_root is not None
                and ctx.mod_root.resolve() == child.resolve(),
            }
        )
    return ToolResult(
        ok=True,
        data={
            "mods": mods,
            "mods_root": str(ctx.mods_root),
            "count": len(mods),
        },
    )


def _new_mod(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    mod_id = str(args.get("id") or "").strip()
    if not mod_id:
        return ToolResult(ok=False, error="'id' is required")
    if not MOD_ID_RE.match(mod_id):
        return ToolResult(
            ok=False,
            error="'id' must match [a-z0-9_]+ (lowercase ASCII letters, digits, underscores)",
        )
    mod_dir = ctx.mods_root / mod_id
    if mod_dir.exists():
        return ToolResult(ok=False, error=f"mod folder already exists: {mod_dir}")

    template = docs_index.mod_template() or {}
    base_descriptor: dict[str, Any] = dict(template.get("mod_json") or {})
    base_descriptor["id"] = mod_id
    base_descriptor["name"] = str(args.get("name") or mod_id.replace("_", " ").title())
    base_descriptor["author"] = str(args.get("author") or "Unknown")
    base_descriptor["description"] = str(args.get("description") or "")
    base_descriptor.setdefault("version", "1.0.0")
    base_descriptor.setdefault("dependencies", ["base_game"])
    base_descriptor.setdefault("scripts", [])
    base_descriptor.setdefault("data", {})

    if args.get("total_conversion") is True:
        base_descriptor["total_conversion"] = True

    mod_dir.mkdir(parents=True, exist_ok=False)
    (mod_dir / "data").mkdir(exist_ok=True)
    (mod_dir / "mod.json").write_text(
        json.dumps(base_descriptor, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    files_created = ["mod.json", "data/"]
    template_files = template.get("files") or {}
    if base_descriptor["scripts"]:
        for script in base_descriptor["scripts"]:
            script_path = mod_dir / script
            script_path.parent.mkdir(parents=True, exist_ok=True)
            content = template_files.get(script)
            if content is None:
                content = "// auto-generated entry point\n"
            script_path.write_text(content, encoding="utf-8")
            files_created.append(script)

    # Auto-select the newly created mod so subsequent tools work on it.
    ctx.mod_root = mod_dir

    return ToolResult(
        ok=True,
        data={
            "mod_id": mod_id,
            "mod_path": str(mod_dir),
            "files": files_created,
        },
    )


def _validate(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    target_id = str(args.get("mod_id") or "").strip()
    if target_id:
        mod_path = ctx.mods_root / target_id
    elif ctx.mod_root is not None:
        mod_path = ctx.mod_root
    else:
        return ToolResult(
            ok=False,
            error="no mod selected and no mod_id given. Pass mod_id=... or `modkit --mod <id>`.",
        )
    report = run_validation(mod_path)
    return ToolResult(ok=report.ok, data=report.to_dict())


def _select_mod(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    mod_id = str(args.get("id") or args.get("mod_id") or "").strip()
    if not mod_id:
        return ToolResult(ok=False, error="'id' is required")
    target = ctx.mods_root / mod_id
    if not target.exists() or not target.is_dir():
        return ToolResult(ok=False, error=f"mod folder not found: {target}")
    ctx.mod_root = target
    return ToolResult(ok=True, data={"mod_id": mod_id, "mod_path": str(target)})


def _analyze_mod(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    """Authoritative, on-disk inventory of a mod.

    This is the tool to call FIRST whenever the user asks for a
    review, audit, evaluation, summary, or "what's in this mod?"
    The report reads every file, counts items per declared data key,
    flags missing / orphaned files, and includes the contract
    validation report — all in one structured payload.

    The numbers in the result are the ground truth. If your prose
    summary contradicts the inventory, the inventory is right.
    """
    target_id = str(args.get("mod_id") or "").strip()
    if target_id:
        mod_path = ctx.mods_root / target_id
    elif ctx.mod_root is not None:
        mod_path = ctx.mod_root
    else:
        return ToolResult(
            ok=False,
            error="no mod selected and no mod_id given. Pass mod_id=... or `modkit --mod <id>`.",
        )
    report = mod_inventory.build_inventory(mod_path)
    return ToolResult(ok=report.ok, data=report.to_dict())


def build_mod_tools() -> list[Tool]:
    return [
        Tool(
            name="list_mods",
            description="List all mods discovered in the mods directory.",
            parameters={"type": "object", "properties": {}, "additionalProperties": False},
            kind=Kind.READ,
            handler=_list_mods,
        ),
        Tool(
            name="new_mod",
            description=(
                "Scaffold a new mod folder with mod.json and data/. "
                "After this tool succeeds the new mod is automatically selected."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "author": {"type": "string"},
                    "description": {"type": "string"},
                    "total_conversion": {"type": "boolean"},
                },
                "required": ["id"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_new_mod,
        ),
        Tool(
            name="select_mod",
            description="Make an existing mod the active context for subsequent tool calls.",
            parameters={
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_select_mod,
        ),
        Tool(
            name="validate_mod",
            description=(
                "Validate a mod against the Chronicles of Meterea modding contract: "
                "checks mod.json fields, semver, manifest keys, file existence, and JSON. "
                "Without mod_id validates the currently selected mod."
            ),
            parameters={
                "type": "object",
                "properties": {"mod_id": {"type": "string"}},
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_validate,
        ),
        Tool(
            name="analyze_mod",
            description=(
                "Authoritative on-disk inventory of a mod. Reads every file the mod "
                "contains, counts items per declared data key, flags missing/orphaned "
                "files, and bundles the contract validation. Use this as the FIRST "
                "call whenever the user asks for a review, audit, evaluation, "
                "summary, or 'what does this mod have?'. The numbers in the result "
                "are ground truth — your prose summary must match them. Without "
                "mod_id analyzes the currently selected mod."
            ),
            parameters={
                "type": "object",
                "properties": {"mod_id": {"type": "string"}},
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_analyze_mod,
        ),
    ]
