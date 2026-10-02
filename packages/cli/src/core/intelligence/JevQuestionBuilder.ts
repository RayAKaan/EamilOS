import type { DecisionContext, DecisionAction } from './types.js';
import type { JevQuestion } from './JevSystemOneTypes.js';

const ACTIONS: DecisionAction[] = ['DECOMPOSE','EXECUTE','REASSIGN','RETRY','PARALLELIZE','SEQUENCE','REPLAN','VERIFY','CONTINUE','COMPLETE','ESCALATE','ABORT'];
const MAX_OPTIONS = 255;

export interface JevQuestionBuild {
  state: unknown;
  questions: Record<string, JevQuestion>;
  targetTaskIds: string[];
  candidateAgentIds: string[];
}

export class JevQuestionBuilder {
  build(context: DecisionContext): JevQuestionBuild {
    const targetTaskIds = this.targetTasks(context).slice(0, MAX_OPTIONS);
    const candidateAgentIds = context.agents
      .filter(agent => ['AVAILABLE', 'READY'].includes(agent.status) && ['HEALTHY', 'healthy'].includes(agent.health))
      .map(agent => agent.id)
      .sort()
      .slice(0, MAX_OPTIONS);

    const questions: Record<string, JevQuestion> = {
      action: {
        type: 'choice',
        instructions: 'Which single next action should EamilOS consider for this mission state? Select only from the provided actions. Do not assume permission to execute the action.',
        criteria: Object.fromEntries(ACTIONS.map(action => [action, this.actionMeaning(action)])),
      },
      human_review: {
        type: 'noul',
        instructions: 'Does the current state contain enough uncertainty, conflict, risk, or policy-sensitive conditions that EamilOS should require human review before taking a model-suggested action?',
        criteria: {
          true: 'uncertainty, risk, conflict, or policy sensitivity warrants human review',
          false: 'the state is sufficiently clear for deterministic policy validation',
        },
      },
    };

    if (targetTaskIds.length > 0) {
      questions.target_task = {
        type: 'choice',
        instructions: 'Which task is the most relevant target for the selected next action? Choose only an existing task.',
        criteria: Object.fromEntries(targetTaskIds.map(id => [id, this.taskMeaning(context, id)])),
      };
    }

    if (candidateAgentIds.length > 0) {
      questions.agent = {
        type: 'choice',
        instructions: 'Which available agent is the strongest candidate for the selected action, if an agent assignment is needed?',
        criteria: Object.fromEntries(candidateAgentIds.map(id => [id, this.agentMeaning(context, id)])),
      };
    }

    return {
      state: this.state(context),
      questions,
      targetTaskIds,
      candidateAgentIds,
    };
  }

  private targetTasks(context: DecisionContext): string[] {
    const preferred = [...context.taskGraph.failedTasks, ...context.taskGraph.blockedTasks, ...context.taskGraph.readyTasks, ...context.taskGraph.runningTasks];
    return Array.from(new Set(preferred));
  }

  private taskMeaning(context: DecisionContext, id: string): string {
    const task = context.taskGraph.tasks.find(item => item.id === id);
    return task ? task.title.slice(0, 500) : id;
  }

  private agentMeaning(context: DecisionContext, id: string): string {
    const agent = context.agents.find(item => item.id === id);
    return agent ? agent.harness + ' [' + agent.capabilities.slice(0, 8).join(', ') + ']' : id;
  }

  private actionMeaning(action: DecisionAction): string {
    const meanings: Record<DecisionAction, string> = {
      DECOMPOSE: 'create a validated decomposition for unfinished work',
      EXECUTE: 'execute a ready task',
      REASSIGN: 'move a task to a different compatible worker',
      RETRY: 'retry a recoverable failed execution',
      PARALLELIZE: 'execute independent compatible tasks concurrently',
      SEQUENCE: 'serialize tasks because ordering or resource constraints matter',
      REPLAN: 'replace or revise future work while preserving completed evidence',
      VERIFY: 'validate existing execution evidence and completion criteria',
      CONTINUE: 'continue the current strategy',
      COMPLETE: 'request mission completion after authoritative checks',
      ESCALATE: 'require higher-level or human intervention',
      ABORT: 'stop the mission under an authoritative cancellation policy',
    };
    return meanings[action];
  }

  private state(context: DecisionContext): unknown {
    return {
      mission: context.mission,
      project: context.project,
      taskGraph: context.taskGraph,
      coordination: context.coordination,
      executions: context.executions.slice(-20),
      failures: context.failures.slice(-20),
      checkpoints: context.checkpoints.slice(-20),
      evidence: context.evidence.slice(-30),
      decisions: context.decisions.slice(-20),
      progress: context.progress,
      fleet: context.fleet,
      timestamp: context.timestamp,
    };
  }
}
