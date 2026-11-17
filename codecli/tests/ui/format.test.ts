import assert from "node:assert/strict";
import test from "node:test";

import {
  displayToolName,
  formatSize,
  formatToolCallArguments,
  summarizeToolResult,
  truncate,
} from "../../src/app/ui/format.js";

test("displayToolName maps known tools and falls back", () => {
  assert.equal(displayToolName("read_file"), "Read");
  assert.equal(displayToolName("write_file"), "Write");
  assert.equal(displayToolName("list_files"), "List");
  assert.equal(displayToolName("search_text"), "Search");
  assert.equal(displayToolName("bash"), "bash");
});

test("formatSize switches units", () => {
  assert.equal(formatSize(0), "0 B");
  assert.equal(formatSize(1023), "1023 B");
  assert.equal(formatSize(1024), "1.0 KB");
  assert.equal(formatSize(1536), "1.5 KB");
  assert.equal(formatSize(1024 * 1024), "1.0 MB");
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
});

test("formatToolCallArguments falls back to key=value", () => {
  assert.equal(
    formatToolCallArguments("bash", {
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
      "read_file",
      { error: "partial", content: "ok" },
      null,
    ),
    { text: "Read 1 line (2 B)", error: false },
  );
});

test("summarizeToolResult summarizes read_file content", () => {
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
      "read_file",
      { content: "", truncated: true },
      null,
    ),
    { text: "Read 0 lines (0 B, truncated)", error: false },
  );
});

test("summarizeToolResult summarizes listings, search and writes", () => {
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
      "list_files",
      { files: [], directories: [], truncated: true },
      null,
    ),
    { text: "List 0 files, 0 directories, truncated", error: false },
  );
  assert.deepEqual(
    summarizeToolResult(
      "search_text",
      { results: [{ path: "a.ts", line: 1 }], truncated: false },
      null,
    ),
    { text: "Search 1 match", error: false },
  );
  assert.deepEqual(
    summarizeToolResult(
      "write_file",
      { path: "out.txt", bytes_written: 2048 },
      null,
    ),
    { text: "Wrote out.txt (2.0 KB)", error: false },
  );
});

test("summarizeToolResult handles generic payloads", () => {
  assert.deepEqual(
    summarizeToolResult("read_file", "line one\nline two", null),
    { text: "Read: line one line two", error: false },
  );
  assert.deepEqual(
    summarizeToolResult("read_file", null, null),
    { text: "Done", error: false },
  );
  assert.deepEqual(
    summarizeToolResult("read_file", 42, null),
    { text: "Read: 42", error: false },
  );
});
