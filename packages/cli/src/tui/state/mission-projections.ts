import type { AppModel } from '../model.js';
import type { ArtifactRecord, ExecutionRecord, SessionRecord, TaskRecord } from '../mission-data.js';

export const selectTasks = (model: AppModel): TaskRecord[] => model.missionData.tasks;
export const selectCurrentTask = (model: AppModel): TaskRecord | undefined =>
  model.missionData.tasks.find(t => t.id === model.missionData.selectedTaskId) ??
  model.missionData.tasks.find(t => t.status === 'running') ??
  model.missionData.tasks[0];

export const selectArtifacts = (model: AppModel): ArtifactRecord[] => model.missionData.artifacts;
export const selectCurrentArtifact = (model: AppModel): ArtifactRecord | undefined =>
  model.missionData.artifacts.find(a => a.id === model.missionData.selectedArtifactId) ??
  model.missionData.artifacts[0];

export const selectSessions = (model: AppModel): SessionRecord[] => model.missionData.sessions;
export const selectCurrentSession = (model: AppModel): SessionRecord | undefined =>
  model.missionData.sessions.find(s => s.id === model.missionData.selectedSessionId) ??
  model.missionData.sessions[0];

export const selectExecution = (model: AppModel): ExecutionRecord | undefined =>
  model.missionData.executions.find(e => e.id === model.missionData.selectedExecutionId) ??
  model.missionData.executions.find(e => e.status === 'running') ??
  model.missionData.executions[0];

export const selectExecutionsForTask = (model: AppModel, taskId: string): ExecutionRecord[] =>
  model.missionData.executions.filter(e => e.taskId === taskId);

export const selectArtifactsForTask = (model: AppModel, taskId: string): ArtifactRecord[] =>
  model.missionData.artifacts.filter(a => a.taskId === taskId);

export const selectExecutionsForSession = (model: AppModel, sessionId: string): ExecutionRecord[] =>
  model.missionData.executions.filter(e => e.sessionId === sessionId);
