import { useEffect } from 'react';

type KeyHandler = (key: string) => void;

const keyListeners = new Set<KeyHandler>();

export const useKeyboard = (handler: KeyHandler): void => {
  useEffect(() => {
    keyListeners.add(handler);
    return () => { keyListeners.delete(handler); };
  }, [handler]);
};

export const useViewKeyboard = (shortcuts: Record<string, () => void>) => {
  useEffect(() => {
    const handler = (key: string) => {
      const norm = key.toLowerCase();
      for (const [shortcut, callback] of Object.entries(shortcuts)) {
        if (norm === shortcut.toLowerCase()) {
          callback();
          return;
        }
      }
    };
    keyListeners.add(handler);
    return () => { keyListeners.delete(handler); };
  }, [shortcuts]);
};

export const isKey = (keyId: string, expected: string): boolean => {
  return keyId.toLowerCase() === expected.toLowerCase();
};

export const isAnyKey = (keyId: string, expected: string[]): boolean => {
  const norm = keyId.toLowerCase();
  return expected.some(e => norm === e.toLowerCase());
};

if (typeof process !== 'undefined' && process.stdin) {
  process.stdin.on('data', (data: Buffer) => {
    const key = data.toString();
    for (const listener of keyListeners) {
      try { listener(key); } catch {}
    }
  });
}