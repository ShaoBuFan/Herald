import { Box, Text } from "ink";

export interface SectionBarProps {
  title: string;
}

export function SectionBar({ title }: SectionBarProps) {
  const lines = title.split("\n");
  return (
    <Box
      backgroundColor="#303030"
      flexDirection="column"
      marginTop={1}
      paddingX={1}
      width="100%"
    >
      {lines.map((line, index) => (
        <Text key={index} color="white">
          {index === 0 ? "> " : "  "}
          {line || " "}
        </Text>
      ))}
    </Box>
  );
}
