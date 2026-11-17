export class AgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ModelAdapterError extends AgentError {}

export class ToolExecutionError extends AgentError {}

export interface InvalidModelResponseOptions {
  code?: string;
  feedback?: string | null;
  rawText?: string;
}

export class InvalidModelResponseError extends AgentError {
  code: string;
  feedback: string | null;
  rawText: string;

  constructor(
    message: string,
    options: InvalidModelResponseOptions = {},
  ) {
    super(message);
    this.code = options.code ?? "invalid_response";
    this.feedback = options.feedback ?? null;
    this.rawText = options.rawText ?? "";
  }
}

export class MaxRoundsExceeded extends AgentError {}
