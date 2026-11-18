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
  createWorkspaceTools,
  editFile,
  globFiles,
  globToRegExp,
  listFiles,
  normalizeTodos,
  readFile,
  runBash,
  safePath,
  searchText,
  todosFromToolResult,
  writeFile,
  writeTodos,
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

test("createWorkspaceTools registers the standard tools in order", () => {
  const registry = createWorkspaceTools(process.cwd());
  assert.deepEqual(
    registry.listTools().map((tool) => tool.name),
    [
      "list_files",
      "glob",
      "read_file",
      "search_text",
      "write_file",
      "edit",
      "bash",
      "todo_write",
    ],
  );
  assert.equal(registry.kindOf("read_file"), "read");
  assert.equal(registry.kindOf("write_file"), "write");
  assert.equal(registry.kindOf("bash"), "execute");
  assert.equal(registry.kindOf("todo_write"), "meta");
});

test("editFile replaces exactly once or all occurrences", async () => {
  await withTempDir(async (root) => {
    const file = path.join(root, "a.txt");
    await fsWriteFile(file, "hello world hello", "utf8");

    const one = await editFile(root, {
      path: "a.txt",
      old_string: "hello",
      new_string: "hi",
    });
    assert.deepEqual(one, {
      error:
        "old_string matches 2 places; set replace_all or include more context",
    });

    const all = await editFile(root, {
      path: "a.txt",
      old_string: "hello",
      new_string: "hi",
      replace_all: true,
    });
    assert.equal(all["replacements"], 2);
    assert.equal(await fsReadFile(file, "utf8"), "hi world hi");

    const missing = await editFile(root, {
      path: "a.txt",
      old_string: "absent",
      new_string: "x",
    });
    assert.deepEqual(missing, { error: "old_string not found" });

    const empty = await editFile(root, {
      path: "a.txt",
      old_string: "",
      new_string: "x",
    });
    assert.deepEqual(empty, {
      error: "old_string must not be empty",
    });
  });
});

test("globFiles supports **, basename patterns and limits", async () => {
  await withTempDir(async (root) => {
    await mkdir(path.join(root, "src", "nested"), {
      recursive: true,
    });
    await fsWriteFile(path.join(root, "a.txt"), "a");
    await fsWriteFile(path.join(root, "README.md"), "r");
    await fsWriteFile(path.join(root, "src", "a.ts"), "a");
    await fsWriteFile(path.join(root, "src", "nested", "b.ts"), "b");
    await mkdir(path.join(root, "node_modules"), {
      recursive: true,
    });
    await fsWriteFile(
      path.join(root, "node_modules", "ignored.ts"),
      "x",
    );

    const ts = await globFiles(root, { pattern: "**/*.ts" });
    assert.deepEqual(
      (ts["files"] as string[]).sort(),
      ["src/a.ts", "src/nested/b.ts"].sort(),
    );

    const rootMd = await globFiles(root, { pattern: "*.md" });
    assert.deepEqual(rootMd["files"], ["README.md"]);

    const limited = await globFiles(root, {
      pattern: "**/*.ts",
      limit: 1,
    });
    assert.equal((limited["files"] as string[]).length, 1);
    assert.equal(limited["truncated"], true);

    assert.equal(
      globToRegExp("**/*.ts").test("src/a.ts"),
      true,
    );
    assert.equal(globToRegExp("**/*.ts").test("a.ts"), true);
    assert.equal(globToRegExp("src/*.tsx").test("src/a.ts"), false);
  });
});

test("runBash returns stdout, exit code and truncation", async () => {
  await withTempDir(async (root) => {
    const ok = await runBash(root, {
      command: 'node -e "console.log(42)"',
    });
    assert.equal(ok.exit_code, 0);
    assert.equal(ok.stdout.trim(), "42");
    assert.equal(ok.timed_out, false);
    assert.equal(ok.aborted, false);

    const failed = await runBash(root, {
      command: 'node -e "process.exit(3)"',
    });
    assert.equal(failed.exit_code, 3);

    const truncated = await runBash(root, {
      command: 'node -e "console.log(\'x\'.repeat(2000))"',
      max_output_bytes: 1024,
    });
    assert.equal(truncated.truncated, true);
    assert.equal(
      Buffer.byteLength(truncated.stdout, "utf8") <= 1024,
      true,
    );

    await assert.rejects(
      () => runBash(root, { command: "echo hi", cwd: "../" }),
      /Path escapes project root/,
    );
  });
});

test("todo_write validates statuses and one in_progress", () => {
  const todos = normalizeTodos([
    { content: "a", status: "completed" },
    { content: "b", status: "in_progress", activeForm: "doing b" },
  ]);
  assert.equal(todos.length, 2);
  assert.equal(todos[1]?.activeForm, "doing b");

  assert.throws(
    () =>
      normalizeTodos([
        { content: "a", status: "in_progress" },
        { content: "b", status: "in_progress" },
      ]),
    /at most one todo may be in_progress/,
  );
  assert.throws(
    () => normalizeTodos([{ content: "", status: "pending" }]),
    /content must be a non-empty string/,
  );
  assert.throws(
    () => normalizeTodos([{ content: "a", status: "done" }]),
    /status must be pending/,
  );

  const result = writeTodos({
    todos: [{ content: "a", status: "pending" }],
  });
  assert.deepEqual(result["counts"], {
    pending: 1,
    in_progress: 0,
    completed: 0,
  });

  const parsed = todosFromToolResult(result);
  assert.equal(parsed?.length, 1);
  assert.equal(parsed?.[0]?.content, "a");
  assert.equal(todosFromToolResult(null), null);
});
