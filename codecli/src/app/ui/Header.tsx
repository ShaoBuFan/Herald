import { Box, Text, useStdout } from "ink";

import { displayWidth } from "./text.js";

export interface HeaderProps {
  appName: string;
  version: string;
  provider: string;
  model: string;
  cwd: string;
  toolCount: number;
  modeCount: number;
}

const ACCENT = "#d97757";

const BANNER_ROWS = [
  "   ______          __         ________    ____",
  String.raw`  / ____/___  ____/ /__      / ____/ /   /  _/`,
  String.raw` / /   / __ \/ __  / _ \    / /   / /    / /`,
  String.raw`/ /___/ /_/ / /_/ /  __/   / /___/ /____/ /`,
  String.raw`\____/\____/\__,_/\___/    \____/_____/___/`,
] as const;

const BANNER_WIDTH = Math.max(
  ...BANNER_ROWS.map((row) => displayWidth(row)),
);

export function CodeCliBanner() {
  return (
    <Box flexDirection="column">
      {BANNER_ROWS.map((row, index) => (
        <Text key={index} bold color={ACCENT}>
          {row}
        </Text>
      ))}
    </Box>
  );
}

function WelcomeColumn({
  provider,
  model,
  cwd,
  width,
}: {
  provider: string;
  model: string;
  cwd: string;
  width: number | string;
}) {
  return (
    <Box
      alignItems="center"
      flexDirection="column"
      paddingX={1}
      paddingY={1}
      width={width}
    >
      <Text bold>Welcome back!</Text>
      <Box marginY={1}>
        <CodeCliBanner />
      </Box>
      <Text dimColor>
        {provider} · {model} · API Usage
      </Text>
      <Text dimColor>{cwd}</Text>
    </Box>
  );
}

function TipsColumn({
  toolCount,
  modeCount,
  width,
  dividerWidth,
  borderLeft,
}: {
  toolCount: number;
  modeCount: number;
  width: number | string;
  dividerWidth: number;
  borderLeft: boolean;
}) {
  return (
    <Box
      borderBottom={false}
      borderColor={ACCENT}
      borderLeft={borderLeft}
      borderRight={false}
      borderStyle="single"
      borderTop={!borderLeft}
      flexDirection="column"
      paddingX={1}
      paddingY={1}
      width={width}
    >
      <Text bold color={ACCENT}>
        Tips for getting started
      </Text>
      <Text>{toolCount} tools · {modeCount} modes · /help for commands</Text>
      <Text>Run /mode plan for read-only investigation</Text>
      <Text>Shift+Tab switches modes · Esc interrupts</Text>

      <Text dimColor>{"─".repeat(dividerWidth)}</Text>

      <Text bold color={ACCENT}>
        Recent activity
      </Text>
      <Text dimColor>No recent activity</Text>
    </Box>
  );
}

export function Header({
  appName,
  version,
  provider,
  model,
  cwd,
  toolCount,
  modeCount,
}: HeaderProps) {
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;
  const panelWidth = Math.max(
    40,
    Math.min(120, columns - 1),
  );
  const innerWidth = panelWidth - 2;
  const twoColumn = panelWidth >= 96;
  const leftWidth = twoColumn
    ? Math.min(
      BANNER_WIDTH + 4,
      Math.max(
        BANNER_WIDTH + 2,
        Math.floor(innerWidth * 0.52),
      ),
    )
    : innerWidth;
  const rightWidth = innerWidth - leftWidth;
  const title = `${appName} v${version}`;
  const titleRemaining = Math.max(
    1,
    panelWidth - displayWidth(title) - 5,
  );
  const top = `╭─ ${title} ${"─".repeat(titleRemaining)}╮`;
  const bottom = `╰${"─".repeat(panelWidth - 2)}╯`;
  const dividerWidth = Math.max(
    8,
    twoColumn ? rightWidth - 3 : innerWidth - 2,
  );

  return (
    <Box flexDirection="column" marginBottom={1} width="100%">
      <Text color={ACCENT}>{top}</Text>
      <Box
        borderBottom={false}
        borderColor={ACCENT}
        borderStyle="round"
        borderTop={false}
        flexDirection={twoColumn ? "row" : "column"}
        width={panelWidth}
      >
        <WelcomeColumn
          provider={provider}
          model={model}
          cwd={cwd}
          width={twoColumn ? leftWidth : "100%"}
        />
        <TipsColumn
          toolCount={toolCount}
          modeCount={modeCount}
          width={twoColumn ? rightWidth : "100%"}
          dividerWidth={dividerWidth}
          borderLeft={twoColumn}
        />
      </Box>
      <Text color={ACCENT}>{bottom}</Text>
    </Box>
  );
}
