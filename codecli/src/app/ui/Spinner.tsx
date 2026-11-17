import { useEffect, useState } from "react";
import { Box, Text } from "ink";

const FRAMES = ["✻", "✢", "✳", "✶"] as const;

export interface SpinnerProps {
  label: string;
}

export function Spinner({ label }: SpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((value) => (value + 1) % FRAMES.length);
    }, 120);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box>
      <Text color="cyan">{FRAMES[frame]}</Text>
      <Text dimColor> {label}…</Text>
    </Box>
  );
}
