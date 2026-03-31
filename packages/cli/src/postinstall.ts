/**
 * Postinstall script - runs after npm install
 * Does NOT require user interaction.
 * Does NOT fail loudly.
 */

function postinstall(): void {
  console.log(`
  ┌─────────────────────────────────────────────┐
  │  EamilOS installed successfully             │
  │                                             │
  │  Get started:                               │
  │    eamilos setup       guided configuration │
  │    eamilos doctor      check system health  │
  │    eamilos help        see all commands     │
  │                                             │
  │  Quick start:                               │
  │    eamilos run "Create a Python calculator" │
  └─────────────────────────────────────────────┘
    `);

  const major = parseInt(process.version.slice(1).split('.')[0], 10);
  if (major < 18) {
    console.log(`  Node.js ${process.version} detected. EamilOS requires Node.js >= 18.`);
    console.log(`  Please upgrade: https://nodejs.org/\n`);
  }
}

postinstall();
