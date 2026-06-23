import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface ThinkingIndicatorProps {
  agentName: string;
  color: string;
  style?: 'bar' | 'spinner' | 'dots';
}

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({
  agentName,
  color,
  style = 'bar',
}) => {
  const [frame, setFrame] = useState(0);
  const [barPos, setBarPos] = useState(0);
  const [barDir, setBarDir] = useState(1);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
      setBarPos((p) => {
        const next = p + barDir;
        if (next >= 12 || next <= 0) {
          setBarDir((d) => -d);
        }
        return Math.max(0, Math.min(12, next));
      });
    }, 100);
    return () => clearInterval(interval);
  }, [barDir]);

  if (style === 'spinner') {
    return (
      <Box>
        <Text color={color as Parameters<typeof Text>[0]['color']}>
          {SPINNER_FRAMES[frame]}{' '}
        </Text>
        <Text dimColor>{agentName} is thinking...</Text>
      </Box>
    );
  }

  if (style === 'dots') {
    const dots = '.'.repeat((frame % 3) + 1).padEnd(3, ' ');
    return (
      <Box>
        <Text color={color as Parameters<typeof Text>[0]['color']}>{agentName}</Text>
        <Text dimColor> thinking{dots}</Text>
      </Box>
    );
  }

  return (
    <Box gap={1}>
      <Text color={color as Parameters<typeof Text>[0]['color']}>
        {'█'.repeat(Math.min(barPos + 8, 20))}{'░'.repeat(Math.max(0, 20 - barPos - 8))}
      </Text>
      <Text dimColor>{agentName} working...</Text>
    </Box>
  );
};
