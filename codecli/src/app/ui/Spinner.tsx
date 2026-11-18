import { useEffect, useState } from "react";
import { Box, Text } from "ink";

import { formatDuration, formatTokens } from "./format.js";

const FRAMES = ["✻", "✢", "✳", "✶", "✽"] as const;

const TIPS = [
  "Shift+Tab 切换模式",
  "/help 查看命令",
  "Esc 中断当前任务",
  "双击 Enter 发送",
] as const;

export interface SpinnerProps {
  label: string;
  startedAt?: number;
  tokens?: number | null;
  tip?: string;
}

export function Spinner({
  label,
  startedAt = Date.now(),
  tokens = null,
  tip,
}: SpinnerProps) {
  const [frame, setFrame] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((value) => (value + 1) % FRAMES.length);
    }, 120);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setTipIndex((value) => (value + 1) % TIPS.length);
    }, 8_000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = Math.max(0, now - startedAt);
  const tokenText =
    tokens !== null
      ? ` · ↓ ${formatTokens(tokens)} tokens`
      : "";

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color="#d97757">{FRAMES[frame]}</Text>
        <Text dimColor>
          {" "}
          {label}… ({formatDuration(elapsed)}
          {tokenText})
        </Text>
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>
          └ Tip: {tip ?? TIPS[tipIndex]}
        </Text>
      </Box>
    </Box>
  );
}
