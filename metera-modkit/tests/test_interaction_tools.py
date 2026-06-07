from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from modkit.permissions import Mode
from modkit.tools.interaction_tools import build_interaction_tools
from modkit.tools.registry import ToolContext, ToolRegistry


def _registry() -> ToolRegistry:
    reg = ToolRegistry()
    for tool in build_interaction_tools():
        reg.register(tool)
    return reg


class InteractionToolsTests(unittest.TestCase):
    def test_ask_user_uses_context_callback(self) -> None:
        seen: list[dict] = []

        def ask_user(payload: dict) -> str:
            seen.append(payload)
            return "use the forge faction"

        with tempfile.TemporaryDirectory() as tmp:
            ctx = ToolContext(
                mods_root=Path(tmp),
                mode=Mode.YOLO,
                confirm=lambda *_: True,
                extra={"ask_user": ask_user},
            )
            res = _registry().run(
                "ask_user",
                {
                    "question": "Which faction should own this recipe?",
                    "options": ["forge", "market"],
                    "reason": "The source example has two valid owners.",
                },
                ctx,
            )

        self.assertTrue(res.ok, msg=res.error)
        self.assertEqual(res.data["answer"], "use the forge faction")
        self.assertEqual(seen[0]["question"], "Which faction should own this recipe?")
        self.assertEqual(seen[0]["options"], ["forge", "market"])

    def test_ask_user_without_callback_returns_structured_blocker(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ctx = ToolContext(
                mods_root=Path(tmp),
                mode=Mode.YOLO,
                confirm=lambda *_: True,
            )
            res = _registry().run(
                "ask_user",
                {"question": "Which era should be primary?"},
                ctx,
            )

        self.assertFalse(res.ok)
        self.assertIn("not configured", res.error)
        self.assertTrue(res.data["requires_user_input"])
        self.assertEqual(res.data["question"], "Which era should be primary?")

    def test_ask_user_rejects_empty_question(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ctx = ToolContext(mods_root=Path(tmp), mode=Mode.YOLO, confirm=lambda *_: True)
            res = _registry().run("ask_user", {"question": "   "}, ctx)

        self.assertFalse(res.ok)
        self.assertIn("question", res.error)


if __name__ == "__main__":
    unittest.main()
