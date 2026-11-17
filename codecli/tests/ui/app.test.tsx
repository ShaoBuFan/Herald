import assert from "node:assert/strict";
import test from "node:test";
import { render } from "ink-testing-library";

import { Spinner } from "../../src/app/ui/Spinner.js";
import { ToolCallLine, ToolResultLine } from "../../src/app/ui/ToolCard.js";
import { Welcome } from "../../src/app/ui/Welcome.js";
import { InputBox } from "../../src/app/ui/InputBox.js";
import { App, type AppHost } from "../../src/app/ui/App.js";
import {
  AgentConfig,
  InMemoryMessageStore,
  ToolRegistry,
  modelTurn,
  type ModelAdapter,
  type ModelRequest,
} from "../../src/core/index.js";
import { PromptRegistry } from "../../src/app/prompt/registry.js";

function delay(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

test("Welcome renders the two-column panel", () => {
  const { lastFrame, unmount } = render(
    <Welcome
      appName="CodeCLI"
      provider="DeepSeek"
      model="deepseek-chat"
      cwd="D:\\work"
      runtime="node v20.18.0"
      toolCount={4}
    />,
  );

  const frame = lastFrame() ?? "";
  assert.match(frame, /CodeCLI/);
  assert.match(frame, /What's new/);
  assert.match(frame, /Workspace/);
  assert.match(frame, /deepseek-chat/);
  assert.match(frame, /cwd\s+D:.*work/);
  assert.match(frame, /4/);
  unmount();
});

test("InputBox renders multiline values and the cursor", () => {
  const { lastFrame, unmount } = render(
    <InputBox value={"first\nsecond"} busy={false} />,
  );

  const frame = lastFrame() ?? "";
  assert.match(frame, /first/);
  assert.match(frame, /second/);
  assert.match(frame, /▌/);
  unmount();
});

test("InputBox hides the cursor while busy", () => {
  const { lastFrame, unmount } = render(
    <InputBox value="working" busy={true} />,
  );

  const frame = lastFrame() ?? "";
  assert.match(frame, /working/);
  assert.doesNotMatch(frame, /▌/);
  unmount();
});

test("tool call and result lines use Claude Code markers", () => {
  const call = render(
    <ToolCallLine name="read_file" detail="README.md" />,
  );
  assert.match(call.lastFrame() ?? "", /⏺/);
  assert.match(call.lastFrame() ?? "", /Read/);
  assert.match(call.lastFrame() ?? "", /README\.md/);
  call.unmount();

  const result = render(
    <ToolResultLine
      name="read_file"
      data={{ content: "a\nb\n", truncated: false }}
      error={null}
    />,
  );
  assert.match(result.lastFrame() ?? "", /⎿/);
  assert.match(result.lastFrame() ?? "", /Read 3 lines/);
  result.unmount();
});

test("Spinner renders its label", () => {
  const { lastFrame, unmount } = render(<Spinner label="Thinking" />);
  assert.match(lastFrame() ?? "", /Thinking/);
  unmount();
});

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

  assert.match(lastFrame() ?? "", /What's new/);
  stdin.write("你好");
  await delay();
  stdin.write("\r");
  await delay();
  stdin.write("\r");
  await delay(80);

  const frame = stripAnsi(lastFrame() ?? "");
  assert.match(frame, /You/);
  assert.match(frame, /你好/);
  assert.match(frame, /完成/);
  assert.match(frame, /1 round/);
  assert.equal(requests.length, 1);
  assert.equal(store.getMessages().length, 2);
  assert.equal(saved, "完成");
  unmount();
});

test("App executes slash commands without a model call", async () => {
  const requests: ModelRequest[] = [];
  const model = makeModel(requests);
  const { stdin, lastFrame, unmount } = render(
    <App
      model={model}
      tools={new ToolRegistry()}
      store={new InMemoryMessageStore()}
      config={new AgentConfig()}
      host={makeHost()}
    />,
  );

  stdin.write("/help");
  await delay();
  stdin.write("\r");
  await delay(50);

  assert.match(lastFrame() ?? "", /命令说明/);
  assert.equal(requests.length, 0);
  unmount();
});
