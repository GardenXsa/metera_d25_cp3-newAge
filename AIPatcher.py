import os
import json
import shutil
import datetime
import difflib
import re
import queue
import time
import customtkinter as ctk
from tkinter import messagebox

# --- НАСТРОЙКИ ИНТЕРФЕЙСА ---
BG_COLOR = "#1e1e1e"
SIDEBAR_COLOR = "#252526"
CARD_BG = "#2d2d30"
TEXT_COLOR = "#d4d4d4"
DIFF_ADD_BG = "#234b23"
DIFF_DEL_BG = "#512020"
ACCENT_COLOR = "#007acc"
SUCCESS_COLOR = "#27ae60"
ERROR_COLOR = "#c0392b"
WARNING_COLOR = "#f39c12"
INFO_COLOR = "#3498db"
BACKUP_DIR = ".ai_backups"

class BackupManagerWindow(ctk.CTkToplevel):
    def __init__(self, parent):
        super().__init__(parent)
        self.title("Машина Времени (История патчей)")
        self.geometry("650x500")
        self.configure(fg_color=BG_COLOR)
        self.attributes("-topmost", True)

        lbl = ctk.CTkLabel(self, text="История бэкапов:", font=("Consolas", 14, "bold"), text_color=ACCENT_COLOR)
        lbl.pack(pady=10)

        self.scroll_frame = ctk.CTkScrollableFrame(self, fg_color=SIDEBAR_COLOR)
        self.scroll_frame.pack(fill="both", expand=True, padx=10, pady=10)
        
        self.all_backups = []
        self.loaded_count = 0
        self.chunk_size = 20
        self.is_loading = False

        self.init_backups_list()
        self.check_scroll_position()

    def init_backups_list(self):
        if not os.path.exists(BACKUP_DIR): return
        items = os.listdir(BACKUP_DIR)
        self.all_backups = sorted([d for d in items if os.path.isdir(os.path.join(BACKUP_DIR, d))], reverse=True)
        self.load_more_backups()

    def load_more_backups(self):
        if self.is_loading or self.loaded_count >= len(self.all_backups): return
        self.is_loading = True
        chunk = self.all_backups[self.loaded_count : self.loaded_count + self.chunk_size]
        
        for b_dir in chunk:
            full_path = os.path.join(BACKUP_DIR, b_dir)
            meta_path = os.path.join(full_path, "patch_meta.json")
            name = b_dir
            
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, 'r', encoding='utf-8') as f:
                        meta = json.load(f)
                        name = f"[{meta['timestamp']}] {meta['patch_name']}"
                except: pass

            frame = ctk.CTkFrame(self.scroll_frame, fg_color=BG_COLOR)
            frame.pack(fill="x", pady=3, padx=5)
            ctk.CTkLabel(frame, text=name, font=("Consolas", 12), anchor="w").pack(side="left", padx=10, pady=8)
            ctk.CTkButton(frame, text="ОТКАТИТЬ", width=80, fg_color=ERROR_COLOR, command=lambda p=full_path: self.restore(p)).pack(side="right", padx=10)

        self.loaded_count += len(chunk)
        self.is_loading = False

    def check_scroll_position(self):
        if not self.winfo_exists(): return
        if self.loaded_count < len(self.all_backups):
            try:
                yview = self.scroll_frame._parent_canvas.yview()
                if len(yview) == 2 and yview[1] >= 0.90: self.load_more_backups()
            except Exception: pass
        self.after(250, self.check_scroll_position)

    def restore(self, path):
        if messagebox.askyesno("Внимание", "Вы уверены, что хотите откатить файлы к этой версии?\nТекущие несохраненные изменения будут утеряны."):
            for root, _, files in os.walk(path):
                for f in files:
                    if f == "patch_meta.json": continue
                    src = os.path.join(root, f)
                    rel = os.path.relpath(src, path)
                    dst = os.path.join(os.getcwd(), rel)
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    shutil.copy2(src, dst)
            messagebox.showinfo("Успех", "Файлы успешно восстановлены!")
            self.destroy()

class EditOpWindow(ctk.CTkToplevel):
    def __init__(self, parent, op_data, save_callback):
        super().__init__(parent)
        self.title("Редактирование блока")
        self.geometry("700x500")
        self.configure(fg_color=BG_COLOR)
        self.attributes("-topmost", True)
        self.save_callback = save_callback

        self.textbox = ctk.CTkTextbox(self, font=("Consolas", 12), wrap="none")
        self.textbox.pack(fill="both", expand=True, padx=10, pady=10)
        self.textbox.insert("1.0", json.dumps(op_data, indent=2, ensure_ascii=False))
        self.textbox._textbox.bind("<MouseWheel>", lambda e: "break")

        btn_frame = ctk.CTkFrame(self, fg_color="transparent")
        btn_frame.pack(fill="x", padx=10, pady=10)
        
        ctk.CTkButton(btn_frame, text="Отмена", fg_color=ERROR_COLOR, command=self.destroy).pack(side="left", padx=5)
        ctk.CTkButton(btn_frame, text="Сохранить", fg_color=SUCCESS_COLOR, command=self.save).pack(side="right", padx=5)

    def save(self):
        try:
            new_data = json.loads(self.textbox.get("1.0", "end").strip(), strict=False)
            self.save_callback(new_data)
            self.destroy()
        except Exception as e:
            messagebox.showerror("Ошибка JSON", f"Некорректный JSON:\n{e}")

class SearchEngine:
    @staticmethod
    def multi_tier_search(file_text, search_text):
        if not search_text.strip(): return None, [], "Пустой запрос"
        if search_text in file_text: return search_text, [], "Точное совпадение"

        def normalize_strict(text):
            norm_chars, orig_indices = [], []
            for i, char in enumerate(text):
                if not char.isspace():
                    if char in ["'", '"', "`"]: char = '"'
                    norm_chars.append(char)
                    orig_indices.append(i)
            return "".join(norm_chars), orig_indices

        file_norm, file_map = normalize_strict(file_text)
        search_norm, _ = normalize_strict(search_text)

        if search_norm:
            idx = file_norm.find(search_norm)
            if idx != -1:
                return file_text[file_map[idx]:file_map[idx + len(search_norm) - 1] + 1], [], "Игнор пробелов и кавычек"

        file_lines = file_text.splitlines()
        search_lines = [line.strip() for line in search_text.splitlines() if line.strip()]
        
        if search_lines:
            s_len = len(search_lines)
            for i in range(len(file_lines) - s_len + 1):
                chunk = file_lines[i:i + s_len + 2]
                if difflib.SequenceMatcher(None, "\n".join(search_lines), "\n".join([l.strip() for l in chunk if l.strip()])).ratio() > 0.92:
                    start_idx = file_text.find(file_lines[i])
                    end_idx = file_text.find(file_lines[min(i + s_len + 1, len(file_lines)-1)]) + len(file_lines[min(i + s_len + 1, len(file_lines)-1)])
                    return file_text[start_idx:end_idx], [], "Построчный Fuzzy Search (92%+)"

        suggestions = []
        search_len = len(search_norm)
        step = max(1, search_len // 3) 
        
        for i in range(0, len(file_norm) - search_len + 1, step):
            # КРИТИЧНО: отдаём GIL главному потоку для отрисовки UI
            if i % (step * 3) == 0:
                time.sleep(0) 

            window = file_norm[i:i + search_len + int(search_len * 0.3)] 
            ratio = difflib.SequenceMatcher(None, search_norm, window).ratio()
            if ratio > 0.80: 
                match = difflib.SequenceMatcher(None, search_norm, window).find_longest_match(0, len(search_norm), 0, len(window))
                if match.size > 0:
                    candidate = file_text[file_map[i + match.b]:file_map[min(i + match.b + match.size - 1, len(file_map) - 1)] + 1]
                    if candidate not in [s[1] for s in suggestions]: suggestions.append((ratio, candidate))

        suggestions.sort(key=lambda x: x[0], reverse=True)
        return None, suggestions[:4], "Не найдено (Требуется ручной выбор)"

class AIPatcherPro(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("AI Patcher Pro - Enterprise Search Edition")
        self.geometry("1300x800")
        self.configure(fg_color=BG_COLOR)

        self.current_patch_name = "Без имени"
        self.raw_operations = []
        self.operations = [] 
        self.memory_files = {}
        self.sort_mode = "Сначала ошибки" 
        
        # Кооперативная обработка вместо ThreadPoolExecutor (устраняет GIL-фризы Tkinter)
        self._pending_ops = []
        self._proc_idx = 0
        self._current_file_cache = {}
        
        self.render_queue = queue.Queue()
        
        self.total_ops = 0
        self.completed_ops = 0
        self.is_processing = False
        self.is_rendering = False

        self.setup_ui()

    def bind_scroll_fix(self, widget):
        widget._textbox.bind("<MouseWheel>", lambda e: "break")
        widget._textbox.bind("<Button-4>", lambda e: "break") 
        widget._textbox.bind("<Button-5>", lambda e: "break") 

    def setup_ui(self):
        self.sidebar = ctk.CTkFrame(self, width=350, fg_color=SIDEBAR_COLOR, corner_radius=0)
        self.sidebar.pack(side="left", fill="y")

        ctk.CTkLabel(self.sidebar, text="AI PATCHER PRO", font=("Consolas", 18, "bold"), text_color=ACCENT_COLOR).pack(pady=10)

        btn_box = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        btn_box.pack(fill="x", padx=10)
        ctk.CTkButton(btn_box, text="📋 Вставить", width=140, height=28, command=self.paste).pack(side="left", padx=2)
        ctk.CTkButton(btn_box, text="🗑 Очистить", width=140, height=28, fg_color=ERROR_COLOR, command=self.clear).pack(side="right", padx=2)

        ctk.CTkLabel(self.sidebar, text="Сырой JSON от ИИ:", font=("Consolas", 11)).pack(anchor="w", padx=10, pady=(10,0))
        self.txt_json = ctk.CTkTextbox(self.sidebar, height=200, font=("Consolas", 11), wrap="none")
        self.txt_json.pack(padx=10, pady=5, fill="both", expand=True)
        self.bind_scroll_fix(self.txt_json)

        self.btn_analyze = ctk.CTkButton(self.sidebar, text="🔍 Парсить и Анализировать", height=40, command=self.parse_and_analyze)
        self.btn_analyze.pack(pady=10, padx=10, fill="x")

        self.progress_frame = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        self.progress_frame.pack(fill="x", padx=10, pady=5)
        
        self.lbl_status = ctk.CTkLabel(self.progress_frame, text="Статус: Ожидание", font=("Consolas", 13, "bold"), text_color=WARNING_COLOR)
        self.lbl_status.pack(pady=2)
        
        self.progress_bar = ctk.CTkProgressBar(self.progress_frame, height=10)
        self.progress_bar.pack(fill="x", pady=5)
        self.progress_bar.set(0)
        
        self.lbl_progress_text = ctk.CTkLabel(self.progress_frame, text="0 / 0", font=("Consolas", 10))
        self.lbl_progress_text.pack()

        self.btn_history = ctk.CTkButton(self.sidebar, text="📜 История бэкапов", height=30, fg_color="#8e44ad", command=self.open_history)
        self.btn_history.pack(pady=5, padx=10, fill="x", side="bottom")

        self.btn_copy_report = ctk.CTkButton(self.sidebar, text="🤖 Отчет об ошибках для ИИ", height=35, fg_color="#d35400", hover_color="#e67e22", command=self.copy_error_report)
        self.btn_copy_report.pack(pady=5, padx=10, fill="x", side="bottom")

        self.btn_apply = ctk.CTkButton(self.sidebar, text="✅ ПРИМЕНИТЬ ПАТЧ", height=45, state="disabled", fg_color=SUCCESS_COLOR, command=self.apply)
        self.btn_apply.pack(pady=10, padx=10, fill="x", side="bottom")

        self.right_frame = ctk.CTkFrame(self, fg_color=BG_COLOR)
        self.right_frame.pack(side="right", fill="both", expand=True)

        self.top_bar = ctk.CTkFrame(self.right_frame, fg_color="transparent")
        self.top_bar.pack(fill="x", padx=10, pady=(10, 0))
        
        ctk.CTkLabel(self.top_bar, text="Сортировка:", font=("Consolas", 12)).pack(side="left", padx=5)
        self.sort_menu = ctk.CTkOptionMenu(self.top_bar, values=["Сначала ошибки", "По умолчанию", "По файлам"], command=self.change_sort)
        self.sort_menu.set(self.sort_mode)
        self.sort_menu.pack(side="left", padx=5)

        self.main_area = ctk.CTkScrollableFrame(self.right_frame, fg_color=BG_COLOR)
        self.main_area.pack(fill="both", expand=True, padx=10, pady=10)

    def change_sort(self, choice):
        self.sort_mode = choice
        if not self.is_processing:
            self.apply_sorting()
            self.queue_all_for_render()

    def apply_sorting(self):
        def status_weight(status):
            if status == 'error': return 0
            if status == 'already_applied': return 1
            return 2

        if self.sort_mode == "По умолчанию":
            self.operations.sort(key=lambda x: x['id'])
        elif self.sort_mode == "По файлам":
            self.operations.sort(key=lambda x: (x['op'].get('path') or x['op'].get('file', ''), x['id']))
        elif self.sort_mode == "Сначала ошибки":
            self.operations.sort(key=lambda x: (status_weight(x['status']), x['id']))

    def paste(self):
        self.txt_json.delete("1.0", "end")
        self.txt_json.insert("end", self.clipboard_get())

    def clear(self):
        self.txt_json.delete("1.0", "end")
        self.raw_operations = []
        self.operations = []
        self.memory_files = {}
        self.is_processing = False
        self.is_rendering = False
        self._pending_ops = []
        self._proc_idx = 0
        self._current_file_cache = {}
        with self.render_queue.mutex: self.render_queue.queue.clear()
        
        for widget in self.main_area.winfo_children():
            widget.destroy()
             
        self.btn_apply.configure(state="disabled")
        self.lbl_status.configure(text="Статус: Ожидание", text_color=WARNING_COLOR)
        self.progress_bar.set(0)
        self.lbl_progress_text.configure(text="0 / 0")

    def open_history(self):
        BackupManagerWindow(self)

    def copy_error_report(self):
        failed_ops = [op for op in self.operations if op['status'] != 'success']

        if not failed_ops:
            messagebox.showinfo("Отчет", "Нет ошибок для копирования. Все операции успешны!")
            return

        report = "Привет, ИИ. При применении твоего патча возникли следующие ошибки. Пожалуйста, проанализируй их и выдай исправленный JSON.\n\n"

        for i, item in enumerate(failed_ops, 1):
            op = item['op']
            status = item['status']
            error_msg = item['error']
            path = op.get('path') or op.get('file', 'Неизвестный файл')
            action = op.get('action') or op.get('op', 'Неизвестное действие')

            report += f"### Ошибка {i}: Файл `{path}` (Действие: `{action}`)\n"
            report += f"**Статус:** {'Уже применено (Код уже есть в файле)' if status == 'already_applied' else 'Ошибка поиска'}\n"
            report += f"**Причина:** {error_msg}\n\n"

            search_text = op.get('search') or op.get('original', '')
            if search_text:
                report += "**Что ты пытался найти (search/original):**\n```\n" + search_text + "\n```\n\n"

            content_text = op.get('content') or op.get('text') or op.get('code', '')
            if content_text:
                report += "**Что ты хотел вставить (content/code):**\n```\n" + content_text + "\n```\n\n"

            if item.get('suggestions'):
                report += "**Возможные совпадения в файле (Fuzzy Search нашел это):**\n"
                for idx, (ratio, sug_text) in enumerate(item['suggestions']):
                    report += f"- Вариант {idx+1} (Совпадение {int(ratio*100)}%):\n```\n{sug_text}\n```\n"
                report += "\n"

            report += "---\n\n"

        self.clipboard_clear()
        self.clipboard_append(report)
        messagebox.showinfo("Скопировано", "Отчет об ошибках скопирован в буфер обмена!\nПросто вставь его (Ctrl+V) в чат с ИИ.")

    def _evaluate_single_op(self, item):
        """Синхронная обработка одной операции с сохранением состояния файла в кэше"""
        op = item['op']
        path = op.get('path') or op.get('file', 'unknown')
        abs_p = os.path.abspath(path)
        
        # Загружаем файл в кэш, если его там нет
        if abs_p not in self._current_file_cache:
            if os.path.exists(abs_p):
                try:
                    with open(abs_p, 'r', encoding='utf-8') as f: self._current_file_cache[abs_p] = f.read()
                except Exception: self._current_file_cache[abs_p] = ""
            else:
                self._current_file_cache[abs_p] = ""

        current_content = self._current_file_cache[abs_p]
        virtual_exists = bool(current_content) or os.path.exists(abs_p)
        
        action = op.get("action") or op.get("op", "unknown")
        search = op.get("search") or op.get("original") or op.get("find", "")
        content = op.get("content") or op.get("text") or op.get("code", "")
        
        res = {'id': item['id'], 'op': op, 'status': 'success', 'error': '', 'diff': [], 'suggestions': [], 'search_method': ''}

        if action != "create_file" and not virtual_exists:
            res['status'], res['error'] = 'error', 'Файл не найден на диске.'
            self.operations.append(res)
            return

        if action == "create_file": virtual_exists = True

        old_c = current_content
        new_c = old_c

        try:
            if action == "create_file": 
                new_c, res['search_method'] = content, "Создание файла"
            elif action in ["replace", "insert_after", "insert_before", "delete"]:
                if not search and action != "delete": raise ValueError("Отсутствует поле 'search' (или 'original')")
                
                actual_search, suggestions, method_name = SearchEngine.multi_tier_search(old_c, search)
                res['search_method'] = method_name
                
                if not actual_search:
                    if content and content.strip() and content.strip() in old_c:
                        res['status'] = 'already_applied'
                        res['error'] = 'Этот код уже присутствует в файле. Похоже, патч был применен ранее.'
                        self.operations.append(res)
                        return
                    elif action == 'delete':
                        res['status'] = 'already_applied'
                        res['error'] = 'Текст для удаления не найден. Вероятно, он уже был удален.'
                        self.operations.append(res)
                        return
                    else:
                        res['suggestions'] = suggestions
                        raise ValueError("Текст для привязки не найден. ИИ сильно изменил код.")

                if action == "replace": new_c = old_c.replace(actual_search, content)
                elif action == "insert_after": new_c = old_c.replace(actual_search, actual_search + "\n" + content)
                elif action == "insert_before": new_c = old_c.replace(actual_search, content + "\n" + actual_search)
                elif action == "delete": new_c = old_c.replace(actual_search, "")
            
            elif action == "append": new_c, res['search_method'] = old_c + "\n" + content, "Добавление в конец"
            elif action == "prepend": new_c, res['search_method'] = content + "\n" + old_c, "Добавление в начало"
            else: raise ValueError(f"Неизвестное действие: {action}")

            diff_lines = list(difflib.unified_diff(old_c.splitlines(), new_c.splitlines(), n=2, lineterm=''))
            
            if not diff_lines and action != 'create_file':
                res['status'] = 'already_applied'
                res['error'] = 'Изменений нет. Этот блок кода уже идентичен тому, что предлагает ИИ.'
            
            res['diff'] = diff_lines
            self._current_file_cache[abs_p] = new_c 

        except Exception as e:
            res['status'], res['error'] = 'error', str(e)

        self.operations.append(res)

    def _start_cooperative_processing(self, pending_ops):
        """Запускает плавную обработку без блокировки UI"""
        self.btn_analyze.configure(state="disabled")
        self.lbl_status.configure(text="⏳ Анализ и поиск...", text_color=WARNING_COLOR)
        
        self.total_ops = max(len(pending_ops), 1)
        self.completed_ops = 0
        self.is_processing = True
        self.operations.clear()
        self.memory_files.clear()
        self._pending_ops = pending_ops
        self._proc_idx = 0
        self._current_file_cache = {}
        
        self.after(10, self._process_next_chunk)

    def _process_next_chunk(self):
        """Обрабатывает 1-2 операции за тик, обновляет прогресс-бар и отдаёт управление UI"""
        if not self.is_processing or self._proc_idx >= len(self._pending_ops):
            self.finalize_processing()
            return

        ops_this_tick = 0
        while self._proc_idx < len(self._pending_ops) and ops_this_tick < 2:
            self._evaluate_single_op(self._pending_ops[self._proc_idx])
            self._proc_idx += 1
            self.completed_ops += 1
            ops_this_tick += 1
            time.sleep(0) # Мгновенная отдача GIL планировщику

        # Принудительное обновление прогресс-бара
        progress = self.completed_ops / self.total_ops
        self.progress_bar.set(progress)
        self.lbl_progress_text.configure(text=f"{self.completed_ops} / {self.total_ops}")
        self.progress_bar.update_idletasks()
        self.lbl_progress_text.update_idletasks()

        self.after(5, self._process_next_chunk)

    def parse_and_analyze(self):
        raw = self.txt_json.get("1.0", "end").strip()
        try:
            match = re.search(r'(\[.*\]|\{.*\})', raw, re.DOTALL)
            if not match: 
                raise ValueError("JSON структура (массив или объект) не найдена")
            
            js_str = match.group(1)
            js_str = re.sub(r',(\s*[\]}])', r'\1', js_str) 
            
            data = json.loads(js_str, strict=False)
            
            self.current_patch_name = "Без имени"
            raw_ops = []

            if isinstance(data, list):
                self.current_patch_name = "Патч из массива"
                raw_ops = data
            elif isinstance(data, dict):
                if "operations" in data:
                    self.current_patch_name = data.get("patch_name", "Без имени")
                    raw_ops = data.get("operations", [])
                elif "op" in data or "action" in data:
                    self.current_patch_name = "Одиночная операция"
                    raw_ops = [data]
                else:
                    raise ValueError("Неизвестный формат JSON (нет массива operations или ключа op)")
            else:
                raise ValueError("Ожидался список или словарь")
            
            self.clear()
            self.raw_operations = [{'id': i, 'op': op} for i, op in enumerate(raw_ops)]
            self._start_cooperative_processing(self.raw_operations)
             
        except Exception as e:
            messagebox.showerror("Ошибка парсинга", f"Не удалось прочитать JSON:\n{e}")

    def recalculate_file(self, filepath):
        self.btn_apply.configure(state="disabled")
        self.lbl_status.configure(text="⏳ Перерасчет файла...", text_color=WARNING_COLOR)
        
        self.operations = [op for op in self.operations if (op['op'].get('path') or op['op'].get('file', 'unknown')) != filepath]
        file_raw_ops = [item for item in self.raw_operations if (item['op'].get('path') or item['op'].get('file', 'unknown')) == filepath]
        
        self.is_processing = True
        self.total_ops = len(self.raw_operations)
        self.completed_ops = len(self.operations)
        self._pending_ops = file_raw_ops
        self._proc_idx = 0
        # Кэш для этого файла сбрасывается, чтобы перечитать с диска
        abs_p = os.path.abspath(filepath)
        if abs_p in self._current_file_cache: del self._current_file_cache[abs_p]
        
        self.after(10, self._process_next_chunk)

    def process_render_queue(self): 
        try:
            item = self.render_queue.get_nowait()
            self.create_card(item)
        except queue.Empty:
            pass
            
        if not self.render_queue.empty():
            self.after(5, self.process_render_queue)
        else:
            self.is_rendering = False 

    def finalize_processing(self):
        self.btn_analyze.configure(state="normal")
        # Синхронизируем память файлов из кэша
        self.memory_files.update(self._current_file_cache)
        
        self.apply_sorting()
        self.queue_all_for_render()
            
        has_errors = any(op['status'] == 'error' for op in self.operations)
        if not has_errors and self.operations:
            self.lbl_status.configure(text="✅ Готово к применению", text_color=SUCCESS_COLOR)
            self.btn_apply.configure(state="normal")
        else:
            self.lbl_status.configure(text="❌ Есть ошибки", text_color=ERROR_COLOR)

    def queue_all_for_render(self):
        for widget in self.main_area.winfo_children():
            widget.destroy()
        with self.render_queue.mutex:
            self.render_queue.queue.clear()
            
        for op in self.operations:
            self.render_queue.put(op)
            
        if not self.is_rendering:
            self.is_rendering = True
            self.process_render_queue()

    def create_card(self, item):
        op = item['op']
        status = item['status']
        
        if status == 'success':
            border_color = SUCCESS_COLOR
            status_text = "✅ УСПЕХ"
        elif status == 'already_applied':
            border_color = INFO_COLOR
            status_text = "ℹ️ УЖЕ БЫЛО"
        else:
            border_color = ERROR_COLOR
            status_text = "❌ ОШИБКА"

        card = ctk.CTkFrame(self.main_area, fg_color=CARD_BG, border_width=2, border_color=border_color, corner_radius=8)
        card.pack(fill="x", padx=5, pady=10)

        header = ctk.CTkFrame(card, fg_color="transparent")
        header.pack(fill="x", padx=10, pady=5)
        
        path_str = op.get('path') or op.get('file', '???')
        action_str = op.get('action') or op.get('op', '???')
        
        title_text = f"📄 {path_str}  |  ⚡ {action_str}"
        ctk.CTkLabel(header, text=title_text, font=("Consolas", 14, "bold")).pack(side="left")
        ctk.CTkLabel(header, text=status_text, text_color=border_color, font=("Consolas", 12, "bold")).pack(side="left", padx=20)

        btn_del = ctk.CTkButton(header, text="🗑 Удалить", width=70, height=24, fg_color=ERROR_COLOR, command=lambda i=item['id']: self.action_delete(i))
        btn_del.pack(side="right", padx=5)
        
        btn_copy = ctk.CTkButton(header, text="📋 Копировать", width=80, height=24, fg_color="#34495e", command=lambda o=op: self.action_copy(o))
        btn_copy.pack(side="right", padx=5)
        
        btn_edit = ctk.CTkButton(header, text="✏️ Редактировать", width=100, height=24, fg_color="#2980b9", command=lambda i=item['id']: self.action_edit(i))
        btn_edit.pack(side="right", padx=5)

        body = ctk.CTkFrame(card, fg_color="transparent")
        body.pack(fill="x", padx=10, pady=(0, 10))

        if status == 'success':
            if item.get('search_method'):
                ctk.CTkLabel(body, text=f"🔍 Метод поиска: {item['search_method']}", text_color="#8e44ad", font=("Consolas", 11, "italic")).pack(anchor="w", pady=(0, 5))

            original_search = op.get('search') or op.get('original', '')
            if original_search and item.get('search_method') not in ["Точное совпадение", "Создание файла", "Добавление в конец", "Добавление в начало"]:
                ctk.CTkLabel(body, text="⚠️ Оригинальный запрос ИИ (для сверки):", text_color=WARNING_COLOR, font=("Consolas", 11, "bold")).pack(anchor="w", pady=(0, 2))
                box_height = min(max(len(original_search.splitlines()) * 18, 40), 100)
                txt_orig_success = ctk.CTkTextbox(body, height=box_height, font=("Consolas", 11), wrap="none", fg_color="#2a2a2a", border_width=1, border_color="#555")
                txt_orig_success.pack(fill="x", pady=(0, 10))
                txt_orig_success.insert("1.0", original_search)
                txt_orig_success.configure(state="disabled")
                self.bind_scroll_fix(txt_orig_success)

            txt_diff = ctk.CTkTextbox(body, height=120, font=("Consolas", 11), wrap="none")
            txt_diff.pack(fill="x", expand=True)
            txt_diff.tag_config("add", background=DIFF_ADD_BG)
            txt_diff.tag_config("del", background=DIFF_DEL_BG)
            
            for line in item['diff']:
                if line.startswith('---') or line.startswith('+++') or line.startswith('@@'): continue
                if line.startswith('+'): txt_diff.insert("end", line + "\n", "add")
                elif line.startswith('-'): txt_diff.insert("end", line + "\n", "del")
                else: txt_diff.insert("end", line + "\n")
            txt_diff.configure(state="disabled")
            self.bind_scroll_fix(txt_diff)

        elif status == 'already_applied':
            ctk.CTkLabel(body, text=item['error'], text_color=INFO_COLOR, font=("Consolas", 12, "bold")).pack(anchor="w", pady=5)
            
            content = op.get('content') or op.get('text') or op.get('code', '')
            if content:
                ctk.CTkLabel(body, text="Код, который ИИ хотел вставить (он уже есть в файле):", text_color="#aaa", font=("Consolas", 11)).pack(anchor="w", pady=(5, 0))
                box_height = min(max(len(content.splitlines()) * 18, 40), 120)
                txt_content = ctk.CTkTextbox(body, height=box_height, font=("Consolas", 11), wrap="none", fg_color="#1a1a1a", border_width=1, border_color="#444")
                txt_content.pack(fill="x", pady=(2, 10))
                txt_content.insert("1.0", content)
                txt_content.configure(state="disabled")
                self.bind_scroll_fix(txt_content)

        else: # error
            ctk.CTkLabel(body, text=f"Причина: {item['error']}", text_color=ERROR_COLOR, font=("Consolas", 12, "bold")).pack(anchor="w", pady=5)
            
            original_search = op.get('search') or op.get('original', '')
            if original_search:
                ctk.CTkLabel(body, text="🔍 Искомый текст (от ИИ):", text_color=ACCENT_COLOR, font=("Consolas", 12, "bold")).pack(anchor="w", pady=(5, 0))
                box_height = min(max(len(original_search.splitlines()) * 18, 40), 120)
                txt_orig = ctk.CTkTextbox(body, height=box_height, font=("Consolas", 11), wrap="none", fg_color="#1a1a1a", border_width=1, border_color="#444")
                txt_orig.pack(fill="x", pady=(2, 10))
                txt_orig.insert("1.0", original_search)
                txt_orig.configure(state="disabled")
                self.bind_scroll_fix(txt_orig)
            
            if item['suggestions']:
                ctk.CTkLabel(body, text="💡 Возможные совпадения в файле:", text_color=WARNING_COLOR, font=("Consolas", 12, "bold")).pack(anchor="w", pady=(10, 0))
                
                for idx, (ratio, sug_text) in enumerate(item['suggestions']):
                    sug_frame = ctk.CTkFrame(body, fg_color="#1e1e1e", border_width=1, border_color="#555")
                    sug_frame.pack(fill="x", pady=5)
                    
                    top_bar = ctk.CTkFrame(sug_frame, fg_color="transparent")
                    top_bar.pack(fill="x", padx=5, pady=2)
                    ctk.CTkLabel(top_bar, text=f"Вариант {idx+1} (Совпадение: {int(ratio*100)}%)", text_color="#aaa").pack(side="left")
                    ctk.CTkButton(top_bar, text="✅ Применить", height=20, fg_color=SUCCESS_COLOR, command=lambda i=item['id'], t=sug_text: self.action_apply_suggestion(i, t)).pack(side="right")
                    
                    sug_height = min(max(len(sug_text.splitlines()) * 18, 40), 120)
                    txt_sug = ctk.CTkTextbox(sug_frame, height=sug_height, font=("Consolas", 11), wrap="none", fg_color="#252526")
                    txt_sug.pack(fill="x", padx=5, pady=5)
                    txt_sug.insert("1.0", sug_text)
                    txt_sug.configure(state="disabled")
                    self.bind_scroll_fix(txt_sug)

    def action_delete(self, op_id):
        # Ищем блок в сырых данных
        target_raw = next((item for item in self.raw_operations if item['id'] == op_id), None)
        # Ищем блок в обработанных данных (чтобы узнать его статус)
        target_processed = next((item for item in self.operations if item['id'] == op_id), None)
        
        if not target_raw or not target_processed: 
            return
            
        filepath = target_raw['op'].get('path') or target_raw['op'].get('file', 'unknown')
        status = target_processed['status']
        
        # Удаляем из сырых данных
        self.raw_operations = [item for item in self.raw_operations if item['id'] != op_id]
        
        # УМНОЕ УДАЛЕНИЕ:
        # Если блок был с ошибкой или "уже было", он НЕ менял файл в памяти.
        # Значит, перерасчет файла не нужен! Просто удаляем из списка и обновляем UI.
        if status != 'success':
            self.operations = [item for item in self.operations if item['id'] != op_id]
            
            # Обновляем счетчики
            self.total_ops = len(self.raw_operations)
            self.completed_ops = len(self.operations)
            self.lbl_progress_text.configure(text=f"{self.completed_ops} / {self.total_ops}")
            if self.total_ops > 0:
                self.progress_bar.set(self.completed_ops / self.total_ops)
            else:
                self.progress_bar.set(0)
            
            # Перерисовываем UI мгновенно
            self.apply_sorting()
            self.queue_all_for_render()
            
            # Проверяем, можно ли теперь разблокировать кнопку "Применить"
            has_errors = any(op['status'] == 'error' for op in self.operations)
            if not has_errors and self.operations:
                self.lbl_status.configure(text="✅ Готово к применению", text_color=SUCCESS_COLOR)
                self.btn_apply.configure(state="normal")
            elif not self.operations:
                self.lbl_status.configure(text="Статус: Ожидание", text_color=WARNING_COLOR)
                self.btn_apply.configure(state="disabled")
        else:
            # Если блок был УСПЕШНЫМ, он изменил кэш файла.
            # В этом случае перерасчет обязателен, чтобы откатить его изменения в памяти.
            self.recalculate_file(filepath)

    def action_copy(self, op_dict):
        self.clipboard_clear()
        self.clipboard_append(json.dumps(op_dict, indent=2, ensure_ascii=False))
        messagebox.showinfo("Скопировано", "JSON блока скопирован в буфер обмена.")

    def action_edit(self, op_id):
        target_raw = next((item for item in self.raw_operations if item['id'] == op_id), None)
        if target_raw:
            def save_cb(new_data):
                target_raw['op'] = new_data
                filepath = target_raw['op'].get('path') or target_raw['op'].get('file', 'unknown')
                self.recalculate_file(filepath)
            EditOpWindow(self, target_raw['op'], save_cb)

    def action_apply_suggestion(self, op_id, new_search_text):
        target_raw = next((item for item in self.raw_operations if item['id'] == op_id), None)
        if target_raw:
            target_raw['op']['search'] = new_search_text
            filepath = target_raw['op'].get('path') or target_raw['op'].get('file', 'unknown')
            self.recalculate_file(filepath)

    def apply(self):
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        b_path = os.path.join(BACKUP_DIR, f"backup_{ts}")
        os.makedirs(b_path, exist_ok=True)
        
        with open(os.path.join(b_path, "patch_meta.json"), "w", encoding="utf-8") as f:
            json.dump({"timestamp": ts, "patch_name": self.current_patch_name}, f, ensure_ascii=False)

        for p, content in self.memory_files.items():
            if os.path.exists(p):
                rel = os.path.relpath(p, os.getcwd())
                bp = os.path.join(b_path, rel)
                os.makedirs(os.path.dirname(bp), exist_ok=True)
                shutil.copy2(p, bp)
            
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, 'w', encoding='utf-8') as f: 
                f.write(content)
            
        messagebox.showinfo("Успех", f"Патч '{self.current_patch_name}' успешно применен!")
        self.clear()

if __name__ == "__main__":
    ctk.set_appearance_mode("Dark")
    ctk.set_default_color_theme("dark-blue")
    app = AIPatcherPro()
    app.mainloop()