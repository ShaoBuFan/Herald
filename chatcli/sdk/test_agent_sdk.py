import unittest

from sdk.agent_sdk import (
    Agent,
    AgentConfig,
    InMemoryMessageStore,
    ModelRequest,
    ModelTurn,
    Tool,
    ToolCall,
    ToolRegistry,
)
from sdk.agent_sdk.errors import InvalidModelResponseError


class ScriptedAdapter:
    """Deterministic semantic adapter used by the offline tests."""

    def __init__(self, turns):
        self.turns = list(turns)
        self.requests = []

    def complete(self, request):
        self.requests.append(request)
        if not self.turns:
            raise AssertionError("no scripted turn left")
        item = self.turns.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def make_tool():
    return Tool(
        "read_file",
        "读取文件",
        {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
        lambda arguments: {
            "path": arguments["path"],
            "content": "hello",
        },
    )


def make_agent(turns, tools=None, config=None, events=None):
    adapter = ScriptedAdapter(turns)
    store = InMemoryMessageStore()
    agent = Agent(
        adapter,
        tools if tools is not None else ToolRegistry(),
        store,
        config or AgentConfig(),
        events.append if events is not None else None,
    )
    return adapter, store, agent


def final_turn(content="ok", thought="t"):
    return ModelTurn(content=content, thought=thought)


def tool_turn(*calls, thought="t"):
    return ModelTurn(thought=thought, tool_calls=tuple(calls))


class RequestAssemblyTests(unittest.TestCase):
    def test_request_carries_semantic_fields(self):
        adapter, _, agent = make_agent(
            [final_turn()],
            tools=ToolRegistry([make_tool()]),
            config=AgentConfig(system_prompt="SYS"),
        )
        agent.run("hi")

        request = adapter.requests[0]
        self.assertEqual("SYS", request.system)
        self.assertEqual(["read_file"], [tool["name"] for tool in request.tools])
        self.assertEqual([{"role": "user", "content": "hi"}], request.messages)
        self.assertFalse(hasattr(request, "protocol"))

    def test_legacy_system_messages_are_filtered(self):
        adapter = ScriptedAdapter([final_turn()])
        store = InMemoryMessageStore([{"role": "system", "content": "legacy"}])
        agent = Agent(
            adapter, ToolRegistry(), store, AgentConfig(system_prompt="SYS")
        )
        agent.run("hi")

        self.assertEqual(
            [{"role": "user", "content": "hi"}],
            adapter.requests[0].messages,
        )

    def test_model_request_event_exposes_the_snapshot(self):
        events = []
        make_agent(
            [final_turn()],
            tools=ToolRegistry([make_tool()]),
            config=AgentConfig(system_prompt="SYS"),
            events=events,
        )[2].run("hi")

        event = [item for item in events if item.type == "model_request"][0]
        self.assertEqual("SYS", event.data["system"])
        self.assertEqual(
            ["read_file"], [tool["name"] for tool in event.data["tools"]]
        )
        self.assertNotIn("protocol", event.data)

    def test_final_turn_is_recorded_with_semantics(self):
        _, store, agent = make_agent([final_turn("ok", "think")])
        agent.run("hi")

        self.assertEqual(
            [
                {"role": "user", "content": "hi"},
                {
                    "role": "assistant",
                    "content": "ok",
                    "thought": "think",
                    "tool_calls": [],
                },
            ],
            store.get_messages(),
        )

    def test_tool_turn_records_assistant_and_tool_messages(self):
        call = ToolCall("c1", "read_file", {"path": "a"})
        adapter, store, agent = make_agent(
            [tool_turn(call), final_turn("done", "d")],
            tools=ToolRegistry([make_tool()]),
        )
        result = agent.run("hi")

        self.assertEqual("done", result.final)
        messages = store.get_messages()
        self.assertEqual(
            ["user", "assistant", "tool", "assistant"],
            [message["role"] for message in messages],
        )
        self.assertEqual(
            [{"id": "c1", "name": "read_file", "arguments": {"path": "a"}}],
            messages[1]["tool_calls"],
        )
        self.assertEqual("c1", messages[2]["tool_call_id"])
        self.assertEqual("read_file", messages[2]["name"])
        self.assertEqual(
            {"path": "a", "content": "hello"}, messages[2]["data"]
        )
        self.assertIsNone(messages[2]["error"])

    def test_unknown_tool_is_fed_back_without_retry(self):
        events = []
        adapter, store, agent = make_agent(
            [tool_turn(ToolCall("c1", "nope", {})), final_turn()],
            events=events,
        )
        result = agent.run("hi")

        self.assertEqual("ok", result.final)
        self.assertFalse(any(event.type == "retry" for event in events))
        self.assertEqual(2, len(adapter.requests))
        self.assertIn("unknown tool: nope", store.get_messages()[2]["error"])

    def test_recovered_turn_emits_event(self):
        events = []
        make_agent(
            [ModelTurn(content="ok", thought="t", recovered=True)],
            events=events,
        )[2].run("hi")

        self.assertTrue(any(event.type == "parse_recovered" for event in events))


class RetryFeedbackTests(unittest.TestCase):
    def test_invalid_response_appends_raw_attempt_and_feedback(self):
        events = []
        error = InvalidModelResponseError(
            "bad json",
            code="invalid_json",
            feedback="FIX IT",
            raw_text="bad raw",
        )
        adapter, store, agent = make_agent([error, final_turn()], events=events)
        result = agent.run("hi")

        messages = store.get_messages()
        self.assertEqual(
            ["user", "assistant", "user", "assistant"],
            [message["role"] for message in messages],
        )
        self.assertTrue(messages[1]["raw"])
        self.assertEqual("bad raw", messages[1]["content"])
        self.assertEqual("FIX IT", messages[2]["content"])
        self.assertEqual(2, len(adapter.requests))

        retry = [event for event in events if event.type == "retry"][0]
        self.assertEqual(1, retry.data["attempt"])
        self.assertEqual(2, retry.data["remaining"])
        self.assertEqual("invalid_json", retry.data["code"])
        self.assertEqual("ok", result.final)

    def test_empty_raw_text_only_appends_feedback(self):
        error = InvalidModelResponseError(
            "empty", code="empty_response", feedback="FIX", raw_text=""
        )
        _, store, agent = make_agent([error, final_turn()])
        agent.run("hi")

        self.assertEqual(
            ["user", "user", "assistant"],
            [message["role"] for message in store.get_messages()],
        )
        self.assertEqual("FIX", store.get_messages()[1]["content"])

    def test_retry_budget_counts_consecutive_invalid_responses(self):
        errors = [
            InvalidModelResponseError("bad", code="invalid_json")
            for _ in range(5)
        ]
        adapter, _, agent = make_agent(
            errors,
            config=AgentConfig(
                max_invalid_response_retries=2,
                max_rounds=10,
            ),
        )
        with self.assertRaises(InvalidModelResponseError):
            agent.run("hi")
        self.assertEqual(3, len(adapter.requests))

    def test_budget_resets_after_a_valid_round(self):
        error = InvalidModelResponseError("bad", code="invalid_json")
        adapter, _, agent = make_agent(
            [
                tool_turn(ToolCall("c1", "read_file", {"path": "a"})),
                error,
                final_turn("ok"),
            ],
            tools=ToolRegistry([make_tool()]),
            config=AgentConfig(
                max_invalid_response_retries=1,
                max_rounds=10,
            ),
        )
        result = agent.run("hi")
        self.assertEqual("ok", result.final)
        self.assertEqual(3, len(adapter.requests))


class ModelRequestTests(unittest.TestCase):
    def test_snapshot_is_isolated_from_source_mutation(self):
        messages = [{"role": "user", "content": "hi"}]
        tools = [{"name": "t", "parameters": {"type": "object"}}]
        request = ModelRequest(messages=messages, tools=tools)

        messages[0]["content"] = "changed"
        tools[0]["parameters"]["type"] = "changed"

        self.assertEqual("hi", request.messages[0]["content"])
        self.assertEqual("object", request.tools[0]["parameters"]["type"])

    def test_system_messages_are_rejected(self):
        with self.assertRaises(ValueError):
            ModelRequest(messages=[{"role": "system", "content": "x"}])


class SnapshotGuardedExecutor:
    """list_tools 只报 read_file；execute 还认得一个没进清单的 ghost。"""

    def __init__(self):
        self.executed = []

    def list_tools(self):
        return [
            {
                "name": "read_file",
                "description": "read",
                "parameters": {"type": "object"},
            }
        ]

    def execute(self, name, arguments):
        self.executed.append(name)
        return "ok"


class ToolSnapshotTests(unittest.TestCase):
    def test_tool_outside_the_run_snapshot_is_rejected(self):
        executor = SnapshotGuardedExecutor()
        adapter, store, agent = make_agent(
            [
                tool_turn(ToolCall("c1", "ghost", {})),
                final_turn("ok"),
            ],
            tools=executor,
        )
        result = agent.run("hi")

        self.assertEqual("ok", result.final)
        self.assertEqual([], executor.executed)
        self.assertIn("unknown tool: ghost", store.get_messages()[2]["error"])
        self.assertEqual(
            ["read_file"], [tool["name"] for tool in adapter.requests[0].tools]
        )


if __name__ == "__main__":
    unittest.main()
