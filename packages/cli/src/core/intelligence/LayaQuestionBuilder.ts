import type { DecisionContext, TaskSummary } from './types.js';
import type { IntelligenceRequest } from './IntelligenceRuntimeTypes.js';
import type { LayaPredictRequest, LayaQuestion } from './LayaDecisionTypes.js';

const ACTIONS = ['EXECUTE', 'RETRY', 'REASSIGN', 'REPLAN', 'VERIFY', 'ESCALATE', 'CONTINUE'];
const RECOVERY_ACTIONS = ['RETRY', 'REASSIGN', 'REPLAN', 'SEQUENCE', 'ESCALATE'];
const MAX_AGENT_OPTIONS = 20;

export interface LayaQuestionBuild { request: LayaPredictRequest; questionIds: string[]; candidateAgentIds: string[]; }

export class LayaQuestionBuilder {
  build(request: IntelligenceRequest, context: DecisionContext): LayaQuestionBuild {
    const task = this.task(context, request.metadata?.taskId as string | undefined);
    const candidateAgentIds = context.agents.filter(agent => ['AVAILABLE', 'READY'].includes(agent.status) && ['HEALTHY', 'healthy'].includes(agent.health)).sort((a, b) => a.id.localeCompare(b.id)).map(agent => agent.id);
    const questions: Record<string, LayaQuestion> = {};
    if (request.type === 'RECOVERY_DECISION') questions.recovery = { type: 'choice', instructions: 'Which recovery action is safest for the failed task, considering failure type, retry budget, worker availability, dependencies, and resource constraints?', criteria: Object.fromEntries(RECOVERY_ACTIONS.map(action => [action, action.toLowerCase()])) };
    else if (request.type === 'AGENT_SELECTION' && candidateAgentIds.length >= 2 && candidateAgentIds.length <= MAX_AGENT_OPTIONS) questions.agent = { type: 'choice', instructions: 'Which available worker is the best capability match for the target task while respecting health and execution constraints?', criteria: Object.fromEntries(candidateAgentIds.map(id => [id, 'worker ' + id])) };
    else if (request.type === 'PARALLELIZATION') questions.safe_parallel = { type: 'noul', instructions: 'Is it safe to execute the currently ready tasks concurrently without violating dependencies, resource conflicts, concurrency limits, or mission policy?', criteria: { true: 'parallel execution is safe', false: 'parallel execution is unsafe or insufficiently supported' } };
    else if (request.type === 'VALIDATION') questions.evidence_sufficient = { type: 'noul', instructions: 'Is the recorded execution evidence sufficient to support completion without relying on an agent self-declaration?', criteria: { true: 'authoritative validation evidence supports completion', false: 'evidence is missing, failed, stale, or insufficient' } };
    else if (request.type === 'TASK_DECISION' || request.type === 'STRATEGIC_DECISION') questions.action = { type: 'choice', instructions: task ? 'Which next action is most appropriate for this task given its state, dependencies, failures, evidence, and available workers?' : 'Which next action is most appropriate for this mission given its state, constraints, progress, failures, evidence, and available workers?', criteria: Object.fromEntries(ACTIONS.map(action => [action, action.toLowerCase()])) };
    else questions.action = { type: 'choice', instructions: 'Which safe next action best advances the supplied EamilOS state?', criteria: Object.fromEntries(ACTIONS.map(action => [action, action.toLowerCase()])) };
    return { request: { state: this.state(context, request, task), questions, model: process.env.EAMILOS_LAYA_MODEL || 'typed-decisions' }, questionIds: Object.keys(questions), candidateAgentIds };
  }
  private task(context: DecisionContext, taskId?: string): TaskSummary | undefined { return taskId ? context.taskGraph.tasks.find(task => task.id === taskId) : context.taskGraph.tasks.find(task => task.state === 'READY' || task.state === 'FAILED'); }
  private state(context: DecisionContext, request: IntelligenceRequest, task?: TaskSummary): Record<string, unknown> {
    return { mission: { id: context.mission.id, goal: context.mission.goal, status: context.mission.status, constraints: context.mission.constraints, completionCriteria: context.mission.completionCriteria, graphVersion: context.taskGraph.version }, task, taskGraph: { version: context.taskGraph.version, ready: context.taskGraph.readyTasks, running: context.taskGraph.runningTasks, blocked: context.taskGraph.blockedTasks, failed: context.taskGraph.failedTasks }, failures: context.failures.slice(-10), executions: context.executions.slice(-10), evidence: context.evidence.slice(-20), agents: context.agents.slice(0, MAX_AGENT_OPTIONS), coordination: { conflicts: context.coordination.conflicts, reservations: context.coordination.activeReservations, leases: context.coordination.activeLeases }, progress: context.progress, request: { type: request.type, priority: request.priority, metadata: request.metadata ?? {} } };
  }
}
