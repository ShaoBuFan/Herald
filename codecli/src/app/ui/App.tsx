import { useRef, useState } from "react";
import {
  Box,
  Static,
  Text,
  useApp,
  useInput,
} from "ink";

import {
  Agent,
  type AgentConfig,
  type AgentEvent,
  type AgentResult,
  type MessageStore,
  type ModelAdapter,
  type ToolExecutor,
} from "../../core/index.js";
import {
  PromptContext,
  type PromptRegistry,
} from "../prompt/registry.js";
import type { SessionStore } from "../session/store.js";
import { formatToolCallArguments } from "./format.js";
import { InputBox } from "./InputBox.js";
import {
  INPUT_HINTS,
  parseCommand,
  sanitizeInput,
  type ParsedCommand,
} from "./input.js";
import { Spinner } from "./Spinner.js";
import {
  TranscriptItemView,
  type NewTranscriptItem,
  type TranscriptItem,
} from "./Transcript.js";

const SPINNER_WORDS = [
  "Thinking",
  "Pondering",
  "Working",
  "Checking",
];

function helpText(host: AppHost): string {
  const lines = [
    "/help            命令说明",
    "/prompt          查看 system prompt",
    "/clear           清空对话历史（保留终端 scrollback）",
    "/save [title]    保存对话",
    "/reload [n]      列出 / 恢复会话",
    "/model [n]       查看 / 切换模型",
  ];
  if (host.getUsage) {
    lines.push("/usage           查看用量（Mattermost）");
  }
  if (host.getUser) {
    lines.push("/user            查看用户（Mattermost）");
  }
  lines.push("/exit            退出");
  return lines.join("\n");
}

export interface AppHost {
  appName: string;
  provider: string;
  cwd: string;
  modelName(): string;
  promptRegistry: PromptRegistry;
  sessionStore?: SessionStore;
  listModels?(): Array<{ label: string }>;
  selectModel?(index: number): string;
  getUsage?(): Promise<unknown>;
  getUser?(): Promise<unknown>;
  onResult?(result: AgentResult): Promise<void> | void;
}

export interface AppProps {
  model: ModelAdapter;
  tools: ToolExecutor;
  store: MessageStore;
  config: AgentConfig;
  host: AppHost;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function App({
  model,
  tools,
  store,
  config,
  host,
}: AppProps) {
  const { exit } = useApp();
  const [items, setItems] = useState<TranscriptItem[]>(() => [
    {
      id: 0,
      kind: "welcome",
      data: {
        appName: host.appName,
        provider: host.provider,
        model: host.modelName(),
        cwd: host.cwd,
        runtime: `node ${process.version}`,
        toolCount: tools.listTools().length,
      },
    },
  ]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [spinnerLabel, setSpinnerLabel] =
    useState("Thinking");

  const nextId = useRef(1);
  const lastWasEnter = useRef(false);
  const busyRef = useRef(false);
  const startedAt = useRef(Date.now());

  const add = (item: NewTranscriptItem): void => {
    const next = {
      ...item,
      id: nextId.current,
    } as TranscriptItem;
    nextId.current += 1;
    setItems((previous) => [...previous, next]);
  };

  const handleEvent = (event: AgentEvent): void => {
    switch (event.type) {
      case "model_request": {
        const index =
          (event.data.round - 1) % SPINNER_WORDS.length;
        setSpinnerLabel(
          SPINNER_WORDS[index] ?? "Thinking",
        );
        break;
      }
      case "parse_recovered":
        add({
          kind: "system",
          text: "↻ 已容错解析（非 canonical 格式）",
        });
        break;
      case "thought":
        add({ kind: "thought", text: event.data.content });
        break;
      case "tool_call":
        add({
          kind: "tool",
          name: event.data.tool,
          detail: formatToolCallArguments(
            event.data.tool,
            event.data.arguments,
          ),
        });
        break;
      case "tool_result":
        add({
          kind: "result",
          name: event.data.tool,
          data: event.data.data,
          error: event.data.error,
        });
        break;
      case "retry":
        add({
          kind: "system",
          text:
            `↻ 回复格式错误（${event.data.code}），` +
            `重试 ${event.data.attempt}（剩余 ${event.data.remaining}）`,
          tone: "warning",
        });
        break;
      case "final":
        add({
          kind: "assistant",
          text: event.data.content,
        });
        break;
      case "run_finished": {
        const rounds = event.data.result.rounds;
        const elapsed =
          (Date.now() - startedAt.current) / 1000;
        add({
          kind: "summary",
          text:
            `✻ ${rounds} ${
              rounds === 1 ? "round" : "rounds"
            } · ${elapsed.toFixed(1)}s`,
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
    setValue("");
    busyRef.current = true;
    setBusy(true);
    startedAt.current = Date.now();

    try {
      const agent = new Agent(
        model,
        tools,
        store,
        config,
        handleEvent,
      );
      const result = await agent.run(prompt);
      await host.onResult?.(result);
    } catch (error) {
      add({
        kind: "system",
        text: `✗ ${errorText(error)}`,
        tone: "error",
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleCommand = async (
    command: ParsedCommand,
  ): Promise<void> => {
    const { name, argument } = command;

    try {
      switch (name) {
        case "help":
          add({ kind: "system", text: helpText(host) });
          break;

        case "prompt": {
          const context = new PromptContext({
            system: config.systemPrompt,
            tools: tools.listTools(),
          });
          let shown = 0;
          for (const section of host.promptRegistry.sections()) {
            if (!section.enabled(context)) {
              continue;
            }
            const text = section.render(context).trim();
            if (!text) {
              continue;
            }
            add({
              kind: "system",
              text:
                `── ${section.name} ` +
                `(order=${section.order}) ──\n${text}`,
            });
            shown += 1;
          }
          add({
            kind: "summary",
            text:
              `${shown} sections · ` +
              `${host.promptRegistry.render(context).length} chars`,
          });
          break;
        }

        case "clear":
          if (store.clear) {
            store.clear();
          } else {
            store.replaceMessages([]);
          }
          add({
            kind: "system",
            text: "对话历史已清空（终端 scrollback 保留）",
          });
          break;

        case "save":
          if (!host.sessionStore) {
            throw new Error("该入口不支持会话保存");
          }
          add({
            kind: "system",
            text: `会话已保存到: ${await host.sessionStore.save(
              argument || undefined,
            )}`,
          });
          break;

        case "reload": {
          if (!host.sessionStore) {
            throw new Error("该入口不支持会话恢复");
          }
          const sessions = await host.sessionStore.sessions();
          if (!argument) {
            add({
              kind: "system",
              text:
                sessions.length === 0
                  ? "未发现任何会话存档"
                  : [
                      "已保存会话：",
                      ...sessions.map(
                        (session, index) =>
                          `${index + 1}. ${session.title}`,
                      ),
                      "输入 /reload <序号> 恢复",
                    ].join("\n"),
            });
            break;
          }
          const index = Number.parseInt(argument, 10);
          const session = sessions[index - 1];
          if (!Number.isInteger(index) || !session) {
            throw new Error("会话序号无效");
          }
          const loaded = await host.sessionStore.load(
            session.path,
          );
          add({
            kind: loaded ? "system" : "system",
            text: loaded
              ? `会话已恢复: ${session.title}`
              : "会话恢复失败",
            tone: loaded ? "info" : "error",
          });
          break;
        }

        case "model": {
          if (!host.listModels || !host.selectModel) {
            add({
              kind: "system",
              text: `当前模型: ${host.modelName()}`,
            });
            break;
          }
          const models = host.listModels();
          if (!argument) {
            add({
              kind: "system",
              text: [
                "可用模型：",
                ...models.map(
                  (modelInfo, index) =>
                    `${index + 1}. ${modelInfo.label}`,
                ),
                "输入 /model <序号> 切换",
              ].join("\n"),
            });
            break;
          }
          const index = Number.parseInt(argument, 10);
          if (
            !Number.isInteger(index) ||
            index < 1 ||
            index > models.length
          ) {
            throw new Error("模型序号无效");
          }
          add({
            kind: "system",
            text: `已切换到模型: ${host.selectModel(
              index - 1,
            )}`,
          });
          break;
        }

        case "usage":
          if (!host.getUsage) {
            throw new Error("该入口不支持 /usage");
          }
          add({
            kind: "system",
            text: JSON.stringify(
              await host.getUsage(),
              null,
              2,
            ),
          });
          break;

        case "user":
          if (!host.getUser) {
            throw new Error("该入口不支持 /user");
          }
          add({
            kind: "system",
            text: JSON.stringify(
              await host.getUser(),
              null,
              2,
            ),
          });
          break;

        case "exit":
          exit();
          break;

        default:
          add({
            kind: "system",
            text: `未知命令: /${name}；/help 查看命令`,
            tone: "error",
          });
          break;
      }
    } catch (error) {
      add({
        kind: "system",
        text: `✗ ${errorText(error)}`,
        tone: "error",
      });
    }
  };

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    if (busy) {
      return;
    }

    if (key.return && (key.shift || key.meta)) {
      lastWasEnter.current = false;
      setValue((previous) => previous + "\n");
      return;
    }
    if (input === "\n" || input === "\u000b") {
      lastWasEnter.current = false;
      setValue((previous) => previous + "\n");
      return;
    }

    if (key.return) {
      const prompt = value.trim();
      if (!prompt) {
        lastWasEnter.current = false;
        return;
      }

      if (
        prompt.startsWith("/") &&
        !prompt.includes("\n")
      ) {
        lastWasEnter.current = false;
        setValue("");
        const parsed = parseCommand(prompt);
        if (parsed) {
          void handleCommand(parsed);
        } else {
          add({
            kind: "system",
            text: `未知命令: ${prompt}；/help 查看命令`,
            tone: "error",
          });
        }
        return;
      }

      if (lastWasEnter.current) {
        lastWasEnter.current = false;
        void submit(prompt);
        return;
      }

      lastWasEnter.current = true;
      setValue((previous) => previous + "\n");
      return;
    }

    lastWasEnter.current = false;

    if (key.backspace || key.delete) {
      setValue((previous) => previous.slice(0, -1));
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      const text = sanitizeInput(input);
      if (text) {
        setValue((previous) => previous + text);
      }
    }
  });

  return (
    <Box flexDirection="column" width="100%">
      <Static items={items}>
        {(item) => (
          <TranscriptItemView key={item.id} item={item} />
        )}
      </Static>

      <Box
        flexDirection="column"
        marginTop={1}
        width="100%"
      >
        {busy ? <Spinner label={spinnerLabel} /> : null}
        <InputBox value={value} busy={busy} />
        {INPUT_HINTS.map((hint, index) => (
          <Text key={index} dimColor>
            {hint}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
