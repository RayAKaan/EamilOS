import React, { useState, useEffect } from 'react';
import { Box, Text, useStdout } from 'ink';

export const WelcomeBanner: React.FC = () => {
  const { stdout } = useStdout();
  const [cols, setCols] = useState(() => stdout.columns || 80);

  useEffect(() => {
    const onResize = () => setCols(stdout.columns);
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);

  const innerWidth = Math.min(cols - 4, 60);

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" paddingY={1}>
      <Box borderStyle="round" borderColor="cyan" paddingX={1} paddingY={1} flexDirection="column" alignItems="center">
        <Text color="cyan" bold>
          {'═'.repeat(innerWidth)}
        </Text>
        <Text color="cyan" bold>
          {' ' .repeat(Math.floor((innerWidth - 24) / 2))}EamilOS Multi-Agent{' ' .repeat(Math.ceil((innerWidth - 24) / 2))}
        </Text>
        <Text color="cyan" bold>
          {' ' .repeat(Math.floor((innerWidth - 18) / 2))}AI Orchestrator{' ' .repeat(Math.ceil((innerWidth - 18) / 2))}
        </Text>
        <Text color="cyan" bold>
          {'═'.repeat(innerWidth)}
        </Text>
        <Box marginTop={1} gap={2}>
          <Text color="cyan">🤖 OpenCode</Text>
          <Text color="magenta">🤖 Gemini CLI</Text>
          <Text color="blue">📊 Graphify</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Type a task below to get started. Both agents will collaborate.</Text>
        </Box>
        <Box marginTop={1} gap={1}>
          <Text dimColor>Strategies:</Text>
          <Text color="cyan">opencode-first</Text>
          <Text dimColor>│</Text>
          <Text color="magenta">gemini-first</Text>
          <Text dimColor>│</Text>
          <Text color="blue">parallel</Text>
          <Text dimColor>│</Text>
          <Text color="yellow">swarm</Text>
        </Box>
      </Box>
    </Box>
  );
};
