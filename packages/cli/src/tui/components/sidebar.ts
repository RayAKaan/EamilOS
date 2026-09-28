// sidebar.ts — Right panel. Mission-first context: mission, agents, terminals, run.
// Surface shading (not a heavy border) separates it from the main viewport.

import type { AppModel, AgentEntry, TerminalEntry, MissionStatus } from '../model.js';
import type { Layout }               from '../layout.js';
import { SIDEBAR_WIDTH }             from '../layout.js';
import { fit, truncate }             from '../terminal/text.js';
import { styled, BOLD, DIM, FG, BG, RESET } from '../terminal/ansi.js';
import { colourFor, DOT, onPanel } from '../theme.js';

const W = SIDEBAR_WIDTH;

function sl(content: string): string {
  return onPanel(fit(content, W));
}

function blank(): string {
  return sl('');
}

function sectionTitle(title: string): string {
  return sl('  ' + styled(title, BOLD, FG.WHITE));
}

function kv(k: string, v: string, keyW = 9): string {
  const label = styled(k.padEnd(keyW).slice(0, keyW), DIM, FG.BRIGHT_BLACK);
  const val   = truncate(v, W - keyW - 4);
  return sl('  ' + label + '  ' + val);
}

function statusColour(status: MissionStatus): string {
  switch (status) {
    case 'running':   return FG.GREEN;
    case 'paused':    return FG.YELLOW;
    case 'failed':    return FG.RED;
    case 'completed': return FG.CYAN;
    case 'cancelled': return DIM + FG.BRIGHT_BLACK;
    default:          return FG.WHITE;
  }
}

function statusDot(status: MissionStatus): string {
  switch (status) {
    case 'running':   return styled('●', FG.GREEN);
    case 'paused':    return styled('◌', FG.YELLOW);
    case 'failed':    return styled('✖', FG.RED);
    case 'completed': return styled('✓', FG.CYAN);
    case 'cancelled': return styled('○', DIM, FG.BRIGHT_BLACK);
    default:          return styled('○', DIM, FG.WHITE);
  }
}

function agentLine(a: AgentEntry): string {
  const dot = a.status === 'ready'         ? DOT.ready
            : a.status === 'busy'          ? DOT.busy
            : a.status === 'not_installed' ? DOT.absent
            :                               DOT.offline;

  const colour = colourFor(a.id);
  const cs     = a.callsign
    ? styled(a.callsign.slice(0, 5).padEnd(5), colour)
    : styled('     ', DIM, FG.BRIGHT_BLACK);
  const name   = styled(truncate(a.id, 12).padEnd(12), DIM, FG.WHITE);
  const stat   = a.status === 'ready'         ? styled('ready',  FG.GREEN)
               : a.status === 'busy'          ? styled('busy',   FG.YELLOW)
               : a.status === 'not_installed' ? styled('absent', DIM, FG.BRIGHT_BLACK)
               :                               styled('off',    DIM, FG.BRIGHT_BLACK);

  return sl(`  ${dot} ${cs}  ${name}  ${stat}`);
}

function terminalLine(t: TerminalEntry): string {
  const dot = t.status === 'running' ? styled('◐', FG.YELLOW)
            : t.status === 'done'    ? styled('●', FG.GREEN)
            : t.status === 'error'   ? styled('✖', FG.RED)
            :                          styled('○', DIM, FG.WHITE);
  const cs   = styled(t.callsign.padEnd(5), colourFor(t.agentId));
  const tail = t.lastLine ? styled(' ' + truncate(t.lastLine, W - 18), DIM, FG.BRIGHT_BLACK) : '';
  return sl(`  ${dot} ${cs}  ${truncate(t.agentId, W - 12)}${tail}`);
}

export function renderSidebar(model: AppModel, layout: Layout): string[] {
  const height = layout.sidebarHeight;
  const lines: string[] = [];

  // ── MISSION ────────────────────────────────────────────────────────────
  const m = model.missionUi;
  const hasMission = Boolean(m && m.id);
  lines.push(blank());
  lines.push(sectionTitle('MISSION'));
  lines.push(blank());

  if (hasMission) {
    lines.push(sl(`  ${statusDot(m.status)} ${styled(m.status.toUpperCase(), BOLD, statusColour(m.status))}`));
    lines.push(sl('  ' + styled(truncate(m.title || m.objective || m.id, W - 4), FG.BRIGHT_WHITE)));
    lines.push(blank());
    lines.push(kv('progress', `${Math.round(m.progress)}%`));
    if (m.currentAction) {
      lines.push(kv('action', styled(truncate(m.currentAction, W - 14), FG.YELLOW)));
    }
    lines.push(kv('valid', m.validation));
    if (m.pendingApprovals > 0) {
      lines.push(kv('approvals', styled(String(m.pendingApprovals), FG.YELLOW)));
    }
    if (m.cost) lines.push(kv('cost', m.cost));
    if (m.deviceCount !== null) lines.push(kv('devices', String(m.deviceCount)));
  } else {
    lines.push(sl(styled('  no active mission', DIM, FG.BRIGHT_BLACK)));
    lines.push(sl(styled('  M mission · X execution', DIM, FG.BRIGHT_BLACK)));
  }

  lines.push(blank());
  lines.push(blank());

  // ── AGENTS ──────────────────────────────────────────────────────────────
  lines.push(sectionTitle('AGENTS'));
  lines.push(blank());

  const agents = Array.from(model.agents.values());
  if (agents.length === 0) {
    if (model.detectionState === 'detecting') {
      lines.push(sl(styled('  detecting…', DIM, FG.YELLOW)));
    } else {
      lines.push(sl(styled('  none detected', DIM, FG.BRIGHT_BLACK)));
    }
  } else {
    for (const a of agents.slice(0, 6)) lines.push(agentLine(a));
    if (agents.length > 6) {
      lines.push(sl(styled(`  +${agents.length - 6} more`, DIM, FG.BRIGHT_BLACK)));
    }
  }

  // ── TERMINALS (only when the runtime spawned panes) ─────────────────────
  if (model.terminals.length > 0) {
    lines.push(blank());
    lines.push(sectionTitle('TERMINALS'));
    lines.push(blank());
    for (const t of model.terminals.slice(0, 4)) lines.push(terminalLine(t));
  }

  lines.push(blank());
  lines.push(blank());

  // ── STRATEGY ────────────────────────────────────────────────────────────
  lines.push(sectionTitle('STRATEGY'));
  lines.push(blank());
  lines.push(kv('mode',  styled(model.mode,     FG.CYAN)));
  lines.push(kv('strat', styled(model.strategy, FG.CYAN)));

  lines.push(blank());
  lines.push(blank());

  // ── CHANGES ─────────────────────────────────────────────────────────────
  lines.push(sectionTitle('CHANGES'));
  lines.push(blank());

  if (model.modifiedFiles.length === 0) {
    lines.push(sl(styled('  —', DIM, FG.BRIGHT_BLACK)));
  } else {
    for (const f of model.modifiedFiles.slice(0, 5)) {
      const icon = f.action === 'create' ? styled('+', BOLD, FG.GREEN)
                 : f.action === 'delete' ? styled('−', BOLD, FG.RED)
                 :                         styled('~', BOLD, FG.YELLOW);
      const path = styled(truncate(f.path, W - 6), DIM, FG.WHITE);
      lines.push(sl(`  ${icon}  ${path}`));
    }
    if (model.modifiedFiles.length > 5) {
      lines.push(sl(styled(`  +${model.modifiedFiles.length - 5} more`, DIM, FG.BRIGHT_BLACK)));
    }
  }

  lines.push(blank());
  lines.push(blank());

  // ── RUN ─────────────────────────────────────────────────────────────────
  lines.push(sectionTitle('RUN'));
  lines.push(blank());

  if (model.runSummary) {
    const s = model.runSummary;
    lines.push(kv('result',
      s.validated
        ? styled('✔  ok',   BOLD, FG.GREEN)
        : styled('✖  fail', BOLD, FG.RED),
    ));
    lines.push(kv('agent',
      styled(s.agentUsed ?? '—', FG.BRIGHT_WHITE),
    ));
    lines.push(kv('time',
      styled(`${(s.durationMs / 1000).toFixed(1)}s`, FG.BRIGHT_WHITE),
    ));
    lines.push(kv('files',
      styled(String(s.fileCount), FG.BRIGHT_WHITE),
    ));
    if (s.errors.length > 0) {
      lines.push(kv('errors', styled(String(s.errors.length), FG.RED)));
    }
  } else {
    lines.push(sl(styled('  no run yet', DIM, FG.BRIGHT_BLACK)));
  }

  while (lines.length < height) lines.push(blank());
  return lines.slice(0, height);
}

// One character wide. Sits between the main viewport and the sidebar. The
// surface fill difference does the separating; on terminals without fills the
// cell stays blank so no stray grey column appears.
export function sidebarDividerLines(height: number): string[] {
  return Array.from({ length: height }, () => ' ');
}
