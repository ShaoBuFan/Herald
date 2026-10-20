from copy import deepcopy
from typing import Any


class InMemoryMessageStore:
    """Simple message store suitable for SDK use and tests."""

    def __init__(self, messages: list[dict[str, Any]] | None = None) -> None:
        self._messages: list[dict[str, Any]] = deepcopy(messages or [])

    def get_messages(self) -> list[dict[str, Any]]:
        """Return a copy so callers cannot mutate store state accidentally."""
        return deepcopy(self._messages)

    def append(self, message: dict[str, Any]) -> None:
        if not isinstance(message, dict):
            raise TypeError("message must be a dictionary")
        self._messages.append(deepcopy(message))

    def replace_messages(self, messages: list[dict[str, Any]]) -> None:
        if not isinstance(messages, list):
            raise TypeError("messages must be a list")
        if not all(isinstance(message, dict) for message in messages):
            raise TypeError("each message must be a dictionary")
        self._messages = deepcopy(messages)

    def clear(self) -> None:
        self._messages.clear()
