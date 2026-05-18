#!/usr/bin/env python3
"""
Metera Simulation Test Client — расширенный графический клиент
для полноценного тестирования каждого аспекта симуляции.

Зависимости: pip install customtkinter Pillow

Запуск: python simulation_test_client.py
(Копировать в папку engine/ рядом с meterea_engine)
"""

import customtkinter as ctk
import tkinter as tk
from tkinter import messagebox, ttk
import subprocess
import threading
import json
import sys
import os
import random
import math
import time
from collections import defaultdict

try:
    from PIL import Image, ImageTk, ImageDraw, ImageFont
except ImportError:
    print("ОШИБКА: pip install Pillow")
    sys.exit(1)

ctk.set_appearance_mode("Dark")
ctk.set_default_color_theme("blue")

# =============================================================================
# ENGINE PROCESS WRAPPER
# =============================================================================
class EngineProcess:
    def __init__(self, on_progress, on_result, on_error):
        self.proc = None
        self.on_progress = on_progress
        self.on_result = on_result
        self.on_error = on_error
        self.is_running = False

    def start(self):
        base_dir = os.path.dirname(os.path.abspath(__file__))
        exe_name = 'meterea_engine.exe' if sys.platform == 'win32' else 'meterea_engine'
        exe_path = os.path.join(base_dir, exe_name)
        if not os.path.exists(exe_path):
            self.on_error(f"Движок не найден:\n{exe_path}\nСкомпилируйте C++ код.")
            return False
        try:
            self.proc = subprocess.Popen(
                [exe_path], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True, encoding='utf-8', cwd=base_dir
            )
            self.is_running = True
            threading.Thread(target=self._read_loop, daemon=True).start()
            return True
        except Exception as e:
            self.on_error(f"Ошибка запуска: {e}")
            return False

    def send(self, cmd_data):
        if self.is_running and self.proc:
            try:
                self.proc.stdin.write(json.dumps(cmd_data, ensure_ascii=False) + '\n')
                self.proc.stdin.flush()
            except Exception as e:
                self.on_error(f"Ошибка отправки: {e}")

    def _read_loop(self):
        while self.is_running and self.proc:
            line = self.proc.stdout.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                if data.get("status") == "progress":
                    self.on_progress(data.get("message", ""))
                elif data.get("status") in ("ok", "realtime_update"):
                    self.on_result(data)
                elif data.get("status") == "error":
                    self.on_error(data.get("message", "Ошибка движка"))
            except json.JSONDecodeError:
                print(f"[RAW] {line}")
        self.is_running = False
        if self.proc:
            self.proc.poll()
            if self.proc.returncode is not None and self.proc.returncode != 0:
                err = self.proc.stderr.read()
                self.on_error(f"Движок упал (Код: {self.proc.returncode})\n{err}")

    def stop(self):
        self.is_running = False
        if self.proc:
            self.proc.terminate()
            self.proc = None


# =============================================================================
# MAIN APPLICATION
# =============================================================================
class SimulationTestClient(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Metera Simulation Test Client v2.0")
        self.geometry("1500x900")
        self.minsize(1100, 700)

        self.engine = EngineProcess(self.handle_progress, self.handle_result, self.handle_error)
        self.world_data = None
        self.containers_data = {}
        self.items_data = {}
        self.map_photo = None
        self.map_zoom = 4
        self.drag_data = {"x": 0, "y": 0}
        self.realtime_active = False
        self.pending_bootstrap = False
        self.test_results = []
        self.path_result = None
        self.highlight_path = []

        self._build_ui()

    # -------------------------------------------------------------------------
    # UI CONSTRUCTION
    # -------------------------------------------------------------------------
    def _build_ui(self):
        # --- Sidebar ---
        self.sidebar = ctk.CTkFrame(self, width=280, corner_radius=0)
        self.sidebar.pack(side="left", fill="y")
        self.sidebar.pack_propagate(False)

        ctk.CTkLabel(self.sidebar, text="METERA", font=ctk.CTkFont(size=22, weight="bold"),
                     text_color="#e74c3c").pack(pady=(15, 2))
        ctk.CTkLabel(self.sidebar, text="Simulation Test Client v2.0",
                     font=ctk.CTkFont(size=11, slant="italic"), text_color="#7f8c8d").pack(pady=(0, 15))

        # Settings
        sf = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        sf.pack(fill="x", padx=12)

        ctk.CTkLabel(sf, text="Эпоха:", anchor="w").pack(fill="x")
        self.era_var = ctk.StringVar(value="rebirth")
        ctk.CTkOptionMenu(sf, variable=self.era_var,
                          values=["rebirth", "architects", "sundering", "silence"]).pack(fill="x", pady=(0, 10))

        ctk.CTkLabel(sf, text="Агенты:", anchor="w").pack(fill="x")
        self.agents_var = ctk.IntVar(value=100)
        ctk.CTkSlider(sf, from_=50, to=500, variable=self.agents_var).pack(fill="x", pady=(0, 10))

        ctk.CTkLabel(sf, text="Время симуляции:", anchor="w").pack(fill="x")
        self.time_var = ctk.StringVar(value="1 год")
        ctk.CTkOptionMenu(sf, variable=self.time_var,
                          values=["1 месяц", "6 месяцев", "1 год", "2 года", "5 лет"]).pack(fill="x", pady=(0, 15))

        # Control buttons
        ctk.CTkButton(self.sidebar, text="1. Инициализация", command=self.start_generation,
                      fg_color="#27ae60", hover_color="#2ecc71").pack(fill="x", padx=12, pady=3)
        self.btn_sim = ctk.CTkButton(self.sidebar, text="2. Шаг Симуляции", command=self.start_simulation,
                                     state="disabled", fg_color="#2980b9", hover_color="#3498db")
        self.btn_sim.pack(fill="x", padx=12, pady=3)
        self.btn_realtime = ctk.CTkButton(self.sidebar, text="▶ Реал-тайм", command=self.toggle_realtime,
                                          state="disabled", fg_color="#8e44ad", hover_color="#9b59b6")
        self.btn_realtime.pack(fill="x", padx=12, pady=3)
        self.btn_sim_ref = self.btn_realtime  # placeholder

        ctk.CTkButton(self.sidebar, text="Остановить Движок", command=self.stop_engine,
                      fg_color="#c0392b", hover_color="#e74c3c").pack(fill="x", padx=12, pady=(15, 5))

        # Speed
        self.speed_var = ctk.IntVar(value=500)
        ctk.CTkSlider(self.sidebar, from_=50, to=2000, variable=self.speed_var,
                      command=self._update_speed).pack(fill="x", padx=12, pady=5)
        self.speed_lbl = ctk.CTkLabel(self.sidebar, text="500 мс/тик", font=ctk.CTkFont(size=11))
        self.speed_lbl.pack(pady=(0, 5))

        # Status
        self.status_lbl = ctk.CTkLabel(self.sidebar, text="Движок остановлен", text_color="#e74c3c")
        self.status_lbl.pack(side="bottom", pady=8)
        self.progress = ctk.CTkProgressBar(self.sidebar)
        self.progress.set(0)
        self.progress.pack(side="bottom", fill="x", padx=12, pady=5)

        # --- Main area with tabs ---
        self.tabs = ctk.CTkTabview(self, corner_radius=10)
        self.tabs.pack(side="right", fill="both", expand=True, padx=8, pady=8)

        self._build_map_tab()
        self._build_pathfinding_tab()
        self._build_roads_tab()
        self._build_regions_tab()
        self._build_factions_tab()
        self._build_diagnostics_tab()
        self._build_news_tab()

    # --- TAB: Map Visualizer ---
    def _build_map_tab(self):
        tab = self.tabs.add("🗺 Карта")
        toolbar = ctk.CTkFrame(tab, fg_color="transparent")
        toolbar.pack(fill="x", pady=(0, 5))

        ctk.CTkButton(toolbar, text="Обновить", command=self.request_map, width=80).pack(side="left", padx=3)
        ctk.CTkLabel(toolbar, text="Зум:").pack(side="left", padx=(10, 3))
        self.zoom_var = ctk.IntVar(value=4)
        ctk.CTkSlider(toolbar, from_=1, to=10, variable=self.zoom_var, width=120,
                      command=lambda v: setattr(self, 'map_zoom', int(v))).pack(side="left", padx=3)

        self.map_filter_var = ctk.StringVar(value="none")
        for lbl, val in [("Нет", "none"), ("Политика", "political"), ("Экономика", "economic"), ("Угрозы", "threat")]:
            ctk.CTkRadioButton(toolbar, text=lbl, variable=self.map_filter_var, value=val).pack(side="left", padx=4)

        ctk.CTkButton(toolbar, text="☄ Метеорит", command=self._test_meteorite,
                      fg_color="#c0392b", width=80).pack(side="right", padx=3)

        self.map_canvas = tk.Canvas(tab, bg="#0a0a0a")
        self.map_canvas.pack(fill="both", expand=True)
        self.map_canvas.bind("<ButtonPress-1>", self._drag_start)
        self.map_canvas.bind("<B1-Motion>", self._drag_motion)
        self.map_canvas.bind("<MouseWheel>", self._map_scroll)
        self.map_canvas.bind("<Button-4>", lambda e: self._map_scroll_linux(e, 1))
        self.map_canvas.bind("<Button-5>", lambda e: self._map_scroll_linux(e, -1))

    # --- TAB: Pathfinding Tester ---
    def _build_pathfinding_tab(self):
        tab = self.tabs.add("🧭 Поиск пути")

        top = ctk.CTkFrame(tab)
        top.pack(fill="x", pady=5)

        ctk.CTkLabel(top, text="Откуда:").grid(row=0, column=0, padx=5, pady=3)
        self.path_from_var = ctk.StringVar()
        self.path_from_menu = ctk.CTkOptionMenu(top, variable=self.path_from_var, values=[""], width=200)
        self.path_from_menu.grid(row=0, column=1, padx=5, pady=3)

        ctk.CTkLabel(top, text="Куда:").grid(row=0, column=2, padx=5, pady=3)
        self.path_to_var = ctk.StringVar()
        self.path_to_menu = ctk.CTkOptionMenu(top, variable=self.path_to_var, values=[""], width=200)
        self.path_to_menu.grid(row=0, column=3, padx=5, pady=3)

        ctk.CTkLabel(top, text="Тип:").grid(row=0, column=4, padx=5, pady=3)
        self.move_type_var = ctk.StringVar(value="ANY")
        ctk.CTkOptionMenu(top, variable=self.move_type_var, values=["LAND", "WATER", "ANY"],
                          width=80).grid(row=0, column=5, padx=5, pady=3)

        ctk.CTkButton(top, text="Найти путь", command=self._test_pathfinding,
                      fg_color="#27ae60").grid(row=0, column=6, padx=10, pady=3)
        ctk.CTkButton(top, text="Показать на карте", command=self._show_path_on_map,
                      fg_color="#8e44ad").grid(row=0, column=7, padx=5, pady=3)

        # Results
        bottom = ctk.CTkFrame(tab)
        bottom.pack(fill="both", expand=True, pady=5)

        self.path_canvas = tk.Canvas(bottom, bg="#0a0a0a", width=400)
        self.path_canvas.pack(side="left", fill="both", expand=True)

        self.path_info = ctk.CTkTextbox(bottom, width=350, font=("Consolas", 12))
        self.path_info.pack(side="right", fill="y", padx=5)
        self.path_info.insert("1.0", "Выберите два города и нажмите 'Найти путь'")
        self.path_info.configure(state="disabled")

    # --- TAB: Road Inspector ---
    def _build_roads_tab(self):
        tab = self.tabs.add("🛤 Дороги")

        toolbar = ctk.CTkFrame(tab, fg_color="transparent")
        toolbar.pack(fill="x", pady=5)
        ctk.CTkButton(toolbar, text="Обновить данные", command=self._refresh_roads).pack(side="left", padx=5)
        ctk.CTkButton(toolbar, text="Тест: Построить шоссе", command=self._test_highway,
                      fg_color="#f39c12", text_color="black").pack(side="left", padx=5)

        # Split: road list + stats
        left = ctk.CTkFrame(tab)
        left.pack(side="left", fill="both", expand=True, padx=(0, 3))

        ctk.CTkLabel(left, text="Список дорог:", font=ctk.CTkFont(weight="bold")).pack(anchor="w", padx=5)
        self.roads_list = ctk.CTkTextbox(left, font=("Consolas", 11))
        self.roads_list.pack(fill="both", expand=True, padx=5, pady=3)

        right = ctk.CTkFrame(tab, width=350)
        right.pack(side="right", fill="y", padx=(3, 0))
        right.pack_propagate(False)

        ctk.CTkLabel(right, text="Статистика дорог:", font=ctk.CTkFont(weight="bold")).pack(anchor="w", padx=5)
        self.roads_stats = ctk.CTkTextbox(right, font=("Consolas", 12))
        self.roads_stats.pack(fill="both", expand=True, padx=5, pady=3)

    # --- TAB: Region Inspector ---
    def _build_regions_tab(self):
        tab = self.tabs.add("🏙 Регионы")

        # Filter row
        ff = ctk.CTkFrame(tab, fg_color="transparent")
        ff.pack(fill="x", pady=5)

        ctk.CTkLabel(ff, text="Фракция:").pack(side="left", padx=3)
        self.reg_faction_var = ctk.StringVar(value="Все")
        self.reg_faction_menu = ctk.CTkOptionMenu(ff, variable=self.reg_faction_var, values=["Все"],
                                                  width=150, command=self._filter_regions)
        self.reg_faction_menu.pack(side="left", padx=3)

        ctk.CTkLabel(ff, text="Тип:").pack(side="left", padx=3)
        self.reg_type_var = ctk.StringVar(value="Все")
        ctk.CTkOptionMenu(ff, variable=self.reg_type_var,
                          values=["Все", "city", "village", "ruins", "fort", "anomaly"],
                          width=120, command=self._filter_regions).pack(side="left", padx=3)

        ctk.CTkCheckBox(ff, text="Только no_road", variable=ctk.BooleanVar(value=False),
                        command=self._filter_regions).pack(side="left", padx=10)
        self.no_road_only_var = ff.winfo_children()[-1]

        # Treeview
        cols = ("name", "type", "population", "faction", "no_road", "threat", "stability", "money")
        self.reg_tree = ttk.Treeview(tab, columns=cols, show="headings", height=20)
        for c, w in zip(cols, [180, 70, 80, 120, 60, 60, 60, 100]):
            self.reg_tree.heading(c, text=c.upper())
            self.reg_tree.column(c, width=w, anchor="center")
        self.reg_tree.pack(fill="both", expand=True, pady=5)
        self.reg_tree.bind("<<TreeviewSelect>>", self._on_region_select)

        # Detail panel
        self.reg_detail = ctk.CTkTextbox(tab, height=150, font=("Consolas", 12))
        self.reg_detail.pack(fill="x", pady=(5, 0))

    # --- TAB: Factions ---
    def _build_factions_tab(self):
        tab = self.tabs.add("⚔ Фракции")
        self.factions_text = ctk.CTkTextbox(tab, font=("Consolas", 13), wrap="word")
        self.factions_text.pack(fill="both", expand=True)

    # --- TAB: Diagnostics ---
    def _build_diagnostics_tab(self):
        tab = self.tabs.add("🔬 Диагностика")

        toolbar = ctk.CTkFrame(tab, fg_color="transparent")
        toolbar.pack(fill="x", pady=5)

        ctk.CTkButton(toolbar, text="Полная диагностика", command=self._run_diagnostics,
                      fg_color="#e74c3c").pack(side="left", padx=5)
        ctk.CTkButton(toolbar, text="Проверка дорог", command=self._diagnose_roads,
                      fg_color="#f39c12", text_color="black").pack(side="left", padx=5)
        ctk.CTkButton(toolbar, text="Проверка NPC", command=self._diagnose_npcs,
                      fg_color="#2980b9").pack(side="left", padx=5)
        ctk.CTkButton(toolbar, text="Проверка экономики", command=self._diagnose_economy,
                      fg_color="#27ae60").pack(side="left", padx=5)
        ctk.CTkButton(toolbar, text="Очистить", command=lambda: self.diag_text.configure(
                      state="normal") or self.diag_text.delete("1.0", tk.END) or
                      self.diag_text.configure(state="disabled")).pack(side="right", padx=5)

        self.diag_text = ctk.CTkTextbox(tab, font=("Consolas", 13), wrap="word")
        self.diag_text.pack(fill="both", expand=True, pady=5)

    # --- TAB: News ---
    def _build_news_tab(self):
        tab = self.tabs.add("📰 Летопись")

        ff = ctk.CTkFrame(tab, fg_color="transparent")
        ff.pack(fill="x", pady=5)
        ctk.CTkLabel(ff, text="Фильтр:").pack(side="left", padx=3)
        self.news_filter_var = ctk.StringVar(value="all")
        for lbl, val in [("Все", "all"), ("Война", "war"), ("Торговля", "trade"),
                         ("Бедствия", "disaster"), ("Бизнес", "business"), ("Логистика", "logistics")]:
            ctk.CTkRadioButton(ff, text=lbl, variable=self.news_filter_var, value=val,
                              command=self._render_news).pack(side="left", padx=3)

        self.news_text = ctk.CTkTextbox(tab, font=("Consolas", 13), wrap="word")
        self.news_text.pack(fill="both", expand=True)
        for tag, color in [("header", "#5dade2"), ("war", "#e74c3c"), ("trade", "#f1c40f"),
                           ("disaster", "#e67e22"), ("business", "#9b59b6"), ("misc", "#bdc3c7")]:
            self.news_text.tag_config(tag, foreground=color)

    # -------------------------------------------------------------------------
    # MAP INTERACTION
    # -------------------------------------------------------------------------
    def _drag_start(self, e):
        self.drag_data = {"x": e.x, "y": e.y}

    def _drag_motion(self, e):
        dx, dy = e.x - self.drag_data["x"], e.y - self.drag_data["y"]
        self.map_canvas.move("all", dx, dy)
        self.drag_data = {"x": e.x, "y": e.y}

    def _map_scroll(self, e):
        d = 1 if e.delta > 0 else -1
        self.map_zoom = max(1, min(10, self.map_zoom + d))
        self.zoom_var.set(self.map_zoom)
        self.render_map()

    def _map_scroll_linux(self, e, d):
        self.map_zoom = max(1, min(10, self.map_zoom + d))
        self.zoom_var.set(self.map_zoom)
        self.render_map()

    # -------------------------------------------------------------------------
    # ENGINE COMMANDS
    # -------------------------------------------------------------------------
    def _load_json(self, path, default=None):
        """Load JSON file. default: [] for array fields, {} for object fields."""
        if default is None:
            default = {}
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if not data:
                    print(f"[WARN] {path} loaded but empty, using default")
                    return default
                return data
        except FileNotFoundError:
            print(f"[ERROR] File not found: {path}")
            return default
        except json.JSONDecodeError as e:
            print(f"[ERROR] Invalid JSON in {path}: {e}")
            return default
        except Exception as e:
            print(f"[ERROR] Failed to load {path}: {e}")
            return default

    def _find_data_dir(self):
        """Find the data/ directory by searching multiple locations."""
        base_dir = os.path.dirname(os.path.abspath(__file__))
        candidates = [
            os.path.join(os.path.dirname(base_dir), 'data'),  # engine/../data
            os.path.join(base_dir, 'data'),                    # engine/data
            os.path.join(base_dir, '..', 'data'),              # relative ../data
            os.path.join(base_dir, '..', '..', 'data'),        # relative ../../data
        ]
        # Also try CWD-based paths
        cwd = os.getcwd()
        candidates.extend([
            os.path.join(cwd, 'data'),
            os.path.join(cwd, '..', 'data'),
        ])
        for d in candidates:
            dp = os.path.normpath(d)
            if os.path.isdir(dp) and os.path.exists(os.path.join(dp, 'biomes.json')):
                print(f"[INFO] Data directory found: {dp}")
                return dp
        # Fallback: return the first candidate anyway
        print(f"[WARN] Data directory not found! Tried: {candidates}")
        return os.path.normpath(candidates[0])

    def start_generation(self):
        if not self.engine.is_running:
            if not self.engine.start():
                return
            self.engine.send({"command": "init"})

        self.status_lbl.configure(text="Загрузка БД...", text_color="#f1c40f")
        self.progress.configure(mode="indeterminate")
        self.progress.start()

        data_dir = self._find_data_dir()
        print(f"[INFO] Loading database from: {data_dir}")

        # Array fields (engine expects JsonValue::ARRAY) — default to []
        # Object fields (engine expects JsonValue::OBJECT) — default to {}
        self.engine.send({
            "command": "loadDatabase",
            "items": self._load_json(os.path.join(data_dir, 'economy_items.json'), {}),
            "recipes": self._load_json(os.path.join(data_dir, 'economy_recipes.json'), []),
            "facilities": self._load_json(os.path.join(data_dir, 'facility_names.json'), {}),
            "biomes": self._load_json(os.path.join(data_dir, 'biomes.json'), []),
            "city_gen": self._load_json(os.path.join(data_dir, 'city_gen.json'), {}),
            "monsters": self._load_json(os.path.join(data_dir, 'monsters.json'), []),
            "disasters": self._load_json(os.path.join(data_dir, 'disasters.json'), []),
            "races": self._load_json(os.path.join(data_dir, 'races.json'), []),
            "professions": self._load_json(os.path.join(data_dir, 'professions.json'), []),
            "traits": self._load_json(os.path.join(data_dir, 'traits.json'), []),
            "npc_names": self._load_json(os.path.join(data_dir, 'npc_names.json'), {}),
            "faction_relations": self._load_json(os.path.join(data_dir, 'faction_relations.json'), {}),
            "world_config": self._load_json(os.path.join(data_dir, 'world_config.json'), {}),
        })

        self.pending_bootstrap = True
        self.engine.send({
            "command": "buildWorld",
            "player_id": "test_admin",
            "era": self.era_var.get(),
            "initial_agents": self.agents_var.get()
        })

    def start_simulation(self):
        time_map = {"1 месяц": 720, "6 месяцев": 4320, "1 год": 8640, "2 года": 17280, "5 лет": 43200}
        ticks = time_map.get(self.time_var.get(), 8640)
        self.status_lbl.configure(text=f"Симуляция {self.time_var.get()}...", text_color="#3498db")
        self.progress.configure(mode="indeterminate")
        self.progress.start()
        self.engine.send({"command": "simulateTicks", "ticks": ticks})

    def toggle_realtime(self):
        if not self.realtime_active:
            self.realtime_active = True
            self.btn_realtime.configure(text="⏸ Стоп", fg_color="#e74c3c")
            self.engine.send({"command": "startRealtime", "interval": int(self.speed_var.get())})
        else:
            self.realtime_active = False
            self.btn_realtime.configure(text="▶ Реал-тайм", fg_color="#8e44ad")
            self.engine.send({"command": "stopRealtime"})

    def _update_speed(self, val):
        self.speed_lbl.configure(text=f"{int(val)} мс/тик")

    def stop_engine(self):
        self.engine.stop()
        self.realtime_active = False
        self.status_lbl.configure(text="Движок остановлен", text_color="#e74c3c")
        self.progress.stop()
        self.progress.set(0)
        self.btn_realtime.configure(state="disabled", text="▶ Реал-тайм", fg_color="#8e44ad")

    def request_map(self):
        self.engine.send({"command": "getWorldMap"})

    # -------------------------------------------------------------------------
    # HANDLERS
    # -------------------------------------------------------------------------
    def handle_progress(self, msg):
        self.after(0, lambda: self.status_lbl.configure(text=msg))

    def handle_result(self, data):
        def update():
            self.progress.stop()
            self.progress.set(1)

            if "map" in data and "world" not in data:
                if not self.world_data:
                    self.world_data = {}
                self.world_data["map"] = data["map"]
                self.render_map()
                return

            if data.get("status") == "realtime_update":
                self.world_data = data.get("world", self.world_data)
                tick = self.world_data.get('tick', 0)
                self.status_lbl.configure(text=f"Тик {tick}", text_color="#8e44ad")
                self._auto_refresh_all()
                return

            if "world" in data:
                self.world_data = data["world"]
                for c in data.get("containers", []):
                    self.containers_data[c[0]] = c[1]
                for i in data.get("items", []):
                    self.items_data[i[0]] = i[1]
                for cid in data.get("deleted_containers", []):
                    self.containers_data.pop(cid, None)
                for iid in data.get("deleted_items", []):
                    self.items_data.pop(iid, None)

                if self.pending_bootstrap:
                    self.pending_bootstrap = False
                    self.status_lbl.configure(text="Балансировка...", text_color="#f39c12")
                    pop = sum(r.get("population", 0) for r in self.world_data.get("regions", {}).values())
                    days = max(30, 30 + pop // 10000)
                    self.engine.send({"command": "bootstrapWorld", "days": days})
                    return

                self.status_lbl.configure(text=f"Готово! Тик: {self.world_data.get('tick', 0)}",
                                         text_color="#2ecc71")
                self.btn_realtime.configure(state="normal")
                self.btn_sim.configure(state="normal")
                self._auto_refresh_all()

        self.after(0, update)

    def handle_error(self, msg):
        self.after(0, lambda: messagebox.showerror("Ошибка", msg))
        self.after(0, self.stop_engine)

    def _auto_refresh_all(self):
        """Refresh all tab panels when world data arrives."""
        self._update_city_dropdowns()
        self._refresh_roads()
        self._refresh_regions()
        self._refresh_factions()
        self._render_news()
        if self.world_data and "map" in self.world_data:
            self.render_map()

    # -------------------------------------------------------------------------
    # MAP RENDERING
    # -------------------------------------------------------------------------
    def render_map(self):
        if not self.world_data or "map" not in self.world_data:
            return
        md = self.world_data["map"]
        w, h = md.get("width", 256), md.get("height", 256)
        grid = md.get("grid", [])
        tiles = [cell[0] for cell in grid] if grid else md.get("tiles", [])
        roads = md.get("roads", [])
        locs = md.get("locations", {})

        if not tiles:
            return

        COLORS = {
            0: (26, 59, 92), 1: (41, 128, 185), 2: (245, 230, 200), 3: (46, 204, 113),
            4: (39, 174, 96), 5: (127, 140, 141), 6: (243, 156, 18), 7: (230, 126, 34),
            8: (142, 68, 173), 9: (236, 240, 241), 10: (52, 73, 94), 11: (155, 89, 182),
            12: (52, 152, 219), 13: (192, 57, 43), 14: (60, 176, 67), 15: (31, 97, 141),
            16: (88, 214, 141), 17: (211, 84, 0), 18: (85, 85, 85)
        }

        img = Image.new('RGB', (w, h))
        img.putdata([COLORS.get(t, (0, 0, 0)) for t in tiles])
        img = img.resize((w * self.map_zoom, h * self.map_zoom), Image.NEAREST)
        draw = ImageDraw.Draw(img)
        z = self.map_zoom

        # Roads
        for road in roads:
            wps = road.get("waypoints", [])
            if len(wps) < 2:
                continue
            cond = road.get("condition", "dirt")
            rtype = road.get("type", "")
            if rtype == "sea_route":
                color, lw = (52, 152, 219), max(2, int(z * 0.5))
            elif rtype in ("bridge", "ferry"):
                color, lw = (139, 69, 19), max(3, int(z * 0.7))
            elif rtype == "tunnel":
                color, lw = (85, 85, 85), max(2, int(z * 0.5))
            elif cond == "paved" or rtype == "highway":
                color, lw = (149, 165, 166), max(2, int(z * 0.6))
            elif cond == "ruined":
                color, lw = (231, 76, 60), max(1, int(z * 0.3))
            else:
                color, lw = (139, 69, 19), max(1, int(z * 0.3))
            pts = [(p[0] * z + z // 2, p[1] * z + z // 2) for p in wps]
            draw.line(pts, fill=color, width=lw, joint="curve")

        # Highlight path
        if self.highlight_path:
            pts = [(p[0] * z + z // 2, p[1] * z + z // 2) for p in self.highlight_path]
            draw.line(pts, fill=(255, 50, 50), width=max(3, z), joint="curve")

        # Locations
        regions = self.world_data.get("regions", {})
        for lid, loc in locs.items():
            lx = loc.get("x", 0) * z + z // 2
            ly = loc.get("y", 0) * z + z // 2
            lt = loc.get("type", "village")
            no_road = loc.get("no_road", False)
            pop = regions.get(lid, {}).get("population", 0) if lid in regions else 0

            if lt == "city":
                r = max(5, int(z * 1.3))
                draw.rectangle([lx - r, ly - r, lx + r, ly + r], fill=(241, 196, 15), outline=(0, 0, 0), width=2)
            elif lt == "ruins":
                r = max(4, int(z * 1.0))
                draw.polygon([(lx, ly - r), (lx - r, ly + r), (lx + r, ly + r)], fill=(127, 140, 141), outline=(0, 0, 0))
            elif lt == "fort":
                r = max(4, int(z * 1.0))
                draw.rectangle([lx - r, ly - r, lx + r, ly + r], fill=(149, 165, 166), outline=(0, 0, 0))
            else:
                r = max(3, int(z * 0.8))
                draw.ellipse([lx - r, ly - r, lx + r, ly + r], fill=(189, 195, 199), outline=(0, 0, 0))

            # Red X for no_road + has population (BUG indicator!)
            if no_road and pop > 0:
                draw.line([(lx - r - 3, ly - r - 3), (lx + r + 3, ly + r + 3)], fill=(255, 0, 0), width=2)
                draw.line([(lx + r + 3, ly - r - 3), (lx - r - 3, ly + r + 3)], fill=(255, 0, 0), width=2)

        # Caravans
        for rid, r in regions.items():
            for c in r.get("caravans", []):
                if "x" in c:
                    px, py = c["x"] * z + z // 2, c["y"] * z + z // 2
                    draw.ellipse([px - 3, py - 3, px + 3, py + 3], fill=(241, 196, 15))

        # Armies
        for fid, f in self.world_data.get("factions", {}).items():
            for a in f.get("armies", []):
                if "x" in a:
                    px, py = a["x"] * z + z // 2, a["y"] * z + z // 2
                    draw.ellipse([px - 3, py - 3, px + 3, py + 3], fill=(231, 76, 60))

        self.map_photo = ImageTk.PhotoImage(img)
        self.map_canvas.delete("all")
        cx = (self.map_canvas.winfo_width() - w * z) // 2
        cy = (self.map_canvas.winfo_height() - h * z) // 2
        self.map_canvas.create_image(max(0, cx), max(0, cy), image=self.map_photo, anchor="nw")

    # -------------------------------------------------------------------------
    # PATHFINDING TAB
    # -------------------------------------------------------------------------
    def _update_city_dropdowns(self):
        if not self.world_data or "map" not in self.world_data:
            return
        locs = self.world_data["map"].get("locations", {})
        names = [f"{v.get('name', k)} ({k})" for k, v in locs.items()]
        if not names:
            names = [""]
        self.path_from_menu.configure(values=names)
        self.path_to_menu.configure(values=names)
        if names and names[0]:
            if not self.path_from_var.get():
                self.path_from_var.set(names[0])
            if not self.path_to_var.get():
                self.path_to_var.set(names[min(1, len(names) - 1)])

    def _test_pathfinding(self):
        """Run pathfinding test via engine gmCommand."""
        if not self.world_data:
            return
        locs = self.world_data["map"].get("locations", {})
        # Parse IDs from dropdown
        from_str = self.path_from_var.get()
        to_str = self.path_to_var.get()
        from_id = from_str.split("(")[-1].rstrip(")") if "(" in from_str else from_str
        to_id = to_str.split("(")[-1].rstrip(")") if "(" in to_str else to_str

        if from_id not in locs or to_id not in locs:
            self._set_path_info("Ошибка: выберите существующие города")
            return

        loc1, loc2 = locs[from_id], locs[to_id]
        self.engine.send({
            "command": "gmCommand",
            "cmd": "gmBuildHighway",
            "args": {"fromRegion": from_id, "toRegion": to_id}
        })
        self._set_path_info(f"Запрос отправлен: {loc1.get('name')} -> {loc2.get('name')}\n"
                           f"Тип движения: {self.move_type_var.get()}\n"
                           f"Ожидайте результат...")

    def _show_path_on_map(self):
        """Highlight the path on the main map."""
        self.render_map()

    def _set_path_info(self, text):
        self.path_info.configure(state="normal")
        self.path_info.delete("1.0", tk.END)
        self.path_info.insert("1.0", text)
        self.path_info.configure(state="disabled")

    # -------------------------------------------------------------------------
    # ROADS TAB
    # -------------------------------------------------------------------------
    def _refresh_roads(self):
        if not self.world_data or "map" not in self.world_data:
            return
        roads = self.world_data["map"].get("roads", [])
        locs = self.world_data["map"].get("locations", {})
        regions = self.world_data.get("regions", {})

        self.roads_list.configure(state="normal")
        self.roads_list.delete("1.0", tk.END)

        type_counts = defaultdict(int)
        cond_counts = defaultdict(int)
        cities_with_roads = set()
        cities_without_roads = []
        total_length = 0

        for road in roads:
            rtype = road.get("type", "dirt")
            cond = road.get("condition", "unknown")
            wps = road.get("waypoints", [])
            from_id = road.get("from", "?")
            to_id = road.get("to", "?")

            type_counts[rtype] += 1
            cond_counts[cond] += 1
            total_length += len(wps)

            cities_with_roads.add(from_id)
            cities_with_roads.add(to_id)

            fname = locs.get(from_id, {}).get("name", from_id)
            tname = locs.get(to_id, {}).get("name", to_id)
            integrity = road.get("integrity", 100)

            self.roads_list.insert(tk.END,
                f"[{rtype:>10}] {fname} -> {tname}  |  cond={cond}  int={integrity}%  len={len(wps)}\n")

        # Cities without roads
        for lid, loc in locs.items():
            if lid not in cities_with_roads:
                pop = regions.get(lid, {}).get("population", 0)
                no_road = loc.get("no_road", False)
                flag = " [no_road!]" if no_road else ""
                pop_flag = " ⚠ ЖИЛОЙ!" if pop > 0 else ""
                cities_without_roads.append(f"  {loc.get('name', lid)}: pop={pop}{flag}{pop_flag}")

        self.roads_stats.configure(state="normal")
        self.roads_stats.delete("1.0", tk.END)
        stats = f"""=== СТАТИСТИКА ДОРОГ ===

Всего дорог: {len(roads)}
Типы: {dict(type_counts)}
Состояния: {dict(cond_counts)}
Общая длина (waypoints): {total_length}

Городов с дорогами: {len(cities_with_roads)}
Городов БЕЗ дорог: {len(cities_without_roads)}

"""
        if cities_without_roads:
            stats += "⚠ ИЗОЛИРОВАННЫЕ ГОРОДА:\n"
            stats += "\n".join(cities_without_roads)
            stats += "\n\n"

        # Check for bug: residential cities with no_road
        bug_count = 0
        for lid, loc in locs.items():
            no_road = loc.get("no_road", False)
            pop = regions.get(lid, {}).get("population", 0)
            if no_road and pop > 0:
                bug_count += 1
        if bug_count > 0:
            stats += f"\n🔴 БАГ: {bug_count} жилых городов с no_road=True!"
        else:
            stats += "\n✅ Все жилые города имеют дороги"

        self.roads_stats.insert("1.0", stats)
        self.roads_stats.configure(state="disabled")
        self.roads_list.configure(state="disabled")

    def _test_highway(self):
        if not self.world_data:
            return
        locs = list(self.world_data["map"].get("locations", {}).keys())
        if len(locs) < 2:
            return
        a, b = random.sample(locs, 2)
        self.engine.send({
            "command": "gmCommand",
            "cmd": "gmBuildHighway",
            "args": {"fromRegion": a, "toRegion": b}
        })

    # -------------------------------------------------------------------------
    # REGIONS TAB
    # -------------------------------------------------------------------------
    def _refresh_regions(self):
        if not self.world_data:
            return
        locs = self.world_data["map"].get("locations", {})
        regions = self.world_data.get("regions", {})
        factions = self.world_data.get("factions", {})

        # Update faction dropdown
        fac_names = ["Все"] + [f.get("name", fid) for fid, f in factions.items()]
        self.reg_faction_menu.configure(values=fac_names)

        self._filter_regions()

    def _filter_regions(self, *args):
        if not self.world_data:
            return
        locs = self.world_data["map"].get("locations", {})
        regions = self.world_data.get("regions", {})
        factions = self.world_data.get("factions", {})

        for item in self.reg_tree.get_children():
            self.reg_tree.delete(item)

        for rid, r in regions.items():
            loc = locs.get(rid, {})
            if not loc:
                continue

            fac_name = factions.get(r.get("factionId", ""), {}).get("name", r.get("factionId", ""))

            # Apply filters
            if self.reg_faction_var.get() != "Все" and fac_name != self.reg_faction_var.get():
                continue
            if self.reg_type_var.get() != "Все" and loc.get("type", "") != self.reg_type_var.get():
                continue
            if hasattr(self, 'no_road_only_var') and self.no_road_only_var.get() and not loc.get("no_road", False):
                continue

            self.reg_tree.insert("", tk.END, iid=rid, values=(
                r.get("name", rid),
                loc.get("type", "?"),
                r.get("population", 0),
                fac_name,
                "Да" if loc.get("no_road", False) else "Нет",
                r.get("threat_level", 0),
                r.get("stability", 0),
                int(r.get("moneySupply", 0))
            ))

    def _on_region_select(self, event):
        sel = self.reg_tree.selection()
        if not sel or not self.world_data:
            return
        rid = sel[0]
        r = self.world_data.get("regions", {}).get(rid, {})
        loc = self.world_data["map"].get("locations", {}).get(rid, {})

        text = f"=== {r.get('name', rid)} ===\n"
        text += f"Тип: {loc.get('type', '?')} | Фракция: {r.get('factionId', 'Нет')}\n"
        text += f"Население: {r.get('population', 0)} | Рабочих: {r.get('labor_force', 0)}\n"
        text += f"Угроза: {r.get('threat_level', 0)} | Стабильность: {r.get('stability', 0)}\n"
        text += f"Безработица: {int(r.get('unemployment_rate', 0) * 100)}%\n"
        text += f"Зарплата: {r.get('average_wage', 0)} | Казна: {int(r.get('moneySupply', 0))}\n"
        text += f"no_road: {loc.get('no_road', False)} | Позиция: ({loc.get('x')}, {loc.get('y')})\n"

        facs = [f"{n} ур.{v.get('level', 0)}" for n, v in r.get("facilities", {}).items() if v.get("level", 0) > 0]
        if facs:
            text += f"Предприятия: {', '.join(facs)}\n"

        port = self.world_data.get("port_facilities", {}).get(rid)
        if port:
            text += f"Порт: ур.{port.get('level')} {port.get('type')}"
            if port.get("is_blockaded"):
                text += " [БЛОКАДА]"
            text += "\n"

        self.reg_detail.configure(state="normal")
        self.reg_detail.delete("1.0", tk.END)
        self.reg_detail.insert("1.0", text)
        self.reg_detail.configure(state="disabled")

    # -------------------------------------------------------------------------
    # FACTIONS TAB
    # -------------------------------------------------------------------------
    def _refresh_factions(self):
        if not self.world_data:
            return
        factions = self.world_data.get("factions", {})

        self.factions_text.configure(state="normal")
        self.factions_text.delete("1.0", tk.END)

        for fid, f in factions.items():
            regions = f.get("regions", [])
            armies = f.get("armies", [])
            diplomacy = f.get("diplomacy", {})

            self.factions_text.insert(tk.END, f"\n{'='*50}\n", "header")
            self.factions_text.insert(tk.END, f"👑 {f.get('name', fid)}\n", "header")
            self.factions_text.insert(tk.END, f"  Стабильность: {f.get('stability', 0)} | "
                                              f"Легитимность: {f.get('legitimacy', 0)} | "
                                              f"Усталость: {f.get('warExhaustion', 0)}\n")
            self.factions_text.insert(tk.END, f"  Регионов: {len(regions)} | Армий: {len(armies)} | "
                                              f"Состояние: {f.get('warType', 'PEACE')}\n")

            wars = [k for k, v in diplomacy.items() if v == "war"]
            allies = [k for k, v in diplomacy.items() if v == "alliance"]
            if wars:
                wnames = [factions.get(w, {}).get("name", w) for w in wars]
                self.factions_text.insert(tk.END, f"  ⚔ Война: {', '.join(wnames)}\n")
            if allies:
                anames = [factions.get(a, {}).get("name", a) for a in allies]
                self.factions_text.insert(tk.END, f"  🤝 Союз: {', '.join(anames)}\n")

            self.factions_text.insert(tk.END, "\n")

        self.factions_text.configure(state="disabled")

    # -------------------------------------------------------------------------
    # NEWS TAB
    # -------------------------------------------------------------------------
    def _render_news(self):
        if not self.world_data:
            return
        news = self.world_data.get("news", [])
        filt = self.news_filter_var.get()
        if filt != "all":
            news = [n for n in news if n.get("category", "misc") == filt]

        self.news_text.configure(state="normal")
        self.news_text.delete("1.0", tk.END)

        for n in sorted(news, key=lambda x: x.get("day", 0)):
            day = n.get("day", 0)
            yr, mo = (day // 360) + 1, ((day % 360) // 30) + 1
            cat = n.get("category", "misc")
            tag = cat if cat in ("war", "trade", "disaster", "business") else "misc"
            self.news_text.insert(tk.END, f"[Г{yr} М{mo}] {n.get('text', '')}\n", tag)

        if not news:
            self.news_text.insert("1.0", "Нет событий в этой категории.\n")

        self.news_text.configure(state="disabled")

    # -------------------------------------------------------------------------
    # DIAGNOSTICS TAB
    # -------------------------------------------------------------------------
    def _diag_write(self, text, tag="misc"):
        self.diag_text.configure(state="normal")
        self.diag_text.insert(tk.END, text + "\n", tag)
        self.diag_text.configure(state="disabled")

    def _run_diagnostics(self):
        self._diagnose_roads()
        self._diag_write("\n" + "=" * 50)
        self._diagnose_npcs()
        self._diag_write("\n" + "=" * 50)
        self._diagnose_economy()

    def _diagnose_roads(self):
        if not self.world_data or "map" not in self.world_data:
            self._diag_write("Нет данных мира")
            return

        locs = self.world_data["map"].get("locations", {})
        roads = self.world_data["map"].get("roads", [])
        regions = self.world_data.get("regions", {})

        self._diag_write("=== ДИАГНОСТИКА ДОРОГ ===", "header")

        # 1. Check residential cities with no_road
        bug_cities = []
        for lid, loc in locs.items():
            if loc.get("no_road", False) and regions.get(lid, {}).get("population", 0) > 0:
                bug_cities.append(f"  {loc.get('name', lid)}: pop={regions[lid].get('population')}")

        if bug_cities:
            self._diag_write(f"🔴 БАГ: Жилые города БЕЗ дорог ({len(bug_cities)}):")
            for b in bug_cities:
                self._diag_write(b)
        else:
            self._diag_write("✅ Все жилые города имеют дороги")

        # 2. Check road connectivity
        connected = set()
        for road in roads:
            connected.add(road.get("from", ""))
            connected.add(road.get("to", ""))

        isolated = []
        for lid, loc in locs.items():
            if lid not in connected and regions.get(lid, {}).get("population", 0) > 0:
                isolated.append(f"  {loc.get('name', lid)}: pop={regions[lid].get('population')}")

        if isolated:
            self._diag_write(f"🟡 Изолированные жилые города ({len(isolated)}):")
            for i in isolated:
                self._diag_write(i)
        else:
            self._diag_write("✅ Нет изолированных жилых городов")

        # 3. Road integrity
        ruined = [r for r in roads if r.get("condition") == "ruined" or r.get("integrity", 100) < 30]
        if ruined:
            self._diag_write(f"🟠 Разрушенных дорог: {len(ruined)}")
        else:
            self._diag_write("✅ Все дороги целы")

        # 4. Sea routes
        sea = [r for r in roads if r.get("type") == "sea_route"]
        ports = self.world_data.get("port_facilities", {})
        self._diag_write(f"Морских маршрутов: {len(sea)} | Портов: {len(ports)}")

    def _diagnose_npcs(self):
        if not self.world_data:
            return
        npcs = self.world_data.get("npcs", {})
        self._diag_write("=== ДИАГНОСТИКА NPC ===", "header")

        total = len(npcs)
        alive = sum(1 for n in npcs.values() if n.get("isAlive", True))
        with_prof = sum(1 for n in npcs.values() if n.get("economy", {}).get("profession_type", "none") != "none")

        self._diag_write(f"Всего NPC: {total} | Живых: {alive} | С профессией: {with_prof}")

        if alive == 0 and total > 0:
            self._diag_write("🔴 ВСЕ NPC МЕРТВЫ!")
        elif alive < total * 0.5:
            self._diag_write(f"🟠 Более половины NPC мертвы ({total - alive}/{total})")
        else:
            self._diag_write("✅ Популяция NPC в норме")

        # Starvation
        starved = sum(1 for n in npcs.values() if not n.get("isAlive", True) and "starvation" in n.get("death_cause", "").lower())
        if starved > 0:
            self._diag_write(f"🟠 Умерло от голода: {starved}")

    def _diagnose_economy(self):
        if not self.world_data:
            return
        regions = self.world_data.get("regions", {})
        self._diag_write("=== ДИАГНОСТИКА ЭКОНОМИКИ ===", "header")

        total_pop = sum(r.get("population", 0) for r in regions.values())
        total_money = sum(r.get("moneySupply", 0) for r in regions.values())
        avg_wage = sum(r.get("average_wage", 0) for r in regions.values()) / max(1, len(regions))

        self._diag_write(f"Население: {total_pop} | Деньги: {int(total_money)} | Ср.зарплата: {int(avg_wage)}")

        high_unemp = [r.get("name", rid) for rid, r in regions.items() if r.get("unemployment_rate", 0) > 0.5]
        if high_unemp:
            self._diag_write(f"🟠 Высокая безработица (>50%): {', '.join(high_unemp[:5])}")

        high_threat = [r.get("name", rid) for rid, r in regions.items() if r.get("threat_level", 0) > 80]
        if high_threat:
            self._diag_write(f"🔴 Высокая угроза (>80): {', '.join(high_threat[:5])}")

        # Caravans
        total_caravans = sum(len(r.get("caravans", [])) for r in regions.values())
        self._diag_write(f"Караванов в пути: {total_caravans}")

        # Markets
        total_offers = sum(len(r.get("market_square", [])) for r in regions.values())
        self._diag_write(f"Лотов на рынках: {total_offers}")

    # -------------------------------------------------------------------------
    # TEST COMMANDS
    # -------------------------------------------------------------------------
    def _test_meteorite(self):
        if not self.world_data:
            return
        regions = list(self.world_data.get("regions", {}).keys())
        if not regions:
            return
        target = random.choice(regions)
        self.engine.send({
            "command": "gmCommand",
            "cmd": "gmModifyTerrain",
            "args": {"regionId": target, "radius": 10, "newType": 9}
        })
        self.request_map()


# =============================================================================
# ENTRY POINT
# =============================================================================
if __name__ == "__main__":
    app = SimulationTestClient()
    app.mainloop()
