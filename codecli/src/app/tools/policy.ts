import { ToolExecutionError } from "../../core/errors.js";
import type {
  ToolContext,
  ToolExecutor,
} from "../../core/protocols.js";
import type { ToolSchema } from "../../core/models.js";
import { ToolRegistry } from "../../core/tools/registry.js";
import {
  MODE_POLICIES,
  requiresApproval,
  type SessionMode,
  type ToolKind,
} from "../modes.js";

export interface ApprovalRequest {
  tool: string;
  arguments: Record<string, unknown>;
  kind: ToolKind;
  mode: SessionMode;
}

export type ApprovalHandler = (
  request: ApprovalRequest,
) => Promise<boolean> | boolean;

export interface ModeTool {
  schema: ToolSchema;
  kind: ToolKind;
  allowed: boolean;
}

/**
 * 模式策略的唯一查询入口。UI 的 /tools、/prompt 和实际执行都走这里，
 * 避免 allowedKinds 在多个地方各算一遍。
 */
export function describeModeTools(
  registry: ToolRegistry,
  mode: SessionMode,
): ModeTool[] {
  const allowed = new Set(MODE_POLICIES[mode].allowedKinds);
  return registry.listTools().map((schema) => {
    const kind = registry.kindOf(schema.name) as ToolKind;
    return {
      schema,
      kind,
      allowed: allowed.has(kind),
    };
  });
}

/**
 * 按模式过滤模型可见工具。未允许的工具不会出现在本轮 tool schema 中；
 * 如果模型仍凭历史消息调用，Agent 的快照检查也会拒绝。
 */
export function buildModeTools(
  registry: ToolRegistry,
  mode: SessionMode,
): ToolRegistry {
  const tools = describeModeTools(registry, mode)
    .filter((item) => item.allowed)
    .map((item) => registry.get(item.schema.name));
  return new ToolRegistry(tools);
}

export class ApprovalToolExecutor implements ToolExecutor {
  readonly inner: ToolRegistry;
  readonly mode: SessionMode;
  readonly approve?: ApprovalHandler;

  constructor(
    inner: ToolRegistry,
    mode: SessionMode,
    approve?: ApprovalHandler,
  ) {
    this.inner = inner;
    this.mode = mode;
    this.approve = approve;
  }

  listTools() {
    return this.inner.listTools();
  }

  async execute(
    name: string,
    arguments_: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<unknown> {
    const tool = this.inner.get(name);
    const kind = tool.kind as ToolKind;
    if (requiresApproval(this.mode, kind)) {
      if (!this.approve) {
        throw new ToolExecutionError(
          `permission required for ${name}`,
        );
      }
      const allowed = await this.approve({
        tool: name,
        arguments: arguments_,
        kind,
        mode: this.mode,
      });
      if (!allowed) {
        throw new ToolExecutionError(
          `permission denied by user: ${name}`,
        );
      }
    }
    return this.inner.execute(name, arguments_, context);
  }
}

export function createModeExecutor(
  registry: ToolRegistry,
  mode: SessionMode,
  approve?: ApprovalHandler,
): ToolExecutor {
  return new ApprovalToolExecutor(
    buildModeTools(registry, mode),
    mode,
    approve,
  );
}
