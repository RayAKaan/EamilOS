import type { UniversalAgentDefinition } from './types.js';

export interface AgentIntegrationIssue {
  agentId: string;
  field: string;
  message: string;
}

export function validateAgentDefinition(agent: UniversalAgentDefinition): AgentIntegrationIssue[] {
  const issues: AgentIntegrationIssue[] = [];
  if (!agent.id.trim()) issues.push({ agentId: agent.id, field: 'id', message: 'Agent id is required' });
  if (!agent.name.trim()) issues.push({ agentId: agent.id, field: 'name', message: 'Agent name is required' });
  if (!agent.provider.trim()) issues.push({ agentId: agent.id, field: 'provider', message: 'Provider is required' });
  if (!agent.executableCandidates.length) issues.push({ agentId: agent.id, field: 'executableCandidates', message: 'At least one executable candidate is required' });
  if (!agent.versionArgs.length) issues.push({ agentId: agent.id, field: 'versionArgs', message: 'At least one version probe argument is required' });
  if (!agent.platforms.length) issues.push({ agentId: agent.id, field: 'platforms', message: 'At least one supported platform is required' });
  if (!agent.protocols.length) issues.push({ agentId: agent.id, field: 'protocols', message: 'At least one execution protocol is required' });
  if (!agent.authentication.methods.length) issues.push({ agentId: agent.id, field: 'authentication.methods', message: 'At least one authentication method is required' });
  if (agent.capabilities.interactive === false && agent.capabilities.headless === false) {
    issues.push({ agentId: agent.id, field: 'capabilities', message: 'Agent must support interactive or headless execution' });
  }
  if (agent.promptDelivery === 'env' && !agent.promptEnv) {
    issues.push({ agentId: agent.id, field: 'promptEnv', message: 'Environment prompt delivery requires promptEnv' });
  }
  if ((agent.promptDelivery === 'argv' || agent.runArgs) && !agent.runArgs) {
    issues.push({ agentId: agent.id, field: 'runArgs', message: 'Argument prompt delivery requires runArgs' });
  }
  if ((agent.integrationStatus === 'production' || agent.integrationStatus === 'verified') && !agent.upstreamUrl) {
    issues.push({ agentId: agent.id, field: 'upstreamUrl', message: 'Verified/production integrations require an upstream reference' });
  }
  if ((agent.installation.strategy === 'npm' || agent.installation.strategy === 'pip' || agent.installation.strategy === 'uv' || agent.installation.strategy === 'brew') && !agent.installation.package) {
    issues.push({ agentId: agent.id, field: 'installation.package', message: `${agent.installation.strategy} installation requires a package` });
  }
  if ((agent.installation.strategy === 'github-release' || agent.installation.strategy === 'binary') && !agent.installation.release && !agent.installation.notes) {
    issues.push({ agentId: agent.id, field: 'installation.release', message: 'Binary installation requires a release manifest or explicit manual instructions' });
  }
  return issues;
}

export function validateAgentCatalog(agents: UniversalAgentDefinition[]): AgentIntegrationIssue[] {
  const issues = agents.flatMap(validateAgentDefinition);
  const ids = new Set<string>();
  for (const agent of agents) {
    if (ids.has(agent.id)) issues.push({ agentId: agent.id, field: 'id', message: 'Duplicate agent id' });
    ids.add(agent.id);
  }
  return issues;
}
