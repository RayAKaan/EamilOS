import type { AppModel } from '../model.js';
import type { Layout } from '../layout.js';
import type { AgentEvent } from '../events/agent-event.js';
import { fit, truncate } from '../terminal/text.js';
import { BOLD, DIM, FG, styled } from '../terminal/ansi.js';
import { onChat } from '../theme.js';

function status(status: AppModel['missionUi']['status']): string {
  if (status === 'running') return styled('● RUNNING', BOLD, FG.GREEN);
  if (status === 'paused') return styled('Ⅱ PAUSED', BOLD, FG.YELLOW);
  if (status === 'completed') return styled('✓ COMPLETED', BOLD, FG.GREEN);
  if (status === 'failed') return styled('! FAILED', BOLD, FG.RED);
  if (status === 'cancelled') return styled('○ CANCELLED', DIM, FG.WHITE);
  return styled('○ READY', DIM, FG.WHITE);
}

function validation(status: AppModel['missionUi']['validation']): string {
  if (status === 'passed') return styled('✓ validation', FG.GREEN);
  if (status === 'failed') return styled('! validation', FG.RED);
  if (status === 'running') return styled('◌ validating', FG.YELLOW);
  return styled('— validation', DIM, FG.WHITE);
}

function progressBar(value: number, width: number): string {
  const n = Math.max(0, Math.min(100, value));
  const filled = Math.round(n * width / 100);
  return styled('█'.repeat(filled), FG.CYAN) + styled('░'.repeat(Math.max(0, width - filled)), DIM, FG.BRIGHT_BLACK);
}

function eventSummary(event: AgentEvent): { icon: string; text: string; color: string } {
  switch (event.type) {
    case 'MESSAGE': return { icon: '●', text: event.agentId + ' / ' + event.content.replace(/\s+/g, ' '), color: FG.CYAN };
    case 'THINKING': return { icon: '◌', text: event.agentId + ' / ' + (event.label ?? 'working'), color: FG.YELLOW };
    case 'TOOL_CALL': return { icon: '⚙', text: event.agentId + ' / ' + event.tool, color: FG.CYAN };
    case 'TOOL_RESULT': return { icon: event.success ? '✓' : '!', text: event.tool + ' / ' + (event.success ? 'completed' : 'failed'), color: event.success ? FG.GREEN : FG.RED };
    case 'FILE_CHANGE': return { icon: '✎', text: event.path + ' / ' + event.action, color: FG.YELLOW };
    case 'COMMAND': return { icon: '$', text: event.command, color: FG.CYAN };
    case 'TEST': return { icon: event.status === 'passed' ? '✓' : event.status === 'failed' ? '!' : '◌', text: event.name + ' / ' + event.status, color: event.status === 'passed' ? FG.GREEN : event.status === 'failed' ? FG.RED : FG.YELLOW };
    case 'APPROVAL': return { icon: '!', text: 'approval / ' + event.reason, color: FG.YELLOW };
    case 'ERROR': return { icon: '!', text: event.agentId + ' / ' + event.message, color: FG.RED };
    case 'COMPLETE': return { icon: event.success ? '✓' : '!', text: event.agentId + ' / ' + (event.success ? 'completed' : 'failed'), color: event.success ? FG.GREEN : FG.RED };
  }
}

export function renderMissionHome(model: AppModel, layout: Layout): string[] {
  const width = layout.mainWidth;
  const height = layout.viewportHeight;
  const m = model.missionUi;
  const lines: string[] = [];
  const add = (s: string) => lines.push(onChat(fit(s, width)));
  const title = truncate(m.title || 'No active mission', Math.max(10, width - 44));

  add('  ' + styled('EAMILOS', BOLD, FG.CYAN) + '   ' + title + '   ' + status(m.status) + '   ' + styled(String(m.progress) + '%', BOLD, FG.BRIGHT_WHITE) + '   ' + styled(m.cost ?? '—', FG.BRIGHT_WHITE));
  add('  ' + styled('─'.repeat(Math.max(0, width - 4)), DIM, FG.BRIGHT_BLACK));
  add('');
  add('  ' + styled('MISSION', BOLD, FG.WHITE));
  add('  ' + styled(m.objective || 'Start a mission from the prompt below.', FG.BRIGHT_WHITE));
  add('');
  add('  ' + styled('CURRENT ACTION', BOLD, FG.WHITE));
  add('  ' + styled('● ', FG.CYAN) + truncate(m.currentAction || 'Waiting for a mission.', width - 6));
  add('');
  add('  ' + styled('EXECUTION', BOLD, FG.WHITE));
  const taskIcon = m.status === 'completed' ? styled('✓', FG.GREEN) : m.status === 'failed' ? styled('!', FG.RED) : m.status === 'running' || m.status === 'paused' ? styled('→', FG.CYAN) : styled('○', DIM, FG.WHITE);
  add('  ' + taskIcon + ' ' + truncate(m.currentAction || 'Mission execution', width - 8));
  const barWidth = Math.max(8, Math.min(42, width - 12));
  add('  ' + progressBar(m.progress, barWidth) + ' ' + String(m.progress) + '%');
  add('');
  add('  ' + styled('LIVE ACTIVITY', BOLD, FG.WHITE));
  const recent = m.activity.slice(-4);
  if (recent.length === 0) {
    add('  ' + styled('No activity yet — start a mission from the prompt.', DIM, FG.WHITE));
  } else {
    for (const item of recent) {
      const icon = item.severity === 'success' ? styled('✓', FG.GREEN) : item.severity === 'error' ? styled('!', FG.RED) : item.severity === 'warning' ? styled('!', FG.YELLOW) : styled('●', FG.CYAN);
      add('  ' + icon + ' ' + truncate(item.title + (item.detail ? ' / ' + item.detail : ''), width - 8));
    }
  }
  add('');
  add('  ' + styled('● ' + String(Array.from(model.agents.values()).filter(a => a.status === 'busy').length) + ' agents', FG.GREEN) + '   ' + styled('● ' + (m.deviceCount == null ? '—' : String(m.deviceCount)) + ' devices', FG.CYAN) + '   ' + (m.pendingApprovals ? styled('! ' + String(m.pendingApprovals) + ' approval', FG.YELLOW) : styled('✓ no approvals', DIM, FG.WHITE)) + '   ' + validation(m.validation));
  add('');
  add('  ' + styled('M', BOLD, FG.CYAN) + ' Mission   ' + styled('X', BOLD, FG.CYAN) + ' Live execution   ' + styled('↑↓', BOLD, FG.WHITE) + ' activity   ' + styled('Enter', BOLD, FG.WHITE) + ' prompt');

  while (lines.length < height) add('');
  return lines.slice(0, height);
}

export function renderLiveExecution(model: AppModel, layout: Layout): string[] {
  const width = layout.mainWidth;
  const height = layout.viewportHeight;
  const lines: string[] = [];
  const events = model.agentEvents;
  const add = (s: string) => lines.push(onChat(fit(s, width)));

  add('  ' + styled('LIVE EXECUTION', BOLD, FG.CYAN) + '   ' + (model.activityFollow ? styled('● AUTO FOLLOW', FG.GREEN) : styled('○ MANUAL SCROLL', FG.YELLOW)) + '   ' + styled(String(events.length) + ' events', DIM, FG.WHITE));
  add('  ' + styled('─'.repeat(Math.max(0, width - 4)), DIM, FG.BRIGHT_BLACK));

  const viewport = Math.max(1, height - 6);
  const maxScroll = Math.max(0, events.length - viewport);
  const scroll = Math.min(model.activityScroll, maxScroll);
  const end = model.activityFollow ? events.length : Math.max(0, events.length - scroll);
  const start = Math.max(0, end - viewport);
  const visible = events.slice(start, end);

  if (visible.length === 0) add('  ' + styled('Waiting for execution events…', DIM, FG.WHITE));
  for (const event of visible) {
    const item = eventSummary(event);
    add('  ' + styled(item.icon, item.color) + ' ' + truncate(item.text, width - 8));
  }
  while (lines.length < height - 3) add('');
  add('  ' + styled('↑↓', BOLD, FG.WHITE) + ' scroll   ' + styled('F', BOLD, FG.CYAN) + ' follow live   ' + styled('M', BOLD, FG.CYAN) + ' mission');
  add('  ' + styled('Structured events only — hidden chain-of-thought is never rendered.', DIM, FG.WHITE));
  while (lines.length < height) add('');
  return lines.slice(0, height);
}
