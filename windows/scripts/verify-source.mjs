import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from './prepare.mjs';
import { repository, workspace } from './paths.mjs';
const manifest = JSON.parse(await readFile(join(workspace, 'source-manifest.json'), 'utf8'));
for (const [path, hash] of Object.entries(manifest)) {
  assert.equal(digest(await readFile(join(repository, path))), hash, `Root source changed: ${path}`);
}
console.log(`PASS: ${Object.keys(manifest).length} shared source files are unchanged.`);
