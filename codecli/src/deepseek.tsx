import path from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "ink";

import { ChatCompletionsModel } from "./app/adapters/chat-completions.js";
import { SESSIONS_DIR, saveResponse } from "./app/config.js";
import { loadEnvFiles } from "./app/env.js";
import {
  PromptRegistry,
  PromptSection,
} from "./app/prompt/registry.js";
import { SessionStore } from "./app/session/store.js";
import { createFileTools } from "./app/tools/index.js";
import { App, type AppHost } from "./app/ui/App.js";
import { AgentConfig } from "./core/index.js";

const NATIVE_SYSTEM_PROMPT =
  "你是一个在本地工作区里工作的编程 agent。" +
  "你可以使用提供的工具读取、搜索、写入文件。" +
  "先理解任务，再决定是否需要调用工具；可以多步推进。" +
  "回答使用中文，除非用户要求其他语言。";

function buildNativePromptRegistry(): PromptRegistry {
  const registry = new PromptRegistry();
  registry.register(
    new PromptSection({
      name: "app_system",
      render: () => NATIVE_SYSTEM_PROMPT,
      order: 100,
    }),
  );
  return registry;
}

function main(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(here, "..");
  loadEnvFiles([
    path.join(process.cwd(), ".env"),
    path.join(projectRoot, ".env"),
  ]);

  const apiKey = (process.env["DEEPSEEK_API_KEY"] ?? "").trim();
  if (!apiKey) {
    console.error("✗ 未找到 DEEPSEEK_API_KEY");
    console.error(
      "请在 codecli/.env 或仓库根目录 .env 中填写，或 export DEEPSEEK_API_KEY=...",
    );
    process.exit(1);
  }

  const baseUrl =
    (process.env["DEEPSEEK_BASE_URL"] ?? "").trim() ||
    "https://api.deepseek.com/v1";
  const modelName =
    (process.env["DEEPSEEK_MODEL"] ?? "").trim() ||
    "deepseek-chat";
  const workspace = path.resolve(process.cwd());

  const model = new ChatCompletionsModel({
    baseUrl,
    apiKey,
    model: modelName,
  });
  const tools = createFileTools(workspace);
  const store = new SessionStore(SESSIONS_DIR);
  const promptRegistry = buildNativePromptRegistry();
  const config = new AgentConfig({
    systemPrompt: NATIVE_SYSTEM_PROMPT,
  });

  const host: AppHost = {
    appName: "CodeCLI",
    provider: "DeepSeek",
    cwd: workspace,
    modelName: () => modelName,
    promptRegistry,
    sessionStore: store,
    onResult: (result) => {
      saveResponse(result.final);
    },
  };

  render(
    <App
      model={model}
      tools={tools}
      store={store}
      config={config}
      host={host}
    />,
  );
}

main();
