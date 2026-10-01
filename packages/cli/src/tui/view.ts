import type { AppModel } from './model.js';
import { layoutFor } from './layout.js';
import { Frame } from './terminal/frame.js';
import { fit } from './terminal/text.js';
import { renderStatusBar } from './components/statusBar.js';
import { renderInputBar } from './components/inputBar.js';
import { renderChatView } from './components/chatView.js';
import { renderSidebar, sidebarDividerLines } from './components/sidebar.js';
import { renderLogsPage, renderAgentsPage } from './components/pages.js';
import { renderMissionHome, renderLiveExecution } from './screens/missionHome.js';
import { renderTasks, renderArtifacts, renderSessions, renderGitHub } from './screens/explorers.js';
import { renderFleet, renderGraph } from './screens/fleetGraph.js';
import { renderLoop, renderDecisions, renderApprovals } from './screens/loopDecisionApproval.js';
import { renderCommandPalette } from './screens/commandPalette.js';
import { projectMission } from './projection/mission.js';
import { renderMissionHud } from './components/missionHud.js';

export function buildFrame(model: AppModel): string {
  const layout = layoutFor(model);
  const frame = new Frame({ width: layout.width, height: layout.height });
  frame.push(renderStatusBar(model, layout));

  const hud = renderMissionHud(projectMission(model), layout);
  for (const line of hud) frame.push(fit(line, layout.width));

  let bodyLines: string[];
  switch (model.page) {
    case 'mission': bodyLines = renderMissionHome(model, layout); break;
    case 'execution': bodyLines = renderLiveExecution(model, layout); break;
    case 'tasks': bodyLines = renderTasks(model, layout); break;
    case 'artifacts': bodyLines = renderArtifacts(model, layout); break;
    case 'sessions': bodyLines = renderSessions(model, layout); break;
    case 'github': bodyLines = renderGitHub(model, layout); break;
    case 'fleet': bodyLines = renderFleet(model, layout); break;
    case 'graph': bodyLines = renderGraph(model, layout); break;
    case 'loop': bodyLines = renderLoop(model, layout); break;
    case 'decisions': bodyLines = renderDecisions(model, layout); break;
    case 'approvals': bodyLines = renderApprovals(model, layout); break;
    case 'chat': bodyLines = renderChatView(model, layout); break;
    case 'logs': bodyLines = renderLogsPage(model, layout); break;
    case 'agents': bodyLines = renderAgentsPage(model, layout); break;
  }

  if (layout.showSidebar) {
    const sidebarLines = renderSidebar(model, layout);
    const dividerLines = sidebarDividerLines(layout.sidebarHeight);
    for (let i = 0; i < layout.bodyHeight; i++) {
      const bodyLine = bodyLines[i] ?? fit('', layout.mainWidth);
      const divLine = dividerLines[i] ?? ' ';
      const sideLine = sidebarLines[i] ?? fit('', layout.sidebarWidth);
      frame.push(fit(bodyLine + divLine + sideLine, layout.width));
    }
  } else {
    for (let i = 0; i < layout.bodyHeight; i++) frame.push(fit(bodyLines[i] ?? '', layout.width));
  }

  if (model.commandPalette.open) {
    const palette = renderCommandPalette(model, layout);
    const start = layout.bodyTop;
    for (let i = 0; i < palette.length && start + i < layout.botSepRow; i++) frame.setLine(start + i, palette[i]!);
  }

  const [promptRow, statusRow] = renderInputBar(model, layout);
  frame.push(promptRow);
  frame.push(statusRow);
  return frame.finalize();
}
