import path from "node:path";
import { readFile as fsReadFile, stat } from "node:fs/promises";

import { Tool } from "../../core/tools/registry.js";
import {
  requireString,
  safePath,
  toInteger,
  walk,
} from "./shared.js";

export const SEARCH_TEXT_PARAMETERS = {
  type: "object",
  properties: {
    keyword: {
      type: "string",
      description: "要搜索的文本关键字",
    },
    path: {
      type: "string",
      description: "相对项目根目录的起始路径，默认 .",
    },
    limit: {
      type: "integer",
      description: "最多返回的匹配行数，默认 100",
    },
  },
  required: ["keyword"],
};

function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (
    lines.length > 0 &&
    lines[lines.length - 1] === "" &&
    /(?:\r\n|\r|\n)$/.test(text)
  ) {
    lines.pop();
  }
  return lines;
}

export async function searchText(
  root: string,
  arguments_: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const keyword = requireString(
    arguments_["keyword"],
    "keyword",
  );
  const requestedPath =
    typeof arguments_["path"] === "string" &&
    arguments_["path"] !== ""
      ? arguments_["path"]
      : ".";
  const base = await safePath(root, requestedPath);
  const limit = Math.max(0, toInteger(arguments_["limit"], 100));

  const results: Array<{
    path: string;
    line: number;
    text: string;
  }> = [];

  for await (const entry of walk(base, true, "*")) {
    if (results.length >= limit) {
      break;
    }

    const info = await stat(entry).catch(() => null);
    if (!info?.isFile()) {
      continue;
    }

    const buffer = await fsReadFile(entry).catch(() => null);
    if (!buffer) {
      continue;
    }

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        buffer,
      );
    } catch {
      continue;
    }

    const lines = splitLines(text);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (line.includes(keyword)) {
        results.push({
          path: path.relative(path.resolve(root), entry),
          line: index + 1,
          text: line.trim(),
        });
        if (results.length >= limit) {
          break;
        }
      }
    }
  }

  return {
    results,
    truncated: results.length >= limit,
  };
}

export function buildSearchTextTool(root: string): Tool {
  return new Tool(
    "search_text",
    "在项目内文本文件中按关键字搜索，返回匹配行。",
    SEARCH_TEXT_PARAMETERS,
    (arguments_) => searchText(root, arguments_),
  );
}
