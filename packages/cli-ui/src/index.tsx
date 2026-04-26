#!/usr/bin/env node

import React, { useState, useEffect } from 'react';
import { render } from 'ink';
import { App } from './ui/App';
import { createBridge } from './bridge.js';
import { useInput } from 'ink';

function InputHandler({ onKey }: { onKey: (key: string) => void }) {
  useInput((input) => {
    onKey(input);
  });
  return null;
}

function Main() {
  const [bridge, setBridge] = useState<any>(null);
  const [lastKey, setLastKey] = useState('');
  const [mode, setMode] = useState<'chat' | 'dashboard'>('chat');

  useEffect(() => {
    const init = async () => {
      const b = createBridge({ mockMode: true });
      await b.initialize();
      setBridge(b);
    };
    init();
  }, []);

  const handleKey = (key: string) => {
    setLastKey(key);
    
    if (key === '\t') {
      setMode(m => m === 'chat' ? 'dashboard' : 'chat');
    } else if (key === 'q') {
      process.exit(0);
    }
  };

  if (!bridge) {
    return <InputHandler onKey={() => {}} />;
  }

  return (
    <>
      <InputHandler onKey={handleKey} />
      <App bridge={bridge} mode={mode} onModeChange={setMode} lastKey={lastKey} />
    </>
  );
}

async function main() {
  if (!process.stdin.isTTY) {
    console.error('❌ EamilOS UI requires an interactive terminal');
    process.exit(1);
  }

  process.stdin.setRawMode(true);
  process.stdin.resume();

  const { waitUntilExit } = render(React.createElement(Main), {
    stdout: process.stdout,
    stdin: process.stdin,
    exitOnCtrlC: false
  });

  process.stdin.setRawMode(false);
  await waitUntilExit();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});