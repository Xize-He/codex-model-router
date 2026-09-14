import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/postcss';
// This local client uses a separate Node service for Codex subprocesses and credentials.
export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } }, plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  build: { outDir: 'out' },
  server: { host: '127.0.0.1', port: 7340, strictPort: true, proxy: { '/api': 'http://127.0.0.1:7341' } },
});
