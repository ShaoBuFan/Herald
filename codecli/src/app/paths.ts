import os from "node:os";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

export const PROJECT_ROOT = path.resolve(process.cwd());
export const APP_DATA_DIR = path.join(
  process.env["APPDATA"] ??
    path.join(os.homedir(), ".local", "share"),
  "chat-cli",
);
export const CONFIG_PATH = path.join(
  APP_DATA_DIR,
  "data",
  "config.json",
);
export const SESSIONS_DIR = path.join(APP_DATA_DIR, "sessions");
export const RESPONSE_PATH = path.join(
  APP_DATA_DIR,
  "response.md",
);
export const LOG_DIR = path.join(APP_DATA_DIR, "logs");
export const PROMPT_PATH = path.join(
  PROJECT_ROOT,
  "data",
  "prompt.json",
);

/** 与 Python 参考实现一致：把最后一次终答落盘。 */
export function saveResponse(text: string): void {
  mkdirSync(path.dirname(RESPONSE_PATH), { recursive: true });
  writeFileSync(RESPONSE_PATH, text, "utf8");
}
