# ref —— 第三方论文原件

本目录存放调研时用到的论文 PDF，供核对引文与数字。**不入 git**（见根目录 `.gitignore`）：这些是第三方版权材料，体积大且可重新下载，入库只会让仓库膨胀。

`docs/research/` 里的对照研究引用本目录文件时，写作 `docs/ref/<文件名>`。

## 当前收录

| 文件名 | 论文 | 版本 | 来源 | 被哪篇研究引用 |
|---|---|---|---|---|
| `2210.03629v3.pdf` | ReAct: Synergizing Reasoning and Acting in Language Models | v3（ICLR 2023 camera ready，2023-03-10） | https://arxiv.org/abs/2210.03629v3 | 两篇都依赖它 |
| `2204.01691v2.pdf` | Do As I Can, Not As I Say: Grounding Language in Robotic Affordances (SayCan) | v2（2022-08-16） | https://arxiv.org/abs/2204.01691v2 | [`react-prehistory.md`](../research/react-prehistory.md) §4.2、§5.3 |
| `2112.09332v3.pdf` | WebGPT: Browser-assisted question-answering with human feedback | v3（2022-06-01） | https://arxiv.org/abs/2112.09332v3 | [`react-prehistory.md`](../research/react-prehistory.md) §4.1、§5.1 |
| `2201.11903v6.pdf` | Chain-of-Thought Prompting Elicits Reasoning in Large Language Models | v6（2023-01-10） | https://arxiv.org/abs/2201.11903v6 | [`react-prehistory.md`](../research/react-prehistory.md) §2.2 |
| `2203.11171v4.pdf` | Self-Consistency Improves Chain of Thought Reasoning in Language Models | v4（ICLR 2023 camera ready，2023-03-07） | https://arxiv.org/abs/2203.11171v4 | [`react-prehistory.md`](../research/react-prehistory.md) §2.3、§6 |
| `2207.05608v1.pdf` | Inner Monologue: Embodied Reasoning through Planning with Language Models | v1（2022-07-12，单版本） | https://arxiv.org/abs/2207.05608v1 | [`react-prehistory.md`](../research/react-prehistory.md) §1、§4.3、§6 |
| `2205.11916v4.pdf` | Large Language Models are Zero-Shot Reasoners | v4（2023-03-14） | https://arxiv.org/abs/2205.11916v4 | [`react-prehistory.md`](../research/react-prehistory.md) §2.6、§4、§7 |

## 为什么固定版本号

arXiv 的 v1 与最终版可能差很多（ReAct 的 v1 与 v3 页数就不同）。文档里写的引文与页码只在**特定版本**上成立，所以文件名保留版本号，正文引用时也带版本号。换版本时要重新核对引文。

## 重新下载

```powershell
cd docs/ref
curl.exe -LO https://arxiv.org/pdf/2210.03629v3
curl.exe -LO https://arxiv.org/pdf/2204.01691v2
curl.exe -LO https://arxiv.org/pdf/2112.09332v3
curl.exe -LO https://arxiv.org/pdf/2201.11903v6
curl.exe -LO https://arxiv.org/pdf/2203.11171v4
curl.exe -LO https://arxiv.org/pdf/2207.05608v1
curl.exe -LO https://arxiv.org/pdf/2205.11916v4
```

## 提取正文的文本

本机装了 TeX Live，`pdftotext` 可用（`F:\Tex\texlive\2023\bin\windows\pdftotext.exe`）。提取时加 `-layout` 保留排版，否则表格会散：

```powershell
pdftotext -layout docs/ref/2210.03629v3.pdf /tmp/react.txt
```

注意两点：`pdftotext` 会把 ICLR 页眉页脚插进正文中间（搜索时可能被它挡住）；数学符号与花体字可能被解成错乱字符（ReAct 附录 A.2 就出现了这种情况）。**引语以 PDF 原文为准，不要直接引提取出来的文本。**
