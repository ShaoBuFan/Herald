import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from sdk.agent_sdk import (
    Agent,
    AgentConfig,
    InMemoryMessageStore,
    InvalidModelResponseError,
    ModelAdapterError,
    ModelRequest,
    Tool,
    ToolRegistry,
)
from sdk.app.adapters.chat_completions import ChatCompletionsModel
from sdk.app.adapters.mattermost import (
    MattermostModel,
    parse_response,
    render_protocol,
    render_text_messages,
    turn_from_text_response,
)
from sdk.app.adapters.streaming_chat_completions import StreamingChatCompletionsModel
from sdk.app.session.store import SCHEMA_VERSION, SessionStore


def make_request():
    return ModelRequest(
        messages=[{"role": "user", "content": "hi"}],
        system="SYS",
        tools=[
            {
                "name": "read_file",
                "description": "read",
                "parameters": {
                    "type": "object",
                    "properties": {"path": {"type": "string"}},
                    "required": ["path"],
                },
            }
        ],
    )


class RecordingJsonTransport:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def __call__(self, url, headers, payload):
        self.calls.append((url, headers, payload))
        return self.response


class RecordingStreamTransport:
    def __init__(self, chunks):
        self.chunks = chunks
        self.calls = []

    def __call__(self, url, headers, payload):
        self.calls.append((url, headers, payload))
        yield from self.chunks


def sse(payload):
    return "data: " + json.dumps(payload, ensure_ascii=False)


class ChatCompletionsTests(unittest.TestCase):
    def test_payload_and_final_response(self):
        transport = RecordingJsonTransport(
            {
                "choices": [{"message": {"content": "hello"}}],
                "usage": {"total_tokens": 3},
            }
        )
        model = ChatCompletionsModel(
            base_url="https://example.com/v1",
            api_key="k",
            model="m",
            transport=transport,
        )

        turn = model.complete(make_request())

        self.assertEqual("hello", turn.content)
        self.assertEqual({"total_tokens": 3}, turn.usage)
        url, headers, payload = transport.calls[0]
        self.assertEqual("https://example.com/v1/chat/completions", url)
        self.assertEqual("Bearer k", headers["Authorization"])
        self.assertEqual("application/json", headers["Accept"])
        self.assertEqual("m", payload["model"])
        self.assertNotIn("stream", payload)
        self.assertEqual(
            [
                {"role": "system", "content": "SYS"},
                {"role": "user", "content": "hi"},
            ],
            payload["messages"],
        )
        self.assertEqual("function", payload["tools"][0]["type"])
        self.assertEqual("auto", payload["tool_choice"])

    def test_native_tool_calls(self):
        transport = RecordingJsonTransport(
            {
                "choices": [
                    {
                        "message": {
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "c1",
                                    "type": "function",
                                    "function": {
                                        "name": "read_file",
                                        "arguments": '{"path": "README.md"}',
                                    },
                                }
                            ],
                        }
                    }
                ]
            }
        )
        model = ChatCompletionsModel(
            base_url="https://example.com/v1",
            api_key="k",
            model="m",
            transport=transport,
        )

        turn = model.complete(make_request())

        self.assertEqual("", turn.content)
        self.assertEqual("c1", turn.tool_calls[0].id)
        self.assertEqual("read_file", turn.tool_calls[0].name)
        self.assertEqual(
            {"path": "README.md"}, turn.tool_calls[0].arguments
        )

    def test_invalid_tool_arguments_carry_feedback(self):
        transport = RecordingJsonTransport(
            {
                "choices": [
                    {
                        "message": {
                            "tool_calls": [
                                {
                                    "id": "c1",
                                    "function": {
                                        "name": "read_file",
                                        "arguments": "not json",
                                    },
                                }
                            ]
                        }
                    }
                ]
            }
        )
        model = ChatCompletionsModel(
            base_url="https://example.com/v1",
            api_key="k",
            model="m",
            transport=transport,
        )

        with self.assertRaises(InvalidModelResponseError) as context:
            model.complete(make_request())
        self.assertEqual("invalid_tool_calls", context.exception.code)
        self.assertIsNotNone(context.exception.feedback)
        self.assertIn("tool_calls", context.exception.raw_text)

    def test_empty_response_raises(self):
        transport = RecordingJsonTransport(
            {"choices": [{"message": {"content": ""}}]}
        )
        model = ChatCompletionsModel(
            base_url="https://example.com/v1",
            api_key="k",
            model="m",
            transport=transport,
        )

        with self.assertRaises(InvalidModelResponseError) as context:
            model.complete(make_request())
        self.assertEqual("empty_response", context.exception.code)

    def test_request_without_tools_omits_native_tools(self):
        transport = RecordingJsonTransport(
            {"choices": [{"message": {"content": "ok"}}]}
        )
        model = ChatCompletionsModel(
            base_url="https://example.com/v1",
            api_key="k",
            model="m",
            transport=transport,
        )

        model.complete(
            ModelRequest(messages=[{"role": "user", "content": "hi"}])
        )

        payload = transport.calls[0][2]
        self.assertNotIn("tools", payload)
        self.assertNotIn("tool_choice", payload)


class StreamingChatCompletionsTests(unittest.TestCase):
    def make_model(self, chunks, **kwargs):
        transport = RecordingStreamTransport(chunks)
        model = StreamingChatCompletionsModel(
            base_url="https://example.com/v1",
            api_key="k",
            model="m",
            transport=transport,
            **kwargs,
        )
        return model, transport

    def test_content_deltas_are_delivered_to_the_app(self):
        deltas = []
        model, transport = self.make_model(
            [
                sse({"choices": [{"delta": {"content": "你"}}]}),
                sse({"choices": [{"delta": {"content": "好"}}]}),
                sse({"choices": [], "usage": {"total_tokens": 9}}),
                "data: [DONE]",
            ],
            on_delta=deltas.append,
        )

        turn = model.complete(make_request())

        self.assertEqual(["你", "好"], deltas)
        self.assertEqual("你好", turn.content)
        self.assertEqual({"total_tokens": 9}, turn.usage)
        url, headers, payload = transport.calls[0]
        self.assertTrue(payload["stream"])
        self.assertEqual("text/event-stream", headers["Accept"])

    def test_tool_call_fragments_are_reassembled(self):
        model, _ = self.make_model(
            [
                sse(
                    {
                        "choices": [
                            {
                                "delta": {
                                    "tool_calls": [
                                        {
                                            "index": 0,
                                            "id": "c1",
                                            "function": {
                                                "name": "read_file",
                                                "arguments": "",
                                            },
                                        }
                                    ]
                                }
                            }
                        ]
                    }
                ),
                sse(
                    {
                        "choices": [
                            {
                                "delta": {
                                    "tool_calls": [
                                        {
                                            "index": 0,
                                            "function": {
                                                "arguments": '{"path": '
                                            },
                                        }
                                    ]
                                }
                            }
                        ]
                    }
                ),
                sse(
                    {
                        "choices": [
                            {
                                "delta": {
                                    "tool_calls": [
                                        {
                                            "index": 0,
                                            "function": {
                                                "arguments": '"README.md"}'
                                            },
                                        }
                                    ]
                                }
                            }
                        ]
                    }
                ),
                "data: [DONE]",
            ]
        )

        turn = model.complete(make_request())

        self.assertEqual(1, len(turn.tool_calls))
        self.assertEqual("c1", turn.tool_calls[0].id)
        self.assertEqual("read_file", turn.tool_calls[0].name)
        self.assertEqual(
            {"path": "README.md"}, turn.tool_calls[0].arguments
        )

    def test_reasoning_delta_has_its_own_callback(self):
        reasoning = []
        model, _ = self.make_model(
            [
                sse(
                    {
                        "choices": [
                            {"delta": {"reasoning_content": "thinking"}}
                        ]
                    }
                ),
                sse({"choices": [{"delta": {"content": "ok"}}]}),
                "data: [DONE]",
            ],
            on_reasoning_delta=reasoning.append,
        )

        turn = model.complete(make_request())

        self.assertEqual(["thinking"], reasoning)
        self.assertEqual("thinking", turn.thought)
        self.assertEqual("ok", turn.content)

    def test_empty_stream_raises(self):
        model, _ = self.make_model(["data: [DONE]"])

        with self.assertRaises(InvalidModelResponseError) as context:
            model.complete(make_request())
        self.assertEqual("empty_response", context.exception.code)

    def test_invalid_streamed_arguments_raise(self):
        model, _ = self.make_model(
            [
                sse(
                    {
                        "choices": [
                            {
                                "delta": {
                                    "tool_calls": [
                                        {
                                            "index": 0,
                                            "id": "c1",
                                            "function": {
                                                "name": "read_file",
                                                "arguments": "not json",
                                            },
                                        }
                                    ]
                                }
                            }
                        ]
                    }
                ),
                "data: [DONE]",
            ]
        )

        with self.assertRaises(InvalidModelResponseError) as context:
            model.complete(make_request())
        self.assertEqual("invalid_tool_calls", context.exception.code)
        self.assertIn("tool_calls", context.exception.raw_text)

    def test_error_chunk_raises_model_adapter_error(self):
        model, _ = self.make_model(
            [sse({"error": {"message": "boom"}})],
        )

        with self.assertRaises(ModelAdapterError):
            model.complete(make_request())

    def test_non_data_lines_are_ignored(self):
        model, _ = self.make_model(
            [
                "",
                ": keepalive",
                "event: message",
                sse({"choices": [{"delta": {"content": "ok"}}]}),
                "data: [DONE]",
            ]
        )

        turn = model.complete(make_request())
        self.assertEqual("ok", turn.content)

    def test_streaming_adapter_runs_through_the_agent_loop(self):
        deltas = []
        model, _ = self.make_model(
            [
                sse({"choices": [{"delta": {"content": "done"}}]}),
                "data: [DONE]",
            ],
            on_delta=deltas.append,
        )
        store = InMemoryMessageStore()
        agent = Agent(
            model,
            ToolRegistry(),
            store,
            AgentConfig(system_prompt="SYS"),
        )

        result = agent.run("hi")

        self.assertEqual("done", result.final)
        self.assertEqual(["done"], deltas)
        self.assertEqual(
            [
                {"role": "user", "content": "hi"},
                {
                    "role": "assistant",
                    "content": "done",
                    "thought": "",
                    "tool_calls": [],
                },
            ],
            store.get_messages(),
        )


class AdapterInterchangeTests(unittest.TestCase):
    def make_tools(self):
        return ToolRegistry(
            [
                Tool(
                    "read_file",
                    "read",
                    {
                        "type": "object",
                        "properties": {"path": {"type": "string"}},
                        "required": ["path"],
                    },
                    lambda arguments: {"content": "hi"},
                )
            ]
        )

    def test_native_adapter_runs_through_agent_with_tools(self):
        responses = [
            {
                "choices": [
                    {
                        "message": {
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "c1",
                                    "type": "function",
                                    "function": {
                                        "name": "read_file",
                                        "arguments": '{"path": "README.md"}',
                                    },
                                }
                            ],
                        }
                    }
                ]
            },
            {"choices": [{"message": {"content": "done"}}]},
        ]
        payloads = []

        def transport(url, headers, payload):
            payloads.append(payload)
            return responses.pop(0)

        store = InMemoryMessageStore()
        agent = Agent(
            ChatCompletionsModel(
                base_url="https://example.com/v1",
                api_key="k",
                model="m",
                transport=transport,
            ),
            self.make_tools(),
            store,
            AgentConfig(system_prompt="SYS"),
        )

        result = agent.run("read")

        self.assertEqual("done", result.final)
        self.assertEqual(
            ["user", "assistant", "tool", "assistant"],
            [message["role"] for message in store.get_messages()],
        )
        second_messages = payloads[1]["messages"]
        self.assertEqual("assistant", second_messages[2]["role"])
        self.assertEqual("c1", second_messages[2]["tool_calls"][0]["id"])
        self.assertEqual("tool", second_messages[3]["role"])
        self.assertEqual("c1", second_messages[3]["tool_call_id"])

    def test_transcript_can_be_continued_by_the_text_adapter(self):
        responses = [
            {
                "choices": [
                    {
                        "message": {
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "c1",
                                    "type": "function",
                                    "function": {
                                        "name": "read_file",
                                        "arguments": '{"path": "README.md"}',
                                    },
                                }
                            ],
                        }
                    }
                ]
            },
            {"choices": [{"message": {"content": "done"}}]},
        ]
        store = InMemoryMessageStore()
        tools = self.make_tools()
        Agent(
            ChatCompletionsModel(
                base_url="https://example.com/v1",
                api_key="k",
                model="m",
                transport=lambda url, headers, payload: responses.pop(0),
            ),
            tools,
            store,
            AgentConfig(system_prompt="SYS"),
        ).run("read")

        wire_payloads = []

        def text_transport(method, path, payload):
            wire_payloads.append(payload)
            return {"respMessage": json.dumps({"thought": "d", "final": "follow"})}

        text_model = MattermostModel(
            SimpleNamespace(
                current_account={"TEAM_ID": "team-1"},
                current_model_key="sendMessageToLLM",
                current_model_name="m1",
            ),
            SimpleNamespace(base_url="https://example.com"),
            text_transport,
        )
        result = Agent(
            text_model,
            tools,
            store,
            AgentConfig(system_prompt="SYS"),
        ).run("follow up")

        self.assertEqual("follow", result.final)
        payload = wire_payloads[0]
        self.assertEqual(
            ["system", "user", "assistant", "user", "assistant", "user"],
            [message["role"] for message in payload],
        )
        assistant_payload = json.loads(payload[2]["content"])
        self.assertEqual(
            "read_file", assistant_payload["tool_calls"][0]["tool"]
        )
        tool_payload = json.loads(payload[3]["content"])
        self.assertEqual("tool_result", tool_payload["type"])
        self.assertEqual("c1", tool_payload["results"][0]["id"])


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


class TextRenderingTests(unittest.TestCase):
    def test_renders_semantic_transcript(self):
        rendered = render_text_messages(
            [
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
            ]
        )

        self.assertEqual(["user", "assistant", "user"], [m["role"] for m in rendered])
        assistant_payload = json.loads(rendered[1]["content"])
        self.assertEqual("need", assistant_payload["thought"])
        self.assertEqual("read_file", assistant_payload["tool_calls"][0]["tool"])
        tool_payload = json.loads(rendered[2]["content"])
        self.assertEqual("tool_result", tool_payload["type"])
        self.assertEqual("c1", tool_payload["results"][0]["id"])

    def test_protocol_text_depends_on_tools(self):
        with_tools = render_protocol(True)
        without_tools = render_protocol(False)
        self.assertIn("需要调用工具时使用", with_tools)
        self.assertNotIn("需要调用工具时使用", without_tools)
        self.assertIn("禁止使用 tool_calls", without_tools)

    def test_tool_results_are_grouped_into_one_envelope(self):
        rendered = render_text_messages(
            [
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

        self.assertEqual(2, len(rendered))
        payload = json.loads(rendered[1]["content"])
        self.assertEqual(2, len(payload["results"]))
        self.assertEqual("boom", payload["results"][1]["error"])

    def test_raw_assistant_turn_is_passed_through(self):
        rendered = render_text_messages(
            [
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

        self.assertEqual("not json at all", rendered[1]["content"])


class TextResponseParsingTests(unittest.TestCase):
    def test_tool_turn_maps_to_model_turn(self):
        turn = turn_from_text_response(
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
            ),
            has_tools=True,
        )

        self.assertEqual("", turn.content)
        self.assertEqual("need", turn.thought)
        self.assertEqual("c1", turn.tool_calls[0].id)
        self.assertEqual({"path": "a"}, turn.tool_calls[0].arguments)

    def test_invalid_response_sets_feedback_and_raw_text(self):
        with self.assertRaises(InvalidModelResponseError) as context:
            turn_from_text_response("not json")

        error = context.exception
        self.assertEqual("invalid_json", error.code)
        self.assertEqual("not json", error.raw_text)
        self.assertIn("invalid_json", error.feedback)

    def test_recovered_final_marks_the_turn(self):
        turn = turn_from_text_response('{"thought": "t", "final": "line1\nline2"}')

        self.assertTrue(turn.recovered)
        self.assertEqual("line1\nline2", turn.content)


class MattermostModelTests(unittest.TestCase):
    def make_model(self, results):
        calls = []

        def transport(method, path, payload):
            calls.append((method, path, payload))
            return results.pop(0)

        state = SimpleNamespace(
            current_account={"TEAM_ID": "team-1"},
            current_model_key="sendMessageToLLM",
            current_model_name="m1",
        )
        return MattermostModel(
            state,
            SimpleNamespace(base_url="https://example.com"),
            transport,
        ), calls

    def test_complete_builds_wire_payload_and_maps_turn(self):
        model, calls = self.make_model(
            [{"respMessage": json.dumps({"thought": "d", "final": "ok"})}]
        )

        turn = model.complete(
            ModelRequest(
                messages=[{"role": "user", "content": "hi"}],
                system="APP",
                tools=[
                    {
                        "name": "read_file",
                        "description": "d",
                        "parameters": {"type": "object"},
                    }
                ],
            )
        )

        self.assertEqual("ok", turn.content)
        self.assertEqual("d", turn.thought)
        method, path, payload = calls[0]
        self.assertEqual("POST", method)
        self.assertIn("sendMessageToLLM", path)
        self.assertIn("accessTeam=team-1", path)
        self.assertEqual(["system", "user"], [m["role"] for m in payload])
        self.assertIn("APP", payload[0]["content"])
        self.assertIn("工具调用型 Agent", payload[0]["content"])
        self.assertIn("## 可用工具", payload[0]["content"])
        self.assertIn("read_file", payload[0]["content"])
        self.assertEqual({"role": "user", "content": "hi"}, payload[1])

    def test_invalid_plugin_response_raises(self):
        model, _ = self.make_model([{"other": 1}])
        with self.assertRaises(RuntimeError):
            model.complete(
                ModelRequest(messages=[{"role": "user", "content": "hi"}])
            )


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
