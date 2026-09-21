# ReAct 之前：推理线与行动线的分头演进

调研日期：2026-09-21。本文补的是 [`react-lineage.md`](react-lineage.md) 第 11 节留下的前史缺口——ReAct 自己继承了谁。

与那篇的差别在于证据层级：本文的关键继承关系来自 **ReAct v3 正文与参考文献表**，其余各篇的定量结果来自各自 PDF 正文。

**版本说明（2026-09-21 更新）**：本文初版只依赖 arXiv 摘要页；随后取得四篇 PDF 正文（`docs/ref/`），本文据此做了三类修正——补入 SayCan 的精确公式与消融数字、补入 WebGPT 的完整动作空间、**纠正了初版「ReAct 未引 Scratchpads」的错误结论**。第 9 节逐条标注了当前的证据层级。

---

## 0. 结论速览

| 线索 | 代表工作 | 首次提交 | 「思考」住在哪 | 与 ReAct 的关系 |
|---|---|---|---|---|
| 中间步骤 | Scratchpads (2112.00114) | 2021-11 | 模型输出（**经微调**） | **确认被引**（初版误判为未引） |
| 推理 | CoT (2201.11903) | 2022-01 | 模型输出（纯提示） | **直接继承**，被当成要修的对象 |
| 采样 | Self-Consistency (2203.11171) | 2022-03 | 模型输出 × n 条路径 | **被改掉**（ReAct 只跑一条） |
| 分解 | Least-to-Most (2205.10625) | 2022-05 | 模型输出（两阶段） | 平行，ReAct 只列为跟进工作 |
| 中间步骤 | PAL (2211.10435) | 2022-11 | 模型写代码，解释器算 | 事后：ReAct 的「行动」的另一种接法 |
| 检索 | RAG (2005.11401) | 2020-05 | **不在模型里**，检索器决定 | 血缘远；决策权归属相反 |
| 动作 | WebGPT (2112.09332) | 2021-12 | 无显式思考通道 | **被改掉**：训练 → 提示 |
| 动作 | SayCan (2204.01691) | 2022-04 | 无；技能价值函数过滤动作 | **被引**；世界接地由「当前场景有什么」换成「学出来的可行性」 |
| 思考+反馈 | Inner Monologue (2207.05608) | 2022-07 | 环境反馈转成语言 | **ReAct 自己承认的最近前作** |
| 工具 | Toolformer (2302.04761) | 2023-02 | 权重（自监督训练） | 晚 ReAct 一年，反向路线 |

六条判决：

1. **ReAct 的思考侧是 CoT，动作侧是 WebGPT 与 SayCan。** 它自己在前言里就是这么分的：一边是「reasoning... e.g. chain-of-thought prompting」，一边是「acting... e.g. action plan generation」。ReAct 的贡献不是发明这两侧，而是把两侧接进同一个循环。
2. **ReAct 明确承认 Inner Monologue 是最接近的前作，但它对 IM 的概括是不完整的。** ReAct 说 IM 的独白「limited to observations of the environment state」，但 IM 正文里有第三类反馈 **Active Scene Description**——LLM 主动提问、拿回非结构化答案。这个概括遗漏了它。ReAct 更站得住的差别是：**IM 没有把思考做成动作空间里的一等公民**，而 ReAct 把它显式定义并对固定形式做了消融。详见 §4.3。
3. **WebGPT → ReAct 的分叉不在「训练 vs 提示」这个表面标签上，而在动作空间的复杂度。** WebGPT 要训，是因为它的动作空间大（浏览、引用、作答）且需要人类偏好信号；ReAct 敢只提示，是因为在知识密集任务上它把动作空间压到三个（`search` / `lookup` / `finish`）。ReAct 自己用一句话点破了这层关系。
4. **ReAct 的微调实验比它的提示实验更值得记。** 3000 条自举轨迹微调后，8B 微调 ReAct 打得过所有 62B 提示方法。这是「工具使用属于权重，不属于提示」这条判词在 ReAct 论文内部的证据——而 [`react-lineage.md`](react-lineage.md) 目前把它归给了 2023-06 之后的原生函数调用。
5. **Self-Consistency 那条路在 agent 里断了。** CoT-SC 要把同一条问题采样几十条路径投票（论文默认 40 条）；agent 每步都有副作用，采样几十条带副作用的轨迹在语义上就不成立。ReAct 只在「无副作用的推理」这一侧借用 CoT-SC，动作侧永远只跑一条。
6. **LLM 与世界接地缺一不可，SayCan 的消融把这件事量了出来。** 去掉 LLM，规划成功率 **0%**；去掉世界接地，84% → **67%**。这直接对应今天 harness 的两半——模型负责「做什么有意义」，工具与环境负责「什么是真的」。只优化其中一半都是白费。

---

## 1. ReAct 的直接继承

来源：ReAct v3 正文 Related Work 与 Introduction，另加参考文献表。引语逐字取自 PDF（`docs/ref/2210.03629v3.pdf`），与 [ar5iv 抓取版](https://ar5iv.labs.arxiv.org/html/2210.03629) 交叉核对一致。

版本核对：ReAct 于 **2022-10-06** 提交 v1，v3（2023-03-10）的 Comments 字段写明「v3 is the ICLR camera ready version」，ICLR 2023 归属由此确认（[摘要页](https://arxiv.org/abs/2210.03629)）。

### 参考文献表核实（v3 PDF，`docs/ref/2210.03629v3.pdf`）

上一轮我只能确认「正文按名讨论」，编号给不出。**现已读到 ReAct v3 的完整 References 表**，逐条核对如下：

| 被引文献 | ReAct 文献表里的条目 | 是否被引 |
|---|---|---|
| Ahn et al., SayCan | Do as i can, not as i say: Grounding language in robotic affordances, 2022. arXiv:2204.01691 | **确认** |
| Huang et al., Inner Monologue | Inner monologue: Embodied reasoning through planning with language models, 2022b. arXiv:2207.05608 | **确认** |
| Kojima et al., Zero-shot CoT | Large language models are zero-shot reasoners, 2022. arXiv:2205.11916 | **确认** |
| Lewis et al., RAG | Retrieval-augmented generation for knowledge-intensive nlp tasks. NeurIPS 33:9459–9474, 2020 | **确认** |
| Nakano et al., WebGPT | Webgpt: Browser-assisted question-answering with human feedback, 2021. arXiv:2112.09332 | **确认** |
| Nye et al., Scratchpads | Show your work: Scratchpads for intermediate computation with language models, 2021. arXiv:2112.00114 | **确认**（初版结论错误） |
| Wang et al., Self-Consistency | Self-consistency improves chain of thought reasoning in language models, 2022a. arXiv:2203.11171 | **确认** |
| Wang et al., Rationale-augmented ensembles | Rationale-augmented ensembles in language models, 2022b. arXiv:2207.00747 | **确认** |
| Wei et al., CoT | Chain of thought prompting elicits reasoning in large language models, 2022. arXiv:2201.11903 | **确认** |
| Zelikman et al., STaR | Star: Bootstrapping reasoning with reasoning, 2022. arXiv:2203.14465 | **确认**（微调那一节的来源） |
| Zhou et al., Least-to-Most | Least-to-most prompting enables complex reasoning in large language models, 2022. arXiv:2205.10625 | **确认** |
| Creswell & Shanahan | Faithful reasoning using large language models, 2022. arXiv:2208.14271 | 确认 |
| Creswell et al. | Selection-inference: Exploiting large language models for interpretable logical reasoning, 2022. arXiv:2205.09712 | 确认 |
| Lazaridou et al. | Internet-augmented language models through few-shot prompting for open-domain QA, 2022. arXiv:2203.05115 | 确认 |
| Shuster et al. | Language models that seek for knowledge: Modular search & generation, 2022a | 确认 |
| **Toolformer** | — | **确认未引**（ReAct 提交于 2022-10，Toolformer 发布于 2023-02，不可能被引） |
| **PAL** | — | **确认未引**（同上，PAL 为 2022-11） |

两点结论：

1. **推理侧的清单比上一轮写的多一个成员：zero-shot CoT（Kojima et al., arXiv:2205.11916）。** 这是上一轮明确记为「仍然缺的一块」，现在补齐。
2. **Scratchpads 确实被引。** 初版写「概念前身，ReAct 未引」是错的——那个判断来自 ar5iv 抓取在 Related Work 之后被截断，我据此做了未引的推断，属于从缺失证据推出结论。这条已修正。

### 对自己谱系的定位

前言把两条线并列摆开：

> 「their abilities for reasoning (e.g. chain-of-thought prompting) and acting (e.g. action plan generation) have primarily been studied as separate topics」

Related Work 第一句确认推理侧的直系：

> 「Perhaps the most well-known work of using LLMs for reasoning is Chain-of-Thought (CoT), which reveals the ability of LLMs to formulate their own "thinking procedure" for problem solving. Several follow-up works have since been performed, including least-to-most prompting for solving complicated tasks, zero-shot-CoT, and reasoning with self-consistency」

**这是 ReAct 自己划的推理线清单：CoT → least-to-most / zero-shot-CoT / self-consistency。** 上一轮文档第 11 节想补的正是这条线，现在可以按 ReAct 自己的排序来写。

### 对 WebGPT 的定位：把训练换成提示

ReAct 在构造 Act-only 基线时这样描述它：

> 「Acting-only prompt (Act), which removes thoughts in ReAct trajectories, **loosely resembling how WebGPT interacts with the Internet to answer questions, though it operates on a different task and action space, and uses imitation and reinforcement learning instead of prompting.**」

加粗部分是整篇文档里最有价值的一句话。它说明 ReAct 清楚知道自己和 WebGPT 的差别有两层：任务/动作空间不同，训练方式不同。二手资料通常只讲第二层（提示 vs 训练），漏掉第一层。

### 对 Inner Monologue：承认最近，然后切分差别

> 「To our knowledge, ReAct is the first demonstration of combined reasoning and action using an LLM applied to an interactive environment within a closed-loop system. Perhaps the closest prior work is Inner Monologue (IM)... However, **IM's "inner monologue" is limited to observations of the environment state and what needs to be completed by the agent for the goal to be satisfied.** In contrast, the reasoning traces in ReAct for decision making is flexible and sparse, allowing diverse reasoning types to be induced for different tasks.」

这里 ReAct 划的分界线是**思考的表达力**：IM 的独白是环境状态的复述，ReAct 的思考是可自由形式的。它还用 ReAct-IM 消融把这条线量了出来（ALFWorld 71 vs 53，见 [`react-lineage.md`](react-lineage.md) 第 3 节）。

**但这个概括需要修正。** 读过 IM 正文后（§4.3）：IM 的第三类反馈 Active Scene Description 允许「LLM 主动提问、拿回非结构化答案」，且它有一节专门记录自发涌现的重规划行为。ReAct 描述的是 IM 的被动反馈那一半。两条论断的全部证据见 §4.3。

### 两项被忽略的自陈

**其一，ReAct 自己做过微调。** 正文 Section 3.2：

> 「we consider a bootstraping approach similar to Zelikman et al. 2022, using 3,000 trajectories with correct answers generated by ReAct to finetune smaller language models (PaLM-8/62B)」

结果（Section 3.3）：微调后 ReAct 是四种方法中最好的，PaLM-8B 微调的 ReAct 超过所有 PaLM-62B 提示方法，PaLM-62B 微调的 ReAct 超过所有 540B 提示方法。**「提示式 ReAct」是论文的主结果，但不是论文的终点。**

**其二，思考轨迹是可写的人机接口。** 特点是「Human aligned and controllable」：

> 「humans can also control or correct the agent behavior on the go by **thought editing**」

在轨迹中间改写思考就能改变后续行为。这是「模型认知」被提升为一等可操作对象的最早明确表述之一。

### 一个设计细节值得抄：思考的密度是分任务的

**仅在知识密集任务上**，ReAct 的动作空间是三个（`search` / `lookup` / `finish`），示例数与思考密度如下：

| 任务 | 示例数 | 思考密度 | 测试规模 |
|---|---|---|---|
| HotpotQA | 6 | 密集（每步交替 thought-action-observation） | — |
| FEVER | 3 | 密集 | — |
| ALFWorld | 每类 3 条，排列组合成 6 个提示 | **稀疏**（只在关键位置出现） | 134 个未见游戏 |
| WebShop | 1–2 | 稀疏 | 500 条测试指令 |

决策类任务（ALFWorld / WebShop）的动作空间不是这三个，而是环境原生的动作（`go to`、`take`、`choose`、`buy` 等）。**所以「ReAct 的动作空间很小」这个说法只对知识类任务成立**，第 5.1 节的推论也只在那一侧成立。真正跨任务不变的是**思考与动作的区分**，不是动作空间的规模。

ReAct 的原话是「we let the language model decide the asynchronous occurrence of thoughts and actions for itself」。**推理任务强制交错，决策任务交给模型自己决定。** 这个「同一机制、两种密度」的做法与 [`react-lineage.md`](react-lineage.md) 第 8 节说的「思考通道时有时无」是同一件事的正面表述。

HotpotQA 与 FEVER 的示例数是 6 和 3，且 ReAct 注明「more examples do not improve performance」。

---

## 2. 推理线：CoT 与它的后代

### 2.1 Scratchpads —— 中间步骤的最早形态（arXiv:2112.00114）

Nye et al.，2021-11-30 提交（[摘要页](https://arxiv.org/abs/2112.00114)）。

做法是**训练** transformer 把中间计算步骤吐进一个「scratchpad」，任务覆盖从长加法到执行任意程序。摘要是这么说的：「we **train** transformers to perform multi-step computations by asking them to emit intermediate computation steps into a "scratchpad"」。

关键事实：**它的中间步骤是训练出来的，不是提示出来的。** 这一点让它与 CoT 有了性质差别，尽管「让模型把中间过程写出来」这个想法更早出现在这里。它是 CoT 的概念前身，**不是**方法前身。

**修正**：初版本文写「ReAct 未引用它」，那是错的。ReAct v3 的参考文献表里有完整条目（arXiv:2112.00114）。当时的判断是在 ar5iv 抓取被截断后做出的，属于从「没看到」推出「不存在」——这类推断不该写进文档。

### 2.2 Chain-of-Thought —— ReAct 思考侧的直接来源（arXiv:2201.11903）

Wei et al.，2022-01-28 提交，v6 于 2023-01-10（[摘要页](https://arxiv.org/abs/2201.11903)）。

纯提示：「a few chain of thought demonstrations are provided as exemplars in prompting」。最常被引的数字：**540B 模型 + 8 条 CoT 示例，在 GSM8K 上达到 SOTA，超过带 verifier 的微调 GPT-3。**

**涌现的临界点（正文核对，`docs/ref/2201.11903v6.pdf`）**：

> 「chain-of-thought prompting is an emergent ability of model scale. That is, chain-of-thought prompting **does not positively impact performance for small models, and only yields performance gains when used with models of ∼100B parameters.** We qualitatively found that models of smaller scale produced **fluent but illogical chains of thought**, leading to lower performance than standard prompting.」

「fluent but illogical」这个描述值得记住——**小模型会生成读起来很顺但没有逻辑的推理链，于是比不推理更差。** 这是「涌现」的具体机制，不是一句玄学。文中还指出提升幅度与题目难度相关：GSM8K（基线最低）上最大模型的表现翻倍以上，而 SingleOp（只需一步）几乎没收益。

两个容易记错的地方：

- 它的成果不是「推理更强」这种笼统说法，而是**在足够大的模型上涌现**——约 100B 以下用 CoT 会更差。这条在 ReAct 里被复现了：PaLM-8/62B 上提示式 ReAct 是四种方法中最差的。
- CoT 是纯提示，参数不动。它把推理的责任放在**模型自身能力 + 提示构造**上，harness 不参与。

ReAct 对 CoT 的批评用词很硬：「this "chain-of-thought" reasoning is a static black box, in that the model uses its own internal representations to generate thoughts and is **not grounded in the external world**」。

### 2.3 Self-Consistency —— 被 agent 放弃的那条（arXiv:2203.11171）

Wang et al.，2022-03-21 提交，ICLR 2023（[摘要页](https://arxiv.org/abs/2203.11171)，Comments 明写「Published at ICLR 2023」）。

改动很小但收益很大：把 CoT 的贪心解码换成「采样多条推理路径，边缘化后取最一致的答案」。相对 CoT 的提升幅度（摘要原文）：

| benchmark | 提升 |
|---|---|
| GSM8K | +17.9% |
| SVAMP | +11.0% |
| AQuA | +12.2% |
| StrategyQA | +6.4% |
| ARC-challenge | +3.9% |

**采样参数（正文核对，`docs/ref/2203.11171v4.pdf` Section 3.1）**：

> 「for UL2-20B and LaMDA-137B we applied temperature sampling with **T = 0.5** and truncated at the top-k (**k = 40**)... for PaLM-540B we applied **T = 0.7, k = 40**, and for GPT-3 we use **T = 0.7 without top-k truncation**」

主结果的口径是 **10 次运行、每次独立采样 40 条输出**（Section 3.2：「averaged over 10 runs, where we sampled **40 outputs** independently from the decoder in each run」）。

**修正**：初版本文写「ReAct 里对应的是 CoT-SC 基线：采样 21 条、temperature 0.7」。这个 **21 条是 ReAct 自己为节省算力设的**（ReAct §3.2），**不是 Self-Consistency 论文的设置**，原文是 40 条。写成本文时我把它当成了后者，属于把 A 论文的参数记到 B 论文头上。

据 Self-Consistency 自己的消融（Figure 2，采样数取 1/5/10/20/40），**采样数越多越好，但边际收益递减**——所以 ReAct 用 21 条而非 40 条是合理的折中，只是这个折中是 ReAct 做的，不是原论文的默认。

**一块值得单独记的发现（Section 3.3）**：Self-Consistency 不只是「在 CoT 之上再加分」，它还能**救回 CoT 反而有害的那些任务**。原文：

> 「For some tasks (e.g., ANLI-R1, e-SNLI, RTE), adding chain-of-thought **does hurt performance** compared to standard prompting, but self-consistency is able to robustly boost the performance and **outperform standard prompting**」

| 任务 | Standard | CoT | Self-Consistency |
|---|---|---|---|
| ANLI-R1 | 69.1 | 68.8 | **78.5** |
| e-SNLI | 85.8 | 81.0 | **88.4** |
| RTE | 84.8 | 79.1 | **86.3** |

**这张表的意义**：CoT 的「有时反而更差」不是可以绕过的边角问题，而 Self-Consistency 对它有效。这与 ReAct 那条批评（CoT 是 static black box）不冲突——Self-Consistency 修的是**采样的随机性**，不是**缺少环境接地**。两类缺陷，两种修法。

顺带一处交叉印证：该表里 HotpotQA 的 CoT-prompting 是 **28.9 EM**，Self-Consistency **33.8 EM**，而 ReAct 论文表 1 的 CoT 是 **29.4**、CoT-SC 是 **33.4**。两篇论文数字接近但不等，因为 ReAct 用的是 21 条采样而非 40 条，且复现口径不同。**引用这两个数字时不要混用。**

**为什么 agent 循环里没有内建多数投票，这是本文最值得想的问题。** 一个直接原因是副作用：CoT-SC 的几十条路径互相独立、可丢弃，而 agent 的每一步都可能改世界。采样几十条带写操作轨迹，要么全部回滚（需要事务语义），要么只对只读推理侧投票。ReAct 选了后者——它的两个混合策略（ReAct→CoT-SC、CoT-SC→ReAct）都只在**没有副作用的推理**上使用采样与投票，动作侧永远只跑一条轨迹。

### 2.4 Least-to-Most —— 分解但不改变循环（arXiv:2205.10625）

Zhou et al.，2022-05-21 提交，ICLR 2023（[摘要页](https://arxiv.org/abs/2205.10625)）。

动机是 CoT 的「easy-to-hard 泛化」缺陷：示例简单、问题更难时就掉。做法是两阶段——先把复杂问题**分解**成一串更简单的子问题，再依次求解，每个子问题用前面子问题的答案。

最强的一组数字：SCAN 基准上，GPT-3 `code-davinci-002` + least-to-most **只用 14 条示例，在所有 split（包括 length split）上准确率至少 99%**，而 CoT 只有 **16%**。作为对照，文献里专门解 SCAN 的神经符号模型要在 15,000+ 条训练样本上训练。

**它的分解发生在模型输出里，不在 harness 代码里。** 这是它与后来 agent「先规划再执行」的 planner 模式的关键差别：least-to-most 只是让模型分两轮说话，循环结构没变。

### 2.5 Self-Ask —— 同期的竞争解法（arXiv:2210.03350）

Press et al.，2022-10-07 提交，与 ReAct 几乎同时（ReAct 是 2022-10-06），**To appear at Findings of EMNLP 2023**（[摘要页](https://arxiv.org/abs/2210.03350)）。

它引入了一个有用的度量：**compositionality gap**——模型能答对所有子问题却不能给出整体答案的比例。发现是反直觉的：**模型变大，单跳能力提升快于多跳，所以这个 gap 不缩小。**

解法是让模型显式地自问自答后续问题（self-ask），并且「self-ask's structured prompting lets us easily plug in a search engine to answer the follow-up questions」。

**把 Self-Ask 和 ReAct 并排看是本份调研里最有信息量的一组对照。** 两者都是 2022 年 10 月、都在测多跳问答、都要接外部知识、都在说 CoT 不够。差别在**谁决定检索**：Self-Ask 用固定结构的提示词槽位（模型必须发问，搜索引擎固定回答），ReAct 把检索做成动作空间里的合法动作（模型自己决定搜什么、搜几次、什么时候改用 lookup）。前者是结构化模板，后者是自由动作空间加推理痕迹。后来的 agent 选了后者。

### 2.6 PAL —— 把计算外包（arXiv:2211.10435）

Gao et al.，2022-11-18 提交（[摘要页](https://arxiv.org/abs/2211.10435)），晚于 ReAct 一个月。

思路：让模型把自然语言问题转成程序，**求解交给 Python 解释器**——「decomposing the natural language problem into runnable steps remains the only learning task for the LLM, while solving is delegated to the interpreter」。

结果：13 个任务上 Codex + PAL 在 GSM8K 上超过用 CoT 的 PaLM-540B **绝对 15%**。它的动机陈述对 agent 设计很直接：**模型即使分解对了，也会在算术和逻辑上出错**，所以该外包的就外包。

这是 ReAct「行动」的另一种接法：行动不一定是检索，也可以是**执行**。今天的 `bash` 工具在这条线上。

---

## 3. 检索线：RAG 与「非参数化记忆」

### 3.1 RAG（arXiv:2005.11401）

Lewis et al.，2020-05-22 提交，NeurIPS 2020（[摘要页](https://arxiv.org/abs/2005.11401)）。

**它比 CoT 早一年半，比 ReAct 早两年半。** 这决定了它在血缘上不是 ReAct 的前身，而是另一条支流。

必须澄清一个常见误写：**RAG 不是「先检索再把结果拼进提示词」。** 它是一个**端到端微调的模型架构**：

- 参数化记忆 = 预训练 seq2seq 模型
- 非参数化记忆 = Wikipedia 的稠密向量索引
- 两者通过一个**预训练神经检索器**连接，整个配方是 fine-tuning 出来的

摘要有两种 RAG 形式的对照：一种是「conditions on the same retrieved passages across the whole generated sequence」（RAG-Sequence），另一种「can use different passages per token」（RAG-Token）。成绩是三个开放域 QA 任务上的 SOTA，超过纯参数化 seq2seq 与任务专用的 retrieve-and-extract 架构。

**它要解决的问题与 ReAct 不同。** RAG 的出发点是纯参数化模型「access and precisely manipulate knowledge」能力有限，且**无法提供 provenance、无法更新世界知识**。ReAct 的出发点是 CoT 的思考「not grounded in the external world」。两者都在往外部信息上接，但 RAG 接的是**权重里的检索器**，ReAct 接的是**模型的一个动作**。

### 3.2 Toolformer —— 相反的方向（arXiv:2302.04761）

Schick et al.，2023-02-09 提交，单版本（[摘要页](https://arxiv.org/abs/2302.04761)）。**比 ReAct 晚四个月。**

它训练模型自己决定「which APIs to call, when to call them, what arguments to pass, and how to best incorporate the results into future token prediction」，自监督，每个 API 只需少量演示。工具集包括计算器、QA 系统、两个搜索引擎、翻译系统、日历。

与 RAG 的区别：RAG 是**检索**（把文档取回来做条件），Toolformer 是**动作**（调用 API 并把结果内化进后续 token 预测）。与 ReAct 的区别：ReAct 把工具使用留在**上下文里**（提示 + 轨迹），Toolformer 把它压进**权重里**。

三者构成一条清晰的谱：RAG（检索器决定，端到端训练）→ Toolformer（模型决定，自监督训练）→ ReAct（模型决定，纯提示）。**ReAct 是唯一不动参数的。**

---

## 4. 网页智能体与具身动作线

### 4.1 WebGPT（arXiv:2112.09332）

Nakano et al., OpenAI，2021-12-17 提交，32 页（[摘要页](https://arxiv.org/abs/2112.09332)）。**比 ReAct 早十个月。**

做法：微调 GPT-3 在一个纯文本的网页浏览环境里回答问题。**它不是纯提示**——训练流程是行为克隆 → 人类偏好奖励模型 → 拒绝采样（rejection sampling）。为了让人类容易评估事实准确性，模型浏览时必须**同时收集引用**。

成绩：最好的模型（行为克隆微调 + 对奖励模型做拒绝采样）的答案被人类偏好**胜过人类示范者 56% 的时间**，胜过 Reddit 最高票答案 **69% 的时间**。测试集是 ELI5（另有 TruthfulQA）。论文还给了另一组更硬的口径：答案 **75% 为真**，**54% 同时为真且有信息量**，强于基座 GPT-3 但不如人类。

**动作空间完整清单（正文核对，`docs/ref/2112.09332v3.pdf` Table 1）**——摘要只说 search 与 navigate，实际有十种命令：

| 命令 | 效果 |
|---|---|
| `Search <query>` | 发给 Bing API，显示结果页 |
| `Clicked on link <link ID>` | 跟随链接 |
| `Find in page: <text>` | 定位并滚动到下一个匹配 |
| `Quote: <text>` | 在当前页找到则**加入引用** |
| `Scrolled down <1,2,3>` / `Scrolled up <1,2,3>` | 滚动 |
| `Top` / `Back` | 回到页首 / 上一页 |
| `End: Answer` | 结束浏览，进入作答阶段 |
| `End: <Nonsense, Controversial>` | 结束浏览并**跳过作答** |

关键规则：**生成任何其他文本都算无效动作**；无效动作照样计入步数上限，但不产生效果。动作预算在训练时从 20–100 均匀随机采样，评估时固定为 100。

还有两处结构上更重要的事实：

1. **每一步都是全新 context。** 正文原话：「This process is then repeated with a fresh context (hence, **the only memory of previous steps is what is recorded in the summary**).」模型没有对话历史，每一步只看到当前环境摘要。这与 ReAct 把完整 thought-action-observation 轨迹留在上下文里是**根本不同的记忆模型**。
2. **引用是「浏览」与「作答」两阶段的桥。** 浏览阶段收集到的引用（页标题、域名、摘录）在结束后连同问题一起喂给模型写终稿；没有引用就不进作答阶段。

**这份材料里最值得注意的设计是「边浏览边收集引用」。** 它是为了服务**人类评估**而加的输出约束，副产品是把「来源」变成了模型输出的一等公民。今天 agent 在回答里带文件路径和行号，血缘在这里。

最后补一处论文自己提的对照：它在设计环境时明确说，此前 REALM、RAG 这类工作「has focused on improving document retrieval for a given query. **Instead, we use a familiar existing method for this: a modern search engine (Bing)**」——理由是搜索引擎已经很强且索引新鲜，可以把注意力放到「用搜索引擎回答问题」这个更高层任务上。**这正是后来 agent 选的路：不自建检索器，直接用现成工具。**

### 4.2 SayCan（arXiv:2204.01691）

Ahn et al., Google，2022-04-04 提交，v2 于 2022-08-16（[摘要页](https://arxiv.org/abs/2204.01691)）。**比 ReAct 早半年，与 ReAct 同年。**

动机陈述直指 LLM 的短板：「a significant weakness of language models is that they lack real-world experience, which makes it difficult to leverage them for decision making within a given embodiment」。举例很具体：问模型怎么清理洒出来的东西，它会给出合理叙述，但那个叙述不适用于**这个**环境里的**这个**机器人。

解法是**用预训练技能约束模型的提议**：「pretrained skills, which are used to constrain the model to propose natural language actions that are **both feasible and contextually appropriate**」。

**精确公式（正文核对，`docs/ref/2204.01691v2.pdf` Section 3）**。记指令为 `i`，技能集合为 `Π`，技能 `π` 有文本标签 `ℓ_π` 与可供性函数 `p(c_π | s, ℓ_π)`（在状态 `s` 下执行 `ℓ_π` 成功完成的概率，`c_π` 是伯努利变量）。LLM 给出 `p(ℓ_π | i)`，即可供性函数与语言概率相乘后取最大：

```
π = arg max_{π∈Π} p(c_π | s, ℓ_π) · p(ℓ_π | i)
```

论文把两项分别命名为 **task-grounding**（`p(ℓ_π|i)`，技能是否是对该指令有意义的下一步）与 **world-grounding**（`p(c_π|s,ℓ_π)`，该技能在这个世界里此刻能否做成）。可供性函数在 RL 术语里就是「成功为 1、失败为 0」的奖励下的价值函数。

**消融数字（Table 2 / Section 5.2）**：

| 配置 | 规划成功率 |
|---|---|
| PaLM-SayCan（完整） | **84%** |
| No VF（去掉价值函数，只取语言分最高的技能） | 67% |
| Generative（用生成式输出再投影到最近技能） | 74% |
| BC NL（**不用 LLM**，直接把指令喂给策略） | **0%** |
| BC USE（不用 LLM，指令投影到最近技能） | 9%（执行成功率） |

完整系统在训练环境的规划成功率 84%、执行成功率 74%；在真实厨房 81% / 60%。

v2 追加的内容里有几项值得单独记：增加了 PaLM 结果、**增加了 chain of thought prompting 的研究**、多语言指令、以及**语言模型规模的消融**。

**与今天 harness 的关系需要说清是有条件的**：SayCan 的约束作用是「不可行的动作被筛掉」，机制是学出来的价值函数；harness 里的工具参数校验与权限判定是确定性的规则判定。功能位相同（在动作执行前拦一道），实现路径不同（学出来的可行性 vs 写出来的规则）。把它当成同一个东西会误判代价。**消融给了这个「代价」一个量级**：去掉世界接地（No VF）让规划成功率从 84% 掉到 67%——**一个校准不准的可行性判断，漏掉的正是最难的那批情形**。而规则系统不会漏判自己覆盖的部分，代价换成了另一样东西：**规则外的一律拦不住**。

另外，作者自陈的第 3 条局限对今天同样成立：

> 「the system is not easily able to react to situations where individual skills fail despite reporting a high value」

**技能报告高价值却执行失败时，系统不会应对。** 这正是权限系统与工具执行语义要处理的问题，SayCan 停在「承认它」这一步。

**而 Inner Monologue 就是冲着这条局限来的**（§4.3）：它的 Related Work 直接指出 SayCan 这类方法「assume that each proposed step is executed successfully」，真实厨房里一旦强制注入故障，SayCan 成功率归零，带反馈的版本还能救回三到七成。**两篇是接续关系，不是并列。**

### 4.3 Inner Monologue（arXiv:2207.05608）

Huang et al., Google，2022-07-12 提交，单版本（[摘要页](https://arxiv.org/abs/2207.05608)）。**比 ReAct 早三个月，且全文未提及 ReAct**——引用是单向的。它与 SayCan 同属 Everyday Robots 项目线。

下面全部为正文核对（`docs/ref/2207.05608v1.pdf`）。

**它不是训练式方法。** 与 SayCan 的关键差别在这里：

> 「in our specific implementations of Inner Monologue, we use pre-trained LLMs for planning that are **not finetuned**, but rather evaluated **solely with few-shot prompting**」

**它要修的是 SayCan 的哪个缺陷**——Related Work 写得比 SayCan 自己的局限一节更直接：

> 「However, both approaches effectively produce the plan **while assuming that each proposed step is executed successfully by the agent.** As a result, these approaches may not be robust in handling intermediate failures in dynamic environments or with poor lower level policies.」

也就是说，SayCan 那条「技能报告高价值却执行失败时系统不会应对」的自陈局限，**是 Inner Monologue 的出发点**。两篇的关系不是并列，是接续。

#### 三类反馈，其中一类是模型主动发问

| 类型 | 内容 | 触发方式 |
|---|---|---|
| **Success Detection** | 某个低层技能是否成功（二分类） | 被动注入 |
| **Passive Scene Description** | 场景语义，分 Object feedback（物体识别）与 Scene feedback（任务进度） | 每次规划自动注入 |
| **Active Scene Description** | LLM **主动提问**，由人或 VQA 模型回答 | 模型发起 |

第三类是重点。原文说它「encompasses sources of feedback that are provided directly in response to **active queries by the LLM planner**」，而且「the LLM can receive **unstructured answers to open-ended questions**」。

**这件事值得单独标出来**：Inner Monologue 已经有了「模型自己发起查询、拿回非结构化结果」的机制。这与 ReAct 的 `Action → Observation` 在结构上是同一件事。所以 ReAct 对它的概括需要打折。

#### ReAct 的概括是不完整的

ReAct 说 IM 的独白「is limited to observations of the environment state and what needs to be completed by the agent for the goal to be satisfied」。**这个描述准确覆盖了 IM 的被动两类反馈，但漏掉了第三类。**

IM 自己的原文把它的反馈描述为「any type of environment feedback can inform the LLM planner, **as long as it can be expressed through language**」——这个表述比 ReAct 给它的框要宽。

更麻烦的是，IM 论文里还有一个专门的 Emergent Capabilities 一节，记录了**没有被提示过、但模型自发涌现的行为**：

- **Self-Proposing Goals under Infeasibility**：拿一个重到拿不动的积木失败后，模型自行改换目标「find a lighter block」并完成任务
- **Continued Adaptation to New Instructions**：人在任务中途改目标、又改回去，模型跟着切换两次；没被教过「please stop」也能产出 `done`
- **Interactive Scene Understanding**：任务执行完后反问场景问题，模型能正确回答需要时序与具身推理的问题
- **Multilingual Interaction**：中文指令照样理解并重述成英文目标

这四条说明 IM 的「思考」有主动重规划的成分，不只是复述环境状态。

**那么 ReAct 的辩护空间在哪？** 有一个，但比它写的窄：IM 的这段涌现行为作者自己承认「they are of **varying levels of consistency** when no similar examples have been provided in the prompt」。ReAct 更站得住的差别不是「IM 没有自由思考」，而是**IM 没有把思考做成动作空间的一个一等公民**——IM 的思考是提示注入的副产品，ReAct 把它变成 `Â = A ∪ L` 里被显式定义的东西，并配了 ReAct-IM 消融来量化固定形式的代价（ALFWorld 71 vs 53）。

#### 实验：三组场景，数字都硬

**模拟桌面重排（Ravens 环境，50 episodes）**。基线是 CLIPort，逐级加反馈：

| 任务 | CLIPort + oracle | +LLM | +Object | +Object+Success | +Object+Scene |
|---|---|---|---|---|---|
| Pick and place（已见） | 24% | 74% | 80% | 90% | **94%** |
| Put blocks in matching bowls（未见） | 0% | 0% | 56% | 70% | **82%** |
| Put blocks on mismatched bowls（未见） | 0% | 0% | 62% | 76% | **86%** |
| Stack all blocks on [x] corner（未见） | 0% | 0% | 0% | 4% | 6% |

**未见任务上基线是 0%，加完整反馈到 82–86%。** 最后一行的 6% 说明这个方法也有它自己搞不定的任务。

**真实桌面（10 次运行）**：Finish 3-block stacking 从 20% → 100%；Sort fruits from bottles 从 20% → 80%；总计 20% → 90%。

**真实厨房移动操作（120 次评测，直接对比 SayCan）**——这是全篇最有信息量的一组，因为第 4.2 节说过 SayCan 在真实厨房是 81% / 60%：

| 任务类 | SayCan | +Success | +Object+Success |
|---|---|---|---|
| Manipulation（无扰动） | 50.0% | 62.5% | **75.0%** |
| Mobile Manipulation（无扰动） | 50.0% | 50.0% | **75.0%** |
| Drawers（无扰动） | 83.3% | 83.3% | **100.0%** |
| Manipulation（**有扰动**） | 12.5% | 25.0% | 33.3% |
| Mobile Manipulation（**有扰动**） | **0.0%** | 25.0% | **75.0%** |
| Drawers（**有扰动**） | **0.0%** | 44.4% | 44.4% |

作者的解读：

> 「Without any LLM-informed feedback **SayCan has success rate close to 0%** since it does not have explicitly high-level retry behavior.」

**结论要说准**：无扰动时 SayCan 表现尚可，差距不算悬殊；**一旦低层技能被迫失败，SayCan 直接归零，而有反馈的版本还能救回三到七成。** 这个对比把「闭环反馈」的价值定位得很清楚——**它不是让平均情况更好，而是让失败可恢复**。这与 ReAct 反复强调的「把错误变成观察」是同一个论点的量化版本。

#### 作者自陈的两项代价

1. **用了 oracle 场景描述**：「we assume access to oracle scene descriptors in the form of **human observers or scripted systems**」——人来描述场景。这是个人在环里的系统，不是全自动。
2. **模型会忽略反馈**：「In some instances, we found that the **LLM planners ignored the environment feedback** and still proposed policy skills involving objects not present in the scene.」

第 2 条值得记住：**把反馈放进上下文不等于模型会用它。** 另有两类失败来源——成功检测的假阴（导致多余重试）与假阳（给环境引入「对抗性部分可观测性」）、以及控制错误。

### 4.4 MRKL（arXiv:2205.00445）

Karpas et al., AI21 Labs，2022-05-01 提交（[摘要页](https://arxiv.org/abs/2205.00445)），与 SayCan 同月。

主张是架构层面的：把任务理解为「knowledge and reasoning in addition to linguistic processing」，用一个由多个神经模型加**离散的知识与推理模块**组成的神经符号系统来解。文中的实现叫 Jurassic-X。

它的价值在于**它是这一批里唯一从「系统架构」而不是「提示技巧」出发的**。今天 harness 里「LLM 负责调度、工具负责求解」的整体形状，与这篇的表述最接近。

---

## 5. 交叉判断

### 5.1 提示 vs 训练的分叉，成因不是理念而是动作空间

表面叙述是「ReAct 证明了纯提示够用」。证据指向更具体的原因：**动作空间的复杂度决定了要不要训。**

- WebGPT 的动作空间有**十种命令**（搜索、点链接、页内查找、引用、滚动、回退、结束/跳过作答），且需要人类偏好信号来判断答案质量 → 必须训
- SayCan 的动作空间是连续控制，可行性要靠 RL 学出的价值函数判断 → 部分必须训
- ReAct 在知识密集任务上把动作空间压到三个（`search` / `lookup` / `finish`），**每个动作的语义都能从名字读出来** → 可以只提示

还有一层差别比动作空间更根本，是**记忆模型**：WebGPT 每一步都是全新 context，「the only memory of previous steps is what is recorded in the summary」；ReAct 把完整轨迹留在上下文里。**WebGPT 需要训，部分原因就是它把记忆外包给了环境摘要——模型必须学会从摘要里重建状态。** ReAct 把这件事交给上下文本身，于是模型不必学。

ReAct 对动作空间的弱化是**刻意**的，正文写得很直白：这个 API「mostly can only retrieve a small part of a passage based on exact passage name, which is significantly weaker than state-of-the-art lexical or neural retrievers. **The purpose is to simulate how humans would interact with Wikipedia, and force models to retrieve via explicit reasoning in language.**」

**它故意用了一个更弱的检索器。** 这是本篇最有教学价值的一个发现：ReAct 要证明的不是「模型能检索」，而是「模型的推理能驱动检索」——所以它必须把检索器削弱到推理有意义为止。如果检索器强到一次就搜准，思考就没必要存在了。

需要限定的是：这个论证在决策类任务上不成立。ALFWorld / WebShop 的动作空间是环境原生的、数量更多，ReAct 仍是提示而不是训练。所以「动作空间小 → 可以只提示」是个**启发式，不是定律**。另一个可能的解释是：知识类任务的动作空间是**论文自己设计的**（一个三动作的 Wikipedia API），而决策类任务的动作空间是**环境给定的**——凡是作者能自己设计动作空间的地方，他都选了最小的一组。

### 5.2 检索由谁发起：决策权的归属

| | 谁决定检索 | 检索什么 | 代价 |
|---|---|---|---|
| RAG | 神经检索器（训练出来的） | 稠密向量 top-k | 不可解释、难以按需触发 |
| Self-Ask | 提示模板的固定槽位 | 交给外部搜索引擎 | 结构固定，模型无自由度 |
| ReAct | **模型自己** | 模型自己写 query | 多轮往返、非确定性、搜错就崩 |

最后一列的代价在 ReAct 自己的消融里有数字：**搜索无效占其失败案例的 23%**，且「derails the model reasoning and gives it a hard time to recover and reformulate thoughts」。

**这是把决策权交给模型的价格标签：换来可解释与灵活性，付出 23% 的失败归因。** 今天所有检索类工具（`grep`、`glob`、`web_search`）都继承了这个交换。

### 5.3 动作可行性由谁保证

三条路径，值得并列而不是抹平：

1. **学出来的**（SayCan）：技能价值函数给出可行性。**消融给了代价的量级**——去掉世界接地后规划成功率 84% → 67%，且作者自陈「技能报告高价值却执行失败时系统不会应对」
2. **筛出来的**（ReAct）：不筛。动作空间故意做小，让模型自己别犯错——搜不到就是观察结果，模型自己恢复
3. **写出来的**（今天的 harness）：参数 schema 校验 + 路径围栏 + 命令策略，确定性，但只能拦住写进规则的

ReAct 的立场是第 2 条，而且是被低估的设计选择：**把错误变成观察，而不是阻止它发生。** 搜不到、参数错、文件不存在，都是回灌给模型的 observation。今天 harness 里「工具失败不中断循环，把错误当结果回灌」的语义，出处在这条线上。

**SayCan 的消融还说明了另一件事：LLM 与世界接地缺一不可。** 去掉 LLM（BC NL）规划成功率 **0%**，去掉世界接地（No VF）掉到 67%，只有两者都在才到 84%。这直接对应今天 harness 的两半——**模型负责「做什么有意义」，工具与环境负责「什么是真的」**。

而权限系统要处理的是第 3 类里的**不可逆副作用**：ReAct 的论文里没有这类动作（作者在 Broader Impact 里明说「without any dangerous actions in the action space design」，模型不能真买商品、不能编辑 Wikipedia），所以它对权限问题没有答案。**ReAct 能回避权限问题，是因为它把动作空间设计得足够安全——这是权限设计的一种极端解法：不要有危险动作。**

---

## 6. 被否决的选项清单

| 被否决的方案 | 提出者 | 否决理由 | 证据 |
|---|---|---|---|
| 固定形式的思考（ReAct-IM） | ReAct 自建消融 | ALFWorld 71 → 53，五个任务上一致变差；缺高层目标分解与常识推理 | [ar5iv 全文](https://ar5iv.labs.arxiv.org/html/2210.03629) |
| 纯推理（CoT）用于决策任务 | ReAct | 思考是 static black box、not grounded，导致幻觉与错误传播 | 同上 |
| 纯行动（Act-only）用于推理任务 | ReAct | 无法把目标拆成子目标、跟踪不到环境状态；HotpotQA 25.7 vs ReAct 27.4 | 同上 |
| 大而全的检索动作空间 | ReAct | 刻意用弱检索器，逼模型「retrieve via explicit reasoning in language」 | 同上 |
| 无界循环 / 自判定完成 | ReAct | 用 7 步（HotpotQA）、5 步（FEVER）作为回退阈值；注明更多步不提升 | 同上 |
| 训练式 agent（在该任务上） | ReAct | 用 1–2 条示例的提示击败了用 10³–10⁵ 条实例训练的 IL/RL 基线 | 同上 |
| 贪心解码的 CoT | Self-Consistency | 采样 + 边缘化显著优于单路径（GSM8K +17.9%） | [2203.11171](https://arxiv.org/abs/2203.11171) |
| 让模型自己做算术 | PAL | 模型即使分解对了也在算术/逻辑上出错，改由解释器求解 | [2211.10435](https://arxiv.org/abs/2211.10435) |
| 只靠参数化知识 | RAG | 无法提供 provenance、无法更新世界知识 | [2005.11401](https://arxiv.org/abs/2005.11401) |
| 不受约束的 LLM 动作提议 | SayCan | 语义合理但物理上不可行，需要技能价值函数过滤（84% vs 67%） | [2204.01691](https://arxiv.org/abs/2204.01691) |
| 不用 LLM 的指令跟随 | SayCan | BC NL 规划成功率 0%，投影到已知技能的 BC USE 也只有 9% | 同上 |
| 自建检索器 | WebGPT | 改用现成搜索引擎（Bing）——「modern search engines are already very powerful」 | [2112.09332](https://arxiv.org/abs/2112.09332) |
| 把历史上下文交给模型 | WebGPT | 反例：每步用全新 context，只保留环境摘要作为记忆 | 同上 |
| 把工具用法留在提示里 | Toolformer | 改为自监督训练进权重 | [2302.04761](https://arxiv.org/abs/2302.04761) |
| 固定槽位的检索触发 | Self-Ask | 结构固定，模型无自由度（与 ReAct 的对照） | [2210.03350](https://arxiv.org/abs/2210.03350) |
| 只由环境状态构成的独白 | Inner Monologue → ReAct | ReAct 认为 IM 的思考受限，改为自由形式且稀疏 | [ar5iv 全文](https://ar5iv.labs.arxiv.org/html/2210.03629) |
| 假设每一步都执行成功 | SayCan → Inner Monologue | SayCan 这类方法没有高层重试行为，强制故障时成功率归零（0%–12.5%） | [2207.05608](https://arxiv.org/abs/2207.05608) |
| 只在任务开始时识别一次场景 | Inner Monologue | 开环变体（「similar to the system demonstrated in [19]」）弱于持续注入反馈 | 同上 |
| 把反馈放进上下文就以为模型会用 | Inner Monologue 的失败模式 | 「we found that the LLM planners **ignored the environment feedback** and still proposed policy skills involving objects not present in the scene」 | 同上 |
| 让模型自己选解码方式（贪心） | CoT → Self-Consistency | 涌现只在约 100B 以上成立；小模型生成 fluent but illogical 的链 | [2201.11903](https://arxiv.org/abs/2201.11903) |

---

## 7. 对 Herald 的直接含义

1. **阶段一的 `LlmAdapter` 只需要覆盖「一条轨迹、多轮工具调用」。** 采样投票（Self-Consistency）在 agent 语义下不成立，不要为它预留接口。等真要做「同一问题跑 N 次」时再单独立项。
2. **消息数组要能表达「思考」与「行动」的区分。** ReAct 的结构性发现是：`Thought` 不产生 observation，`Action` 产生。哪怕阶段一刻意不用事件日志，消息数组里也要保留这个区分——否则后面接 thinking 通道时要重做。这是阶段二「事件日志该记什么」的一个具体输入。
3. **循环的退出条件需要一个非模型来源。** ReAct 用的是步数阈值（7 / 5），而 AutoGPT 的失败机制第 1 条正是「没有非模型意见的终止信号」。阈值是廉价但有效的答案，值得在阶段一就写死一个可调参数。
4. **`read_file` 之外，第一阶段值得再想一个「会失败」的工具。** ReAct 的 23% 失败归因全部来自搜索无效，而它把失败当 observation 回灌。Herald 如果第一版工具只有只读且几乎不失败的 `read_file`，就练不到「工具失败后模型如何恢复」这段语义——那恰恰是 agent 循环最有价值的部分。
5. **工具校验的位置要早做决定。** SayCan 的教训是：约束动作可行性的机制决定了你要付出什么代价（学出来的会漏判、写出来的不会泛化）。Herald 选写出规则，那就接受「只能拦住规则内的」，并且把规则外的情况当 observation 回灌而不是当异常抛出。

---

## 8. 与 react-lineage.md 的分工

[`react-lineage.md`](react-lineage.md) 讲 **ReAct 之后**：它的提示技巧怎么被原生工具调用（2023-06）和受训练思考通道先后替换，以及 2023 年无界循环的失败机制。
本文讲 **ReAct 之前**：推理线与行动线各自走到哪、ReAct 从每条线上取了什么、否决了什么。

两文在第 3 节（消融数字）与第 9 节（判决）上有衔接但不重复：那篇的判决针对「名字活下来、机制被替换两次」，本文的判决针对「继承关系与分叉成因」。

---

## 9. 未验证与待补

### 证据层级（2026-09-21 更新后）

已核对 PDF 正文的六篇（在 `docs/ref/`）：ReAct v3、SayCan v2、WebGPT v3、CoT v6、Self-Consistency v4、Inner Monologue v1。

仍只有 arXiv 摘要页的：Scratchpads、Least-to-Most、Self-Ask、PAL、RAG、Toolformer、MRKL、GSM8K。

也就是说：**继承关系（第 1 节）与四个最关键的正文细节（SayCan 公式与消融、WebGPT 动作空间与记忆模型、Self-Consistency 采样参数、Inner Monologue 反馈分类与实验数字）已是正文级；其余各篇的定量结果仍是摘要级。**

### 初版的五处修正

| 初版断言 | 修正后 | 成因 |
|---|---|---|
| 「Scratchpads…ReAct 未引」 | **错。确认被引** | 从 ar5iv 抓取截断推出「不存在」——不该做的推断 |
| 「SayCan 的精确打分公式未确认」 | **已补**：`π = arg max p(c_π\|s,ℓ_π)·p(ℓ_π\|i)` | 读到 PDF 正文 |
| 「WebGPT 的动作空间完整清单未确认」 | **已补**：十种命令 + 每步全新 context | 读到 PDF 正文 |
| 「CoT-SC：采样 21 条、temperature 0.7」 | **半错**：21 条是 ReAct 自设的算力折中，Self-Consistency 原文默认 40 条 | 把 ReAct 的参数记到了 Self-Consistency 头上 |
| 转述 ReAct 对 IM 的概括，未加保留 | **已改为揭示其不完整**：IM 有 LLM 主动提问的第三类反馈，ReAct 只描述了被动那一半 | 直接采信了一手来源里的**转述**，未回被转述方原文核对 |

最后一条与前四条性质不同：前四条是我自己出错，这一条是 **ReAct 对 IM 的概括本身有偏，我照抄了**。教训是——**论文里「X 方法的局限是……」这类转述，必须回 X 的原文核一遍再用。** 引语逐字无误，不代表引语描述的事实无误。

### 仍然未确认的条目

| 断言 | 状态 | 说明 |
|---|---|---|
| CoT 的正式发表会议 | **未确认** | arXiv 2201.11903 的 v1–v6 页面 Comments 字段均无发表信息；PDF 版本页眉为「Published as a conference paper at ICLR 2023」但那只存在于 ReAct 的 PDF。CoT v6 的首页信息未逐字核对，故仍不写会议 |
| Toolformer / Scratchpads / MRKL 的发表会议 | 未确认 | 各自 arXiv 页面无 Comments 字段，PDF 未取得 |
| RAG / Least-to-Most / PAL / Self-Ask 的具体分数 | **仅摘要级** | 只写了摘要里明确的数字，未从正文补（Self-Consistency 已升为正文级） |
| SayCan v2 所加 CoT 研究的具体结论 | 未确认 | 只从 Comments 字段得知「Added study about ... chain of thought prompting」，未读该小节 |
| 零样本 CoT 的内容 | **编号已确认，内容未调研** | ReAct 文献表确认为 Kojima et al., arXiv:2205.11916；本篇未展开它 |
| 各篇代码仓库可达性 | 未检查 | 未逐个访问项目页 |

### 建议下一步

要继续提高证据层级，按价值排序需要：

1. **arXiv:2005.11401**（RAG）——RAG-Sequence / RAG-Token 术语与两种形式的实际差别
2. **arXiv:2205.11916**（Zero-shot CoT）——补上推理线最后一个成员
3. **arXiv:2205.10625**（Least-to-Most）——两阶段提示的具体构造
4. **arXiv:2207.01206**（WebShop）——ReAct 的两个决策任务基准之一，ReAct 论文引用它但本篇未展开
5. **Toolformer / Scratchpads / MRKL** 的发表信息——只能从会议官网或 OpenReview 查，arXiv 页面没有
