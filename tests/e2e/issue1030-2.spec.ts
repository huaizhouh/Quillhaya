import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultSettings, makeProfile } from '../../src/models/schema';
import { launchIsolated } from './isolated-electron';
import { writeEditor } from './editor';

let app: ElectronApplication, page: Page, directory: string, server: Server;
let analyses: number, releases: number, failRelease: boolean;
async function launch() {
  app = await launchIsolated(directory); page = await app.firstWindow();
  await expect(page.getByTestId('writing-editor')).toBeVisible();
}
async function quit() {
  const closed = app.waitForEvent('close');
  await app.evaluate(({ app, dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox;
    app.quit();
  });
  await closed;
}
const storedSettings = async () => JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8'));

test.beforeEach(async () => {
  analyses = 0; releases = 0; failRelease = false;
  server = createServer((req, res) => {
    let raw = ''; req.on('data', chunk => { raw += chunk; }); req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/generate') {
        releases++;
        if (failRelease) { res.writeHead(503); res.end(JSON.stringify({ error: 'test release failure' })); }
        else res.end(JSON.stringify({ done: true, done_reason: 'unload' }));
        return;
      }
      analyses++;
      const input = JSON.parse(JSON.parse(raw).messages[1].content);
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sentence_id: input.sentence_id,
        original_text: input.original_text, status: 'good', overall_explanation_zh: '表达良好，无需修改。', suggested_revision: null, issues: [], confidence: 0.9 }) } }] }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  directory = await mkdtemp(join(tmpdir(), 'quillhaya-pause-'));
  const profile = { ...makeProfile('ollama'), baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` };
  await writeFile(join(directory, 'settings.json'), JSON.stringify({ ...defaultSettings, debounceMs: 300, profiles: [profile], defaultProfileId: profile.id }));
  await writeFile(join(directory, 'draft.json'), JSON.stringify({ document: { id: crypto.randomUUID(), name: '未命名.md',
    text: 'Learning takes practice.', task: '', mode: 'discussion', dirty: true, hasFile: false }, path: null, savedText: '', savedAt: new Date().toISOString() }));
  await launch();
  await expect(page.getByTestId('feedback-card')).toContainText('表达良好');
  expect(analyses).toBe(1);
});
test.afterEach(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {});
  server?.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

for (const route of ['pause', 'stop', 'settings-close', 'settings-save', 'release-failure'] as const) {
  test(`issue1030_2: ${route} remains paused after restart until explicitly resumed`, async () => {
    if (route.startsWith('settings-')) {
      await page.getByRole('button', { name: '打开设置' }).click();
      await page.getByLabel('配置名称').fill('Unsaved name');
    }
    failRelease = route === 'release-failure';
    if (route === 'pause') await page.getByRole('button', { name: '暂停自动分析' }).click();
    else {
      await page.getByRole('button', { name: '停止并释放模型', exact: true }).last().click();
      await expect(page.getByRole('button', { name: '停止并释放模型', exact: true }).last()).toBeEnabled();
      expect(releases).toBe(1);
      if (failRelease) await expect(page.locator('.toast')).toContainText('释放模型失败');
    }
    if (route.startsWith('settings-')) {
      await expect(page.getByRole('checkbox', { name: '自动分析', exact: true })).not.toBeChecked();
      // Stopping saves only the pause, not unsaved fields in this dialog.
      expect((await storedSettings()).profiles[0].name).toBe('Ollama');
      await expect(page.getByLabel('配置名称')).toHaveValue('Unsaved name');
      await page.getByRole('button', { name: route === 'settings-save' ? '保存设置' : '关闭设置', exact: true }).click();
    }
    await expect(page.getByRole('button', { name: '恢复自动分析' })).toBeVisible();
    expect((await storedSettings()).autoAnalyze).toBe(false);
    const count = analyses;
    await quit(); await launch();
    await expect(page.getByRole('button', { name: '恢复自动分析' })).toBeVisible();
    await expect(page.getByTestId('writing-editor')).toHaveText('Learning takes practice.');
    // Exceeds both the 220 ms completion trigger and this fixture's 300 ms debounce.
    await page.waitForTimeout(800);
    expect(analyses).toBe(count);
    await writeEditor(page, 'Learning takes practice. We can keep writing.');
    await expect(page.locator('.draft-status')).toContainText('草稿已自动保存');
    expect(analyses).toBe(count);
    if (route === 'settings-save') {
      await page.getByRole('button', { name: '打开设置' }).click();
      await expect(page.getByLabel('配置名称')).toHaveValue('Unsaved name');
      await page.getByRole('checkbox', { name: '自动分析', exact: true }).check();
      await page.getByRole('button', { name: '保存设置', exact: true }).click();
    } else await page.getByRole('button', { name: '恢复自动分析' }).click();
    await expect.poll(() => analyses).toBe(count + 2);
    expect((await storedSettings()).autoAnalyze).toBe(true);
  });
}

test('issue1030_2: stopping and immediately quitting waits for the pause to reach disk', async () => {
  await app.evaluate(({ app, ipcMain }) => {
    const fs = process.getBuiltinModule('node:fs/promises');
    const path = process.getBuiltinModule('node:path').join(app.getPath('userData'), 'settings.json');
    ipcMain.removeHandler('settings:save');
    ipcMain.handle('settings:save', async (_event, { settings }) => {
      await new Promise(resolve => setTimeout(resolve, 700));
      await fs.writeFile(path, JSON.stringify(settings));
      return { ok: true, value: { settings, keyStatus: {}, analysisChanged: false } };
    });
  });
  await page.getByRole('button', { name: '停止并释放模型', exact: true }).click();
  await quit();
  expect((await storedSettings()).autoAnalyze).toBe(false);
  await launch();
  await expect(page.getByRole('button', { name: '恢复自动分析' })).toBeVisible();
  await page.waitForTimeout(800); expect(analyses).toBe(1);
});

test('issue1030_2: temporary settings pause and ordinary quit do not disable future analysis', async () => {
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByRole('button', { name: '关闭设置' }).click();
  await quit();
  expect((await storedSettings()).autoAnalyze).toBe(true);
  await launch();
  await expect.poll(() => analyses).toBe(2);
  await expect(page.getByRole('button', { name: '暂停自动分析' })).toBeVisible();
});
