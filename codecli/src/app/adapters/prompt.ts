import {
  ModelRequest,
} from "../../core/models.js";
import {
  PromptContext,
  type PromptRegistry,
} from "../prompt/registry.js";

/**
 * 所有 adapter 共用的 prompt 组合入口。没有 registry 时保持原请求，
 * 有 registry 时让自定义 section 真正进入 wire system message。
 */
export function applyPromptRegistry(
  request: ModelRequest,
  registry?: PromptRegistry,
): ModelRequest {
  if (!registry) {
    return request;
  }
  const rendered = registry.render(
    new PromptContext({
      system: request.system,
      tools: request.tools,
    }),
  );
  return new ModelRequest({
    messages: request.messages,
    system: rendered.trim() ? rendered : request.system,
    tools: request.tools,
  });
}
