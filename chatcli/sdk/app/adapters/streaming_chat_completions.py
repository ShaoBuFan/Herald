from __future__ import annotations

import json
from collections.abc import Callable

from sdk.agent_sdk import (
    InvalidModelResponseError,
    ModelAdapterError,
    ModelRequest,
    ModelTurn,
)

from .openai_common import (
    DEFAULT_TIMEOUT,
    StreamTransport,
    build_payload,
    chat_completions_url,
    http_stream_lines,
    parse_native_tool_calls,
    request_headers,
    resolve_config,
)


class StreamingChatCompletionsModel:
    """OpenAI-compatible streaming Chat Completions adapter.

    Streaming is a transport/display concern: content deltas are delivered to
    the app through ``on_delta``, while the SDK receives only the fully
    assembled ModelTurn. Tool call argument fragments are reassembled here.
    """

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
        on_delta: Callable[[str], None] | None = None,
        on_reasoning_delta: Callable[[str], None] | None = None,
        transport: StreamTransport | None = None,
        timeout: int = DEFAULT_TIMEOUT,
    ) -> None:
        self.base_url, self.api_key, self.model = resolve_config(
            base_url, api_key, model
        )
        self.on_delta = on_delta
        self.on_reasoning_delta = on_reasoning_delta
        self.timeout = timeout
        self.transport = transport or (
            lambda url, headers, payload: http_stream_lines(
                url, headers, payload, self.timeout
            )
        )

    def complete(self, request: ModelRequest) -> ModelTurn:
        payload = build_payload(self.model, request, stream=True)

        content_parts: list[str] = []
        thought_parts: list[str] = []
        calls: dict[int, dict[str, str]] = {}
        usage = None
        finish_reason = None

        for line in self.transport(
            chat_completions_url(self.base_url),
            request_headers(self.api_key, stream=True),
            payload,
        ):
            if not line or line.startswith(":"):
                continue
            if not line.startswith("data:"):
                continue

            data_text = line[5:].strip()
            if data_text == "[DONE]":
                break
            try:
                chunk = json.loads(data_text)
            except json.JSONDecodeError as exc:
                raise ModelAdapterError(
                    f"invalid SSE chunk: {data_text[:200]}"
                ) from exc

            if chunk.get("error"):
                raise ModelAdapterError(
                    json.dumps(chunk["error"], ensure_ascii=False)
                )

            usage = chunk.get("usage") or usage
            choices = chunk.get("choices") or []
            if not choices:
                continue

            choice = choices[0] or {}
            finish_reason = choice.get("finish_reason") or finish_reason
            delta = choice.get("delta") or {}

            content_delta = delta.get("content")
            if isinstance(content_delta, str) and content_delta:
                content_parts.append(content_delta)
                if self.on_delta is not None:
                    self.on_delta(content_delta)

            reasoning_delta = delta.get("reasoning_content")
            if isinstance(reasoning_delta, str) and reasoning_delta:
                thought_parts.append(reasoning_delta)
                if self.on_reasoning_delta is not None:
                    self.on_reasoning_delta(reasoning_delta)

            for raw_call in delta.get("tool_calls") or []:
                index = raw_call.get("index", 0)
                entry = calls.setdefault(
                    index, {"id": "", "name": "", "arguments": ""}
                )
                if raw_call.get("id"):
                    entry["id"] = str(raw_call["id"])
                function = raw_call.get("function") or {}
                if function.get("name"):
                    entry["name"] = str(function["name"])
                arguments_delta = function.get("arguments")
                if isinstance(arguments_delta, str):
                    entry["arguments"] += arguments_delta

        native_calls = [
            {
                "id": entry["id"] or str(index),
                "type": "function",
                "function": {
                    "name": entry["name"],
                    "arguments": entry["arguments"] or "{}",
                },
            }
            for index, entry in sorted(calls.items())
        ]

        content = "".join(content_parts)
        thought = "".join(thought_parts)
        try:
            tool_calls = parse_native_tool_calls(native_calls)
        except InvalidModelResponseError as error:
            if not error.raw_text:
                error.raw_text = json.dumps(
                    {"content": content, "tool_calls": native_calls},
                    ensure_ascii=False,
                )
            raise
        if not content.strip() and not tool_calls:
            raise InvalidModelResponseError(
                "stream ended without content or tool calls",
                code="empty_response",
                feedback="你上一条回复为空，请重新回答。",
                raw_text=content,
            )

        return ModelTurn(
            content=content,
            thought=thought,
            tool_calls=tool_calls,
            usage=usage,
            raw={"finish_reason": finish_reason} if finish_reason else None,
        )
