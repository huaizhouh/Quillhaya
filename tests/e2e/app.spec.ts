import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { writeEditor } from './editor';

let app: ElectronApplication;
let page: Page;
let userData: string;
async function launch(directory: string) {
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), TWA_TEST_USER_DATA: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [resolve('out/main/main.js')], env });
  page = await app.firstWindow();
  await expect(page.getByTestId('writing-editor')).toBeVisible();
}
test.beforeEach(async () => { userData = await mkdtemp(join(tmpdir(), 'twa-e2e-')); await launch(userData); });
test.afterEach(async () => { if (app) await app.evaluate(({ app: main }) => main.exit(0)).catch(() => {}); });
async function write(text: string) { await writeEditor(page, text); }
async function chooseMockBehavior(value: string) {
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByLabel('模拟响应').selectOption(value);
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}

test('real sandboxed Electron window, native menus and isolated API', async () => {
  const security = await app.evaluate(({ BrowserWindow, Menu }) => {
    const preferences = (BrowserWindow.getAllWindows()[0].webContents as unknown as { getLastWebPreferences(): { contextIsolation: boolean; sandbox: boolean; nodeIntegration: boolean } }).getLastWebPreferences();
    const menu = Menu.getApplicationMenu();
    return { isolation: preferences.contextIsolation, sandbox: preferences.sandbox, node: preferences.nodeIntegration,
      fileMenu: menu?.items.find(i => i.label === '文件')?.submenu?.items.map(i => ({ label: i.label, accelerator: i.accelerator })) };
  });
  expect(security).toMatchObject({ isolation: true, sandbox: true, node: false });
  expect(security.fileMenu).toContainEqual({ label: '保存', accelerator: 'CmdOrCtrl+S' });
  expect(await page.evaluate(() => ({ require: typeof (window as unknown as { require?: unknown }).require, hasAnalyze: typeof window.desktop.analyze, hasFS: 'readFile' in window.desktop }))).toEqual({ require: 'undefined', hasAnalyze: 'function', hasFS: false });
  const invalid = await page.evaluate(() => window.desktop.analyze({ unexpected: true } as never));
  expect(invalid.ok).toBe(false);
});

test('adding, switching, deleting and saving model drafts does not crash or lose headers', async () => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  await page.getByLabel('配置名称').fill('Local review');
  await page.getByLabel('Provider', { exact: true }).selectOption('ollama');
  await page.getByLabel('配置名称').fill('Local review');
  await page.getByLabel('Model', { exact: true }).fill('gemma3:12b');
  await page.locator('summary').filter({ hasText: '附加 Headers' }).click();
  await page.getByLabel('JSON 对象').fill('{"X-Review":"saved-draft"}');
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  await page.getByRole('button', { name: '删除配置', exact: true }).click();
  await page.getByRole('button', { name: 'Local review', exact: true }).click();
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('gemma3:12b');
  await expect(page.getByLabel('JSON 对象')).toHaveValue(/saved-draft/);
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByRole('button', { name: 'Local review', exact: true }).click();
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('gemma3:12b');
  const boot = await page.evaluate(() => window.desktop.bootstrap());
  expect(boot.ok && boot.value.settings.profiles).toHaveLength(2);
  expect(boot.ok && boot.value.settings.defaultProfileId).toBe('mock'); expect(errors).toEqual([]);
  const closed = app.waitForEvent('close'); await app.evaluate(({ app: main }) => main.quit()); await closed;
});

test('appending a complete sentence and changing appearance retain completed feedback', async () => {
  await write('Learning takes practice.');
  await expect(page.getByTestId('feedback-card').first()).toContainText('表达良好');
  // MutationObserver captures transient repeats that a final-state assertion would miss.
  await page.evaluate(() => {
    const observed: string[] = [];
    (window as unknown as { feedbackStates: string[] }).feedbackStates = observed;
    new MutationObserver(() => observed.push(document.querySelector('[data-testid="feedback-card"] .card-status')?.textContent ?? '')).observe(document.querySelector('.feedback-card')!, { subtree: true, childList: true, characterData: true });
  });
  await page.getByTestId('writing-editor').focus(); await page.keyboard.press('End');
  await page.keyboard.insertText(' Practice helps us improve.');
  await expect(page.getByTestId('feedback-card').nth(1)).toContainText('表达良好');
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByLabel('主题').selectOption('dark');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByTestId('feedback-card').first()).toContainText('表达良好');
  const states = await page.evaluate(() => (window as unknown as { feedbackStates: string[] }).feedbackStates);
  expect(states).toEqual(states.map(() => '表达良好'));
});

test('a failed renderer can save its last snapshot and quit without a menu listener', async () => {
  const text = 'The latest recovery snapshot.';
  const result = await page.evaluate(async text => window.desktop.rendererFailed({ id: crypto.randomUUID(), name: '未命名.md', text, mode: 'general', task: '', dirty: true }), text);
  expect(result.ok).toBe(true);
  const closed = app.waitForEvent('close'); await app.evaluate(({ app: main }) => main.quit()); await closed;
  const draft = JSON.parse(await readFile(join(userData, 'draft.json'), 'utf8'));
  expect(draft.document.text).toBe(text);
});

test('continuous typing preserves focus and cursor while feedback arrives', async () => {
  await chooseMockBehavior('slow');
  const editor = page.getByTestId('writing-editor');
  await write('I am agree with you.');
  await expect(page.getByTestId('feedback-card').first()).toContainText('分析中');
  await page.keyboard.press('End');
  await page.keyboard.insertText(' I am still writing');
  const logicalCursor = () => page.evaluate(() => {
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('.cm-content')!);
    range.setEnd(selection.anchorNode!, selection.anchorOffset);
    return range.toString().length;
  });
  const cursor = await logicalCursor();
  await expect(page.getByRole('button', { name: '接受修改', exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(editor).toBeFocused();
  expect(await logicalCursor()).toBe(cursor);
  await expect(editor).toHaveText('I am agree with you. I am still writing');
});

test('suggestion only applies on click and is undoable; good sentences stay unchanged', async () => {
  await write('I am agree with you.');
  await expect(page.getByRole('button', { name: '接受修改', exact: true })).toBeVisible();
  await expect(page.getByTestId('writing-editor')).toHaveText('I am agree with you.');
  await app.evaluate(({ clipboard }) => { clipboard.writeText = async (text: string) => { (globalThis as unknown as { copiedText: string }).copiedText = text; }; });
  await page.getByRole('button', { name: '复制推荐句' }).click();
  expect(await app.evaluate(() => (globalThis as unknown as { copiedText: string }).copiedText)).toBe('I agree with you.');
  await page.getByRole('button', { name: '接受修改', exact: true }).click();
  await expect(page.getByTestId('writing-editor')).toHaveText('I agree with you.');
  await expect(page.getByTestId('writing-editor')).toBeFocused();
  await page.keyboard.press('Meta+z');
  await expect(page.getByTestId('writing-editor')).toHaveText('I am agree with you.');
  await write('Learning takes practice.');
  await expect(page.getByTestId('feedback-card')).toContainText('表达良好');
  await expect(page.getByRole('button', { name: '接受修改', exact: true })).toHaveCount(0);
});

test('editing during an in-flight request never shows or applies the old response', async () => {
  await chooseMockBehavior('slow');
  await write('He go home.'); await expect(page.getByTestId('feedback-card')).toContainText('分析中');
  await write('He goes home.');
  await expect(page.getByTestId('feedback-card')).toContainText('表达良好', { timeout: 10_000 });
  await expect(page.getByRole('button', { name: '接受修改', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('writing-editor')).toHaveText('He goes home.');
});

test('ignore stays hidden, collapse keeps analysis enabled, full review is explicit', async () => {
  await write('I am agree with you.');
  await page.getByRole('button', { name: '忽略', exact: true }).click();
  await expect(page.getByTestId('feedback-card')).toHaveCount(0);
  await page.getByTestId('writing-editor').click(); await page.keyboard.press('Meta+End'); await page.keyboard.insertText(' ');
  await expect(page.getByTestId('feedback-card')).toHaveCount(0);
  await page.getByRole('button', { name: '折叠反馈' }).click();
  await write('Learning takes practice.');
  await expect(page.getByLabel('AI Writing Feedback')).toHaveCount(0);
  await page.getByRole('button', { name: '展开反馈' }).click();
  await expect(page.getByTestId('feedback-card')).toContainText('表达良好');
  await page.getByRole('button', { name: '分析全文', exact: true }).click();
  await expect(page.getByTestId('feedback-card').first()).toContainText('全文');
  await expect(page.getByTestId('feedback-card').first()).toContainText('表达良好');
});

test('offline errors remain non-blocking and connection tests use the selected configuration', async () => {
  await chooseMockBehavior('error'); await write('Learning takes practice.');
  await expect(page.getByTestId('feedback-card')).toContainText('模拟连接失败');
  await page.getByTestId('writing-editor').focus(); await page.keyboard.press('Meta+End'); await page.keyboard.insertText(' We keep writing.');
  await expect(page.getByTestId('writing-editor')).toContainText('We keep writing.');
  await page.getByRole('button', { name: '打开设置' }).click(); await page.getByLabel('模拟响应').selectOption('normal');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Mock 演示可用');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByTestId('feedback-card').first()).toContainText('表达良好');
});

test('missing API key does not disable the editor; multiple configurations persist', async () => {
  const configured = await page.evaluate(async () => {
    const boot = await window.desktop.bootstrap(); if (!boot.ok) throw new Error('bootstrap failed');
    const profile = { ...boot.value.settings.profiles[0], id: 'missing-key', name: 'Missing Key', kind: 'custom' as const, auth: 'bearer' as const, envKey: '', baseUrl: 'http://127.0.0.1:65530/v1' };
    return window.desktop.saveSettings({ ...boot.value.settings, profiles: [...boot.value.settings.profiles, profile], defaultProfileId: profile.id }, {});
  });
  expect(configured.ok).toBe(true); await page.reload(); await expect(page.getByTestId('writing-editor')).toBeVisible();
  await write('We keep writing.'); await expect(page.getByTestId('feedback-card')).toContainText('尚未配置 API Key');
  await expect(page.getByTestId('writing-editor')).toBeFocused();
  await expect(page.getByLabel('当前模型')).toHaveValue('missing-key');
  await page.getByLabel('当前模型').selectOption('mock'); await expect(page.getByTestId('feedback-card')).toContainText('表达良好');
});

test('save, save-as, open, unsaved cancellation and draft recovery', async () => {
  const target = join(userData, 'essay.md');
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog;
    dialog.showMessageBox = (async () => ({ response: 2, checkboxChecked: false })) as typeof dialog.showMessageBox;
  }, target);
  await write('Learning takes practice.');
  await page.getByRole('button', { name: '新建文档' }).click();
  await expect(page.getByTestId('writing-editor')).toHaveText('Learning takes practice.');
  await page.getByRole('button', { name: '保存', exact: false }).first().click();
  await expect(page.locator('.document-name')).toHaveText('essay.md');
  expect(await readFile(target, 'utf8')).toBe('Learning takes practice.');
  await app.evaluate(({ Menu }) => { Menu.getApplicationMenu()?.items.find(i => i.label === '文件')?.submenu?.items.find(i => i.label === '另存为…')?.click(); });
  await expect(page.locator('.save-pill')).toHaveText('已保存');
  await page.getByRole('button', { name: '新建文档' }).click(); await expect(page.locator('.document-name')).toHaveText('未命名.md');
  await page.getByRole('button', { name: '打开文档' }).click(); await expect(page.getByTestId('writing-editor')).toHaveText('Learning takes practice.');
  await write('Unsaved draft survives a restart.');
  await expect(page.locator('.draft-status')).toContainText('草稿已自动保存');
  await app.evaluate(({ app: main }) => main.exit(0));
  await launch(userData);
  await expect(page.getByTestId('writing-editor')).toHaveText('Unsaved draft survives a restart.');
  await expect(page.locator('.restore-banner')).toBeVisible();
  expect(await readFile(target, 'utf8')).toBe('Learning takes practice.');
});

test('captures the implemented writing workspace in light and dark themes', async () => {
  await page.getByRole('button', { name: '体验示例反馈' }).click();
  await expect(page.getByRole('button', { name: '接受修改', exact: true })).toBeVisible();
  await expect(page.locator('.feedback-summary')).toContainText('4 句表达良好', { timeout: 10_000 });
  await page.getByRole('button', { name: '写作题目与情境', exact: false }).click();
  await mkdir(resolve('docs'), { recursive: true });
  await page.screenshot({ path: resolve('docs/workspace-light.png') });
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByLabel('主题', { exact: false }).selectOption('dark');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: '接受修改', exact: true })).toBeVisible();
  await page.screenshot({ path: resolve('docs/workspace-dark.png') });
});

test('native quit can be cancelled and then closes after preserving the latest draft', async () => {
  await write('My latest unsaved sentence.');
  await app.evaluate(({ dialog, app: main }) => {
    dialog.showMessageBox = (async () => ({ response: 2, checkboxChecked: false })) as typeof dialog.showMessageBox;
    main.quit();
  });
  await expect(page.getByTestId('writing-editor')).toHaveText('My latest unsaved sentence.');
  await expect(page.locator('.draft-status')).toContainText('草稿已自动保存');
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox; });
  const closed = app.waitForEvent('close');
  await app.evaluate(({ app: main }) => main.quit());
  await closed;
  const draft = JSON.parse(await readFile(join(userData, 'draft.json'), 'utf8'));
  expect(draft.document.text).toBe('My latest unsaved sentence.');
});

test('real macOS safeStorage round trip is encrypted and never exposed by bootstrap', async () => {
  const encrypted = await app.evaluate(({ safeStorage }) => {
    const available = safeStorage.isEncryptionAvailable();
    if (!available) return { available, roundTrip: false, encrypted: false };
    const value = 'synthetic-storage-validation';
    const ciphertext = safeStorage.encryptString(value);
    return { available, roundTrip: safeStorage.decryptString(ciphertext) === value, encrypted: !ciphertext.includes(Buffer.from(value)) };
  });
  expect(encrypted).toEqual({ available: true, roundTrip: true, encrypted: true });
  const bootstrap = await page.evaluate(() => window.desktop.bootstrap());
  expect(JSON.stringify(bootstrap)).not.toContain('synthetic-storage-validation');
});

test('main process talks to a real HTTP compatible endpoint and falls back from JSON mode', async () => {
  const received: Record<string, unknown>[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw); received.push(body);
      res.setHeader('Content-Type', 'application/json');
      if (body.response_format) { res.writeHead(400); res.end(JSON.stringify({ error: 'response_format unsupported' })); return; }
      const input = JSON.parse(body.messages[1].content);
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sentence_id: input.sentence_id, original_text: input.original_text, status: 'good', overall_explanation_zh: '表达良好，无需修改。', suggested_revision: null, issues: [], confidence: 0.8 }) } }] }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const result = await page.evaluate(async port => {
      const boot = await window.desktop.bootstrap(); if (!boot.ok) throw new Error('bootstrap');
      const profile = { ...boot.value.settings.profiles[0], id: 'http-test', name: 'Local HTTP test', kind: 'custom' as const, baseUrl: `http://127.0.0.1:${port}/v1` };
      return window.desktop.saveSettings({ ...boot.value.settings, profiles: [profile], defaultProfileId: profile.id }, {});
    }, address.port);
    expect(result.ok).toBe(true); await page.reload(); await expect(page.getByTestId('writing-editor')).toBeVisible();
    await write('Learning takes practice.'); await expect(page.getByTestId('feedback-card')).toContainText('表达良好');
    expect(received).toHaveLength(3); expect(received[0]).toHaveProperty('response_format'); expect(received[1]).toHaveProperty('response_format'); expect(received[2]).not.toHaveProperty('response_format');
    const payload = JSON.stringify(received); expect(payload).not.toContain('document_id'); expect(payload).not.toContain(userData);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('Ollama reviews appear queued until their actual HTTP request starts', async () => {
  const received: string[] = []; const releases: (() => void)[] = [];
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw), input = JSON.parse(body.messages[1].content);
      received.push(input.original_text);
      releases.push(() => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sentence_id: input.sentence_id, original_text: input.original_text, status: 'good', overall_explanation_zh: '表达良好，无需修改。', suggested_revision: null, issues: [], confidence: 0.9 }) } }] })); });
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const saved = await page.evaluate(async port => {
      const boot = await window.desktop.bootstrap(); if (!boot.ok) throw Error('bootstrap');
      const p = { ...boot.value.settings.profiles[0], kind: 'ollama' as const, baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model' };
      return window.desktop.saveSettings({ ...boot.value.settings, profiles: [p] }, {});
    }, port);
    expect(saved.ok).toBe(true); await page.reload();
    await write('Learning takes practice. Practice helps us improve.');
    await expect(page.getByTestId('feedback-card').nth(0)).toContainText('分析中');
    await expect(page.getByTestId('feedback-card').nth(1)).toContainText('排队中');
    await expect.poll(() => received.length).toBe(1);
    releases[0]();
    await expect(page.getByTestId('feedback-card').nth(0)).toContainText('表达良好');
    await expect(page.getByTestId('feedback-card').nth(1)).toContainText('分析中');
    await expect.poll(() => received.length).toBe(2); releases[1]();
    await expect(page.getByTestId('feedback-card').nth(1)).toContainText('表达良好');
    expect(received).toEqual(['Learning takes practice.', 'Practice helps us improve.']);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('issue1012: settings headings stay horizontal and task height uses an accessible drag handle', async () => {
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByLabel('Provider', { exact: true }).selectOption('ollama');
  const heading = page.locator('.section-label').filter({ hasText: '编辑与外观' });
  await heading.scrollIntoViewIfNeeded();
  const bounds = await heading.evaluate(el => {
    const node = el.firstChild!, range = document.createRange();
    range.setStart(node, 0); range.setEnd(node, 1); const first = range.getBoundingClientRect();
    range.setStart(node, node.textContent!.length - 1); range.setEnd(node, node.textContent!.length); const last = range.getBoundingClientRect();
    return { first: first.top, last: last.top, width: el.getBoundingClientRect().width };
  });
  expect(Math.abs(bounds.last - bounds.first)).toBeLessThan(2); expect(bounds.width).toBeGreaterThan(250);
  await page.screenshot({ path: 'docs/issue1012-settings.png' });
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.getByRole('button', { name: /写作题目与情境/ }).click();
  const input = page.getByRole('textbox', { name: '写作题目与情境' });
  await expect(input).toHaveCSS('resize', 'none');
  const handle = page.getByRole('separator', { name: '调整题目区域高度' });
  await handle.focus(); await page.keyboard.press('ArrowDown'); await expect(handle).toHaveAttribute('aria-valuenow', '112');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 35); await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-valuenow', '147');
});

test('issue1012: timer pauses, resumes and resets independently of typing', async () => {
  await write('I am writing');
  const timer = page.getByTestId('writing-timer'); await expect(timer).not.toHaveText('00:00');
  await page.getByRole('button', { name: '暂停计时', exact: true }).click();
  const frozen = await timer.textContent(); await write('I keep writing while paused');
  await expect(page.getByRole('button', { name: '开始或继续计时' })).toBeVisible(); await expect(timer).toHaveText(frozen!);
  await page.getByRole('button', { name: '开始或继续计时' }).click();
  await expect(page.getByRole('button', { name: '暂停计时', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '复位计时' }).click();
  await expect(timer).toHaveText('00:00'); await expect(page.getByRole('button', { name: '开始或继续计时' })).toBeVisible();
});

test('issue1012: accepting one correction keeps neighboring feedback until manual reevaluation', async () => {
  await write('I am agree with you. Practice helps us improve.');
  const cards = page.getByTestId('feedback-card');
  await expect(cards.nth(0)).toContainText('建议修改'); await expect(cards.nth(1)).toContainText('表达良好');
  await cards.nth(0).getByRole('button', { name: '接受修改', exact: true }).click();
  await expect(cards.nth(1)).toContainText('上下文已变化'); await expect(cards.nth(1).locator('.card-status')).toHaveText('表达良好');
  await expect(page.getByTestId('writing-editor')).toBeFocused();
  await page.getByRole('button', { name: /写作题目与情境/ }).click();
  await page.getByRole('button', { name: '暂停计时', exact: true }).click();
  await expect(cards.nth(0)).toContainText('表达良好');
  await page.screenshot({ path: 'docs/issue1012-workspace.png' });
  await cards.nth(1).getByRole('button', { name: '重新评估', exact: true }).click();
  await expect(cards.nth(1)).toContainText('表达良好'); // The earlier explanation stays visible during refresh.
  await expect(cards.nth(1)).not.toContainText('上下文已变化'); await expect(cards.nth(1).locator('.card-status')).toHaveText('表达良好');
});

async function modelTestServer(hold: (model: string, sentenceId: string) => boolean) {
  const requests: { path: string; model: string; sentenceId?: string }[] = [];
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', chunk => { raw += chunk; }); req.on('end', () => {
      const body = JSON.parse(raw), input = body.messages ? JSON.parse(body.messages[1].content) : undefined;
      requests.push({ path: req.url!, model: body.model, sentenceId: input?.sentence_id });
      if (req.url === '/api/generate') {
        expect(body).toEqual({ model: body.model, keep_alive: 0, stream: false });
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ done: true, done_reason: 'unload' })); return;
      }
      if (hold(body.model, input.sentence_id)) return;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sentence_id: input.sentence_id, original_text: input.original_text, status: 'good', overall_explanation_zh: '表达良好，无需修改。', suggested_revision: null, issues: [], confidence: 0.9 }) } }] }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const saved = await page.evaluate(async port => {
    const boot = await window.desktop.bootstrap(); if (!boot.ok) throw Error('bootstrap');
    const profiles = ['background', 'selected', 'untouched'].map(id => ({ ...boot.value.settings.profiles[0], id, name: id, kind: 'ollama' as const, model: id, baseUrl: `http://127.0.0.1:${port}/v1` }));
    return window.desktop.saveSettings({ ...boot.value.settings, profiles, defaultProfileId: 'background' }, {});
  }, port);
  expect(saved.ok).toBe(true); await page.reload(); await expect(page.getByTestId('writing-editor')).toBeVisible();
  return { requests, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

test('issue1012: connection test targets only the selected profile and unloads it after success', async () => {
  const server = await modelTestServer(model => model === 'background');
  try {
    await write('Learning takes practice. Practice helps us improve.');
    await expect.poll(() => server.requests.length).toBe(1);
    await page.getByRole('button', { name: '打开设置' }).click();
    await page.getByRole('button', { name: 'selected', exact: true }).click();
    await page.getByRole('button', { name: '测试连接', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('测试模型已从 Ollama 内存中释放');
    expect(server.requests.filter(r => r.sentenceId === 'connection-test').map(r => r.model)).toEqual(['selected']);
    expect(server.requests.filter(r => r.path === '/api/generate').map(r => r.model)).toEqual(['selected']);
    expect(server.requests.filter(r => r.model === 'background')).toHaveLength(1); expect(server.requests.some(r => r.model === 'untouched')).toBe(false);
  } finally { await server.close(); }
});

test('issue1012: cancelling a connection test unlocks settings after unloading its model', async () => {
  const server = await modelTestServer(() => true);
  try {
    await page.getByRole('button', { name: '打开设置' }).click(); await page.getByRole('button', { name: 'selected', exact: true }).click();
    await page.getByRole('button', { name: '测试连接', exact: true }).click();
    await expect.poll(() => server.requests.length).toBe(1);
    await expect(page.getByRole('button', { name: 'untouched', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '取消测试', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('分析已取消');
    await expect(page.getByRole('button', { name: '测试连接', exact: true })).toBeEnabled();
    expect(server.requests.map(r => [r.path, r.model])).toEqual([['/v1/chat/completions', 'selected'], ['/api/generate', 'selected']]);
  } finally { await server.close(); }
});

test('issue1012: stop cancels active and queued inference, unloads and prevents automatic reload', async () => {
  const server = await modelTestServer(() => true);
  try {
    await write('Learning takes practice. Practice helps us improve.');
    await expect(page.getByTestId('feedback-card').nth(1)).toContainText('排队中');
    await expect.poll(() => server.requests.length).toBe(1);
    await page.getByRole('button', { name: '停止并释放模型', exact: true }).click();
    await expect(page.locator('.toast')).toContainText('已停止请求并释放模型：background');
    await expect(page.getByRole('button', { name: '恢复自动分析' })).toBeVisible();
    await write('Learning takes practice. Practice helps us improve. We can continue writing.');
    await expect(page.locator('.draft-status')).toContainText('草稿已自动保存');
    expect(server.requests.map(r => [r.path, r.model])).toEqual([['/v1/chat/completions', 'background'], ['/api/generate', 'background']]);
    await expect(page.getByTestId('writing-editor')).toBeFocused();
  } finally { await server.close(); }
});
