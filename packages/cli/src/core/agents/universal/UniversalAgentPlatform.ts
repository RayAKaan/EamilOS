import { AgentDoctor } from './AgentDoctor.js';
import { AgentInstaller } from './AgentInstaller.js';
import { AuthenticationManager } from './AuthenticationManager.js';
import { UniversalAgentEventBus } from './AgentEventBus.js';
import { UniversalAgentRegistry } from './UniversalAgentRegistry.js';
import { UniversalAgentScheduler } from './UniversalAgentScheduler.js';
import { AgentRecoveryCoordinator } from './AgentRecoveryCoordinator.js';
import { ExecutionStore } from './ExecutionStore.js';
import type { UniversalAgentDefinition } from './types.js';

export class UniversalAgentPlatform {
  readonly registry: UniversalAgentRegistry;
  readonly installer: AgentInstaller;
  readonly doctor: AgentDoctor;
  readonly auth: AuthenticationManager;
  readonly events: UniversalAgentEventBus;
  readonly store: ExecutionStore;
  readonly scheduler: UniversalAgentScheduler;
  readonly recovery: AgentRecoveryCoordinator;

  constructor(registry = new UniversalAgentRegistry(), store = new ExecutionStore()) {
    this.registry = registry;
    this.installer = new AgentInstaller();
    this.doctor = new AgentDoctor(this.registry);
    this.auth = new AuthenticationManager();
    this.events = new UniversalAgentEventBus();
    this.store = store;
    this.scheduler = new UniversalAgentScheduler(this.registry, this.events, { maxConcurrent: 8, maxPerAgent: 2, store });
    this.recovery = new AgentRecoveryCoordinator(this.registry, this.events, store);
  }

  async initialize(): Promise<void> { await this.store.load(); }

  definition(id: string): UniversalAgentDefinition {
    const definition = this.registry.get(id);
    if (!definition) throw new Error('Unknown universal agent: ' + id);
    return definition;
  }
}

let platform: UniversalAgentPlatform | undefined;
export function getUniversalAgentPlatform(): UniversalAgentPlatform {
  platform ??= new UniversalAgentPlatform();
  return platform;
}
