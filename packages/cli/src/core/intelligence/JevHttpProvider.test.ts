import { describe, expect, it, vi, afterEach } from 'vitest';
import { JevHttpProvider } from './JevHttpProvider.js';

const context = {
  schemaVersion: '1.0' as const,
  mission: { id: 'm1', goal: 'ship', status: 'active', constraints: {}, completionCriteria: [], requirements: {}, graphVersion: 4 },
  project: { workspace: { workingDir: '/workspace' }, relevantFiles: [] },
  agents: [{ id: 'agent-1', harness: 'opencode', capabilities: ['code'], status: 'AVAILABLE', health: 'HEALTHY' }],
  taskGraph: { version: 4, tasks: [{ id: 'task-1', title: 'Ship API', state: 'READY', priority: 'HIGH', dependencies: [], requiredCapabilities: ['code'], acceptanceCriteria: ['tests'], attempt: 0 }], dependencies: [], readyTasks: ['task-1'], runningTasks: [], blockedTasks: [], completedTasks: [], failedTasks: [] },
  coordination: { conflicts: [], activeReservations: [], activeLeases: [], localPlans: [] },
  executions: [], failures: [], checkpoints: [], evidence: [], artifacts: { files: [], diffs: [], evidence: [] }, decisions: [],
  progress: { totalTasks: 1, completedTasks: 0, runningTasks: 0, blockedTasks: 0, failedTasks: 0, readyTasks: 1, completionRatio: 0, progressSinceLastDecision: false },
  timestamp: new Date().toISOString(),
};

describe('JevHttpProvider', () => {
  afterEach(() => vi.restoreAllMocks());

  it('posts the System One contract and maps typed answers into an EamilOS decision', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      model: 'jev-1.13.0',
      answers: {
        action: { type: 'choice', choice: 'EXECUTE', probabilities: { EXECUTE: 0.9, RETRY: 0.1 }, confidence: 0.9 },
        target_task: { type: 'choice', choice: 'task-1', probabilities: { 'task-1': 1 }, confidence: 1 },
        human_review: { type: 'noul', noul: 0.02 },
      },
      usage: { input_tokens: 120, output_tokens: 20 },
    }), { status: 200 }));
    const provider = new JevHttpProvider({ endpoint: 'https://api.typesafe.ai/v1/systemone', apiKey: 'secret', model: 'jev-latest' });
    const result = await provider.decide(context);
    expect(result.decision.action).toBe('EXECUTE');
    expect(result.decision.targets[0].taskId).toBe('task-1');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/v1/systemone'), expect.objectContaining({ method: 'POST' }));
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(String(init.headers)).not.toContain('secret');
  });

  it('retries rate limits and honors Retry-After', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('busy', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: 'jev-1.13.0',
        answers: { action: { type: 'choice', choice: 'VERIFY', probabilities: { VERIFY: 1 }, confidence: 1 }, human_review: { type: 'noul', noul: 0 } },
      }), { status: 200 }));
    const provider = new JevHttpProvider({ endpoint: 'https://api.typesafe.ai/v1/systemone', apiKey: 'secret', maxRetries: 1, baseBackoffMs: 0 });
    await provider.decide(context);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed typed responses without treating them as valid decisions', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ model: 'jev-1.13.0', answers: { action: { type: 'choice', choice: 'NOT_AN_ACTION', probabilities: { NOT_AN_ACTION: 1 } } } }), { status: 200 }));
    const provider = new JevHttpProvider({ endpoint: 'https://api.typesafe.ai/v1/systemone', apiKey: 'secret', maxRetries: 0 });
    await expect(provider.decide(context)).rejects.toThrow();
  });

  it('enforces total token budgets', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      model: 'jev-1.13.0',
      answers: { action: { type: 'choice', choice: 'VERIFY', probabilities: { VERIFY: 1 } } },
      usage: { input_tokens: 80, output_tokens: 30, total_tokens: 110 },
    }), { status: 200 }));
    const provider = new JevHttpProvider({ endpoint: 'https://api.typesafe.ai/v1/systemone', apiKey: 'secret', maxTokens: 100, maxRetries: 0 });
    await expect(provider.decide(context)).rejects.toThrow('token budget exceeded');
  });

  it('does not retry authentication failures', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unauthorized', { status: 401 }));
    const provider = new JevHttpProvider({ endpoint: 'https://api.typesafe.ai/v1/systemone', apiKey: 'secret', maxRetries: 3 });
    await expect(provider.decide(context)).rejects.toThrow('Jev HTTP 401');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
