import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

await esbuild.build({
  entryPoints: [join(root, 'src', 'ui', 'index.tsx')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: join(root, 'dist', 'eamilos-ui.js'),
  external: [
    'blessed',
    'fs', 'fs/promises', 'path', 'os', 'child_process', 'stream',
    'stream/promises', 'util', 'events', 'crypto', 'http', 'https',
    'net', 'tls', 'url', 'querystring', 'readline', 'tty', 'assert',
    'buffer', 'module', 'process', 'v8', 'vm', 'worker_threads',
    'cluster', 'dns', 'dgram', 'zlib', 'string_decoder', 'timers',
    'timers/promises', 'constants', 'punycode', 'perf_hooks',
    'pty.js', 'term.js',
    'zustand', 'nanoid', 'react', 'react-dom', 'execa',
  ],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  sourcemap: true,
  logLevel: 'info',
  banner: {
    js: '#!/usr/bin/env node\n// EamilOS TUI — built by esbuild\n',
  },
  minify: false,
}).catch((err) => {
  console.error('Bundle failed:', err);
  process.exit(1);
});

console.log('\nUI bundle complete -> dist/eamilos-ui.js\n');
