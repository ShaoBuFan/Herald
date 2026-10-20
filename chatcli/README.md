# chatCLI

一个微型 Agent 子项目，随 Herald 一起持续演进。

## 与 Herald 的关系

- Herald 主体仍是 TypeScript 的学习型 harness（见根目录 [`AGENTS.md`](../AGENTS.md)）。
- `chatCLI` 是独立的 Python 子项目，提供一个可运行的最小 Agent 参照实现。
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
    │   ├── parser.py      # 文本 JSON 协议解析（codec 内部）
    │   ├── protocol.py    # 文本 JSON 协议文本、重试提示与示例（codec 内部）
    │   ├── protocols.py   # ModelAdapter / MessageStore / ToolExecutor
    │   ├── request.py     # 语义请求组装
    │   ├── text_protocol.py # 语义 transcript ↔ 文本 JSON 编解码
    │   ├── stores/        # InMemoryMessageStore
    │   └── tools/         # Tool / ToolRegistry
    ├── app/         # 基于 agent_sdk 的 CLI 应用与模型适配器
    │   ├── main.py        # 主循环与命令分发
    │   ├── commands.py    # /model、/save、/reload 等命令
    │   ├── config.py      # 路径与配置加载
    │   ├── console.py     # 终端输出（含流式渲染回调）
    │   ├── files.py       # 文件工具
    │   ├── model.py       # Mattermost 文本客户端（原样保留）
    │   ├── openai_common.py # OpenAI wire 渲染/解析/HTTP
    │   ├── chat_completions.py # OpenAI 兼容、原生 tools、非流式
    │   ├── streaming_chat_completions.py # OpenAI 兼容、SSE 流式
    │   └── session.py     # 会话持久化（语义 transcript，v2）
    ├── test_agent_sdk.py  # SDK / 文本 codec / 会话测试
    └── test_openai_adapters.py # OpenAI 非流式与流式适配器测试
```

## 运行

要求 Python 3.13（代码使用 PEP 604 类型标注，至少需要 3.10）：

```bash
cd chatcli
python -m sdk.app
```

配置读取 `%APPDATA%/chat-cli/data/config.json`（Linux 为 `~/.local/share/chat-cli/data/config.json`）。也可以先把配置放到项目内的 `data/config.json`，首次启动会复制过去。`data/prompt.json` 可选，只放应用层的人设与任务说明；文本 JSON 协议由 `TextProtocolAdapter` 提供，不要在 prompt 里重复描述。

## 模型适配器

SDK 只认识 `ModelRequest -> ModelTurn`：输入是语义 transcript、system 和工具 schema，输出是 content、tool_calls、usage 与可选 thought。流式、HTTP、JSON 文本协议都属于适配器与 App。

| 适配器 | 说明 |
|---|---|
| `TextProtocolAdapter(MattermostModel(...))` | 现有 Mattermost 文本客户端保持不变；codec 负责文本 JSON 协议、工具清单渲染、解析与重试提示 |
| `ChatCompletionsModel` | OpenAI 兼容 `/chat/completions`，原生 function tools，非流式 |
| `StreamingChatCompletionsModel` | 同一接口 `stream=true`；SSE 增量在适配器内重组，通过 `on_delta` / `on_reasoning_delta` 交给 App；SDK 仍只收到完整 `ModelTurn` |

OpenAI 兼容适配器的配置（环境变量，构造参数可覆盖）：

- `OPENAI_BASE_URL`，默认 `https://api.openai.com/v1`
- `OPENAI_API_KEY`，必填
- `OPENAI_MODEL`，必填

```python
from sdk.agent_sdk import Agent, AgentConfig
from sdk.app.chat_completions import ChatCompletionsModel
from sdk.app.streaming_chat_completions import StreamingChatCompletionsModel
from sdk.app.console import console

model = ChatCompletionsModel()  # 非流式
# model = StreamingChatCompletionsModel(
#     on_delta=console.stream_delta,
#     on_reasoning_delta=console.stream_reasoning_delta,
# )
agent = Agent(model, tools, store, AgentConfig(system_prompt=...))
```

流式只影响展示；SDK 的 loop 不产生 token/delta 事件。重试时 SDK 会发 `retry` 事件，App 据此决定是否清空或标记上一轮已展示的增量。默认 CLI 仍走 Mattermost + `TextProtocolAdapter`。

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
