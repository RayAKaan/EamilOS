#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import { App } from './ui/App';
import { createBridge } from './bridge.js';

async function main() {
  if (!process.stdin.isTTY) {
    console.error('❌ EamilOS UI requires an interactive terminal');
    console.error('   Try: node packages/cli-ui/bin/eamilos-ui');
    process.exit(1);
  }

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  const mockMode = process.env.MOCK === 'true' || process.env.NODE_ENV === 'development';
  const debugMode = process.env.DEBUG === 'true';
  
  if (debugMode) {
    console.error('[EamilOS] Debug mode enabled');
  }
  if (mockMode) {
    console.error('[EamilOS] Mock mode enabled');
  }

  const bridge = createBridge({ mockMode });
  await bridge.initialize();

  const { waitUntilExit } = render(React.createElement(App, { bridge }), {
    stdout: process.stdout,
    stdin: process.stdin,
    debug: debugMode,
    exitOnCtrlC: false
  });

  const cleanup = async () => {
    process.stdin.setRawMode(false);
    await bridge.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  process.stdin.on('data', (chunk) => {
    if (debugMode) {
      process.stderr.write(`[Input] ${JSON.stringify(chunk)}\n`);
    }
  });

  await waitUntilExit();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});