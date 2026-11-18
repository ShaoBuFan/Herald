import { ToolRegistry } from "../../core/tools/registry.js";
import { buildBashTool } from "./bash.js";
import { buildEditTool } from "./edit.js";
import { buildGlobTool } from "./glob.js";
import { buildListFilesTool } from "./list-files.js";
import { buildReadFileTool } from "./read-file.js";
import { buildSearchTextTool } from "./search-text.js";
import { buildTodoWriteTool } from "./todo.js";
import { buildWriteFileTool } from "./write-file.js";

export { runBash } from "./bash.js";
export { editFile } from "./edit.js";
export { globFiles, globToRegExp } from "./glob.js";
export { listFiles } from "./list-files.js";
export { readFile } from "./read-file.js";
export { searchText } from "./search-text.js";
export { safePath } from "./shared.js";
export {
  countTodos,
  normalizeTodos,
  todosFromToolResult,
  writeTodos,
} from "./todo.js";
export type { TodoCounts, TodoItem, TodoStatus } from "./todo.js";
export { writeFile } from "./write-file.js";

/**
 * 组装标准工作区工具集。顺序会进入模型可见的工具目录。
 */
export function createWorkspaceTools(root: string): ToolRegistry {
  return new ToolRegistry([
    buildListFilesTool(root),
    buildGlobTool(root),
    buildReadFileTool(root),
    buildSearchTextTool(root),
    buildWriteFileTool(root),
    buildEditTool(root),
    buildBashTool(root),
    buildTodoWriteTool(),
  ]);
}

/** 兼容旧入口；新代码应使用 createWorkspaceTools。 */
export const createFileTools = createWorkspaceTools;
