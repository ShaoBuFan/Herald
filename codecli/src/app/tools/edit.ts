import path from "node:path";
import {
  readFile as fsReadFile,
  stat,
  writeFile as fsWriteFile,
} from "node:fs/promises";

import { Tool } from "../../core/tools/registry.js";
import {
  requireString,
  safePath,
  toBoolean,
} from "./shared.js";

export const EDIT_PARAMETERS = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "相对项目根目录的文件路径",
    },
    old_string: {
      type: "string",
      description: "要被替换的原文，必须与文件内容完全一致",
    },
    new_string: {
      type: "string",
      description: "替换后的文本",
    },
    replace_all: {
      type: "boolean",
      description: "是否替换所有匹配，默认 false",
    },
  },
  required: ["path", "old_string", "new_string"],
};

export async function editFile(
  root: string,
  arguments_: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const requestedPath = requireString(
    arguments_["path"],
    "path",
  );
  const oldString = requireString(
    arguments_["old_string"],
    "old_string",
  );
  const newString = requireString(
    arguments_["new_string"],
    "new_string",
  );
  const replaceAll = toBoolean(
    arguments_["replace_all"],
    false,
  );

  if (!oldString) {
    return { error: "old_string must not be empty" };
  }

  const filePath = await safePath(root, requestedPath);
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) {
    return { error: "File does not exist" };
  }

  const data = await fsReadFile(filePath);
  let content: string;
  try {
    content = new TextDecoder("utf-8", {
      fatal: true,
    }).decode(data);
  } catch {
    return { error: "File is not valid UTF-8" };
  }

  const occurrences = content.split(oldString).length - 1;
  if (occurrences === 0) {
    return { error: "old_string not found" };
  }
  if (occurrences > 1 && !replaceAll) {
    return {
      error:
        `old_string matches ${occurrences} places; ` +
        "set replace_all or include more context",
    };
  }

  const updated = replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString);
  await fsWriteFile(filePath, updated, "utf8");

  return {
    status: true,
    path: path.relative(path.resolve(root), filePath),
    replacements: replaceAll ? occurrences : 1,
    bytes_written: Buffer.byteLength(updated, "utf8"),
  };
}

export function buildEditTool(root: string): Tool {
  return new Tool(
    "edit",
    "对项目内文本文件做精确字符串替换；修改已有文件时优先使用。",
    EDIT_PARAMETERS,
    (arguments_) => editFile(root, arguments_),
    "write",
  );
}
