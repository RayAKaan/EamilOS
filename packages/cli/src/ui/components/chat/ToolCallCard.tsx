import React from 'react';
import { Box, Text } from 'ink';
import type { ToolCall } from '../../types/ui.js';

interface Props {
  tool: ToolCall;
}

const STATUS_ICONS: Record<string, string> = {
  pending: '○',
  running: '…',
  done: '✓',
  failed: '✗',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'white',
  running: 'yellow',
  done: 'green',
  failed: 'red',
};

export const ToolCallCard: React.FC<Props> = ({ tool }) => {
  const icon = STATUS_ICONS[tool.status] ?? '○';
  const sc = STATUS_COLORS[tool.status] ?? 'white';

  return (
    <Box flexDirection="column" marginY={0}>
      <Box>
        <Text color={sc}>{icon}</Text>
        <Text> </Text>
        <Text bold>{tool.name}</Text>
        <Text> </Text>
        <Text color={sc}>{tool.status}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text wrap="truncate-end" dimColor>{tool.args}</Text>
      </Box>
      {tool.lines !== undefined && (
        <Box paddingLeft={2}>
          <Text color="green">+{tool.lines} lines</Text>
        </Box>
      )}
    </Box>
  );
};
