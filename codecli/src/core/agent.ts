import { deepClone } from "./clone.js";
import {
  AgentError,
  InvalidModelResponseError,
  MaxRoundsExceeded,
  ToolExecutionError,
} from "./errors.js";
import type { AgentEvent, EventHandler } from "./events.js";
import {
  AgentConfig,
  type AgentResult,
  type ModelTurn,
  type ToolResult,
} from "./models.js";
import type {
  MessageStore,
  ModelAdapter,
  ToolExecutor,
} from "./protocols.js";
import { buildRequest } from "./request.js";

export interface RunOptions {
  signal?: AbortSignal;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class Agent {
  readonly model: ModelAdapter;
  readonly tools: ToolExecutor;
  readonly store: MessageStore;
  readonly config: AgentConfig;
  readonly eventHandler?: EventHandler;

  constructor(
    model: ModelAdapter,
    tools: ToolExecutor,
    store: MessageStore,
    config: AgentConfig = new AgentConfig(),
    eventHandler?: EventHandler,
  ) {
    this.model = model;
    this.tools = tools;
    this.store = store;
    this.config = config;
    this.eventHandler = eventHandler;
  }

  async run(
    userText: string,
    options: RunOptions = {},
  ): Promise<AgentResult> {
    let finalResult: AgentResult | undefined;

    for await (const event of this.runStream(userText, options)) {
      if (event.type === "final") {
        finalResult = event.data.result;
      }
    }

    if (!finalResult) {
      throw new Error("agent run ended without a final result");
    }
    return finalResult;
  }

  async *runStream(
    userText: string,
    options: RunOptions = {},
  ): AsyncGenerator<AgentEvent> {
    if (typeof userText !== "string" || !userText.trim()) {
      throw new Error("user_text must be a non-empty string");
    }

    this.store.append({ role: "user", content: userText });
    yield* this.emit({ type: "run_started", data: { content: userText } });

    const toolSchemas = this.tools.listTools();
    const knownToolNames = new Set(
      toolSchemas.map((schema) => schema.name),
    );

    let invalidRetries = 0;

    for (
      let roundIndex = 1;
      roundIndex <= this.config.maxRounds;
      roundIndex += 1
    ) {
      if (options.signal?.aborted) {
        throw new AgentError("agent run aborted");
      }

      const request = buildRequest(this.store.getMessages(), {
        system: this.config.systemPrompt,
        tools: toolSchemas,
      });

      yield* this.emit({
        type: "model_request",
        data: {
          round: roundIndex,
          system: request.system,
          tools: deepClone(request.tools),
          messages: deepClone(request.messages),
        },
      });

      let turn: ModelTurn;
      try {
        turn = await this.model.complete(request, options.signal);
      } catch (error) {
        if (error instanceof InvalidModelResponseError) {
          invalidRetries += 1;
          yield* this.emit({
            type: "error",
            data: {
              round: roundIndex,
              error,
              code: error.code,
              response: error.rawText,
            },
          });

          if (
            !this.config.retryInvalidResponse ||
            invalidRetries >
              this.config.maxInvalidResponseRetries
          ) {
            throw error;
          }

          this.appendRetryFeedback(error);
          yield* this.emit({
            type: "retry",
            data: {
              round: roundIndex,
              attempt: invalidRetries,
              remaining:
                this.config.maxInvalidResponseRetries -
                invalidRetries,
              code: error.code,
            },
          });
          continue;
        }
        throw error;
      }

      invalidRetries = 0;

      yield* this.emit({
        type: "model_response",
        data: { round: roundIndex, turn },
      });
      if (turn.recovered) {
        yield* this.emit({
          type: "parse_recovered",
          data: { round: roundIndex, turn },
        });
      }
      if (turn.thought) {
        yield* this.emit({
          type: "thought",
          data: { round: roundIndex, content: turn.thought },
        });
      }

      this.appendAssistant(turn);

      if (turn.toolCalls.length > 0) {
        const results: ToolResult[] = [];

        for (const call of turn.toolCalls) {
          yield* this.emit({
            type: "tool_call",
            data: {
              round: roundIndex,
              id: call.id,
              tool: call.name,
              arguments: call.arguments,
            },
          });

          let result: ToolResult;
          try {
            if (!knownToolNames.has(call.name)) {
              throw new ToolExecutionError(
                `unknown tool: ${call.name}`,
              );
            }
            const data = await this.tools.execute(
              call.name,
              call.arguments,
            );
            result = {
              id: call.id,
              name: call.name,
              data,
              error: null,
            };
          } catch (error) {
            result = {
              id: call.id,
              name: call.name,
              data: null,
              error: errorMessage(error),
            };
          }

          results.push(result);
          yield* this.emit({
            type: "tool_result",
            data: {
              round: roundIndex,
              id: result.id,
              tool: result.name,
              data: result.data,
              error: result.error,
            },
          });
        }

        for (const result of results) {
          this.store.append({
            role: "tool",
            tool_call_id: result.id,
            name: result.name,
            data: result.data,
            error: result.error,
          });
        }
        continue;
      }

      const result: AgentResult = {
        final: turn.content,
        thought: turn.thought,
        rounds: roundIndex,
        metadata: turn.usage ? { usage: turn.usage } : {},
      };

      yield* this.emit({
        type: "final",
        data: {
          round: roundIndex,
          content: result.final,
          result,
        },
      });
      yield* this.emit({
        type: "run_finished",
        data: { result },
      });
      return;
    }

    const error = new MaxRoundsExceeded(
      `agent exceeded maximum rounds: ${this.config.maxRounds}`,
    );
    yield* this.emit({ type: "error", data: { error } });
    throw error;
  }

  private async *emit(
    event: AgentEvent,
  ): AsyncGenerator<AgentEvent> {
    if (this.eventHandler) {
      await this.eventHandler(event);
    }
    yield event;
  }

  private appendAssistant(turn: ModelTurn): void {
    this.store.append({
      role: "assistant",
      content: turn.content,
      thought: turn.thought,
      tool_calls: turn.toolCalls.map((call) => ({
        id: call.id,
        name: call.name,
        arguments: call.arguments,
      })),
    });
  }

  private appendRetryFeedback(
    error: InvalidModelResponseError,
  ): void {
    const rawText = error.rawText;
    if (rawText.trim()) {
      this.store.append({
        role: "assistant",
        content: rawText,
        thought: "",
        tool_calls: [],
        raw: true,
      });
    }

    const feedback =
      error.feedback ??
      `你上一条回复无法使用（${error.code}）：${error.message}。请重新回答。`;
    this.store.append({ role: "user", content: feedback });
  }
}
