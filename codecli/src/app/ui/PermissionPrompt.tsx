import { Box, Text } from "ink";

import type { ApprovalRequest } from "../tools/policy.js";
import {
  displayToolName,
  formatToolCallArguments,
} from "./format.js";

export interface PermissionPromptProps {
  request: ApprovalRequest;
}

export function PermissionPrompt({
  request,
}: PermissionPromptProps) {
  const subject = formatToolCallArguments(
    request.tool,
    request.arguments,
  );
  return (
    <Box flexDirection="column" marginY={1}>
      <Text color="yellow" bold>
        ⏸ Permission required ·{" "}
        {displayToolName(request.tool)}
      </Text>
      {subject ? <Text dimColor>{subject}</Text> : null}
      <Text dimColor>
        y allow · n deny · esc cancel
      </Text>
    </Box>
  );
}
