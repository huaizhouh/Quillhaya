import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { windows } from './paths.mjs';
const temporary = join(windows, '.cache/tmp');
await mkdir(temporary, { recursive: true });
const env = { ...process.env, TEMP: temporary, TMP: temporary, ELECTRON_CACHE: join(windows, '.cache/electron'), electron_config_cache: join(windows, '.cache/electron') };
for (const entry of ['esbuild/install.js', 'electron/install.js']) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(windows, 'node_modules', entry)], { cwd: windows, env, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${entry} exited with ${code}`)));
  });
}
