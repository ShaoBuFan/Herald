from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Protocol

from .errors import InvalidModelResponseError
from .models import ModelRequest, ModelResponse, ModelTurn
from .parser import parse_response
from .protocol import render_protocol, render_retry_hint


@dataclass(frozen=True)
class TextModelRequest(ModelRequest):
    """Text-client request: the semantic request plus the protocol text."""

    protocol: str = ""


class TextChatClient(Protocol):
    """A transport client that returns raw text for one request."""

    def complete(self, request: TextModelRequest) -> ModelResponse:
        ...


class TextProtocolAdapter:
    """Codec adapter between the semantic transcript and the text JSON protocol.

    The wrapped client owns transport only; this adapter owns the protocol
    text, rendering, parsing, and model-facing retry feedback.
    """

    def __init__(self, client: TextChatClient) -> None:
        self.client = client

    def complete(self, request: ModelRequest) -> ModelTurn:
        has_tools = bool(request.tools)
        text_request = TextModelRequest(
            messages=self._render_messages(request.messages),
            system=request.system,
            tools=request.tools,
            protocol=render_protocol(has_tools),
        )
        response = self.client.complete(text_request)
        try:
            parsed = parse_response(response.text)
        except InvalidModelResponseError as error:
            error.feedback = render_retry_hint(error, has_tools)
            error.raw_text = response.text
            raise

        if parsed.kind == "final":
            return ModelTurn(
                content=parsed.final or "",
                thought=parsed.thought,
                tool_calls=(),
                usage=response.usage,
                raw=response.raw,
                recovered=parsed.recovered,
            )
        return ModelTurn(
            content="",
            thought=parsed.thought,
            tool_calls=parsed.tool_calls,
            usage=response.usage,
            raw=response.raw,
            recovered=parsed.recovered,
        )

    @classmethod
    def _render_messages(cls, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        rendered: list[dict[str, Any]] = []
        index = 0
        while index < len(messages):
            message = messages[index]
            role = message.get("role")
            if role == "user":
                rendered.append(
                    {"role": "user", "content": str(message.get("content", ""))}
                )
                index += 1
            elif role == "assistant":
                rendered.append(cls._render_assistant(message))
                index += 1
            elif role == "tool":
                results: list[dict[str, Any]] = []
                while index < len(messages) and messages[index].get("role") == "tool":
                    tool_message = messages[index]
                    result = {
                        "id": str(tool_message.get("tool_call_id", "")),
                        "tool": str(tool_message.get("name", "")),
                        "data": tool_message.get("data"),
                    }
                    if tool_message.get("error"):
                        result["error"] = str(tool_message["error"])
                    results.append(result)
                    index += 1
                rendered.append(
                    {
                        "role": "user",
                        "content": json.dumps(
                            {"type": "tool_result", "results": results},
                            ensure_ascii=False,
                        ),
                    }
                )
            else:
                index += 1
        return rendered

    @classmethod
    def _render_assistant(cls, message: dict[str, Any]) -> dict[str, Any]:
        content = str(message.get("content", ""))
        if message.get("raw"):
            return {"role": "assistant", "content": content}

        thought = str(message.get("thought", "") or "")
        tool_calls = message.get("tool_calls") or []
        if tool_calls:
            payload = {
                "thought": thought or content or "调用工具",
                "tool_calls": [
                    {
                        "id": str(call.get("id", "")),
                        "tool": str(call.get("name", "")),
                        "arguments": call.get("arguments") or {},
                    }
                    for call in tool_calls
                ],
            }
        else:
            payload = {
                "thought": thought or "完成",
                "final": content,
            }
        return {
            "role": "assistant",
            "content": json.dumps(payload, ensure_ascii=False),
        }
