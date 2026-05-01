import * as esbuild from 'esbuild';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const version = pkg.version;

await esbuild.build({
  entryPoints: ['src/index.tsx'],
  bundle: true,
  outfile: 'dist/eamilos-ui.js',
  platform: 'node',
  target: 'node20',
  format: 'esm',
  external: ['react', 'react-dom', 'ink'],
  inject: [],
  define: {
    'process.env.EAMILOS_VERSION': JSON.stringify(version)
  },
  loader: { '.ts': 'ts' },
});

console.log('Bundled to dist/eamilos-ui.js, version:', version);