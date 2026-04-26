import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../../state/store';
import type { UIBridge } from '../../bridge';

interface TaskRunnerProps {
  bridge: UIBridge;
  task?: any;
  onBack: () => void;
}

export const TaskRunner: React.FC<TaskRunnerProps> = ({ bridge, task, onBack }) => {
  const [taskInput, setTaskInput] = useState(task?.input || '');
  const [isRunning, setIsRunning] = useState(false);
  const store = bridge.getStore();
  const isRunningState = store((s) => s.isRunning);

  return (
    <Box flexDirection="column" height="100%">
      {isRunning || isRunningState ? (
        <>
          <Box paddingX={2}>
            <Text bold color="cyan">Running: {taskInput}</Text>
          </Box>
          <Box flexGrow={1} padding={1}>
            <Text>Task execution in progress...</Text>
          </Box>
          <Box paddingX={2} height={3}>
            <Text>F6: Pause | F7: Stop | Esc: Back</Text>
          </Box>
        </>
      ) : (
        <Box flexDirection="column" alignItems="center" justifyContent="center" height="100%">
          <Box flexDirection="column" padding={3}>
            <Text bold color="cyan">Run New Task</Text>
            <Text dimColor>Describe what you want to build or fix:</Text>
            <Box marginTop={2}>
              <Text>{'> '}</Text>
              <input
                type="text"
                value={taskInput}
                onChange={(e: any) => setTaskInput(e.target.value)}
                placeholder="e.g., Build a REST API..."
              />
            </Box>
            <Box marginTop={2}>
              <Text bold>F5</Text>
              <Text> to run  </Text>
              <Text bold>Esc</Text>
              <Text> to cancel</Text>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};