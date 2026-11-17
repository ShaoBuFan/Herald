import path from "node:path";
import { readdir, realpath, stat } from "node:fs/promises";

export const IGNORED = new Set([
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  "node_modules",
  "dist",
  "build",
  ".idea",
  ".vscode",
]);

/**
 * 尽可能解析目标路径中已存在的部分，再拼回不存在的尾部。
 * `fs.realpath` 对不存在的写入目标会失败，但围栏仍需要解析
 * 已存在前缀里的符号链接。
 */
async function realpathLoose(target: string): Promise<string> {
  let current = path.resolve(target);
  const tail: string[] = [];

  for (;;) {
    try {
      const resolved = await realpath(current);
      return path.join(resolved, ...[...tail].reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error(`cannot resolve path: ${target}`);
      }
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

export async function safePath(
  root: string,
  relative: string,
): Promise<string> {
  if (typeof relative !== "string") {
    throw new Error("path must be a string");
  }

  const rootResolved = await realpathLoose(root);
  const candidate = await realpathLoose(
    path.resolve(rootResolved, relative),
  );
  const rel = path.relative(rootResolved, candidate);

  if (rel === "") {
    return candidate;
  }
  if (
    rel === ".." ||
    rel.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rel)
  ) {
    throw new Error(`Path escapes project root: ${relative}`);
  }
  return candidate;
}

export async function* walk(
  base: string,
  recursive: boolean,
  pattern: string,
): AsyncGenerator<string> {
  let info;
  try {
    info = await stat(base);
  } catch {
    return;
  }

  if (info.isFile()) {
    if (matchesPattern(path.basename(base), pattern)) {
      yield base;
    }
    return;
  }

  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  const directories = entries.filter(
    (entry) => entry.isDirectory() && !IGNORED.has(entry.name),
  );
  const files = entries.filter((entry) => !entry.isDirectory());

  for (const entry of [...directories, ...files]) {
    const fullPath = path.join(base, entry.name);
    if (matchesPattern(entry.name, pattern)) {
      yield fullPath;
    }
  }

  if (!recursive) {
    return;
  }

  for (const directory of directories) {
    yield* walk(
      path.join(base, directory.name),
      true,
      pattern,
    );
  }
}

export function matchesPattern(
  name: string,
  pattern: string,
): boolean {
  let source = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "*") {
      source += ".*";
    } else if (character === "?") {
      source += ".";
    } else if (character === "[") {
      const end = pattern.indexOf("]", index + 1);
      if (end === -1) {
        source += "\\[";
      } else {
        let content = pattern.slice(index + 1, end);
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
  return new RegExp(source, "s").test(name);
}

export function toInteger(
  value: unknown,
  fallback: number,
): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`expected an integer, got ${String(value)}`);
  }
  return Math.trunc(parsed);
}

export function toBoolean(
  value: unknown,
  fallback: boolean,
): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return String(value).toLowerCase() === "true";
}

export function requireString(
  value: unknown,
  name: string,
): string {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  return value;
}
