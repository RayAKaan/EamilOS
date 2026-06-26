import React, { useState } from 'react';
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
  const [expanded, setExpanded] = useState(false);
  const icon = STATUS_ICONS[tool.status] ?? '○';
  const sc = STATUS_COLORS[tool.status] ?? 'white';

  return (
    <Box flexDirection="column" marginY={0}>
      <Box>
        <Text color={sc}>{icon}</Text>
        <Text> </Text>
        <Text bold>{tool.name}</Text>
        <Text dimColor> {tool.id.slice(0, 8)}</Text>
      </Box>
      {expanded && (
        <Box paddingLeft={4} flexDirection="column">
          <Text wrap="wrap">{tool.args}</Text>
          {tool.result && (
            <Box marginTop={0}>
              <Text dimColor>→ </Text>
              <Text wrap="wrap">{tool.result}</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};
