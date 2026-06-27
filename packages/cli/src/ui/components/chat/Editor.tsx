import React, { useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { useStore } from '../../state/store.js';
import { run } from '../../hooks/useOrchestrator.js';

interface Props {
  isRunning: boolean;
}

export const Editor: React.FC<Props> = ({ isRunning }) => {
  const activePage = useStore((s) => s.activePage);
  const activeOverlay = useStore((s) => s.activeOverlay);
  const chatInputValue = useStore((s) => s.chatInputValue);
  const setChatInputValue = useStore((s) => s.setChatInputValue);
  const setInputFocused = useStore((s) => s.setInputFocused);
  const isInputFocused = useStore((s) => s.isInputFocused);

  const canType = activePage === 'chat' && !activeOverlay && !isRunning;

  useInput((input, key) => {
    if (!canType) return;

    if (key.escape) {
      setInputFocused(false);
      setChatInputValue('');
      return;
    }

    if (key.return && !key.shift) {
      const value = chatInputValue.trim();
      if (value) {
        setInputFocused(false);
        setChatInputValue('');
        run(value);
      }
      return;
    }

    if (key.return && key.shift) {
      setChatInputValue(chatInputValue + '\n');
      return;
    }

    if (key.backspace) {
      setChatInputValue(chatInputValue.slice(0, -1));
      return;
    }

    if (input && !key.ctrl && !key.meta && !key.escape) {
      setChatInputValue(chatInputValue + input);
    }
  }, { isActive: canType });

  const displayLines = isRunning
    ? ['…']
    : chatInputValue
      ? chatInputValue.split('\n')
      : ['ask something'];

  const showCursor = !isRunning && (isInputFocused || chatInputValue.length > 0);

  return (
    <Box flexDirection="column" width="100%" borderStyle="single" borderColor="gray" paddingX={1}>
      {displayLines.map((line, i) => (
        <Box key={i} flexDirection="row" width="100%">
          <Text bold color="cyan">{i === 0 ? '▸' : ' '}</Text>
          <Text> </Text>
          <Text wrap={i === displayLines.length - 1 ? 'truncate-end' : undefined}>
            {line || ' '}
            {showCursor && i === displayLines.length - 1 ? (
              <Text inverse> </Text>
            ) : null}
          </Text>
        </Box>
      ))}
    </Box>
  );
};
