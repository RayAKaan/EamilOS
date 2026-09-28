import { describe, expect, it } from 'vitest';
import { initialModel } from '../model.js';
import { update } from '../update.js';
import { renderTasks, renderArtifacts, renderSessions, renderGitHub } from './explorers.js';

describe('Phase 13.3 explorers', () => {
  it('projects a task, execution and artifact chain from session events', () => {
    let model = initialModel(120, 40);
    model = update(model, { type: 'SESSION_STARTED' });
    model = update(model, { type: 'AGENT_STARTED', agentId: 'codex' });
    model = update(model, { type: 'CHANGES_COLLECTED', files: [{ path: 'src/auth.ts', action: 'modify', agent: 'codex' }] });
    model = update(model, { type: 'VALIDATION_PASSED' });
    model = update(model, { type: 'SESSION_COMPLETED', summary: { strategy: 'single', agentUsed: 'codex', durationMs: 1200, fileCount: 1, validated: true, errors: [] } });
    expect(model.missionData.tasks).toHaveLength(1);
    expect(model.missionData.executions).toHaveLength(1);
    expect(model.missionData.artifacts[0]?.path).toBe('src/auth.ts');
    expect(model.missionData.sessions).toHaveLength(1);
  });

  it('renders empty explorer states without throwing', () => {
    const model = initialModel(100, 30);
    const layout = { mainWidth: 90, viewportHeight: 20 } as any;
    expect(renderTasks(model, layout)).toHaveLength(20);
    expect(renderArtifacts(model, layout)).toHaveLength(20);
    expect(renderSessions(model, layout)).toHaveLength(20);
    expect(renderGitHub(model, layout)).toHaveLength(20);
  });
});
