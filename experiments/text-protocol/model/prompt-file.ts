import type { ChatMessage } from './types.ts'

const SECTION_HEADER = /^=== (system|user|assistant) ===[ \t]*\r?$/gm

export function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { role?: unknown; content?: unknown }
  return (
    (candidate.role === 'system' || candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.content === 'string'
  )
}

function parseJsonMessages(text: string, source: string): ChatMessage[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`${source}: JSON 解析失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!Array.isArray(parsed) || !parsed.every(isChatMessage)) {
    throw new Error(`${source}: JSON 必须是 [{role, content}] 数组`)
  }
  return parsed
}

function parseSectionedMessages(text: string, source: string): ChatMessage[] {
  const headers = [...text.matchAll(SECTION_HEADER)]
  if (headers.length === 0) {
    throw new Error(`${source}: 既不是 JSON 数组，也没有 === system === / === user === 分隔行`)
  }

  const messages: ChatMessage[] = []
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index]
    if (header === undefined || header.index === undefined) {
      throw new Error(`${source}: 无法定位分隔行`)
    }
    const role = header[1]
    if (role !== 'system' && role !== 'user' && role !== 'assistant') {
      throw new Error(`${source}: 非法角色 ${String(role)}`)
    }
    const start = header.index + header[0].length
    const next = headers[index + 1]
    const end = next?.index ?? text.length
    const content = text.slice(start, end).trim()
    if (content === '') throw new Error(`${source}: ${role} 段为空`)
    messages.push({ role, content })
  }

  if (!messages.some((message) => message.role === 'user')) {
    throw new Error(`${source}: 缺少 user 段`)
  }
  return messages
}

/**
 * 读取一个 prompt 文件，支持两种格式：
 *
 * 1. 分段格式（推荐手写）：
 *    === system ===
 *    ...
 *    === user ===
 *    ...
 *
 * 2. JSON 数组：[{role, content}, ...]
 */
export function parseMessagesFile(text: string, source = '<prompt>'): ChatMessage[] {
  if (text.trimStart().startsWith('[')) return parseJsonMessages(text.trim(), source)
  return parseSectionedMessages(text, source)
}
