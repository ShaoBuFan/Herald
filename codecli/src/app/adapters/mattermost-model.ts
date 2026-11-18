import type {
  ModelRequest,
  ModelTurn,
} from "../../core/models.js";
import type { ModelAdapter } from "../../core/protocols.js";
import {
  PromptContext,
  type PromptRegistry,
} from "../prompt/registry.js";
import {
  buildDefaultPromptRegistry,
  renderTextMessages,
  turnFromTextResponse,
  type TextMessage,
} from "./mattermost-protocol.js";
import { createTimeoutSignal } from "./signal.js";

export interface MattermostAccount {
  CSRF_TOKEN: string;
  AUTH_TOKEN: string;
  USER_ID: string;
  TEAM_ID: string;
  [key: string]: unknown;
}

export interface MattermostState {
  current_account: MattermostAccount;
  current_model_key: string;
  current_model_name: string;
}

export interface MattermostConfig {
  base_url: string;
}

export type MattermostTransport = (
  method: string,
  path: string,
  payload: unknown,
  signal?: AbortSignal,
) => Promise<unknown>;

export interface MattermostOptions {
  promptRegistry?: PromptRegistry;
}

interface WireMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export class MattermostModel implements ModelAdapter {
  readonly state: MattermostState;
  readonly config: MattermostConfig;
  readonly transport: MattermostTransport;
  readonly promptRegistry: PromptRegistry;

  constructor(
    state: MattermostState,
    config: MattermostConfig,
    transport?: MattermostTransport,
    options: MattermostOptions = {},
  ) {
    this.state = state;
    this.config = config;
    this.transport =
      transport ??
      ((method, path, payload, signal) =>
        this.request(method, path, payload, signal));
    this.promptRegistry =
      options.promptRegistry ??
      buildDefaultPromptRegistry();
  }

  private headers(): Record<string, string> {
    const account = this.state.current_account;
    return {
      Accept: "*/*",
      "Content-Type": "text/plain;charset=UTF-8",
      Origin: this.config.base_url,
      "User-Agent": "Mozilla/5.0",
      "X-CSRF-Token": account.CSRF_TOKEN,
      "X-Requested-With": "XMLHttpRequest",
      Cookie:
        `MMAUTHTOKEN=${account.AUTH_TOKEN}; ` +
        `MMUSERID=${account.USER_ID}; ` +
        `MMCSRF=${account.CSRF_TOKEN}`,
    };
  }

  private async request(
    method: string,
    path: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const url = `${this.config.base_url}${path}`;
    const body =
      payload === null || payload === undefined
        ? undefined
        : JSON.stringify(payload);
    const response = await fetch(url, {
      method,
      headers: this.headers(),
      body,
      signal: createTimeoutSignal(240, signal),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `HTTP ${response.status}: ${detail.slice(0, 500)}`,
      );
    }
    return JSON.parse(await response.text()) as unknown;
  }

  async complete(
    request: ModelRequest,
    signal?: AbortSignal,
  ): Promise<ModelTurn> {
    const account = this.state.current_account;
    const key = this.state.current_model_key;
    let query =
      `requestTime=${Date.now()}&` +
      `accessTeam=${encodeURIComponent(account.TEAM_ID)}`;
    if (key === "sendMessageToGemini") {
      query +=
        `&chatModel=${encodeURIComponent(
          this.state.current_model_name,
        )}` +
        `&enableWebSearch=${
          this.state.current_model_name.includes("Flash Lite")
            ? "true"
            : "false"
        }`;
    }

    const context = new PromptContext({
      system: request.system,
      tools: request.tools,
    });
    const systemContent = this.promptRegistry.render(context);
    const payload = MattermostModel.wireMessages(
      systemContent,
      renderTextMessages(request.messages),
    );

    const result = await this.transport(
      "POST",
      `/plugins/aslead-chatgpt/${key}?${query}`,
      payload,
      signal,
    );
    const message = isRecord(result)
      ? result["respMessage"]
      : null;
    if (
      typeof message !== "string" ||
      !message.trim()
    ) {
      throw new Error(
        `模型响应无效: ${JSON.stringify(result)}`,
      );
    }

    return turnFromTextResponse(message, {
      hasTools: request.tools.length > 0,
      raw: result,
    });
  }

  private static wireMessages(
    systemContent: string,
    messages: TextMessage[],
  ): WireMessage[] {
    if (!systemContent.trim()) {
      return messages.map((message) => ({
        role: message.role,
        content: message.content,
      }));
    }
    return [
      { role: "system", content: systemContent.trim() },
      ...messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ];
  }

  getMe(): Promise<unknown> {
    return this.request("GET", "/api/v4/users/me", null);
  }

  getUsage(): Promise<unknown> {
    return this.request(
      "GET",
      "/plugins/aslead-chatgpt/checkUserShow?isKeyDown=false",
      null,
    );
  }
}
