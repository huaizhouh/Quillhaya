import { _electron as electron } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve, normalize } from 'node:path';

export async function launchIsolated(directory: string) {
  const main = resolve('out/main/main.js');
  const source = await readFile(main, 'utf8');
  if (!source.includes('process.env.QUILLHAYA_TEST_USER_DATA')) throw new Error('Build lacks isolated user data support. Rebuild first.');
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), QUILLHAYA_TEST_USER_DATA: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const app = await electron.launch({ args: [main], env });
  const actual = await app.evaluate(({ app }) => app.getPath('userData'));
  if (normalize(resolve(actual)).toLowerCase() !== normalize(resolve(directory)).toLowerCase()) {
    await app.evaluate(({ app }) => app.exit(1));
    throw new Error('Refusing to test a non-isolated data directory.');
  }
  return app;
}
