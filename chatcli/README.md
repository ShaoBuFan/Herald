# chatcli

一个微型 Agent 子项目，随 Herald 一起持续演进。

## 与 Herald 的关系

- Herald 主体仍是 TypeScript 的学习型 harness（见根目录 [`AGENTS.md`](../AGENTS.md)）。
- `chatcli` 是独立的 Python 子项目，提供一个可运行的最小 Agent 参照实现。
- 它不是 Herald 内核，也不替代 Herald 中由作者自写的核心逻辑；两者的设计取舍可以相互对照。

## 结构

```
chatcli/
└── sdk/
    ├── agent_sdk/   # 框架无关的 Agent 运行时
    │   ├── agent.py       # loop：语义 transcript → ModelTurn
    │   ├── config.py      # AgentConfig
    │   ├── errors.py      # 异常类型（含协议错误码与 feedback）
    │   ├── events.py      # AgentEvent
    │   ├── models.py      # ModelRequest / ModelTurn / 语义消息
    │   ├── protocols.py   # ModelAdapter / MessageStore / ToolExecutor
    │   ├── request.py     # 语义请求组装
    │   ├── stores/        # InMemoryMessageStore
    │   └── tools/         # Tool / ToolRegistry
    ├── app/         # 基于 agent_sdk 的 CLI 应用
    │   ├── main.py        # 主循环与命令分发（组合根）
    │   ├── commands.py    # /model、/save、/reload 等命令
    │   ├── config.py      # 路径与配置加载
    │   ├── adapters/      # 模型适配器
    │   │   ├── mattermost.py       # Mattermost 适配器（直接实现 ModelAdapter，transport 可注入；内置文本 JSON 协议 codec）
    │   │   ├── openai_common.py    # OpenAI wire 渲染/解析/HTTP
    │   │   ├── chat_completions.py # OpenAI 兼容、原生 tools、非流式
    │   │   └── streaming_chat_completions.py # OpenAI 兼容、SSE 流式
    │   ├── display/       # 显示管理
    │   │   └── console.py # 终端输出（含流式渲染回调）
    │   ├── session/       # 会话管理
    │   │   └── store.py   # 会话持久化（语义 transcript，v2）
    │   └── tools/         # Agent 工具（每工具一个文件）
    │       ├── _shared.py    # 路径围栏与遍历助手（包内共享）
    │       ├── list_files.py # 列出项目文件与目录
    │       ├── read_file.py  # 读取文本文件
    │       ├── search_text.py # 按关键字搜索
    │       └── write_file.py # 写入/覆盖文本文件
    ├── test_agent_sdk.py  # SDK 核心测试（loop、重试、请求组装）
    └── test_app.py        # app 侧测试（适配器、文本 codec、会话）
```

## 运行

开发与测试环境为 Python 3.13；语法层面最低 3.10（PEP 604 类型标注）。

```bash
cd chatcli
python -m sdk.app
```

配置读取 `%APPDATA%/chat-cli/data/config.json`（Linux 为 `~/.local/share/chat-cli/data/config.json`；数据目录名沿用旧版 `chat-cli` 拼法，与项目名 `chatcli` 不同）。也可以先把配置放到项目内的 `data/config.json`，首次启动会复制过去。`data/prompt.json` 可选，只放应用层的人设与任务说明；文本 JSON 协议内置于 Mattermost 适配器，不要在 prompt 里重复描述。

## 模型适配器

SDK 只认识 `ModelRequest -> ModelTurn`：输入是语义 transcript、system 和工具 schema，输出是 content、tool_calls、usage 与可选 thought。流式、HTTP、JSON 文本协议都属于适配器与 App。

| 适配器 | 说明 |
|---|---|
| `MattermostModel` | 反代 Mattermost chat 插件，直接实现 ModelAdapter；文本 JSON 协议 codec 内置于 `app/adapters/mattermost.py`，HTTP transport 可注入（离线测试的接缝） |
| `ChatCompletionsModel` | OpenAI 兼容 `/chat/completions`，原生 function tools，非流式 |
| `StreamingChatCompletionsModel` | 同一接口 `stream=true`；SSE 增量在适配器内重组，通过 `on_delta` / `on_reasoning_delta` 交给 App；SDK 仍只收到完整 `ModelTurn` |

OpenAI 兼容适配器的配置（环境变量，构造参数可覆盖）：

- `OPENAI_BASE_URL`，默认 `https://api.openai.com/v1`
- `OPENAI_API_KEY`，必填
- `OPENAI_MODEL`，必填

```python
from sdk.agent_sdk import Agent, AgentConfig
from sdk.app.adapters.chat_completions import ChatCompletionsModel
from sdk.app.adapters.streaming_chat_completions import StreamingChatCompletionsModel
from sdk.app.display.console import console

model = ChatCompletionsModel()  # 非流式
# model = StreamingChatCompletionsModel(
#     on_delta=console.stream_delta,
#     on_reasoning_delta=console.stream_reasoning_delta,
# )
agent = Agent(model, tools, store, AgentConfig(system_prompt=...))
```

流式只影响展示；SDK 的 loop 不产生 token/delta 事件。重试时 SDK 会发 `retry` 事件，App 据此决定是否清空或标记上一轮已展示的增量。默认 CLI 仍走 Mattermost 适配器。

## 测试

测试全部离线，不依赖 API key 或网络：

```bash
cd chatcli
python -m unittest discover -s sdk -p 'test_*.py' -v
```

## 状态

- 当前只包含 `sdk/` 部分；原项目的 `bin/`、`data/`、`docs/`、`packaging/`、`src/`、`test/` 尚未加入。
- `sdk/plan.md` 尚未补齐。
- 会话存档为语义 transcript（version 2），旧文本协议会话在加载时自动迁移。
- `agent_sdk` 仅使用 Python 标准库，无第三方依赖。
