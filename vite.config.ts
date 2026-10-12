/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { contentDevServer } from './tools/vite-content-plugin.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

// Tauri needs a fixed dev port; release builds load the pages from dist/.
export default defineConfig({
  plugins: [react(), contentDevServer(resolve(root, 'content'))],
  clearScreen: false,
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
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
  },
});
