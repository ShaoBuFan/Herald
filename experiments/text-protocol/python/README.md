# Python 最小实现（lab probe）

按 [FORMAT.md](../protocol/FORMAT.md)（v0.5）实现的最小 agent：DeepSeek + 只有 `role/content` 的 chat API。**纯标准库，零第三方依赖。**

这是实验原型，不是 Herald 的正式实现（正式技术选型见 `AGENTS.md`，目前是 TypeScript）。

## 配置 API key

两种方式，选一种。**不要把 key 写进源码，也不要提交到仓库。**

1. **环境变量**（临时，适合一次性测试）：

   ```powershell
   $env:DEEPSEEK_API_KEY = "..."
   ```

   ```bash
   export DEEPSEEK_API_KEY=...
   ```

2. **本地 `.env`**（程序启动时自动读取；已 gitignore）：

   ```sh
   cp .env.example .env      # Windows: Copy-Item .env.example .env
   # 用编辑器把 key 填进 .env
   ```

   已存在的环境变量优先，`.env` 不会覆盖它们。

临时 key 用完记得在控制台吊销。

## 运行

```sh
cd experiments/text-protocol/python

# Windows: $env:DEEPSEEK_API_KEY = "..."
export DEEPSEEK_API_KEY=...

python mini_agent.py "读一下 README.md 并用一句话总结这个项目" --workspace ..
```

`--workspace` 是工具的访问根目录（默认当前目录）；工具只接受相对路径，越出根目录会被拒绝。

可选环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 必填 | 只从环境变量读，不读写 `.env` |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | OpenAI 兼容端点 |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 模型名 |

其他参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `--workspace` | `.` | 工具的访问根目录 |
| `--max-steps` | 12 | 最大步数 |
| `--max-actions` | 4 | 单次回复最多动作数 |
| `--transcript <path>` | — | 把原始请求/回复写成 JSONL |
| `--verbose` | 关 | 每步打印模型原始回复 |

## transcript：原始消息日志

`--transcript <path>` 会把每次**发给模型的消息数组**和**模型原始回复**逐条写成 JSONL：

| `type` | 内容 |
|---|---|
| `run_start` | 任务、模型、工作区、system prompt 全文 |
| `step` | 第 N 步的 `request`（完整 messages）、`response`（模型原文）、`classification`、`usage` |
| `tool_results` | 工具执行结果（含完整输出） |
| `protocol_error` | 协议错误原因 + 回填的纠错消息 |
| `tool_error` | 参数校验失败（整批未执行） |
| `run_end` | 结束状态（final / aborted）、终答、统计 |

这就是“模型实际看到的东西”的完整记录——`request` 字段里的内容可以原样拿去复现一次请求。示例：

```powershell
python experiments\text-protocol\python\mini_agent.py "读一下 README.md 和 AGENTS.md..." `
  --workspace . `
  --transcript experiments\text-protocol\corpus\transcripts\deepseek-task-01.jsonl `
  --verbose
```

## 测试（离线，不联网）

```sh
cd experiments/text-protocol/python
python -m unittest test_mini_agent -v
```

`chat()` 在测试里被打桩，覆盖：协议判别（动作 / 终答 / 6 类协议错误）、参数校验、工作区围栏、最小循环（动作 → 观察 → 终答、协议错误重试、整批不执行、预算超限）。

## 实现了什么

- `classify()`：按 FORMAT §1.3 判别（thought 段 + fence 动作 / `final:` 终答）
- 先全量校验、再顺序执行；未知工具/参数错误 → 整批不执行，回填 tool error
- 观察消息的 `<tool_result>` 格式与固定提醒
- 协议错误回填 + 每步预算（连续 3 次终止）
- max steps、连续重复动作终止
- 统计：步数、协议错误、工具错误、调用数、token

## 明确没实现

- 流式
- transcript 落盘 / 回放
- 上下文压缩、观察的历史裁剪（只有单次观察截断）
- 多轮用户对话（一次 run 一个任务）
- thought 的展示（原样存在消息历史里，但不打印）
- 语料分析

## 已知行为差异

- FORMAT §3 说“整批校验失败时回填第几个 call 的错误”；这里回填**一个** `tool_result` 块（`status="error"`），而不是 N 个块。
- 带 `final:` 的回复里如果再次出现 `final:` 行，不会被当作新 payload（第一个 payload 起点之后的都算正文），与 FORMAT 一致。
