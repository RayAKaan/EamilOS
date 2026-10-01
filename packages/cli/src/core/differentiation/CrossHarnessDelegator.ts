export interface DelegationTask {
  id: string;
  missionId: string;
  taskId: string;
  objective: string;
  requiredCapabilities: string[];
  context?: Record<string, unknown>;
}

export interface DelegationTarget {
  harnessId: string;
  score: number;
}

export interface DelegationPlan {
  taskId: string;
  targets: DelegationTarget[];
  strategy: 'single' | 'fallback' | 'parallel';
}

export class CrossHarnessDelegator {
  plan(task: DelegationTask, rankedHarnesses: readonly { harnessId: string; score: number }[], maxParallel = 1): DelegationPlan {
    const targets = rankedHarnesses.slice(0, Math.max(1, maxParallel)).map(h => ({ ...h }));
    return {
      taskId: task.taskId,
      targets,
      strategy: targets.length > 1 ? 'fallback' : 'single',
    };
  }

  handoffContext(task: DelegationTask, previousOutput: string, artifacts: string[] = []): Record<string, unknown> {
    return {
      missionId: task.missionId,
      taskId: task.taskId,
      objective: task.objective,
      requiredCapabilities: [...task.requiredCapabilities],
      previousOutput,
      artifacts: [...artifacts],
      handoffVersion: 1,
    };
  }
}
