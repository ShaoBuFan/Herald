import assert from "node:assert/strict";
import test from "node:test";

import {
  Agent,
  AgentConfig,
  InMemoryMessageStore,
  InvalidModelResponseError,
  ModelAdapterError,
  ModelRequest,
  Tool,
  ToolRegistry,
} from "../../src/core/index.js";
import {
  ChatCompletionsModel,
} from "../../src/app/adapters/chat-completions.js";
import {
  StreamingChatCompletionsModel,
} from "../../src/app/adapters/streaming-chat-completions.js";
import type {
  JsonTransport,
  StreamTransport,
} from "../../src/app/adapters/openai-common.js";

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
}

class RecordingJsonTransport {
  readonly calls: RecordedCall[] = [];
  private readonly response: unknown;

  constructor(response: unknown) {
    this.response = response;
  }

  transport: JsonTransport = async (
    url,
    headers,
    payload,
  ) => {
    this.calls.push({ url, headers, payload });
    return this.response;
  };
}

class RecordingStreamTransport {
  readonly calls: RecordedCall[] = [];
  readonly transport: StreamTransport;
  private readonly chunks: string[];

  constructor(chunks: string[]) {
    this.chunks = chunks;
    this.transport = (url, headers, payload) => {
      this.calls.push({ url, headers, payload });
      return (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })();
    };
  }
}

function makeRequest(): ModelRequest {
  return new ModelRequest({
    messages: [{ role: "user", content: "hi" }],
    system: "SYS",
    tools: [
      {
        name: "read_file",
        description: "read",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    ],
  });
}

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}`;
}

function makeTool(): Tool {
  return new Tool(
    "read_file",
    "read",
    {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    () => ({ content: "hi" }),
  );
}

test("chat completions payload and final response", async () => {
  const transport = new RecordingJsonTransport({
    choices: [{ message: { content: "hello" } }],
    usage: { total_tokens: 3 },
  });
  const model = new ChatCompletionsModel({
    baseUrl: "https://example.com/v1",
    apiKey: "k",
    model: "m",
    transport: transport.transport,
  });

  const turn = await model.complete(makeRequest());

  assert.equal(turn.content, "hello");
  assert.deepEqual(turn.usage, { total_tokens: 3 });

  const call = transport.calls[0];
  assert.ok(call);
  assert.equal(
    call.url,
    "https://example.com/v1/chat/completions",
  );
  assert.equal(call.headers["Authorization"], "Bearer k");
  assert.equal(call.headers["Accept"], "application/json");
  assert.equal(call.payload["model"], "m");
  assert.equal("stream" in call.payload, false);
  assert.deepEqual(call.payload["messages"], [
    { role: "system", content: "SYS" },
    { role: "user", content: "hi" },
  ]);

  const tools = call.payload["tools"] as Array<
    Record<string, unknown>
  >;
  assert.equal(tools[0]?.["type"], "function");
  assert.equal(call.payload["tool_choice"], "auto");
});

test("chat completions parses native tool calls", async () => {
  const transport = new RecordingJsonTransport({
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: {
                name: "read_file",
                arguments: '{"path": "README.md"}',
              },
            },
          ],
        },
      },
    ],
  });
  const model = new ChatCompletionsModel({
    baseUrl: "https://example.com/v1",
    apiKey: "k",
    model: "m",
    transport: transport.transport,
  });

  const turn = await model.complete(makeRequest());

  assert.equal(turn.content, "");
  const call = turn.toolCalls[0];
  assert.ok(call);
  assert.equal(call.id, "c1");
  assert.equal(call.name, "read_file");
  assert.deepEqual(call.arguments, { path: "README.md" });
});

test("invalid native tool arguments carry feedback", async () => {
  const transport = new RecordingJsonTransport({
    choices: [
      {
        message: {
          tool_calls: [
            {
              id: "c1",
              function: {
                name: "read_file",
                arguments: "not json",
              },
            },
          ],
        },
      },
    ],
  });
  const model = new ChatCompletionsModel({
    baseUrl: "https://example.com/v1",
    apiKey: "k",
    model: "m",
    transport: transport.transport,
  });

  await assert.rejects(
    () => model.complete(makeRequest()),
    (error: unknown) => {
      assert.ok(error instanceof InvalidModelResponseError);
      assert.equal(error.code, "invalid_tool_calls");
      assert.ok(error.feedback);
      assert.match(error.rawText, /tool_calls/);
      return true;
    },
  );
});

test("empty chat completion raises", async () => {
  const transport = new RecordingJsonTransport({
    choices: [{ message: { content: "" } }],
  });
  const model = new ChatCompletionsModel({
    baseUrl: "https://example.com/v1",
    apiKey: "k",
    model: "m",
    transport: transport.transport,
  });

  await assert.rejects(
    () => model.complete(makeRequest()),
    (error: unknown) => {
      assert.ok(error instanceof InvalidModelResponseError);
      assert.equal(error.code, "empty_response");
      return true;
    },
  );
});

test("request without tools omits native tools", async () => {
  const transport = new RecordingJsonTransport({
    choices: [{ message: { content: "ok" } }],
  });
  const model = new ChatCompletionsModel({
    baseUrl: "https://example.com/v1",
    apiKey: "k",
    model: "m",
    transport: transport.transport,
  });

  await model.complete(
    new ModelRequest({
      messages: [{ role: "user", content: "hi" }],
    }),
  );

  const call = transport.calls[0];
  assert.ok(call);
  assert.equal("tools" in call.payload, false);
  assert.equal("tool_choice" in call.payload, false);
});

function makeStreamingModel(
  chunks: string[],
  options: {
    onDelta?: (text: string) => void;
    onReasoningDelta?: (text: string) => void;
  } = {},
): {
  model: StreamingChatCompletionsModel;
  transport: RecordingStreamTransport;
} {
  const transport = new RecordingStreamTransport(chunks);
  const model = new StreamingChatCompletionsModel({
    baseUrl: "https://example.com/v1",
    apiKey: "k",
    model: "m",
    transport: transport.transport,
    onDelta: options.onDelta,
    onReasoningDelta: options.onReasoningDelta,
  });
  return { model, transport };
}

test("streaming content deltas reach the app", async () => {
  const deltas: string[] = [];
  const { model, transport } = makeStreamingModel(
    [
      sse({ choices: [{ delta: { content: "你" } }] }),
      sse({ choices: [{ delta: { content: "好" } }] }),
      sse({
        choices: [],
        usage: { total_tokens: 9 },
      }),
      "data: [DONE]",
    ],
    { onDelta: (text) => deltas.push(text) },
  );

  const turn = await model.complete(makeRequest());

  assert.deepEqual(deltas, ["你", "好"]);
  assert.equal(turn.content, "你好");
  assert.deepEqual(turn.usage, { total_tokens: 9 });

  const call = transport.calls[0];
  assert.ok(call);
  assert.equal(call.payload["stream"], true);
  assert.equal(call.headers["Accept"], "text/event-stream");
});

test("streaming tool call fragments are reassembled", async () => {
  const { model } = makeStreamingModel([
    sse({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "c1",
                function: {
                  name: "read_file",
                  arguments: "",
                },
              },
            ],
          },
        },
      ],
    }),
    sse({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                function: { arguments: '{"path": ' },
              },
            ],
          },
        },
      ],
    }),
    sse({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                function: { arguments: '"README.md"}' },
              },
            ],
          },
        },
      ],
    }),
    "data: [DONE]",
  ]);

  const turn = await model.complete(makeRequest());

  assert.equal(turn.toolCalls.length, 1);
  const call = turn.toolCalls[0];
  assert.ok(call);
  assert.equal(call.id, "c1");
  assert.equal(call.name, "read_file");
  assert.deepEqual(call.arguments, { path: "README.md" });
});

test("streaming reasoning delta has its own callback", async () => {
  const reasoning: string[] = [];
  const { model } = makeStreamingModel(
    [
      sse({
        choices: [
          { delta: { reasoning_content: "thinking" } },
        ],
      }),
      sse({ choices: [{ delta: { content: "ok" } }] }),
      "data: [DONE]",
    ],
    {
      onReasoningDelta: (text) => reasoning.push(text),
    },
  );

  const turn = await model.complete(makeRequest());

  assert.deepEqual(reasoning, ["thinking"]);
  assert.equal(turn.thought, "thinking");
  assert.equal(turn.content, "ok");
});

test("empty stream raises", async () => {
  const { model } = makeStreamingModel(["data: [DONE]"]);

  await assert.rejects(
    () => model.complete(makeRequest()),
    (error: unknown) => {
      assert.ok(error instanceof InvalidModelResponseError);
      assert.equal(error.code, "empty_response");
      return true;
    },
  );
});

test("invalid streamed arguments raise", async () => {
  const { model } = makeStreamingModel([
    sse({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "c1",
                function: {
                  name: "read_file",
                  arguments: "not json",
                },
              },
            ],
          },
        },
      ],
    }),
    "data: [DONE]",
  ]);

  await assert.rejects(
    () => model.complete(makeRequest()),
    (error: unknown) => {
      assert.ok(error instanceof InvalidModelResponseError);
      assert.equal(error.code, "invalid_tool_calls");
      assert.match(error.rawText, /tool_calls/);
      return true;
    },
  );
});

test("stream error chunk raises ModelAdapterError", async () => {
  const { model } = makeStreamingModel([
    sse({ error: { message: "boom" } }),
  ]);

  await assert.rejects(
    () => model.complete(makeRequest()),
    ModelAdapterError,
  );
});

test("non-data streaming lines are ignored", async () => {
  const { model } = makeStreamingModel([
    "",
    ": keepalive",
    "event: message",
    sse({ choices: [{ delta: { content: "ok" } }] }),
    "data: [DONE]",
  ]);

  const turn = await model.complete(makeRequest());
  assert.equal(turn.content, "ok");
});

test("streaming adapter runs through the agent loop", async () => {
  const deltas: string[] = [];
  const { model } = makeStreamingModel(
    [
      sse({ choices: [{ delta: { content: "done" } }] }),
      "data: [DONE]",
    ],
    { onDelta: (text) => deltas.push(text) },
  );
  const store = new InMemoryMessageStore();
  const agent = new Agent(
    model,
    new ToolRegistry(),
    store,
    new AgentConfig({ systemPrompt: "SYS" }),
  );

  const result = await agent.run("hi");

  assert.equal(result.final, "done");
  assert.deepEqual(deltas, ["done"]);
  assert.deepEqual(store.getMessages(), [
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: "done",
      thought: "",
      tool_calls: [],
    },
  ]);
});

test("native adapter runs through the agent with tools", async () => {
  const responses: unknown[] = [
    {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: {
                  name: "read_file",
                  arguments: '{"path": "README.md"}',
                },
              },
            ],
          },
        },
      ],
    },
    { choices: [{ message: { content: "done" } }] },
  ];
  const payloads: Record<string, unknown>[] = [];
  const transport: JsonTransport = async (
    _url,
    _headers,
    payload,
  ) => {
    payloads.push(payload);
    const response = responses.shift();
    assert.ok(response);
    return response;
  };
  const store = new InMemoryMessageStore();
  const agent = new Agent(
    new ChatCompletionsModel({
      baseUrl: "https://example.com/v1",
      apiKey: "k",
      model: "m",
      transport,
    }),
    new ToolRegistry([makeTool()]),
    store,
    new AgentConfig({ systemPrompt: "SYS" }),
  );

  const result = await agent.run("read");

  assert.equal(result.final, "done");
  assert.deepEqual(
    store.getMessages().map((message) => message.role),
    ["user", "assistant", "tool", "assistant"],
  );

  const second = payloads[1];
  assert.ok(second);
  const messages = second["messages"] as Array<
    Record<string, unknown>
  >;
  const assistant = messages[2];
  assert.ok(assistant);
  const toolCalls = assistant["tool_calls"] as Array<
    Record<string, unknown>
  >;
  assert.equal(toolCalls[0]?.["id"], "c1");
  const tool = messages[3];
  assert.ok(tool);
  assert.equal(tool["tool_call_id"], "c1");
});

