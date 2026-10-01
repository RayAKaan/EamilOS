import { describe, expect, it } from 'vitest';
import {
  EamilOSRuntimeKernel,
  TOOL_RUNTIME,
  MODEL_GATEWAY,
  TERMINAL_RUNTIME,
  JOB_RUNTIME,
  SANDBOX_RUNTIME,
  MCP_RUNTIME,
  SCHEDULER_RUNTIME,
  SKILL_RUNTIME,
  WEB_RUNTIME,
  WEBHOOK_RUNTIME,
  ACP_RUNTIME,
  MISSION_EVENTS,
  MISSION_REPLAY,
  MISSION_RECOVERY,
  HARNESS_REGISTRY,
  DIFFERENTIATION_RUNTIME,
  MISSION_CONTROL,
  SDK_RUNTIME,
  COMPOSITION_RUNTIME,
} from '../core/runtime/EamilOSRuntimeKernel.js';

describe('unified runtime integration', () => {
  it('installs Phase A-F services into one typed runtime', async () => {
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

  it('connects SDK inspection to the same mission control plane', async () => {
    const kernel = new EamilOSRuntimeKernel({ autoRegisterCliHarnesses: false });
    const mission = await kernel.missionControl.create({ goal: 'integration test mission' });
    const status = await kernel.sdk.inspect(mission.id);
    expect(status).toHaveProperty('missionId', mission.id);
    await kernel.shutdown();
  });

  it('cleans scheduled work and background jobs during shutdown', async () => {
    const kernel = new EamilOSRuntimeKernel({ autoRegisterCliHarnesses: false });
    const id = kernel.scheduler.schedule({
      name: 'integration',
      runAt: new Date(Date.now() + 1000),
      task: async () => undefined,
    });
    expect(kernel.scheduler.get(id)?.state).toBe('scheduled');
    await kernel.shutdown();
    expect(kernel.scheduler.list()).toHaveLength(0);
    expect(kernel.execution.jobs.list()).toHaveLength(0);
  });
});
