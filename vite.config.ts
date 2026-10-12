/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { contentDevServer } from './tools/vite-content-plugin.ts';
import { relayBundle } from './tools/vite-relay-plugin.ts';
import { gitRevision } from './tools/gitRevision.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

// Tauri needs a fixed dev port; release builds load the pages from dist/.
export default defineConfig({
  plugins: [
    react(),
    contentDevServer(resolve(root, 'content')),
    relayBundle(resolve(root, 'dist-server', 'relay.mjs')),
  ],
  clearScreen: false,
  // Shown under Settings > About to tell builds apart.
  define: { __GIT_REVISION__: JSON.stringify(gitRevision(root)) },
  resolve: {
    alias: { '@': resolve(root, 'src') },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        dm: resolve(root, 'index.html'),
        player: resolve(root, 'player.html'),
      },
    },
  },
  worker: { format: 'es' },
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts', 'server/**/*.test.ts'],
    environment: 'node',
  },
});
