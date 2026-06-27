import { describe, it, expect } from 'vitest';
import { useStore } from '../ui/state/store.js';

describe('TUI agent detection store integration', () => {
  it('can populate agentStatus and activeTerminals', () => {
    const state = useStore.getState();

    state.setAgentStatus('opencode', {
      status: 'ready',
      callsign: 'Alpha',
      name: 'OpenCode AI',
    });

    state.setActiveTerminals([
      { callsign: 'Alpha', agentId: 'opencode', mode: 'execution' },
    ]);

    expect(useStore.getState().agentStatus.opencode.status).toBe('ready');
    expect(useStore.getState().activeTerminals[0]?.callsign).toBe('Alpha');
  });
});
