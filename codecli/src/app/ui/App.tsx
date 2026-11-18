import { useRef, useState } from "react";
import {
  Box,
  Static,
  Text,
  useInput,
} from "ink";

import {
  AgentConfig,
  type MessageStore,
  type ModelAdapter,
} from "../../core/index.js";
import { ToolRegistry } from "../../core/tools/registry.js";
import { nextSessionMode } from "../modes.js";
import { LiveProgress } from "../progress.js";
import type { AppHost } from "./app-host.js";
import { SHORTCUT_HELP } from "./commands.js";
import { InputBox } from "./InputBox.js";
import { LivePreview } from "./LivePreview.js";
import { MODE_PRESENTATIONS } from "./mode-presentation.js";
import {
  parseCommand,
  sanitizeInput,
} from "./input.js";
import { PermissionPrompt } from "./PermissionPrompt.js";
import { Rule } from "./Rule.js";
import { Spinner } from "./Spinner.js";
import { StatusBar } from "./StatusBar.js";
import { TodoPanel } from "./TodoPanel.js";
import { ToolActivity } from "./ToolActivity.js";
import { TranscriptItemView } from "./Transcript.js";
import { useAgentSession } from "./useAgentSession.js";

export type { AppHost } from "./app-host.js";

export interface AppProps {
  model: ModelAdapter;
  tools: ToolRegistry;
  store: MessageStore;
  config: AgentConfig;
  host: AppHost;
  progress?: LiveProgress;
}

export function App({
  model,
  tools,
  store,
  config,
  host,
  progress,
}: AppProps) {
  const session = useAgentSession({
    model,
    tools,
    store,
    config,
    host,
    progress,
  });
  const {
    exit,
    items,
    busy,
    mode,
    effort,
    todos,
    approval,
    pendingTools,
    spinnerLabel,
    turnStartedAt,
    tokenCount,
    liveContent,
    add,
    submit,
    resolveApproval,
    abort,
    runCommand,
    setMode,
  } = session;

  const [value, setValue] = useState("");
  const valueRef = useRef("");
  const lastWasEnter = useRef(false);

  const setInput = (next: string): void => {
    valueRef.current = next;
    setValue(next);
  };

  const appendInput = (text: string): void => {
    setInput(valueRef.current + text);
  };

  useInput((input, key) => {
    if (approval) {
      if (key.ctrl && input === "c") {
        resolveApproval(false);
        abort();
        return;
      }
      if (input.toLowerCase() === "y" || key.return) {
        resolveApproval(true);
        return;
      }
      if (input.toLowerCase() === "n" || key.escape) {
        resolveApproval(false);
        return;
      }
      return;
    }

    if (key.ctrl && input === "c") {
      if (busy) {
        abort();
      } else {
        exit();
      }
      return;
    }

    if (busy) {
      if (key.escape) {
        abort();
      }
      return;
    }

    if (
      (key.tab && key.shift) ||
      input === "\u001b[Z" ||
      (key.meta && input.toLowerCase() === "m")
    ) {
      const next = nextSessionMode(mode);
      setMode(next);
      add({
        kind: "system",
        text: `模式已切换: ${MODE_PRESENTATIONS[next].label}`,
      });
      return;
    }

    if (key.escape) {
      setInput("");
      lastWasEnter.current = false;
      return;
    }

    if (input === "?" && valueRef.current === "") {
      add({ kind: "system", text: SHORTCUT_HELP });
      return;
    }

    if (key.return && (key.shift || key.meta)) {
      lastWasEnter.current = false;
      appendInput("\n");
      return;
    }
    if (input === "\n" || input === "\u000b") {
      lastWasEnter.current = false;
      appendInput("\n");
      return;
    }

    if (key.return) {
      const prompt = valueRef.current.trim();
      if (!prompt) {
        lastWasEnter.current = false;
        return;
      }

      if (
        prompt.startsWith("/") &&
        !prompt.includes("\n")
      ) {
        lastWasEnter.current = false;
        setInput("");
        const parsed = parseCommand(prompt);
        if (parsed) {
          runCommand(parsed);
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
      appendInput("\n");
      return;
    }

    lastWasEnter.current = false;

    if (key.backspace || key.delete) {
      setInput([...valueRef.current].slice(0, -1).join(""));
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      const text = sanitizeInput(input);
      if (text) {
        appendInput(text);
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
        <TodoPanel todos={todos} />

        {liveContent ? (
          <LivePreview content={liveContent} />
        ) : null}

        {pendingTools.map((item) => (
          <ToolActivity
            key={item.id}
            name={item.name}
            arguments={item.arguments}
            startedAt={item.startedAt}
            pending
          />
        ))}

        {busy && !approval ? (
          <Spinner
            label={spinnerLabel}
            startedAt={turnStartedAt}
            tokens={tokenCount}
          />
        ) : null}

        {approval ? (
          <PermissionPrompt request={approval} />
        ) : null}

        <Box justifyContent="flex-end">
          <Text dimColor>◆ {effort} · /effort</Text>
        </Box>

        <Rule />
        <InputBox value={value} busy={busy} />
        <Rule />
        <StatusBar
          mode={mode}
          busy={busy}
          waiting={approval !== null}
        />
      </Box>
    </Box>
  );
}
