"""Provider-agnostic message and tool types + the abstract Provider class.

All providers translate this shared shape into their native API call
format. The agent loop only knows about these types.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Any


class ProviderError(Exception):
    """Raised when an LLM call fails (HTTP error, bad JSON, etc.)."""


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]
    # Optional provider-specific opaque blob. Gemini 2.5+ uses this to
    # carry the model's encrypted "thought signature" between turns;
    # it MUST be sent back in the next request's functionCall content part,
    # otherwise Gemini rejects the conversation with HTTP 400.
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "arguments": self.arguments,
            "extra": self.extra,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ToolCall":
        return cls(
            id=data.get("id", ""),
            name=data.get("name", ""),
            arguments=data.get("arguments", {}),
            extra=data.get("extra", {})
        )


@dataclass
class Message:
    """Provider-agnostic chat message.

    For role=="tool", ``tool_call_id`` identifies which tool call this
    message answers and ``content`` is the JSON-serialized result.
    """

    role: str  # "system" | "user" | "assistant" | "tool"
    content: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    tool_call_id: str = ""
    name: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "role": self.role,
            "content": self.content,
            "tool_calls": [tc.to_dict() for tc in self.tool_calls],
            "tool_call_id": self.tool_call_id,
            "name": self.name,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Message":
        return cls(
            role=data.get("role", "user"),
            content=data.get("content", ""),
            tool_calls=[ToolCall.from_dict(tc) for tc in data.get("tool_calls", [])],
            tool_call_id=data.get("tool_call_id", ""),
            name=data.get("name", "")
        )


@dataclass
class ToolDef:
    name: str
    description: str
    parameters: dict[str, Any]


@dataclass
class AssistantTurn:
    text: str
    tool_calls: list[ToolCall] = field(default_factory=list)


class Provider(abc.ABC):
    """All concrete providers (OpenAI / Anthropic / Gemini / local / dummy) inherit this."""

    id: str = "base"

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        base_url: str = "",
        temperature: float = 0.4,
        max_tokens: int = 4096,
        timeout: int = 120,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.base_url = base_url
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.timeout = timeout

    @abc.abstractmethod
    def chat(
        self,
        messages: list[Message],
        *,
        tools: list[ToolDef] | None = None,
        system: str | None = None,
    ) -> AssistantTurn:
        """Single round-trip. Returns the assistant turn."""

    def supports_tools(self) -> bool:  # noqa: D401 - simple flag
        return True

    def get_models(self) -> list[str]:
        """Fetch available models from the provider."""
        return []

    def ping(self) -> str:
        """Send a minimal request with a dummy tool to verify tool support and connectivity."""
        try:
            self.chat(
                messages=[Message(role="user", content="ping")],
                tools=[ToolDef(name="ping_tool", description="A dummy tool for pinging.", parameters={"type": "object", "properties": {}})],
                system="You are a ping bot. Call the ping_tool immediately."
            )
            return "OK"
        except Exception as exc:
            raise ProviderError(f"Ping failed: {exc}") from exc
