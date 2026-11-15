import { copyFile, mkdir, readFile, readdir, writeFile, rm, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, extname } from 'node:path';
import { windows, repository, workspace } from './paths.mjs';

export const digest = data => createHash('sha256').update(data).digest('hex');
export function adapt(source, rule, path) {
  const text = source.replace(/\r\n/g, '\n');
  if (digest(text) !== rule.sha256) throw new Error(`Shared source changed: ${path}. Review platform/adaptations.json before rebuilding.`);
  return rule.edits.reduce((value, { before, after, count = 1 }) => {
    const parts = value.split(before);
    if (parts.length !== count + 1) throw new Error(`Adaptation anchor mismatch in ${path}: ${before}`);
    return parts.join(after);
  }, text);
}

export async function prepare() {
  const rules = JSON.parse(await readFile(join(windows, 'platform/adaptations.json'), 'utf8'));
  // Validate every guarded source before changing the disposable staging directory.
  for (const [path, rule] of Object.entries(rules)) adapt(await readFile(join(repository, path), 'utf8'), rule, path);
  if (dirname(workspace) !== windows) throw new Error('Staging directory must be inside windows/');
  const existing = await lstat(workspace).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (existing?.isSymbolicLink()) throw new Error('Refusing a symlinked staging directory');
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  const manifest = {};
  async function copy(path) {
    const source = await readFile(join(repository, path));
    manifest[path] = digest(source);
    const target = join(workspace, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, rules[path] ? adapt(source.toString('utf8'), rules[path], path) : source);
  }
  async function tree(path, allowed) {
    for (const entry of await readdir(join(repository, path), { withFileTypes: true })) {
      const name = `${path}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Source symlinks are not allowed: ${name}`);
      if (entry.isDirectory()) await tree(name, allowed);
      else if (allowed.has(extname(entry.name))) await copy(name);
    }
  }
  await tree('electron', new Set(['.ts']));
  await tree('src', new Set(['.ts', '.tsx', '.css']));
  await tree('tests', new Set(['.ts']));
  await copy('index.html');
  await mkdir(join(workspace, 'icon/generated'), { recursive: true });
  await copyFile(join(windows, 'assets/app-icon.png'), join(workspace, 'icon/generated/app-icon.png'));
  await copyFile(join(windows, 'platform/windows.css'), join(workspace, 'src/styles/windows.css'));
  await copyFile(join(windows, 'tests/isolated-electron.ts'), join(workspace, 'tests/e2e/isolated-electron.ts'));
  await writeFile(join(workspace, 'source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await mkdir(join(windows, 'reports/screenshots'), { recursive: true });
  console.log(`Prepared ${Object.keys(manifest).length} shared source files inside windows/.workspace.`);
}
