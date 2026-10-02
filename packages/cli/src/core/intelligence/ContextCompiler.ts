import type { DecisionContext } from './types.js';
import { ContextHasher } from './ContextHasher.js';
import { ContextSanitizer } from './ContextSanitizer.js';

export interface StrategicContext {
  schemaVersion: '2.0';
  mission: DecisionContext['mission'];
  project: DecisionContext['project'];
  taskGraph: DecisionContext['taskGraph'];
  coordination: DecisionContext['coordination'];
  executions: DecisionContext['executions'];
  failures: DecisionContext['failures'];
  evidence: DecisionContext['evidence'];
  decisions: DecisionContext['decisions'];
  progress: DecisionContext['progress'];
  fleet?: DecisionContext['fleet'];
}

export interface DecisionContextView {
  schemaVersion: '2.0';
  mission: DecisionContext['mission'];
  taskGraph: DecisionContext['taskGraph'];
  coordination: DecisionContext['coordination'];
  progress: DecisionContext['progress'];
  failures: DecisionContext['failures'];
}

export interface PlanningContext {
  schemaVersion: '2.0';
  mission: Pick<DecisionContext['mission'], 'id' | 'goal' | 'constraints' | 'completionCriteria' | 'requirements' | 'graphVersion'>;
  taskGraph: Pick<DecisionContext['taskGraph'], 'version' | 'tasks' | 'dependencies'>;
  coordination: Pick<DecisionContext['coordination'], 'activeReservations' | 'activeLeases' | 'localPlans'>;
}

export interface RecoveryContext {
  schemaVersion: '2.0';
  mission: Pick<DecisionContext['mission'], 'id' | 'goal' | 'constraints' | 'graphVersion'>;
  taskGraph: DecisionContext['taskGraph'];
  executions: DecisionContext['executions'];
  failures: DecisionContext['failures'];
  checkpoints: DecisionContext['checkpoints'];
  fleet?: DecisionContext['fleet'];
}

export interface ValidationContext {
  schemaVersion: '2.0';
  mission: Pick<DecisionContext['mission'], 'id' | 'goal' | 'completionCriteria' | 'requirements' | 'graphVersion'>;
  taskGraph: Pick<DecisionContext['taskGraph'], 'version' | 'tasks' | 'completedTasks' | 'failedTasks'>;
  evidence: DecisionContext['evidence'];
  artifacts: DecisionContext['artifacts'];
}

export interface CompiledContext<T> {
  value: T;
  version: number;
  hash: string;
}

export class ContextCompiler {
  constructor(private readonly sanitizer = new ContextSanitizer()) {}

  strategic(context: DecisionContext): CompiledContext<StrategicContext> {
    return this.compile({
      schemaVersion: '2.0',
      mission: context.mission,
      project: context.project,
      taskGraph: context.taskGraph,
      coordination: context.coordination,
      executions: context.executions,
      failures: context.failures,
      evidence: context.evidence,
      decisions: context.decisions,
      progress: context.progress,
      fleet: context.fleet,
    }, context.taskGraph.version);
  }

  decision(context: DecisionContext): CompiledContext<DecisionContextView> {
    return this.compile({
      schemaVersion: '2.0',
      mission: context.mission,
      taskGraph: context.taskGraph,
      coordination: context.coordination,
      progress: context.progress,
      failures: context.failures,
    }, context.taskGraph.version);
  }

  planning(context: DecisionContext): CompiledContext<PlanningContext> {
    return this.compile({
      schemaVersion: '2.0',
      mission: {
        id: context.mission.id,
        goal: context.mission.goal,
        constraints: context.mission.constraints,
        completionCriteria: context.mission.completionCriteria,
        requirements: context.mission.requirements,
        graphVersion: context.mission.graphVersion,
      },
      taskGraph: {
        version: context.taskGraph.version,
        tasks: context.taskGraph.tasks,
        dependencies: context.taskGraph.dependencies,
      },
      coordination: {
        activeReservations: context.coordination.activeReservations,
        activeLeases: context.coordination.activeLeases,
        localPlans: context.coordination.localPlans,
      },
    }, context.taskGraph.version);
  }

  recovery(context: DecisionContext): CompiledContext<RecoveryContext> {
    return this.compile({
      schemaVersion: '2.0',
      mission: {
        id: context.mission.id,
        goal: context.mission.goal,
        constraints: context.mission.constraints,
        graphVersion: context.mission.graphVersion,
      },
      taskGraph: context.taskGraph,
      executions: context.executions,
      failures: context.failures,
      checkpoints: context.checkpoints,
      fleet: context.fleet,
    }, context.taskGraph.version);
  }

  validation(context: DecisionContext): CompiledContext<ValidationContext> {
    return this.compile({
      schemaVersion: '2.0',
      mission: {
        id: context.mission.id,
        goal: context.mission.goal,
        completionCriteria: context.mission.completionCriteria,
        requirements: context.mission.requirements,
        graphVersion: context.mission.graphVersion,
      },
      taskGraph: {
        version: context.taskGraph.version,
        tasks: context.taskGraph.tasks,
        completedTasks: context.taskGraph.completedTasks,
        failedTasks: context.taskGraph.failedTasks,
      },
      evidence: context.evidence,
      artifacts: context.artifacts,
    }, context.taskGraph.version);
  }

  private compile<T>(value: T, version: number): CompiledContext<T> {
    const sanitized = this.sanitizer.sanitize(value);
    return { value: sanitized, version, hash: ContextHasher.hash(sanitized) };
  }
}
