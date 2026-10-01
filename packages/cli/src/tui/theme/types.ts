export type ThemeName = 'eamilos-dark' | 'eamilos-light' | 'terminal-native' | 'high-contrast' | 'no-color' | 'auto';
export type MotionMode = 'full' | 'reduced' | 'none';

export interface ThemeTokens {
  background: string;
  foreground: string;
  muted: string;
  primary: string;
  success: string;
  warning: string;
  error: string;
  approval: string;
  border: string;
  focus: string;
}

export interface ThemeConfig {
  name: ThemeName;
  motion: MotionMode;
  unicode: boolean;
}
