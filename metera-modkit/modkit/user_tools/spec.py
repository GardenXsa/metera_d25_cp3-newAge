"""JSON schema for user-declared tools.

A user (the modder, who has only ``modkit.exe`` — no Python, no
manifest, no CLI) drops a ``.json`` file into
``~/.metera-modkit/user_tools/`` and the agent picks it up at
startup. This module validates the JSON shape and gives helpful
errors when something is wrong.

Shape of a single user file (typically one tool, but the format
allows several)::

    {
      "tools": [
        {
          "name": "word_count",
          "description": "Count words in a file (uses bin/word_count.cmd).",
          "kind": "read",
          "parameters": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"]
          },
          "action": {
            "type": "shell",
            "command_template": "bin\\\\word_count.cmd {path}"
          }
        }
      ]
    }

Supported action types (no Python required on the user side):

* ``http_get``        — ``url`` with ``{arg}`` placeholders + optional ``response_path``
* ``http_post``       — ``url`` + ``body`` with ``{arg}`` placeholders
* ``shell``           — ``command_template`` with ``{arg}`` placeholders; relative
                        paths are resolved against the user-tools folder
* ``read_file``       — ``path`` (templated) inside the user-tools folder
* ``write_file``      — ``path`` + ``content`` (templated); defaults to inside the
                        folder, opt out with ``allow_outside_user_tools: true``
* ``list_files``      — ``path`` (templated) inside the user-tools folder
* ``prompt``          — no execution; the tool description is the deliverable

The available action types are pulled from
:mod:`modkit.user_tools.actions` so the validation and the
dispatcher can never disagree about what exists.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from modkit.user_tools.actions import available_actions


# Top-level shape of a user tool file.
USER_FILE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["tools"],
    "properties": {
        "tools": {
            "type": "array",
            "items": {"$ref": "#/$defs/tool"},
        },
    },
    "$defs": {
        "tool": {
            "type": "object",
            "additionalProperties": False,
            "required": ["name", "description", "action"],
            "properties": {
                "name": {"type": "string", "pattern": "^[a-z][a-z0-9_]*$"},
                "description": {"type": "string", "minLength": 1},
                "kind": {
                    "type": "string",
                    "enum": ["read", "edit"],
                    "default": "read",
                },
                "parameters": {
                    "type": "object",
                    "default": {"type": "object", "properties": {}},
                },
                "action": {
                    "type": "object",
                    "required": ["type"],
                    "properties": {
                        "type": {"type": "string"},
                    },
                },
            },
        },
    },
}


VALID_KINDS = ("read", "edit")
TOOL_NAME_RE = re.compile(r"^[a-z][a-z0-9_]*$")


@dataclass
class ToolSpec:
    name: str
    description: str
    kind: str
    parameters: dict[str, Any]
    action: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "kind": self.kind,
            "parameters": self.parameters,
            "action": self.action,
        }


@dataclass
class ToolsFile:
    """Parsed and validated user tool file."""

    tools: list[ToolSpec] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def parse_tools_payload(payload: Any) -> ToolsFile:
    """Validate the JSON payload and return a :class:`ToolsFile`."""
    result = ToolsFile()
    known_action_types = {a["type"] for a in available_actions()}

    if not isinstance(payload, dict):
        result.errors.append("root must be an object")
        return result
    if "tools" not in payload:
        result.errors.append("missing 'tools' array")
        return result
    raw_tools = payload["tools"]
    if not isinstance(raw_tools, list):
        result.errors.append("'tools' must be an array")
        return result

    seen_names: set[str] = set()
    for index, entry in enumerate(raw_tools):
        if not isinstance(entry, dict):
            result.errors.append(f"tools[{index}] is not an object")
            continue

        name = str(entry.get("name") or "").strip()
        if not name:
            result.errors.append(f"tools[{index}].name is required")
            continue
        if not TOOL_NAME_RE.match(name):
            result.errors.append(
                f"tools[{index}].name '{name}' must match [a-z][a-z0-9_]*"
            )
        if name in seen_names:
            result.errors.append(f"tools[{index}].name '{name}' is duplicated")
        seen_names.add(name)

        description = str(entry.get("description") or "").strip()
        if not description:
            result.errors.append(f"tools[{index}].description is required")

        kind = str(entry.get("kind") or "read").strip().lower()
        if kind not in VALID_KINDS:
            result.errors.append(
                f"tools[{index}].kind '{kind}' is not one of {VALID_KINDS}"
            )

        parameters = entry.get("parameters") or {}
        if not isinstance(parameters, dict):
            result.errors.append(f"tools[{index}].parameters must be an object")
            parameters = {}

        action = entry.get("action") or {}
        if not isinstance(action, dict):
            result.errors.append(f"tools[{index}].action must be an object")
            continue
        action_type = str(action.get("type") or "").strip()
        if not action_type:
            result.errors.append(f"tools[{index}].action.type is required")
        elif action_type not in known_action_types:
            result.errors.append(
                f"tools[{index}].action.type '{action_type}' is unknown; "
                f"available: {sorted(known_action_types)}"
            )

        if not result.errors:
            result.tools.append(
                ToolSpec(
                    name=name,
                    description=description,
                    kind=kind,
                    parameters=parameters,
                    action=action,
                )
            )
    return result


def load_tools_file(path: Path) -> ToolsFile:
    """Read + parse a ``.json`` tool file from disk."""
    path = Path(path)
    if not path.is_file():
        return ToolsFile(errors=[f"file not found: {path}"])
    try:
        raw = path.read_text(encoding="utf-8-sig")
    except OSError as exc:
        return ToolsFile(errors=[f"cannot read: {exc}"])
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        return ToolsFile(errors=[f"not valid JSON: {exc}"])
    return parse_tools_payload(payload)


EXAMPLE_TOOLS_JSON: str = json.dumps(
    {
        "tools": [
            {
                "name": "translate_to_russian",
                "description": "Translate English text to Russian via a free API.",
                "kind": "read",
                "parameters": {
                    "type": "object",
                    "properties": {"text": {"type": "string"}},
                    "required": ["text"],
                },
                "action": {
                    "type": "http_get",
                    "url": "https://translate.example.com/api?q={text}&target=ru",
                    "response_path": "translation",
                },
            },
            {
                "name": "word_count",
                "description": "Count words in a file (Windows built-in).",
                "kind": "read",
                "parameters": {
                    "type": "object",
                    "properties": {"path": {"type": "string"}},
                    "required": ["path"],
                },
                "action": {
                    "type": "shell",
                    "command_template": "bin\\word_count.cmd {path}",
                },
            },
        ],
    },
    indent=2,
    ensure_ascii=False,
)
