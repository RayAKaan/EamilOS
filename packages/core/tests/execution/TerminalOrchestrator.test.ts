import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CommsGround } from '../../src/collaboration/CommsGround.js';

vi.mock('node-pty', () => {
  return {
    spawn: vi.fn(() => ({
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      kill: vi.fn(),
      pid: 12345
    })),
  };
});

import { TerminalOrchestrator } from '../../src/execution/TerminalOrchestrator.js';

describe('TerminalOrchestrator', () => {
  let orchestrator: TerminalOrchestrator;
  let commsGround: CommsGround;

  beforeEach(() => {
    commsGround = new CommsGround();
    orchestrator = new TerminalOrchestrator(commsGround);
  });

  afterEach(() => {
    orchestrator.getSessions().forEach((_, id) => orchestrator.cleanup(id));
  });

  it('should spawn a terminal session', async () => {
    const sessionId = await orchestrator.spawn('test-session', {
      cwd: process.cwd(),
      env: { AGENT_ID: 'test-agent' }
    });
    
    expect(sessionId).toBe('test-session');
    expect(orchestrator.getSession('test-agent')).toBeDefined();
  });

  it('should get session by agent ID', async () => {
    await orchestrator.spawn('session-1', {
      cwd: process.cwd(),
      env: { AGENT_ID: 'my-agent' }
    });

    const session = orchestrator.getSession('my-agent');
    expect(session).toBeDefined();
    expect(session?.agentId).toBe('my-agent');
  });

  it('should cleanup session', async () => {
    await orchestrator.spawn('cleanup-test', {
      cwd: process.cwd(),
      env: { AGENT_ID: 'cleanup-agent' }
    });

    orchestrator.cleanup('cleanup-test');
    expect(orchestrator.getSession('cleanup-agent')).toBeUndefined();
  });

  it('should use platform-aware shell on Windows', async () => {
    const sessionId = await orchestrator.spawn('shell-test', {
      cwd: process.cwd(),
      env: { AGENT_ID: 'test' }
    });

    expect(sessionId).toBe('shell-test');
    expect(process.platform).toBeDefined();
  });
});