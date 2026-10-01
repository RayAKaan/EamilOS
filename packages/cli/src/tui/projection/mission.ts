import type { AppModel, MissionStatus } from '../model.js';

export interface MissionProjection {
  id: string;
  title: string;
  objective: string;
  status: MissionStatus;
  progress: number;
  taskCount: number;
  completedTasks: number;
  runningTasks: number;
  agentCount: number;
  activeAgents: number;
  toolCount: number;
  testCount: number;
  failedTests: number;
  pendingApprovals: number;
  cost: string | null;
  startedAt?: number;
  elapsedMs: number;
  currentAction: string;
  validation: AppModel['missionUi']['validation'];
}

export function projectMission(model: AppModel, now = Date.now()): MissionProjection {
  const tasks = model.missionData.tasks;
  const completedTasks = tasks.filter((task) => task.status === 'completed').length;
  const runningTasks = tasks.filter((task) => task.status === 'running').length;
  const toolCount = model.messages.reduce((count, message) => count + message.tools.length, 0);
  const testEvents = model.agentEvents.filter((event) => event.type === 'TEST');
  const failedTests = testEvents.filter((event) => event.type === 'TEST' && event.status === 'failed').length;

  return {
    id: model.missionUi.id,
    title: model.missionUi.title,
    objective: model.missionUi.objective,
    status: model.missionUi.status,
    progress: Math.max(0, Math.min(100, model.missionUi.progress)),
    taskCount: tasks.length,
    completedTasks,
    runningTasks,
    agentCount: model.agents.size,
    activeAgents: Array.from(model.agents.values()).filter((agent) => agent.status === 'busy').length,
    toolCount,
    testCount: testEvents.length,
    failedTests,
    pendingApprovals: model.missionUi.pendingApprovals,
    cost: model.missionUi.cost,
    startedAt: model.missionUi.startedAt,
    elapsedMs: model.missionUi.startedAt ? Math.max(0, now - model.missionUi.startedAt) : 0,
    currentAction: model.missionUi.currentAction,
    validation: model.missionUi.validation,
  };
}
