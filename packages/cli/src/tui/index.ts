import { EamilOSTuiApp } from './app.js';

const app = new EamilOSTuiApp();

app.start().catch((err) => {
  console.error('TUI failed to start:', err);
  process.exit(1);
});
