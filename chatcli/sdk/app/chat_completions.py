from __future__ import annotations

from sdk.agent_sdk import ModelRequest, ModelTurn

from .openai_common import (
    DEFAULT_TIMEOUT,
    JsonTransport,
    build_payload,
    chat_completions_url,
    http_post_json,
    request_headers,
    resolve_config,
    turn_from_chat_response,
)


class ChatCompletionsModel:
    """OpenAI-compatible Chat Completions adapter with native tool calling.

    This adapter is non-streaming. The SDK sees only the normalized ModelTurn;
    the wire format and provider differences stay here.
    """

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
        transport: JsonTransport | None = None,
        timeout: int = DEFAULT_TIMEOUT,
    ) -> None:
        self.base_url, self.api_key, self.model = resolve_config(
            base_url, api_key, model
        )
        self.timeout = timeout
        self.transport = transport or (
            lambda url, headers, payload: http_post_json(
                url, headers, payload, self.timeout
            )
        )

    def complete(self, request: ModelRequest) -> ModelTurn:
        payload = build_payload(self.model, request, stream=False)
        data = self.transport(
            chat_completions_url(self.base_url),
            request_headers(self.api_key),
            payload,
        )
        return turn_from_chat_response(data)
