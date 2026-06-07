"""TODO state for the agent.

LLMs forget mid-conversation what they were doing. A real TODO
list — visible to the user in the GUI / TUI, mutable via tools —
keeps the agent honest and lets the user follow along in
real-time.

The state is held on the :class:`ToolContext` (or attached via
``ctx.todos`` if the context supports it). The tools in this
module are read / write that state.

States: ``pending`` → ``in_progress`` → ``done``. Items can also
be removed (``cancel``) or renamed.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Iterable


# Statuses are deliberately small. The model should not invent
# exotic values; the regex in ``_set_status`` rejects anything else.
VALID_STATUSES = ("pending", "in_progress", "done", "cancelled")


@dataclass
class TodoItem:
    id: int
    title: str
    status: str = "pending"
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class TodoState:
    """Holds the agent's TODO list.

    Lives on the ToolContext as ``ctx.todos`` (a free attribute).
    The :func:`get_state` helper creates it lazily so callers don't
    have to remember to initialise.
    """

    items: list[TodoItem] = field(default_factory=list)
    _next_id: int = 1

    def add(self, title: str, notes: str = "") -> TodoItem:
        item = TodoItem(id=self._next_id, title=title.strip(), notes=notes)
        self._next_id += 1
        self.items.append(item)
        return item

    def update(self, item_id: int, **changes: Any) -> TodoItem | None:
        for item in self.items:
            if item.id == item_id:
                for key, value in changes.items():
                    if not hasattr(item, key):
                        continue
                    setattr(item, key, value)
                return item
        return None

    def remove(self, item_id: int) -> bool:
        before = len(self.items)
        self.items = [i for i in self.items if i.id != item_id]
        return len(self.items) < before

    def clear_done(self) -> int:
        before = len(self.items)
        self.items = [i for i in self.items if i.status != "done"]
        return before - len(self.items)

    def clear(self) -> int:
        before = len(self.items)
        self.items = []
        return before

    def summary(self) -> dict[str, Any]:
        counts: dict[str, int] = {s: 0 for s in VALID_STATUSES}
        for it in self.items:
            counts[it.status] = counts.get(it.status, 0) + 1
        return {
            "total": len(self.items),
            "counts": counts,
            "items": [i.to_dict() for i in self.items],
        }

    def is_open(self) -> bool:
        """True while at least one item is pending or in progress."""
        return any(i.status in ("pending", "in_progress") for i in self.items)


def get_state(ctx: Any) -> TodoState:
    """Return (creating if needed) the TODO state attached to ``ctx``."""
    state = getattr(ctx, "todos", None)
    if state is None:
        state = TodoState()
        try:
            ctx.todos = state  # type: ignore[attr-defined]
        except Exception:
            # ToolContext is a dataclass that may be frozen; we fall
            # back to a private attribute and rely on the caller
            # to read it back the same way.
            object.__setattr__(ctx, "_todos", state)
    return state


def all_done(ctx: Any) -> bool:
    """True if there are no pending / in-progress TODO items.

    Used by the autonomous mode to decide when to wrap up.
    """
    state = getattr(ctx, "todos", None) or getattr(ctx, "_todos", None)
    if state is None:
        return True
    return not state.is_open()


def render_text(items: Iterable[TodoItem]) -> str:
    """Plain-text rendering for the GUI / TUI / log."""
    rows: list[str] = []
    for it in items:
        mark = {
            "pending": "[ ]",
            "in_progress": "[~]",
            "done": "[x]",
            "cancelled": "[-]",
        }.get(it.status, "[?]")
        rows.append(f"{mark} #{it.id} {it.title}")
    return "\n".join(rows)
