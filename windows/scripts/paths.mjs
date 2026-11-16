import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const windows = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const repository = resolve(windows, '..');
export const workspace = resolve(windows, '.workspace');
