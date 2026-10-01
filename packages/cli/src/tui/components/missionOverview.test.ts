import { describe, expect, it } from 'vitest';
import { initialModel } from '../model.js';
import { layoutFor } from '../layout.js';
import { renderMissionAttention, renderMissionMetrics, renderMissionPlan, missionStages } from './missionOverview.js';

function model() {
  const m = initialModel(140, 40);
  m.missionUi = {
    ...m.missionUi,
    id: 'mission-1',
    title: 'Ship authentication',
    objective: 'Implement and validate OAuth authentication',
    status: 'running',
    progress: 42,
    currentAction: 'Running integration tests',
    validation: 'running',
    pendingApprovals: 0,
    activity: [],
  };
  m.missionData.tasks = [
    { id: 'T-1', missionId: 'mission-1', title: 'Implement OAuth flow', status: 'completed', progress: 100, dependsOn: [], validation: 'passed', createdAt: 1, completedAt: 2 },
    { id: 'T-2', missionId: 'mission-1', title: 'Run integration tests', status: 'running', progress: 50, dependsOn: ['T-1'], validation: 'running', createdAt: 1 },
  ];
  return m;
}

describe('phase 3 mission UI', () => {
  it('projects the mission flow from canonical task and validation state', () => {
    const stages = missionStages(model());
    expect(stages.map(s => s.label)).toEqual(['Intent', 'Plan', 'Execute', 'Validate', 'Deliver']);
    expect(stages.find(s => s.key === 'execute')?.state).toBe('active');
    expect(stages.find(s => s.key === 'validate')?.state).toBe('active');
  });

  it('renders the task plan and progress without exposing hidden reasoning', () => {
    const m = model();
    const lines = renderMissionPlan(m, layoutFor(m)).join('\n');
    expect(lines).toContain('TASK PLAN');
    expect(lines).toContain('T-1');
    expect(lines).toContain('T-2');
    expect(lines).not.toContain('chain-of-thought');
  });

  it('surfaces approval attention as an actionable mission state', () => {
    const m = model();
    m.missionUi.pendingApprovals = 2;
    const lines = renderMissionAttention(m, layoutFor(m)).join('\n');
    expect(lines).toContain('ACTION REQUIRED');
    expect(lines).toContain('2 approvals');
  });

  it('renders mission metrics from model state', () => {
    const m = model();
    m.missionData.executions = [
      { id: 'E-1', taskId: 'T-2', sessionId: 'S-1', status: 'running', events: [] },
    ];
    const lines = renderMissionMetrics(m, layoutFor(m)).join('\n');
    expect(lines).toContain('Tasks 1/2');
    expect(lines).toContain('Executions 1');
  });
});
