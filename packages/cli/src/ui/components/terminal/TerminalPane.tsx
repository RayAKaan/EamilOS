import React from 'react';
import { Box, Text } from 'ink';
import type { TerminalInfo } from '../../types/ui.js';

interface Props {
  terminal: TerminalInfo;
}

export const TerminalPane: React.FC<Props> = ({ terminal }) => {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
    >
      <Box>
        <Text bold>{terminal.callsign}</Text>
        <Text dimColor> @{terminal.agentId}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text dimColor>— idle —</Text>
      </Box>
    </Box>
  );
};
