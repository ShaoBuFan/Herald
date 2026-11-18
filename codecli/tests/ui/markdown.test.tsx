import assert from "node:assert/strict";
import test from "node:test";
import { render } from "ink-testing-library";

import { Markdown } from "../../src/app/ui/Markdown.js";
import { displayWidth } from "../../src/app/ui/text.js";

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function tableLines(frame: string): string[] {
  return stripAnsi(frame)
    .split("\n")
    .filter((line) => /^[┌│├└]/.test(line));
}

test("Markdown renders pipe tables with box borders", () => {
  const text = [
    "| 工具 | kind | 说明 |",
    "|---|---|---|",
    "| list_files / glob / read_file / search_text | read | 直接可用 |",
    "| write_file / edit | write | 需审批 |",
  ].join("\n");

  const { lastFrame, unmount } = render(
    <Markdown text={text} />,
  );
  const frame = stripAnsi(lastFrame() ?? "");

  assert.match(frame, /┌/);
  assert.match(frame, /┬/);
  assert.match(frame, /┼/);
  assert.match(frame, /└/);
  assert.match(frame, /工具/);
  assert.match(frame, /list_files/);
  assert.match(frame, /直接可用/);
  assert.match(frame, /write_file \/ edit/);

  const lines = tableLines(frame);
  assert.ok(lines.length >= 5);
  const widths = new Set(lines.map(displayWidth));
  assert.equal(
    widths.size,
    1,
    `table lines should share a width: ${JSON.stringify(
      lines.map(displayWidth),
    )}`,
  );
  unmount();
});

test("Markdown tables wrap long cells and keep borders aligned", () => {
  const long = "很长的说明".repeat(20);
  const text = [
    "| 项目 | 说明 |",
    "|---|---|",
    `| x | ${long} |`,
  ].join("\n");

  const { lastFrame, unmount } = render(
    <Markdown text={text} />,
  );
  const frame = stripAnsi(lastFrame() ?? "");
  assert.match(frame, /很长的说明/);
  const lines = tableLines(frame);
  assert.ok(lines.length > 4);
  const widths = new Set(lines.map(displayWidth));
  assert.equal(widths.size, 1);
  unmount();
});

test("a pipe row without a separator stays plain text", () => {
  const { lastFrame, unmount } = render(
    <Markdown text={"| not | a table |\nstill text"} />,
  );
  const frame = stripAnsi(lastFrame() ?? "");
  assert.doesNotMatch(frame, /┌/);
  assert.match(frame, /not/);
  unmount();
});
