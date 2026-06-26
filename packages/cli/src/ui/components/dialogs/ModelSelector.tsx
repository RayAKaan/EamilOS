import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useStore } from '../../state/store.js';

const MODELS = [
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { id: 'gemini-2.0-pro', label: 'Gemini 2.0 Pro' },
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  { id: 'local', label: 'Local (ollama)' },
];

export const ModelSelector: React.FC = () => {
  const [selected, setSelected] = useState(0);
  const closeOverlay = useStore((s) => s.closeOverlay);

  useInput((_input, key) => {
    if (key.return) {
      closeOverlay();
    } else if (key.escape) {
      closeOverlay();
    } else if (key.upArrow) {
      setSelected((p) => Math.max(0, p - 1));
    } else if (key.downArrow) {
      setSelected((p) => Math.min(MODELS.length - 1, p + 1));
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Select Model</Text>
      {MODELS.map((m, i) => (
        <Box key={m.id}>
          <Text color={i === selected ? 'cyan' : 'white'}>
            {i === selected ? '▸ ' : '  '}{m.label}
          </Text>
        </Box>
      ))}
    </Box>
  );
};
