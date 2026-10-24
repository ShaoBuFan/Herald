# 文本协议实验室

验证一个问题：**对于只有 `[{role, content}]` 的 chat API（无 tools、无 tool_calls、无 thinking / finish_reason 等元数据），能否实现一个 agent？难点是否就在格式定义与解析兜底。**

这不是产品，是实验区。

## 计划产出

1. 一份格式规范 + 错误分类（**已就绪**：[`protocol/FORMAT.md`](protocol/FORMAT.md) locked v0.5）
2. 真实模型输出的语料 + 格式服从率（脚本采集，待跑）
3. parser + 最小循环：Python 原型已可跑（[`python/`](python/README.md)）；TS 版由作者写
4. 对 `LlmAdapter` 边界的判断：文本协议下 loop 需要改多少

## 边界

- **实验区，可整体删除**。在 `AGENTS.md` 中仅作为实验室登记（不参与正式工程约定），不接 pnpm workspace。
- **零运行时依赖**：Node 24 原生 TS 剥离 + `node:test`，无需 install。
- 结论（是否保留、代价是什么）由作者写进 `docs/decisions/`。

## 目录

```text
experiments/text-protocol/
  README.md
  package.json
  protocol/         # FORMAT.md（规范）/ PROMPT.md（prompt 契约）/ EXAMPLE.md（交互样例）
  corpus/           # prompts/（样例任务）+ raw/（真实模型输出）
  python/           # Python 最小实现（DeepSeek，纯标准库）
  model/            # 传输层类型 + ScriptedModel（测试替身）
  tests/            # TS 测试；语料 fixtures 后续加在这里
  scripts/          # 采语料的临时脚本
  loop/             # 待作者创建：TS 版最小循环 + 错误策略
```

`loop/` 目前不存在——TS 版最小循环等作者写；`protocol/` 与 `python/` 已就绪。

## 怎么跑

```sh
cd experiments/text-protocol
node --test --test-isolation=none
```

零安装步骤。`node --version` 需要 >= 24（本机 v24.19.0）。

也可以直接跑单个文件：`node tests/smoke.test.ts`。注意默认的 `node --test` 会为每个测试文件 spawn 子进程，在受限沙箱（比如 DSH 会话内）会报 `spawn EPERM`，所以脚本固定用 `--test-isolation=none` 让测试在同进程执行；普通终端里两种都可以。

## 实验室约定（与正式工程有差异）

- **本地导入带 `.ts` 后缀**（`import { x } from './y.ts'`）。Node 原生运行 TS 要求如此；正式工程用 `.js` 后缀（tsc 编译后）。
- **类型只剥离、不检查**。想要 `strict` + `noUncheckedIndexedAccess`，再加 `typescript` 跑 `tsc --noEmit`（做这个决定前先问：这个实验需要类型检查吗）。
- 不用 `enum` / `namespace` / 参数属性——Node 剥离模式不支持。
- 只导入类型时写 `import type { X }` 或 `import { type X }`，否则运行时会去找值。
- 不用第三方依赖。

## Python 原型（快速验证）

`python/mini_agent.py` 是按 FORMAT v0.5 实现的最小 agent：DeepSeek + 只有 role/content 的 API，纯标准库。

```sh
cd experiments/text-protocol/python
$env:DEEPSEEK_API_KEY = "..."          # bash: export DEEPSEEK_API_KEY=...
# 或者：cp .env.example .env 然后填入 key（.env 已 gitignore）
python mini_agent.py "读一下 README.md 并总结" --workspace ..
```

离线测试（不联网，`chat` 打桩）：`python -m unittest test_mini_agent -v`（22 个用例）。

这是实验原型，不是 Herald 的正式实现；细节与限制见 [`python/README.md`](python/README.md)。

## 采语料

1. 任务写在 `corpus/prompts/task-XX.md`，格式见 [`corpus/README.md`](corpus/README.md)（已有 task-01/02/03 三个样例）。
2. `export DEEPSEEK_API_KEY=...`（不进仓库）。
3. `node scripts/collect-corpus.ts --messages corpus/prompts/task-01.md --tag task-01`
4. 原始响应写进 `corpus/raw/`，stdout 同时打印文本内容。

一次完整交互与失败分支的样例见 [`protocol/EXAMPLE.md`](protocol/EXAMPLE.md)。

`scripts/collect-corpus.ts` 是采集工具，**不是最终 adapter**：没有流式、没有工具调用重组、没有重试。adapter 由作者写。

## 里程碑

- [x] **M0 环境就绪**：零依赖跑通 `node --test --test-isolation=none`，`ScriptedModel` 可用
- [ ] **M1 语料**：采集 20 条真实输出，统计格式服从率（规范、prompt 样例、Python 原型已就绪，待真实语料）
- [ ] **M2 parser**：四个失败分支（无动作 / 语法错 / schema 错 / 截断）的测试先于实现
- [ ] **M3 最小 loop**：`ScriptedModel` 驱动，离线跑通"动作 → 执行 → 观察 → 继续"
- [ ] **M4（可选）对照**：同一模型 native tools vs 文本协议，比较成功率、步数、token

## 删除条件

满足任一条就记录结论、删除本目录：

- M1 的服从率低于可接受阈值，且换模型/换格式也没有改善空间
- M3 证明 loop 必须为协议大改（说明 adapter 边界不成立），结论比实验本身重要
- 阶段一正式开始，且这个实验不能作为它的测试夹具复用
