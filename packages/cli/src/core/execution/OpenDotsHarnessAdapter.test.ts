import { describe, expect, it, vi } from 'vitest';
import { OpenDotsHarnessAdapter } from './OpenDotsHarnessAdapter.js';

const request = {
  executionId: 'exec_1',
  missionId: 'mission_1',
  taskId: 'task_1',
  harnessId: 'opendots:default',
  nodeId: 'opendots',
  workingDir: '/workspace',
  prompt: 'Implement the assigned change.',
  context: {
    missionGoal: 'Ship the feature.',
    taskObjective: 'Implement the API.',
    acceptanceCriteria: ['Tests pass'],
    relevantFiles: ['src/api.ts'],
    dependencies: [],
  },
  resources: { readSet: [], writeSet: [] },
  timeoutMs: 30_000,
  environment: {},
  policy: {},
} as const;

describe('OpenDotsHarnessAdapter', () => {
  it('discovers an advertised agent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ mode: 'intelligence', agents: { default: { description: 'Default Dot' } } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));

    const adapter = new OpenDotsHarnessAdapter({
      baseUrl: 'http://127.0.0.1:5173',
      agentId: 'default',
    });

    const availability = await adapter.detect();
    expect(availability.installed).toBe(true);
    expect(availability.executable).toBe(true);
  });

  it('streams AG-UI text and records terminal completion', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'data: {"type":"RUN_STARTED","threadId":"thread-1","runId":"exec_1"}\n\n' +
          'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"hello"}\n\n' +
          'data: {"type":"TEXT_MESSAGE_CONTENT","delta":" world"}\n\n' +
          'data: {"type":"RUN_FINISHED","threadId":"thread-1","runId":"exec_1"}\n\n',
        ));
        controller.close();
      },
    });

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })));

    const adapter = new OpenDotsHarnessAdapter({
      baseUrl: 'http://127.0.0.1:5173',
      agentId: 'default',
    });

    const chunks: string[] = [];
    const result = await adapter.start(request, (chunk) => chunks.push(chunk));

    expect(result.status).toBe('COMPLETED');
    expect(result.output).toBe('hello world');
    expect(chunks).toEqual(['hello', ' world']);
  });

  it('maps an interrupted stream to recoverable execution', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'data: {"type":"RUN_STARTED","threadId":"thread-1","runId":"exec_1"}\n\n',
        ));
        controller.close();
      },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })));

    const adapter = new OpenDotsHarnessAdapter({
      baseUrl: 'http://127.0.0.1:5173',
      agentId: 'default',
    });

    const result = await adapter.start(request);
    expect(result.status).toBe('RECOVERABLE');
    expect(result.error?.type).toBe('WORKER_LOST');
  });
});
