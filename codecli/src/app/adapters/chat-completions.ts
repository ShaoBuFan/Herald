import type {
  ModelRequest,
  ModelTurn,
} from "../../core/models.js";
import type { ModelAdapter } from "../../core/protocols.js";
import type { PromptRegistry } from "../prompt/registry.js";
import {
  DEFAULT_TIMEOUT,
  buildPayload,
  chatCompletionsUrl,
  httpPostJson,
  requestHeaders,
  resolveConfig,
  turnFromChatResponse,
  type JsonTransport,
} from "./openai-common.js";
import { applyPromptRegistry } from "./prompt.js";

export interface ChatCompletionsOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  promptRegistry?: PromptRegistry;
  transport?: JsonTransport;
  timeout?: number;
}

export class ChatCompletionsModel implements ModelAdapter {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeout: number;
  readonly promptRegistry?: PromptRegistry;
  readonly transport: JsonTransport;

  constructor(options: ChatCompletionsOptions = {}) {
    const config = resolveConfig(
      options.baseUrl,
      options.apiKey,
      options.model,
    );
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.promptRegistry = options.promptRegistry;
    this.transport =
      options.transport ??
      ((url, headers, payload, signal) =>
        httpPostJson(
          url,
          headers,
          payload,
          this.timeout,
          signal,
        ));
  }

  async complete(
    request: ModelRequest,
    signal?: AbortSignal,
  ): Promise<ModelTurn> {
    const effective = applyPromptRegistry(
      request,
      this.promptRegistry,
    );
    const payload = buildPayload(this.model, effective, {
      stream: false,
    });
    const data = await this.transport(
      chatCompletionsUrl(this.baseUrl),
      requestHeaders(this.apiKey),
      payload,
      signal,
    );
    return turnFromChatResponse(data);
  }
}
