import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const API_TARGET = process.env.API_TARGET ?? 'http://localhost:4175';

export default defineConfig({
  root: dir,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@agenda/shared': path.resolve(dir, '../../packages/shared/src/index.ts'),
      '@': path.resolve(dir, 'src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true, headers: { origin: API_TARGET } },
      '/uploads': { target: API_TARGET, changeOrigin: true, headers: { origin: API_TARGET } },
      '/brand': { target: API_TARGET, changeOrigin: true, headers: { origin: API_TARGET } },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
