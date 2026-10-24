from collections.abc import Iterator
from copy import deepcopy

from .config import AgentConfig
from .errors import (
    InvalidModelResponseError,
    MaxRoundsExceeded,
    ToolExecutionError,
)
from .events import AgentEvent
from .models import AgentResult, ModelTurn, ToolResult
from .protocols import EventHandler, MessageStore, ModelAdapter, ToolExecutor
from .request import build_request


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
        """Run the agent while yielding framework-independent loop events."""
        if not isinstance(user_text, str) or not user_text.strip():
            raise ValueError("user_text must be a non-empty string")

        self.store.append({"role": "user", "content": user_text})
        yield from self._emit(AgentEvent("run_started", {"content": user_text}))

        tool_schemas = self.tools.list_tools()
        # 本轮可调用集合以 run 开始的快照为准：中途注册的工具对本次 run 不可见
        known_tool_names = {schema["name"] for schema in tool_schemas}

        invalid_retries = 0
        for round_index in range(1, self.config.max_rounds + 1):
            request = build_request(
                self.store.get_messages(),
                system=self.config.system_prompt,
                tools=tool_schemas,
            )
            yield from self._emit(
                AgentEvent(
                    "model_request",
                    {
                        "round": round_index,
                        "system": request.system,
                        "tools": deepcopy(request.tools),
                        "messages": deepcopy(request.messages),
                    },
                )
            )

            try:
                turn = self.model.complete(request)
            except InvalidModelResponseError as error:
                invalid_retries += 1
                yield from self._emit(
                    AgentEvent(
                        "error",
                        {
                            "round": round_index,
                            "error": error,
                            "code": error.code,
                            "response": error.raw_text,
                        },
                    )
                )
                if (
                    not self.config.retry_invalid_response
                    or invalid_retries > self.config.max_invalid_response_retries
                ):
                    raise
                self._append_retry_feedback(error)
                yield from self._emit(
                    AgentEvent(
                        "retry",
                        {
                            "round": round_index,
                            "attempt": invalid_retries,
                            "remaining": self.config.max_invalid_response_retries
                            - invalid_retries,
                            "code": error.code,
                        },
                    )
                )
                continue

            invalid_retries = 0
            yield from self._emit(
                AgentEvent("model_response", {"round": round_index, "turn": turn})
            )
            if turn.recovered:
                yield from self._emit(
                    AgentEvent("parse_recovered", {"round": round_index, "turn": turn})
                )
            if turn.thought:
                yield from self._emit(
                    AgentEvent(
                        "thought",
                        {"round": round_index, "content": turn.thought},
                    )
                )

            self._append_assistant(turn)

            if turn.tool_calls:
                results: list[ToolResult] = []
                for call in turn.tool_calls:
                    yield from self._emit(
                        AgentEvent(
                            "tool_call",
                            {
                                "round": round_index,
                                "id": call.id,
                                "tool": call.name,
                                "arguments": call.arguments,
                            },
                        )
                    )
                    try:
                        if call.name not in known_tool_names:
                            raise ToolExecutionError(
                                f"unknown tool: {call.name}"
                            )
                        result = ToolResult(
                            call.id,
                            call.name,
                            self.tools.execute(call.name, call.arguments),
                        )
                    except Exception as error:
                        result = ToolResult(call.id, call.name, None, error=str(error))
                    results.append(result)
                    yield from self._emit(
                        AgentEvent(
                            "tool_result",
                            {
                                "round": round_index,
                                "id": result.id,
                                "tool": result.name,
                                "data": result.data,
                                "error": result.error,
                            },
                        )
                    )

                for result in results:
                    self.store.append(
                        {
                            "role": "tool",
                            "tool_call_id": result.id,
                            "name": result.name,
                            "data": result.data,
                            "error": result.error,
                        }
                    )
                continue

            result = AgentResult(
                final=turn.content,
                thought=turn.thought,
                rounds=round_index,
                metadata={"usage": turn.usage} if turn.usage else {},
            )
            yield from self._emit(
                AgentEvent(
                    "final",
                    {"round": round_index, "content": result.final, "result": result},
                )
            )
            yield from self._emit(AgentEvent("run_finished", {"result": result}))
            return

        error = MaxRoundsExceeded(
            f"agent exceeded maximum rounds: {self.config.max_rounds}"
        )
        yield from self._emit(AgentEvent("error", {"error": error}))
        raise error

    def _append_assistant(self, turn: ModelTurn) -> None:
        self.store.append(
            {
                "role": "assistant",
                "content": turn.content,
                "thought": turn.thought,
                "tool_calls": [
                    {
                        "id": call.id,
                        "name": call.name,
                        "arguments": call.arguments,
                    }
                    for call in turn.tool_calls
                ],
            }
        )

    def _append_retry_feedback(self, error: InvalidModelResponseError) -> None:
        raw_text = getattr(error, "raw_text", "") or ""
        if raw_text.strip():
            self.store.append(
                {
                    "role": "assistant",
                    "content": raw_text,
                    "thought": "",
                    "tool_calls": [],
                    "raw": True,
                }
            )
        feedback = getattr(error, "feedback", None) or (
            f"你上一条回复无法使用（{error.code}）：{error}。请重新回答。"
        )
        self.store.append({"role": "user", "content": feedback})

    def _emit(self, event: AgentEvent) -> Iterator[AgentEvent]:
        if self.event_handler is not None:
            self.event_handler(event)
        yield event
