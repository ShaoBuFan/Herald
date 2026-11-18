import {
  InvalidModelResponseError,
  ModelAdapterError,
} from "../../core/errors.js";
import {
  modelTurn,
  type ModelRequest,
  type ModelTurn,
  type ToolCall,
} from "../../core/models.js";
import type { ModelAdapter } from "../../core/protocols.js";
import type { PromptRegistry } from "../prompt/registry.js";
import {
  DEFAULT_TIMEOUT,
  buildPayload,
  chatCompletionsUrl,
  httpStreamLines,
  parseNativeToolCalls,
  requestHeaders,
  resolveConfig,
  type StreamTransport,
} from "./openai-common.js";
import { applyPromptRegistry } from "./prompt.js";

export interface StreamingChatCompletionsOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  promptRegistry?: PromptRegistry;
  onDelta?: (text: string) => void;
  onReasoningDelta?: (text: string) => void;
  onUsage?: (usage: Record<string, unknown>) => void;
  transport?: StreamTransport;
  timeout?: number;
}

interface CallEntry {
  id: string;
  name: string;
  arguments: string;
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

export class StreamingChatCompletionsModel
  implements ModelAdapter
{
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeout: number;
  readonly promptRegistry?: PromptRegistry;
  readonly onDelta?: (text: string) => void;
  readonly onReasoningDelta?: (text: string) => void;
  readonly onUsage?: (usage: Record<string, unknown>) => void;
  readonly transport: StreamTransport;

  constructor(options: StreamingChatCompletionsOptions = {}) {
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
    this.onDelta = options.onDelta;
    this.onReasoningDelta = options.onReasoningDelta;
    this.onUsage = options.onUsage;
    this.transport =
      options.transport ??
      ((url, headers, payload, signal) =>
        httpStreamLines(
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
      stream: true,
    });

    const contentParts: string[] = [];
    const thoughtParts: string[] = [];
    const calls = new Map<number, CallEntry>();
    let usage: Record<string, unknown> | null = null;
    let finishReason: string | null = null;

    for await (const line of this.transport(
      chatCompletionsUrl(this.baseUrl),
      requestHeaders(this.apiKey, true),
      payload,
      signal,
    )) {
      if (!line || line.startsWith(":")) {
        continue;
      }
      if (!line.startsWith("data:")) {
        continue;
      }

      const dataText = line.slice(5).trim();
      if (dataText === "[DONE]") {
        break;
      }

      let chunk: unknown;
      try {
        chunk = JSON.parse(dataText);
      } catch {
        throw new ModelAdapterError(
          `invalid SSE chunk: ${dataText.slice(0, 200)}`,
        );
      }
      if (!isRecord(chunk)) {
        throw new ModelAdapterError(
          `invalid SSE chunk: ${dataText.slice(0, 200)}`,
        );
      }

      if (chunk["error"]) {
        throw new ModelAdapterError(
          JSON.stringify(chunk["error"]),
        );
      }

      const usageValue = chunk["usage"];
      if (isRecord(usageValue)) {
        usage = usageValue;
        this.onUsage?.(usageValue);
      }

      const choices = chunk["choices"];
      if (!Array.isArray(choices) || choices.length === 0) {
        continue;
      }

      const choice = choices[0];
      if (!isRecord(choice)) {
        continue;
      }

      const reason = choice["finish_reason"];
      if (typeof reason === "string" && reason) {
        finishReason = reason;
      }

      const deltaValue = choice["delta"];
      const delta = isRecord(deltaValue) ? deltaValue : {};

      const contentDelta = delta["content"];
      if (
        typeof contentDelta === "string" &&
        contentDelta
      ) {
        contentParts.push(contentDelta);
        this.onDelta?.(contentDelta);
      }

      const reasoningDelta = delta["reasoning_content"];
      if (
        typeof reasoningDelta === "string" &&
        reasoningDelta
      ) {
        thoughtParts.push(reasoningDelta);
        this.onReasoningDelta?.(reasoningDelta);
      }

      const rawCalls = delta["tool_calls"];
      if (Array.isArray(rawCalls)) {
        for (const rawCall of rawCalls) {
          if (!isRecord(rawCall)) {
            continue;
          }
          const index =
            typeof rawCall["index"] === "number"
              ? rawCall["index"]
              : 0;
          let entry = calls.get(index);
          if (!entry) {
            entry = { id: "", name: "", arguments: "" };
            calls.set(index, entry);
          }

          const id = rawCall["id"];
          if (typeof id === "string" && id) {
            entry.id = id;
          }

          const functionValue = rawCall["function"];
          const functionRecord = isRecord(functionValue)
            ? functionValue
            : {};
          const name = functionRecord["name"];
          if (typeof name === "string" && name) {
            entry.name = name;
          }
          const argumentsDelta =
            functionRecord["arguments"];
          if (typeof argumentsDelta === "string") {
            entry.arguments += argumentsDelta;
          }
        }
      }
    }

    const nativeCalls = [...calls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, entry]) => ({
        id: entry.id || String(index),
        type: "function",
        function: {
          name: entry.name,
          arguments: entry.arguments || "{}",
        },
      }));

    const content = contentParts.join("");
    const thought = thoughtParts.join("");

    let toolCalls: ToolCall[];
    try {
      toolCalls = parseNativeToolCalls(nativeCalls);
    } catch (error) {
      if (
        error instanceof InvalidModelResponseError &&
        !error.rawText
      ) {
        error.rawText = JSON.stringify({
          content,
          tool_calls: nativeCalls,
        });
      }
      throw error;
    }

    if (!content.trim() && toolCalls.length === 0) {
      throw new InvalidModelResponseError(
        "stream ended without content or tool calls",
        {
          code: "empty_response",
          feedback: "你上一条回复为空，请重新回答。",
          rawText: content,
        },
      );
    }

    return modelTurn({
      content,
      thought,
      toolCalls,
      usage,
      raw: finishReason
        ? { finish_reason: finishReason }
        : null,
    });
  }
}
