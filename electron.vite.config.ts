import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve('electron/main.ts') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve('electron/preload.ts'), output: { format: 'cjs', entryFileNames: 'preload.cjs' } } }
  },
  renderer: {
    root: '.', plugins: [react()],
    build: { rollupOptions: { input: resolve('index.html') } },
    // Keep the strict script CSP in development too; React Refresh injects inline JS.
    server: { host: '127.0.0.1', hmr: false }
  }
});
