import type { IntelligenceRequest, IntelligenceRoute, IntelligenceRequestType } from './IntelligenceRuntimeTypes.js';
import { IntelligenceProviderRegistry } from './ProviderRegistry.js';

function supports(provider: ReturnType<IntelligenceProviderRegistry['list']>[number], type: IntelligenceRequestType): boolean {
  const capabilities = provider.capabilities();
  switch (type) {
    case 'STRATEGIC_DECISION': return capabilities.strategicDecision;
    case 'TASK_DECISION': return capabilities.taskDecision;
    case 'RECOVERY_DECISION': return capabilities.recoveryDecision;
    case 'PLANNING': return capabilities.planning;
    case 'VALIDATION': return capabilities.validationAssessment;
    case 'AGENT_SELECTION': return capabilities.agentSelection;
    case 'PARALLELIZATION': return capabilities.parallelization;
  }
}

export class IntelligenceRouter {
  constructor(private readonly registry: IntelligenceProviderRegistry) {}

  async route(request: IntelligenceRequest): Promise<IntelligenceRoute> {
    const candidates = this.registry.list().filter(provider => supports(provider, request.type));
    const preferred = request.preferredProviders ?? [];
    const defaultsByType: Record<IntelligenceRequestType, string[]> = {
      STRATEGIC_DECISION: ['jev-http', 'jev', 'deterministic'],
      TASK_DECISION: ['deterministic', 'jev-http', 'jev'],
      RECOVERY_DECISION: ['deterministic', 'jev-http', 'jev'],
      PLANNING: ['laya', 'laya-local', 'deterministic'],
      VALIDATION: ['deterministic', 'jev-http', 'jev'],
      AGENT_SELECTION: ['deterministic'],
      PARALLELIZATION: ['deterministic'],
    };
    const priority = [...preferred, ...defaultsByType[request.type]];
    const ordered = [
      ...priority.map(id => candidates.find(provider => provider.id === id)).filter((provider): provider is typeof candidates[number] => provider !== undefined),
      ...candidates.filter(provider => !priority.includes(provider.id)),
    ];

    const healthy: string[] = [];
    for (const provider of ordered) {
      const health = await provider.health();
      if (health.status === 'READY' || health.status === 'DEGRADED') healthy.push(provider.id);
    }

    const selectedProviderId = healthy[0];
    return {
      requestType: request.type,
      providerIds: healthy,
      selectedProviderId,
      reason: selectedProviderId
        ? `Selected ${selectedProviderId} for ${request.type}.`
        : `No healthy provider supports ${request.type}; caller must use its fallback policy.`,
    };
  }
}
