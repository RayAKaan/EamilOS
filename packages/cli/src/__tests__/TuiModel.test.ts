import { describe, it, expect } from 'vitest';
import { initialModel, nextMsgId, readyAgentCount } from '../tui/model.js';
import { update } from '../tui/update.js';
import type { AppModel, AgentEntry } from '../tui/model.js';

function makeModel(): AppModel {
  return initialModel(120, 40);
}

describe('AppModel', () => {
  it('creates initial model with default values', () => {
    const m = makeModel();
    expect(m.page).toBe('chat');
    expect(m.mode).toBe('communication');
    expect(m.strategy).toBe('single-fallback');
    expect(m.running).toBe(false);
    expect(m.input).toBe('');
    expect(m.agents.size).toBe(0);
    expect(m.messages.length).toBe(0);
  });

  it('readyAgentCount returns correct count', () => {
    const m = makeModel();
    expect(readyAgentCount(m)).toBe(0);

    m.agents.set('opencode', {
      id: 'opencode',
      name: 'OpenCode AI',
      callsign: 'Alpha',
      status: 'ready',
    });
    expect(readyAgentCount(m)).toBe(1);

    m.agents.set('claude-code', {
      id: 'claude-code',
      name: 'Claude Code',
      callsign: 'Beta',
      status: 'busy',
    });
    expect(readyAgentCount(m)).toBe(1);
  });

  it('nextMsgId generates unique ids', () => {
    const id1 = nextMsgId();
    const id2 = nextMsgId();
    expect(id1).not.toBe(id2);
  });
});

describe('update — navigation', () => {
  it('SET_PAGE changes page', () => {
    const m = update(makeModel(), { type: 'SET_PAGE', page: 'logs' });
    expect(m.page).toBe('logs');
  });

  it('SET_STRATEGY changes strategy', () => {
    const m = update(makeModel(), { type: 'SET_STRATEGY', strategy: 'swarm' });
    expect(m.strategy).toBe('swarm');
  });

  it('TOGGLE_SIDEBAR flips visibility', () => {
    const m1 = update(makeModel(), { type: 'TOGGLE_SIDEBAR' });
    expect(m1.sidebarVisible).toBe(false);
    const m2 = update(m1, { type: 'TOGGLE_SIDEBAR' });
    expect(m2.sidebarVisible).toBe(true);
  });

  it('CLEAR_CHAT clears messages and scroll', () => {
    let m = makeModel();
    m.messages = [{ id: 'm1', type: 'user', content: 'hi', timestamp: 0, tools: [], streaming: false }];
    m.scroll = 5;
    m.runSummary = { strategy: 'test', agentUsed: 'a', durationMs: 0, fileCount: 0, validated: true, errors: [] };
    m = update(m, { type: 'CLEAR_CHAT' });
    expect(m.messages.length).toBe(0);
    expect(m.scroll).toBe(0);
    expect(m.runSummary).toBeNull();
  });
});

describe('update — input', () => {
  it('INPUT_CHAR appends character', () => {
    const m = update(makeModel(), { type: 'INPUT_CHAR', char: 'a' });
    expect(m.input).toBe('a');
    expect(m.cursor).toBe(1);
  });

  it('INPUT_BACKSPACE removes character', () => {
    let m = update(makeModel(), { type: 'INPUT_CHAR', char: 'a' });
    m = update(m, { type: 'INPUT_BACKSPACE' });
    expect(m.input).toBe('');
    expect(m.cursor).toBe(0);
  });

  it('INPUT_CLEAR empties input', () => {
    let m = update(makeModel(), { type: 'INPUT_CHAR', char: 'hello' });
    m = update(m, { type: 'INPUT_CLEAR' });
    expect(m.input).toBe('');
    expect(m.cursor).toBe(0);
  });

  it('INPUT_RECALL restores lastPrompt', () => {
    let m = makeModel();
    m.lastPrompt = 'test prompt';
    m = update(m, { type: 'INPUT_RECALL' });
    expect(m.input).toBe('test prompt');
  });
});

describe('update — detection', () => {
  it('DETECTION_START sets state to detecting', () => {
    const m = update(makeModel(), { type: 'DETECTION_START' });
    expect(m.detectionState).toBe('detecting');
    expect(m.statusText).toContain('Detecting');
  });

  it('DETECTION_COMPLETE adds agents', () => {
    const agents: AgentEntry[] = [{
      id: 'opencode', name: 'OpenCode AI', callsign: 'Alpha', status: 'ready',
    }];
    const m = update(makeModel(), { type: 'DETECTION_COMPLETE', agents });
    expect(m.detectionState).toBe('complete');
    expect(m.agents.get('opencode')?.status).toBe('ready');
    expect(m.statusText).toContain('1 agent');
  });

  it('DETECTION_FAILED sets failed state', () => {
    const m = update(makeModel(), { type: 'DETECTION_FAILED', error: 'timeout' });
    expect(m.detectionState).toBe('failed');
  });
});

describe('update — session lifecycle', () => {
  it('SESSION_STARTED sets running and adds system message', () => {
    const m = update(makeModel(), { type: 'SESSION_STARTED' });
    expect(m.running).toBe(true);
    expect(m.messages.length).toBe(1);
    expect(m.messages[0]?.type).toBe('system');
  });

  it('SESSION_COMPLETED sets running false and adds run summary', () => {
    let m = update(makeModel(), { type: 'SESSION_STARTED' });
    m = update(m, {
      type: 'SESSION_COMPLETED',
      summary: { strategy: 'single', agentUsed: 'opencode', durationMs: 1000, fileCount: 2, validated: true, errors: [] },
    });
    expect(m.running).toBe(false);
    expect(m.runSummary?.validated).toBe(true);
    expect(m.messages.some(msg => msg.type === 'run_summary')).toBe(true);
  });

  it('SESSION_ERROR adds error message', () => {
    const m = update(makeModel(), { type: 'SESSION_ERROR', error: 'Connection refused' });
    expect(m.running).toBe(false);
    expect(m.messages.some(msg => msg.type === 'error')).toBe(true);
  });
});

describe('update — agent events', () => {
  it('AGENT_STARTED creates streaming message', () => {
    let m = makeModel();
    m.agents.set('opencode', { id: 'opencode', name: 'OpenCode AI', callsign: 'Alpha', status: 'ready' });
    m = update(m, { type: 'AGENT_STARTED', agentId: 'opencode' });
    expect(m.agents.get('opencode')?.status).toBe('busy');
    expect(m.messages.some(msg => msg.type === 'agent' && msg.streaming)).toBe(true);
  });

  it('AGENT_OUTPUT appends to streaming message', () => {
    let m = makeModel();
    m.agents.set('opencode', { id: 'opencode', name: 'OpenCode AI', callsign: 'Alpha', status: 'ready' });
    m = update(m, { type: 'AGENT_STARTED', agentId: 'opencode' });
    m = update(m, { type: 'AGENT_OUTPUT', agentId: 'opencode', content: 'hello' });
    m = update(m, { type: 'AGENT_OUTPUT', agentId: 'opencode', content: ' world' });
    const agentMsgs = m.messages.filter(msg => msg.agentId === 'opencode');
    expect(agentMsgs[agentMsgs.length - 1]?.content).toBe('hello world');
  });

  it('AGENT_COMPLETED closes streaming', () => {
    let m = makeModel();
    m.agents.set('opencode', { id: 'opencode', name: 'OpenCode AI', callsign: 'Alpha', status: 'busy' });
    m = update(m, { type: 'AGENT_STARTED', agentId: 'opencode' });
    m = update(m, { type: 'AGENT_COMPLETED', agentId: 'opencode' });
    expect(m.agents.get('opencode')?.status).toBe('ready');
    expect(m.messages.some(msg => msg.type === 'agent' && msg.streaming)).toBe(false);
  });

  it('AGENT_ERROR closes streaming and adds error', () => {
    let m = makeModel();
    m.agents.set('opencode', { id: 'opencode', name: 'OpenCode AI', callsign: 'Alpha', status: 'busy' });
    m = update(m, { type: 'AGENT_STARTED', agentId: 'opencode' });
    m = update(m, { type: 'AGENT_ERROR', agentId: 'opencode', error: 'exit code 1' });
    expect(m.messages.some(msg => msg.type === 'error' && msg.content.includes('exit code 1'))).toBe(true);
  });

  it('AGENT_FALLBACK adds system message', () => {
    const m = update(makeModel(), { type: 'AGENT_FALLBACK', from: 'opencode', to: 'claude-code', reason: 'timeout' });
    expect(m.messages.some(msg => msg.type === 'system' && msg.content.includes('Fallback'))).toBe(true);
  });
});

describe('update — validation', () => {
  it('VALIDATION_PASSED adds system message', () => {
    const m = update(makeModel(), { type: 'VALIDATION_PASSED' });
    expect(m.messages.some(msg => msg.content.includes('passed'))).toBe(true);
  });

  it('VALIDATION_FAILED adds error messages', () => {
    const m = update(makeModel(), { type: 'VALIDATION_FAILED', errors: ['lint error'] });
    expect(m.messages.some(msg => msg.type === 'error')).toBe(true);
  });

  it('CHANGES_COLLECTED sets modifiedFiles', () => {
    const m = update(makeModel(), {
      type: 'CHANGES_COLLECTED',
      files: [{ path: 'src/test.ts', action: 'create', agent: 'opencode' }],
    });
    expect(m.modifiedFiles.length).toBe(1);
    expect(m.modifiedFiles[0]?.path).toBe('src/test.ts');
  });
});

describe('update — resize', () => {
  it('RESIZE updates dimensions', () => {
    const m = update(makeModel(), { type: 'RESIZE', width: 100, height: 30 });
    expect(m.width).toBe(100);
    expect(m.height).toBe(30);
  });
});
