import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../state/store.js';
import type { AgentMode, ExecutionStrategy } from '../types/ui.js';

const MODE_LABEL: Record<AgentMode, string> = {
  communication: 'COMM',
  execution: 'EXEC',
};

const DOCS_URL = 'https://github.com/RayAKaan/EamilOS';

export const StatusBar: React.FC = () => {
  const strategy = useStore((s) => s.currentStrategy);
  const mode = useStore((s) => s.currentMode);
  const isRunning = useStore((s) => s.isRunning);
  const page = useStore((s) => s.activePage);
  const agentStatus = useStore((s) => s.agentStatus);

  const ocStatus = agentStatus.opencode?.status ?? 'offline';
  const gemStatus = agentStatus.gemini?.status ?? 'offline';

  const left = [
    `mode:${MODE_LABEL[mode]}`,
    `strat:${strategy}`,
    `oc:${ocStatus === 'ready' ? '●' : '○'}${ocStatus}`,
    `gem:${gemStatus === 'ready' ? '●' : '○'}${gemStatus}`,
  ].join(' │ ');

  const center = isRunning ? ' ● RUNNING' : '';

  const right = `${DOCS_URL} │ ${page}`;

  return (
    <Box width="100%" justifyContent="space-between">
      <Text wrap="truncate-end" bold>{left}</Text>
      <Text bold color="yellow">{center}</Text>
      <Text wrap="truncate-start" dimColor>{right}</Text>
    </Box>
  );
};
