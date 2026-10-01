import { z } from 'zod';

export const RuntimeEventNameSchema = z.enum([
  'runtime.started',
  'runtime.paused',
  'runtime.resumed',
  'runtime.stopping',
  'runtime.stopped',
  'runtime.recovered',
  'runtime.failed',
  'runtime.completed',
  'mission.observed',
  'planning.requested',
  'planning.completed',
  'scheduling.requested',
  'execution.started',
  'execution.completed',
  'execution.failed',
  'execution.checkpointed',
  'execution.recovered',
  'execution.reassigned',
  'validation.started',
  'validation.passed',
  'validation.failed',
  'recovery.started',
  'recovery.completed',
  'replan.started',
  'worker.lost',
  'harness.quota_exhausted',
  'resource.reserved',
  'resource.released',
  'communication.received',
  'communication.rejected',
  'budget.exhausted',
  'watchdog.alert',
  'agent.registered',
  'agent.unregistered',
  'agent.capabilities.changed',
  'plugin.installed',
  'plugin.disposed',
  'capability.registered',
  'capability.unregistered',
]);
export type RuntimeEventName = z.infer<typeof RuntimeEventNameSchema>;

export interface RuntimeEventPayloadMap {
  'runtime.started': { runtimeId: string };
  'runtime.paused': { runtimeId: string; reason?: string };
  'runtime.resumed': { runtimeId: string };
  'runtime.stopping': { runtimeId: string; reason?: string };
  'runtime.stopped': { runtimeId: string };
  'runtime.recovered': { runtimeId: string; reason?: string };
  'runtime.failed': { runtimeId: string; error: string };
  'runtime.completed': { runtimeId: string };
  'mission.observed': { missionId: string };
  'planning.requested': { missionId: string };
  'planning.completed': { missionId: string; taskCount?: number };
  'scheduling.requested': { missionId: string; taskId?: string };
  'execution.started': { missionId: string; taskId: string; executionId: string; agentId?: string };
  'execution.completed': { missionId: string; taskId: string; executionId: string };
  'execution.failed': { missionId: string; taskId: string; executionId: string; error: string; retryable?: boolean };
  'execution.checkpointed': { missionId: string; taskId: string; checkpointId: string };
  'execution.recovered': { missionId: string; taskId: string; executionId: string };
  'execution.reassigned': { missionId: string; taskId: string; from?: string; to: string };
  'validation.started': { missionId: string; taskId?: string };
  'validation.passed': { missionId: string; taskId?: string };
  'validation.failed': { missionId: string; taskId?: string; errors: string[] };
  'recovery.started': { missionId: string; taskId?: string; reason: string };
  'recovery.completed': { missionId: string; taskId?: string; recovered: boolean };
  'replan.started': { missionId: string; reason: string };
  'worker.lost': { workerId: string; taskId?: string };
  'harness.quota_exhausted': { harnessId: string; missionId?: string };
  'resource.reserved': { resource: string; owner: string };
  'resource.released': { resource: string; owner: string };
  'communication.received': { from: string; to?: string };
  'communication.rejected': { from: string; to?: string; reason: string };
  'budget.exhausted': { missionId: string; resource: string };
  'watchdog.alert': { scope: string; message: string };
  'agent.registered': { agentId: string };
  'agent.unregistered': { agentId: string };
  'agent.capabilities.changed': { agentId: string; capabilities: string[] };
  'plugin.installed': { plugin: string };
  'plugin.disposed': { plugin: string };
  'capability.registered': { capability: string };
  'capability.unregistered': { capability: string };
}

export type RuntimeEvents = RuntimeEventPayloadMap & Record<string, unknown>;
