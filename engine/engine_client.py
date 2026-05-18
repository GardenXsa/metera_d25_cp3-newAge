#!/usr/bin/env python3
"""
Shared EngineProcess client and utilities for communicating with the
Metera C++ simulation engine.

This module is the single source of truth for:
  - EngineProcess class (subprocess management + JSON line protocol)
  - _load_json utility with correct default handling
  - Common constants

Both run_simulation.py and simulation_test_client.py should import from here:
    from engine_client import EngineProcess, load_json
"""
import json
import os
import subprocess
import sys
import threading


class EngineProcess:
    """Manages a C++ engine subprocess with JSON-over-stdin/stdout protocol."""

    def __init__(self, on_progress, on_result, on_error, *, verbose=False):
        self.proc = None
        self.on_progress = on_progress
        self.on_result = on_result
        self.on_error = on_error
        self.is_running = False
        self.verbose = verbose

    def start(self):
        base_dir = os.path.dirname(os.path.abspath(__file__))
        exe_name = 'meterea_engine.exe' if sys.platform == 'win32' else 'meterea_engine'
        exe_path = os.path.join(base_dir, exe_name)

        if not os.path.exists(exe_path):
            self.on_error(
                f"Движок не найден по пути:\n{exe_path}\nСкомпилируйте C++ код."
            )
            return False

        try:
            self.proc = subprocess.Popen(
                [exe_path],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding='utf-8',
                cwd=base_dir
            )
            self.is_running = True
            threading.Thread(target=self._read_loop, daemon=True).start()
            return True
        except Exception as e:
            self.on_error(f"Критическая ошибка запуска процесса: {e}")
            return False

    def send(self, cmd_data):
        if self.is_running and self.proc:
            try:
                self.proc.stdin.write(json.dumps(cmd_data, ensure_ascii=False) + '\n')
                self.proc.stdin.flush()
            except Exception as e:
                self.on_error(f"Ошибка отправки данных в движок: {e}")

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
                if self.verbose:
                    cmd = data.get("message", "") or data.get("command", "")
                    has_world = "world" in data
                    has_map = "map" in data
                    status = data.get("status", "?")
                    print(f"[ENGINE] status={status} world={has_world} map={has_map} msg={cmd[:60]}")

                if data.get("status") == "progress":
                    self.on_progress(data.get("message", ""))
                elif data.get("status") in ("ok", "realtime_update"):
                    self.on_result(data)
                elif data.get("status") == "error":
                    self.on_error(data.get("message", "Неизвестная ошибка движка"))
            except json.JSONDecodeError:
                print(f"[RAW ENGINE OUTPUT] {line[:200]}")

        self.is_running = False

        # Check for silent crash
        if self.proc:
            self.proc.poll()
            if self.proc.returncode is not None and self.proc.returncode != 0:
                err_output = self.proc.stderr.read()
                error_msg = f"Движок аварийно завершился (Код: {self.proc.returncode}).\n"
                if "dll" in err_output.lower() or self.proc.returncode == 3221225781:
                    error_msg += "\nПохоже, не хватает системных библиотек C++ (DLL). Перекомпилируйте движок с флагом -static:\n"
                    error_msg += "g++ -std=c++17 -O2 -static -o meterea_engine meterea_engine.cpp"
                else:
                    error_msg += f"Вывод ошибок:\n{err_output}"
                self.on_error(error_msg)

    def stop(self):
        self.is_running = False
        if self.proc:
            self.proc.terminate()
            self.proc = None


def load_json(path, default=None):
    """Load a JSON file. Returns `default` on failure.

    IMPORTANT: Array-type fields (recipes, biomes, monsters, disasters, races,
    professions, traits) MUST use default=[] to prevent C++ engine crashes.
    Object-type fields use default={} (the original behavior).
    """
    if default is None:
        default = {}
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            if not data:
                return default
            return data
    except FileNotFoundError:
        print(f"[WARN] File not found: {path}")
        return default
    except json.JSONDecodeError as e:
        print(f"[ERROR] Invalid JSON in {path}: {e}")
        return default
    except Exception as e:
        print(f"[WARN] Failed to load {path}: {e}")
        return default


def sync_biome_colors(biomes_data):
    """Build a biome-id -> RGB tuple dict from biomes.json data."""
    colors = {}
    if not isinstance(biomes_data, list) or not biomes_data:
        return colors
    for b in sorted(biomes_data, key=lambda x: x.get("numeric_id", 0)):
        nid = b.get("numeric_id", 0)
        hex_color = b.get("color_hex", "#000000")
        hex_color = hex_color.lstrip('#')
        if len(hex_color) == 6:
            rgb = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
            colors[nid] = rgb
    return colors
