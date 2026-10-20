import json
from collections.abc import Iterator
from typing import Any

from .config import AgentConfig
from .errors import InvalidModelResponseError, MaxRoundsExceeded
from .events import AgentEvent
from .models import AgentResult, ToolResult
from .parser import parse_response
from .protocols import EventHandler, MessageStore, ModelAdapter, ToolExecutor


class Agent:
    """Framework-independent agent orchestration API."""

    def __init__(
        self,
        model: ModelAdapter,
        tools: ToolExecutor,
        store: MessageStore,
        config: AgentConfig | None = None,
        event_handler: EventHandler | None = None,
    ) -> None:
        self.model = model
        self.tools = tools
        self.store = store
        self.config = config or AgentConfig()
        self.event_handler = event_handler

    def run(self, user_text: str) -> AgentResult:
        """Run the agent and return its final answer."""
        final_result: AgentResult | None = None
        for event in self.run_stream(user_text):
            if event.type == "final":
                final_result = event.data["result"]
        if final_result is None:
            raise RuntimeError("agent run ended without a final result")
        return final_result

    def run_stream(self, user_text: str) -> Iterator[AgentEvent]:
        """Run the agent while yielding framework-independent events."""
        if not isinstance(user_text, str) or not user_text.strip():
            raise ValueError("user_text must be a non-empty string")

        self._ensure_system_prompt()
        self.store.append({"role": "user", "content": user_text})
        yield from self._emit(AgentEvent("run_started", {"content": user_text}))

        invalid_retries = 0
        for round_index in range(1, self.config.max_rounds + 1):
            messages = self.store.get_messages()
            yield from self._emit(AgentEvent("model_request", {"round": round_index, "messages": messages}))
            response = self.model.complete(messages)
            yield from self._emit(AgentEvent("model_response", {"round": round_index, "response": response}))

            try:
                parsed = parse_response(response.text)
            except InvalidModelResponseError as error:
                invalid_retries += 1
                yield from self._emit(AgentEvent("error", {"round": round_index, "error": error, "response": response.text}))
                if not self.config.retry_invalid_response or invalid_retries > self.config.max_invalid_response_retries:
                    raise
                yield from self._emit(AgentEvent("retry", {"round": round_index, "reason": str(error)}))
                continue

            invalid_retries = 0
            yield from self._emit(AgentEvent("thought", {"round": round_index, "content": parsed.thought}))
            if parsed.kind == "final":
                result = AgentResult(final=parsed.final or "", thought=parsed.thought, rounds=round_index, metadata={"usage": response.usage} if response.usage else {})
                yield from self._emit(AgentEvent("final", {"round": round_index, "content": result.final, "result": result}))
                yield from self._emit(AgentEvent("run_finished", {"result": result}))
                return

            self.store.append({"role": "assistant", "content": response.text})
            results: list[ToolResult] = []
            for call in parsed.tool_calls:
                yield from self._emit(AgentEvent("tool_call", {"round": round_index, "id": call.id, "tool": call.name, "arguments": call.arguments}))
                try:
                    result = ToolResult(call.id, call.name, self.tools.execute(call.name, call.arguments))
                except Exception as error:
                    result = ToolResult(call.id, call.name, None, error=str(error))
                results.append(result)
                yield from self._emit(AgentEvent("tool_result", {"round": round_index, "id": result.id, "tool": result.name, "data": result.data, "error": result.error}))

            self.store.append({"role": "user", "content": self._serialize_tool_results(results)})

        error = MaxRoundsExceeded(f"agent exceeded maximum rounds: {self.config.max_rounds}")
        yield from self._emit(AgentEvent("error", {"error": error}))
        raise error

    def _ensure_system_prompt(self) -> None:
        if self.config.system_prompt and not any(m.get("role") == "system" for m in self.store.get_messages()):
            self.store.append({"role": "system", "content": self.config.system_prompt})

    @staticmethod
    def _serialize_tool_results(results: list[ToolResult]) -> str:
        return json.dumps({"type": "tool_result", "results": [{"id": r.id, "tool": r.name, "data": r.data, **({"error": r.error} if r.error else {})} for r in results]}, ensure_ascii=False)

    def _emit(self, event: AgentEvent) -> Iterator[AgentEvent]:
        if self.event_handler is not None:
            self.event_handler(event)
        yield event
