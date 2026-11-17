import { Box, Text } from "ink";

export interface InputBoxProps {
  value: string;
  busy: boolean;
}

export function InputBox({ value, busy }: InputBoxProps) {
  const lines = value.split("\n");

  return (
    <Box
      borderColor={busy ? "gray" : "green"}
      borderStyle="round"
      flexDirection="column"
      paddingX={1}
      width="100%"
    >
      {lines.map((line, index) => (
        <Box key={index}>
          <Text color="green">
            {index === 0 ? (busy ? "…" : ">") : " "}{" "}
          </Text>
          <Text>
            {line ||
              (index === 0 && value === ""
                ? "输入消息…"
                : "")}
            {!busy && index === lines.length - 1 ? (
              <Text color="green">▌</Text>
            ) : null}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
