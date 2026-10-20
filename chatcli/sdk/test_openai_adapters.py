import json
import unittest

from sdk.agent_sdk import (
    Agent,
    AgentConfig,
    InMemoryMessageStore,
    InvalidModelResponseError,
    ModelAdapterError,
    ModelRequest,
    ModelResponse,
    TextProtocolAdapter,
    Tool,
    ToolRegistry,
)
from sdk.app.chat_completions import ChatCompletionsModel
from sdk.app.streaming_chat_completions import StreamingChatCompletionsModel


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


class ScriptedTextClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def complete(self, request):
        self.requests.append(request)
        return ModelResponse(text=self.responses.pop(0))


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

        client = ScriptedTextClient(
            [json.dumps({"thought": "d", "final": "follow"})]
        )
        result = Agent(
            TextProtocolAdapter(client),
            tools,
            store,
            AgentConfig(system_prompt="SYS"),
        ).run("follow up")

        self.assertEqual("follow", result.final)
        rendered = client.requests[0].messages
        self.assertEqual(
            ["user", "assistant", "user", "assistant", "user"],
            [message["role"] for message in rendered],
        )
        assistant_payload = json.loads(rendered[1]["content"])
        self.assertEqual(
            "read_file", assistant_payload["tool_calls"][0]["tool"]
        )
        tool_payload = json.loads(rendered[2]["content"])
        self.assertEqual("tool_result", tool_payload["type"])
        self.assertEqual("c1", tool_payload["results"][0]["id"])


if __name__ == "__main__":
    unittest.main()
