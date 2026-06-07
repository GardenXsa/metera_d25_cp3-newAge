"""Index of Chronicles of Meterea modding docs.

We parse ``resources/README.md`` once at startup and split it into
markdown sections. Each section has:

* ``id`` — slug derived from the heading (e.g. ``6.6-biomes``)
* ``number`` — section number like ``6.6`` (optional)
* ``title`` — original heading text
* ``level`` — heading depth (2 = ``##``, 3 = ``###`` ...)
* ``body`` — text from the heading up to the next equal-or-shallower one

We also expose ``resources/runtime_manifest.json`` (parsed) so callers
have a single place to look up merge policies / required fields.

The module is consumed by ``modkit.tools.docs`` to expose
``docs_search``, ``docs_section`` and ``schema_lookup`` as agent tools.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, asdict
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

from modkit.paths import resources_dir


HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*$")
NUMBER_RE = re.compile(r"^(\d+(?:\.\d+)*)\.?\s+(.*)$")
SLUG_RE = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class Section:
    id: str
    title: str
    number: str
    level: int
    body: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _slugify(title: str) -> str:
    raw = title.strip().lower()
    # Drop emojis / decorative chars by keeping ASCII alnum and basic Cyrillic.
    raw = re.sub(r"[^\w\s-]", "", raw, flags=re.UNICODE)
    raw = SLUG_RE.sub("-", raw)
    return raw.strip("-")


def _parse_sections(markdown: str) -> list[Section]:
    lines = markdown.splitlines()
    headings: list[tuple[int, int, str, str]] = []  # (line_idx, level, number, title)
    for idx, line in enumerate(lines):
        m = HEADING_RE.match(line)
        if not m:
            continue
        level = len(m.group(1))
        raw_title = m.group(2).strip()
        n_match = NUMBER_RE.match(raw_title)
        if n_match:
            number = n_match.group(1)
            title = n_match.group(2).strip()
        else:
            number = ""
            title = raw_title
        headings.append((idx, level, number, title))

    sections: list[Section] = []
    for i, (start_idx, level, number, title) in enumerate(headings):
        end_idx = len(lines)
        for j in range(i + 1, len(headings)):
            next_level = headings[j][1]
            if next_level <= level:
                end_idx = headings[j][0]
                break
        body = "\n".join(lines[start_idx:end_idx]).rstrip()
        slug = _slugify(title)
        section_id = f"{number}-{slug}" if number else slug
        if not section_id:
            section_id = f"section-{i}"
        sections.append(
            Section(
                id=section_id,
                title=title,
                number=number,
                level=level,
                body=body,
            )
        )
    return sections


@lru_cache(maxsize=1)
def _load_readme() -> str:
    path = resources_dir() / "README.md"
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


@lru_cache(maxsize=1)
def all_sections() -> tuple[Section, ...]:
    return tuple(_parse_sections(_load_readme()))


@lru_cache(maxsize=1)
def runtime_manifest() -> dict[str, Any]:
    path = resources_dir() / "runtime_manifest.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def runtime_manifest_keys() -> tuple[str, ...]:
    """Return the sorted list of database keys declared in the manifest."""
    manifest = runtime_manifest()
    files = manifest.get("database_files") or manifest.get("database_keys") or {}
    return tuple(sorted(files.keys()))


@lru_cache(maxsize=1)
def mod_template() -> dict[str, Any]:
    path = resources_dir() / "mod_template.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def find_section(query: str) -> Section | None:
    """Locate a single section by id, number, or partial title match."""
    if not query:
        return None
    q = query.strip().lower()
    for section in all_sections():
        if section.id.lower() == q or section.number == query:
            return section
    for section in all_sections():
        if q in section.title.lower():
            return section
    for section in all_sections():
        if q in section.id.lower():
            return section
    return None


def find_sections(query: str) -> list[Section]:
    """Return all sections whose id / title contains the query, in order."""
    if not query:
        return []
    q = query.strip().lower()
    out: list[Section] = []
    for section in all_sections():
        if q in section.id.lower() or q in section.title.lower():
            out.append(section)
    return out


def search(
    query: str,
    *,
    limit: int = 5,
    max_snippet_chars: int = 800,
) -> list[dict[str, Any]]:
    """Naive token-based search across section titles + bodies.

    Returns up to ``limit`` matches ordered by score, each with a
    short snippet so the agent doesn't pay for the entire section
    body up front. The agent can follow up with ``docs_section`` for
    full content.
    """
    if not query or not query.strip():
        return []

    tokens = [t for t in re.split(r"\W+", query.lower(), flags=re.UNICODE) if t]
    if not tokens:
        return []

    scored: list[tuple[float, Section, int]] = []
    for section in all_sections():
        title_l = section.title.lower()
        body_l = section.body.lower()
        score = 0.0
        first_hit = -1
        for token in tokens:
            in_title = title_l.count(token)
            in_body = body_l.count(token)
            if in_title:
                score += 5.0 * in_title
            if in_body:
                score += 1.0 * in_body
            if first_hit < 0:
                pos = body_l.find(token)
                if pos >= 0:
                    first_hit = pos
        if score == 0.0:
            continue
        scored.append((score, section, max(first_hit, 0)))

    scored.sort(key=lambda item: item[0], reverse=True)
    results: list[dict[str, Any]] = []
    for score, section, hit_at in scored[:limit]:
        snippet = _snippet(section.body, hit_at, max_snippet_chars)
        results.append(
            {
                "id": section.id,
                "number": section.number,
                "title": section.title,
                "level": section.level,
                "score": round(score, 2),
                "snippet": snippet,
            }
        )
    return results


def _snippet(body: str, around: int, max_chars: int) -> str:
    if len(body) <= max_chars:
        return body
    half = max_chars // 2
    start = max(0, around - half)
    end = min(len(body), start + max_chars)
    start = max(0, end - max_chars)
    snippet = body[start:end]
    if start > 0:
        snippet = "..." + snippet
    if end < len(body):
        snippet = snippet + "..."
    return snippet


# ── Schema lookup ─────────────────────────────────────────────────────────

# Section in README.md that documents each database key. Keys are
# normalised manifest keys.
_SCHEMA_HINTS: dict[str, str] = {
    "items": "6.1",
    "recipes": "6.2",
    "races": "6.3",
    "classes": "6.4",
    "eras": "6.5",
    "biomes": "6.6",
    "monsters": "6.7",
    "professions": "6.8",
    "traits": "6.9",
    "npc_names": "6.10",
    "faction_relations": "6.11",
    "diplomacy": "6.12",
    "casus_belli": "6.13",
    "building_types": "6.14",
    "world_config": "6.15",
    "locations": "6.16",
    "equipment_slots": "6.17",
    "tag_defaults": "6.18",
    "narrators": "6.19",
    "prompt_pack": "6.20",
    "map_markers": "6.21",
    "tile_dictionary": "6.22",
    "ship_types": "6.23",
    "transport_registry": "6.24",
    "trek_config": "6.25",
    "container_types": "6.26",
    "system_containers": "6.26",
    "furniture_catalog": "6.27",
    "item_descriptions": "6.28",
    "news_categories": "6.29",
    "intent_registry": "6.30",
    "visual_assets": "6.31",
    "visual_asset_packs": "6.31",
    "scene_visual_rules": "6.31",
    "ui_runtime": "6.32",
    "prompt_runtime": "6.32",
    "gameplay_runtime": "6.32",
    "electron_runtime": "6.32",
}


def schema_lookup(database_key: str) -> dict[str, Any]:
    """Return metadata for a database key: manifest entry, contract, doc section."""
    manifest = runtime_manifest()
    db_files: dict[str, Any] = manifest.get("database_files", {})
    entry = db_files.get(database_key)
    contracts: dict[str, Any] = manifest.get("contracts", {})
    payload: dict[str, Any] = {
        "key": database_key,
        "known": entry is not None,
    }
    if entry:
        payload["manifest"] = entry
    if database_key in contracts:
        payload["contract"] = contracts[database_key]

    doc_id = _SCHEMA_HINTS.get(database_key)
    section: Section | None = None
    if doc_id:
        section = find_section(doc_id)
    if section is None:
        section = find_section(database_key)
    if section is not None:
        payload["doc_section_id"] = section.id
        payload["doc_section_title"] = section.title
        payload["doc_body"] = section.body[:4000]
    return payload


def cheatsheet() -> str:
    """Short reference embedded into the agent system prompt.

    Intentionally compact (~700 tokens) — agents call ``schema_lookup``
    or ``docs_search`` for the deep details.
    """
    manifest = runtime_manifest()
    db_files: dict[str, Any] = manifest.get("database_files", {})
    contract = manifest.get("modding_contract", {})
    required = contract.get("total_conversion", {}).get("required_database_keys", [])
    merge_policies = contract.get("merge_policies", [])

    rows: list[str] = []
    for key in sorted(db_files.keys()):
        info = db_files[key]
        policy = info.get("merge_policy", "?")
        dtype = info.get("default_type", "?")
        rows.append(f"  {key:24s}  type={dtype:6s}  merge={policy}")

    return (
        "Chronicles of Meterea modding — quick reference\n"
        "================================================\n"
        "Mod folder layout (lives in the user's mods dir, NOT inside the game folder):\n"
        "  <mods>/<mod_id>/mod.json          required descriptor\n"
        "  <mods>/<mod_id>/data/*.json       data sections\n"
        "  <mods>/<mod_id>/data/main.js      optional JS script\n"
        "  <mods>/<mod_id>/assets/*          optional assets\n"
        "\n"
        "mod.json minimum:\n"
        "  id          [a-z0-9_]+, matches folder name\n"
        "  name        human-readable\n"
        "  version     semver (e.g. 1.0.0)\n"
        "  author      author name\n"
        "  description short text\n"
        "  dependencies [\"base_game\"] usually\n"
        "  data        { \"<db_key>\": [\"data/<file>.json\"], ... }\n"
        "\n"
        f"Merge policies: {', '.join(merge_policies) or 'deepMerge, append, appendUnique, upsertById, replace'}\n"
        f"Total-Conversion required keys: {', '.join(required) or 'items, eras, classes, races, biomes, world_config, tag_defaults'}\n"
        "\n"
        "Database keys (from runtime_manifest.json):\n"
        + "\n".join(rows)
        + "\n\n"
        "Tool families (each family has one purpose — pick the one that fits the task):\n"
        "\n"
        "  Engine source (read-only, fetched from GitHub into RAM, never written to disk):\n"
        "    code_info            overview of the engine repo\n"
        "    code_ls / code_tree  browse directories\n"
        "    code_find_files      find files by name pattern\n"
        "    code_outline         structured function/class signatures\n"
        "    code_grep            free-form regex search\n"
        "    code_where_defined   find symbol definitions\n"
        "    code_references      find symbol references\n"
        "    code_dependencies    what this file includes/imports\n"
        "    code_dependents      who includes/imports this file\n"
        "    code_read            read a file (whole or sliced)\n"
        "    code_count_lines     file size without body\n"
        "\n"
        "  Mod data (structured, schema-aware, applied via runtime_manifest.json):\n"
        "    read_data            read data/<key>.json as Python data\n"
        "    write_data           overwrite / replace whole file\n"
        "    add_data_items       append / upsert one or more items\n"
        "    set_data_item        set or update one item by id\n"
        "    update_data_field    change one field on one item\n"
        "    remove_data_item     remove one item by id\n"
        "    validate_data        shape + required-fields check\n"
        "    data_database_keys   list manifest-declared keys with policies\n"
        "    read_mod_json        read mod.json as Python data\n"
        "    update_mod_json      deep-merge a patch into mod.json\n"
        "\n"
        "  Mod files (generic, no schema awareness — use for non-data files):\n"
        "    list_files / read_file / write_file / edit_file / delete_file / append_file / grep\n"
        "\n"
        "  Source transfer / copy-paste / refactor (read source, write safe targets):\n"
        "    source_read_file      read active_mod / mods_root / engine_source / project\n"
        "    source_read_range     read exact line ranges with context\n"
        "    source_outline        structured symbols / keys / headings for one file\n"
        "    copy_file             copy whole text or binary files into a mod/scratch\n"
        "    copy_tree             copy folders recursively with include/exclude globs\n"
        "    copy_range            copy selected lines and insert by line or marker\n"
        "    copy_json_value       copy JSON objects/arrays/fields by JSON Pointer\n"
        "    copy_symbol           copy a function/class/method-like symbol\n"
        "    insert_text           insert generated text by line or unique marker\n"
        "    replace_exact         exact substring replace with ambiguity checks\n"
        "    apply_unified_patch   apply unified diffs with context checks\n"
        "    move_path / delete_path\n"
        "                          move/delete only inside writable roots\n"
        "    preview_diff          unified diff before writing\n"
        "    agent_clipboard       multi-step text buffer for copied snippets\n"
        "    checkpoint_create / checkpoint_list / checkpoint_diff / checkpoint_restore\n"
        "                          snapshot active mod before risky edits\n"
        "    rename_symbol / find_unused_imports / remove_unused_imports\n"
        "                          adapt copied Python code\n"
        "    format_json           parser-based JSON formatting\n"
        "    validate_js_sandbox   catch require/process/fs/module.exports patterns\n"
        "\n"
        "  Source intelligence (use before complex scripts or total conversions):\n"
        "    analyze_source_pattern\n"
        "                          find working source examples for a query\n"
        "    list_modapi_endpoints scan source for ModAPI endpoints and examples\n"
        "    list_runtime_data_keys\n"
        "                          manifest keys, merge policies and required fields\n"
        "    compare_mod_to_engine_contract\n"
        "                          inventory-vs-contract issues before validation\n"
        "\n"
        "  Docs / manifest:\n"
        "    docs_search          free-text over the bundled README\n"
        "    docs_section         fetch a full section\n"
        "    schema_lookup        merge_policy + required fields for a db key\n"
        "\n"
        "  Mod-level:\n"
        "    list_mods            enumerate mods\n"
        "    select_mod           switch active mod\n"
        "    new_mod              scaffold a fresh mod folder\n"
        "    analyze_mod          FULL on-disk inventory (call FIRST for any\n"
        "                          review/audit/evaluate request; reports are\n"
        "                          ground truth, your prose must match them)\n"
        "    validate_mod         contract validation (subset of analyze_mod)\n"
        "\n"
    "  Task tracking (autonomous mode relies on this):\n"
    "    todo(action=...)     one verb to rule them all: list | add |\n"
    "                          set_status | done | update | remove |\n"
    "                          clear_done | clear. The list is shown to\n"
    "                          the user live; keep it accurate.\n"
    "    ask_user              structured question hook for unsafe ambiguity\n"
    "\n"
    "  Game launch (preflight):\n"
    "    preflight_mod        run the JS ModLoader's declarative data\n"
    "                          preflight in Python — same checks, same\n"
    "                          error format as the DevConsole. No engine,\n"
    "                          no Node, no Electron. Pass mod_id (one)\n"
    "                          or mods (list). Use this BEFORE run_game\n"
    "                          to see which mods will be auto-disabled.\n"
    "    run_game             preflight_mod + spawn meterea_engine.exe\n"
    "                          with the given mod IDs, capture the\n"
    "                          engine's startup log, terminate. Surfaces\n"
    "                          both the Python preflight and the C++\n"
    "                          engine's DATA ERROR / WARNING lines.\n"
    "                          Engine auto-discovered from project/engine/,\n"
    "                          alongside modkit.exe, or the path in\n"
    "                          %APPDATA%\\metera-modkit\\engine_path.txt.\n"
    "\n"
    "  User-installed tools (auto-discovered):\n"
    "    <user-defined>       dropped in ~/.metera-modkit/user_tools/*.py\n"
    "                          as @tool-decorated functions. Pure Python,\n"
    "                          no manifest, no JSON schema. The agent\n"
    "                          picks them up at startup and they appear\n"
    "                          in its tool list like any built-in.\n"
    "\n"
    "  User-defined skills (instructions the agent can read on demand):\n"
    "    <skill>              dropped in\n"
    "                          ~/.metera-modkit/skills/<name>/SKILL.md\n"
    "                          (YAML frontmatter: name + description; body\n"
    "                          is markdown instructions). Listed in the\n"
    "                          system prompt; load the full body with the\n"
    "                          read_skill tool when relevant. No code,\n"
    "                          no executables, no Python required.\n"
    "\n"
        "Workflow reminder: when extending a mod, always (1) read the engine "
        "side with code_* to understand the contract, (2) shape the data with "
        "the *_data family so the merge policy and required fields are "
        "enforced automatically, (3) validate with validate_data and "
        "validate_mod. For any 'analyze / review / audit / describe' request "
        "start with analyze_mod — never rely on partial reads. For multi-step "
        "work, lay out a todo plan first; in autonomous mode the agent must "
        "keep the list accurate until everything is 'done'. NEVER hand-write "
        "JSON strings — pass Python data.\n"
    )


def section_dicts() -> Iterable[dict[str, Any]]:
    for s in all_sections():
        yield s.to_dict()
