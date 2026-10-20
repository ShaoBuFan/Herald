import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from sdk.agent_sdk import (
    Agent,
    AgentConfig,
    InMemoryMessageStore,
    ModelRequest,
    ModelResponse,
    ModelTurn,
    TextModelRequest,
    TextProtocolAdapter,
    Tool,
    ToolCall,
    ToolRegistry,
    parse_response,
)
from sdk.agent_sdk.errors import InvalidModelResponseError
from sdk.app.model import MattermostModel
from sdk.app.session import SCHEMA_VERSION, SessionStore


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


class ScriptedTextClient:
    """Deterministic text transport used by the codec tests."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def complete(self, request):
        self.requests.append(request)
        if not self.responses:
            raise AssertionError("no scripted response left")
        return ModelResponse(text=self.responses.pop(0))


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

    def test_text_model_request_adds_protocol(self):
        request = TextModelRequest(messages=[], protocol="P")
        self.assertEqual("P", request.protocol)


class ParserErrorCodeTests(unittest.TestCase):
    def test_parse_errors_carry_codes(self):
        cases = {
            "": "empty_response",
            "nope": "invalid_json",
            "[]": "not_an_object",
            '{"final": "x"}': "invalid_thought",
            '{"thought": "t", "final": "x", "tool_calls": []}': "ambiguous_output",
            '{"thought": "t", "final": ""}': "invalid_final",
            '{"thought": "t", "tool_calls": []}': "invalid_tool_calls",
            '{"thought": "t", "tool_calls": [{"tool": "x", "arguments": "no"}]}': "invalid_tool_calls",
        }
        for text, expected_code in cases.items():
            with self.subTest(text=text):
                with self.assertRaises(InvalidModelResponseError) as context:
                    parse_response(text)
                self.assertEqual(expected_code, context.exception.code)


class TextProtocolAdapterTests(unittest.TestCase):
    def test_renders_semantic_transcript(self):
        client = ScriptedTextClient(
            [json.dumps({"thought": "done", "final": "ok"})]
        )
        request = ModelRequest(
            messages=[
                {"role": "user", "content": "hi"},
                {
                    "role": "assistant",
                    "content": "",
                    "thought": "need",
                    "tool_calls": [
                        {
                            "id": "c1",
                            "name": "read_file",
                            "arguments": {"path": "a"},
                        }
                    ],
                },
                {
                    "role": "tool",
                    "tool_call_id": "c1",
                    "name": "read_file",
                    "data": {"content": "x"},
                    "error": None,
                },
            ],
            system="SYS",
            tools=[
                {
                    "name": "read_file",
                    "description": "read",
                    "parameters": {"type": "object"},
                }
            ],
        )

        turn = TextProtocolAdapter(client).complete(request)

        self.assertEqual("ok", turn.content)
        self.assertEqual("done", turn.thought)
        text_request = client.requests[0]
        self.assertIsInstance(text_request, TextModelRequest)
        self.assertEqual("SYS", text_request.system)
        self.assertIn("tool_calls", text_request.protocol)
        self.assertEqual(["read_file"], [tool["name"] for tool in text_request.tools])

        rendered = text_request.messages
        self.assertEqual(["user", "assistant", "user"], [m["role"] for m in rendered])
        assistant_payload = json.loads(rendered[1]["content"])
        self.assertEqual("need", assistant_payload["thought"])
        self.assertEqual("read_file", assistant_payload["tool_calls"][0]["tool"])
        tool_payload = json.loads(rendered[2]["content"])
        self.assertEqual("tool_result", tool_payload["type"])
        self.assertEqual("c1", tool_payload["results"][0]["id"])

    def test_no_tools_shrinks_the_protocol(self):
        client = ScriptedTextClient(
            [json.dumps({"thought": "t", "final": "ok"})]
        )
        TextProtocolAdapter(client).complete(
            ModelRequest(messages=[{"role": "user", "content": "hi"}])
        )

        protocol = client.requests[0].protocol
        self.assertNotIn("需要调用工具时使用", protocol)
        self.assertIn("禁止使用 tool_calls", protocol)
        self.assertEqual([], client.requests[0].tools)

    def test_tool_turn_maps_to_model_turn(self):
        client = ScriptedTextClient(
            [
                json.dumps(
                    {
                        "thought": "need",
                        "tool_calls": [
                            {
                                "id": "c1",
                                "tool": "read_file",
                                "arguments": {"path": "a"},
                            }
                        ],
                    }
                )
            ]
        )
        turn = TextProtocolAdapter(client).complete(
            ModelRequest(
                messages=[{"role": "user", "content": "hi"}],
                tools=[{"name": "read_file", "parameters": {"type": "object"}}],
            )
        )

        self.assertEqual("", turn.content)
        self.assertEqual("need", turn.thought)
        self.assertEqual("c1", turn.tool_calls[0].id)
        self.assertEqual({"path": "a"}, turn.tool_calls[0].arguments)

    def test_tool_results_are_grouped_into_one_envelope(self):
        client = ScriptedTextClient(
            [json.dumps({"thought": "t", "final": "ok"})]
        )
        TextProtocolAdapter(client).complete(
            ModelRequest(
                messages=[
                    {"role": "user", "content": "hi"},
                    {
                        "role": "tool",
                        "tool_call_id": "c1",
                        "name": "a",
                        "data": 1,
                        "error": None,
                    },
                    {
                        "role": "tool",
                        "tool_call_id": "c2",
                        "name": "b",
                        "data": 2,
                        "error": "boom",
                    },
                ]
            )
        )

        rendered = client.requests[0].messages
        self.assertEqual(2, len(rendered))
        payload = json.loads(rendered[1]["content"])
        self.assertEqual(2, len(payload["results"]))
        self.assertEqual("boom", payload["results"][1]["error"])

    def test_raw_assistant_turn_is_passed_through(self):
        client = ScriptedTextClient(
            [json.dumps({"thought": "t", "final": "ok"})]
        )
        TextProtocolAdapter(client).complete(
            ModelRequest(
                messages=[
                    {"role": "user", "content": "hi"},
                    {
                        "role": "assistant",
                        "content": "not json at all",
                        "thought": "",
                        "tool_calls": [],
                        "raw": True,
                    },
                ]
            )
        )

        self.assertEqual("not json at all", client.requests[0].messages[1]["content"])

    def test_invalid_response_sets_feedback_and_raw_text(self):
        client = ScriptedTextClient(["not json"])
        with self.assertRaises(InvalidModelResponseError) as context:
            TextProtocolAdapter(client).complete(
                ModelRequest(messages=[{"role": "user", "content": "hi"}])
            )

        error = context.exception
        self.assertEqual("invalid_json", error.code)
        self.assertEqual("not json", error.raw_text)
        self.assertIn("invalid_json", error.feedback)

    def test_recovered_final_marks_the_turn(self):
        client = ScriptedTextClient(
            ['{"thought": "t", "final": "line1\nline2"}']
        )
        turn = TextProtocolAdapter(client).complete(
            ModelRequest(messages=[{"role": "user", "content": "hi"}])
        )

        self.assertTrue(turn.recovered)
        self.assertEqual("line1\nline2", turn.content)


class MattermostWireTests(unittest.TestCase):
    def test_system_protocol_and_tools_are_prepended(self):
        model = MattermostModel(
            SimpleNamespace(),
            SimpleNamespace(base_url="https://example.com"),
        )
        request = TextModelRequest(
            messages=[{"role": "user", "content": "hi"}],
            system="APP",
            protocol="PROTO",
            tools=[
                {
                    "name": "read_file",
                    "description": "d",
                    "parameters": {"type": "object"},
                }
            ],
        )

        wire = model._wire_messages(request)

        self.assertEqual(["system", "user"], [message["role"] for message in wire])
        self.assertIn("APP", wire[0]["content"])
        self.assertIn("PROTO", wire[0]["content"])
        self.assertIn("## 可用工具", wire[0]["content"])
        self.assertIn("read_file", wire[0]["content"])
        self.assertEqual({"role": "user", "content": "hi"}, wire[1])


class SessionStoreTests(unittest.TestCase):
    def test_clear_removes_history_without_seeding_a_system_prompt(self):
        with tempfile.TemporaryDirectory() as directory:
            store = SessionStore(Path(directory))
            store.append({"role": "user", "content": "hi"})
            store.clear()
            self.assertEqual([], store.get_messages())

    def test_save_includes_schema_version(self):
        with tempfile.TemporaryDirectory() as directory:
            store = SessionStore(Path(directory))
            store.append({"role": "user", "content": "hi"})
            path = store.save("t")
            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(SCHEMA_VERSION, payload["version"])

    def test_load_migrates_legacy_text_history(self):
        legacy = {
            "title": "old",
            "history": [
                {"role": "system", "content": "old system"},
                {"role": "user", "content": "hi"},
                {
                    "role": "assistant",
                    "content": json.dumps(
                        {
                            "thought": "need",
                            "tool_calls": [
                                {
                                    "id": "c1",
                                    "tool": "read_file",
                                    "arguments": {"path": "a"},
                                }
                            ],
                        }
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "type": "tool_result",
                            "results": [
                                {
                                    "id": "c1",
                                    "tool": "read_file",
                                    "data": {"content": "x"},
                                }
                            ],
                        }
                    ),
                },
                {
                    "role": "assistant",
                    "content": json.dumps(
                        {"thought": "done", "final": "ok"}
                    ),
                },
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "conversation_old.json"
            path.write_text(json.dumps(legacy), encoding="utf-8")
            store = SessionStore(Path(directory))
            self.assertTrue(store.load(path))

            messages = store.get_messages()
            self.assertEqual(
                ["user", "assistant", "tool", "assistant"],
                [message["role"] for message in messages],
            )
            self.assertEqual(
                [
                    {
                        "id": "c1",
                        "name": "read_file",
                        "arguments": {"path": "a"},
                    }
                ],
                messages[1]["tool_calls"],
            )
            self.assertEqual("c1", messages[2]["tool_call_id"])
            self.assertEqual({"content": "x"}, messages[2]["data"])
            self.assertEqual("ok", messages[3]["content"])
            self.assertEqual("done", messages[3]["thought"])

    def test_semantic_session_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            store = SessionStore(Path(directory))
            store.append({"role": "user", "content": "hi"})
            store.append(
                {
                    "role": "assistant",
                    "content": "ok",
                    "thought": "t",
                    "tool_calls": [],
                }
            )
            path = store.save("round trip")

            restored = SessionStore(Path(directory))
            self.assertTrue(restored.load(path))
            self.assertEqual(store.get_messages(), restored.get_messages())


if __name__ == "__main__":
    unittest.main()
