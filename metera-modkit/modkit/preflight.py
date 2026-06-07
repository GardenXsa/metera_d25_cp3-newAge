"""Port of ``ModLoader.js`` preflight to Python.

The JavaScript ModLoader runs a two-step check on every mod before
activating it:

  * :func:`validate_mod_meta`         — mirror of ``_validateModMeta`` (line 83-93)
  * :func:`validate_declarative_mod_data` — mirror of ``_validateDeclarativeModData`` (line 1105-1277)

This module replicates both **line-for-line** in Python, including the
exact error string format. The error messages are kept identical so
the agent (and any downstream tooling) can match them against the
JS console output from the Electron app without translation.

The file-resolution logic mirrors ``mods-read-file`` in ``main.js``
(line 1123) — try ``<mods_root>/<mod>/<file>`` first, fall back to
``<mods_root>/<mod>/data/<file>``.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

# ── Tiny JS helpers ────────────────────────────────────────────────────


def is_object(item: Any) -> bool:
    """Mirror of ``function isObject(item)`` at ModLoader.js:26-28.

    JS: ``return (item && typeof item === 'object' && !Array.isArray(item));``

    Note: ``{}`` is truthy in JavaScript, so this returns ``True`` for an
    empty dict in Python — only ``None`` is treated as "missing".
    """
    return item is not None and isinstance(item, dict) and not isinstance(item, list)


# From ModLoader.js:83-93
def validate_mod_meta(mod_meta: dict[str, Any] | None) -> list[str]:
    errors: list[str] = []
    if not is_object(mod_meta):
        return ['Missing or invalid "mod" object']
    if not mod_meta.get("id") or not isinstance(mod_meta["id"], str):
        errors.append('Missing or invalid "id"')
    if not mod_meta.get("name") or not isinstance(mod_meta["name"], str):
        errors.append('Missing or invalid "name"')
    if not mod_meta.get("version") or not isinstance(mod_meta["version"], str):
        errors.append('Missing or invalid "version"')
    mod_id = mod_meta.get("id")
    if mod_id is not None and not re.match(r"^[a-z0-9_]+$", str(mod_id)):
        errors.append('"id" must be lowercase alphanumeric + underscore only')
    if "dependencies" in mod_meta and not isinstance(mod_meta["dependencies"], list):
        errors.append('"dependencies" must be an array')
    if "scripts" in mod_meta and not isinstance(mod_meta["scripts"], list):
        errors.append('"scripts" must be an array')
    if "total_conversion" in mod_meta and not isinstance(mod_meta["total_conversion"], bool):
        errors.append('"total_conversion" must be a boolean')
    return errors


# Mirror of the ``mods-read-file`` IPC handler in main.js:1123-1149.
# Returns ``(ok, content, error_message)`` so the caller can build the
# same ``{success, content} | {success: false, error}`` payload the JS
# code expects from ``modsReadFile``.
def read_mod_file_strict(
    mod: dict[str, Any],
    file_name: str,
    mods_root: Path,
) -> tuple[bool, str | None, str | None]:
    mod_folder = (mod.get("folder") or mod.get("id") or "").strip()
    if not mod_folder:
        return False, None, "mod has no folder or id"
    safe_mod_folder = re.sub(r"^(\.\.[/\\])+", "", str(mod_folder).replace("\\", "/"))
    safe_file_name = re.sub(r"^(\.\.[/\\])+", "", str(file_name).replace("\\", "/"))
    try:
        root_resolved = mods_root.resolve()
    except (OSError, ValueError):
        return False, None, f"cannot resolve mods root {mods_root}"
    candidates = [mods_root / safe_mod_folder / safe_file_name,
                  mods_root / safe_mod_folder / "data" / safe_file_name]
    for full_path in candidates:
        try:
            resolved = full_path.resolve()
        except (OSError, ValueError):
            continue
        try:
            resolved.relative_to(root_resolved)
        except ValueError:
            return False, None, "Access denied"
        if resolved.is_file():
            try:
                return True, resolved.read_text(encoding="utf-8"), None
            except OSError as exc:
                return False, None, str(exc)
    return False, None, f"missing mod file {safe_file_name}: File not found (ENOENT)"


# From ModLoader.js:1094-1103
def collect_item_ids(items_data: Any) -> set[str]:
    if not items_data:
        return set()
    if isinstance(items_data, list):
        return {item["id"] for item in items_data
                if isinstance(item, dict) and item.get("id")}
    if isinstance(items_data, dict):
        return set(items_data.keys())
    return set()


STAT_KEYS: tuple[str, ...] = ("str", "dex", "int", "con", "cha", "res")


def _is_finite_number(value: Any) -> bool:
    if isinstance(value, bool):  # bool is a subclass of int — reject
        return False
    if isinstance(value, (int, float)):
        return value == value and value not in (float("inf"), float("-inf"))
    if isinstance(value, str):
        try:
            v = float(value)
        except ValueError:
            return False
        return v == v and v not in (float("inf"), float("-inf"))
    return False


def _is_total_conversion_mod(mod: dict[str, Any]) -> bool:
    return bool(
        mod.get("total_conversion")
        or mod.get("totalConversion")
        or mod.get("mod_type") == "total_conversion"
    )


# Mirrors validateRequiredStats in ModLoader.js:1192-1202
def _validate_required_stats(stats: Any, label: str, errors: list[str]) -> None:
    if not is_object(stats):
        errors.append(f"{label} is missing or not an object")
        return
    for key in STAT_KEYS:
        if not _is_finite_number(stats.get(key)):
            errors.append(f"{label}.{key} is missing or not numeric")


# Mirrors validateOptionalStatObject in ModLoader.js:1204-1219
def _validate_optional_stat_object(stats: Any, label: str, errors: list[str]) -> None:
    if stats is None:
        return
    if not is_object(stats):
        errors.append(f"{label} must be an object when present")
        return
    for key, value in stats.items():
        if key not in STAT_KEYS:
            errors.append(f"{label}.{key} is not a known character stat")
            continue
        if not _is_finite_number(value):
            errors.append(f"{label}.{key} is not numeric")


# Mirrors collectArrayData in ModLoader.js:1177-1190
def _collect_array_data(
    file_names: Any,
    parsed_by_file: dict[str, Any],
    out: list[Any],
    label: str,
    errors: list[str],
) -> None:
    for file_name in file_names or []:
        parsed = parsed_by_file.get(file_name)
        if parsed is None:
            continue
        if isinstance(parsed, list):
            out.extend(parsed)
        elif isinstance(parsed, dict):
            for k, v in parsed.items():
                if isinstance(v, dict):
                    out.append({"id": v.get("id") or k, **v})
        else:
            errors.append(f"{label}:{file_name}: expected array or object")


# ── Top-level: port of _validateDeclarativeModData ────────────────────


def validate_declarative_mod_data(
    mod: dict[str, Any],
    mods_root: Path,
) -> list[str]:
    """Run the JS ``declarative data preflight`` on a mod in Python.

    *mod* is the mod descriptor dict (parsed ``mod.json``). Pass
    ``folder=`` to override the on-disk folder name.
    *mods_root* is the parent of the mod folder (the same path that
    the engine gets as ``mods_dir``).
    """
    if not is_object(mod.get("data")):
        return []

    errors: list[str] = []
    parsed_by_file: dict[str, Any] = {}

    # 1. load + JSON-parse every listed file (skip 'lore')
    for raw_key, file_list in mod["data"].items():
        if not isinstance(file_list, list):
            continue
        for file_name in file_list:
            ok, content, err = read_mod_file_strict(mod, str(file_name), mods_root)
            if not ok:
                errors.append(f"{raw_key}:{file_name}: {err}")
                continue
            if raw_key == "lore":
                continue
            try:
                parsed_by_file[str(file_name)] = json.loads(content)
            except json.JSONDecodeError as exc:
                errors.append(f"{raw_key}:{file_name}: {exc}")

    # 2. eras + their default_location_file
    eras: list[dict[str, Any]] = []
    for file_name in mod["data"].get("eras") or []:
        parsed = parsed_by_file.get(str(file_name))
        if isinstance(parsed, list):
            eras.extend(parsed)

    location_files: set[str] = set()
    for f in mod["data"].get("locations") or []:
        f_norm = str(f).replace("\\", "/")
        if f_norm.startswith("data/"):
            f_norm = f_norm[len("data/"):]
        location_files.add(f_norm)

    for era in eras:
        if not isinstance(era, dict) or not era.get("id"):
            continue
        era_id = era["id"]
        default_loc = era.get("default_location_file")
        if not default_loc:
            errors.append(f"eras:{era_id}: missing default_location_file")
            continue
        if default_loc not in location_files:
            errors.append(
                f"eras:{era_id}: default_location_file {default_loc} "
                f"is not listed in mod.data.locations"
            )
        era_path = f"data/{default_loc}"
        ok, content, err = read_mod_file_strict(mod, era_path, mods_root)
        if not ok:
            errors.append(
                f"eras:{era_id}: missing/invalid default location file "
                f"{default_loc}: {err}"
            )
        else:
            try:
                json.loads(content)
            except json.JSONDecodeError as exc:
                errors.append(
                    f"eras:{era_id}: missing/invalid default location file "
                    f"{default_loc}: {exc}"
                )

    # 3. items + tag_defaults
    merged_items: dict[str, Any] = {}
    for file_name in mod["data"].get("items") or []:
        parsed = parsed_by_file.get(str(file_name))
        if isinstance(parsed, list):
            for item in parsed:
                if isinstance(item, dict) and item.get("id"):
                    merged_items[item["id"]] = item
        elif isinstance(parsed, dict):
            merged_items.update(parsed)
    item_ids = collect_item_ids(merged_items)

    for file_name in mod["data"].get("tag_defaults") or []:
        tags = parsed_by_file.get(str(file_name))
        if not isinstance(tags, dict):
            continue
        for key, value in tags.items():
            values = value if isinstance(value, list) else [value]
            for item_id in values:
                if isinstance(item_id, str) and item_id and item_id not in item_ids:
                    errors.append(f"tag_defaults:{key} -> missing item id {item_id}")

    # 4. classes
    is_tc = _is_total_conversion_mod(mod)
    class_entries: list[Any] = []
    race_entries: list[Any] = []
    _collect_array_data(
        mod["data"].get("classes"), parsed_by_file, class_entries, "classes", errors
    )
    _collect_array_data(
        mod["data"].get("races"), parsed_by_file, race_entries, "races", errors
    )

    class_ids: set[str] = set()
    for cls in class_entries:
        if not isinstance(cls, dict):
            errors.append("classes: class entry is not an object")
            continue
        cls_id = cls.get("id")
        if not cls_id or not isinstance(cls_id, str):
            errors.append("classes: class entry without string id")
            continue
        class_ids.add(cls_id)
        _validate_required_stats(
            cls.get("base_stats"), f"classes:{cls_id}.base_stats", errors
        )
        _validate_optional_stat_object(
            cls.get("stat_modifiers"), f"classes:{cls_id}.stat_modifiers", errors
        )
        if "starting_items" in cls:
            si = cls["starting_items"]
            if not is_object(si):
                errors.append(
                    f"classes:{cls_id}.starting_items must be an object "
                    f"{{ itemId: quantity }} when present"
                )
            elif is_tc:
                for item_id in si:
                    if item_id not in item_ids:
                        errors.append(
                            f"classes:{cls_id}.starting_items -> missing item id {item_id}"
                        )

    # 5. races
    for race in race_entries:
        if not isinstance(race, dict):
            errors.append("races: race entry is not an object")
            continue
        race_id = race.get("id")
        if not race_id or not isinstance(race_id, str):
            errors.append("races: race entry without string id")
            continue
        _validate_optional_stat_object(
            race.get("stat_modifiers") or {},
            f"races:{race_id}.stat_modifiers",
            errors,
        )
        if "class_stats" in race:
            cs = race["class_stats"]
            if not is_object(cs):
                errors.append(
                    f"races:{race_id}.class_stats must be an object when present"
                )
                continue
            for class_id, stats in cs.items():
                if class_id != "default" and class_ids and class_id not in class_ids:
                    errors.append(
                        f"races:{race_id}.class_stats references unknown class {class_id}"
                    )
                _validate_optional_stat_object(
                    stats, f"races:{race_id}.class_stats.{class_id}", errors
                )

    return errors


def load_mod_descriptor(mods_root: Path, mod_id: str) -> dict[str, Any] | None:
    """Read ``<mods_root>/<mod_id>/mod.json`` and return the dict.

    The mod is annotated with ``folder=<mod_id>`` so the preflight
    helpers know where to find the data files.
    """
    mod_json = mods_root / mod_id / "mod.json"
    if not mod_json.is_file():
        return None
    try:
        raw = mod_json.read_text(encoding="utf-8-sig")
    except OSError:
        return None
    try:
        meta = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if isinstance(meta, dict):
        meta.setdefault("folder", mod_id)
    return meta


def run_preflight(
    mods_root: Path,
    mod_ids: list[str],
) -> dict[str, dict[str, Any]]:
    """Run meta + declarative preflight on each mod. Return per-mod report.

    The returned dict maps ``mod_id`` to::

        {
            "ok": bool,
            "mod_id": str,
            "mod_path": str,
            "meta_errors": [...],
            "data_errors": [...],
            "disabled": bool,
        }
    """
    reports: dict[str, dict[str, Any]] = {}
    for mod_id in mod_ids:
        mod_path = mods_root / mod_id
        meta = load_mod_descriptor(mods_root, mod_id)
        if meta is None:
            reports[mod_id] = {
                "ok": False,
                "mod_id": mod_id,
                "mod_path": str(mod_path),
                "meta_errors": [f"Cannot read mod.json for {mod_id}"],
                "data_errors": [],
                "disabled": True,
            }
            continue
        meta_errors = validate_mod_meta(meta)
        data_errors = validate_declarative_mod_data(meta, mods_root)
        reports[mod_id] = {
            "ok": not meta_errors and not data_errors,
            "mod_id": mod_id,
            "mod_path": str(mod_path),
            "meta_errors": meta_errors,
            "data_errors": data_errors,
            "disabled": bool(meta_errors or data_errors),
        }
    return reports


__all__ = [
    "STAT_KEYS",
    "collect_item_ids",
    "is_object",
    "load_mod_descriptor",
    "read_mod_file_strict",
    "run_preflight",
    "validate_declarative_mod_data",
    "validate_mod_meta",
]
