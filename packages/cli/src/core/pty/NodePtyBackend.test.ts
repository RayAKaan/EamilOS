import { describe, expect, it } from 'vitest';
import { NodePtyBackend, type NodePtyModuleLike, type NodePtyProcessLike } from './NodePtyBackend.js';
import type { PtySessionRequest } from './PtyTypes.js';

class FakePtyProcess implements NodePtyProcessLike {
  readonly pid = 4242;
  readonly cols: number;
  readonly rows: number;
  writes: string[] = [];
  kills: Array<string | undefined> = [];
  resizes: Array<{ cols: number; rows: number }> = [];

  private dataListeners: Array<(data: string) => void> = [];
  private exitListeners: Array<(event: { exitCode: number; signal?: number }) => void> = [];

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
  }

  write(data: string): void { this.writes.push(data); }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }

  kill(signal?: string): void { this.kills.push(signal); }

  onData(listener: (data: string) => void): { dispose(): void } {
    this.dataListeners.push(listener);
    return { dispose: () => {
      this.dataListeners = this.dataListeners.filter((item) => item !== listener);
    }};
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.exitListeners.push(listener);
    return { dispose: () => {
      this.exitListeners = this.exitListeners.filter((item) => item !== listener);
    }};
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) listener(data);
  }

  emitExit(exitCode: number, signal?: number): void {
    for (const listener of this.exitListeners) listener({ exitCode, signal });
  }
}

class FakePtyModule implements NodePtyModuleLike {
  lastProcess?: FakePtyProcess;

  spawn(
    _file: string,
    _args: string[],
    options: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> },
  ): NodePtyProcessLike {
    this.lastProcess = new FakePtyProcess(options.cols, options.rows);
    return this.lastProcess;
  }
}

const request: PtySessionRequest = {
  sessionId: 'pty-native-1',
  executionId: 'exec-1',
  missionId: 'mission-1',
  taskId: 'task-1',
  workerId: 'worker-1',
  agentId: 'agent-1',
  harnessId: 'harness-1',
  cwd: process.cwd(),
  command: 'node',
  args: ['-e', 'process.stdout.write("hello")'],
};

describe('NodePtyBackend', () => {
  it('maps PTY creation and terminal operations to node-pty', async () => {
    const module = new FakePtyModule();
    const backend = new NodePtyBackend(module);

    const session = await backend.create(request);
    const process = module.lastProcess!;

    expect(session.pid).toBe(4242);

    const output: string[] = [];
    const exits: Array<[number | null, string | null]> = [];
    const disposeData = session.onData((_stream, data) => output.push(data));
    const disposeExit = session.onExit((code, signal) => exits.push([code, signal]));

    session.write('hello');
    session.resize({ cols: 100, rows: 30 });
    session.terminate('SIGTERM');

    process.emitData('hello\\r\\n');
    process.emitExit(0);

    expect(process.writes).toEqual(['hello']);
    expect(process.resizes).toEqual([{ cols: 100, rows: 30 }]);
    expect(process.kills).toEqual(['SIGTERM']);
    expect(output).toEqual(['hello\\r\\n']);
    expect(exits).toEqual([[0, null]]);

    disposeData();
    disposeExit();
  });

  it('supports process-local attach to an existing session', async () => {
    const module = new FakePtyModule();
    const backend = new NodePtyBackend(module);

    const first = await backend.create(request);
    const attached = await backend.attach(request.sessionId);

    expect(attached.pid).toBe(first.pid);
  });

  it('rejects attach after the backend has no local session', async () => {
    const backend = new NodePtyBackend(new FakePtyModule());

    await expect(backend.attach(request.sessionId))
      .rejects.toThrow('PTY backend session not found in current process');
  });
});
