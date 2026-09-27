import type { CoordinationEngine } from '../coordination/CoordinationEngine.js';
import type { MissionEngine } from '../mission/MissionEngine.js';
import type { Mission, TaskNode } from '../mission/types.js';
import type { DecisionContext, EvidenceContext, TaskSummary } from './types.js';

export class DecisionContextBuilder {
  constructor(
    private readonly missions: MissionEngine,
    private readonly coordination: CoordinationEngine,
  ) {}

  build(missionId: string): DecisionContext {
    const snapshot = this.missions.snapshot(missionId);
    const coordination = this.coordination.snapshot(missionId);
    const tasks = snapshot.tasks.map(this.toTaskSummary);

    const counts = {
      total: tasks.length,
      completed: tasks.filter(t => t.state === 'COMPLETED').length,
      running: tasks.filter(t => t.state === 'RUNNING').length,
      blocked: tasks.filter(t => t.state === 'BLOCKED').length,
      failed: tasks.filter(t => t.state === 'FAILED').length,
    };

    const completedIds = new Set<string>();
    for (const task of snapshot.tasks) {
      if (task.state === 'COMPLETED') completedIds.add(task.id);
    }

    const readyTasks = snapshot.tasks
      .filter(t => (t.state === 'READY' || t.state === 'PENDING') && t.dependencies.every(d => completedIds.has(d)))
      .map(t => t.id);

    const taskGraphVersion = coordination.version.graphVersion;

    const context: DecisionContext = {
      schemaVersion: '1.0',
      mission: {
        id: snapshot.mission.id,
        goal: snapshot.mission.goal,
        status: snapshot.mission.status,
        projectId: snapshot.mission.projectId,
        constraints: snapshot.mission.constraints as unknown as Record<string, unknown>,
        completionCriteria: snapshot.mission.requirements.completionCriteria,
        requirements: snapshot.mission.requirements as unknown as Record<string, unknown>,
        graphVersion: taskGraphVersion,
      },
      taskGraph: {
        version: taskGraphVersion,
        tasks,
        dependencies: snapshot.tasks.flatMap(t => t.dependencies.map(d => ({ from: d, to: t.id }))),
        readyTasks,
        runningTasks: tasks.filter(t => t.state === 'RUNNING').map(t => t.id),
        blockedTasks: tasks.filter(t => t.state === 'BLOCKED').map(t => t.id),
        completedTasks: tasks.filter(t => t.state === 'COMPLETED').map(t => t.id),
        failedTasks: tasks.filter(t => t.state === 'FAILED').map(t => t.id),
      },
      coordination: {
        conflicts: coordination.conflicts,
        activeReservations: coordination.reservations.filter(r => r.status === 'ACTIVE'),
        activeLeases: coordination.resourceLeases.filter(r => r.status === 'ACTIVE'),
        localPlans: coordination.localPlans,
      },
      executions: [],
      failures: [],
      checkpoints: snapshot.checkpoints.map(c => ({
        id: c.id, taskId: c.taskId, status: c.status,
        completedSteps: c.completedSteps, remainingSteps: c.remainingSteps,
        artifacts: c.artifacts, evidenceIds: c.evidenceIds,
      })),
      evidence: snapshot.evidence.map((e: EvidenceContext) => ({
        id: e.id, type: e.type, passed: e.passed,
        description: e.description, reference: e.reference,
      })),
      decisions: [],
      progress: {
        totalTasks: counts.total,
        completedTasks: counts.completed,
        runningTasks: counts.running,
        blockedTasks: counts.blocked,
        failedTasks: counts.failed,
        readyTasks: readyTasks.length,
        completionRatio: counts.total === 0 ? 0 : counts.completed / counts.total,
        progressSinceLastDecision: true,
      },
      timestamp: new Date().toISOString(),
    };
    return context;
  }

  private readonly toTaskSummary = (task: TaskNode): TaskSummary => ({
    id: task.id,
    parentTaskId: task.parentTaskId,
    title: task.title,
    state: task.state,
    priority: task.priority,
    dependencies: task.dependencies,
    requiredCapabilities: task.requiredCapabilities,
    acceptanceCriteria: task.acceptanceCriteria,
    owner: task.owner,
    attempt: task.attempt,
  });
}
