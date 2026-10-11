import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const portServer = createServer();
portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening');
const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve));
const directory = await mkdtemp(join(tmpdir(), 'twa-dev-smoke-'));
const child = spawn('bash', ['run.sh'], { detached: true, env: { ...process.env, TWA_TEST_USER_DATA: directory, REMOTE_DEBUGGING_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', chunk => { output = (output + chunk).slice(-15_000); });
child.stderr.on('data', chunk => { output = (output + chunk).slice(-15_000); });
let browser;
let page;
const errors = [];
try {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`开发服务器提前退出：${output}`);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 800 }); break; } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert.ok(browser, `Electron 没有启动：${output}`);
  const context = browser.contexts()[0];
  page = context.pages()[0] ?? await context.waitForEvent('page');
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const editor = page.getByTestId('writing-editor');
  await editor.waitFor({ timeout: 20_000 });
  assert.match(page.url(), /^http:\/\/127\.0\.0\.1:/);
  await editor.fill('I am agree with you.');
  await page.getByRole('button', { name: '接受修改', exact: true }).waitFor();
  assert.equal(await editor.textContent(), 'I am agree with you.');
  await page.getByRole('button', { name: '接受修改', exact: true }).click();
  assert.equal(await editor.textContent(), 'I agree with you.');
  assert.deepEqual(errors, []);
  console.log(`PASS: bash run.sh → Vite → sandboxed Electron → Mock feedback → accept. Node ${process.version} (${process.arch}).`);
} catch (error) {
  console.error('Dev smoke diagnostics:', { url: page?.url(), body: await page?.textContent('body').catch(() => ''), errors, output });
  throw error;
} finally {
  // Terminate our isolated process group first; Browser.close alone can open
  // the app's legitimate unsaved-document confirmation and wait indefinitely.
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
  if (browser) await browser.close().catch(() => {});
}
