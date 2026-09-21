# docs

本目录是 Herald 项目的主要工作区。

## 为什么以文档为主

项目目标不是产出可运行的代码，而是理解 agent harness 的设计取舍（详见[项目说明](../README.md)）。工作重心因此落在设计与推演上，代码是实现和验证的手段。

可预见的一段时间内，本目录的内容量将超过代码。

## 文档类型

本目录按**从原始到固化**排成四层。上下游关系是单向的：笔记 → 研究 → 决策，引用贯穿其中。

| 层 | 目录 | 谁写 | 内容 |
|---|---|---|---|
| 笔记 | `notes/` | **只有作者** | 读论文的现场记录。未整理、可能有错、自相矛盾是正常的 |
| 研究 | [`research/`](research/) | 作者与 AI 共同 | 从笔记提炼出的对照研究：事实、证据、判断、被否决的方案 |
| 引用 | [`ref/`](ref/) | 参考件 | 论文原件与原文引语抄本。可追溯，不加工 |
| 决策 | [`decisions/`](decisions/) | 结论由作者定 | 已定型的决策 |

- **决策记录**（[`decisions/`](decisions/)）—— 每份包含四项：问题、所选方案、被否决的方案、代价。模板见 [`0000-template.md`](decisions/0000-template.md)；**尚未定型的决策点**（含证据位置）见 [`decisions/README.md`](decisions/README.md) 的待决清单。
- **对照研究**（[`research/`](research/)）—— 文件清单与阅读顺序见 [`research/README.md`](research/README.md)。
- **原件与引语**（[`ref/`](ref/)）—— 论文 PDF **不入 git**（第三方版权、体积大、可按清单重新下载）；引语抄本入库。见 [`ref/README.md`](ref/README.md)。
- **笔记**（`notes/`）—— **AI 不在此目录写入任何内容**（见 [`../AGENTS.md`](../AGENTS.md) 第 2.6 节）。目录尚未建立，等作者产出第一篇笔记时再建。

`research/` 与 `decisions/` 的边界：前者写**事实与判断**，后者写**选择与代价**。研究文档里的「对 Herald 的直接含义」是设计输入，不是决策——它们被编进待决清单，等作者定夺。

## 全部文件

| 文件 | 内容 |
|---|---|
| [`README.md`](README.md) | 本文件：文档类型与约定 |
| [`decisions/0000-template.md`](decisions/0000-template.md) | ADR 模板 |
| [`decisions/README.md`](decisions/README.md) | 待决清单与预留编号 |
| [`research/README.md`](research/README.md) | 研究文件索引与阅读顺序 |
| [`research/react-lineage.md`](research/react-lineage.md) | ReAct **之后**：机制如何被替换两次、2023 年泡沫的失败机制 |
| [`research/react-prehistory.md`](research/react-prehistory.md) | ReAct **之前**：两条线的演进、继承与否决 |
| [`research/paper-reading-map.md`](research/paper-reading-map.md) | 论文依赖图与阅读顺序 |
| [`ref/README.md`](ref/README.md) | 论文原件清单（PDF 本身不入 git） |

## 约定

- 语言：中文。
- 文件名：小写英文加连字符，例如 `session-log-design.md`。
- 决策记录按顺序编号：`0001-xxx.md`。预留编号见 [`decisions/README.md`](decisions/README.md)，定稿时不要重复占用。
- 每个可进入的子目录都有 `README.md` 说明自己的内容与阅读顺序。
