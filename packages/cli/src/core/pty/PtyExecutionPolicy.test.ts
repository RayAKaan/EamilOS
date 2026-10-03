import { describe, expect, it } from 'vitest';
import {
  DefaultPtyExecutionPolicy,
  type PtySessionRequest,
} from './index.js';

const request: PtySessionRequest = {
  sessionId: 'pty-policy-1',
  executionId: 'exec-policy-1',
  missionId: 'mission-1',
  taskId: 'task-1',
  workerId: 'worker-1',
  agentId: 'agent-1',
  harnessId: 'harness-1',
  cwd: '/workspace/project',
  command: 'node',
  args: ['script.js'],
};

describe('DefaultPtyExecutionPolicy', () => {
  it('allows normal execution within configured limits', () => {
    const policy = new DefaultPtyExecutionPolicy({
      allowedCommands: ['node'],
      allowedWorkingDirectories: ['/workspace'],
    });

    expect(() => policy.authorize({ request })).not.toThrow();
  });

  it('rejects commands outside the explicit command allowlist', () => {
    const policy = new DefaultPtyExecutionPolicy({ allowedCommands: ['python'] });

    expect(() => policy.authorize({ request }))
      .toThrow('PTY command is not allowed by execution policy');
  });

  it('rejects working directories outside the explicit workspace roots', () => {
    const policy = new DefaultPtyExecutionPolicy({
      allowedWorkingDirectories: ['/workspace/project-a'],
    });

    expect(() => policy.authorize({
      request: { ...request, cwd: '/tmp' },
    })).toThrow('PTY working directory is not allowed by execution policy');
  });

  it('bounds argument and environment expansion', () => {
    const policy = new DefaultPtyExecutionPolicy({
      maxArguments: 1,
      maxArgumentLength: 3,
      maxEnvironmentEntries: 1,
    });

    expect(() => policy.authorize({
      request: { ...request, args: ['abcd'] },
    })).toThrow('PTY argument exceeds execution policy limit');

    expect(() => policy.authorize({
      request: { ...request, args: [] },
    })).not.toThrow();

    expect(() => policy.authorize({
      request: { ...request, env: { A: '1', B: '2' } },
    })).toThrow('PTY environment exceeds execution policy limit');
  });
});
