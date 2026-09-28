import type { AgentEvent } from './events/agent-event.js';
import type { AppModel, Page, AgentMode, Strategy, AgentEntry, TerminalEntry, Message, RunSummary, ModifiedFile, MissionActivityItem } from './model.js';
import { nextActivityId, nextMsgId } from './model.js';
import type { FleetDevice } from './fleet-data.js';
import { buildMissionGraph } from './graph-builder.js';

export type Msg =
  | { type: 'RESIZE'; width: number; height: number }
  | { type: 'SET_PAGE'; page: Page }
  | { type: 'SET_MODE'; mode: AgentMode }
  | { type: 'SET_STRATEGY'; strategy: Strategy }
  | { type: 'INPUT_CHAR'; char: string }
  | { type: 'INPUT_BACKSPACE' }
  | { type: 'INPUT_DELETE' }
  | { type: 'INPUT_CLEAR' }
  | { type: 'INPUT_RECALL' }
  | { type: 'INPUT_HOME' }
  | { type: 'INPUT_END' }
  | { type: 'INPUT_LEFT' }
  | { type: 'INPUT_RIGHT' }
  | { type: 'SUBMIT' }
  | { type: 'SCROLL_UP'; lines: number }
  | { type: 'SCROLL_DOWN'; lines: number }
  | { type: 'SCROLL_TOP' }
  | { type: 'SCROLL_BOTTOM' }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'TOGGLE_ACTIVITY_FOLLOW' }
  | { type: 'CLEAR_CHAT' }
  | { type: 'TICK' }
  | { type: 'NOTIFY'; text: string }
  | { type: 'DETECTION_START' }
  | { type: 'DETECTION_COMPLETE'; agents: AgentEntry[] }
  | { type: 'DETECTION_FAILED'; error: string }
  | { type: 'SESSION_STARTED' }
  | { type: 'SESSION_COMPLETED'; summary: RunSummary }
  | { type: 'SESSION_ERROR'; error: string }
  | { type: 'AGENT_STARTED'; agentId: string }
  | { type: 'AGENT_OUTPUT'; agentId: string; content: string }
  | { type: 'AGENT_COMPLETED'; agentId: string }
  | { type: 'AGENT_ERROR'; agentId: string; error: string }
  | { type: 'AGENT_FALLBACK'; from: string; to: string; reason: string }
  | { type: 'CHANGES_COLLECTED'; files: ModifiedFile[] }
  | { type: 'VALIDATION_STARTED' }
  | { type: 'VALIDATION_PASSED' }
  | { type: 'VALIDATION_FAILED'; errors: string[] }
  | { type: 'CONFLICT_RESOLVED'; path: string; method: string; winner: string }
  | { type: 'TERMINAL_SPAWNED'; entry: TerminalEntry }
  | { type: 'TERMINAL_UPDATED'; agentId: string; lastLine: string; status: TerminalEntry['status'] }
  | { type: 'LOG'; text: string }
  | { type: 'STATUS_TEXT'; text: string }
  | { type: 'REFRESH_GITHUB' }
  | { type: 'GITHUB_REFRESHED'; state: import('./mission-data.js').GitHubState }
  | { type: 'SELECT_TASK'; taskId: string }
  | { type: 'SELECT_ARTIFACT'; artifactId: string }
  | { type: 'SELECT_SESSION'; sessionId: string }
  | { type: 'SELECT_EXECUTION'; executionId: string }
  | { type: 'DEVICE_CONNECTED'; device: { id: string; name: string; capabilities?: string[] } }
  | { type: 'DEVICE_DISCONNECTED'; deviceId: string }
  | { type: 'DEVICE_STATUS'; deviceId: string; status: import('./fleet-data.js').FleetDeviceStatus }
  | { type: 'AGENT_ASSIGNED'; agentId: string; taskId?: string; executionId?: string; deviceId?: string }
  | { type: 'FLEET_SELECT_AGENT'; agentId: string }
  | { type: 'FLEET_SELECT_DEVICE'; deviceId: string }
  | { type: 'GRAPH_FOCUS'; nodeId: string }
  | { type: 'GRAPH_TOGGLE_EXPAND'; nodeId: string }
  | { type: 'GRAPH_TRACE'; nodeId: string };

function findCallsign(model: AppModel, agentId: string): string | undefined {
  return model.agents.get(agentId)?.callsign;
}

function makeMsg(partial: Omit<Message, 'id' | 'tools' | 'streaming'> & Partial<Pick<Message, 'tools' | 'streaming'>>): Message {
  return { id: nextMsgId(), tools: [], streaming: false, ...partial };
}

function activity(title: string, severity: MissionActivityItem['severity'], detail?: string, source?: string): MissionActivityItem {
  return { id: nextActivityId(), timestamp: Date.now(), title, detail, severity, source };
}

function appendAgentEvent(events: AgentEvent[], event: AgentEvent): AgentEvent[] {
  return [...events, event].slice(-200);
}

function appendActivity(items: MissionActivityItem[], item: MissionActivityItem): MissionActivityItem[] {
  return [...items, item].slice(-100);
}
function rebuildGraph(model: AppModel): AppModel {
  const graph = buildMissionGraph(model);
  return { ...model, graph: { ...graph, focus: model.graph.focus, version: model.graph.version + 1, changedAt: Date.now() } };
}

export function update(model: AppModel, msg: Msg): AppModel {
  switch (msg.type) {
    case 'RESIZE':
      return { ...model, width: msg.width, height: msg.height };

    case 'SET_PAGE':
      return { ...model, page: msg.page };

    case 'SET_MODE':
      return { ...model, mode: msg.mode };

    case 'SET_STRATEGY':
      return { ...model, strategy: msg.strategy };

    case 'INPUT_CHAR': {
      const input = model.input.slice(0, model.cursor) + msg.char + model.input.slice(model.cursor);
      return { ...model, input, cursor: model.cursor + 1 };
    }

    case 'INPUT_BACKSPACE': {
      if (model.cursor === 0) return model;
      return { ...model, input: model.input.slice(0, model.cursor - 1) + model.input.slice(model.cursor), cursor: model.cursor - 1 };
    }

    case 'INPUT_DELETE':
      return model.cursor >= model.input.length ? model : { ...model, input: model.input.slice(0, model.cursor) + model.input.slice(model.cursor + 1) };

    case 'INPUT_CLEAR':
      return { ...model, lastPrompt: model.input, input: '', cursor: 0 };

    case 'INPUT_RECALL':
      return { ...model, input: model.lastPrompt, cursor: model.lastPrompt.length };

    case 'INPUT_HOME':
      return { ...model, cursor: 0 };

    case 'INPUT_END':
      return { ...model, cursor: model.input.length };

    case 'INPUT_LEFT':
      return { ...model, cursor: Math.max(0, model.cursor - 1) };

    case 'INPUT_RIGHT':
      return { ...model, cursor: Math.min(model.input.length, model.cursor + 1) };

    case 'SUBMIT':
      return model;

    case 'SCROLL_UP':
      return model.page === 'execution'
        ? { ...model, activityScroll: model.activityScroll + msg.lines, activityFollow: false }
        : { ...model, scroll: model.scroll + msg.lines };

    case 'SCROLL_DOWN':
      return model.page === 'execution'
        ? { ...model, activityScroll: Math.max(0, model.activityScroll - msg.lines) }
        : { ...model, scroll: Math.max(0, model.scroll - msg.lines) };

    case 'SCROLL_TOP':
      return model.page === 'execution' ? { ...model, activityScroll: 999999, activityFollow: false } : { ...model, scroll: 999999 };

    case 'SCROLL_BOTTOM':
      return model.page === 'execution' ? { ...model, activityScroll: 0, activityFollow: true } : { ...model, scroll: 0 };

    case 'TOGGLE_SIDEBAR':
      return { ...model, sidebarVisible: !model.sidebarVisible };

    case 'TOGGLE_ACTIVITY_FOLLOW':
      return { ...model, activityFollow: !model.activityFollow, activityScroll: 0 };

    case 'CLEAR_CHAT':
      return { ...model, messages: [], runSummary: null, modifiedFiles: [], scroll: 0 };

    case 'TICK':
      return { ...model, spinFrame: (model.spinFrame + 1) % 10 };

    case 'REFRESH_GITHUB':
      return { ...model, statusText: 'Refreshing GitHub…' };

    case 'GITHUB_REFRESHED':
      return { ...model, missionData: { ...model.missionData, github: msg.state }, statusText: msg.state.error ? 'GitHub unavailable' : 'GitHub refreshed' };

    case 'SELECT_TASK':
      return { ...model, missionData: { ...model.missionData, selectedTaskId: msg.taskId } };
    case 'SELECT_ARTIFACT':
      return { ...model, missionData: { ...model.missionData, selectedArtifactId: msg.artifactId } };
    case 'SELECT_SESSION':
      return { ...model, missionData: { ...model.missionData, selectedSessionId: msg.sessionId } };
    case 'SELECT_EXECUTION':
      return { ...model, missionData: { ...model.missionData, selectedExecutionId: msg.executionId } };

    case 'FLEET_SELECT_AGENT':
      return { ...model, fleet: { ...model.fleet, selectedAgentId: msg.agentId, selectedDeviceId: undefined } };
    case 'FLEET_SELECT_DEVICE':
      return { ...model, fleet: { ...model.fleet, selectedDeviceId: msg.deviceId, selectedAgentId: undefined } };
    case 'GRAPH_FOCUS':
      return { ...model, graph: { ...model.graph, focus: { ...model.graph.focus, nodeId: msg.nodeId } } };
    case 'GRAPH_TOGGLE_EXPAND': {
      const expanded = new Set(model.graph.focus.expanded);
      if (expanded.has(msg.nodeId)) expanded.delete(msg.nodeId); else expanded.add(msg.nodeId);
      return { ...model, graph: { ...model.graph, focus: { ...model.graph.focus, nodeId: msg.nodeId, expanded: [...expanded] } } };
    }
    case 'GRAPH_TRACE': {
      const from = model.graph.focus.nodeId;
      if (!from) return model;
      const q: string[][] = [[from]]; const seen = new Set([from]); let path: string[] = [];
      while (q.length) { const p = q.shift()!; const cur = p[p.length - 1]!; if (cur === msg.nodeId) { path = p; break; } for (const e of model.graph.edges) { const n = e.from === cur ? e.to : e.to === cur ? e.from : undefined; if (n && !seen.has(n)) { seen.add(n); q.push([...p, n]); } } }
      return { ...model, graph: { ...model.graph, focus: { ...model.graph.focus, nodeId: msg.nodeId, path } } };
    }
    case 'DEVICE_CONNECTED': {
      const existing = model.fleet.devices.find(d => d.id === msg.device.id);
      const device = { id: msg.device.id, name: msg.device.name, status: 'connected' as const, agentIds: existing?.agentIds ?? [], taskIds: existing?.taskIds ?? [], capabilities: msg.device.capabilities ?? existing?.capabilities ?? [], health: 'healthy' as const, lastSeenAt: Date.now() };
      return rebuildGraph({ ...model, fleet: { ...model.fleet, devices: [...model.fleet.devices.filter(d => d.id !== device.id), device], selectedDeviceId: device.id, lastEventAt: Date.now() }, missionUi: { ...model.missionUi, deviceCount: model.fleet.devices.filter(d => d.status === 'connected').length + (existing?.status === 'connected' ? 0 : 1), activity: appendActivity(model.missionUi.activity, activity('Device connected', 'success', device.name)) } });
    }
    case 'DEVICE_DISCONNECTED': {
      const devices = model.fleet.devices.map(d => d.id === msg.deviceId ? { ...d, status: 'disconnected' as const, health: 'unknown' as const, lastSeenAt: Date.now() } : d);
      return rebuildGraph({ ...model, fleet: { ...model.fleet, devices, lastEventAt: Date.now() }, missionUi: { ...model.missionUi, activity: appendActivity(model.missionUi.activity, activity('Device disconnected', 'warning', msg.deviceId)) } });
    }
    case 'DEVICE_STATUS': {
      const devices = model.fleet.devices.map(d => d.id === msg.deviceId ? { ...d, status: msg.status, health: msg.status === 'connected' ? 'healthy' as const : 'unknown' as const, lastSeenAt: Date.now() } : d);
      return rebuildGraph({ ...model, fleet: { ...model.fleet, devices, lastEventAt: Date.now() } });
    }
    case 'AGENT_ASSIGNED': {
      const agents = model.fleet.agents.map(a => a.id === msg.agentId ? { ...a, currentTaskId: msg.taskId, currentExecutionId: msg.executionId, deviceId: msg.deviceId, status: 'running' as const, lastSeenAt: Date.now() } : a);
      const devices = model.fleet.devices.map(d => d.id === msg.deviceId ? { ...d, agentIds: d.agentIds.includes(msg.agentId) ? d.agentIds : [...d.agentIds, msg.agentId], taskIds: msg.taskId && !d.taskIds.includes(msg.taskId) ? [...d.taskIds, msg.taskId] : d.taskIds } : d);
      return rebuildGraph({ ...model, fleet: { ...model.fleet, agents, devices, lastEventAt: Date.now() } });
    }

    case 'NOTIFY':
      return { ...model, notification: msg.text };

    case 'DETECTION_START':
      return { ...model, detectionState: 'detecting', statusText: 'Detecting agents…' };

    case 'DETECTION_COMPLETE': {
      const agents = new Map(model.agents);
      for (const a of msg.agents) agents.set(a.id, a);
      const readyCount = msg.agents.filter(a => a.status === 'ready').length;
      const fleetAgents = msg.agents.map(a => ({ id:a.id, name:a.name || a.callsign, status:(a.status === 'busy' ? 'running' : a.status === 'offline' ? 'disconnected' : a.status === 'not_installed' ? 'error' : 'ready') as const, capabilities:[], health:'unknown' as const, lastSeenAt:Date.now() }));
      return rebuildGraph({ ...model, detectionState: 'complete', agents, fleet:{...model.fleet,agents:fleetAgents,lastEventAt:Date.now()}, statusText: String(readyCount) + ' agent' + (readyCount !== 1 ? 's' : '') + ' ready' });
    }

    case 'DETECTION_FAILED':
      return { ...model, detectionState: 'failed', statusText: 'Detection failed: ' + msg.error };

    case 'SESSION_STARTED': {
      const now = Date.now();
      const missionId = 'mission-' + String(now);
      const sessionId = 'session-' + String(now);
      const taskId = 'task-' + String(now);
      const objective = model.lastPrompt || 'Execute the requested mission.';
      const sysMsg = makeMsg({ type: 'system', content: 'Strategy: ' + model.strategy + ' · mode: ' + model.mode, timestamp: now });
      const mission = { ...model.missionUi, id: missionId, title: objective, objective, status: 'running' as const, progress: 0, currentAction: 'Initializing mission execution', validation: 'idle' as const, pendingApprovals: 0, startedAt: now, activity: [activity('Mission started', 'info')] };
      const session = { id: sessionId, missionId, goal: objective, strategy: model.strategy, startedAt: now, status: 'running' as const, executionIds: [] as string[] };
      const task = { id: taskId, missionId, title: objective, status: 'running' as const, progress: 0, dependsOn: [] as string[], validation: 'idle' as const, createdAt: now, startedAt: now };
      return { ...model, running: true, scroll: 0, agentEvents: [], activityFollow: true, activityScroll: 0, missionUi: mission, messages: [...model.messages, sysMsg], statusText: 'Running…', sessions: [...model.sessions, { id: sessionId, goal: objective, strategy: model.strategy, startedAt: now, status: 'running' as const, messageCount: 0 }], missionData: { ...model.missionData, tasks: [...model.missionData.tasks, task], sessions: [...model.missionData.sessions, session], selectedTaskId: taskId, selectedSessionId: sessionId, selectedExecutionId: undefined } };
    }

    case 'SESSION_COMPLETED': {
      const summary = msg.summary;
      const summaryMsg = makeMsg({ type: 'run_summary', content: JSON.stringify(summary), timestamp: Date.now(), validated: summary.validated });
      const updatedSessions = model.sessions.map(s => s.status === 'running' ? { ...s, status: 'completed' as const, duration: summary.durationMs, messageCount: model.messages.length } : s);
      return rebuildGraph({
        ...model,
        running: false,
        runSummary: summary,
        messages: [...model.messages, summaryMsg],
        sessions: updatedSessions,
        missionUi: {
          ...model.missionUi,
          status: summary.validated ? 'completed' : 'failed',
          progress: summary.validated ? 100 : model.missionUi.progress,
          currentAction: summary.validated ? 'Mission completed and validated' : 'Mission completed with validation errors',
          validation: summary.validated ? 'passed' : 'failed',
          activity: appendActivity(model.missionUi.activity, activity(summary.validated ? 'Mission completed' : 'Mission finished with errors', summary.validated ? 'success' : 'error')),
        },
        statusText: summary.validated ? '✓ Completed' : '✗ Failed',
        missionData: {
          ...model.missionData,
          tasks: model.missionData.tasks.map(t => t.id === model.missionData.selectedTaskId ? { ...t, status: summary.validated ? 'completed' as const : 'failed' as const, progress: summary.validated ? 100 : t.progress, validation: summary.validated ? 'passed' as const : 'failed' as const, completedAt: Date.now() } : t),
          sessions: model.missionData.sessions.map(s => s.id === model.missionData.selectedSessionId ? { ...s, status: summary.validated ? 'completed' as const : 'failed' as const, durationMs: summary.durationMs } : s),
          executions: model.missionData.executions.map(e => e.id === model.missionData.selectedExecutionId ? { ...e, status: summary.validated ? 'completed' as const : 'failed' as const, finishedAt: Date.now() } : e),
        },
      });
    }

    case 'SESSION_ERROR': {
      const errMsg = makeMsg({ type: 'error', content: msg.error, timestamp: Date.now() });
      const updatedSessions = model.sessions.map(s => s.status === 'running' ? { ...s, status: 'failed' as const } : s);
      return rebuildGraph({
        ...model,
        running: false,
        messages: [...model.messages, errMsg],
        missionUi: { ...model.missionUi, status: 'failed', currentAction: msg.error, activity: appendActivity(model.missionUi.activity, activity('Mission failed', 'error', msg.error)) },
        statusText: 'Error: ' + msg.error.slice(0, 60),
        missionData: {
          ...model.missionData,
          tasks: model.missionData.tasks.map(t => t.id === model.missionData.selectedTaskId ? { ...t, status: 'failed' as const, validation: 'failed' as const } : t),
          sessions: model.missionData.sessions.map(s => s.id === model.missionData.selectedSessionId ? { ...s, status: 'failed' as const } : s),
          executions: model.missionData.executions.map(e => e.id === model.missionData.selectedExecutionId ? { ...e, status: 'failed' as const, finishedAt: Date.now() } : e),
        },
      });
    }

    case 'AGENT_STARTED': {
      const agents = new Map(model.agents);
      const a = agents.get(msg.agentId);
      if (a) agents.set(msg.agentId, { ...a, status: 'busy' });
      const event: AgentEvent = { type: 'THINKING', timestamp: Date.now(), agentId: msg.agentId, label: 'Starting execution' };
      const executionId = 'exec-' + String(Date.now());
      const taskId = model.missionData.selectedTaskId;
      const sessionId = model.missionData.selectedSessionId;
      const execution = { id: executionId, taskId: taskId ?? 'unassigned', sessionId: sessionId ?? 'unknown', agentId: msg.agentId, status: 'running' as const, startedAt: Date.now(), events: [] as string[] };
      const tasks = model.missionData.tasks.map(t => t.id === taskId ? { ...t, assignedAgentId: msg.agentId, currentExecutionId: executionId, status: 'running' as const, progress: Math.max(t.progress, 10) } : t);
      const sessions = model.missionData.sessions.map(s => s.id === sessionId ? { ...s, executionIds: [...s.executionIds, executionId] } : s);
      return {
        ...model,
        agents,
        agentEvents: appendAgentEvent(model.agentEvents, event),
        missionData: { ...model.missionData, executions: [...model.missionData.executions, execution], tasks, sessions, selectedExecutionId: executionId },
        missionUi: { ...model.missionUi, currentAction: 'Agent ' + msg.agentId + ' is executing', activity: appendActivity(model.missionUi.activity, activity('Agent started', 'info', msg.agentId, msg.agentId)) },
        messages: [...model.messages, makeMsg({ type: 'agent', agentId: msg.agentId, callsign: findCallsign(model, msg.agentId), content: '', timestamp: Date.now(), streaming: true })],
      });
    }

    case 'AGENT_OUTPUT': {
      const messages = [...model.messages];
      let found = false;
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]!;
        if (m.agentId === msg.agentId && m.streaming) {
          messages[i] = { ...m, content: m.content + msg.content };
          found = true;
          break;
        }
      }
      if (!found) messages.push(makeMsg({ type: 'agent', agentId: msg.agentId, callsign: findCallsign(model, msg.agentId), content: msg.content, timestamp: Date.now(), streaming: true }));
      const event: AgentEvent = { type: 'MESSAGE', timestamp: Date.now(), agentId: msg.agentId, content: msg.content };
      return {
        ...model,
        messages,
        agentEvents: appendAgentEvent(model.agentEvents, event),
        missionUi: { ...model.missionUi, currentAction: 'Agent ' + msg.agentId + ' is producing output', activity: appendActivity(model.missionUi.activity, activity('Agent output', 'info', msg.content.slice(0, 100), msg.agentId)) },
      };
    }

    case 'AGENT_COMPLETED': {
      const agents = new Map(model.agents);
      const a = agents.get(msg.agentId);
      if (a) agents.set(msg.agentId, { ...a, status: 'ready' });
      const event: AgentEvent = { type: 'COMPLETE', timestamp: Date.now(), agentId: msg.agentId, success: true };
      return {
        ...model,
        agents,
        agentEvents: appendAgentEvent(model.agentEvents, event),
        messages: model.messages.map(m => m.agentId === msg.agentId && m.streaming ? { ...m, streaming: false } : m),
        missionUi: { ...model.missionUi, currentAction: 'Agent ' + msg.agentId + ' completed its execution', activity: appendActivity(model.missionUi.activity, activity('Agent completed', 'success', msg.agentId, msg.agentId)) },
      };
    }

    case 'AGENT_ERROR': {
      const agents = new Map(model.agents);
      const a = agents.get(msg.agentId);
      if (a) agents.set(msg.agentId, { ...a, status: 'ready' });
      const event: AgentEvent = { type: 'ERROR', timestamp: Date.now(), agentId: msg.agentId, message: msg.error, recoverable: true };
      return {
        ...model,
        agents,
        agentEvents: appendAgentEvent(model.agentEvents, event),
        messages: [...model.messages.map(m => m.agentId === msg.agentId && m.streaming ? { ...m, streaming: false } : m), makeMsg({ type: 'error', agentId: msg.agentId, content: msg.error, timestamp: Date.now() })],
        missionUi: { ...model.missionUi, currentAction: 'Agent ' + msg.agentId + ' reported an error', activity: appendActivity(model.missionUi.activity, activity('Agent error', 'error', msg.error, msg.agentId)) },
      };
    }

    case 'AGENT_FALLBACK': {
      const event: AgentEvent = { type: 'MESSAGE', timestamp: Date.now(), agentId: msg.to, content: 'Fallback from ' + msg.from + ': ' + msg.reason };
      return {
        ...model,
        agentEvents: appendAgentEvent(model.agentEvents, event),
        messages: [...model.messages, makeMsg({ type: 'system', content: 'Fallback: ' + msg.from + ' → ' + msg.to + ' (' + msg.reason + ')', timestamp: Date.now() })],
        missionUi: { ...model.missionUi, currentAction: 'Recovered execution on ' + msg.to, activity: appendActivity(model.missionUi.activity, activity('Agent fallback', 'warning', msg.from + ' → ' + msg.to + ': ' + msg.reason)) },
      };
    }

    case 'CHANGES_COLLECTED': {
      const events = msg.files.map(file => ({ type: 'FILE_CHANGE', timestamp: Date.now(), agentId: file.agent, path: file.path, action: file.action } as AgentEvent));
      const taskId = model.missionData.selectedTaskId;
      const executionId = model.missionData.selectedExecutionId;
      const artifacts = msg.files.map((file, index) => ({
        id: 'artifact-' + String(Date.now()) + '-' + String(index),
        missionId: model.missionUi.id,
        taskId,
        executionId,
        path: file.path,
        kind: 'source' as const,
        action: file.action,
        agentId: file.agent,
        validation: 'unknown' as const,
        updatedAt: Date.now(),
      }));
      return { ...model, modifiedFiles: msg.files, agentEvents: events.reduce(appendAgentEvent, model.agentEvents), missionUi: { ...model.missionUi, currentAction: 'Reviewing ' + String(msg.files.length) + ' file change' + (msg.files.length === 1 ? '' : 's'), activity: appendActivity(model.missionUi.activity, activity('Files changed', 'info', String(msg.files.length) + ' files')) }, missionData: { ...model.missionData, artifacts: [...model.missionData.artifacts, ...artifacts] } };
    }

    case 'VALIDATION_STARTED': {
      const event: AgentEvent = { type: 'TEST', timestamp: Date.now(), agentId: 'validation', name: 'validation', status: 'running' };
      return { ...model, agentEvents: appendAgentEvent(model.agentEvents, event), missionUi: { ...model.missionUi, validation: 'running', currentAction: 'Validating mission output', activity: appendActivity(model.missionUi.activity, activity('Validation started', 'info')) }, messages: [...model.messages, makeMsg({ type: 'system', content: 'Validating changes…', timestamp: Date.now() })] };
    }

    case 'VALIDATION_PASSED': {
      const event: AgentEvent = { type: 'TEST', timestamp: Date.now(), agentId: 'validation', name: 'validation', status: 'passed' };
      return { ...model, agentEvents: appendAgentEvent(model.agentEvents, event), missionUi: { ...model.missionUi, validation: 'passed', currentAction: 'Validation passed', activity: appendActivity(model.missionUi.activity, activity('Validation passed', 'success')) }, missionData: { ...model.missionData, tasks: model.missionData.tasks.map(t => t.id === model.missionData.selectedTaskId ? { ...t, validation: 'passed' as const } : t), artifacts: model.missionData.artifacts.map(a => a.taskId === model.missionData.selectedTaskId ? { ...a, validation: 'passed' as const } : a) }, messages: [...model.messages, makeMsg({ type: 'system', content: '✓ Validation passed', timestamp: Date.now() })] };
    }

    case 'VALIDATION_FAILED': {
      const event: AgentEvent = { type: 'TEST', timestamp: Date.now(), agentId: 'validation', name: 'validation', status: 'failed' };
      return { ...model, agentEvents: appendAgentEvent(model.agentEvents, event), missionUi: { ...model.missionUi, validation: 'failed', currentAction: 'Validation failed', activity: appendActivity(model.missionUi.activity, activity('Validation failed', 'error', msg.errors.join('; '))) }, missionData: { ...model.missionData, tasks: model.missionData.tasks.map(t => t.id === model.missionData.selectedTaskId ? { ...t, validation: 'failed' as const } : t), artifacts: model.missionData.artifacts.map(a => a.taskId === model.missionData.selectedTaskId ? { ...a, validation: 'failed' as const } : a) }, messages: [...model.messages, makeMsg({ type: 'error', content: 'Validation failed: ' + msg.errors.join('; '), timestamp: Date.now() })] };
    }

    case 'CONFLICT_RESOLVED':
      return { ...model, missionUi: { ...model.missionUi, currentAction: 'Conflict resolved in ' + msg.path, activity: appendActivity(model.missionUi.activity, activity('Conflict resolved', 'success', msg.path + ' → ' + msg.winner)) }, messages: [...model.messages, makeMsg({ type: 'arbiter', content: msg.path + ' → ' + msg.winner + ' (' + msg.method + ')', timestamp: Date.now() })] };

    case 'TERMINAL_SPAWNED':
      return { ...model, terminals: [...model.terminals, msg.entry] };

    case 'TERMINAL_UPDATED':
      return { ...model, terminals: model.terminals.map(t => t.agentId === msg.agentId ? { ...t, lastLine: msg.lastLine, status: msg.status } : t) };

    case 'LOG':
      return { ...model, logs: [...model.logs, msg.text].slice(-1000) };

    case 'STATUS_TEXT':
      return { ...model, statusText: msg.text };

    default:
      return model;
  }
}
