import React, { useEffect, useRef, useState } from 'react';

export interface KeyPress {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

type KeyHandler = (keyId: string, key?: KeyPress) => void;

const listeners = new Set<KeyHandler>();

export const onKey = (handler: KeyHandler) => {
  listeners.add(handler);
  return () => listeners.delete(handler);
};

const emitKey = (keyId: string, key?: KeyPress) => {
  for (const handler of listeners) {
    handler(keyId, key);
  }
};

export const setupKeyboard = () => {
  if (typeof process === 'undefined') return;
  
  process.stdin.setRawMode(true);
  process.stdin.resume();
  
  process.stdin.on('data', (data: Buffer) => {
    const str = data.toString();
    const code = data[0];
    
    if (code === 3) {
      process.exit(0);
    }
    
    if (code === 13 || code === 10) {
      emitKey('enter');
    } else if (code === 27) {
      emitKey('escape');
    } else if (code === 127 || code === 8) {
      emitKey('backspace');
    } else if (code === 9) {
      emitKey('tab');
    } else if (code >= 32 && code <= 126) {
      emitKey(str);
    } else if (code === 27 && data.length > 1) {
      if (data[1] === 91) {
        if (data[2] === 65) emitKey('arrowup');
        else if (data[2] === 66) emitKey('arrowdown');
        else if (data[2] === 67) emitKey('arrowright');
        else if (data[2] === 68) emitKey('arrowleft');
      }
    }
  });
};

export const useKeyboard = (handler: KeyHandler) => {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const keyHandler = (keyId: string) => {
      handlerRef.current(keyId);
    };
    listeners.add(keyHandler);
    return () => { listeners.delete(keyHandler); };
  }, [handler]);
};

export const useGlobalKeyboard = (handler: KeyHandler) => {
  useEffect(() => {
    setupKeyboard();
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, [handler]);
};

export const useViewKeyboard = (shortcuts: Record<string, () => void>) => {
  const handler = (keyId: string) => {
    const normalizedKey = keyId.toLowerCase();
    for (const [shortcut, callback] of Object.entries(shortcuts)) {
      if (normalizedKey === shortcut.toLowerCase() || normalizedKey === shortcut) {
        callback();
        break;
      }
    }
  };
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