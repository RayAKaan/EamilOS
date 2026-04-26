import { useEffect, useCallback } from 'react';

export interface KeyPress {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

export const useKeyboard = (handler: (keyId: string, key?: KeyPress) => void) => {
  useEffect(() => {
    const onKeypress = (ch: string, key: KeyPress) => {
      if (!ch && !key?.name) return;

      let keyId = '';
      
      if (key.ctrl) keyId += 'Ctrl+';
      if (key.meta) keyId += 'Meta+';
      if (key.shift) keyId += 'Shift+';
      
      const baseKey = (key.name || ch || '').toLowerCase();
      keyId += baseKey;

      handler(keyId, key);
    };

    process.stdin.on('keypress', onKeypress);
    return () => {
      try {
        process.stdin.off('keypress', onKeypress);
      } catch {
        // Ignore if not registered
      }
    };
  }, [handler]);
};

export const useViewKeyboard = (shortcuts: Record<string, () => void>) => {
  const handler = useCallback((keyId: string) => {
    const normalizedKey = keyId.toLowerCase();
    for (const [shortcut, callback] of Object.entries(shortcuts)) {
      if (normalizedKey === shortcut.toLowerCase() || normalizedKey === shortcut) {
        callback();
        break;
      }
    }
  }, [shortcuts]);

  useKeyboard(handler);
};

export const normalizeKey = (key: KeyPress, char?: string): string => {
  let keyId = '';
  
  if (key.ctrl) keyId += 'ctrl+';
  if (key.meta) keyId += 'meta+';
  if (key.shift) keyId += 'shift+';
  
  keyId += key.name || char || '';
  
  return keyId.toLowerCase();
};

export const isKey = (keyId: string, expected: string): boolean => {
  return keyId.toLowerCase() === expected.toLowerCase();
};

export const isAnyKey = (keyId: string, expected: string[]): boolean => {
  const normalized = keyId.toLowerCase();
  return expected.some(e => normalized === e.toLowerCase());
};