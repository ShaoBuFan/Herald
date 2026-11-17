import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdir,
  mkdtemp,
  readFile as fsReadFile,
  realpath,
  rm,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createFileTools,
  listFiles,
  readFile,
  safePath,
  searchText,
  writeFile,
} from "../src/app/tools/index.js";

async function withTempDir(
  callback: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(
    path.join(tmpdir(), "codecli-tools-"),
  );
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("safePath allows the root and rejects escapes", async () => {
  await withTempDir(async (root) => {
    assert.equal(
      await safePath(root, "."),
      await realpath(root),
    );

    await assert.rejects(
      () => safePath(root, "../outside.txt"),
      /Path escapes project root/,
    );
    await assert.rejects(
      () =>
        safePath(
          root,
          path.join(root, "..", "outside.txt"),
        ),
      /Path escapes project root/,
    );
  });
});

test("readFile returns content, truncation, and missing errors", async () => {
  await withTempDir(async (root) => {
    await fsWriteFile(path.join(root, "a.txt"), "hello", "utf8");

    const full = await readFile(root, { path: "a.txt" });
    assert.equal(full["path"], "a.txt");
    assert.equal(full["content"], "hello");
    assert.equal(full["truncated"], false);

    const partial = await readFile(root, {
      path: "a.txt",
      max_bytes: 2,
    });
    assert.equal(partial["content"], "he");
    assert.equal(partial["truncated"], true);

    const missing = await readFile(root, { path: "nope.txt" });
    assert.deepEqual(missing, { error: "File does not exist" });
  });
});

test("writeFile creates, refuses overwrite, and overwrites", async () => {
  await withTempDir(async (root) => {
    const created = await writeFile(root, {
      path: "nested/a.txt",
      content: "hello",
    });
    assert.equal(created["status"], true);
    assert.equal(created["bytes_written"], 5);
    assert.equal(
      await fsReadFile(path.join(root, "nested", "a.txt"), "utf8"),
      "hello",
    );

    const refused = await writeFile(root, {
      path: "nested/a.txt",
      content: "changed",
    });
    assert.equal(refused["status"], false);
    assert.match(
      String(refused["error"]),
      /File already exists/,
    );

    const overwritten = await writeFile(root, {
      path: "nested/a.txt",
      content: "changed",
      overwrite: true,
    });
    assert.equal(overwritten["status"], true);
    assert.equal(
      await fsReadFile(path.join(root, "nested", "a.txt"), "utf8"),
      "changed",
    );
  });
});

test("listFiles honors pattern, recursion, limit, and ignores", async () => {
  await withTempDir(async (root) => {
    await mkdir(path.join(root, "dir", "sub"), {
      recursive: true,
    });
    await mkdir(path.join(root, "node_modules"), {
      recursive: true,
    });
    await fsWriteFile(path.join(root, "a.txt"), "a");
    await fsWriteFile(path.join(root, "b.py"), "b");
    await fsWriteFile(path.join(root, "dir", "c.txt"), "c");
    await fsWriteFile(path.join(root, "dir", "sub", "d.md"), "d");
    await fsWriteFile(
      path.join(root, "node_modules", "ignored.txt"),
      "ignored",
    );

    const all = await listFiles(root, { path: "." });
    assert.deepEqual(
      (all["files"] as string[]).sort(),
      [
        "a.txt",
        "b.py",
        path.join("dir", "c.txt"),
        path.join("dir", "sub", "d.md"),
      ].sort(),
    );
    assert.deepEqual(
      (all["directories"] as string[]).sort(),
      [path.join("dir"), path.join("dir", "sub")].sort(),
    );
    assert.equal(all["file_count"], 4);
    assert.equal(all["directory_count"], 2);
    assert.equal(all["truncated"], false);

    const txt = await listFiles(root, {
      path: ".",
      pattern: "*.txt",
    });
    assert.deepEqual(
      (txt["files"] as string[]).sort(),
      ["a.txt", path.join("dir", "c.txt")].sort(),
    );

    const shallow = await listFiles(root, {
      path: ".",
      recursive: false,
    });
    assert.deepEqual(
      (shallow["files"] as string[]).sort(),
      ["a.txt", "b.py"].sort(),
    );
    assert.deepEqual(
      (shallow["directories"] as string[]).sort(),
      [path.join("dir")].sort(),
    );

    const limited = await listFiles(root, {
      path: ".",
      limit: 1,
    });
    assert.equal(
      (limited["files"] as string[]).length +
        (limited["directories"] as string[]).length,
      1,
    );
    assert.equal(limited["truncated"], true);

    const missing = await listFiles(root, {
      path: "missing",
    });
    assert.deepEqual(missing, {
      error: "Path does not exist",
    });
  });
});

test("searchText finds lines, honors limit, and skips invalid UTF-8", async () => {
  await withTempDir(async (root) => {
    await mkdir(path.join(root, "sub"), { recursive: true });
    await fsWriteFile(
      path.join(root, "a.txt"),
      "hello\nworld\nhello",
    );
    await fsWriteFile(
      path.join(root, "sub", "b.txt"),
      "HELLO\nhello",
    );
    await fsWriteFile(
      path.join(root, "bad.bin"),
      Buffer.from([0xff, 0xfe, 0x00]),
    );

    const result = await searchText(root, {
      keyword: "hello",
    });
    const results = result["results"] as Array<{
      path: string;
      line: number;
      text: string;
    }>;
    assert.equal(results.length, 3);
    assert.equal(result["truncated"], false);
    assert.deepEqual(
      results.map((item) => [item.path, item.line, item.text]).sort(),
      [
        ["a.txt", 1, "hello"],
        ["a.txt", 3, "hello"],
        [path.join("sub", "b.txt"), 2, "hello"],
      ].sort(),
    );

    const limited = await searchText(root, {
      keyword: "hello",
      limit: 1,
    });
    assert.equal(
      (limited["results"] as unknown[]).length,
      1,
    );
    assert.equal(limited["truncated"], true);

    const upper = await searchText(root, {
      keyword: "HELLO",
    });
    const upperResults = upper["results"] as Array<{
      path: string;
      line: number;
    }>;
    assert.equal(upperResults.length, 1);
    assert.equal(upperResults[0]?.path, path.join("sub", "b.txt"));
  });
});

test("createFileTools registers the standard tools in order", () => {
  const registry = createFileTools(process.cwd());
  assert.deepEqual(
    registry.listTools().map((tool) => tool.name),
    ["list_files", "read_file", "search_text", "write_file"],
  );
});
