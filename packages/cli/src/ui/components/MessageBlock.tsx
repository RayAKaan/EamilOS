/**
 * MessageBlock — plain text rendering, no borders
 */
import pkg from 'blessed';
const { box, text } = pkg;
import type { Message } from '../types/ui.js';

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' +
         String(d.getMinutes()).padStart(2, '0') + ':' +
         String(d.getSeconds()).padStart(2, '0');
}

export function trunc(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '>';
}

export function hRule(len: number): string {
  return '-'.repeat(Math.max(len - 2, 0));
}

export function getMsgHeight(msg: Message, width: number): number {
  const innerW = width - 4;
  const contentLen = msg.content?.length ?? 0;
  const lines = contentLen > 0 ? Math.ceil(contentLen / innerW) || 1 : 1;
  const toolLines = msg.tools?.length ?? 0;
  const streamLine = msg.isStreaming ? 1 : 0;

  switch (msg.type) {
    case 'user':     return 3 + lines;
    case 'opencode':
    case 'gemini':   return 3 + lines + toolLines + streamLine;
    case 'system':
    case 'error':    return 3 + lines;
    case 'graph-stats': return 8;
    default:         return 4;
  }
}

export function renderMessageBox(
  parent: ReturnType<typeof box>,
  msg: Message,
  width: number,
  yOffset: number = 0
): void {
  const innerW = width - 4;
  const time = fmtTime(msg.timestamp);
  const content = msg.content ?? '';
  const tools = msg.tools ?? [];

  switch (msg.type) {
    case 'user': {
      const b = box({ parent, top: yOffset, left: 0, width });
      text({ parent: b, top: 0, left: 0, content: ' YOU ' + hRule(width) + ' ' + time, fg: 'green', bold: true });
      text({ parent: b, top: 1, left: 0, content: ' ' + trunc(content, innerW), fg: 'white' });
      return;
    }
    case 'opencode':
    case 'gemini': {
      const color = msg.type === 'opencode' ? 'cyan' : 'magenta';
      const label = msg.type.toUpperCase();
      const b = box({ parent, top: yOffset, left: 0, width });
      text({ parent: b, top: 0, left: 0, content: ' ' + label + ' ' + hRule(width) + ' ' + time, fg: color, bold: true });
      let y = 1;
      if (content.trim()) {
        text({ parent: b, top: y++, left: 0, content: ' ' + trunc(content, innerW), fg: 'white', wrap: true });
      }
      for (const tool of tools) {
        const iconColor = tool.status === 'done' ? 'green' : tool.status === 'failed' ? 'red' : tool.status === 'running' ? 'yellow' : 'gray';
        const icon = tool.status === 'done' ? '[+]' : tool.status === 'failed' ? '[-]' : tool.status === 'running' ? '[~]' : '[ ]';
        text({ parent: b, top: y, left: 0, content: icon + ' ' + tool.name.padEnd(8) + trunc(tool.args, Math.max(innerW - 14, 10)), fg: iconColor });
        y++;
      }
      if (msg.isStreaming) {
        text({ parent: b, top: y++, left: 0, content: ' [.....] ' + msg.type + ' working...', fg: color });
      }
      return;
    }
    case 'system':
    case 'error': {
      const color = msg.type === 'error' ? 'red' : 'yellow';
      const b = box({ parent, top: yOffset, left: 0, width });
      text({ parent: b, top: 0, left: 0, content: ' SYS ' + hRule(width) + ' ' + time, fg: color, bold: true });
      text({ parent: b, top: 1, left: 0, content: ' ' + trunc(content, innerW), fg: 'white' });
      return;
    }
    case 'graph-stats': {
      let stats: Record<string, unknown> = {};
      try { stats = JSON.parse(msg.content); } catch { /* ignore */ }
      const dur = typeof stats.duration === 'string' ? stats.duration as string : String(((stats.duration as number) ?? 0) / 1000) + 's';
      const validated = (stats.validated as boolean) ? 'PASSED' : 'FAILED';
      const b = box({ parent, top: yOffset, left: 0, width });
      text({ parent: b, top: 0, left: 0, content: ' EXECUTION SUMMARY ' + hRule(width - 19), fg: 'blue', bold: true });
      text({ parent: b, top: 1, left: 0, content: '  Strategy:      ' + ((stats.strategy as string) ?? '?'), fg: 'white' });
      text({ parent: b, top: 2, left: 0, content: '  Duration:      ' + dur, fg: 'white' });
      text({ parent: b, top: 3, left: 0, content: '  Tools used:    ' + String((stats.toolsUsed as number) ?? 0), fg: 'white' });
      text({ parent: b, top: 4, left: 0, content: '  Graph nodes:   ' + String((stats.nodes as number) ?? 0), fg: 'white' });
      text({ parent: b, top: 5, left: 0, content: '  Graph edges:   ' + String((stats.edges as number) ?? 0), fg: 'white' });
      text({ parent: b, top: 6, left: 0, content: '  Result:        ' + validated, fg: (stats.validated as boolean) ? 'green' : 'red', bold: true });
      return;
    }
    default:
      return;
  }
}
