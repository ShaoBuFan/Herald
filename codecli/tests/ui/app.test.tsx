import assert from "node:assert/strict";
import test from "node:test";
import { render } from "ink-testing-library";

import { App, type AppHost } from "../../src/app/ui/App.js";
import { Header } from "../../src/app/ui/Header.js";
import { InputBox } from "../../src/app/ui/InputBox.js";
import { Spinner } from "../../src/app/ui/Spinner.js";
import { ToolActivity } from "../../src/app/ui/ToolActivity.js";
import { PromptRegistry } from "../../src/app/prompt/registry.js";
import {
  AgentConfig,
  InMemoryMessageStore,
  Tool,
  ToolRegistry,
  modelTurn,
  type ModelAdapter,
  type ModelRequest,
  type ModelTurn,
} from "../../src/core/index.js";

function delay(ms = 30): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function makeHost(): AppHost {
  return {
    appName: "CodeCLI",
    provider: "Test",
    cwd: "D:\\work",
    modelName: () => "test-model",
    promptRegistry: new PromptRegistry(),
    sessionStore: undefined,
  };
}

function makeModel(requests: ModelRequest[]): ModelAdapter {
  return {
    async complete(request) {
      requests.push(request);
      return modelTurn({ content: "完成" });
    },
  };
}

function makeScriptedModel(turns: ModelTurn[]): {
  requests: ModelRequest[];
  model: ModelAdapter;
} {
  const requests: ModelRequest[] = [];
  return {
    requests,
    model: {
      async complete(request) {
        requests.push(request);
        const turn = turns.shift();
        if (!turn) {
          throw new Error("no scripted turn left");
        }
        return turn;
      },
    },
  };
}

function renderApp(
  model: ModelAdapter,
  host: AppHost = makeHost(),
  tools: ToolRegistry = new ToolRegistry(),
) {
  return render(
    <App
      model={model}
      tools={tools}
      store={new InMemoryMessageStore()}
      config={new AgentConfig()}
      host={host}
    />,
  );
}

async function submitText(
  stdin: { write(text: string): void },
  text: string,
): Promise<void> {
  stdin.write(text);
  await delay();
  stdin.write("\r");
  await delay();
  stdin.write("\r");
  await delay(180);
}

test("Header renders the Claude Code style banner", () => {
  const { lastFrame, unmount } = render(
    <Header
      appName="CodeCLI"
      version="0.1.0"
      provider="DeepSeek"
      model="deepseek-chat"
      cwd={"D:\\work"}
      toolCount={8}
      modeCount={4}
    />,
  );

  const frame = lastFrame() ?? "";
  assert.match(frame, /\/ ____\//);
  assert.match(frame, /╭─ CodeCLI v0\.1\.0/);
  assert.match(frame, /Welcome back!/);
  assert.match(frame, /DeepSeek · deepseek-chat · API Usage/);
  assert.match(frame, /D:\\work/);
  assert.match(frame, /Tips for getting started/);
  assert.match(frame, /8 tools · 4 modes/);
  assert.match(frame, /Recent activity/);
  assert.match(frame, /No recent activity/);
  unmount();
});

test("InputBox renders multiline values with a native cursor", () => {
  const { lastFrame, unmount } = render(
    <InputBox value={"first\nsecond"} busy={false} />,
  );

  const frame = lastFrame() ?? "";
  assert.match(frame, />/);
  assert.match(frame, /first/);
  assert.match(frame, /second/);
  assert.doesNotMatch(frame, /▌/);
  unmount();
});

test("InputBox uses the busy prefix while working", () => {
  const { lastFrame, unmount } = render(
    <InputBox value="working" busy={true} />,
  );

  const frame = lastFrame() ?? "";
  assert.match(frame, /…/);
  assert.match(frame, /working/);
  assert.doesNotMatch(frame, /▌/);
  unmount();
});

test("ToolActivity renders completed and pending tool lines", () => {
  const completed = render(
    <ToolActivity
      name="read_file"
      arguments={{ path: "README.md" }}
      data={{ content: "a\nb\n", truncated: false }}
      error={null}
      durationMs={200}
    />,
  );
  const completedFrame = completed.lastFrame() ?? "";
  assert.match(completedFrame, /●/);
  assert.match(completedFrame, /Read README\.md/);
  assert.match(completedFrame, /0\.2s/);
  assert.match(completedFrame, /3 lines/);
  completed.unmount();

  const pending = render(
    <ToolActivity
      name="bash"
      arguments={{ command: "git status" }}
      startedAt={Date.now() - 1_000}
      pending
    />,
  );
  const pendingFrame = pending.lastFrame() ?? "";
  assert.match(pendingFrame, /Running command/);
  assert.match(pendingFrame, /\$ git status/);
  pending.unmount();

  const denied = render(
    <ToolActivity
      name="write_file"
      arguments={{ path: "x" }}
      error="permission denied by user: write_file"
      durationMs={5}
    />,
  );
  assert.match(denied.lastFrame() ?? "", /Not run · denied/);
  denied.unmount();
});

test("Spinner renders label, elapsed time, tokens and tip", () => {
  const { lastFrame, unmount } = render(
    <Spinner
      label="Thinking"
      startedAt={Date.now() - 2_000}
      tokens={717}
    />,
  );
  const frame = lastFrame() ?? "";
  assert.match(frame, /Thinking/);
  assert.match(frame, /↓ 717 tokens/);
  assert.match(frame, /Tip:/);
  unmount();
});

test("App submits a prompt on double Enter and renders the reply", async () => {
  const requests: ModelRequest[] = [];
  const model = makeModel(requests);
  const store = new InMemoryMessageStore();
  let saved = "";
  const host: AppHost = {
    ...makeHost(),
    onResult: (result) => {
      saved = result.final;
    },
  };
  const { stdin, lastFrame, unmount } = render(
    <App
      model={model}
      tools={new ToolRegistry()}
      store={store}
      config={new AgentConfig()}
      host={host}
    />,
  );

  const initial = stripAnsi(lastFrame() ?? "");
  assert.match(initial, /CodeCLI v0\.1\.0/);
  assert.match(initial, /manual mode on/);
  assert.match(initial, /◆ max · \/effort/);

  await submitText(stdin, "你好");

  const frame = stripAnsi(lastFrame() ?? "");
  assert.match(frame, /> 你好/);
  assert.match(frame, /完成/);
  assert.match(frame, /Thought for/);
  assert.match(frame, /Cogitated for/);
  assert.equal(requests.length, 1);
  assert.equal(store.getMessages().length, 2);
  assert.equal(saved, "完成");
  unmount();
});

test("App executes slash commands and switches mode/effort", async () => {
  const requests: ModelRequest[] = [];
  const { stdin, lastFrame, unmount } = renderApp(
    makeModel(requests),
  );

  stdin.write("/help");
  await delay();
  stdin.write("\r");
  await delay(80);
  assert.match(lastFrame() ?? "", /命令说明/);

  stdin.write("/mode plan");
  await delay();
  stdin.write("\r");
  await delay(80);
  assert.match(lastFrame() ?? "", /模式已切换: Plan/);
  assert.match(lastFrame() ?? "", /plan mode on/);

  stdin.write("/effort low");
  await delay();
  stdin.write("\r");
  await delay(80);
  assert.match(lastFrame() ?? "", /effort 已切换: low/);
  assert.match(lastFrame() ?? "", /◆ low · \/effort/);

  assert.equal(requests.length, 0);
  unmount();
});

test("App asks for permission in manual mode and allows the tool", async () => {
  const calls: string[] = [];
  const writeTool = new Tool(
    "write_file",
    "write",
    { type: "object" },
    () => {
      calls.push("write");
      return { status: true, path: "x.txt", bytes_written: 2 };
    },
    "write",
  );
  const { model } = makeScriptedModel([
    modelTurn({
      toolCalls: [
        {
          id: "c1",
          name: "write_file",
          arguments: { path: "x.txt", content: "hi" },
        },
      ],
    }),
    modelTurn({ content: "完成" }),
  ]);
  const { stdin, lastFrame, unmount } = renderApp(
    model,
    makeHost(),
    new ToolRegistry([writeTool]),
  );

  await submitText(stdin, "写文件");
  const permission = stripAnsi(lastFrame() ?? "");
  assert.match(permission, /Permission required/);
  assert.match(permission, /Write/);
  assert.match(permission, /y allow · n deny/);

  stdin.write("y");
  await delay(180);
  const result = stripAnsi(lastFrame() ?? "");
  assert.match(result, /完成/);
  assert.deepEqual(calls, ["write"]);
  unmount();
});

test("App denies a tool and continues the agent", async () => {
  const calls: string[] = [];
  const writeTool = new Tool(
    "write_file",
    "write",
    { type: "object" },
    () => {
      calls.push("write");
      return { status: true, path: "x.txt", bytes_written: 2 };
    },
    "write",
  );
  const { model } = makeScriptedModel([
    modelTurn({
      toolCalls: [
        {
          id: "c1",
          name: "write_file",
          arguments: { path: "x.txt", content: "hi" },
        },
      ],
    }),
    modelTurn({ content: "收到拒绝" }),
  ]);
  const { stdin, lastFrame, unmount } = renderApp(
    model,
    makeHost(),
    new ToolRegistry([writeTool]),
  );

  await submitText(stdin, "写文件");
  stdin.write("n");
  await delay(180);
  const frame = stripAnsi(lastFrame() ?? "");
  assert.match(frame, /Not run · denied/);
  assert.match(frame, /收到拒绝/);
  assert.deepEqual(calls, []);
  unmount();
});

test("App renders todo_write results as a checklist", async () => {
  const todoTool = new Tool(
    "todo_write",
    "todo",
    { type: "object" },
    (arguments_) => ({
      todos: arguments_["todos"],
      counts: { pending: 1, in_progress: 1, completed: 0 },
    }),
    "meta",
  );
  const { model } = makeScriptedModel([
    modelTurn({
      toolCalls: [
        {
          id: "c1",
          name: "todo_write",
          arguments: {
            todos: [
              { content: "第一步", status: "completed" },
              {
                content: "第二步",
                status: "in_progress",
                activeForm: "正在做第二步",
              },
              { content: "第三步", status: "pending" },
            ],
          },
        },
      ],
    }),
    modelTurn({ content: "计划已更新" }),
  ]);
  const { stdin, lastFrame, unmount } = renderApp(
    model,
    makeHost(),
    new ToolRegistry([todoTool]),
  );

  await submitText(stdin, "列计划");
  const frame = stripAnsi(lastFrame() ?? "");
  assert.match(frame, /Tasks/);
  assert.match(frame, /✔ 第一步/);
  assert.match(frame, /◐ 正在做第二步/);
  assert.match(frame, /☐ 第三步/);
  assert.match(frame, /计划已更新/);
  unmount();
});

test("App can be interrupted with Esc", async () => {
  let started = false;
  const model: ModelAdapter = {
    complete(_request, signal) {
      started = true;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    },
  };
  const { stdin, lastFrame, unmount } = renderApp(model);

  stdin.write("慢慢来");
  await delay();
  stdin.write("\r");
  await delay();
  stdin.write("\r");
  await delay(80);
  assert.equal(started, true);

  stdin.write("\u001b");
  await delay(100);
  assert.match(lastFrame() ?? "", /Interrupted by user/);
  unmount();
});