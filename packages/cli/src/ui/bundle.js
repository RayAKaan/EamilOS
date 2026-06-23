import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root      = join(__dirname, '..', '..');

const BUILTINS = [
  'fs','fs/promises','path','os','child_process','stream','stream/promises',
  'util','events','crypto','http','https','net','tls','url','querystring',
  'readline','tty','assert','buffer','module','process','v8','vm',
  'worker_threads','cluster','dns','dgram','zlib','string_decoder',
  'timers','timers/promises','constants','punycode','perf_hooks',
];

await build({
  entryPoints: [join(root, 'src', 'ui', 'index.ts')],
  bundle:      true,
  platform:    'node',
  target:      'node18',
  format:      'esm',
  outfile:     join(root, 'dist', 'eamilos-ui.js'),
  external: [
    ...BUILTINS,
    ...BUILTINS.map((b) => `node:${b}`),
    'blessed',
    'zustand',
    'execa',
  ],
  define: { 'process.env.NODE_ENV': '"production"' },
  sourcemap: 'linked',
  logLevel:  'info',
  banner:    { js: '// EamilOS TUI\n' },
}).catch((e) => { console.error(e); process.exit(1); });

console.log('bundle -> dist/eamilos-ui.js');
