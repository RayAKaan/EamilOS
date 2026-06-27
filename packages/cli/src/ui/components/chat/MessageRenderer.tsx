import React from 'react';
import { Box, Text } from 'ink';
import { ToolCallCard } from './ToolCallCard.js';
import { useStore } from '../../state/store.js';
import type { Message } from '../../types/ui.js';

const AGENT_COLORS: Record<string, string> = {
  user: 'green',
  opencode: 'cyan',
  gemini: 'blue',
  eamilos: 'magenta',
  arbiter: 'yellow',
  system: 'white',
  thinking: 'yellow',
  error: 'red',
};

const AGENT_LABELS: Record<string, string> = {
  opencode: 'opencode',
  gemini: 'gemini-cli',
  eamilos: 'EamilOS',
  arbiter: 'arbiter',
  user: 'you',
};

interface Props {
  message: Message;
}

export const MessageRenderer: React.FC<Props> = ({ message }) => {
  const color = AGENT_COLORS[message.type] ?? 'white';
  const baseLabel = AGENT_LABELS[message.type] ?? message.type;
  const time = new Date(message.timestamp).toLocaleTimeString();

  let label = baseLabel;
  if (message.agent) {
    const agentInfo = useStore.getState().agentStatus[message.agent];
    if (agentInfo?.callsign) {
      label = `${agentInfo.callsign} · ${message.agent}`;
    }
  }

  return (
    <Box flexDirection="column" marginY={0}>
      <Box>
        <Text color={color} bold>
          {label}
        </Text>
        <Text dimColor> {time}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text wrap="wrap">{message.content}</Text>
      </Box>
      {message.tools && message.tools.length > 0 && (
        <Box flexDirection="column" paddingLeft={2} marginTop={0}>
          {message.tools.map((tool) => (
            <ToolCallCard key={tool.id} tool={tool} />
          ))}
        </Box>
      )}
    </Box>
  );
};
