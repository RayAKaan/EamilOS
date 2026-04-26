import React from 'react';
import { Box, Text } from 'ink';
import type { UIBridge } from '../../bridge';

interface AgentDetailProps {
  bridge: UIBridge;
  agentId?: string;
  onBack: () => void;
}

export const AgentDetail: React.FC<AgentDetailProps> = ({ bridge, agentId, onBack }) => {
  const mockAgent = agentId ? {
    id: agentId,
    name: `${agentId} CLI`,
    status: 'running',
    capability: 'reasoning',
    health: 98,
    completed: 12,
    failures: 0
  } : null;

  if (!mockAgent) {
    return (
      <Box flexDirection="column" alignItems="center" justifyContent="center" height="100%">
        <Text>No agent selected</Text>
        <Text dimColor>Select an agent from the Dashboard</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box paddingX={2}>
        <Text bold>Agent: {mockAgent.name}</Text>
      </Box>

      {/* Stats */}
      <Box flexDirection="row" gap={4} padding={2}>
        <Box>
          <Text dimColor>Capabilities:</Text>
          <Text> {mockAgent.capability}</Text>
        </Box>
        <Box>
          <Text dimColor>Health:</Text>
          <Text color={mockAgent.health > 90 ? 'green' : 'yellow'}> {mockAgent.health}%</Text>
        </Box>
        <Box>
          <Text dimColor>Completed:</Text>
          <Text> {mockAgent.completed}</Text>
        </Box>
      </Box>

      {/* Terminal Session */}
      <Box flexGrow={1} padding={1}>
        <Text dimColor>Terminal session output:</Text>
        <Box marginTop={1}>
          <Text>{'>'} Running agent: {mockAgent.id}</Text>
        </Box>
      </Box>

      {/* Footer */}
      <Box paddingX={2} height={3}>
        <Text>[r: Restart] [l: View Logs] [Escape: Back]</Text>
      </Box>
    </Box>
  );
};