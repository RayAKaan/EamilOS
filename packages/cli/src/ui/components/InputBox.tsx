import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import type { ExecutionStrategy } from '../types/ui.js';

interface InputBoxProps {
  isRunning: boolean;
  onSubmit: (value: string, strategy: ExecutionStrategy) => void;
  lastPrompt?: string;
  currentStrategy: ExecutionStrategy;
  onStrategyChange: (s: ExecutionStrategy) => void;
}

const STRATEGIES: ExecutionStrategy[] = [
  'opencode-first',
  'gemini-first',
  'parallel',
  'swarm',
];

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const TTYInput: React.FC<{
  value: string; setValue: (v: string) => void;
  handleSubmit: (v: string) => void;
  isRunning: boolean; lastPrompt: string;
  onStrategyChange: (s: ExecutionStrategy) => void;
}> = ({ value, setValue, handleSubmit, isRunning, lastPrompt, onStrategyChange }) => {
  useInput((input, key) => {
    if (isRunning) return;
    if (key.upArrow && lastPrompt && !value) setValue(lastPrompt);
    if (['1', '2', '3', '4'].includes(input) && !value) {
      const idx = parseInt(input, 10) - 1;
      const strat = STRATEGIES[idx];
      if (strat) onStrategyChange(strat);
    }
  }, { isActive: !isRunning });

  return (
    <Box flexGrow={1} height={2}>
      <TextInput value={value} onChange={setValue} onSubmit={handleSubmit}
        placeholder={isRunning ? '' : 'Type a task...'} focus />
    </Box>
  );
};

export const InputBox: React.FC<InputBoxProps> = ({
  isRunning, onSubmit, lastPrompt = '',
  currentStrategy, onStrategyChange,
}) => {
  const { stdout } = useStdout();
  const [width, setWidth] = useState(() => stdout.columns || 80);

  useEffect(() => {
    const onResize = () => setWidth(stdout.columns);
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);

  const [value, setValue] = useState('');
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 100);
    return () => clearInterval(interval);
  }, [isRunning]);

  const handleSubmit = useCallback(
    (val: string) => {
      const trimmed = val.trim();
      if (!trimmed || isRunning) return;
      setValue('');
      onSubmit(trimmed, currentStrategy);
    },
    [isRunning, onSubmit, currentStrategy]
  );

  const inputArea = !process.stdin?.isTTY ? (
    <Text dimColor>[stdin not TTY — interactive input unavailable]</Text>
  ) : (
    <TTYInput value={value} setValue={setValue} handleSubmit={handleSubmit}
      isRunning={isRunning} lastPrompt={lastPrompt} onStrategyChange={onStrategyChange} />
  );

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box paddingX={1} paddingY={0} borderStyle="single" borderColor="gray">
        <Text dimColor wrap="truncate">
          Strategy [{STRATEGIES.map((s, i) =>
            `${i + 1}:${s === currentStrategy ? s.toUpperCase() : s}`
          ).join('  ')}]
        </Text>
      </Box>

      <Box borderStyle="single" borderColor={isRunning ? 'yellow' : 'cyan'} paddingX={1} paddingY={0} height={3}>
        <Box flexDirection="column" flexGrow={1}>
          {isRunning && (
            <Text color="yellow">{SPINNER_FRAMES[spinnerFrame]} Running — Ctrl+C cancel</Text>
          )}
          <Box flexGrow={1}>
            <Text color="cyan" bold>› </Text>
            {inputArea}
            {!isRunning && <Text dimColor>[⏎]</Text>}
          </Box>
        </Box>
      </Box>

      <Box paddingX={1}>
        <Text dimColor wrap="truncate">
          ↑repeat │ 1-4strategy │ Ctrl+Alt+Ggraph │ Ctrl+Lclear │ Ctrl+Ccancel
        </Text>
      </Box>
    </Box>
  );
};
