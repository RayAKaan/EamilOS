import { describe, expect, it } from 'vitest';
import { initialModel } from '../model.js';
import { update } from '../update.js';
import { renderMissionHome, renderLiveExecution } from './missionHome.js';
import { summarizeAgentEvent } from '../renderers/mission-events.js';

describe('Phase 13.2 Mission UI', () => {
  it('starts on Mission Home while preserving the existing session model', () => {
    const model = initialModel(120, 40);
    expect(model.page).toBe('mission');
    expect(model.messages).toEqual([]);
  });

  it('projects real session lifecycle events into Mission Home', () => {
    let model = initialModel(120, 40);
    model = update(model, { type: 'SESSION_STARTED' });
    model = update(model, { type: 'AGENT_STARTED', agentId: 'codex-cli' });
    expect(model.missionUi.status).toBe('running');
    expect(model.missionUi.currentAction).toContain('codex-cli');
    expect(model.agentEvents.some(event => event.type === 'THINKING')).toBe(true);
    expect(renderMissionHome(model, { width: 120, height: 40, mainWidth: 120, mainHeight: 30, mainTop: 0, mainLeft: 0, viewportHeight: 30, bodyHeight: 30, bodyTop: 0, statusBarRow: 0, topSepRow: 0, botSepRow: 0, inputRow: 0, inputStatusRow: 0, sidebarLeft: 120, sidebarWidth: 0, sidebarTop: 0, sidebarHeight: 30, dividerCol: -1, showSidebar: false, compact: false })).toHaveLength(30);
  });

  it('normalizes agent output into live events', () => {
    let model = initialModel(100, 30);
    model = update(model, { type: 'SESSION_STARTED' });
    model = update(model, { type: 'AGENT_OUTPUT', agentId: 'a1', content: 'running tests' });
    expect(model.agentEvents.at(-1)?.type).toBe('MESSAGE');
    expect(summarizeAgentEvent(model.agentEvents.at(-1)!)).toContain('running tests');
  });

  it('bounds live history and supports manual scrolling', () => {
    let model = initialModel(100, 30);
    model = update(model, { type: 'SESSION_STARTED' });
    for (let i = 0; i < 260; i++) model = update(model, { type: 'AGENT_OUTPUT', agentId: 'a1', content: 'event-' + String(i) });
    expect(model.agentEvents.length).toBeLessThanOrEqual(200);
    model = update(model, { type: 'TOGGLE_ACTIVITY_FOLLOW' });
    model = update(model, { type: 'SCROLL_UP', lines: 3 });
    expect(model.activityFollow).toBe(false);
    expect(model.activityScroll).toBe(3);
    expect(renderLiveExecution(model, { width: 100, height: 30, mainWidth: 100, mainHeight: 25, mainTop: 0, mainLeft: 0, viewportHeight: 25, bodyHeight: 25, bodyTop: 0, statusBarRow: 0, topSepRow: 0, botSepRow: 0, inputRow: 0, inputStatusRow: 0, sidebarLeft: 100, sidebarWidth: 0, sidebarTop: 0, sidebarHeight: 25, dividerCol: -1, showSidebar: false, compact: false })).toHaveLength(25);
  });

  it('renders completion and validation without exposing hidden reasoning', () => {
    let model = initialModel(100, 30);
    model = update(model, { type: 'SESSION_STARTED' });
    model = update(model, { type: 'VALIDATION_STARTED' });
    model = update(model, { type: 'VALIDATION_PASSED' });
    model = update(model, { type: 'SESSION_COMPLETED', summary: { strategy: 'single', agentUsed: 'a1', durationMs: 100, fileCount: 2, validated: true, errors: [] } });
    expect(model.missionUi.progress).toBe(100);
    expect(model.missionUi.validation).toBe('passed');
    expect(renderLiveExecution(model, { width: 100, height: 30, mainWidth: 100, mainHeight: 25, mainTop: 0, mainLeft: 0, viewportHeight: 25, bodyHeight: 25, bodyTop: 0, statusBarRow: 0, topSepRow: 0, botSepRow: 0, inputRow: 0, inputStatusRow: 0, sidebarLeft: 100, sidebarWidth: 0, sidebarTop: 0, sidebarHeight: 25, dividerCol: -1, showSidebar: false, compact: false }).some(line => line.includes('hidden chain-of-thought'))).toBe(true);
  });
});
