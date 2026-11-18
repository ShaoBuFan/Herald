import { Text, useStdout } from "ink";

export function Rule() {
  const { stdout } = useStdout();
  const width = Math.max(20, stdout?.columns ?? 80);
  return <Text dimColor>{"─".repeat(width)}</Text>;
}
