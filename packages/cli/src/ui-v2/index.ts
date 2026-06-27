import { TerminalSurface } from './terminal.js';
import { EamilOSTuiApp } from './app.js';

const term = new TerminalSurface();
const app = new EamilOSTuiApp(term);

app.start().catch((err) => {
  term.restoreConsole();
  term.disableRawMode();
  term.exitAltScreen();
  console.error('TUI failed to start:', err);
  process.exit(1);
});
