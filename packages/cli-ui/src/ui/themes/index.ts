export * from './colors.js';

export const Spacing = {
  xs: 1,
  sm: 2,
  md: 3,
  lg: 4,
  xl: 6,
};

export const NewTheme = {
  colors: {
    bg: 'black' as const,
    fg: 'white' as const,
    dim: 'gray' as const,
    accent: 'cyan' as const,
    success: 'green' as const,
    warning: 'yellow' as const,
    error: 'red' as const,
    user: 'green' as const,
    assistant: 'cyan' as const,
  },
  borders: {
    style: 'single' as const,
    color: 'gray' as const,
  },
  spacing: {
    xs: 1,
    sm: 2,
    md: 3,
    lg: 4,
    xl: 6,
  },
};

export type ThemeColors = typeof NewTheme.colors;
