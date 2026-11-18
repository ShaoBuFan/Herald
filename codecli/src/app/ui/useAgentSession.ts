import {
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useApp } from "ink";

import {
  Agent,
  AgentConfig,
  type AgentEvent,
  type MessageStore,
  type ModelAdapter,
} from "../../core/index.js";
import type { ToolRegistry } from "../../core/tools/registry.js";
import {
  composeSystemPrompt,
  MODE_ORDER,
  type EffortLevel,
  type SessionMode,
} from "../modes.js";
import {
  approxTokens,
  LiveProgress,
  usageTokens,
  type ProgressSnapshot,
} from "../progress.js";
import {
  createModeExecutor,
  type ApprovalRequest,
} from "../tools/policy.js";
import {
  todosFromToolResult,
  type TodoItem,
} from "../tools/todo.js";
import { CODECLI_VERSION } from "../version.js";
import {
  activityText,
  countStats,
  emptyStats,
  type RunStats,
} from "./activity.js";
import type { AppHost } from "./app-host.js";
import {
  runCommand as executeCommand,
} from "./commands.js";
import { formatDuration } from "./format.js";
import type { ParsedCommand } from "./input.js";
import type {
  NewTranscriptItem,
  TranscriptItem,
} from "./Transcript.js";

const SPINNER_WORDS = [
  "Ionizing",
  "Pondering",
  "Cogitating",
  "Finagling",
  "Working",
  "Checking",
] as const;

const DONE_WORDS = [
  "Cogitated",
  "Baked",
  "Brewed",
  "Churned",
  "Cooked",
  "Crunched",
  "Sautéed",
  "Worked",
] as const;

const EMPTY_PROGRESS: ProgressSnapshot = {
  content: "",
  reasoningChars: 0,
  outputChars: 0,
  usage: null,
};

function noopSubscribe(): () => void {
  return () => {};
}

function emptyProgress(): ProgressSnapshot {
  return EMPTY_PROGRESS;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function two(value: number): string {
  return String(value).padStart(2, "0");
}

function clockTime(date: Date): string {
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

export interface PendingTool {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  startedAt: number;
}

export interface AgentSessionOptions {
  model: ModelAdapter;
  tools: ToolRegistry;
  store: MessageStore;
  config: AgentConfig;
  host: AppHost;
  progress?: LiveProgress;
}

export interface AgentSession {
  exit(): void;
  items: TranscriptItem[];
  busy: boolean;
  mode: SessionMode;
  effort: EffortLevel;
  todos: TodoItem[];
  approval: ApprovalRequest | null;
  pendingTools: PendingTool[];
  spinnerLabel: string;
  turnStartedAt: number;
  tokenCount: number | null;
  liveContent: string;
  add(item: NewTranscriptItem): void;
  submit(text: string): Promise<void>;
  resolveApproval(allowed: boolean): void;
  abort(): void;
  runCommand(command: ParsedCommand): void;
  setMode(mode: SessionMode): void;
  setEffort(effort: EffortLevel): void;
  clearTodos(): void;
  resetProgress(): void;
}

export function useAgentSession({
  model,
  tools,
  store,
  config,
  host,
  progress,
}: AgentSessionOptions): AgentSession {
  const { exit } = useApp();
  const [items, setItems] = useState<TranscriptItem[]>(() => [
    {
      id: 0,
      kind: "header",
      data: {
        appName: host.appName,
        version: CODECLI_VERSION,
        provider: host.provider,
        model: host.modelName(),
        cwd: host.cwd,
        toolCount: tools.listTools().length,
        modeCount: MODE_ORDER.length,
      },
    },
  ]);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<SessionMode>("manual");
  const [effort, setEffort] = useState<EffortLevel>("max");
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [spinnerLabel, setSpinnerLabel] =
    useState("Thinking");
  const [turnStartedAt, setTurnStartedAt] = useState(
    () => Date.now(),
  );
  const [approval, setApproval] =
    useState<ApprovalRequest | null>(null);
  const [pending, setPending] = useState<
    Record<string, PendingTool>
  >({});

  const snapshot = useSyncExternalStore(
    progress?.subscribe ?? noopSubscribe,
    progress?.getSnapshot ?? emptyProgress,
    progress?.getSnapshot ?? emptyProgress,
  );

  const nextId = useRef(1);
  const busyRef = useRef(false);
  const runStartedAt = useRef(Date.now());
  const statsRef = useRef<RunStats>(emptyStats());
  const pendingRef = useRef<Map<string, PendingTool>>(
    new Map(),
  );
  const abortRef = useRef<AbortController | null>(null);
  const approvalResolver = useRef<
    ((allowed: boolean) => void) | null
  >(null);
  const roundsRef = useRef(1);

  const add = (item: NewTranscriptItem): void => {
    const next = {
      ...item,
      id: nextId.current,
    } as TranscriptItem;
    nextId.current += 1;
    setItems((previous) => [...previous, next]);
  };

  const syncPending = (): void => {
    setPending(
      Object.fromEntries(pendingRef.current.entries()),
    );
  };

  const requestApproval = (
    request: ApprovalRequest,
  ): Promise<boolean> =>
    new Promise((resolve) => {
      approvalResolver.current = resolve;
      setApproval(request);
    });

  const resolveApproval = (allowed: boolean): void => {
    const resolver = approvalResolver.current;
    approvalResolver.current = null;
    setApproval(null);
    resolver?.(allowed);
  };

  const abort = (): void => {
    abortRef.current?.abort();
  };

  const clearTodos = (): void => {
    setTodos([]);
  };

  const resetProgress = (): void => {
    progress?.reset();
    roundsRef.current = 0;
    statsRef.current = emptyStats();
  };

  const handleEvent = (event: AgentEvent): void => {
    switch (event.type) {
      case "run_started":
        runStartedAt.current = Date.now();
        break;

      case "model_request": {
        roundsRef.current = event.data.round;
        const index =
          (event.data.round - 1) % SPINNER_WORDS.length;
        setSpinnerLabel(
          SPINNER_WORDS[index] ?? "Thinking",
        );
        setTurnStartedAt(Date.now());
        progress?.reset();
        break;
      }

      case "model_response":
        progress?.setUsage(event.data.turn.usage);
        break;

      case "parse_recovered":
        add({
          kind: "system",
          text: "↻ 已容错解析（非 canonical 格式）",
        });
        break;

      case "thought":
        break;

      case "tool_call": {
        pendingRef.current.set(event.data.id, {
          id: event.data.id,
          name: event.data.tool,
          arguments: event.data.arguments,
          startedAt: Date.now(),
        });
        syncPending();
        break;
      }

      case "tool_result": {
        const started = pendingRef.current.get(
          event.data.id,
        );
        pendingRef.current.delete(event.data.id);
        syncPending();

        countStats(
          statsRef.current,
          event.data.tool,
          event.data.error,
        );

        if (
          event.data.tool === "todo_write" &&
          !event.data.error
        ) {
          const nextTodos = todosFromToolResult(
            event.data.data,
          );
          if (nextTodos) {
            setTodos(nextTodos);
          }
        }

        add({
          kind: "tool",
          name: event.data.tool,
          arguments: started?.arguments ?? {},
          data: event.data.data,
          error: event.data.error,
          durationMs: started
            ? Date.now() - started.startedAt
            : 0,
        });
        break;
      }

      case "retry":
        add({
          kind: "system",
          text:
            `↻ 回复格式错误（${event.data.code}），` +
            `重试 ${event.data.attempt}（剩余 ${event.data.remaining}）`,
          tone: "warning",
        });
        break;

      case "final": {
        const elapsed =
          Date.now() - runStartedAt.current;
        progress?.finish();
        add({
          kind: "summary",
          text: activityText(statsRef.current, elapsed),
        });
        add({
          kind: "assistant",
          text: event.data.content,
        });
        break;
      }

      case "run_finished": {
        const elapsed =
          Date.now() - runStartedAt.current;
        const rounds = event.data.result.rounds;
        const word =
          DONE_WORDS[(rounds - 1) % DONE_WORDS.length] ??
          "Worked";
        add({
          kind: "summary",
          text:
            `✻ ${word} for ${formatDuration(elapsed)}` +
            ` · done ${clockTime(new Date())}`,
        });
        break;
      }

      default:
        break;
    }
  };

  const submit = async (text: string): Promise<void> => {
    const prompt = text.trim();
    if (!prompt || busyRef.current) {
      return;
    }

    add({ kind: "user", text: prompt });
    busyRef.current = true;
    setBusy(true);
    runStartedAt.current = Date.now();
    setTurnStartedAt(Date.now());
    statsRef.current = emptyStats();
    pendingRef.current.clear();
    setPending({});
    progress?.reset();

    const controller = new AbortController();
    abortRef.current = controller;
    const effectiveConfig = new AgentConfig({
      systemPrompt: composeSystemPrompt(
        config.systemPrompt,
        mode,
        effort,
      ),
      maxRounds: config.maxRounds,
      retryInvalidResponse: config.retryInvalidResponse,
      maxInvalidResponseRetries:
        config.maxInvalidResponseRetries,
    });
    const executor = createModeExecutor(
      tools,
      mode,
      requestApproval,
    );

    try {
      const agent = new Agent(
        model,
        executor,
        store,
        effectiveConfig,
        handleEvent,
      );
      const result = await agent.run(prompt, {
        signal: controller.signal,
      });
      await host.onResult?.(result);
    } catch (error) {
      if (controller.signal.aborted) {
        add({
          kind: "system",
          text: "Interrupted by user",
        });
      } else {
        add({
          kind: "system",
          text: `✗ ${errorText(error)}`,
          tone: "error",
        });
      }
    } finally {
      if (approvalResolver.current) {
        const resolver = approvalResolver.current;
        approvalResolver.current = null;
        setApproval(null);
        resolver(false);
      }
      pendingRef.current.clear();
      setPending({});
      abortRef.current = null;
      busyRef.current = false;
      setBusy(false);
      progress?.finish();
    }
  };

  const tokenCount = (() => {
    if (!progress) {
      return null;
    }
    return (
      usageTokens(snapshot) ??
      (approxTokens(snapshot) || null)
    );
  })();

  const runCommand = (parsed: ParsedCommand): void => {
    void executeCommand(parsed, {
      host,
      tools,
      store,
      config,
      mode,
      effort,
      rounds: roundsRef.current,
      tokens: tokenCount,
      add,
      setMode,
      setEffort,
      clearTodos,
      resetProgress,
      exit,
    });
  };

  return {
    exit,
    items,
    busy,
    mode,
    effort,
    todos,
    approval,
    pendingTools: Object.values(pending),
    spinnerLabel,
    turnStartedAt,
    tokenCount,
    liveContent: busy ? snapshot.content : "",
    add,
    submit,
    resolveApproval,
    abort,
    runCommand,
    setMode,
    setEffort,
    clearTodos,
    resetProgress,
  };
}
