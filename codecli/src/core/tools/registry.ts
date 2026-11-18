import { deepClone } from "../clone.js";
import { ToolExecutionError } from "../errors.js";
import type {
  JsonObject,
  ToolSchema,
} from "../models.js";
import type {
  ToolContext,
  ToolExecutor,
} from "../protocols.js";

export type ToolHandler = (
  arguments_: Record<string, unknown>,
  context?: ToolContext,
) => Promise<unknown> | unknown;

export class Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonObject;
  readonly handler: ToolHandler;
  readonly kind: string;

  constructor(
    name: string,
    description: string,
    parameters: JsonObject,
    handler: ToolHandler,
    kind = "unknown",
  ) {
    if (!name.trim()) {
      throw new Error("tool name must not be empty");
    }
    if (typeof handler !== "function") {
      throw new TypeError("tool handler must be callable");
    }
    this.name = name;
    this.description = description;
    this.parameters = parameters;
    this.handler = handler;
    this.kind = kind;
  }

  schema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: deepClone(this.parameters),
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ToolRegistry implements ToolExecutor {
  private readonly tools = new Map<string, Tool>();

  constructor(tools: Tool[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): Tool {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ToolExecutionError(`unknown tool: ${name}`);
    }
    return tool;
  }

  kindOf(name: string): string {
    return this.get(name).kind;
  }

  listTools(): ToolSchema[] {
    return [...this.tools.values()].map((tool) => tool.schema());
  }

  async execute(
    name: string,
    arguments_: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<unknown> {
    if (
      typeof arguments_ !== "object" ||
      arguments_ === null ||
      Array.isArray(arguments_)
    ) {
      throw new ToolExecutionError("tool arguments must be an object");
    }

    const tool = this.get(name);
    try {
      return await tool.handler(arguments_, context);
    } catch (error) {
      if (error instanceof ToolExecutionError) {
        throw error;
      }
      throw new ToolExecutionError(
        `tool execution failed for ${name}: ${errorMessage(error)}`,
      );
    }
  }
}
