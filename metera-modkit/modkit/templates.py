"""Quick-create mod templates.

Pure-data templates used by both the TUI and the CLI. Each template
returns a dict of ``relative_path -> content`` where content may be
a string, a dict, or a list (the caller is responsible for serialising
non-string values to JSON).

The templates only depend on stdlib so they can be imported from
frozen executables (PyInstaller / cx_Freeze) without pulling in the
textual TUI runtime.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

TemplateFn = Callable[[dict[str, Any]], dict[str, Any]]


def _mod_json(
    mod_id: str,
    name: str,
    *,
    author: str = "Unknown",
    description: str = "",
    total_conversion: bool = False,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": mod_id,
        "name": name,
        "version": "1.0.0",
        "author": author,
        "description": description,
        "dependencies": ["base_game"],
        "scripts": ["data/main.js"],
        "data": {},
    }
    if total_conversion:
        base["total_conversion"] = True
    if extra:
        base.update(extra)
    return base


def empty_mod(ctx: dict[str, Any]) -> dict[str, Any]:
    return {
        "mod.json": _mod_json(
            ctx["id"],
            ctx.get("name") or ctx["id"],
            author=ctx.get("author", "Unknown"),
            description=ctx.get("description", ""),
        ),
        "data/main.js": (
            "// " + ctx["id"] + "\n"
            "// Entry point for the mod. See docs: `modkit docs scripts`.\n"
            "module.exports = {};\n"
        ),
    }


def item_mod(ctx: dict[str, Any]) -> dict[str, Any]:
    mod = empty_mod(ctx)
    mod["data/items.json"] = [
        {
            "id": ctx["id"] + "_example_item",
            "name": "Example Item",
            "description": "Replace me with your own item.",
            "stack": 1,
            "weight": 1.0,
            "value": 10,
        }
    ]
    mod["mod.json"]["data"]["items"] = ["data/items.json"]
    return mod


def biome_mod(ctx: dict[str, Any]) -> dict[str, Any]:
    mod = empty_mod(ctx)
    mod["data/biomes.json"] = [
        {
            "id": ctx["id"] + "_biome",
            "name": "Example Biome",
            "description": "Replace me with your own biome.",
            "ambient_color": "#88ccff",
        }
    ]
    mod["mod.json"]["data"]["biomes"] = ["data/biomes.json"]
    return mod


def recipe_mod(ctx: dict[str, Any]) -> dict[str, Any]:
    mod = empty_mod(ctx)
    mod["data/economy_recipes.json"] = [
        {
            "id": ctx["id"] + "_example_recipe",
            "name": "Example Recipe",
            "inputs": [{"id": "scrap_metal", "count": 2}],
            "outputs": [{"id": "metal_ingot", "count": 1}],
            "station": "workbench",
        }
    ]
    mod["mod.json"]["data"]["economy_recipes"] = ["data/economy_recipes.json"]
    return mod


def class_mod(ctx: dict[str, Any]) -> dict[str, Any]:
    mod = empty_mod(ctx)
    mod["data/classes.json"] = [
        {
            "id": ctx["id"] + "_example_class",
            "name": "Example Class",
            "description": "Replace me with your own class.",
            "base_stats": {
                "hp": 100,
                "stamina": 100,
                "strength": 10,
                "agility": 10,
                "intelligence": 10,
            },
        }
    ]
    mod["mod.json"]["data"]["classes"] = ["data/classes.json"]
    return mod


def loot_table_mod(ctx: dict[str, Any]) -> dict[str, Any]:
    mod = empty_mod(ctx)
    mod["data/loot_tables.json"] = [
        {
            "id": ctx["id"] + "_example_loot",
            "name": "Example Loot",
            "rolls": 1,
            "entries": [
                {"id": "scrap_metal", "weight": 80, "count": [1, 2]},
                {"id": "metal_ingot", "weight": 15, "count": [1, 1]},
                {"id": "rare_gem", "weight": 5, "count": [1, 1]},
            ],
        }
    ]
    mod["mod.json"]["data"]["loot_tables"] = ["data/loot_tables.json"]
    return mod


def total_conversion_mod(ctx: dict[str, Any]) -> dict[str, Any]:
    mod = empty_mod(ctx)
    mod["mod.json"] = _mod_json(
        ctx["id"],
        ctx.get("name") or ctx["id"],
        author=ctx.get("author", "Unknown"),
        description=ctx.get("description", ""),
        total_conversion=True,
    )
    return mod


# Registry: ordered list of (key, label, function).
TEMPLATES: list[tuple[str, str, TemplateFn]] = [
    ("empty", "Empty mod (mod.json + main.js)", empty_mod),
    ("item", "Item mod (items.json example)", item_mod),
    ("biome", "Biome mod (biomes.json example)", biome_mod),
    ("recipe", "Recipe mod (economy_recipes.json example)", recipe_mod),
    ("class", "Class mod (classes.json example)", class_mod),
    ("loot", "Loot table mod (loot_tables.json example)", loot_table_mod),
    ("total_conversion", "Total Conversion (TC) mod", total_conversion_mod),
]


def get_template(name: str) -> TemplateFn | None:
    """Return the template function for ``name`` or None if unknown."""
    name = (name or "").lower().strip()
    for key, _, fn in TEMPLATES:
        if key == name:
            return fn
    return None


def write_template(target: Path, files: dict[str, Any]) -> None:
    """Write the template's files into ``target`` directory.

    ``files`` is the dict returned by a template function. Values that
    are dict / list get serialised to JSON; everything else is written
    as UTF-8 text.
    """
    target = Path(target)
    for rel, content in files.items():
        p = target / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, (dict, list)):
            p.write_text(
                json.dumps(content, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        else:
            p.write_text(str(content), encoding="utf-8")


__all__ = [
    "TEMPLATES",
    "TemplateFn",
    "empty_mod",
    "item_mod",
    "biome_mod",
    "recipe_mod",
    "class_mod",
    "loot_table_mod",
    "total_conversion_mod",
    "get_template",
    "write_template",
]
