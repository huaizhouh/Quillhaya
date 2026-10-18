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
const directory = await mkdtemp(join(tmpdir(), 'twa-package-'));
const env = { ...process.env, TWA_TEST_USER_DATA: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
let app;
try {
  app = await electron.launch({ executablePath: join(bundle, 'Contents/MacOS', info.CFBundleExecutable), env });
  const runtime = await app.evaluate(({ app, BrowserWindow }) => {
    const { sandbox, contextIsolation, nodeIntegration } = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { packaged: app.isPackaged, architecture: process.arch, directory: app.getPath('userData'), sandbox, contextIsolation, nodeIntegration };
  });
  assert.deepEqual(runtime, { packaged: true, architecture: 'arm64', directory, sandbox: true, contextIsolation: true, nodeIntegration: false });
  const page = await app.firstWindow(), editor = page.getByTestId('writing-editor');
  await expect(editor).toBeVisible();
  assert.match(page.url(), /^file:/);
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
  if (app) {
    const closed = app.waitForEvent('close', { timeout: 10_000 });
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await closed;
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
console.log('PASS: packaged arm64 app identity, sandbox, local assets, Mock feedback, ignore/reevaluate and accept.');
