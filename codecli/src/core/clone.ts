/**
 * 在 API 边界深拷贝普通数据。
 *
 * 消息、工具 schema 和工具参数都应当是 JSON 形状。不要从这里传
 * 类实例或函数；那些属于 app 层。
 */
export function deepClone<T>(value: T): T {
  return structuredClone(value);
}
