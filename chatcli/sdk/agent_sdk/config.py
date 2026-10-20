from dataclasses import dataclass


@dataclass(frozen=True)
class AgentConfig:
    """Configuration for the framework-independent agent runtime."""

    system_prompt: str = ""
    max_rounds: int = 150
    retry_invalid_response: bool = True
    max_invalid_response_retries: int = 3

    def __post_init__(self) -> None:
        if self.max_rounds <= 0:
            raise ValueError("max_rounds must be greater than 0")
        if self.max_invalid_response_retries < 0:
            raise ValueError("max_invalid_response_retries must not be negative")
