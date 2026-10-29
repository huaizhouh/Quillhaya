// Launch the built .app using isolated data and Mock feedback, never real drafts.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect } from '@playwright/test';

assert.equal(process.platform, 'darwin', 'Run this smoke test on macOS after npm run pack:mac or npm run dist:mac.');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const bundle = resolve(pkg.build.directories.output, 'mac-arm64', `${pkg.build.productName}.app`);
const info = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(bundle, 'Contents/Info.plist')], { encoding: 'utf8' }));
assert.equal(info.CFBundleIdentifier, pkg.build.appId);
assert.equal(info.CFBundleDisplayName, pkg.build.productName);
assert.equal(info.LSApplicationCategoryType, pkg.build.mac.category);
assert.equal(info.CFBundleName, pkg.build.productName);
assert.equal(info.CFBundleExecutable, pkg.build.productName);
const bundledIcon = join(bundle, 'Contents/Resources', info.CFBundleIconFile);
assert.deepEqual(await readFile(bundledIcon), await readFile(resolve(pkg.build.mac.icon)), 'The bundle must contain the freshly prepared macOS ICNS.');
const directory = await mkdtemp(join(tmpdir(), 'twa-package-'));
const env = { ...process.env, TWA_TEST_USER_DATA: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
let app, legacy;
try {
  // Encrypt a synthetic string with the old namespace, then open the renamed bundle.
  legacy = await electron.launch({ args: [resolve('tests/fixtures/legacy-storage.cjs')], env: { ...env, TWA_TEST_USER_DATA: join(directory, 'legacy') } });
  const ciphertext = await legacy.evaluate(async ({ app, safeStorage }) => {
    await app.whenReady();
    if (app.commandLine.hasSwitch('use-mock-keychain')) throw new Error('Legacy compatibility requires the native Keychain.');
    return safeStorage.encryptString('synthetic-package-legacy').toString('base64');
  });
  const legacyClosed = legacy.waitForEvent('close', { timeout: 10_000 });
  await legacy.evaluate(({ app }) => app.exit(0)); await legacyClosed; legacy = undefined;
  app = await electron.launch({ executablePath: join(bundle, 'Contents/MacOS', info.CFBundleExecutable), env });
  const runtime = await app.evaluate(({ app, BrowserWindow }) => {
    const { sandbox, contextIsolation, nodeIntegration } = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    if (app.commandLine.hasSwitch('use-mock-keychain')) throw new Error('The packaged smoke test must use the native Keychain.');
    return { name: app.getName(), packaged: app.isPackaged, architecture: process.arch, directory: app.getPath('userData'), sandbox, contextIsolation, nodeIntegration };
  });
  assert.deepEqual(runtime, { name: 'Quillhaya', packaged: true, architecture: 'arm64', directory, sandbox: true, contextIsolation: true, nodeIntegration: false });
  const page = await app.firstWindow(), editor = page.getByTestId('writing-editor');
  await expect(editor).toBeVisible();
  assert.match(page.url(), /^file:/);
  await expect(page).toHaveTitle('Quillhaya - Writing Assistant');
  await expect(page.locator('.app-brand')).toHaveText('Quillhaya - Writing Assistant');
  await expect(page.locator('.app-brand img')).toHaveCount(0);
  assert.equal(await app.evaluate(({ safeStorage }, text) => safeStorage.decryptString(Buffer.from(text, 'base64')), ciphertext), 'synthetic-package-legacy');
  const boot = await page.evaluate(() => window.desktop.bootstrap());
  assert.equal(boot.ok, true);
  assert.equal(boot.value.settings.profiles.find(p => p.id === boot.value.settings.defaultProfileId).kind, 'mock');
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
} finally {
  if (legacy) await legacy.close().catch(() => {});
  if (app) {
    const closed = app.waitForEvent('close', { timeout: 10_000 });
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await closed;
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
console.log('PASS: Quillhaya arm64 bundle identity, prepared ICNS icon and text-only titlebar, legacy credential decryption, sandbox, local assets and writing workflow.');
