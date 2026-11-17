import { Box, Text } from "ink";

export interface WelcomeProps {
  appName: string;
  provider: string;
  model: string;
  cwd: string;
  runtime: string;
  toolCount: number;
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <Box>
      <Box width={9}>
        <Text dimColor>{label}</Text>
      </Box>
      <Text>{value}</Text>
    </Box>
  );
}

export function Welcome({
  appName,
  provider,
  model,
  cwd,
  runtime,
  toolCount,
}: WelcomeProps) {
  return (
    <Box
      alignItems="center"
      borderColor="gray"
      borderStyle="round"
      flexDirection="row"
      marginBottom={1}
      paddingX={1}
    >
      <Box
        alignItems="center"
        flexDirection="column"
        justifyContent="center"
        marginRight={1}
        width={14}
      >
        <Text bold color="yellow">
          ✻
        </Text>
        <Text bold color="yellow">
          ✻✻✻
        </Text>
        <Text bold color="yellow">
          ✻
        </Text>
        <Text bold>{appName}</Text>
        <Text dimColor>v0.1</Text>
      </Box>

      <Box
        borderBottom={false}
        borderLeft={true}
        borderRight={false}
        borderStyle="single"
        borderTop={false}
        flexDirection="column"
        flexGrow={1}
        paddingLeft={1}
      >
        <Text bold color="yellow">
          What's new
        </Text>
        <Text dimColor>· TypeScript + React Ink</Text>
        <Text dimColor>· Double-Enter to send</Text>
        <Text dimColor>· OpenAI native tools + Mattermost XML</Text>

        <Box
          borderBottom={false}
          borderLeft={false}
          borderRight={false}
          borderStyle="single"
          borderTop={true}
          marginY={1}
        />

        <Text bold color="yellow">
          Workspace
        </Text>
        <InfoRow label="provider" value={provider} />
        <InfoRow label="model" value={model} />
        <InfoRow label="cwd" value={cwd} />
        <InfoRow label="runtime" value={runtime} />
        <InfoRow label="tools" value={String(toolCount)} />

        <Box marginTop={1}>
          <Text dimColor>
            /help 查看命令 · /exit 退出
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
