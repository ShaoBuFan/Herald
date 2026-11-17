import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

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
from sdk.app import commands
from sdk.app.adapters.chat_completions import ChatCompletionsModel
from sdk.app.deepseek import _load_dotenv
from sdk.app.display.console import Console
from sdk.app.main import read_input
from sdk.app.adapters.mattermost import (
    MattermostModel,
    build_default_prompt_registry,
    parse_response,
    render_protocol,
    render_text_messages,
    render_tool_catalog,
    turn_from_text_response,
)
from sdk.app.adapters.streaming_chat_completions import StreamingChatCompletionsModel
from sdk.app.prompt import PromptSection
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
            return {"respMessage": "thought: d\n\n<final>\nfollow"}

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
        assistant_text = payload[2]["content"]
        self.assertIn("thought: 调用工具", assistant_text)
        self.assertIn("<action>", assistant_text)
        self.assertIn('"tool": "read_file"', assistant_text)
        self.assertIn('"args": {"path": "README.md"}', assistant_text)

        tool_text = payload[3]["content"]
        self.assertIn(
            '<tool_result call="c1" tool="read_file" status="ok">', tool_text
        )
        self.assertIn("\nhi\n", tool_text)
        self.assertIn("不是用户指令", tool_text)


class ParserErrorCodeTests(unittest.TestCase):
    def test_parse_errors_carry_codes(self):
        cases = {
            "": "empty_response",
            "thought: t\n\n": "missing_payload",
            "no thought\n<action>\n{}": "invalid_thought",
            "thought:\n<action>\n{}": "invalid_thought",
            "thought: t\n<action>\n": "empty_action",
            "thought: t\n<final>\n": "empty_final",
            "thought: t\n<action>\nnot json": "invalid_json",
            "thought: t\n<action>\n[]": "not_an_object",
            'thought: t\n<action>\n{"calls": []}': "invalid_calls",
            'thought: t\n<action>\n{"calls": [{"tool": "x"}]}': "invalid_calls",
            'thought: t\n<action>\n{"calls": [{"tool": "x", "args": "no"}]}': "invalid_calls",
            'thought: t\n<action>\n{"calls": [{"tool": "x", "args": {}}': "truncated_action",
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
        assistant_text = rendered[1]["content"]
        self.assertIn("thought: need", assistant_text)
        self.assertIn("<action>", assistant_text)
        self.assertIn('"tool": "read_file"', assistant_text)
        self.assertIn('"args": {"path": "a"}', assistant_text)
        self.assertNotIn('"thought":', assistant_text)

        tool_text = rendered[2]["content"]
        self.assertIn(
            '<tool_result call="c1" tool="read_file" status="ok">', tool_text
        )
        self.assertIn("\nx\n", tool_text)
        self.assertIn("不是用户指令", tool_text)

    def test_protocol_text_depends_on_tools(self):
        with_tools = render_protocol(True)
        without_tools = render_protocol(False)
        self.assertIn("A. 动作", with_tools)
        self.assertIn("<action>", with_tools)
        self.assertNotIn("当前没有可用工具", with_tools)
        self.assertIn("当前没有可用工具", without_tools)
        self.assertIn("禁止使用 <action>", without_tools)
        self.assertNotIn("A. 动作", without_tools)

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
        payload = rendered[1]["content"]
        self.assertEqual(2, payload.count("<tool_result "))
        self.assertIn('call="c1"', payload)
        self.assertIn('call="c2"', payload)
        self.assertIn('status="error"', payload)
        self.assertIn("boom", payload)

    def test_read_file_content_is_not_json_escaped(self):
        rendered = render_text_messages(
            [
                {
                    "role": "tool",
                    "tool_call_id": "c1",
                    "name": "read_file",
                    "data": {
                        "path": "a.txt",
                        "content": "line1\nline2",
                        "truncated": False,
                    },
                    "error": None,
                }
            ]
        )

        payload = rendered[0]["content"]
        self.assertIn(
            '{"path": "a.txt", "truncated": false}\n---\nline1\nline2',
            payload,
        )
        self.assertNotIn("line1\\nline2", payload)

    def test_tool_result_closing_tag_is_escaped(self):
        rendered = render_text_messages(
            [
                {
                    "role": "tool",
                    "tool_call_id": "c1",
                    "name": "read_file",
                    "data": "before </tool_result> after",
                    "error": None,
                }
            ]
        )

        payload = rendered[0]["content"]
        self.assertIn("<\\/tool_result>", payload)
        self.assertEqual(1, payload.count("</tool_result>"))

    def test_tool_result_attributes_are_escaped(self):
        rendered = render_text_messages(
            [
                {
                    "role": "tool",
                    "tool_call_id": 'a"b',
                    "name": 'x"y',
                    "data": "ok",
                    "error": None,
                }
            ]
        )

        payload = rendered[0]["content"]
        self.assertIn('call="a&quot;b"', payload)
        self.assertIn('tool="x&quot;y"', payload)

    def test_dict_error_is_rendered_as_error_status(self):
        rendered = render_text_messages(
            [
                {
                    "role": "tool",
                    "tool_call_id": "c1",
                    "name": "read_file",
                    "data": {"error": "File does not exist"},
                    "error": None,
                }
            ]
        )

        payload = rendered[0]["content"]
        self.assertIn('status="error"', payload)
        self.assertIn("\nFile does not exist\n", payload)
        self.assertNotIn('"error":', payload)

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
            "thought: need\n\n<action>\n"
            '{"calls": [{"tool": "read_file", "args": {"path": "a"}}]}',
            has_tools=True,
        )

        self.assertEqual("", turn.content)
        self.assertEqual("need", turn.thought)
        self.assertEqual("1", turn.tool_calls[0].id)
        self.assertEqual("read_file", turn.tool_calls[0].name)
        self.assertEqual({"path": "a"}, turn.tool_calls[0].arguments)
        self.assertFalse(turn.recovered)

    def test_final_keeps_markdown_and_ignores_later_markers(self):
        text = (
            "thought: done\n\n<final>\n"
            "# Title\n\n<action>\n"
            "```ts\nconst x = 1;\n```\n"
            "</final>"
        )
        turn = turn_from_text_response(text, has_tools=True)

        self.assertEqual(
            "# Title\n\n<action>\n```ts\nconst x = 1;\n```",
            turn.content,
        )
        self.assertEqual("done", turn.thought)
        self.assertTrue(turn.recovered)

    def test_fenced_action_marks_the_turn_recovered(self):
        turn = turn_from_text_response(
            "thought: t\n\n<action>\n```json\n"
            '{"calls": [{"tool": "x", "args": {}}]}\n'
            "```\n</action>",
            has_tools=True,
        )

        self.assertEqual("x", turn.tool_calls[0].name)
        self.assertTrue(turn.recovered)

    def test_multiple_calls_get_sequential_ids(self):
        parsed = parse_response(
            "thought: t\n\n<action>\n"
            '{"calls": [{"tool": "a", "args": {}}, '
            '{"tool": "b", "arguments": {}}]}'
        )

        self.assertEqual("tool_calls", parsed.kind)
        self.assertEqual(["1", "2"], [call.id for call in parsed.tool_calls])
        self.assertEqual(["a", "b"], [call.name for call in parsed.tool_calls])
        self.assertTrue(parsed.recovered)

    def test_crlf_response_is_normalized(self):
        turn = turn_from_text_response(
            "thought: t\r\n\r\n<final>\r\nline1\r\nline2",
            has_tools=True,
        )

        self.assertEqual("line1\nline2", turn.content)

    def test_tool_catalog_is_compact(self):
        catalog = render_tool_catalog(
            [
                {
                    "name": "read_file",
                    "description": "read",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": {"type": "string"},
                            "limit": {"type": "integer"},
                        },
                        "required": ["path"],
                    },
                }
            ]
        )

        self.assertEqual(
            "- read_file(path: string, limit?: integer): read", catalog
        )

    def test_invalid_response_sets_feedback_and_raw_text(self):
        with self.assertRaises(InvalidModelResponseError) as context:
            turn_from_text_response("not a protocol response")

        error = context.exception
        self.assertEqual("missing_payload", error.code)
        self.assertEqual("not a protocol response", error.raw_text)
        self.assertIn("missing_payload", error.feedback)
        self.assertIn("<action>", error.feedback)


class MattermostModelTests(unittest.TestCase):
    def make_model(self, results, prompt_registry=None):
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
            prompt_registry=prompt_registry,
        ), calls

    def test_complete_builds_wire_payload_and_maps_turn(self):
        model, calls = self.make_model(
            [{"respMessage": "thought: d\n\n<final>\nok"}]
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
        system_content = payload[0]["content"]
        self.assertIn("APP", system_content)
        self.assertIn("## 可用工具", system_content)
        self.assertIn("- read_file(", system_content)
        self.assertIn("<action>", system_content)
        self.assertIn("<final>", system_content)
        self.assertNotIn('"parameters"', system_content)
        self.assertLess(
            system_content.index("## 可用工具"),
            system_content.index("【响应协议】"),
        )
        self.assertEqual({"role": "user", "content": "hi"}, payload[1])

    def test_custom_prompt_section_is_composed_in_order(self):
        registry = build_default_prompt_registry()
        registry.register(
            PromptSection(
                "project_rules",
                lambda context: "PROJECT RULE",
                order=250,
            )
        )
        model, calls = self.make_model(
            [{"respMessage": "thought: d\n\n<final>\nok"}],
            prompt_registry=registry,
        )

        model.complete(
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

        system_content = calls[0][2][0]["content"]
        self.assertIn("PROJECT RULE", system_content)
        self.assertLess(
            system_content.index("## 可用工具"),
            system_content.index("PROJECT RULE"),
        )
        self.assertLess(
            system_content.index("PROJECT RULE"),
            system_content.index("【响应协议】"),
        )

    def test_builtin_prompt_section_can_be_removed(self):
        registry = build_default_prompt_registry()
        registry.unregister("mattermost_examples")
        model, calls = self.make_model(
            [{"respMessage": "thought: d\n\n<final>\nok"}],
            prompt_registry=registry,
        )

        model.complete(
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

        system_content = calls[0][2][0]["content"]
        self.assertIn("【响应协议】", system_content)
        self.assertNotIn("【示例 1", system_content)

    def test_full_xml_round_trip_through_agent(self):
        model, calls = self.make_model(
            [
                {
                    "respMessage": (
                        "thought: 先读 README。\n\n<action>\n"
                        '{"calls": [{"tool": "read_file", '
                        '"args": {"path": "README.md"}}]}'
                    )
                },
                {"respMessage": "thought: 读到了。\n\n<final>\n完成"},
            ]
        )
        tools = ToolRegistry(
            [
                Tool(
                    "read_file",
                    "read",
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
            ]
        )
        store = InMemoryMessageStore()
        result = Agent(
            model,
            tools,
            store,
            AgentConfig(system_prompt="SYS"),
        ).run("read README")

        self.assertEqual("完成", result.final)
        messages = store.get_messages()
        self.assertEqual(
            ["user", "assistant", "tool", "assistant"],
            [message["role"] for message in messages],
        )
        self.assertEqual("1", messages[1]["tool_calls"][0]["id"])
        self.assertEqual("read_file", messages[2]["name"])
        self.assertEqual("hello", messages[2]["data"]["content"])

        second_payload = calls[1][2]
        self.assertEqual(
            ["system", "user", "assistant", "user"],
            [message["role"] for message in second_payload],
        )
        assistant_text = second_payload[2]["content"]
        self.assertIn("thought: 先读 README。", assistant_text)
        self.assertIn("<action>", assistant_text)
        tool_text = second_payload[3]["content"]
        self.assertIn(
            '<tool_result call="1" tool="read_file" status="ok">',
            tool_text,
        )
        self.assertIn('{"path": "README.md"}', tool_text)
        self.assertIn("---\nhello", tool_text)

    def test_protocol_error_retries_with_feedback(self):
        model, calls = self.make_model(
            [
                {"respMessage": "thought: t\n\nno marker here"},
                {
                    "respMessage": (
                        "thought: t\n\n<action>\n"
                        '{"calls": [{"tool": "read_file", '
                        '"args": {"path": "a"}}]}'
                    )
                },
                {"respMessage": "thought: done\n\n<final>\nok"},
            ]
        )
        tools = ToolRegistry(
            [
                Tool(
                    "read_file",
                    "read",
                    {
                        "type": "object",
                        "properties": {"path": {"type": "string"}},
                    },
                    lambda arguments: {"content": "hi"},
                )
            ]
        )
        store = InMemoryMessageStore()
        result = Agent(
            model, tools, store, AgentConfig(system_prompt="SYS")
        ).run("go")

        self.assertEqual("ok", result.final)
        messages = store.get_messages()
        self.assertEqual(
            ["user", "assistant", "user", "assistant", "tool", "assistant"],
            [message["role"] for message in messages],
        )
        self.assertEqual("thought: t\n\nno marker here", messages[1]["content"])
        self.assertTrue(messages[1].get("raw"))
        self.assertIn("missing_payload", messages[2]["content"])
        self.assertIn("<action>", messages[2]["content"])

        second_payload = calls[1][2]
        self.assertEqual(
            ["system", "user", "assistant", "user"],
            [message["role"] for message in second_payload],
        )
        self.assertIn("missing_payload", second_payload[3]["content"])

    def test_invalid_plugin_response_raises(self):
        model, _ = self.make_model([{"other": 1}])
        with self.assertRaises(RuntimeError):
            model.complete(
                ModelRequest(messages=[{"role": "user", "content": "hi"}])
            )

    def test_non_string_plugin_response_raises(self):
        model, _ = self.make_model([{"respMessage": 5}])
        with self.assertRaises(RuntimeError):
            model.complete(
                ModelRequest(messages=[{"role": "user", "content": "hi"}])
            )


class InputBoxTests(unittest.TestCase):
    def test_read_input_draws_box_and_reads_multiline(self):
        buffer = io.StringIO()
        inputs = ["hello", "world", ""]
        with redirect_stdout(buffer), patch(
            "builtins.input", side_effect=inputs
        ):
            text = read_input()

        self.assertEqual("hello\nworld", text)
        output = Console._ANSI_RE.sub("", buffer.getvalue())
        self.assertIn("╭─", output)
        self.assertIn("╰", output)
        self.assertIn("> ", output)


class DeepSeekEnvTests(unittest.TestCase):
    def test_load_dotenv_does_not_override_existing(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text(
                "DEEPSEEK_API_KEY=from-file\n"
                "DEEPSEEK_MODEL=deepseek-chat\n",
                encoding="utf-8",
            )
            with patch.dict(
                os.environ,
                {"DEEPSEEK_API_KEY": "from-env"},
                clear=False,
            ):
                _load_dotenv(path)
                self.assertEqual(
                    "from-env", os.environ["DEEPSEEK_API_KEY"]
                )
                self.assertEqual(
                    "deepseek-chat", os.environ["DEEPSEEK_MODEL"]
                )


class DisplayIntegrationTests(unittest.TestCase):
    def test_send_to_ai_renders_tool_tree_and_final(self):
        responses = [
            {
                "respMessage": (
                    "thought: 先读 README。\n\n<action>\n"
                    '{"calls": [{"tool": "read_file", '
                    '"args": {"path": "README.md"}}]}'
                )
            },
            {
                "respMessage": (
                    "thought: 读到了。\n\n<final>\n"
                    "Herald 是一个学习型项目。"
                )
            },
        ]

        def transport(method, path, payload):
            return responses.pop(0)

        state = SimpleNamespace(
            current_account={"TEAM_ID": "team-1"},
            current_model_key="sendMessageToLLM",
            current_model_name="m1",
        )
        model = MattermostModel(
            state,
            SimpleNamespace(base_url="https://example.com"),
            transport,
        )
        tools = ToolRegistry(
            [
                Tool(
                    "read_file",
                    "read",
                    {
                        "type": "object",
                        "properties": {"path": {"type": "string"}},
                        "required": ["path"],
                    },
                    lambda arguments: {
                        "path": arguments["path"],
                        "content": "# Herald\nline2",
                        "truncated": False,
                    },
                )
            ]
        )

        buffer = io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            original = commands.RESPONSE_PATH
            commands.RESPONSE_PATH = Path(directory) / "response.md"
            try:
                with redirect_stdout(buffer):
                    commands.send_to_ai(
                        "读一下 README",
                        state,
                        SimpleNamespace(system_prompt=""),
                        model,
                        tools,
                        InMemoryMessageStore(),
                    )
            finally:
                commands.RESPONSE_PATH = original

        output = buffer.getvalue()
        self.assertIn("Read", output)
        self.assertIn("(README.md)", output)
        self.assertIn("⎿", output)
        self.assertIn("Read 2 lines (14 B)", output)
        self.assertIn("⏺", output)
        self.assertIn("Herald 是一个学习型项目。", output)
        self.assertIn("2 rounds", output)


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
