import type { PluginRuntime } from '../runtime/PluginRuntime.js';
import type { RuntimeInspector } from '../runtime/RuntimeInspector.js';
import type { SchedulerRuntime } from '../scheduler/SchedulerRuntime.js';
import type { SkillRuntime } from '../skills/SkillRuntime.js';

export interface SDKMissionAdapter {
  run(mission: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  inspect?(missionId: string): Promise<unknown>;
}

export interface EamilOSSDKOptions {
  readonly runtime: PluginRuntime;
  readonly mission?: SDKMissionAdapter;
  readonly skills?: SkillRuntime;
  readonly scheduler?: SchedulerRuntime;
  readonly inspector?: RuntimeInspector;
}

export class EamilOSSDK {
  constructor(private readonly options: EamilOSSDKOptions) {}

  async run(mission: string, options?: { signal?: AbortSignal }): Promise<unknown> {
    if (!this.options.mission) throw new Error('Mission adapter is not configured');
    return this.options.mission.run(mission, options);
  }

  async inspect(missionId: string): Promise<unknown> {
    if (!this.options.mission?.inspect) throw new Error('Mission inspection is not configured');
    return this.options.mission.inspect(missionId);
  }

  skills(): SkillRuntime {
    if (!this.options.skills) throw new Error('Skill runtime is not configured');
    return this.options.skills;
  }

  scheduler(): SchedulerRuntime {
    if (!this.options.scheduler) throw new Error('Scheduler runtime is not configured');
    return this.options.scheduler;
  }

  runtime(): PluginRuntime {
    return this.options.runtime;
  }

  runtimeInspector(): RuntimeInspector {
    if (!this.options.inspector) throw new Error('Runtime inspector is not configured');
    return this.options.inspector;
  }
}
