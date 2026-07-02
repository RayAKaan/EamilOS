import type { AppModel } from './model.js';
import { layoutFor, Layout } from './layout.js';
import { Frame } from './terminal/frame.js';
import { fit, splitLine } from './terminal/text.js';
import { styled, BOLD, DIM, FG } from './terminal/ansi.js';
import { renderStatusBar } from './components/statusBar.js';
import { renderInputBar } from './components/inputBar.js';
import { renderChatView } from './components/chatView.js';
import { renderSidebar, sidebarDividerLines } from './components/sidebar.js';
import { renderLogsPage, renderAgentsPage, renderSessionsPage, renderTerminalsPage } from './components/pages.js';

export function buildFrame(model: AppModel): string {
  const layout = layoutFor(model);

  const frame = new Frame({ width: layout.width, height: layout.height });

  frame.push(renderStatusBar(model, layout));

  let bodyLines: string[] = [];

  switch (model.page) {
    case 'chat':
      bodyLines = renderChatView(model, layout);
      break;
    case 'logs':
      bodyLines = renderLogsPage(model, layout);
      break;
    case 'agents':
      bodyLines = renderAgentsPage(model, layout);
      break;
    case 'sessions':
      bodyLines = renderSessionsPage(model, layout);
      break;
    case 'terminals':
      bodyLines = renderTerminalsPage(model, layout);
      break;
  }

  if (layout.showSidebar) {
    const sidebarLines = renderSidebar(model, layout);
    const dividerLines = sidebarDividerLines(layout.sidebarHeight);

    for (let i = 0; i < layout.bodyHeight; i++) {
      const bodyLine = bodyLines[i] ?? fit('', layout.mainWidth);
      const divLine = dividerLines[i] ?? styled(' ', FG.BRIGHT_BLACK);
      const sideLine = sidebarLines[i] ?? fit('', layout.sidebarWidth);
      const combined = fit(
        bodyLine + divLine + sideLine,
        layout.width
      );
      frame.push(combined);
    }
  } else {
    for (const line of bodyLines) {
      frame.push(line);
    }
  }

  const [promptRow, statusRow] = renderInputBar(model, layout);
  frame.push(promptRow);
  frame.push(statusRow);

  return frame.finalize();
}
