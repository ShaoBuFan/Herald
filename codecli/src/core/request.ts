import {
  ModelRequest,
  type Message,
  type ToolSchema,
} from "./models.js";

export interface BuildRequestOptions {
  system: string;
  tools: ToolSchema[];
}

/**
 * 组装模型这一次调用看到的语义快照。
 *
 * 旧会话里可能仍有 system 消息；这里把它们丢掉，因为 system prompt
 * 只放在 ModelRequest.system。
 */
export function buildRequest(
  messages: Message[],
  options: BuildRequestOptions,
): ModelRequest {
  const conversation = messages.filter(
    (message) => message.role !== "system",
  );
  return new ModelRequest({
    messages: conversation,
    system: options.system,
    tools: options.tools,
  });
}
