import { defineConfig } from 'vitest/config';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export default defineConfig({ root: dirname(fileURLToPath(import.meta.url)), cacheDir: '.cache/vitest', test: {
  include: ['.workspace/tests/unit/**/*.test.ts', 'tests/unit/**/*.test.ts'], environment: 'node', restoreMocks: true
} });
