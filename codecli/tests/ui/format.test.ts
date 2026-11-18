import assert from "node:assert/strict";
import test from "node:test";

import {
  displayToolName,
  formatDuration,
  formatSize,
  formatTokens,
  formatToolCallArguments,
  presentToolCall,
  summarizeToolResult,
  toolResultDetail,
  truncate,
} from "../../src/app/ui/format.js";

test("displayToolName maps known tools and falls back", () => {
  assert.equal(displayToolName("read_file"), "Read");
  assert.equal(displayToolName("write_file"), "Write");
  assert.equal(displayToolName("edit"), "Update");
  assert.equal(displayToolName("list_files"), "List");
  assert.equal(displayToolName("search_text"), "Grep");
  assert.equal(displayToolName("glob"), "Glob");
  assert.equal(displayToolName("bash"), "Bash");
  assert.equal(displayToolName("todo_write"), "Todo");
  assert.equal(displayToolName("custom"), "custom");
});

test("formatSize switches units", () => {
  assert.equal(formatSize(0), "0 B");
  assert.equal(formatSize(1023), "1023 B");
  assert.equal(formatSize(1024), "1.0 KB");
  assert.equal(formatSize(1536), "1.5 KB");
  assert.equal(formatSize(1024 * 1024), "1.0 MB");
});

test("formatDuration and formatTokens use compact forms", () => {
  assert.equal(formatDuration(0), "0.0s");
  assert.equal(formatDuration(200), "0.2s");
  assert.equal(formatDuration(12_000), "12s");
  assert.equal(formatDuration(65_000), "1m 5s");
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(717), "717");
  assert.equal(formatTokens(1500), "1.5k");
  assert.equal(formatTokens(12_000), "12k");
});

test("truncate counts code points and handles limits", () => {
  assert.equal(truncate("abc", 0), "");
  assert.equal(truncate("abc", 3), "abc");
  assert.equal(truncate("abcd", 3), "ab…");
  assert.equal(truncate("星野光", 2), "星…");
  assert.equal(truncate("😀😀😀", 2), "😀…");
});

test("formatToolCallArguments prefers readable keys", () => {
  assert.equal(
    formatToolCallArguments("read_file", {
      path: "src/main.ts",
      offset: 1,
    }),
    "src/main.ts",
  );
  assert.equal(
    formatToolCallArguments("list_files", {
      path: "src",
      pattern: "*.ts",
      recursive: true,
    }),
    "src, *.ts",
  );
  assert.equal(
    formatToolCallArguments("search_text", {
      keyword: "needle",
      path: "docs",
    }),
    "needle, docs",
  );
  assert.equal(
    formatToolCallArguments("bash", {
      command: "git status",
      timeout: 5,
    }),
    "git status",
  );
  assert.equal(
    formatToolCallArguments("todo_write", {
      todos: [{ content: "a" }, { content: "b" }],
    }),
    "2 tasks",
  );
});

test("formatToolCallArguments falls back to key=value", () => {
  assert.equal(
    formatToolCallArguments("custom", {
      command: "ls",
      timeout: 5,
    }),
    'command="ls", timeout=5',
  );
  assert.equal(formatToolCallArguments("read_file", {}), "");
  assert.match(
    formatToolCallArguments("unknown", {
      long: "x".repeat(100),
    }),
    /…/,
  );
});

test("presentToolCall builds Claude-style action lines", () => {
  assert.deepEqual(
    presentToolCall("read_file", { path: "README.md" }, "active"),
    { action: "Reading README.md" },
  );
  assert.deepEqual(
    presentToolCall("bash", { command: "git status" }, "active"),
    {
      action: "Running command",
      command: "$ git status",
    },
  );
  assert.equal(
    presentToolCall("bash", { command: "git status" }, "done")
      .action,
    "Ran command",
  );
  assert.equal(
    presentToolCall("todo_write", {}, "done").action,
    "Updated todo list",
  );
  assert.equal(
    presentToolCall("custom", { x: 1 }, "done").action,
    'custom x=1',
  );
});

test("summarizeToolResult reports explicit errors", () => {
  assert.deepEqual(
    summarizeToolResult("read_file", null, "boom"),
    { text: "Error: boom", error: true },
  );
  assert.deepEqual(
    summarizeToolResult("read_file", { error: "File does not exist" }, null),
    { text: "Error: File does not exist", error: true },
  );
  assert.deepEqual(
    summarizeToolResult(
      "bash",
      null,
      "permission denied by user: bash",
    ),
    { text: "Not run · denied", error: true },
  );
  assert.deepEqual(
    summarizeToolResult(
      "read_file",
      { error: "partial", content: "ok" },
      null,
    ),
    { text: "Read 1 line (2 B)", error: false },
  );
});

test("summarizeToolResult summarizes file tools", () => {
  assert.deepEqual(
    summarizeToolResult(
      "read_file",
      { path: "README.md", content: "a\nb\n", truncated: false },
      null,
    ),
    { text: "Read 3 lines (4 B)", error: false },
  );
  assert.deepEqual(
    summarizeToolResult(
      "list_files",
      {
        files: ["a.ts", "b.ts"],
        directories: ["src"],
        truncated: false,
      },
      null,
    ),
    { text: "List 2 files, 1 directory", error: false },
  );
  assert.deepEqual(
    summarizeToolResult(
      "search_text",
      { results: [{ path: "a.ts", line: 1 }], truncated: false },
      null,
    ),
    { text: "Grep 1 match", error: false },
  );
  assert.deepEqual(
    summarizeToolResult(
      "write_file",
      { path: "out.txt", bytes_written: 2048 },
      null,
    ),
    { text: "Wrote out.txt (2.0 KB)", error: false },
  );
  assert.deepEqual(
    summarizeToolResult(
      "edit",
      { path: "a.ts", replacements: 2, bytes_written: 4 },
      null,
    ),
    { text: "Updated 2 replacements · 4 B", error: false },
  );
  assert.deepEqual(
    summarizeToolResult(
      "glob",
      { files: ["a.ts", "b.ts"], truncated: false },
      null,
    ),
    { text: "Glob 2 files", error: false },
  );
});

test("summarizeToolResult summarizes bash and todo", () => {
  assert.deepEqual(
    summarizeToolResult(
      "bash",
      {
        stdout: "a\nb\n",
        stderr: "",
        exit_code: 0,
        timed_out: false,
        aborted: false,
        truncated: false,
      },
      null,
    ),
    { text: "Bash exit 0 · 3 lines", error: false },
  );
  assert.deepEqual(
    summarizeToolResult(
      "bash",
      {
        stdout: "",
        stderr: "",
        exit_code: null,
        timed_out: true,
        aborted: false,
        truncated: false,
      },
      null,
    ),
    { text: "Bash Timed out", error: false },
  );
  assert.deepEqual(
    summarizeToolResult(
      "todo_write",
      {
        todos: [
          { content: "a", status: "completed" },
          { content: "b", status: "in_progress" },
        ],
      },
      null,
    ),
    { text: "Todo 1/2 done · 1 in progress", error: false },
  );
});

test("toolResultDetail returns the nested detail without the verb", () => {
  assert.deepEqual(
    toolResultDetail(
      "read_file",
      { content: "a\nb\n", truncated: false },
      null,
    ),
    { text: "3 lines (4 B)", error: false },
  );
  assert.deepEqual(
    toolResultDetail(
      "glob",
      { files: ["a", "b"], truncated: true },
      null,
    ),
    { text: "2 files, truncated", error: false },
  );
  assert.deepEqual(
    toolResultDetail("bash", null, "permission denied"),
    { text: "Not run · denied", error: true },
  );
});

test("summarizeToolResult handles generic payloads", () => {
  assert.deepEqual(
    summarizeToolResult("read_file", "line one\nline two", null),
    { text: "Read line one line two", error: false },
  );
  assert.deepEqual(
    summarizeToolResult("read_file", null, null),
    { text: "Done", error: false },
  );
  assert.deepEqual(
    summarizeToolResult("read_file", 42, null),
    { text: "Read 42", error: false },
  );
});
