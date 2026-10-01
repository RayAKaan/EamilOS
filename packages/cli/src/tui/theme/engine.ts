import type { ThemeConfig, ThemeName, ThemeTokens, MotionMode } from './types.js';

const DARK: ThemeTokens = {
  background: '#0d1014', foreground: '#f5f7fa', muted: '#8b929c', primary: '#d98a45',
  success: '#55c271', warning: '#e5b84f', error: '#e05b5b', approval: '#d98a45',
  border: '#30363d', focus: '#f2a65a',
};

const LIGHT: ThemeTokens = {
  background: '#ffffff', foreground: '#1b1f24', muted: '#5b6570', primary: '#9a5a24',
  success: '#247a3b', warning: '#8a6500', error: '#a52c2c', approval: '#9a5a24',
  border: '#c9cfd6', focus: '#9a5a24',
};

const HIGH_CONTRAST: ThemeTokens = {
  background: '#000000', foreground: '#ffffff', muted: '#ffffff', primary: '#ffffff',
  success: '#ffffff', warning: '#ffffff', error: '#ffffff', approval: '#ffffff',
  border: '#ffffff', focus: '#ffffff',
};

export function detectThemeName(env: NodeJS.ProcessEnv = process.env): ThemeName {
  const requested = env.EAMILOS_THEME?.toLowerCase();
  if (requested === 'dark' || requested === 'eamilos-dark') return 'eamilos-dark';
  if (requested === 'light' || requested === 'eamilos-light') return 'eamilos-light';
  if (requested === 'terminal' || requested === 'terminal-native') return 'terminal-native';
  if (requested === 'high-contrast') return 'high-contrast';
  if (requested === 'no-color') return 'no-color';
  return 'auto';
}

export function resolveTheme(name: ThemeName, colorDepth: 'truecolor' | 'ansi256' | 'ansi16' | 'none'): ThemeTokens {
  if (name === 'no-color' || name === 'high-contrast' || colorDepth === 'none') return HIGH_CONTRAST;
  if (name === 'eamilos-light') return LIGHT;
  if (name === 'terminal-native' || colorDepth === 'ansi16') return DARK;
  return DARK;
}

export function resolveMotion(env: NodeJS.ProcessEnv = process.env): MotionMode {
  if (env.EAMILOS_MOTION === 'none') return 'none';
  if (env.EAMILOS_MOTION === 'reduced' || env.EAMILOS_REDUCED_MOTION === '1') return 'reduced';
  return 'full';
}

export function createThemeConfig(colorDepth: 'truecolor' | 'ansi256' | 'ansi16' | 'none', env: NodeJS.ProcessEnv = process.env): ThemeConfig {
  return { name: detectThemeName(env), motion: resolveMotion(env), unicode: env.EAMILOS_ASCII !== '1' };
}

export function themeTokens(name: ThemeName, colorDepth: 'truecolor' | 'ansi256' | 'ansi16' | 'none'): ThemeTokens {
  return resolveTheme(name, colorDepth);
}
