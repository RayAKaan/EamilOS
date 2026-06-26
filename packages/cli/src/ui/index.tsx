import React from 'react';
import { render } from 'ink';
import { App } from './app.js';

const _origLog = console.log;
console.log = () => {};
process.on('exit', () => { console.log = _origLog; });

const { waitUntilExit } = render(<App />, {
  exitOnCtrlC: false,
  patchConsole: false,
});

export { waitUntilExit };
