import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../../state/store.js';

const EXAMPLES = [
  'Analyze this repo and propose improvements',
  'Fix failing tests and explain changes',
  'Refactor the auth module safely',
  'Run swarm mode to compare implementation plans',
];

export const WelcomeScreen: React.FC = () => {
  const mode = useStore((s) => s.currentMode);
  const strategy = useStore((s) => s.currentStrategy);
  const agents = useStore((s) => s.agentStatus);
  const activeTerminals = useStore((s) => s.activeTerminals);

  const agentEntries = Object.entries(agents);
  const detected = agentEntries
    .filter(([, info]) => info.status === 'ready')
    .map(([id, info]) => ({
      id,
      callsign: info.callsign,
      name: info.name ?? id,
      kind: info.kind,
    }));

  const anyDetected = agentEntries.length > 0;
  const allOffline = anyDetected && detected.length === 0;
  const detecting = !anyDetected;

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
        <Text>
          Mode: <Text color={mode === 'execution' ? 'yellow' : 'green'} bold>{mode}</Text>
          {'  '}
          Strategy: <Text color="cyan" bold>{strategy}</Text>
        </Text>

        <Text dimColor>
          communication = plan/research/propose only · execution = staged changes + validation + approval
        </Text>

        {strategy === 'swarm' && (
          <Text color="yellow">
            swarm mode runs multiple agents and compares their outputs. Use it when you want redundancy.
          </Text>
        )}
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1} marginBottom={1}>
        <Text bold>Detected agents</Text>
        {detecting ? (
          <Text dimColor>Detecting agents on startup…</Text>
        ) : allOffline ? (
          <Box flexDirection="column">
            <Text dimColor>All agents offline. Install OpenCode, Claude Code, Gemini CLI, Aider, Goose, or configure API/local providers.</Text>
            {agentEntries.filter(([, info]) => info.error).map(([id, info]) => (
              <Text key={id} dimColor color="red">  {info.name ?? id}: {info.error}</Text>
            ))}
          </Box>
        ) : (
          detected.map((agent) => (
            <Text key={agent.id}>
              <Text color="green">●</Text>{' '}
              {agent.callsign && <Text color="cyan" bold>{agent.callsign}</Text>}
              {agent.callsign && <Text dimColor>:</Text>}
              {' '}
              <Text>{agent.name}</Text>
              <Text dimColor> ({agent.id}{agent.kind ? `/${agent.kind}` : ''})</Text>
            </Text>
          ))
        )}

        {activeTerminals.length > 0 && (
          <Text dimColor>
            terminal panes: {activeTerminals.map((t) => `${t.callsign}:${t.agentId}`).join(', ')}
          </Text>
        )}
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
