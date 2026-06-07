"""Structured mod-data tools.

The LLM never writes a JSON string. It passes Python data
(dicts, lists, scalars) and these tools:

* locate the right file (declared in ``mod.json -> data`` or default
  to ``data/<key>.json``),
* apply the manifest's merge policy (deepMerge / append /
  appendUnique / upsertById / replace),
* validate required fields when the contract declares them,
* write through ``mod_data.write_atomic`` so a previous version of
  the file is preserved as ``<file>.json.bak``.

All tools require an active mod (``select_mod`` or ``new_mod``).
"""

from __future__ import annotations

from typing import Any

from modkit import mod_data
from modkit.permissions import Kind
from modkit.tools.registry import Tool, ToolContext, ToolResult


def _ok(op: mod_data.DataOp) -> ToolResult:
    return ToolResult(ok=op.ok, data=op.to_dict(), error=("\n".join(op.errors) if not op.ok else ""))


def _require_mod(ctx: ToolContext) -> mod_data.DataOp | None:
    if ctx.mod_root is None:
        return mod_data.DataOp(ok=False, errors=["no mod is selected. Use new_mod or select_mod first."])
    return None


# ── 1. read_data ────────────────────────────────────────────────────


def _read_data(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    key = str(args.get("database_key") or "").strip()
    if not key:
        return ToolResult(ok=False, error="'database_key' is required (e.g. 'items', 'recipes', 'biomes')")
    bad = _require_mod(ctx)
    if bad is not None:
        return _ok(bad)
    if not mod_data.manifest_entry(key):
        return ToolResult(
            ok=False,
            error=f"unknown database key '{key}'. Use data_database_keys to list known keys.",
        )
    path, data, dtype = mod_data.load_typed(ctx.mod_root, key)
    if path is None or data is None:
        op = mod_data.DataOp(ok=True, action="absent", path=f"data/{key}.json")
        op.warnings.append("data file does not exist yet")
        return _ok(op)
    op = mod_data.validate_data_file(key, path)
    return ToolResult(
        ok=True,
        data={
            "database_key": key,
            "path": str(path.relative_to(ctx.mod_root)),
            "merge_policy": mod_data.merge_policy_for(key),
            "default_type": mod_data.default_type_for(key),
            "data": data,
            "warnings": op.warnings,
            "count": len(data) if hasattr(data, "__len__") else 1,
        },
    )


# ── 2. write_data ───────────────────────────────────────────────────


def _write_data(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    key = str(args.get("database_key") or "").strip()
    if not key:
        return ToolResult(ok=False, error="'database_key' is required")
    bad = _require_mod(ctx)
    if bad is not None:
        return _ok(bad)
    payload = args.get("data")
    if payload is None:
        return ToolResult(ok=False, error="'data' is required")
    op = mod_data.apply_structured_update(ctx.mod_root, key, payload)
    return _ok(op)


# ── 3. add_data_items ───────────────────────────────────────────────


def _add_data_items(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    key = str(args.get("database_key") or "").strip()
    if not key:
        return ToolResult(ok=False, error="'database_key' is required")
    bad = _require_mod(ctx)
    if bad is not None:
        return _ok(bad)
    items = args.get("items")
    if items is None:
        items = args.get("item")
    if items is None:
        return ToolResult(ok=False, error="'items' is required (a list of objects, or one object)")
    if not isinstance(items, list):
        items = [items]
    if not all(isinstance(x, dict) for x in items):
        return ToolResult(ok=False, error="'items' must all be objects")
    op = mod_data.apply_structured_update(ctx.mod_root, key, items)
    op.extra = {"requested": len(items)}
    return _ok(op)


# ── 4. set_data_item ────────────────────────────────────────────────


def _set_data_item(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    key = str(args.get("database_key") or "").strip()
    item_id = str(args.get("id") or "").strip()
    if not key:
        return ToolResult(ok=False, error="'database_key' is required")
    if not item_id:
        return ToolResult(ok=False, error="'id' is required")
    bad = _require_mod(ctx)
    if bad is not None:
        return _ok(bad)
    value = args.get("value")
    if not isinstance(value, dict):
        return ToolResult(ok=False, error="'value' must be an object")
    op = mod_data.apply_set_item(ctx.mod_root, key, item_id, value)
    return _ok(op)


# ── 5. update_data_field ────────────────────────────────────────────


def _update_data_field(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    key = str(args.get("database_key") or "").strip()
    item_id = str(args.get("id") or "").strip()
    field_path = str(args.get("field_path") or args.get("field") or "").strip()
    if not key or not item_id or not field_path:
        return ToolResult(
            ok=False,
            error="'database_key', 'id' and 'field_path' are all required",
        )
    bad = _require_mod(ctx)
    if bad is not None:
        return _ok(bad)
    if "value" not in args:
        return ToolResult(ok=False, error="'value' is required")
    op = mod_data.apply_update_field(ctx.mod_root, key, item_id, field_path, args["value"])
    return _ok(op)


# ── 6. remove_data_item ─────────────────────────────────────────────


def _remove_data_item(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    key = str(args.get("database_key") or "").strip()
    item_id = str(args.get("id") or "").strip()
    if not key or not item_id:
        return ToolResult(ok=False, error="'database_key' and 'id' are required")
    bad = _require_mod(ctx)
    if bad is not None:
        return _ok(bad)
    op = mod_data.apply_remove_item(ctx.mod_root, key, item_id)
    return _ok(op)


# ── 7. validate_data ────────────────────────────────────────────────


def _validate_data(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    bad = _require_mod(ctx)
    if bad is not None:
        return _ok(bad)
    key = str(args.get("database_key") or "").strip()
    if key:
        if not mod_data.manifest_entry(key):
            return ToolResult(ok=False, error=f"unknown database key '{key}'")
        path = mod_data.resolve_data_path(ctx.mod_root, key)
        op = mod_data.validate_data_file(key, path)
        return _ok(op)
    # Validate every declared database key that has a registered file.
    ops: list[dict[str, Any]] = []
    for k in mod_data.list_database_keys():
        path = mod_data.resolve_data_path(ctx.mod_root, k)
        if path.exists():
            op = mod_data.validate_data_file(k, path)
            ops.append({"database_key": k, **op.to_dict()})
    return ToolResult(ok=all(o["ok"] for o in ops), data={"results": ops})


# ── 8. data_database_keys ───────────────────────────────────────────


def _data_database_keys(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    rows: list[dict[str, Any]] = []
    for key in mod_data.list_database_keys():
        entry = mod_data.manifest_entry(key)
        rows.append(
            {
                "database_key": key,
                "merge_policy": mod_data.merge_policy_for(key),
                "default_type": mod_data.default_type_for(key),
                "path": entry.get("path"),
                "replace_on_total_conversion": bool(entry.get("replace_on_total_conversion")),
                "load_in_total_conversion": bool(entry.get("load_in_total_conversion")),
            }
        )
    return ToolResult(ok=True, data={"keys": rows, "count": len(rows)})


# ── 9. read_mod_json / update_mod_json (split into two tools) ──────


def _read_mod_json(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    bad = _require_mod(ctx)
    if bad is not None:
        return _ok(bad)
    path = ctx.mod_root / "mod.json"
    if not path.exists():
        return ToolResult(ok=False, error="mod.json does not exist")
    import json as _json
    try:
        data = _json.loads(path.read_text(encoding="utf-8"))
    except (OSError, _json.JSONDecodeError) as exc:
        return ToolResult(ok=False, error=f"cannot parse mod.json: {exc}")
    return ToolResult(ok=True, data={"path": "mod.json", "data": data})


def _update_mod_json(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    bad = _require_mod(ctx)
    if bad is not None:
        return _ok(bad)
    patch = args.get("patch")
    if not isinstance(patch, dict):
        return ToolResult(ok=False, error="'patch' must be an object")
    op = mod_data.apply_patch_mod_json(ctx.mod_root, patch)
    return _ok(op)


# ── registry ────────────────────────────────────────────────────────


def build_data_tools() -> list[Tool]:
    return [
        Tool(
            name="read_data",
            description=(
                "Read a mod's data file (e.g. 'items', 'recipes', 'biomes') as "
                "structured Python data. Returns the parsed object/array, the "
                "manifest's merge_policy / default_type and any schema warnings. "
                "Use this instead of read_file when you need a known data section."
            ),
            parameters={
                "type": "object",
                "properties": {"database_key": {"type": "string"}},
                "required": ["database_key"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_read_data,
        ),
        Tool(
            name="write_data",
            description=(
                "Write a structured payload into a mod's data file. The tool "
                "applies the manifest's merge_policy (deepMerge / append / "
                "appendUnique / upsertById / replace) automatically — you don't "
                "decide how to merge, the tool does. The previous file is "
                "preserved as '<file>.json.bak'."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "database_key": {"type": "string"},
                    "data": {
                        "type": "object",
                        "description": "Python-shaped data: object, list, or scalar matching the manifest's default_type.",
                    },
                },
                "required": ["database_key", "data"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_write_data,
        ),
        Tool(
            name="add_data_items",
            description=(
                "Append or upsert one or more items to a mod's data file. Pass a "
                "list of objects (or one object). For arrays the policy is "
                "append / appendUnique / upsertById depending on the manifest; "
                "for objects the items are deep-merged by id. Items missing the "
                "manifest-declared required fields are accepted but warned about."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "database_key": {"type": "string"},
                    "items": {
                        "type": "array",
                        "items": {"type": "object"},
                        "description": "One item, or a list of items. Each must be a JSON object.",
                    },
                },
                "required": ["database_key", "items"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_add_data_items,
        ),
        Tool(
            name="set_data_item",
            description=(
                "Set or update a single item by id in a mod's data file. The "
                "item's 'id' field is taken from the 'id' argument unless the "
                "value already has an 'id' field that matches. For arrays this "
                "is an upsertById; for objects it's a deep-merge of the value "
                "into data[id]."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "database_key": {"type": "string"},
                    "id": {"type": "string"},
                    "value": {"type": "object"},
                },
                "required": ["database_key", "id", "value"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_set_data_item,
        ),
        Tool(
            name="update_data_field",
            description=(
                "Update a single field on a single item without rewriting the "
                "rest of the file. 'field_path' is a dotted/bracketed path like "
                "'tags[2]', 'names_by_era.rebirth' or 'properties.damage'. The "
                "previous file is preserved as '<file>.json.bak'."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "database_key": {"type": "string"},
                    "id": {"type": "string"},
                    "field_path": {"type": "string"},
                    "value": {},
                },
                "required": ["database_key", "id", "field_path", "value"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_update_data_field,
        ),
        Tool(
            name="remove_data_item",
            description=(
                "Remove a single item by id from a mod's data file. For arrays "
                "this drops the entry; for objects this deletes the key. The "
                "previous file is preserved as '<file>.json.bak'."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "database_key": {"type": "string"},
                    "id": {"type": "string"},
                },
                "required": ["database_key", "id"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_remove_data_item,
        ),
        Tool(
            name="validate_data",
            description=(
                "Schema-light validation of one or all mod data files: shape "
                "(array vs object) and required-fields declared in the manifest. "
                "Without 'database_key' validates every file that has a path in "
                "the manifest and exists on disk."
            ),
            parameters={
                "type": "object",
                "properties": {"database_key": {"type": "string"}},
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_validate_data,
        ),
        Tool(
            name="data_database_keys",
            description=(
                "List every database key declared in runtime_manifest.json, with "
                "its merge_policy, default_type, on-disk path and TC flags. Use "
                "this when you don't know which key to use."
            ),
            parameters={"type": "object", "properties": {}, "additionalProperties": False},
            kind=Kind.READ,
            handler=_data_database_keys,
        ),
        Tool(
            name="read_mod_json",
            description=(
                "Read the active mod's mod.json as structured Python data. Use "
                "this instead of read_file when you want to inspect dependencies, "
                "data section registration, version, etc."
            ),
            parameters={"type": "object", "properties": {}, "additionalProperties": False},
            kind=Kind.READ,
            handler=_read_mod_json,
        ),
        Tool(
            name="update_mod_json",
            description=(
                "Deep-merge a patch object into the active mod's mod.json. Use "
                "this to register a new data file, e.g. "
                "update_mod_json({'data': {'items': ['data/items.json']}}). The "
                "previous mod.json is preserved as 'mod.json.bak'."
            ),
            parameters={
                "type": "object",
                "properties": {"patch": {"type": "object"}},
                "required": ["patch"],
                "additionalProperties": False,
            },
            kind=Kind.EDIT,
            handler=_update_mod_json,
        ),
    ]
