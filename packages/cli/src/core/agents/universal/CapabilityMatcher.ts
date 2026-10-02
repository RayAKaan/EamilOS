import type { UniversalAgentDefinition, UniversalCapabilities } from './types.js';

export type CapabilityRequirement = keyof UniversalCapabilities;

export interface AgentCapabilityRequirements {
  all?: CapabilityRequirement[];
  any?: CapabilityRequirement[];
  none?: CapabilityRequirement[];
  preferredAgentIds?: string[];
}

export interface AgentMatch {
  agent: UniversalAgentDefinition;
  score: number;
  matched: CapabilityRequirement[];
  missing: CapabilityRequirement[];
  reason: string;
}

export class CapabilityMatcher {
  match(agents: UniversalAgentDefinition[], requirements: AgentCapabilityRequirements = {}): AgentMatch[] {
    const all = requirements.all ?? [];
    const any = requirements.any ?? [];
    const none = requirements.none ?? [];
    return agents
      .map((agent) => {
        const matched = all.filter((key) => agent.capabilities[key]);
        const missing = all.filter((key) => !agent.capabilities[key]);
        const anySatisfied = any.length === 0 || any.some((key) => agent.capabilities[key]);
        const forbidden = none.some((key) => agent.capabilities[key]);
        const preferred = requirements.preferredAgentIds?.includes(agent.id) ? 20 : 0;
        const score = matched.length * 10 + (anySatisfied ? 5 : -50) + preferred - (forbidden ? 1000 : 0);
        return { agent, score, matched, missing, reason: forbidden ? 'forbidden capability present' : missing.length ? 'missing required capabilities' : anySatisfied ? 'requirements satisfied' : 'none of the optional capabilities matched' };
      })
      .filter((result) => result.missing.length === 0 && result.score > -100);
  }

  select(agents: UniversalAgentDefinition[], requirements: AgentCapabilityRequirements = {}): AgentMatch | undefined {
    return this.match(agents, requirements).sort((a, b) => b.score - a.score)[0];
  }
}
