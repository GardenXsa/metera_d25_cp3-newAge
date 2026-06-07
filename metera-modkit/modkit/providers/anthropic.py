"""Anthropic Messages API provider.

https://docs.anthropic.com/en/api/messages

We translate our common Message/ToolCall format into Anthropic's
``content`` blocks (text, tool_use, tool_result).
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from modkit.providers.base import (
    AssistantTurn,
    Message,
    Provider,
    ProviderError,
    ToolCall,
    ToolDef,
)
from modkit.providers.http import post_json


DEFAULT_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"


class AnthropicProvider(Provider):
    id = "anthropic"

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        if not self.base_url:
            self.base_url = DEFAULT_URL

    def chat(
        self,
        messages: list[Message],
        *,
        tools: list[ToolDef] | None = None,
        system: str | None = None,
    ) -> AssistantTurn:
        anthropic_messages = self._convert_messages(messages)
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": anthropic_messages,
            "max_tokens": self.max_tokens,
            "temperature": self.temperature,
        }
        if system:
            payload["system"] = system
        if tools:
            payload["tools"] = [self._tool_to_anthropic(t) for t in tools]

        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": ANTHROPIC_VERSION,
        }
        status, body = post_json(self.base_url, headers, payload, timeout=self.timeout)
        if status >= 400:
            raise ProviderError(f"{self.id} HTTP {status}: {self._format_error(body)}")

        return self._parse_response(body)

    def get_models(self) -> list[str]:
        from modkit.providers.http import get_json
        url = "https://api.anthropic.com/v1/models"
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": ANTHROPIC_VERSION,
        }
        status, body = get_json(url, headers, timeout=self.timeout)
        if status >= 400:
            return ["claude-3-5-sonnet-20241022", "claude-3-opus-20240229", "claude-3-haiku-20240307"]
        return [m.get("id") for m in body.get("data", []) if m.get("id")]

    # ── conversion helpers ────────────────────────────────────────────

    def _convert_messages(self, messages: list[Message]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        i = 0
        while i < len(messages):
            msg = messages[i]
            if msg.role == "system":
                # System should be passed via top-level 'system' param.
                i += 1
                continue

            if msg.role == "tool":
                # Anthropic packs tool results into a user message with
                # tool_result content blocks.
                results_block: list[dict[str, Any]] = []
                while i < len(messages) and messages[i].role == "tool":
                    tool_msg = messages[i]
                    results_block.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_msg.tool_call_id,
                            "content": tool_msg.content,
                        }
                    )
                    i += 1
                out.append({"role": "user", "content": results_block})
                continue

            if msg.role == "assistant":
                blocks: list[dict[str, Any]] = []
                if msg.content:
                    blocks.append({"type": "text", "text": msg.content})
                for call in msg.tool_calls:
                    blocks.append(
                        {
                            "type": "tool_use",
                            "id": call.id,
                            "name": call.name,
                            "input": call.arguments or {},
                        }
                    )
                if not blocks:
                    blocks = [{"type": "text", "text": ""}]
                out.append({"role": "assistant", "content": blocks})
            elif msg.role == "user":
                out.append({"role": "user", "content": msg.content or ""})
            i += 1
        return out

    @staticmethod
    def _tool_to_anthropic(tool: ToolDef) -> dict[str, Any]:
        return {
            "name": tool.name,
            "description": tool.description,
            "input_schema": tool.parameters,
        }

    def _parse_response(self, body: dict[str, Any]) -> AssistantTurn:

        if not isinstance(body, dict):
            raise ProviderError(f"{self.id}: expected JSON object, got {type(body).__name__}: {self._format_error(body)}")
        if "error" in body and "content" not in body:
            raise ProviderError(f"{self.id}: {self._format_error(body)}")
        text_parts: list[str] = []
        tool_calls: list[ToolCall] = []
        for block in body.get("content") or []:
            if not isinstance(block, dict):
                continue
            btype = block.get("type")
            if btype == "text":
                text_parts.append(str(block.get("text") or ""))
            elif btype == "tool_use":
                tool_calls.append(
                    ToolCall(
                        id=str(block.get("id") or f"call_{uuid.uuid4().hex[:8]}"),
                        name=str(block.get("name") or ""),
                        arguments=block.get("input") or {},
                    )
                )
        return AssistantTurn(text="".join(text_parts), tool_calls=tool_calls)

    @staticmethod
    def _format_error(body: Any) -> str:
        if isinstance(body, dict):
            if "_raw" in body:
                raw = str(body["_raw"])
                if "<html" in raw.lower() or "<!doctype html>" in raw.lower():
                    return "Провайдер вернул HTML-страницу с ошибкой (проверь Base URL и доступность сервиса)."
                return raw[:500]
            err = body.get("error") or body
            if isinstance(err, dict):
                return err.get("message") or json.dumps(err, ensure_ascii=False)[:500]
            return str(err)[:500]
        return str(body)[:500]
