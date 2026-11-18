import { useEffect, useState } from "react";
import { Box, Text } from "ink";

import {
  formatDuration,
  presentToolCall,
  toolResultDetail,
} from "./format.js";

export interface ToolActivityProps {
  name: string;
  arguments: Record<string, unknown>;
  data?: unknown;
  error?: string | null;
  durationMs?: number;
  startedAt?: number;
  pending?: boolean;
}

function useElapsed(
  startedAt: number | undefined,
  active: boolean,
): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active || startedAt === undefined) {
      return;
    }
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => clearInterval(timer);
  }, [active, startedAt]);

  if (startedAt === undefined) {
    return 0;
  }
  return Math.max(0, now - startedAt);
}

export function ToolActivity({
  name,
  arguments: arguments_,
  data,
  error = null,
  durationMs,
  startedAt,
  pending = false,
}: ToolActivityProps) {
  const elapsed = useElapsed(startedAt, pending);
  const presentation = presentToolCall(
    name,
    arguments_,
    pending ? "active" : "done",
  );
  const detail = pending
    ? null
    : toolResultDetail(name, data, error);
  const denied = Boolean(
    error?.includes("permission denied"),
  );
  const shownDuration =
    durationMs ?? (pending ? elapsed : undefined);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={detail?.error ? "red" : "green"}>● </Text>
        <Text bold>
          {denied ? "Not run" : presentation.action}
        </Text>
        {!denied && shownDuration !== undefined ? (
          <Text dimColor> · {formatDuration(shownDuration)}</Text>
        ) : null}
        {denied ? (
          <Text color="red"> · denied</Text>
        ) : detail?.error ? (
          <Text color="red"> · failed</Text>
        ) : null}
      </Box>

      {presentation.command ? (
        <Box marginLeft={2}>
          <Text dimColor>└ </Text>
          <Text dimColor>{presentation.command}</Text>
        </Box>
      ) : null}

      {detail && !denied ? (
        <Box marginLeft={presentation.command ? 4 : 2}>
          <Text
            color={detail.error ? "red" : undefined}
            dimColor={!detail.error}
          >
            {presentation.command ? detail.text : `└ ${detail.text}`}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
