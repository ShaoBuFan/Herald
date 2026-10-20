import json
import re
from typing import Any

from .errors import InvalidModelResponseError
from .models import ParsedResponse, ToolCall


BROKEN_FINAL_RE = re.compile(
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

    return {
        "thought": thought,
        "final": _decode_json_fragment(match.group("final")),
    }


def _load_object(text: str) -> dict[str, Any]:
    try:
        value = json.loads(text)
    except json.JSONDecodeError as strict_error:
        value = _recover_broken_final(text)
        if value is None:
            raise InvalidModelResponseError(
                f"Invalid JSON: {strict_error}"
            ) from strict_error

    if not isinstance(value, dict):
        raise InvalidModelResponseError("Response must be a JSON object")
    return value


def parse_response(text: str) -> ParsedResponse:
    """Parse and validate one model response without executing any tools."""
    normalized = (text or "").strip()
    if not normalized:
        raise InvalidModelResponseError("Empty response")

    obj = _load_object(normalized)
    thought = obj.get("thought")
    if not isinstance(thought, str) or not thought.strip():
        raise InvalidModelResponseError("Missing or invalid 'thought'")
    thought = thought.strip()

    has_final = "final" in obj
    has_tool_calls = "tool_calls" in obj
    if has_final == has_tool_calls:
        raise InvalidModelResponseError(
            "Response must contain exactly one of 'final' or 'tool_calls'"
        )

    if has_final:
        final = obj.get("final")
        if not isinstance(final, str) or not final.strip():
            raise InvalidModelResponseError("Missing or invalid 'final'")
        return ParsedResponse(kind="final", thought=thought, final=final)

    raw_calls = obj.get("tool_calls")
    if not isinstance(raw_calls, list) or not raw_calls:
        raise InvalidModelResponseError("'tool_calls' must be a non-empty array")

    calls: list[ToolCall] = []
    for index, raw_call in enumerate(raw_calls):
        if not isinstance(raw_call, dict):
            raise InvalidModelResponseError(
                f"tool_calls[{index}] must be an object"
            )

        call_id = raw_call.get("id", str(index))
        name = raw_call.get("tool")
        arguments = raw_call.get("arguments")

        if not isinstance(call_id, (str, int)):
            raise InvalidModelResponseError(
                f"tool_calls[{index}] invalid 'id'"
            )
        if not isinstance(name, str) or not name.strip():
            raise InvalidModelResponseError(
                f"tool_calls[{index}] missing or invalid 'tool'"
            )
        if not isinstance(arguments, dict):
            raise InvalidModelResponseError(
                f"tool_calls[{index}] 'arguments' must be an object"
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
    )
