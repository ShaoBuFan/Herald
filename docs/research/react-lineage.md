# ReAct 的谱系：从提示技巧到 agent 循环

调研日期：2026-09-21。本文所有事实性陈述尽量标注出处；无法验证的部分单列在末尾。

> **前传**：[`react-prehistory.md`](react-prehistory.md) 补上了本文第 11 节留下的前史缺口——ReAct 从推理线（CoT / Self-Consistency / Least-to-Most）与行动线（WebGPT / SayCan / Inner Monologue / RAG）各继承了什么、否决了什么。两文分工见该文第 8 节。

---

## 1. 基本事实

| 项目 | 内容 |
|---|---|
| 标题 | ReAct: Synergizing Reasoning and Acting in Language Models |
| 作者 | Shunyu Yao, Jeffrey Zhao, Dian Yu, Nan Du, Izhak Shafran, Karthik Narasimhan, Yuan Cao |
| 单位 | 普林斯顿大学计算机系 + Google Research Brain 团队（Yao 的工作完成于 Google 实习期间） |
| arXiv | 2210.03629（cs.CL），v1 于 2022-10-06 |
| 发表 | ICLR 2023，poster |
| 代码 | https://github.com/ysymyth/ReAct |
| 项目页 | https://react-lm.github.io |

**方法本质：纯提示，主结果不涉及权重更新。** 把"思考"作为动作空间中的一个合法动作——论文原话是一段"不影响外部环境的思考或推理轨迹"。轨迹按 `Thought → Action → Observation` 交错，直到 `finish[...]` 输出答案。

动作空间是**按环境定制的、有小类型系统的接口**，不是任意工具：

- HotpotQA / FEVER：Wikipedia API 包装，恰好三个动作——`search[entity]`、`lookup[string]`、`finish[answer]`
- ALFWorld：TextWorld 风格的可执行命令（`go to`、`take ... from`、`clean ... with` 等），外加 `think:`
- WebShop：`search[...]`、`click[...]`、`think[...]`

示例数量：HotpotQA 6 条、FEVER 3 条、ALFWorld 每类任务 3 条再组合成 6 种排列、WebShop 1～2 条。

---

## 2. 一个常被略过的事实：ReAct 在知识任务上打不过 CoT

PaLM-540B 上的主结果：

| 方法 | HotpotQA (EM) | FEVER (Acc) |
|---|---|---|
| Standard | 28.7 | 57.1 |
| CoT | **29.4** | 56.3 |
| CoT-SC | **33.4** | 60.4 |
| Act（只行动） | 25.7 | 58.9 |
| **ReAct** | 27.4 | **60.9** |
| ReAct → CoT-SC | 35.1 | 62.0 |
| CoT-SC → ReAct | 34.2 | 64.6 |
| 有监督 SotA | 67.5 | 89.5 |

**在 HotpotQA 上，纯提示的 ReAct（27.4）输给 CoT（29.4）和 CoT-SC（33.4）。** 论文自己写明了这一点。FEVER 上的领先也很小（60.9 对 60.4）。

真正的优势在决策类任务：

- ALFWorld 成功率：ReAct 71（best-of-6）对 Act 45，对训练了约 10 万条专家轨迹的 RL 基线 BUTLER 37
- WebShop 成功率：ReAct 40.0 对 Act 30.1，对模仿学习 IL 29.1

**读法**：ReAct 的价值不在"推理更强"，而在**有外部反馈的循环更强**。答案在模型脑子里时，让它直接想更好；答案在环境里时，交互的价值才显现。这个区分在后面的设计里会反复出现。

---

## 3. 消融：论文最有价值的部分

论文对 200 条轨迹做了人工标注（对与错各 50 条），比较 ReAct 与 CoT 的失败构成：

| 类别 | ReAct | CoT |
|---|---|---|
| 成功且正确 | 94% | 86% |
| 成功但含幻觉 | 6% | 14% |
| 失败原因：推理错误 | 47% | 16% |
| 失败原因：检索结果错误 | 23% | — |
| 失败原因：幻觉 | **0%** | **56%** |

三个结论：

1. **对 CoT**：CoT 失败的 56% 是幻觉，ReAct 是 0%——因为它被迫锚定在检索结果上。代价是交错格式限制了推理灵活性，推理错误率反而更高（47% 对 16%）。论文给出的补救是混合策略：需要接地时用 ReAct，拿不准时回退 CoT-SC。
2. **对 Act-only**：ReAct 在两个任务上都优于 Act，说明推理对行动有引导价值。没有思考时，Act "无法正确地把目标拆成子目标，或者跟踪不到当前环境状态"。
3. **对 ReAct-IM**：这是最能说明问题的一组对照——它保持了行动和交错，只把思考限制成固定形式，结果 ALFWorld 从 71 掉到 53。**自由形式的推理确实有价值。**

还有一组规模消融值得注意：在 PaLM-8B/62B 上，提示式 ReAct **是四种方法里最差的**——小模型很难从上下文示例里同时学会推理和行动。交错只在很大规模上、或经过微调之后才划算。

---

## 4. 作者自己承认的局限

- **循环重复是明确承认的**，原文：ReAct 有一种高频错误模式，"模型重复生成之前的思考和行动"，他们把它算作推理错误，并归因于"次优的贪心解码"，提出的未来工作是 **beam search**。这是今天所有 `max_steps` 的祖先。
- **检索结果无效**是第二条失败通道（占失败 23%）。
- **上下文长度**：复杂任务的大动作空间需要很多示例，"很容易超出上下文学习的输入长度上限"。

需要澄清一点：**"推理轨迹不可靠"不是这篇论文说的。** 论文的主张相反——它的轨迹幻觉率为 0，被称为"更接地、更事实驱动、更可信"。论文承认的是结构约束削弱了推理灵活性。

---

## 5. 批评：机制而非数字受到挑战

最重要的批评来自 Verma、Bhambri & Kambhampati，arXiv:2405.13966（2024-05，后以《Do Think Tags Really Help LLMs Plan?》发表于 TMLR）：

- 在 ALFWorld 上跨 6 类问题、约 14 种提示变体测试了 GPT-3.5-Turbo / GPT-3.5-Instruct / GPT-4 / Claude-Opus
- 结论：性能**几乎不受交错推理轨迹及其内容的影响**。事后追加的"事后诸葛亮"式提示，甚至占位文本，效果与真实推理轨迹相当
- 性能实际由**输入示例与查询的相似度**驱动，即近似检索，而不是推理
- 作者自陈局限：实验只限于 ALFWorld 一个常识规划域

需要区分的是：**这个批评攻击的是"文字化的推理轨迹"，不是"与环境交错的循环"。** 后者才是真正存活下来的部分。

未找到针对主结果（ALFWorld / WebShop / HotpotQA 数字）的严格复现失败。一个结构性原因：关键后端 PaLM-540B 和 text-davinci-002 从未公开提供或已下线，外部无法复现原配置。

---

## 6. 框架化：论文变成了类名

LangChain 的 `create_react_agent` 是这个转折的标本。三个机械决策定义了"框架版 ReAct"：

```python
llm_with_stop = llm.bind(stop=["\nObservation"])
agent = (RunnablePassthrough.assign(
             agent_scratchpad=lambda x: format_log_to_str(x["intermediate_steps"]))
         | prompt | llm_with_stop | ReActSingleInputOutputParser())
```

1. **`stop=["\nObservation"]`** —— 用停止序列实现论文所假设的"harness 在动作后打断生成"
2. **`agent_scratchpad`** —— 论文的 Thought/Action/Observation 历史每轮重新渲染成字符串，推理轨迹从"模型拥有的 token 流"降格为"框架格式化的字符串字段"
3. **`ReActSingleInputOutputParser`** —— 正则解析 `Action:` / `Action Input:`。于是解析器成为失败面，这才是 `handle_parsing_errors` 和 `max_iterations` 成为一等参数的原因

**框架版本丢掉了什么**：

- **论文的实验被丢掉了，只留下胜出的格式。** 论文的贡献是一次消融对照（CoT / Act / ReAct），框架保留格式、丢弃对照。"ReAct" 从此成了 "agent" 的同义词
- **精心挑选的示例被丢掉了。** 论文 ALFWorld 的成绩来自一两个上下文示例；框架版发的是零示例的通用模板，是明显更弱的产物
- **有类型的动作空间被压扁了** 成 `Action: one of [tool_names]` 加一个未经校验的字符串
- **可解释性作为一等目标被丢掉了**——论文把"提升人类可解释性与可信度"列为成果，框架版里轨迹只是解析目标

---

## 7. 2023 年的泡沫：失败机制

AutoGPT（2023-03-30）和 BabyAGI（2023-03-28）证明了循环本身不能扩展。当时的批评（如 Jina AI 的《Auto-GPT Unmasked》，2023-04）算过成本：每步约消耗满 8K 上下文，约 $0.288/步，小任务约 50 步，**单任务约 $14.40**。

失败机制拆开看是五条，全部与循环格式无关：

1. **没有非模型意见的终止信号。** "任务完成了吗"由同一个想继续干的模型回答。目标模糊时没有可度量的谓词，默认答案就是"还需要更多工作"
2. **上下文窗口 = 记忆 = 工作集。** 相关内容滚出窗口后，agent 无法知道某件事已经做过。**死循环是记忆 bug，不是推理 bug**
3. **错误累积。** 每步有非零失败概率，50 步后成功概率趋近于零
4. **自我反馈没有真值。** agent 批评自己的输出，没有 oracle，错误被强化而非纠正
5. **成本随上下文每步二次增长**

Karpathy 在 2023-04-02 把跑偏归因于**有限的上下文窗口**。

编程 agent 之所以活下来，正是因为这五条里的第 1、4 条被**外部锚点**解决了：跑测试、读文件、看 git diff，真值来自环境而不来自模型自评。

---

## 8. 协议转换：文本 ReAct → 原生工具调用

| 时间 | 事件 |
|---|---|
| 2023-06-13 | OpenAI 函数调用：`functions` / `function_call`，gpt-4-0613 与 gpt-3.5-turbo-0613 经微调后能输出符合签名的 JSON |
| 2023-11-06 | DevDay：`functions`→`tools`、`function_call`→`tool_choice`、`role:"function"`→`role:"tool"`、引入 `tool_call_id`、**并行工具调用** |
| 2024 | Anthropic 的 `tool_use` 内容块、Gemini 函数声明、开源权重模型内置工具调用模板 |
| 2024-11-25 | MCP 发布 |

**得到**：没有解析面（`ReActSingleInputOutputParser` 之类彻底消失）、格式可训练（格式遵循不再与任务求解争抢注意力）、类型化参数与 schema 校验、一轮内并行调用、`tool_call_id` 提供精确的请求/结果配对。这些是今天 coding agent 里并行读文件、并行 grep 的来源。

**失去**：**可见的推理轨迹**。ReAct 里 Thought 是强制的，因为 harness 需要它是合理的自然语言；工具调用里它是可选的，而且经常不存在。一个工具调用型 agent 可以永远只发工具调用，你没有任何窗口看到它为什么这么做。Anthropic 自己的多智能体研究和 ACI 相关文献都描述了这个调试能力的退化。

还有一个更微妙的概念损失：**ReAct 把"思考"定义为不改变环境的动作**。在纯工具 schema 里没有地方放这个区分——工具按定义就是有副作用的或查询性的。"协同"这个论点（推理塑造行动、观察重塑推理）于是从协议属性退化成模型的隐含属性。

**一个反转**：推理后来回来了，但不是以提示的形式。o1（2024-09）、Claude 3.7 thinking（2025-02）、Claude 4 的工具使用间交错思考，恢复了工具调用之间的显式推理通道——结构上就是 ReAct 的 Thought 转世。但有两点根本不同：它是**模型能力**而非提示技巧（不写示例，只开模式），而且它**往往不完全可见**（被摘要、加密或签名）。

---

## 9. 判决：名字活下来了，机制被替换了两次

**第一次被原生工具调用杀掉**——`Action:` / `Observation:` 的文本语法不再必要。
**第二次被训练出的思考通道杀掉**——`Thought:` 的文本语法不再必要。

**仍然承载负载的部分**（真正的继承）：

1. **把模型认知与环境反馈交错在一个循环里**——这已经是"agent"的定义本身。Anthropic 的原话："LLM 在循环中使用工具、依据环境反馈行动"
2. **以环境真值作为纠错信号**——ReAct 的 `Observation` 变成了"跑测试、读退出码"
3. **思考是不改变环境的动作**——thinking block 完整保留了这个区分，且这是最完整的一条概念继承，也最不常被归功于 ReAct
4. **少样本示例作为行为规范**——角色存活了（必须向模型展示协议），介质从上下文示例变成了系统提示 + 工具描述
5. **agent 是有边界、有退出条件的循环**——这一条其实是对 2023 年无界循环的**修正**，不是从 ReAct 继承的

**已被内化、机制消失的部分**：

- **工具使用属于权重，不属于提示**——Toolformer（2023-02）提出论点，原生函数调用（2023-06）实现，2024 后的轨迹 RL 完善。Toolformer 的产物（自监督标注、损失过滤、内联 API 文本）死掉了，论点成了整个行业
- **推理轨迹**从提示输出迁移到受训练、由 API 中介的通道
- **ReAct 这个名字**变成了"任意 agent 循环"的意思，包括不含任何 ReAct 内容的循环

**纯脚手架、已丢弃**：文本线格式、停止序列与正则解析器及其伴生 bug、框架里的零示例通用 ReAct 提示、无界自治与自判定完成、把规划器做成独立 agent、以及论文的评测框架本身。

**一句话判决**：*ReAct 的提示技巧——少样本文本示例加解析式的 Thought/Action/Observation 契约——在任何一个严肃的 coding agent 里都已经死了；活下来的是架构，而且比格式更有价值：**一个把模型认知与真实环境反馈交错起来的有界循环，其中推理被明确地与改变世界的行动区分开，且真值信号由环境而非模型提供。***

---

## 10. 对 Herald 的直接含义

1. **循环是便宜的部分。** 2023 年杀死 agent 的是终止条件、记忆、成本、错误累积——全是 harness 问题，没有一个是循环格式问题。
2. **抽象已经被改名了。** LangChain 2026 年的文档写的是 "**Agent = Model + Harness**"，harness 指"循环周围的一切：提示、工具，以及任何塑造模型行为的中间件"。循环被当作既定前提，harness 才是产品。
3. **Anthropic 自己的 agent 文档从头到尾没提过 ReAct**，它强调工具设计和真值反馈。
4. **你要写的那个 `while` 循环，控制流和 ReAct 一样**：`Thought → Action → Observation` 对比现代形态 `call model → 有工具调用就执行并回填 → 否则退出`。区别在于思考不再是协议元素、动作是结构化类型化的、循环住在 harness 代码里且有显式退出条件。

---

## 11. 未验证与待补

- **前史（ReAct 继承了什么）已由 [`react-prehistory.md`](react-prehistory.md) 补上**（2026-09-21）。该文覆盖 CoT、Self-Consistency、Least-to-Most、Self-Ask、RAG、Toolformer、WebGPT、SayCan、Inner Monologue、MRKL，并从 ReAct 正文的 Related Work 落实了直接继承关系。本文不再展开。
- OpenAI 函数调用与 DevDay 的官方页面（openai.com）在调研环境中不可达，时间与内容来自搜索覆盖，未读原文。
- Codex CLI 的内部循环结构、Cursor / Composer 的内部实现、社区流传的 Claude Code"主循环"逆向分析，均**未获验证**，本文刻意不引用其具体细节。
- AutoGPT / BabyAGI 的仓库与提示文件不可达，"AutoGPT 不是严格意义的 ReAct"这一判断来自二手描述。
- SWE-bench 及 ACI 相关论文（arXiv:2405.15793）未取原文。
