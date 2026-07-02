// pages.ts — Non-chat page renders. All painted with onChat() (BG.BLACK).

import type { AppModel } from '../model.js';
import type { Layout } from '../layout.js';
import { fit, truncate } from '../terminal/text.js';
import { styled, BOLD, DIM, FG } from '../terminal/ansi.js';
import { colourFor, onChat } from '../theme.js';

export function renderLogsPage(model: AppModel, layout: Layout): string[] {
  const { mainWidth, viewportHeight } = layout;
  const lines: string[] = [];

  if (model.logs.length === 0) {
    lines.push(onChat(fit(styled('  (no log entries)', DIM, FG.WHITE), mainWidth)));
  } else {
    const visible = model.logs.slice(-viewportHeight);
    for (const entry of visible) {
      lines.push(onChat(fit('  ' + styled(entry, DIM, FG.WHITE), mainWidth)));
    }
  }

  while (lines.length < viewportHeight) lines.push(onChat(fit('', mainWidth)));
  return lines.slice(0, viewportHeight);
}

export function renderAgentsPage(model: AppModel, layout: Layout): string[] {
  const { mainWidth, viewportHeight } = layout;
  const lines: string[] = [];

  const agents = Array.from(model.agents.values());

  if (model.detectionState === 'detecting') {
    lines.push(onChat(fit(styled('  detecting agents...', DIM, FG.YELLOW), mainWidth)));
  } else if (agents.length === 0) {
    lines.push(onChat(fit(styled('  no agents detected', DIM, FG.WHITE), mainWidth)));
  } else {
    for (const a of agents) {
      const dot  = a.status === 'ready' ? styled('●', FG.GREEN)
                 : a.status === 'busy'  ? styled('◈', FG.YELLOW)
                 :                        styled('◇', DIM, FG.WHITE);
      const clr  = colourFor(a.id);
      const name = styled(a.name, clr);
      const statusStr = a.status === 'ready' ? styled('ready', FG.GREEN)
                       : a.status === 'busy'  ? styled('busy', FG.YELLOW)
                       : styled(a.status, DIM, FG.WHITE);
      const callsignStr = a.callsign ? styled(a.callsign, DIM, FG.WHITE) : '';
      const verStr = a.version ? styled(` v${a.version}`, DIM, FG.WHITE) : '';
      lines.push(onChat(fit(`  ${dot} ${callsignStr} ${name}${verStr}  ${statusStr}`, mainWidth)));
      if (a.error) {
        lines.push(onChat(fit(`    ${styled(a.error, FG.RED)}`, mainWidth)));
      }
    }
  }

  while (lines.length < viewportHeight) lines.push(onChat(fit('', mainWidth)));
  return lines.slice(0, viewportHeight);
}

export function renderSessionsPage(model: AppModel, layout: Layout): string[] {
  const { mainWidth, viewportHeight } = layout;
  const lines: string[] = [];

  if (model.sessions.length === 0) {
    lines.push(onChat(fit(styled('  no sessions yet', DIM, FG.WHITE), mainWidth)));
  } else {
    for (const s of model.sessions.slice(-viewportHeight)) {
      const statusIcon = s.status === 'completed' ? styled('✓', FG.GREEN)
                        : s.status === 'failed' ? styled('✗', FG.RED)
                        : styled('●', FG.YELLOW);
      const goal = truncate(s.goal, mainWidth - 25);
      const strat = styled(s.strategy, DIM, FG.WHITE);
      const count = styled(`${s.messageCount} msgs`, DIM, FG.WHITE);
      const dur = s.duration ? styled(` ${(s.duration / 1000).toFixed(1)}s`, DIM, FG.WHITE) : '';
      lines.push(onChat(fit(`  ${statusIcon} ${goal}  ${strat}  ${count}${dur}`, mainWidth)));
    }
  }

  while (lines.length < viewportHeight) lines.push(onChat(fit('', mainWidth)));
  return lines.slice(0, viewportHeight);
}

export function renderTerminalsPage(model: AppModel, layout: Layout): string[] {
  const { mainWidth, viewportHeight } = layout;
  const lines: string[] = [];

  if (model.terminals.length === 0) {
    lines.push(onChat(fit(styled('  no active terminals', DIM, FG.WHITE), mainWidth)));
  } else {
    for (const t of model.terminals) {
      const statusIcon = t.status === 'running' ? styled('◐', FG.YELLOW)
                        : t.status === 'done' ? styled('●', FG.GREEN)
                        : t.status === 'error' ? styled('✗', FG.RED)
                        : styled('○', DIM, FG.WHITE);
      const callsign = styled(t.callsign, BOLD, FG.WHITE);
      const agentId = styled(t.agentId, DIM, FG.WHITE);
      const lastLine = t.lastLine ? ` ${styled(truncate(t.lastLine, mainWidth - 30), DIM, FG.WHITE)}` : '';
      lines.push(onChat(fit(`  ${statusIcon} ${callsign}  ${agentId}${lastLine}`, mainWidth)));
    }
  }

  while (lines.length < viewportHeight) lines.push(onChat(fit('', mainWidth)));
  return lines.slice(0, viewportHeight);
}
