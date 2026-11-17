import path from "node:path";
import { readFile as fsReadFile, stat } from "node:fs/promises";

import { Tool } from "../../core/tools/registry.js";
import {
  requireString,
  safePath,
  toInteger,
} from "./shared.js";

export const READ_FILE_PARAMETERS = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "相对项目根目录的文件路径",
    },
    max_bytes: {
      type: "integer",
      description: "最多读取的字节数，默认 100000",
    },
  },
  required: ["path"],
};

export async function readFile(
  root: string,
  arguments_: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const requestedPath = requireString(
    arguments_["path"],
    "path",
  );
  const filePath = await safePath(root, requestedPath);
  const info = await stat(filePath).catch(() => null);

  if (!info?.isFile()) {
    return { error: "File does not exist" };
  }

  const maxBytes = Math.max(
    0,
    toInteger(arguments_["max_bytes"], 100000),
  );
  const data = await fsReadFile(filePath);
  const truncated = data.length > maxBytes;
  const content = new TextDecoder("utf-8").decode(
    data.subarray(0, maxBytes),
  );

  return {
    path: path.relative(path.resolve(root), filePath),
    content,
    truncated,
  };
}

export function buildReadFileTool(root: string): Tool {
  return new Tool(
    "read_file",
    "读取项目内文本文件的内容。查看源码或文档时使用。",
    READ_FILE_PARAMETERS,
    (arguments_) => readFile(root, arguments_),
  );
}
