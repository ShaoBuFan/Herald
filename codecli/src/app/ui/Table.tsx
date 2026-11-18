import { Box, Text } from "ink";

import {
  displayWidth,
  padDisplay,
  wrapDisplay,
  type TextAlign,
} from "./text.js";

export interface TableBlock {
  header: string[];
  alignments: TextAlign[];
  rows: string[][];
  /** 表格之后的第一行索引（不含）。 */
  end: number;
}

function splitRow(line: string): string[] | null {
  if (!line.includes("|")) {
    return null;
  }

  let body = line.trim();
  if (body.startsWith("|")) {
    body = body.slice(1);
  }
  if (body.endsWith("|") && !body.endsWith("\\|")) {
    body = body.slice(0, -1);
  }

  const cells: string[] = [];
  let current = "";
  let escaped = false;
  let inCode = false;

  for (const character of body) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "`") {
      inCode = !inCode;
      current += character;
      continue;
    }
    if (character === "|" && !inCode) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (escaped) {
    current += "\\";
  }
  cells.push(current.trim());
  return cells;
}

function isSeparator(cells: string[]): boolean {
  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
  );
}

function alignment(cell: string): TextAlign {
  const trimmed = cell.trim();
  const left = trimmed.startsWith(":");
  const right = trimmed.endsWith(":");
  if (left && right) {
    return "center";
  }
  if (right) {
    return "right";
  }
  return "left";
}

function normalize(
  cells: string[],
  count: number,
): string[] {
  return Array.from(
    { length: count },
    (_, index) => cells[index] ?? "",
  );
}

export function parseTable(
  lines: string[],
  start: number,
): TableBlock | null {
  const header = splitRow(lines[start] ?? "");
  const separator = splitRow(lines[start + 1] ?? "");
  if (
    !header ||
    !separator ||
    header.length === 0 ||
    header.length !== separator.length ||
    !isSeparator(separator)
  ) {
    return null;
  }

  const count = header.length;
  const rows: string[][] = [];
  let index = start + 2;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      break;
    }
    const cells = splitRow(line);
    if (!cells) {
      break;
    }
    rows.push(normalize(cells, count));
    index += 1;
  }

  return {
    header: normalize(header, count),
    alignments: separator.map(alignment),
    rows,
    end: index,
  };
}

function plainCell(text: string): string {
  return text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\r?\n/g, " ");
}

function columnWidths(
  table: TableBlock,
  columns: number,
): number[] {
  const count = table.header.length;
  const natural = Array.from({ length: count }, (_, index) => {
    let width = displayWidth(
      plainCell(table.header[index] ?? ""),
    );
    for (const row of table.rows) {
      width = Math.max(
        width,
        displayWidth(plainCell(row[index] ?? "")),
      );
    }
    return Math.max(1, width);
  });

  const available = Math.max(20, columns - 1);
  const overhead = 3 * count + 1;
  const budget = Math.max(count, available - overhead);
  const widths = [...natural];
  let total = widths.reduce(
    (sum, width) => sum + width,
    0,
  );

  while (total > budget) {
    let widest = 0;
    for (let index = 1; index < widths.length; index += 1) {
      if (widths[index]! > widths[widest]!) {
        widest = index;
      }
    }
    if (widths[widest]! <= 1) {
      break;
    }
    widths[widest] = widths[widest]! - 1;
    total -= 1;
  }

  return widths;
}

function border(
  widths: number[],
  left: string,
  middle: string,
  right: string,
): string {
  return (
    left +
    widths
      .map((width) => "─".repeat(width + 2))
      .join(middle) +
    right
  );
}

function renderRow(
  cells: string[],
  widths: number[],
  alignments: TextAlign[],
): string {
  return (
    "│ " +
    cells
      .map((cell, index) =>
        padDisplay(
          cell,
          widths[index] ?? 1,
          alignments[index] ?? "left",
        ),
      )
      .join(" │ ") +
    " │"
  );
}

function wrappedRows(
  cells: string[],
  widths: number[],
  alignments: TextAlign[],
): string[] {
  const wrapped = cells.map((cell, index) =>
    wrapDisplay(
      plainCell(cell),
      widths[index] ?? 1,
    ),
  );
  const height = Math.max(
    1,
    ...wrapped.map((lines) => lines.length),
  );

  return Array.from({ length: height }, (_, lineIndex) =>
    renderRow(
      wrapped.map(
        (lines) => lines[lineIndex] ?? "",
      ),
      widths,
      alignments,
    ),
  );
}

export interface MarkdownTableProps {
  table: TableBlock;
  columns: number;
}

export function MarkdownTable({
  table,
  columns,
}: MarkdownTableProps) {
  const widths = columnWidths(table, columns);
  const top = border(widths, "┌", "┬", "┐");
  const middle = border(widths, "├", "┼", "┤");
  const bottom = border(widths, "└", "┴", "┘");

  const headerLines = wrappedRows(
    table.header,
    widths,
    table.alignments,
  );
  const bodyLines = table.rows.flatMap((row) =>
    wrappedRows(row, widths, table.alignments),
  );

  return (
    <Box flexDirection="column" marginY={1}>
      <Text dimColor>{top}</Text>
      {headerLines.map((line, index) => (
        <Text key={`h-${index}`} bold>
          {line}
        </Text>
      ))}
      <Text dimColor>{middle}</Text>
      {bodyLines.map((line, index) => (
        <Text key={`r-${index}`}>{line}</Text>
      ))}
      <Text dimColor>{bottom}</Text>
    </Box>
  );
}
