import React from 'react';
import { Box, Text } from 'ink';
import type { Message } from '../types/ui.js';

interface GraphStatsProps {
  message: Message;
}

interface StatsData {
  strategy: string;
  duration: string;
  toolsUsed: number;
  nodes: number;
  edges: number;
  validated: boolean;
}

const STRATEGY_DESCRIPTIONS: Record<string, string> = {
  'opencode-first': 'OpenCode (primary) + Gemini (review)',
  'gemini-first': 'Gemini (research) + OpenCode (impl)',
  parallel: 'OpenCode ∥ Gemini (simultaneous)',
  swarm: 'OpenCode vs Gemini (best wins)',
};

export const GraphStats: React.FC<GraphStatsProps> = ({ message }) => {
  let stats: StatsData;
  try {
    stats = JSON.parse(message.content) as StatsData;
  } catch {
    return null;
  }

  const agentDesc = STRATEGY_DESCRIPTIONS[stats.strategy] ?? stats.strategy;

  const rows: Array<[string, string]> = [
    ['Strategy', stats.strategy],
    ['Agents', agentDesc],
    ['Duration', stats.duration],
    ['Tools used', String(stats.toolsUsed)],
    ['Graph nodes', String(stats.nodes)],
    ['Graph edges', String(stats.edges)],
    ['Result', stats.validated ? '✅ Validated and saved' : '⚠️  No validation'],
  ];

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="blue"
      paddingX={1}
      paddingY={0}
      marginBottom={1}
    >
      <Box marginBottom={1}>
        <Text color="blue" bold>
          📊 Execution Summary
        </Text>
      </Box>

      {rows.map(([label, value], i) => (
        <Box key={i} gap={1}>
          <Text dimColor>{(label + ':').padEnd(14)}</Text>
          <Text color={label === 'Result' ? (stats.validated ? 'green' : 'yellow') : 'white'}>
            {value}
          </Text>
        </Box>
      ))}
    </Box>
  );
};
