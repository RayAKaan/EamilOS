import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../../state/store';
import type { UIBridge } from '../../bridge';

interface DashboardProps {
  bridge: UIBridge;
  onSelectAgent: (agentId: string) => void;
  onSelectTask: (task: any) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ bridge, onSelectAgent, onSelectTask }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const store = bridge.getStore();
  const isRunning = store((s) => s.isRunning);

  const mockAgents = [
    { id: 'claude-01', name: 'Claude CLI', status: isRunning ? 'running' : 'idle', capability: 'reasoning' },
    { id: 'codex-01', name: 'Codex CLI', status: 'idle', capability: 'code-generation' },
    { id: 'ollama-01', name: 'Ollama', status: 'ready', capability: 'local' }
  ];

  return (
    <Box flexDirection="column" height="100%">
      {/* Metrics Strip */}
      <Box paddingX={2}>
        <MetricsStrip />
      </Box>

      {/* Main Content */}
      <Box flexGrow={1}>
        {/* Agent Fleet Panel */}
        <Box width="35%" flexDirection="column">
          <Box paddingX={1}>
            <Text bold>Agent Fleet</Text>
          </Box>
          <Box flexGrow={1} flexDirection="column">
            {mockAgents.map((agent, index) => (
              <Box key={agent.id} paddingX={1}>
                <Text>
                  {agent.status === 'running' ? '*' : 'o'} {agent.name}
                  <Text dimColor> ({agent.capability})</Text>
                </Text>
              </Box>
            ))}
          </Box>
        </Box>

        {/* Task Queue Panel */}
        <Box width="65%" flexDirection="column">
          <Box paddingX={1}>
            <Text bold>Task Queue</Text>
          </Box>
          <Box flexGrow={1} flexDirection="column">
            <Text dimColor>No active tasks. Press 'n' to create a new task.</Text>
          </Box>
        </Box>
      </Box>

      {/* Footer */}
      <Box paddingX={2} height={3}>
        <Text dimColor>Navigate: arrow keys | Select: Enter | New Task: n | Run: r | Agents: a | Config: c | Help: ?</Text>
      </Box>
    </Box>
  );
};

const MetricsStrip: React.FC = () => {
  const memoryUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
  const uptime = Math.floor(process.uptime());

  return (
    <Box flexDirection="row" gap={4}>
      <Text>
        <Text color="cyan">*</Text> Running
      </Text>
      <Text>
        <Text color="green">^</Text> {Math.floor(uptime / 60)}m {uptime % 60}s
      </Text>
      <Text>
        <Text color="yellow">+</Text> {heapUsedMB}MB
      </Text>
    </Box>
  );
};