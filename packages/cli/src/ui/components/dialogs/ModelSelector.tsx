import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { useStore } from '../../state/store.js';

const FALLBACK_MODELS = [
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { id: 'gemini-2.0-pro', label: 'Gemini 2.0 Pro' },
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  { id: 'local', label: 'Local (ollama)' },
];

export const ModelSelector: React.FC = () => {
  const [selected, setSelected] = useState(0);
  const closeOverlay = useStore((s) => s.closeOverlay);
  const agentStatus = useStore((s) => s.agentStatus);

  const models = useMemo(() => {
    const fromAgents: Array<{ id: string; label: string }> = [];
    for (const [id, info] of Object.entries(agentStatus)) {
      if (info.status === 'ready' || info.status === 'busy') {
        fromAgents.push({ id, label: `${id} (${info.version || 'detected'})` });
      }
    }
    return fromAgents.length > 0 ? fromAgents : FALLBACK_MODELS;
  }, [agentStatus]);

  useInput((_input, key) => {
    if (key.return || key.escape) {
      closeOverlay();
    } else if (key.upArrow || key.pageUp) {
      setSelected((p) => Math.max(0, p - 1));
    } else if (key.downArrow || key.pageDown) {
      setSelected((p) => Math.min(models.length - 1, p + 1));
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Select Model</Text>
      {models.map((m, i) => (
        <Box key={m.id}>
          <Text color={i === selected ? 'cyan' : 'white'}>
            {i === selected ? '▸ ' : '  '}{m.label}
          </Text>
        </Box>
      ))}
    </Box>
  );
};
