interface LayoutConfig {
  width: number;
  height: number;
  canShowSidebar: boolean;
  contentWidth: number;
  contentHeight: number;
  header: { width: number; height: number };
  footer: { width: number; height: number };
}

const LAYOUT = {
  header: { height: 1, minWidth: 60 },
  footer: { height: 1, minWidth: 60 },
  sidebar: { width: 35, minWidthForSidebar: 80 },
  content: { minWidth: 50 },
};

export const calculateLayout = (terminalWidth: number, terminalHeight: number): LayoutConfig => {
  const effectiveWidth = Math.max(terminalWidth, LAYOUT.header.minWidth);
  const effectiveHeight = Math.max(terminalHeight, 15);
  const canShowSidebar = effectiveWidth >= LAYOUT.sidebar.minWidthForSidebar;
  
  const contentWidth = canShowSidebar 
    ? effectiveWidth - LAYOUT.sidebar.width 
    : effectiveWidth;
  const contentHeight = effectiveHeight - LAYOUT.header.height - LAYOUT.footer.height;

  return {
    width: effectiveWidth,
    height: effectiveHeight,
    canShowSidebar,
    contentWidth,
    contentHeight,
    header: {
      width: effectiveWidth,
      height: LAYOUT.header.height,
    },
    footer: {
      width: effectiveWidth,
      height: LAYOUT.footer.height,
    },
  };
};