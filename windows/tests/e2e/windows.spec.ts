import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchIsolated } from '../isolated-electron';
import { writeEditor } from '../../.workspace/tests/e2e/editor';

let app: ElectronApplication, page: Page, directory: string;
async function control(key: string) {
  // CDP keyboard events bypass Electron's native menu accelerator processing.
  await app.evaluate(({ BrowserWindow }, key) => {
    const window = BrowserWindow.getAllWindows()[0]; window.focus();
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: ['control'] });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: ['control'] });
  }, key);
}
test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'quillhaya-win-中文 '));
  app = await launchIsolated(directory); page = await app.firstWindow();
  await expect(page.getByTestId('writing-editor')).toBeVisible();
});
test.afterEach(async () => {
  if (app && app.process().exitCode === null) {
    const closed = app.waitForEvent('close'); await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await closed;
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test('Windows Ctrl shortcuts, native minimize/maximize and cancel-close keep editing available', async () => {
  await expect(page.locator('.titlebar')).toHaveCSS('padding-left', '22px');
  await expect(page.getByRole('button', { name: '打开设置' })).toHaveAttribute('title', '设置 Ctrl+,');
  await control(',');
  await expect(page.getByRole('dialog')).toBeVisible();
  const name = page.getByLabel('配置名称', { exact: true });
  await name.focus(); await page.keyboard.press('Control+A'); await page.keyboard.insertText('Windows model');
  await expect(name).toHaveValue('Windows model');
  await page.keyboard.press('Control+z'); await expect(name).not.toHaveValue('Windows model');
  await page.getByRole('button', { name: '关闭设置' }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.restore(); w.maximize(); });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.focus(); });
  await writeEditor(page, 'My latest Windows draft.');
  await app.evaluate(({ dialog, BrowserWindow }) => {
    dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false });
    BrowserWindow.getAllWindows()[0].close();
  });
  await expect(page.getByTestId('writing-editor')).toHaveText('My latest Windows draft.');
  await writeEditor(page, 'I can still write after cancelling close.');
  await expect(page.getByTestId('writing-editor')).toHaveText('I can still write after cancelling close.');
});

test('Windows Chinese/space paths and CRLF survive open, Ctrl+S, conflict cancellation and retry', async () => {
  const path = join(directory, '中文 writing file.md');
  await writeFile(path, '\uFEFFHello world.\r\n中文说明。\r\n');
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, path);
  await control('O');
  await expect(page.getByTestId('writing-editor')).toContainText('中文说明。');
  await writeEditor(page, 'Changed writing.\n中文修改。');
  await control('S');
  await expect.poll(() => readFile(path, 'utf8')).toBe('\uFEFFChanged writing.\r\n中文修改。');
  await writeFile(path, 'External change.');
  await writeEditor(page, 'My new writing.');
  await app.evaluate(({ dialog }) => {
    (globalThis as unknown as { conflictShown: boolean }).conflictShown = false;
    dialog.showMessageBox = async () => { (globalThis as unknown as { conflictShown: boolean }).conflictShown = true; return { response: 0, checkboxChecked: false }; };
  });
  await control('S');
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { conflictShown: boolean }).conflictShown)).toBe(true);
  expect(await readFile(path, 'utf8')).toBe('External change.');
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  await control('S');
  await expect.poll(() => readFile(path, 'utf8')).toBe('\uFEFFMy new writing.');
});

for (const scale of [1, 1.25, 1.5]) test(`Windows layout and synthetic IME composition at ${scale * 100}%`, async () => {
  await app.evaluate(({ BrowserWindow }, zoom) => {
    const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(940, 720); w.webContents.setZoomFactor(zoom);
  }, scale);
  await writeEditor(page, 'He go home.');
  await expect(page.getByRole('button', { name: '收藏反馈', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '收藏反馈', exact: true }).click();
  await page.getByRole('button', { name: '打开收藏夹' }).click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const dialog = page.getByRole('dialog', { name: '收藏夹', exact: true });
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const bounds = await dialog.evaluate(el => {
      const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0); expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.width); expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
    // CDP page.screenshot crops Electron captures when page zoom is not 100%.
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
    await writeFile(join(process.cwd(), `reports/screenshots/windows-${scale}-${theme}.png`), Buffer.from(png, 'base64'));
  }
  await page.getByRole('button', { name: '关闭收藏夹' }).click();
  await page.getByTestId('writing-editor').focus(); await page.keyboard.press('Control+End');
  await app.evaluate(async ({ BrowserWindow }) => {
    const debug = BrowserWindow.getAllWindows()[0].webContents.debugger;
    debug.attach('1.3');
    try {
      await debug.sendCommand('Input.imeSetComposition', { text: '中文输入', selectionStart: 4, selectionEnd: 4 });
      await debug.sendCommand('Input.insertText', { text: '中文输入' });
    } finally { debug.detach(); }
  });
  await expect(page.getByTestId('writing-editor')).toContainText('中文输入');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const footer = await page.locator('.editor-footer').boundingBox();
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight) + 0.1);
  const writing = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await writeFile(join(process.cwd(), `reports/screenshots/windows-${scale}-writing.png`), Buffer.from(writing, 'base64'));
  await page.getByRole('button', { name: '打开设置' }).click();
  const settings = await page.getByRole('dialog').boundingBox();
  expect(settings!.x).toBeGreaterThanOrEqual(0); expect(settings!.y).toBeGreaterThanOrEqual(0);
  expect(settings!.x + settings!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth) + 0.1);
  expect(settings!.y + settings!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight) + 0.1);
  expect(await page.locator('.settings-fields').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(page.getByRole('button', { name: '保存设置', exact: true })).toBeInViewport();
});
