export interface KeyboardShortcut {
  key: string;
  modifiers?: ('ctrl' | 'shift' | 'alt')[];
  description: string;
}

export const SHORTCUTS: Record<string, KeyboardShortcut> = {
  run: {
    key: 'enter',
    description: 'Start execution',
  },
  retry: {
    key: 'r',
    description: 'Retry last execution',
  },
  stop: {
    key: 's',
    description: 'Stop execution',
  },
  mode: {
    key: 'm',
    description: 'Toggle mock mode',
  },
  clear: {
    key: 'c',
    description: 'Clear graph',
  },
  refresh: {
    key: 'r',
    modifiers: ['ctrl'],
    description: 'Refresh display',
  },
  exit: {
    key: 'c',
    modifiers: ['ctrl'],
    description: 'Exit application',
  },
};

export function parseShortcut(input: string, key: { ctrl?: boolean; shift?: boolean; alt?: boolean }): string {
  const modifiers: string[] = [];
  if (key.ctrl) modifiers.push('ctrl');
  if (key.shift) modifiers.push('shift');
  if (key.alt) modifiers.push('alt');
  
  return modifiers.length > 0 
    ? `${modifiers.join('+')}+${input}`
    : input.toLowerCase();
}

export function isShortcutMatch(
  input: string,
  key: { ctrl?: boolean; shift?: boolean; alt?: boolean; upArrow?: boolean; downArrow?: boolean; leftArrow?: boolean; rightArrow?: boolean; return?: boolean; escape?: boolean; backspace?: boolean },
  shortcut: KeyboardShortcut
): boolean {
  const inputKey = key.upArrow ? 'up' 
    : key.downArrow ? 'down' 
    : key.leftArrow ? 'left' 
    : key.rightArrow ? 'right'
    : key.return ? 'enter'
    : key.escape ? 'escape'
    : key.backspace ? 'backspace'
    : input.toLowerCase();

  const normalizedKey = shortcut.key.toLowerCase();
  
  if (inputKey !== normalizedKey) return false;

  const requiredMods = shortcut.modifiers || [];
  const hasCtrl = key.ctrl || false;
  const hasShift = key.shift || false;
  const hasAlt = key.alt || false;

  return (
    requiredMods.includes('ctrl') === hasCtrl &&
    requiredMods.includes('shift') === hasShift &&
    requiredMods.includes('alt') === hasAlt
  );
}
