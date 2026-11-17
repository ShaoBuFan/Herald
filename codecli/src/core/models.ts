import { deepClone } from "./clone.js";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: unknown };

export interface ToolSchema {
  name: string;
  description: string;
  parameters: JsonObject;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: JsonObject;
}

export interface ToolResult {
  id: string;
  name: string;
  data: unknown;
  error: string | null;
}

export interface ModelTurn {
  content: string;
  thought: string;
  toolCalls: readonly ToolCall[];
  usage: Record<string, unknown> | null;
  raw: unknown;
  recovered: boolean;
}

export interface AgentResult {
  final: string;
  thought: string;
  rounds: number;
  metadata: Record<string, unknown>;
}

export interface UserMessage {
  role: "user";
  content: string;
}

export interface SystemMessage {
  role: "system";
  content: string;
}

export interface AssistantMessage {
  role: "assistant";
  content: string;
  thought?: string;
  tool_calls?: ToolCall[];
  raw?: boolean;
}

export interface ToolMessage {
  role: "tool";
  tool_call_id: string;
  name: string;
  data: unknown;
  error?: string | null;
}

export type Message =
  | UserMessage
  | SystemMessage
  | AssistantMessage
  | ToolMessage;

export interface ModelRequestInit {
  messages: Message[];
  system?: string;
  tools?: ToolSchema[];
}

export class ModelRequest {
  readonly messages: Message[];
  readonly system: string;
  readonly tools: ToolSchema[];

  constructor(init: ModelRequestInit) {
    if (
      !init.messages.every(
        (message) => typeof message === "object" && message !== null,
      )
    ) {
      throw new TypeError("messages must contain objects");
    }
    if (init.messages.some((message) => message.role === "system")) {
      throw new Error("system messages belong in ModelRequest.system");
    }
    this.messages = deepClone(init.messages);
    this.system = init.system ?? "";
    this.tools = deepClone(init.tools ?? []);
  }
}

export interface AgentConfigInit {
  systemPrompt?: string;
  maxRounds?: number;
  retryInvalidResponse?: boolean;
  maxInvalidResponseRetries?: number;
}

export class AgentConfig {
  readonly systemPrompt: string;
  readonly maxRounds: number;
  readonly retryInvalidResponse: boolean;
  readonly maxInvalidResponseRetries: number;

  constructor(init: AgentConfigInit = {}) {
    this.systemPrompt = init.systemPrompt ?? "";
    this.maxRounds = init.maxRounds ?? 150;
    this.retryInvalidResponse = init.retryInvalidResponse ?? true;
    this.maxInvalidResponseRetries = init.maxInvalidResponseRetries ?? 3;

    if (this.maxRounds <= 0) {
      throw new RangeError("max_rounds must be greater than 0");
    }
    if (this.maxInvalidResponseRetries < 0) {
      throw new RangeError(
        "max_invalid_response_retries must not be negative",
      );
    }
  }
}

export function modelTurn(init: Partial<ModelTurn> = {}): ModelTurn {
  return {
    content: init.content ?? "",
    thought: init.thought ?? "",
    toolCalls: init.toolCalls ?? [],
    usage: init.usage ?? null,
    raw: init.raw,
    recovered: init.recovered ?? false,
  };
}
