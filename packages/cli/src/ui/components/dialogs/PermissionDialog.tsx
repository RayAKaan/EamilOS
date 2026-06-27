import React from 'react';
import { Box, Text, useInput } from 'ink';
import { useStore } from '../../state/store.js';
import { getPermissionService } from '../../../core/permissions.js';

export const PermissionDialog: React.FC = () => {
  const params = useStore((s) => s.overlayParams);
  const resolvePermissionRequest = useStore((s) => s.resolvePermissionRequest);
  const closeOverlay = useStore((s) => s.closeOverlay);

  const request = params?.request as { id: string; agentId: string; action: string; details: string; requestId?: string } | undefined;

  useInput((input, key) => {
    if (!request) return;

    const service = getPermissionService();

    if (input.toLowerCase() === 'y' || key.return) {
      service.resolveRequest(request.id, 'allow-once');
      resolvePermissionRequest(request.id, true);
      closeOverlay();
      return;
    }

    if (input.toLowerCase() === 's') {
      service.resolveRequest(request.id, 'allow-session');
      resolvePermissionRequest(request.id, true);
      closeOverlay();
      return;
    }

    if (input.toLowerCase() === 'n' || key.escape) {
      service.resolveRequest(request.id, 'deny');
      resolvePermissionRequest(request.id, false);
      closeOverlay();
      return;
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
        <Text color="green">[Y/Enter] Allow once</Text>
        <Text> </Text>
        <Text color="cyan">[S] Allow session</Text>
        <Text> </Text>
        <Text color="red">[N/Esc] Deny</Text>
      </Box>
    </Box>
  );
};
