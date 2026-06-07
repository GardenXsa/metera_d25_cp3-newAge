"""Documentation tools: docs_search / docs_section / schema_lookup.

These are *the* mechanism we promised the user: instead of dumping
the README into every system prompt, the agent searches it on demand.
"""

from __future__ import annotations

from typing import Any

from modkit import docs as docs_index
from modkit.permissions import Kind
from modkit.tools.registry import Tool, ToolContext, ToolResult


def _docs_search(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    query = str(args.get("query") or "").strip()
    if not query:
        return ToolResult(ok=False, error="'query' is required")
    limit = int(args.get("limit") or 5)
    limit = max(1, min(limit, 15))
    results = docs_index.search(query, limit=limit)
    if not results:
        return ToolResult(
            ok=True,
            content="no matches",
            data={"results": [], "query": query},
        )
    return ToolResult(ok=True, data={"results": results, "query": query})


def _docs_section(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    raw = args.get("id") or args.get("section") or args.get("number") or args.get("title")
    if not raw:
        return ToolResult(ok=False, error="provide 'id', 'section', 'number' or 'title'")
    section = docs_index.find_section(str(raw))
    if section is None:
        return ToolResult(ok=False, error=f"section not found: {raw}")
    max_chars = int(args.get("max_chars") or 8000)
    body = section.body[:max_chars]
    return ToolResult(
        ok=True,
        content=body,
        data={
            "id": section.id,
            "number": section.number,
            "title": section.title,
            "truncated": len(section.body) > max_chars,
        },
    )


def _schema_lookup(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    key = str(args.get("database_key") or args.get("key") or "").strip()
    if not key:
        return ToolResult(ok=False, error="'database_key' is required")
    payload = docs_index.schema_lookup(key)
    return ToolResult(ok=True, data=payload)


def build_docs_tools() -> list[Tool]:
    return [
        Tool(
            name="docs_search",
            description=(
                "Search the Chronicles of Meterea modding documentation by free-form "
                "query. Returns up to 'limit' (default 5) matching sections with title, "
                "number and a snippet. Use docs_section afterwards to read a full section."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 15},
                },
                "required": ["query"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_docs_search,
        ),
        Tool(
            name="docs_section",
            description=(
                "Fetch a full documentation section by id, number, or title fragment. "
                "Example ids: '6.6-biomes', numbers like '6.6', or titles like 'Биомы'."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "section": {"type": "string"},
                    "number": {"type": "string"},
                    "title": {"type": "string"},
                    "max_chars": {"type": "integer", "minimum": 100},
                },
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_docs_section,
        ),
        Tool(
            name="schema_lookup",
            description=(
                "Look up a database key (e.g. 'items', 'biomes', 'recipes'). "
                "Returns its manifest entry (path, merge_policy, default_type), the "
                "contract (required fields, if any) and the matching docs section body."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "database_key": {"type": "string"},
                },
                "required": ["database_key"],
                "additionalProperties": False,
            },
            kind=Kind.READ,
            handler=_schema_lookup,
        ),
    ]
