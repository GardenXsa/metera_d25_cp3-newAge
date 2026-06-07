# Modkit AI Chat Markdown And Live Events Design

## Goal

Improve the metera-modkit AI chat so the desktop Qt chat renders assistant Markdown and every chat surface shows what the agent is doing in real time.

The affected surfaces are:

- Qt GUI AI tab, launched by `modkit` or `modkit gui`.
- Textual TUI AI tab, launched by `modkit tui`.
- CLI chat and one-shot agent commands, launched by `modkit chat`, `modkit agent`, or `modkit run`.

## Current Behavior

The agent loop already emits structured `AgentEvent` values:

- `assistant_text`
- `tool_call`
- `tool_result`
- `done`
- `error`

The CLI consumes those events and prints live progress. Qt GUI does not pass an event handler to `run_agent`, so it waits for the worker to finish and then prints only one assistant message. The TUI also calls `run_agent` without an event handler, so it does not show tool calls while the agent is running.

The Qt GUI escapes assistant text and appends it as HTML plain text. Markdown lists, code fences, headings, and inline formatting are not rendered.

## Design

Add a shared chat-event formatting module for presentation-neutral event labels and previews. It should turn `AgentEvent` objects into small display records such as:

- user message
- assistant Markdown
- tool call
- tool result success
- tool result failure
- error
- done

The shared formatter must not depend on Qt, Textual, or terminal color APIs. UI-specific code can convert the display record into HTML, Rich markup, or ANSI output.

Qt GUI behavior:

- Keep the current AI tab layout: transcript above, input row below.
- Render user messages as escaped plain text.
- Render assistant messages as Markdown.
- Append live tool events while the worker is running.
- Use Qt signals from `_AgentWorker` for event delivery so background thread UI updates remain safe.
- Show tool call arguments as compact JSON previews, matching the CLI's current 200-character truncation.
- Show failed tool results with the error preview.
- Re-enable the Send button and refresh the mod list when the worker finishes.

TUI behavior:

- Pass `on_event` into `run_agent`.
- Append live tool events to `RichLog`.
- Escape Rich markup-sensitive text before writing model/user/tool data.
- Keep assistant responses readable as plain Markdown text in the terminal log. Full Markdown rendering is not required for TUI.

CLI behavior:

- Preserve existing visible behavior.
- Reuse the shared formatter where practical so event wording stays aligned with GUI/TUI.

## Rendering Rules

Assistant Markdown in Qt should support the Markdown subset Qt can render natively:

- paragraphs
- bullet and numbered lists
- bold and italic
- inline code
- fenced code blocks
- links as text or clickable links if supported by the widget

User input, tool names, JSON previews, and errors must be escaped before insertion into HTML/Rich markup.

## Error Handling

Provider construction errors and provider runtime errors should appear in the chat transcript, not only as dialogs or logs.

If Markdown conversion fails or Qt lacks a needed method, the Qt GUI should fall back to escaped plain text rather than losing the message.

## Testing

Add focused tests for:

- shared event formatter output for `tool_call`, successful `tool_result`, failed `tool_result`, and `error`;
- Qt GUI assistant rendering path preserves Markdown semantics instead of escaping the entire assistant message as plain text;
- Qt GUI event handler appends tool progress records;
- existing smoke tests still pass.

Run:

```powershell
py -m unittest discover -s metera-modkit\tests
```

## Non-Goals

- No redesign of the AI tab layout.
- No streaming token-by-token model output; only existing `run_agent` events are shown as soon as they are emitted.
- No new third-party Markdown dependency.
- No persistent chat history storage.
