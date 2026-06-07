"""OpenAI Chat Completions provider.

Also serves all OpenAI-compatible endpoints: OpenRouter, Groq, Mistral,
Together, Fireworks, DeepSeek, Cohere (compat), LM Studio, Ollama,
custom endpoints.

Tool-call format = OpenAI ``tool_calls`` with function definitions.
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


DEFAULT_URL = "https://api.openai.com/v1/chat/completions"


class OpenAIProvider(Provider):
    id = "openai"

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
        payload: dict[str, Any] = {
            "model": self.model,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "messages": self._convert_messages(messages, system),
        }
        if tools:
            payload["tools"] = [self._tool_to_openai(t) for t in tools]

        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        status, body = post_json(self.base_url, headers, payload, timeout=self.timeout)
        if status >= 400:
            raise ProviderError(f"{self.id} HTTP {status}: {self._format_error(body)}")

        return self._parse_response(body)

    def get_models(self) -> list[str]:
        from modkit.providers.http import get_json
        url = self.base_url.split("/chat/completions")[0]
        if not url.endswith("/v1") and "openrouter" not in url:
            url = url.rstrip("/") + "/v1"
        if "openrouter" in url and not url.endswith("/models"):
            url = "https://openrouter.ai/api/v1/models"
        elif not url.endswith("/models"):
            url = url + "/models"
            
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        status, body = get_json(url, headers, timeout=self.timeout)
        if status >= 400:
            raise ProviderError(f"Failed to fetch models: {self._format_error(body)}")
        
        models = []
        for m in body.get("data", []):
            id_str = m.get("id", "")
            if "embedding" in id_str.lower() or "vision" in id_str.lower():
                continue
            models.append(id_str)
        return models

    # ── conversion helpers ────────────────────────────────────────────

    def _convert_messages(self, messages: list[Message], system: str | None) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        if system:
            result.append({"role": "system", "content": system})
        for msg in messages:
            if msg.role == "tool":
                result.append(
                    {
                        "role": "tool",
                        "tool_call_id": msg.tool_call_id,
                        "name": msg.name,
                        "content": msg.content,
                    }
                )
                continue
            if msg.role == "assistant" and msg.tool_calls:
                openai_calls = []
                for call in msg.tool_calls:
                    openai_calls.append(
                        {
                            "id": call.id,
                            "type": "function",
                            "function": {
                                "name": call.name,
                                "arguments": json.dumps(call.arguments, ensure_ascii=False),
                            },
                        }
                    )
                entry: dict[str, Any] = {"role": "assistant", "tool_calls": openai_calls}
                if msg.content:
                    entry["content"] = msg.content
                result.append(entry)
                continue
            result.append({"role": msg.role, "content": msg.content})
        return result

    @staticmethod
    def _tool_to_openai(tool: ToolDef) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
            },
        }

    def _parse_response(self, body: dict[str, Any]) -> AssistantTurn:

        if not isinstance(body, dict):
            raise ProviderError(f"{self.id}: expected JSON object, got {type(body).__name__}: {self._format_error(body)}")
        if "error" in body:
            raise ProviderError(f"{self.id}: {body['error']}")
        choices = body.get("choices") or []
        if not choices:
            raise ProviderError(f"{self.id}: empty choices in response")
        message = choices[0].get("message", {})
        text = message.get("content") or ""
        if isinstance(text, list):
            # Some compat providers return content as list[parts]
            text = "".join(
                part.get("text", "")
                for part in text
                if isinstance(part, dict) and part.get("type") == "text"
            )
        tool_calls: list[ToolCall] = []
        for call in message.get("tool_calls") or []:
            fn = call.get("function", {}) if isinstance(call, dict) else {}
            args_raw = fn.get("arguments", "{}")
            if isinstance(args_raw, str):
                try:
                    args = json.loads(args_raw or "{}")
                except json.JSONDecodeError:
                    args = {"_raw": args_raw}
            elif isinstance(args_raw, dict):
                args = args_raw
            else:
                args = {}
            tool_calls.append(
                ToolCall(
                    id=str(call.get("id") or f"call_{uuid.uuid4().hex[:8]}"),
                    name=str(fn.get("name") or ""),
                    arguments=args,
                )
            )
        return AssistantTurn(text=text or "", tool_calls=tool_calls)

    @staticmethod
    def _format_error(body: Any) -> str:
        if isinstance(body, dict):
            if "_raw" in body:
                raw = str(body["_raw"])
                if "<html" in raw.lower() or "<!doctype html>" in raw.lower():
                    return "Провайдер вернул HTML-страницу с ошибкой (проверь Base URL и доступность сервиса)."
                return raw[:500]
            err = body.get("error")
            if isinstance(err, dict):
                return err.get("message") or json.dumps(err, ensure_ascii=False)[:500]
            if isinstance(err, str):
                return err
            return json.dumps(body, ensure_ascii=False)[:500]
        return str(body)[:500]
