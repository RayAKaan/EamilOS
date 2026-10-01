import type { ToolCall, TranscriptDensity } from '../model.js';
import { fit, truncate, sanitiseLine, visibleWidth } from '../terminal/text.js';
import { styled, BOLD, DIM, FG } from '../terminal/ansi.js';
import { onChat, spinAt } from '../theme.js';

export type ToolCardKind = 'terminal' | 'diff' | 'test' | 'approval' | 'read' | 'search' | 'generic';

export interface ToolCardDescriptor {
  kind: ToolCardKind;
  icon: string;
  label: string;
  title: string;
}

export function classifyTool(name: string): ToolCardDescriptor {
  const n = name.toLowerCase();
  if (/(terminal|bash|shell|exec|command|powershell|zsh|sh$)/.test(n)) return { kind: 'terminal', icon: '⌁', label: 'terminal', title: name };
  if (/(diff|edit|write|patch|apply|replace|create|delete|rename)/.test(n)) return { kind: 'diff', icon: '±', label: 'diff', title: name };
  if (/(test|pytest|vitest|jest|lint|typecheck|check)/.test(n)) return { kind: 'test', icon: '✓', label: 'test', title: name };
  if (/(approv|permission|authorize|confirm)/.test(n)) return { kind: 'approval', icon: '⚠', label: 'approval', title: name };
  if (/(search|grep|glob|find|ripgrep)/.test(n)) return { kind: 'search', icon: '⌕', label: 'search', title: name };
  if (/(read|file|cat|open|list|stat)/.test(n)) return { kind: 'read', icon: '▤', label: 'read', title: name };
  return { kind: 'generic', icon: '·', label: 'tool', title: name };
}

export function toolStatus(tool: ToolCall, spinFrame: number): { mark: string; colour: string; label: string } {
  if (tool.status === 'running') return { mark: spinAt(spinFrame), colour: FG.YELLOW, label: 'running' };
  if (tool.status === 'failed') return { mark: '✖', colour: FG.RED, label: 'failed' };
  if (tool.status === 'done') return { mark: '✓', colour: FG.GREEN, label: 'done' };
  return { mark: '○', colour: FG.BRIGHT_BLACK, label: 'pending' };
}

function shellLines(tool: ToolCall): string[] {
  const command = tool.args?.trim();
  const result = tool.result?.trim();
  return [
    ...(command ? ['$ ' + command] : []),
    ...(result ? result.split(/\r?\n/) : []),
  ];
}

function diffLines(tool: ToolCall): string[] {
  const raw = tool.result?.trim() || tool.args?.trim() || '';
  return raw.split(/\r?\n/).map(line => sanitiseLine(line));
}

function testLines(tool: ToolCall): string[] {
  const raw = tool.result?.trim() || tool.args?.trim() || '';
  return raw.split(/\r?\n/).map(line => sanitiseLine(line));
}

function approvalLines(tool: ToolCall): string[] {
  const raw = tool.result?.trim() || tool.args?.trim() || '';
  return raw.split(/\r?\n/).map(line => sanitiseLine(line));
}

function bodyFor(tool: ToolCall, kind: ToolCardKind): string[] {
  switch (kind) {
    case 'terminal': return shellLines(tool);
    case 'diff': return diffLines(tool);
    case 'test': return testLines(tool);
    case 'approval': return approvalLines(tool);
    default: return (tool.result ?? tool.args ?? '').split(/\r?\n/).map(line => sanitiseLine(line));
  }
}

function accent(kind: ToolCardKind): string {
  switch (kind) {
    case 'diff': return FG.CYAN;
    case 'test': return FG.GREEN;
    case 'approval': return FG.YELLOW;
    case 'terminal': return FG.BRIGHT_WHITE;
    case 'search': return FG.MAGENTA;
    case 'read': return FG.BRIGHT_BLACK;
    default: return FG.WHITE;
  }
}

function limitFor(density: TranscriptDensity): number {
  return density === 'expanded' ? 18 : 7;
}

function cardLine(prefix: string, content: string, suffix: string, width: number, colour = FG.WHITE): string {
  const inner = Math.max(8, width - 4);
  return onChat(fit(prefix + styled(truncate(content, inner), colour) + suffix, width));
}

function compactSummary(tool: ToolCall, descriptor: ToolCardDescriptor, width: number, spinFrame: number): string[] {
  const state = toolStatus(tool, spinFrame);
  const detail = descriptor.kind === 'terminal'
    ? (tool.args || tool.name)
    : descriptor.kind === 'test'
      ? (tool.result?.split(/\r?\n/).find(Boolean) || tool.name)
      : descriptor.title;
  return [
    onChat(fit(
      '  ' + styled(state.mark + ' ' + descriptor.icon, BOLD, state.colour) +
      ' ' + styled(descriptor.label + ' · ', DIM, accent(descriptor.kind)) +
      styled(truncate(detail, Math.max(8, width - 24)), FG.WHITE) +
      styled('  Ctrl+O', DIM, FG.BRIGHT_BLACK),
      width,
    )),
  ];
}

export function renderToolCard(tool: ToolCall, width: number, spinFrame: number, density: TranscriptDensity): string[] {
  if (density === 'hidden') return [];
  const descriptor = classifyTool(tool.name);
  const state = toolStatus(tool, spinFrame);

  if (density === 'normal' && (descriptor.kind === 'read' || descriptor.kind === 'search')) {
    return compactSummary(tool, descriptor, width, spinFrame);
  }

  const inner = Math.max(8, width - 4);
  const title = descriptor.kind === 'terminal' ? (tool.args || descriptor.title) : descriptor.title;
  const header = '  ┌─ ' +
    styled(state.mark + ' ' + descriptor.icon + ' ' + truncate(title, Math.max(8, inner - 10)), BOLD, state.colour) +
    ' ┐';

  const raw = bodyFor(tool, descriptor.kind);
  const limit = limitFor(density);
  const shown = raw.length > limit
    ? [...raw.slice(0, Math.ceil(limit / 2)), '… +' + String(raw.length - limit) + ' lines', ...raw.slice(-Math.floor(limit / 2))]
    : raw;

  const body = shown.map(line => {
    const clean = sanitiseLine(line, inner - 2);
    let colour = FG.WHITE;
    if (descriptor.kind === 'diff') {
      if (clean.startsWith('+') && !clean.startsWith('+++')) colour = FG.GREEN;
      else if (clean.startsWith('-') && !clean.startsWith('---')) colour = FG.RED;
      else if (clean.startsWith('@@')) colour = FG.CYAN;
    } else if (descriptor.kind === 'test') {
      if (/\b(pass|passed|ok|success)\b/i.test(clean)) colour = FG.GREEN;
      else if (/\b(fail|failed|error)\b/i.test(clean)) colour = FG.RED;
      else if (/\brunning|pending\b/i.test(clean)) colour = FG.YELLOW;
    } else if (descriptor.kind === 'approval') {
      colour = FG.YELLOW;
    }
    return cardLine('  │ ', clean, ' │', width, colour);
  });

  if (!body.length) {
    const placeholder = descriptor.kind === 'approval' ? 'Awaiting approval decision' :
      descriptor.kind === 'test' ? 'Waiting for test output' : descriptor.kind === 'diff' ? 'No diff output' : 'No output';
    body.push(cardLine('  │ ', placeholder, ' │', width, DIM));
  }

  const footer = state.label +
    (tool.lines !== undefined ? ' · ' + tool.lines + ' lines' : '') +
    (density === 'normal' && raw.length > limit ? ' · Ctrl+O for full output' : '');

  return [
    header,
    ...body,
    cardLine('  └─ ', footer, ' ─', width, state.colour),
  ];
}

export function renderToolGroup(tools: ToolCall[], width: number, spinFrame: number): string[] {
  if (!tools.length) return [];
  const kinds = [...new Set(tools.map(t => classifyTool(t.name).kind))];
  const names = tools.slice(0, 3).map(t => classifyTool(t.name).label).join(', ');
  const more = tools.length > 3 ? ' +' + String(tools.length - 3) : '';
  return [onChat(fit(
    '  ' + styled('↳ ', DIM, FG.BRIGHT_BLACK) +
    styled(String(tools.length) + ' read-only calls', BOLD, FG.WHITE) +
    styled('  ' + names + more + ' · ' + kinds.join('/') + ' · Ctrl+O to expand', DIM, FG.BRIGHT_BLACK),
    width,
  ))];
}
