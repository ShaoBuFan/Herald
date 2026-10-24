/**
 * 本实验室的传输层词汇：一个只有 role / content 的 chat API。
 *
 * 这是「wire 格式」，不是 agent 的内部协议。内部协议（动作、观察、终止）
 * 由作者在 protocol/ 与 loop/ 中定义。
 */

/** chat API 允许的角色。 */
export type ChatRole = 'system' | 'user' | 'assistant'

/** chat API 的一条消息。 */
export interface ChatMessage {
  role: ChatRole
  content: string
}

/** 一个「消息数组 → assistant 文本」的模型。 */
export interface ChatModel {
  chat(messages: readonly ChatMessage[]): Promise<string>
}
