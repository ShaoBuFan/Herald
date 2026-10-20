from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class AgentEvent:
    """A framework-independent event emitted during an agent run."""

    type: str
    data: dict[str, Any] = field(default_factory=dict)

    @property
    def content(self) -> Any:
        """Convenience access to the event content, when present."""
        return self.data.get("content")
