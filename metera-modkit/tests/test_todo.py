"""Tests for the ``todo`` tool + state helpers."""

from __future__ import annotations

import sys
import unittest
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from modkit.permissions import Mode
from modkit.todo import TodoState, all_done, get_state, render_text
from modkit.tools.registry import ToolContext
from modkit.tools.todo_tool import build_todo_tools


def _ctx() -> ToolContext:
    return ToolContext(mods_root=Path("."), mode=Mode.YOLO, confirm=lambda *_: True)


def _registry() -> Any:
    from modkit.tools.registry import ToolRegistry

    reg = ToolRegistry()
    for t in build_todo_tools():
        reg.register(t)
    return reg


class TodoStateTests(unittest.TestCase):
    def test_add_assigns_ids(self):
        s = TodoState()
        a = s.add("first")
        b = s.add("second")
        self.assertEqual(a.id, 1)
        self.assertEqual(b.id, 2)
        self.assertEqual(a.status, "pending")

    def test_update_changes_field(self):
        s = TodoState()
        item = s.add("foo")
        updated = s.update(item.id, status="in_progress", title="foo!")
        self.assertEqual(updated.title, "foo!")
        self.assertEqual(updated.status, "in_progress")

    def test_update_unknown_id_returns_none(self):
        s = TodoState()
        self.assertIsNone(s.update(99, status="done"))

    def test_remove_keeps_order(self):
        s = TodoState()
        a = s.add("a")
        b = s.add("b")
        c = s.add("c")
        self.assertTrue(s.remove(b.id))
        self.assertEqual([i.id for i in s.items], [a.id, c.id])

    def test_clear_done(self):
        s = TodoState()
        s.add("a")
        b = s.add("b")
        s.add("c")
        s.update(b.id, status="done")
        removed = s.clear_done()
        self.assertEqual(removed, 1)
        self.assertEqual(len(s.items), 2)

    def test_summary_counts(self):
        s = TodoState()
        s.add("a")
        b = s.add("b")
        s.add("c")
        s.update(b.id, status="in_progress")
        summary = s.summary()
        self.assertEqual(summary["total"], 3)
        self.assertEqual(summary["counts"]["pending"], 2)
        self.assertEqual(summary["counts"]["in_progress"], 1)

    def test_is_open(self):
        s = TodoState()
        self.assertFalse(s.is_open())
        s.add("a")
        self.assertTrue(s.is_open())
        s.update(1, status="done")
        self.assertFalse(s.is_open())

    def test_get_state_attaches_to_ctx(self):
        ctx = _ctx()
        s = get_state(ctx)
        self.assertIsInstance(s, TodoState)
        s.add("x")
        # second call returns the same state
        self.assertIs(get_state(ctx), s)

    def test_all_done_helper(self):
        ctx = _ctx()
        self.assertTrue(all_done(ctx))
        get_state(ctx).add("x")
        self.assertFalse(all_done(ctx))

    def test_render_text(self):
        s = TodoState()
        s.add("a")
        s.add("b")
        s.update(2, status="done")
        text = render_text(s.items)
        self.assertIn("[ ] #1 a", text)
        self.assertIn("[x] #2 b", text)


class TodoToolTests(unittest.TestCase):
    def test_list_empty(self):
        res = _registry().run("todo", {"action": "list"}, _ctx())
        self.assertTrue(res.ok)
        self.assertEqual(res.data["total"], 0)

    def test_add_then_list(self):
        ctx = _ctx()
        reg = _registry()
        reg.run("todo", {"action": "add", "title": "first"}, ctx)
        res = reg.run("todo", {"action": "list"}, ctx)
        self.assertEqual(res.data["total"], 1)
        self.assertEqual(res.data["items"][0]["title"], "first")

    def test_set_status_moves_along(self):
        ctx = _ctx()
        reg = _registry()
        reg.run("todo", {"action": "add", "title": "a"}, ctx)
        res = reg.run("todo", {"action": "set_status", "id": 1, "status": "in_progress"}, ctx)
        self.assertEqual(res.data["updated"]["status"], "in_progress")

    def test_done_action(self):
        ctx = _ctx()
        reg = _registry()
        reg.run("todo", {"action": "add", "title": "a"}, ctx)
        res = reg.run("todo", {"action": "done", "id": 1}, ctx)
        self.assertEqual(res.data["updated"]["status"], "done")

    def test_update_renames(self):
        ctx = _ctx()
        reg = _registry()
        reg.run("todo", {"action": "add", "title": "old"}, ctx)
        res = reg.run("todo", {"action": "update", "id": 1, "title": "new"}, ctx)
        self.assertEqual(res.data["updated"]["title"], "new")

    def test_remove(self):
        ctx = _ctx()
        reg = _registry()
        reg.run("todo", {"action": "add", "title": "a"}, ctx)
        reg.run("todo", {"action": "add", "title": "b"}, ctx)
        res = reg.run("todo", {"action": "remove", "id": 1}, ctx)
        self.assertEqual(res.data["summary"]["total"], 1)

    def test_clear_done_keeps_pending(self):
        ctx = _ctx()
        reg = _registry()
        reg.run("todo", {"action": "add", "title": "a"}, ctx)
        reg.run("todo", {"action": "add", "title": "b"}, ctx)
        reg.run("todo", {"action": "done", "id": 1}, ctx)
        res = reg.run("todo", {"action": "clear_done"}, ctx)
        self.assertEqual(res.data["removed_done"], 1)
        self.assertEqual(res.data["summary"]["total"], 1)

    def test_unknown_action(self):
        res = _registry().run("todo", {"action": "nope"}, _ctx())
        self.assertFalse(res.ok)

    def test_add_requires_title(self):
        res = _registry().run("todo", {"action": "add"}, _ctx())
        self.assertFalse(res.ok)

    def test_set_status_invalid_value(self):
        ctx = _ctx()
        reg = _registry()
        reg.run("todo", {"action": "add", "title": "a"}, ctx)
        res = reg.run("todo", {"action": "set_status", "id": 1, "status": "bogus"}, ctx)
        self.assertFalse(res.ok)


if __name__ == "__main__":
    unittest.main()
