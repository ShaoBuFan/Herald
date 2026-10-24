# 语料（corpus）

存放真实模型返回的原始文本，供离线测试 parser 与失败分类使用。

## 约定

- **原始输出不改写**。解析失败的那条同样保留，它就是最有价值的测试样本。
- 文件名：`raw/<YYYYMMDD-HHMMSS>-<model>-<tag>.json`，由采集脚本自动生成。
- 采集：`node scripts/collect-corpus.ts --messages <file> --tag <tag>`（需要 `DEEPSEEK_API_KEY`）。
- 不记录 API key；messages 里不要放敏感内容（语料会入库）。
- 建议入库：parser 的测试要能离线跑，语料就是它的输入。

## transcripts/

agent 循环的完整原始日志（JSONL）：每一步发给模型的 messages、模型原文、工具结果、判别结果、统计。
由 `python/mini_agent.py --transcript <path>` 生成，记录格式见 [`python/README.md`](../python/README.md)。

命名建议：`transcripts/<YYYYMMDD-HHMMSS>-<model>-<tag>.jsonl`。

## prompts/

一条任务一个文件，放在 `prompts/` 下。支持两种格式：

### 分段格式（推荐，好写 diff）

```text
# task-01：多动作（两个独立读取）

=== system ===
（system prompt 全文）
=== user ===
（用户任务）
```

分隔行必须独占一行，精确匹配 `=== system ===` / `=== user ===`。由 `model/prompt-file.ts` 解析。

### JSON 数组

```json
[
  { "role": "system", "content": "..." },
  { "role": "user", "content": "..." }
]
```

## 已有样例

- `prompts/task-01.md`：多动作（同时读 README 和 AGENTS.md）
- `prompts/task-02.md`：依赖链（先列目录，再读 README）
- `prompts/task-03.md`：不需要工具（直接终答）

完整交互与失败分支见 [`protocol/EXAMPLE.md`](../protocol/EXAMPLE.md)。
