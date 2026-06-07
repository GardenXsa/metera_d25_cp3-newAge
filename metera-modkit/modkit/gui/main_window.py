"""Main window for the metera-modkit Qt GUI.

A QMainWindow with three dock-like panels and a tabbed work area.

* Left: mod list (QListWidget)
* Middle: file tree (QTreeView + QFileSystemModel)
* Right: QTabWidget
    - Editor (QPlainTextEdit with JSON syntax highlighting)
    - Schema (QTextBrowser, non-editable)
    - Validate (QTextBrowser, non-editable)
    - AI (QTextBrowser + QLineEdit)

Plus: menus, toolbar, status bar, native file dialogs and shell
explorer integration.
"""

from __future__ import annotations

import json
import os
import platform
import re
import shutil
import subprocess
import zipfile
from pathlib import Path
from typing import Any

from PySide6.QtCore import QDir, QSize, Qt, QThread, Signal
from PySide6.QtGui import (
    QAction,
    QFont,
    QKeySequence,
    QTextCursor,
    QTextOption,
)
from PySide6.QtWidgets import (
    QApplication,
    QCompleter,
    QFileDialog,
    QFileSystemModel,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMenu,
    QMessageBox,
    QPlainTextEdit,
    QProgressDialog,
    QPushButton,
    QSplitter,
    QStatusBar,
    QTabWidget,
    QTextBrowser,
    QToolBar,
    QTreeView,
    QVBoxLayout,
    QWidget,
)

from modkit import __version__, config as config_mod, docs as docs_index
from modkit.chat_render import ChatRecord, event_to_record
from modkit.gui.dialogs import NewModDialog, SettingsDialog, confirm
from modkit.gui.json_highlighter import JsonHighlighter
from modkit.paths import resolve_mods_root
from modkit.permissions import Mode


# ── tiny stdlib markdown helpers (used by the Schema tab) ─────────


def _escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


_INLINE_CODE_RE = re.compile(r"`([^`]+)`")
_BOLD_RE = re.compile(r"\*\*([^*]+)\*\*")
_ITALIC_RE = re.compile(r"(?<!\*)\*([^*]+)\*(?!\*)")
_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")


def _inline(text: str) -> str:
    """Apply inline markdown to an already-trusted, single-line string.

    Order matters: escape first, then run the regexes against the
    escaped text (the regexes never emit raw HTML characters).
    """
    s = _escape(text)
    s = _LINK_RE.sub(r'<a href="\2">\1</a>', s)
    s = _INLINE_CODE_RE.sub(r"<code>\1</code>", s)
    s = _BOLD_RE.sub(r"<b>\1</b>", s)
    s = _ITALIC_RE.sub(r"<i>\1</i>", s)
    return s
from modkit.templates import get_template, write_template
from modkit.validate import validate_mod


# ── helpers ──────────────────────────────────────────────────────────────


def _open_in_explorer(path: Path) -> None:
    if platform.system() == "Windows":
        os.startfile(str(path))  # noqa: S606
    elif platform.system() == "Darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])


def _export_zip(src: Path, dest: Path) -> None:
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(src):
            for f in files:
                full = Path(root) / f
                zf.write(full, full.relative_to(src.parent))


# ── AI agent thread ──────────────────────────────────────────────────────


class _AgentWorker(QThread):
    """Runs the LLM agent in a background thread and emits messages."""

    event = Signal(str, str, str, bool)  # kind, title, body, is_markdown
    error = Signal(str)
    finished_history = Signal(list)
    ask_user_signal = Signal(dict)  # payload dict → main window shows dialog

    def __init__(self, cfg: config_mod.Config, mod_path: Path | None, mods_root: Path, task: str, history: list) -> None:
        super().__init__()
        self.cfg = cfg
        self.mod_path = mod_path
        self.mods_root = mods_root
        self.task = task
        self.history = history

    def run(self) -> None:  # type: ignore[override]
        try:
            from modkit.agent import run_agent
            from modkit.providers import build_provider
            from modkit.tools import build_default_registry
            from modkit.tools.registry import ToolContext

            provider = build_provider(
                provider_id=self.cfg.provider,
                api_key=self.cfg.api_key_for(self.cfg.provider) or "",
                model=self.cfg.model or "",
                base_url=self.cfg.base_url or "",
                temperature=self.cfg.temperature,
                max_tokens=self.cfg.max_tokens,
            )
            # ask_user: emit signal to main thread, wait for answer
            def _ask_user(payload: dict) -> str:
                import threading

                result_holder: dict = {"answer": None}
                answer_event = threading.Event()

                def _on_answer(answer: str) -> None:
                    result_holder["answer"] = answer
                    answer_event.set()

                # Store callback so the main window slot can call it
                payload["_answer_callback"] = _on_answer
                self.ask_user_signal.emit(payload)

                # Wait up to 5 minutes for the user to answer
                answer_event.wait(timeout=300)
                return result_holder["answer"] or payload.get("default", "")

            project_root = str(self.mods_root.parent) if self.mods_root.parent.exists() else str(self.mods_root)

            ctx = ToolContext(
                mods_root=self.mods_root,
                mod_root=self.mod_path,
                mode=Mode(self.cfg.permission_mode),
                confirm=lambda name, args: True,
                extra={"ask_user": _ask_user, "project_root": project_root},
            )
            registry = build_default_registry(include_shell=False)
            def safe_emit(ev):
                rec = event_to_record(ev)
                self.event.emit(rec.kind, rec.title, rec.body, rec.is_markdown)

            final_history = run_agent(
                provider=provider,
                registry=registry,
                ctx=ctx,
                user_task=self.task,
                history=self.history,
                max_iterations=self.cfg.max_iterations or 12,
                on_event=safe_emit,
            )
            self.finished_history.emit(final_history)
        except Exception as exc:  # noqa: BLE001
            self.error.emit(str(exc))


# ── main window ──────────────────────────────────────────────────────────


class ModKitWindow(QMainWindow):
    """The main modding workbench window."""

    def __init__(self, cfg: config_mod.Config) -> None:
        super().__init__()
        self.cfg = cfg
        self.mods_root = resolve_mods_root(cfg.mods_dir or None)
        self.current_mod: Path | None = None
        self.current_file: Path | None = None
        self._editor_dirty = False
        self._ai_worker: _AgentWorker | None = None
        self.chat_history = []

        self.setWindowTitle(f"metera-modkit  v{__version__}")
        self.resize(1280, 800)

        # ── central layout ────────────────────────────────────────
        central = QWidget()
        self.setCentralWidget(central)
        outer = QVBoxLayout(central)
        outer.setContentsMargins(0, 0, 0, 0)

        splitter = QSplitter(Qt.Orientation.Horizontal)
        splitter.setChildrenCollapsible(False)
        splitter.setHandleWidth(6)
        splitter.setToolTip("Тяни, чтобы изменить ширину панелей")
        outer.addWidget(splitter)

        # Left: mod list
        self.mod_list = QListWidget()
        self.mod_list.setMinimumWidth(220)
        self.mod_list.itemSelectionChanged.connect(self._on_mod_changed)
        splitter.addWidget(self._wrap_with_title("Моды", self.mod_list))

        # Middle: file tree
        self.fs_model = QFileSystemModel()
        self.fs_model.setFilter(QDir.Filter.AllEntries | QDir.Filter.NoDotAndDotDot)
        self.fs_model.setRootPath(str(self.mods_root))
        self.file_tree = QTreeView()
        self.file_tree.setModel(self.fs_model)
        self.file_tree.setRootIndex(self.fs_model.index(str(self.mods_root)))
        self.file_tree.setMinimumWidth(240)
        self.file_tree.setColumnHidden(1, True)
        self.file_tree.setColumnHidden(2, True)
        self.file_tree.setColumnHidden(3, True)
        self.file_tree.doubleClicked.connect(self._on_file_activated)
        splitter.addWidget(self._wrap_with_title("Файлы", self.file_tree))

        # Right: tabbed work area
        self.tabs = QTabWidget()

        # Editor tab
        self.editor = QPlainTextEdit()
        self.editor.setFont(QFont("Consolas, Menlo, monospace", 10))
        self.editor.setWordWrapMode(QTextOption.WrapMode.NoWrap)
        self.editor.setLineWrapMode(QPlainTextEdit.LineWrapMode.NoWrap)
        self.editor.setTabChangesFocus(False)
        # Indent width of 2 spaces when Tab is pressed.
        tab_width = self.editor.fontMetrics().horizontalAdvance(" ") * 2
        self.editor.setTabStopDistance(tab_width)
        self.editor.textChanged.connect(self._on_editor_changed)
        self._highlighter = JsonHighlighter(self.editor.document())
        self.tabs.addTab(self.editor, "Редактор")

        # Schema tab
        self.schema_view = QTextBrowser()
        self.schema_view.setOpenExternalLinks(False)
        self.tabs.addTab(self.schema_view, "Схема")

        # Validate tab
        self.validate_view = QTextBrowser()
        self.validate_view.setReadOnly(True)
        self.tabs.addTab(self.validate_view, "Валидация")

        # AI tab
        self.ai_view = QTextBrowser()
        self.ai_view.setReadOnly(True)
        self.ai_view.setFont(QFont("Consolas, Menlo, monospace", 10))
        self.ai_view.setOpenExternalLinks(True)
        self.ai_input = QLineEdit()
        self.ai_input.setPlaceholderText("Сообщение агенту…  (Enter = отправить)")
        self.ai_input.returnPressed.connect(self._on_send_ai)
        
        commands = ["/clear", "/undo", "/plan ", "/save ", "/load ", "/backup ", "/help"]
        completer = QCompleter(commands, self.ai_input)
        completer.setCaseSensitivity(Qt.CaseSensitivity.CaseInsensitive)
        completer.setCompletionMode(QCompleter.CompletionMode.PopupCompletion)
        self.ai_input.setCompleter(completer)

        self.ai_send = QPushButton("Отправить")
        self.ai_send.clicked.connect(self._on_send_ai)
        ai_row = QHBoxLayout()
        ai_row.addWidget(self.ai_input, 1)
        ai_row.addWidget(self.ai_send)
        ai_widget = QWidget()
        ai_layout = QVBoxLayout(ai_widget)
        ai_layout.setContentsMargins(4, 4, 4, 4)
        ai_layout.addWidget(self.ai_view, 1)
        ai_layout.addLayout(ai_row)
        self.tabs.addTab(ai_widget, "AI-агент")

        splitter.addWidget(self.tabs)
        splitter.setStretchFactor(0, 1)
        splitter.setStretchFactor(1, 1)
        splitter.setStretchFactor(2, 3)

        # Status bar
        self.setStatusBar(QStatusBar())
        self._refresh_status()

        # Menus + toolbar
        self._build_menus()
        self._build_toolbar()

        # Initial population
        self._refresh_mods()

    # ── wrapping helpers ─────────────────────────────────────────

    @staticmethod
    def _wrap_with_title(title: str, widget: QWidget) -> QWidget:
        wrap = QWidget()
        layout = QVBoxLayout(wrap)
        layout.setContentsMargins(2, 2, 2, 2)
        layout.setSpacing(2)
        header = QLabel(f"<b>{title}</b>")
        header.setStyleSheet("background:#2d2d2d;color:#ddd;padding:4px 6px;")
        layout.addWidget(header)
        layout.addWidget(widget, 1)
        return wrap

    # ── menus & toolbar ──────────────────────────────────────────

    def _build_menus(self) -> None:
        mb = self.menuBar()
        file_menu = mb.addMenu("&Файл")
        file_menu.addAction(self._mk_action("Новый мод…", "Ctrl+N", self._on_new_mod))
        file_menu.addAction(self._mk_action("Сохранить", "Ctrl+S", self._on_save))
        file_menu.addSeparator()
        file_menu.addAction(self._mk_action("Обновить", "Ctrl+R", self._refresh_mods))
        file_menu.addSeparator()
        file_menu.addAction(self._mk_action("Выход", "Ctrl+Q", self.close))

        mod_menu = mb.addMenu("&Мод")
        mod_menu.addAction(self._mk_action("Дублировать", "Ctrl+D", self._on_duplicate))
        mod_menu.addAction(self._mk_action("Удалить", "Delete", self._on_delete))
        mod_menu.addSeparator()
        mod_menu.addAction(self._mk_action("Провалидировать", "F5", self._on_validate))
        mod_menu.addAction(self._mk_action("Экспорт в .zip", "Ctrl+E", self._on_export))
        mod_menu.addAction(self._mk_action("Открыть в проводнике", "Ctrl+Shift+E", self._on_open_explorer))

        view_menu = mb.addMenu("&Вид")
        view_menu.addAction(self._mk_action("Фокус на моды", "Ctrl+L", lambda: self.mod_list.setFocus()))
        view_menu.addAction(self._mk_action("Фокус на файлы", "Ctrl+T", lambda: self.file_tree.setFocus()))
        view_menu.addAction(self._mk_action("Фокус на редактор", "Ctrl+I", lambda: self.editor.setFocus()))

        help_menu = mb.addMenu("&Справка")
        help_menu.addAction(self._mk_action("О программе", "F1", self._on_about))

        settings_menu = mb.addMenu("&Настройки")
        settings_menu.addAction(self._mk_action("Параметры…", "Ctrl+,", self._on_settings))

    def _build_toolbar(self) -> None:
        tb = QToolBar("Главная")
        tb.setIconSize(QSize(20, 20))
        tb.setMovable(False)
        self.addToolBar(tb)
        for label, shortcut, slot in [
            ("Новый", "Ctrl+N", self._on_new_mod),
            ("Сохранить", "Ctrl+S", self._on_save),
            ("Валидация", "F5", self._on_validate),
            ("Экспорт", "Ctrl+E", self._on_export),
            ("Открыть в проводнике", "Ctrl+Shift+E", self._on_open_explorer),
        ]:
            act = QAction(label, self)
            act.setShortcut(QKeySequence(shortcut))
            act.triggered.connect(slot)
            tb.addAction(act)

    def _mk_action(self, label: str, shortcut: str | None, slot) -> QAction:
        act = QAction(label, self)
        if shortcut:
            act.setShortcut(QKeySequence(shortcut))
        act.triggered.connect(slot)
        return act

    # ── mod list ─────────────────────────────────────────────────

    def _refresh_mods(self) -> None:
        self.mod_list.blockSignals(True)
        self.mod_list.clear()
        if not self.mods_root.exists():
            self.mods_root.mkdir(parents=True, exist_ok=True)
        for entry in sorted(self.mods_root.iterdir(), key=lambda p: p.name.lower()):
            if not entry.is_dir():
                continue
            item = QListWidgetItem()
            mj = entry / "mod.json"
            if mj.exists():
                try:
                    data = json.loads(mj.read_text(encoding="utf-8"))
                    label = f"{entry.name}\n  {data.get('name', '')}  v{data.get('version', '?')}"
                except Exception:
                    label = entry.name
            else:
                label = entry.name
            item.setText(label)
            item.setData(Qt.ItemDataRole.UserRole, str(entry))
            self.mod_list.addItem(item)
        self.mod_list.blockSignals(False)
        if self.current_mod and self.mod_list.count() > 0:
            for i in range(self.mod_list.count()):
                if Path(self.mod_list.item(i).data(Qt.ItemDataRole.UserRole)) == self.current_mod:
                    self.mod_list.setCurrentRow(i)
                    break
        self._refresh_status()

    def _on_mod_changed(self) -> None:
        items = self.mod_list.selectedItems()
        if not items:
            self.current_mod = None
            self.file_tree.setRootIndex(self.fs_model.index(str(self.mods_root)))
            return
        mod_path = Path(items[0].data(Qt.ItemDataRole.UserRole))
        if self._editor_dirty and not confirm(
            self,
            "В текущем файле есть несохранённые изменения. Переключить мод?",
        ):
            return
        self.current_mod = mod_path
        self.file_tree.setRootIndex(self.fs_model.index(str(mod_path)))
        # Reset editor
        self.current_file = None
        self.editor.setReadOnly(True)
        self.editor.clear()
        self.schema_view.setHtml("<i>выбери файл</i>")
        self._refresh_status()

    def _on_file_activated(self, index) -> None:
        path = Path(self.fs_model.filePath(index))
        if path.is_dir():
            return
        # Only allow files inside the active mod
        if self.current_mod is None:
            QMessageBox.information(self, "Подсказка", "Сначала выбери мод слева.")
            return
        try:
            path.resolve().relative_to(self.current_mod.resolve())
        except ValueError:
            QMessageBox.warning(self, "Подсказка", f"Файл принадлежит другому моду.")
            return
        self._open_file(path)

    def _open_file(self, path: Path) -> None:
        self.current_file = path
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            text = path.read_text(encoding="utf-8", errors="replace")
        self.editor.setReadOnly(False)
        self.editor.setPlainText(text)
        self._editor_dirty = False
        self._refresh_schema(path)
        self.tabs.setCurrentWidget(self.editor)
        self._refresh_status()

    def _refresh_schema(self, path: Path) -> None:
        rel_name = path.name
        # Try to find a manifest key whose filename matches.
        key = None
        for k in docs_index.runtime_manifest_keys():
            if rel_name == f"{k}.json" or rel_name.startswith(k):
                key = k
                break
        if key is None:
            self.schema_view.setHtml(
                f"<i>Нет схемы для файла '{rel_name}'. "
                f"Список ключей: <code>modkit docs --section runtime-manifest</code>.</i>"
            )
            return
        info = docs_index.schema_lookup(key)
        sections = docs_index.find_sections(key) or docs_index.find_sections("runtime-manifest")
        policy = info["manifest"].get("merge_policy", "?")
        desc = info["manifest"].get("description", "")
        body_parts: list[str] = []
        for s in sections[:2]:
            text = s.body
            if len(text) > 1200:
                text = text[:1200] + "\n…(обрезано, см. полный README)"
            body_parts.append(self._md_to_html(text))
        body = "".join(body_parts) or "<i>(нет соответствующей секции в README)</i>"
        css = self._schema_css()
        self.schema_view.document().setDefaultStyleSheet(css)
        self.schema_view.setHtml(
            f"<h1>{_escape(key)}</h1>"
            f"<p><b>merge_policy:</b> <code>{_escape(policy)}</code></p>"
            f"<p>{_escape(desc)}</p>"
            f"{body}"
        )

    @staticmethod
    def _md_to_html(text: str) -> str:
        """Tiny stdlib-only Markdown→HTML for schema descriptions.

        Supports: ATX headers (#..####), fenced code blocks (```...```),
        bullet/numbered lists, inline code, **bold**, *italic*, [text](url)
        links, paragraphs. Escapes HTML on the way in. Good enough for
        the bundled README, no external deps.
        """
        out: list[str] = []
        lines = text.splitlines()
        i = 0
        n = len(lines)
        in_code = False
        code_buf: list[str] = []
        code_lang = ""
        list_stack: list[tuple[str, int]] = []  # (kind, indent)

        def flush_para(buf: list[str]) -> None:
            if buf:
                out.append(f"<p>{_inline(' '.join(buf).strip())}</p>")
                buf.clear()

        def close_lists(to_indent: int) -> None:
            while list_stack and list_stack[-1][1] > to_indent:
                kind, _ = list_stack.pop()
                out.append(f"</{kind}>")

        para_buf: list[str] = []
        while i < n:
            line = lines[i]
            stripped = line.lstrip()
            indent = len(line) - len(stripped)

            # Fenced code block
            if stripped.startswith("```"):
                flush_para(para_buf)
                close_lists(-1)
                if not in_code:
                    in_code = True
                    code_lang = stripped[3:].strip()
                    code_buf = []
                else:
                    in_code = False
                    lang_class = f" class=\"lang-{_escape(code_lang)}\"" if code_lang else ""
                    code_text = _escape("\n".join(code_buf))
                    out.append(f"<pre{lang_class}><code>{code_text}</code></pre>")
                i += 1
                continue
            if in_code:
                code_buf.append(line)
                i += 1
                continue

            # Blank line → end paragraph / list
            if not stripped:
                flush_para(para_buf)
                close_lists(-1)
                i += 1
                continue

            # ATX header
            if stripped.startswith("#"):
                flush_para(para_buf)
                close_lists(-1)
                level = 0
                while level < len(stripped) and stripped[level] == "#" and level < 4:
                    level += 1
                if level and (level == len(stripped) or stripped[level] == " "):
                    title = stripped[level:].strip()
                    out.append(f"<h{level + 1}>{_inline(title)}</h{level + 1}>")
                    i += 1
                    continue

            # Bullet list
            if re.match(r"^[-*]\s+", stripped):
                flush_para(para_buf)
                # Find the proper list depth.
                if not list_stack or list_stack[-1][1] < indent:
                    out.append("<ul>")
                    list_stack.append(("ul", indent))
                elif list_stack[-1][0] != "ul":
                    close_lists(indent)
                    out.append("<ul>")
                    list_stack.append(("ul", indent))
                content = re.sub(r"^[-*]\s+", "", stripped)
                out.append(f"<li>{_inline(content)}</li>")
                i += 1
                continue

            # Numbered list
            if re.match(r"^\d+\.\s+", stripped):
                flush_para(para_buf)
                if not list_stack or list_stack[-1][1] < indent:
                    out.append("<ol>")
                    list_stack.append(("ol", indent))
                elif list_stack[-1][0] != "ol":
                    close_lists(indent)
                    out.append("<ol>")
                    list_stack.append(("ol", indent))
                content = re.sub(r"^\d+\.\s+", "", stripped)
                out.append(f"<li>{_inline(content)}</li>")
                i += 1
                continue

            # Plain text line → paragraph (joined with next lines until blank)
            para_buf.append(stripped)
            i += 1

        flush_para(para_buf)
        close_lists(-1)
        return "".join(out)

    @staticmethod
    def _schema_css() -> str:
        return (
            "h1 { color: #c0a060; font-size: 18pt; }"
            "h2 { color: #c0a060; font-size: 15pt; margin-top: 12px; }"
            "h3 { color: #b89850; font-size: 13pt; margin-top: 10px; }"
            "h4 { color: #a08840; font-size: 12pt; margin-top: 8px; }"
            "h5, h6 { color: #807030; }"
            "p  { margin: 4px 0 6px 0; }"
            "ul, ol { margin: 4px 0 8px 24px; }"
            "li { margin: 2px 0; }"
            "code { background: #2a2a3a; color: #e0c080;"
            "       padding: 1px 4px; border-radius: 3px;"
            "       font-family: Consolas, Menlo, monospace; }"
            "pre { background: #1a1a26; color: #d0d0d0;"
            "      padding: 8px 10px; border-radius: 4px;"
            "      border-left: 3px solid #806040;"
            "      font-family: Consolas, Menlo, monospace;"
            "      white-space: pre-wrap; }"
            "pre code { background: transparent; padding: 0; }"
            "b, strong { color: #d8b870; }"
            "i, em { color: #b8c890; }"
            "a  { color: #7aaad8; }"
        )

    # ── editor ───────────────────────────────────────────────────

    def _on_editor_changed(self) -> None:
        if not self._editor_dirty and self.current_file is not None:
            self._editor_dirty = True
        # Live JSON check
        if self.current_file and self.current_file.suffix.lower() == ".json":
            try:
                json.loads(self.editor.toPlainText())
                self.validate_view.setHtml("<p style='color:#5fa55a'>JSON OK</p>")
            except json.JSONDecodeError as exc:
                self.validate_view.setHtml(
                    f"<p style='color:#cf6679'>JSON ошибка: {_escape(str(exc))}</p>"
                )

    # ── superpowers tab ───────────────────────────────────────

    def _on_save(self) -> None:
        if not self.current_file:
            QMessageBox.information(self, "Подсказка", "Сначала открой файл.")
            return
        try:
            self.current_file.write_text(self.editor.toPlainText(), encoding="utf-8")
        except OSError as exc:
            QMessageBox.critical(self, "Ошибка", f"Не удалось сохранить: {exc}")
            return
        self._editor_dirty = False
        self.statusBar().showMessage(f"сохранено: {self.current_file.name}", 4000)
        if self.current_file.name == "mod.json" and self.current_mod is not None:
            self._refresh_mods()

    # ── actions ──────────────────────────────────────────────────

    def _on_new_mod(self) -> None:
        dlg = NewModDialog(self, default_author=self.cfg.provider or "Unknown")
        if dlg.exec() != NewModDialog.DialogCode.Accepted:
            return
        data = dlg.result_data()
        target = self.mods_root / data["id"]
        if target.exists():
            QMessageBox.warning(self, "Ошибка", f"мод '{data['id']}' уже существует")
            return
        target.mkdir(parents=True)
        (target / "data").mkdir(exist_ok=True)
        fn = get_template(data["template"]) or get_template("empty")
        if fn is None:
            QMessageBox.critical(self, "Ошибка", "не удалось загрузить шаблоны")
            return
        files = fn(
            {
                "id": data["id"],
                "name": data["name"] or data["id"],
                "author": data["author"],
                "description": data["description"],
            }
        )
        write_template(target, files)
        # Apply CLI-style overrides to mod.json
        mj = target / "mod.json"
        try:
            d = json.loads(mj.read_text(encoding="utf-8"))
        except Exception:
            d = {}
        d["id"] = data["id"]
        if data["name"]:
            d["name"] = data["name"]
        if data["author"]:
            d["author"] = data["author"]
        if data["description"]:
            d["description"] = data["description"]
        if data["template"] == "total_conversion":
            d["total_conversion"] = True
        mj.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
        self._refresh_mods()
        # Select the new mod
        for i in range(self.mod_list.count()):
            if Path(self.mod_list.item(i).data(Qt.ItemDataRole.UserRole)) == target:
                self.mod_list.setCurrentRow(i)
                break
        self.statusBar().showMessage(f"создан мод '{data['id']}'", 4000)

    def _on_duplicate(self) -> None:
        if not self.current_mod:
            return
        new_id = f"{self.current_mod.name}_copy"
        i = 2
        while (self.mods_root / new_id).exists():
            new_id = f"{self.current_mod.name}_copy{i}"
            i += 1
        dest = self.mods_root / new_id
        shutil.copytree(self.current_mod, dest)
        mj = dest / "mod.json"
        if mj.exists():
            try:
                d = json.loads(mj.read_text(encoding="utf-8"))
                d["id"] = new_id
                mj.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception:
                pass
        self._refresh_mods()
        self.statusBar().showMessage(f"продублировано: {new_id}", 4000)

    def _on_delete(self) -> None:
        if self.current_file:
            if not confirm(self, f"Удалить файл '{self.current_file.name}'?", danger=True):
                return
            try:
                self.current_file.unlink()
            except OSError as exc:
                QMessageBox.critical(self, "Ошибка", str(exc))
                return
            self.current_file = None
            self.editor.setReadOnly(True)
            self.editor.clear()
            self._refresh_mods()
            return
        if not self.current_mod:
            return
        if not confirm(self, f"Удалить мод '{self.current_mod.name}' целиком?", danger=True):
            return
        shutil.rmtree(self.current_mod, ignore_errors=True)
        self.current_mod = None
        self._refresh_mods()

    def _on_validate(self) -> None:
        if not self.current_mod:
            QMessageBox.information(self, "Подсказка", "Сначала выбери мод.")
            return
        report = validate_mod(self.current_mod)
        lines: list[str] = []
        if report.ok:
            lines.append(f"<p style='color:#5fa55a'>+ мод '{self.current_mod.name}' валиден</p>")
        else:
            lines.append(f"<p style='color:#cf6679'>x мод '{self.current_mod.name}' невалиден</p>")
        for e in report.errors:
            lines.append(f"<p style='color:#cf6679'>x {_escape(e)}</p>")
        for w in report.warnings:
            lines.append(f"<p style='color:#d2a16b'>! {_escape(w)}</p>")
        self.validate_view.setHtml("\n".join(lines))
        self.tabs.setCurrentWidget(self.validate_view)
        self._refresh_status()

    def _on_export(self) -> None:
        if not self.current_mod:
            return
        dest, _ = QFileDialog.getSaveFileName(
            self,
            "Экспортировать мод в .zip",
            str(self.mods_root / f"{self.current_mod.name}.zip"),
            "Zip files (*.zip)",
        )
        if not dest:
            return
        try:
            _export_zip(self.current_mod, Path(dest))
        except OSError as exc:
            QMessageBox.critical(self, "Ошибка", str(exc))
            return
        self.statusBar().showMessage(f"экспортировано: {dest}", 5000)

    def _on_open_explorer(self) -> None:
        if not self.current_mod:
            return
        _open_in_explorer(self.current_mod)

    def _on_about(self) -> None:
        QMessageBox.about(
            self,
            "metera-modkit",
            f"<h3>metera-modkit  v{__version__}</h3>"
            f"<p>Professional modding workbench for Chronicles of Meterea.</p>"
            f"<p>Модов: <b>{self.mod_list.count()}</b><br/>"
            f"Корень: <code>{self.mods_root}</code><br/>"
            f"AI-провайдер: <b>{self.cfg.provider or '(не настроен)'}</b></p>",
        )

    def _on_settings(self) -> None:
        dlg = SettingsDialog(self.cfg, self)
        if dlg.exec() == SettingsDialog.DialogCode.Accepted and dlg.updated_config is not None:
            self.cfg = dlg.updated_config
            self.statusBar().showMessage(
                f"настройки сохранены: провайдер={self.cfg.provider or '(none)'}",
                6000,
            )

    # ── AI panel ─────────────────────────────────────────────────

    def _handle_chat_command(self, text: str) -> None:
        cmd, *args = text.split(" ", 1)
        arg = args[0].strip() if args else ""
        cmd = cmd.lower()

        if cmd == "/clear":
            self.chat_history.clear()
            self.ai_view.clear()
            self._append_html_block("<i style='color:#888'>Чат очищен. История сброшена.</i>")
        elif cmd == "/undo":
            if not self.chat_history:
                self._append_html_block("<i style='color:#888'>История пуста.</i>")
                return
            idx = len(self.chat_history) - 1
            while idx >= 0 and self.chat_history[idx].role != "user":
                idx -= 1
            if idx >= 0:
                self.chat_history = self.chat_history[:idx]
                self._append_html_block("<i style='color:#888'>Последний запрос и ответы агента удалены из памяти.</i>")
            else:
                self.chat_history.clear()
                self._append_html_block("<i style='color:#888'>История очищена.</i>")
        elif cmd == "/plan":
            if not arg:
                self._append_html_block("<i style='color:#cf6679'>Укажи задачу: /plan &lt;задача&gt;</i>")
                return
            plan_prompt = (
                "ПЛАН ДЕЙСТВИЙ. Изучи текущий мод с помощью инструментов чтения (list_files, read_file, docs_search, schema_lookup). "
                "Напиши подробный пошаговый план решения следующей задачи. "
                "ПОКА НЕ ИЗМЕНЯЙ ФАЙЛЫ (не используй write_file, edit_file, delete_file, shell). "
                f"Задача: {arg}"
            )
            self._append_html_block(f"<div style='color:#888'><i>Режим планирования:</i> {_escape(arg)}</div>")
            self._run_agent(plan_prompt)
        elif cmd == "/save":
            if not arg:
                self._append_html_block("<i style='color:#cf6679'>Укажи имя файла: /save &lt;имя&gt;</i>")
                return
            chats_dir = self.mods_root / ".chats"
            chats_dir.mkdir(exist_ok=True)
            path = chats_dir / f"{arg}.json"
            try:
                data = [m.to_dict() for m in self.chat_history]
                path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                self._append_html_block(f"<i style='color:#5fa55a'>Чат сохранён: {path.name}</i>")
            except Exception as e:
                self._append_html_block(f"<i style='color:#cf6679'>Ошибка сохранения: {e}</i>")
        elif cmd == "/load":
            if not arg:
                self._append_html_block("<i style='color:#cf6679'>Укажи имя файла: /load &lt;имя&gt;</i>")
                return
            path = self.mods_root / ".chats" / f"{arg}.json"
            if not path.exists():
                self._append_html_block(f"<i style='color:#cf6679'>Файл не найден: {path.name}</i>")
                return
            try:
                from modkit.providers.base import Message
                data = json.loads(path.read_text(encoding="utf-8"))
                self.chat_history = [Message.from_dict(m) for m in data]
                self.ai_view.clear()
                self._append_html_block(f"<i style='color:#5fa55a'>Чат загружен: {path.name} ({len(self.chat_history)} сообщений)</i>")
            except Exception as e:
                self._append_html_block(f"<i style='color:#cf6679'>Ошибка загрузки: {e}</i>")
        elif cmd == "/backup":
            if not self.current_mod:
                self._append_html_block("<i style='color:#cf6679'>Сначала выбери мод.</i>")
                return
            name = arg or "backup"
            backups_dir = self.mods_root / ".backups"
            backups_dir.mkdir(exist_ok=True)
            import time
            ts = int(time.time())
            dest = backups_dir / f"{self.current_mod.name}_{name}_{ts}.zip"
            try:
                _export_zip(self.current_mod, dest)
                self._append_html_block(f"<i style='color:#5fa55a'>Бэкап создан: {dest.name}</i>")
            except Exception as e:
                self._append_html_block(f"<i style='color:#cf6679'>Ошибка бэкапа: {e}</i>")
        elif cmd == "/help":
            help_text = (
                "<b>Команды чата:</b><br/>"
                "<code>/clear</code> — очистить историю и экран<br/>"
                "<code>/undo</code> — отменить последний запрос и ответы агента<br/>"
                "<code>/plan &lt;задача&gt;</code> — составить план без изменения файлов<br/>"
                "<code>/save &lt;имя&gt;</code> — сохранить историю чата<br/>"
                "<code>/load &lt;имя&gt;</code> — загрузить историю чата<br/>"
                "<code>/backup [имя]</code> — сделать zip-бэкап текущего мода<br/>"
            )
            self._append_html_block(f"<div style='color:#8ab4f8'>{help_text}</div>")
        else:
            self._append_html_block(f"<i style='color:#cf6679'>Неизвестная команда: {_escape(cmd)}. Введи /help</i>")


    def _on_send_ai(self) -> None:
        if not self.cfg.provider:
            QMessageBox.information(
                self,
                "AI не настроен",
                "Открой Настройки (Ctrl+,) и выбери провайдера + API ключ.",
            )
            return
        text = self.ai_input.text().strip()
        if not text:
            return
        self.ai_input.clear()
        
        if text.startswith("/"):
            self._handle_chat_command(text)
            return

        user_html = f"""
        <table width="100%" border="0" cellspacing="0" cellpadding="6">
          <tr>
            <td width="20%"></td>
            <td style="background-color: #005b9f; color: #ffffff;">
              <b>Ты</b><br/>{_escape(text)}
            </td>
          </tr>
        </table>
        """
        self._append_html_block(user_html)
        self._run_agent(text)

    def _run_agent(self, task: str) -> None:
        self.ai_view.append("<i style='color:#888'>(агент думает…)</i>")
        self.ai_send.setEnabled(False)
        self._ai_worker = _AgentWorker(
            self.cfg, self.current_mod, self.mods_root, task, self.chat_history
        )
        self._ai_worker.event.connect(self._on_ai_event)
        self._ai_worker.error.connect(self._on_ai_error)
        self._ai_worker.finished_history.connect(self._on_ai_finished_history)
        self._ai_worker.ask_user_signal.connect(self._on_ask_user)
        self._ai_worker.start()

    def _remove_thinking_placeholder(self) -> None:
        cursor = self.ai_view.textCursor()
        cursor.movePosition(QTextCursor.MoveOperation.End)
        cursor.select(QTextCursor.SelectionType.BlockUnderCursor)
        if "(агент думает…)" in cursor.selectedText():
            cursor.removeSelectedText()
            if cursor.block().length() <= 1 and not cursor.atStart():
                cursor.deletePreviousChar()

    def _append_html_block(self, html: str) -> None:
        self._remove_thinking_placeholder()
        cursor = self.ai_view.textCursor()
        cursor.movePosition(QTextCursor.MoveOperation.End)
        if not cursor.atBlockStart():
            cursor.insertBlock()
        cursor.insertHtml(html)
        cursor.insertHtml("<br/>")
        self.ai_view.setTextCursor(cursor)
        self.ai_view.ensureCursorVisible()

    def _mini_md_to_html(self, text: str) -> str:
        import re
        text = _escape(text)
        
        # Code blocks
        text = re.sub(
            r"```(?:[a-zA-Z0-9]*\n)?([\s\S]*?)```",
            r"<table width='100%' bgcolor='#1e1e1e'><tr><td style='color:#d4d4d4;'><pre>\1</pre></td></tr></table>",
            text
        )
        
        # Inline code
        text = re.sub(
            r"`([^`]+)`",
            r"<span style='background-color:#1e1e1e; color:#d4d4d4;'>&nbsp;\1&nbsp;</span>",
            text
        )
        
        # Bold
        text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
        
        # Italic
        text = re.sub(r"\*([^*]+)\*", r"<i>\1</i>", text)
        
        # Newlines outside tables
        parts = re.split(r"(<table.*?</table>)", text, flags=re.DOTALL)
        for i in range(len(parts)):
            if not parts[i].startswith("<table"):
                parts[i] = parts[i].replace("\n", "<br/>")
                
        return "".join(parts)

    def _append_chat_record(self, record: ChatRecord) -> None:
        if record.kind == "assistant":
            html = self._mini_md_to_html(record.body)
            bubble = f"""
            <table width="100%" border="0" cellspacing="0" cellpadding="6">
              <tr>
                <td style="background-color: #2d2d2d; color: #dddddd;">
                  <b style="color: #5fa55a;">Агент</b><br/>{html}
                </td>
                <td width="10%"></td>
              </tr>
            </table>
            """
            self._append_html_block(bubble)
            return

        if record.kind == "tool_call":
            body = _escape(record.body)
            bubble = f"""
            <table width="100%" border="0" cellspacing="0" cellpadding="4">
              <tr>
                <td width="5%"></td>
                <td style="background-color: #3c3836; color: #d2a16b;">
                  ⚙ <b>{_escape(record.title)}</b><br/><pre>{body}</pre>
                </td>
                <td width="15%"></td>
              </tr>
            </table>
            """
            self._append_html_block(bubble)
            return

        if record.kind == "tool_result":
            body = _escape(record.body)
            is_ok = record.title.startswith("ok ")
            bg = "#2a332c" if is_ok else "#4a2323"
            fg = "#8ab4f8" if is_ok else "#cf6679"
            icon = "✓" if is_ok else "❌"
            bubble = f"""
            <table width="100%" border="0" cellspacing="0" cellpadding="4">
              <tr>
                <td width="5%"></td>
                <td style="background-color: {bg}; color: {fg};">
                  {icon} <b>{_escape(record.title)}</b>
                  {f'<br/><pre>{body}</pre>' if body else ''}
                </td>
                <td width="15%"></td>
              </tr>
            </table>
            """
            self._append_html_block(bubble)
            return

        if record.kind == "error":
            body = _escape(record.body)
            bubble = f"""
            <table width="100%" border="0" cellspacing="0" cellpadding="4">
              <tr>
                <td width="5%"></td>
                <td style="background-color: #4a2323; color: #cf6679;">
                  ❌ <b>{_escape(record.title)}</b><br/><pre>{body}</pre>
                </td>
                <td width="15%"></td>
              </tr>
            </table>
            """
            self._append_html_block(bubble)
            return

        if record.kind == "done":
            self._append_html_block(f"<div style='color:#888; text-align:center;'><i>{_escape(record.title)}</i></div>")
            return
            
        # Fallback
        body = f"<br/><code>{_escape(record.body)}</code>" if record.body else ""
        self._append_html_block(
            f"<span style='color:#888'>{_escape(record.title)}</span>{body}"
        )

    def _on_ai_event(self, kind: str, title: str, body: str, is_markdown: bool) -> None:
        record = ChatRecord(kind=kind, title=title, body=body, is_markdown=is_markdown)
        self._append_chat_record(record)

    def _on_ai_error(self, msg: str) -> None:
        self._append_chat_record(ChatRecord(kind="error", title="error", body=msg))

    def _on_ask_user(self, payload: dict) -> None:
        """Show a dialog on the main thread when agent asks a question.

        This slot is connected to _AgentWorker.ask_user_signal and runs
        on the GUI thread, so QMessageBox.exec() is safe to call.
        """
        from PySide6.QtWidgets import QMessageBox

        question = payload.get("question", "")
        options = payload.get("options", [])
        default_val = payload.get("default", "")
        callback = payload.get("_answer_callback")

        msg_box = QMessageBox(self)
        msg_box.setWindowTitle("Вопрос агента")
        msg_box.setText(question)
        msg_box.setIcon(QMessageBox.Question)

        if options:
            for i, opt in enumerate(options):
                label = opt if isinstance(opt, str) else opt.get("label", opt.get("value", str(opt)))
                value = opt if isinstance(opt, str) else opt.get("value", str(opt))
                btn = msg_box.addButton(label, QMessageBox.AcceptRole)
                btn.ask_value = value  # type: ignore[attr-defined]
        else:
            msg_box.setStandardButtons(QMessageBox.Ok | QMessageBox.Cancel)
            msg_box.setInformativeText(f"По умолчанию: {default_val}" if default_val else "Нажмите OK для подтверждения")

        msg_box.exec()

        # Determine answer
        answer = default_val
        if options:
            for btn in msg_box.buttons():
                if msg_box.clickedButton() == btn:
                    answer = getattr(btn, "ask_value", btn.text())
                    break
        else:
            if msg_box.result() == QMessageBox.Ok:
                answer = default_val

        # Send answer back to the agent thread
        if callable(callback):
            callback(answer)

    def _on_ai_finished_history(self, history: list) -> None:
        self.chat_history = history
        self.ai_send.setEnabled(True)
        self._ai_worker = None
        self._refresh_mods()

    # ── status ───────────────────────────────────────────────────

    def _refresh_status(self) -> None:
        if self.current_mod is None:
            self.statusBar().showMessage(
                f"Модов: {self.mod_list.count()}   ·   {self.mods_root}"
            )
        else:
            extra = " (не сохранено)" if self._editor_dirty else ""
            file_info = f" · {self.current_file.name}{extra}" if self.current_file else ""
            self.statusBar().showMessage(
                f"Модов: {self.mod_list.count()}   ·   активный: {self.current_mod.name}{file_info}"
            )

    def closeEvent(self, event) -> None:  # type: ignore[override]
        if self._editor_dirty:
            if not confirm(self, "Есть несохранённые изменения. Выйти?"):
                event.ignore()
                return
        event.accept()


# ── launch ───────────────────────────────────────────────────────────────


def launch_gui(cfg: config_mod.Config) -> int:
    """Launch the Qt GUI. Returns 0 on success, non-zero on error."""
    import sys
    import traceback

    app = QApplication.instance() or QApplication(sys.argv)
    app.setApplicationName("metera-modkit")
    app.setApplicationVersion(__version__)
    app.setStyle("Fusion")

    def _excepthook(exc_type, exc_value, exc_tb):
        text = "".join(traceback.format_exception(exc_type, exc_value, exc_tb))
        sys.stderr.write(text) if sys.stderr else None
        try:
            QMessageBox.critical(
                None,
                "metera-modkit: непредвиденная ошибка",
                f"{exc_type.__name__}: {exc_value}\n\n"
                f"Подробности в stderr (если есть).",
            )
        except Exception:
            pass

    sys.excepthook = _excepthook

    window = ModKitWindow(cfg)
    window.show()
    # Check the engine source after the window is visible so the
    # modal dialogs (clone confirmation, progress, error) parent
    # correctly. The agent/chat/validate commands later rely on
    # ``CodeRepo.default()`` being able to find a local clone.
    _gui_ensure_source_ready(window)
    return app.exec()


def _gui_ensure_source_ready(parent: QWidget | None) -> bool:
    """GUI-side counterpart of :func:`modkit.cli._ensure_source_ready`.

    Pops up a ``QMessageBox`` asking the user to clone the engine
    source tree the first time the GUI starts, and a similar dialog
    offering an update whenever the local clone falls behind
    ``origin/<branch>``. Returns ``True`` when the source is usable.
    On failure the user gets a single warning and the GUI continues
    in a degraded mode (commands that need the source will error out
    individually).
    """
    from modkit.source_manager import (
        SourceError,
        default_manager,
        default_spec,
    )

    spec = default_spec()
    mgr = default_manager()

    if not mgr.is_cloned(spec):
        title = "metera-modkit: исходники движка"
        body = (
            f"Чтобы ИИ-агент понимал код движка, ему нужен локальный "
            f"клон репозитория {spec.display_name}.\n\n"
            f"Скачать в:\n{mgr.dir_for(spec)}\n"
            f"(≈ 10–50 МБ, один раз)"
        )
        reply = QMessageBox.question(
            parent,
            title,
            body,
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.Yes,
        )
        if reply != QMessageBox.StandardButton.Yes:
            return False

        progress = QProgressDialog(
            f"Клонирую {spec.display_name}…",
            "",
            0,
            0,
            parent,
        )
        progress.setWindowTitle(title)
        progress.setCancelButton(None)
        progress.setWindowModality(Qt.WindowModality.ApplicationModal)
        progress.show()

        def _report(msg: str) -> None:
            progress.setLabelText(msg)
            QApplication.processEvents()

        try:
            ok = mgr.ensure_ready(spec, update=False, progress=_report)
        except SourceError as exc:
            ok = False
            err = str(exc)
        else:
            err = ""
        finally:
            progress.close()

        if not ok:
            QMessageBox.warning(
                parent,
                title,
                "Не удалось загрузить исходники движка.\n\n"
                f"{err or 'проверьте интернет и попробуйте позже'}\n\n"
                "Команды, которым нужен код движка, будут "
                "недоступны до первой успешной загрузки.",
            )
            return False
        QMessageBox.information(
            parent, title,
            f"Исходники {spec.display_name} готовы.",
        )
        return True

    # Update check: only when the network round-trip is cheap (it is,
    # we do a single ``git rev-parse origin/<branch>``).
    try:
        behind = mgr.has_updates(spec)
    except SourceError as exc:
        return True  # network glitch — keep going with the local copy
    if not behind:
        return True

    reply = QMessageBox.question(
        parent,
        "metera-modkit: обновление исходников",
        f"Доступна новая версия {spec.display_name}. Обновить локальный клон?",
        QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        QMessageBox.StandardButton.No,
    )
    if reply != QMessageBox.StandardButton.Yes:
        return True
    try:
        mgr.ensure_ready(spec, update=True)
    except SourceError as exc:
        QMessageBox.warning(
            parent, "metera-modkit: обновление",
            f"Не удалось обновить: {exc}\n\nработаю с локальной копией.",
        )
    return True
