import os from "node:os";
import path from "node:path";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

export interface AccountConfig {
  CSRF_TOKEN: string;
  AUTH_TOKEN: string;
  USER_ID: string;
  TEAM_ID: string;
  [key: string]: unknown;
}

export interface ModelConfig {
  MODEL_KEY: string;
  MODEL_NAME: string;
  NICKNAME: string;
  [key: string]: unknown;
}

export interface AppConfigInit {
  base_url: string;
  accounts: AccountConfig[];
  models: ModelConfig[];
  system_prompt?: string;
}

export class AppConfig {
  readonly base_url: string;
  readonly accounts: AccountConfig[];
  readonly models: ModelConfig[];
  readonly system_prompt: string;

  constructor(init: AppConfigInit) {
    this.base_url = init.base_url;
    this.accounts = init.accounts;
    this.models = init.models;
    this.system_prompt = init.system_prompt ?? "";
  }
}

export class AppState {
  readonly config: AppConfig;
  currentAccount: AccountConfig;
  currentModel: ModelConfig;

  constructor(config: AppConfig) {
    if (config.accounts.length === 0 || config.models.length === 0) {
      throw new Error(
        "配置中必须至少包含一个账户和一个模型",
      );
    }
    this.config = config;
    this.currentAccount = config.accounts[0]!;
    this.currentModel = config.models[0]!;
  }

  get current_account(): AccountConfig {
    return this.currentAccount;
  }

  get current_model_key(): string {
    return this.currentModel.MODEL_KEY;
  }

  get current_model_name(): string {
    return this.currentModel.MODEL_NAME;
  }

  setCurrentModel(model: ModelConfig): void {
    this.currentModel = model;
  }
}

export const PROJECT_ROOT = path.resolve(process.cwd());
export const APP_DATA_DIR = path.join(
  process.env["APPDATA"] ??
    path.join(os.homedir(), ".local", "share"),
  "chat-cli",
);
export const CONFIG_PATH = path.join(
  APP_DATA_DIR,
  "data",
  "config.json",
);
export const SESSIONS_DIR = path.join(APP_DATA_DIR, "sessions");
export const RESPONSE_PATH = path.join(
  APP_DATA_DIR,
  "response.md",
);
export const LOG_DIR = path.join(APP_DATA_DIR, "logs");
export const PROMPT_PATH = path.join(
  PROJECT_ROOT,
  "data",
  "prompt.json",
);

/** 与 Python 参考实现一致：把最后一次终答落盘。 */
export function saveResponse(text: string): void {
  mkdirSync(path.dirname(RESPONSE_PATH), { recursive: true });
  writeFileSync(RESPONSE_PATH, text, "utf8");
}

export interface LoadConfigOptions {
  cwd?: string;
  appDataDir?: string;
  configPath?: string;
  promptPath?: string;
}

function loadJson(filePath: string): unknown {
  const text = readFileSync(filePath, "utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `JSON object expected: ${filePath} (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function asAccount(value: unknown): AccountConfig | null {
  if (!isRecord(value)) {
    return null;
  }
  const keys = [
    "CSRF_TOKEN",
    "AUTH_TOKEN",
    "USER_ID",
    "TEAM_ID",
  ];
  if (
    keys.some((key) => typeof value[key] !== "string")
  ) {
    return null;
  }
  return value as AccountConfig;
}

function asModel(value: unknown): ModelConfig | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value["MODEL_KEY"] !== "string" ||
    typeof value["MODEL_NAME"] !== "string"
  ) {
    return null;
  }
  return {
    ...value,
    NICKNAME:
      typeof value["NICKNAME"] === "string"
        ? value["NICKNAME"]
        : value["MODEL_NAME"],
  } as ModelConfig;
}

export function loadConfig(
  options: LoadConfigOptions = {},
): AppConfig {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const appDataDir = options.appDataDir ?? APP_DATA_DIR;
  const configPath =
    options.configPath ??
    path.join(appDataDir, "data", "config.json");
  const promptPath =
    options.promptPath ??
    path.join(cwd, "data", "prompt.json");

  mkdirSync(path.dirname(configPath), { recursive: true });

  if (!existsSync(configPath)) {
    const legacy = path.join(cwd, "data", "config.json");
    if (existsSync(legacy)) {
      copyFileSync(legacy, configPath);
    }
  }

  if (!existsSync(configPath)) {
    throw new Error(`配置文件不存在: ${configPath}`);
  }

  const data = loadJson(configPath);
  if (!isRecord(data)) {
    throw new Error(`JSON object expected: ${configPath}`);
  }

  const baseUrl = String(data["BASE_URL"] ?? "").replace(
    /\/+$/,
    "",
  );
  const rawAccounts = data["ACCOUNT"];
  const rawModels = data["MODEL_LIST"];
  if (!Array.isArray(rawAccounts)) {
    throw new Error("ACCOUNT must be an array");
  }
  if (!Array.isArray(rawModels)) {
    throw new Error("MODEL_LIST must be an array");
  }

  const accounts = rawAccounts
    .map((value) => asAccount(value))
    .filter((value): value is AccountConfig => value !== null);
  const models = rawModels
    .map((value) => asModel(value))
    .filter((value): value is ModelConfig => value !== null);

  let systemPrompt = "";
  if (existsSync(promptPath)) {
    systemPrompt = JSON.stringify(loadJson(promptPath));
  }

  return new AppConfig({
    base_url: baseUrl,
    accounts,
    models,
    system_prompt: systemPrompt,
  });
}
