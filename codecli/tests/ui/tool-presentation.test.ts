import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceTools } from "../../src/app/tools/index.js";
import {
  activityKindFor,
  displayToolName,
} from "../../src/app/ui/format.js";

test("every workspace tool has presentation metadata", () => {
  const tools = createWorkspaceTools(process.cwd());
  for (const schema of tools.listTools()) {
    assert.notEqual(
      displayToolName(schema.name),
      schema.name,
      `${schema.name} has no display name`,
    );
    assert.notEqual(
      activityKindFor(schema.name),
      null,
      `${schema.name} has no activity kind`,
    );
  }
});
