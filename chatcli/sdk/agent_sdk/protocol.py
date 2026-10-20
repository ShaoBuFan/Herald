from __future__ import annotations

from .errors import InvalidModelResponseError

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
