import os
import json
import platform
import threading
import customtkinter as ctk
from tkinter import filedialog, messagebox

# --- КОНФИГУРАЦИЯ ИНТЕРФЕЙСА ---
ctk.set_appearance_mode("System")
ctk.set_default_color_theme("blue")

class ProjectScannerApp(ctk.CTk):
    def __init__(self):
        super().__init__()

        # Настройка главного окна
        self.title("Project Scanner Pro")
        self.geometry("850x750")
        self.minsize(800, 700)

        # --- Инициализация конфигурации ---
        self.app_name = "ProjectScannerPro"
        self.config_file = os.path.join(self.get_appdata_dir(), "config.json")
        
        # Базовые настройки (по умолчанию)
        self.config_data = {
            "project_path": os.getcwd(),
            "output_file": os.path.join(os.getcwd(), "project_scan.txt"),
            "full_scan_mode": True,
            "scan_specific_mode": False,
            "specific_folders": [],
            "skip_hidden": True,
            "skip_large_files": True,
            "max_file_size_mb": "1.0",
            "ignored_dirs": [
                '.git', '.idea', '.vscode', '__pycache__', '.godot', 
                'node_modules', 'venv', '.import', 'dist', 'build', 'bin', 'obj', 'sound', '.ai_backups'
            ],
            "ignored_exts": [
                '.png', '.jpg', '.jpeg', '.gif', '.ico', '.bmp', '.tga', '.svg',
                '.wav', '.mp3', '.ogg', '.flac',
                '.exe', '.dll', '.so', '.pck', '.zip', '.rar', '.pdf', '.docx', 
                '.ttr', '.ttf', '.otf', '.pyc',
                '.obj', '.gltf', '.glb', '.fbx', '.dae', '.stl', '.ply', 
                '.blend', '.blend1', '.3ds', '.max', '.ma', '.mb'
            ],
            "ignored_files": [
                'package-lock.json', 'yarn.lock', 'poetry.lock', '.env', '.DS_Store'
            ]
        }

        # Загружаем настройки из AppData (если есть)
        self.load_config()

        # --- Переменные состояния ---
        self.project_path = ctk.StringVar(value=self.config_data["project_path"])
        self.output_file = ctk.StringVar(value=self.config_data["output_file"])
        self.full_scan_mode = ctk.BooleanVar(value=self.config_data["full_scan_mode"]) 
        self.scan_specific_mode = ctk.BooleanVar(value=self.config_data.get("scan_specific_mode", False))
        self.skip_hidden = ctk.BooleanVar(value=self.config_data["skip_hidden"])
        self.skip_large_files = ctk.BooleanVar(value=self.config_data["skip_large_files"])
        self.max_file_size_mb = ctk.StringVar(value=self.config_data["max_file_size_mb"])

        self.create_widgets()

        # Обработка закрытия окна
        self.protocol("WM_DELETE_WINDOW", self.on_closing)

    # --- ЛОГИКА СОХРАНЕНИЯ В APPDATA ---
    def get_appdata_dir(self):
        system = platform.system()
        if system == "Windows":
            base_dir = os.environ.get("APPDATA", os.path.expanduser("~\\AppData\\Roaming"))
        elif system == "Darwin":
            base_dir = os.path.expanduser("~/Library/Application Support")
        else:
            base_dir = os.path.expanduser("~/.config")
        
        app_dir = os.path.join(base_dir, self.app_name)
        os.makedirs(app_dir, exist_ok=True)
        return app_dir

    def load_config(self):
        if os.path.exists(self.config_file):
            try:
                with open(self.config_file, 'r', encoding='utf-8') as f:
                    saved_data = json.load(f)
                    for key, value in saved_data.items():
                        self.config_data[key] = value
            except Exception as e:
                print(f"Ошибка загрузки конфигурации: {e}")

    def save_config(self):
        self.config_data["project_path"] = self.project_path.get()
        self.config_data["output_file"] = self.output_file.get()
        self.config_data["full_scan_mode"] = self.full_scan_mode.get()
        self.config_data["scan_specific_mode"] = self.scan_specific_mode.get()
        self.config_data["skip_hidden"] = self.skip_hidden.get()
        self.config_data["skip_large_files"] = self.skip_large_files.get()
        self.config_data["max_file_size_mb"] = self.max_file_size_mb.get()
        
        self.config_data["specific_folders"] = [line.strip() for line in self.txt_specific_folders.get("0.0", "end").splitlines() if line.strip()]
        self.config_data["ignored_dirs"] = [line.strip() for line in self.txt_ignore_dirs.get("0.0", "end").splitlines() if line.strip()]
        self.config_data["ignored_exts"] = [line.strip() for line in self.txt_ignore_exts.get("0.0", "end").splitlines() if line.strip()]
        self.config_data["ignored_files"] = [line.strip() for line in self.txt_ignore_files.get("0.0", "end").splitlines() if line.strip()]

        try:
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(self.config_data, f, indent=4, ensure_ascii=False)
        except Exception as e:
            print(f"Ошибка сохранения конфигурации: {e}")

    def on_closing(self):
        self.save_config()
        self.destroy()

    # --- СОЗДАНИЕ ИНТЕРФЕЙСА ---
    def create_widgets(self):
        self.tabview = ctk.CTkTabview(self)
        self.tabview.pack(fill="both", expand=True, padx=20, pady=(10, 0))

        self.tab_main = self.tabview.add("Основное")
        self.tab_ignore = self.tabview.add("Исключения")
        self.tab_settings = self.tabview.add("Настройки")

        self.setup_main_tab()
        self.setup_ignore_tab()
        self.setup_settings_tab()

        self.frame_actions = ctk.CTkFrame(self, fg_color="transparent")
        self.frame_actions.pack(pady=10, padx=20, fill="x", side="bottom")

        self.btn_start = ctk.CTkButton(
            self.frame_actions, text="НАЧАТЬ СКАНИРОВАНИЕ", 
            height=45, font=("Arial", 14, "bold"), command=self.start_scan_thread
        )
        self.btn_start.pack(fill="x", pady=(0, 10))

        self.progress_bar = ctk.CTkProgressBar(self.frame_actions, mode='indeterminate')
        self.progress_bar.set(0)
        self.progress_bar.pack(fill="x", pady=(0, 5))
        
        self.status_label = ctk.CTkLabel(self.frame_actions, text="Готов к работе", text_color="gray", font=("Arial", 12))
        self.status_label.pack()

    def setup_main_tab(self):
        # Выбор папки проекта
        ctk.CTkLabel(self.tab_main, text="📁 Базовая папка проекта:", font=("Arial", 13, "bold")).pack(anchor="w", padx=10, pady=(10, 0))
        input_row = ctk.CTkFrame(self.tab_main, fg_color="transparent")
        input_row.pack(fill="x", padx=10, pady=(5, 10))
        
        ctk.CTkEntry(input_row, textvariable=self.project_path).pack(side="left", fill="x", expand=True, padx=(0, 10))
        ctk.CTkButton(input_row, text="Обзор", width=80, command=self.select_directory).pack(side="right")

        # Выбор файла отчета
        ctk.CTkLabel(self.tab_main, text="📄 Файл отчета:", font=("Arial", 13, "bold")).pack(anchor="w", padx=10)
        output_row = ctk.CTkFrame(self.tab_main, fg_color="transparent")
        output_row.pack(fill="x", padx=10, pady=(5, 10))
        
        ctk.CTkEntry(output_row, textvariable=self.output_file).pack(side="left", fill="x", expand=True, padx=(0, 10))
        ctk.CTkButton(output_row, text="Сохранить как", width=80, command=self.select_output_file).pack(side="right")

        # Выбор что сканировать
        scan_target_frame = ctk.CTkFrame(self.tab_main)
        scan_target_frame.pack(fill="both", expand=True, padx=10, pady=5)
        
        ctk.CTkLabel(scan_target_frame, text="Что сканировать:", font=("Arial", 13, "bold")).pack(anchor="w", padx=10, pady=(10, 5))
        
        ctk.CTkRadioButton(scan_target_frame, text="Весь проект (Базовую папку)", variable=self.scan_specific_mode, value=False, command=self.toggle_specific_folders_ui).pack(anchor="w", padx=20, pady=5)
        ctk.CTkRadioButton(scan_target_frame, text="Только выбранные папки:", variable=self.scan_specific_mode, value=True, command=self.toggle_specific_folders_ui).pack(anchor="w", padx=20, pady=5)

        self.specific_folders_frame = ctk.CTkFrame(scan_target_frame, fg_color="transparent")
        self.specific_folders_frame.pack(fill="both", expand=True, padx=40, pady=(0, 10))

        self.txt_specific_folders = ctk.CTkTextbox(self.specific_folders_frame, height=80)
        self.txt_specific_folders.pack(side="left", fill="both", expand=True, padx=(0, 10))
        self.txt_specific_folders.insert("0.0", "\n".join(self.config_data.get("specific_folders", [])))

        btn_frame = ctk.CTkFrame(self.specific_folders_frame, fg_color="transparent")
        btn_frame.pack(side="right", fill="y")
        
        # Сохраняем кнопки в переменные для управления состоянием
        self.btn_add_folder = ctk.CTkButton(btn_frame, text="+ Добавить", width=80, command=self.add_specific_folder)
        self.btn_add_folder.pack(pady=(0, 5))
        
        self.btn_clear_folders = ctk.CTkButton(btn_frame, text="Очистить", width=80, fg_color="#8B0000", hover_color="#5C0000", command=self.clear_specific_folders)
        self.btn_clear_folders.pack()

        self.toggle_specific_folders_ui() # Обновляем состояние UI

        # Режим сканирования (Глубина)
        mode_frame = ctk.CTkFrame(self.tab_main)
        mode_frame.pack(fill="x", padx=10, pady=10)
        ctk.CTkLabel(mode_frame, text="Глубина сканирования:", font=("Arial", 13, "bold")).pack(pady=(10, 5))
        
        ctk.CTkRadioButton(mode_frame, text="Полный скан (Структура + Содержимое файлов)", variable=self.full_scan_mode, value=True).pack(anchor="w", padx=20, pady=5)
        ctk.CTkRadioButton(mode_frame, text="Только архитектура (Дерево папок и файлов)", variable=self.full_scan_mode, value=False).pack(anchor="w", padx=20, pady=(5, 10))

    def setup_ignore_tab(self):
        self.tab_ignore.grid_columnconfigure(0, weight=1)
        self.tab_ignore.grid_columnconfigure(1, weight=1)
        self.tab_ignore.grid_columnconfigure(2, weight=1)

        # 1. Папки
        frame_dirs = ctk.CTkFrame(self.tab_ignore, fg_color="transparent")
        frame_dirs.grid(row=0, column=0, padx=10, pady=5, sticky="nsew")
        
        lbl_dirs = ctk.CTkLabel(frame_dirs, text="Исключить папки:", font=("Arial", 12, "bold"))
        lbl_dirs.pack(anchor="w")
        
        ctk.CTkButton(frame_dirs, text="+ Выбрать папку", height=24, command=self.add_ignore_dir_dialog).pack(anchor="w", pady=(0, 5))

        self.txt_ignore_dirs = ctk.CTkTextbox(frame_dirs, height=350)
        self.txt_ignore_dirs.pack(fill="both", expand=True)
        self.txt_ignore_dirs.insert("0.0", "\n".join(self.config_data["ignored_dirs"]))

        # 2. Форматы (Расширения)
        frame_exts = ctk.CTkFrame(self.tab_ignore, fg_color="transparent")
        frame_exts.grid(row=0, column=1, padx=10, pady=5, sticky="nsew")

        lbl_exts = ctk.CTkLabel(frame_exts, text="Исключить расширения:", font=("Arial", 12, "bold"))
        lbl_exts.pack(anchor="w")
        ctk.CTkLabel(frame_exts, text="(вводить вручную, напр. .exe)", text_color="gray", font=("Arial", 10)).pack(anchor="w", pady=(0, 5))

        self.txt_ignore_exts = ctk.CTkTextbox(frame_exts, height=350)
        self.txt_ignore_exts.pack(fill="both", expand=True)
        self.txt_ignore_exts.insert("0.0", "\n".join(self.config_data["ignored_exts"]))

        # 3. Конкретные файлы
        frame_files = ctk.CTkFrame(self.tab_ignore, fg_color="transparent")
        frame_files.grid(row=0, column=2, padx=10, pady=5, sticky="nsew")

        lbl_files = ctk.CTkLabel(frame_files, text="Исключить файлы:", font=("Arial", 12, "bold"))
        lbl_files.pack(anchor="w")

        ctk.CTkButton(frame_files, text="+ Выбрать файл", height=24, command=self.add_ignore_file_dialog).pack(anchor="w", pady=(0, 5))

        self.txt_ignore_files = ctk.CTkTextbox(frame_files, height=350)
        self.txt_ignore_files.pack(fill="both", expand=True)
        self.txt_ignore_files.insert("0.0", "\n".join(self.config_data["ignored_files"]))

    def setup_settings_tab(self):
        ctk.CTkSwitch(self.tab_settings, text="Игнорировать скрытые файлы/папки (начинаются с точки)", variable=self.skip_hidden).pack(anchor="w", padx=20, pady=15)
        
        size_frame = ctk.CTkFrame(self.tab_settings, fg_color="transparent")
        size_frame.pack(fill="x", padx=20, pady=10)
        
        ctk.CTkSwitch(size_frame, text="Пропускать большие файлы", variable=self.skip_large_files).pack(side="left")
        
        ctk.CTkLabel(size_frame, text="Лимит (МБ):").pack(side="left", padx=(20, 5))
        entry_size = ctk.CTkEntry(size_frame, textvariable=self.max_file_size_mb, width=60)
        entry_size.pack(side="left")

    # --- ЛОГИКА ИНТЕРФЕЙСА ---
    def toggle_specific_folders_ui(self):
        """Включает/выключает текстовое поле и кнопки в зависимости от выбранного режима"""
        state = "normal" if self.scan_specific_mode.get() else "disabled"
        
        self.txt_specific_folders.configure(state=state)
        self.btn_add_folder.configure(state=state)
        self.btn_clear_folders.configure(state=state)

    def clear_specific_folders(self):
        """Очищает список папок"""
        self.txt_specific_folders.configure(state="normal")
        self.txt_specific_folders.delete("0.0", "end")
        if not self.scan_specific_mode.get():
            self.txt_specific_folders.configure(state="disabled")

    def add_specific_folder(self):
        path = filedialog.askdirectory(initialdir=self.project_path.get())
        if path:
            self.txt_specific_folders.configure(state="normal")
            current_text = self.txt_specific_folders.get("0.0", "end").strip()
            
            if current_text:
                self.txt_specific_folders.insert("end", f"\n{path}")
            else:
                self.txt_specific_folders.insert("end", path)
                
            if not self.scan_specific_mode.get():
                self.txt_specific_folders.configure(state="disabled")

    def add_ignore_dir_dialog(self):
        path = filedialog.askdirectory(initialdir=self.project_path.get())
        if path:
            folder_name = os.path.basename(path)
            current_text = self.txt_ignore_dirs.get("0.0", "end").strip()
            if current_text:
                self.txt_ignore_dirs.insert("end", f"\n{folder_name}")
            else:
                self.txt_ignore_dirs.insert("end", folder_name)

    def add_ignore_file_dialog(self):
        path = filedialog.askopenfilename(initialdir=self.project_path.get())
        if path:
            file_name = os.path.basename(path)
            current_text = self.txt_ignore_files.get("0.0", "end").strip()
            if current_text:
                self.txt_ignore_files.insert("end", f"\n{file_name}")
            else:
                self.txt_ignore_files.insert("end", file_name)

    def select_directory(self):
        path = filedialog.askdirectory()
        if path:
            self.project_path.set(path)

    def select_output_file(self):
        path = filedialog.asksaveasfilename(defaultextension=".txt", filetypes=[("Text files", "*.txt"), ("All files", "*.*")])
        if path:
            self.output_file.set(path)

    # --- ЛОГИКА СКАНИРОВАНИЯ ---
    def start_scan_thread(self):
        self.save_config()

        self.btn_start.configure(state="disabled", text="СКАНИРОВАНИЕ...")
        self.progress_bar.start()
        self.status_label.configure(text="Подготовка...", text_color=ctk.ThemeManager.theme["CTkLabel"]["text_color"])
        
        config = {
            "project_path": self.project_path.get(),
            "output_file": self.output_file.get(),
            "full_scan": self.full_scan_mode.get(),
            "scan_specific": self.scan_specific_mode.get(),
            "specific_folders": [line.strip() for line in self.txt_specific_folders.get("0.0", "end").splitlines() if line.strip()],
            "skip_hidden": self.skip_hidden.get(),
            "skip_large": self.skip_large_files.get(),
            "max_mb": 1.0
        }

        try:
            config["max_mb"] = float(self.max_file_size_mb.get())
        except ValueError:
            config["max_mb"] = 1.0
            self.max_file_size_mb.set("1.0")
        
        config["ignore_dirs"] = {line.strip() for line in self.txt_ignore_dirs.get("0.0", "end").splitlines() if line.strip()}
        config["ignore_exts"] = {line.strip().lower() for line in self.txt_ignore_exts.get("0.0", "end").splitlines() if line.strip()}
        config["ignore_files"] = {line.strip() for line in self.txt_ignore_files.get("0.0", "end").splitlines() if line.strip()}

        thread = threading.Thread(target=self.run_scan, args=(config,))
        thread.start()

    def run_scan(self, config):
        try:
            abs_output_file = os.path.abspath(config["output_file"])
            max_size_bytes = config["max_mb"] * 1024 * 1024
            
            # Определяем, какие папки будем сканировать
            if config["scan_specific"]:
                paths_to_scan = [os.path.abspath(p) for p in config["specific_folders"] if os.path.exists(p)]
                if not paths_to_scan:
                    raise FileNotFoundError("Не выбрано ни одной существующей папки для сканирования.")
            else:
                if not os.path.exists(config["project_path"]):
                    raise FileNotFoundError("Указанная базовая папка проекта не существует.")
                paths_to_scan = [os.path.abspath(config["project_path"])]

            with open(config["output_file"], 'w', encoding='utf-8') as f:
                # --- ЭТАП 1: АРХИТЕКТУРА ---
                f.write("========================================\n")
                f.write("        АРХИТЕКТУРА ПРОЕКТА\n")
                f.write("========================================\n\n")

                self.update_status(f"Анализ структуры папок...")

                for base_path in paths_to_scan:
                    if config["scan_specific"]:
                        f.write(f"[{base_path}]\n") # Выделяем корень выбранной папки

                    for root, dirs, files in os.walk(base_path):
                        dirs[:] = [d for d in dirs if d not in config["ignore_dirs"] and not (config["skip_hidden"] and d.startswith('.'))]
                        
                        # Вычисляем отступ относительно текущей базовой папки
                        level = root.replace(base_path, '').count(os.sep)
                        indent = ' ' * 4 * level
                        
                        # Печатаем имя папки (кроме самой базовой, если сканируем весь проект)
                        if root != base_path or config["scan_specific"]:
                            f.write(f"{indent}{os.path.basename(root)}/\n")
                            sub_indent = ' ' * 4 * (level + 1)
                        else:
                            f.write(f"{os.path.basename(root)}/\n")
                            sub_indent = ' ' * 4
                        
                        for file_name in files:
                            if config["skip_hidden"] and file_name.startswith('.'): continue
                            if file_name in config["ignore_files"]: continue
                            if os.path.abspath(os.path.join(root, file_name)) != abs_output_file:
                                f.write(f"{sub_indent}{file_name}\n")
                    f.write("\n")

                if not config["full_scan"]:
                    self.finish_scan(True, config["output_file"])
                    return

                # --- ЭТАП 2: ЧТЕНИЕ СОДЕРЖИМОГО ---
                f.write("\n========================================\n")
                f.write("     СОДЕРЖИМОЕ ТЕКСТОВЫХ ФАЙЛОВ\n")
                f.write("========================================\n\n")

                self.update_status(f"Чтение файлов...")
                
                for base_path in paths_to_scan:
                    for root, dirs, files in os.walk(base_path):
                        dirs[:] = [d for d in dirs if d not in config["ignore_dirs"] and not (config["skip_hidden"] and d.startswith('.'))]

                        for file_name in files:
                            if config["skip_hidden"] and file_name.startswith('.'): continue
                            if file_name in config["ignore_files"]: continue

                            file_path = os.path.join(root, file_name)
                            if os.path.abspath(file_path) == abs_output_file: continue
                            
                            _, ext = os.path.splitext(file_name)
                            if ext.lower() in config["ignore_exts"]: continue

                            self.update_status(f"Обработка: {file_name}")

                            try:
                                with open(file_path, 'r', encoding='utf-8') as content_file:
                                    if config["skip_large"]:
                                        content_file.seek(0, 2)
                                        size = content_file.tell()
                                        content_file.seek(0)
                                        if size > max_size_bytes:
                                            f.write(f"--- Файл {file_name} пропущен (>{config['max_mb']}MB) ---\n\n")
                                            continue

                                    content = content_file.read()
                                    f.write(f"----------------------------------------\n")
                                    f.write(f"Файл: {file_path}\n")
                                    f.write(f"----------------------------------------\n\n")
                                    f.write(content)
                                    f.write("\n\n")
                            except Exception:
                                pass # Игнорируем бинарные файлы

            self.finish_scan(True, config["output_file"])

        except Exception as e:
            self.finish_scan(False, str(e))

    def update_status(self, text):
        """Thread-safe status update via self.after()"""
        if len(text) > 50:
            text = text[:47] + "..."
        self.after(0, lambda: self.status_label.configure(text=text))

    def finish_scan(self, success, message):
        """Thread-safe scan completion via self.after()"""
        def _on_ui_thread():
            self.progress_bar.stop()
            self.btn_start.configure(state="normal", text="НАЧАТЬ СКАНИРОВАНИЕ")
            
            if success:
                self.status_label.configure(text="Готово!", text_color="green")
                if messagebox.askyesno("Успех", f"Сканирование завершено.\n\nОткрыть файл отчета?"):
                    self._open_file_cross_platform(message)
            else:
                self.status_label.configure(text="Ошибка", text_color="red")
                messagebox.showerror("Ошибка", f"Произошла ошибка:\n{message}")
        self.after(0, _on_ui_thread)

    @staticmethod
    def _open_file_cross_platform(filepath):
        """Cross-platform file opener (Windows/macOS/Linux)"""
        import subprocess
        import platform
        system = platform.system()
        try:
            if system == "Windows":
                os.startfile(filepath)
            elif system == "Darwin":
                subprocess.Popen(["open", filepath])
            else:
                subprocess.Popen(["xdg-open", filepath])
        except Exception as e:
            print(f"Не удалось открыть файл: {e}")

if __name__ == "__main__":
    app = ProjectScannerApp()
    app.mainloop()