import { Box, Text } from "ink";

import {
  Header,
  type HeaderProps,
} from "./Header.js";
import { Markdown } from "./Markdown.js";
import { SectionBar } from "./SectionBar.js";
import { ToolActivity } from "./ToolActivity.js";

export type SystemTone = "info" | "error" | "warning";

export type NewTranscriptItem =
  | { kind: "header"; data: HeaderProps }
  | { kind: "user"; text: string }
  | { kind: "thought"; text: string }
  | { kind: "assistant"; text: string }
  | {
      kind: "tool";
      name: string;
      arguments: Record<string, unknown>;
      data: unknown;
      error: string | null;
      durationMs: number;
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
    case "header":
      return <Header {...item.data} />;

    case "user":
      return <SectionBar title={item.text} />;

    case "thought":
      return (
        <Box>
          <Text color="cyan">✻ </Text>
          <Text dimColor>{item.text}</Text>
        </Box>
      );

    case "assistant":
      return (
        <Box flexDirection="row" marginTop={1}>
          <Text color="green">● </Text>
          <Box flexDirection="column" flexGrow={1}>
            <Markdown text={item.text} widthOffset={2} />
          </Box>
        </Box>
      );

    case "tool":
      return (
        <ToolActivity
          name={item.name}
          arguments={item.arguments}
          data={item.data}
          error={item.error}
          durationMs={item.durationMs}
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
