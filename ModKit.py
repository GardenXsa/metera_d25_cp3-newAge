import os
import json
import platform
import re
import subprocess
import customtkinter as ctk
from tkinter import messagebox

ctk.set_appearance_mode("Dark")
ctk.set_default_color_theme("blue")

class ModKitApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Meterea Creation Kit (Mod SDK)")
        self.geometry("1200x750")
        
        self.mods_dir = self.get_mods_dir()
        self.current_mod_id = None
        self.current_file_path = None
        
        self.setup_ui()
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

    def setup_ui(self):
        # Toolbar
        self.toolbar = ctk.CTkFrame(self, height=45, corner_radius=0, fg_color="#1e1e1e")
        self.toolbar.pack(side="top", fill="x")
        
        ctk.CTkButton(self.toolbar, text="➕ Новый Мод", width=120, command=self.create_mod).pack(side="left", padx=10, pady=8)
        ctk.CTkButton(self.toolbar, text="📂 Открыть папку модов", width=150, fg_color="#34495e", hover_color="#2c3e50", command=self.open_mods_folder).pack(side="left", padx=5, pady=8)
        ctk.CTkButton(self.toolbar, text="🔄 Обновить", width=100, fg_color="#7f8c8d", hover_color="#95a5a6", command=self.load_mods).pack(side="left", padx=5, pady=8)
        
        # Main Panes
        self.panes = ctk.CTkFrame(self, fg_color="transparent")
        self.panes.pack(side="top", fill="both", expand=True, padx=10, pady=10)
        
        # Left: Mods List
        self.mods_frame = ctk.CTkScrollableFrame(self.panes, width=220, label_text="Установленные Моды", label_font=("Arial", 12, "bold"))
        self.mods_frame.pack(side="left", fill="y", padx=(0, 10))
        
        # Middle: Files List Container
        self.mid_container = ctk.CTkFrame(self.panes, width=250, fg_color="transparent")
        self.mid_container.pack(side="left", fill="y", padx=(0, 10))
        
        self.files_frame = ctk.CTkScrollableFrame(self.mid_container, width=250, label_text="Файлы мода", label_font=("Arial", 12, "bold"))
        self.files_frame.pack(side="top", fill="both", expand=True)
        
        self.btn_new_file = ctk.CTkButton(self.mid_container, text="➕ Создать файл", fg_color="#2980b9", command=self.create_file)
        self.btn_new_file.pack(side="bottom", fill="x", pady=(10, 0))

        self.btn_edit_meta = ctk.CTkButton(self.mid_container, text="⚙️ Настройки мода", fg_color="#8e44ad", command=self.edit_metadata)
        self.btn_edit_meta.pack(side="bottom", fill="x", pady=(10, 0))

        # Right: Editor
        self.editor_container = ctk.CTkFrame(self.panes)
        self.editor_container.pack(side="left", fill="both", expand=True)
        
        self.editor_header = ctk.CTkFrame(self.editor_container, height=40, fg_color="#252526", corner_radius=0)
        self.editor_header.pack(side="top", fill="x")
        
        self.lbl_current_file = ctk.CTkLabel(self.editor_header, text="Файл не выбран", font=("Consolas", 14, "bold"), text_color="#5dade2")
        self.lbl_current_file.pack(side="left", padx=15, pady=5)
        
        self.btn_save = ctk.CTkButton(self.editor_header, text="💾 Сохранить (Ctrl+S)", fg_color="#27ae60", hover_color="#2ecc71", width=150, command=self.save_file)
        self.btn_save.pack(side="right", padx=10, pady=5)
        
        self.editor = ctk.CTkTextbox(self.editor_container, font=("Consolas", 14), wrap="none", fg_color="#1e1e1e", text_color="#d4d4d4")
        self.editor.pack(side="top", fill="both", expand=True, padx=2, pady=2)
        
        self.bind("<Control-s>", lambda e: self.save_file())

    def open_mods_folder(self):
        if not os.path.exists(self.mods_dir):
            os.makedirs(self.mods_dir, exist_ok=True)
        if platform.system() == "Windows":
            os.startfile(self.mods_dir)
        elif platform.system() == "Darwin":
            subprocess.Popen(["open", self.mods_dir])
        else:
            subprocess.Popen(["xdg-open", self.mods_dir])

    def load_mods(self):
        for widget in self.mods_frame.winfo_children():
            widget.destroy()
        
        if not os.path.exists(self.mods_dir): return
        
        for folder in sorted(os.listdir(self.mods_dir)):
            full_path = os.path.join(self.mods_dir, folder)
            if os.path.isdir(full_path):
                btn = ctk.CTkButton(self.mods_frame, text=folder, fg_color="#2c3e50", hover_color="#34495e", border_width=1, border_color="#34495e", text_color="#ecf0f1", anchor="w", command=lambda f=folder: self.select_mod(f))
                btn.pack(fill="x", pady=3, padx=2)

    def select_mod(self, mod_id):
        self.current_mod_id = mod_id
        self.current_file_path = None
        self.lbl_current_file.configure(text="Файл не выбран")
        self.editor.delete("1.0", "end")
        self.load_files()

    def load_files(self):
        for widget in self.files_frame.winfo_children():
            widget.destroy()
            
        if not self.current_mod_id: return
        
        mod_path = os.path.join(self.mods_dir, self.current_mod_id)
        
        # Собираем все файлы и сортируем
        all_files = []
        for root, _, files in os.walk(mod_path):
            for file in files:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, mod_path).replace("\\", "/")
                all_files.append((full_path, rel_path))
                
        for full_path, rel_path in sorted(all_files, key=lambda x: x[1]):
            btn = ctk.CTkButton(self.files_frame, text="📄 " + rel_path, fg_color="transparent", hover_color="#34495e", text_color="#bdc3c7", anchor="w", command=lambda p=full_path, r=rel_path: self.open_file(p, r))
            btn.pack(fill="x", pady=1)

    def edit_metadata(self):
        if not self.current_mod_id:
            messagebox.showwarning("Внимание", "Выберите мод!")
            return
        meta_path = os.path.join(self.mods_dir, self.current_mod_id, "mod.json")
        if os.path.exists(meta_path):
            self.open_file(meta_path, "mod.json")

    def open_file(self, full_path, rel_path):
        self.current_file_path = full_path
        self.lbl_current_file.configure(text=f"[{self.current_mod_id}] {rel_path}")
        self.editor.delete("1.0", "end")
        try:
            with open(full_path, 'r', encoding='utf-8') as f:
                self.editor.insert("1.0", f.read())
        except Exception as e:
            self.editor.insert("1.0", f"// Ошибка чтения файла:\n// {e}")

    def save_file(self):
        if not self.current_file_path: return
        content = self.editor.get("1.0", "end-1c")
        try:
            with open(self.current_file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            
            # Визуальный отклик сохранения
            self.btn_save.configure(text="✅ Сохранено!", fg_color="#2ecc71")
            self.after(1500, lambda: self.btn_save.configure(text="💾 Сохранить (Ctrl+S)", fg_color="#27ae60"))
        except Exception as e:
            messagebox.showerror("Ошибка", f"Не удалось сохранить:\n{e}")

    def create_mod(self):
        dialog = ctk.CTkInputDialog(text="Введите ID мода (только англ. буквы и _):", title="Создание Модификации")
        mod_id = dialog.get_input()
        if not mod_id: return
        
        mod_id = mod_id.strip().lower().replace(" ", "_")
        
        if not re.match(r'^[a-z][a-z0-9_]*$', mod_id):
            messagebox.showerror("Error", "Mod ID must be lowercase alphanumeric + underscore, starting with a letter")
            return
        
        mod_path = os.path.join(self.mods_dir, mod_id)
        
        if os.path.exists(mod_path):
            messagebox.showerror("Ошибка", "Мод с таким ID уже существует!")
            return
            
        os.makedirs(mod_path)
        os.makedirs(os.path.join(mod_path, "data"), exist_ok=True)
        
        template_path = os.path.join(os.getcwd(), "data", "mod_template.json")
        template = {
            "mod_json": {
                "id": "__MOD_ID__",
                "name": "__MOD_NAME__",
                "version": "1.0.0",
                "author": "Unknown",
                "description": "Описание мода...",
                "dependencies": ["base_game"],
                "scripts": ["data/main.js"],
                "data": {}
            },
            "files": {
                "data/main.js": "// Инициализация мода\nModAPI.on('onModsInitialized', async () => {\n    console.log('Мод __MOD_ID__ успешно загружен!');\n});\n"
            }
        }

        if os.path.exists(template_path):
            with open(template_path, "r", encoding="utf-8") as f:
                loaded_template = json.load(f)
                template.update(loaded_template)

        replacements = {
            "__MOD_ID__": mod_id,
            "__MOD_NAME__": mod_id.replace("_", " ").title()
        }

        def render_template_value(value):
            if isinstance(value, str):
                for key, replacement in replacements.items():
                    value = value.replace(key, replacement)
                return value
            if isinstance(value, list):
                return [render_template_value(item) for item in value]
            if isinstance(value, dict):
                return {key: render_template_value(item) for key, item in value.items()}
            return value

        meta = render_template_value(template.get("mod_json", {}))
        
        with open(os.path.join(mod_path, "mod.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=4, ensure_ascii=False)
            
        for rel_file_path, raw_content in template.get("files", {}).items():
            safe_rel = rel_file_path.replace("\\", "/").lstrip("/")
            full_file_path = os.path.realpath(os.path.join(mod_path, safe_rel))
            if not full_file_path.startswith(os.path.realpath(mod_path)):
                continue
            os.makedirs(os.path.dirname(full_file_path), exist_ok=True)
            with open(full_file_path, "w", encoding="utf-8") as f:
                f.write(render_template_value(raw_content))
            
        self.load_mods()
        self.select_mod(mod_id)

    def create_file(self):
        if not self.current_mod_id:
            messagebox.showwarning("Внимание", "Сначала выберите мод в левой панели!")
            return
            
        dialog = ctk.CTkInputDialog(text="Введите путь и имя файла (например: data/items.json или scripts/combat.js):", title="Новый файл")
        rel_path = dialog.get_input()
        if not rel_path: return

        # Validate filename: no path traversal, no absolute paths, only safe characters
        if not re.match(r'^[a-zA-Z0-9_./-]+$', rel_path):
            messagebox.showerror("Ошибка", "Имя файла содержит недопустимые символы. Используйте только буквы, цифры, _, -, / и .")
            return
        if rel_path.startswith('/') or rel_path.startswith('..') or ':\\' in rel_path:
            messagebox.showerror("Ошибка", "Абсолютные пути и выход за пределы мода запрещены.")
            return

        mod_path = os.path.join(self.mods_dir, self.current_mod_id)
        full_path = os.path.realpath(os.path.join(mod_path, rel_path))
        if not full_path.startswith(os.path.realpath(mod_path)):
            messagebox.showerror("Error", "Invalid file path")
            return
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        
        if not os.path.exists(full_path):
            with open(full_path, 'w', encoding='utf-8') as f:
                if full_path.endswith('.json'): f.write("{\n    \n}")
                else: f.write("// Новый файл\n")
                
        self.load_files()
        self.open_file(full_path, rel_path)

if __name__ == "__main__":
    app = ModKitApp()
    app.mainloop()
