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
    │   ├── deepseek.py    # DeepSeek 直连入口（OpenAI 兼容 + 原生 tools）
    │   ├── commands.py    # /model、/save、/reload 等命令
    │   ├── config.py      # 路径与配置加载
    │   ├── prompt.py      # 可组合 prompt section 注册表
    │   ├── adapters/      # 模型适配器
    │   │   ├── mattermost.py       # Mattermost 适配器（直接实现 ModelAdapter，transport 可注入；内置 XML 风格文本协议 codec）
    │   │   ├── openai_common.py    # OpenAI wire 渲染/解析/HTTP
    │   │   ├── chat_completions.py # OpenAI 兼容、原生 tools、非流式
    │   │   └── streaming_chat_completions.py # OpenAI 兼容、SSE 流式
    │   ├── display/       # 显示管理
    │   │   ├── console.py # 终端输出（Claude Code 风格、Markdown-lite）
    │   │   └── spinner.py # 单行原地刷新的 spinner
    │   ├── session/       # 会话管理
    │   │   └── store.py   # 会话持久化（语义 transcript，v2）
    │   └── tools/         # Agent 工具（每工具一个文件）
    │       ├── _shared.py    # 路径围栏与遍历助手（包内共享）
    │       ├── list_files.py # 列出项目文件与目录
    │       ├── read_file.py  # 读取文本文件
    │       ├── search_text.py # 按关键字搜索
    │       └── write_file.py # 写入/覆盖文本文件
    ├── test_agent_sdk.py  # SDK 核心测试（loop、重试、请求组装）
    ├── test_app.py        # app 侧测试（适配器、文本 codec、会话）
    ├── test_prompt.py     # prompt section 注册表测试
    └── test_console.py    # CLI 显示辅助函数测试
```

## 运行

开发与测试环境为 Python 3.13；语法层面最低 3.10（PEP 604 类型标注）。

```bash
cd chatcli
python -m sdk.app
```

配置读取 `%APPDATA%/chat-cli/data/config.json`（Linux 为 `~/.local/share/chat-cli/data/config.json`；数据目录名沿用旧版 `chat-cli` 拼法，与项目名 `chatcli` 不同）。也可以先把配置放到项目内的 `data/config.json`，首次启动会复制过去。`data/prompt.json` 可选，只放应用层的人设与任务说明；XML 风格文本协议内置于 Mattermost 适配器（动作参数仍是 JSON），不要在 prompt 里重复描述。

### 用 DeepSeek 启动

默认 `python -m sdk.app` 走 Mattermost。想先用 DeepSeek 的 key 试，用 `sdk.app.deepseek`：

```bash
cd chatcli
cp .env.example .env          # 填入 DEEPSEEK_API_KEY
python -m sdk.app.deepseek
```

或者从仓库根目录启动，让 agent 的 workspace 是仓库根：

```bash
cd /d/CodeProject/AI/Herald
cp experiments/text-protocol/python/.env .env   # 已有实验 key，可直接复用
PYTHONPATH=chatcli python -m sdk.app.deepseek
```

PowerShell 对应写法：`$env:PYTHONPATH="chatcli"; python -m sdk.app.deepseek`。

- `DEEPSEEK_BASE_URL` 默认 `https://api.deepseek.com/v1`
- `DEEPSEEK_MODEL` 默认 `deepseek-chat`
- 已存在的环境变量优先，`.env` 不会覆盖
- 这个入口使用 OpenAI 兼容适配器 + 原生 tool calling，不走 Mattermost 的 XML 文本协议

## CLI 界面

一次请求的典型输出：

```text
╭─ You ─────────────────────────────────────────
> 读一下 README 并总结
╰───────────────────────────────────────────────

✻ 需要先读 README。
⏺ Read(README.md)
  ⎿ Read 42 lines (1.2 KB)
⏺ Search(agent)
  ⎿ Search 3 matches
✻ 信息够了。

⏺
  结论

  Herald 是一个从零构建的 TypeScript agent harness。

  • 用于学习
  • 不以产品为目标

✻ 2 rounds · 3.4s
```

- 请求期间会原地刷新 `✻ Thinking… (N.Ns)` spinner，收到响应后清除；非 TTY 或设置 `CHATCLI_NO_SPINNER=1` 时自动关闭
- `✻` 是 thought 段，灰色显示
- `⏺` 是工具调用或最终回答；工具名映射为 `Read` / `Write` / `List` / `Search`
- `⎿` 是工具结果摘要：`read_file` 显示行数/大小，`list_files` 显示文件/目录数，`search_text` 显示匹配数
- 最终回答支持轻量 Markdown 渲染：标题、代码块、粗体、行内代码、列表
- 输入框支持多行，空行发送；`/prompt` 按 section 显示当前组合出的 system prompt，`/help` 查看全部命令

这是行式 REPL 上的视觉近似，不是 Claude Code 那种固定底部输入栏、可滚动 transcript 的全屏 TUI。全屏 TUI 需要 raw-mode 终端控制（Windows 下标准库没有 `curses`/`termios`）或第三方依赖，不在 chatcli 当前的零依赖约束内。

## 模型适配器

SDK 只认识 `ModelRequest -> ModelTurn`：输入是语义 transcript、system 和工具 schema，输出是 content、tool_calls、usage 与可选 thought。流式、HTTP、文本协议都属于适配器与 App。

| 适配器 | 说明 |
|---|---|
| `MattermostModel` | 反代 Mattermost chat 插件，直接实现 ModelAdapter；XML 风格文本协议 codec 内置于 `app/adapters/mattermost.py`（动作参数为 JSON），HTTP transport 可注入（离线测试的接缝） |
| `ChatCompletionsModel` | OpenAI 兼容 `/chat/completions`，原生 function tools，非流式 |
| `StreamingChatCompletionsModel` | 同一接口 `stream=true`；SSE 增量在适配器内重组，通过 `on_delta` / `on_reasoning_delta` 交给 App；SDK 仍只收到完整 `ModelTurn` |

### Mattermost 文本协议

Mattermost 插件只交换 `{role, content}`，因此适配器内置一套 XML 风格协议：

````text
thought: 需要读一下 README。

<action>
{"calls": [{"tool": "read_file", "args": {"path": "README.md"}}]}
````

或：

````text
thought: 信息够了。

<final>
<任意 Markdown，可含代码块>
````

工具结果作为 user 消息里的 `<tool_result call="..." tool="..." status="...">` 块回填。动作参数是 JSON；thought、final 与工具结果正文都是裸文本，不做 JSON 转义。结构化结果可能是一行 JSON，或者「JSON 元数据 + `---` + 原始内容」；正文里的 `</tool_result>` 会被确定性转义。协议文本由 `render_protocol` 生成，解析与历史渲染在 `app/adapters/mattermost.py`。

### Prompt 组合

`system` 内容由 `app/prompt.py` 的 `PromptRegistry` 组合，不再硬编码拼接。每个 `PromptSection` 有名字、排序号、渲染函数和可选启用条件；`PromptPlugin` 把一组 section 一起注册。

默认 section：

| 名字 | order | 内容 |
|---|---|---|
| `app_system` | 100 | 应用传入的 system prompt |
| `tool_catalog` | 200 | 紧凑工具目录（无工具时跳过） |
| `mattermost_protocol` | 300 | XML 风格响应协议 |
| `mattermost_examples` | 400 | 协议示例 |

注册自定义片段：

```python
from sdk.app.prompt import PromptSection
from sdk.app.adapters.mattermost import MattermostModel, build_default_prompt_registry

registry = build_default_prompt_registry()
registry.register(
    PromptSection("project_rules", lambda ctx: "本项目使用 pnpm。", order=250)
)
model = MattermostModel(state, config, prompt_registry=registry)
```

- `order` 小的先渲染；同 order 按名字排序。
- `enabled` 返回 `False` 时跳过该 section；渲染结果为空也会跳过。
- `register(..., replace=True)` 可替换同名内置 section；`unregister(name)` 可移除。
- `register_plugin(plugin)` 原子注册一组 section；只要有一个冲突，整组都不注册。

当前只有 `MattermostModel` 使用这个注册表；OpenAI 原生适配器仍直接使用 `request.system`，工具 schema 走原生 `tools` 字段。`app/main.py` 作为组合根创建默认注册表；需要项目级 section 时在那里注册。

### OpenAI 兼容适配器

配置（环境变量，构造参数可覆盖）：

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
- 会话存档为语义 transcript（version 2），旧 JSON 文本协议会话在加载时自动迁移。
- `agent_sdk` 仅使用 Python 标准库，无第三方依赖。
