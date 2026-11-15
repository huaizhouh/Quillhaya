import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { windows, workspace } from './paths.mjs';
import { prepare } from './prepare.mjs';

await prepare();
assert((await readFile(join(workspace, 'electron/main.ts'), 'utf8')).includes('process.env.QUILLHAYA_TEST_USER_DATA'));
const directory = await mkdtemp(join(tmpdir(), 'quillhaya-win-dev-'));
async function freePort() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
const inspectorPort = await freePort(), browserPort = await freePort();
const env = { ...process.env, QUILLHAYA_TEST_USER_DATA: directory };
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
const child = spawn(process.execPath, [join(windows, 'node_modules/electron-vite/bin/electron-vite.js'), 'dev', `--inspect=${inspectorPort}`, `--remoteDebuggingPort=${browserPort}`], { cwd: windows, env, windowsHide: true, stdio: 'pipe' });
let log = '', socket, browser;
child.stdout.on('data', chunk => { log = (log + chunk).slice(-12000); });
child.stderr.on('data', chunk => { log = (log + chunk).slice(-12000); });
const exited = new Promise(resolve => child.once('exit', resolve));
const pending = new Map(); let id = 0;
async function evaluate(expression) {
  const requestId = ++id;
  const reply = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Inspector timed out')); }, 10000);
    pending.set(requestId, value => { clearTimeout(timer); value.error || value.result.exceptionDetails ? reject(new Error(JSON.stringify(value))) : resolve(value.result.result.value); });
  });
  socket.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  return reply;
}
const electron = "process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron')";
try {
  let endpoint;
  await expect.poll(async () => {
    if (child.exitCode !== null) throw new Error(log);
    try { endpoint = (await (await fetch(`http://127.0.0.1:${inspectorPort}/json/list`)).json())[0].webSocketDebuggerUrl; return true; } catch { return false; }
  }, { timeout: 30000 }).toBe(true);
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => { const message = JSON.parse(event.data); if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); } };
  await expect.poll(() => evaluate(`${electron}.app.isReady()`)).toBe(true);
  const actual = await evaluate(`${electron}.app.getPath('userData')`);
  assert.equal(normalize(resolve(actual)).toLowerCase(), normalize(resolve(directory)).toLowerCase());
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${browserPort}`);
  const page = browser.contexts()[0].pages()[0];
  await expect(page.getByTestId('writing-editor')).toBeVisible();
  assert.match(page.url(), /^http:\/\/127\.0\.0\.1:/);
  const preferences = await evaluate(`(() => { const p = ${electron}.BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(); return { sandbox: p.sandbox, isolation: p.contextIsolation, node: p.nodeIntegration }; })()`);
  assert.deepEqual(preferences, { sandbox: true, isolation: true, node: false });
  await page.getByTestId('writing-editor').focus(); await page.keyboard.insertText('Development writing works.');
  await expect(page.getByTestId('feedback-card')).toContainText('表达良好');
  await page.screenshot({ path: join(windows, 'reports/screenshots/development.png') });
  await evaluate(`${electron}.app.exit(0)`).catch(() => {});
  socket.close();
  await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('Dev runner did not exit')), 10000))]);
  console.log('PASS: actual electron-vite dev command, isolated userData, HTTP renderer/CSP/preload, sandbox, writing feedback and process cleanup.');
} catch (error) {
  console.error(log); throw error;
} finally {
  await browser?.close().catch(() => {}); socket?.close();
  if (child.exitCode === null) {
    await new Promise(resolve => { const kill = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); kill.once('exit', resolve); });
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
