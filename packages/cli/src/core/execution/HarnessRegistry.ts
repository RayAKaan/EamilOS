import { CLI_AGENT_DEFINITIONS } from '../agents/definitions.js';
import {
  createCliHarnessAdapter,
} from './AgentFactoryHarnessAdapter.js';
import type { HarnessAdapter } from './HarnessAdapter.js';
import type {
  HarnessAvailability,
  HarnessDescriptor,
  HarnessHealth,
  HarnessStatus,
} from './types.js';
import { HarnessDescriptorSchema } from './types.js';

export class HarnessRegistry {
  private readonly adapters = new Map<string, HarnessAdapter>();
  private readonly descriptors = new Map<string, HarnessDescriptor>();
  private readonly healthState = new Map<string, HarnessHealth>();

  constructor(autoRegisterCli = true) {
    if (autoRegisterCli) {
      for (const definition of CLI_AGENT_DEFINITIONS) {
        const adapter = createCliHarnessAdapter(definition.id);
        if (adapter) this.register(adapter);
      }
    }
  }

  register(adapter: HarnessAdapter): void {
    const descriptor = HarnessDescriptorSchema.parse(adapter.descriptor);
    this.adapters.set(descriptor.id, adapter);
    this.descriptors.set(descriptor.id, descriptor);
  }

  unregister(harnessId: string): boolean {
    this.healthState.delete(harnessId);
    this.descriptors.delete(harnessId);
    return this.adapters.delete(harnessId);
  }

  get(harnessId: string): HarnessAdapter | undefined {
    return this.adapters.get(harnessId);
  }

  descriptor(harnessId: string): HarnessDescriptor | undefined {
    return this.descriptors.get(harnessId);
  }

  list(): HarnessDescriptor[] {
    return Array.from(this.descriptors.values()).map((descriptor) => ({
      ...descriptor,
      availability: { ...descriptor.availability },
    }));
  }

  health(harnessId: string): HarnessHealth | undefined {
    return this.healthState.get(harnessId);
  }

  async refresh(harnessId?: string): Promise<HarnessDescriptor[]> {
    const adapters = harnessId
      ? [this.adapters.get(harnessId)].filter(
          (adapter): adapter is HarnessAdapter => Boolean(adapter),
        )
      : Array.from(this.adapters.values());

    for (const adapter of adapters) {
      const availability = await adapter.detect();
      const health = await adapter.health();
      const descriptor = this.descriptors.get(adapter.descriptor.id);
      if (!descriptor) continue;

      const status = this.statusFor(availability, health);
      const updated: HarnessDescriptor = HarnessDescriptorSchema.parse({
        ...descriptor,
        status,
        version: descriptor.version,
        availability,
      });

      this.descriptors.set(updated.id, updated);
      this.healthState.set(updated.id, health);
    }

    return this.list();
  }

  available(): HarnessDescriptor[] {
    const now = Date.now();

    return this.list().filter((descriptor) => {
      if (descriptor.status !== 'AVAILABLE') return false;

      const health = this.healthState.get(descriptor.id);
      if (!health?.cooldownUntil) return true;

      return Date.parse(health.cooldownUntil) <= now;
    });
  }

  markFailure(
    harnessId: string,
    status: Extract<
      HarnessStatus,
      'QUOTA_EXHAUSTED' | 'AUTH_FAILED' | 'UNAVAILABLE' | 'COOLDOWN'
    >,
    failure: HarnessHealth['lastFailure'],
    cooldownUntil?: string,
  ): void {
    const descriptor = this.descriptors.get(harnessId);
    if (!descriptor) return;

    const previous = this.healthState.get(harnessId);
    const now = new Date().toISOString();

    this.descriptors.set(harnessId, {
      ...descriptor,
      status,
    });

    this.healthState.set(harnessId, {
      harnessId,
      status,
      lastCheckedAt: now,
      successCount: previous?.successCount ?? 0,
      failureCount: (previous?.failureCount ?? 0) + 1,
      consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
      lastFailure: failure,
      cooldownUntil,
    });
  }

  markSuccess(harnessId: string): void {
    const descriptor = this.descriptors.get(harnessId);
    if (!descriptor) return;

    const previous = this.healthState.get(harnessId);
    const now = new Date().toISOString();

    this.descriptors.set(harnessId, {
      ...descriptor,
      status: 'AVAILABLE',
    });

    this.healthState.set(harnessId, {
      harnessId,
      status: 'AVAILABLE',
      lastCheckedAt: now,
      successCount: (previous?.successCount ?? 0) + 1,
      failureCount: previous?.failureCount ?? 0,
      consecutiveFailures: 0,
    });
  }

  private statusFor(
    availability: HarnessAvailability,
    health: HarnessHealth,
  ): HarnessStatus {
    if (!availability.installed) return 'NOT_INSTALLED';
    if (!availability.authenticated) return 'AUTH_REQUIRED';
    if (!availability.executable) return 'UNAVAILABLE';
    if (health.status === 'QUOTA_EXHAUSTED') return 'QUOTA_EXHAUSTED';
    return 'AVAILABLE';
  }
}
