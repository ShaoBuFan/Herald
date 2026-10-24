"""Mattermost 适配器：直接实现 ModelAdapter，并自带文本 JSON 协议。

Mattermost 的 chat 插件只交换 {role, content}——没有原生工具调用，
所以「教模型说协议、解析它的回复、把历史渲染回协议文本」整套适配
都归本模块。SDK 只提供 ModelAdapter 契约与语义类型；transport
可注入，是离线测试的接缝。
"""

from __future__ import annotations

import json
import re
import time
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

from sdk.agent_sdk import (
    InvalidModelResponseError,
    ModelRequest,
    ModelTurn,
    ToolCall,
)


# ---------------------------------------------------------------------------
# 协议文本
# ---------------------------------------------------------------------------

FINAL_EXAMPLE = '{"thought": "已经掌握足够信息。", "final": "这是最终回答。"}'

TOOL_CALL_EXAMPLE = (
    '{"thought": "需要先查看 README。", '
    '"tool_calls": [{"id": "call_1", "tool": "read_file", '
    '"arguments": {"path": "README.md"}}]}'
)

TOOL_RESULT_EXAMPLE = (
    '{"type": "tool_result", "results": [{"id": "call_1", '
    '"tool": "read_file", "data": {"content": "..."}}]}'
)

_JSON_ONLY = (
    "你是一个工具调用型 Agent。每次回复必须是一个合法 JSON 对象，"
    "只输出 JSON 本身：不要 Markdown 代码块，不要在对象前后添加任何文字。"
)

_FINAL_FORM = (
    "直接回答时使用：\n"
    '{"thought": "<非空字符串，说明你的判断过程>", '
    '"final": "<非空字符串，给用户的最终回答>"}'
)

_TOOL_FORM = (
    "需要调用工具时使用：\n"
    '{"thought": "<非空字符串，说明你的判断过程>", '
    '"tool_calls": [{"id": "<可选调用 id>", "tool": "<工具名>", '
    '"arguments": {<符合该工具 schema 的对象>}}]}'
)

_COMMON_RULES = (
    "通用规则：\n"
    "- thought 必须是非空字符串。\n"
    "- final 与 tool_calls 必须恰好出现一个，不能同时出现，也不能都缺失。\n"
    "- 如果已经可以直接回答，使用 final；不要为了调用而调用工具。"
)

_TOOL_RULES = (
    "工具调用规则：\n"
    "- tool_calls 必须是非空数组，每个元素都必须包含 tool 和 arguments。\n"
    "- arguments 必须是 JSON 对象，并且符合对应工具的 schema。\n"
    "- 工具名只能从系统提示的「可用工具」清单中选择。"
)

_TOOL_RESULT_NOTICE = (
    "工具执行结果会以下面的形式出现在紧接着的 user 消息中：\n"
    + TOOL_RESULT_EXAMPLE
    + "\n收到结果后继续推理；需要更多信息就继续调用工具，否则用 final 结束。"
)

_CODE_HINTS = {
    "empty_response": "你返回了空内容；必须输出一个 JSON 对象。",
    "invalid_json": "输出不是合法 JSON；检查引号、逗号和 Markdown 代码块围栏。",
    "not_an_object": "顶层必须是一个 JSON 对象。",
    "invalid_thought": "thought 必须是非空字符串。",
    "ambiguous_output": "final 与 tool_calls 必须恰好出现一个。",
    "invalid_final": "final 必须是非空字符串。",
    "invalid_tool_calls": "tool_calls 必须是非空数组；每项的 arguments 必须是 JSON 对象。",
}


def render_protocol(has_tools: bool) -> str:
    """Return the authoritative response contract taught to the model."""
    parts = [_JSON_ONLY, _FINAL_FORM]
    if has_tools:
        parts.extend([_TOOL_FORM, _COMMON_RULES, _TOOL_RULES, _TOOL_RESULT_NOTICE])
        parts.append(f"合法示例：\n{FINAL_EXAMPLE}\n{TOOL_CALL_EXAMPLE}")
    else:
        parts.append(
            "规则：\n"
            "- thought 必须是非空字符串。\n"
            "- 当前没有可用工具，必须使用 final 形式回答，禁止使用 tool_calls。"
        )
        parts.append(f"合法示例：\n{FINAL_EXAMPLE}")
    return "\n\n".join(parts)


def render_retry_hint(error: InvalidModelResponseError, has_tools: bool) -> str:
    """Build a compact correction that reuses the authoritative contract."""
    lines = [f"你上一条回复没有通过协议校验（{error.code}）：{error}"]
    hint = _CODE_HINTS.get(error.code)
    if hint:
        lines.append(hint)

    lines.append("请重新回复，只输出一个 JSON 对象。合法形式如下：")
    lines.append(_FINAL_FORM)
    if has_tools:
        lines.append(_TOOL_FORM)
        lines.append(_COMMON_RULES)
        lines.append(_TOOL_RULES)
        lines.append(f"合法示例：\n{FINAL_EXAMPLE}\n{TOOL_CALL_EXAMPLE}")
    else:
        lines.append(
            "规则：\n"
            "- thought 必须是非空字符串。\n"
            "- 当前没有可用工具，必须使用 final 形式回答。"
        )
        lines.append(f"合法示例：\n{FINAL_EXAMPLE}")
    return "\n\n".join(lines)


# ---------------------------------------------------------------------------
# 响应解析
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ParsedResponse:
    """Validated text-protocol response produced by the response parser."""

    kind: str
    thought: str = ""
    final: str | None = None
    tool_calls: tuple[ToolCall, ...] = ()
    recovered: bool = False


_BROKEN_FINAL_RE = re.compile(
    r'^\s*\{\s*'
    r'"thought"\s*:\s*'
    r'(?P<thought>"(?:\\.|[^"\\])*")'
    r'\s*,\s*'
    r'"final"\s*:\s*'
    r'(?P<final>.*)'
    r'\s*\}\s*$',
    re.DOTALL,
)


def _decode_json_fragment(value: str) -> str:
    result: list[str] = []
    index = 0
    simple_escapes = {
        '"': '"',
        "\\": "\\",
        "/": "/",
        "b": "\b",
        "f": "\f",
        "n": "\n",
        "r": "\r",
        "t": "\t",
    }

    while index < len(value):
        char = value[index]
        if char != "\\":
            result.append(char)
            index += 1
            continue

        if index + 1 >= len(value):
            result.append("\\")
            index += 1
            continue

        escaped = value[index + 1]
        if escaped in simple_escapes:
            result.append(simple_escapes[escaped])
            index += 2
            continue

        if escaped == "u" and index + 6 <= len(value):
            hex_value = value[index + 2:index + 6]
            if re.fullmatch(r"[0-9a-fA-F]{4}", hex_value):
                result.append(chr(int(hex_value, 16)))
                index += 6
                continue

        result.extend(("\\", escaped))
        index += 2

    return "".join(result)


def _recover_broken_final(text: str) -> dict[str, str] | None:
    match = _BROKEN_FINAL_RE.match(text)
    if not match:
        return None

    try:
        thought = json.loads(match.group("thought"))
    except json.JSONDecodeError:
        return None

    raw_final = match.group("final").strip()
    if len(raw_final) >= 2 and raw_final.startswith('"') and raw_final.endswith('"'):
        raw_final = raw_final[1:-1]

    return {
        "thought": thought,
        "final": _decode_json_fragment(raw_final),
    }


def _load_object(text: str) -> tuple[dict[str, Any], bool]:
    recovered = False
    try:
        value = json.loads(text)
    except json.JSONDecodeError as strict_error:
        value = _recover_broken_final(text)
        if value is None:
            raise InvalidModelResponseError(
                f"Invalid JSON: {strict_error}", code="invalid_json"
            ) from strict_error
        recovered = True

    if not isinstance(value, dict):
        raise InvalidModelResponseError(
            "Response must be a JSON object", code="not_an_object"
        )
    return value, recovered


def parse_response(text: str) -> ParsedResponse:
    """Parse and validate one model response without executing any tools."""
    normalized = (text or "").strip()
    if not normalized:
        raise InvalidModelResponseError("Empty response", code="empty_response")

    obj, recovered = _load_object(normalized)
    thought = obj.get("thought")
    if not isinstance(thought, str) or not thought.strip():
        raise InvalidModelResponseError(
            "Missing or invalid 'thought'", code="invalid_thought"
        )
    thought = thought.strip()

    has_final = "final" in obj
    has_tool_calls = "tool_calls" in obj
    if has_final == has_tool_calls:
        raise InvalidModelResponseError(
            "Response must contain exactly one of 'final' or 'tool_calls'",
            code="ambiguous_output",
        )

    if has_final:
        final = obj.get("final")
        if not isinstance(final, str) or not final.strip():
            raise InvalidModelResponseError(
                "Missing or invalid 'final'", code="invalid_final"
            )
        return ParsedResponse(
            kind="final", thought=thought, final=final, recovered=recovered
        )

    raw_calls = obj.get("tool_calls")
    if not isinstance(raw_calls, list) or not raw_calls:
        raise InvalidModelResponseError(
            "'tool_calls' must be a non-empty array", code="invalid_tool_calls"
        )

    calls: list[ToolCall] = []
    for index, raw_call in enumerate(raw_calls):
        if not isinstance(raw_call, dict):
            raise InvalidModelResponseError(
                f"tool_calls[{index}] must be an object",
                code="invalid_tool_calls",
            )

        call_id = raw_call.get("id", str(index))
        name = raw_call.get("tool")
        arguments = raw_call.get("arguments")

        if not isinstance(call_id, (str, int)):
            raise InvalidModelResponseError(
                f"tool_calls[{index}] invalid 'id'",
                code="invalid_tool_calls",
            )
        if not isinstance(name, str) or not name.strip():
            raise InvalidModelResponseError(
                f"tool_calls[{index}] missing or invalid 'tool'",
                code="invalid_tool_calls",
            )
        if not isinstance(arguments, dict):
            raise InvalidModelResponseError(
                f"tool_calls[{index}] 'arguments' must be an object",
                code="invalid_tool_calls",
            )

        calls.append(
            ToolCall(
                id=str(call_id),
                name=name.strip(),
                arguments=arguments,
            )
        )

    return ParsedResponse(
        kind="tool_calls",
        thought=thought,
        tool_calls=tuple(calls),
        recovered=recovered,
    )


# ---------------------------------------------------------------------------
# 历史渲染
# ---------------------------------------------------------------------------


def render_text_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """把语义 transcript 渲染成纯 user/assistant 的文本消息序列。

    连续的 tool 消息合并进一条 tool_result 信封（user 角色）；
    assistant 的 thought/tool_calls 重新打包为协议 JSON 文本。
    """
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
            rendered.append(_render_assistant(message))
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


def _render_assistant(message: dict[str, Any]) -> dict[str, Any]:
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


# ---------------------------------------------------------------------------
# turn 组装
# ---------------------------------------------------------------------------


def turn_from_text_response(
    text: str,
    *,
    has_tools: bool = False,
    usage: dict[str, Any] | None = None,
    raw: Any = None,
) -> ModelTurn:
    """把一段模型原始文本解析为 ModelTurn。

    解析失败时抛 InvalidModelResponseError，附上给模型看的重试提示
    （feedback）与原文（raw_text），交给 agent 循环的重试路径处理。
    """
    try:
        parsed = parse_response(text)
    except InvalidModelResponseError as error:
        error.feedback = render_retry_hint(error, has_tools)
        error.raw_text = text
        raise

    if parsed.kind == "final":
        return ModelTurn(
            content=parsed.final or "",
            thought=parsed.thought,
            tool_calls=(),
            usage=usage,
            raw=raw,
            recovered=parsed.recovered,
        )
    return ModelTurn(
        content="",
        thought=parsed.thought,
        tool_calls=parsed.tool_calls,
        usage=usage,
        raw=raw,
        recovered=parsed.recovered,
    )


# ---------------------------------------------------------------------------
# 适配器
# ---------------------------------------------------------------------------


class MattermostModel:
    """Mattermost chat 插件适配器：直接实现 ModelAdapter。

    传输（HTTP、鉴权、路由）与线上消息的最终组装归这里；文本 JSON
    协议的渲染/解析是本模块的函数。transport 是可注入的 HTTP 接缝，
    离线测试从这里替身。
    """

    def __init__(
        self,
        state,
        config,
        transport: Callable[[str, str, dict | None], Any] | None = None,
    ):
        self.state = state
        self.config = config
        self.transport = transport or self._request

    def _headers(self) -> dict[str, str]:
        account = self.state.current_account
        return {
            "Accept": "*/*",
            "Content-Type": "text/plain;charset=UTF-8",
            "Origin": self.config.base_url,
            "User-Agent": "Mozilla/5.0",
            "X-CSRF-Token": account["CSRF_TOKEN"],
            "X-Requested-With": "XMLHttpRequest",
            "Cookie": f"MMAUTHTOKEN={account['AUTH_TOKEN']}; MMUSERID={account['USER_ID']}; MMCSRF={account['CSRF_TOKEN']}",
        }

    def _request(self, method: str, path: str, payload=None):
        url = f"{self.config.base_url}{path}"
        data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(url, data=data, headers=self._headers(), method=method)
        with urllib.request.urlopen(request, timeout=240) as response:
            return json.loads(response.read().decode("utf-8"))

    def complete(self, request: ModelRequest) -> ModelTurn:
        account = self.state.current_account
        key = self.state.current_model_key
        query = f"requestTime={int(time.time() * 1000)}&accessTeam={quote(account['TEAM_ID'])}"
        if key == "sendMessageToGemini":
            query += f"&chatModel={quote(self.state.current_model_name)}&enableWebSearch={'true' if 'Flash Lite' in self.state.current_model_name else 'false'}"
        payload = self._wire_messages(
            request.system,
            render_protocol(bool(request.tools)),
            request.tools,
            render_text_messages(request.messages),
        )
        result = self.transport("POST", f"/plugins/aslead-chatgpt/{key}?{query}", payload)
        if not result or not result.get("respMessage"):
            raise RuntimeError(f"模型响应无效: {result}")
        return turn_from_text_response(
            result["respMessage"],
            has_tools=bool(request.tools),
            raw=result,
        )

    @staticmethod
    def _wire_messages(system, protocol, tools, messages):
        sections = [system.strip(), protocol.strip()]
        if tools:
            sections.append(
                "## 可用工具\n"
                + json.dumps(tools, ensure_ascii=False, separators=(",", ":"))
            )
        system_content = "\n\n".join(section for section in sections if section)
        if not system_content:
            return list(messages)
        return [{"role": "system", "content": system_content}] + list(messages)

    def get_me(self):
        return self._request("GET", "/api/v4/users/me")

    def get_usage(self):
        return self._request("GET", "/plugins/aslead-chatgpt/checkUserShow?isKeyDown=false")
