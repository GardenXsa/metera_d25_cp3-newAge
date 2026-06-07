"""Persistent configuration for metera-modkit.

Stored at ``<user_config_dir>/config.json``. Keeps last-used provider,
API keys (one per provider), defaults for permission mode and approval.

We intentionally do not require this file to exist; ``load()`` returns
an empty config when nothing has been written yet.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, asdict
from typing import Any

from modkit.paths import user_config_dir


CONFIG_FILE_NAME = "config.json"


@dataclass
class Config:
    """In-memory representation of ``config.json``."""

    provider: str = ""
    model: str = ""
    base_url: str = ""
    api_keys: dict[str, str] = field(default_factory=dict)
    permission_mode: str = "ask"  # ask | auto-edit | yolo
    temperature: float = 0.4
    max_tokens: int = 4096
    max_iterations: int = 20
    mods_dir: str = ""

    def api_key_for(self, provider: str) -> str:
        return self.api_keys.get(provider, "") or os.environ.get(self._env_for(provider), "")

    @staticmethod
    def _env_for(provider: str) -> str:
        return {
            "openai": "OPENAI_API_KEY",
            "anthropic": "ANTHROPIC_API_KEY",
            "gemini": "GEMINI_API_KEY",
            "openrouter": "OPENROUTER_API_KEY",
            "deepseek": "DEEPSEEK_API_KEY",
            "groq": "GROQ_API_KEY",
            "mistral": "MISTRAL_API_KEY",
            "together": "TOGETHER_API_KEY",
            "fireworks": "FIREWORKS_API_KEY",
            "cohere": "COHERE_API_KEY",
            "local": "MODKIT_LOCAL_KEY",
            "custom": "MODKIT_CUSTOM_KEY",
        }.get(provider, f"{provider.upper()}_API_KEY")


def config_path() -> str:
    return os.path.join(user_config_dir(), CONFIG_FILE_NAME)


def load() -> Config:
    path = config_path()
    if not os.path.exists(path):
        return Config()
    try:
        with open(path, "r", encoding="utf-8") as f:
            data: dict[str, Any] = json.load(f)
    except (OSError, json.JSONDecodeError):
        return Config()
    cfg = Config()
    for key, value in data.items():
        if hasattr(cfg, key):
            setattr(cfg, key, value)
    if not isinstance(cfg.api_keys, dict):
        cfg.api_keys = {}
    return cfg


def save(cfg: Config) -> str:
    path = config_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(asdict(cfg), f, ensure_ascii=False, indent=2)
    return path
