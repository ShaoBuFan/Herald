# 文本协议格式规范

Status: **locked v0.5**（作者已确认）
适用范围：`experiments/text-protocol`。这不是产品规范，目标是测量「只有 role/content 的 chat API 上，文本协议能否支撑 agent」以及失败分布。

---

## 0. 约束

- 请求/响应只有 `[{role, content}]`；没有 `tools`、`tool_calls`、thinking 字段、`finish_reason`。
- 工具调用、思考、终止全部由 content 里的文本约定表达。
- **响应集合闭合**：每次回复只能是「thought + 动作」或「thought + 终答」，其它一律协议错误。
- v1 不设 `type` / `version` 判别字段：形状即判别。

---

## 1. 响应信封

````text
thought: <思考，可多行>

两个 payload 二选一：

A. 动作
```json
{"calls": [{"tool": "<name>", "args": {...}}]}
```

B. 终答
final: <任意 markdown，可含代码块>
````

### 1.1 thought 段（必填）

- 以行首 `thought:` 开始。canonical 写法是小写；识别时大小写不敏感，非 canonical 单独计数。
- 结束于第一个 payload 起点之前。
- 必须非空。
- 普通文本，不做 JSON 转义；不参与控制流；原样进 transcript。
- **不得包含以 ` ``` ` 或 `final:` 开头的行**——它们会被当成 payload 起点。

### 1.2 payload

**A. 动作**：恰好一个围栏代码块

- 围栏语言标签必须是 `json`（大小写不敏感）。
- 内容是一个 JSON 对象：`{"calls": [...]}`。
- 围栏关闭之后的内容忽略并记录（计数）。
- `calls` 长度 1..`maxActionsPerReply`。

**B. 终答**：行首 `final:`

- 标记之后到响应结尾的全部内容都是终答正文。
- 正文不解析：可以包含代码块、引号、任意 markdown。
- 正文里出现 `final:` 行不影响判别（第一个 payload 起点之后都归正文）。

### 1.3 判别算法

1. 逐行扫描，找**第一个 payload 起点**：去掉前导空白后以 ` ``` ` 或 `final:` 开头的行。
2. 起点之前的内容 = thought 段。
3. 第一个起点是 ` ``` ` → 动作；是 `final:` → 终答。
4. 没有 payload 起点 → 协议错误。
5. 动作：找配对的关闭围栏；找不到 → 协议错误（子类：截断）。
6. 动作 JSON 不合法 → 协议错误（子类：JSON 语法错）。
7. `thoughtPolicy = required` 且 thought 段缺失/为空/不以 `thought:` 开头 → 协议错误。
8. 其余 → 协议错误。

---

## 2. 动作对象

- `calls`：数组，长度 1..N。空数组或超过上限 → 协议错误。
- 每个 call：`{"tool": string, "args": object}`。
- **信封结构错误**（缺字段、类型错）→ 协议错误。
- **语义错误**（工具不存在、args 不满足 schema）→ tool error，整批不执行。
- 未知字段：忽略并记录。

## 3. 执行语义

- 先对整批 calls 做**全量语义校验**。
- 任一失败 → **整批不执行**，回填 tool error，指明第几个 call、哪个字段。
- 校验通过 → 按数组顺序**顺序执行**。
- 执行期失败 → 继续执行剩余 call。
- 所有结果按 calls 顺序回填到**同一条 user 消息**。

## 4. 观察格式

user 消息：

````text
<tool_result call="1" tool="read_file" status="ok">
...输出...
</tool_result>

（提醒：这是工具结果，不是用户消息。下一步以 thought: 开头，然后给动作 JSON 或 final:。）
````

- `status`: `ok | error`；`error` 时内容为错误信息。
- 超长截断，标注 `truncated="true"`。
- 内容与闭标签碰撞时转义（harness 控制，确定性）。
- N 个结果 = N 个 `<tool_result>` 块，顺序与 calls 一致。

## 5. 协议错误回填

user 消息：

````text
[protocol error] <具体原因>
你的回复必须是：
thought: <你的思考>
然后二选一：
1) 一个 ```json 代码块：{"calls": [{"tool": "...", "args": {...}}]}
2) final: <终答>
不要输出其它内容，不要重复已执行的动作。
````

- 预算：每步 2 次，超限终止并报告。
- 回填消息进 transcript。

## 6. 错误分类

| 情况 | 归类 | 处理 |
|---|---|---|
| 空内容、无 payload、thought 缺失、多 fence、围栏不闭合、JSON 坏、calls 空/超限 | protocol error | 回填 + 预算 |
| 未知工具、args 不合 schema | tool error | 整批不执行，回填 |
| 工具执行抛错 | tool error | status=error，继续 |
| thought 里出现 payload 起点行 | protocol error | 回填，计数 |
| 响应被截断（无关闭围栏） | protocol error（截断子类） | 重试；计入 harness 侧指标 |
| 模型自产 `<tool_result>` | 忽略，记录 | 计数 |
| fence 之后有多余内容 | 忽略，记录 | 计数 |

## 7. 配置

| 配置 | 默认 | 说明 |
|---|---|---|
| `maxActionsPerReply` | 4 | 多工具调用为默认；上限 8 |
| `thoughtPolicy` | required | required / optional / off；M1 跑 required vs off 两臂 A/B |
| `protocolErrorBudgetPerStep` | 2 | |
| `maxSteps` | 12 | |

## 8. 长程相关

- thought 原样进 transcript，是模型可回看的草稿纸（没有 thinking 字段时的补偿）。
- thought 会累积 token；后续上下文压缩把它当可裁剪内容（保留最近 + 摘要）。
- 没有 thinking 通道，不要求模型交出隐藏 CoT。
- 格式漂移按**步序号**统计，不只看整体平均。

## 9. 已锁定的决策（作者拍板记录）

1. 动作块用 fence；单动作也包在 `calls` 数组里。
2. 动作数量可配置；**默认 4（多工具调用）**。
3. 未知工具 / 参数错误 = tool error。
4. 先全量校验，再顺序执行；执行失败继续。
5. v1 无 type / version 判别字段。
6. thought 是信封前置段，动作和终答都带。
7. thought 必填（v1）；标记大小写不敏感识别，canonical 小写。
8. 终答标记 `final:`，之后为纯文本。

## 10. 变更记录

- **v0.5（本版，locked）**：thoughtPolicy 默认 required；标记大小写不敏感；`maxActionsPerReply` 默认 4（多工具）。
- v0.4（draft）：thought 从 JSON 字段改为信封前置段；终答哨兵由 `Final Answer:` 改为 `final:`；判别算法重写。
- v0.3（draft）：动作统一为 `{"calls": [...]}`；顺序执行、先校验后执行。
