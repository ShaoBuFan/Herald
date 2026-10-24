import type { ChatMessage, ChatModel } from './types.ts'

/**
 * 用预置文本驱动的模型替身（测试替身，不联网）。
 *
 * 给它一串「模型会依次说什么」，它按顺序返回；同时记录每次调用收到的消息数组，
 * 方便断言 loop 到底往历史里追加了什么。解析失败的样本也直接用预置文本喂进来。
 */
export class ScriptedModel implements ChatModel {
  readonly #responses: string[]
  readonly #calls: ChatMessage[][] = []
  #next = 0

  constructor(responses: readonly string[]) {
    this.#responses = [...responses]
  }

  /** 已发生的调用，按发生顺序；每项是当次传入消息的浅拷贝。 */
  get calls(): readonly (readonly ChatMessage[])[] {
    return this.#calls
  }

  /** 还没被消费的预置响应数量。 */
  get remaining(): number {
    return this.#responses.length - this.#next
  }

  async chat(messages: readonly ChatMessage[]): Promise<string> {
    this.#calls.push([...messages])
    const response = this.#responses[this.#next]
    if (response === undefined) {
      throw new Error(`ScriptedModel 已耗尽：第 ${this.#next + 1} 次调用没有预置响应`)
    }
    this.#next += 1
    return response
  }
}
