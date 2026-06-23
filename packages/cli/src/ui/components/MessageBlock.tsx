import blessed from 'blessed';
import type { Message } from '../types/ui.js';

function trunc(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '>';
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

export function getMsgHeight(msg: Message, width: number): number {
  const innerW = width - 4;
  const contentLen = msg.content?.length ?? 0;
  const lines = contentLen > 0 ? Math.ceil(contentLen / Math.max(innerW, 1)) : 1;
  const toolLines = msg.tools?.length ?? 0;
  const streamLine = msg.isStreaming ? 1 : 0;

  switch (msg.type) {
    case 'user':
      return 3 + lines;
    case 'opencode':
    case 'gemini':
      return 3 + lines + toolLines + streamLine;
    case 'system':
    case 'error':
      return 3 + lines;
    case 'graph-stats':
      return 8;
    default:
      return 4;
  }
}

export function renderMessageBox(
  parent: blessed.Widgets.BoxElement,
  msg: Message,
  width: number,
  yOffset: number
): void {
  const innerW = width - 4;
  const colorMap: Record<string, blessed.Widgets.Color> = {
    user: 'green',
    opencode: 'cyan',
    gemini: 'magenta',
    system: 'yellow',
    error: 'red',
    thinking: 'gray',
    'graph-stats': 'blue',
  };

  const bgColor: blessed.Widgets.Color = (colorMap[msg.type] ?? 'white') as blessed.Widgets.Color;
  const label = msg.type === 'user' ? 'you' : msg.type;

  const box = blessed.box({
    parent,
    top: yOffset,
    left: 0,
    width,
    height: getMsgHeight(msg, width),
    border: { type: 'line' },
    style: { border: { fg: bgColor } },
  });

  // Header line
  const header = msg.type === 'user'
    ? ` ${label}  ──  ${formatTime(msg.timestamp)}`
    : ` ${label}  ────────────────────────────────────────────────────────────────────────  ${formatTime(msg.timestamp)}`;

  blessed.text({
    parent: box,
    top: 0,
    left: 0,
    content: trunc(header, width - 2),
    style: { fg: bgColor, bold: true },
  });

  // Content
  if (msg.content) {
    blessed.text({
      parent: box,
      top: 1,
      left: 1,
      width: innerW,
      content: msg.content,
      style: { fg: 'white' },
    });
  }

  // Streaming indicator
  if (msg.isStreaming) {
    const streamY = 1 + (msg.content ? Math.ceil(msg.content.length / Math.max(innerW, 1)) : 0);
    blessed.text({
      parent: box,
      top: streamY,
      left: 1,
      content: '  / / /  opencode working...',
      style: { fg: 'yellow' },
    });
  }

  // Tool calls
  if (msg.tools && msg.tools.length > 0) {
    const toolStartY = 1 + (msg.content ? Math.ceil(msg.content.length / Math.max(innerW, 1)) : 0) + (msg.isStreaming ? 1 : 0);
    msg.tools.forEach((tool, i) => {
      const statusIcon = tool.status === 'done' ? 'OK' : tool.status === 'running' ? '..' : tool.status === 'failed' ? '!!' : '__';
      const resultStr = tool.result ? trunc(tool.result, 40) : '';
      blessed.text({
        parent: box,
        top: toolStartY + i,
        left: 2,
        content: trunc(`  ${statusIcon}  ${tool.name}(${tool.args}) ${resultStr}`, width - 6),
        style: { fg: tool.status === 'failed' ? 'red' : 'gray' },
      });
    });
  }
}
