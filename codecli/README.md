# CodeCLI

TypeScript + React Ink 版的 chatcli。**当前活跃的 TS/Ink 参考实现**；Python [`../chatcli`](../chatcli/) 保留为 legacy 对照实现。

## 与 Herald 的关系

- Herald 主体仍是由作者自写核心逻辑的学习型 harness，见根目录 [`AGENTS.md`](../AGENTS.md)。
- CodeCLI 是作者明确授权 AI 全量移植的参考实现，用于快速建立可运行的 TS/Ink 对照基线；它不属于 Herald 主体内核，也不替代作者的复述验收。
- Python chatcli 继续保留：它更接近“每层手写”的教学版本，CodeCLI 则用于对照“同一套协议在 React Ink 下如何组织 UI 与流式事件”。

## 运行

需要 Node >= 20（开发环境实测 Node 24）和 pnpm。

```bash
cd codecli
pnpm install
pnpm dev:deepseek      # DeepSeek / OpenAI 兼容入口（原生 tools）
pnpm dev               # Mattermost 入口（XML 文本协议）
```

### DeepSeek 入口

配置放在 `codecli/.env`（或仓库根目录 `.env`）；已有环境变量优先：

```bash
cp .env.example .env
# 填入 DEEPSEEK_API_KEY
```

可选变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 无 | 必填 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` | OpenAI 兼容地址 |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 模型名 |

### Mattermost 入口

与 Python 版共用配置位置：`%APPDATA%/chat-cli/data/config.json`（Linux 为 `~/.local/share/chat-cli/data/config.json`）。也可以先把配置放到项目内 `data/config.json`，首次启动会复制过去。`data/prompt.json` 可选，只放应用层人设与任务说明；XML 协议内置于 Mattermost 适配器。

> 配置里包含 token，`data/` 已被 gitignore；不要提交。

## 交互

| 按键 | 行为 |
|---|---|
| Enter | 插入换行 |
| 双击 Enter | 发送 |
| Shift+Enter / Alt+Enter / Ctrl+J | 插入换行 |
| Ctrl+C | 退出 |

部分终端（Git Bash/MinTTY、某些 VS Code 终端）不区分 Enter 与 Shift+Enter，所以默认发送方式是双击 Enter。`pnpm probe` 可查看当前终端实际上报的按键。

粘贴文本会清理 bracketed-paste 标记、ANSI 转义、CRLF、Tab 和 C0 控制字符，再按行渲染。

## 命令

| 命令 | 说明 |
|---|---|
| `/help` | 命令说明（按入口能力显示） |
| `/prompt` | 查看组合后的 system prompt 与各 section |
| `/clear` | 清空对话历史（不删除 Terminal scrollback） |
| `/save [title]` | 保存会话 |
| `/reload [n]` | 列出 / 恢复会话 |
| `/model [n]` | 查看 / 切换模型（Mattermost） |
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
  config.ts request.ts errors.ts
  stores/memory.ts
  tools/registry.ts
src/app/
  adapters/
    openai-common.ts              # OpenAI wire 渲染/解析/HTTP
    chat-completions.ts           # 原生 tools，非流式
    streaming-chat-completions.ts # SSE、按 index 重组 tool_call
    mattermost-protocol.ts        # XML 文本协议 codec + prompt sections
    mattermost-model.ts           # Mattermost ModelAdapter
  prompt/registry.ts      # 可组合 PromptSection / PromptPlugin
  tools/                  # read/write/list/search + 路径围栏
  session/store.ts        # schema v2 + v1 迁移
  config.ts               # Mattermost 配置、AppState、数据路径
  ui/                     # Ink 组件与输入处理
src/main.tsx              # Mattermost 组合根
src/deepseek.tsx          # DeepSeek/OpenAI 兼容组合根
src/probe.tsx             # 键盘诊断
tests/                    # node:test + tsx，全部离线
```

`src/core/` 与 app 逻辑只用 Node 标准库；Ink/React 只出现在 `ui/` 和入口。本地导入遵守 NodeNext，带 `.js` 后缀。

## 测试

```bash
pnpm test        # 111 个测试，无 API key、无网络
pnpm typecheck   # tsc --noEmit（strict + noUncheckedIndexedAccess）
```

测试覆盖：Agent 事件顺序/重试/工具快照、prompt 注册表、文件工具路径围栏、会话 v1→v2 迁移、OpenAI 非流式与 SSE 重组、Mattermost XML 协议、Ink 组件与双击 Enter。

## 与 Python chatcli 的差异

保留的 parity：

- 相同的 Agent 语义：事件顺序、handler-before-yield、无效响应重试、未知工具回灌、工具快照、最大轮数。
- 相同的 OpenAI 兼容 wire 格式与 Mattermost XML 协议；工具参数仍是 JSON。
- 相同的工具名、路径围栏规则与会话目录；Python 写下的 v1 会话可被 CodeCLI 读取并迁移。
- 成功回答会写入 `%APPDATA%/chat-cli/response.md`，与 Python 版一致。

有意不同的部分：

- 终端 UI 从行式 console 换成 Ink：Welcome 面板、静态 transcript、spinner、多行输入框、工具卡片。
- 发送方式从“空行发送”改为“双击 Enter”；原因是 Ink 下需要同时支持多行编辑与粘贴。
- 命令的参数形式更直接：`/model 2`、`/reload 2`，不再进入二次交互问答。

已知限制：

- `/clear` 只清空会话历史，无法删除 Ink `<Static>` 已写入终端的内容。
- Mattermost 适配器沿用 Python 的同步请求语义（等待完整响应），没有逐字流式输出。
- 当前终端若不支持 Shift+Enter 区分，需要双击 Enter 发送；这是终端协议限制，不是应用层 bug。
