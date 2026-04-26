#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { createBridge } from './bridge.js';

async function main() {
  // Check if running in interactive terminal
  if (!process.stdin.isTTY) {
    console.error('❌ EamilOS UI requires an interactive terminal');
    console.error('   Try: npx eamilos');
    process.exit(1);
  }

  // Enable raw keyboard mode
  process.stdin.setRawMode(true);
  process.stdin.resume();

  // Create bridge with mock mode for development
  const bridge = createBridge({ mockMode: true });
  await bridge.initialize();

  // Render UI
  const { waitUntilExit } = render(React.createElement(App, { bridge }), {
    stdout: process.stdout,
    stdin: process.stdin,
    debug: process.env.DEBUG === 'true',
    exitOnCtrlC: false
  });

  // Cleanup on exit
  const cleanup = async () => {
    process.stdin.setRawMode(false);
    await bridge.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  await waitUntilExit();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});