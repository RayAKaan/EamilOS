import { MissionControl } from '../mission-interface/MissionControl.js';
import { ACPRuntime } from '../acp/ACPRuntime.js';
import { SchedulerRuntime } from '../scheduler/SchedulerRuntime.js';
import { SkillRuntime } from '../skills/SkillRuntime.js';
import { WebRuntime } from '../web/WebRuntime.js';
import { WebhookRuntime } from '../webhook/WebhookRuntime.js';
import { EamilOSSDK } from '../sdk/EamilOSSDK.js';
import { PhaseFDifferentiationRuntime } from '../differentiation/PhaseFDifferentiationRuntime.js';
import { HarnessRegistry } from '../execution/HarnessRegistry.js';
import { getUniversalAgentPlatform } from '../agents/universal/UniversalAgentPlatform.js';
import { MissionEventStore } from './MissionEventStore.js';
import { MissionReplay } from './MissionReplay.js';
import { MissionRecovery } from './MissionRecovery.js';
import { CompositionRuntime } from './CompositionRuntime.js';
import { PluginRuntime } from './PluginRuntime.js';
import { installExecutionCapabilities, type ExecutionCapabilities } from './ExecutionCapabilities.js';
import { capabilityKey } from './CapabilityRegistry.js';
import { DistributedMissionAuthority } from '../distributed-mission/DistributedMissionAuthority.js';
import type { RuntimeInspector } from './RuntimeInspector.js';

export const SCHEDULER_RUNTIME = capabilityKey<SchedulerRuntime>('runtime.scheduler', 'Mission-independent scheduled background work');
export const SKILL_RUNTIME = capabilityKey<SkillRuntime>('runtime.skills', 'Versioned reusable agent skills');
export const WEB_RUNTIME = capabilityKey<WebRuntime>('runtime.web', 'Policy-controlled web requests');
export const WEBHOOK_RUNTIME = capabilityKey<WebhookRuntime>('runtime.webhooks', 'Verified external event ingress');
export const ACP_RUNTIME = capabilityKey<ACPRuntime>('runtime.acp', 'Agent interoperability transport');
export const MISSION_EVENTS = capabilityKey<MissionEventStore>('runtime.mission-events', 'Durable mission event log');
export const MISSION_REPLAY = capabilityKey<MissionReplay>('runtime.mission-replay', 'Mission replay and projection reconstruction');
export const MISSION_RECOVERY = capabilityKey<MissionRecovery>('runtime.mission-recovery', 'Mission integrity and recovery');
export const HARNESS_REGISTRY = capabilityKey<HarnessRegistry>('runtime.harnesses', 'Installed harness registry');
export const DIFFERENTIATION_RUNTIME = capabilityKey<PhaseFDifferentiationRuntime>('runtime.differentiation', 'EamilOS mission differentiation services');
export const DISTRIBUTED_MISSION_AUTHORITY = capabilityKey<DistributedMissionAuthority>('runtime.distributed-mission-authority', 'Durable distributed mission authority');
export const MISSION_CONTROL = capabilityKey<MissionControl>('runtime.mission-control', 'Mission control plane');
export const SDK_RUNTIME = capabilityKey<EamilOSSDK>('runtime.sdk', 'Programmatic EamilOS SDK');
export const COMPOSITION_RUNTIME = capabilityKey<CompositionRuntime>('runtime.composition', 'Profiles, bundles, plugins and runtime inspection');

export interface EamilOSRuntimeOptions {
  readonly missionControl?: MissionControl;
  readonly missionEventRoot?: string;
  readonly distributedMissionRoot?: string;
  readonly distributedMissionFilename?: string;
  readonly autoRegisterCliHarnesses?: boolean;
}

export class EamilOSRuntimeKernel {
  readonly plugins: PluginRuntime;
  readonly composition: CompositionRuntime;
  readonly execution: ExecutionCapabilities;
  readonly missionControl: MissionControl;
  readonly missionEvents: MissionEventStore;
  readonly missionReplay: MissionReplay;
  readonly missionRecovery: MissionRecovery;
  readonly distributedMissionAuthority: DistributedMissionAuthority;
  readonly scheduler: SchedulerRuntime;
  readonly skills: SkillRuntime;
  readonly web: WebRuntime;
  readonly webhooks: WebhookRuntime;
  readonly acp: ACPRuntime;
  readonly harnesses: HarnessRegistry;
  readonly differentiation: PhaseFDifferentiationRuntime;
  readonly sdk: EamilOSSDK;
  readonly inspector: RuntimeInspector;

  private disposed = false;

  constructor(options: EamilOSRuntimeOptions = {}) {
    this.plugins = new PluginRuntime();
    this.composition = new CompositionRuntime(this.plugins);
    this.execution = installExecutionCapabilities(this.plugins);
    this.missionControl = options.missionControl ?? new MissionControl();
    this.missionEvents = new MissionEventStore({ root: options.missionEventRoot });
    this.missionReplay = new MissionReplay(this.missionEvents);
    this.missionRecovery = new MissionRecovery(this.missionEvents);
    this.distributedMissionAuthority = new DistributedMissionAuthority({
      root: options.distributedMissionRoot,
      filename: options.distributedMissionFilename,
    });
    this.scheduler = new SchedulerRuntime();
    this.skills = new SkillRuntime();
    this.web = new WebRuntime();
    this.webhooks = new WebhookRuntime();
    this.acp = new ACPRuntime();
    const universalPlatform = getUniversalAgentPlatform();
    this.harnesses = new HarnessRegistry(options.autoRegisterCliHarnesses ?? true, universalPlatform.registry, universalPlatform.store);
    this.differentiation = new PhaseFDifferentiationRuntime();
    this.sdk = new EamilOSSDK({
      runtime: this.plugins,
      mission: {
        run: async (mission) => {
          const created = await this.missionControl.create({ goal: mission });
          return this.missionControl.start(created.id);
        },
        inspect: (missionId) => this.missionControl.status(missionId),
      },
      skills: this.skills,
      scheduler: this.scheduler,
      inspector: this.composition.inspector,
    });
    this.inspector = this.composition.inspector;

    this.installCoreCapabilities();
  }

  private installCoreCapabilities(): void {
    const registrations = [
      [SCHEDULER_RUNTIME, this.scheduler],
      [SKILL_RUNTIME, this.skills],
      [WEB_RUNTIME, this.web],
      [WEBHOOK_RUNTIME, this.webhooks],
      [ACP_RUNTIME, this.acp],
      [MISSION_EVENTS, this.missionEvents],
      [MISSION_REPLAY, this.missionReplay],
      [MISSION_RECOVERY, this.missionRecovery],
      [DISTRIBUTED_MISSION_AUTHORITY, this.distributedMissionAuthority],
      [HARNESS_REGISTRY, this.harnesses],
      [DIFFERENTIATION_RUNTIME, this.differentiation],
      [MISSION_CONTROL, this.missionControl],
      [SDK_RUNTIME, this.sdk],
      [COMPOSITION_RUNTIME, this.composition],
    ] as const;

    for (const [key, value] of registrations) {
      this.plugins.registerCapability(key, value);
    }
  }

  async boot(): Promise<void> {
    if (this.disposed) throw new Error('Runtime kernel has been disposed');
    await this.harnesses.refresh();
  }

  inspect() {
    return this.inspector.inspect();
  }

  async shutdown(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.scheduler.dispose();
    this.execution.terminal.stopAll();
    this.distributedMissionAuthority.close();
    await this.execution.mcp.disconnect();
    await this.plugins.dispose();
  }
}

export function createEamilOSRuntime(options: EamilOSRuntimeOptions = {}): EamilOSRuntimeKernel {
  return new EamilOSRuntimeKernel(options);
}
