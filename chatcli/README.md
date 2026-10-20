# chatCLI

一个微型 Agent 子项目，最初写于公司内部，现随 Herald 一起持续演进。

## 与 Herald 的关系

- Herald 主体仍是 TypeScript 的学习型 harness（见根目录 [`AGENTS.md`](../AGENTS.md)）。
- `chatCLI` 是独立的 Python 子项目，提供一个可运行的最小 Agent 参照实现。
- 它不是 Herald 内核，也不替代 Herald 中由作者自写的核心逻辑；两者的设计取舍可以相互对照。

## 结构

```
chatcli/
└── sdk/
    ├── agent_sdk/   # 框架无关的 Agent 运行时
    │   ├── agent.py       # Agent 循环与事件流
    │   ├── config.py      # AgentConfig
    │   ├── errors.py      # 异常类型
    │   ├── events.py      # AgentEvent
    │   ├── models.py      # 数据模型
    │   ├── parser.py      # 模型响应解析
    │   ├── protocols.py   # ModelAdapter / MessageStore / ToolExecutor
    │   ├── stores/        # InMemoryMessageStore
    │   └── tools/         # Tool / ToolRegistry
    └── app/         # 基于 agent_sdk 的 CLI 应用
        ├── main.py        # 主循环与命令分发
        ├── commands.py    # /model、/save、/reload 等命令
        ├── config.py      # 路径与配置加载
        ├── console.py     # 终端输出
        ├── files.py       # 文件工具
        ├── model.py       # Mattermost 模型适配器
        └── session.py     # 会话持久化
```

## 运行

要求 Python 3.13（代码使用 PEP 604 类型标注，至少需要 3.10）：

```bash
cd chatcli
python -m sdk.app
```

配置读取 `%APPDATA%/chat-cli/data/config.json`（Linux 为 `~/.local/share/chat-cli/data/config.json`）。也可以先把配置放到项目内的 `data/config.json`，首次启动会复制过去。`data/prompt.json` 可选。

## 状态

- 当前只包含 `sdk/` 部分；原项目的 `bin/`、`data/`、`docs/`、`packaging/`、`src/`、`test/` 尚未加入。
- `sdk/plan.md`、`sdk/test_agent_sdk.py` 尚未补齐。
- `agent_sdk` 仅使用 Python 标准库，无第三方依赖。
