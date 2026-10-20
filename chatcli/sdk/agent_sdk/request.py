from __future__ import annotations

from typing import Any

from .models import ModelRequest


def build_request(
    messages: list[dict[str, Any]],
    *,
    system: str,
    tools: list[dict[str, Any]],
) -> ModelRequest:
    """Assemble the semantic snapshot the model sees for one call.

    System messages stored by older sessions are dropped here because the
    system prompt lives in ``ModelRequest.system``.
    """
    conversation = [
        message for message in messages if message.get("role") != "system"
    ]
    return ModelRequest(
        messages=conversation,
        system=system,
        tools=tools,
    )
