import type { ReactNode } from "react";
import { Box, Text, useStdout } from "ink";

import { MarkdownTable, parseTable } from "./Table.js";

function inlineNodes(
  text: string,
  keyPrefix: string,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let buffer = "";
  let index = 0;
  let nodeIndex = 0;

  const flush = (): void => {
    if (buffer) {
      nodes.push(buffer);
      buffer = "";
    }
  };

  while (index < text.length) {
    if (text[index] === "`") {
      const end = text.indexOf("`", index + 1);
      if (end !== -1) {
        flush();
        nodes.push(
          <Text
            key={`${keyPrefix}-code-${nodeIndex}`}
            color="cyan"
          >
            {text.slice(index + 1, end)}
          </Text>,
        );
        nodeIndex += 1;
        index = end + 1;
        continue;
      }
    }

    if (text.startsWith("**", index)) {
      const end = text.indexOf("**", index + 2);
      if (end !== -1) {
        flush();
        nodes.push(
          <Text
            key={`${keyPrefix}-bold-${nodeIndex}`}
            bold
          >
            {text.slice(index + 2, end)}
          </Text>,
        );
        nodeIndex += 1;
        index = end + 2;
        continue;
      }
    }

    buffer += text[index];
    index += 1;
  }

  flush();
  return nodes;
}

export interface MarkdownProps {
  text: string;
  indent?: number;
  widthOffset?: number;
}

export function Markdown({
  text,
  indent = 0,
  widthOffset = 0,
}: MarkdownProps): ReactNode {
  const { stdout } = useStdout();
  const columns = Math.max(
    20,
    (stdout?.columns ?? 80) - widthOffset - indent * 2,
  );
  const rows: ReactNode[] = [];
  const padding = "  ".repeat(indent);
  const lines = text.split("\n");
  let codeLines: string[] | null = null;
  let key = 0;

  const pushCode = (): void => {
    if (codeLines === null) {
      return;
    }
    rows.push(
      <Text key={`code-${key}`} color="gray">
        {codeLines
          .map((line) => `${padding}${line}`)
          .join("\n")}
      </Text>,
    );
    key += 1;
    codeLines = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;

    if (codeLines === null) {
      const table = parseTable(lines, index);
      if (table) {
        rows.push(
          <MarkdownTable
            key={`table-${key}`}
            table={table}
            columns={columns}
          />,
        );
        key += 1;
        index = table.end - 1;
        continue;
      }
    }

    if (line.trimStart().startsWith("```")) {
      if (codeLines === null) {
        codeLines = [];
      } else {
        pushCode();
      }
      continue;
    }

    if (codeLines !== null) {
      codeLines.push(line);
      continue;
    }

    const trimmedStart = line.trimStart();
    if (trimmedStart.startsWith("#")) {
      const level = trimmedStart.length - trimmedStart.replace(/^#+/, "").length;
      const content = trimmedStart.slice(level).trim();
      rows.push(
        <Text key={`h-${key}`} bold color="cyan">
          {padding}
          {content}
        </Text>,
      );
      key += 1;
      continue;
    }

    if (
      trimmedStart.startsWith("- ") ||
      trimmedStart.startsWith("* ")
    ) {
      const content = trimmedStart.slice(2);
      rows.push(
        <Text key={`b-${key}`}>
          {padding}• {inlineNodes(content, `b-${key}`)}
        </Text>,
      );
      key += 1;
      continue;
    }

    if (line.trim() === "") {
      rows.push(<Text key={`e-${key}`}> </Text>);
      key += 1;
      continue;
    }

    rows.push(
      <Text key={`t-${key}`}>
        {padding}
        {inlineNodes(line, `t-${key}`)}
      </Text>,
    );
    key += 1;
  }

  pushCode();
  return <Box flexDirection="column">{rows}</Box>;
}
