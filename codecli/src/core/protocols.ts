import type {
  Message,
  ModelRequest,
  ModelTurn,
  ToolSchema,
} from "./models.js";

export interface ModelAdapter {
  complete(
    request: ModelRequest,
    signal?: AbortSignal,
  ): Promise<ModelTurn>;
}

export interface MessageStore {
  getMessages(): Message[];
  append(message: Message): void;
  replaceMessages(messages: Message[]): void;
  clear?(): void;
}

export interface ToolExecutor {
  listTools(): ToolSchema[];
  execute(
    name: string,
    arguments_: Record<string, unknown>,
  ): Promise<unknown> | unknown;
}

