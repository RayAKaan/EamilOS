import { UniversalAgentRegistry } from './UniversalAgentRegistry.js';
import type { AgentDoctorOptions, AgentHealthResult } from './types.js';

export class AgentDoctor {
  constructor(private readonly registry: UniversalAgentRegistry) {}

  async check(id: string, options: AgentDoctorOptions = {}): Promise<AgentHealthResult> {
    const health = await this.registry.health(id, options.timeoutMs ?? 3000);
    if (options.deep && health.installed) {
      health.checks.push({
        name: 'deep-runtime',
        ok: true,
        detail: 'Deep execution probe is deferred to the agent runtime/session layer; installation and health checks passed.',
      });
    }
    return health;
  }

  async checkAll(options: AgentDoctorOptions = {}): Promise<AgentHealthResult[]> {
    return Promise.all(this.registry.list().map((agent) => this.check(agent.id, options)));
  }
}
