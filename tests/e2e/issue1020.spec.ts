import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { writeEditor } from './editor';

let app: ElectronApplication, page: Page, userData: string;
async function launch() {
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), TWA_TEST_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [resolve('out/main/main.js')], env }); page = await app.firstWindow();
  await expect(page.getByTestId('writing-editor')).toBeVisible();
}
test.beforeEach(async () => { userData = await mkdtemp(join(tmpdir(), 'twa-issue1020-')); await launch(); });
test.afterEach(async () => { await app.evaluate(({ app: main }) => main.exit(0)).catch(() => {}); });

test('issue1020: failed connection details preserve responses in an isolated window without changing settings layout', async () => {
  const key = 'synthetic-connection-credential';
  let mode = 'empty'; const requests: string[] = [];
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', chunk => { raw += chunk; }); req.on('end', () => {
      requests.push(raw); res.setHeader('x-request-id', 'provider-request-123'); res.setHeader('set-cookie', 'session=private-cookie');
      if (mode === 'http') { res.writeHead(401); res.end('<html><script>window.attack = true</script>upstream rejected ' + 'x'.repeat(7000) + ' END_OF_RESPONSE</html>'); return; }
      const input = JSON.parse(JSON.parse(raw).messages[1].content);
      const result = { sentence_id: input.sentence_id, original_text: input.original_text, status: 'good', overall_explanation_zh: '表达良好。', suggested_revision: null, issues: [], confidence: 0.9 };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: mode === 'empty' ? null : JSON.stringify(result), reasoning: 'upstream reasoning retained' }, finish_reason: mode === 'empty' ? 'length' : 'stop' }], echo: req.headers.authorization, api_key: 'server-secret' }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    await writeEditor(page, 'PRIVATE_DRAFT_SENTINEL.');
    await page.getByRole('button', { name: '打开设置' }).click();
    await page.getByLabel('Provider', { exact: true }).selectOption('custom');
    await page.getByLabel('配置名称', { exact: true }).fill('OpenRouterFree2');
    await page.getByLabel('Base URL', { exact: true }).fill(`http://127.0.0.1:${port}/v1`);
    await page.getByLabel('Model', { exact: true }).fill('minimax/minimax-m3.1-flash:free');
    await page.getByLabel('API Key', { exact: true }).fill(key);
    await page.getByRole('button', { name: '测试连接', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'OpenRouterFree2' })).toContainText('模型返回空内容');
    const firstWindow = app.waitForEvent('window'); await page.getByRole('button', { name: '查看详情', exact: true }).click();
    const detail = await firstWindow;
    await expect(detail.getByRole('heading', { name: '连接测试详情', exact: true })).toBeVisible();
    await expect(detail.getByRole('heading', { level: 2 })).toHaveCount(2);
    await expect(detail.locator('body')).toContainText('HTTP 200');
    await expect(detail.locator('body')).toContainText('"content": null');
    await expect(detail.locator('body')).toContainText('"finish_reason": "length"');
    await expect(detail.locator('body')).toContainText('provider-request-123');
    for (const secret of [key, 'server-secret', 'private-cookie']) await expect(detail.locator('body')).not.toContainText(secret);
    expect(await detail.evaluate(() => ({ require: typeof (window as unknown as { require?: unknown }).require, api: typeof window.desktop }))).toEqual({ require: 'undefined', api: 'undefined' });
    expect(requests).toHaveLength(2); expect(requests.join('\n')).not.toContain('PRIVATE_DRAFT_SENTINEL');
    await detail.close(); await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByLabel('Model', { exact: true })).toHaveValue('minimax/minimax-m3.1-flash:free');
    mode = 'http'; await page.getByRole('button', { name: '测试连接', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'OpenRouterFree2' })).toContainText('认证失败');
    const nextWindow = app.waitForEvent('window'); await page.getByRole('button', { name: '查看详情', exact: true }).click();
    const httpDetail = await nextWindow;
    await expect(httpDetail.locator('body')).toContainText('HTTP 401');
    await expect(httpDetail.locator('body')).toContainText('END_OF_RESPONSE');
    expect(await httpDetail.evaluate(() => (window as unknown as { attack?: boolean }).attack)).toBeUndefined();
    await httpDetail.close();
    mode = 'good'; await page.getByRole('button', { name: '测试连接', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'OpenRouterFree2' })).toContainText('连接成功');
    await expect(page.getByRole('button', { name: '查看详情', exact: true })).toHaveCount(0);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('issue1020: moving a saved file marks the editor unsaved and never recreates the old path', async () => {
  const original = join(userData, 'original.md'), moved = join(userData, 'moved.md'), replacement = join(userData, 'chosen.md');
  const text = 'Keep my writing after moving its file.';
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog; }, original);
  await writeEditor(page, text); await page.getByRole('button', { name: /^保存/ }).click();
  await expect(page.locator('.save-pill')).toHaveText('已保存');
  await rename(original, moved);
  await expect(page.locator('.save-pill')).toHaveText('未保存至文件');
  await expect(page.getByTestId('writing-editor')).toHaveText(text);
  await expect.poll(async () => JSON.parse(await readFile(join(userData, 'draft.json'), 'utf8')).path).toBeNull();
  const closed = app.waitForEvent('close'); await app.evaluate(({ app: main }) => main.exit(0)); await closed;
  await launch(); await expect(page.locator('.save-pill')).toHaveText('未保存至文件');
  await expect(page.getByTestId('writing-editor')).toHaveText(text);
  await app.evaluate(({ dialog }) => { dialog.showSaveDialog = (async () => ({ canceled: true, filePath: '' })) as typeof dialog.showSaveDialog; });
  await page.getByRole('button', { name: /^保存/ }).click();
  await expect(page.locator('.save-pill')).toHaveText('未保存至文件');
  await expect(readFile(original)).rejects.toMatchObject({ code: 'ENOENT' });
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog; }, replacement);
  await page.getByRole('button', { name: /^保存/ }).click(); await expect(page.locator('.save-pill')).toHaveText('已保存');
  await expect(page.locator('.document-name')).toHaveText('chosen.md');
  expect(await readFile(replacement, 'utf8')).toBe(text); expect(await readFile(moved, 'utf8')).toBe(text);
  await expect(readFile(original)).rejects.toMatchObject({ code: 'ENOENT' });
});
