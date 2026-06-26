import React from 'react';
import { Box, Text, useInput } from 'ink';
import { useStore } from '../../state/store.js';

export const HelpDialog: React.FC = () => {
  const closeOverlay = useStore((s) => s.closeOverlay);

  useInput((_input, key) => {
    if (key.escape || key.return) closeOverlay();
  });

  return (
    <Box flexDirection="column" minWidth={60}>
      <Text bold underline>Keyboard Shortcuts</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text>Ctrl+P     Command palette</Text>
        <Text>Ctrl+N     New session</Text>
        <Text>Ctrl+Q     Quit</Text>
        <Text>Ctrl+S     Toggle sidebar</Text>
        <Text>Tab        Cycle strategy</Text>
        <Text>↑/↓        History / navigate</Text>
        <Text>PgUp/PgDn  Scroll chat</Text>
        <Text>Ctrl+L     Clear messages</Text>
        <Text>Ctrl+C     Cancel / exit</Text>
        <Text>1-4        Switch page</Text>
        <Text>?/F1       Help</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Esc or Enter to close</Text>
      </Box>
    </Box>
  );
};
