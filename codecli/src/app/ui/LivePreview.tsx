import { Box, Text } from "ink";

export interface LivePreviewProps {
  content: string;
  maxLines?: number;
}

export function LivePreview({
  content,
  maxLines = 6,
}: LivePreviewProps) {
  const lines = content.split(/\r?\n/);
  const visible = lines.slice(-maxLines);
  return (
    <Box flexDirection="column" marginBottom={1}>
      {visible.map((line, index) => (
        <Text key={index} dimColor>
          {line || " "}
        </Text>
      ))}
    </Box>
  );
}
