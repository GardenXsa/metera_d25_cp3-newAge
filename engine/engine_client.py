#!/usr/bin/env python3
"""
Shared EngineProcess client and runtime-data helpers for communicating with the
Metera C++ simulation engine.

This module is the single source of truth for:
  - EngineProcess class (subprocess management + JSON line protocol)
  - load_json utility with correct default handling
  - runtime database manifest loading
  - shared era -> location file resolution
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
        import select as _select
        while self.is_running and self.proc:
            try:
                # Use select to add a timeout so we don't block forever
                if hasattr(_select, 'select'):
                    readable, _, _ = _select.select([self.proc.stdout], [], [], 5.0)
                    if not readable:
                        # No data for 5 seconds — check if process is still alive
                        if self.proc.poll() is not None:
                            break
                        continue
                line = self.proc.stdout.readline()
            except (ValueError, OSError):
                break
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
                elif data.get("status") == "hook_event":
                    # Lightweight mod hook — fire-and-forget, no world sync needed
                    if hasattr(self, "on_hook_event") and self.on_hook_event:
                        self.on_hook_event(data.get("hook", ""), data.get("data", {}))
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

    FIX (Issue #84): Previously `if not data:` returned `default` for valid but
    empty JSON values ({}, [], 0, false). Python's truthiness treats empty
    containers as falsy. Now only returns default on actual parse failures,
    not on valid empty values.
    """
    if default is None:
        default = {}
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # FIX: Only return default if parsing produced None (invalid),
            # NOT for valid empty values ({}, [], 0, false, "")
            if data is None:
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


def _resolve_manifest_relative_path(manifest_dir, data_dir, relative_path):
    if os.path.isabs(relative_path):
        return relative_path

    workspace_root = os.path.dirname(os.path.normpath(data_dir))
    normalized = relative_path.replace('/', os.sep)

    if normalized.startswith(f'.{os.sep}'):
        return os.path.normpath(os.path.join(workspace_root, normalized[2:]))

    return os.path.normpath(os.path.join(manifest_dir, normalized))


def _default_value_for_type(default_type):
    return [] if default_type == 'array' else {}


def _hydrate_prompt_pack(prompt_pack, manifest_dir, data_dir):
    if not isinstance(prompt_pack, dict):
        return {}

    prompt_pack = json.loads(json.dumps(prompt_pack))
    entries = prompt_pack.get('entries', {})
    aliases = prompt_pack.get('aliases', {})

    if not isinstance(entries, dict):
        entries = {}
    if not isinstance(aliases, dict):
        aliases = {}

    for semantic_key, entry in entries.items():
        if not isinstance(entry, dict):
            continue
        prompt_path = entry.get('path')
        if prompt_path and 'content' not in entry:
            resolved = _resolve_manifest_relative_path(manifest_dir, data_dir, prompt_path)
            try:
                with open(resolved, 'r', encoding='utf-8') as handle:
                    entry['content'] = handle.read()
            except OSError as exc:
                entry['content'] = f'Ошибка: не удалось загрузить prompt "{semantic_key}" из {prompt_path}. {exc}'
        if prompt_path:
            aliases[prompt_path] = semantic_key

    prompt_pack['entries'] = entries
    prompt_pack['aliases'] = aliases
    return prompt_pack


def load_runtime_manifest(data_dir, manifest_path=None):
    manifest_path = manifest_path or os.path.join(data_dir, 'runtime_manifest.json')
    return load_json(manifest_path, {"database_files": {}, "era_location_fallback_file": "locations_rebirth.json"})


def build_runtime_database(data_dir, manifest_path=None):
    manifest = load_runtime_manifest(data_dir, manifest_path=manifest_path)
    manifest_path = manifest_path or os.path.join(data_dir, 'runtime_manifest.json')
    manifest_dir = os.path.dirname(os.path.abspath(manifest_path))
    database = {}

    for key, descriptor in (manifest.get('database_files') or {}).items():
        descriptor = descriptor or {}
        default_value = _default_value_for_type(descriptor.get('default_type'))
        path_value = descriptor.get('path')
        if not path_value:
            database[key] = default_value
            continue
        resolved_path = _resolve_manifest_relative_path(manifest_dir, data_dir, path_value)
        database[key] = load_json(resolved_path, default_value)

    if 'prompt_pack' in database:
        database['prompt_pack'] = _hydrate_prompt_pack(database['prompt_pack'], manifest_dir, data_dir)

    database['runtime_manifest'] = manifest
    return database


def resolve_era_location_file(eras, era_id, fallback_file_name):
    fallback = fallback_file_name or 'locations_rebirth.json'
    era = None
    if isinstance(eras, list):
        era = next((item for item in eras if isinstance(item, dict) and item.get('id') == era_id), None)

    if not era:
        return {
            "file_name": fallback,
            "used_fallback": True,
            "warning": f'[RuntimeData] Era "{era_id}" is not defined. Falling back to {fallback}.'
        }

    default_file = era.get('default_location_file')
    if not default_file:
        return {
            "file_name": fallback,
            "used_fallback": True,
            "warning": f'[RuntimeData] Era "{era_id}" has no default_location_file. Falling back to {fallback}.'
        }

    return {
        "file_name": default_file,
        "used_fallback": False,
        "warning": ""
    }


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
