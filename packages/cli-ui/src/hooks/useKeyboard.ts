import { useEffect, useState, useCallback, useRef } from 'react';

type KeyHandler = (key: string) => void;
type MouseHandler = (x: number, y: number, button: number) => void;

let globalKeyHandler: KeyHandler | null = null;
let globalMouseHandler: MouseHandler | null = null;
let mouseEnabled = false;

export const useKeyboard = (handler: KeyHandler): void => {
  useEffect(() => {
    globalKeyHandler = handler;
    return () => { globalKeyHandler = null; };
  }, [handler]);
};

export const useMouse = (handler: MouseHandler, enabled: boolean = true): void => {
  useEffect(() => {
    if (enabled) {
      globalMouseHandler = handler;
      if (!mouseEnabled) {
        enableMouse();
      }
    }
    return () => { globalMouseHandler = null; };
  }, [handler, enabled]);
};

const enableMouse = () => {
  if (typeof process === 'undefined') return;
  
  process.stdout?.write('\x1b[?1003h');
  
  process.stdin?.on('data', (data: Buffer) => {
    const str = data.toString();
    
    if (str.startsWith('\x1b[')) {
      if (str.includes('M') && str.length >= 6) {
        const code = str.charCodeAt(1);
        if (code === 0x1b) {
          const button = str.charCodeAt(3) - 32;
          const x = str.charCodeAt(4) - 32;
          const y = str.charCodeAt(5) - 32;
          
          if (button === 0) {
            if (globalMouseHandler) {
              globalMouseHandler(x, y, 0);
            }
          }
        }
      }
      return;
    }
    
    if (globalKeyHandler) {
      globalKeyHandler(str);
    }
  });
  
  mouseEnabled = true;
};

export const disableMouse = () => {
  process.stdout?.write('\x1b[?1003l');
  mouseEnabled = false;
};

export const useViewKeyboard = (shortcuts: Record<string, () => void>) => {
  const handler = (key: string) => {
    const normalized = key.toLowerCase();
    for (const [shortcut, callback] of Object.entries(shortcuts)) {
      if (normalized === shortcut.toLowerCase()) {
        callback();
        return;
      }
    }
  };
  useKeyboard(handler);
};

export const isKey = (keyId: string, expected: string): boolean => {
  return keyId.toLowerCase() === expected.toLowerCase();
};

export const isAnyKey = (keyId: string, expected: string[]): boolean => {
  const normalized = keyId.toLowerCase();
  return expected.some(e => normalized === e.toLowerCase());
};