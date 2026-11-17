import { Box, Text } from "ink";

import {
  displayToolName,
  summarizeToolResult,
} from "./format.js";

export interface ToolCallLineProps {
  name: string;
  detail: string;
}

export function ToolCallLine({
  name,
  detail,
}: ToolCallLineProps) {
  const display = displayToolName(name);
  return (
    <Box marginTop={1}>
      <Text color="green">⏺ </Text>
      <Text bold>{display}</Text>
      <Text dimColor>({detail})</Text>
    </Box>
  );
}

export interface ToolResultLineProps {
  name: string;
  data: unknown;
  error: string | null;
}

export function ToolResultLine({
  name,
  data,
  error,
}: ToolResultLineProps) {
  const summary = summarizeToolResult(name, data, error);
  return (
    <Box marginLeft={2}>
      <Text dimColor>⎿ </Text>
      <Text
        color={summary.error ? "red" : undefined}
        dimColor={!summary.error}
      >
        {summary.text}
      </Text>
    </Box>
  );
}
