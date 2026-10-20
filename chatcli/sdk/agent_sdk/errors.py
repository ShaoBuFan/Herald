class AgentError(Exception):
    """Base exception for SDK errors."""


class ModelAdapterError(AgentError):
    """Raised when a model adapter cannot complete a request."""


class ToolExecutionError(AgentError):
    """Raised when a tool cannot be executed safely."""


class InvalidModelResponseError(AgentError):
    """Raised when an adapter cannot normalize a model response.

    ``feedback`` is model-facing correction text supplied by the adapter; the
    loop appends it as a user message before retrying. ``raw_text`` is the
    unusable assistant output, kept for the transcript and for debugging.
    """

    def __init__(
        self,
        message: str,
        code: str = "invalid_response",
        feedback: str | None = None,
        raw_text: str = "",
    ) -> None:
        super().__init__(message)
        self.code = code
        self.feedback = feedback
        self.raw_text = raw_text


class MaxRoundsExceeded(AgentError):
    """Raised when an agent run exceeds its configured round limit."""
