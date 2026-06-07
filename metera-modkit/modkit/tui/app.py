"""Textual app for metera-modkit.

Layout (5 columns split into 3 panes):

    ┌─ Header: modkit · <mods root> · <provider> ─────────────────────┐
    │ Mods (sidebar) │ Files (tree)  │ Editor / Schema / Validate / AI │
    │                │               │                                  │
    │                │               │                                  │
    └─ Footer: keybindings ─────────────────────────────────────────────┘

The app deliberately keeps state minimal: it never holds a file
buffer that is out of sync with disk. Every "save" reads from the
TextArea, every "load" pushes to it. That makes undo / redo and
external edits behave naturally.
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import sys
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from rich.markup import escape as rich_escape
from textual import on, work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.reactive import reactive
from textual.screen import ModalScreen
from textual.widgets import (
    Button,
    DataTable,
    DirectoryTree,
    Footer,
    Header,
    Input,
    Label,
    RichLog,
    Static,
    TabbedContent,
    TabPane,
    TextArea,
)
from textual.suggester import SuggestFromList

from modkit import __version__, config as config_mod, docs as docs_index
from modkit.chat_render import ChatRecord, event_to_record
from modkit.paths import resolve_mods_root
from modkit.providers import build_provider
from modkit.providers.registry import list_providers
from modkit import templates
from modkit.validate import validate_mod


# ── helpers ──────────────────────────────────────────────────────────────


# tree-sitter is required for TextArea syntax highlighting. We try
# to use it if the user has the language packages installed, but
# never crash if they're missing.
_AVAILABLE_LANGUAGES: set[str] = set()
try:  # pragma: no cover - best-effort detection
    from textual.document._languages import (  # type: ignore[attr-defined]
        BUILTIN_LANGUAGES,
    )

    _AVAILABLE_LANGUAGES = set(BUILTIN_LANGUAGES)
except Exception:  # pragma: no cover
    _AVAILABLE_LANGUAGES = {"json", "markdown", "python", "css", "html", "javascript"}


def _pick_language(path: Path) -> str | None:
    """Return a tree-sitter language name for ``path`` or None if
    the corresponding package is not installed."""
    if not path:
        return None
    ext = path.suffix.lower()
    mapping = {
        ".json": "json",
        ".md": "markdown",
        ".py": "python",
        ".js": "javascript",
        ".css": "css",
        ".html": "html",
    }
    name = mapping.get(ext)
    if name and name in _AVAILABLE_LANGUAGES:
        return name
    return None


def _open_in_explorer(path: Path) -> None:
    """Open ``path`` in the platform file manager."""
    path = path.resolve()
    if platform.system() == "Windows":
        os.startfile(str(path))  # noqa: S606 - intentional user action
    elif platform.system() == "Darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])


def _export_zip(src: Path, dest: Path) -> None:
    """Pack ``src`` directory into a .zip at ``dest``."""
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(src):
            for f in files:
                full = Path(root) / f
                zf.write(full, full.relative_to(src.parent))


def _validate_id(value: str) -> str | None:
    """Return an error string if the id is not a valid mod id, else None."""
    if not value:
        return "id не может быть пустым"
    import re

    if not re.fullmatch(r"[a-z0-9_]+", value):
        return "id: только [a-z0-9_]+ (латиница в нижнем регистре, цифры, подчёркивания)"
    return None


def _chat_record_to_rich(record: ChatRecord) -> str:
    title = rich_escape(record.title)
    body = rich_escape(record.body)
    if record.kind == "assistant":
        return f"[bold green]Р°РіРµРЅС‚:[/bold green] {body}"
    if record.kind == "tool_call":
        return f"[yellow]{title}[/yellow] {body}".rstrip()
    if record.kind == "tool_result":
        color = "green" if record.title.startswith("ok ") else "red"
        return f"[{color}]{title}[/{color}]" + (f" {body}" if body else "")
    if record.kind == "error":
        return f"[red]{title}: {body}[/red]"
    if record.kind == "done":
        return f"[dim]{title}[/dim]"
    return f"[dim]{title}[/dim]" + (f" {body}" if body else "")


# ── new-mod modal ────────────────────────────────────────────────────────


@dataclass
class _NewModResult:
    id: str
    name: str
    author: str
    description: str
    template: str


class _NewModScreen(ModalScreen[_NewModResult | None]):
    """Modal that asks for id, name, author, description, template."""

    BINDINGS = [Binding("escape", "cancel", "Cancel")]

    def __init__(self, default_author: str = "Unknown"):
        super().__init__()
        self.default_author = default_author

    def compose(self) -> ComposeResult:
        with Vertical(id="new-mod-dialog"):
            yield Label("Создать новый мод", id="new-mod-title")
            yield Label("id (латиница/цифры/_):")
            yield Input(placeholder="my_cool_mod", id="new-mod-id")
            yield Label("Название:")
            yield Input(id="new-mod-name")
            yield Label("Автор:")
            yield Input(value=self.default_author, id="new-mod-author")
            yield Label("Описание (опционально):")
            yield Input(id="new-mod-description")
            yield Label("Шаблон:")
            yield Input(value="empty", id="new-mod-template")
            yield Label(
                "Шаблоны: empty, item, biome, recipe, class, loot, total_conversion",
                id="new-mod-hint",
            )
            with Horizontal(id="new-mod-buttons"):
                yield Button("Создать", id="new-mod-ok", variant="primary")
                yield Button("Отмена", id="new-mod-cancel")

    @on(Button.Pressed, "#new-mod-ok")
    def _ok(self) -> None:
        mod_id = self.query_one("#new-mod-id", Input).value.strip()
        err = _validate_id(mod_id)
        if err:
            self.notify(err, severity="error")
            return
        self.dismiss(
            _NewModResult(
                id=mod_id,
                name=self.query_one("#new-mod-name", Input).value.strip(),
                author=self.query_one("#new-mod-author", Input).value.strip() or "Unknown",
                description=self.query_one("#new-mod-description", Input).value.strip(),
                template=self.query_one("#new-mod-template", Input).value.strip() or "empty",
            )
        )

    @on(Button.Pressed, "#new-mod-cancel")
    def _cancel(self) -> None:
        self.dismiss(None)

    def action_cancel(self) -> None:
        self.dismiss(None)


# ── confirm modal ────────────────────────────────────────────────────────


class _ConfirmScreen(ModalScreen[bool]):
    BINDINGS = [Binding("escape", "cancel", "Cancel")]

    def __init__(self, prompt: str, danger: bool = False):
        super().__init__()
        self.prompt = prompt
        self.danger = danger

    def compose(self) -> ComposeResult:
        with Vertical(id="confirm-dialog"):
            yield Label(self.prompt, id="confirm-prompt")
            with Horizontal(id="confirm-buttons"):
                yield Button(
                    "Удалить" if self.danger else "Ок",
                    id="confirm-ok",
                    variant="error" if self.danger else "primary",
                )
                yield Button("Отмена", id="confirm-cancel")

    @on(Button.Pressed, "#confirm-ok")
    def _ok(self) -> None:
        self.dismiss(True)

    @on(Button.Pressed, "#confirm-cancel")
    def _cancel(self) -> None:
        self.dismiss(False)

    def action_cancel(self) -> None:
        self.dismiss(False)


# ── main app ─────────────────────────────────────────────────────────────


@dataclass
class _EditorState:
    path: Path | None = None
    dirty: bool = False
    last_validation: str = ""


class ModKitApp(App):
    """Professional modding workbench for Chronicles of Meterea."""

    CSS = """
    Screen {
        layout: vertical;
    }
    #body {
        height: 1fr;
    }
    #sidebar, #files-pane, #right-pane {
        height: 100%;
    }
    #sidebar {
        width: 28;
        border-right: solid $accent 30%;
    }
    #files-pane {
        width: 32;
        border-right: solid $accent 30%;
    }
    #right-pane {
        width: 1fr;
    }
    .pane-title {
        background: $boost;
        color: $text;
        padding: 0 1;
        text-style: bold;
    }
    #new-mod-dialog, #confirm-dialog {
        align: center middle;
        background: $surface;
        border: thick $accent;
        padding: 1 2;
        width: 60;
        height: auto;
    }
    #new-mod-dialog Input, #confirm-dialog Input {
        margin-bottom: 1;
    }
    #new-mod-buttons, #confirm-buttons {
        height: auto;
        align-horizontal: right;
    }
    #new-mod-buttons Button, #confirm-buttons Button {
        margin-left: 1;
    }
    #new-mod-title {
        text-style: bold;
        margin-bottom: 1;
    }
    #new-mod-hint {
        color: $text-muted;
        margin-bottom: 1;
    }
    #confirm-prompt {
        margin-bottom: 1;
    }
    DataTable {
        height: 1fr;
    }
    DirectoryTree {
        height: 1fr;
    }
    #editor {
        height: 1fr;
    }
    .panel {
        padding: 1 2;
    }
    #chat-log {
        height: 1fr;
        border: solid $accent 30%;
    }
    #chat-input-row {
        height: 3;
    }
    #chat-input {
        width: 1fr;
    }
    """

    BINDINGS = [
        Binding("ctrl+q", "quit", "Quit"),
        Binding("ctrl+n", "new_mod", "New mod"),
        Binding("ctrl+d", "duplicate_mod", "Duplicate"),
        Binding("delete", "delete", "Delete"),
        Binding("ctrl+s", "save", "Save"),
        Binding("f5", "validate", "Validate"),
        Binding("ctrl+e", "export", "Export zip"),
        Binding("ctrl+shift+e", "open_explorer", "Open in Explorer"),
        Binding("ctrl+l", "focus_mods", "Focus mods"),
        Binding("ctrl+t", "focus_tree", "Focus files"),
        Binding("ctrl+r", "refresh", "Refresh"),
        Binding("f1", "help", "Help"),
    ]

    TITLE = "metera-modkit"
    SUB_TITLE = f"v{__version__}"

    current_mod: reactive[str | None] = reactive(None)
    current_file: reactive[Path | None] = reactive(None)
    last_validation: reactive[str] = reactive("")

    def __init__(self, cfg: config_mod.Config):
        super().__init__()
        self.cfg = cfg
        self._editor = _EditorState()
        self._mods_root = resolve_mods_root(cfg.mods_dir or None)
        self.chat_history = []

    # ── compose ──────────────────────────────────────────────────────

    def compose(self) -> ComposeResult:
        yield Header(show_clock=False)
        with Horizontal(id="body"):
            with Vertical(id="sidebar"):
                yield Static("Моды", classes="pane-title")
                yield DataTable(id="mods-table", cursor_type="row", zebra_stripes=True)
            with Vertical(id="files-pane"):
                yield Static("Файлы", classes="pane-title")
                yield DirectoryTree(str(self._mods_root), id="files-tree")
            with Vertical(id="right-pane"):
                with TabbedContent(initial="editor-tab"):
                    with TabPane("Editor", id="editor-tab"):
                        yield TextArea(
                            "",
                            id="editor",
                            soft_wrap=False,
                            show_line_numbers=True,
                        )
                    with TabPane("Schema", id="schema-tab"):
                        yield VerticalScroll(
                            Static("(выбери файл)", id="schema-body", classes="panel"),
                            id="schema-scroll",
                        )
                    with TabPane("Validate", id="validate-tab"):
                        yield VerticalScroll(
                            Static("(нажми F5 чтобы провалидировать)", id="validate-body", classes="panel"),
                            id="validate-scroll",
                        )
                    with TabPane("AI", id="ai-tab"):
                        yield RichLog(id="chat-log", highlight=True, markup=True, wrap=True)
                        with Horizontal(id="chat-input-row"):
                            yield Input(
                                placeholder="Сообщение агенту…",
                                id="chat-input",
                                suggester=SuggestFromList(
                                    ["/clear", "/undo", "/plan ", "/save ", "/load ", "/backup ", "/help"],
                                    case_sensitive=False
                                )
                            )
                            yield Button("Send", id="chat-send", variant="primary")
        yield Footer()

    # ── lifecycle ────────────────────────────────────────────────────

    def on_mount(self) -> None:
        table = self.query_one("#mods-table", DataTable)
        table.add_columns("id", "v", "name")
        self._refresh_mods()
        self._refresh_header()
        if not self.cfg.provider:
            self.notify(
                "AI-провайдер не настроен. Запусти `modkit init` в обычном терминале.",
                severity="warning",
                timeout=10,
            )

    def _refresh_header(self) -> None:
        provider = self.cfg.provider or "(не настроен)"
        self.sub_title = f"v{__version__}  ·  {self._mods_root}  ·  {provider}"

    # ── mods table ───────────────────────────────────────────────────

    def _refresh_mods(self, select: str | None = None) -> None:
        table = self.query_one("#mods-table", DataTable)
        table.clear()
        if not self._mods_root.exists():
            return
        for mod_dir in sorted(self._mods_root.iterdir(), key=lambda p: p.name.lower()):
            if not mod_dir.is_dir():
                continue
            mjson = mod_dir / "mod.json"
            version = "?"
            name = mod_dir.name
            if mjson.exists():
                try:
                    with mjson.open("r", encoding="utf-8") as fh:
                        data = json.load(fh)
                    version = data.get("version", "?")
                    name = data.get("name") or mod_dir.name
                except Exception:
                    pass
            table.add_row(mod_dir.name, str(version), str(name), key=mod_dir.name)
        if select:
            self._select_mod(select)

    def _select_mod(self, mod_id: str) -> None:
        self.current_mod = mod_id
        tree = self.query_one("#files-tree", DirectoryTree)
        mod_path = self._mods_root / mod_id
        if mod_path.exists():
            tree.path = mod_path
        else:
            tree.path = self._mods_root
        # reset editor
        self.current_file = None
        self._editor.path = None
        self._editor.dirty = False
        editor = self.query_one("#editor", TextArea)
        editor.text = ""
        editor.read_only = True
        self.query_one("#schema-body", Static).update("(выбери файл)")
        self.query_one("#validate-body", Static).update("(нажми F5)")

    @on(DataTable.RowHighlighted, "#mods-table")
    def _on_mod_row_highlighted(self, event: DataTable.RowHighlighted) -> None:
        if event.row_key and event.row_key.value:
            self._select_mod(str(event.row_key.value))

    # ── file tree ────────────────────────────────────────────────────

    @on(DirectoryTree.FileSelected, "#files-tree")
    def _on_file_selected(self, event: DirectoryTree.FileSelected) -> None:
        path = Path(str(event.path))
        # Only files inside mods root are openable.
        try:
            rel = path.resolve().relative_to(self._mods_root.resolve())
        except ValueError:
            self.notify("файл вне mods root", severity="error")
            return
        parts = rel.parts
        if not parts:
            return
        # First segment must be the current mod.
        mod_id = self.current_mod or parts[0]
        if parts[0] != mod_id:
            self.notify(f"файл принадлежит '{parts[0]}', выбери этот мод в списке", severity="warning")
            return
        self._open_file(path)

    def _open_file(self, path: Path) -> None:
        self.current_file = path
        self._editor.path = path
        self._editor.dirty = False
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            text = path.read_text(encoding="utf-8", errors="replace")
        editor = self.query_one("#editor", TextArea)
        editor.language = _pick_language(path)
        editor.read_only = False
        editor.text = text
        self._refresh_schema(path)

    def _refresh_schema(self, path: Path) -> None:
        # Best-effort: infer the manifest key from the path (data/<key>.json)
        # and show the relevant section.
        rel = path.name
        manifest_key = None
        for key in docs_index.runtime_manifest_keys():
            if rel.startswith(key) or rel == f"{key}.json":
                manifest_key = key
                break
        body = self.query_one("#schema-body", Static)
        if not manifest_key:
            body.update(
                f"[dim]Нет схемы для файла '{rel}'.\n"
                f"Полный список ключей: `modkit docs --section runtime-manifest`.[/dim]"
            )
            return
        schema = docs_index.schema_lookup(manifest_key)
        sections = docs_index.find_section(manifest_key) or docs_index.find_section("runtime-manifest")
        parts: list[str] = []
        parts.append(f"[b]{manifest_key}[/b]  ({schema['manifest'].get('merge_policy', '?')})")
        if schema["manifest"].get("description"):
            parts.append("")
            parts.append(schema["manifest"]["description"])
        parts.append("")
        parts.append("[dim]Поля схемы (см. README):[/dim]")
        if sections:
            for s in sections[:2]:
                text = s.body
                if len(text) > 1200:
                    text = text[:1200] + "\n…(обрезано, см. полный README)"
                parts.append(text)
        else:
            parts.append("[dim](нет соответствующей секции в README)[/dim]")
        body.update("\n".join(parts))

    # ── editor ───────────────────────────────────────────────────────

    @on(TextArea.Changed, "#editor")
    def _on_editor_change(self, _event: TextArea.Changed) -> None:
        self._editor.dirty = True
        # Live JSON validation only for .json files.
        if self._editor.path and self._editor.path.suffix.lower() == ".json":
            try:
                json.loads(self.query_one("#editor", TextArea).text)
                self.query_one("#validate-body", Static).update(
                    "[green]JSON синтаксис OK[/green]"
                )
            except json.JSONDecodeError as exc:
                self.query_one("#validate-body", Static).update(
                    f"[red]JSON ошибка: {exc}[/red]"
                )

    # ── actions ──────────────────────────────────────────────────────

    def action_quit(self) -> None:
        if self._editor.dirty:
            self.push_screen(
                _ConfirmScreen("Есть несохранённые изменения. Выйти без сохранения?", danger=False),
                self._confirm_quit,
            )
        else:
            self.exit()

    def _confirm_quit(self, ok: bool | None) -> None:
        if ok:
            self.exit()

    def action_focus_mods(self) -> None:
        self.query_one("#mods-table", DataTable).focus()

    def action_focus_tree(self) -> None:
        self.query_one("#files-tree", DirectoryTree).focus()

    def action_refresh(self) -> None:
        self._refresh_mods(select=self.current_mod)
        self.notify("обновлено")

    def action_new_mod(self) -> None:
        self.push_screen(_NewModScreen(default_author=self.cfg.provider or "Unknown"), self._new_mod_done)

    def _new_mod_done(self, result: _NewModResult | None) -> None:
        if not result:
            return
        target = self._mods_root / result.id
        if target.exists():
            self.notify(f"мод '{result.id}' уже существует", severity="error")
            return
        # Apply template.
        template_name = result.template.lower()
        fn = templates.get_template(template_name)
        if fn is None:
            self.notify(f"неизвестный шаблон '{template_name}'", severity="error")
            return
        ctx = {
            "id": result.id,
            "name": result.name,
            "author": result.author,
            "description": result.description,
        }
        files = fn(ctx)
        target.mkdir(parents=True)
        (target / "data").mkdir(parents=True, exist_ok=True)
        from modkit.templates import write_template

        write_template(target, files)
        self._refresh_mods(select=result.id)
        self.notify(f"создан мод '{result.id}'", severity="information")

    def action_duplicate_mod(self) -> None:
        if not self.current_mod:
            self.notify("выбери мод в списке", severity="warning")
            return
        src = self._mods_root / self.current_mod
        if not src.exists():
            self.notify("мод не найден", severity="error")
            return
        new_id = f"{self.current_mod}_copy"
        i = 2
        while (self._mods_root / new_id).exists():
            new_id = f"{self.current_mod}_copy{i}"
            i += 1
        shutil.copytree(src, self._mods_root / new_id)
        # Update mod.json id field.
        mj = self._mods_root / new_id / "mod.json"
        if mj.exists():
            try:
                data = json.loads(mj.read_text(encoding="utf-8"))
                data["id"] = new_id
                mj.write_text(
                    json.dumps(data, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
            except Exception:
                pass
        self._refresh_mods(select=new_id)
        self.notify(f"продублировано как '{new_id}'", severity="information")

    def action_delete(self) -> None:
        if self._editor.path:
            self.push_screen(
                _ConfirmScreen(f"Удалить файл '{self._editor.path.name}'?", danger=True),
                self._delete_file_done,
            )
        elif self.current_mod:
            self.push_screen(
                _ConfirmScreen(f"Удалить мод '{self.current_mod}' целиком?", danger=True),
                self._delete_mod_done,
            )
        else:
            self.notify("нечего удалять", severity="warning")

    def _delete_file_done(self, ok: bool | None) -> None:
        if not ok or not self._editor.path:
            return
        try:
            self._editor.path.unlink()
        except OSError as exc:
            self.notify(f"не удалось удалить: {exc}", severity="error")
            return
        self.notify("файл удалён", severity="information")
        self.current_file = None
        self._editor.path = None
        self._editor.dirty = False
        self.query_one("#editor", TextArea).text = ""
        self.query_one("#editor", TextArea).read_only = True
        self._refresh_mods(select=self.current_mod)

    def _delete_mod_done(self, ok: bool | None) -> None:
        if not ok or not self.current_mod:
            return
        target = self._mods_root / self.current_mod
        if not target.exists():
            return
        shutil.rmtree(target, ignore_errors=True)
        self.notify("мод удалён", severity="information")
        self.current_mod = None
        self._refresh_mods()

    def action_save(self) -> None:
        if not self._editor.path:
            self.notify("нечего сохранять", severity="warning")
            return
        text = self.query_one("#editor", TextArea).text
        try:
            self._editor.path.write_text(text, encoding="utf-8")
        except OSError as exc:
            self.notify(f"save failed: {exc}", severity="error")
            return
        self._editor.dirty = False
        self.notify(f"сохранено: {self._editor.path.name}", severity="information")
        if self._editor.path.name == "mod.json" and self.current_mod:
            self._refresh_mods(select=self.current_mod)

    def action_validate(self) -> None:
        if not self.current_mod:
            self.notify("выбери мод", severity="warning")
            return
        mod_path = self._mods_root / self.current_mod
        report = validate_mod(mod_path)
        lines: list[str] = []
        if report.ok:
            lines.append(f"[green]+ мод '{self.current_mod}' валиден[/green]")
        else:
            lines.append(f"[red]x мод '{self.current_mod}' невалиден[/red]")
        for e in report.errors:
            lines.append(f"[red]x {e}[/red]")
        for w in report.warnings:
            lines.append(f"[yellow]! {w}[/yellow]")
        body = "\n".join(lines)
        self.last_validation = body
        self.query_one("#validate-body", Static).update(body)
        # Switch to the validate tab so the user sees the result.
        tabs = self.query_one("TabbedContent")
        tabs.active = "validate-tab"

    def action_export(self) -> None:
        if not self.current_mod:
            self.notify("выбери мод", severity="warning")
            return
        mod_path = self._mods_root / self.current_mod
        if not mod_path.exists():
            self.notify("мод не найден", severity="error")
            return
        dest = self._mods_root / f"{self.current_mod}.zip"
        try:
            _export_zip(mod_path, dest)
        except OSError as exc:
            self.notify(f"export failed: {exc}", severity="error")
            return
        self.notify(f"экспортировано: {dest}", severity="information")

    def action_open_explorer(self) -> None:
        if not self.current_mod:
            self.notify("выбери мод", severity="warning")
            return
        mod_path = self._mods_root / self.current_mod
        if not mod_path.exists():
            return
        _open_in_explorer(mod_path)

    def action_help(self) -> None:
        self.push_screen(
            _HelpScreen(),
        )

    # ── AI chat ──────────────────────────────────────────────────────

    @on(Button.Pressed, "#chat-send")
    def _on_chat_send(self) -> None:
        self._send_chat()

    @on(Input.Submitted, "#chat-input")
    def _on_chat_submit(self, _event: Input.Submitted) -> None:
        self._send_chat()

    def _handle_chat_command(self, text: str) -> None:
        cmd, *args = text.split(" ", 1)
        arg = args[0].strip() if args else ""
        cmd = cmd.lower()
        log = self.query_one("#chat-log", RichLog)

        if cmd == "/clear":
            self.chat_history.clear()
            log.clear()
            log.write("[dim]Чат очищен. История сброшена.[/dim]")
        elif cmd == "/undo":
            if not self.chat_history:
                log.write("[dim]История пуста.[/dim]")
                return
            idx = len(self.chat_history) - 1
            while idx >= 0 and self.chat_history[idx].role != "user":
                idx -= 1
            if idx >= 0:
                self.chat_history = self.chat_history[:idx]
                log.write("[dim]Последний запрос и ответы агента удалены из памяти.[/dim]")
            else:
                self.chat_history.clear()
                log.write("[dim]История очищена.[/dim]")
        elif cmd == "/plan":
            if not arg:
                log.write("[red]Укажи задачу: /plan <задача>[/red]")
                return
            plan_prompt = (
                "ПЛАН ДЕЙСТВИЙ. Изучи текущий мод с помощью инструментов чтения (list_files, read_file, docs_search, schema_lookup). "
                "Напиши подробный пошаговый план решения следующей задачи. "
                "ПОКА НЕ ИЗМЕНЯЙ ФАЙЛЫ (не используй write_file, edit_file, delete_file, shell). "
                f"Задача: {arg}"
            )
            log.write(f"[dim]Режим планирования: {rich_escape(arg)}[/dim]")
            self._run_agent(plan_prompt)
        elif cmd == "/save":
            if not arg:
                log.write("[red]Укажи имя файла: /save <имя>[/red]")
                return
            chats_dir = self._mods_root / ".chats"
            chats_dir.mkdir(exist_ok=True)
            path = chats_dir / f"{arg}.json"
            try:
                data = [m.to_dict() for m in self.chat_history]
                path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                log.write(f"[green]Чат сохранён: {path.name}[/green]")
            except Exception as e:
                log.write(f"[red]Ошибка сохранения: {e}[/red]")
        elif cmd == "/load":
            if not arg:
                log.write("[red]Укажи имя файла: /load <имя>[/red]")
                return
            path = self._mods_root / ".chats" / f"{arg}.json"
            if not path.exists():
                log.write(f"[red]Файл не найден: {path.name}[/red]")
                return
            try:
                from modkit.providers.base import Message
                data = json.loads(path.read_text(encoding="utf-8"))
                self.chat_history = [Message.from_dict(m) for m in data]
                log.clear()
                log.write(f"[green]Чат загружен: {path.name} ({len(self.chat_history)} сообщений)[/green]")
            except Exception as e:
                log.write(f"[red]Ошибка загрузки: {e}[/red]")
        elif cmd == "/backup":
            if not self.current_mod:
                log.write("[red]Сначала выбери мод.[/red]")
                return
            name = arg or "backup"
            backups_dir = self._mods_root / ".backups"
            backups_dir.mkdir(exist_ok=True)
            import time
            ts = int(time.time())
            dest = backups_dir / f"{self.current_mod}_{name}_{ts}.zip"
            try:
                _export_zip(self._mods_root / self.current_mod, dest)
                log.write(f"[green]Бэкап создан: {dest.name}[/green]")
            except Exception as e:
                log.write(f"[red]Ошибка бэкапа: {e}[/red]")
        elif cmd == "/help":
            help_text = (
                "[bold]Команды чата:[/bold]\n"
                "  [cyan]/clear[/cyan] — очистить историю и экран\n"
                "  [cyan]/undo[/cyan] — отменить последний запрос и ответы агента\n"
                "  [cyan]/plan <задача>[/cyan] — составить план без изменения файлов\n"
                "  [cyan]/save <имя>[/cyan] — сохранить историю чата\n"
                "  [cyan]/load <имя>[/cyan] — загрузить историю чата\n"
                "  [cyan]/backup [имя][/cyan] — сделать zip-бэкап текущего мода"
            )
            log.write(help_text)
        else:
            log.write(f"[red]Неизвестная команда: {rich_escape(cmd)}. Введи /help[/red]")


    def _send_chat(self) -> None:
        if not self.cfg.provider:
            self.notify("AI-провайдер не настроен", severity="warning")
            return
        text = self.query_one("#chat-input", Input).value.strip()
        if not text:
            return
        self.query_one("#chat-input", Input).value = ""

        if text.startswith("/"):
            self._handle_chat_command(text)
            return
            
        log = self.query_one("#chat-log", RichLog)
        log.write(f"[bold cyan]ты:[/bold cyan] {rich_escape(text)}")
        self._run_agent(text)

    @work(exclusive=True, thread=True)
    def _run_agent(self, task: str) -> None:
        from modkit.agent import run_agent
        from modkit.permissions import Mode
        from modkit.providers.base import ProviderError
        from modkit.tools import build_default_registry
        from modkit.tools.registry import ToolContext

        log = self.query_one("#chat-log", RichLog)
        try:
            provider = build_provider(
                provider_id=self.cfg.provider,
                api_key=self.cfg.api_key_for(self.cfg.provider) or "",
                model=self.cfg.model or "",
                base_url=self.cfg.base_url or "",
                temperature=self.cfg.temperature,
                max_tokens=self.cfg.max_tokens,
            )
        except Exception as exc:
            self.call_from_thread(log.write, f"[red]provider error: {rich_escape(str(exc))}[/red]")
            return

        mods_root = self._mods_root
        mod_root = (mods_root / self.current_mod) if self.current_mod else None
        def _ask_user(payload: dict) -> str:
            """TUI ask_user handler: log question, return default or first option."""
            question = payload.get("question", "")
            options = payload.get("options", [])
            default_val = payload.get("default", "")
            self.call_from_thread(
                log.write,
                f"[yellow]? {question}[/yellow]"
                + (f" (default: {default_val})" if default_val else ""),
            )
            if options:
                return options[0] if isinstance(options[0], str) else options[0].get("value", str(options[0]))
            return default_val

        ctx = ToolContext(
            mods_root=mods_root,
            mod_root=mod_root,
            mode=Mode(self.cfg.permission_mode),
            confirm=lambda name, args: True,  # UI handles prompting via Dialog
            extra={"ask_user": _ask_user},
        )
        registry = build_default_registry(include_shell=bool(self.cfg.provider))

        def on_event(event) -> None:
            record = event_to_record(event)
            self.call_from_thread(log.write, _chat_record_to_rich(record))

        try:
            final = run_agent(
                provider=provider,
                registry=registry,
                ctx=ctx,
                user_task=task,
                history=self.chat_history,
                max_iterations=self.cfg.max_iterations or 12,
                on_event=on_event,
            )
        except Exception as exc:
            self.call_from_thread(log.write, f"[red]error: {rich_escape(str(exc))}[/red]")
            return
            
        self.chat_history = final
        # Refresh mod list in case the agent created something.
        self.call_from_thread(self._refresh_mods, self.current_mod)


class _HelpScreen(ModalScreen[None]):
    BINDINGS = [Binding("escape", "dismiss_help", "Close")]

    HELP = """\
[bold]metera-modkit · горячие клавиши[/bold]

[cyan]Навигация[/cyan]
  Ctrl+L            — фокус на список модов
  Ctrl+T            — фокус на дерево файлов
  Ctrl+R            — обновить

[cyan]Мод[/cyan]
  Ctrl+N            — создать новый мод (выбор шаблона)
  Ctrl+D            — продублировать активный мод
  Delete            — удалить мод (или открытый файл)
  Ctrl+E            — экспортировать мод в .zip
  Ctrl+Shift+E      — открыть папку мода в проводнике
  F5                — провалидировать мод

[cyan]Файл[/cyan]
  Ctrl+S            — сохранить открытый файл
  /                  — поиск по списку модов (в разработке)

[cyan]AI-агент[/cyan]
  Tab "AI"          — чат с LLM-агентом
                     агент может сам искать в docs, читать/писать
                     файлы мода и валидировать изменения

[cyan]Общее[/cyan]
  F1                — эта справка
  Ctrl+Q            — выход

Шаблоны для нового мода:
  empty, item, biome, recipe, class, loot, total_conversion
"""

    def compose(self) -> ComposeResult:
        with Vertical(id="help-dialog"):
            yield Static(self.HELP, id="help-body")
            yield Button("Закрыть", id="help-close", variant="primary")

    @on(Button.Pressed, "#help-close")
    def _close(self) -> None:
        self.dismiss(None)

    def action_dismiss_help(self) -> None:
        self.dismiss(None)


# ── entry point ──────────────────────────────────────────────────────────


def launch(cfg: config_mod.Config) -> int:
    """Run the TUI app. Returns the textual exit code."""
    app = ModKitApp(cfg)
    return app.run() or 0
