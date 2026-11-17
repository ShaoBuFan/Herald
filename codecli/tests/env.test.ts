import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  loadDotEnv,
  loadEnvFiles,
} from "../src/app/env.js";

async function withTempFile(
  content: string,
  callback: (filePath: string) => void,
): Promise<void> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "codecli-env-"),
  );
  const filePath = path.join(directory, ".env");
  await writeFile(filePath, content, "utf8");
  try {
    callback(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function uniqueKey(prefix: string): string {
  return `${prefix}_${process.pid}_${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}`;
}

test("loadDotEnv parses comments, quotes and existing values", async () => {
  const key = uniqueKey("CODECLI_ENV");
  const quoted = uniqueKey("CODECLI_QUOTED");
  const existing = uniqueKey("CODECLI_EXISTING");
  const withEquals = uniqueKey("CODECLI_WITH_EQUALS");
  const previous = process.env[existing];
  process.env[existing] = "from-env";

  try {
    await withTempFile(
      [
        "# comment",
        "",
        `${key}=plain`,
        `${quoted}="quoted value"`,
        `${existing}=from-file`,
        `${withEquals}=${key}=x`,
      ].join("\n"),
      (filePath) => {
        loadDotEnv(filePath);
        assert.equal(process.env[key], "plain");
        assert.equal(process.env[quoted], "quoted value");
        assert.equal(process.env[existing], "from-env");
        assert.equal(process.env[withEquals], `${key}=x`);
      },
    );
  } finally {
    delete process.env[key];
    delete process.env[quoted];
    delete process.env[withEquals];
    if (previous === undefined) {
      delete process.env[existing];
    } else {
      process.env[existing] = previous;
    }
  }
});

test("loadEnvFiles lets the first file win for missing keys", async () => {
  const key = uniqueKey("CODECLI_ORDER");
  const previous = process.env[key];
  delete process.env[key];

  try {
    const dir = await mkdtemp(
      path.join(tmpdir(), "codecli-env-order-"),
    );
    const first = path.join(dir, "first.env");
    const second = path.join(dir, "second.env");
    await writeFile(first, `${key}=first`, "utf8");
    await writeFile(second, `${key}=second`, "utf8");
    try {
      loadEnvFiles([first, second]);
      assert.equal(process.env[key], "first");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
});

test("loadDotEnv ignores missing files and malformed lines", async () => {
  loadDotEnv(
    path.join(tmpdir(), `codecli-missing-${Date.now()}.env`),
  );
  await withTempFile(
    ["no separator", "=empty-key", "EMPTY_VALUE="].join("\n"),
    (filePath) => {
      loadDotEnv(filePath);
      assert.equal(process.env["EMPTY_VALUE"], "");
    },
  );
  delete process.env["EMPTY_VALUE"];
});
