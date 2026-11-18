import assert from "node:assert/strict";
import test from "node:test";

import {
  activityText,
  countStats,
  emptyStats,
} from "../../src/app/ui/activity.js";

test("countStats classifies tools through presentation metadata", () => {
  const stats = emptyStats();
  countStats(stats, "read_file", null);
  countStats(stats, "glob", null);
  countStats(stats, "write_file", null);
  countStats(stats, "bash", null);
  countStats(stats, "todo_write", null);
  countStats(stats, "bash", "permission denied");

  assert.deepEqual(stats, {
    read: 1,
    write: 1,
    command: 1,
    search: 1,
    todo: 1,
  });
});

test("activityText summarizes non-zero counters", () => {
  const text = activityText(
    {
      read: 2,
      write: 0,
      command: 1,
      search: 1,
      todo: 1,
    },
    1_200,
  );
  assert.match(text, /Thought for 1\.2s/);
  assert.match(text, /read 2 files/);
  assert.doesNotMatch(text, /wrote/);
  assert.match(text, /searched 1 time/);
  assert.match(text, /ran 1 command/);
  assert.match(text, /updated todo list/);
});
