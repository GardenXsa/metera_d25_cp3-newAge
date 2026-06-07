"""Registry: maps provider IDs to their classes and default models.

Adding a new provider = register it here. The CLI uses this list both
to validate ``--provider`` arguments and to expose ``modkit providers``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from modkit.providers.anthropic import AnthropicProvider
from modkit.providers.base import Provider
from modkit.providers.dummy import DummyProvider
from modkit.providers.gemini import GeminiProvider
from modkit.providers.openai import OpenAIProvider


@dataclass
class ProviderSpec:
    id: str
    name: str
    cls: type[Provider]
    default_model: str
    default_base_url: str = ""
    requires_api_key: bool = True


PROVIDERS: dict[str, ProviderSpec] = {
    "openai": ProviderSpec(
        id="openai",
        name="OpenAI",
        cls=OpenAIProvider,
        default_model="gpt-4o-mini",
        default_base_url="https://api.openai.com/v1/chat/completions",
    ),
    "anthropic": ProviderSpec(
        id="anthropic",
        name="Anthropic Claude",
        cls=AnthropicProvider,
        default_model="claude-3-5-sonnet-20241022",
        default_base_url="https://api.anthropic.com/v1/messages",
    ),
    "gemini": ProviderSpec(
        id="gemini",
        name="Google Gemini",
        cls=GeminiProvider,
        default_model="gemini-2.5-flash",
        default_base_url="",
    ),
    "openrouter": ProviderSpec(
        id="openrouter",
        name="OpenRouter",
        cls=OpenAIProvider,
        default_model="anthropic/claude-3.5-sonnet",
        default_base_url="https://openrouter.ai/api/v1/chat/completions",
    ),
    "deepseek": ProviderSpec(
        id="deepseek",
        name="DeepSeek",
        cls=OpenAIProvider,
        default_model="deepseek-chat",
        default_base_url="https://api.deepseek.com/v1/chat/completions",
    ),
    "groq": ProviderSpec(
        id="groq",
        name="Groq",
        cls=OpenAIProvider,
        default_model="llama-3.3-70b-versatile",
        default_base_url="https://api.groq.com/openai/v1/chat/completions",
    ),
    "mistral": ProviderSpec(
        id="mistral",
        name="Mistral AI",
        cls=OpenAIProvider,
        default_model="mistral-large-latest",
        default_base_url="https://api.mistral.ai/v1/chat/completions",
    ),
    "together": ProviderSpec(
        id="together",
        name="Together AI",
        cls=OpenAIProvider,
        default_model="meta-llama/Llama-3.3-70B-Instruct-Turbo",
        default_base_url="https://api.together.xyz/v1/chat/completions",
    ),
    "fireworks": ProviderSpec(
        id="fireworks",
        name="Fireworks AI",
        cls=OpenAIProvider,
        default_model="accounts/fireworks/models/llama-v3p3-70b-instruct",
        default_base_url="https://api.fireworks.ai/inference/v1/chat/completions",
    ),
    "cohere": ProviderSpec(
        id="cohere",
        name="Cohere",
        cls=OpenAIProvider,
        default_model="command-a-03-2025",
        default_base_url="https://api.cohere.com/compatibility/v1/chat/completions",
    ),
    "llmost": ProviderSpec(
        id="llmost",
        name="LLMost",
        cls=OpenAIProvider,
        default_model="openai/gpt-4o-mini",
        default_base_url="https://llmost.ru/api/v1/chat/completions",
    ),

    "local": ProviderSpec(
        id="local",
        name="Local LLM (LM Studio / Ollama / vLLM)",
        cls=OpenAIProvider,
        default_model="local-model",
        default_base_url="http://localhost:1234/v1/chat/completions",
        requires_api_key=False,
    ),
    "custom": ProviderSpec(
        id="custom",
        name="Custom OpenAI-compatible endpoint",
        cls=OpenAIProvider,
        default_model="",
        default_base_url="",
        requires_api_key=False,
    ),
    "dummy": ProviderSpec(
        id="dummy",
        name="Dummy (offline test stub)",
        cls=DummyProvider,
        default_model="dummy-modkit",
        default_base_url="",
        requires_api_key=False,
    ),
}


def list_providers() -> list[ProviderSpec]:
    return list(PROVIDERS.values())


def get_spec(provider_id: str) -> ProviderSpec:
    spec = PROVIDERS.get(provider_id)
    if spec is None:
        raise ValueError(
            f"Unknown provider '{provider_id}'. Known: {', '.join(sorted(PROVIDERS))}"
        )
    return spec


def build_provider(
    provider_id: str,
    *,
    api_key: str = "",
    model: str = "",
    base_url: str = "",
    temperature: float = 0.4,
    max_tokens: int = 4096,
    timeout: int = 120,
) -> Provider:
    spec = get_spec(provider_id)
    chosen_model = model or spec.default_model
    chosen_url = base_url or spec.default_base_url
    return spec.cls(
        api_key=api_key,
        model=chosen_model,
        base_url=chosen_url,
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=timeout,
    )
