"""Ink TUI skeleton generator.

单文件、仅标准库：生成一个最小可运行的 Node + React + Ink 终端界面骨架。

用法：
    python ink_tui_bootstrap.py
    python ink_tui_bootstrap.py --output my_tui
    python ink_tui_bootstrap.py --output my_tui --force

生成的项目依赖：
    ink@6 + react@19 + tsx + typescript（Node >= 20）

注意：生成的是 UI 骨架，不包含真实模型与工具执行。
"""

from __future__ import annotations

import argparse
from pathlib import Path

FILES: dict[str, str] = {}

FILES["package.json"] = r'''{
  "name": "ink-tui-skeleton",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx app.tsx",
    "probe": "tsx probe.tsx",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "ink": "^6.0.0",
    "react": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^19.0.0",
    "tsx": "^4.20.0",
    "typescript": "^5.6.0"
  }
}
'''

FILES["tsconfig.json"] = r'''{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["app.tsx", "probe.tsx"]
}
'''

FILES["app.tsx"] = r'''import { useEffect, useRef, useState } from "react";
import { Box, Static, Text, render, useApp, useInput } from "ink";

type NewTranscriptItem =
  | { kind: "welcome" }
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; detail: string }
  | { kind: "result"; detail: string };

type TranscriptItem = NewTranscriptItem & { id: number };

type AgentEvent =
  | { type: "thinking"; label: string }
  | { type: "tool_call"; name: string; detail: string }
  | { type: "tool_result"; detail: string }
  | { type: "final"; text: string };

const SPINNER_FRAMES = ["✻", "✢", "✳", "✶"] as const;
const APP_NAME = "chatCLI";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const sanitizeInput = (text: string): string =>
  text
    // bracketed paste markers
    .replace(/\x1b\[20[01]~/g, "")
    // ANSI escape sequences
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    // Windows / old Mac line endings
    .replace(/\r\n?/g, "\n")
    // tabs break the box width calculation
    .replace(/\t/g, "    ")
    // remaining C0 control chars, keep \n
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");

async function* runScriptedAgent(prompt: string): AsyncGenerator<AgentEvent> {
  yield { type: "thinking", label: "Thinking" };
  await sleep(650);

  yield { type: "tool_call", name: "Read", detail: "README.md" };
  await sleep(350);

  yield { type: "tool_result", detail: "Read 42 lines (1.2 KB)" };

  yield { type: "thinking", label: "Pondering" };
  await sleep(550);

  yield {
    type: "final",
    text: `这是 scripted demo 对「${prompt}」的回答。把 runScriptedAgent 换成真实 agent 的事件流即可。`,
  };
}

function Welcome() {
  return (
    <Box
      alignItems="center"
      borderStyle="round"
      borderColor="gray"
      flexDirection="row"
      marginBottom={1}
      paddingX={1}
    >
      <Box
        alignItems="center"
        flexDirection="column"
        justifyContent="center"
        marginRight={1}
        width={14}
      >
        <Text bold color="yellow">✻</Text>
        <Text bold color="yellow">✻✻✻</Text>
        <Text bold color="yellow">✻</Text>
        <Text bold>{APP_NAME}</Text>
        <Text dimColor>v0.1</Text>
      </Box>

      <Box
        borderBottom={false}
        borderLeft={true}
        borderRight={false}
        borderStyle="single"
        borderTop={false}
        flexDirection="column"
        flexGrow={1}
        paddingLeft={1}
      >
        <Text bold color="yellow">What's new</Text>
        <Text dimColor>· Claude Code-like two-column layout</Text>
        <Text dimColor>· Double-Enter to send</Text>
        <Text dimColor>· Pasted multiline normalization</Text>

        <Box
          borderBottom={false}
          borderLeft={false}
          borderRight={false}
          borderStyle="single"
          borderTop={true}
          marginY={1}
        />

        <Box flexDirection="column">
          <Text bold color="yellow">Workspace</Text>
          <Box>
            <Box width={9}>
              <Text dimColor>cwd</Text>
            </Box>
            <Text>{process.cwd()}</Text>
          </Box>
          <Box>
            <Box width={9}>
              <Text dimColor>model</Text>
            </Box>
            <Text>scripted-demo</Text>
          </Box>
          <Box>
            <Box width={9}>
              <Text dimColor>runtime</Text>
            </Box>
            <Text>node {process.version}</Text>
          </Box>
          <Box>
            <Box width={9}>
              <Text dimColor>tools</Text>
            </Box>
            <Text>Read (demo)</Text>
          </Box>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>/help 查看命令 · /exit 退出</Text>
        </Box>
      </Box>
    </Box>
  );
}

function TranscriptLine({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case "welcome":
      return <Welcome />;
    case "user":
      return (
        <Box marginTop={1}>
          <Text color="yellow">You</Text>
          <Text> {item.text}</Text>
        </Box>
      );
    case "assistant":
      return (
        <Box marginTop={1}>
          <Text color="green">⏺ </Text>
          <Text>{item.text}</Text>
        </Box>
      );
    case "tool":
      return (
        <Box marginTop={1}>
          <Text color="green">⏺ </Text>
          <Text bold>{item.name}</Text>
          <Text dimColor>({item.detail})</Text>
        </Box>
      );
    case "result":
      return (
        <Box marginLeft={2}>
          <Text dimColor>⎿ {item.detail}</Text>
        </Box>
      );
  }
}

function Spinner({ label }: { label: string }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((value) => (value + 1) % SPINNER_FRAMES.length);
    }, 120);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box>
      <Text color="cyan">{SPINNER_FRAMES[frame]} </Text>
      <Text dimColor>{label}…</Text>
    </Box>
  );
}

function InputBox({ value, busy }: { value: string; busy: boolean }) {
  const lines = value.split("\n");

  return (
    <Box
      borderStyle="round"
      borderColor={busy ? "gray" : "green"}
      flexDirection="column"
      paddingX={1}
      width="100%"
    >
      {lines.map((line, index) => (
        <Box key={index}>
          <Text color="green">
            {index === 0 ? (busy ? "…" : ">") : " "}{" "}
          </Text>
          <Text>
            {line || (index === 0 && value === "" ? "输入消息…" : "")}
            {!busy && index === lines.length - 1 ? (
              <Text color="green">▌</Text>
            ) : null}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function App() {
  const { exit } = useApp();
  const [items, setItems] = useState<TranscriptItem[]>([
    { kind: "welcome", id: 0 },
  ]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [spinnerLabel, setSpinnerLabel] = useState("Thinking");
  const nextId = useRef(1);
  const lastWasEnter = useRef(false);

  const add = (item: NewTranscriptItem) => {
    const next = { ...item, id: nextId.current++ } as TranscriptItem;
    setItems((previous) => [...previous, next]);
  };

  const submit = async (prompt: string) => {
    if (busy) return;
    add({ kind: "user", text: prompt });
    setValue("");
    setBusy(true);
    try {
      for await (const event of runScriptedAgent(prompt)) {
        switch (event.type) {
          case "thinking":
            setSpinnerLabel(event.label);
            break;
          case "tool_call":
            add({ kind: "tool", name: event.name, detail: event.detail });
            break;
          case "tool_result":
            add({ kind: "result", detail: event.detail });
            break;
          case "final":
            add({ kind: "assistant", text: event.text });
            break;
        }
      }
    } finally {
      setBusy(false);
    }
  };

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    if (busy) return;
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
      if (prompt === "/exit") {
        exit();
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
        {(item) => <TranscriptLine key={item.id} item={item} />}
      </Static>
      <Box flexDirection="column" marginTop={1} width="100%">
        {busy ? <Spinner label={spinnerLabel} /> : null}
        <InputBox value={value} busy={busy} />
        <Text dimColor>Enter 换行 · 双击 Enter 发送</Text>
        <Text dimColor>
          Shift+Enter / Ctrl+J 也可换行 · /exit 退出 · Ctrl+C 退出
        </Text>
      </Box>
    </Box>
  );
}

render(<App />, {
  kittyKeyboard: {
    mode: "auto",
    flags: ["disambiguateEscapeCodes"],
  },
});
'''

FILES["probe.tsx"] = r'''import { useState } from "react";
import { render, Text, useApp, useInput } from "ink";

function Probe() {
  const { exit } = useApp();
  const [last, setLast] = useState(
    "按 Enter / Shift+Enter / Alt+Enter / Ctrl+J；按 q 退出",
  );

  useInput((input, key) => {
    if (input === "q") exit();
    setLast(
      JSON.stringify({
        input: JSON.stringify(input),
        return: key.return,
        shift: key.shift,
        meta: key.meta,
        ctrl: key.ctrl,
      }),
    );
  });

  return <Text>{last}</Text>;
}

render(<Probe />, {
  kittyKeyboard: {
    mode: "auto",
    flags: ["disambiguateEscapeCodes"],
  },
});
'''

FILES[".gitignore"] = r'''node_modules/
dist/
.env
'''

FILES["README.md"] = r'''# Ink TUI skeleton

最小可运行的 Node + React + Ink 终端界面骨架。

## 运行

```bash
pnpm install
pnpm dev
```

Node >= 20；依赖 `ink@6` + `react@19` + `tsx` + `typescript`。

## 这个骨架演示什么

- `<Static>` 渲染 Welcome 和历史消息：只输出一次，留在终端 scrollback
- Claude Code 风格 Welcome：左侧图标，右侧 What's new / Workspace 两段
- 底部动态区：spinner、输入框、提示行，独立重绘
- Welcome 必须是 `<Static>` 的第一个 item，不能放在 `<Static>` 外面
- `⏺` / `⎿` 工具调用与结果卡片
- `useInput` 的 raw 键盘输入
- `runScriptedAgent` 异步事件流：换成真实 agent 事件即可

## 多行输入

默认行为：**Enter 换行，连续按两次 Enter 发送**（两次之间不要输入文字）。

- Shift+Enter / Alt+Enter 换行：终端支持增强键盘协议时可用
- Ctrl+J 换行：不依赖 Shift+Enter
- 如果 Shift+Enter 无效，不影响双击 Enter 发送
- 粘贴文本会去掉 bracketed paste 标记/ANSI 控制符，统一 `\r\n` → `\n`，tab 转空格

调试按键：

```bash
pnpm probe
```

依次按 Enter / Shift+Enter / Alt+Enter / Ctrl+J，看它输出的 JSON。如果 Shift+Enter 的 `input` 和 Enter 一样、`shift` 也是 false，就是终端层丢了 modifier；用双击 Enter 或 Ctrl+J。

`app.tsx` 处理：双击 Enter、Kitty 的 Shift+Enter、Alt+Enter、`\n` / `\u000b`。

## Git Bash / VS Code 终端

先确认 raw input 是否可用：

```bash
node -e "console.log(process.stdin.isTTY, process.stdout.isTTY)"
```

如果是 `false false`，试：

```bash
winpty pnpm dev
```

或者在 PowerShell / Windows Terminal 里运行。

## 结构

```text
app.tsx          UI + scripted agent + 输入处理
package.json     ink@6 / react@19 / tsx
tsconfig.json    strict + react-jsx
```

## 下一步

1. 把 `runScriptedAgent` 换成你的真实 agent 事件流
2. 增加工具调用参数展示、diff 视图、权限弹窗
3. 增加输入历史、`/` 命令、`@file` 补全
4. 需要的话把 App 拆成 `components/`、`model/`、`input/`
'''


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate a minimal Node + React + Ink TUI skeleton."
    )
    parser.add_argument(
        "--output",
        "-o",
        default="ink_tui_generated",
        help="target directory (default: ink_tui_generated)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="overwrite files in a non-empty target directory",
    )
    args = parser.parse_args(argv)

    output = Path(args.output).resolve()
    if output.exists() and any(output.iterdir()) and not args.force:
        print(f"Refusing to overwrite non-empty directory: {output}")
        print("Use --force or choose another --output.")
        return 1

    output.mkdir(parents=True, exist_ok=True)
    for relative, content in FILES.items():
        path = output / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8", newline="\n")

    print(f"Generated {len(FILES)} files into {output}")
    print()
    print("Next:")
    print(f"  cd {output}")
    print("  pnpm install")
    print("  pnpm dev")
    print()
    print("Node >= 20. If Git Bash cannot do raw input:")
    print("  winpty pnpm dev   # or run in PowerShell/Windows Terminal")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
