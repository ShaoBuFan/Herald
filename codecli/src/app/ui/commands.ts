import type {
  AgentConfig,
  MessageStore,
} from "../../core/index.js";
import { ToolRegistry } from "../../core/tools/registry.js";
import {
  composeSystemPrompt,
  EFFORT_ORDER,
  isEffortLevel,
  isSessionMode,
  MODE_ORDER,
  type EffortLevel,
  type SessionMode,
} from "../modes.js";
import {
  PromptContext,
} from "../prompt/registry.js";
import {
  describeModeTools,
} from "../tools/policy.js";
import type { AppHost } from "./app-host.js";
import { displayToolName } from "./format.js";
import type { ParsedCommand } from "./input.js";
import { MODE_PRESENTATIONS } from "./mode-presentation.js";
import type { NewTranscriptItem } from "./Transcript.js";

export const SHORTCUT_HELP = [
  "Enter 换行 · 双击 Enter 发送",
  "Shift+Enter / Alt+Enter / Ctrl+J 换行",
  "Shift+Tab / Alt+M 切换模式",
  "Esc 运行中中断 · 空闲时清空草稿",
  "Ctrl+C 运行中中断 · 空闲时退出",
  "? 打开快捷键说明",
].join("\n");

export interface CommandContext {
  host: AppHost;
  tools: ToolRegistry;
  store: MessageStore;
  config: AgentConfig;
  mode: SessionMode;
  effort: EffortLevel;
  rounds: number;
  tokens: number | null;
  add(item: NewTranscriptItem): void;
  setMode(mode: SessionMode): void;
  setEffort(effort: EffortLevel): void;
  clearTodos(): void;
  resetProgress(): void;
  exit(): void;
}

function helpText(host: AppHost): string {
  const lines = [
    "命令说明",
    "/help            命令说明与快捷键",
    "/prompt          查看组合后的 system prompt",
    "/clear           清空对话历史与 todo 面板",
    "/save [title]    保存对话",
    "/reload [n]      列出 / 恢复会话",
    "/model [n]       查看 / 切换模型",
    "/mode [mode]     manual / accept / plan / auto",
    "/effort [level]  low / medium / high / max",
    "/tools           查看工具与当前模式可用性",
    "/status          查看模型、模式、effort 与 token",
  ];
  if (host.getUsage) {
    lines.push("/usage           查看用量（Mattermost）");
  }
  if (host.getUser) {
    lines.push("/user            查看用户（Mattermost）");
  }
  lines.push("/exit            退出");
  lines.push("", "快捷键", SHORTCUT_HELP);
  return lines.join("\n");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runCommand(
  command: ParsedCommand,
  context: CommandContext,
): Promise<void> {
  const { name, argument } = command;
  const { host, tools, store, config } = context;

  try {
    switch (name) {
      case "help":
        context.add({
          kind: "system",
          text: helpText(host),
        });
        break;

      case "prompt": {
        const effective = composeSystemPrompt(
          config.systemPrompt,
          context.mode,
          context.effort,
        );
        const enabledTools = describeModeTools(
          tools,
          context.mode,
        )
          .filter((item) => item.allowed)
          .map((item) => item.schema);
        const promptContext = new PromptContext({
          system: effective,
          tools: enabledTools,
        });
        let shown = 0;
        for (const section of host.promptRegistry.sections()) {
          if (!section.enabled(promptContext)) {
            continue;
          }
          const text = section.render(promptContext).trim();
          if (!text) {
            continue;
          }
          context.add({
            kind: "system",
            text:
              `── ${section.name} ` +
              `(order=${section.order}) ──\n${text}`,
          });
          shown += 1;
        }
        context.add({
          kind: "summary",
          text:
            `${shown} sections · ` +
            `${host.promptRegistry.render(promptContext).length} chars · ` +
            `mode=${context.mode} · effort=${context.effort}`,
        });
        break;
      }

      case "clear":
        if (store.clear) {
          store.clear();
        } else {
          store.replaceMessages([]);
        }
        context.clearTodos();
        context.resetProgress();
        context.add({
          kind: "system",
          text: "对话历史与 todo 已清空（终端 scrollback 保留）",
        });
        break;

      case "save":
        if (!host.sessionStore) {
          throw new Error("该入口不支持会话保存");
        }
        context.add({
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
          context.add({
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
        if (loaded) {
          context.clearTodos();
        }
        context.add({
          kind: "system",
          text: loaded
            ? `会话已恢复: ${session.title}`
            : "会话恢复失败",
          tone: loaded ? "info" : "error",
        });
        break;
      }

      case "model": {
        if (!host.listModels || !host.selectModel) {
          context.add({
            kind: "system",
            text: `当前模型: ${host.modelName()}`,
          });
          break;
        }
        const models = host.listModels();
        if (!argument) {
          context.add({
            kind: "system",
            text: [
              "可用模型：",
              ...models.map(
                (model, index) =>
                  `${index + 1}. ${model.label}`,
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
        context.add({
          kind: "system",
          text: `已切换到模型: ${host.selectModel(
            index - 1,
          )}`,
        });
        break;
      }

      case "mode": {
        if (!argument) {
          context.add({
            kind: "system",
            text: [
              "可用模式：",
              ...MODE_ORDER.map(
                (item) =>
                  `${item === context.mode ? "→" : " "} ${
                    MODE_PRESENTATIONS[item].label
                  } (${item}) · ${
                    MODE_PRESENTATIONS[item].statusLabel
                  }`,
              ),
              "Shift+Tab / Alt+M 循环切换",
            ].join("\n"),
          });
          break;
        }
        const requested = argument.toLowerCase();
        if (!isSessionMode(requested)) {
          throw new Error(
            "模式必须是 manual / accept / plan / auto",
          );
        }
        context.setMode(requested);
        context.add({
          kind: "system",
          text: `模式已切换: ${MODE_PRESENTATIONS[requested].label}`,
        });
        break;
      }

      case "effort": {
        if (!argument) {
          context.add({
            kind: "system",
            text: [
              `当前 effort: ${context.effort}`,
              ...EFFORT_ORDER.map(
                (item) =>
                  `${item === context.effort ? "→" : " "} ${item}`,
              ),
              "effort 是 prompt 级设置，不是 DeepSeek 原生参数",
            ].join("\n"),
          });
          break;
        }
        const requested = argument.toLowerCase();
        if (!isEffortLevel(requested)) {
          throw new Error(
            "effort 必须是 low / medium / high / max",
          );
        }
        context.setEffort(requested);
        context.add({
          kind: "system",
          text: `effort 已切换: ${requested}`,
        });
        break;
      }

      case "tools": {
        const rows = describeModeTools(
          tools,
          context.mode,
        ).map(
          ({ schema, kind, allowed }) =>
            `${allowed ? "✓" : "·"} ${displayToolName(
              schema.name,
            )} [${kind}] ${schema.name}`,
        );
        context.add({
          kind: "system",
          text: [
            `当前模式: ${MODE_PRESENTATIONS[context.mode].label}`,
            ...rows,
            "✓ = 本轮模型可见",
          ].join("\n"),
        });
        break;
      }

      case "status": {
        const visible = describeModeTools(
          tools,
          context.mode,
        ).filter((item) => item.allowed).length;
        context.add({
          kind: "system",
          text: [
            `model:  ${host.modelName()}`,
            `mode:   ${
              MODE_PRESENTATIONS[context.mode].label
            } (${context.mode})`,
            `effort: ${context.effort} (prompt-level)`,
            `cwd:    ${host.cwd}`,
            `rounds: ${context.rounds}`,
            `tokens: ${context.tokens ?? "n/a"}`,
            `tools:  ${visible}/${tools.listTools().length}`,
          ].join("\n"),
        });
        break;
      }

      case "usage":
        if (!host.getUsage) {
          throw new Error("该入口不支持 /usage");
        }
        context.add({
          kind: "system",
          text: JSON.stringify(await host.getUsage(), null, 2),
        });
        break;

      case "user":
        if (!host.getUser) {
          throw new Error("该入口不支持 /user");
        }
        context.add({
          kind: "system",
          text: JSON.stringify(await host.getUser(), null, 2),
        });
        break;

      case "exit":
        context.exit();
        break;

      default:
        context.add({
          kind: "system",
          text: `未知命令: /${name}；/help 查看命令`,
          tone: "error",
        });
        break;
    }
  } catch (error) {
    context.add({
      kind: "system",
      text: `✗ ${errorText(error)}`,
      tone: "error",
    });
  }
}
