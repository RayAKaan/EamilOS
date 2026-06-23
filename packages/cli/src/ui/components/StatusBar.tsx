import React, { useState, useEffect } from 'react';
import { Box, Text, useStdout } from 'ink';
import type { AgentInfo, ExecutionStrategy, GraphStats } from '../types/ui.js';

interface StatusBarProps {
  opencode: AgentInfo;
  gemini: AgentInfo;
  strategy: ExecutionStrategy;
  graphStats: GraphStats;
  isRunning: boolean;
  terminalWidth: number;
  version?: string;
}

const trunc = (str: string, max: number) =>
  str.length > max ? str.slice(0, max - 1) + '…' : str;

export const StatusBar: React.FC<StatusBarProps> = ({
  opencode, gemini, strategy, graphStats, isRunning, terminalWidth, version = '1.0.0',
}) => {
  const stratColor = strategy === 'opencode-first' ? 'cyan'
    : strategy === 'gemini-first' ? 'magenta'
    : strategy === 'parallel' ? 'blue' : 'yellow';

  const innerW = terminalWidth - 4;
  const leftW = Math.floor(innerW * 0.35);
  const rightW = Math.floor(innerW * 0.25);
  const centerW = innerW - leftW - rightW;

  const left = `● v${version} ${isRunning ? '⚡Run' : '✓Rd'}`;
  const ocStatus = opencode.status === 'ready' ? (opencode.version ? `●${opencode.version.replace(/^v/, '')}` : '●ok') : '○';
  const gmStatus = gemini.status === 'ready' ? (gemini.version ? `●${gemini.version.replace(/^v/, '')}` : '●ok') : '○';
  const right = `${trunc(strategy, 10)} n:${graphStats.nodes} e:${graphStats.edges}`;

  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      flexShrink={0}
    >
      <Box width={innerW} flexDirection="row" gap={0}>
        <Text color="cyan" bold wrap="truncate">{trunc(left, leftW)}</Text>
        <Box flexGrow={1} justifyContent="center">
          <Text dimColor wrap="truncate">
            {ocStatus}│{gmStatus}
          </Text>
        </Box>
        <Text dimColor wrap="truncate">{trunc(right, rightW)}</Text>
      </Box>
    </Box>
  );
};
