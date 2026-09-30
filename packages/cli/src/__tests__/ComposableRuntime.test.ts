import { describe, expect, it } from 'vitest';
import { PluginRuntime } from '../core/runtime/PluginRuntime.js';
import { InvariantRegistry } from '../core/runtime/InvariantRegistry.js';
import { EventSourcedSession } from '../core/session/EventSourcedSession.js';
import { ToolRuntime } from '../core/tools/ToolRuntime.js';

describe('DeepSeek-inspired composable runtime', () => {
  it('installs and disposes plugins with scoped effects', async () => {
    const runtime = new PluginRuntime();
    let disposed = false;
    const uninstall = await runtime.use({
      name: 'test-plugin',
      setup: (ctx) => {
        ctx.set('value', 42);
        return () => { disposed = true; };
      },
    });
    expect(runtime.getService('value')).toBe(42);
    await uninstall();
    expect(disposed).toBe(true);
    await runtime.dispose();
  });

  it('keeps session state reconstructable from an append-only event log', async () => {
    const session = new EventSourcedSession('test-runtime-session', { count: 0 }, '.eamilos/test-session-events');
    await session.append('turn/start', { prompt: 'hello' });
    await session.append('assistant/message', { text: 'world' });
    expect(session.eventsSnapshot()).toHaveLength(2);
    const state = session.reduce({ apply: (current: { count: number }, event) => ({
      count: current.count + (event.type === 'assistant/message' ? 1 : 0),
    }) }, { count: 0 });
    expect(state.count).toBe(1);
  });

  it('enforces monotonic tool guards before execution', async () => {
    const tools = new ToolRuntime();
    let executed = false;
    tools.register({
      name: 'dangerous',
      description: 'test',
      execute: async () => {
        executed = true;
        return 'done';
      },
    });
    tools.guard(() => 'denied');
    const result = await tools.execute('dangerous', {}, new AbortController().signal);
    expect(result.ok).toBe(false);
    expect(executed).toBe(false);
  });

  it('attributes invariant failures to their owner', async () => {
    const invariants = new InvariantRegistry();
    invariants.register('test.owner', (fail) => fail('broken relation'));
    const failures = await invariants.verify();
    expect(failures[0]?.owner).toBe('test.owner');
    expect(failures[0]?.code).toBe('INVARIANT');
  });
});
