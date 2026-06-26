import React from 'react';
import { Box, Text, useInput } from 'ink';
import { useStore } from '../../state/store.js';
import { useApp } from 'ink';

export const QuitDialog: React.FC = () => {
  const closeOverlay = useStore((s) => s.closeOverlay);
  const { exit } = useApp();

  useInput((input) => {
    if (input === 'y' || input === 'Y') {
      exit();
    } else if (input === 'n' || input === 'N') {
      closeOverlay();
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Quit EamilOS TUI?</Text>
      <Box marginTop={1}>
        <Text color="green">[Y] Yes</Text>
        <Text> </Text>
        <Text color="red">[N] No</Text>
      </Box>
    </Box>
  );
};
