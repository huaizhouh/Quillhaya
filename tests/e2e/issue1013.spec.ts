import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';

let app: ElectronApplication, page: Page, userData: string;
test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'twa-issue1013-'));
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), TWA_TEST_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [resolve('out/main/main.js')], env }); page = await app.firstWindow();
  await expect(page.getByTestId('writing-editor')).toBeVisible();
});
test.afterEach(async () => { await app.evaluate(({ app: main }) => main.exit(0)).catch(() => {}); });

async function reviewServer() {
  const state = { hold: false, requests: [] as { sentence_id: string; original_text: string; context: { before: string[]; after: string[]; task: string } }[], pending: [] as (() => void)[] };
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', chunk => { raw += chunk; }); req.on('end', () => {
      const body = JSON.parse(raw); res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/generate') { res.end(JSON.stringify({ done: true, done_reason: 'unload' })); return; }
      const input = JSON.parse(body.messages[1].content); state.requests.push(input);
      const full = input.sentence_id === 'document-review';
      const index = state.requests.filter(r => r.sentence_id === 'document-review').length;
      const revise = !full && /\bHe go\b/.test(input.original_text);
      const result = { sentence_id: input.sentence_id, original_text: input.original_text, status: revise ? 'needs_revision' : 'good',
        overall_explanation_zh: full ? `全文反馈第 ${index} 次：结构清晰。` : revise ? '主语 He 为第三人称单数，谓语需要 goes。' : '表达良好，无需修改。',
        suggested_revision: revise ? input.original_text.replace('He go', 'He goes') : null,
        issues: revise ? [{ type: 'grammar', severity: 'error', original_span: 'go', suggested_text: 'goes', explanation_zh: '第三人称单数需要 goes。' }] : [], confidence: 0.9 };
      const send = () => res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
      if (state.hold) state.pending.push(send); else send();
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const saved = await page.evaluate(async port => {
    const boot = await window.desktop.bootstrap(); if (!boot.ok) throw Error('bootstrap');
    const profile = { ...boot.value.settings.profiles[0], name: '本地回归测试', kind: 'ollama' as const, model: 'context-test', baseUrl: `http://127.0.0.1:${port}/v1` };
    return window.desktop.saveSettings({ ...boot.value.settings, profiles: [profile] }, {});
  }, port);
  expect(saved.ok).toBe(true); await page.reload(); await expect(page.getByTestId('writing-editor')).toBeVisible();
  return { state, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

test('issue1013: new and recovered empty drafts are unsaved until an actual file save succeeds', async () => {
  await expect(page.locator('.document-name')).toHaveText('未命名.md'); await expect(page.locator('.save-pill')).toHaveText('未保存至文件');
  await expect(page.locator('.draft-status')).toContainText('草稿已自动保存'); await page.reload();
  await expect(page.locator('.save-pill')).toHaveText('未保存至文件');
  await app.evaluate(({ dialog }) => { dialog.showSaveDialog = (async () => ({ canceled: true, filePath: '' })) as typeof dialog.showSaveDialog; });
  await page.getByRole('button', { name: /^保存/ }).click(); await expect(page.locator('.save-pill')).toHaveText('未保存至文件');
  const path = join(userData, '未命名.md');
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog; }, path);
  await page.getByRole('button', { name: /^保存/ }).click(); await expect(page.locator('.save-pill')).toHaveText('已保存');
  expect(await readFile(path, 'utf8')).toBe(''); await page.reload(); await expect(page.locator('.save-pill')).toHaveText('已保存');
  await page.getByRole('button', { name: '新建文档' }).click(); await expect(page.locator('.save-pill')).toHaveText('未保存至文件');
});

test('issue1013: email salutation and opening sentence are sent together with exact line breaks', async () => {
  const server = await reviewServer();
  try {
    await page.getByLabel('写作模式').selectOption('email'); await page.getByTestId('writing-editor').fill('Dear Alex,\nHello. I need help.');
    await expect(page.getByTestId('feedback-card')).toHaveCount(2); await expect(page.getByTestId('feedback-card').first()).toContainText('表达良好');
    await expect.poll(() => server.state.requests.length).toBe(2);
    expect(server.state.requests[0].original_text).toBe('Dear Alex,\nHello.');
    expect(server.state.requests[1].context.before).toEqual(['Dear Alex,\nHello.']);
  } finally { await server.close(); }
});

test('issue1013: old sentence advice stays visible and disabled during the longer edit wait and refresh', async () => {
  const server = await reviewServer();
  try {
    const editor = page.getByTestId('writing-editor'), card = page.getByTestId('feedback-card');
    await editor.fill('He go home.'); await expect(card.getByRole('button', { name: '接受修改', exact: true })).toBeEnabled();
    server.state.hold = true; await editor.fill('He go home today.');
    await expect(card).toContainText('保留上次意见'); await expect(card).toContainText('原句已修改'); await expect(card.locator('.suggestion')).toContainText('He goes home.');
    await expect(card.getByRole('button', { name: '接受修改', exact: true })).toBeDisabled();
    await expect(page.locator('.draft-status')).toContainText('草稿已自动保存'); expect(server.state.requests).toHaveLength(1);
    await expect.poll(() => server.state.pending.length).toBe(1);
    await expect(card).toContainText('分析中'); await expect(card.locator('.suggestion')).toContainText('He goes home.');
    await page.screenshot({ path: 'docs/issue1013-preserved-feedback.png' });
    server.state.pending[0]();
    await expect(card.locator('.suggestion')).toContainText('He goes home today.'); await expect(card).not.toContainText('原句已修改');
    await expect(card.getByRole('button', { name: '接受修改', exact: true })).toBeEnabled(); await expect(editor).toBeFocused();
  } finally { await server.close(); }
});

test('issue1013: full review survives edits and an interrupted manual refresh until explicitly rerun', async () => {
  const server = await reviewServer();
  try {
    await page.getByRole('button', { name: '暂停自动分析' }).click();
    const editor = page.getByTestId('writing-editor'); await editor.fill('We learn.');
    await page.getByRole('button', { name: '分析全文', exact: true }).click();
    const full = page.getByTestId('feedback-card').filter({ hasText: '全文 · 结构' }); await expect(full).toContainText('全文反馈第 1 次');
    await editor.fill('We learn together.'); await expect(full).toContainText('全文或分析设置已变化'); await expect(full).toContainText('全文反馈第 1 次');
    await expect(page.locator('.draft-status')).toContainText('草稿已自动保存'); expect(server.state.requests).toHaveLength(1);
    server.state.hold = true; await page.getByRole('button', { name: '分析全文', exact: true }).click();
    await expect.poll(() => server.state.pending.length).toBe(1); await expect(full).toContainText('全文反馈第 1 次');
    await editor.fill('We learn together every day.'); await expect(full).toContainText('全文反馈第 1 次');
    server.state.pending[0](); server.state.hold = false;
    await page.getByRole('button', { name: '分析全文', exact: true }).click();
    await expect(full).toContainText('全文反馈第 3 次'); await expect(full).not.toContainText('全文或分析设置已变化');
    expect(server.state.requests.at(-1)?.original_text).toBe('We learn together every day.');
    await page.screenshot({ path: 'docs/issue1013-full-review.png' });
  } finally { await server.close(); }
});

test('issue1013: automatic and manual sentence review carry the current context to the HTTP endpoint', async () => {
  const server = await reviewServer();
  try {
    const before = 'I recently moved into your apartment, and I found it cozy and comfortable.';
    const sentence = 'Last day, however, I experienced issues with the heating system.';
    const after = 'Could you arrange a repair?';
    await page.getByLabel('写作模式').selectOption('email'); await page.getByTestId('writing-editor').fill(`${before} ${sentence}`);
    await expect(page.getByTestId('feedback-card').nth(1)).toContainText('表达良好');
    expect(server.state.requests[1].context.before).toEqual([before]);
    await page.getByRole('button', { name: '暂停自动分析' }).click();
    await page.getByTestId('writing-editor').fill(`${before} ${sentence} ${after}`);
    const card = page.getByTestId('feedback-card').nth(1); await card.getByRole('button', { name: '重新评估', exact: true }).click();
    await expect.poll(() => server.state.requests.length).toBe(3);
    expect(server.state.requests[2].context).toEqual({ before: [before], after: [after], task: '' });
    await expect(card).not.toContainText('上下文已变化'); await card.getByRole('button', { name: '详情' }).click();
    await expect(card).not.toContainText('本次审议使用的上下文');
    await expect(card).not.toContainText(before); await expect(card).not.toContainText(after);
  } finally { await server.close(); }
});

test('issue1013: revision delay has a visible independent setting and persists without changing normal debounce', async () => {
  await page.getByRole('button', { name: '打开设置' }).click();
  await expect(page.getByLabel('修改后重新评估等待', { exact: true })).toHaveValue('3000');
  await page.getByLabel('修改后重新评估等待', { exact: true }).fill('4500'); await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.getByRole('button', { name: '打开设置' }).click();
  await expect(page.getByLabel('修改后重新评估等待', { exact: true })).toHaveValue('4500'); await expect(page.getByLabel('停顿延迟', { exact: true })).toHaveValue('1200');
  await page.getByLabel('修改后重新评估等待', { exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: 'docs/issue1013-settings.png' });
});
