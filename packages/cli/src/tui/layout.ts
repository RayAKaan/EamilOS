// layout.ts — Computes all panel dimensions from terminal size.
// All components read from Layout; none compute their own geometry.

import type { AppModel } from './model.js';

export interface Layout {
  // Terminal
  width:          number;
  height:         number;

  // Feature flags
  showSidebar:    boolean;
  compact:        boolean;

  // Row positions
  statusBarRow:   number;   // row 0
  topSepRow:      number;   // row 1
  bodyTop:        number;   // row 2
  bodyHeight:     number;
  botSepRow:      number;
  inputRow:       number;   // prompt
  inputStatusRow: number;   // hints

  // Main content area
  mainLeft:       number;
  mainWidth:      number;
  mainTop:        number;
  mainHeight:     number;

  // Sidebar
  sidebarLeft:    number;
  sidebarWidth:   number;
  sidebarTop:     number;
  sidebarHeight:  number;

  // Divider column between main and sidebar
  dividerCol:     number;   // -1 if no sidebar

  // Viewport = rows available for message rendering
  viewportHeight: number;
}

// ── Constants ────────────────────────────────────────────────────────────────
export const SIDEBAR_WIDTH          = 34;  // visible chars including border
const        STATUS_BAR_HEIGHT      = 1;
const        TOP_SEP_HEIGHT         = 1;
const        BOT_SEP_HEIGHT         = 1;
const        INPUT_BAR_HEIGHT       = 2;   // prompt + hint row
const        MIN_HEIGHT             = 16;
const        MIN_WIDTH_FOR_SIDEBAR  = 96;

export function layoutFor(model: AppModel): Layout {
  const { width, height } = model;

  const compact     = height < MIN_HEIGHT;
  const showSidebar = model.sidebarVisible
    && width >= MIN_WIDTH_FOR_SIDEBAR
    && !compact;

  // ── Row positions ──────────────────────────────────────────────────────────
  const statusBarRow   = 0;
  const topSepRow      = statusBarRow + STATUS_BAR_HEIGHT;
  const bodyTop        = topSepRow + TOP_SEP_HEIGHT;
  const botSepRow      = height - INPUT_BAR_HEIGHT - BOT_SEP_HEIGHT;
  const inputRow       = height - INPUT_BAR_HEIGHT;
  const inputStatusRow = height - 1;
  const bodyHeight     = Math.max(0, botSepRow - bodyTop);

  // ── Column positions ───────────────────────────────────────────────────────
  const sidebarWidth  = showSidebar ? SIDEBAR_WIDTH : 0;
  const dividerWidth  = showSidebar ? 1 : 0;
  const dividerCol    = showSidebar ? width - sidebarWidth - dividerWidth : -1;

  const sidebarLeft   = showSidebar ? width - sidebarWidth : width;
  const sidebarTop    = bodyTop;
  const sidebarHeight = bodyHeight;

  const mainLeft   = 0;
  const mainWidth  = Math.max(0, width - sidebarWidth - dividerWidth);
  const mainTop    = bodyTop;
  const mainHeight = bodyHeight;

  return {
    width,
    height,
    showSidebar,
    compact,
    statusBarRow,
    topSepRow,
    bodyTop,
    bodyHeight,
    botSepRow,
    inputRow,
    inputStatusRow,
    mainLeft,
    mainWidth,
    mainTop,
    mainHeight,
    sidebarLeft,
    sidebarWidth,
    sidebarTop,
    sidebarHeight,
    dividerCol,
    viewportHeight: mainHeight,
  };
}
