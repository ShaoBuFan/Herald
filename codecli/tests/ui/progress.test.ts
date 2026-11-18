import assert from "node:assert/strict";
import test from "node:test";

import {
  approxTokens,
  LiveProgress,
  usageTokens,
} from "../../src/app/progress.js";

test("LiveProgress tracks content, reasoning and usage", () => {
  const progress = new LiveProgress();
  progress.delta("abcd");
  progress.reasoning("12345678");
  progress.flush();

  const snapshot = progress.getSnapshot();
  assert.equal(snapshot.content, "abcd");
  assert.equal(snapshot.outputChars, 4);
  assert.equal(snapshot.reasoningChars, 8);
  assert.equal(approxTokens(snapshot), 3);
  assert.equal(usageTokens(snapshot), null);

  progress.setUsage({ completion_tokens: 7 });
  progress.flush();
  assert.equal(usageTokens(progress.getSnapshot()), 7);

  progress.finish();
  assert.equal(progress.getSnapshot().content, "");
  assert.equal(progress.getSnapshot().outputChars, 4);
});

test("LiveProgress reset clears all state", () => {
  const progress = new LiveProgress();
  progress.delta("hello");
  progress.reasoning("why");
  progress.setUsage({ output_tokens: 5 });
  progress.reset();

  assert.deepEqual(progress.getSnapshot(), {
    content: "",
    reasoningChars: 0,
    outputChars: 0,
    usage: null,
  });
});

test("LiveProgress notifies subscribers until unsubscribe", () => {
  const progress = new LiveProgress();
  let calls = 0;
  const unsubscribe = progress.subscribe(() => {
    calls += 1;
  });

  progress.delta("a");
  progress.flush();
  assert.equal(calls, 1);

  unsubscribe();
  progress.delta("b");
  progress.flush();
  assert.equal(calls, 1);
});

test("usageTokens falls back through output/total tokens", () => {
  const progress = new LiveProgress();
  progress.setUsage({ total_tokens: 12 });
  progress.flush();
  assert.equal(usageTokens(progress.getSnapshot()), 12);
});
