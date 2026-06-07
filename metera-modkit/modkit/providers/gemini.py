"""Google Gemini API provider.

https://ai.google.dev/api/rest/v1beta/models/generateContent

Gemini uses ``contents`` with ``parts`` (text / functionCall /
functionResponse). System instruction sits at the top level.
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


BASE = "https://generativelanguage.googleapis.com/v1beta/models"


# Gemini's ``functionDeclarations.parameters`` schema is a strict subset of
# JSON Schema / OpenAPI 3.0 — it rejects fields OpenAI's strict mode happily
# accepts (most notably ``additionalProperties``). Strip them recursively so
# tool calls work against Gemini without rewriting every tool definition.
_UNSUPPORTED_SCHEMA_KEYS = {
    "additionalProperties",
    "$schema",
    "title",
    "default",
    "examples",
    "$id",
    "$ref",
    "definitions",
    "patternProperties",
}


def _strip_unsupported_schema_fields(node: Any) -> Any:
    if isinstance(node, dict):
        cleaned: dict[str, Any] = {}
        for k, v in node.items():
            if k in _UNSUPPORTED_SCHEMA_KEYS:
                continue
            cleaned[k] = _strip_unsupported_schema_fields(v)
        return cleaned
    if isinstance(node, list):
        return [_strip_unsupported_schema_fields(x) for x in node]
    return node


class GeminiProvider(Provider):
    id = "gemini"

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        # base_url is built per-request because Gemini puts the model in the path.

    def chat(
        self,
        messages: list[Message],
        *,
        tools: list[ToolDef] | None = None,
        system: str | None = None,
    ) -> AssistantTurn:
        contents = self._convert_messages(messages)
        payload: dict[str, Any] = {
            "contents": contents,
            "generationConfig": {
                "temperature": self.temperature,
                "maxOutputTokens": self.max_tokens,
            },
        }
        if system:
            payload["systemInstruction"] = {"parts": [{"text": system}]}
        if tools:
            payload["tools"] = [
                {"functionDeclarations": [self._tool_to_gemini(t) for t in tools]}
            ]
        url = self.base_url or f"{BASE}/{self.model}:generateContent"
        if "?" not in url and self.api_key:
            url = f"{url}?key={self.api_key}"
        status, body = post_json(url, {}, payload, timeout=self.timeout)
        if status >= 400:
            raise ProviderError(f"{self.id} HTTP {status}: {self._format_error(body)}")
        return self._parse_response(body)

    def get_models(self) -> list[str]:
        from modkit.providers.http import get_json
        url = f"https://generativelanguage.googleapis.com/v1beta/models?key={self.api_key}"
        status, body = get_json(url, {}, timeout=self.timeout)
        if status >= 400:
            raise ProviderError(f"Failed to fetch models: {self._format_error(body)}")
        models = []
        for m in body.get("models", []):
            methods = m.get("supportedGenerationMethods", [])
            if "generateContent" in methods:
                name = m.get("name", "").replace("models/", "")
                models.append(name)
        return models

    # ── conversion helpers ────────────────────────────────────────────

    def _convert_messages(self, messages: list[Message]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        i = 0
        while i < len(messages):
            msg = messages[i]
            if msg.role == "system":
                i += 1
                continue
            if msg.role == "tool":
                parts: list[dict[str, Any]] = []
                while i < len(messages) and messages[i].role == "tool":
                    tm = messages[i]
                    response_payload: Any
                    try:
                        response_payload = json.loads(tm.content)
                    except (json.JSONDecodeError, TypeError):
                        response_payload = {"content": tm.content}
                    parts.append(
                        {
                            "functionResponse": {
                                "name": tm.name or "tool",
                                "response": response_payload
                                if isinstance(response_payload, dict)
                                else {"content": response_payload},
                            }
                        }
                    )
                    i += 1
                out.append({"role": "user", "parts": parts})
                continue
            if msg.role == "assistant":
                parts = []
                if msg.content:
                    parts.append({"text": msg.content})
                for call in msg.tool_calls:
                    fc: dict[str, Any] = {
                        "name": call.name,
                        "args": call.arguments or {},
                    }
                    part: dict[str, Any] = {"functionCall": fc}
                    sig = call.extra.get("thought_signature") if call.extra else None
                    if sig:
                        part["thoughtSignature"] = sig
                    parts.append(part)
                if not parts:
                    parts = [{"text": ""}]
                out.append({"role": "model", "parts": parts})
            else:  # user
                out.append({"role": "user", "parts": [{"text": msg.content or ""}]})
            i += 1
        return out

    @staticmethod
    def _tool_to_gemini(tool: ToolDef) -> dict[str, Any]:
        params = tool.parameters or {"type": "object", "properties": {}}
        return {
            "name": tool.name,
            "description": tool.description,
            "parameters": _strip_unsupported_schema_fields(params),
        }

    def _parse_response(self, body: dict[str, Any]) -> AssistantTurn:

        if not isinstance(body, dict):
            raise ProviderError(f"{self.id}: expected JSON object, got {type(body).__name__}: {self._format_error(body)}")
        candidates = body.get("candidates") or []
        if not candidates:
            raise ProviderError(f"{self.id}: no candidates in response: {self._format_error(body)}")
        first = candidates[0]
        text_parts: list[str] = []
        tool_calls: list[ToolCall] = []
        for part in (first.get("content") or {}).get("parts") or []:
            if not isinstance(part, dict):
                continue
            if "text" in part and part["text"]:
                text_parts.append(str(part["text"]))
            elif "functionCall" in part:
                fc = part["functionCall"]
                extra: dict[str, Any] = {}
                sig = part.get("thought_signature") or part.get("thoughtSignature")
                if sig:
                    extra["thought_signature"] = sig
                tool_calls.append(
                    ToolCall(
                        id=f"call_{uuid.uuid4().hex[:8]}",
                        name=str(fc.get("name") or ""),
                        arguments=fc.get("args") or {},
                        extra=extra,
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
