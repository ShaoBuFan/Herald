/**
 * 采语料用的临时脚本（不是最终 adapter）：
 * 读一份 messages JSON，调用一次 DeepSeek chat completions，把原始响应写进 corpus/raw/。
 *
 * 用法：
 *   export DEEPSEEK_API_KEY=...
 *   node scripts/collect-corpus.ts --messages corpus/prompts/task-01.json --tag task-01
 *
 * 可选环境变量：DEEPSEEK_BASE_URL（默认 https://api.deepseek.com）、DEEPSEEK_MODEL（默认 deepseek-chat）。
 * 这是实验室工具：没有流式、没有工具调用重组、没有重试。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { parseMessagesFile } from '../model/prompt-file.ts'
import type { ChatMessage } from '../model/types.ts'

const corpusRawDir = fileURLToPath(new URL('../corpus/raw/', import.meta.url))
const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/+$/, '')
const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat'
const apiKey = process.env.DEEPSEEK_API_KEY

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function parseArgs(argv: string[]): { messagesPath: string; tag: string } {
  let messagesPath: string | undefined
  let tag = 'run'
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--messages') {
      messagesPath = argv[index + 1]
      index += 1
    } else if (arg === '--tag') {
      tag = argv[index + 1] ?? tag
      index += 1
    } else {
      fail(`未知参数：${arg}`)
    }
  }
  if (messagesPath === undefined) fail('缺少 --messages <messages.json>')
  return { messagesPath, tag }
}

function extractContent(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return undefined
  const first: unknown = choices[0]
  if (typeof first !== 'object' || first === null) return undefined
  const message = (first as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return undefined
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' ? content : undefined
}

const { messagesPath, tag } = parseArgs(process.argv.slice(2))
if (apiKey === undefined || apiKey === '') fail('缺少环境变量 DEEPSEEK_API_KEY')

const raw = await readFile(messagesPath, 'utf8')
let messages: ChatMessage[]
try {
  messages = parseMessagesFile(raw, messagesPath)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

const startedAt = new Date()
const response = await fetch(`${baseUrl}/chat/completions`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({ model, messages, stream: false }),
})

const body: unknown = await response.json().catch(() => undefined)
if (!response.ok) {
  fail(`请求失败：HTTP ${response.status}\n${JSON.stringify(body, null, 2)}`)
}

const record = { request: { model, messages }, response: body }
const stamp = startedAt.toISOString().replace(/[:.]/g, '-')
await mkdir(corpusRawDir, { recursive: true })
const outPath = `${corpusRawDir}${stamp}-${model}-${tag}.json`
await writeFile(outPath, JSON.stringify(record, null, 2), 'utf8')

const content = extractContent(body)
console.log(content ?? '(响应里没有 choices[0].message.content)')
console.log(`\n已写入 ${outPath}`)
