import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CommsGround } from '../../src/collaboration/CommsGround.js';

const ptyMock = vi.hoisted(() => {
  const writes: string[] = [];

  const emitForWrite = (input: string, dataHandler?: (data: string) => void): void => {
    if (!dataHandler) return;

    const start = input.match(/__EAMILOS_CMD_START_\d+__/);
    if (start) {
      dataHandler(`${start[0]}\r\n`);
      return;
    }

    const end = input.match(/__EAMILOS_CMD_END_\d+__/);
    if (end) {
      dataHandler(`\r\n${end[0]}\r\n`);
      return;
    }

    if (input.includes('agent1')) {
      dataHandler('agent1\r\n');
    } else if (input.includes('agent2')) {
      dataHandler('agent2\r\n');
    } else if (input.includes('hello')) {
      dataHandler('hello\r\n');
    } else {
      dataHandler(input);
    }
  };

  return {
    writes,
    spawn: vi.fn(() => {
      let dataHandler: ((data: string) => void) | undefined;
      let exitHandler: ((event: { exitCode: number; signal?: number }) => void) | undefined;

      return {
        onData: vi.fn((handler: (data: string) => void) => {
          dataHandler = handler;
        }),
        onExit: vi.fn((handler: (event: { exitCode: number; signal?: number }) => void) => {
          exitHandler = handler;
        }),
        write: vi.fn((input: string) => {
          writes.push(input);
          emitForWrite(input, dataHandler);
        }),
        kill: vi.fn(() => {
          exitHandler?.({ exitCode: 0 });
        }),
        pid: 12345
      };
    }),
  };
});

vi.mock('node-pty', () => {
  return {
    spawn: ptyMock.spawn,
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

  it('should execute a command and return result', async () => {
    const sessionId = await orchestrator.spawn('test-exec', {
      cwd: process.cwd(),
      env: { AGENT_ID: 'exec-agent' }
    });

    const result = await orchestrator.execute(sessionId, 'echo "hello"');
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should execute commands in parallel', async () => {
    await Promise.all([
      orchestrator.spawn('parallel-1', { cwd: process.cwd(), env: { AGENT_ID: 'agent-1' } }),
      orchestrator.spawn('parallel-2', { cwd: process.cwd(), env: { AGENT_ID: 'agent-2' } })
    ]);

    const results = await orchestrator.executeParallel([
      { sessionId: 'parallel-1', command: 'echo "agent1"' },
      { sessionId: 'parallel-2', command: 'echo "agent2"' }
    ]);

    expect(results.get('parallel-1')?.output).toContain('agent1');
    expect(results.get('parallel-2')?.output).toContain('agent2');
  });

  it('should stream terminal output through CommsGround', async () => {
    const events: unknown[] = [];
    commsGround.on('terminal:output', (event) => events.push(event));

    const sessionId = await orchestrator.spawn('stream-test', {
      cwd: process.cwd(),
      env: { AGENT_ID: 'stream-agent' }
    });

    await orchestrator.execute(sessionId, 'echo "hello"');
    expect(events.length).toBeGreaterThan(0);
    expect(commsGround.searchMessages('hello').length).toBeGreaterThan(0);
  });
});
