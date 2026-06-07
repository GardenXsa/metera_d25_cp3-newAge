"""Example user tool — copy this file to start a custom tool of your own.

Steps to use:

1. Find your user tools folder. Run ``modkit doctor`` and look for
   the "user dir" line, or open it from the GUI's Superpowers tab.
   The full path is ``~/.metera-modkit/user_tools/`` on every OS
   (``%APPDATA%/metera-modkit/user_tools`` on Windows).

2. Copy this file there (or just create a new ``.py`` file with the
   same shape).

3. Restart modkit (or the agent in the GUI). The ``greet`` tool
   shows up in the agent's tool list automatically.

That's it. No manifest, no JSON schema, no ``bin/`` folder, no
manifest validation. Drop a ``.py`` file, get a tool.
"""

from modkit.user_tools import tool


@tool
def greet(who: str) -> dict:
    """Return a friendly greeting for the given person."""
    return {"text": f"Hello, {who}!"}
