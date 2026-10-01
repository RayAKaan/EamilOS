import { describe, expect, it } from 'vitest';
import { AgentScope } from '../core/agents/AgentScope.js';
import { capabilityKey, CapabilityRegistry } from '../core/runtime/CapabilityRegistry.js';
import { RuntimeDependencyGraph } from '../core/runtime/RuntimeDependencyGraph.js';
import { PluginRuntime } from '../core/runtime/PluginRuntime.js';
import { TypedEventBus } from '../core/runtime/TypedEventBus.js';

describe('Phase A runtime foundation', () => {
  it('provides typed capability registration and disposal', () => {
    const registry = new CapabilityRegistry();
    const key = capabilityKey<{ value: number }>('test.service');
    const dispose = registry.register(key, { value: 42 });
    expect(registry.resolve(key).value).toBe(42);
    dispose();
    expect(registry.has(key)).toBe(false);
  });

  it('enforces typed event subscriptions', () => {
    type Events = { ping: { value: number } };
    const bus = new TypedEventBus<Events>();
    let value = 0;
    bus.on('ping', (payload) => { value = payload.value; });
    bus.emit('ping', { value: 7 });
    expect(value).toBe(7);
  });

  it('supports agent capability grants and revocation', () => {
    const scope = new AgentScope();
    const dispose = scope.create('agent-1', ['shell']);
    scope.grant('agent-1', 'filesystem');
    expect(scope.has('agent-1', 'filesystem')).toBe(true);
    scope.revoke('agent-1', 'shell');
    expect(scope.has('agent-1', 'shell')).toBe(false);
    dispose();
    expect(scope.get('agent-1')).toBeUndefined();
  });

  it('detects plugin capability relationships', () => {
    const graph = new RuntimeDependencyGraph();
    graph.addPlugin({ name: 'shell', provides: ['shell'] });
    graph.addPlugin({ name: 'agent', inject: ['shell'] });
    const snapshot = graph.snapshot(['shell']);
    expect(snapshot.nodes.length).toBe(3);
    expect(snapshot.edges).toHaveLength(2);
    expect(snapshot.cycles).toHaveLength(0);
  });

  it('composes typed capabilities through the plugin runtime', async () => {
    const runtime = new PluginRuntime();
    const key = capabilityKey<number>('answer');
    const dispose = await runtime.use({
      name: 'provider',
      provides: ['answer'],
      setup: (ctx) => {
        ctx.provide(key, 42);
      },
    });
    const consumer = await runtime.use({
      name: 'consumer',
      inject: ['answer'],
      setup: (ctx) => {
        expect(ctx.resolve(key)).toBe(42);
      },
    });
    expect(runtime.listCapabilities().map((item) => item.id)).toContain('answer');
    expect(runtime.dependencyGraph().unresolved).toHaveLength(0);
    await consumer();
    await dispose();
    await runtime.dispose();
  });
});
