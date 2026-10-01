import { describe, expect, it } from 'vitest';
import { EamilOSRuntimeKernel, MISSION_CONTROL, TOOL_RUNTIME, MODEL_GATEWAY, TERMINAL_RUNTIME, JOB_RUNTIME, SANDBOX_RUNTIME, MCP_RUNTIME, SCHEDULER_RUNTIME, SKILL_RUNTIME, WEB_RUNTIME, WEBHOOK_RUNTIME, ACP_RUNTIME, MISSION_EVENTS, MISSION_REPLAY, MISSION_RECOVERY, HARNESS_REGISTRY, DIFFERENTIATION_RUNTIME, SDK_RUNTIME, COMPOSITION_RUNTIME } from '../core/runtime/EamilOSRuntimeKernel.js';

describe('unified runtime integration', () => {
  it('installs every Phase A-F capability into one runtime graph', async () => {
    const kernel = new EamilOSRuntimeKernel({ autoRegisterCliHarnesses: false });
    const keys = [
      TOOL_RUNTIME, MODEL_GATEWAY, TERMINAL_RUNTIME, JOB_RUNTIME, SANDBOX_RUNTIME, MCP_RUNTIME,
      SCHEDULER_RUNTIME, SKILL_RUNTIME, WEB_RUNTIME, WEBHOOK_RUNTIME, ACP_RUNTIME,
      MISSION_EVENTS, MISSION_REPLAY, MISSION_RECOVERY, HARNESS_REGISTRY,
      DIFFERENTIATION_RUNTIME, MISSION_CONTROL, SDK_RUNTIME, COMPOSITION_RUNTIME,
    ];
    for (const key of keys) expect(kernel.plugins.resolveCapability(key)).toBeDefined();
    const inspection = kernel.inspect();
    expect(inspection.capabilities.length).toBeGreaterThanOrEqual(keys.length);
    expect(inspection.dependencyGraph.unresolved).toHaveLength(0);
    await kernel.shutdown();
  });

  it('routes SDK mission creation through the mission control plane', async () => {
    const kernel = new EamilOSRuntimeKernel({ autoRegisterCliHarnesses: false });
    const result = await kernel.sdk.run('integration test mission');
    expect(result).toHaveProperty('started');
    await kernel.shutdown();
  });

  it('boots and disposes without leaving scheduled work behind', async () => {
    const kernel = new EamilOSRuntimeKernel({ autoRegisterCliHarnesses: false });
    await kernel.boot();
    const id = kernel.scheduler.schedule({
      name: 'integration',
      runAt: new Date(Date.now() + 1000),
      task: async () => undefined,
    });
    expect(kernel.scheduler.get(id)?.state).toBe('scheduled');
    await kernel.shutdown();
    expect(kernel.scheduler.list()).toHaveLength(0);
  });
});
