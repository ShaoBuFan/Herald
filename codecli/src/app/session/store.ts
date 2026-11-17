import path from "node:path";
import { mkdirSync } from "node:fs";
import {
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";

import { InMemoryMessageStore } from "../../core/stores/memory.js";
import type {
  Message,
  ToolCall,
} from "../../core/models.js";

export const SCHEMA_VERSION = 2;
const DEFAULT_TITLE = "未命名";

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function tryJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * 把旧文本协议消息转换成语义 transcript。
 * 保留它只为读取 Python 参考实现写下的 version 1 会话。
 */
export function migrateHistory(history: unknown[]): Message[] {
  const migrated: Message[] = [];

  for (const message of history) {
    if (!isRecord(message)) {
      continue;
    }
    const role = message["role"];
    const content = message["content"] ?? "";

    if (role === "system") {
      continue;
    }

    if (role === "user") {
      const payload = tryJson(content);
      if (
        isRecord(payload) &&
        payload["type"] === "tool_result"
      ) {
        const results = payload["results"];
        if (Array.isArray(results)) {
          for (const item of results) {
            if (!isRecord(item)) {
              continue;
            }
            migrated.push({
              role: "tool",
              tool_call_id: String(item["id"] ?? ""),
              name: String(item["tool"] ?? ""),
              data: item["data"],
              error:
                item["error"] === undefined ||
                item["error"] === null
                  ? null
                  : String(item["error"]),
            });
          }
        }
        continue;
      }

      migrated.push({
        role: "user",
        content: asText(content),
      });
      continue;
    }

    if (role === "assistant") {
      const payload = tryJson(content);
      if (
        isRecord(payload) &&
        ("final" in payload || "tool_calls" in payload)
      ) {
        const thought = String(payload["thought"] ?? "");
        if ("tool_calls" in payload) {
          const calls: ToolCall[] = [];
          const rawCalls = payload["tool_calls"];
          if (Array.isArray(rawCalls)) {
            rawCalls.forEach((call, index) => {
              if (!isRecord(call)) {
                return;
              }
              calls.push({
                id: String(call["id"] ?? index),
                name: String(call["tool"] ?? ""),
                arguments: isRecord(call["arguments"])
                  ? call["arguments"]
                  : {},
              });
            });
          }
          migrated.push({
            role: "assistant",
            content: "",
            thought,
            tool_calls: calls,
          });
        } else {
          migrated.push({
            role: "assistant",
            content: String(payload["final"] ?? ""),
            thought,
            tool_calls: [],
          });
        }
      } else {
        migrated.push({
          role: "assistant",
          content: asText(content),
          thought: "",
          tool_calls: [],
          raw: true,
        });
      }
      continue;
    }

    if (role === "tool") {
      migrated.push(message as unknown as Message);
    }
  }

  return migrated;
}

export interface SessionEntry {
  path: string;
  title: string;
}

export class SessionStore extends InMemoryMessageStore {
  readonly directory: string;
  currentFile: string | null = null;
  title = DEFAULT_TITLE;

  constructor(directory: string) {
    super();
    this.directory = directory;
    mkdirSync(directory, { recursive: true });
  }

  clear(): void {
    this.currentFile = null;
    this.title = DEFAULT_TITLE;
    this.replaceMessages([]);
  }

  async save(title?: string): Promise<string> {
    if (title) {
      this.title = title;
    }

    if (this.currentFile === null) {
      const safeTitle = this.title
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/\s+/g, "_");
      this.currentFile = path.join(
        this.directory,
        `conversation_${Math.floor(Date.now() / 1000)}_${safeTitle}.json`,
      );
    }

    const payload = {
      version: SCHEMA_VERSION,
      title: this.title,
      history: this.getMessages(),
    };
    await writeFile(
      this.currentFile,
      JSON.stringify(payload, null, 2),
      "utf8",
    );
    return this.currentFile;
  }

  async sessions(): Promise<SessionEntry[]> {
    const names = await readdir(this.directory);
    const files = names
      .filter(
        (name) =>
          name.startsWith("conversation_") &&
          name.endsWith(".json"),
      )
      .sort((a, b) => a.localeCompare(b));

    const result: SessionEntry[] = [];
    for (const name of files) {
      const filePath = path.join(this.directory, name);
      const stem = path.basename(name, ".json");
      try {
        const data = JSON.parse(
          await readFile(filePath, "utf8"),
        ) as unknown;
        const title =
          isRecord(data) && typeof data["title"] === "string"
            ? data["title"]
            : stem;
        result.push({ path: filePath, title });
      } catch {
        result.push({ path: filePath, title: stem });
      }
    }
    return result;
  }

  async load(filePath: string): Promise<boolean> {
    try {
      const data = JSON.parse(
        await readFile(filePath, "utf8"),
      ) as unknown;
      if (!isRecord(data)) {
        return false;
      }

      let history: unknown[] = Array.isArray(data["history"])
        ? data["history"]
        : [];
      const version =
        typeof data["version"] === "number"
          ? data["version"]
          : 1;
      if (version < SCHEMA_VERSION) {
        history = migrateHistory(history);
      }

      this.replaceMessages(history as Message[]);
      this.title =
        typeof data["title"] === "string"
          ? data["title"]
          : path.basename(filePath, ".json");
      this.currentFile = filePath;
      return true;
    } catch {
      return false;
    }
  }
}
