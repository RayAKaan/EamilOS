import { AgentDoctor } from './AgentDoctor.js';
import { AgentInstaller } from './AgentInstaller.js';
import { AuthenticationManager } from './AuthenticationManager.js';
import { UniversalAgentEventBus } from './AgentEventBus.js';
import { UniversalAgentRegistry } from './UniversalAgentRegistry.js';
import { UniversalAgentScheduler } from './UniversalAgentScheduler.js';
import { AgentRecoveryCoordinator } from './AgentRecoveryCoordinator.js';

export class UniversalAgentPlatform {
  readonly registry: UniversalAgentRegistry;
  readonly installer: AgentInstaller;
  readonly doctor: AgentDoctor;
  readonly auth: AuthenticationManager;
  readonly events: UniversalAgentEventBus;
  readonly scheduler: UniversalAgentScheduler;
  readonly recovery: AgentRecoveryCoordinator;

  constructor(registry = new UniversalAgentRegistry()) {
    this.registry = registry;
    this.installer = new AgentInstaller();
    this.doctor = new AgentDoctor(this.registry);
    this.auth = new AuthenticationManager();
    this.events = new UniversalAgentEventBus();
    this.scheduler = new UniversalAgentScheduler(this.registry);
    this.recovery = new AgentRecoveryCoordinator(this.registry);
  }
}

let platform: UniversalAgentPlatform | undefined;
export function getUniversalAgentPlatform(): UniversalAgentPlatform {
  platform ??= new UniversalAgentPlatform();
  return platform;
}
