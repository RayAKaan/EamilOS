import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function helloCommand(name?: string): void {
  const pkgPath = resolve(__dirname, '../../package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const v = pkg.version || '1.0.0';

  const greeting = name
    ? `Hello, ${name}!`
    : 'Hello, EamilOS user!';
  console.log(`\n  ${greeting}`);
  console.log(`  EamilOS v${v}`);
  console.log(`  Node.js ${process.version} on ${os.type()} ${os.release()}`);
  console.log(`  Platform: ${process.platform} ${process.arch}`);
  console.log(`  Hostname: ${os.hostname()}\n`);
}
