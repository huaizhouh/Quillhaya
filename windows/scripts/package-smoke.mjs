import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, normalize, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { _electron as electron, expect } from '@playwright/test';
import { listPackage, extractFile } from '@electron/asar';
import { windows } from './paths.mjs';

assert.equal(process.platform, 'win32', 'Run the package smoke test on Windows.');
const executable = resolve(process.argv[2] || join(windows, 'dist/win-unpacked/Quillhaya.exe'));
const asar = join(dirname(executable), 'resources/app.asar');
const entries = listPackage(asar).map(p => p.replaceAll('\\', '/'));
assert(entries.every(p => /^\/(out|node_modules)(\/|$)/.test(p) || p === '/package.json'), 'Unexpected files in app.asar');
assert(!entries.some(p => /(?:^|\/)(?:credentials|settings|draft|favorites)\.json$/.test(p)), 'User data must never be packaged');
const main = extractFile(asar, join('out', 'main', 'main.js')).toString('utf8');
assert(main.includes('process.env.QUILLHAYA_TEST_USER_DATA'), 'Package lacks isolated test directory support');
assert.match(main, /setAppUserModelId\(["']com\.zloyan\.quillhaya["']\)/);
const metadata = JSON.parse(extractFile(asar, 'package.json'));
assert.equal(metadata.version, JSON.parse(await readFile(join(windows, 'package.json'))).version);
assert.equal(metadata.main, 'out/main/main.js');
await mkdir(join(windows, 'reports'), { recursive: true });
await writeFile(join(windows, 'reports/package-files.txt'), entries.join('\n') + '\n');
assert.deepEqual(await readFile(join(dirname(executable), 'resources/app-icon.ico')), await readFile(join(windows, 'assets/app-icon.ico')));

const directory = await mkdtemp(join(tmpdir(), 'quillhaya-win-package-'));
const userData = join(directory, '中文 user data');
const env = { ...process.env, QUILLHAYA_TEST_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
const key = 'synthetic-quillhaya-windows-restart';
let authenticatedRequests = 0;
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    if (req.headers.authorization !== `Bearer ${key}`) { res.writeHead(401); res.end(); return; }
    authenticatedRequests++;
    const input = JSON.parse(JSON.parse(raw).messages[1].content);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sentence_id: input.sentence_id, original_text: input.original_text,
      status: 'good', overall_explanation_zh: '表达良好，无需修改。', suggested_revision: null, issues: [], confidence: 0.9 }) } }] }));
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let app;
async function launch() {
  app = await electron.launch({ executablePath: executable, env });
  const actual = await app.evaluate(({ app }) => app.getPath('userData'));
  assert.equal(normalize(resolve(actual)).toLowerCase(), normalize(resolve(userData)).toLowerCase(), 'Refusing non-isolated package test');
  const runtime = await app.evaluate(async ({ app, BrowserWindow, safeStorage }) => {
    const { sandbox, contextIsolation, nodeIntegration } = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { name: app.getName(), version: app.getVersion(), packaged: app.isPackaged, arch: process.arch, sandbox, contextIsolation, nodeIntegration, encryption: await safeStorage.isAsyncEncryptionAvailable() };
  });
  assert.deepEqual(runtime, { name: 'Quillhaya', version: metadata.version, packaged: true, arch: 'x64', sandbox: true, contextIsolation: true, nodeIntegration: false, encryption: true });
  const page = await app.firstWindow();
  await expect(page.getByTestId('writing-editor')).toBeVisible();
  return page;
}
async function close(graceful = false) {
  if (!app) return;
  const current = app; app = undefined;
  const closed = current.waitForEvent('close', { timeout: 15_000 });
  await current.evaluate(({ app, dialog }, graceful) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    if (graceful) app.quit(); else app.exit(0);
  }, graceful).catch(() => {});
  await closed;
}
try {
  let page = await launch();
  const boot = await page.evaluate(() => window.desktop.bootstrap());
  assert.equal(boot.ok, true); assert.equal(boot.value.restored, false);
  await page.getByTestId('writing-editor').focus(); await page.keyboard.insertText('He go home.');
  await expect(page.getByRole('button', { name: '接受修改', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '收藏反馈', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消收藏反馈' })).toBeVisible();
  await page.getByRole('button', { name: '接受修改', exact: true }).click();
  await expect(page.getByTestId('writing-editor')).toHaveText('He goes home.');
  await page.keyboard.press('Control+z'); await expect(page.getByTestId('writing-editor')).toHaveText('He go home.');
  const profile = { ...boot.value.settings.profiles[0], id: 'restart-key', kind: 'custom', name: 'Windows restart check', auth: 'bearer', envKey: '', model: 'synthetic', baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
  const saved = await page.evaluate(({ settings, profile, key }) => window.desktop.saveSettings({ ...settings, profiles: [...settings.profiles, profile], defaultProfileId: profile.id, autoAnalyze: false }, { [profile.id]: key }), { settings: boot.value.settings, profile, key });
  assert.equal(saved.ok, true); assert.equal(saved.value.keyStatus[profile.id], true);
  await page.reload(); await expect(page.getByRole('button', { name: '恢复自动分析' })).toBeVisible();
  for(const file of ['settings.json','credentials.json']) assert(!(await readFile(join(userData,file),'utf8')).includes(key));
  await close(true);
  page = await launch();
  const restored = await page.evaluate(() => window.desktop.bootstrap());
  assert.equal(restored.ok && restored.value.keyStatus[profile.id], true);
  assert(!JSON.stringify(restored).includes(key));
  await expect(page.getByTestId('writing-editor')).toHaveText('He go home.');
  await expect(page.getByRole('button', { name: '恢复自动分析' })).toBeVisible();
  await page.getByRole('button', { name: '打开收藏夹' }).click();
  await expect(page.getByTestId('favorite-item')).toHaveCount(1);
  const reply = await page.evaluate(profile => window.desktop.testConnection(profile), profile);
  assert.equal(reply.ok, true); assert.equal(authenticatedRequests, 1);
  await page.screenshot({ path: join(windows, 'reports/screenshots/package.png') });
  await close(true);
  console.log('PASS: packaged x64 identity, sandbox, file inventory, icon, writing/undo/favorite, pause/draft restart, native Windows encryption and authenticated loopback request after restart.');
} finally {
  await close().catch(() => {});
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  // Only remove this freshly-created synthetic data directory, never appData.
  assert(dirname(directory) === tmpdir() && directory.includes('quillhaya-win-package-'));
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
