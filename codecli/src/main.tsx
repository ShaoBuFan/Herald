import { render } from "ink";

import { MattermostModel } from "./app/adapters/mattermost-model.js";
import { buildDefaultPromptRegistry } from "./app/adapters/mattermost-protocol.js";
import {
  AppState,
  loadConfig,
} from "./app/adapters/mattermost-config.js";
import {
  PROJECT_ROOT,
  SESSIONS_DIR,
  saveResponse,
} from "./app/paths.js";
import { SessionStore } from "./app/session/store.js";
import { createWorkspaceTools } from "./app/tools/index.js";
import { App, type AppHost } from "./app/ui/App.js";
import { AgentConfig } from "./core/index.js";

function main(): void {
  const config = loadConfig();
  const state = new AppState(config);
  const promptRegistry = buildDefaultPromptRegistry();
  const mattermost = new MattermostModel(
    state,
    config,
    undefined,
    { promptRegistry },
  );
  const tools = createWorkspaceTools(PROJECT_ROOT);
  const store = new SessionStore(SESSIONS_DIR);

  const host: AppHost = {
    appName: "CodeCLI",
    provider: "Mattermost",
    cwd: PROJECT_ROOT,
    modelName: () => state.current_model_name,
    promptRegistry,
    sessionStore: store,
    listModels: () =>
      state.config.models.map((model) => ({
        label: `${model.NICKNAME} (${model.MODEL_NAME})`,
      })),
    selectModel: (index) => {
      const model = state.config.models[index];
      if (!model) {
        throw new Error("模型序号无效");
      }
      state.setCurrentModel(model);
      return state.current_model_name;
    },
    getUsage: () => mattermost.getUsage(),
    getUser: () => mattermost.getMe(),
    onResult: (result) => {
      saveResponse(result.final);
    },
  };

  render(
    <App
      model={mattermost}
      tools={tools}
      store={store}
      config={
        new AgentConfig({
          systemPrompt: config.system_prompt,
        })
      }
      host={host}
    />,
  );
}

try {
  main();
} catch (error) {
  console.error(
    `✗ ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
}
