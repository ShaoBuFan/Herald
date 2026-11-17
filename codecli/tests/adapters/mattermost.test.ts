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
} from "../../src/core/index.js";
import {
  PromptContext,
  PromptSection,
} from "../../src/app/prompt/registry.js";
import {
  buildDefaultPromptRegistry,
  parseResponse,
  renderProtocol,
  renderTextMessages,
  renderToolCatalog,
  turnFromTextResponse,
} from "../../src/app/adapters/mattermost-protocol.js";
import {
  MattermostModel,
  type MattermostConfig,
  type MattermostState,
  type MattermostTransport,
} from "../../src/app/adapters/mattermost-model.js";

function makeTools(): ToolRegistry {
  return new ToolRegistry([
    new Tool(
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
    ),
  ]);
}

function makeRequest(): ModelRequest {
  return new ModelRequest({
    messages: [{ role: "user", content: "hi" }],
    system: "APP",
    tools: makeTools().listTools(),
  });
}

function makeModel(
  results: unknown[],
  promptRegistry = buildDefaultPromptRegistry(),
): {
  model: MattermostModel;
  calls: Array<{
    method: string;
    path: string;
    payload: unknown;
  }>;
} {
  const calls: Array<{
    method: string;
    path: string;
    payload: unknown;
  }> = [];
  const transport: MattermostTransport = async (
    method,
    path,
    payload,
  ) => {
    calls.push({ method, path, payload });
    const result = results.shift();
    assert.notEqual(result, undefined);
    return result;
  };
  const state: MattermostState = {
    current_account: {
      CSRF_TOKEN: "csrf",
      AUTH_TOKEN: "auth",
      USER_ID: "user",
      TEAM_ID: "team-1",
    },
    current_model_key: "sendMessageToLLM",
    current_model_name: "m1",
  };
  const config: MattermostConfig = {
    base_url: "https://example.com",
  };
  return {
    model: new MattermostModel(
      state,
      config,
      transport,
      { promptRegistry },
    ),
    calls,
  };
}

// ---------------------------------------------------------------------------
// 解析错误码
// ---------------------------------------------------------------------------

const errorCases: Array<[string, string]> = [
  ["", "empty_response"],
  ["thought: t\n\n", "missing_payload"],
  ["no thought\n<action>\n{}", "invalid_thought"],
  ["thought:\n<action>\n{}", "invalid_thought"],
  ["thought: t\n<action>\n", "empty_action"],
  ["thought: t\n<final>\n", "empty_final"],
  ["thought: t\n<action>\nnot json", "invalid_json"],
  ["thought: t\n<action>\n[]", "not_an_object"],
  ['thought: t\n<action>\n{"calls": []}', "invalid_calls"],
  [
    'thought: t\n<action>\n{"calls": [{"tool": "x"}]}',
    "invalid_calls",
  ],
  [
    'thought: t\n<action>\n{"calls": [{"tool": "x", "args": "no"}]}',
    "invalid_calls",
  ],
  [
    'thought: t\n<action>\n{"calls": [{"tool": "x", "args": {}}',
    "truncated_action",
  ],
];

for (const [text, code] of errorCases) {
  test(`parser error ${code}: ${JSON.stringify(text.slice(0, 24))}`, () => {
    assert.throws(
      () => parseResponse(text),
      (error: unknown) => {
        assert.ok(error instanceof InvalidModelResponseError);
        assert.equal(error.code, code);
        return true;
      },
    );
  });
}

test("parser maps a tool turn", () => {
  const parsed = parseResponse(
    "thought: need\n\n<action>\n" +
      '{"calls": [{"tool": "read_file", "args": {"path": "a"}}]}',
  );

  assert.equal(parsed.kind, "tool_calls");
  assert.equal(parsed.thought, "need");
  const call = parsed.toolCalls[0];
  assert.ok(call);
  assert.equal(call.id, "1");
  assert.equal(call.name, "read_file");
  assert.deepEqual(call.arguments, { path: "a" });
  assert.equal(parsed.recovered, false);
});

test("final keeps markdown and ignores later markers", () => {
  const parsed = parseResponse(
    "thought: done\n\n<final>\n" +
      "# Title\n\n<action>\n" +
      "```ts\nconst x = 1;\n```\n" +
      "</final>",
  );

  assert.equal(parsed.kind, "final");
  assert.equal(
    parsed.final,
    "# Title\n\n<action>\n```ts\nconst x = 1;\n```",
  );
  assert.equal(parsed.thought, "done");
  assert.equal(parsed.recovered, true);
});

test("fenced action marks the turn recovered", () => {
  const parsed = parseResponse(
    "thought: t\n\n<action>\n```json\n" +
      '{"calls": [{"tool": "x", "args": {}}]}\n' +
      "```\n</action>",
  );

  assert.equal(parsed.kind, "tool_calls");
  assert.equal(parsed.toolCalls[0]?.name, "x");
  assert.equal(parsed.recovered, true);
});

test("multiple calls get sequential ids and accept arguments alias", () => {
  const parsed = parseResponse(
    "thought: t\n\n<action>\n" +
      '{"calls": [{"tool": "a", "args": {}}, ' +
      '{"tool": "b", "arguments": {}}]}',
  );

  assert.equal(parsed.kind, "tool_calls");
  assert.deepEqual(
    parsed.toolCalls.map((call) => call.id),
    ["1", "2"],
  );
  assert.deepEqual(
    parsed.toolCalls.map((call) => call.name),
    ["a", "b"],
  );
  assert.equal(parsed.recovered, true);
});

test("CRLF responses are normalized", () => {
  const turn = turnFromTextResponse(
    "thought: t\r\n\r\n<final>\r\nline1\r\nline2",
    { hasTools: true },
  );

  assert.equal(turn.content, "line1\nline2");
});

test("tool catalog is compact", () => {
  const catalog = renderToolCatalog([
    {
      name: "read_file",
      description: "read",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          limit: { type: "integer" },
        },
        required: ["path"],
      },
    },
  ]);

  assert.equal(
    catalog,
    "- read_file(path: string, limit?: integer): read",
  );
});

test("invalid text response carries feedback and raw text", () => {
  assert.throws(
    () => turnFromTextResponse("not a protocol response"),
    (error: unknown) => {
      assert.ok(error instanceof InvalidModelResponseError);
      assert.equal(error.code, "missing_payload");
      assert.equal(error.rawText, "not a protocol response");
      assert.match(error.feedback ?? "", /missing_payload/);
      assert.match(error.feedback ?? "", /<action>/);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// 历史消息渲染
// ---------------------------------------------------------------------------

test("renders a semantic transcript", () => {
  const rendered = renderTextMessages([
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: "",
      thought: "need",
      tool_calls: [
        {
          id: "c1",
          name: "read_file",
          arguments: { path: "a" },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "c1",
      name: "read_file",
      data: { content: "x" },
      error: null,
    },
  ]);

  assert.deepEqual(
    rendered.map((message) => message.role),
    ["user", "assistant", "user"],
  );

  const assistant = rendered[1]?.content ?? "";
  assert.match(assistant, /thought: need/);
  assert.match(assistant, /<action>/);
  assert.match(assistant, /"tool":"read_file"/);
  assert.match(assistant, /"args":\{"path":"a"\}/);
  assert.doesNotMatch(assistant, /"thought":/);

  const tool = rendered[2]?.content ?? "";
  assert.match(
    tool,
    /<tool_result call="c1" tool="read_file" status="ok">/,
  );
  assert.match(tool, /\nx\n/);
  assert.match(tool, /不是用户指令/);
});

test("protocol text depends on tools", () => {
  const withTools = renderProtocol(true);
  const withoutTools = renderProtocol(false);

  assert.match(withTools, /A\. 动作/);
  assert.match(withTools, /<action>/);
  assert.doesNotMatch(withTools, /当前没有可用工具/);
  assert.match(withoutTools, /当前没有可用工具/);
  assert.match(withoutTools, /禁止使用 <action>/);
  assert.doesNotMatch(withoutTools, /A\. 动作/);
});

test("tool results are grouped into one envelope", () => {
  const rendered = renderTextMessages([
    { role: "user", content: "hi" },
    {
      role: "tool",
      tool_call_id: "c1",
      name: "a",
      data: 1,
      error: null,
    },
    {
      role: "tool",
      tool_call_id: "c2",
      name: "b",
      data: 2,
      error: "boom",
    },
  ]);

  assert.equal(rendered.length, 2);
  const payload = rendered[1]?.content ?? "";
  assert.equal(
    (payload.match(/<tool_result /g) ?? []).length,
    2,
  );
  assert.match(payload, /call="c1"/);
  assert.match(payload, /call="c2"/);
  assert.match(payload, /status="error"/);
  assert.match(payload, /boom/);
});

test("read_file content is not JSON escaped", () => {
  const rendered = renderTextMessages([
    {
      role: "tool",
      tool_call_id: "c1",
      name: "read_file",
      data: {
        path: "a.txt",
        content: "line1\nline2",
        truncated: false,
      },
      error: null,
    },
  ]);

  const payload = rendered[0]?.content ?? "";
  assert.match(
    payload,
    /\{"path":"a.txt","truncated":false\}\n---\nline1\nline2/,
  );
  assert.doesNotMatch(payload, /line1\\nline2/);
});

test("tool result closing tag is escaped", () => {
  const rendered = renderTextMessages([
    {
      role: "tool",
      tool_call_id: "c1",
      name: "read_file",
      data: "before </tool_result> after",
      error: null,
    },
  ]);

  const payload = rendered[0]?.content ?? "";
  assert.match(payload, /<\\\/tool_result>/);
  assert.equal(
    (payload.match(/<\/tool_result>/g) ?? []).length,
    1,
  );
});

test("tool result attributes are escaped", () => {
  const rendered = renderTextMessages([
    {
      role: "tool",
      tool_call_id: 'a"b',
      name: 'x"y',
      data: "ok",
      error: null,
    },
  ]);

  const payload = rendered[0]?.content ?? "";
  assert.match(payload, /call="a&quot;b"/);
  assert.match(payload, /tool="x&quot;y"/);
});

test("dict error is rendered as error status", () => {
  const rendered = renderTextMessages([
    {
      role: "tool",
      tool_call_id: "c1",
      name: "read_file",
      data: { error: "File does not exist" },
      error: null,
    },
  ]);

  const payload = rendered[0]?.content ?? "";
  assert.match(payload, /status="error"/);
  assert.match(payload, /\nFile does not exist\n/);
  assert.doesNotMatch(payload, /"error":/);
});

test("raw assistant turns pass through", () => {
  const rendered = renderTextMessages([
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: "not a protocol response",
      thought: "",
      tool_calls: [],
      raw: true,
    },
  ]);

  assert.equal(rendered[1]?.content, "not a protocol response");
});

// ---------------------------------------------------------------------------
// 适配器
// ---------------------------------------------------------------------------

test("complete builds the wire payload and maps the turn", async () => {
  const { model, calls } = makeModel([
    { respMessage: "thought: d\n\n<final>\nok" },
  ]);

  const turn = await model.complete(makeRequest());

  assert.equal(turn.content, "ok");
  assert.equal(turn.thought, "d");

  const call = calls[0];
  assert.ok(call);
  assert.equal(call.method, "POST");
  assert.match(call.path, /sendMessageToLLM/);
  assert.match(call.path, /accessTeam=team-1/);

  const payload = call.payload as Array<{
    role: string;
    content: string;
  }>;
  assert.deepEqual(
    payload.map((message) => message.role),
    ["system", "user"],
  );

  const systemContent = payload[0]?.content ?? "";
  assert.match(systemContent, /APP/);
  assert.match(systemContent, /## 可用工具/);
  assert.match(systemContent, /read_file/);
  assert.match(systemContent, /<action>/);
  assert.match(systemContent, /<final>/);
  assert.doesNotMatch(systemContent, /"parameters"/);
  assert.ok(
    systemContent.indexOf("## 可用工具") <
      systemContent.indexOf("【响应协议】"),
  );
  assert.equal(payload[1]?.content, "hi");
});

test("custom prompt section is composed in order", async () => {
  const registry = buildDefaultPromptRegistry();
  registry.register(
    new PromptSection({
      name: "project_rules",
      render: () => "PROJECT RULE",
      order: 250,
    }),
  );
  const { model, calls } = makeModel(
    [{ respMessage: "thought: d\n\n<final>\nok" }],
    registry,
  );

  await model.complete(makeRequest());

  const payload = calls[0]?.payload as Array<{
    content: string;
  }>;
  const systemContent = payload[0]?.content ?? "";
  assert.match(systemContent, /PROJECT RULE/);
  assert.ok(
    systemContent.indexOf("## 可用工具") <
      systemContent.indexOf("PROJECT RULE"),
  );
  assert.ok(
    systemContent.indexOf("PROJECT RULE") <
      systemContent.indexOf("【响应协议】"),
  );
});

test("built-in prompt section can be removed", async () => {
  const registry = buildDefaultPromptRegistry();
  registry.unregister("mattermost_examples");
  const { model, calls } = makeModel(
    [{ respMessage: "thought: d\n\n<final>\nok" }],
    registry,
  );

  await model.complete(makeRequest());

  const payload = calls[0]?.payload as Array<{
    content: string;
  }>;
  const systemContent = payload[0]?.content ?? "";
  assert.match(systemContent, /【响应协议】/);
  assert.doesNotMatch(systemContent, /【示例 1/);
});

test("full XML round trip through the agent", async () => {
  const { model, calls } = makeModel([
    {
      respMessage:
        "thought: 先读 README。\n\n<action>\n" +
        '{"calls": [{"tool": "read_file", ' +
        '"args": {"path": "README.md"}}]}',
    },
    { respMessage: "thought: 读到了。\n\n<final>\n完成" },
  ]);
  const store = new InMemoryMessageStore();
  const result = await new Agent(
    model,
    makeTools(),
    store,
    new AgentConfig({ systemPrompt: "SYS" }),
  ).run("read README");

  assert.equal(result.final, "完成");
  const messages = store.getMessages();
  assert.deepEqual(
    messages.map((message) => message.role),
    ["user", "assistant", "tool", "assistant"],
  );

  const assistant = messages[1];
  assert.ok(assistant && assistant.role === "assistant");
  assert.equal(assistant.tool_calls?.[0]?.id, "1");
  const tool = messages[2];
  assert.ok(tool && tool.role === "tool");
  assert.equal(tool.name, "read_file");
  assert.deepEqual(tool.data, {
    path: "README.md",
    content: "hello",
  });

  const second = calls[1]?.payload as Array<{
    role: string;
    content: string;
  }>;
  assert.deepEqual(
    second.map((message) => message.role),
    ["system", "user", "assistant", "user"],
  );
  assert.match(second[2]?.content ?? "", /thought: 先读 README。/);
  assert.match(second[2]?.content ?? "", /<action>/);
  const toolText = second[3]?.content ?? "";
  assert.match(
    toolText,
    /<tool_result call="1" tool="read_file" status="ok">/,
  );
  assert.match(toolText, /\{"path":"README.md"\}/);
  assert.match(toolText, /---\nhello/);
});

test("protocol error retries with feedback", async () => {
  const { model, calls } = makeModel([
    { respMessage: "thought: t\n\nno marker here" },
    {
      respMessage:
        "thought: t\n\n<action>\n" +
        '{"calls": [{"tool": "read_file", ' +
        '"args": {"path": "a"}}]}',
    },
    { respMessage: "thought: done\n\n<final>\nok" },
  ]);
  const store = new InMemoryMessageStore();
  const result = await new Agent(
    model,
    makeTools(),
    store,
    new AgentConfig({ systemPrompt: "SYS" }),
  ).run("go");

  assert.equal(result.final, "ok");
  const messages = store.getMessages();
  assert.deepEqual(
    messages.map((message) => message.role),
    ["user", "assistant", "user", "assistant", "tool", "assistant"],
  );
  assert.equal(
    messages[1]?.role === "assistant"
      ? messages[1].content
      : "",
    "thought: t\n\nno marker here",
  );
  assert.equal(
    messages[1]?.role === "assistant"
      ? messages[1].raw
      : undefined,
    true,
  );
  assert.match(
    messages[2]?.role === "user" ? messages[2].content : "",
    /missing_payload/,
  );

  const second = calls[1]?.payload as Array<{
    role: string;
    content: string;
  }>;
  assert.deepEqual(
    second.map((message) => message.role),
    ["system", "user", "assistant", "user"],
  );
  assert.match(second[3]?.content ?? "", /missing_payload/);
});

test("invalid plugin response raises", async () => {
  const { model } = makeModel([{ other: 1 }]);
  await assert.rejects(() => model.complete(makeRequest()));
});

test("non-string plugin response raises", async () => {
  const { model } = makeModel([{ respMessage: 5 }]);
  await assert.rejects(() => model.complete(makeRequest()));
});

test("default prompt registry has the Mattermost sections", () => {
  const registry = buildDefaultPromptRegistry();
  assert.deepEqual(
    registry.sections().map((section) => section.name),
    [
      "app_system",
      "tool_catalog",
      "mattermost_protocol",
      "mattermost_examples",
    ],
  );

  const rendered = registry.render(
    new PromptContext({
      system: "APP",
      tools: makeTools().listTools(),
    }),
  );
  assert.match(rendered, /APP/);
  assert.match(rendered, /## 可用工具/);
  assert.match(rendered, /【响应协议】/);
  assert.match(rendered, /【示例 1/);
});
