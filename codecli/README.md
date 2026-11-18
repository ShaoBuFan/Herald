# CodeCLI

TypeScript + React Ink 版的 chatcli。**当前活跃的 TS/Ink 参考实现**；Python [`../chatcli`](../chatcli/) 保留为 legacy 对照实现。

界面以 Claude Code v2.1.x 的终端布局为参照：启动欢迎面板（标题嵌在边框，左侧 CodeCLI ASCII banner，右侧 Tips / Recent activity）、整行 prompt section bar、`●` assistant 行、工具行动词与嵌套详情、`✻` spinner + token、底部 composer 和模式状态栏。

Markdown 输出支持标题、列表、代码块、行内代码/粗体，以及带边框的管道表格（`| ... |` + `|---|`）；表格会按终端宽度换行，并按 CJK 显示宽度对齐列。

## 与 Herald 的关系

- Herald 主体仍是由作者自写核心逻辑的学习型 harness，见根目录 [`AGENTS.md`](../AGENTS.md)。
- CodeCLI 是作者明确授权 AI 全量移植的参考实现，用于快速建立可运行的 TS/Ink 对照基线；它不属于 Herald 主体内核，也不替代作者的复述验收。
- Python chatcli 继续保留：它更接近“每层手写”的教学版本，CodeCLI 则用于对照“同一套协议在 React Ink 下如何组织 UI、流式事件与权限”。

## 运行

需要 Node >= 20（开发环境实测 Node 24）和 pnpm。

```bash
cd codecli
pnpm install
pnpm dev:deepseek      # DeepSeek / OpenAI 兼容入口（原生 tools + SSE）
pnpm dev               # Mattermost 入口（XML 文本协议）
```

### DeepSeek 入口

配置读取顺序：启动目录 `.env` → `codecli/.env` → 仓库根 `.env`；已有环境变量优先。

```bash
cp .env.example .env
# 填入 DEEPSEEK_API_KEY
```

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 无 | 必填 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` | OpenAI 兼容地址 |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 模型名 |

DeepSeek 入口使用 SSE 流式请求；spinner 的 `↓ N tokens` 优先使用服务端返回的 usage，没有 usage 时按输出字符数估算。

### Mattermost 入口

与 Python 版共用配置位置：`%APPDATA%/chat-cli/data/config.json`（Linux 为 `~/.local/share/chat-cli/data/config.json`）。也可以先把配置放到项目内 `data/config.json`，首次启动会复制过去。`data/prompt.json` 可选，只放应用层人设与任务说明；XML 协议内置于 Mattermost 适配器。

Mattermost 请求是同步的，因此 spinner 只显示耗时，不显示流式 token。

> 配置里包含 token，`data/` 已被 gitignore；不要提交。

## 交互

| 按键 | 行为 |
|---|---|
| Enter | 插入换行 |
| 双击 Enter | 发送 |
| Shift+Enter / Alt+Enter / Ctrl+J | 插入换行 |
| Shift+Tab / Alt+M | 循环切换权限模式 |
| Esc | 运行中中断；空闲时清空草稿 |
| Ctrl+C | 运行中中断；空闲时退出 |
| `?` | 输入为空时显示快捷键说明 |

部分终端（Git Bash/MinTTY、某些 VS Code 终端）不区分 Enter 与 Shift+Enter，所以默认发送方式是双击 Enter。`pnpm probe` 可查看当前终端实际上报的按键。

粘贴文本会清理 bracketed-paste 标记、ANSI 转义、CRLF、Tab 和 C0 控制字符，再按行渲染。

## 工具

| 工具 | 类别 | 作用 |
|---|---|---|
| `list_files` | read | 列出文件与目录 |
| `glob` | read | 按 `**`/`*` 模式查找文件 |
| `read_file` | read | 读取文本文件 |
| `search_text` | read | 按关键字搜索 |
| `write_file` | write | 创建/覆盖文件 |
| `edit` | write | 精确字符串替换，支持 `replace_all` |
| `bash` | execute | 在工作区运行 shell 命令 |
| `todo_write` | meta | 更新任务 checklist |

`bash` 默认超时 120s，stdout/stderr 各自最多保留 64KB；Windows 默认调用 `bash.exe`，可用 `CODECLI_BASH` 指定 shell。非零退出不会抛异常，而是把 `exit_code` 回灌给模型。

`todo_write` 的结果会直接渲染为 spinner 上方的 checklist；`/clear` 会同时清空它。

## 权限模式

| 模式 | 状态栏 | 可用工具 | 审批 |
|---|---|---|---|
| `manual` | `manual mode on` | 全部 | write/execute 每次 y/n |
| `accept` | `accept edits on` | 全部 | 仅 execute |
| `plan` | `plan mode on` | read/meta | 无写/执行工具 |
| `auto` | `auto mode on` | 全部 | 自动执行 |

状态栏不显示模式图标，用文字颜色区分：manual 绿色、accept 青色、plan 黄色、auto 品红。

默认是 `manual`。审批提示出现在 composer 上方：

```text
⏸ Permission required · Bash
git status
y allow · n deny · esc cancel
```

被拒绝的工具会以 `Not run · denied` 回灌给模型，agent 继续下一轮。`Esc` 在审批提示中表示拒绝；运行中按 Ctrl+C 会取消当前 agent。

## Effort

`/effort [low|medium|high|max]` 切换，默认 `max`。它只改变 system prompt 中的推理指令，**不是 DeepSeek 原生参数**；右下角显示 `◆ max · /effort`。Mattermost 入口同样生效。

## 命令

| 命令 | 说明 |
|---|---|
| `/help` | 命令说明与快捷键（按入口能力显示） |
| `/prompt` | 查看组合后的 system prompt 与各 section |
| `/clear` | 清空对话历史与 todo 面板（不删除 Terminal scrollback） |
| `/save [title]` | 保存会话 |
| `/reload [n]` | 列出 / 恢复会话 |
| `/model [n]` | 查看 / 切换模型 |
| `/mode [mode]` | manual / accept / plan / auto |
| `/effort [level]` | low / medium / high / max |
| `/tools` | 列出工具、类别与当前模式可用性 |
| `/status` | 查看模型、模式、effort、轮次与 token |
| `/usage` | 查看用量（Mattermost） |
| `/user` | 查看用户（Mattermost） |
| `/exit` | 退出 |

## 架构

```text
src/core/                 # 零运行时依赖：不依赖 Ink/React
  agent.ts                # Agent 循环、事件流、重试预算、工具执行
  models.ts               # ModelRequest / ModelTurn / 语义消息
  events.ts               # AgentEvent 判别联合
  protocols.ts            # ModelAdapter / MessageStore / ToolExecutor
  tools/registry.ts       # 通用 Tool 元数据与执行；不携带权限模式词汇
src/app/
  adapters/
    openai-common.ts              # OpenAI wire 渲染/解析/HTTP
    chat-completions.ts           # 原生 tools，非流式
    streaming-chat-completions.ts # SSE、按 index 重组 tool_call、usage 回调
    prompt.ts                     # OpenAI adapter 共用的 PromptRegistry 入口
    mattermost-protocol.ts        # XML 文本协议 codec + prompt sections
    mattermost-model.ts           # Mattermost ModelAdapter
    mattermost-config.ts          # Mattermost AppConfig / AppState / loadConfig
  modes.ts                # 权限策略、effort、system prompt 组合
  progress.ts             # 流式浏览器桥（50ms 节流）
  prompt/registry.ts      # 可组合 PromptSection / PromptPlugin
  tools/                  # 8 个工具 + 路径围栏 + policy/approval
  session/store.ts        # schema v2 + v1 迁移
  paths.ts                # 数据目录、response.md、路径常量
  version.ts              # CodeCLI 版本
  ui/
    App.tsx               # 视图与 composer；不含命令/会话控制
    useAgentSession.ts    # Agent 会话、事件、审批、中断控制
    commands.ts           # slash command 分发
    activity.ts           # 工具活动计数与摘要
    format.ts             # 工具展示元数据与通用格式化
    mode-presentation.ts  # 模式标签/颜色（纯 UI）
src/main.tsx              # Mattermost 组合根
src/deepseek.tsx          # DeepSeek/OpenAI 兼容组合根
src/probe.tsx             # 键盘诊断
tests/                    # node:test + tsx，全部离线
```

`src/core/` 与 app 逻辑只用 Node 标准库；Ink/React 只出现在 `ui/` 和入口。本地导入遵守 NodeNext，带 `.js` 后缀。

## 测试

```bash
pnpm test        # 144 个测试，无 API key、无网络
pnpm typecheck   # tsc --noEmit（strict + noUncheckedIndexedAccess）
```

测试覆盖：Agent 事件顺序/重试/工具快照/AbortSignal、prompt 注册表、8 个工具、模式过滤与审批矩阵、会话 v1→v2 迁移、OpenAI 非流式与 SSE 重组、Mattermost XML 协议、LiveProgress、Markdown 表格、Ink 组件与双击 Enter。

## 与 Python chatcli 的差异

保留的 parity：

- 相同的 Agent 语义：事件顺序、handler-before-yield、无效响应重试、未知工具回灌、工具快照、最大轮数。
- 相同的 OpenAI 兼容 wire 格式与 Mattermost XML 协议；工具参数仍是 JSON。
- 相同的工具名、路径围栏规则与会话目录；Python 写下的 v1 会话可被 CodeCLI 读取并迁移。
- 成功回答会写入 `%APPDATA%/chat-cli/response.md`，与 Python 版一致。

有意不同的部分：

- 终端 UI 从行式 console 换成 Ink：Header、section bar、工具活动、spinner、多行输入框、todo 面板和底部状态栏。
- 发送方式从“空行发送”改为“双击 Enter”；原因是 Ink 下需要同时支持多行编辑与粘贴。
- 命令的参数形式更直接：`/model 2`、`/reload 2`，不再进入二次交互问答。
- 新增权限模式、审批、Esc 取消、SSE 流式 token 与 todo 工具。

已知限制：

- 只实现 `manual / accept / plan / auto` 四种模式；`dontAsk`、`bypassPermissions` 等危险/CI 专用模式不在本轮范围。
- 不做 alternate-screen、鼠标滚动/选择、`Ctrl+B` 后台 shell；transcript 使用 Ink `<Static>` 的终端 scrollback。
- `/effort` 是 prompt 级设置，DeepSeek 没有原生 effort 参数；token 数在服务端未返回 usage 时是估算值。
- `/clear` 只清空会话历史与 todo，无法删除 Ink `<Static>` 已写入终端的内容。
- `bash` 的路径围栏只限制 `cwd` 参数，无法阻止命令内部 `cd` 到工作区外；auto 模式会自动执行命令，需自行判断风险。
- spinner 词、Tip、颜色、机器人像素画和工具自然语言描述是视觉近似，不追求逐帧/逐字一致。
