import type {
  AgentResult,
  Message,
  ModelTurn,
  ToolSchema,
} from "./models.js";

export type AgentEvent =
  | { type: "run_started"; data: { content: string } }
  | {
      type: "model_request";
      data: {
        round: number;
        system: string;
        tools: ToolSchema[];
        messages: Message[];
      };
    }
  | { type: "model_response"; data: { round: number; turn: ModelTurn } }
  | { type: "parse_recovered"; data: { round: number; turn: ModelTurn } }
  | { type: "thought"; data: { round: number; content: string } }
  | {
      type: "tool_call";
      data: {
        round: number;
        id: string;
        tool: string;
        arguments: Record<string, unknown>;
      };
    }
  | {
      type: "tool_result";
      data: {
        round: number;
        id: string;
        tool: string;
        data: unknown;
        error: string | null;
      };
    }
  | {
      type: "retry";
      data: {
        round: number;
        attempt: number;
        remaining: number;
        code: string;
      };
    }
  | {
      type: "error";
      data: {
        round?: number;
        error: Error;
        code?: string;
        response?: string;
      };
    }
  | {
      type: "final";
      data: { round: number; content: string; result: AgentResult };
    }
  | { type: "run_finished"; data: { result: AgentResult } };

export type EventHandler = (
  event: AgentEvent,
) => void | Promise<void>;
