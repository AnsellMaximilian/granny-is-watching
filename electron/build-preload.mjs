import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Sandboxed preloads cannot require npm packages directly.
await build({
  entryPoints: [fileURLToPath(new URL('./preload.cjs', import.meta.url))],
  outfile: fileURLToPath(new URL('../dist/preload.cjs', import.meta.url)),
  tsconfigRaw: {},
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
});
