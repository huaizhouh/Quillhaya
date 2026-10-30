import { launchIsolated } from './isolated-electron';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { writeEditor } from './editor';

let app: ElectronApplication, page: Page, userData: string;
async function launch() {
  app = await launchIsolated(userData); page = await app.firstWindow();
  await expect(page.getByTestId('writing-editor')).toBeVisible();
}
test.beforeEach(async () => { userData = await mkdtemp(join(tmpdir(), 'twa-issue1014-')); await launch(); });
test.afterEach(async () => { await app.evaluate(({ app: main }) => main.exit(0)).catch(() => {}); });

test('issue1014: continuing to write does not mark earlier reviews stale, while reviewed neighbor edits do', async () => {
  const editor = page.getByTestId('writing-editor');
  await writeEditor(page, 'We learn.');
  const first = page.getByTestId('feedback-card').first(); await expect(first).toContainText('表达良好');
  await writeEditor(page, 'We learn. Practice'); await editor.press('End'); await editor.pressSequentially(' helps.');
  await expect(page.getByTestId('feedback-card').nth(1)).toContainText('表达良好');
  await expect(first).not.toContainText('上下文已变化');
  await writeEditor(page, 'We learn. Practice helps. We improve.');
  await expect(page.getByTestId('feedback-card').nth(2)).toContainText('表达良好');
  await expect(page.getByTestId('feedback-card').nth(1)).not.toContainText('上下文已变化');
  await first.getByRole('button', { name: '重新评估', exact: true }).click();
  await expect(first).toContainText('表达良好');
  await writeEditor(page, 'We learn. Practice helps everyone. We improve.');
  await expect(first).toContainText('上下文已变化');
});

test('issue1014: save during native quit restores the saved file and subsequent saves reuse its path', async () => {
  const path = join(userData, 'my-letter.md'), text = 'My letter is saved when I quit.';
  await app.evaluate(({ dialog }, path) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
  }, path);
  await writeEditor(page, text);
  const closed = app.waitForEvent('close'); await app.evaluate(({ app: main }) => main.quit()); await closed;
  const draft = JSON.parse(await readFile(join(userData, 'draft.json'), 'utf8'));
  expect(draft).toMatchObject({ path, savedText: text, document: { name: 'my-letter.md', hasFile: true, dirty: false, text } });
  await launch(); await expect(page.locator('.document-name')).toHaveText('my-letter.md');
  await expect(page.locator('.save-pill')).toHaveText('已保存'); await expect(page.getByTestId('writing-editor')).toHaveText(text);
  await app.evaluate(({ dialog }) => {
    // A clean close must need neither dialog. Existing-file Save must not ask for a path.
    dialog.showMessageBox = (async () => ({ response: 2, checkboxChecked: false })) as typeof dialog.showMessageBox;
    dialog.showSaveDialog = (async () => ({ canceled: true, filePath: '' })) as typeof dialog.showSaveDialog;
  });
  const edited = `${text} More details.`; await writeEditor(page, edited);
  await page.getByRole('button', { name: /^保存/ }).click(); await expect(page.locator('.save-pill')).toHaveText('已保存');
  expect(await readFile(path, 'utf8')).toBe(edited);
  const closedAgain = app.waitForEvent('close'); await app.evaluate(({ app: main }) => main.quit()); await closedAgain;
  await launch(); await expect(page.locator('.document-name')).toHaveText('my-letter.md');
  await expect(page.locator('.save-pill')).toHaveText('已保存'); await expect(page.getByTestId('writing-editor')).toHaveText(edited);
});

test('issue1014: optional expression advice remains visible after one review', async () => {
  let calls = 0;
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', chunk => { raw += chunk; }); req.on('end', () => {
      calls++; const input = JSON.parse(JSON.parse(raw).messages[1].content);
      const style = { type: 'conciseness', severity: 'improvement', original_span: 'at this point in time', suggested_text: 'now', explanation_zh: '原句语法正确，可以用 now 更简洁地表达。' };
      const result = { sentence_id: input.sentence_id, original_text: input.original_text, status: 'needs_revision',
        suggested_revision: input.original_text.replace('at this point in time', 'now'), overall_explanation_zh: '语法正确，可以精简时间表达。',
        issues: [style], confidence: 0.9 };
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    await page.evaluate(async port => {
      const boot = await window.desktop.bootstrap(); if (!boot.ok) throw Error('bootstrap');
      const profile = { ...boot.value.settings.profiles[0], kind: 'custom' as const, baseUrl: `http://127.0.0.1:${port}/v1` };
      const saved = await window.desktop.saveSettings({ ...boot.value.settings, profiles: [profile] }, {});
      if (!saved.ok) throw Error(saved.error.message);
    }, port);
    await page.reload(); await writeEditor(page, 'We need more information at this point in time.');
    const card = page.getByTestId('feedback-card').first(); await expect(card).toContainText('可选优化');
    await card.getByRole('button', { name: '详情' }).click();
    await expect(card).toContainText('简洁度 · 可选优化'); await expect(card).not.toContainText('客观错误');
    expect(calls).toBe(2);
    await expect(card.getByRole('button', { name: '接受修改', exact: true })).toBeEnabled();
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
