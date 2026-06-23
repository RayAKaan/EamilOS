import React from 'react';
import { Box, Text } from 'ink';
import type { Message, ToolCall } from '../types/ui.js';
import { ThinkingIndicator } from './ThinkingIndicator.js';

interface AgentMessageProps {
  message: Message;
}

const formatTime = (ts: number): string => {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
};

const AGENT_CONFIG = {
  opencode: {
    color: 'cyan',
    label: '🤖 OPENCODE',
    borderColor: 'cyan',
  },
  gemini: {
    color: 'magenta',
    label: '🤖 GEMINI',
    borderColor: 'magenta',
  },
} as const;

const ToolCallRow: React.FC<{ tool: ToolCall }> = ({ tool }) => {
  const icon =
    tool.status === 'done' ? '✅' : tool.status === 'failed' ? '❌' : tool.status === 'running' ? '⏳' : '📝';
  const argsDisplay = tool.args.length > 50 ? tool.args.slice(0, 47) + '...' : tool.args;

  return (
    <Box gap={1} paddingLeft={2}>
      <Text>{icon}</Text>
      <Text dimColor>{tool.name.padEnd(8)}</Text>
      <Text color="white">{argsDisplay}</Text>
      {tool.lines !== undefined && <Text dimColor>({tool.lines} lines)</Text>}
    </Box>
  );
};

export const AgentMessage: React.FC<AgentMessageProps> = ({ message }) => {
  const agentKey = message.agent ?? (message.type === 'gemini' ? 'gemini' : 'opencode');
  const config = AGENT_CONFIG[agentKey] ?? AGENT_CONFIG.opencode;
  const time = formatTime(message.timestamp);
  const hasContent = message.content.trim().length > 0;
  const hasTools = (message.tools?.length ?? 0) > 0;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={config.borderColor}
      paddingX={1}
      paddingY={0}
      marginBottom={1}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Box gap={1}>
          <Text color={config.color} bold>
            {config.label}
          </Text>
        </Box>
        <Text dimColor>{time}</Text>
      </Box>

      {hasContent && (
        <Box paddingLeft={1} marginBottom={hasTools || message.isStreaming ? 1 : 0}>
          <Text wrap="wrap">{message.content}</Text>
        </Box>
      )}

      {hasTools && (
        <Box flexDirection="column" marginBottom={message.isStreaming ? 1 : 0}>
          {message.tools!.map((tool) => (
            <ToolCallRow key={tool.id} tool={tool} />
          ))}
        </Box>
      )}

      {message.isStreaming && (
        <Box paddingLeft={1}>
          <ThinkingIndicator
            agentName={agentKey === 'gemini' ? 'Gemini' : 'OpenCode'}
            color={config.color}
            style="bar"
          />
        </Box>
      )}
    </Box>
  );
};
