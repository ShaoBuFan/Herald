import path from "node:path";
import { stat } from "node:fs/promises";

import { Tool } from "../../core/tools/registry.js";
import {
  safePath,
  toBoolean,
  toInteger,
  walk,
} from "./shared.js";

export const LIST_FILES_PARAMETERS = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "相对项目根目录的起始路径，默认 .",
    },
    pattern: {
      type: "string",
      description: "文件名通配符，默认 *",
    },
    recursive: {
      type: "boolean",
      description: "是否递归子目录，默认 true",
    },
    limit: {
      type: "integer",
      description: "最多返回条目数，默认 200",
    },
  },
};

export async function listFiles(
  root: string,
  arguments_: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const requestedPath =
    typeof arguments_["path"] === "string" &&
    arguments_["path"] !== ""
      ? arguments_["path"]
      : ".";
  const base = await safePath(root, requestedPath);

  const exists = await stat(base)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    return { error: "Path does not exist" };
  }

  const pattern =
    typeof arguments_["pattern"] === "string" &&
    arguments_["pattern"] !== ""
      ? arguments_["pattern"]
      : "*";
  const recursive = toBoolean(arguments_["recursive"], true);
  const limit = Math.max(0, toInteger(arguments_["limit"], 200));

  const files: string[] = [];
  const directories: string[] = [];

  for await (const entry of walk(base, recursive, pattern)) {
    if (files.length + directories.length >= limit) {
      break;
    }
    const info = await stat(entry).catch(() => null);
    if (!info) {
      continue;
    }
    const relative = path.relative(
      path.resolve(root),
      entry,
    );
    if (info.isDirectory()) {
      directories.push(relative);
    } else {
      files.push(relative);
    }
  }

  return {
    files,
    directories,
    file_count: files.length,
    directory_count: directories.length,
    truncated: files.length + directories.length >= limit,
  };
}

export function buildListFilesTool(root: string): Tool {
  return new Tool(
    "list_files",
    "列出项目内的文件与目录，用于了解项目结构。",
    LIST_FILES_PARAMETERS,
    (arguments_) => listFiles(root, arguments_),
  );
}
