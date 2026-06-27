import React from 'react';
import { Box, Text } from 'ink';

const EXAMPLES = [
  'Analyze this repo and propose improvements',
  'Fix failing tests and explain changes',
  'Refactor the auth module safely',
  'Run swarm mode to compare implementation plans',
];

export const WelcomeScreen: React.FC = () => {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text color="cyan" bold>
          ███████╗ █████╗ ███╗   ███╗██╗██╗      ██████╗ ███████╗
        </Text>
        <Text color="cyan" bold>
          ██╔════╝██╔══██╗████╗ ████║██║██║     ██╔═══██╗██╔════╝
        </Text>
        <Text color="cyan" bold>
          █████╗  ███████║██╔████╔██║██║██║     ██║   ██║███████╗
        </Text>
        <Text color="cyan" bold>
          ██╔══╝  ██╔══██║██║╚██╔╝██║██║██║     ██║   ██║╚════██║
        </Text>
        <Text color="cyan" bold>
          ███████╗██║  ██║██║ ╚═╝ ██║██║███████╗╚██████╔╝███████║
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text bold>EamilOS TUI-first AI Agent OS</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginBottom={1}>
        <Text bold>Shortcuts</Text>
        <Text dimColor>1 chat · 2 logs · 3 sessions · 4 agents · Ctrl+P command palette · Ctrl+S sidebar · Ctrl+L clear · ? help</Text>
        <Text dimColor>Input: 1-5 strategy · ↑ repeat last prompt · Enter submit</Text>
      </Box>

      <Box flexDirection="column">
        <Text bold>Try one:</Text>
        {EXAMPLES.map((example) => (
          <Text key={example} dimColor>  › {example}</Text>
        ))}
      </Box>
    </Box>
  );
};
