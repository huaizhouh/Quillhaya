// Exercise the packaged app with isolated data and a loopback HTTP fixture.
// Never imports legacy credentials or reads a user's actual drafts/API keys.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect } from '@playwright/test';

assert.equal(process.platform, 'darwin', 'Run this smoke test on macOS after npm run pack:mac or npm run dist:mac.');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const bundle = resolve(pkg.build.directories.output, 'mac-arm64', `${pkg.build.productName}.app`);
const info = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(bundle, 'Contents/Info.plist')], { encoding: 'utf8' }));
assert.equal(info.CFBundleIdentifier, 'com.zloyan.quillhaya');
assert.equal(info.CFBundleDisplayName, pkg.build.productName);
assert.equal(info.LSApplicationCategoryType, pkg.build.mac.category);
assert.equal(info.CFBundleName, pkg.build.productName);
assert.equal(info.CFBundleExecutable, pkg.build.productName);
assert.deepEqual(await readFile(join(bundle, 'Contents/Resources', info.CFBundleIconFile)), await readFile(resolve(pkg.build.mac.icon)));
const directory = await mkdtemp(join(tmpdir(), 'quillhaya-package-'));
const userData = join(directory, 'user-data');
const env = { ...process.env, QUILLHAYA_TEST_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const key = 'synthetic-quillhaya-package-key';
let authenticatedRequests = 0;
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', data => { raw += data; });
  req.on('end', () => {
    if (req.headers.authorization !== `Bearer ${key}`) { res.writeHead(401); res.end('Wrong test credential'); return; }
    authenticatedRequests++;
    const input = JSON.parse(JSON.parse(raw).messages[1].content);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sentence_id: input.sentence_id, original_text: input.original_text,
      status: 'good', overall_explanation_zh: '表达良好，无需修改。', suggested_revision: null, issues: [], confidence: 0.9 }) } }] }));
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let app;
let appProcess;
let processLog = '';
async function close() {
  if (!app) return;
  const current = app; app = undefined;
  if (appProcess.exitCode !== null || appProcess.signalCode !== null) return;
  const closed = current.waitForEvent('close', { timeout: 10_000 }).catch(() => {});
  await current.evaluate(({ app }) => app.exit(0)).catch(() => {}); await closed;
}
async function launch(path) {
  app = await electron.launch({ executablePath: join(path, 'Contents/MacOS', info.CFBundleExecutable), env });
  appProcess = app.process();
  appProcess.stderr?.on('data', chunk => { processLog = (processLog + chunk.toString()).slice(-12_000); });
  const page = await app.firstWindow();
  await expect(page.getByTestId('writing-editor')).toBeVisible();
  return page;
}
try {
  let page = await launch(bundle);
  const runtime = await app.evaluate(({ app, BrowserWindow }) => {
    const { sandbox, contextIsolation, nodeIntegration } = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    if (app.commandLine.hasSwitch('use-mock-keychain')) throw new Error('The package test must use the native Keychain.');
    return { name: app.getName(), packaged: app.isPackaged, architecture: process.arch, directory: app.getPath('userData'), sandbox, contextIsolation, nodeIntegration };
  });
  assert.deepEqual(runtime, { name: 'Quillhaya', packaged: true, architecture: 'arm64', directory: userData, sandbox: true, contextIsolation: true, nodeIntegration: false });
  assert.match(page.url(), /^file:/);
  await expect(page).toHaveTitle('Quillhaya - Writing Assistant');
  await expect(page.locator('.app-brand')).toHaveText('Quillhaya - Writing Assistant');
  await expect(page.locator('.app-brand img')).toHaveCount(0);
  const boot = await page.evaluate(() => window.desktop.bootstrap());
  assert.equal(boot.ok, true); assert.equal(boot.value.restored, false);
  assert.deepEqual(boot.value.settings.profiles.map(p => p.kind), ['mock']);
  const editor = page.getByTestId('writing-editor');
  await editor.focus(); await page.keyboard.insertText('He go home.');
  const card = page.getByTestId('feedback-card');
  await expect(card).toContainText('建议修改');
  await expect(page.locator('.sentence-error')).toHaveCount(1);
  await card.getByRole('button', { name: '忽略', exact: true }).click();
  await expect(card).toContainText('已忽略'); await expect(card.locator('.original-text')).toHaveText('He go home.');
  await expect(page.locator('.sentence-problem')).toHaveCount(0);
  await card.getByRole('button', { name: '重新评估', exact: true }).click();
  await expect(card.getByRole('button', { name: '接受修改', exact: true })).toBeEnabled();
  await card.getByRole('button', { name: '接受修改', exact: true }).click();
  await expect(editor).toHaveText('He goes home.');
  await expect(page.locator('.draft-status')).toContainText('草稿已自动保存');
  const profile = { ...boot.value.settings.profiles[0], id: 'restart-key', name: 'Restart check', kind: 'custom', auth: 'bearer', envKey: '',
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'test' };
  console.log('Checking Quillhaya credential save using the native Keychain…');
  const saved = await page.evaluate(({ settings, key, profile }) => window.desktop.saveSettings({ ...settings,
    profiles: [...settings.profiles, profile], defaultProfileId: profile.id, autoAnalyze: false }, { [profile.id]: key }), { settings: boot.value.settings, key, profile });
  assert.equal(saved.ok, true);
  assert.equal(saved.value.keyStatus[profile.id], true);
  assert.equal((await readFile(join(userData, 'credentials.json'), 'utf8')).includes(key), false);
  console.log('Saved the encrypted credential successfully.');
  await close();
  // A copied installation of the very same signed build must read its own data.
  const copiedBundle = join(directory, 'installed', 'Quillhaya.app');
  await cp(bundle, copiedBundle, { recursive: true, verbatimSymlinks: true });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', copiedBundle]);
  console.log('Checking saved credential after restart and relocation…');
  page = await launch(copiedBundle);
  const restored = await page.evaluate(() => window.desktop.bootstrap());
  assert.equal(restored.ok, true);
  assert.equal(restored.value.keyStatus[profile.id], true);
  assert.equal(JSON.stringify(restored).includes(key), false);
  await expect(page.getByTestId('writing-editor')).toHaveText('He goes home.');
  const reply = await page.evaluate(profile => window.desktop.testConnection(profile), profile);
  assert.equal(reply.ok, true);
  assert.equal(authenticatedRequests, 1);
  console.log('PASS: Quillhaya identity, native credential save/restart/relocation, encrypted files, icon, sandbox and writing workflow.');
} catch (error) {
  console.error(processLog);
  throw error;
} finally {
  await close();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
