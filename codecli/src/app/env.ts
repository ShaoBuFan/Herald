import { existsSync, readFileSync } from "node:fs";

/**
 * 最小 .env 读取器：支持注释、空行和 KEY=VALUE。
 * 已存在的环境变量优先。
 */
export function loadDotEnv(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function loadEnvFiles(paths: string[]): void {
  for (const filePath of paths) {
    loadDotEnv(filePath);
  }
}
