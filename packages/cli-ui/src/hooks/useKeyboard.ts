import { useEffect, useState } from 'react';

type KeyHandler = (key: string) => void;

let globalHandler: KeyHandler | null = null;

export const useKeyboard = (handler: KeyHandler): void => {
  useEffect(() => {
    globalHandler = handler;
    return () => { globalHandler = null; };
  }, [handler]);
};

export const useViewKeyboard = (shortcuts: Record<string, () => void>) => {
  useEffect(() => {
    globalHandler = (key: string) => {
      const normalized = key.toLowerCase();
      for (const [shortcut, callback] of Object.entries(shortcuts)) {
        if (normalized === shortcut.toLowerCase()) {
          callback();
          return;
        }
      }
    };
    return () => { globalHandler = null; };
  }, [shortcuts]);
};

export const isKey = (keyId: string, expected: string): boolean => {
  return keyId.toLowerCase() === expected.toLowerCase();
};

export const isAnyKey = (keyId: string, expected: string[]): boolean => {
  const normalized = keyId.toLowerCase();
  return expected.some(e => normalized === e.toLowerCase());
};

if (typeof process !== 'undefined') {
  process.stdin?.on('data', (data: Buffer) => {
    if (globalHandler) {
      globalHandler(data.toString());
    }
  });
}