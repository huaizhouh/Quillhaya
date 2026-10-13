import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';

let app: ElectronApplication, page: Page, userData: string;
test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'twa-issue1012-2-'));
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), TWA_TEST_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [resolve('out/main/main.js')], env }); page = await app.firstWindow();
  await expect(page.getByTestId('writing-editor')).toBeVisible();
});
test.afterEach(async () => { await app.evaluate(({ app: main }) => main.exit(0)).catch(() => {}); });

async function modelServer() {
  const state = { requests: [] as { path: string; model?: string; text?: string }[], resident: new Set<string>(), missing: new Set<string>(),
    holdUnload: false, failUnload: false, holdAnalysis: false, severities: false, unload: [] as (() => void)[] };
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', chunk => { raw += chunk; }); req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {}, input = body.messages ? JSON.parse(body.messages[1].content) : undefined;
      state.requests.push({ path: req.url!, model: body.model, text: input?.original_text });
      const respond = (body: unknown, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (req.url === '/api/ps') { respond({ models: [...state.resident].map(name => ({ name })) }); return; }
      if (req.url === '/api/generate') {
        if (state.missing.has(body.model)) { respond({ error: 'model not found' }, 404); return; }
        if (state.failUnload) { respond({ error: 'unavailable' }, 503); return; }
        const release = () => { state.resident.delete(body.model); respond({ done: true, done_reason: 'unload' }); };
        if (state.holdUnload) state.unload.push(release); else release();
        return;
      }
      state.resident.add(body.model);
      if (state.holdAnalysis) return;
      const error = input.original_text.startsWith('He ');
      const result = { sentence_id: input.sentence_id, original_text: input.original_text, status: state.severities ? 'needs_revision' : 'good',
        overall_explanation_zh: state.severities ? (error ? '第三人称单数谓语应使用 goes。' : '原句没有语法错误，可按需简化表达。') : '表达良好，无需修改。',
        suggested_revision: state.severities ? (error ? 'He goes home.' : 'This idea is helpful.') : null,
        issues: state.severities ? [{ type: error ? 'grammar' : 'conciseness', severity: error ? 'error' : 'improvement', original_span: error ? 'go' : 'I think that', suggested_text: error ? 'goes' : '', explanation_zh: error ? '主语是第三人称单数。' : '可省略个人判断的引导语，属于可选优化。' }] : [], confidence: 0.9 };
      respond({ choices: [{ message: { content: JSON.stringify(result) } }] });
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const reply = await page.evaluate(async port => {
    const boot = await window.desktop.bootstrap(); if (!boot.ok) throw Error('bootstrap');
    const profile = { ...boot.value.settings.profiles[0], name: '测试模型', model: 'old-model', kind: 'ollama' as const, baseUrl: `http://127.0.0.1:${port}/v1` };
    return window.desktop.saveSettings({ ...boot.value.settings, profiles: [profile], debounceMs: 1600 }, {});
  }, port);
  expect(reply.ok).toBe(true); await page.reload(); await expect(page.getByTestId('writing-editor')).toBeVisible();
  return { state, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

test('issue1012_2: existing sentence edits wait for idle instead of submitting every 220 ms', async () => {
  const server = await modelServer();
  try {
    const editor = page.getByTestId('writing-editor'); await editor.fill('We learn.');
    await expect(page.getByTestId('feedback-card')).toContainText('表达良好');
    await editor.focus(); await page.keyboard.press('End'); await page.keyboard.press('ArrowLeft');
    await editor.pressSequentially(' together', { delay: 300 });
    expect(server.state.requests.filter(r => r.text).map(r => r.text)).toEqual(['We learn.']);
    await expect(page.getByTestId('feedback-card').locator('.card-status')).toContainText('保留上次意见');
    await expect.poll(() => server.state.requests.filter(r => r.text).map(r => r.text)).toEqual(['We learn.', 'We learn together.']);
    await expect(editor).toBeFocused(); await expect(editor).toHaveText('We learn together.');
  } finally { await server.close(); }
});

test('issue1012_2: objective errors and optional improvements have distinct marks in both themes', async () => {
  const server = await modelServer(); server.state.severities = true;
  try {
    await page.getByTestId('writing-editor').fill('He go home. I think that this idea is helpful.');
    const error = page.locator('.cm-content .sentence-error'), improvement = page.locator('.cm-content .sentence-improvement');
    await expect(error).toHaveText('He go home.'); await expect(improvement).toHaveText('I think that this idea is helpful.');
    await expect(error).toHaveAttribute('title', /客观错误/); await expect(improvement).toHaveAttribute('title', /可选优化/);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await expect(error).toHaveCSS('text-decoration-style', 'wavy'); await expect(improvement).toHaveCSS('text-decoration-style', 'dashed');
      const colors = await page.evaluate(() => ['.sentence-error', '.sentence-improvement'].map(selector => getComputedStyle(document.querySelector(selector)!).textDecorationColor));
      expect(colors[0]).not.toBe(colors[1]);
      await page.screenshot({ path: `docs/issue1012-2-marks-${theme}.png` });
    }
    await page.getByTestId('feedback-card').first().getByRole('button', { name: '忽略', exact: true }).click();
    await expect(error).toHaveCount(0); await expect(improvement).toHaveCount(1);
    await expect(page.getByTestId('writing-editor')).toHaveText('He go home. I think that this idea is helpful.');
  } finally { await server.close(); }
});

for (const route of ['window', 'quit', 'failed-renderer'] as const) {
  test(`issue1012_2: ${route} close waits for unload and retains the latest draft`, async () => {
    const server = await modelServer(); server.state.holdUnload = true; server.state.holdAnalysis = true;
    try {
      const text = 'We learn. We practice.';
      await page.getByTestId('writing-editor').fill(text); await expect.poll(() => server.state.requests.filter(r => r.text).length).toBe(1);
      if (route === 'quit') {
        await app.evaluate(({ dialog, app: main }) => {
          (globalThis as unknown as { closePrompts: number }).closePrompts = 0;
          dialog.showMessageBox = (async () => { (globalThis as unknown as { closePrompts: number }).closePrompts++; return { response: 2, checkboxChecked: false }; }) as typeof dialog.showMessageBox; main.quit();
        });
        await expect.poll(() => app.evaluate(() => (globalThis as unknown as { closePrompts: number }).closePrompts)).toBe(1);
        await expect(page.getByRole('button', { name: '新建文档' })).toBeEnabled();
        await expect(page.getByTestId('writing-editor')).toHaveText(text);
        expect(server.state.requests.some(r => r.path === '/api/generate')).toBe(false);
      }
      if (route === 'failed-renderer') {
        const reply = await page.evaluate(async text => window.desktop.rendererFailed({ id: crypto.randomUUID(), name: '未命名.md', text, mode: 'general', task: '', dirty: true }), text);
        expect(reply.ok).toBe(true);
      }
      await app.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox; });
      await app.evaluate(({ app: main, BrowserWindow }, route) => { if (route === 'window') BrowserWindow.getAllWindows()[0].close(); else main.quit(); }, route);
      await expect.poll(() => server.state.unload.length).toBe(1);
      expect(page.isClosed()).toBe(false); expect(server.state.resident.has('old-model')).toBe(true);
      if (route !== 'failed-renderer') await expect(page.getByRole('dialog', { name: '正在关闭应用' })).toBeVisible();
      // The queued second sentence never gets sent, even while shutdown is awaiting unloading.
      expect(server.state.requests.filter(r => r.text)).toHaveLength(1);
      const closed = route === 'window' ? page.waitForEvent('close') : app.waitForEvent('close');
      server.state.unload[0](); await closed;
      expect(server.state.resident.size).toBe(0);
      expect(server.state.requests.filter(r => r.path === '/api/generate')).toHaveLength(1);
      const draft = JSON.parse(await readFile(join(userData, 'draft.json'), 'utf8')); expect(draft.document.text).toBe(text);
    } finally { await server.close(); }
  });
}

test('issue1012_2: failed shutdown cleanup can return to writing and be retried', async () => {
  const server = await modelServer(); server.state.failUnload = true;
  try {
    await page.getByTestId('writing-editor').fill('We learn.'); await expect(page.getByTestId('feedback-card')).toContainText('表达良好');
    await app.evaluate(({ app: main, dialog }) => {
      dialog.showMessageBox = (async (...args: unknown[]) => { const options = args.at(-1) as { message: string }; return { response: options.message === '部分模型未能释放' ? 2 : 1, checkboxChecked: false }; }) as typeof dialog.showMessageBox;
      main.quit();
    });
    await expect.poll(() => server.state.requests.filter(r => r.path === '/api/generate').length).toBe(1);
    await expect(page.getByRole('dialog', { name: '正在关闭应用' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '恢复自动分析' })).toBeVisible();
    expect(server.state.resident.has('old-model')).toBe(true);
    await page.getByTestId('writing-editor').fill('We can still write.');
    server.state.failUnload = false;
    const closed = app.waitForEvent('close'); await app.evaluate(({ app: main }) => main.quit()); await closed;
    expect(server.state.resident.size).toBe(0);
    const draft = JSON.parse(await readFile(join(userData, 'draft.json'), 'utf8')); expect(draft.document.text).toBe('We can still write.');
  } finally { await server.close(); }
});

test('issue1012_2: changing the model ID retires an absent old model without hiding real release errors', async () => {
  const server = await modelServer();
  try {
    await page.getByTestId('writing-editor').fill('We learn.'); await expect(page.getByTestId('feedback-card')).toContainText('表达良好');
    server.state.missing.add('old-model'); server.state.resident.delete('old-model');
    await page.getByRole('button', { name: '打开设置' }).click(); await page.getByLabel('Model', { exact: true }).fill('new-model-mlx');
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect.poll(() => server.state.requests.filter(r => r.text).map(r => r.model)).toEqual(['old-model', 'new-model-mlx']);
    await expect(page.getByTestId('feedback-card')).toContainText('表达良好');
    await page.getByRole('button', { name: '停止并释放模型', exact: true }).click();
    await expect(page.locator('.toast')).toContainText('释放模型：new-model-mlx');
    await expect(page.locator('.toast')).toContainText('确认已不驻留：old-model');
    await expect(page.locator('.toast')).not.toContainText('失败');
    expect(server.state.resident.size).toBe(0); expect(server.state.requests.some(r => r.path === '/api/ps')).toBe(true);
    // The historical entry was removed after confirmation and will not recur.
    await page.getByRole('button', { name: '停止并释放模型', exact: true }).click();
    await expect(page.getByRole('button', { name: '停止并释放模型', exact: true })).toBeEnabled();
    expect(server.state.requests.filter(r => r.path === '/api/generate' && r.model === 'old-model')).toHaveLength(1);
  } finally { await server.close(); }
});
