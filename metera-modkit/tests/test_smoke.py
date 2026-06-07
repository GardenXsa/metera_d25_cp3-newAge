"""Smoke tests that run without any network / external service."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

# Make `modkit` importable when running `py -m unittest discover` from the
# repo root.
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from modkit import docs as docs_index
from modkit.agent import run_agent
from modkit.paths import safe_join
from modkit.permissions import Decision, Kind, Mode, evaluate
from modkit.providers.base import AssistantTurn, Message, Provider, ToolCall
from modkit.providers.dummy import DummyProvider
from modkit.tools import build_default_registry
from modkit.tools.registry import Tool, ToolContext, ToolRegistry, ToolResult
from modkit.validate import validate_mod


class PermissionTests(unittest.TestCase):
    def test_ask_mode_allows_read_but_asks_for_edit(self):
        self.assertEqual(evaluate(Mode.ASK, Kind.READ).decision, Decision.ALLOW)
        self.assertEqual(evaluate(Mode.ASK, Kind.EDIT).decision, Decision.ASK)
        self.assertEqual(evaluate(Mode.ASK, Kind.SHELL).decision, Decision.ASK)

    def test_auto_edit_allows_edit_asks_shell(self):
        self.assertEqual(evaluate(Mode.AUTO_EDIT, Kind.READ).decision, Decision.ALLOW)
        self.assertEqual(evaluate(Mode.AUTO_EDIT, Kind.EDIT).decision, Decision.ALLOW)
        self.assertEqual(evaluate(Mode.AUTO_EDIT, Kind.SHELL).decision, Decision.ASK)

    def test_yolo_allows_everything(self):
        for kind in Kind:
            self.assertEqual(evaluate(Mode.YOLO, kind).decision, Decision.ALLOW)


class SafeJoinTests(unittest.TestCase):
    def test_safe_join_inside_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = safe_join(root, "data/items.json")
            self.assertTrue(str(target).startswith(str(root.resolve())))

    def test_safe_join_rejects_traversal(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                safe_join(Path(tmp), "../outside.json")

    def test_safe_join_normalises_separators(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = safe_join(Path(tmp), "data\\items.json")
            self.assertIn("items.json", target.name)


class DocsIndexTests(unittest.TestCase):
    def test_sections_parsed(self):
        sections = docs_index.all_sections()
        self.assertGreater(len(sections), 10)
        ids = [s.id for s in sections]
        self.assertTrue(any("biomes" in i for i in ids))

    def test_search_returns_relevant_hit(self):
        results = docs_index.search("биомы", limit=3)
        self.assertTrue(results)
        self.assertEqual(results[0]["number"], "6.6")

    def test_schema_lookup_for_known_key(self):
        payload = docs_index.schema_lookup("biomes")
        self.assertTrue(payload["known"])
        self.assertEqual(payload["manifest"]["merge_policy"], "upsertById")

    def test_schema_lookup_unknown(self):
        payload = docs_index.schema_lookup("not_a_real_key")
        self.assertFalse(payload["known"])

    def test_cheatsheet_mentions_mod_json(self):
        text = docs_index.cheatsheet()
        self.assertIn("mod.json", text)
        self.assertIn("biomes", text)

    def test_cheatsheet_mentions_transfer_tools(self):
        text = docs_index.cheatsheet()
        self.assertIn("source_read_range", text)
        self.assertIn("copy_tree", text)
        self.assertIn("copy_symbol", text)
        self.assertIn("copy_json_value", text)
        self.assertIn("apply_unified_patch", text)
        self.assertIn("checkpoint_create", text)
        self.assertIn("ask_user", text)
        self.assertIn("analyze_source_pattern", text)
        self.assertIn("list_modapi_endpoints", text)


class ValidationTests(unittest.TestCase):
    def test_valid_mod(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            mod = root / "good_mod"
            mod.mkdir()
            (mod / "mod.json").write_text(
                json.dumps(
                    {
                        "id": "good_mod",
                        "name": "Good",
                        "version": "1.0.0",
                        "author": "Tester",
                        "description": "ok",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            report = validate_mod(mod)
            self.assertTrue(report.ok, msg=report.errors)

    def test_missing_required(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            mod = root / "bad_mod"
            mod.mkdir()
            (mod / "mod.json").write_text("{}", encoding="utf-8")
            report = validate_mod(mod)
            self.assertFalse(report.ok)
            self.assertTrue(any("'id'" in e for e in report.errors))

    def test_unknown_data_key_warns(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = Path(tmp) / "mod_with_unknown"
            mod.mkdir()
            (mod / "data").mkdir()
            (mod / "data" / "x.json").write_text("[]", encoding="utf-8")
            (mod / "mod.json").write_text(
                json.dumps(
                    {
                        "id": "mod_with_unknown",
                        "name": "test",
                        "version": "1.0.0",
                        "data": {"not_a_key": ["data/x.json"]},
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            report = validate_mod(mod)
            self.assertTrue(any("not in runtime_manifest" in w for w in report.warnings))

    def test_bom_is_warning_not_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            mod = Path(tmp) / "bom_mod"
            mod.mkdir()
            (mod / "mod.json").write_text(
                "\ufeff"
                + json.dumps(
                    {
                        "id": "bom_mod",
                        "name": "test",
                        "version": "1.0.0",
                        "author": "Tester",
                        "description": "x",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            report = validate_mod(mod)
            self.assertTrue(report.ok)
            self.assertTrue(any("BOM" in w for w in report.warnings))


class AgentLoopTests(unittest.TestCase):
    def test_autonomous_requires_validate_e2e_after_successful_edit(self):
        provider = _ScriptedProvider(
            [
                AssistantTurn(
                    text="editing",
                    tool_calls=[ToolCall(id="edit_1", name="write_mod_file", arguments={})],
                ),
                AssistantTurn(text="finished without validation"),
                AssistantTurn(
                    text="validating",
                    tool_calls=[
                        ToolCall(
                            id="validate_1",
                            name="validate_e2e",
                            arguments={"ok": True},
                        )
                    ],
                ),
                AssistantTurn(text="finished after validation"),
            ]
        )
        events = []
        with tempfile.TemporaryDirectory() as tmp:
            messages = run_agent(
                provider=provider,
                registry=_validation_gate_registry(),
                ctx=ToolContext(
                    mods_root=Path(tmp),
                    mode=Mode.YOLO,
                    confirm=lambda name, args: True,
                ),
                user_task="make a mod change",
                max_iterations=6,
                autonomous=True,
                on_event=events.append,
            )

        self.assertEqual(messages[-1].content, "finished after validation")
        self.assertIn("validate_e2e has not passed", "\n".join(m.content for m in messages))
        self.assertIn("done", [e.kind for e in events])

    def test_autonomous_failed_validate_e2e_keeps_validation_gate_open(self):
        provider = _ScriptedProvider(
            [
                AssistantTurn(
                    text="editing",
                    tool_calls=[ToolCall(id="edit_1", name="write_mod_file", arguments={})],
                ),
                AssistantTurn(
                    text="first validation",
                    tool_calls=[
                        ToolCall(
                            id="validate_1",
                            name="validate_e2e",
                            arguments={"ok": False},
                        )
                    ],
                ),
                AssistantTurn(text="finished after failed validation"),
                AssistantTurn(
                    text="second validation",
                    tool_calls=[
                        ToolCall(
                            id="validate_2",
                            name="validate_e2e",
                            arguments={"ok": True},
                        )
                    ],
                ),
                AssistantTurn(text="finished after passing validation"),
            ]
        )
        with tempfile.TemporaryDirectory() as tmp:
            messages = run_agent(
                provider=provider,
                registry=_validation_gate_registry(),
                ctx=ToolContext(
                    mods_root=Path(tmp),
                    mode=Mode.YOLO,
                    confirm=lambda name, args: True,
                ),
                user_task="make and validate a mod change",
                max_iterations=7,
                autonomous=True,
            )

        self.assertEqual(messages[-1].content, "finished after passing validation")
        nudges = [m.content for m in messages if "validate_e2e has not passed" in m.content]
        self.assertEqual(len(nudges), 1)

    def test_default_registry_includes_transfer_tools(self):
        registry = build_default_registry(include_shell=False, load_user_tools=False)
        for name in [
            "source_read_range",
            "copy_file",
            "copy_tree",
            "copy_json_value",
            "apply_unified_patch",
            "copy_symbol",
            "checkpoint_create",
            "rename_symbol",
            "validate_js_sandbox",
            "ask_user",
        ]:
            self.assertIsNotNone(registry.get(name), name)

    def test_dummy_agent_completes(self):
        events = []
        with tempfile.TemporaryDirectory() as tmp:
            registry = build_default_registry(include_shell=False)
            ctx = ToolContext(
                mods_root=Path(tmp),
                mod_root=None,
                mode=Mode.YOLO,
                confirm=lambda name, args: True,
            )
            provider = DummyProvider(
                api_key="", model="dummy-modkit", base_url="",
                temperature=0.0, max_tokens=512,
            )
            messages = run_agent(
                provider=provider,
                registry=registry,
                ctx=ctx,
                user_task="расскажи про биомы",
                on_event=events.append,
            )
        kinds = [e.kind for e in events]
        self.assertIn("tool_call", kinds)
        self.assertIn("tool_result", kinds)
        self.assertIn("done", kinds)
        # Final message should be assistant text with no remaining tool calls.
        self.assertEqual(messages[-1].role, "assistant")

    def test_new_mod_via_agent_tool(self):
        with tempfile.TemporaryDirectory() as tmp:
            registry = build_default_registry(include_shell=False)
            ctx = ToolContext(
                mods_root=Path(tmp),
                mode=Mode.YOLO,
                confirm=lambda name, args: True,
            )
            result = registry.run(
                "new_mod",
                {"id": "agent_made_mod", "name": "Agent", "author": "T"},
                ctx,
            )
            self.assertTrue(result.ok, msg=result.error)
            self.assertEqual(ctx.mod_root.name, "agent_made_mod")
            self.assertTrue((ctx.mod_root / "mod.json").exists())


class _ScriptedProvider(Provider):
    id = "scripted"

    def __init__(self, turns: list[AssistantTurn]) -> None:
        super().__init__(api_key="", model="scripted")
        self._turns = list(turns)

    def chat(
        self,
        messages: list[Message],
        *,
        tools: list | None = None,
        system: str | None = None,
    ) -> AssistantTurn:
        if not self._turns:
            return AssistantTurn(text="done")
        return self._turns.pop(0)


def _validation_gate_registry() -> ToolRegistry:
    registry = ToolRegistry()
    registry.register(
        Tool(
            name="write_mod_file",
            description="test edit tool",
            parameters={"type": "object", "properties": {}},
            kind=Kind.EDIT,
            handler=lambda args, ctx: ToolResult(ok=True, data={"changed": True}),
        )
    )
    registry.register(
        Tool(
            name="validate_e2e",
            description="test validation tool",
            parameters={"type": "object", "properties": {"ok": {"type": "boolean"}}},
            kind=Kind.SHELL,
            handler=lambda args, ctx: ToolResult(
                ok=bool(args.get("ok", True)),
                data={"status": "ok" if args.get("ok", True) else "failed"},
            ),
        )
    )
    return registry


class ChatRenderTests(unittest.TestCase):
    def test_tool_call_record_uses_compact_json_preview(self):
        from modkit.agent import AgentEvent
        from modkit.chat_render import event_to_record
        from modkit.providers.base import ToolCall

        record = event_to_record(
            AgentEvent(
                kind="tool_call",
                tool_call=ToolCall(
                    id="call_1",
                    name="read_file",
                    arguments={"path": "data/items.json"},
                ),
            )
        )

        self.assertEqual(record.kind, "tool_call")
        self.assertEqual(record.title, "tool: read_file")
        self.assertIn('"path": "data/items.json"', record.body)

    def test_tool_result_record_reports_success(self):
        from modkit.agent import AgentEvent
        from modkit.chat_render import event_to_record
        from modkit.providers.base import ToolCall
        from modkit.tools.registry import ToolResult

        call = ToolCall(id="call_1", name="validate_mod", arguments={})
        record = event_to_record(
            AgentEvent(
                kind="tool_result",
                tool_call=call,
                tool_result=ToolResult(ok=True, content="valid"),
            )
        )

        self.assertEqual(record.kind, "tool_result")
        self.assertEqual(record.title, "ok validate_mod")
        self.assertEqual(record.body, "")

    def test_tool_result_record_summarises_transfer_data(self):
        from modkit.agent import AgentEvent
        from modkit.chat_render import event_to_record
        from modkit.providers.base import ToolCall
        from modkit.tools.registry import ToolResult

        record = event_to_record(
            AgentEvent(
                kind="tool_result",
                tool_call=ToolCall(id="call_1", name="copy_file", arguments={}),
                tool_result=ToolResult(
                    ok=True,
                    data={"target_path": "scripts/copied.js", "bytes": 42, "dry_run": False},
                ),
            )
        )

        self.assertEqual(record.title, "ok copy_file")
        self.assertIn("scripts/copied.js", record.body)
        self.assertIn("42 bytes", record.body)

    def test_tool_result_record_summarises_checkpoint_data(self):
        from modkit.agent import AgentEvent
        from modkit.chat_render import event_to_record
        from modkit.providers.base import ToolCall
        from modkit.tools.registry import ToolResult

        record = event_to_record(
            AgentEvent(
                kind="tool_result",
                tool_call=ToolCall(id="call_1", name="checkpoint_create", arguments={}),
                tool_result=ToolResult(ok=True, data={"id": "abc", "count": 3}),
            )
        )

        self.assertEqual(record.title, "ok checkpoint_create")
        self.assertIn("abc", record.body)
        self.assertIn("3 file", record.body)

    def test_tool_result_record_reports_failure_preview(self):
        from modkit.agent import AgentEvent
        from modkit.chat_render import event_to_record
        from modkit.providers.base import ToolCall
        from modkit.tools.registry import ToolResult

        call = ToolCall(id="call_1", name="write_file", arguments={})
        record = event_to_record(
            AgentEvent(
                kind="tool_result",
                tool_call=call,
                tool_result=ToolResult(ok=False, error="permission denied"),
            )
        )

        self.assertEqual(record.kind, "tool_result")
        self.assertEqual(record.title, "fail write_file")
        self.assertEqual(record.body, "permission denied")

    def test_error_record_keeps_message(self):
        from modkit.agent import AgentEvent
        from modkit.chat_render import event_to_record

        record = event_to_record(AgentEvent(kind="error", text="provider unavailable"))

        self.assertEqual(record.kind, "error")
        self.assertEqual(record.title, "error")
        self.assertEqual(record.body, "provider unavailable")


class ToolPermissionEnforcementTests(unittest.TestCase):
    def test_edit_blocked_in_ask_mode_without_confirm(self):
        with tempfile.TemporaryDirectory() as tmp:
            registry = build_default_registry(include_shell=False)
            mod = Path(tmp) / "x_mod"
            mod.mkdir()
            ctx = ToolContext(
                mods_root=Path(tmp),
                mod_root=mod,
                mode=Mode.ASK,
                confirm=lambda name, args: False,  # user declines
            )
            result = registry.run("write_file", {"path": "x.json", "content": "{}"}, ctx)
            self.assertFalse(result.ok)
            self.assertIn("denied", result.error.lower())
            self.assertFalse((mod / "x.json").exists())

    def test_read_allowed_in_ask_mode_without_confirm(self):
        with tempfile.TemporaryDirectory() as tmp:
            registry = build_default_registry(include_shell=False)
            mod = Path(tmp) / "x_mod"
            mod.mkdir()
            (mod / "y.json").write_text("[1,2,3]", encoding="utf-8")
            ctx = ToolContext(
                mods_root=Path(tmp),
                mod_root=mod,
                mode=Mode.ASK,
                confirm=lambda name, args: False,
            )
            result = registry.run("read_file", {"path": "y.json"}, ctx)
            self.assertTrue(result.ok)
            self.assertEqual(result.content, "[1,2,3]")


class GeminiSchemaCompatTests(unittest.TestCase):
    """Gemini's function-decl schema rejects fields OpenAI strict mode uses."""

    def test_strip_unsupported_fields(self):
        from modkit.providers.gemini import _strip_unsupported_schema_fields

        before = {
            "type": "object",
            "properties": {
                "x": {"type": "string", "title": "X", "default": "y"},
                "y": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {"z": {"type": "integer"}},
                },
            },
            "additionalProperties": False,
            "title": "Root",
            "$schema": "https://json-schema.org/draft/2020-12/schema",
        }
        after = _strip_unsupported_schema_fields(before)
        self.assertNotIn("additionalProperties", after)
        self.assertNotIn("title", after)
        self.assertNotIn("$schema", after)
        self.assertEqual(after["type"], "object")
        self.assertNotIn("additionalProperties", after["properties"]["x"])
        self.assertNotIn("default", after["properties"]["x"])
        self.assertNotIn("additionalProperties", after["properties"]["y"])
        self.assertEqual(after["properties"]["y"]["properties"]["z"]["type"], "integer")

    def test_gemini_tool_conversion_drops_strict_fields(self):
        from modkit.providers.base import ToolDef
        from modkit.providers.gemini import GeminiProvider

        tool = ToolDef(
            name="t",
            description="d",
            parameters={
                "type": "object",
                "properties": {"a": {"type": "string"}},
                "additionalProperties": False,
            },
        )
        converted = GeminiProvider._tool_to_gemini(tool)
        self.assertNotIn("additionalProperties", converted["parameters"])
        self.assertEqual(converted["parameters"]["properties"]["a"]["type"], "string")

    def test_gemini_payload_has_no_unsupported_fields(self):
        """End-to-end: build the full chat() payload via a stubbed post_json
        and assert no tool schema leaks unsupported fields."""
        from unittest.mock import patch
        from modkit.providers.base import Message, ToolDef
        from modkit.providers.gemini import GeminiProvider

        captured: dict = {}

        def fake_post(url, headers, body, timeout):
            captured["body"] = body
            return 200, {
                "candidates": [
                    {
                        "content": {
                            "parts": [{"text": "ok"}],
                        }
                    }
                ]
            }

        with patch("modkit.providers.gemini.post_json", side_effect=fake_post):
            p = GeminiProvider(api_key="x", model="gemini-2.5-flash")
            p.chat(
                messages=[Message(role="user", content="hi")],
                tools=[
                    ToolDef(
                        name="t",
                        description="d",
                        parameters={
                            "type": "object",
                            "properties": {"a": {"type": "string"}},
                            "additionalProperties": False,
                        },
                    )
                ],
            )
        self.assertIn("tools", captured["body"])
        decl = captured["body"]["tools"][0]["functionDeclarations"][0]
        self.assertNotIn("additionalProperties", decl["parameters"])

    def test_gemini_captures_and_echoes_thought_signature(self):
        """Gemini returns ``thoughtSignature`` on the content part.
        We must capture it into ``ToolCall.extra`` and send it back on
        the next turn's functionCall part, otherwise the API returns
        HTTP 400 'Function call is missing a thought_signature'."""
        from unittest.mock import patch
        from modkit.providers.base import Message, ToolDef
        from modkit.providers.gemini import GeminiProvider

        SIG = "opaque-base64-blob=="

        def fake_post(url, headers, body, timeout):
            # This is the second request: model role with a functionCall
            # that should carry thought_signature from the previous turn.
            captured["body"] = body
            return 200, {
                "candidates": [
                    {
                        "content": {
                            "parts": [{"text": "done"}],
                        }
                    }
                ]
            }

        captured: dict = {}
        with patch("modkit.providers.gemini.post_json", side_effect=fake_post):
            p = GeminiProvider(api_key="x", model="gemini-2.5-flash")
            tc = p._parse_response(
                {
                    "candidates": [
                        {
                            "content": {
                                "parts": [
                                    {
                                        "functionCall": {
                                            "name": "list_mods",
                                            "args": {},
                                        },
                                        "thoughtSignature": SIG,
                                    }
                                ]
                            }
                        }
                    ]
                }
            ).tool_calls[0]
            self.assertEqual(tc.extra.get("thought_signature"), SIG)
            # Now ask the provider to serialise this call back.
            p.chat(
                messages=[
                    Message(role="user", content="list"),
                    Message(role="assistant", content="", tool_calls=[tc]),
                    Message(role="tool", content='{"mods": []}', name="list_mods"),
                    Message(role="user", content="thanks"),
                ],
                tools=[ToolDef(name="list_mods", description="", parameters={"type": "object"})],
            )
        model_parts = captured["body"]["contents"][1]["parts"]
        fc = next(p for p in model_parts if "functionCall" in p)
        self.assertEqual(fc.get("thoughtSignature"), SIG)
        self.assertNotIn("thought_signature", fc["functionCall"])


if __name__ == "__main__":
    unittest.main()
