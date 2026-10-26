import { test, expect, _electron as electron, type ElectronApplication, type Page, type Locator } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { writeEditor } from './editor';

let app: ElectronApplication, page: Page, userData: string;
type MenuState = { contextMenu?: Electron.Menu; nativePopup: Electron.Menu['popup']; calls: string[] };
async function launch() {
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), TWA_TEST_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [resolve('out/main/main.js')], env }); page = await app.firstWindow();
  await expect(page.getByTestId('writing-editor')).toBeVisible();
  await app.evaluate(({ Menu }) => {
    const state = globalThis as unknown as MenuState; state.calls = []; state.nativePopup = Menu.prototype.popup;
    // Observe native menus without opening an OS popup that would block the runner.
    Menu.prototype.popup = function () { state.contextMenu = this; };
  });
}
async function stop() { const closed = app.waitForEvent('close'); await app.evaluate(({ app: main }) => main.exit(0)); await closed; }
test.beforeEach(async () => { userData = await mkdtemp(join(tmpdir(), 'twa-issue1022-')); await launch(); });
test.afterEach(async () => { await stop().catch(() => {}); await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); });
async function menuOn(target: Locator, position?: { x: number; y: number }) {
  await app.evaluate(() => { (globalThis as unknown as MenuState).contextMenu = undefined; });
  await target.click({ button: 'right', position });
  await expect.poll(() => app.evaluate(() => Boolean((globalThis as unknown as MenuState).contextMenu))).toBe(true);
  return app.evaluate(() => (globalThis as unknown as MenuState).contextMenu!.items.map(i => ({ label: i.label, enabled: i.enabled })));
}
async function choose(label: string) {
  await app.evaluate(({ BrowserWindow }, label) => {
    const item = (globalThis as unknown as MenuState).contextMenu!.items.find(i => i.label === label)!;
    if (!item.enabled) throw new Error(`Disabled menu item: ${label}`);
    item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent);
  }, label);
}
async function selectFirst(length: number) {
  await page.getByTestId('writing-editor').focus(); await page.keyboard.press('Meta+ArrowUp');
  await page.keyboard.down('Shift'); for (let i = 0; i < length; i++) await page.keyboard.press('ArrowRight'); await page.keyboard.up('Shift');
}

test('issue1022: native edit and Look Up actions work in editor, read-only feedback and settings', async () => {
  await writeEditor(page, 'Learning takes practice.');
  await expect(page.locator('.feedback-card.good')).toHaveCount(1);
  await selectFirst(8);
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    // Do not replace the user's clipboard or open the OS dictionary in automation.
    for (const name of ['cut', 'copy', 'paste', 'pasteAndMatchStyle', 'showDefinitionForSelection'] as const)
      contents[name] = () => { (globalThis as unknown as MenuState).calls.push(name); };
  });
  const line = page.locator('.cm-line').first();
  const items = await menuOn(line, { x: 12, y: 10 });
  expect(items.map(i => i.label)).toEqual(expect.arrayContaining(['查询（Look Up）', '剪切', '复制', '粘贴', '粘贴并匹配样式', '全选', '定位到写作反馈']));
  for (const label of ['查询（Look Up）', '剪切', '复制', '粘贴', '粘贴并匹配样式']) await choose(label);
  expect(await app.evaluate(() => (globalThis as unknown as MenuState).calls)).toEqual(['showDefinitionForSelection', 'cut', 'copy', 'paste', 'pasteAndMatchStyle']);
  await choose('全选'); await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim())).toBe('Learning takes practice.');
  await page.keyboard.insertText('Learning takes practice.'); await expect(page.getByTestId('writing-editor')).toHaveText('Learning takes practice.');
  const description = page.locator('.feedback-card .card-description');
  await description.evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); const s = window.getSelection()!; s.removeAllRanges(); s.addRange(range); });
  const readonly = await menuOn(description, { x: 10, y: 8 });
  expect(readonly.map(i => i.label)).toContain('复制'); expect(readonly.map(i => i.label)).not.toContain('剪切'); expect(readonly.map(i => i.label)).not.toContain('定位到写作反馈');
  await page.getByRole('button', { name: '打开设置' }).click();
  const name = page.getByLabel('配置名称', { exact: true }); await name.focus(); await page.keyboard.press('Meta+A');
  const fields = await menuOn(name, { x: 12, y: 10 });
  expect(fields.map(i => i.label)).toContain('粘贴'); expect(fields.map(i => i.label)).not.toContain('定位到写作反馈');
  await page.getByLabel('Provider', { exact: true }).selectOption('custom');
  const key = page.getByLabel('API Key', { exact: true }); await key.fill('synthetic-secret'); await key.focus(); await page.keyboard.press('Meta+A');
  const password = await menuOn(key, { x: 12, y: 10 }); expect(password.map(i => i.label)).not.toContain('查询（Look Up）');
});

test('issue1022: the real macOS context menu opens and closes without blocking the editor', async () => {
  await writeEditor(page, 'Learning takes practice.'); await selectFirst(8);
  await app.evaluate(({ Menu }) => {
    const state = globalThis as unknown as MenuState;
    Menu.prototype.popup = function (options) {
      state.contextMenu = this;
      this.once('menu-will-show', () => state.calls.push('shown'));
      this.once('menu-will-close', () => state.calls.push('closed'));
      state.nativePopup.call(this, options);
    };
  });
  await menuOn(page.locator('.cm-line'), { x: 12, y: 10 });
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as MenuState).calls)).toContain('shown');
  await app.evaluate(({ BrowserWindow }) => (globalThis as unknown as MenuState).contextMenu!.closePopup(BrowserWindow.getAllWindows()[0]));
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as MenuState).calls)).toContain('closed');
  await writeEditor(page, 'The editor still responds.');
});

test('issue1022: a single selected sentence locates feedback, including collapsed and ignored cards; cross-sentence selection omits it', async () => {
  const text = Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} is ready.`).join(' ');
  await page.getByRole('button', { name: '暂停自动分析' }).click(); await writeEditor(page, text);
  await expect(page.getByTestId('feedback-card')).toHaveCount(12);
  await selectFirst('Sentence'.length);
  const line = page.locator('.cm-line').first();
  await page.locator('.feedback-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await menuOn(line, { x: 12, y: 10 }); await choose('定位到写作反馈');
  const first = page.getByTestId('feedback-card').first(); await expect(first).toHaveClass(/located/); await expect(first).toBeInViewport();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('Sentence');
  await page.getByRole('button', { name: '折叠反馈' }).click();
  await menuOn(line, { x: 12, y: 10 }); await choose('定位到写作反馈'); await expect(first).toBeInViewport();
  await selectFirst('Sentence number 1 is ready. Sentence'.length);
  const cross = await menuOn(line, { x: 12, y: 10 }); expect(cross.map(i => i.label)).not.toContain('定位到写作反馈');
  // A right click in a different sentence uses its position, not an old selection.
  await writeEditor(page, 'I am agree with you.\nLearning takes practice.');
  await page.getByTestId('feedback-card').first().getByRole('button', { name: '重新评估' }).click();
  await expect(page.locator('.feedback-card.needs_revision')).toHaveCount(1);
  await page.getByTestId('feedback-card').first().getByRole('button', { name: '忽略', exact: true }).click();
  await page.locator('.cm-line').first().click({ position: { x: 30, y: 8 } });
  await menuOn(page.locator('.cm-line').first(), { x: 30, y: 8 }); await choose('定位到写作反馈');
  await expect(page.locator('.feedback-card.ignored')).toHaveClass(/located/);
  await menuOn(page.locator('.cm-line').nth(1), { x: 30, y: 8 }); await choose('定位到写作反馈');
  await expect(page.getByTestId('feedback-card').nth(1)).toHaveClass(/located/);
  await expect(page.getByTestId('writing-editor')).toHaveText('I am agree with you.Learning takes practice.');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25));
  await menuOn(page.locator('.cm-line').nth(1), { x: 30, y: 8 }); await choose('定位到写作反馈');
  await expect(page.getByTestId('feedback-card').nth(1)).toHaveClass(/located/);
  await writeEditor(page, '# Heading.\nLearning takes practice.');
  const excluded = await menuOn(page.locator('.cm-line').first(), { x: 30, y: 8 }); expect(excluded.map(i => i.label)).not.toContain('定位到写作反馈');
});

test('issue1022: per-model system prompts survive switching, saving and restart, and reach test, sentence and document requests', async () => {
  const requests: { model: string; messages: { role: string; content: string }[] }[] = [];
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', chunk => { raw += chunk; }); req.on('end', () => {
      const body = JSON.parse(raw); requests.push(body); const input = JSON.parse(body.messages[1].content);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sentence_id: input.sentence_id, original_text: input.original_text, status: 'good', overall_explanation_zh: '表达良好。', suggested_revision: null, issues: [], confidence: 0.9 }) } }] }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
    await page.getByRole('button', { name: '暂停自动分析' }).click();
    await page.getByRole('button', { name: '打开设置' }).click();
    const configure = async (name: string, prompt: string) => {
      await page.getByLabel('Provider', { exact: true }).selectOption('custom');
      await page.getByLabel('配置名称', { exact: true }).fill(name); await page.getByLabel('Base URL', { exact: true }).fill(url);
      await page.getByLabel('Model', { exact: true }).fill(name); await page.getByLabel('认证方式', { exact: true }).selectOption('none');
      await page.getByLabel('额外系统提示词', { exact: true }).fill(prompt);
    };
    const a = '采用英式英语。\n解释简洁。', b = '使用美式英语。';
    await configure('Model A', a);
    await page.getByRole('button', { name: '添加模型', exact: true }).click(); await configure('Model B', b);
    await page.locator('.profile-list').getByRole('button', { name: 'Model A', exact: true }).click();
    await expect(page.getByLabel('额外系统提示词', { exact: true })).toHaveValue(a);
    await page.screenshot({ path: '/private/tmp/twa-issue1022-settings.png' });
    await page.getByRole('button', { name: '测试连接', exact: true }).click(); await expect(page.locator('.settings-footer [role=status]')).toContainText('连接成功');
    expect(requests[0].messages[0].content).toContain(a);
    await page.getByRole('button', { name: '保存设置', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
    const stored = JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8'));
    expect(stored.profiles.map((p: { extraSystemPrompt: string }) => p.extraSystemPrompt)).toEqual([a, b]);
    await stop(); await launch();
    await page.getByRole('button', { name: '打开设置' }).click(); await expect(page.getByLabel('额外系统提示词', { exact: true })).toHaveValue(a);
    await page.locator('.profile-list').getByRole('button', { name: 'Model B', exact: true }).click(); await expect(page.getByLabel('额外系统提示词', { exact: true })).toHaveValue(b);
    await page.getByRole('button', { name: '关闭设置' }).click();
    await writeEditor(page, 'Learning takes practice.');
    await page.getByTestId('feedback-card').getByRole('button', { name: '重新评估' }).click(); await expect(page.locator('.feedback-card.good')).toHaveCount(1);
    expect(requests.at(-1)!.messages[0].content).toContain(a);
    await page.getByLabel('当前模型', { exact: true }).selectOption({ label: 'Model B' });
    await page.getByRole('button', { name: '分析全文', exact: true }).click(); await expect(page.getByTestId('feedback-card').first()).toHaveClass(/good/);
    expect(requests.at(-1)!.model).toBe('Model B'); expect(requests.at(-1)!.messages[0].content).toContain(b); expect(requests.at(-1)!.messages[0].content).not.toContain(a);
    await page.getByRole('button', { name: '打开设置' }).click(); await page.getByLabel('额外系统提示词', { exact: true }).fill('');
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await page.getByTestId('feedback-card').last().getByRole('button', { name: '重新评估' }).click();
    await expect.poll(() => requests.at(-1)!.messages[0].content.includes('用户为当前模型添加的系统提示词')).toBe(false);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
