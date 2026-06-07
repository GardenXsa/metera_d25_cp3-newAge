"""Helpers for the agent's ``*_data`` tools.

The agent never writes a JSON string. It passes Python data
(dicts, lists, scalars) and this module:

* loads and parses the file,
* applies the merge policy declared in ``runtime_manifest.json``,
* validates required fields and the shape of arrays vs. objects,
* writes the result back through ``json.dumps(..., indent=2)``.

If something is wrong the helper returns a result with a list of
warnings/errors so the LLM can react.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from modkit import docs as docs_index
from modkit.paths import safe_join


MERGE_DEEP_MERGE = "deepMerge"
MERGE_APPEND = "append"
MERGE_APPEND_UNIQUE = "appendUnique"
MERGE_UPSERT_BY_ID = "upsertById"
MERGE_REPLACE = "replace"

VALID_POLICIES = {
    MERGE_DEEP_MERGE,
    MERGE_APPEND,
    MERGE_APPEND_UNIQUE,
    MERGE_UPSERT_BY_ID,
    MERGE_REPLACE,
}


@dataclass
class DataOp:
    """Result of a structured write operation against a mod data file."""

    ok: bool = True
    path: str = ""
    bytes_written: int = 0
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    action: str = ""  # "created" | "updated" | "appended" | "merged" | "removed"
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "path": self.path,
            "bytes_written": self.bytes_written,
            "warnings": list(self.warnings),
            "errors": list(self.errors),
            "action": self.action,
            **({"extra": self.extra} if self.extra else {}),
        }


# ── manifest access ─────────────────────────────────────────────────


def manifest_entry(database_key: str) -> dict[str, Any]:
    """Return the manifest entry for a database key, or {} if unknown."""
    manifest = docs_index.runtime_manifest()
    files = manifest.get("database_files", {})
    return dict(files.get(database_key) or {})


def contract_for(database_key: str) -> dict[str, Any]:
    manifest = docs_index.runtime_manifest()
    return dict(manifest.get("contracts", {}).get(database_key) or {})


def default_type_for(database_key: str) -> str:
    entry = manifest_entry(database_key)
    return str(entry.get("default_type") or "object")


def merge_policy_for(database_key: str) -> str:
    entry = manifest_entry(database_key)
    policy = str(entry.get("merge_policy") or MERGE_DEEP_MERGE)
    if policy not in VALID_POLICIES:
        return MERGE_DEEP_MERGE
    return policy


def list_database_keys() -> list[str]:
    manifest = docs_index.runtime_manifest()
    files = manifest.get("database_files") or {}
    return sorted(files.keys())


# ── path resolution ─────────────────────────────────────────────────


def resolve_data_path(mod_root: Path, database_key: str, rel: str | None = None) -> Path:
    """Resolve the on-disk path for a database key.

    Priority:
    1. ``rel`` (explicit override).
    2. ``mod.json`` ``data[database_key]`` entry, first element.
    3. ``<key>.json`` under ``data/``.
    """
    if rel:
        return safe_join(mod_root, rel)
    descriptor = _read_descriptor(mod_root)
    data = descriptor.get("data") or {}
    if isinstance(data.get(database_key), list) and data[database_key]:
        return safe_join(mod_root, str(data[database_key][0]))
    if isinstance(data.get(database_key), str):
        return safe_join(mod_root, str(data[database_key]))
    return safe_join(mod_root, f"data/{database_key}.json")


def _read_descriptor(mod_root: Path) -> dict[str, Any]:
    path = mod_root / "mod.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


# ── read / write helpers ────────────────────────────────────────────


def read_data_file(path: Path) -> Any:
    if not path.exists():
        return None
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    if not text.strip():
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def write_data_file(path: Path, data: Any) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    path.write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))


def write_atomic(path: Path, data: Any) -> int:
    """Write to ``<path>.tmp`` then rename, leaving a ``.bak`` of the
    previous content if one existed. Returns the byte count of the
    new file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        try:
            backup = path.read_bytes()
            (path.with_suffix(path.suffix + ".bak")).write_bytes(backup)
        except OSError:
            pass
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)
    return len(text.encode("utf-8"))


# ── structural validation ───────────────────────────────────────────


def validate_shape(database_key: str, data: Any, op: DataOp) -> None:
    """Light-touch validation: just check that the on-disk type matches
    the manifest's ``default_type`` (object vs. array). Full field-level
    schema isn't published in ``runtime_manifest.json`` for most keys."""
    expected = default_type_for(database_key)
    if expected == "array":
        if not isinstance(data, list):
            op.warnings.append(
                f"database key '{database_key}' is declared as an array, "
                f"but the file contains {type(data).__name__}"
            )
    elif expected == "object":
        if not isinstance(data, dict):
            op.warnings.append(
                f"database key '{database_key}' is declared as an object, "
                f"but the file contains {type(data).__name__}"
            )


def validate_required_fields(database_key: str, item: dict[str, Any], op: DataOp) -> None:
    """For keys with a published contract, check required fields.

    The contract only declares requirements for ``items`` today, but
    this is wired up so that adding more to ``runtime_manifest.json``
    automatically benefits from the check.
    """
    contract = contract_for(database_key)
    required = contract.get("required_fields") or []
    if not required or not isinstance(item, dict):
        return
    for field_name in required:
        if field_name not in item:
            op.warnings.append(
                f"item is missing required field '{field_name}'"
            )
        elif item[field_name] in (None, "", [], {}):
            op.warnings.append(
                f"item has empty required field '{field_name}'"
            )


# ── merge operations ────────────────────────────────────────────────


def merge_upsert(
    existing: Any,
    payload: Any,
    policy: str,
    id_field: str = "id",
) -> tuple[Any, str, list[str]]:
    """Apply the manifest's merge policy to combine ``existing`` with
    ``payload``. Returns (new_data, action, warnings)."""
    warnings: list[str] = []

    if policy == MERGE_REPLACE:
        return _coerce(payload, policy), "replaced", warnings

    if policy == MERGE_DEEP_MERGE:
        if not isinstance(existing, dict):
            existing = {}
        if not isinstance(payload, dict):
            warnings.append(f"deepMerge expected an object, got {type(payload).__name__}; ignored")
            return existing, "kept", warnings
        return _deep_merge(existing, payload), "merged", warnings

    if policy == MERGE_APPEND:
        if not isinstance(existing, list):
            existing = []
        if not isinstance(payload, list):
            payload = [payload]
        return existing + list(payload), "appended", warnings

    if policy == MERGE_APPEND_UNIQUE:
        if not isinstance(existing, list):
            existing = []
        if not isinstance(payload, list):
            payload = [payload]
        seen = {_hashable(x) for x in existing}
        out = list(existing)
        added = 0
        for item in payload:
            key = _hashable(item)
            if key not in seen:
                seen.add(key)
                out.append(item)
                added += 1
        return out, f"appended_unique({added})", warnings

    if policy == MERGE_UPSERT_BY_ID:
        if not isinstance(existing, list):
            existing = []
        if not isinstance(payload, list):
            payload = [payload]
        index: dict[str, int] = {}
        for i, item in enumerate(existing):
            if isinstance(item, dict) and id_field in item:
                index[str(item[id_field])] = i
        created = 0
        updated = 0
        for item in payload:
            if not isinstance(item, dict) or id_field not in item:
                warnings.append(
                    f"upsertById skipped item without '{id_field}' field: {item!r}"
                )
                continue
            key = str(item[id_field])
            if key in index:
                existing[index[key]] = item
                updated += 1
            else:
                existing.append(item)
                index[key] = len(existing) - 1
                created += 1
        return existing, f"upsert(created={created},updated={updated})", warnings

    warnings.append(f"unknown merge policy '{policy}', used deepMerge as fallback")
    return _deep_merge(existing if isinstance(existing, dict) else {}, payload if isinstance(payload, dict) else {}), "merged", warnings


def _coerce(data: Any, policy: str) -> Any:
    if policy == MERGE_DEEP_MERGE and not isinstance(data, dict):
        return {}
    if policy in (MERGE_APPEND, MERGE_APPEND_UNIQUE, MERGE_UPSERT_BY_ID) and not isinstance(data, list):
        return []
    return data


def _deep_merge(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for k, v in overlay.items():
        if (
            k in out
            and isinstance(out[k], dict)
            and isinstance(v, dict)
        ):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def _hashable(value: Any) -> Any:
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return value


# ── field-level updates ─────────────────────────────────────────────


_FIELD_PATH_RE = re.compile(r"([^.\[\]]+)|\[(\d+)\]")


def set_field_path(root: Any, path: str, value: Any) -> tuple[bool, str]:
    """Set ``root[<path>] = value`` where ``path`` is a dotted/bracketed
    string like ``tags[2]`` or ``names_by_era.rebirth``. Returns
    (changed, resolved_path)."""
    if not path:
        return False, ""
    tokens = _tokenize_path(path)
    if not tokens:
        return False, ""
    target = root
    for token in tokens[:-1]:
        if isinstance(target, list):
            try:
                idx = int(token)
            except ValueError:
                return False, ""
            if idx < 0 or idx >= len(target):
                return False, ""
            target = target[idx]
        elif isinstance(target, dict):
            if token not in target:
                return False, ""
            target = target[token]
        else:
            return False, ""
    last = tokens[-1]
    if isinstance(target, list):
        try:
            idx = int(last)
        except ValueError:
            return False, ""
        if idx < 0 or idx >= len(target):
            return False, ""
        target[idx] = value
    elif isinstance(target, dict):
        target[last] = value
    else:
        return False, ""
    return True, ".".join(tokens)


def _tokenize_path(path: str) -> list[str]:
    tokens: list[str] = []
    for match in _FIELD_PATH_RE.finditer(path):
        ident, idx = match.groups()
        tokens.append(idx or ident)
    return tokens


# ── item id resolution ──────────────────────────────────────────────


def find_item_by_id(data: Any, item_id: str, id_field: str = "id") -> tuple[int, dict[str, Any]] | None:
    """Locate an item by id in either an array of objects or an object
    of objects. Returns (index, item) or None."""
    if isinstance(data, list):
        for i, item in enumerate(data):
            if isinstance(item, dict) and str(item.get(id_field)) == str(item_id):
                return i, item
        return None
    if isinstance(data, dict):
        if item_id in data and isinstance(data[item_id], dict):
            return -1, data[item_id]
        for k, v in data.items():
            if isinstance(v, dict) and str(v.get(id_field)) == str(item_id):
                return -1, v
    return None


# ── high-level operations ───────────────────────────────────────────


def load_typed(mod_root: Path, database_key: str) -> tuple[Path | None, Any, str]:
    """Load a data file and announce its declared type.

    Returns (path, data, default_type) where path is None if the file
    does not exist yet. ``data`` is the freshly-deserialised value
    (None when the file is absent or empty)."""
    path = resolve_data_path(mod_root, database_key)
    if not path.exists():
        return path, None, default_type_for(database_key)
    data = read_data_file(path)
    if data is None:
        return path, None, default_type_for(database_key)
    return path, data, default_type_for(database_key)


def initial_value(database_key: str) -> Any:
    """Return the empty value of the right type for a fresh data file."""
    dtype = default_type_for(database_key)
    return [] if dtype == "array" else {}


def apply_structured_update(
    mod_root: Path,
    database_key: str,
    payload: Any,
) -> DataOp:
    """Apply the manifest's merge policy and write the result.

    The ``payload`` is whatever the LLM passed — a single item, a list
    of items, an object, etc. We use :func:`merge_upsert` to combine
    it with whatever already exists, validate shape, and write back.

    A list of items is normalised before merging so that
    ``deepMerge``-policy keys (which expect an object) still get the
    items folded in by their ``id``. This makes ``add_data_items`` /
    ``set_data_item`` work uniformly for object and array policies.
    """
    op = DataOp(action="updated")
    path, existing, _ = load_typed(mod_root, database_key)
    if path is None:
        path = resolve_data_path(mod_root, database_key)
    if existing is None:
        existing = initial_value(database_key)
    policy = merge_policy_for(database_key)
    payload = _normalise_payload(payload, policy)
    new_data, action, warnings = merge_upsert(existing, payload, policy)
    op.warnings.extend(warnings)
    op.action = action
    validate_shape(database_key, new_data, op)
    if isinstance(new_data, list):
        for item in new_data:
            validate_required_fields(database_key, item, op)
    elif isinstance(new_data, dict):
        for v in new_data.values():
            if isinstance(v, dict):
                validate_required_fields(database_key, v, op)
    op.ok = True
    op.path = str(path.relative_to(mod_root))
    op.bytes_written = write_atomic(path, new_data)
    return op


def _normalise_payload(payload: Any, policy: str) -> Any:
    """Make a list-of-items payload play nicely with any merge policy.

    * For ``deepMerge`` (object default) the payload must be a dict. A
      list of items is folded into ``{id: item}`` using each item's
      ``id`` field; items missing ``id`` are dropped with a warning
      (but we don't have a place to surface that here, so we just
      skip them — the higher-level tool reports the count).
    * For ``append``/``appendUnique``/``upsertById`` (array default)
      the payload must be a list; a single object is wrapped.
    * ``replace`` is a pass-through.
    """
    if not isinstance(payload, list):
        return payload
    if policy == MERGE_DEEP_MERGE:
        out: dict[str, Any] = {}
        for item in payload:
            if isinstance(item, dict) and "id" in item:
                key = str(item["id"])
                if key in out:
                    out[key] = _deep_merge(out[key], item)
                else:
                    out[key] = item
            else:
                # Try to use the item itself as a value: drop the
                # 'id' field so it doesn't get merged as a key.
                if isinstance(item, dict) and "id" in item:
                    cloned = {k: v for k, v in item.items() if k != "id"}
                    out.setdefault(str(item["id"]), cloned)
        return out
    return payload


def apply_set_item(
    mod_root: Path,
    database_key: str,
    item_id: str,
    item: dict[str, Any],
) -> DataOp:
    """Upsert a single item, identified by ``item_id``."""
    op = DataOp()
    if not isinstance(item, dict):
        op.ok = False
        op.errors.append("'value' must be an object")
        return op
    item = dict(item)
    item.setdefault("id", item_id)
    if str(item.get("id")) != str(item_id):
        op.warnings.append(
            f"value's id field '{item.get('id')}' does not match requested id '{item_id}'"
        )
    op = apply_structured_update(mod_root, database_key, [item])
    op.action = "updated" if op.action.startswith("upsert") else op.action
    return op


def apply_update_field(
    mod_root: Path,
    database_key: str,
    item_id: str,
    field_path: str,
    value: Any,
) -> DataOp:
    """Update a single field on a single item without rewriting the
    whole file."""
    op = DataOp()
    path, data, _ = load_typed(mod_root, database_key)
    if path is None or data is None:
        op.ok = False
        op.errors.append(f"data file for '{database_key}' does not exist yet")
        return op
    found = find_item_by_id(data, item_id)
    if found is None:
        op.ok = False
        op.errors.append(f"item with id '{item_id}' not found in {database_key}")
        return op
    _, item = found
    changed, resolved = set_field_path(item, field_path, value)
    if not changed:
        op.ok = False
        op.errors.append(
            f"field path '{field_path}' could not be resolved in item '{item_id}'"
        )
        return op
    validate_required_fields(database_key, item, op)
    op.action = "field_updated"
    op.path = str(path.relative_to(mod_root))
    op.extra = {"item_id": item_id, "field": resolved}
    op.bytes_written = write_atomic(path, data)
    return op


def apply_remove_item(
    mod_root: Path,
    database_key: str,
    item_id: str,
) -> DataOp:
    """Remove a single item from a data file."""
    op = DataOp()
    path, data, _ = load_typed(mod_root, database_key)
    if path is None or data is None:
        op.ok = False
        op.errors.append(f"data file for '{database_key}' does not exist yet")
        return op
    if isinstance(data, list):
        before = len(data)
        data[:] = [x for x in data if not (isinstance(x, dict) and str(x.get("id")) == str(item_id))]
        if len(data) == before:
            op.ok = False
            op.errors.append(f"item '{item_id}' not found in {database_key}")
            return op
    elif isinstance(data, dict):
        if item_id in data:
            del data[item_id]
        else:
            op.ok = False
            op.errors.append(f"key '{item_id}' not found in {database_key}")
            return op
    else:
        op.ok = False
        op.errors.append(f"unsupported data type: {type(data).__name__}")
        return op
    op.action = "removed"
    op.path = str(path.relative_to(mod_root))
    op.extra = {"item_id": item_id}
    op.bytes_written = write_atomic(path, data)
    return op


def apply_patch_mod_json(mod_root: Path, patch: dict[str, Any]) -> DataOp:
    """Deep-merge a patch into ``mod.json``."""
    op = DataOp()
    if not isinstance(patch, dict):
        op.ok = False
        op.errors.append("'patch' must be an object")
        return op
    path = mod_root / "mod.json"
    if not path.exists():
        op.ok = False
        op.errors.append("mod.json does not exist")
        return op
    try:
        descriptor = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        op.ok = False
        op.errors.append(f"cannot read mod.json: {exc}")
        return op
    merged = _deep_merge(descriptor, patch)
    op.action = "patched"
    op.path = "mod.json"
    op.bytes_written = write_atomic(path, merged)
    return op


# ── validation ──────────────────────────────────────────────────────


def validate_data_file(database_key: str, path: Path) -> DataOp:
    op = DataOp()
    if not path.exists():
        op.ok = False
        op.errors.append(f"file not found: {path}")
        return op
    data = read_data_file(path)
    if data is None:
        op.ok = False
        op.errors.append(f"file is empty or not valid JSON: {path}")
        return op
    validate_shape(database_key, data, op)
    if isinstance(data, list):
        for i, item in enumerate(data):
            if not isinstance(item, dict):
                op.warnings.append(f"item {i} is not an object")
                continue
            validate_required_fields(database_key, item, op)
    elif isinstance(data, dict):
        for k, v in data.items():
            if isinstance(v, dict):
                validate_required_fields(database_key, v, op)
    op.action = "validated"
    op.path = str(path)
    return op
