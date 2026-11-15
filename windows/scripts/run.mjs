import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, dirname, delimiter } from 'node:path';
import { windows } from './paths.mjs';
import { prepare } from './prepare.mjs';

process.chdir(windows);
process.env.PATH = dirname(process.execPath) + delimiter + process.env.PATH;
process.env.npm_config_cache = join(windows, '.cache/npm');
process.env.ELECTRON_CACHE = join(windows, '.cache/electron');
process.env.ELECTRON_BUILDER_CACHE = join(windows, '.cache/electron-builder');
process.env.electron_config_cache = join(windows, '.cache/electron');
process.env.TEMP = join(windows, '.cache/tmp');
process.env.TMP = process.env.TEMP;
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
delete process.env.ELECTRON_RUN_AS_NODE;
const [task, ...extra] = process.argv.slice(2);
const cli = { tsc: 'typescript/bin/tsc', vite: 'electron-vite/bin/electron-vite.js', vitest: 'vitest/vitest.mjs', playwright: '@playwright/test/cli.js', builder: 'electron-builder/out/cli/cli.js' };
async function run(name, args) {
  const entry = cli[name] ? join(windows, 'node_modules', cli[name]) : join(windows, 'scripts', name);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { cwd: windows, env: process.env, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${name} exited with ${code ?? signal}`)));
  });
}
async function build() { await prepare(); await run('tsc', ['--noEmit']); await run('vite', ['build']); }
await mkdir(join(windows, '.cache'), { recursive: true });
await mkdir(process.env.TEMP, { recursive: true });
switch (task) {
  case 'prepare': await prepare(); break;
  case 'dev': await prepare(); await run('vite', ['dev', ...extra]); break;
  case 'start': await run('vite', ['preview', ...extra]); break;
  case 'typecheck': await prepare(); await run('tsc', ['--noEmit', ...extra]); break;
  case 'test': await prepare(); await run('vitest', ['run', ...extra]); break;
  case 'build': await build(); break;
  case 'test:e2e': await build(); await run('playwright', ['test', ...extra]); break;
  case 'check': await build(); await run('vitest', ['run']); await run('playwright', ['test']); break;
  case 'pack:win': await build(); await run('builder', ['--config', 'electron-builder.yml', '--win', '--x64', '--dir', '--publish', 'never', ...extra]); break;
  case 'dist:win': await build(); await run('builder', ['--config', 'electron-builder.yml', '--win', '--x64', '--publish', 'never', ...extra]); break;
  case 'test:package': await run('package-smoke.mjs', extra); break;
  case 'test:dev': await run('dev-smoke.mjs', extra); break;
  default: throw new Error(`Unknown task: ${task}`);
}
