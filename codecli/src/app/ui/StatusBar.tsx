import { Box, Text } from "ink";

import {
  MODE_PRESENTATIONS,
  type ModePresentation,
} from "./mode-presentation.js";
import type { SessionMode } from "../modes.js";

export interface StatusBarProps {
  mode: SessionMode;
  busy: boolean;
  waiting?: boolean;
}

export function StatusBar({
  mode,
  busy,
  waiting = false,
}: StatusBarProps) {
  const info: ModePresentation =
    MODE_PRESENTATIONS[mode];
  const hint = waiting
    ? "permission required"
    : busy
      ? "esc to interrupt"
      : "? for shortcuts";
  return (
    <Box>
      <Text color={info.color}>{info.statusLabel}</Text>
      <Text dimColor> · {hint}</Text>
    </Box>
  );
}
