#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import { App } from './app.js';

const instance = render(React.createElement(App));

process.on('SIGINT', () => {
  // Handle SIGINT gracefully
  instance.unmount();
  process.exit(0);
});
