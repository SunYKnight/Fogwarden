import { resolve } from 'node:path';
import { build } from 'esbuild';

// One self-contained file, so installing the relay needs only Node, no npm.
const root = resolve(import.meta.dirname, '..');
await build({
  entryPoints: [resolve(root, 'server', 'relay.ts')],
  outfile: resolve(root, 'dist-server', 'relay.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  // Unminified: stack traces in the server's journal stay readable.
  legalComments: 'eof',
  // `ws` is CommonJS and requires Node built-ins, which an ES module bundle
  // can only do through a real `require`.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
