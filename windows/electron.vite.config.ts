import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const base = dirname(fileURLToPath(import.meta.url));
const path = (name: string) => resolve(base, name);
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { outDir: path('out/main'), rollupOptions: { input: path('.workspace/electron/main.ts') } } },
  preload: { plugins: [externalizeDepsPlugin()], build: { outDir: path('out/preload'), rollupOptions: { input: path('.workspace/electron/preload.ts'), output: { format: 'cjs', entryFileNames: 'preload.cjs' } } } },
  renderer: {
    root: path('.workspace'), cacheDir: path('.cache/vite'), plugins: [react()],
    build: { outDir: path('out/renderer'), emptyOutDir: true, rollupOptions: { input: path('.workspace/index.html') } },
    server: { host: '127.0.0.1', hmr: false }
  }
});
