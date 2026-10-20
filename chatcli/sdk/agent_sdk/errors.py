class AgentError(Exception):
    """Base exception for SDK errors."""


class ModelAdapterError(AgentError):
    """Raised when a model adapter cannot complete a request."""


class ToolExecutionError(AgentError):
    """Raised when a tool cannot be executed safely."""


class InvalidModelResponseError(AgentError):
    """Raised when a model response does not follow the agent protocol."""


class MaxRoundsExceeded(AgentError):
    """Raised when an agent run exceeds its configured round limit."""
