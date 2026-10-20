from collections.abc import Callable
from typing import Any, Protocol

from .events import AgentEvent
from .models import ModelResponse


class ModelAdapter(Protocol):
    """Adapter that hides a concrete model provider or transport."""

    def complete(self, messages: list[dict[str, Any]]) -> ModelResponse:
        """Return one normalized model response for the supplied messages."""
        ...


class MessageStore(Protocol):
    """Storage abstraction used by the agent runtime."""

    def get_messages(self) -> list[dict[str, Any]]:
        ...

    def append(self, message: dict[str, Any]) -> None:
        ...

    def replace_messages(self, messages: list[dict[str, Any]]) -> None:
        ...


class ToolExecutor(Protocol):
    """Tool execution abstraction supplied by the host application."""

    def list_tools(self) -> list[dict[str, Any]]:
        ...

    def execute(self, name: str, arguments: dict[str, Any]) -> Any:
        ...


EventHandler = Callable[[AgentEvent], None]
