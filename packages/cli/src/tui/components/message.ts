// Message renderer. Tool presentation is delegated to specialized tool cards.
import type { Message, TranscriptDensity, ToolCall } from '../model.js';
import { fit, truncate, wrapPlain, sanitiseLine, visibleWidth } from '../terminal/text.js';
import { styled, BOLD, DIM, FG } from '../terminal/ansi.js';
import { colourFor, spinAt, onChat } from '../theme.js';
import { renderToolCard, renderToolGroup, classifyTool } from './toolCards.js';

function ts(t: number): string {
  const d = new Date(t);
  return styled(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`, DIM, FG.BRIGHT_BLACK);
}

function sectionHeader(label: string, colour: string, timestamp: number, width: number): string {
  const tsStr = ts(timestamp);
  const tsW = 10;
  const arrow = styled('▸ ', DIM, FG.BRIGHT_BLACK);
  const lbl = styled(label, BOLD, colour);
  const lblW = visibleWidth('▸ ' + label + ' ');
  const ruleW = Math.max(1, width - lblW - tsW);
  const rule = styled('─'.repeat(ruleW), DIM, FG.BRIGHT_BLACK);
  return onChat(fit(arrow + lbl + ' ' + rule + ' ' + tsStr, width));
}

export function renderUserMsg(msg: Message, width: number): string[] {
  const body = wrapPlain(msg.content, Math.max(0, width - 2)).map(l => onChat(fit('  ' + styled(sanitiseLine(l, width), FG.BRIGHT_YELLOW), width)));
  return [sectionHeader('you', FG.BRIGHT_YELLOW, msg.timestamp, width), ...body, onChat(fit('', width))];
}

export function renderAgentMsg(msg: Message, width: number, spinFrame: number, density: TranscriptDensity = 'normal'): string[] {
  const agentId = msg.agentId ?? 'agent';
  const lines: string[] = [sectionHeader(msg.callsign ? msg.callsign + ' · ' + agentId : agentId, colourFor(agentId), msg.timestamp, width)];
  if (msg.content.trim()) {
    for (const l of wrapPlain(msg.content, Math.max(0, width - 2))) {
      if (/\[.*\]\(http/.test(l)) continue;
      lines.push(onChat(fit('  ' + styled(sanitiseLine(l, width), FG.WHITE), width)));
    }
  }
  if (density !== 'hidden') {
    let i = 0;
    while (i < msg.tools.length) {
      const descriptor = classifyTool(msg.tools[i]!.name);
      if (density === 'normal' && (descriptor.kind === 'read' || descriptor.kind === 'search')) {
        const group: ToolCall[] = [];
        while (i < msg.tools.length) {
          const d = classifyTool(msg.tools[i]!.name);
          if (d.kind !== 'read' && d.kind !== 'search') break;
          group.push(msg.tools[i++]!);
        }
        if (group.length > 1) lines.push(...renderToolGroup(group, width, spinFrame));
        else lines.push(...renderToolCard(group[0]!, width, spinFrame, density));
      } else {
        lines.push(...renderToolCard(msg.tools[i]!, width, spinFrame, density));
        i++;
      }
    }
  }
  if (msg.streaming) {
    lines.push(onChat(fit('  ' + styled(spinAt(spinFrame), colourFor(agentId)) + ' ' + styled('streaming…', DIM, FG.BRIGHT_BLACK), width)));
  }
  lines.push(onChat(fit('', width)));
  return lines;
}

export function renderSystemMsg(msg: Message, width: number): string[] {
  return [onChat(fit('  ' + styled('sys', DIM, FG.BRIGHT_BLACK) + '  ' + styled(sanitiseLine(msg.content, width - 8), DIM, FG.WHITE), width)), onChat(fit('', width))];
}

export function renderErrorMsg(msg: Message, width: number): string[] {
  return [...wrapPlain(msg.content, Math.max(0, width - 6)).map((l, i) => onChat(fit('  ' + (i === 0 ? styled('✖ ', BOLD, FG.RED) : '  ') + styled(sanitiseLine(l, width), FG.RED), width))), onChat(fit('', width))];
}

export function renderArbiterMsg(msg: Message, width: number): string[] {
  return [onChat(fit('  ' + styled('⊕', FG.MAGENTA) + styled('  arbiter  ', DIM, FG.BRIGHT_BLACK) + styled(sanitiseLine(msg.content, width), FG.MAGENTA), width)), onChat(fit('', width))];
}

export function renderRunSummary(msg: Message, width: number): string[] {
  interface Summary { strategy: string; agentUsed: string; durationMs: number; fileCount: number; validated: boolean; errors: string[]; }
  let s: Summary = { strategy: '?', agentUsed: '?', durationMs: 0, fileCount: 0, validated: false, errors: [] };
  try { s = JSON.parse(msg.content) as Summary; } catch {}
  const header = sectionHeader('run complete', FG.CYAN, msg.timestamp, width);
  const kv = (k: string, v: string) => onChat(fit('  ' + styled(k.padEnd(11), DIM, FG.BRIGHT_BLACK) + v, width));
  const rows = [
    kv('strategy', styled(s.strategy, FG.CYAN)),
    kv('agent', styled(s.agentUsed ?? '—', FG.BRIGHT_WHITE)),
    kv('duration', styled(`${(s.durationMs / 1000).toFixed(1)}s`, FG.BRIGHT_WHITE)),
    kv('files', styled(String(s.fileCount), FG.BRIGHT_WHITE)),
    kv('result', s.validated ? styled('✔  validated', BOLD, FG.GREEN) : styled('✖  failed', BOLD, FG.RED)),
  ];
  if (s.errors.length) {
    rows.push(kv('errors', styled(String(s.errors.length), FG.RED)));
    for (const e of s.errors.slice(0, 3)) rows.push(onChat(fit('    ' + styled(e.slice(0, width - 6), FG.RED), width)));
  }
  return [header, ...rows, onChat(fit('', width))];
}

export function renderMessage(msg: Message, width: number, spinFrame: number, density: TranscriptDensity = 'normal'): string[] {
  switch (msg.type) {
    case 'user': return renderUserMsg(msg, width);
    case 'agent': return renderAgentMsg(msg, width, spinFrame, density);
    case 'system': return renderSystemMsg(msg, width);
    case 'error': return renderErrorMsg(msg, width);
    case 'arbiter': return renderArbiterMsg(msg, width);
    case 'run_summary': return renderRunSummary(msg, width);
    default: return [];
  }
}
