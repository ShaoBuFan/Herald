import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ScriptedModel } from '../model/scripted-model.ts'
import type { ChatMessage } from '../model/types.ts'

test('工具链就绪：Node 原生剥离 TS 类型后可直接运行测试', () => {
  assert.equal(typeof ScriptedModel, 'function')
})

test('ScriptedModel 按顺序返回预置响应，并记录每次调用收到的消息', async () => {
  const model = new ScriptedModel(['第一响应', '第二响应'])
  const first: ChatMessage[] = [
    { role: 'system', content: '规则' },
    { role: 'user', content: '任务' },
  ]
  const second: ChatMessage[] = [...first, { role: 'assistant', content: '第一响应' }]

  assert.equal(await model.chat(first), '第一响应')
  assert.equal(await model.chat(second), '第二响应')
  assert.equal(model.calls.length, 2)
  assert.deepEqual(model.calls[0], first)
  assert.deepEqual(model.calls[1], second)
  assert.equal(model.remaining, 0)
})

test('ScriptedModel 耗尽时抛出可读错误', async () => {
  const model = new ScriptedModel([])
  await assert.rejects(() => model.chat([{ role: 'user', content: 'hi' }]), /已耗尽/)
})
