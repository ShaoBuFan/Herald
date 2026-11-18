import assert from "node:assert/strict";
import test from "node:test";

import {
  Tool,
  ToolRegistry,
} from "../src/core/index.js";
import {
  composeSystemPrompt,
  MODE_ORDER,
  nextSessionMode,
  requiresApproval,
} from "../src/app/modes.js";
import {
  ApprovalToolExecutor,
  buildModeTools,
  createModeExecutor,
  describeModeTools,
} from "../src/app/tools/policy.js";

function makeRegistry(calls: string[]): ToolRegistry {
  const tool = (
    name: string,
    kind: "read" | "write" | "execute" | "meta",
  ) =>
    new Tool(
      name,
      name,
      { type: "object" },
      () => {
        calls.push(name);
        return { ok: true };
      },
      kind,
    );

  return new ToolRegistry([
    tool("read_file", "read"),
    tool("write_file", "write"),
    tool("bash", "execute"),
    tool("todo_write", "meta"),
  ]);
}

test("mode order cycles manual -> accept -> plan -> auto", () => {
  assert.deepEqual(MODE_ORDER, [
    "manual",
    "accept",
    "plan",
    "auto",
  ]);
  assert.equal(nextSessionMode("manual"), "accept");
  assert.equal(nextSessionMode("accept"), "plan");
  assert.equal(nextSessionMode("plan"), "auto");
  assert.equal(nextSessionMode("auto"), "manual");
});

test("approval matrix matches the mode contract", () => {
  assert.equal(requiresApproval("manual", "read"), false);
  assert.equal(requiresApproval("manual", "meta"), false);
  assert.equal(requiresApproval("manual", "write"), true);
  assert.equal(requiresApproval("manual", "execute"), true);

  assert.equal(requiresApproval("accept", "write"), false);
  assert.equal(requiresApproval("accept", "execute"), true);

  assert.equal(requiresApproval("auto", "write"), false);
  assert.equal(requiresApproval("auto", "execute"), false);
  assert.equal(requiresApproval("plan", "write"), false);
});

test("buildModeTools hides write/execute tools in plan mode", () => {
  const calls: string[] = [];
  const registry = makeRegistry(calls);

  assert.deepEqual(
    buildModeTools(registry, "plan")
      .listTools()
      .map((tool) => tool.name),
    ["read_file", "todo_write"],
  );
  for (const mode of ["manual", "accept", "auto"] as const) {
    assert.deepEqual(
      buildModeTools(registry, mode)
        .listTools()
        .map((tool) => tool.name),
      ["read_file", "write_file", "bash", "todo_write"],
    );
  }
});

test("describeModeTools is the shared policy view", () => {
  const calls: string[] = [];
  const registry = makeRegistry(calls);
  const view = describeModeTools(registry, "plan");

  assert.deepEqual(
    view.filter((item) => item.allowed).map((item) => item.schema.name),
    ["read_file", "todo_write"],
  );
  assert.equal(
    view.find((item) => item.schema.name === "bash")?.allowed,
    false,
  );
  assert.equal(
    view.find((item) => item.schema.name === "write_file")?.allowed,
    false,
  );
});

test("manual mode asks before write and honors denial", async () => {
  const calls: string[] = [];
  const registry = makeRegistry(calls);
  const requests: string[] = [];
  const executor = new ApprovalToolExecutor(
    buildModeTools(registry, "manual"),
    "manual",
    (request) => {
      requests.push(request.tool);
      return false;
    },
  );

  await assert.rejects(
    () => executor.execute("write_file", {}),
    /permission denied by user/,
  );
  assert.deepEqual(requests, ["write_file"]);
  assert.deepEqual(calls, []);

  const allowed = new ApprovalToolExecutor(
    buildModeTools(registry, "manual"),
    "manual",
    () => true,
  );
  await allowed.execute("write_file", {});
  assert.deepEqual(calls, ["write_file"]);
});

test("accept mode auto-approves writes but asks for bash", async () => {
  const calls: string[] = [];
  const registry = makeRegistry(calls);
  const requests: string[] = [];
  const executor = new ApprovalToolExecutor(
    buildModeTools(registry, "accept"),
    "accept",
    (request) => {
      requests.push(request.tool);
      return true;
    },
  );

  await executor.execute("write_file", {});
  assert.deepEqual(requests, []);
  assert.deepEqual(calls, ["write_file"]);

  await executor.execute("bash", {});
  assert.deepEqual(requests, ["bash"]);
  assert.deepEqual(calls, ["write_file", "bash"]);
});

test("auto mode never asks", async () => {
  const calls: string[] = [];
  const executor = createModeExecutor(
    makeRegistry(calls),
    "auto",
    () => {
      throw new Error("must not ask");
    },
  );

  await executor.execute("write_file", {});
  await executor.execute("bash", {});
  assert.deepEqual(calls, ["write_file", "bash"]);
});

test("mode and effort are appended to the system prompt", () => {
  const prompt = composeSystemPrompt(
    "base",
    "plan",
    "max",
  );
  assert.match(prompt, /base/);
  assert.match(prompt, /plan mode/);
  assert.match(prompt, /effort=max/);
});
