from dataclasses import dataclass, field
from typing import Any

@dataclass(frozen=True)
class ModelResponse:
    """Normalized model output returned by a ModelAdapter."""

    text: str
    raw: Any = None
    usage: dict[str, Any] | None = None

@dataclass(frozen=True)
class ToolCall:
    """A tool invocation requested by the model."""

    id: str
    name: str
    arguments: dict[str, Any]

@dataclass(frozen=True)
class ParsedResponse:
    """Validated protocol response produced by the response parser."""
    kind: str
    thought: str = ""
    final: str | None = None
    tool_calls: tuple[ToolCall, ...] = ()

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
