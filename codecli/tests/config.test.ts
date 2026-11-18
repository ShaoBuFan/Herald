import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  AppConfig,
  AppState,
  loadConfig,
} from "../src/app/adapters/mattermost-config.js";

async function withTempDirs(
  callback: (cwd: string, appDataDir: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(
    path.join(tmpdir(), "codecli-config-"),
  );
  const cwd = path.join(root, "cwd");
  const appDataDir = path.join(root, "appdata");
  await mkdir(cwd, { recursive: true });
  await mkdir(appDataDir, { recursive: true });
  try {
    await callback(cwd, appDataDir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const configPayload = {
  BASE_URL: "https://example.com/",
  ACCOUNT: [
    {
      CSRF_TOKEN: "csrf",
      AUTH_TOKEN: "auth",
      USER_ID: "user",
      TEAM_ID: "team",
    },
  ],
  MODEL_LIST: [
    {
      MODEL_KEY: "key-1",
      MODEL_NAME: "model-1",
      NICKNAME: "Model One",
    },
    {
      MODEL_KEY: "key-2",
      MODEL_NAME: "model-2",
    },
  ],
};

async function writeConfig(
  appDataDir: string,
  payload: unknown = configPayload,
): Promise<void> {
  const directory = path.join(appDataDir, "data");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "config.json"),
    JSON.stringify(payload),
    "utf8",
  );
}

test("loadConfig reads config and prompt.json", async () => {
  await withTempDirs(async (cwd, appDataDir) => {
    await writeConfig(appDataDir);
    await mkdir(path.join(cwd, "data"), { recursive: true });
    await writeFile(
      path.join(cwd, "data", "prompt.json"),
      JSON.stringify({ role: "system" }),
      "utf8",
    );

    const config = loadConfig({ cwd, appDataDir });

    assert.equal(config.base_url, "https://example.com");
    assert.equal(config.accounts.length, 1);
    assert.equal(config.models.length, 2);
    assert.equal(
      config.system_prompt,
      JSON.stringify({ role: "system" }),
    );

    const state = new AppState(config);
    assert.equal(state.current_account.TEAM_ID, "team");
    assert.equal(state.current_model_key, "key-1");
    assert.equal(state.current_model_name, "model-1");

    state.setCurrentModel(config.models[1]!);
    assert.equal(state.current_model_key, "key-2");
    assert.equal(state.current_model_name, "model-2");
    assert.equal(
      state.currentModel.NICKNAME,
      "model-2",
    );
  });
});

test("loadConfig copies a legacy project config", async () => {
  await withTempDirs(async (cwd, appDataDir) => {
    await mkdir(path.join(cwd, "data"), { recursive: true });
    await writeFile(
      path.join(cwd, "data", "config.json"),
      JSON.stringify(configPayload),
      "utf8",
    );

    const config = loadConfig({ cwd, appDataDir });

    assert.equal(config.base_url, "https://example.com");
    const copied = await readFile(
      path.join(appDataDir, "data", "config.json"),
      "utf8",
    );
    assert.match(copied, /BASE_URL/);
  });
});

test("loadConfig throws when config is missing", async () => {
  await withTempDirs(async (cwd, appDataDir) => {
    assert.throws(
      () => loadConfig({ cwd, appDataDir }),
      /配置文件不存在/,
    );
  });
});

test("AppState rejects empty accounts or models", () => {
  assert.throws(
    () =>
      new AppState(
        new AppConfig({
          base_url: "",
          accounts: [],
          models: [],
        }),
      ),
    /至少包含一个账户和一个模型/,
  );
});
