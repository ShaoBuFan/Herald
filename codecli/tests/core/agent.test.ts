import assert from "node:assert/strict";
import test from "node:test";

import {
  Agent,
  AgentConfig,
  InMemoryMessageStore,
  InvalidModelResponseError,
  ModelRequest,
  Tool,
  ToolRegistry,
  modelTurn,
  type AgentEvent,
  type Message,
  type ModelTurn,
  type ToolCall,
  type ToolExecutor,
  type ToolSchema,
  type UserMessage,
} from "../../src/core/index.js";

type ScriptedTurn = ModelTurn | Error;

class ScriptedAdapter {
  readonly requests: ModelRequest[] = [];
  private readonly turns: ScriptedTurn[];

  constructor(turns: ScriptedTurn[]) {
    this.turns = [...turns];
  }

  async complete(request: ModelRequest): Promise<ModelTurn> {
    this.requests.push(request);
    const item = this.turns.shift();
    if (!item) {
      throw new Error("no scripted turn left");
    }
    if (item instanceof Error) {
      throw item;
    }
    return item;
  }
}

function makeTool(): Tool {
  return new Tool(
    "read_file",
    "读取文件",
    {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    (arguments_) => ({
      path: arguments_["path"],
      content: "hello",
    }),
  );
}

function makeAgent(
  turns: ScriptedTurn[],
  tools: ToolExecutor = new ToolRegistry(),
  config: AgentConfig = new AgentConfig(),
  events?: AgentEvent[],
): {
  adapter: ScriptedAdapter;
  store: InMemoryMessageStore;
  agent: Agent;
} {
  const adapter = new ScriptedAdapter(turns);
  const store = new InMemoryMessageStore();
  const agent = new Agent(
    adapter,
    tools,
    store,
    config,
    events
      ? (event) => {
          events.push(event);
        }
      : undefined,
  );
  return { adapter, store, agent };
}

function finalTurn(content = "ok", thought = "t"): ModelTurn {
  return modelTurn({ content, thought });
}

function toolTurn(...calls: ToolCall[]): ModelTurn {
  return modelTurn({ thought: "t", toolCalls: calls });
}

test("request carries semantic fields", async () => {
  const { adapter, agent } = makeAgent(
    [finalTurn()],
    new ToolRegistry([makeTool()]),
    new AgentConfig({ systemPrompt: "SYS" }),
  );

  await agent.run("hi");

  const request = adapter.requests[0];
  assert.ok(request);
  assert.equal(request.system, "SYS");
  assert.deepEqual(
    request.tools.map((tool) => tool.name),
    ["read_file"],
  );
  assert.deepEqual(request.messages, [{ role: "user", content: "hi" }]);
  assert.equal("protocol" in request, false);
});

test("legacy system messages are filtered", async () => {
  const adapter = new ScriptedAdapter([finalTurn()]);
  const store = new InMemoryMessageStore([
    { role: "system", content: "legacy" },
  ]);
  const agent = new Agent(
    adapter,
    new ToolRegistry(),
    store,
    new AgentConfig({ systemPrompt: "SYS" }),
  );

  await agent.run("hi");

  const request = adapter.requests[0];
  assert.ok(request);
  assert.deepEqual(request.messages, [
    { role: "user", content: "hi" },
  ]);
});

test("model_request event exposes the snapshot", async () => {
  const events: AgentEvent[] = [];
  const { agent } = makeAgent(
    [finalTurn()],
    new ToolRegistry([makeTool()]),
    new AgentConfig({ systemPrompt: "SYS" }),
    events,
  );

  await agent.run("hi");

  const event = events.find(
    (item) => item.type === "model_request",
  );
  assert.ok(event && event.type === "model_request");
  assert.equal(event.data.system, "SYS");
  assert.deepEqual(
    event.data.tools.map((tool) => tool.name),
    ["read_file"],
  );
  assert.equal("protocol" in event.data, false);
});

test("final turn is recorded with semantics", async () => {
  const { store, agent } = makeAgent([finalTurn("ok", "think")]);

  await agent.run("hi");

  assert.deepEqual(store.getMessages(), [
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: "ok",
      thought: "think",
      tool_calls: [],
    },
  ]);
});

test("tool turn records assistant and tool messages", async () => {
  const call: ToolCall = {
    id: "c1",
    name: "read_file",
    arguments: { path: "a" },
  };
  const { store, agent } = makeAgent(
    [toolTurn(call), finalTurn("done", "d")],
    new ToolRegistry([makeTool()]),
  );

  const result = await agent.run("hi");
  assert.equal(result.final, "done");

  const messages = store.getMessages();
  assert.deepEqual(
    messages.map((message) => message.role),
    ["user", "assistant", "tool", "assistant"],
  );

  const assistant = messages[1];
  assert.ok(assistant && assistant.role === "assistant");
  assert.deepEqual(assistant.tool_calls, [
    { id: "c1", name: "read_file", arguments: { path: "a" } },
  ]);

  const tool = messages[2];
  assert.ok(tool && tool.role === "tool");
  assert.equal(tool.tool_call_id, "c1");
  assert.equal(tool.name, "read_file");
  assert.deepEqual(tool.data, {
    path: "a",
    content: "hello",
  });
  assert.equal(tool.error, null);
});

test("unknown tool is fed back without retry", async () => {
  const events: AgentEvent[] = [];
  const { adapter, store, agent } = makeAgent(
    [
      toolTurn({ id: "c1", name: "nope", arguments: {} }),
      finalTurn(),
    ],
    new ToolRegistry(),
    new AgentConfig(),
    events,
  );

  const result = await agent.run("hi");

  assert.equal(result.final, "ok");
  assert.equal(
    events.some((event) => event.type === "retry"),
    false,
  );
  assert.equal(adapter.requests.length, 2);

  const tool = store.getMessages()[2];
  assert.ok(tool && tool.role === "tool");
  assert.match(tool.error ?? "", /unknown tool: nope/);
});

test("recovered turn emits parse_recovered", async () => {
  const events: AgentEvent[] = [];
  const { agent } = makeAgent(
    [modelTurn({ content: "ok", thought: "t", recovered: true })],
    new ToolRegistry(),
    new AgentConfig(),
    events,
  );

  await agent.run("hi");

  assert.equal(
    events.some((event) => event.type === "parse_recovered"),
    true,
  );
});

test("invalid response appends raw attempt and feedback", async () => {
  const events: AgentEvent[] = [];
  const error = new InvalidModelResponseError("bad json", {
    code: "invalid_json",
    feedback: "FIX IT",
    rawText: "bad raw",
  });
  const { adapter, store, agent } = makeAgent(
    [error, finalTurn()],
    new ToolRegistry(),
    new AgentConfig(),
    events,
  );

  const result = await agent.run("hi");

  const messages = store.getMessages();
  assert.deepEqual(
    messages.map((message) => message.role),
    ["user", "assistant", "user", "assistant"],
  );

  const rawAttempt = messages[1];
  assert.ok(rawAttempt && rawAttempt.role === "assistant");
  assert.equal(rawAttempt.raw, true);
  assert.equal(rawAttempt.content, "bad raw");

  const feedback = messages[2];
  assert.ok(feedback && feedback.role === "user");
  assert.equal(feedback.content, "FIX IT");
  assert.equal(adapter.requests.length, 2);

  const retry = events.find((event) => event.type === "retry");
  assert.ok(retry && retry.type === "retry");
  assert.equal(retry.data.attempt, 1);
  assert.equal(retry.data.remaining, 2);
  assert.equal(retry.data.code, "invalid_json");
  assert.equal(result.final, "ok");
});

test("empty raw text only appends feedback", async () => {
  const error = new InvalidModelResponseError("empty", {
    code: "empty_response",
    feedback: "FIX",
    rawText: "",
  });
  const { store, agent } = makeAgent([error, finalTurn()]);

  await agent.run("hi");

  assert.deepEqual(
    store.getMessages().map((message) => message.role),
    ["user", "user", "assistant"],
  );
  const feedback = store.getMessages()[1];
  assert.ok(feedback && feedback.role === "user");
  assert.equal(feedback.content, "FIX");
});

test("retry budget counts consecutive invalid responses", async () => {
  const errors = Array.from(
    { length: 5 },
    () =>
      new InvalidModelResponseError("bad", {
        code: "invalid_json",
      }),
  );
  const { adapter, agent } = makeAgent(
    errors,
    new ToolRegistry(),
    new AgentConfig({
      maxInvalidResponseRetries: 2,
      maxRounds: 10,
    }),
  );

  await assert.rejects(
    () => agent.run("hi"),
    InvalidModelResponseError,
  );
  assert.equal(adapter.requests.length, 3);
});

test("retry budget resets after a valid round", async () => {
  const error = new InvalidModelResponseError("bad", {
    code: "invalid_json",
  });
  const { adapter, agent } = makeAgent(
    [
      toolTurn({ id: "c1", name: "read_file", arguments: { path: "a" } }),
      error,
      finalTurn("ok"),
    ],
    new ToolRegistry([makeTool()]),
    new AgentConfig({
      maxInvalidResponseRetries: 1,
      maxRounds: 10,
    }),
  );

  const result = await agent.run("hi");

  assert.equal(result.final, "ok");
  assert.equal(adapter.requests.length, 3);
});

test("snapshot is isolated from source mutation", () => {
  const messages: Message[] = [{ role: "user", content: "hi" }];
  const tools: ToolSchema[] = [
    { name: "t", description: "", parameters: { type: "object" } },
  ];
  const request = new ModelRequest({ messages, tools });

  const sourceMessage = messages[0];
  assert.ok(sourceMessage && sourceMessage.role === "user");
  (sourceMessage as UserMessage).content = "changed";

  const sourceTool = tools[0];
  assert.ok(sourceTool);
  sourceTool.parameters["type"] = "changed";

  const requestMessage = request.messages[0];
  assert.ok(requestMessage && requestMessage.role === "user");
  assert.equal(requestMessage.content, "hi");

  const requestTool = request.tools[0];
  assert.ok(requestTool);
  assert.equal(requestTool.parameters["type"], "object");
});

test("system messages are rejected", () => {
  assert.throws(
    () =>
      new ModelRequest({
        messages: [{ role: "system", content: "x" }],
      }),
    /system messages belong in ModelRequest.system/,
  );
});

class SnapshotGuardedExecutor implements ToolExecutor {
  readonly executed: string[] = [];

  listTools(): ToolSchema[] {
    return [
      {
        name: "read_file",
        description: "read",
        parameters: { type: "object" },
      },
    ];
  }

  execute(name: string): unknown {
    this.executed.push(name);
    return "ok";
  }
}

test("tool outside the run snapshot is rejected", async () => {
  const executor = new SnapshotGuardedExecutor();
  const { adapter, store, agent } = makeAgent(
    [
      toolTurn({ id: "c1", name: "ghost", arguments: {} }),
      finalTurn("ok"),
    ],
    executor,
  );

  const result = await agent.run("hi");

  assert.equal(result.final, "ok");
  assert.deepEqual(executor.executed, []);

  const tool = store.getMessages()[2];
  assert.ok(tool && tool.role === "tool");
  assert.match(tool.error ?? "", /unknown tool: ghost/);

  const request = adapter.requests[0];
  assert.ok(request);
  assert.deepEqual(
    request.tools.map((toolSchema) => toolSchema.name),
    ["read_file"],
  );
});

class SignalCapturingExecutor implements ToolExecutor {
  signal: AbortSignal | undefined;
  executed = false;

  listTools(): ToolSchema[] {
    return [
      {
        name: "read_file",
        description: "read",
        parameters: { type: "object" },
      },
    ];
  }

  execute(
    _name: string,
    _arguments: Record<string, unknown>,
    context?: { signal?: AbortSignal },
  ): unknown {
    this.executed = true;
    this.signal = context?.signal;
    return "ok";
  }
}

test("agent passes the run signal to tool execution", async () => {
  const executor = new SignalCapturingExecutor();
  const controller = new AbortController();
  const { agent } = makeAgent(
    [
      toolTurn({
        id: "c1",
        name: "read_file",
        arguments: { path: "a" },
      }),
      finalTurn("ok"),
    ],
    executor,
  );

  const result = await agent.run("hi", {
    signal: controller.signal,
  });

  assert.equal(result.final, "ok");
  assert.equal(executor.executed, true);
  assert.equal(executor.signal, controller.signal);
});

test("agent refuses to start an aborted run", async () => {
  const controller = new AbortController();
  controller.abort();
  const { agent } = makeAgent([finalTurn("never")]);

  await assert.rejects(
    () => agent.run("hi", { signal: controller.signal }),
    /agent run aborted/,
  );
});
