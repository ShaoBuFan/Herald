import type { AgentResult } from "../../core/models.js";
import type { PromptRegistry } from "../prompt/registry.js";
import type { SessionStore } from "../session/store.js";

export interface AppHost {
  appName: string;
  provider: string;
  cwd: string;
  modelName(): string;
  promptRegistry: PromptRegistry;
  sessionStore?: SessionStore;
  listModels?(): Array<{ label: string }>;
  selectModel?(index: number): string;
  getUsage?(): Promise<unknown>;
  getUser?(): Promise<unknown>;
  onResult?(result: AgentResult): Promise<void> | void;
}
