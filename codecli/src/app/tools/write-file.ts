import path from "node:path";
import {
  mkdir,
  stat,
  writeFile as fsWriteFile,
} from "node:fs/promises";

import { Tool } from "../../core/tools/registry.js";
import {
  requireString,
  safePath,
  toBoolean,
} from "./shared.js";

export const WRITE_FILE_PARAMETERS = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "相对项目根目录的文件路径",
    },
    content: {
      type: "string",
      description: "要写入的完整文本内容",
    },
    overwrite: {
      type: "boolean",
      description: "文件已存在时是否覆盖，默认 false",
    },
  },
  required: ["path", "content"],
};

export async function writeFile(
  root: string,
  arguments_: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const requestedPath = requireString(
    arguments_["path"],
    "path",
  );
  const content = requireString(
    arguments_["content"],
    "content",
  );
  const filePath = await safePath(root, requestedPath);

  const exists = await stat(filePath)
    .then(() => true)
    .catch(() => false);
  if (exists && !toBoolean(arguments_["overwrite"], false)) {
    return {
      status: false,
      error: "File already exists; set overwrite=true",
    };
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await fsWriteFile(filePath, content, "utf8");

  return {
    status: true,
    path: path.relative(path.resolve(root), filePath),
    bytes_written: Buffer.byteLength(content, "utf8"),
  };
}

export function buildWriteFileTool(root: string): Tool {
  return new Tool(
    "write_file",
    "写入或覆盖项目内的文本文件。只在确实需要修改文件时使用。",
    WRITE_FILE_PARAMETERS,
    (arguments_) => writeFile(root, arguments_),
    "write",
  );
}
