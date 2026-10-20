from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class ModelRequest:
    """Semantic snapshot of one model call.

    ``messages`` is a provider-neutral transcript. Adapters render it into the
    wire format their model expects; the loop never sees wire messages.
    """

    messages: list[dict[str, Any]]
    system: str = ""
    tools: list[dict[str, Any]] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not all(isinstance(message, dict) for message in self.messages):
            raise TypeError("messages must contain dictionaries")
        if any(message.get("role") == "system" for message in self.messages):
            raise ValueError("system messages belong in ModelRequest.system")
        object.__setattr__(self, "messages", deepcopy(self.messages))
        object.__setattr__(self, "tools", deepcopy(self.tools))


@dataclass(frozen=True)
class ModelTurn:
    """Normalized assistant turn produced by a ModelAdapter.

    The loop only consumes ``content`` and ``tool_calls``. ``thought`` is
    optional metadata for display and history; ``usage`` and ``raw`` are
    provider passthrough.
    """

    content: str = ""
    thought: str = ""
    tool_calls: tuple[ToolCall, ...] = ()
    usage: dict[str, Any] | None = None
    raw: Any = None
    recovered: bool = False

    @property
    def is_final(self) -> bool:
        return not self.tool_calls


@dataclass(frozen=True)
class ModelResponse:
    """Raw text response returned by a text-only client.

    This is a transport-level type used by TextProtocolAdapter's clients; the
    agent loop consumes ModelTurn instead.
    """

    text: str
    raw: Any = None
    usage: dict[str, Any] | None = None


@dataclass(frozen=True)
class ToolCall:
    """A semantic tool invocation requested by the model."""

    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ParsedResponse:
    """Validated text-protocol response produced by the response parser."""

    kind: str
    thought: str = ""
    final: str | None = None
    tool_calls: tuple[ToolCall, ...] = ()
    recovered: bool = False


@dataclass(frozen=True)
class ToolResult:
    """Normalized result of executing one tool call."""

    id: str
    name: str
    data: Any
    error: str | None = None


@dataclass(frozen=True)
class AgentResult:
    """Final result of one agent run."""

    final: str
    thought: str = ""
    rounds: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)
