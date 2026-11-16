import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const base = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  testDir: base, testMatch: ['.workspace/tests/e2e/**/*.spec.ts', 'tests/e2e/**/*.spec.ts'],
  workers: 1, timeout: 45_000, outputDir: resolve(base, 'test-results'),
  use: { trace: 'retain-on-failure' },
  reporter: [['list'], ['json', { outputFile: resolve(base, 'reports/e2e.json') }]]
});
