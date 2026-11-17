import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  SCHEMA_VERSION,
  SessionStore,
} from "../src/app/session/store.js";

async function withTempDir(
  callback: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(
    path.join(tmpdir(), "codecli-session-"),
  );
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("clear removes history without seeding a system prompt", async () => {
  await withTempDir(async (directory) => {
    const store = new SessionStore(directory);
    store.append({ role: "user", content: "hi" });

    store.clear();

    assert.deepEqual(store.getMessages(), []);
    assert.equal(store.currentFile, null);
    assert.equal(store.title, "未命名");
  });
});

test("save includes schema version and history", async () => {
  await withTempDir(async (directory) => {
    const store = new SessionStore(directory);
    store.append({ role: "user", content: "hi" });

    const filePath = await store.save("t");
    const payload = JSON.parse(
      await readFile(filePath, "utf8"),
    ) as {
      version: number;
      title: string;
      history: unknown[];
    };

    assert.equal(payload.version, SCHEMA_VERSION);
    assert.equal(payload.title, "t");
    assert.deepEqual(payload.history, [
      { role: "user", content: "hi" },
    ]);
  });
});

test("load migrates legacy text history", async () => {
  await withTempDir(async (directory) => {
    const legacy = {
      title: "old",
      history: [
        { role: "system", content: "old system" },
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: JSON.stringify({
            thought: "need",
            tool_calls: [
              {
                id: "c1",
                tool: "read_file",
                arguments: { path: "a" },
              },
            ],
          }),
        },
        {
          role: "user",
          content: JSON.stringify({
            type: "tool_result",
            results: [
              {
                id: "c1",
                tool: "read_file",
                data: { content: "x" },
              },
            ],
          }),
        },
        {
          role: "assistant",
          content: JSON.stringify({
            thought: "done",
            final: "ok",
          }),
        },
      ],
    };

    const filePath = path.join(
      directory,
      "conversation_old.json",
    );
    await writeFile(
      filePath,
      JSON.stringify(legacy),
      "utf8",
    );

    const store = new SessionStore(directory);
    assert.equal(await store.load(filePath), true);

    const messages = store.getMessages();
    assert.deepEqual(
      messages.map((message) => message.role),
      ["user", "assistant", "tool", "assistant"],
    );

    const assistant = messages[1];
    assert.ok(assistant && assistant.role === "assistant");
    assert.deepEqual(assistant.tool_calls, [
      {
        id: "c1",
        name: "read_file",
        arguments: { path: "a" },
      },
    ]);

    const tool = messages[2];
    assert.ok(tool && tool.role === "tool");
    assert.equal(tool.tool_call_id, "c1");
    assert.deepEqual(tool.data, { content: "x" });
    assert.equal(tool.error, null);

    const final = messages[3];
    assert.ok(final && final.role === "assistant");
    assert.equal(final.content, "ok");
    assert.equal(final.thought, "done");

    assert.equal(store.title, "old");
    assert.equal(store.currentFile, filePath);
  });
});

test("semantic session round-trips", async () => {
  await withTempDir(async (directory) => {
    const store = new SessionStore(directory);
    store.append({ role: "user", content: "hi" });
    store.append({
      role: "assistant",
      content: "ok",
      thought: "t",
      tool_calls: [],
    });
    const filePath = await store.save("round trip");

    const restored = new SessionStore(directory);
    assert.equal(await restored.load(filePath), true);
    assert.deepEqual(
      restored.getMessages(),
      store.getMessages(),
    );
  });
});

test("sessions lists saved conversations", async () => {
  await withTempDir(async (directory) => {
    const store = new SessionStore(directory);
    await store.save("first");
    store.clear();
    await store.save("second");

    const sessions = await store.sessions();
    assert.equal(sessions.length, 2);
    const titles = sessions.map((entry) => entry.title).sort();
    assert.deepEqual(titles, ["first", "second"]);
    assert.equal(
      sessions.every((entry) => entry.path.endsWith(".json")),
      true,
    );
  });
});

test("load returns false for invalid JSON", async () => {
  await withTempDir(async (directory) => {
    const filePath = path.join(directory, "bad.json");
    await writeFile(filePath, "not json", "utf8");

    const store = new SessionStore(directory);
    assert.equal(await store.load(filePath), false);
  });
});
