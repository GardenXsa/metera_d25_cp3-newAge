# Modkit AI Chat Markdown Live Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Markdown in the Qt AI chat and show agent tool activity live in Qt GUI, Textual TUI, and CLI.

**Architecture:** Add a presentation-neutral formatter for `AgentEvent` objects. Qt, Textual, and CLI convert those records into their own output formats while sharing labels, JSON previews, and truncation behavior.

**Tech Stack:** Python stdlib, PySide6 `QTextBrowser`, Textual `RichLog`, existing `unittest` tests.

---

### Task 1: Shared Chat Event Formatter

**Files:**
- Create: `metera-modkit/modkit/chat_render.py`
- Modify: `metera-modkit/tests/test_smoke.py`

- [ ] **Step 1: Write failing formatter tests**

Add tests that construct `AgentEvent`, `ToolCall`, and `ToolResult`, then assert:

```python
record = event_to_record(AgentEvent(kind="tool_call", tool_call=call))
self.assertEqual(record.kind, "tool_call")
self.assertEqual(record.title, "tool: read_file")
self.assertIn('"path": "data/items.json"', record.body)
```

Also test successful `tool_result`, failed `tool_result`, and `error`.

- [ ] **Step 2: Run tests to verify failure**

Run: `py -m unittest metera-modkit.tests.test_smoke.ChatRenderTests`

Expected: import failure for `modkit.chat_render`.

- [ ] **Step 3: Implement formatter**

Create:

```python
@dataclass(frozen=True)
class ChatRecord:
    kind: str
    title: str
    body: str = ""
    is_markdown: bool = False

def preview_json(value: object, limit: int = 200) -> str:
    text = json.dumps(value, ensure_ascii=False)
    return text if len(text) <= limit else text[:limit] + "..."

def event_to_record(event: AgentEvent) -> ChatRecord:
    ...
```

- [ ] **Step 4: Run formatter tests**

Run: `py -m unittest metera-modkit.tests.test_smoke.ChatRenderTests`

Expected: all tests pass.

### Task 2: Qt GUI Markdown And Live Events

**Files:**
- Modify: `metera-modkit/modkit/gui/main_window.py`
- Modify: `metera-modkit/tests/test_gui.py`

- [ ] **Step 1: Write failing GUI tests**

Add tests for:

```python
w._append_assistant_markdown("**bold**\n\n- one")
self.assertIn("<strong>bold</strong>", w.ai_view.toHtml())
self.assertIn("one", w.ai_view.toPlainText())
```

And:

```python
w._append_chat_record(ChatRecord(kind="tool_call", title="tool: read_file", body='{"path":"x"}'))
self.assertIn("tool: read_file", w.ai_view.toPlainText())
```

- [ ] **Step 2: Run GUI tests to verify failure**

Run: `py -m unittest metera-modkit.tests.test_gui.GUISmokeTests`

Expected: missing helper methods or escaped Markdown.

- [ ] **Step 3: Implement Qt rendering**

Change the AI transcript widget to `QTextBrowser`. Add helper methods:

```python
def _append_user_message(self, text: str) -> None: ...
def _append_assistant_markdown(self, text: str) -> None: ...
def _append_chat_record(self, record: ChatRecord) -> None: ...
```

Change `_AgentWorker` to emit `AgentEvent` records via a Qt signal and pass an `on_event` callback into `run_agent`.

- [ ] **Step 4: Run GUI tests**

Run: `py -m unittest metera-modkit.tests.test_gui.GUISmokeTests`

Expected: all GUI tests pass.

### Task 3: TUI And CLI Event Reuse

**Files:**
- Modify: `metera-modkit/modkit/tui/app.py`
- Modify: `metera-modkit/modkit/cli.py`
- Modify: `metera-modkit/tests/test_smoke.py`

- [ ] **Step 1: Add formatter coverage for CLI-compatible wording**

Assert tool call and result records use the labels expected by CLI/TUI.

- [ ] **Step 2: Wire TUI live events**

Pass `on_event` into `run_agent` in `_run_agent`, and write each record to `RichLog` from the worker thread with escaped Rich markup text.

- [ ] **Step 3: Reuse formatter in CLI**

Update `_make_event_handler` to use `event_to_record` while preserving existing visible output and JSON mode behavior.

- [ ] **Step 4: Run smoke tests**

Run: `py -m unittest metera-modkit.tests.test_smoke`

Expected: all smoke tests pass.

### Task 4: Full Verification

**Files:**
- No new files expected.

- [ ] **Step 1: Run full modkit test suite**

Run: `py -m unittest discover -s metera-modkit\tests`

Expected: all tests pass. Qt may print existing font or watcher warnings, but the unittest result must be `OK`.

- [ ] **Step 2: Inspect working tree**

Run: `git status --short`

Expected: changes are limited to the modkit files, docs/spec, and docs/plan for this task; unrelated existing changes remain untouched.
