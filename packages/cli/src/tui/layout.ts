import type { AppModel } from './model.js';

export type LayoutTier = 'ultra-small' | 'standard' | 'large' | 'huge';

export interface Layout {
  width: number;
  height: number;
  tier: LayoutTier;
  showSidebar: boolean;
  compact: boolean;
  activityPane: boolean;
  hudHeight: number;

  statusBarRow: number;
  topSepRow: number;
  hudTop: number;
  bodyTop: number;
  bodyHeight: number;
  botSepRow: number;
  inputRow: number;
  inputStatusRow: number;

  mainLeft: number;
  mainWidth: number;
  mainTop: number;
  mainHeight: number;

  sidebarLeft: number;
  sidebarWidth: number;
  sidebarTop: number;
  sidebarHeight: number;
  dividerCol: number;
  viewportHeight: number;
}

export const SIDEBAR_WIDTH = 34;
const STATUS_BAR_HEIGHT = 1;
const TOP_SEP_HEIGHT = 1;
const BOT_SEP_HEIGHT = 1;
const INPUT_BAR_HEIGHT = 2;
const MIN_HEIGHT = 16;
const MIN_WIDTH_FOR_SIDEBAR = 120;
const MIN_WIDTH_FOR_ACTIVITY = 160;

function tierFor(width: number, height: number): LayoutTier {
  if (width < 80 || height < MIN_HEIGHT) return 'ultra-small';
  if (width < 120 || height < 24) return 'standard';
  if (width < 160) return 'large';
  return 'huge';
}

export function layoutFor(model: AppModel): Layout {
  const { width, height } = model;
  const tier = tierFor(width, height);
  const compact = tier === 'ultra-small';
  const showSidebar = model.sidebarVisible && width >= MIN_WIDTH_FOR_SIDEBAR && !compact;
  const activityPane = width >= MIN_WIDTH_FOR_ACTIVITY && !compact;
  const hudHeight = compact ? 2 : 4;

  const statusBarRow = 0;
  const topSepRow = statusBarRow + STATUS_BAR_HEIGHT;
  const hudTop = topSepRow + TOP_SEP_HEIGHT;
  const bodyTop = hudTop + hudHeight;
  const botSepRow = Math.max(bodyTop, height - INPUT_BAR_HEIGHT - BOT_SEP_HEIGHT);
  const inputRow = Math.max(0, height - INPUT_BAR_HEIGHT);
  const inputStatusRow = Math.max(0, height - 1);
  const bodyHeight = Math.max(0, botSepRow - bodyTop);

  const sidebarWidth = showSidebar ? SIDEBAR_WIDTH : 0;
  const dividerWidth = showSidebar ? 1 : 0;
  const dividerCol = showSidebar ? width - sidebarWidth - dividerWidth : -1;
  const sidebarLeft = showSidebar ? width - sidebarWidth : width;
  const sidebarTop = bodyTop;
  const sidebarHeight = bodyHeight;
  const mainLeft = 0;
  const mainWidth = Math.max(0, width - sidebarWidth - dividerWidth);
  const mainTop = bodyTop;
  const mainHeight = bodyHeight;

  return {
    width, height, tier, showSidebar, compact, activityPane, hudHeight,
    statusBarRow, topSepRow, hudTop, bodyTop, bodyHeight, botSepRow, inputRow, inputStatusRow,
    mainLeft, mainWidth, mainTop, mainHeight,
    sidebarLeft, sidebarWidth, sidebarTop, sidebarHeight, dividerCol,
    viewportHeight: mainHeight,
  };
}
