import React from 'react';
import { Box, Text, useInput } from 'ink';
import { useStore } from '../../state/store.js';

export const PermissionDialog: React.FC = () => {
  const params = useStore((s) => s.overlayParams);
  const resolvePermissionRequest = useStore((s) => s.resolvePermissionRequest);
  const closeOverlay = useStore((s) => s.closeOverlay);

  const request = params?.request as { id: string; agentId: string; action: string; details: string } | undefined;

  useInput((_input, key) => {
    if (key.return) {
      if (request) resolvePermissionRequest(request.id, true);
      closeOverlay();
    }
  });

  if (!request) return <Text>No permission request</Text>;

  return (
    <Box flexDirection="column">
      <Text bold>Permission Request</Text>
      <Text dimColor>Agent: {request.agentId}</Text>
      <Text dimColor>Action: {request.action}</Text>
      <Text wrap="wrap">{request.details}</Text>
      <Box marginTop={1}>
        <Text color="green">[Y] Allow</Text>
        <Text> </Text>
        <Text color="red">[N] Deny</Text>
      </Box>
    </Box>
  );
};
