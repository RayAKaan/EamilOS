import React, { useState } from 'react';
import { Box, Text } from 'ink';
import type { UIBridge } from '../../bridge';

interface ConfigViewProps {
  bridge: UIBridge;
}

export const ConfigView: React.FC<ConfigViewProps> = ({ bridge }) => {
  const [selectedField, setSelectedField] = useState(0);
  const [config] = useState({
    claudePath: '/usr/local/bin/claude',
    openaiKey: 'sk-***...',
    ollamaHost: 'http://localhost:11434',
    controllerPort: '3000'
  });

  const fields = [
    { label: 'Claude CLI', value: config.claudePath },
    { label: 'OpenAI Key', value: config.openaiKey },
    { label: 'Ollama Host', value: config.ollamaHost },
    { label: 'Controller Port', value: config.controllerPort }
  ];

  return (
    <Box flexDirection="column" height="100%">
      <Box paddingX={2}>
        <Text bold color="cyan">Configuration</Text>
      </Box>

      <Box flexGrow={1} flexDirection="column" padding={2}>
        {fields.map((field, index) => (
          <Box key={index} paddingY={1}>
            <Box width="40%">
              <Text>{field.label}</Text>
            </Box>
            <Box width="60%">
              <Text color="gray">{field.value}</Text>
            </Box>
          </Box>
        ))}
      </Box>

      <Box paddingX={2} height={3}>
        <Text dimColor>Navigate: arrow keys | Edit: Enter | Save: Ctrl+S | Back: Esc</Text>
      </Box>
    </Box>
  );
};