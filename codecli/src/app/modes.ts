export type ToolKind =
  | "read"
  | "write"
  | "execute"
  | "meta";

export type SessionMode =
  | "manual"
  | "accept"
  | "plan"
  | "auto";

export type EffortLevel =
  | "low"
  | "medium"
  | "high"
  | "max";

export interface ModePolicy {
  readonly id: SessionMode;
  readonly allowedKinds: readonly ToolKind[];
  readonly prompt: string;
}

const ALL_KINDS: readonly ToolKind[] = [
  "read",
  "write",
  "execute",
  "meta",
];

export const MODE_ORDER: readonly SessionMode[] = [
  "manual",
  "accept",
  "plan",
  "auto",
];

export const MODE_POLICIES: Record<SessionMode, ModePolicy> = {
  manual: {
    id: "manual",
    allowedKinds: ALL_KINDS,
    prompt:
      "当前是 manual mode。读取类工具可直接使用；写文件和运行命令需要用户确认。" +
      "如果用户拒绝，不要绕过，先说明原因或调整方案。",
  },
  accept: {
    id: "accept",
    allowedKinds: ALL_KINDS,
    prompt:
      "当前是 accept edits mode。文件写入和编辑会自动执行；shell 命令仍需用户确认。" +
      "修改文件前先读取相关上下文。",
  },
  plan: {
    id: "plan",
    allowedKinds: ["read", "meta"],
    prompt:
      "当前是 plan mode。只能使用只读工具和 todo 清单；不要写文件或运行 shell 命令。" +
      "先调查代码并给出可执行的计划，等待用户批准。",
  },
  auto: {
    id: "auto",
    allowedKinds: ALL_KINDS,
    prompt:
      "当前是 auto mode。工具调用会自动执行；仍需遵守工作区路径围栏。" +
      "执行破坏性命令前先确认它确实是完成任务所必需的。",
  },
};

export const EFFORT_ORDER: readonly EffortLevel[] = [
  "low",
  "medium",
  "high",
  "max",
];

export const EFFORT_PROMPTS: Record<EffortLevel, string> = {
  low: "effort=low：优先快速回答，除非必要不要展开分析。",
  medium: "effort=medium：平衡速度与推理深度。",
  high: "effort=high：充分推理，并在关键结论上做必要验证。",
  max: "effort=max：尽可能充分推理，优先正确性，可以多步调查和验证。",
};

export function isSessionMode(
  value: string,
): value is SessionMode {
  return (MODE_ORDER as readonly string[]).includes(value);
}

export function isEffortLevel(
  value: string,
): value is EffortLevel {
  return (EFFORT_ORDER as readonly string[]).includes(value);
}

export function nextSessionMode(
  current: SessionMode,
): SessionMode {
  const index = MODE_ORDER.indexOf(current);
  return MODE_ORDER[(index + 1) % MODE_ORDER.length] ?? "manual";
}

export function requiresApproval(
  mode: SessionMode,
  kind: ToolKind,
): boolean {
  if (mode === "manual") {
    return kind === "write" || kind === "execute";
  }
  if (mode === "accept") {
    return kind === "execute";
  }
  return false;
}

export function composeSystemPrompt(
  base: string,
  mode: SessionMode,
  effort: EffortLevel,
): string {
  return [
    base.trim(),
    MODE_POLICIES[mode].prompt,
    EFFORT_PROMPTS[effort],
  ]
    .filter(Boolean)
    .join("\n\n");
}
