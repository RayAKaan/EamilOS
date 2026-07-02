// sidebar.ts — Right panel. BG.BRIGHT_BLACK surface, same as status/input chrome.
// Section titles use a fractionally lighter feel via BOLD FG on the dark bg.
// No boxes. No rules. Background shade alone separates it from the chat area.

import type { AppModel, AgentEntry } from '../model.js';
import type { Layout }               from '../layout.js';
import { SIDEBAR_WIDTH }             from '../layout.js';
import { fit, truncate }             from '../terminal/text.js';
import { styled, BOLD, DIM, FG, BG, RESET } from '../terminal/ansi.js';
import { colourFor, DOT, onChrome } from '../theme.js';

const W = SIDEBAR_WIDTH;

// All sidebar lines painted with chrome background
function sl(content: string): string {
  return onChrome(fit(content, W));
}

function blank(): string {
  return sl('');
}

// Section title — bold white, no decoration, background does the work
function sectionTitle(title: string): string {
  return sl('  ' + styled(title, BOLD, FG.WHITE));
}

// Key-value row
function kv(k: string, v: string, keyW = 9): string {
  const label = styled(k.padEnd(keyW).slice(0, keyW), DIM, FG.BRIGHT_BLACK);
  const val   = truncate(v, W - keyW - 4);
  return sl('  ' + label + '  ' + val);
}

// ── Agent row ─────────────────────────────────────────────────────────────────
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

// ── Render ────────────────────────────────────────────────────────────────────
export function renderSidebar(model: AppModel, layout: Layout): string[] {
  const height = layout.sidebarHeight;
  const lines: string[] = [];

  // ── AGENTS ──────────────────────────────────────────────────────────────
  lines.push(blank());
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
    for (const a of agents.slice(0, 7)) lines.push(agentLine(a));
    if (agents.length > 7) {
      lines.push(sl(styled(`  +${agents.length - 7} more`, DIM, FG.BRIGHT_BLACK)));
    }
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
    for (const f of model.modifiedFiles.slice(0, 7)) {
      const icon = f.action === 'create' ? styled('+', BOLD, FG.GREEN)
                 : f.action === 'delete' ? styled('−', BOLD, FG.RED)
                 :                         styled('~', BOLD, FG.YELLOW);
      const path = styled(truncate(f.path, W - 6), DIM, FG.WHITE);
      lines.push(sl(`  ${icon}  ${path}`));
    }
    if (model.modifiedFiles.length > 7) {
      lines.push(sl(styled(`  +${model.modifiedFiles.length - 7} more`, DIM, FG.BRIGHT_BLACK)));
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

  // Fill remainder
  while (lines.length < height) lines.push(blank());
  return lines.slice(0, height);
}

// ── Divider ───────────────────────────────────────────────────────────────────
// One character wide. Sits between chat (BG.BLACK) and sidebar (BG.BRIGHT_BLACK).
// The colour contrast alone makes it feel like a border without drawing one.
export function sidebarDividerLines(height: number): string[] {
  // A space character with the chrome background — the bg colour contrast
  // between chat and sidebar IS the visual separator. No pipe needed.
  // But we keep a dim pipe for terminals where bg colours are identical.
  const ch = `${styled(' ', FG.BRIGHT_BLACK)}`;
  return Array.from({ length: height }, () => ch);
}
