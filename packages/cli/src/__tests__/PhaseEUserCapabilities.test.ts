import { describe, expect, it } from 'vitest';
import { SkillRuntime } from '../core/skills/SkillRuntime.js';
import { SchedulerRuntime } from '../core/scheduler/SchedulerRuntime.js';
import { WebRuntime } from '../core/web/WebRuntime.js';
import { WebhookRuntime } from '../core/webhook/WebhookRuntime.js';
import { ACPRuntime } from '../core/acp/ACPRuntime.js';

describe('Phase E user capabilities', () => {
  it('registers, disables and executes skills', async () => {
    const runtime = new SkillRuntime();
    runtime.register({ id: 'greet', version: '1.0.0', description: 'Greeting', run: async ({ input }) => `hello ${input}` });
    expect((await runtime.run('greet', 'ray')).toString()).toBe('hello ray');
    runtime.disable('greet');
    await expect(runtime.run('greet', 'ray')).rejects.toThrow('disabled');
  });

  it('runs bounded recurring schedules', async () => {
    const runtime = new SchedulerRuntime();
    let runs = 0;
    const id = runtime.schedule({ name: 'test', intervalMs: 1_000, maxRuns: 1, task: async () => { runs += 1; } });
    expect(runtime.get(id)?.state).toBe('scheduled');
    runtime.cancel(id);
    expect(runtime.get(id)?.state).toBe('cancelled');
    runtime.dispose();
    expect(runs).toBe(0);
  });

  it('enforces web policy before making requests', async () => {
    const runtime = new WebRuntime();
    await expect(runtime.request({ url: 'http://example.com' })).rejects.toThrow('HTTPS only');
  });

  it('verifies webhook signatures before dispatch', async () => {
    const runtime = new WebhookRuntime();
    let called = false;
    runtime.register({ id: 'test', secret: 'secret', signatureHeader: 'x-signature', handler: async () => { called = true; } });
    await expect(runtime.dispatch('test', { id: '1', source: 'test', timestamp: Date.now(), headers: {}, body: 'x' })).rejects.toThrow('signature missing');
    expect(called).toBe(false);
  });

  it('handles ACP requests with correlation ids', async () => {
    const runtime = new ACPRuntime();
    runtime.register('ping', () => ({ ok: true }));
    const response = await runtime.handle({
      version: '1.0', id: 'request-1', kind: 'request', sender: 'agent-a',
      method: 'ping', timestamp: Date.now(), payload: null,
    });
    expect(response?.kind).toBe('response');
    expect(response?.correlationId).toBe('request-1');
  });
});
