"""User-installed custom tools for the modkit agent.

A "user tool" is a plain Python function the modder/player drops
into ``~/.metera-modkit/user_tools/`` and decorates with
:func:`tool`. The agent picks it up at startup and exposes it
exactly like any built-in tool — no manifest, no JSON schema, no
bin/ folder, no subcommand.

The minimum viable example lives at
``metera-modkit/resources/user_tools_example/greet.py``::

    from modkit.user_tools import tool

    @tool
    def greet(who: str) -> dict:
        \"\"\"Return a friendly greeting.\"\"\"
        return {"text": f"Hello, {who}!"}

The decorator also accepts overrides for ``name``, ``description``,
``parameters`` and ``kind`` — useful when you want to expose a
function under a different name or with a richer JSON-Schema than
the auto-inferred one.

This module is intentionally tiny: one decorator, one folder
scan, no manifest format. The whole point is to be a five-second
"drop a file, get a tool" feature for the person running modkit.
"""

from modkit.user_tools.decorator import UserToolSpec, tool
from modkit.user_tools.discovery import discover_user_tools, user_tools_root

__all__ = [
    "UserToolSpec",
    "discover_user_tools",
    "tool",
    "user_tools_root",
]
