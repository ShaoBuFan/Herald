# docs

本目录是 Herald 项目的主要工作区。

## 为什么以文档为主

项目目标不是产出可运行的代码，而是理解 agent harness 的设计取舍（详见[项目说明](../README.md)）。工作重心因此落在设计与推演上，代码是实现和验证的手段。

可预见的一段时间内，本目录的内容量将超过代码。

## 文档类型

- **决策记录**（[`decisions/`](decisions/)）—— 已定型的决策。每份包含四项：问题、所选方案、被否决的方案、代价。模板见 [`0000-template.md`](decisions/0000-template.md)；**尚未定型的决策点**（含证据位置）见 [`decisions/README.md`](decisions/README.md) 的待决清单。
- **设计讨论** —— 子系统设计过程中的推演与备选方案，尚未定型。定型后提炼为决策记录。
- **对照研究**（[`research/`](research/)）—— 对已有实现与已有研究的分析。重点是它们未采用的方案及原因。文件清单与阅读顺序见 [`research/README.md`](research/README.md)。
- **原件**（[`ref/`](ref/)）—— 第三方论文 PDF，供核对引文、数字与页码。**不入 git**（第三方版权、体积大、可按清单重新下载），收录内容与下载命令见 [`ref/README.md`](ref/README.md)。

「设计讨论」暂未建立固定目录，出现实际内容时再建。

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
