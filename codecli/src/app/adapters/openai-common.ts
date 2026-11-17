import {
  InvalidModelResponseError,
  ModelAdapterError,
} from "../../core/errors.js";
import {
  modelTurn,
  type Message,
  type ModelRequest,
  type ModelTurn,
  type ToolCall,
  type ToolSchema,
} from "../../core/models.js";

export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_TIMEOUT = 240;

export type JsonTransport = (
  url: string,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<unknown>;

export type StreamTransport = (
  url: string,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
) => AsyncIterable<string>;

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function resolveConfig(
  baseUrl?: string,
  apiKey?: string,
  model?: string,
): {
  baseUrl: string;
  apiKey: string;
  model: string;
} {
  const resolvedBase = (
    baseUrl ??
    process.env["OPENAI_BASE_URL"] ??
    DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
  const resolvedKey =
    apiKey ?? process.env["OPENAI_API_KEY"];
  const resolvedModel =
    model ?? process.env["OPENAI_MODEL"];

  if (!resolvedKey) {
    throw new Error(
      "OPENAI_API_KEY is required (or pass apiKey=...)",
    );
  }
  if (!resolvedModel) {
    throw new Error(
      "OPENAI_MODEL is required (or pass model=...)",
    );
  }

  return {
    baseUrl: resolvedBase,
    apiKey: resolvedKey,
    model: resolvedModel,
  };
}

export function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl}/chat/completions`;
}

export function requestHeaders(
  apiKey: string,
  stream = false,
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    Accept: stream ? "text/event-stream" : "application/json",
  };
}

export function renderMessages(
  messages: Message[],
  system: string,
): Record<string, unknown>[] {
  const rendered: Record<string, unknown>[] = [];
  if (system.trim()) {
    rendered.push({ role: "system", content: system });
  }

  for (const message of messages) {
    if (message.role === "user") {
      rendered.push({
        role: "user",
        content: message.content,
      });
      continue;
    }

    if (message.role === "assistant") {
      const content = message.content ?? "";
      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length > 0) {
        rendered.push({
          role: "assistant",
          content: content || null,
          tool_calls: toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: {
              name: call.name,
              arguments: JSON.stringify(
                call.arguments ?? {},
              ),
            },
          })),
        });
      } else {
        rendered.push({ role: "assistant", content });
      }
      continue;
    }

    if (message.role === "tool") {
      const payload: Record<string, unknown> = {
        data: message.data ?? null,
      };
      if (message.error) {
        payload["error"] = String(message.error);
      }
      rendered.push({
        role: "tool",
        tool_call_id: message.tool_call_id,
        content: JSON.stringify(payload),
      });
    }
  }

  return rendered;
}

export function renderTools(
  tools: ToolSchema[],
): Record<string, unknown>[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function buildPayload(
  model: string,
  request: ModelRequest,
  options: { stream: boolean },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model,
    messages: renderMessages(
      request.messages,
      request.system,
    ),
  };

  const tools = renderTools(request.tools);
  if (tools.length > 0) {
    payload["tools"] = tools;
    payload["tool_choice"] = "auto";
  }
  if (options.stream) {
    payload["stream"] = true;
  }
  return payload;
}

export function parseNativeToolCalls(
  rawCalls: unknown[],
): ToolCall[] {
  const calls: ToolCall[] = [];

  rawCalls.forEach((rawCall, index) => {
    if (!isRecord(rawCall)) {
      throw new InvalidModelResponseError(
        `tool_calls[${index}] must be an object`,
        {
          code: "invalid_tool_calls",
          feedback:
            "上一轮工具调用格式不合法，请重新调用工具。",
        },
      );
    }

    const functionValue = rawCall["function"];
    const functionRecord = isRecord(functionValue)
      ? functionValue
      : {};
    const name = functionRecord["name"];
    if (typeof name !== "string" || !name.trim()) {
      throw new InvalidModelResponseError(
        `tool_calls[${index}] missing function name`,
        {
          code: "invalid_tool_calls",
          feedback:
            "上一轮工具调用缺少函数名，请重新调用工具。",
        },
      );
    }

    const argumentsValue =
      functionRecord["arguments"] ?? "{}";
    let arguments_: unknown;
    if (isRecord(argumentsValue)) {
      arguments_ = argumentsValue;
    } else {
      if (typeof argumentsValue !== "string") {
        throw new InvalidModelResponseError(
          `tool_calls[${index}] arguments is not valid JSON`,
          {
            code: "invalid_tool_calls",
            feedback:
              "上一轮工具调用的 arguments 不是合法 JSON 对象，请重新调用工具并给出合法参数。",
          },
        );
      }
      try {
        arguments_ = JSON.parse(argumentsValue || "{}");
      } catch (error) {
        throw new InvalidModelResponseError(
          `tool_calls[${index}] arguments is not valid JSON: ${errorMessage(error)}`,
          {
            code: "invalid_tool_calls",
            feedback:
              "上一轮工具调用的 arguments 不是合法 JSON 对象，请重新调用工具并给出合法参数。",
          },
        );
      }
    }

    if (!isRecord(arguments_)) {
      throw new InvalidModelResponseError(
        `tool_calls[${index}] arguments must be an object`,
        {
          code: "invalid_tool_calls",
          feedback:
            "上一轮工具调用的 arguments 不是 JSON 对象，请重新调用工具并给出合法参数。",
        },
      );
    }

    const idValue = rawCall["id"];
    const id =
      idValue === undefined ||
      idValue === null ||
      idValue === ""
        ? String(index)
        : String(idValue);

    calls.push({
      id,
      name: name.trim(),
      arguments: arguments_,
    });
  });

  return calls;
}

export function turnFromChatResponse(
  data: unknown,
): ModelTurn {
  if (!isRecord(data)) {
    throw new InvalidModelResponseError(
      "response is not an object",
      {
        code: "empty_response",
        feedback: "模型没有返回任何结果，请重新回答。",
      },
    );
  }

  const choices = data["choices"];
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new InvalidModelResponseError(
      "response has no choices",
      {
        code: "empty_response",
        feedback: "模型没有返回任何结果，请重新回答。",
      },
    );
  }

  const firstChoice = choices[0];
  if (!isRecord(firstChoice)) {
    throw new InvalidModelResponseError(
      "response message is not an object",
      {
        code: "empty_response",
        feedback: "模型返回的消息格式不合法，请重新回答。",
      },
    );
  }

  const messageValue = firstChoice["message"];
  if (!isRecord(messageValue)) {
    throw new InvalidModelResponseError(
      "response message is not an object",
      {
        code: "empty_response",
        feedback: "模型返回的消息格式不合法，请重新回答。",
      },
    );
  }

  const contentValue = messageValue["content"];
  let content = "";
  if (Array.isArray(contentValue)) {
    content = contentValue
      .map((part) =>
        isRecord(part) ? String(part["text"] ?? "") : "",
      )
      .join("");
  } else if (typeof contentValue === "string") {
    content = contentValue;
  }

  const thoughtValue = messageValue["reasoning_content"];
  const thought =
    typeof thoughtValue === "string" ? thoughtValue : "";

  const rawToolCalls = messageValue["tool_calls"];
  let toolCalls: ToolCall[];
  try {
    toolCalls = parseNativeToolCalls(
      Array.isArray(rawToolCalls) ? rawToolCalls : [],
    );
  } catch (error) {
    if (
      error instanceof InvalidModelResponseError &&
      !error.rawText
    ) {
      error.rawText = JSON.stringify({
        message: messageValue,
      });
    }
    throw error;
  }

  if (!content.trim() && toolCalls.length === 0) {
    throw new InvalidModelResponseError(
      "assistant message is empty",
      {
        code: "empty_response",
        feedback: "你上一条回复为空，请重新回答。",
      },
    );
  }

  const usageValue = data["usage"];

  return modelTurn({
    content,
    thought,
    toolCalls,
    usage: isRecord(usageValue) ? usageValue : null,
    raw: data,
  });
}

function createSignal(
  timeoutSeconds: number,
  external?: AbortSignal,
): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutSeconds * 1000,
  );
  timer.unref();

  if (external) {
    if (external.aborted) {
      controller.abort();
    } else {
      external.addEventListener(
        "abort",
        () => controller.abort(),
        { once: true },
      );
    }
  }

  return controller.signal;
}

export async function httpPostJson(
  url: string,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
  timeout = DEFAULT_TIMEOUT,
  signal?: AbortSignal,
): Promise<unknown> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: createSignal(timeout, signal),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new ModelAdapterError(
        `HTTP ${response.status}: ${detail.slice(0, 500)}`,
      );
    }

    const text = await response.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ModelAdapterError(
        `invalid JSON response: ${text.slice(0, 200)}`,
      );
    }
  } catch (error) {
    if (error instanceof ModelAdapterError) {
      throw error;
    }
    throw new ModelAdapterError(
      `request failed: ${errorMessage(error)}`,
    );
  }
}

export async function* httpStreamLines(
  url: string,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
  timeout = DEFAULT_TIMEOUT,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: createSignal(timeout, signal),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new ModelAdapterError(
        `HTTP ${response.status}: ${detail.slice(0, 500)}`,
      );
    }
    if (!response.body) {
      throw new ModelAdapterError(
        "response has no streaming body",
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        for (;;) {
          const newline = buffer.indexOf("\n");
          if (newline === -1) {
            break;
          }
          const line = buffer
            .slice(0, newline)
            .replace(/\r$/, "");
          buffer = buffer.slice(newline + 1);
          yield line;
        }
      }
      buffer += decoder.decode();
      if (buffer.length > 0) {
        yield buffer.replace(/\r$/, "");
      }
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    if (error instanceof ModelAdapterError) {
      throw error;
    }
    throw new ModelAdapterError(
      `request failed: ${errorMessage(error)}`,
    );
  }
}
