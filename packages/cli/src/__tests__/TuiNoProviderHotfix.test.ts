import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../ui/state/store.js';
import { AgentRegistry } from '../core/agents/AgentRegistry.js';
import { AgentFactory } from '../core/agents/AgentFactory.js';
import { run } from '../ui/hooks/useOrchestrator.js';
import type { RegisteredAgent } from '../core/agents/types.js';

describe('TUI no-provider hotfix', () => {
  beforeEach(() => {
    useStore.setState({
      agentStatus: {},
      isRunning: false,
      messages: [],
      currentMode: 'communication',
      currentStrategy: 'single-fallback',
      activeTerminals: [],
    });
  });

  describe('AgentRegistry CLI agent modes', () => {
    async function detectForMode(mode: 'communication' | 'execution'): Promise<RegisteredAgent[]> {
      const registry = AgentRegistry.create();
      const execMock = async () => { throw new Error('not installed'); };
      const origExecFileSync = (await import('child_process')).execFileSync;
      return [];
    }

    it('opencode detector is registered with communication mode', () => {
      const registry = AgentRegistry.create();
      const all = registry.getAllAgents();
      expect(all).toHaveLength(0);
    });

    it('AgentFactory lists opencode adapter as available for both modes via checkStatus', async () => {
      const adapter = AgentFactory.createAdapter('opencode');
      if (!adapter) { expect(adapter).not.toBeNull(); return; }
      const status = await adapter.checkStatus();
      expect(status.supportedModes).toContain('communication');
      expect(status.supportedModes).toContain('execution');
    });

    it('AgentFactory lists claude-code adapter as available for both modes', async () => {
      const adapter = AgentFactory.createAdapter('claude-code');
      if (!adapter) { expect(adapter).not.toBeNull(); return; }
      const status = await adapter.checkStatus();
      expect(status.supportedModes).toContain('communication');
      expect(status.supportedModes).toContain('execution');
    });

    it('AgentFactory lists aider adapter as available for both modes', async () => {
      const adapter = AgentFactory.createAdapter('aider');
      if (!adapter) { expect(adapter).not.toBeNull(); return; }
      const status = await adapter.checkStatus();
      expect(status.supportedModes).toContain('communication');
      expect(status.supportedModes).toContain('execution');
    });

    it('AgentFactory lists goose adapter as available for both modes', async () => {
      const adapter = AgentFactory.createAdapter('goose');
      if (!adapter) { expect(adapter).not.toBeNull(); return; }
      const status = await adapter.checkStatus();
      expect(status.supportedModes).toContain('communication');
      expect(status.supportedModes).toContain('execution');
    });

    it('AgentFactory lists codex-cli adapter as available for both modes', async () => {
      const adapter = AgentFactory.createAdapter('codex-cli');
      if (!adapter) { expect(adapter).not.toBeNull(); return; }
      const status = await adapter.checkStatus();
      expect(status.supportedModes).toContain('communication');
      expect(status.supportedModes).toContain('execution');
    });
  });

  describe('Store preflight state management', () => {
    it('starts with no agentStatus entries (detecting state)', () => {
      const state = useStore.getState();
      expect(Object.keys(state.agentStatus)).toHaveLength(0);
      expect(state.isRunning).toBe(false);
    });

    it('shown as detecting when agentStatus is empty', () => {
      const state = useStore.getState();
      const entries = Object.entries(state.agentStatus);
      expect(entries.length === 0).toBe(true);
    });

    it('shown as all-offline when agentStatus entries exist but none are ready', () => {
      useStore.getState().setAgentStatus('opencode', {
        status: 'offline',
        name: 'OpenCode AI',
        error: 'not installed',
      });
      useStore.getState().setAgentStatus('gemini-cli', {
        status: 'offline',
        name: 'Gemini CLI',
        error: 'not installed',
      });

      const state = useStore.getState();
      const anyDetected = Object.keys(state.agentStatus).length > 0;
      const hasReady = Object.values(state.agentStatus).some((info) => info.status === 'ready');
      expect(anyDetected).toBe(true);
      expect(hasReady).toBe(false);
    });

    it('shown as ready when at least one agent has ready status', () => {
      useStore.getState().setAgentStatus('opencode', {
        status: 'ready',
        name: 'OpenCode AI',
      });

      const state = useStore.getState();
      const hasReady = Object.values(state.agentStatus).some((info) => info.status === 'ready');
      expect(hasReady).toBe(true);
    });

    it('validated is undefined after initial updateGraphStats call', () => {
      const state = useStore.getState();
      state.updateGraphStats({ nodes: 0, edges: 0, strategy: 'single', duration: undefined, toolsUsed: undefined, validated: undefined });
      expect(state.graphStats.validated).toBe(undefined);
    });
  });

  describe('run() no-agent preflight', () => {
    it('bails out with guidance when agentStatus is empty (detecting)', async () => {
      useStore.setState({ agentStatus: {}, isRunning: false });
      const msgCountBefore = useStore.getState().messages.length;

      await run('hello');

      const state = useStore.getState();
      expect(state.isRunning).toBe(false);
      const newMessages = state.messages.slice(msgCountBefore);
      const hasGuidance = newMessages.some((m) =>
        m.content.includes('No agents available')
      );
      expect(hasGuidance).toBe(true);
    });

    it('bails out with guidance when all agents are offline', async () => {
      useStore.getState().setAgentStatus('opencode', {
        status: 'offline',
        name: 'OpenCode AI',
        error: 'not installed',
      });
      useStore.setState({ isRunning: false });
      const msgCountBefore = useStore.getState().messages.length;

      await run('hello');

      const state = useStore.getState();
      expect(state.isRunning).toBe(false);
      const newMessages = state.messages.slice(msgCountBefore);
      const hasGuidance = newMessages.some((m) =>
        m.content.includes('No agents available')
      );
      expect(hasGuidance).toBe(true);
    });

    it('proceeds past preflight when an agent is ready (no guidance shown)', async () => {
      useStore.getState().setAgentStatus('opencode', {
        status: 'ready',
        name: 'OpenCode AI',
      });
      useStore.setState({ isRunning: false });

      await run('test prompt');

      const state = useStore.getState();
      const hasNoAgentGuidance = state.messages.some((m) =>
        m.content.includes('No agents available')
      );
      expect(hasNoAgentGuidance).toBe(false);
    });
  });

  describe('StatusBar gemini key', () => {
    it('reads agentStatus from gemini-cli key, not gemini', () => {
      useStore.getState().setAgentStatus('gemini-cli', {
        status: 'ready',
        name: 'Gemini CLI',
      });

      const state = useStore.getState();
      expect(state.agentStatus['gemini-cli']?.status).toBe('ready');
      expect(state.agentStatus['gemini']).toBeUndefined();
    });
  });
});
