#!/usr/bin/env python3
"""
Chronicles of Meterea — ModKit 3.1
Professional Mod Creation Suite

Features:
  - Professional IDE-like interface inspired by VS Code
  - Context menus (right-click) for ALL actions
  - AI Modder Assistant with ALL vanilla game providers
  - AI can create complete mods from scratch
  - Trained on game's own modding documentation
  - Syntax highlighting for JSON/JS
  - Mod validation & dependency checker
  - Template scaffolding
  - Live preview of mod.json
  - Keyboard shortcuts everywhere
  - Thinking budget, prompt caching, key rotation support

Author: MrKins_XP (GardenXsa)
"""

import os
import sys
import json
import re
import platform
import subprocess
import threading
import tkinter as tk
from tkinter import ttk, messagebox, filedialog, colorchooser
import customtkinter as ctk

# ─── Version ───────────────────────────────────────────────────────────────────
MODKIT_VERSION = "3.1.0"
GAME_VERSION = "0.4.0"

ctk.set_appearance_mode("Dark")
ctk.set_default_color_theme("blue")

# ─── Color Palette (matches game UI) ──────────────────────────────────────────
COLORS = {
    "bg_dark":       "#0a0e14",
    "bg_panel":      "#0f1419",
    "bg_card":       "#1a1f26",
    "bg_hover":      "#1e2530",
    "bg_selected":   "#1a2a3a",
    "bg_input":      "#151a22",
    "accent_blue":   "#5dade2",
    "accent_gold":   "#d4af37",
    "accent_green":  "#2ecc71",
    "accent_red":    "#e74c3c",
    "accent_purple": "#9b59b6",
    "accent_cyan":   "#1abc9c",
    "accent_orange": "#e67e22",
    "text_main":     "#ecf0f1",
    "text_muted":    "#7f8c8d",
    "text_dim":      "#555e68",
    "border":        "#2c3e50",
    "border_light":  "#34495e",
    "border_active": "#5dade2",
    "success":       "#27ae60",
    "warning":       "#f39c12",
    "danger":        "#c0392b",
    "info":          "#2980b9",
    "toolbar_bg":    "#0d1117",
    "sidebar_bg":    "#0d1117",
    "tab_active":    "#1a2a3a",
    "tab_inactive":  "#0d1117",
}

# ─── AI Providers (ALL vanilla game providers + extras) ────────────────────────
AI_PROVIDERS = {
    "gemini": {
        "name": "Google Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/models",
        "models": ["gemini-3.1-flash-lite-preview", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-2.0-flash-lite"],
        "auth_type": "query_param",
        "supports_key_rotation": True,
        "supports_prompt_caching": False,
        "supports_thinking": False,
    },
    "openrouter": {
        "name": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1/chat/completions",
        "models": ["google/gemini-3.1-flash-lite-preview", "anthropic/claude-3.5-sonnet", "anthropic/claude-3-haiku", "google/gemini-2.0-flash-lite-preview-02-05:free"],
        "auth_type": "bearer",
        "supports_key_rotation": False,
        "supports_prompt_caching": True,
        "supports_thinking": False,
    },
    "deepseek": {
        "name": "DeepSeek",
        "base_url": "https://api.deepseek.com/v1/chat/completions",
        "models": ["deepseek-chat", "deepseek-reasoner"],
        "auth_type": "bearer",
        "supports_key_rotation": False,
        "supports_prompt_caching": False,
        "supports_thinking": True,
    },
    "openai": {
        "name": "OpenAI (GPT-4o / GPT-4 / GPT-3.5)",
        "base_url": "https://api.openai.com/v1/chat/completions",
        "models": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
        "auth_type": "bearer",
        "supports_key_rotation": False,
        "supports_prompt_caching": False,
        "supports_thinking": False,
    },
    "anthropic": {
        "name": "Anthropic (Claude)",
        "base_url": "https://api.anthropic.com/v1/messages",
        "models": ["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"],
        "auth_type": "anthropic",
        "supports_key_rotation": False,
        "supports_prompt_caching": True,
        "supports_thinking": True,
    },
    "local": {
        "name": "Local LLM (LM Studio / Ollama)",
        "base_url": "http://localhost:1234/v1/chat/completions",
        "models": ["local-model", "llama3", "mistral", "codellama", "deepseek-coder"],
        "auth_type": "none",
        "supports_key_rotation": False,
        "supports_prompt_caching": False,
        "supports_thinking": False,
        "configurable_url": True,
    },
    "custom": {
        "name": "Custom OpenAI-compatible API",
        "base_url": "",
        "models": [],
        "auth_type": "bearer",
        "supports_key_rotation": False,
        "supports_prompt_caching": False,
        "supports_thinking": False,
        "configurable_url": True,
    },
}

AI_PROVIDERS.update({
    "dummy": {
        "name": "Dummy / UI Test Provider",
        "base_url": "",
        "models": ["dummy-modkit"],
        "auth_type": "none",
        "supports_key_rotation": False,
        "supports_prompt_caching": False,
        "supports_thinking": False,
        "configurable_url": False,
        "category": "vanilla",
        "requires_api_key": False,
        "description": "Offline test provider for checking ModKit AI UI without network.",
    },
    "groq": {
        "name": "Groq",
        "base_url": "https://api.groq.com/openai/v1/chat/completions",
        "models": ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
        "auth_type": "bearer",
        "supports_key_rotation": False,
        "supports_prompt_caching": False,
        "supports_thinking": False,
        "category": "extended",
        "requires_api_key": True,
    },
    "mistral": {
        "name": "Mistral AI",
        "base_url": "https://api.mistral.ai/v1/chat/completions",
        "models": ["mistral-large-latest", "mistral-small-latest", "codestral-latest"],
        "auth_type": "bearer",
        "supports_key_rotation": False,
        "supports_prompt_caching": False,
        "supports_thinking": False,
        "category": "extended",
        "requires_api_key": True,
    },
    "cohere": {
        "name": "Cohere",
        "base_url": "https://api.cohere.com/compatibility/v1/chat/completions",
        "models": ["command-a-03-2025", "command-r-plus", "command-r"],
        "auth_type": "bearer",
        "supports_key_rotation": False,
        "supports_prompt_caching": False,
        "supports_thinking": False,
        "category": "extended",
        "requires_api_key": True,
    },
    "together": {
        "name": "Together AI",
        "base_url": "https://api.together.xyz/v1/chat/completions",
        "models": ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-Coder-32B-Instruct", "deepseek-ai/DeepSeek-V3"],
        "auth_type": "bearer",
        "supports_key_rotation": False,
        "supports_prompt_caching": False,
        "supports_thinking": False,
        "category": "extended",
        "requires_api_key": True,
    },
    "fireworks": {
        "name": "Fireworks AI",
        "base_url": "https://api.fireworks.ai/inference/v1/chat/completions",
        "models": ["accounts/fireworks/models/llama-v3p3-70b-instruct", "accounts/fireworks/models/deepseek-v3", "accounts/fireworks/models/qwen2p5-coder-32b-instruct"],
        "auth_type": "bearer",
        "supports_key_rotation": False,
        "supports_prompt_caching": False,
        "supports_thinking": False,
        "category": "extended",
        "requires_api_key": True,
    },
    "xai": {
        "name": "xAI",
        "base_url": "https://api.x.ai/v1/chat/completions",
        "models": ["grok-4", "grok-3", "grok-3-mini"],
        "auth_type": "bearer",
        "supports_key_rotation": False,
        "supports_prompt_caching": False,
        "supports_thinking": True,
        "category": "extended",
        "requires_api_key": True,
    },
    "cerebras": {
        "name": "Cerebras",
        "base_url": "https://api.cerebras.ai/v1/chat/completions",
        "models": ["llama-3.3-70b", "llama-4-scout-17b-16e-instruct"],
        "auth_type": "bearer",
        "supports_key_rotation": False,
        "supports_prompt_caching": False,
        "supports_thinking": False,
        "category": "extended",
        "requires_api_key": True,
    },
    "github_models": {
        "name": "GitHub Models",
        "base_url": "https://models.github.ai/inference/chat/completions",
        "models": ["openai/gpt-4o", "openai/gpt-4o-mini", "mistral-ai/mistral-large-2411", "meta/llama-3.3-70b-instruct"],
        "auth_type": "bearer",
        "supports_key_rotation": False,
        "supports_prompt_caching": False,
        "supports_thinking": False,
        "category": "extended",
        "requires_api_key": True,
    },
    "azure_openai": {
        "name": "Azure OpenAI",
        "base_url": "",
        "models": ["deployment-name"],
        "auth_type": "api_key",
        "supports_key_rotation": False,
        "supports_prompt_caching": False,
        "supports_thinking": False,
        "configurable_url": True,
        "category": "extended",
        "requires_api_key": True,
        "description": "Paste the full Azure chat completions URL including api-version.",
    },
})

VANILLA_PROVIDER_IDS = ("gemini", "openrouter", "deepseek", "local", "dummy")
OPENAI_COMPATIBLE_PROVIDER_IDS = (
    "openai", "openrouter", "deepseek", "local", "custom",
    "groq", "mistral", "cohere", "together", "fireworks", "xai",
    "cerebras", "github_models", "azure_openai",
)
OPENAI_TOOL_STREAM_PROVIDER_IDS = (
    "openai", "openrouter", "deepseek", "local", "custom",
    "groq", "mistral", "cohere", "together", "fireworks", "xai",
    "cerebras", "github_models", "azure_openai",
)
GEMINI_TOOL_STREAM_PROVIDER_IDS = ("gemini",)
ANTHROPIC_TOOL_STREAM_PROVIDER_IDS = ("anthropic",)
DUMMY_TOOL_STREAM_PROVIDER_IDS = ("dummy",)
NATIVE_TOOL_STREAM_PROVIDER_IDS = (
    "gemini", "openrouter", "deepseek", "local", "dummy", "openai", "anthropic",
    "custom", "groq", "mistral", "cohere", "together", "fireworks", "xai",
    "cerebras", "github_models", "azure_openai",
)

for _provider_id, _provider_cfg in AI_PROVIDERS.items():
    _provider_cfg.setdefault("category", "vanilla" if _provider_id in VANILLA_PROVIDER_IDS else "extended")
    _provider_cfg.setdefault("requires_api_key", _provider_cfg.get("auth_type") not in ("none",))
    _provider_cfg.setdefault("description", "")

# ─── System Prompt for AI Modder ──────────────────────────────────────────────
AI_SYSTEM_PROMPT = """You are the Meterea ModKit AI Assistant — an expert modder for "Chronicles of Meterea", an AI Text RPG (v0.4.0).

GAME OVERVIEW:
- Dark fantasy text RPG with AI Game Master, built on Electron + C++ simulation engine
- 4 epochs: Возрождение (year 1042, dark fantasy), Архитекторы (year 850, mana-punk), Раскол (year 1, cosmic horror), Тишина (year 215, post-apocalypse)
- Three modding levels: Data mods (JSON), JS mods (ModAPI sandbox), C++ plugins (ModKit SDK)

DATA MOD STRUCTURE (mod.json):
{
  "id": "my_mod_id",
  "name": "My Mod Name",
  "version": "1.0.0",
  "author": "Author",
  "description": "Description",
  "dependencies": ["base_game"],
  "scripts": ["data/main.js"],
  "data": {
    "items": "data/items.json",
    "races": "data/races.json"
  }
}

MERGE POLICIES:
- deepMerge: merges objects recursively (default for most data)
- append: appends array items (items, recipes, professions, etc.)
- appendUnique: appends only if id not present (races, classes, eras, biomes, etc.)
- upsertById: updates existing by id or appends (faction_relations, etc.)
- replace: full replacement (world_config, prompt_pack)

KEY DATABASE KEYS AND FORMATS:
- items: [{id, name, type, tags[], value, weight, damage, armor, slot, description}]
- recipes: [{id, name, category, ingredients:{item_id:count}, result:{item_id,count}, skill_requirement}]
- races: [{id, name_ru, faction_preference[], biome, stats:{str,dex,int,con,cha,res}, description}]
- classes: [{id, name_ru, stats:{str,dex,int,con,cha,res}, abilities[], starting_items[], description}]
- eras: [{id, name_ru, start_year, description, features[], theme}]
- biomes: [{id, name_ru, color, movement_cost, tags[], resources[]}]
- monsters: [{id, name_ru, hp, biome, loot[], special_abilities[]}]
- professions: [{id, name_ru, category, skills[], requirements}]
- traits: [{id, name_ru, effects:{}, description}]
- factions: [{id, name_ru, biome, role, theme, starting_relations{}}]
- locations: [{id, name_ru, era, biome, description, features[], parent?}]
- building_types: [{id, name_ru, era_transforms{era:id}, cost{}, effects{}}]
- npc_names: {male:[], female:[], surnames:[]}
- faction_relations: [{faction1, faction2, base_relation, era?}]
- diplomacy: {states:[], actions:[]}
- casus_belli: [{id, name, description, requirements[]}]
- ship_types: [{id, name, speed, capacity, combat_power, cost}]
- narrators: [{id, name_ru, style, system_prompt_mod, portrait}]

ModAPI (JavaScript Sandbox):
- ModAPI.on(event, callback) — register hooks (onModsInitialized, onDatabaseLoad, onGameStart, onPlayerAction, onAITurnStart, onAITurnEnd, onCombatStart, onCombatEnd, onItemUsed, onLocationEntered, onDayTick, onHourTick, onNPCDeath)
- ModAPI.emit(event, ...args) — fire hooks
- ModAPI.addCommand(name, handler, docs) — custom GM command
- ModAPI.addPromptInjection(text) — inject into AI system prompt (max 2000 chars)
- ModAPI.patchFunction(obj, name, cb) — monkey-patch with rollback
- ModAPI.hookFunction(obj, name, cb, priority) — priority-based hook chain
- ModAPI.addUI(html, selector) — insert sanitized HTML
- ModAPI.addStyle(id, css) — inject scoped CSS
- ModAPI.addSettingsTab(id, title, html) — add settings tab
- ModAPI.registerHotkey(combo, cb) — keyboard shortcut
- ModAPI.addPromptFilter(cb) / addResponseFilter(cb) / addTextFilter(cb)
- ModAPI.addTranslations(lang, obj) / setString(lang, path, value)
- ModAPI.registerSaveData(modId, onSave, onLoad)
- ModAPI.sendToEngine(command, args) / sendRawToEngine(command, args)
- ModAPI.readFile(modId, fileName) / readJson(modId, fileName)
- ModAPI.notify(message, type)
- ModAPI.queueMutation(mutations) — batched IPC mutations
- ModAPI.unloadMod() — full cleanup

Sandbox blocks: fetch, eval, Function(), import(), require, process, __proto__, child_process, fs, localStorage, sessionStorage, electronAPI

C++ ModKit SDK (meterea_mod_sdk.h v3.3.0):
- Hooks: onDailyTick, onHourlyTick, onRegionChanged, onNpcDeath, onBattle, onTrade, onDisaster, onBuildingBuilt
- Read queries: getRegionPopulation, getRegionStability, getItemPrice, getNpcHp, getMapWidth/Height, getTileBiome, getFactionRelation, getLocationAt
- Deferred mutations: setRegionStability, modifyRegionPopulation, multiplyAllPrices, spawnItem, triggerDisaster, spawnMonster, setTileBiome, addLocation, removeLocation, regenerateMap

WHEN CREATING A MOD FROM SCRATCH:
1. Always create the complete mod.json with all required fields
2. Create ALL data/script files referenced in mod.json
3. Use correct merge policies for each data key
4. Generate production-ready code with Russian comments
5. Include realistic, thematic content matching the game's dark fantasy setting
6. Output the complete mod structure clearly so the user can see every file

RULES:
1. Always generate valid JSON for data mods, valid JS for script mods
2. Use correct merge policies for each data key
3. Include proper mod.json structure with id, name, version, author, description, dependencies
4. For JS mods, only use ModAPI methods listed above — sandbox blocks everything else
5. For data mods, match the exact field names and types shown in the formats above
6. Always explain what the code does in Russian comments
7. Generate production-ready code, not stubs
8. When asked to create a mod from scratch, output the COMPLETE file contents for EVERY file, formatted in clear code blocks with filenames
"""

# ─── AI Quick Create Templates ────────────────────────────────────────────────
AI_CREATE_TEMPLATES = {
    "data_items": {
        "label": "📦 Предметы",
        "desc": "Data-мод: новые предметы",
        "prompt": "Создай ПОЛНЫЙ мод с нуля, добавляющий 8 новых уникальных предметов для эпохи Возрождения. Создай mod.json и data/items.json. Предметы должны быть тематическими (тёмное фэнтези): оружие, броня, зелья, артефакты. Используй merge-политику append. Выведи полное содержимое КАЖДОГО файла.",
    },
    "data_races": {
        "label": "🧬 Расы",
        "desc": "Data-мод: новые расы",
        "prompt": "Создай ПОЛНЫЙ мод с нуля, добавляющий 3 новые расы для Хроник Метерии. Создай mod.json и data/races.json. Каждая раса должна иметь уникальные статы (str,dex,int,con,cha,res), предпочтение фракции, биом и описание на русском. Используй merge-политику appendUnique. Выведи полное содержимое КАЖДОГО файла.",
    },
    "data_monsters": {
        "label": "👹 Монстры",
        "desc": "Data-мод: новые монстры",
        "prompt": "Создай ПОЛНЫЙ мод с нуля, добавляющий 5 новых монстров для Хроник Метерии. Создай mod.json и data/monsters.json. Монстры должны быть тематическими для эпохи Раскол (cosmic horror): хп, биом, лут, специальные способности. Используй merge-политику append. Выведи полное содержимое КАЖДОГО файла.",
    },
    "data_locations": {
        "label": "🏰 Локации",
        "desc": "Data-мод: новые локации",
        "prompt": "Создай ПОЛНЫЙ мод с нуля, добавляющий 4 новые локации для разных эпох Хроник Метерии. Создай mod.json и data/locations.json. Локации должны иметь описание, фичи, биом, привязку к эпохе. Используй merge-политику append. Выведи полное содержимое КАЖДОГО файла.",
    },
    "data_factions": {
        "label": "⚔️ Фракции",
        "desc": "Data-мод: новые фракции",
        "prompt": "Создай ПОЛНЫЙ мод с нуля, добавляющий 2 новые фракции с их отношениями. Создай mod.json, data/factions.json и data/faction_relations.json. Фракции должны быть тематическими (тёмное фэнтези), с биомом, ролью, темой и начальными отношениями. Выведи полное содержимое КАЖДОГО файла.",
    },
    "js_commands": {
        "label": "📜 JS-команды",
        "desc": "JS-мод: кастомные GM-команды",
        "prompt": "Создай ПОЛНЫЙ JS-мод с нуля, добавляющий 3 кастомные GM-команды: /heal (восстановить здоровье), /teleport (телепорт в локацию), /spawn (создать предмет). Создай mod.json и data/main.js. Используй ModAPI.addCommand с документацией. Добавь хук onPlayerAction для логирования. Выведи полное содержимое КАЖДОГО файла.",
    },
    "js_hooks": {
        "label": "🔗 JS-хуки",
        "desc": "JS-мод: хуки и фильтры",
        "prompt": "Создай ПОЛНЫЙ JS-мод с нуля, который использует систему хуков ModAPI: onDayTick (ежедневные события), onCombatStart (бонус перед боем), onAITurnStart (фильтр промпта). Создай mod.json и data/main.js. Используй ModAPI.on, ModAPI.addPromptFilter, ModAPI.addPromptInjection. Выведи полное содержимое КАЖДОГО файла.",
    },
    "js_ui": {
        "label": "🖥 JS-UI",
        "desc": "JS-мод: кастомный UI",
        "prompt": "Создай ПОЛНЫЙ JS-мод с нуля, добавляющий кастомную панель статистики в UI игры. Создай mod.json и data/main.js. Используй ModAPI.addUI, ModAPI.addStyle, ModAPI.addSettingsTab, ModAPI.registerHotkey для отображения/скрытия панели. Выведи полное содержимое КАЖДОГО файла.",
    },
    "total_conversion": {
        "label": "🔥 Тотал-конверсия",
        "desc": "Полная замена: тотал-конверсия",
        "prompt": "Создай ПОЛНЫЙ мод тотал-конверсии с нуля для Хроник Метерии — киберпанк-тема в стиле эпохи Архитекторов (mana-punk). Замени: world_config (replace), prompt_pack (replace), items (append), races (appendUnique), factions (append), biomes (appendUnique). Создай mod.json и ВСЕ data-файлы. Выведи полное содержимое КАЖДОГО файла.",
    },
    "custom": {
        "label": "✏️ Свой запрос",
        "desc": "Опишите мод своими словами",
        "prompt": None,
    },
}

# ─── Helper: Get Mods Directory ────────────────────────────────────────────────
def get_mods_dir():
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

def get_game_dir():
    """Try to find the game directory for README.md / documentation."""
    cwd = os.getcwd()
    if os.path.exists(os.path.join(cwd, "README.md")) and os.path.exists(os.path.join(cwd, "data")):
        return cwd
    return None

# ─── HTTP Helper (no external deps) ───────────────────────────────────────────
def http_post_json(url, headers, body, timeout=120):
    """Minimal HTTP POST using stdlib only. Returns (status_code, response_json) or raises."""
    from urllib.request import Request, urlopen
    from urllib.error import URLError, HTTPError
    import ssl

    data = json.dumps(body).encode("utf-8")
    req = Request(url, data=data, method="POST")
    for k, v in headers.items():
        req.add_header(k, v)
    req.add_header("Content-Type", "application/json")

    ctx = ssl.create_default_context()
    try:
        with urlopen(req, timeout=timeout, context=ctx) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(body_text)
        except:
            return e.code, {"error": body_text}
    except URLError as e:
        raise ConnectionError(f"Network error: {e.reason}")


def http_stream_json_events(url, headers, body, timeout=120):
    """Yield JSON payloads from an SSE-style streaming API response."""
    from urllib.request import Request, urlopen
    from urllib.error import URLError, HTTPError
    import ssl

    data = json.dumps(body).encode("utf-8")
    req = Request(url, data=data, method="POST")
    for k, v in headers.items():
        req.add_header(k, v)
    req.add_header("Content-Type", "application/json")

    ctx = ssl.create_default_context()
    try:
        with urlopen(req, timeout=timeout, context=ctx) as resp:
            for raw_line in resp:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line or not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                try:
                    yield json.loads(payload)
                except json.JSONDecodeError:
                    yield {"_raw": payload}
    except HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        raise Exception(f"Stream API Error {e.code}: {body_text[:2000]}")
    except URLError as e:
        raise ConnectionError(f"Network error: {e.reason}")


# ═══════════════════════════════════════════════════════════════════════════════
# Main Application
# ═══════════════════════════════════════════════════════════════════════════════
class ModKitApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title(f"Meterea ModKit v{MODKIT_VERSION}")
        self.geometry("1500x900")
        self.minsize(1200, 750)
        self.configure(fg_color=COLORS["bg_dark"])

        self.mods_dir = get_mods_dir()
        self.current_mod_id = None
        self.current_file_path = None
        self.all_mods = []
        self.modified = False
        self.ai_settings = self._load_ai_settings()
        self._ai_busy = False
        self._ai_chat_history = []
        self._gemini_keys = list(self.ai_settings.get("gemini_keys", []))
        self._gemini_key_index = 0

        # Context menu reference (destroyed on each right-click)
        self._ctx_menu = None

        # AI panel window reference
        self._ai_window = None

        self._build_ui()
        self._bind_shortcuts()
        self.load_mods()

    # ── AI Settings Persistence ────────────────────────────────────────────────
    def _load_ai_settings(self):
        settings_path = os.path.join(get_mods_dir(), "..", "modkit_ai.json")
        try:
            if os.path.exists(settings_path):
                with open(settings_path, "r", encoding="utf-8") as f:
                    return json.load(f)
        except:
            pass
        return {
            "provider": "gemini",
            "model": "gemini-3.1-flash-lite-preview",
            "api_key": "",
            "base_url": "",
            "temperature": 0.7,
            "max_tokens": 8192,
            "thinking_budget": 2048,
            "use_prompt_caching": False,
            "use_thinking": False,
            "gemini_keys": [],
        }

    def _save_ai_settings(self):
        settings_path = os.path.join(get_mods_dir(), "..", "modkit_ai.json")
        try:
            self.ai_settings["gemini_keys"] = self._gemini_keys
            with open(settings_path, "w", encoding="utf-8") as f:
                json.dump(self.ai_settings, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[ModKit] Could not save AI settings: {e}")

    # ════════════════════════════════════════════════════════════════════════════
    # UI CONSTRUCTION
    # ════════════════════════════════════════════════════════════════════════════
    def _provider_label(self, provider_id):
        cfg = AI_PROVIDERS.get(provider_id, {})
        prefix = "Vanilla" if cfg.get("category") == "vanilla" else "Extended"
        return f"{provider_id} - {cfg.get('name', provider_id)} [{prefix}]"

    def _provider_option_values(self):
        vanilla = [pid for pid in VANILLA_PROVIDER_IDS if pid in AI_PROVIDERS]
        extended = [pid for pid in AI_PROVIDERS if pid not in vanilla]
        return [self._provider_label(pid) for pid in vanilla + extended]

    def _provider_id_from_value(self, value):
        raw = str(value or "").strip()
        if raw in AI_PROVIDERS:
            return raw
        provider_id = raw.split(" - ", 1)[0].strip()
        return provider_id if provider_id in AI_PROVIDERS else "gemini"

    def _provider_requires_api_key(self, provider_id):
        cfg = AI_PROVIDERS.get(provider_id, {})
        return bool(cfg.get("requires_api_key", cfg.get("auth_type") not in ("none",)))

    def _current_provider_id(self):
        return self._provider_id_from_value(self.ai_settings.get("provider", "gemini"))

    def _selected_model_for_provider(self, provider_id):
        models = AI_PROVIDERS.get(provider_id, {}).get("models", [])
        saved = self.ai_settings.get("model", "")
        return saved if saved in models or not models else models[0]

    def _build_dummy_ai_response(self, user_message):
        return (
            "Dummy ModKit AI response.\n\n"
            "Provider routing, UI settings, and prompt delivery are working without network.\n\n"
            "Requested task preview:\n"
            f"{str(user_message or '').strip()[:1200]}"
        )

    def _build_ui(self):
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(1, weight=1)

        self._build_toolbar()
        self._build_sidebar()
        self._build_content_area()
        self._build_statusbar()

    # ── Toolbar ────────────────────────────────────────────────────────────────
    def _build_toolbar(self):
        toolbar = ctk.CTkFrame(self, height=42, fg_color=COLORS["toolbar_bg"], corner_radius=0)
        toolbar.grid(row=0, column=0, columnspan=2, sticky="ew")
        toolbar.grid_columnconfigure(4, weight=1)

        # Logo with game name
        logo_frame = ctk.CTkFrame(toolbar, fg_color="transparent")
        logo_frame.grid(row=0, column=0, padx=(12, 0), pady=6)
        ctk.CTkLabel(logo_frame, text="⚒", font=ctk.CTkFont(size=16), text_color=COLORS["accent_gold"]).pack(side="left")
        ctk.CTkLabel(logo_frame, text=" ModKit", font=ctk.CTkFont(family="Consolas", size=14, weight="bold"), text_color=COLORS["accent_gold"]).pack(side="left", padx=(2, 0))
        ctk.CTkLabel(logo_frame, text=f" v{MODKIT_VERSION}", font=ctk.CTkFont(size=9), text_color=COLORS["text_dim"]).pack(side="left", padx=(4, 0))

        # Action buttons (compact)
        btn_style = {"height": 30, "corner_radius": 4, "font": ctk.CTkFont(size=11)}

        actions_frame = ctk.CTkFrame(toolbar, fg_color="transparent")
        actions_frame.grid(row=0, column=1, padx=8, pady=6)

        self.btn_new_mod = ctk.CTkButton(actions_frame, text="+ Мод", fg_color=COLORS["accent_green"], hover_color="#27ae60", width=70, command=self.create_mod, **btn_style)
        self.btn_new_mod.pack(side="left", padx=2)

        self.btn_open_folder = ctk.CTkButton(actions_frame, text="📂 Папка", fg_color=COLORS["border_light"], hover_color=COLORS["border"], width=70, command=self.open_mods_folder, **btn_style)
        self.btn_open_folder.pack(side="left", padx=2)

        self.btn_refresh = ctk.CTkButton(actions_frame, text="↻", fg_color=COLORS["border_light"], hover_color=COLORS["border"], width=30, command=self.load_mods, **btn_style)
        self.btn_refresh.pack(side="left", padx=2)

        self.btn_validate = ctk.CTkButton(actions_frame, text="✓ Валидация", fg_color=COLORS["info"], hover_color="#2471a3", width=85, command=self.validate_current_mod, **btn_style)
        self.btn_validate.pack(side="left", padx=2)

        # Right side buttons
        right_frame = ctk.CTkFrame(toolbar, fg_color="transparent")
        right_frame.grid(row=0, column=5, padx=(0, 12), pady=6)

        self.btn_ai = ctk.CTkButton(right_frame, text="🤖 AI Ассистент", fg_color=COLORS["accent_purple"], hover_color="#8e44ad", width=120, command=self.open_ai_panel, **btn_style)
        self.btn_ai.pack(side="left", padx=2)

        self.btn_settings = ctk.CTkButton(right_frame, text="⚙", fg_color=COLORS["border_light"], hover_color=COLORS["border"], width=30, command=self.open_settings, **btn_style)
        self.btn_settings.pack(side="left", padx=2)

        # Right-click on toolbar
        toolbar.bind("<Button-3>", self._toolbar_context_menu)

    # ── Sidebar (Mods List) ────────────────────────────────────────────────────
    def _build_sidebar(self):
        sidebar = ctk.CTkFrame(self, width=280, fg_color=COLORS["sidebar_bg"], corner_radius=0)
        sidebar.grid(row=1, column=0, sticky="ns")
        sidebar.grid_rowconfigure(2, weight=1)
        sidebar.grid_columnconfigure(0, weight=1)

        # Header
        hdr = ctk.CTkFrame(sidebar, fg_color="transparent", height=36)
        hdr.grid(row=0, column=0, sticky="ew", padx=10, pady=(10, 2))
        hdr.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(hdr, text="МОДЫ", font=ctk.CTkFont(size=12, weight="bold"), text_color=COLORS["accent_gold"]).grid(row=0, column=0, sticky="w")
        self.mod_count_label = ctk.CTkLabel(hdr, text="0", font=ctk.CTkFont(size=10), text_color=COLORS["text_dim"])
        self.mod_count_label.grid(row=0, column=1, sticky="e")

        # Search
        self.search_var = ctk.StringVar()
        self.search_var.trace_add("write", lambda *_: self._filter_mods())
        search_entry = ctk.CTkEntry(sidebar, textvariable=self.search_var, placeholder_text="Поиск мода...", height=28, fg_color=COLORS["bg_input"], border_color=COLORS["border"], corner_radius=4, font=ctk.CTkFont(size=11))
        search_entry.grid(row=1, column=0, sticky="ew", padx=10, pady=(2, 5))

        # Mod list (scrollable)
        self.mods_scroll = ctk.CTkScrollableFrame(sidebar, fg_color="transparent", corner_radius=0)
        self.mods_scroll.grid(row=2, column=0, sticky="nswe", padx=5, pady=5)

        # Context menu bindings on sidebar
        self.mods_scroll.bind("<Button-3>", self._sidebar_context_menu)

    # ── Content Area ────────────────────────────────────────────────────────────
    def _build_content_area(self):
        content = ctk.CTkFrame(self, fg_color=COLORS["bg_dark"], corner_radius=0)
        content.grid(row=1, column=1, sticky="nswe")
        content.grid_rowconfigure(1, weight=1)
        content.grid_columnconfigure(0, weight=1)

        # ── Tab bar ────────────────────────────────────────────────────────────
        tab_bar = ctk.CTkFrame(content, height=36, fg_color=COLORS["tab_inactive"], corner_radius=0)
        tab_bar.grid(row=0, column=0, sticky="ew")
        tab_bar.grid_columnconfigure(2, weight=1)

        self.tab_files = ctk.CTkButton(tab_bar, text="Файлы", fg_color=COLORS["tab_active"], text_color=COLORS["accent_blue"], hover_color=COLORS["bg_hover"], corner_radius=0, height=32, font=ctk.CTkFont(size=11), command=lambda: self._switch_tab("files"))
        self.tab_files.grid(row=0, column=0, padx=(5, 0), pady=2)

        self.tab_editor = ctk.CTkButton(tab_bar, text="Редактор", fg_color=COLORS["tab_inactive"], text_color=COLORS["text_muted"], hover_color=COLORS["bg_hover"], corner_radius=0, height=32, font=ctk.CTkFont(size=11), command=lambda: self._switch_tab("editor"))
        self.tab_editor.grid(row=0, column=1, padx=2, pady=2)

        # File path label
        self.file_path_label = ctk.CTkLabel(tab_bar, text="", font=ctk.CTkFont(family="Consolas", size=10), text_color=COLORS["text_dim"])
        self.file_path_label.grid(row=0, column=2, sticky="e", padx=10)

        # Save button
        self.btn_save = ctk.CTkButton(tab_bar, text="💾 Сохранить", fg_color=COLORS["success"], hover_color=COLORS["accent_green"], width=90, height=26, corner_radius=4, font=ctk.CTkFont(size=10), command=self.save_file)
        self.btn_save.grid(row=0, column=3, padx=5)

        # Right-click on tab bar
        tab_bar.bind("<Button-3>", self._tabbar_context_menu)

        # ── Paned: files tree | editor ─────────────────────────────────────────
        paned = ctk.CTkFrame(content, fg_color="transparent")
        paned.grid(row=1, column=0, sticky="nswe", padx=3, pady=3)
        paned.grid_columnconfigure(1, weight=1)
        paned.grid_rowconfigure(0, weight=1)

        # Files panel
        self.files_panel = ctk.CTkFrame(paned, width=240, fg_color=COLORS["bg_panel"], corner_radius=6)
        self.files_panel.grid(row=0, column=0, sticky="ns", padx=(0, 3))
        self.files_panel.grid_rowconfigure(1, weight=1)
        self.files_panel.grid_columnconfigure(0, weight=1)

        files_hdr = ctk.CTkFrame(self.files_panel, fg_color="transparent", height=32)
        files_hdr.grid(row=0, column=0, sticky="ew", padx=8, pady=(6, 2))
        ctk.CTkLabel(files_hdr, text="Файлы мода", font=ctk.CTkFont(size=11, weight="bold"), text_color=COLORS["accent_blue"]).pack(side="left")

        btn_add_file = ctk.CTkButton(files_hdr, text="+", width=24, height=24, fg_color="transparent", hover_color=COLORS["bg_hover"], text_color=COLORS["accent_green"], corner_radius=3, font=ctk.CTkFont(size=12, weight="bold"), command=self.create_file)
        btn_add_file.pack(side="right")

        self.files_scroll = ctk.CTkScrollableFrame(self.files_panel, fg_color="transparent")
        self.files_scroll.grid(row=1, column=0, sticky="nswe", padx=3, pady=3)
        self.files_scroll.bind("<Button-3>", self._files_context_menu)

        # Editor panel
        editor_frame = ctk.CTkFrame(paned, fg_color=COLORS["bg_card"], corner_radius=6)
        editor_frame.grid(row=0, column=1, sticky="nswe")
        editor_frame.grid_rowconfigure(0, weight=1)
        editor_frame.grid_columnconfigure(0, weight=1)

        # Text editor with line numbers
        self.editor_container = ctk.CTkFrame(editor_frame, fg_color="transparent")
        self.editor_container.grid(row=0, column=0, sticky="nswe", padx=2, pady=2)
        self.editor_container.grid_rowconfigure(0, weight=1)
        self.editor_container.grid_columnconfigure(1, weight=1)

        # Line numbers
        self.line_numbers = tk.Text(self.editor_container, width=5, fg=COLORS["text_dim"], bg=COLORS["bg_card"], font=("Consolas", 11), state="disabled", relief="flat", padx=4, pady=5, cursor="arrow", selectbackground=COLORS["bg_card"], borderwidth=0)
        self.line_numbers.grid(row=0, column=0, sticky="ns")

        # Main editor
        self.editor = tk.Text(self.editor_container, fg=COLORS["text_main"], bg=COLORS["bg_card"], font=("Consolas", 11), insertbackground=COLORS["accent_blue"], relief="flat", padx=8, pady=5, wrap="none", undo=True, borderwidth=0, selectbackground=COLORS["accent_blue"], selectforeground=COLORS["bg_dark"], tabs=("4c",))
        self.editor.grid(row=0, column=1, sticky="nswe")
        self.editor.bind("<KeyRelease>", self._on_editor_change)
        self.editor.bind("<Button-3>", self._editor_context_menu)
        self.editor.bind("<Tab>", self._handle_tab)

        # Scrollbar
        scrollbar = ctk.CTkScrollbar(self.editor_container, command=self._on_scroll)
        scrollbar.grid(row=0, column=2, sticky="ns")
        self.editor.config(yscrollcommand=scrollbar.set)
        self.line_numbers.config(yscrollcommand=scrollbar.set)

        # ── Mod Details Panel (bottom of content) ──────────────────────────────
        self.details_panel = ctk.CTkFrame(content, height=100, fg_color=COLORS["bg_panel"], corner_radius=6)
        self.details_panel.grid(row=2, column=0, sticky="ew", padx=3, pady=(0, 3))
        self.details_panel.grid_columnconfigure(0, weight=1)

        self.details_label = ctk.CTkLabel(self.details_panel, text="Выберите мод для просмотра информации", text_color=COLORS["text_muted"], font=ctk.CTkFont(size=11), justify="left", anchor="w")
        self.details_label.grid(row=0, column=0, sticky="w", padx=12, pady=8)

        # Right-click on details panel
        self.details_panel.bind("<Button-3>", self._details_context_menu)

    # ── Status Bar ─────────────────────────────────────────────────────────────
    def _build_statusbar(self):
        sbar = ctk.CTkFrame(self, height=24, fg_color=COLORS["toolbar_bg"], corner_radius=0)
        sbar.grid(row=2, column=0, columnspan=2, sticky="ew")
        sbar.grid_columnconfigure(1, weight=1)

        self.status_label = ctk.CTkLabel(sbar, text="Готово", font=ctk.CTkFont(size=9), text_color=COLORS["text_muted"])
        self.status_label.grid(row=0, column=0, sticky="w", padx=12)

        self.status_right = ctk.CTkLabel(sbar, text="", font=ctk.CTkFont(size=9), text_color=COLORS["text_dim"])
        self.status_right.grid(row=0, column=1, sticky="e", padx=12)

        # Right-click on status bar
        sbar.bind("<Button-3>", self._statusbar_context_menu)

    # ════════════════════════════════════════════════════════════════════════════
    # CONTEXT MENUS (Right-Click) — EVERYWHERE
    # ════════════════════════════════════════════════════════════════════════════
    def _destroy_ctx(self):
        if self._ctx_menu:
            try: self._ctx_menu.destroy()
            except: pass
            self._ctx_menu = None

    def _make_menu(self):
        """Create a consistently styled context menu."""
        return tk.Menu(self, tearoff=0, bg=COLORS["bg_card"], fg=COLORS["text_main"],
                       activebackground=COLORS["accent_blue"], activeforeground="#fff",
                       font=("Segoe UI", 10), relief="flat", bd=0)

    # ── Toolbar Context Menu ───────────────────────────────────────────────────
    def _toolbar_context_menu(self, event):
        self._destroy_ctx()
        menu = self._make_menu()
        menu.add_command(label="➕ Создать мод", command=self.create_mod)
        menu.add_command(label="📂 Открыть папку модов", command=self.open_mods_folder)
        menu.add_separator()
        menu.add_command(label="🔄 Обновить список", command=self.load_mods)
        menu.add_command(label="✅ Валидация текущего мода", command=self.validate_current_mod)
        menu.add_separator()
        menu.add_command(label="🤖 AI Ассистент", command=self.open_ai_panel)
        menu.add_command(label="⚙️ Настройки", command=self.open_settings)
        self._ctx_menu = menu
        menu.tk_popup(event.x_root, event.y_root)

    # ── Tab Bar Context Menu ───────────────────────────────────────────────────
    def _tabbar_context_menu(self, event):
        self._destroy_ctx()
        menu = self._make_menu()
        menu.add_command(label="📁 Панель файлов", command=lambda: self._switch_tab("files"))
        menu.add_command(label="📝 Только редактор", command=lambda: self._switch_tab("editor"))
        menu.add_separator()
        menu.add_command(label="📄 Создать файл", command=self.create_file)
        menu.add_command(label="📁 Создать папку", command=self.create_folder)
        menu.add_separator()
        menu.add_command(label="💾 Сохранить (Ctrl+S)", command=self.save_file)
        self._ctx_menu = menu
        menu.tk_popup(event.x_root, event.y_root)

    # ── Status Bar Context Menu ────────────────────────────────────────────────
    def _statusbar_context_menu(self, event):
        self._destroy_ctx()
        menu = self._make_menu()
        menu.add_command(label="🔄 Обновить список модов", command=self.load_mods)
        menu.add_command(label="📂 Открыть папку модов", command=self.open_mods_folder)
        menu.add_separator()
        menu.add_command(label="🤖 AI Ассистент", command=self.open_ai_panel)
        menu.add_command(label="⚙️ Настройки AI", command=self.open_settings)
        self._ctx_menu = menu
        menu.tk_popup(event.x_root, event.y_root)

    # ── Details Panel Context Menu ─────────────────────────────────────────────
    def _details_context_menu(self, event):
        self._destroy_ctx()
        if not self.current_mod_id:
            return
        menu = self._make_menu()
        menu.add_command(label="📋 Копировать информацию", command=self._copy_details)
        menu.add_command(label="📂 Открыть папку мода", command=lambda: self._open_mod_folder(self.current_mod_id))
        menu.add_separator()
        menu.add_command(label="✅ Валидация", command=self.validate_current_mod)
        menu.add_command(label="📦 Экспорт .zip", command=lambda: self._export_mod(self.current_mod_id))
        self._ctx_menu = menu
        menu.tk_popup(event.x_root, event.y_root)

    def _sidebar_context_menu(self, event):
        self._destroy_ctx()
        menu = self._make_menu()
        mod_id = self._get_mod_at_y(event.y_root)

        if mod_id:
            self.select_mod(mod_id)
            menu.add_command(label=f"📄 Открыть {mod_id}", command=lambda: self.select_mod(mod_id))
            menu.add_separator()
            menu.add_command(label="📋 Дублировать мод", command=lambda: self._duplicate_mod(mod_id))
            menu.add_command(label="📦 Экспорт .zip", command=lambda: self._export_mod(mod_id))
            menu.add_command(label="✅ Валидация", command=lambda: self._validate_mod_by_id(mod_id))
            menu.add_command(label="📂 Открыть папку", command=lambda: self._open_mod_folder(mod_id))
            menu.add_separator()
            menu.add_command(label="🤖 AI: Создать мод на основе этого", command=lambda: self._ai_create_from_mod(mod_id))
            menu.add_separator()
            if mod_id != "base_game":
                menu.add_command(label="🗑 Удалить мод", command=lambda: self._delete_mod(mod_id))
        else:
            menu.add_command(label="➕ Создать новый мод", command=self.create_mod)
            menu.add_command(label="🤖 AI: Создать мод с нуля...", command=self._ai_create_mod_dialog)
            menu.add_separator()
            menu.add_command(label="📂 Открыть папку модов", command=self.open_mods_folder)
            menu.add_command(label="🔄 Обновить список", command=self.load_mods)

        self._ctx_menu = menu
        menu.tk_popup(event.x_root, event.y_root)

    def _files_context_menu(self, event):
        self._destroy_ctx()
        if not self.current_mod_id:
            return

        menu = self._make_menu()
        file_path = self._get_file_at_y(event.y_root)

        if file_path:
            self.open_file(file_path[0], file_path[1])
            menu.add_command(label=f"📝 Открыть {file_path[1]}", command=lambda: self.open_file(file_path[0], file_path[1]))
            menu.add_separator()
            if file_path[1].endswith(".json"):
                menu.add_command(label="🔧 Форматировать JSON", command=self._format_json)
                menu.add_command(label="✅ Валидировать JSON", command=self._validate_json)
            if file_path[1].endswith(".js"):
                menu.add_command(label="🤖 AI: Проанализировать", command=lambda: self._ai_action("explain"))
                menu.add_command(label="🤖 AI: Дописать код", command=lambda: self._ai_action("continue"))
            menu.add_separator()
            menu.add_command(label="📋 Копировать путь", command=lambda: self._copy_path(file_path[0]))
            if file_path[1] != "mod.json":
                menu.add_command(label="🗑 Удалить файл", command=lambda: self._delete_file(file_path[0]))
        else:
            menu.add_command(label="📄 Создать файл", command=self.create_file)
            menu.add_command(label="📁 Создать папку", command=self.create_folder)
            menu.add_separator()
            menu.add_command(label="🤖 AI: Создать файл через AI", command=lambda: self._ai_create_file())
            menu.add_separator()
            menu.add_command(label="📋 Вставить из буфера", command=self._paste_from_clipboard)

        self._ctx_menu = menu
        menu.tk_popup(event.x_root, event.y_root)

    def _editor_context_menu(self, event):
        self._destroy_ctx()
        menu = self._make_menu()

        # Basic edit
        menu.add_command(label="↩ Отменить (Ctrl+Z)", command=lambda: self.editor.event_generate("<<Undo>>"))
        menu.add_command(label="↪ Повторить (Ctrl+Y)", command=lambda: self.editor.event_generate("<<Redo>>"))
        menu.add_separator()
        menu.add_command(label="✂ Вырезать (Ctrl+X)", command=lambda: self.editor.event_generate("<<Cut>>"))
        menu.add_command(label="📋 Копировать (Ctrl+C)", command=lambda: self.editor.event_generate("<<Copy>>"))
        menu.add_command(label="📄 Вставить (Ctrl+V)", command=lambda: self.editor.event_generate("<<Paste>>"))
        menu.add_command(label="🗑 Удалить", command=lambda: self.editor.delete("sel.first", "sel.last") if self.editor.tag_ranges("sel") else None)
        menu.add_separator()

        # Format
        if self.current_file_path and self.current_file_path.endswith(".json"):
            menu.add_command(label="🔧 Форматировать JSON", command=self._format_json)
            menu.add_command(label="✅ Валидировать JSON", command=self._validate_json)
            menu.add_separator()

        # AI actions (submenu)
        ai_menu = tk.Menu(menu, tearoff=0, bg=COLORS["bg_card"], fg=COLORS["text_main"],
                          activebackground=COLORS["accent_blue"], activeforeground="#fff",
                          font=("Segoe UI", 10), relief="flat", bd=0)
        ai_menu.add_command(label="Дописать код (Ctrl+G)", command=lambda: self._ai_action("continue"))
        ai_menu.add_command(label="Объяснить код", command=lambda: self._ai_action("explain"))
        ai_menu.add_command(label="Найти ошибки", command=lambda: self._ai_action("debug"))
        ai_menu.add_command(label="Оптимизировать", command=lambda: self._ai_action("optimize"))
        ai_menu.add_command(label="Добавить комментарии", command=lambda: self._ai_action("comment"))
        ai_menu.add_command(label="Переписать на русский стиль", command=lambda: self._ai_action("russian_style"))
        ai_menu.add_separator()
        ai_menu.add_command(label="Создать мод с нуля...", command=self._ai_create_mod_dialog)
        ai_menu.add_command(label="Открыть AI чат", command=self.open_ai_panel)
        menu.add_cascade(label="🤖 AI Ассистент", menu=ai_menu)

        menu.add_separator()
        menu.add_command(label="🔍 Найти и заменить (Ctrl+H)", command=self._find_replace)
        menu.add_command(label="💾 Сохранить (Ctrl+S)", command=self.save_file)

        self._ctx_menu = menu
        try:
            menu.tk_popup(event.x_root, event.y_root)
        except:
            pass

    # ── Helpers for context menus ──────────────────────────────────────────────
    def _get_mod_at_y(self, y_root):
        for child in self.mods_scroll.winfo_children():
            try:
                if child.winfo_rooty() <= y_root <= child.winfo_rooty() + child.winfo_height():
                    return child.cget("text") if hasattr(child, 'cget') else None
            except:
                continue
        return None

    def _get_file_at_y(self, y_root):
        for child in self.files_scroll.winfo_children():
            try:
                if child.winfo_rooty() <= y_root <= child.winfo_rooty() + child.winfo_height():
                    return getattr(child, '_file_info', None)
            except:
                continue
        return None

    # ════════════════════════════════════════════════════════════════════════════
    # KEYBOARD SHORTCUTS
    # ════════════════════════════════════════════════════════════════════════════
    def _bind_shortcuts(self):
        self.bind("<Control-s>", lambda e: self.save_file())
        self.bind("<Control-n>", lambda e: self.create_mod())
        self.bind("<Control-r>", lambda e: self.load_mods())
        self.bind("<Control-h>", lambda e: self._find_replace())
        self.bind("<Control-g>", lambda e: self._ai_action("continue"))
        self.bind("<Control-Shift-G>", lambda e: self._ai_action("explain"))
        self.bind("<Control-f>", lambda e: self._find_replace())
        self.bind("<Control-w>", lambda e: self._close_file())
        self.bind("<F5>", lambda e: self.validate_current_mod())
        self.bind("<Control-Shift-A>", lambda e: self.open_ai_panel())
        self.bind("<Control-Shift-N>", lambda e: self._ai_create_mod_dialog())

    # ════════════════════════════════════════════════════════════════════════════
    # MOD MANAGEMENT
    # ════════════════════════════════════════════════════════════════════════════
    def load_mods(self):
        for widget in self.mods_scroll.winfo_children():
            widget.destroy()

        if not os.path.exists(self.mods_dir):
            self.mod_count_label.configure(text="0")
            return

        self.all_mods = []
        for folder in sorted(os.listdir(self.mods_dir)):
            full_path = os.path.join(self.mods_dir, folder)
            if not os.path.isdir(full_path):
                continue

            mod_json_path = os.path.join(full_path, "mod.json")
            mod_info = {"id": folder, "folder": folder, "path": full_path, "error": None}

            if os.path.exists(mod_json_path):
                try:
                    with open(mod_json_path, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                    mod_info.update(meta)
                except Exception as e:
                    mod_info["error"] = f"Invalid mod.json: {e}"
                    mod_info["name"] = f"⚠ {folder}"

            self.all_mods.append(mod_info)

        self._render_mod_list()
        self.mod_count_label.configure(text=str(len(self.all_mods)))
        self._set_status(f"Загружено {len(self.all_mods)} модов")

    def _render_mod_list(self, filter_text=""):
        for widget in self.mods_scroll.winfo_children():
            widget.destroy()

        for mod in self.all_mods:
            name = mod.get("name", mod["id"])
            if filter_text and filter_text.lower() not in name.lower() and filter_text.lower() not in mod["id"].lower():
                continue

            is_core = mod["id"] == "base_game"
            has_error = mod.get("error") is not None
            is_selected = mod["id"] == self.current_mod_id

            border_color = COLORS["accent_red"] if has_error else (COLORS["accent_gold"] if is_core else COLORS["border"])
            fg_color = COLORS["bg_selected"] if is_selected else COLORS["bg_card"]

            # Mod type indicators
            has_scripts = bool(mod.get("scripts"))
            has_data = bool(mod.get("data"))
            type_icons = ""
            if has_scripts: type_icons += "📜"
            if has_data: type_icons += "📊"

            display_text = f"{name} {type_icons}" if type_icons else name

            btn = ctk.CTkButton(
                self.mods_scroll,
                text=display_text,
                fg_color=fg_color,
                hover_color=COLORS["bg_hover"],
                text_color=COLORS["text_main"] if not has_error else COLORS["accent_red"],
                border_width=1,
                border_color=border_color,
                corner_radius=4,
                anchor="w",
                height=32,
                font=ctk.CTkFont(size=11),
                command=lambda mid=mod["id"]: self.select_mod(mid)
            )
            btn.pack(fill="x", pady=1, padx=2)
            btn.bind("<Button-3>", lambda e, mid=mod["id"]: self._sidebar_context_menu_item(e, mid))

            version = mod.get("version", "")
            if version:
                ver_label = ctk.CTkLabel(btn, text=f"v{version}", font=ctk.CTkFont(size=8), text_color=COLORS["text_dim"], fg_color="transparent")
                ver_label.place(relx=0.88, rely=0.5, anchor="e")

    def _filter_mods(self):
        self._render_mod_list(self.search_var.get())

    def _sidebar_context_menu_item(self, event, mod_id):
        self._destroy_ctx()
        self.select_mod(mod_id)
        menu = self._make_menu()

        menu.add_command(label=f"📄 Открыть {mod_id}", command=lambda: self.select_mod(mod_id))
        menu.add_command(label="📂 Открыть папку", command=lambda: self._open_mod_folder(mod_id))
        menu.add_separator()
        menu.add_command(label="📋 Дублировать мод", command=lambda: self._duplicate_mod(mod_id))
        menu.add_command(label="📦 Экспорт .zip", command=lambda: self._export_mod(mod_id))
        menu.add_command(label="✅ Валидация", command=lambda: self._validate_mod_by_id(mod_id))
        menu.add_separator()
        menu.add_command(label="🤖 AI: Создать мод на основе этого", command=lambda: self._ai_create_from_mod(mod_id))
        menu.add_separator()
        if mod_id != "base_game":
            menu.add_command(label="🗑 Удалить мод", command=lambda: self._delete_mod(mod_id))

        self._ctx_menu = menu
        menu.tk_popup(event.x_root, event.y_root)

    def select_mod(self, mod_id):
        self.current_mod_id = mod_id
        self.current_file_path = None
        self.file_path_label.configure(text="")
        self.editor.delete("1.0", "end")
        self._render_mod_list(self.search_var.get())
        self.load_files()
        self._update_details()

    def _update_details(self):
        if not self.current_mod_id:
            self.details_label.configure(text="Выберите мод для просмотра информации")
            return

        mod = next((m for m in self.all_mods if m["id"] == self.current_mod_id), None)
        if not mod:
            return

        parts = []
        if mod.get("name"): parts.append(f"📌 {mod['name']}")
        if mod.get("version"): parts.append(f"v{mod['version']}")
        if mod.get("author"): parts.append(f"👤 {mod['author']}")
        if mod.get("description"): parts.append(f"📖 {mod['description'][:100]}")
        deps = mod.get("dependencies", [])
        if deps: parts.append(f"🔗 {', '.join(deps)}")
        scripts = mod.get("scripts", [])
        if scripts: parts.append(f"📜 {', '.join(scripts)}")
        data_keys = list(mod.get("data", {}).keys())
        if data_keys: parts.append(f"📊 {', '.join(data_keys)}")
        if mod.get("error"): parts.append(f"⚠️ ОШИБКА: {mod['error']}")

        self.details_label.configure(text="  |  ".join(parts))

    def _copy_details(self):
        if self.current_mod_id:
            mod = next((m for m in self.all_mods if m["id"] == self.current_mod_id), None)
            if mod:
                self.clipboard_clear()
                self.clipboard_append(json.dumps(mod, indent=2, ensure_ascii=False))
                self._set_status("Информация о моде скопирована")

    # ── File Operations ────────────────────────────────────────────────────────
    def load_files(self):
        for widget in self.files_scroll.winfo_children():
            widget.destroy()

        if not self.current_mod_id:
            return

        mod_path = os.path.join(self.mods_dir, self.current_mod_id)
        all_files = []
        for root, dirs, files in os.walk(mod_path):
            for file in files:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, mod_path).replace("\\", "/")
                all_files.append((full_path, rel_path))

        for full_path, rel_path in sorted(all_files, key=lambda x: x[1]):
            ext = os.path.splitext(rel_path)[1].lower()
            icon = {"": "📁", ".json": "📋", ".js": "📜", ".py": "🐍", ".txt": "📄", ".md": "📝"}.get(ext, "📄")

            btn = ctk.CTkButton(
                self.files_scroll,
                text=f"{icon} {rel_path}",
                fg_color="transparent",
                hover_color=COLORS["bg_hover"],
                text_color=COLORS["text_muted"],
                anchor="w",
                height=26,
                corner_radius=3,
                font=ctk.CTkFont(family="Consolas", size=10),
                command=lambda p=full_path, r=rel_path: self.open_file(p, r)
            )
            btn.pack(fill="x", pady=1)
            btn._file_info = (full_path, rel_path)
            btn.bind("<Button-3>", lambda e, fp=(full_path, rel_path): self._file_item_context_menu(e, fp))

    def _file_item_context_menu(self, event, file_info):
        self._destroy_ctx()
        full_path, rel_path = file_info
        self.open_file(full_path, rel_path)

        menu = self._make_menu()
        menu.add_command(label=f"📝 Открыть {rel_path}", command=lambda: self.open_file(full_path, rel_path))
        menu.add_separator()
        if rel_path.endswith(".json"):
            menu.add_command(label="🔧 Форматировать JSON", command=self._format_json)
            menu.add_command(label="✅ Валидировать", command=self._validate_json)
        if rel_path.endswith(".js"):
            menu.add_command(label="🤖 AI: Проанализировать", command=lambda: self._ai_action("explain"))
            menu.add_command(label="🤖 AI: Дописать", command=lambda: self._ai_action("continue"))
        menu.add_separator()
        menu.add_command(label="📋 Копировать путь", command=lambda: self._copy_path(full_path))
        if rel_path != "mod.json":
            menu.add_command(label="🗑 Удалить файл", command=lambda: self._delete_file(full_path))

        self._ctx_menu = menu
        menu.tk_popup(event.x_root, event.y_root)

    def open_file(self, full_path, rel_path):
        self.current_file_path = full_path
        self.file_path_label.configure(text=f"[{self.current_mod_id}] {rel_path}")
        self.editor.delete("1.0", "end")
        self.modified = False
        try:
            with open(full_path, 'r', encoding='utf-8') as f:
                content = f.read()
            self.editor.insert("1.0", content)

            if full_path.endswith(".json"):
                try:
                    parsed = json.loads(content)
                    formatted = json.dumps(parsed, indent=2, ensure_ascii=False)
                    self.editor.delete("1.0", "end")
                    self.editor.insert("1.0", formatted)
                except:
                    pass
        except Exception as e:
            self.editor.insert("1.0", f"// Ошибка чтения файла:\n// {e}")

        self._update_line_numbers()
        self._update_status_right()

    def save_file(self):
        if not self.current_file_path:
            self._set_status("⚠ Нет файла для сохранения")
            return

        content = self.editor.get("1.0", "end-1c")
        try:
            if self.current_file_path.endswith(".json"):
                try:
                    json.loads(content)
                except json.JSONDecodeError as e:
                    if not messagebox.askyesno("JSON невалиден", f"Файл содержит ошибки JSON:\n{e}\n\nСохранить всё равно?"):
                        return

            with open(self.current_file_path, 'w', encoding='utf-8') as f:
                f.write(content)

            self.modified = False
            self.btn_save.configure(text="✅ Сохранено!", fg_color="#2ecc71")
            self.after(1500, lambda: self.btn_save.configure(text="💾 Сохранить", fg_color=COLORS["success"]))
            self._set_status(f"Сохранено: {os.path.basename(self.current_file_path)}")
        except Exception as e:
            messagebox.showerror("Ошибка сохранения", str(e))

    # ── Create / Delete ────────────────────────────────────────────────────────
    def create_mod(self):
        dialog = ctk.CTkInputDialog(text="Введите ID мода (англ. буквы, цифры, _):", title="Создание мода")
        mod_id = dialog.get_input()
        if not mod_id:
            return

        mod_id = mod_id.strip().lower().replace(" ", "_")
        if not re.match(r'^[a-z][a-z0-9_]*$', mod_id):
            messagebox.showerror("Ошибка", "ID мода: только строчные латинские буквы, цифры и _, начиная с буквы")
            return

        mod_path = os.path.join(self.mods_dir, mod_id)
        if os.path.exists(mod_path):
            messagebox.showerror("Ошибка", f"Мод '{mod_id}' уже существует!")
            return

        os.makedirs(mod_path)
        os.makedirs(os.path.join(mod_path, "data"), exist_ok=True)

        template_path = os.path.join(os.getcwd(), "data", "mod_template.json")
        template = {
            "mod_json": {
                "id": "__MOD_ID__", "name": "__MOD_NAME__", "version": "1.0.0",
                "author": "Unknown", "description": "Описание мода...",
                "dependencies": ["base_game"], "scripts": ["data/main.js"], "data": {}
            },
            "files": {
                "data/main.js": "// Инициализация мода\nModAPI.on('onModsInitialized', async () => {\n    console.log('Мод __MOD_ID__ загружен!');\n    ModAPI.notify('Мод __MOD_ID__ активирован!', 'info');\n});\n"
            }
        }

        if os.path.exists(template_path):
            try:
                with open(template_path, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                template.update(loaded)
            except:
                pass

        replacements = {"__MOD_ID__": mod_id, "__MOD_NAME__": mod_id.replace("_", " ").title()}

        def render_val(v):
            if isinstance(v, str):
                for k, r in replacements.items():
                    v = v.replace(k, r)
                return v
            if isinstance(v, list):
                return [render_val(i) for i in v]
            if isinstance(v, dict):
                return {k2: render_val(i) for k2, i in v.items()}
            return v

        meta = render_val(template.get("mod_json", {}))
        with open(os.path.join(mod_path, "mod.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=4, ensure_ascii=False)

        for rel_file_path, raw_content in template.get("files", {}).items():
            safe_rel = rel_file_path.replace("\\", "/").lstrip("/")
            full_file_path = os.path.realpath(os.path.join(mod_path, safe_rel))
            if not full_file_path.startswith(os.path.realpath(mod_path)):
                continue
            os.makedirs(os.path.dirname(full_file_path), exist_ok=True)
            with open(full_file_path, "w", encoding="utf-8") as f:
                f.write(render_val(raw_content))

        self.load_mods()
        self.select_mod(mod_id)
        self._set_status(f"Мод '{mod_id}' создан!")

    def create_file(self):
        if not self.current_mod_id:
            messagebox.showwarning("Внимание", "Сначала выберите мод!")
            return

        dialog = ctk.CTkInputDialog(text="Путь файла (напр. data/items.json или scripts/combat.js):", title="Новый файл")
        rel_path = dialog.get_input()
        if not rel_path:
            return

        if not re.match(r'^[a-zA-Z0-9_./-]+$', rel_path):
            messagebox.showerror("Ошибка", "Недопустимые символы в имени файла")
            return
        if rel_path.startswith('/') or rel_path.startswith('..') or ':\\' in rel_path:
            messagebox.showerror("Ошибка", "Абсолютные пути запрещены")
            return

        mod_path = os.path.join(self.mods_dir, self.current_mod_id)
        full_path = os.path.realpath(os.path.join(mod_path, rel_path))
        if not full_path.startswith(os.path.realpath(mod_path)):
            messagebox.showerror("Ошибка", "Выход за пределы мода запрещён")
            return

        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        if not os.path.exists(full_path):
            with open(full_path, 'w', encoding='utf-8') as f:
                if full_path.endswith('.json'):
                    f.write("{\n    \n}")
                elif full_path.endswith('.js'):
                    f.write(f"// {os.path.basename(full_path)} — скрипт мода {self.current_mod_id}\n\n")
                else:
                    f.write("")

        self.load_files()
        self.open_file(full_path, rel_path)
        self._set_status(f"Файл создан: {rel_path}")

    def create_folder(self):
        if not self.current_mod_id:
            messagebox.showwarning("Внимание", "Сначала выберите мод!")
            return

        dialog = ctk.CTkInputDialog(text="Имя папки (напр. data или scripts):", title="Новая папка")
        folder_name = dialog.get_input()
        if not folder_name:
            return

        if not re.match(r'^[a-zA-Z0-9_./-]+$', folder_name):
            messagebox.showerror("Ошибка", "Недопустимые символы")
            return

        mod_path = os.path.join(self.mods_dir, self.current_mod_id)
        full_path = os.path.realpath(os.path.join(mod_path, folder_name))
        if not full_path.startswith(os.path.realpath(mod_path)):
            return

        os.makedirs(full_path, exist_ok=True)
        self.load_files()
        self._set_status(f"Папка создана: {folder_name}")

    def _delete_mod(self, mod_id):
        if mod_id == "base_game":
            messagebox.showerror("Ошибка", "Нельзя удалить базовый мод!")
            return
        if not messagebox.askyesno("Удаление мода", f"Удалить мод '{mod_id}' и ВСЕ его файлы?\nЭто действие необратимо!"):
            return
        import shutil
        mod_path = os.path.join(self.mods_dir, mod_id)
        try:
            shutil.rmtree(mod_path)
            if self.current_mod_id == mod_id:
                self.current_mod_id = None
                self.editor.delete("1.0", "end")
                self.file_path_label.configure(text="")
            self.load_mods()
            self._set_status(f"Мод '{mod_id}' удалён")
        except Exception as e:
            messagebox.showerror("Ошибка", str(e))

    def _delete_file(self, full_path):
        if os.path.basename(full_path) == "mod.json":
            messagebox.showerror("Ошибка", "Нельзя удалить mod.json!")
            return
        if not messagebox.askyesno("Удаление файла", f"Удалить {os.path.basename(full_path)}?"):
            return
        try:
            os.remove(full_path)
            if self.current_file_path == full_path:
                self.current_file_path = None
                self.editor.delete("1.0", "end")
                self.file_path_label.configure(text="")
            self.load_files()
            self._set_status(f"Файл удалён")
        except Exception as e:
            messagebox.showerror("Ошибка", str(e))

    def _duplicate_mod(self, mod_id):
        dialog = ctk.CTkInputDialog(text=f"ID для копии мода '{mod_id}':", title="Дублирование мода")
        new_id = dialog.get_input()
        if not new_id:
            return
        new_id = new_id.strip().lower().replace(" ", "_")
        if not re.match(r'^[a-z][a-z0-9_]*$', new_id):
            messagebox.showerror("Ошибка", "Некорректный ID")
            return

        import shutil
        src = os.path.join(self.mods_dir, mod_id)
        dst = os.path.join(self.mods_dir, new_id)
        if os.path.exists(dst):
            messagebox.showerror("Ошибка", "Мод с таким ID уже существует")
            return

        shutil.copytree(src, dst)

        mod_json_path = os.path.join(dst, "mod.json")
        if os.path.exists(mod_json_path):
            try:
                with open(mod_json_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                meta["id"] = new_id
                meta["name"] = new_id.replace("_", " ").title()
                with open(mod_json_path, "w", encoding="utf-8") as f:
                    json.dump(meta, f, indent=4, ensure_ascii=False)
            except:
                pass

        self.load_mods()
        self.select_mod(new_id)
        self._set_status(f"Мод '{mod_id}' дублирован как '{new_id}'")

    def _export_mod(self, mod_id):
        import zipfile
        mod_path = os.path.join(self.mods_dir, mod_id)
        if not os.path.isdir(mod_path):
            return

        zip_path = filedialog.asksaveasfilename(
            defaultextension=".zip",
            filetypes=[("ZIP архив", "*.zip")],
            initialfile=f"{mod_id}_v1.0.zip"
        )
        if not zip_path:
            return

        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(mod_path):
                for file in files:
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, mod_path)
                    zf.write(file_path, arcname)

        self._set_status(f"Мод экспортирован: {zip_path}")
        messagebox.showinfo("Экспорт", f"Мод '{mod_id}' сохранён как:\n{zip_path}")

    def _open_mod_folder(self, mod_id):
        mod_path = os.path.join(self.mods_dir, mod_id)
        if not os.path.exists(mod_path):
            return
        if platform.system() == "Windows":
            os.startfile(mod_path)
        elif platform.system() == "Darwin":
            subprocess.Popen(["open", mod_path])
        else:
            subprocess.Popen(["xdg-open", mod_path])

    def open_mods_folder(self):
        if not os.path.exists(self.mods_dir):
            os.makedirs(self.mods_dir, exist_ok=True)
        if platform.system() == "Windows":
            os.startfile(self.mods_dir)
        elif platform.system() == "Darwin":
            subprocess.Popen(["open", self.mods_dir])
        else:
            subprocess.Popen(["xdg-open", self.mods_dir])

    # ════════════════════════════════════════════════════════════════════════════
    # EDITOR HELPERS
    # ════════════════════════════════════════════════════════════════════════════
    def _on_editor_change(self, event=None):
        self._update_line_numbers()
        self._update_status_right()
        if not self.modified:
            self.modified = True
            self.btn_save.configure(text="💾 Сохранить *", fg_color=COLORS["warning"])

    def _update_line_numbers(self):
        self.line_numbers.config(state="normal")
        self.line_numbers.delete("1.0", "end")
        line_count = self.editor.get("1.0", "end-1c").count("\n") + 1
        line_numbers_text = "\n".join(str(i) for i in range(1, line_count + 1))
        self.line_numbers.insert("1.0", line_numbers_text)
        self.line_numbers.config(state="disabled")

    def _update_status_right(self):
        content = self.editor.get("1.0", "end-1c")
        lines = content.count("\n") + 1
        chars = len(content)
        lang = "JSON" if (self.current_file_path and self.current_file_path.endswith(".json")) else ("JS" if (self.current_file_path and self.current_file_path.endswith(".js")) else "")
        self.status_right.configure(text=f"{lang} | Строк: {lines} | Символов: {chars}")

    def _on_scroll(self, *args):
        self.editor.yview(*args)
        self.line_numbers.yview(*args)

    def _handle_tab(self, event):
        self.editor.insert("insert", "    ")
        return "break"

    def _format_json(self):
        if not self.current_file_path:
            return
        content = self.editor.get("1.0", "end-1c")
        try:
            parsed = json.loads(content)
            formatted = json.dumps(parsed, indent=2, ensure_ascii=False)
            self.editor.delete("1.0", "end")
            self.editor.insert("1.0", formatted)
            self._set_status("JSON отформатирован")
        except json.JSONDecodeError as e:
            messagebox.showerror("JSON Error", f"Невозможно отформатировать:\n{e}")

    def _validate_json(self):
        content = self.editor.get("1.0", "end-1c")
        try:
            json.loads(content)
            self._set_status("✅ JSON валиден")
            messagebox.showinfo("Валидация", "JSON валиден!")
        except json.JSONDecodeError as e:
            messagebox.showerror("JSON Error", f"Ошибка в JSON:\n{e}")

    def _close_file(self):
        if self.modified:
            if messagebox.askyesno("Несохранённые изменения", "Сохранить перед закрытием?"):
                self.save_file()
        self.current_file_path = None
        self.file_path_label.configure(text="")
        self.editor.delete("1.0", "end")
        self.modified = False

    def _copy_path(self, path):
        self.clipboard_clear()
        self.clipboard_append(path)
        self._set_status("Путь скопирован")

    def _paste_from_clipboard(self):
        if not self.current_mod_id:
            return
        try:
            content = self.clipboard_get()
        except:
            messagebox.showinfo("Буфер", "Буфер обмена пуст")
            return

        dialog = ctk.CTkInputDialog(text="Имя файла для вставки:", title="Вставить из буфера")
        name = dialog.get_input()
        if not name:
            return

        mod_path = os.path.join(self.mods_dir, self.current_mod_id)
        full_path = os.path.join(mod_path, name)
        os.makedirs(os.path.dirname(full_path) if os.path.dirname(full_path) else mod_path, exist_ok=True)
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(content)
        self.load_files()
        self.open_file(full_path, name)

    def _find_replace(self):
        dialog = ctk.CTkToplevel(self)
        dialog.title("Найти и заменить")
        dialog.geometry("420x180")
        dialog.transient(self)
        dialog.grab_set()
        dialog.configure(fg_color=COLORS["bg_dark"])

        ctk.CTkLabel(dialog, text="Найти:").grid(row=0, column=0, padx=10, pady=5, sticky="w")
        find_entry = ctk.CTkEntry(dialog, width=300, fg_color=COLORS["bg_input"])
        find_entry.grid(row=0, column=1, padx=10, pady=5)

        ctk.CTkLabel(dialog, text="Заменить:").grid(row=1, column=0, padx=10, pady=5, sticky="w")
        replace_entry = ctk.CTkEntry(dialog, width=300, fg_color=COLORS["bg_input"])
        replace_entry.grid(row=1, column=1, padx=10, pady=5)

        def do_find():
            self.editor.tag_remove("found", "1.0", "end")
            query = find_entry.get()
            if not query:
                return
            count = 0
            start = "1.0"
            while True:
                pos = self.editor.search(query, start, stopindex="end", nocase=True)
                if not pos:
                    break
                end = f"{pos}+{len(query)}c"
                self.editor.tag_add("found", pos, end)
                start = end
                count += 1
            self.editor.tag_config("found", background=COLORS["accent_gold"], foreground=COLORS["bg_dark"])
            self._set_status(f"Найдено: {count}")

        def do_replace():
            content = self.editor.get("1.0", "end-1c")
            new_content = content.replace(find_entry.get(), replace_entry.get())
            self.editor.delete("1.0", "end")
            self.editor.insert("1.0", new_content)
            self._set_status("Замена выполнена")

        btn_frame = ctk.CTkFrame(dialog, fg_color="transparent")
        btn_frame.grid(row=2, column=0, columnspan=2, pady=10)
        ctk.CTkButton(btn_frame, text="Найти", command=do_find, width=120, height=30).pack(side="left", padx=5)
        ctk.CTkButton(btn_frame, text="Заменить все", command=do_replace, width=120, height=30).pack(side="left", padx=5)

    # ════════════════════════════════════════════════════════════════════════════
    # VALIDATION
    # ════════════════════════════════════════════════════════════════════════════
    def validate_current_mod(self):
        if self.current_mod_id:
            self._validate_mod_by_id(self.current_mod_id)
        else:
            messagebox.showwarning("Валидация", "Сначала выберите мод!")

    def _validate_mod_by_id(self, mod_id):
        mod_path = os.path.join(self.mods_dir, mod_id)
        mod_json_path = os.path.join(mod_path, "mod.json")
        errors = []
        warnings = []

        if not os.path.exists(mod_json_path):
            errors.append("mod.json не найден!")
            self._show_validation_result(errors, warnings)
            return

        try:
            with open(mod_json_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        except json.JSONDecodeError as e:
            errors.append(f"mod.json: невалидный JSON — {e}")
            self._show_validation_result(errors, warnings)
            return

        for field in ["id", "name", "version", "author", "description"]:
            if field not in meta or not meta[field]:
                errors.append(f"mod.json: отсутствует обязательное поле '{field}'")

        if meta.get("id") != mod_id:
            warnings.append(f"mod.json id='{meta.get('id')}' не совпадает с именем папки '{mod_id}'")

        deps = meta.get("dependencies", [])
        for dep in deps:
            if dep == "base_game":
                continue
            dep_path = os.path.join(self.mods_dir, dep)
            if not os.path.exists(dep_path):
                errors.append(f"Зависимость '{dep}' не найдена в папке модов")

        for script in meta.get("scripts", []):
            script_path = os.path.join(mod_path, script)
            if not os.path.exists(script_path):
                errors.append(f"Скрипт '{script}' не найден")
            else:
                with open(script_path, "r", encoding="utf-8") as f:
                    code = f.read()
                banned = ["eval(", "Function(", "import(", "require(", "process.", "__proto__", "child_process", "fetch("]
                for pattern in banned:
                    if pattern in code:
                        errors.append(f"Скрипт '{script}': запрещённый паттерн '{pattern}' (заблокировано песочницей)")

        for key, data_file in meta.get("data", {}).items():
            data_path = os.path.join(mod_path, data_file) if isinstance(data_file, str) else None
            if data_path and not os.path.exists(data_path):
                warnings.append(f"Data файл '{data_file}' (ключ '{key}') не найден")

        self._show_validation_result(errors, warnings)

    def _show_validation_result(self, errors, warnings):
        if not errors and not warnings:
            messagebox.showinfo("Валидация", "✅ Мод прошёл валидацию!\nОшибок и предупреждений не найдено.")
            self._set_status("✅ Валидация пройдена")
        else:
            msg = ""
            if errors:
                msg += "❌ ОШИБКИ:\n" + "\n".join(f"  • {e}" for e in errors) + "\n\n"
            if warnings:
                msg += "⚠️ ПРЕДУПРЕЖДЕНИЯ:\n" + "\n".join(f"  • {w}" for w in warnings)
            messagebox.showwarning("Валидация", msg)
            self._set_status(f"Валидация: {len(errors)} ошибок, {len(warnings)} предупреждений")

    # ════════════════════════════════════════════════════════════════════════════
    # TAB SWITCHING
    # ════════════════════════════════════════════════════════════════════════════
    def _switch_tab(self, tab):
        if tab == "files":
            self.files_panel.grid()
            self.tab_files.configure(fg_color=COLORS["tab_active"], text_color=COLORS["accent_blue"])
            self.tab_editor.configure(fg_color=COLORS["tab_inactive"], text_color=COLORS["text_muted"])
        elif tab == "editor":
            self.files_panel.grid_remove()
            self.tab_files.configure(fg_color=COLORS["tab_inactive"], text_color=COLORS["text_muted"])
            self.tab_editor.configure(fg_color=COLORS["tab_active"], text_color=COLORS["accent_blue"])

    # ════════════════════════════════════════════════════════════════════════════
    # AI MODDER ASSISTANT — FULL REDESIGN
    # ════════════════════════════════════════════════════════════════════════════
    def open_ai_panel(self):
        """Open AI Assistant panel as a side window with all providers."""
        if self._ai_window and self._ai_window.winfo_exists():
            self._ai_window.focus()
            return

        ai_win = ctk.CTkToplevel(self)
        ai_win.title("🤖 AI Ассистент моддинга — Meterea ModKit")
        ai_win.geometry("650x800")
        ai_win.transient(self)
        ai_win.configure(fg_color=COLORS["bg_dark"])
        self._ai_window = ai_win

        # ── Provider Settings (collapsible) ────────────────────────────────────
        settings_frame = ctk.CTkFrame(ai_win, fg_color=COLORS["bg_panel"], corner_radius=6)
        settings_frame.pack(fill="x", padx=8, pady=(8, 4))

        # Settings header with toggle
        settings_hdr = ctk.CTkFrame(settings_frame, fg_color="transparent")
        settings_hdr.pack(fill="x", padx=12, pady=(8, 4))
        settings_hdr.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(settings_hdr, text="🤖 Настройки AI", font=ctk.CTkFont(size=13, weight="bold"), text_color=COLORS["accent_purple"]).grid(row=0, column=0, sticky="w")

        # Connection status indicator
        self._ai_status_indicator = ctk.CTkLabel(settings_hdr, text="🔴 Не подключён", font=ctk.CTkFont(size=9), text_color=COLORS["accent_red"])
        self._ai_status_indicator.grid(row=0, column=1, sticky="e")

        # Settings content
        settings_content = ctk.CTkFrame(settings_frame, fg_color="transparent")
        settings_content.pack(fill="x", padx=12, pady=(0, 8))

        # Provider
        prov_frame = ctk.CTkFrame(settings_content, fg_color="transparent")
        prov_frame.pack(fill="x", pady=3)
        ctk.CTkLabel(prov_frame, text="Провайдер:", width=100, font=ctk.CTkFont(size=10)).pack(side="left")
        current_provider_id = self._current_provider_id()
        provider_var = ctk.StringVar(value=self._provider_label(current_provider_id))
        provider_menu = ctk.CTkOptionMenu(
            prov_frame,
            variable=provider_var,
            values=self._provider_option_values(),
            command=lambda v: self._on_provider_change(self._provider_id_from_value(v), model_menu, api_key_entry, base_url_entry, thinking_frame, thinking_var),
            font=ctk.CTkFont(size=10),
            height=28,
        )
        provider_menu.pack(side="left", padx=5, fill="x", expand=True)

        # Model
        model_frame = ctk.CTkFrame(settings_content, fg_color="transparent")
        model_frame.pack(fill="x", pady=3)
        ctk.CTkLabel(model_frame, text="Модель:", width=100, font=ctk.CTkFont(size=10)).pack(side="left")
        current_provider = current_provider_id
        models = AI_PROVIDERS.get(current_provider, {}).get("models", [])
        model_var = ctk.StringVar(value=self.ai_settings.get("model", models[0] if models else ""))
        model_menu = ctk.CTkOptionMenu(model_frame, variable=model_var, values=models if models else ["custom"], font=ctk.CTkFont(size=10), height=28)
        model_menu.pack(side="left", padx=5, fill="x", expand=True)

        # API Key
        key_frame = ctk.CTkFrame(settings_content, fg_color="transparent")
        key_frame.pack(fill="x", pady=3)
        ctk.CTkLabel(key_frame, text="API ключ:", width=100, font=ctk.CTkFont(size=10)).pack(side="left")
        api_key_entry = ctk.CTkEntry(key_frame, show="*", placeholder_text="sk-... или api_key", font=ctk.CTkFont(size=10), height=28, fg_color=COLORS["bg_input"])
        api_key_entry.pack(side="left", padx=5, fill="x", expand=True)
        api_key_entry.insert(0, self.ai_settings.get("api_key", ""))

        show_key_var = ctk.BooleanVar(value=False)
        def toggle_key():
            api_key_entry.configure(show="" if show_key_var.get() else "*")
        ctk.CTkCheckBox(key_frame, text="👁", variable=show_key_var, command=toggle_key, width=30, font=ctk.CTkFont(size=9)).pack(side="left", padx=3)

        # Base URL
        url_frame = ctk.CTkFrame(settings_content, fg_color="transparent")
        url_frame.pack(fill="x", pady=3)
        ctk.CTkLabel(url_frame, text="Base URL:", width=100, font=ctk.CTkFont(size=10)).pack(side="left")
        base_url_entry = ctk.CTkEntry(url_frame, placeholder_text="https://api.example.com/v1/chat/completions", font=ctk.CTkFont(size=10), height=28, fg_color=COLORS["bg_input"])
        base_url_entry.pack(side="left", padx=5, fill="x", expand=True)
        default_url = AI_PROVIDERS.get(current_provider, {}).get("base_url", "")
        if self.ai_settings.get("base_url"):
            base_url_entry.insert(0, self.ai_settings["base_url"])
        elif default_url and current_provider != "custom":
            base_url_entry.insert(0, default_url)

        # Temperature / Max tokens / Thinking budget
        param_frame = ctk.CTkFrame(settings_content, fg_color="transparent")
        param_frame.pack(fill="x", pady=3)

        ctk.CTkLabel(param_frame, text="Температура:", font=ctk.CTkFont(size=10)).pack(side="left")
        temp_var = ctk.StringVar(value=str(self.ai_settings.get("temperature", 0.7)))
        ctk.CTkEntry(param_frame, textvariable=temp_var, width=50, font=ctk.CTkFont(size=10), height=28).pack(side="left", padx=3)

        ctk.CTkLabel(param_frame, text="Max токенов:", font=ctk.CTkFont(size=10)).pack(side="left", padx=(10, 0))
        max_tokens_var = ctk.StringVar(value=str(self.ai_settings.get("max_tokens", 8192)))
        ctk.CTkEntry(param_frame, textvariable=max_tokens_var, width=70, font=ctk.CTkFont(size=10), height=28).pack(side="left", padx=3)

        # Thinking budget (for DeepSeek/Anthropic)
        thinking_frame = ctk.CTkFrame(settings_content, fg_color="transparent")
        thinking_frame.pack(fill="x", pady=3)
        thinking_var = ctk.BooleanVar(value=self.ai_settings.get("use_thinking", False))
        ctk.CTkCheckBox(thinking_frame, text="Thinking mode", variable=thinking_var, font=ctk.CTkFont(size=10)).pack(side="left")
        ctk.CTkLabel(thinking_frame, text="Budget:", font=ctk.CTkFont(size=10)).pack(side="left", padx=(10, 0))
        thinking_budget_var = ctk.StringVar(value=str(self.ai_settings.get("thinking_budget", 2048)))
        ctk.CTkEntry(thinking_frame, textvariable=thinking_budget_var, width=60, font=ctk.CTkFont(size=10), height=28).pack(side="left", padx=3)

        # Show/hide thinking based on provider
        prov_cfg = AI_PROVIDERS.get(current_provider, {})
        if not prov_cfg.get("supports_thinking", False):
            thinking_frame.pack_forget()

        # Save settings button
        def save_ai_settings():
            self.ai_settings = {
                "provider": self._provider_id_from_value(provider_var.get()),
                "model": model_var.get(),
                "api_key": api_key_entry.get(),
                "base_url": base_url_entry.get(),
                "temperature": float(temp_var.get() or 0.7),
                "max_tokens": int(max_tokens_var.get() or 8192),
                "thinking_budget": int(thinking_budget_var.get() or 2048),
                "use_thinking": thinking_var.get(),
                "use_prompt_caching": False,
                "gemini_keys": self._gemini_keys,
            }
            self._save_ai_settings()
            self._ai_status_indicator.configure(text="🟡 Настроен", text_color=COLORS["warning"])
            self._set_status("AI настройки сохранены")

        ctk.CTkButton(settings_content, text="💾 Сохранить настройки", fg_color=COLORS["success"], hover_color=COLORS["accent_green"], command=save_ai_settings, height=28, font=ctk.CTkFont(size=10)).pack(pady=(4, 0))

        # ── Chat Area ──────────────────────────────────────────────────────────
        chat_frame = ctk.CTkFrame(ai_win, fg_color=COLORS["bg_panel"], corner_radius=6)
        chat_frame.pack(fill="both", expand=True, padx=8, pady=4)
        chat_frame.grid_rowconfigure(0, weight=1)
        chat_frame.grid_columnconfigure(0, weight=1)

        self.ai_chat = ctk.CTkTextbox(chat_frame, fg_color="transparent", font=ctk.CTkFont(family="Consolas", size=11), wrap="word")
        self.ai_chat.grid(row=0, column=0, sticky="nswe", padx=5, pady=5)

        # Input area
        input_frame = ctk.CTkFrame(chat_frame, fg_color="transparent")
        input_frame.grid(row=1, column=0, sticky="ew", padx=5, pady=5)
        input_frame.grid_columnconfigure(0, weight=1)

        self.ai_input = ctk.CTkEntry(input_frame, placeholder_text="Опишите, что вы хотите создать или изменить...", height=32, fg_color=COLORS["bg_input"], font=ctk.CTkFont(size=11))
        self.ai_input.grid(row=0, column=0, sticky="ew", padx=(0, 5))

        def send_ai():
            self._ai_send_message(self.ai_input.get(), model_var, api_key_entry, base_url_entry, temp_var, max_tokens_var, thinking_var, thinking_budget_var, provider_var=provider_var)
            self.ai_input.delete(0, "end")

        def run_agent():
            prompt = self.ai_input.get()
            self.ai_input.delete(0, "end")
            self._run_agent_turn(prompt, model_var, api_key_entry, base_url_entry, temp_var, max_tokens_var, thinking_var, thinking_budget_var, provider_var=provider_var)

        self.ai_input.bind("<Return>", lambda e: send_ai())
        ctk.CTkButton(input_frame, text="➤", width=32, height=32, fg_color=COLORS["accent_purple"], hover_color="#8e44ad", command=send_ai).grid(row=0, column=1)
        ctk.CTkButton(input_frame, text="CLI", width=44, height=32, fg_color=COLORS["accent_cyan"], hover_color="#16a085", command=run_agent).grid(row=0, column=2, padx=(4, 0))

        # ── Quick Create Section ───────────────────────────────────────────────
        create_frame = ctk.CTkFrame(ai_win, fg_color=COLORS["bg_panel"], corner_radius=6)
        create_frame.pack(fill="x", padx=8, pady=(0, 4))

        ctk.CTkLabel(create_frame, text="⚡ Быстрое создание мода с нуля", font=ctk.CTkFont(size=12, weight="bold"), text_color=COLORS["accent_cyan"]).pack(anchor="w", padx=12, pady=(8, 4))

        templates_frame = ctk.CTkFrame(create_frame, fg_color="transparent")
        templates_frame.pack(fill="x", padx=8, pady=(0, 8))

        row = 0
        col = 0
        for key, tpl in AI_CREATE_TEMPLATES.items():
            btn = ctk.CTkButton(
                templates_frame,
                text=tpl["label"],
                fg_color=COLORS["bg_card"],
                hover_color=COLORS["bg_hover"],
                text_color=COLORS["text_main"],
                corner_radius=4,
                height=28,
                font=ctk.CTkFont(size=10),
                width=120,
                command=lambda k=key: self._ai_quick_create(k, model_var, api_key_entry, base_url_entry, temp_var, max_tokens_var, thinking_var, thinking_budget_var, provider_var=provider_var)
            )
            btn.grid(row=row, column=col, padx=3, pady=2, sticky="ew")
            # Tooltip-like: right-click for description
            btn.bind("<Button-3>", lambda e, d=tpl["desc"]: self._show_tooltip_menu(e, d))
            col += 1
            if col >= 5:
                col = 0
                row += 1

        for c in range(5):
            templates_frame.grid_columnconfigure(c, weight=1)

        # ── Quick Actions (editor-aware) ───────────────────────────────────────
        actions_frame = ctk.CTkFrame(ai_win, fg_color=COLORS["bg_panel"], corner_radius=6)
        actions_frame.pack(fill="x", padx=8, pady=(0, 8))

        ctk.CTkLabel(actions_frame, text="🔧 Быстрые действия с кодом", font=ctk.CTkFont(size=12, weight="bold"), text_color=COLORS["accent_orange"]).pack(anchor="w", padx=12, pady=(8, 4))

        action_btns_frame = ctk.CTkFrame(actions_frame, fg_color="transparent")
        action_btns_frame.pack(fill="x", padx=8, pady=(0, 8))

        quick_actions = [
            ("Дописать", "continue"),
            ("Объяснить", "explain"),
            ("Исправить", "debug"),
            ("Оптимизировать", "optimize"),
            ("Комментировать", "comment"),
            ("Проверить мод", "validate_mod"),
            ("mod.json", "manifest"),
            ("Тесты", "tests"),
            ("Рефакторинг", "refactor_mod"),
            ("Data patch", "data_patch"),
        ]

        for i, (label, action) in enumerate(quick_actions):
            ctk.CTkButton(
                action_btns_frame,
                text=label,
                fg_color=COLORS["bg_card"],
                hover_color=COLORS["bg_hover"],
                text_color=COLORS["text_muted"],
                corner_radius=4,
                height=26,
                font=ctk.CTkFont(size=10),
                command=lambda a=action: self._ai_action(a)
            ).grid(row=i // 5, column=i % 5, padx=3, pady=2, sticky="ew")

        for c in range(5):
            action_btns_frame.grid_columnconfigure(c, weight=1)

        # Initial message
        self.ai_chat.insert("end", "🤖 Meterea ModKit AI Ассистент v3.1\n")
        self.ai_chat.insert("end", "━" * 55 + "\n")
        self.ai_chat.insert("end", "Я обучен на документации моддинга Хроник Метерии.\n")
        self.ai_chat.insert("end", "Могу СОЗДАВАТЬ МОДЫ С НУЛЯ и помогать с кодом:\n\n")
        self.ai_chat.insert("end", "  📦 Data-моды: предметы, расы, классы, локации...\n")
        self.ai_chat.insert("end", "  📜 JS-моды: хуки, команды, AI-фильтры...\n")
        self.ai_chat.insert("end", "  🔥 Тотал-конверсии: полная замена мира\n")
        self.ai_chat.insert("end", "  🖥 C++ плагины: нативные расширения\n\n")
        self.ai_chat.insert("end", "Поддерживаемые провайдеры:\n")
        for k, v in AI_PROVIDERS.items():
            self.ai_chat.insert("end", f"  • {v['name']}\n")
        self.ai_chat.insert("end", "\nИспользуйте кнопки быстрого создания или введите запрос.\n\n")

        # Check if settings are configured
        if self.ai_settings.get("api_key"):
            self._ai_status_indicator.configure(text="🟡 Настроен", text_color=COLORS["warning"])
        else:
            self._ai_status_indicator.configure(text="🔴 API ключ не указан", text_color=COLORS["accent_red"])

    def _show_tooltip_menu(self, event, text):
        """Show a simple tooltip as a context menu."""
        self._destroy_ctx()
        menu = self._make_menu()
        menu.add_command(label=text, state="disabled")
        self._ctx_menu = menu
        try:
            menu.tk_popup(event.x_root, event.y_root)
        except:
            pass

    def _on_provider_change(self, provider, model_menu, api_key_entry, base_url_entry, thinking_frame, thinking_var):
        """Update model list, base URL, and UI when provider changes."""
        provider = self._provider_id_from_value(provider)
        models = AI_PROVIDERS.get(provider, {}).get("models", [])
        model_menu.configure(values=models if models else ["custom"])
        if models:
            model_menu.set(models[0])

        base_url = AI_PROVIDERS.get(provider, {}).get("base_url", "")
        base_url_entry.delete(0, "end")
        if base_url and provider != "custom":
            base_url_entry.insert(0, base_url)

        if self._provider_requires_api_key(provider):
            api_key_entry.configure(state="normal", placeholder_text="API key / token")
        else:
            api_key_entry.delete(0, "end")
            api_key_entry.configure(state="disabled", placeholder_text="API key is not required")

        # Show/hide thinking budget
        prov_cfg = AI_PROVIDERS.get(provider, {})
        if prov_cfg.get("supports_thinking", False):
            thinking_frame.pack(fill="x", pady=3)
        else:
            thinking_frame.pack_forget()

    def _ai_quick_create(self, template_key, model_var, api_key_entry, base_url_entry, temp_var, max_tokens_var, thinking_var, thinking_budget_var, provider_var=None):
        """Handle quick create button press."""
        tpl = AI_CREATE_TEMPLATES.get(template_key)
        if not tpl:
            return

        if template_key == "custom":
            # Open input dialog for custom prompt
            dialog = ctk.CTkInputDialog(text="Опишите мод, который вы хотите создать:", title="AI: Создание мода")
            prompt = dialog.get_input()
            if not prompt:
                return
            prompt = f"Создай ПОЛНЫЙ мод с нуля по описанию: {prompt}. Создай mod.json и ВСЕ необходимые файлы. Выведи полное содержимое КАЖДОГО файла с именами."
        else:
            prompt = tpl["prompt"]

        self._ai_send_message(prompt, model_var, api_key_entry, base_url_entry, temp_var, max_tokens_var, thinking_var, thinking_budget_var, provider_var=provider_var)

    def _ai_create_mod_dialog(self):
        """Open the AI create mod dialog — opens AI panel if not open."""
        self.open_ai_panel()
        # The quick create buttons are already in the AI panel

    def _ai_create_from_mod(self, mod_id):
        """Ask AI to create a new mod based on an existing one."""
        self.open_ai_panel()
        mod = next((m for m in self.all_mods if m["id"] == mod_id), None)
        if mod:
            prompt = f"Создай НОВЫЙ мод, вдохновлённый модом '{mod_id}' ({mod.get('name', mod_id)}), но с уникальным контентом. Создай mod.json и ВСЕ необходимые файлы. Используй другие ID, имена и описания. Выведи полное содержимое КАЖДОГО файла."
            # Will need to get references from AI window - just open and let user type
            self.ai_chat.insert("end", f"\n💡 Подсказка: Мод '{mod_id}' выбран как основа.\nВведите запрос или нажмите кнопку быстрого создания.\n\n")

    def _ai_create_file(self):
        """Create a new file via AI for current mod."""
        if not self.current_mod_id:
            messagebox.showwarning("AI", "Сначала выберите мод!")
            return
        dialog = ctk.CTkInputDialog(text="Опишите файл, который нужно создать:", title="AI: Создать файл")
        prompt = dialog.get_input()
        if not prompt:
            return
        prompt = f"Создай файл для мода '{self.current_mod_id}': {prompt}. Выведи только содержимое файла, без объяснений."
        self._ai_action_with_prompt(prompt, "continue")

    def _append_agent_log(self, text):
        if hasattr(self, "ai_chat") and self.ai_chat:
            self.ai_chat.insert("end", text + "\n")
            self.ai_chat.see("end")
        self._set_status(str(text).strip()[:180])

    def _get_current_mod_path(self):
        if not self.current_mod_id:
            return None
        return os.path.realpath(os.path.join(self.mods_dir, self.current_mod_id))

    def _safe_mod_path(self, rel_path):
        mod_path = self._get_current_mod_path()
        if not mod_path:
            raise ValueError("No mod is selected")
        rel_path = str(rel_path or "").replace("\\", "/").lstrip("/")
        target = os.path.realpath(os.path.join(mod_path, rel_path))
        if os.path.commonpath([mod_path, target]) != mod_path:
            raise ValueError(f"Path escapes selected mod: {rel_path}")
        return target

    def _relative_current_file(self):
        if not self.current_file_path or not self._get_current_mod_path():
            return ""
        try:
            return os.path.relpath(self.current_file_path, self._get_current_mod_path()).replace("\\", "/")
        except Exception:
            return os.path.basename(self.current_file_path)

    def _build_agent_tool_protocol_prompt(self, message):
        tool_spec = {
            "tool_calls": [
                {"tool": "list_files", "args": {}},
                {"tool": "read_file", "args": {"path": "mod.json"}},
                {"tool": "write_file", "args": {"path": "data/example.json", "content": "{}"}},
                {"tool": "replace_file", "args": {"path": "data/example.json", "content": "{}"}},
                {"tool": "replace_lines", "args": {"path": "data/main.js", "start_line": 1, "end_line": 3, "content": "// replacement"}},
                {"tool": "insert_after", "args": {"path": "data/main.js", "pattern": "ModAPI", "content": "// inserted"}},
                {"tool": "delete_file", "args": {"path": "data/old.json"}},
                {"tool": "validate_json", "args": {"path": "mod.json"}},
                {"tool": "validate_mod", "args": {}},
                {"tool": "open_file", "args": {"path": "mod.json"}},
                {"tool": "save_editor", "args": {}},
                {"tool": "shell", "args": {"command": "dir", "timeout": 30}},
            ]
        }

        return (
            "You are Meterea ModKit CLI Agent. Work like a coding CLI agent.\n"
            "When you need an action, return ONLY a JSON tool call block. "
            "After tool results, continue or finish with a concise summary.\n"
            "Tool call format:\n"
            f"```json\n{json.dumps(tool_spec, ensure_ascii=False, indent=2)}\n```\n\n"
            "Rules: stay inside the selected mod, prefer file tools before shell, validate after edits, "
            "and if a tool is denied, adapt without repeating the same denied command.\n\n"
            f"{message}"
        )

    def _build_agent_followup_prompt(self, tool_results):
        return self._build_agent_tool_protocol_prompt(
            "Continue the CLI agent task. The previous model response requested tools.\n"
            "Here are tool results. If more work is needed, request more tools. Otherwise summarize final changes.\n\n"
            f"TOOL RESULTS:\n```json\n{json.dumps(tool_results, ensure_ascii=False, indent=2)}\n```"
        )

    def _build_agent_context(self, user_task):
        mod_path = self._get_current_mod_path()
        files = []
        if mod_path and os.path.exists(mod_path):
            for root, _, names in os.walk(mod_path):
                for name in names:
                    rel = os.path.relpath(os.path.join(root, name), mod_path).replace("\\", "/")
                    files.append(rel)
        files = sorted(files)[:300]

        current_file = self._relative_current_file()
        editor_content = self.editor.get("1.0", "end-1c") if self.current_file_path else ""
        mod_json = ""
        if mod_path:
            mod_json_path = os.path.join(mod_path, "mod.json")
            if os.path.exists(mod_json_path):
                try:
                    with open(mod_json_path, "r", encoding="utf-8") as f:
                        mod_json = f.read()[:6000]
                except Exception as e:
                    mod_json = f"Could not read mod.json: {e}"

        context = (
            f"USER TASK:\n{user_task}\n\n"
            f"SELECTED MOD: {self.current_mod_id or '(none)'}\n"
            f"MOD CWD: {mod_path or '(none)'}\n"
            f"FILES:\n{json.dumps(files, ensure_ascii=False, indent=2)}\n\n"
            f"CURRENT FILE: {current_file or '(none)'}\n"
            f"CURRENT EDITOR CONTENT:\n```\n{editor_content[:12000]}\n```\n\n"
            f"MOD.JSON:\n```json\n{mod_json}\n```"
        )
        return self._build_agent_tool_protocol_prompt(context)

    def _extract_agent_tool_calls(self, response):
        candidates = []
        for block in re.findall(r"```(?:json)?\s*(.*?)```", response or "", re.DOTALL | re.IGNORECASE):
            candidates.append(block.strip())
        stripped = (response or "").strip()
        if stripped.startswith("{") or stripped.startswith("["):
            candidates.append(stripped)

        calls = []
        for candidate in candidates:
            try:
                payload = json.loads(candidate)
            except Exception:
                continue
            if isinstance(payload, dict) and isinstance(payload.get("tool_calls"), list):
                calls.extend(payload["tool_calls"])
            elif isinstance(payload, list):
                calls.extend(payload)
            elif isinstance(payload, dict) and (payload.get("tool") or payload.get("name")):
                calls.append(payload)
        normalized = []
        for call in calls:
            if not isinstance(call, dict):
                continue
            tool = call.get("tool") or call.get("name")
            args = call.get("args") or call.get("arguments") or {}
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except Exception:
                    args = {"value": args}
            normalized.append({"tool": str(tool), "args": args if isinstance(args, dict) else {}})
        return normalized

    def _confirm_agent_tool(self, tool_name, args):
        read_only = {"list_files", "read_file", "validate_json", "validate_mod", "open_file"}
        if tool_name in read_only:
            return True

        message = f"Agent wants to run tool: {tool_name}\n\n{json.dumps(args, ensure_ascii=False, indent=2)[:3000]}"
        result = {"allowed": False}

        def ask():
            result["allowed"] = messagebox.askyesno("ModKit CLI Agent approval", message)

        if threading.current_thread() is threading.main_thread():
            ask()
            return result["allowed"]

        event = threading.Event()
        def ask_and_release():
            try:
                ask()
            finally:
                event.set()
        self.after(0, ask_and_release)
        event.wait()
        return result["allowed"]

    def _execute_agent_tool(self, call):
        tool_name = call.get("tool", "")
        args = call.get("args", {}) or {}
        if not self._confirm_agent_tool(tool_name, args):
            return {"tool": tool_name, "denied": True, "message": "denied by user"}

        try:
            if tool_name == "list_files":
                mod_path = self._get_current_mod_path()
                if not mod_path:
                    raise ValueError("No mod selected")
                files = []
                for root, _, names in os.walk(mod_path):
                    for name in names:
                        files.append(os.path.relpath(os.path.join(root, name), mod_path).replace("\\", "/"))
                return {"tool": tool_name, "ok": True, "files": sorted(files)}

            if tool_name == "read_file":
                path = self._safe_mod_path(args.get("path"))
                with open(path, "r", encoding="utf-8") as f:
                    return {"tool": tool_name, "ok": True, "content": f.read()[:50000]}

            if tool_name in ("write_file", "replace_file"):
                path = self._safe_mod_path(args.get("path"))
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w", encoding="utf-8") as f:
                    f.write(str(args.get("content", "")))
                self.after(0, self.load_files)
                return {"tool": tool_name, "ok": True, "path": args.get("path")}

            if tool_name == "replace_lines":
                path = self._safe_mod_path(args.get("path"))
                start = max(1, int(args.get("start_line", 1)))
                end = max(start, int(args.get("end_line", start)))
                with open(path, "r", encoding="utf-8") as f:
                    lines = f.read().splitlines()
                replacement = str(args.get("content", "")).splitlines()
                lines[start - 1:end] = replacement
                with open(path, "w", encoding="utf-8") as f:
                    f.write("\n".join(lines) + ("\n" if lines else ""))
                return {"tool": tool_name, "ok": True, "path": args.get("path"), "start_line": start, "end_line": end}

            if tool_name == "insert_after":
                path = self._safe_mod_path(args.get("path"))
                with open(path, "r", encoding="utf-8") as f:
                    lines = f.read().splitlines()
                insert_at = int(args.get("line", 0))
                pattern = args.get("pattern")
                if pattern:
                    insert_at = next((idx + 1 for idx, line in enumerate(lines) if str(pattern) in line), len(lines))
                insert_lines = str(args.get("content", "")).splitlines()
                lines[insert_at:insert_at] = insert_lines
                with open(path, "w", encoding="utf-8") as f:
                    f.write("\n".join(lines) + ("\n" if lines else ""))
                return {"tool": tool_name, "ok": True, "path": args.get("path"), "line": insert_at}

            if tool_name == "delete_file":
                path = self._safe_mod_path(args.get("path"))
                os.remove(path)
                self.after(0, self.load_files)
                return {"tool": tool_name, "ok": True, "path": args.get("path")}

            if tool_name == "validate_json":
                path_arg = args.get("path")
                content = args.get("content")
                if path_arg:
                    with open(self._safe_mod_path(path_arg), "r", encoding="utf-8") as f:
                        content = f.read()
                json.loads(content or "")
                return {"tool": tool_name, "ok": True, "message": "JSON is valid"}

            if tool_name == "validate_mod":
                errors, warnings = self._collect_mod_validation(self.current_mod_id)
                return {"tool": tool_name, "ok": not errors, "errors": errors, "warnings": warnings}

            if tool_name == "open_file":
                path = self._safe_mod_path(args.get("path"))
                rel = os.path.relpath(path, self._get_current_mod_path()).replace("\\", "/")
                self.after(0, lambda: self.open_file(path, rel))
                return {"tool": tool_name, "ok": True, "path": rel}

            if tool_name == "save_editor":
                self.after(0, self.save_file)
                return {"tool": tool_name, "ok": True}

            if tool_name == "shell":
                command = str(args.get("command", ""))
                timeout = int(args.get("timeout", 30))
                if not command.strip():
                    raise ValueError("Empty shell command")
                if platform.system() == "Windows":
                    cmd = ["powershell", "-NoProfile", "-Command", command]
                    result = subprocess.run(cmd, cwd=self._get_current_mod_path(), capture_output=True, text=True, timeout=timeout)
                else:
                    result = subprocess.run(command, cwd=self._get_current_mod_path(), shell=True, capture_output=True, text=True, timeout=timeout)
                return {
                    "tool": tool_name,
                    "ok": result.returncode == 0,
                    "returncode": result.returncode,
                    "stdout": result.stdout[-20000:],
                    "stderr": result.stderr[-20000:],
                }

            return {"tool": tool_name, "ok": False, "error": f"Unknown tool: {tool_name}"}
        except Exception as e:
            return {"tool": tool_name, "ok": False, "error": str(e)}

    def _collect_mod_validation(self, mod_id):
        if not mod_id:
            return ["No mod selected"], []
        mod_path = os.path.join(self.mods_dir, mod_id)
        mod_json_path = os.path.join(mod_path, "mod.json")
        errors = []
        warnings = []
        if not os.path.exists(mod_json_path):
            return ["mod.json not found"], warnings
        try:
            with open(mod_json_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        except json.JSONDecodeError as e:
            return [f"mod.json invalid JSON: {e}"], warnings
        for field in ["id", "name", "version", "author", "description"]:
            if field not in meta or not meta[field]:
                errors.append(f"mod.json missing required field '{field}'")
        if meta.get("id") != mod_id:
            warnings.append(f"mod.json id '{meta.get('id')}' does not match folder '{mod_id}'")
        for script in meta.get("scripts", []):
            script_path = os.path.join(mod_path, script)
            if not os.path.exists(script_path):
                errors.append(f"script not found: {script}")
        for key, data_file in meta.get("data", {}).items():
            if isinstance(data_file, str) and not os.path.exists(os.path.join(mod_path, data_file)):
                warnings.append(f"data file for '{key}' not found: {data_file}")
        return errors, warnings

    def _provider_supports_native_stream_tools(self, provider):
        return self._provider_id_from_value(provider) in NATIVE_TOOL_STREAM_PROVIDER_IDS

    def _native_tool_stream_family(self, provider):
        provider = self._provider_id_from_value(provider)
        if provider in GEMINI_TOOL_STREAM_PROVIDER_IDS:
            return "gemini"
        if provider in ANTHROPIC_TOOL_STREAM_PROVIDER_IDS:
            return "anthropic"
        if provider in DUMMY_TOOL_STREAM_PROVIDER_IDS:
            return "dummy"
        if provider in OPENAI_TOOL_STREAM_PROVIDER_IDS:
            return "openai"
        return "json_fallback"

    def _openai_agent_tool_definitions(self):
        string_arg = {"type": "string"}
        return [
            {
                "type": "function",
                "function": {
                    "name": "list_files",
                    "description": "List files in the selected mod directory.",
                    "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "read_file",
                    "description": "Read a UTF-8 file inside the selected mod directory.",
                    "parameters": {
                        "type": "object",
                        "properties": {"path": string_arg},
                        "required": ["path"],
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "write_file",
                    "description": "Create or overwrite a UTF-8 file inside the selected mod directory.",
                    "parameters": {
                        "type": "object",
                        "properties": {"path": string_arg, "content": string_arg},
                        "required": ["path", "content"],
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "replace_file",
                    "description": "Replace the full contents of an existing file inside the selected mod directory.",
                    "parameters": {
                        "type": "object",
                        "properties": {"path": string_arg, "content": string_arg},
                        "required": ["path", "content"],
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "replace_lines",
                    "description": "Replace a 1-based inclusive line range in a file.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": string_arg,
                            "start_line": {"type": "integer", "minimum": 1},
                            "end_line": {"type": "integer", "minimum": 1},
                            "content": string_arg,
                        },
                        "required": ["path", "start_line", "end_line", "content"],
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "insert_after",
                    "description": "Insert text after the first line containing pattern, or after a numeric line index.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": string_arg,
                            "pattern": string_arg,
                            "line": {"type": "integer", "minimum": 0},
                            "content": string_arg,
                        },
                        "required": ["path", "content"],
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "delete_file",
                    "description": "Delete a file inside the selected mod directory.",
                    "parameters": {
                        "type": "object",
                        "properties": {"path": string_arg},
                        "required": ["path"],
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "validate_json",
                    "description": "Validate JSON from a file path or inline content.",
                    "parameters": {
                        "type": "object",
                        "properties": {"path": string_arg, "content": string_arg},
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "validate_mod",
                    "description": "Validate the selected mod manifest and referenced files.",
                    "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "open_file",
                    "description": "Open a mod file in the ModKit editor.",
                    "parameters": {
                        "type": "object",
                        "properties": {"path": string_arg},
                        "required": ["path"],
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "save_editor",
                    "description": "Save the current editor buffer.",
                    "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "shell",
                    "description": "Run a shell command from the selected mod directory after user approval.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "command": string_arg,
                            "timeout": {"type": "integer", "minimum": 1, "maximum": 300},
                        },
                        "required": ["command"],
                        "additionalProperties": False,
                    },
                },
            },
        ]

    def _gemini_agent_tool_definitions(self):
        declarations = []
        for tool in self._openai_agent_tool_definitions():
            fn = tool.get("function", {})
            parameters = dict(fn.get("parameters", {}) or {})
            parameters.pop("additionalProperties", None)
            for prop in (parameters.get("properties") or {}).values():
                if isinstance(prop, dict):
                    prop.pop("additionalProperties", None)
            declarations.append({
                "name": fn.get("name", ""),
                "description": fn.get("description", ""),
                "parameters": parameters,
            })
        return [{"functionDeclarations": declarations}]

    def _anthropic_agent_tool_definitions(self):
        tools = []
        for tool in self._openai_agent_tool_definitions():
            fn = tool.get("function", {})
            schema = dict(fn.get("parameters", {}) or {})
            tools.append({
                "name": fn.get("name", ""),
                "description": fn.get("description", ""),
                "input_schema": schema,
            })
        return tools

    def _build_native_agent_messages(self, provider, message):
        family = self._native_tool_stream_family(provider)
        if family == "gemini":
            return [{"role": "user", "parts": [{"text": message}]}]
        if family == "anthropic":
            return [{"role": "user", "content": message}]
        return [
            {
                "role": "system",
                "content": (
                    AI_SYSTEM_PROMPT
                    + "\n\nYou are a CLI-style coding agent inside ModKit. Use tools for file and shell work. "
                    "After tool results, continue until the requested modding task is complete."
                ),
            },
            {"role": "user", "content": message},
        ]

    def _append_native_tool_results(self, provider, native_messages, agent_response, response, tool_results):
        family = self._native_tool_stream_family(provider)
        if family == "openai":
            openai_tool_calls = agent_response.get("openai_tool_calls") or []
            if not openai_tool_calls:
                return False
            native_messages.append({
                "role": "assistant",
                "content": response or "",
                "tool_calls": openai_tool_calls,
            })
            for raw_call, result in zip(openai_tool_calls, tool_results):
                native_messages.append({
                    "role": "tool",
                    "tool_call_id": raw_call.get("id", ""),
                    "content": json.dumps(result, ensure_ascii=False),
                })
            return True

        if family == "gemini":
            gemini_model_parts = agent_response.get("gemini_model_parts") or []
            if not gemini_model_parts:
                return False
            native_messages.append({"role": "model", "parts": gemini_model_parts})
            result_parts = []
            tool_parts = [part for part in gemini_model_parts if part.get("functionCall")]
            for raw_part, result in zip(tool_parts, tool_results):
                function_call = raw_part.get("functionCall", {})
                result_parts.append({
                    "functionResponse": {
                        "name": function_call.get("name", ""),
                        "id": function_call.get("id", ""),
                        "response": result,
                    }
                })
            native_messages.append({"role": "user", "parts": result_parts})
            return True

        if family == "anthropic":
            anthropic_blocks = agent_response.get("anthropic_content_blocks") or []
            tool_blocks = [block for block in anthropic_blocks if block.get("type") == "tool_use"]
            if not tool_blocks:
                return False
            native_messages.append({"role": "assistant", "content": anthropic_blocks})
            result_blocks = []
            for block, result in zip(tool_blocks, tool_results):
                result_blocks.append({
                    "type": "tool_result",
                    "tool_use_id": block.get("id", ""),
                    "content": json.dumps(result, ensure_ascii=False),
                    "is_error": not bool(result.get("ok", True)),
                })
            native_messages.append({"role": "user", "content": result_blocks})
            return True

        return False

    def _gemini_partial_args_to_dict(self, partial_args):
        args = {}
        for item in partial_args or []:
            path = str(item.get("jsonPath", "$")).replace("$.", "")
            if not path:
                continue
            value = None
            for key in ("stringValue", "numberValue", "boolValue", "nullValue"):
                if key in item:
                    value = item[key]
                    break
            args[path] = value
        return args

    def _call_openai_streaming_tools(self, messages, on_delta=None):
        provider = self._provider_id_from_value(self.ai_settings.get("provider", "gemini"))
        api_key = self.ai_settings.get("api_key", "")
        model = self.ai_settings.get("model", "")
        base_url = self.ai_settings.get("base_url", "")
        temperature = self.ai_settings.get("temperature", 0.7)
        max_tokens = self.ai_settings.get("max_tokens", 8192)

        if not base_url:
            base_url = AI_PROVIDERS.get(provider, {}).get("base_url", "https://api.openai.com/v1/chat/completions")
        if not base_url:
            raise Exception(f"Base URL is required for {AI_PROVIDERS.get(provider, {}).get('name', provider)}")
        if provider == "local" and base_url and not base_url.endswith("/chat/completions"):
            if "/v1/" not in base_url:
                base_url = base_url.rstrip("/") + "/v1/chat/completions"

        headers = {"Content-Type": "application/json"}
        auth_type = AI_PROVIDERS.get(provider, {}).get("auth_type", "bearer")
        if auth_type == "bearer" and provider != "local" and api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        elif auth_type == "api_key" and api_key:
            headers["api-key"] = api_key
        if provider == "openrouter":
            headers["HTTP-Referer"] = "https://meterea-modkit.local"
            headers["X-Title"] = "Meterea ModKit"

        body = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
            "tools": self._openai_agent_tool_definitions(),
            "tool_choice": "auto",
        }

        tool_fragments = {}
        content_parts = []
        finish_reason = None
        for event in http_stream_json_events(base_url, headers, body):
            choices = event.get("choices", []) if isinstance(event, dict) else []
            if not choices:
                continue
            choice = choices[0]
            finish_reason = choice.get("finish_reason") or finish_reason
            delta = choice.get("delta", {}) or {}
            chunk = delta.get("content")
            if chunk:
                content_parts.append(chunk)
                if on_delta:
                    on_delta(chunk)
            for tool_delta in delta.get("tool_calls", []) or []:
                index = tool_delta.get("index", 0)
                fragment = tool_fragments.setdefault(index, {"id": "", "type": "function", "name": "", "arguments": ""})
                if tool_delta.get("id"):
                    fragment["id"] = tool_delta["id"]
                if tool_delta.get("type"):
                    fragment["type"] = tool_delta["type"]
                function_delta = tool_delta.get("function", {}) or {}
                if function_delta.get("name"):
                    fragment["name"] += function_delta["name"]
                if function_delta.get("arguments"):
                    fragment["arguments"] += function_delta["arguments"]
            if finish_reason == "tool_calls":
                pass

        tool_calls = []
        openai_tool_calls = []
        for index in sorted(tool_fragments):
            fragment = tool_fragments[index]
            args_text = fragment.get("arguments", "") or "{}"
            tool_call_id = fragment.get("id") or f"call_modkit_{index}"
            try:
                args = json.loads(args_text)
            except Exception:
                args = {"value": args_text}
            openai_tool_calls.append({
                "id": tool_call_id,
                "type": "function",
                "function": {
                    "name": fragment.get("name", ""),
                    "arguments": args_text,
                },
            })
            tool_calls.append({
                "id": tool_call_id,
                "tool": fragment.get("name", ""),
                "args": args if isinstance(args, dict) else {},
            })
        return {
            "content": "".join(content_parts),
            "tool_calls": tool_calls,
            "openai_tool_calls": openai_tool_calls,
            "finish_reason": finish_reason,
        }

    def _call_gemini_streaming_tools(self, messages, on_delta=None):
        provider = self._provider_id_from_value(self.ai_settings.get("provider", "gemini"))
        api_key = self.ai_settings.get("api_key", "")
        model = self.ai_settings.get("model", "")
        base_url = self.ai_settings.get("base_url", "")
        temperature = self.ai_settings.get("temperature", 0.7)
        max_tokens = self.ai_settings.get("max_tokens", 8192)

        effective_key = api_key
        if self._gemini_keys and not effective_key:
            effective_key = self._gemini_keys[self._gemini_key_index % len(self._gemini_keys)]
        if base_url:
            if "{model}" in base_url or "{api_key}" in base_url:
                url = base_url.format(model=model, api_key=effective_key)
            elif ":streamGenerateContent" in base_url:
                url = base_url
            elif ":generateContent" in base_url:
                url = base_url.replace(":generateContent", ":streamGenerateContent")
            else:
                url = base_url.rstrip("/") + f"/{model}:streamGenerateContent?alt=sse&key={effective_key}"
        else:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse&key={effective_key}"

        body = {
            "contents": messages,
            "systemInstruction": {"parts": [{"text": AI_SYSTEM_PROMPT}]},
            "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens},
            "tools": self._gemini_agent_tool_definitions(),
            "toolConfig": {
                "functionCallingConfig": {
                    "mode": "AUTO",
                    "streamFunctionCallArguments": True,
                }
            },
        }
        headers = {"Content-Type": "application/json"}

        content_parts = []
        tool_fragments = {}
        gemini_model_parts = []
        finish_reason = None
        for event in http_stream_json_events(url, headers, body):
            candidates = event.get("candidates", []) if isinstance(event, dict) else []
            if not candidates:
                continue
            candidate = candidates[0]
            finish_reason = candidate.get("finishReason") or finish_reason
            for part in candidate.get("content", {}).get("parts", []) or []:
                raw_part = dict(part)
                if raw_part.get("text") or raw_part.get("functionCall") or raw_part.get("thoughtSignature"):
                    gemini_model_parts.append(raw_part)
                text = part.get("text")
                if text:
                    content_parts.append(text)
                    if on_delta:
                        on_delta(text)
                function_call = part.get("functionCall")
                if function_call:
                    call_id = function_call.get("id") or function_call.get("name") or f"gemini_call_{len(tool_fragments)}"
                    fragment = tool_fragments.setdefault(call_id, {
                        "id": call_id,
                        "name": function_call.get("name", ""),
                        "args": {},
                    })
                    if function_call.get("name"):
                        fragment["name"] = function_call["name"]
                    if isinstance(function_call.get("args"), dict):
                        fragment["args"].update(function_call["args"])
                    if isinstance(function_call.get("partialArgs"), list):
                        fragment["args"].update(self._gemini_partial_args_to_dict(function_call.get("partialArgs")))

        tool_calls = []
        for call_id, fragment in tool_fragments.items():
            args = fragment.get("args", {}) if isinstance(fragment.get("args"), dict) else {}
            tool_calls.append({
                "id": call_id,
                "tool": fragment.get("name", ""),
                "args": args,
            })
        return {
            "content": "".join(content_parts),
            "tool_calls": tool_calls,
            "gemini_model_parts": gemini_model_parts,
            "finish_reason": finish_reason,
        }

    def _call_anthropic_streaming_tools(self, messages, on_delta=None):
        api_key = self.ai_settings.get("api_key", "")
        model = self.ai_settings.get("model", "")
        base_url = self.ai_settings.get("base_url", "") or "https://api.anthropic.com/v1/messages"
        max_tokens = self.ai_settings.get("max_tokens", 8192)
        use_thinking = self.ai_settings.get("use_thinking", False)
        thinking_budget = self.ai_settings.get("thinking_budget", 2048)

        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        body = {
            "model": model,
            "max_tokens": max_tokens,
            "system": AI_SYSTEM_PROMPT,
            "messages": messages,
            "tools": self._anthropic_agent_tool_definitions(),
            "tool_choice": {"type": "auto"},
            "stream": True,
        }
        if use_thinking:
            body["thinking"] = {"type": "enabled", "budget_tokens": thinking_budget}

        content_blocks = {}
        content_parts = []
        finish_reason = None
        for event in http_stream_json_events(base_url, headers, body):
            event_type = event.get("type") if isinstance(event, dict) else ""
            if event_type == "content_block_start":
                index = event.get("index", 0)
                block = dict(event.get("content_block", {}) or {})
                if block.get("type") == "tool_use":
                    block.setdefault("input", {})
                    block["_partial_input_json"] = ""
                content_blocks[index] = block
            elif event_type == "content_block_delta":
                index = event.get("index", 0)
                block = content_blocks.setdefault(index, {"type": "text", "text": ""})
                delta = event.get("delta", {}) or {}
                if delta.get("type") == "text_delta":
                    text = delta.get("text", "")
                    block["text"] = block.get("text", "") + text
                    content_parts.append(text)
                    if on_delta and text:
                        on_delta(text)
                elif delta.get("type") == "input_json_delta":
                    block["_partial_input_json"] = block.get("_partial_input_json", "") + delta.get("partial_json", "")
            elif event_type == "message_delta":
                finish_reason = (event.get("delta", {}) or {}).get("stop_reason") or finish_reason

        anthropic_content_blocks = []
        tool_calls = []
        for index in sorted(content_blocks):
            block = content_blocks[index]
            if block.get("type") == "tool_use":
                input_text = block.pop("_partial_input_json", "")
                if input_text:
                    try:
                        block["input"] = json.loads(input_text)
                    except Exception:
                        block["input"] = {"value": input_text}
                anthropic_content_blocks.append(block)
                tool_calls.append({
                    "id": block.get("id", ""),
                    "tool": block.get("name", ""),
                    "args": block.get("input", {}) if isinstance(block.get("input"), dict) else {},
                })
            elif block.get("type") == "text":
                anthropic_content_blocks.append({"type": "text", "text": block.get("text", "")})
        return {
            "content": "".join(content_parts),
            "tool_calls": tool_calls,
            "anthropic_content_blocks": anthropic_content_blocks,
            "finish_reason": finish_reason,
        }

    def _call_dummy_streaming_tools(self, messages, on_delta=None):
        text = self._build_dummy_ai_response(json.dumps(messages, ensure_ascii=False))
        if on_delta:
            on_delta(text)
        return {"content": text, "tool_calls": [], "finish_reason": "end_turn"}

    def _call_agent_model(self, message, on_delta=None, messages=None):
        provider = self._provider_id_from_value(self.ai_settings.get("provider", "gemini"))
        messages = messages or self._build_native_agent_messages(provider, message)

        if self._provider_supports_native_stream_tools(provider):
            try:
                family = self._native_tool_stream_family(provider)
                if family == "gemini":
                    return self._call_gemini_streaming_tools(messages, on_delta=on_delta)
                if family == "anthropic":
                    return self._call_anthropic_streaming_tools(messages, on_delta=on_delta)
                if family == "dummy":
                    return self._call_dummy_streaming_tools(messages, on_delta=on_delta)
                if family == "openai":
                    return self._call_openai_streaming_tools(messages, on_delta=on_delta)
            except Exception as e:
                self.after(0, lambda err=e: self._append_agent_log(f"[native stream fallback] {err}"))

        fallback_message = self._build_agent_tool_protocol_prompt(message)
        content = self._call_ai_api(fallback_message)
        return {"content": content, "tool_calls": self._extract_agent_tool_calls(content), "finish_reason": None}

    def _run_agent_turn(self, prompt, model_var, api_key_entry, base_url_entry, temp_var, max_tokens_var, thinking_var, thinking_budget_var, provider_var=None):
        if self._ai_busy:
            self._set_status("AI agent is busy...")
            return
        if not str(prompt or "").strip():
            return
        if not self.current_mod_id:
            messagebox.showwarning("CLI Agent", "Select a mod before running the CLI agent.")
            return

        api_key = api_key_entry.get() if hasattr(api_key_entry, 'get') else self.ai_settings.get("api_key", "")
        provider_value = provider_var.get() if provider_var and hasattr(provider_var, 'get') else self.ai_settings.get("provider", "gemini")
        provider = self._provider_id_from_value(provider_value)
        if provider not in ("local", "dummy") and self._provider_requires_api_key(provider) and not api_key:
            self._append_agent_log("Agent blocked: API key is required for this provider.")
            return

        self.ai_settings.update({
            "provider": provider,
            "model": model_var.get() if hasattr(model_var, 'get') else self.ai_settings.get("model", ""),
            "api_key": api_key,
            "base_url": base_url_entry.get() if hasattr(base_url_entry, 'get') else self.ai_settings.get("base_url", ""),
            "temperature": float(temp_var.get() if hasattr(temp_var, 'get') else self.ai_settings.get("temperature", 0.7)),
            "max_tokens": int(max_tokens_var.get() if hasattr(max_tokens_var, 'get') else self.ai_settings.get("max_tokens", 8192)),
            "use_thinking": thinking_var.get() if hasattr(thinking_var, 'get') else False,
            "thinking_budget": int(thinking_budget_var.get() if hasattr(thinking_budget_var, 'get') else self.ai_settings.get("thinking_budget", 2048)),
        })

        self._ai_busy = True
        self._append_agent_log(f"\n$ agent {prompt}")

        def worker():
            try:
                message = self._build_agent_context(prompt)
                native_messages = None
                if self._provider_supports_native_stream_tools(provider):
                    native_messages = self._build_native_agent_messages(provider, message)
                for round_index in range(4):
                    agent_response = self._call_agent_model(message, messages=native_messages)
                    response = agent_response.get("content", "")
                    self.after(0, lambda r=response: self._append_agent_log(f"\n[model]\n{r}\n"))
                    tool_calls = agent_response.get("tool_calls") or self._extract_agent_tool_calls(response)
                    if not tool_calls:
                        break
                    tool_results = []
                    for call in tool_calls:
                        self.after(0, lambda c=call: self._append_agent_log(f"[tool request] {json.dumps(c, ensure_ascii=False)}"))
                        result = self._execute_agent_tool(call)
                        tool_results.append(result)
                        self.after(0, lambda res=result: self._append_agent_log(f"[tool result] {json.dumps(res, ensure_ascii=False)[:4000]}"))
                    if native_messages is not None and not self._append_native_tool_results(provider, native_messages, agent_response, response, tool_results):
                        native_messages = None
                    message = self._build_agent_followup_prompt(tool_results)
                self.after(0, lambda: self._set_status("CLI agent finished turn"))
            except Exception as e:
                self.after(0, lambda: self._append_agent_log(f"[agent error] {e}"))
            finally:
                self._ai_busy = False

        threading.Thread(target=worker, daemon=True).start()

    def _ai_send_message(self, prompt, model_var, api_key_entry, base_url_entry, temp_var, max_tokens_var, thinking_var, thinking_budget_var, provider_var=None):
        """Send a message to the AI provider and display response."""
        if self._ai_busy:
            self._set_status("AI занят, подождите...")
            return

        if not prompt.strip():
            return

        api_key = api_key_entry.get() if hasattr(api_key_entry, 'get') else self.ai_settings.get("api_key", "")
        # IMPORTANT: Read provider from UI widget, NOT from saved settings
        provider_value = provider_var.get() if provider_var and hasattr(provider_var, 'get') else self.ai_settings.get("provider", "gemini")
        provider = self._provider_id_from_value(provider_value)

        # Local provider doesn't need an API key
        if provider not in ("local", "dummy") and self._provider_requires_api_key(provider) and not api_key:
            self.ai_chat.insert("end", "⚠️ Укажите API ключ в настройках!\n\n")
            return

        self._ai_busy = True
        self.ai_chat.insert("end", f"\n👤 Вы: {prompt[:200]}{'...' if len(prompt) > 200 else ''}\n\n🤖 AI ({AI_PROVIDERS.get(provider, {}).get('name', provider)}): ")
        self._set_status(f"AI думает ({AI_PROVIDERS.get(provider, {}).get('name', provider)})...")

        # Gather context: current editor content
        editor_content = self.editor.get("1.0", "end-1c") if self.current_file_path else ""
        current_file = os.path.basename(self.current_file_path) if self.current_file_path else ""

        # Build user message with context
        user_msg = prompt
        if editor_content:
            user_msg += f"\n\n--- Текущий файл ({current_file}) ---\n```\n{editor_content[:8000]}\n```"
        if self.current_mod_id:
            mod_json_path = os.path.join(self.mods_dir, self.current_mod_id, "mod.json")
            if os.path.exists(mod_json_path):
                try:
                    with open(mod_json_path, "r", encoding="utf-8") as f:
                        user_msg += f"\n\n--- mod.json ---\n```json\n{f.read()[:4000]}\n```"
                except:
                    pass

        # Save current settings FROM UI (not from stale self.ai_settings)
        self.ai_settings.update({
            "provider": provider,
            "model": model_var.get() if hasattr(model_var, 'get') else self.ai_settings.get("model", ""),
            "api_key": api_key,
            "base_url": base_url_entry.get() if hasattr(base_url_entry, 'get') else self.ai_settings.get("base_url", ""),
            "temperature": float(temp_var.get() if hasattr(temp_var, 'get') else self.ai_settings.get("temperature", 0.7)),
            "max_tokens": int(max_tokens_var.get() if hasattr(max_tokens_var, 'get') else self.ai_settings.get("max_tokens", 8192)),
            "use_thinking": thinking_var.get() if hasattr(thinking_var, 'get') else False,
            "thinking_budget": int(thinking_budget_var.get() if hasattr(thinking_budget_var, 'get') else self.ai_settings.get("thinking_budget", 2048)),
        })

        # Store in chat history
        self._ai_chat_history.append({"role": "user", "content": user_msg})

        # Run in thread
        def worker():
            try:
                response = self._call_ai_api(user_msg)
                self.after(0, lambda: self.ai_chat.insert("end", response + "\n\n"))
                self.after(0, lambda: self._set_status("AI ответил"))
                self.after(0, lambda: self._ai_status_indicator.configure(text="🟢 Подключён", text_color=COLORS["accent_green"]) if hasattr(self, '_ai_status_indicator') else None)
                self._ai_chat_history.append({"role": "assistant", "content": response})
            except Exception as e:
                self.after(0, lambda: self.ai_chat.insert("end", f"❌ Ошибка: {e}\n\n"))
                self.after(0, lambda: self._set_status(f"AI ошибка: {e}"))
                self.after(0, lambda: self._ai_status_indicator.configure(text="🔴 Ошибка", text_color=COLORS["accent_red"]) if hasattr(self, '_ai_status_indicator') else None)
            finally:
                self._ai_busy = False

        threading.Thread(target=worker, daemon=True).start()

    def _call_ai_api(self, user_message):
        """Call the configured AI provider API — supports ALL vanilla providers."""
        provider = self._provider_id_from_value(self.ai_settings.get("provider", "gemini"))
        api_key = self.ai_settings.get("api_key", "")
        model = self.ai_settings.get("model", "")
        base_url = self.ai_settings.get("base_url", "")
        temperature = self.ai_settings.get("temperature", 0.7)
        max_tokens = self.ai_settings.get("max_tokens", 8192)
        use_thinking = self.ai_settings.get("use_thinking", False)
        thinking_budget = self.ai_settings.get("thinking_budget", 2048)

        if provider == "dummy":
            return self._build_dummy_ai_response(user_message)

        # ── Gemini (native API) ────────────────────────────────────────────────
        if provider == "gemini":
            # Key rotation support
            effective_key = api_key
            if self._gemini_keys and not effective_key:
                effective_key = self._gemini_keys[self._gemini_key_index % len(self._gemini_keys)]

            if base_url:
                if "{model}" in base_url or "{api_key}" in base_url:
                    url = base_url.format(model=model, api_key=effective_key)
                elif ":generateContent" in base_url:
                    url = base_url
                else:
                    url = base_url.rstrip("/") + f"/{model}:generateContent?key={effective_key}"
            else:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={effective_key}"
            body = {
                "contents": [{"parts": [{"text": user_message}]}],
                "systemInstruction": {"parts": [{"text": AI_SYSTEM_PROMPT}]},
                "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens},
            }
            headers = {"Content-Type": "application/json"}

            status, resp = http_post_json(url, headers, body)
            if status == 429 and self._gemini_keys:
                # Rotate key on rate limit
                self._gemini_key_index += 1
                effective_key = self._gemini_keys[self._gemini_key_index % len(self._gemini_keys)]
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={effective_key}"
                status, resp = http_post_json(url, headers, body)

            if status == 200:
                candidates = resp.get("candidates", [{}])
                parts = candidates[0].get("content", {}).get("parts", [])
                return "\n".join(p.get("text", "") for p in parts)
            else:
                error_msg = resp.get("error", {}).get("message", str(resp)) if isinstance(resp, dict) else str(resp)
                raise Exception(f"Gemini API Error {status}: {error_msg}")

        # ── OpenAI-compatible (OpenAI, LLMost, OpenRouter, DeepSeek, OmniRoute, local, custom) ──
        elif provider in OPENAI_COMPATIBLE_PROVIDER_IDS:
            if not base_url:
                base_url = AI_PROVIDERS.get(provider, {}).get("base_url", "https://api.openai.com/v1/chat/completions")
            if not base_url:
                raise Exception(f"Base URL is required for {AI_PROVIDERS.get(provider, {}).get('name', provider)}")

            # Auto-fix URL for local
            if provider == "local" and base_url and not base_url.endswith("/chat/completions"):
                if "/v1/" not in base_url:
                    base_url = base_url.rstrip("/") + "/v1/chat/completions"

            headers = {"Content-Type": "application/json"}
            auth_type = AI_PROVIDERS.get(provider, {}).get("auth_type", "bearer")
            if auth_type == "bearer" and provider != "local" and api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            elif auth_type == "api_key" and api_key:
                headers["api-key"] = api_key

            # Provider-specific headers
            if provider == "openrouter":
                headers["HTTP-Referer"] = "https://meterea-modkit.local"
                headers["X-Title"] = "Meterea ModKit"

            body = {
                "model": model,
                "messages": [
                    {"role": "system", "content": AI_SYSTEM_PROMPT},
                    {"role": "user", "content": user_message},
                ],
                "temperature": temperature,
                "max_tokens": max_tokens,
            }

            # DeepSeek reasoning / thinking mode
            if provider == "deepseek" and use_thinking and "reasoner" in model:
                body.pop("temperature", None)  # DeepSeek reasoner doesn't support temperature
                body["max_tokens"] = max_tokens + thinking_budget
            elif provider == "xai" and use_thinking:
                body["reasoning_effort"] = "medium"

            status, resp = http_post_json(base_url, headers, body)
            if status == 200:
                return resp.get("choices", [{}])[0].get("message", {}).get("content", "Пустой ответ")
            else:
                error_msg = resp.get("error", {}).get("message", str(resp)) if isinstance(resp, dict) else str(resp)
                raise Exception(f"{AI_PROVIDERS.get(provider, {}).get('name', provider)} API Error {status}: {error_msg}")

        # ── Anthropic (Claude) ─────────────────────────────────────────────────
        elif provider == "anthropic":
            headers = {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            }
            body = {
                "model": model,
                "max_tokens": max_tokens,
                "system": AI_SYSTEM_PROMPT,
                "messages": [
                    {"role": "user", "content": user_message},
                ],
            }

            if use_thinking:
                body["thinking"] = {"type": "enabled", "budget_tokens": thinking_budget}

            url = base_url or "https://api.anthropic.com/v1/messages"
            status, resp = http_post_json(url, headers, body)
            if status == 200:
                content_blocks = resp.get("content", [])
                return "\n".join(b.get("text", "") for b in content_blocks if b.get("type") == "text")
            else:
                error_msg = resp.get("error", {}).get("message", str(resp)) if isinstance(resp, dict) else str(resp)
                raise Exception(f"Anthropic API Error {status}: {error_msg}")

        else:
            raise Exception(f"Неизвестный провайдер: {provider}")

    def _ai_action(self, action):
        """Quick AI action from editor context menu."""
        if not self.current_file_path and action not in ("comment",):
            messagebox.showinfo("AI", "Сначала откройте файл")
            return

        content = self.editor.get("1.0", "end-1c")
        filename = os.path.basename(self.current_file_path) if self.current_file_path else ""

        action_prompts = {
            "continue": f"Продолжи этот код ({filename}). Пиши только код, без объяснений:\n\n```\n{content[-4000:]}\n```",
            "explain": f"Объясни этот код ({filename}) простым языком на русском:\n\n```\n{content[:6000]}\n```",
            "debug": f"Найди и исправь ошибки в этом коде ({filename}). Объясни, что было не так:\n\n```\n{content[:6000]}\n```",
            "optimize": f"Оптимизируй и улучши этот код ({filename}). Сохрани функциональность:\n\n```\n{content[:6000]}\n```",
            "comment": f"Добавь подробные русские комментарии к этому коду ({filename}). Сохрани функциональность:\n\n```\n{content[:6000]}\n```",
            "russian_style": f"Перепиши этот код ({filename}) в стиле, соответствующем Хроникам Метерии — с русскими комментариями, правильными ID и тематикой тёмного фэнтези:\n\n```\n{content[:6000]}\n```",
            "validate_mod": f"Проведи строгую ревизию файла мода {filename}. Найди ошибки схемы, несовместимые поля, плохие merge policies, небезопасный JS, проблемы ModAPI и риск поломки игры. Дай список конкретных исправлений и исправленную версию файла, если это уместно:\n\n```\n{content[:9000]}\n```",
            "manifest": f"Создай production-ready mod.json для текущего мода на основе этого файла {filename}. Учти зависимости, apiVersion, scripts, data, native_plugins, loadOrder, merge policy и совместимость с ModKit. Верни полный JSON без заглушек:\n\n```\n{content[:8000]}\n```",
            "tests": f"Напиши минимальные регрессионные тесты и ручной smoke-check план для этого мода/файла {filename}. Тесты должны проверять реальные контракты ModKit и данные, а не моки:\n\n```\n{content[:9000]}\n```",
            "refactor_mod": f"Отрефактори этот файл мода {filename}: уменьши дублирование, сохрани API, сделай ID стабильными, выдели понятные функции, не меняй поведение без объяснения. Верни полный исправленный файл:\n\n```\n{content[:9000]}\n```",
            "data_patch": f"Преобразуй этот контент {filename} в аккуратный data-mod patch для Chronicles of Meterea. Укажи нужные файлы, merge policy, mod.json и полное содержимое каждого файла:\n\n```\n{content[:9000]}\n```",
        }

        prompt = action_prompts.get(action, "")
        if not prompt:
            return

        self._ai_action_with_prompt(prompt, action)

    def _ai_action_with_prompt(self, prompt, action):
        """Execute an AI action with a given prompt."""
        provider = self._current_provider_id()
        if not self.ai_settings.get("api_key") and provider not in ("local", "dummy") and self._provider_requires_api_key(provider):
            messagebox.showwarning("AI", "Сначала настройте AI: нажмите 🤖 AI Ассистент и укажите API ключ")
            self.open_ai_panel()
            return

        self._set_status(f"AI: {action}...")
        self._ai_busy = True

        def worker():
            try:
                response = self._call_ai_api(prompt)
                if action == "continue":
                    code_match = re.search(r'```(?:\w+)?\n(.*?)```', response, re.DOTALL)
                    if code_match:
                        code = code_match.group(1)
                    else:
                        code = response
                    self.after(0, lambda: self.editor.insert("end", "\n" + code))
                    self.after(0, lambda: self._set_status("AI код добавлен в редактор"))
                else:
                    self.after(0, lambda: self._show_ai_response(f"🤖 AI ({action}):\n\n{response}"))
                    self.after(0, lambda: self._set_status("AI ответил"))

            except Exception as e:
                self.after(0, lambda: messagebox.showerror("AI Error", str(e)))
                self.after(0, lambda: self._set_status(f"AI ошибка: {e}"))
            finally:
                self._ai_busy = False

        threading.Thread(target=worker, daemon=True).start()

    def _show_ai_response(self, text):
        """Show AI response in a scrollable dialog with Apply button."""
        dialog = ctk.CTkToplevel(self)
        dialog.title("🤖 AI Ответ")
        dialog.geometry("650x550")
        dialog.transient(self)
        dialog.configure(fg_color=COLORS["bg_dark"])

        textbox = ctk.CTkTextbox(dialog, font=ctk.CTkFont(family="Consolas", size=11), wrap="word", fg_color=COLORS["bg_card"])
        textbox.pack(fill="both", expand=True, padx=10, pady=(10, 5))
        textbox.insert("1.0", text)

        btn_frame = ctk.CTkFrame(dialog, fg_color="transparent")
        btn_frame.pack(fill="x", padx=10, pady=(5, 10))

        def apply_code():
            """Extract code from AI response and apply to editor."""
            content = textbox.get("1.0", "end-1c")
            # Try to extract code blocks
            code_blocks = re.findall(r'```(?:\w+)?\n(.*?)```', content, re.DOTALL)
            if code_blocks:
                combined = "\n\n".join(code_blocks)
                if messagebox.askyesno("Применить", "Заменить содержимое редактора найденным кодом?"):
                    self.editor.delete("1.0", "end")
                    self.editor.insert("1.0", combined)
                    self._set_status("AI код применён к редактору")
            else:
                if messagebox.askyesno("Применить", "Код не найден в блоках. Вставить весь ответ?"):
                    self.editor.delete("1.0", "end")
                    self.editor.insert("1.0", content)
                    self._set_status("AI ответ применён к редактору")

        def copy_to_clipboard():
            content = textbox.get("1.0", "end-1c")
            self.clipboard_clear()
            self.clipboard_append(content)
            self._set_status("AI ответ скопирован в буфер")

        def create_mod_from_response():
            """Parse AI response and create mod files automatically."""
            content = textbox.get("1.0", "end-1c")
            self._ai_parse_and_create_mod(content)

        ctk.CTkButton(btn_frame, text="📋 Копировать", command=copy_to_clipboard, fg_color=COLORS["border_light"], hover_color=COLORS["border"], height=30).pack(side="left", padx=3)
        ctk.CTkButton(btn_frame, text="✅ Применить к редактору", command=apply_code, fg_color=COLORS["success"], hover_color=COLORS["accent_green"], height=30).pack(side="left", padx=3)
        ctk.CTkButton(btn_frame, text="📦 Создать мод из ответа", command=create_mod_from_response, fg_color=COLORS["accent_purple"], hover_color="#8e44ad", height=30).pack(side="left", padx=3)

    def _ai_parse_and_create_mod(self, ai_response):
        """Parse AI response for file blocks and create a complete mod."""
        # Extract filename + content pairs from the response
        # Pattern: filename.ext followed by code block
        pattern = r'(?:Файл|File|---)\s*[:\s]*\s*([a-zA-Z0-9_./-]+\.\w+)\s*\n```(?:\w+)?\n(.*?)```'
        matches = re.findall(pattern, ai_response, re.DOTALL)

        # Alternative pattern: just code blocks
        if not matches:
            code_blocks = re.findall(r'```(?:\w+)?\n(.*?)```', ai_response, re.DOTALL)
            if not code_blocks:
                messagebox.showinfo("AI", "Не удалось найти файлы в ответе AI. Попробуйте скопировать вручную.")
                return
            # Ask for mod ID
            dialog = ctk.CTkInputDialog(text="Введите ID для нового мода:", title="Создание мода из AI")
            mod_id = dialog.get_input()
            if not mod_id:
                return
            mod_id = mod_id.strip().lower().replace(" ", "_")
            mod_path = os.path.join(self.mods_dir, mod_id)
            os.makedirs(mod_path, exist_ok=True)

            # First block = mod.json if it looks like JSON
            for i, block in enumerate(code_blocks):
                ext = ".json" if block.strip().startswith("{") else ".js"
                fname = "mod.json" if i == 0 and ext == ".json" else f"data/file_{i}{ext}"
                fpath = os.path.join(mod_path, fname)
                os.makedirs(os.path.dirname(fpath), exist_ok=True)
                with open(fpath, "w", encoding="utf-8") as f:
                    f.write(block.strip())
            self.load_mods()
            self.select_mod(mod_id)
            self._set_status(f"Мод '{mod_id}' создан из AI ответа!")
            return

        # Use first match to determine mod ID from mod.json
        mod_id = None
        for fname, content in matches:
            if "mod.json" in fname or fname.endswith("mod.json"):
                try:
                    meta = json.loads(content.strip())
                    mod_id = meta.get("id", None)
                except:
                    pass
                break

        if not mod_id:
            dialog = ctk.CTkInputDialog(text="Введите ID для нового мода:", title="Создание мода из AI")
            mod_id = dialog.get_input()
            if not mod_id:
                return
            mod_id = mod_id.strip().lower().replace(" ", "_")

        mod_path = os.path.join(self.mods_dir, mod_id)
        if os.path.exists(mod_path):
            if not messagebox.askyesno("Перезапись", f"Мод '{mod_id}' уже существует. Перезаписать?"):
                return

        os.makedirs(mod_path, exist_ok=True)

        created_files = []
        for fname, content in matches:
            safe_name = fname.replace("\\", "/").lstrip("/")
            full_path = os.path.realpath(os.path.join(mod_path, safe_name))
            if not full_path.startswith(os.path.realpath(mod_path)):
                continue
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            with open(full_path, "w", encoding="utf-8") as f:
                f.write(content.strip())
            created_files.append(safe_name)

        self.load_mods()
        self.select_mod(mod_id)
        self._set_status(f"Мод '{mod_id}' создан из AI ответа! Файлов: {len(created_files)}")
        messagebox.showinfo("Мод создан", f"Мод '{mod_id}' успешно создан!\nФайлов: {len(created_files)}\n\n" + "\n".join(f"  ✅ {f}" for f in created_files))

    # ════════════════════════════════════════════════════════════════════════════
    # SETTINGS
    # ════════════════════════════════════════════════════════════════════════════
    def open_settings(self):
        dialog = ctk.CTkToplevel(self)
        dialog.title("⚙️ Настройки ModKit")
        dialog.geometry("720x680")
        dialog.transient(self)
        dialog.configure(fg_color=COLORS["bg_dark"])

        ctk.CTkLabel(dialog, text="⚙️ Настройки", font=ctk.CTkFont(size=16, weight="bold"), text_color=COLORS["accent_gold"]).pack(pady=(15, 10))

        # AI provider profile
        ai_frame = ctk.CTkFrame(dialog, fg_color=COLORS["bg_panel"], corner_radius=6)
        ai_frame.pack(fill="x", padx=15, pady=5)
        ctk.CTkLabel(ai_frame, text="AI provider profile", font=ctk.CTkFont(size=12, weight="bold"), text_color=COLORS["accent_purple"]).pack(anchor="w", padx=12, pady=(10, 4))

        current_provider = self._current_provider_id()

        provider_row = ctk.CTkFrame(ai_frame, fg_color="transparent")
        provider_row.pack(fill="x", padx=12, pady=3)
        ctk.CTkLabel(provider_row, text="Провайдер:", width=110, font=ctk.CTkFont(size=10)).pack(side="left")
        provider_var = ctk.StringVar(value=self._provider_label(current_provider))
        provider_menu = ctk.CTkOptionMenu(
            provider_row,
            variable=provider_var,
            values=self._provider_option_values(),
            command=lambda v: self._on_provider_change(self._provider_id_from_value(v), model_menu, api_key_entry, base_url_entry, thinking_frame, thinking_var),
            height=28,
            font=ctk.CTkFont(size=10),
        )
        provider_menu.pack(side="left", fill="x", expand=True, padx=5)

        model_row = ctk.CTkFrame(ai_frame, fg_color="transparent")
        model_row.pack(fill="x", padx=12, pady=3)
        ctk.CTkLabel(model_row, text="Модель:", width=110, font=ctk.CTkFont(size=10)).pack(side="left")
        models = AI_PROVIDERS.get(current_provider, {}).get("models", [])
        model_var = ctk.StringVar(value=self._selected_model_for_provider(current_provider))
        model_menu = ctk.CTkOptionMenu(model_row, variable=model_var, values=models if models else ["custom"], height=28, font=ctk.CTkFont(size=10))
        model_menu.pack(side="left", fill="x", expand=True, padx=5)

        key_row = ctk.CTkFrame(ai_frame, fg_color="transparent")
        key_row.pack(fill="x", padx=12, pady=3)
        ctk.CTkLabel(key_row, text="API ключ:", width=110, font=ctk.CTkFont(size=10)).pack(side="left")
        api_key_entry = ctk.CTkEntry(key_row, show="*", placeholder_text="API key / token", height=28, font=ctk.CTkFont(size=10), fg_color=COLORS["bg_input"])
        api_key_entry.pack(side="left", fill="x", expand=True, padx=5)
        api_key_entry.insert(0, self.ai_settings.get("api_key", ""))

        url_row = ctk.CTkFrame(ai_frame, fg_color="transparent")
        url_row.pack(fill="x", padx=12, pady=3)
        ctk.CTkLabel(url_row, text="Base URL:", width=110, font=ctk.CTkFont(size=10)).pack(side="left")
        base_url_entry = ctk.CTkEntry(url_row, placeholder_text="https://.../chat/completions", height=28, font=ctk.CTkFont(size=10), fg_color=COLORS["bg_input"])
        base_url_entry.pack(side="left", fill="x", expand=True, padx=5)
        base_url_entry.insert(0, self.ai_settings.get("base_url") or AI_PROVIDERS.get(current_provider, {}).get("base_url", ""))

        param_row = ctk.CTkFrame(ai_frame, fg_color="transparent")
        param_row.pack(fill="x", padx=12, pady=3)
        ctk.CTkLabel(param_row, text="Температура:", font=ctk.CTkFont(size=10)).pack(side="left")
        temp_var = ctk.StringVar(value=str(self.ai_settings.get("temperature", 0.7)))
        ctk.CTkEntry(param_row, textvariable=temp_var, width=60, height=28, font=ctk.CTkFont(size=10)).pack(side="left", padx=5)
        ctk.CTkLabel(param_row, text="Max tokens:", font=ctk.CTkFont(size=10)).pack(side="left", padx=(10, 0))
        max_tokens_var = ctk.StringVar(value=str(self.ai_settings.get("max_tokens", 8192)))
        ctk.CTkEntry(param_row, textvariable=max_tokens_var, width=80, height=28, font=ctk.CTkFont(size=10)).pack(side="left", padx=5)

        thinking_frame = ctk.CTkFrame(ai_frame, fg_color="transparent")
        thinking_frame.pack(fill="x", padx=12, pady=3)
        thinking_var = ctk.BooleanVar(value=self.ai_settings.get("use_thinking", False))
        ctk.CTkCheckBox(thinking_frame, text="Thinking / reasoning", variable=thinking_var, font=ctk.CTkFont(size=10)).pack(side="left")
        ctk.CTkLabel(thinking_frame, text="Budget:", font=ctk.CTkFont(size=10)).pack(side="left", padx=(12, 0))
        thinking_budget_var = ctk.StringVar(value=str(self.ai_settings.get("thinking_budget", 2048)))
        ctk.CTkEntry(thinking_frame, textvariable=thinking_budget_var, width=80, height=28, font=ctk.CTkFont(size=10)).pack(side="left", padx=5)

        if not AI_PROVIDERS.get(current_provider, {}).get("supports_thinking", False):
            thinking_frame.pack_forget()
        if not self._provider_requires_api_key(current_provider):
            api_key_entry.delete(0, "end")
            api_key_entry.configure(state="disabled", placeholder_text="API key is not required")

        buttons_row = ctk.CTkFrame(ai_frame, fg_color="transparent")
        buttons_row.pack(fill="x", padx=12, pady=(6, 10))

        def save_modkit_ai_settings():
            provider_id = self._provider_id_from_value(provider_var.get())
            self.ai_settings.update({
                "provider": provider_id,
                "model": model_var.get(),
                "api_key": api_key_entry.get() if self._provider_requires_api_key(provider_id) else "",
                "base_url": base_url_entry.get(),
                "temperature": float(temp_var.get() or 0.7),
                "max_tokens": int(max_tokens_var.get() or 8192),
                "thinking_budget": int(thinking_budget_var.get() or 2048),
                "use_thinking": thinking_var.get(),
                "gemini_keys": self._gemini_keys,
            })
            self._save_ai_settings()
            self._set_status("ModKit AI settings saved")

        def ping_ai_provider():
            save_modkit_ai_settings()
            self._set_status("Checking AI provider...")

            def worker():
                try:
                    response = self._call_ai_api("Reply with exactly one short OK line.")
                    preview = str(response).strip().replace("\n", " ")[:160]
                    self.after(0, lambda: self._set_status(f"AI ping OK: {preview}"))
                    self.after(0, lambda: messagebox.showinfo("AI provider", f"Provider answered:\n{preview}"))
                except Exception as e:
                    self.after(0, lambda: self._set_status(f"AI ping failed: {e}"))
                    self.after(0, lambda: messagebox.showerror("AI provider", str(e)))

            threading.Thread(target=worker, daemon=True).start()

        ctk.CTkButton(buttons_row, text="Сохранить AI", fg_color=COLORS["success"], hover_color=COLORS["accent_green"], command=save_modkit_ai_settings, height=28, font=ctk.CTkFont(size=10)).pack(side="left", padx=(0, 6))
        ctk.CTkButton(buttons_row, text="Проверить связь", fg_color=COLORS["info"], hover_color="#2471a3", command=ping_ai_provider, height=28, font=ctk.CTkFont(size=10)).pack(side="left")

        # Mods directory
        dir_frame = ctk.CTkFrame(dialog, fg_color=COLORS["bg_panel"], corner_radius=6)
        dir_frame.pack(fill="x", padx=15, pady=5)
        ctk.CTkLabel(dir_frame, text="📂 Директория модов:", font=ctk.CTkFont(size=11)).pack(anchor="w", padx=12, pady=(8, 2))
        ctk.CTkLabel(dir_frame, text=self.mods_dir, font=ctk.CTkFont(family="Consolas", size=10), text_color=COLORS["accent_cyan"]).pack(anchor="w", padx=12, pady=(0, 8))

        # Gemini keys management
        gem_frame = ctk.CTkFrame(dialog, fg_color=COLORS["bg_panel"], corner_radius=6)
        gem_frame.pack(fill="x", padx=15, pady=5)
        ctk.CTkLabel(gem_frame, text="🔑 Gemini API ключи (ротация):", font=ctk.CTkFont(size=11, weight="bold")).pack(anchor="w", padx=12, pady=(8, 4))

        keys_list = ctk.CTkTextbox(gem_frame, height=80, font=ctk.CTkFont(family="Consolas", size=10), fg_color=COLORS["bg_input"])
        keys_list.pack(fill="x", padx=12, pady=4)
        for key in self._gemini_keys:
            keys_list.insert("end", f"{key[:8]}...{key[-4:]}\n" if len(key) > 12 else f"{key}\n")

        add_key_frame = ctk.CTkFrame(gem_frame, fg_color="transparent")
        add_key_frame.pack(fill="x", padx=12, pady=(4, 8))
        new_key_entry = ctk.CTkEntry(add_key_frame, placeholder_text="Новый Gemini API ключ", font=ctk.CTkFont(size=10), height=28, fg_color=COLORS["bg_input"])
        new_key_entry.pack(side="left", fill="x", expand=True, padx=(0, 5))

        def add_gemini_key():
            key = new_key_entry.get().strip()
            if key and key not in self._gemini_keys:
                self._gemini_keys.append(key)
                self._save_ai_settings()
                new_key_entry.delete(0, "end")
                keys_list.insert("end", f"{key[:8]}...{key[-4:]}\n" if len(key) > 12 else f"{key}\n")
                self._set_status("Gemini ключ добавлен")

        def clear_gemini_keys():
            self._gemini_keys = []
            self._save_ai_settings()
            keys_list.delete("1.0", "end")
            self._set_status("Gemini ключи очищены")

        ctk.CTkButton(add_key_frame, text="+", width=28, height=28, fg_color=COLORS["accent_green"], command=add_gemini_key).pack(side="left", padx=2)
        ctk.CTkButton(add_key_frame, text="🗑", width=28, height=28, fg_color=COLORS["accent_red"], command=clear_gemini_keys).pack(side="left", padx=2)

        # Version info
        info_frame = ctk.CTkFrame(dialog, fg_color=COLORS["bg_panel"], corner_radius=6)
        info_frame.pack(fill="x", padx=15, pady=5)
        ctk.CTkLabel(info_frame, text=f"ModKit v{MODKIT_VERSION} | Game v{GAME_VERSION}", font=ctk.CTkFont(size=10), text_color=COLORS["text_dim"]).pack(padx=12, pady=8)

    # ── Status ─────────────────────────────────────────────────────────────────
    def _set_status(self, text):
        self.status_label.configure(text=text)


# ═══════════════════════════════════════════════════════════════════════════════
# Entry Point
# ═══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    app = ModKitApp()
    app.mainloop()
