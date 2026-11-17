import { Box, Text } from "ink";

import { Markdown } from "./Markdown.js";
import {
  ToolCallLine,
  ToolResultLine,
} from "./ToolCard.js";
import {
  Welcome,
  type WelcomeProps,
} from "./Welcome.js";

export type SystemTone = "info" | "error" | "warning";

export type NewTranscriptItem =
  | { kind: "welcome"; data: WelcomeProps }
  | { kind: "user"; text: string }
  | { kind: "thought"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; detail: string }
  | {
      kind: "result";
      name: string;
      data: unknown;
      error: string | null;
    }
  | { kind: "system"; text: string; tone?: SystemTone }
  | { kind: "summary"; text: string };

export type TranscriptItem = NewTranscriptItem & { id: number };

function SystemLine({
  text,
  tone,
}: {
  text: string;
  tone?: SystemTone;
}) {
  if (tone === "error") {
    return (
      <Box>
        <Text color="red">{text}</Text>
      </Box>
    );
  }
  if (tone === "warning") {
    return (
      <Box>
        <Text color="yellow">{text}</Text>
      </Box>
    );
  }
  return (
    <Box>
      <Text dimColor>{text}</Text>
    </Box>
  );
}

export function TranscriptItemView({
  item,
}: {
  item: TranscriptItem;
}) {
  switch (item.kind) {
    case "welcome":
      return <Welcome {...item.data} />;

    case "user":
      return (
        <Box marginTop={1}>
          <Text color="yellow">You</Text>
          <Text> {item.text}</Text>
        </Box>
      );

    case "thought":
      return (
        <Box>
          <Text color="cyan">✻ </Text>
          <Text dimColor>{item.text}</Text>
        </Box>
      );

    case "assistant":
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color="green">⏺</Text>
          <Markdown text={item.text} indent={2} />
        </Box>
      );

    case "tool":
      return (
        <ToolCallLine name={item.name} detail={item.detail} />
      );

    case "result":
      return (
        <ToolResultLine
          name={item.name}
          data={item.data}
          error={item.error}
        />
      );

    case "system":
      return <SystemLine text={item.text} tone={item.tone} />;

    case "summary":
      return (
        <Box marginTop={1}>
          <Text dimColor>{item.text}</Text>
        </Box>
      );
  }
}
