export const Colors = {
  background: 'black' as const,
  surface: 'gray' as const,
  border: 'gray' as const,

  primary: 'white' as const,
  secondary: 'gray' as const,
  tertiary: 'black' as const,

  active: 'cyan' as const,
  success: 'green' as const,
  warning: 'yellow' as const,
  error: 'red' as const,

  claude: 'cyan' as const,
  codex: 'green' as const,
  ollama: 'yellow' as const,
  user: 'green' as const,
  assistant: 'cyan' as const,
  system: 'gray' as const,
  accent: 'magenta' as const,
};

export type ColorName = typeof Colors[keyof typeof Colors];
