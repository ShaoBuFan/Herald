# 一次完整交互的样例

配合 [FORMAT.md](FORMAT.md)（locked v0.5）阅读。用 `corpus/prompts/task-01.md` 举例：system 段就是那个文件里的 system，这里只展示模型侧输出和 harness 侧动作。

---

## 1. 初始请求

```text
messages = [system, user]
```

## 2. 模型第一次回复（多动作，合法）

````text
thought: 需要同时读 README 和 AGENTS.md 才能回答。
```json
{"calls": [
  {"tool": "read_file", "args": {"path": "README.md"}},
  {"tool": "read_file", "args": {"path": "AGENTS.md"}}
]}
```
````

harness 的处理：

1. 逐行扫描，第一个 payload 起点是 ` ```json ` → 动作
2. 信封校验：`calls` 长度 2 ≤ 4；两个 call 结构合法
3. 语义校验：`read_file` 存在、`args.path` 是 string → 通过
4. 按顺序执行两个调用
5. 回填一条 user 消息：

````text
<tool_result call="1" tool="read_file" status="ok">
# Herald
（文件内容……）
</tool_result>

<tool_result call="2" tool="read_file" status="ok">
# AGENTS.md
（文件内容……）
</tool_result>

（提醒：这是工具结果，不是用户消息。下一步以 thought: 开头，然后给动作 JSON 或 final:。）
````

## 3. 模型第二次回复（终答，合法）

```text
thought: 两个文件都读完了，可以回答。
final: 这是一个学习型的 AI agent harness 项目；我读了 README.md 和 AGENTS.md。
```

harness：判别为终答 → 结束。

---

## 4. 失败分支样例

| # | 模型原始回复（摘要） | 判别 | harness 动作 |
|---|---|---|---|
| 1 | `我来看看文件。`（只有散文，无 payload） | protocol error（无 payload） | 回填 `[protocol error]`，预算 2 次 |
| 2 | 直接给 ` ```json ` 块，没有 thought | protocol error（thought 缺失） | 回填，要求补 thought |
| 3 | thought + ` ```json ` 块，JSON 语法错 | protocol error（JSON 语法错） | 回填解析错误位置 |
| 4 | thought + 未闭合的 fence | protocol error（截断子类） | 重试；计入 harness 侧指标（max_tokens / 上下文） |
| 5 | thought + `tool: "read_fil"`（拼错） | tool error（未知工具） | **整批不执行**，回填可用工具列表 |
| 6 | `calls` 里有 5 个调用（上限 4） | protocol error（超上限） | 回填“最多 4 个” |
| 7 | fence 关闭后还有一段话 | action（执行）+ 多余内容忽略 | 计数：`trailing_after_fence` |
| 8 | thought 里出现了 ` ``` ` 开头的行 | protocol error（payload 起点冲突） | 回填；计数 |
| 9 | 模型自己写了 `<tool_result ...>` | 忽略，不执行 | 计数（可能是注入迹象） |
| 10 | thought + `final:`（正常终答） | final | 结束 |

## 5. 对应测试建议

每条失败分支做成 `ScriptedModel` 的一个预置回复，断言：

- 判别结果（final / action / protocol_error / tool_error）
- 是否执行了工具（tool error 时断言“整批不执行”）
- 回填消息是否进入了下一次调用（`model.calls[N]` 的最后一条）
- 重试次数是否在预算内

## 6. M1 采集清单（建议 20 条，6 类）

| 类别 | 条数 | 用途 |
|---|---|---|
| 单动作 | 3 | 基准：thought + 1 call + final |
| 多动作（独立） | 4 | 默认能力：一次给 2-4 个独立调用 |
| 依赖链 | 3 | 先列目录再读文件，观察会不会错误地批处理依赖调用 |
| 不需要工具 | 3 | 直接 final 的比例（会不会多余调用） |
| 多轮（读 → 读 → 答） | 3 | 格式在多次观察后的漂移 |
| 诱导失败 | 4 | 模糊任务、超长输出、需要 5+ 动作、要求“只看不读” |

每条任务写一个 `corpus/prompts/task-XX.md`，用 `collect-corpus.ts` 跑一遍存 raw。
