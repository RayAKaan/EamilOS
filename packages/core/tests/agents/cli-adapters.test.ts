import { describe, it, expect } from 'vitest';
import { ClaudeCLIAdapter, CodexCLIAdapter } from '../../src/agents/cli-adapters/index.js';
import type { Task } from '../../src/schemas/task.js';

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    title: 'Build a REST API',
    description: 'Create src/server.ts and tests',
    type: 'coding',
    status: 'ready',
    priority: 'medium',
    dependsOn: [],
    artifacts: [],
    retryCount: 0,
    maxRetries: 3,
    requiresHumanApproval: false,
    tokenUsage: 0,
    costUsd: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('CLI agent adapters', () => {
  it('ClaudeCLIAdapter should build a Claude command and parse file artifacts', () => {
    const adapter = new ClaudeCLIAdapter('claude-1', {} as never, { cliPath: 'claude' });
    const command = adapter.buildCommand(createTask(), {});

    expect(command).toContain('claude --prompt');
    expect(command).toContain('--max-tokens 4000');
    expect(adapter.parseArtifacts('Created src/server.ts\nUpdated README.md')).toEqual([
      'src/server.ts',
      'README.md',
    ]);
  });

  it('CodexCLIAdapter should build a Codex command and parse JSON artifacts', () => {
    const adapter = new CodexCLIAdapter('codex-1', {} as never, { cliPath: 'codex' });
    const command = adapter.buildCommand(createTask(), { files: ['src/index.ts'] });

    expect(command).toContain('codex "Create src/server.ts and tests"');
    expect(command).toContain('src/index.ts');
    expect(command).toContain('--json');
    expect(adapter.parseArtifacts('{"files":["src/api.ts","src/api.test.ts"]}')).toEqual([
      'src/api.ts',
      'src/api.test.ts',
    ]);
  });
});
