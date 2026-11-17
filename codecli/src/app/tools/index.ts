import { ToolRegistry } from "../../core/tools/registry.js";
import { buildListFilesTool } from "./list-files.js";
import { buildReadFileTool } from "./read-file.js";
import { buildSearchTextTool } from "./search-text.js";
import { buildWriteFileTool } from "./write-file.js";

export { listFiles } from "./list-files.js";
export { readFile } from "./read-file.js";
export { searchText } from "./search-text.js";
export { safePath } from "./shared.js";
export { writeFile } from "./write-file.js";

/**
 * 组装标准文件工具集。顺序与 Python 参考实现一致：
 * list_files、read_file、search_text、write_file。
 */
export function createFileTools(root: string): ToolRegistry {
  return new ToolRegistry([
    buildListFilesTool(root),
    buildReadFileTool(root),
    buildSearchTextTool(root),
    buildWriteFileTool(root),
  ]);
}
