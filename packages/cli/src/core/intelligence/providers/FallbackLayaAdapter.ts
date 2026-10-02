import type { LayaModelAdapter, LayaPlan, LayaRequest } from '../types.js';

export class FallbackLayaAdapter implements LayaModelAdapter {
  readonly id = 'fallback-local';

  async load(): Promise<void> {}
  async unload(): Promise<void> {}

  async generate(request: LayaRequest): Promise<LayaPlan> {
    return {
      planId: `fallback-${Date.now()}`,
      missionId: request.missionId,
      parentTaskId: request.parentTaskId,
      objective: request.objective,
      tasks: [],
      dependencies: [],
      assumptions: ['No Laya model is configured; no autonomous decomposition was performed.'],
      risks: ['Planning intelligence is unavailable until a Laya provider is configured.'],
      createdAt: new Date().toISOString(),
    };
  }

  async health(): Promise<{ healthy: boolean; error?: string }> {
    return { healthy: false, error: 'Laya is not configured; using deterministic fallback.' };
  }
}
