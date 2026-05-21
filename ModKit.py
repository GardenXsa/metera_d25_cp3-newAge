import sys
import os
import json
import platform
import re
import subprocess
import shutil
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QSplitter,
    QListWidget, QListWidgetItem, QPlainTextEdit, QPushButton, QToolBar,
    QMessageBox, QInputDialog, QFileDialog, QLabel, QStatusBar,
    QStackedWidget, QTreeWidget, QTreeWidgetItem, QMenu
)
from PyQt6.QtGui import QFont, QAction, QKeySequence, QSyntaxHighlighter, QTextCharFormat, QColor
from PyQt6.QtCore import Qt, QRegularExpression

class JsonHighlighter(QSyntaxHighlighter):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.highlightingRules = []

        # Ключи JSON (строки перед двоеточием)
        key_format = QTextCharFormat()
        key_format.setForeground(QColor("#5dade2"))
        key_format.setFontWeight(QFont.Weight.Bold)
        self.highlightingRules.append((QRegularExpression(r'"[^"]*"\s*:'), key_format))

        # Строковые значения
        string_format = QTextCharFormat()
        string_format.setForeground(QColor("#e67e22"))
        self.highlightingRules.append((QRegularExpression(r':\s*"[^"]*"'), string_format))

        # Числа
        number_format = QTextCharFormat()
        number_format.setForeground(QColor("#2ecc71"))
        self.highlightingRules.append((QRegularExpression(r'\b\d+(\.\d+)?\b'), number_format))

        # Булевы значения и null
        keyword_format = QTextCharFormat()
        keyword_format.setForeground(QColor("#9b59b6"))
        keyword_format.setFontWeight(QFont.Weight.Bold)
        keywords = ["true", "false", "null"]
        for word in keywords:
            self.highlightingRules.append((QRegularExpression(rf'\b{word}\b'), keyword_format))

        # Комментарии JS (для скриптов)
        comment_format = QTextCharFormat()
        comment_format.setForeground(QColor("#7f8c8d"))
        comment_format.setFontItalic(True)
        self.highlightingRules.append((QRegularExpression(r'//.*'), comment_format))

    def highlightBlock(self, text):
        for pattern, format in self.highlightingRules:
            iterator = pattern.globalMatch(text)
            while iterator.hasNext():
                match = iterator.next()
                self.setFormat(match.capturedStart(), match.capturedLength(), format)

class JsonTreeWidget(QTreeWidget):
    def __init__(self):
        super().__init__()
        self.setHeaderLabels(["Ключ / Индекс", "Значение"])
        self.setColumnCount(2)
        self.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.customContextMenuRequested.connect(self.open_menu)
        self.setStyleSheet("QTreeWidget::item { padding: 4px; }")

    def load_json(self, data):
        self.clear()
        root_item = QTreeWidgetItem(self, ["root", ""])
        root_item.setData(0, Qt.ItemDataRole.UserRole, type(data).__name__)
        self._build_tree(data, root_item)
        self.expandToDepth(1)

    def _build_tree(self, data, parent_item):
        if isinstance(data, dict):
            for key, value in data.items():
                item = QTreeWidgetItem(parent_item, [str(key), self._get_val_str(value)])
                item.setData(0, Qt.ItemDataRole.UserRole, type(value).__name__)
                item.setFlags(item.flags() | Qt.ItemFlag.ItemIsEditable)
                if isinstance(value, (dict, list)):
                    self._build_tree(value, item)
        elif isinstance(data, list):
            for i, value in enumerate(data):
                item = QTreeWidgetItem(parent_item, [f"[{i}]", self._get_val_str(value)])
                item.setData(0, Qt.ItemDataRole.UserRole, type(value).__name__)
                item.setFlags(item.flags() | Qt.ItemFlag.ItemIsEditable)
                if isinstance(value, (dict, list)):
                    self._build_tree(value, item)

    def _get_val_str(self, value):
        if isinstance(value, (dict, list)): return ""
        if value is None: return "null"
        if isinstance(value, bool): return "true" if value else "false"
        return str(value)

    def to_json(self):
        root_item = self.topLevelItem(0)
        if not root_item: return {}
        return self._parse_item(root_item)

    def _parse_item(self, item):
        t = item.data(0, Qt.ItemDataRole.UserRole)
        if t == 'dict':
            res = {}
            for i in range(item.childCount()):
                child = item.child(i)
                res[child.text(0)] = self._parse_item(child)
            return res
        elif t == 'list':
            res = []
            for i in range(item.childCount()):
                res.append(self._parse_item(item.child(i)))
            return res
        elif t == 'int': 
            try: return int(item.text(1))
            except: return 0
        elif t == 'float': 
            try: return float(item.text(1))
            except: return 0.0
        elif t == 'bool': return item.text(1).lower() == 'true'
        elif t == 'NoneType': return None
        else: return item.text(1)

    def open_menu(self, position):
        item = self.itemAt(position)
        if not item: return
        menu = QMenu()
        t = item.data(0, Qt.ItemDataRole.UserRole)
        
        if t in ['dict', 'list']:
            add_action = menu.addAction("➕ Добавить элемент")
            add_action.triggered.connect(lambda: self.add_child(item, t))
        
        if item != self.topLevelItem(0):
            type_menu = menu.addMenu("🔄 Изменить тип")
            for t_name, t_val in [("Строка", "str"), ("Число", "float"), ("Булево", "bool"), ("Объект", "dict"), ("Массив", "list")]:
                act = type_menu.addAction(t_name)
                act.triggered.connect(lambda checked, tv=t_val, i=item: self.change_type(i, tv))
                
            menu.addSeparator()
            del_action = menu.addAction("❌ Удалить")
            del_action.triggered.connect(lambda: item.parent().removeChild(item))
            
        menu.exec(self.viewport().mapToGlobal(position))
        
    def add_child(self, parent, parent_type):
        key = "new_key" if parent_type == 'dict' else f"[{parent.childCount()}]"
        child = QTreeWidgetItem(parent, [key, "new_value"])
        child.setData(0, Qt.ItemDataRole.UserRole, "str")
        child.setFlags(child.flags() | Qt.ItemFlag.ItemIsEditable)
        parent.setExpanded(True)

    def change_type(self, item, new_type):
        item.setData(0, Qt.ItemDataRole.UserRole, new_type)
        if new_type in ['dict', 'list']:
            item.setText(1, "")
        elif new_type == 'bool':
            item.setText(1, "false")
        elif new_type in ['int', 'float']:
            item.setText(1, "0")
        else:
            item.setText(1, "text")
        
        if new_type not in ['dict', 'list']:
            item.takeChildren()


class ModKitApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Meterea Creation Kit (Mod SDK)")
        self.resize(1200, 750)

        self.mods_dir = self.get_mods_dir()
        self.current_mod_id = None
        self.current_file_path = None

        self.init_ui()
        self.load_mods()

    def get_mods_dir(self):
        system = platform.system()
        if system == "Windows":
            base = os.environ.get("APPDATA", os.path.expanduser("~\\AppData\\Roaming"))
        elif system == "Darwin":
            base = os.path.expanduser("~/Library/Application Support")
        else:
            base = os.path.expanduser("~/.config")
        
        path = os.path.join(base, "chronicles-of-meterea", "mods")
        os.makedirs(path, exist_ok=True)
        return path

    def init_ui(self):
        # Toolbar
        toolbar = QToolBar("Main Toolbar")
        toolbar.setMovable(False)
        self.addToolBar(toolbar)

        action_new_mod = QAction("➕ Новый Мод", self)
        action_new_mod.triggered.connect(self.create_mod)
        toolbar.addAction(action_new_mod)

        action_open_folder = QAction("📂 Открыть папку модов", self)
        action_open_folder.triggered.connect(self.open_mods_folder)
        toolbar.addAction(action_open_folder)

        action_refresh = QAction("🔄 Обновить", self)
        action_refresh.triggered.connect(self.load_mods)
        toolbar.addAction(action_refresh)

        action_export = QAction("📦 Упаковать в ZIP", self)
        action_export.triggered.connect(self.export_mod)
        toolbar.addAction(action_export)

        # Central Widget & Splitter
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_layout = QVBoxLayout(central_widget)
        main_layout.setContentsMargins(5, 5, 5, 5)

        self.splitter = QSplitter(Qt.Orientation.Horizontal)
        main_layout.addWidget(self.splitter)

        # Left Pane: Mods List
        left_pane = QWidget()
        left_layout = QVBoxLayout(left_pane)
        left_layout.setContentsMargins(0, 0, 0, 0)
        left_layout.addWidget(QLabel("<b>Установленные Моды</b>"))
        self.mods_list = QListWidget()
        self.mods_list.itemClicked.connect(self.on_mod_selected)
        left_layout.addWidget(self.mods_list)
        self.splitter.addWidget(left_pane)

        # Middle Pane: Files List
        mid_pane = QWidget()
        mid_layout = QVBoxLayout(mid_pane)
        mid_layout.setContentsMargins(0, 0, 0, 0)
        mid_layout.addWidget(QLabel("<b>Файлы мода</b>"))
        self.files_list = QListWidget()
        self.files_list.itemClicked.connect(self.on_file_selected)
        mid_layout.addWidget(self.files_list)

        btn_new_file = QPushButton("➕ Создать файл")
        btn_new_file.clicked.connect(self.create_file)
        mid_layout.addWidget(btn_new_file)

        btn_edit_meta = QPushButton("⚙️ Настройки мода")
        btn_edit_meta.clicked.connect(self.edit_metadata)
        mid_layout.addWidget(btn_edit_meta)
        self.splitter.addWidget(mid_pane)

        # Right Pane: Editor
        right_pane = QWidget()
        right_layout = QVBoxLayout(right_pane)
        right_layout.setContentsMargins(0, 0, 0, 0)

        editor_header = QHBoxLayout()
        self.lbl_current_file = QLabel("Файл не выбран")
        self.lbl_current_file.setStyleSheet("color: #5dade2; font-weight: bold;")
        editor_header.addWidget(self.lbl_current_file)
        editor_header.addStretch()

        self.btn_toggle_mode = QPushButton("👁 Визуальный редактор")
        self.btn_toggle_mode.clicked.connect(self.toggle_editor_mode)
        self.btn_toggle_mode.setVisible(False)
        editor_header.addWidget(self.btn_toggle_mode)

        self.btn_validate = QPushButton("✅ Проверить JSON")
        self.btn_validate.clicked.connect(self.validate_json)
        self.btn_validate.setVisible(False)
        editor_header.addWidget(self.btn_validate)

        btn_save = QPushButton("💾 Сохранить (Ctrl+S)")
        btn_save.clicked.connect(self.save_file)
        editor_header.addWidget(btn_save)
        right_layout.addLayout(editor_header)

        self.stacked_widget = QStackedWidget()
        
        self.editor = QPlainTextEdit()
        self.editor.setFont(QFont("Consolas", 11))
        self.highlighter = JsonHighlighter(self.editor.document())
        self.stacked_widget.addWidget(self.editor)
        
        self.visual_editor = JsonTreeWidget()
        self.stacked_widget.addWidget(self.visual_editor)
        
        right_layout.addWidget(self.stacked_widget)
        self.splitter.addWidget(right_pane)

        # Set initial splitter sizes
        self.splitter.setSizes([200, 250, 750])

        # Status Bar
        self.statusBar = QStatusBar()
        self.setStatusBar(self.statusBar)
        self.statusBar.showMessage("Готов")

        # Shortcuts
        save_shortcut = QAction("Save", self)
        save_shortcut.setShortcut(QKeySequence("Ctrl+S"))
        save_shortcut.triggered.connect(self.save_file)
        self.addAction(save_shortcut)

    def load_mods(self):
        self.mods_list.clear()
        if not os.path.exists(self.mods_dir): return
        
        for folder in sorted(os.listdir(self.mods_dir)):
            full_path = os.path.join(self.mods_dir, folder)
            if os.path.isdir(full_path):
                item = QListWidgetItem(folder)
                item.setData(Qt.ItemDataRole.UserRole, folder)
                self.mods_list.addItem(item)

    def on_mod_selected(self, item):
        self.current_mod_id = item.data(Qt.ItemDataRole.UserRole)
        self.current_file_path = None
        self.lbl_current_file.setText("Файл не выбран")
        self.editor.clear()
        self.load_files()

    def load_files(self):
        self.files_list.clear()
        if not self.current_mod_id: return
        
        mod_path = os.path.join(self.mods_dir, self.current_mod_id)
        all_files = []
        for root, _, files in os.walk(mod_path):
            for file in files:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, mod_path).replace("\\", "/")
                all_files.append((full_path, rel_path))
                
        for full_path, rel_path in sorted(all_files, key=lambda x: x[1]):
            item = QListWidgetItem("📄 " + rel_path)
            item.setData(Qt.ItemDataRole.UserRole, (full_path, rel_path))
            self.files_list.addItem(item)

    def on_file_selected(self, item):
        full_path, rel_path = item.data(Qt.ItemDataRole.UserRole)
        self.open_file(full_path, rel_path)

    def open_file(self, full_path, rel_path):
        self.current_file_path = full_path
        self.lbl_current_file.setText(f"[{self.current_mod_id}] {rel_path}")
        self.editor.clear()
        self.stacked_widget.setCurrentIndex(0)
        self.btn_toggle_mode.setText("👁 Визуальный редактор")
        
        is_json = full_path.endswith('.json')
        self.btn_toggle_mode.setVisible(is_json)
        self.btn_validate.setVisible(is_json)
        
        try:
            with open(full_path, 'r', encoding='utf-8') as f:
                self.editor.setPlainText(f.read())
        except Exception as e:
            self.editor.setPlainText(f"// Ошибка чтения файла:\n// {e}")

    def save_file(self):
        if not self.current_file_path: return
        
        if self.stacked_widget.currentIndex() == 1:
            data = self.visual_editor.to_json()
            content = json.dumps(data, indent=4, ensure_ascii=False)
            self.editor.setPlainText(content)
        else:
            content = self.editor.toPlainText()
            
        try:
            with open(self.current_file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            self.statusBar.showMessage("✅ Сохранено!", 3000)
        except Exception as e:
            QMessageBox.critical(self, "Ошибка", f"Не удалось сохранить:\n{e}")

    def toggle_editor_mode(self):
        if not self.current_file_path or not self.current_file_path.endswith('.json'):
            return

        if self.stacked_widget.currentIndex() == 0:
            try:
                content = self.editor.toPlainText()
                data = json.loads(content) if content.strip() else {}
                self.visual_editor.load_json(data)
                self.stacked_widget.setCurrentIndex(1)
                self.btn_toggle_mode.setText("📝 Сырой код")
            except json.JSONDecodeError as e:
                QMessageBox.critical(self, "Ошибка JSON", f"Исправьте ошибки синтаксиса перед переключением:\n{e}")
        else:
            data = self.visual_editor.to_json()
            self.editor.setPlainText(json.dumps(data, indent=4, ensure_ascii=False))
            self.stacked_widget.setCurrentIndex(0)
            self.btn_toggle_mode.setText("👁 Визуальный редактор")


    def validate_json(self):
        if not self.current_file_path or not self.current_file_path.endswith('.json'):
            QMessageBox.information(self, "Инфо", "Это не JSON файл. Валидация доступна только для .json")
            return
        content = self.editor.toPlainText()
        try:
            json.loads(content)
            QMessageBox.information(self, "Успех", "JSON валиден! Ошибок нет.")
        except json.JSONDecodeError as e:
            QMessageBox.critical(self, "Ошибка JSON", f"Синтаксическая ошибка:\n{e}")

    def create_mod(self):
        mod_id, ok = QInputDialog.getText(self, "Создание Модификации", "Введите ID мода (только англ. буквы и _):")
        if not ok or not mod_id: return
        
        mod_id = mod_id.strip().lower().replace(" ", "_")
        if not re.match(r'^[a-z][a-z0-9_]*$', mod_id):
            QMessageBox.critical(self, "Ошибка", "Mod ID должен содержать только строчные буквы и _, начинаться с буквы.")
            return
        
        mod_path = os.path.join(self.mods_dir, mod_id)
        if os.path.exists(mod_path):
            QMessageBox.critical(self, "Ошибка", "Мод с таким ID уже существует!")
            return
            
        os.makedirs(mod_path)
        os.makedirs(os.path.join(mod_path, "data"), exist_ok=True)
        
        meta = {
            "id": mod_id,
            "name": mod_id.replace("_", " ").title(),
            "version": "1.0.0",
            "author": "Unknown",
            "description": "Описание мода...",
            "dependencies": ["base_game"],
            "scripts": ["main.js"],
            "data": {}
        }
        
        with open(os.path.join(mod_path, "mod.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=4, ensure_ascii=False)
            
        with open(os.path.join(mod_path, "data", "main.js"), "w", encoding="utf-8") as f:
            f.write("// Инициализация мода\nModAPI.on('onModsInitialized', async () => {\n    console.log('Мод " + mod_id + " успешно загружен!');\n});\n")
            
        self.load_mods()
        # Auto-select the new mod
        for i in range(self.mods_list.count()):
            if self.mods_list.item(i).data(Qt.ItemDataRole.UserRole) == mod_id:
                self.mods_list.setCurrentRow(i)
                self.on_mod_selected(self.mods_list.item(i))
                break

    def create_file(self):
        if not self.current_mod_id:
            QMessageBox.warning(self, "Внимание", "Сначала выберите мод в левой панели!")
            return
            
        rel_path, ok = QInputDialog.getText(self, "Новый файл", "Введите путь и имя файла (например: data/items.json):")
        if not ok or not rel_path: return

        if not re.match(r'^[a-zA-Z0-9_./-]+$', rel_path):
            QMessageBox.critical(self, "Ошибка", "Имя файла содержит недопустимые символы.")
            return
        if rel_path.startswith('/') or rel_path.startswith('..') or ':\\' in rel_path:
            QMessageBox.critical(self, "Ошибка", "Абсолютные пути и выход за пределы мода запрещены.")
            return

        mod_path = os.path.join(self.mods_dir, self.current_mod_id)
        full_path = os.path.realpath(os.path.join(mod_path, rel_path))
        if not full_path.startswith(os.path.realpath(mod_path)):
            QMessageBox.critical(self, "Ошибка", "Недопустимый путь к файлу.")
            return
            
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        
        if not os.path.exists(full_path):
            with open(full_path, 'w', encoding='utf-8') as f:
                if full_path.endswith('.json'): f.write("{\n    \n}")
                else: f.write("// Новый файл\n")
                
        self.load_files()
        self.open_file(full_path, rel_path)

    def edit_metadata(self):
        if not self.current_mod_id:
            QMessageBox.warning(self, "Внимание", "Выберите мод!")
            return
        meta_path = os.path.join(self.mods_dir, self.current_mod_id, "mod.json")
        if os.path.exists(meta_path):
            self.open_file(meta_path, "mod.json")

    def export_mod(self):
        if not self.current_mod_id:
            QMessageBox.warning(self, "Внимание", "Выберите мод для упаковки!")
            return
        mod_path = os.path.join(self.mods_dir, self.current_mod_id)
        export_path, _ = QFileDialog.getSaveFileName(self, "Сохранить ZIP", f"{self.current_mod_id}_v1.0.0.zip", "ZIP Archive (*.zip)")
        if export_path:
            try:
                shutil.make_archive(export_path.replace('.zip', ''), 'zip', mod_path)
                QMessageBox.information(self, "Успех", f"Мод успешно упакован в:\n{export_path}")
            except Exception as e:
                QMessageBox.critical(self, "Ошибка", f"Не удалось упаковать мод:\n{e}")

    def open_mods_folder(self):
        if not os.path.exists(self.mods_dir):
            os.makedirs(self.mods_dir, exist_ok=True)
        if platform.system() == "Windows":
            os.startfile(self.mods_dir)
        elif platform.system() == "Darwin":
            subprocess.Popen(["open", self.mods_dir])
        else:
            subprocess.Popen(["xdg-open", self.mods_dir])

if __name__ == "__main__":
    app = QApplication(sys.argv)
    
    # Dark Theme Stylesheet
    app.setStyleSheet("""
        QMainWindow, QWidget { background-color: #1e1e1e; color: #d4d4d4; }
        QListWidget { background-color: #252526; border: 1px solid #3e3e42; outline: 0; }
        QListWidget::item { padding: 5px; }
        QListWidget::item:selected { background-color: #37373d; color: #ffffff; }
        QPlainTextEdit { background-color: #1e1e1e; color: #d4d4d4; border: 1px solid #3e3e42; selection-background-color: #264f78; }
        QPushButton { background-color: #0e639c; color: #ffffff; border: none; padding: 6px 12px; border-radius: 2px; }
        QPushButton:hover { background-color: #1177bb; }
        QPushButton:pressed { background-color: #094771; }
        QToolBar { background-color: #2d2d30; border: none; padding: 5px; }
        QToolBar QPushButton { margin-right: 5px; }
        QSplitter::handle { background-color: #3e3e42; }
        QStatusBar { background-color: #007acc; color: #ffffff; }
    """)
    
    window = ModKitApp()
    window.show()
    sys.exit(app.exec())

