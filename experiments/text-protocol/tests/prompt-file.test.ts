import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { parseMessagesFile } from '../model/prompt-file.ts'

const SECTIONED = `# task-01

=== system ===
你是 agent。
=== user ===
读一下 README。
`

test('分段格式：解析为 system + user，并去掉首尾空白', () => {
  const messages = parseMessagesFile(SECTIONED, 'task-01.md')
  assert.deepEqual(messages, [
    { role: 'system', content: '你是 agent。' },
    { role: 'user', content: '读一下 README。' },
  ])
})

test('JSON 数组格式', () => {
  const text = JSON.stringify([
    { role: 'system', content: '规则' },
    { role: 'user', content: '任务' },
  ])
  const messages = parseMessagesFile(text, 'task.json')
  assert.equal(messages.length, 2)
  assert.equal(messages[1]?.content, '任务')
})

test('分段格式：缺少 user 段抛错', () => {
  assert.throws(() => parseMessagesFile('=== system ===\n规则\n', 'x.md'), /缺少 user 段/)
})

test('分段格式：空的 user 段抛错', () => {
  assert.throws(
    () => parseMessagesFile('=== system ===\n规则\n=== user ===\n   \n', 'x.md'),
    /user 段为空/,
  )
})

test('既没有 JSON 也没有分隔行时抛错', () => {
  assert.throws(() => parseMessagesFile('随便一段文字', 'x.md'), /没有 === system ===/)
})

test('JSON 里出现非法角色时抛错', () => {
  assert.throws(
    () => parseMessagesFile(JSON.stringify([{ role: 'tool', content: 'x' }]), 'x.json'),
    /必须是 \[{role, content}\] 数组/,
  )
})

test('仓库里的样例 prompt 都能解析', () => {
  for (const name of ['task-01.md', 'task-02.md', 'task-03.md']) {
    const path = new URL(`../corpus/prompts/${name}`, import.meta.url)
    const messages = parseMessagesFile(readFileSync(path, 'utf8'), name)
    assert.deepEqual(messages.map((message) => message.role), ['system', 'user'])
    assert.ok(messages[0]?.content.startsWith('你是一个在本地工作区里工作的 agent'))
  }
})
