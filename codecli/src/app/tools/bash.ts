import { spawn } from "node:child_process";

import { Tool } from "../../core/tools/registry.js";
import type { ToolContext } from "../../core/protocols.js";
import {
  requireString,
  safePath,
  toInteger,
} from "./shared.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 65_536;
const KILL_GRACE_MS = 2_000;

export const BASH_PARAMETERS = {
  type: "object",
  properties: {
    command: {
      type: "string",
      description: "要执行的 shell 命令",
    },
    cwd: {
      type: "string",
      description: "相对项目根目录的工作目录，默认 .",
    },
    timeout_ms: {
      type: "integer",
      description: "超时毫秒数，默认 120000，最大 600000",
    },
    max_output_bytes: {
      type: "integer",
      description: "stdout/stderr 各自最多保留的字节数，默认 65536",
    },
  },
  required: ["command"],
};

function shellInvocation(command: string): {
  file: string;
  args: string[];
} {
  const override = process.env["CODECLI_BASH"];
  if (override) {
    return { file: override, args: ["-lc", command] };
  }
  if (process.platform === "win32") {
    return { file: "bash.exe", args: ["-lc", command] };
  }
  return {
    file: process.env["SHELL"] || "/bin/bash",
    args: ["-lc", command],
  };
}

function clamp(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(maximum, Math.max(minimum, value));
}

interface OutputCollector {
  text: string;
  truncated: boolean;
}

function collect(
  chunk: Buffer,
  collector: OutputCollector,
  maxBytes: number,
): void {
  if (collector.truncated) {
    return;
  }
  const remaining = maxBytes - Buffer.byteLength(collector.text, "utf8");
  if (remaining <= 0) {
    collector.truncated = true;
    return;
  }
  if (chunk.length > remaining) {
    collector.text += chunk.subarray(0, remaining).toString("utf8");
    collector.truncated = true;
    return;
  }
  collector.text += chunk.toString("utf8");
}

export interface BashResult {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
  aborted: boolean;
  truncated: boolean;
}

export function runBash(
  root: string,
  arguments_: Record<string, unknown>,
  context?: ToolContext,
): Promise<BashResult> {
  const command = requireString(
    arguments_["command"],
    "command",
  );
  if (!command.trim()) {
    return Promise.reject(new Error("command must not be empty"));
  }

  const timeoutMs = clamp(
    toInteger(arguments_["timeout_ms"], DEFAULT_TIMEOUT_MS),
    1_000,
    600_000,
  );
  const maxOutputBytes = clamp(
    toInteger(
      arguments_["max_output_bytes"],
      DEFAULT_MAX_OUTPUT_BYTES,
    ),
    1_024,
    1_048_576,
  );
  const requestedCwd =
    typeof arguments_["cwd"] === "string" &&
    arguments_["cwd"] !== ""
      ? arguments_["cwd"]
      : ".";

  return safePath(root, requestedCwd).then(
    (cwd) =>
      new Promise<BashResult>((resolve, reject) => {
        const invocation = shellInvocation(command);
        const stdout: OutputCollector = {
          text: "",
          truncated: false,
        };
        const stderr: OutputCollector = {
          text: "",
          truncated: false,
        };
        let timedOut = false;
        let aborted = false;
        let settled = false;
        let forceKill: NodeJS.Timeout | null = null;
        let timer: NodeJS.Timeout | null = null;

        const child = spawn(invocation.file, invocation.args, {
          cwd,
          env: process.env,
          windowsHide: true,
        });

        const finish = (
          exitCode: number | null,
          error?: Error,
        ): void => {
          if (settled) {
            return;
          }
          settled = true;
          if (timer) {
            clearTimeout(timer);
          }
          if (forceKill) {
            clearTimeout(forceKill);
          }
          context?.signal?.removeEventListener("abort", onAbort);
          if (error) {
            reject(error);
            return;
          }
          resolve({
            stdout: stdout.text,
            stderr: stderr.text,
            exit_code: exitCode,
            timed_out: timedOut,
            aborted,
            truncated: stdout.truncated || stderr.truncated,
          });
        };

        const terminate = (): void => {
          if (child.exitCode !== null) {
            return;
          }
          child.kill("SIGTERM");
          forceKill = setTimeout(() => {
            if (child.exitCode === null) {
              child.kill("SIGKILL");
            }
          }, KILL_GRACE_MS);
          forceKill.unref();
        };

        const onAbort = (): void => {
          aborted = true;
          terminate();
        };

        timer = setTimeout(() => {
          timedOut = true;
          terminate();
        }, timeoutMs);
        timer.unref();

        if (context?.signal) {
          if (context.signal.aborted) {
            onAbort();
          } else {
            context.signal.addEventListener("abort", onAbort, {
              once: true,
            });
          }
        }

        child.stdout.on("data", (chunk: Buffer) => {
          collect(chunk, stdout, maxOutputBytes);
        });
        child.stderr.on("data", (chunk: Buffer) => {
          collect(chunk, stderr, maxOutputBytes);
        });

        child.on("error", (error) => {
          finish(
            null,
            new Error(
              `failed to start shell (${invocation.file}): ${error.message}` +
                (process.platform === "win32"
                  ? "; set CODECLI_BASH to a bash executable"
                  : ""),
            ),
          );
        });

        child.on("close", (code) => {
          finish(code);
        });
      }),
  );
}

export function buildBashTool(root: string): Tool {
  return new Tool(
    "bash",
    "在项目工作区运行 shell 命令，返回 stdout、stderr 和退出码。",
    BASH_PARAMETERS,
    (arguments_, context) => runBash(root, arguments_, context),
    "execute",
  );
}
