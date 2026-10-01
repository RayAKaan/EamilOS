export type RecoveryAction = 'retry' | 'reassign' | 'checkpoint-resume' | 'replan' | 'escalate';

export interface RecoveryIncident {
  missionId: string;
  taskId: string;
  failure: string;
  retryable: boolean;
  fallbackEligible: boolean;
  checkpointAvailable: boolean;
  alternatives: string[];
}

export interface RecoveryPlan {
  action: RecoveryAction;
  target?: string;
  rationale: string;
}

export class AutonomousRecovery {
  plan(incident: RecoveryIncident): RecoveryPlan {
    if (incident.checkpointAvailable && incident.retryable) {
      return { action: 'checkpoint-resume', rationale: 'Resume from the latest safe checkpoint before repeating work.' };
    }
    if (incident.fallbackEligible && incident.alternatives.length) {
      return { action: 'reassign', target: incident.alternatives[0], rationale: 'Delegate to an available alternative execution target.' };
    }
    if (incident.retryable) {
      return { action: 'retry', rationale: 'Failure is explicitly retryable and no better recovery target is available.' };
    }
    if (incident.fallbackEligible) {
      return { action: 'replan', rationale: 'Current execution path is not viable; regenerate the task plan.' };
    }
    return { action: 'escalate', rationale: 'No safe autonomous recovery action is available.' };
  }
}
