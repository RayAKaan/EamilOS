// chatView.ts — Chat area. BG.BLACK — the darkest surface, content recedes into it.
// Welcome screen: no boxes, background contrast carries all structure.

import type { AppModel } from '../model.js';
import type { Layout }   from '../layout.js';
import { renderMessage }  from './message.js';
import { fit, centre }    from '../terminal/text.js';
import { styled, BOLD, DIM, FG, BG, RESET } from '../terminal/ansi.js';
import { spinAt, onChat } from '../theme.js';

// ── Welcome ───────────────────────────────────────────────────────────────────
function buildWelcomeLines(
  model: AppModel,
  width: number,
  height: number,
): string[] {
  const lines: string[] = [];

  const topPad = Math.max(2, Math.floor(height / 2) - 6);
  for (let i = 0; i < topPad; i++) lines.push(onChat(fit('', width)));

  // Title
  lines.push(onChat(fit(
    centre(styled('EamilOS', BOLD, FG.CYAN), width),
    width,
  )));
  lines.push(onChat(fit('', width)));

  // Tagline
  lines.push(onChat(fit(
    centre(styled('multi-agent AI execution kernel', DIM, FG.WHITE), width),
    width,
  )));
  lines.push(onChat(fit('', width)));
  lines.push(onChat(fit('', width)));

  // Agent status
  if (model.detectionState === 'detecting') {
    lines.push(onChat(fit(
      centre(
        styled(spinAt(model.spinFrame), FG.YELLOW)
        + '  ' + styled('detecting agents…', DIM, FG.YELLOW),
        width,
      ),
      width,
    )));
  } else {
    const ready: string[] = [];
    for (const a of model.agents.values()) {
      if (a.status === 'ready') ready.push(a.callsign || a.id);
    }

    if (ready.length > 0) {
      lines.push(onChat(fit(
        centre(
          styled('●  ', FG.GREEN)
          + styled(`${ready.length} ready`, DIM, FG.WHITE)
          + styled('  ' + ready.join('  '), FG.GREEN),
          width,
        ),
        width,
      )));
    } else if (model.detectionState === 'complete') {
      lines.push(onChat(fit(
        centre(styled('no agents detected  —  install a CLI agent', DIM, FG.YELLOW), width),
        width,
      )));
    } else {
      lines.push(onChat(fit(centre(styled('—', DIM, FG.BRIGHT_BLACK), width), width)));
    }
  }

  lines.push(onChat(fit('', width)));
  lines.push(onChat(fit('', width)));

  // CTA
  lines.push(onChat(fit(
    centre(
      styled('type a goal and press ', DIM, FG.BRIGHT_BLACK)
      + styled('Enter', BOLD, FG.BRIGHT_WHITE),
      width,
    ),
    width,
  )));
  lines.push(onChat(fit('', width)));

  // Hints
  const hint = (k: string, l: string) =>
    styled(k, BOLD, FG.BRIGHT_WHITE)
    + styled('  ' + l, DIM, FG.BRIGHT_BLACK);
  const dot = styled('    ·    ', DIM, FG.BRIGHT_BLACK);

  lines.push(onChat(fit(
    centre(
      hint('1 – 5', 'switch page')
      + dot + hint('Ctrl+S', 'sidebar')
      + dot + hint('Ctrl+L', 'clear'),
      width,
    ),
    width,
  )));

  return lines;
}

// ── Scroll nudge ──────────────────────────────────────────────────────────────
function scrollNudge(linesAbove: number, width: number): string {
  return onChat(fit(
    centre(
      styled(`↑  ${linesAbove} line${linesAbove !== 1 ? 's' : ''} above`, DIM, FG.BRIGHT_BLACK),
      width,
    ),
    width,
  ));
}

// ── Viewport ──────────────────────────────────────────────────────────────────
export function renderChatView(model: AppModel, layout: Layout): string[] {
  const { mainWidth: width, viewportHeight: viewH } = layout;

  if (model.messages.length === 0) {
    const wl = buildWelcomeLines(model, width, viewH);
    while (wl.length < viewH) wl.push(onChat(fit('', width)));
    return wl.slice(0, viewH);
  }

  const allLines: string[] = [];
  for (const msg of model.messages) {
    allLines.push(...renderMessage(msg, width, model.spinFrame));
  }

  const total     = allLines.length;
  const maxScroll = Math.max(0, total - viewH);
  const scroll    = Math.min(model.scroll, maxScroll);
  const end       = total - scroll;
  const start     = Math.max(0, end - viewH);
  const slice     = allLines.slice(start, end);

  const result: string[] = [];
  const padTop = viewH - slice.length;
  for (let i = 0; i < padTop; i++) result.push(onChat(fit('', width)));
  result.push(...slice);

  if (scroll > 0 && result.length > 0) {
    result[0] = scrollNudge(scroll, width);
  }

  while (result.length < viewH) result.push(onChat(fit('', width)));
  return result.slice(0, viewH);
}
