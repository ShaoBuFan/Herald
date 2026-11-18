import path from "node:path";
import { stat } from "node:fs/promises";

import { Tool } from "../../core/tools/registry.js";
import {
  requireString,
  safePath,
  toInteger,
  walk,
} from "./shared.js";

export const GLOB_PARAMETERS = {
  type: "object",
  properties: {
    pattern: {
      type: "string",
      description: "glob 模式，例如 **/*.ts 或 src/*.tsx",
    },
    path: {
      type: "string",
      description: "相对项目根目录的起始路径，默认 .",
    },
    limit: {
      type: "integer",
      description: "最多返回文件数，默认 200",
    },
  },
  required: ["pattern"],
};

/**
 * 把 glob 转成路径正则。支持 **、*、? 和简单的 [] 字符组；
 * 匹配对象是使用 / 分隔的相对路径。
 */
export function globToRegExp(pattern: string): RegExp {
  const normalized = pattern
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
  let source = "^";

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]!;
    if (character === "*") {
      if (normalized[index + 1] === "*") {
        index += 1;
        if (normalized[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (character === "?") {
      source += "[^/]";
    } else if (character === "[") {
      const end = normalized.indexOf("]", index + 1);
      if (end === -1) {
        source += "\\[";
      } else {
        let content = normalized.slice(index + 1, end);
        if (content.startsWith("!")) {
          content = `^${content.slice(1)}`;
        }
        source += `[${content}]`;
        index = end;
      }
    } else if ("\\.^$+{}()|".includes(character)) {
      source += `\\${character}`;
    } else {
      source += character;
    }
  }

  source += "$";
  return new RegExp(source);
}

export async function globFiles(
  root: string,
  arguments_: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const pattern = requireString(
    arguments_["pattern"],
    "pattern",
  );
  const requestedPath =
    typeof arguments_["path"] === "string" &&
    arguments_["path"] !== ""
      ? arguments_["path"]
      : ".";
  const base = await safePath(root, requestedPath);
  const limit = Math.max(
    0,
    toInteger(arguments_["limit"], 200),
  );

  const baseInfo = await stat(base).catch(() => null);
  if (!baseInfo?.isDirectory()) {
    return { error: "Path does not exist or is not a directory" };
  }

  const matcher = globToRegExp(pattern);
  const matchBasename =
    !pattern.includes("/") && !pattern.includes("**");
  const files: string[] = [];

  for await (const entry of walk(base, true, "*")) {
    if (files.length >= limit) {
      break;
    }
    const info = await stat(entry).catch(() => null);
    if (!info?.isFile()) {
      continue;
    }
    const relative = path
      .relative(path.resolve(root), entry)
      .split(path.sep)
      .join("/");
    const candidate = matchBasename
      ? path.basename(entry)
      : relative;
    if (matcher.test(candidate)) {
      files.push(relative);
    }
  }

  files.sort((left, right) => left.localeCompare(right));
  return {
    files,
    count: files.length,
    truncated: files.length >= limit,
  };
}

export function buildGlobTool(root: string): Tool {
  return new Tool(
    "glob",
    "按 glob 模式查找项目内的文件路径，用于快速定位文件。",
    GLOB_PARAMETERS,
    (arguments_) => globFiles(root, arguments_),
    "read",
  );
}
