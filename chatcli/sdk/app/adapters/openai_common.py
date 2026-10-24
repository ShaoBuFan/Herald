from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from collections.abc import Callable, Iterator
from typing import Any

from sdk.agent_sdk import (
    InvalidModelResponseError,
    ModelAdapterError,
    ModelRequest,
    ModelTurn,
    ToolCall,
)


DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_TIMEOUT = 240

JsonTransport = Callable[[str, dict[str, str], dict[str, Any]], dict[str, Any]]
StreamTransport = Callable[[str, dict[str, str], dict[str, Any]], Iterator[str]]


def resolve_config(
    base_url: str | None = None,
    api_key: str | None = None,
    model: str | None = None,
) -> tuple[str, str, str]:
    resolved_base = (
        base_url or os.environ.get("OPENAI_BASE_URL") or DEFAULT_BASE_URL
    ).rstrip("/")
    resolved_key = api_key or os.environ.get("OPENAI_API_KEY")
    resolved_model = model or os.environ.get("OPENAI_MODEL")
    if not resolved_key:
        raise ValueError("OPENAI_API_KEY is required (or pass api_key=...)")
    if not resolved_model:
        raise ValueError("OPENAI_MODEL is required (or pass model=...)")
    return resolved_base, resolved_key, resolved_model


def chat_completions_url(base_url: str) -> str:
    return f"{base_url}/chat/completions"


def request_headers(api_key: str, stream: bool = False) -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "Accept": "text/event-stream" if stream else "application/json",
    }


def render_messages(
    messages: list[dict[str, Any]], system: str
) -> list[dict[str, Any]]:
    rendered: list[dict[str, Any]] = []
    if system.strip():
        rendered.append({"role": "system", "content": system})

    for message in messages:
        role = message.get("role")
        if role == "user":
            rendered.append(
                {"role": "user", "content": str(message.get("content", ""))}
            )
        elif role == "assistant":
            content = str(message.get("content", "") or "")
            tool_calls = message.get("tool_calls") or []
            if tool_calls:
                rendered.append(
                    {
                        "role": "assistant",
                        "content": content or None,
                        "tool_calls": [
                            {
                                "id": str(call.get("id", "")),
                                "type": "function",
                                "function": {
                                    "name": str(call.get("name", "")),
                                    "arguments": json.dumps(
                                        call.get("arguments") or {},
                                        ensure_ascii=False,
                                    ),
                                },
                            }
                            for call in tool_calls
                        ],
                    }
                )
            else:
                rendered.append({"role": "assistant", "content": content})
        elif role == "tool":
            payload: dict[str, Any] = {"data": message.get("data")}
            if message.get("error"):
                payload["error"] = str(message["error"])
            rendered.append(
                {
                    "role": "tool",
                    "tool_call_id": str(message.get("tool_call_id", "")),
                    "content": json.dumps(payload, ensure_ascii=False),
                }
            )
    return rendered


def render_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": str(tool.get("name", "")),
                "description": str(tool.get("description", "")),
                "parameters": tool.get(
                    "parameters", {"type": "object", "properties": {}}
                ),
            },
        }
        for tool in tools
    ]


def build_payload(
    model: str, request: ModelRequest, *, stream: bool
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "messages": render_messages(request.messages, request.system),
    }
    tools = render_tools(request.tools)
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    if stream:
        payload["stream"] = True
    return payload


def parse_native_tool_calls(raw_calls: list[Any]) -> tuple[ToolCall, ...]:
    calls: list[ToolCall] = []
    for index, raw_call in enumerate(raw_calls):
        if not isinstance(raw_call, dict):
            raise InvalidModelResponseError(
                f"tool_calls[{index}] must be an object",
                code="invalid_tool_calls",
                feedback="上一轮工具调用格式不合法，请重新调用工具。",
            )
        function = raw_call.get("function") or {}
        name = function.get("name")
        if not isinstance(name, str) or not name.strip():
            raise InvalidModelResponseError(
                f"tool_calls[{index}] missing function name",
                code="invalid_tool_calls",
                feedback="上一轮工具调用缺少函数名，请重新调用工具。",
            )
        arguments_value = function.get("arguments", "{}")
        if isinstance(arguments_value, dict):
            arguments = arguments_value
        else:
            try:
                arguments = json.loads(arguments_value or "{}")
            except (TypeError, ValueError) as exc:
                raise InvalidModelResponseError(
                    f"tool_calls[{index}] arguments is not valid JSON: {exc}",
                    code="invalid_tool_calls",
                    feedback=(
                        "上一轮工具调用的 arguments 不是合法 JSON 对象，"
                        "请重新调用工具并给出合法参数。"
                    ),
                ) from exc
        if not isinstance(arguments, dict):
            raise InvalidModelResponseError(
                f"tool_calls[{index}] arguments must be an object",
                code="invalid_tool_calls",
                feedback=(
                    "上一轮工具调用的 arguments 不是 JSON 对象，"
                    "请重新调用工具并给出合法参数。"
                ),
            )
        calls.append(
            ToolCall(
                id=str(raw_call.get("id") or index),
                name=name.strip(),
                arguments=arguments,
            )
        )
    return tuple(calls)


def turn_from_chat_response(data: dict[str, Any]) -> ModelTurn:
    choices = data.get("choices") or []
    if not isinstance(choices, list) or not choices:
        raise InvalidModelResponseError(
            "response has no choices",
            code="empty_response",
            feedback="模型没有返回任何结果，请重新回答。",
        )
    message = (choices[0] or {}).get("message") or {}
    if not isinstance(message, dict):
        raise InvalidModelResponseError(
            "response message is not an object",
            code="empty_response",
            feedback="模型返回的消息格式不合法，请重新回答。",
        )

    content_value = message.get("content")
    if isinstance(content_value, list):
        content = "".join(
            str(part.get("text", ""))
            for part in content_value
            if isinstance(part, dict)
        )
    elif isinstance(content_value, str):
        content = content_value
    else:
        content = ""

    thought_value = message.get("reasoning_content") or ""
    thought = thought_value if isinstance(thought_value, str) else ""

    try:
        tool_calls = parse_native_tool_calls(message.get("tool_calls") or [])
    except InvalidModelResponseError as error:
        if not error.raw_text:
            error.raw_text = json.dumps(
                {"message": message}, ensure_ascii=False
            )
        raise
    if not content.strip() and not tool_calls:
        raise InvalidModelResponseError(
            "assistant message is empty",
            code="empty_response",
            feedback="你上一条回复为空，请重新回答。",
        )

    return ModelTurn(
        content=content,
        thought=thought,
        tool_calls=tool_calls,
        usage=data.get("usage"),
        raw=data,
    )


def http_post_json(
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any],
    timeout: int = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url, data=body, headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ModelAdapterError(
            f"HTTP {exc.code}: {detail[:500]}"
        ) from exc
    except urllib.error.URLError as exc:
        raise ModelAdapterError(f"request failed: {exc.reason}") from exc


def http_stream_lines(
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any],
    timeout: int = DEFAULT_TIMEOUT,
) -> Iterator[str]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url, data=body, headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            for raw_line in response:
                yield raw_line.decode("utf-8", errors="replace").rstrip("\r\n")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ModelAdapterError(
            f"HTTP {exc.code}: {detail[:500]}"
        ) from exc
    except urllib.error.URLError as exc:
        raise ModelAdapterError(f"request failed: {exc.reason}") from exc
